'use strict';

const logger = require('../config/logger');
const { randomUUID } = require('crypto');
const { assertPaymentTransaction, assertOutsidePaymentTransaction } = require('./paymentTransaction');

const LEASE_SECONDS = 90;
const DELIVERY_REASONS = new Set(['delivery_failed', 'not_sent', 'invalid_phone', 'invalid_recipient', 'empty_body',
  'makaug_own_number', 'blocked_by_provider', 'provider_missing', 'meta_whatsapp_not_configured',
  'no_whatsapp_provider_configured', 'twilio_whatsapp_not_configured']);

function freezePayload(value) {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freezePayload(item);
    Object.freeze(value);
  }
  return value;
}

function safeCode(error) {
  const code = String(error?.code || 'delivery_failed');
  return DELIVERY_REASONS.has(code) || /^(?:E[A-Z0-9_]{1,30}|[0-9A-Z]{5}|PAYMENT_[A-Z0-9_]{1,45}|LOCAL_[A-Z0-9_]{1,45})$/.test(code) ? code : 'delivery_failed';
}

async function enqueueNotice(tx, input) {
  assertPaymentTransaction(tx);
  const channel = input.channel || 'whatsapp';
  const recipient = input.recipient || '';
  const body = input.body || '';
  if (typeof input.eventKey !== 'string' || !input.eventKey || input.eventKey.length > 500 || /[\u0000-\u001f\u007f]/.test(input.eventKey) ||
      typeof input.kind !== 'string' || !/^[A-Za-z0-9_.:-]{1,100}$/.test(input.kind) ||
      !['whatsapp', 'event'].includes(channel) || typeof recipient !== 'string' || typeof body !== 'string' || body.length > 10000 ||
      (channel === 'whatsapp' && (!/^\+?[0-9]{7,15}$/.test(recipient) || !body.trim())) ||
      (channel === 'event' && (input.kind !== 'payment.succeeded' || recipient !== '' || body !== ''))) {
    throw Object.assign(new Error('Payment notification intent is invalid.'), { code: 'PAYMENT_NOTICE_INVALID' });
  }
  const payload = input.payload || {};
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw Object.assign(new Error('Payment notification payload must be an object.'), { code: 'PAYMENT_NOTICE_INVALID' });
  }
  const values = [input.eventKey, input.payLinkId, input.entryId || null, input.attemptId || null,
    input.kind, channel, recipient, body, JSON.stringify(payload)];
  const row = (await tx.query(
    `INSERT INTO payment_notice_retries
       (event_key, pay_link_id, ledger_entry_id, pesapal_attempt_id, notice_kind, channel, recipient, body, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (event_key) DO NOTHING RETURNING *`,
    values
  )).rows[0];
  if (row) return row;
  // A retry may reuse an event key only for the same immutable intent. JSONB
  // equality ignores object key order, but retains every persisted value.
  const prior = await tx.query(
    `SELECT id FROM payment_notice_retries
      WHERE event_key = $1 AND pay_link_id = $2::uuid
        AND ledger_entry_id IS NOT DISTINCT FROM $3::uuid
        AND pesapal_attempt_id IS NOT DISTINCT FROM $4::uuid
        AND notice_kind = $5 AND channel = $6 AND recipient = $7 AND body = $8 AND payload = $9::jsonb`,
    values
  );
  if (!prior.rows.length) {
    throw Object.assign(new Error('Payment notification event key has different intent.'), { code: 'PAYMENT_NOTICE_INTENT_CONFLICT' });
  }
  return null;
}

async function deliverNotice(job) {
  if (job.channel === 'event') {
    const events = require('./paymentProviderService').paymentEvents;
    // Await asynchronous consumers as well. A failure retries the event, so
    // consumers must tolerate repetition just as external recipients do.
    for (const listener of events.rawListeners(job.notice_kind)) await listener.call(events, job.payload);
    return { status: 'sent', provider: 'internal_event' };
  }
  return require('./leadHandoffService').deliverWhatsapp({
    to: job.recipient,
    body: job.body,
    kind: job.notice_kind,
    leadId: null,
    nonce: job.event_key
  });
}

async function drainPaymentNotices(db, { limit = 25, deliver = deliverNotice } = {}) {
  assertOutsidePaymentTransaction(db);
  if (typeof deliver !== 'function') throw new TypeError('A payment notification delivery function is required.');
  const count = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 25)));
  const result = { checked: 0, sent: 0, queued: 0, simulated: 0, retry: 0, review: 0 };
  if (deliver === deliverNotice && process.env.PAYMENT_NOTICE_DISPATCH_ENABLED === 'false') return result;
  for (let index = 0; index < count; index += 1) {
    const claimId = randomUUID();
    // Claim immediately before this delivery rather than aging leases for a
    // whole batch behind the first slow transport call.
    const job = (await db.query(
      `WITH due AS (
         SELECT id FROM payment_notice_retries
          WHERE status IN ('pending', 'retry') AND next_attempt_at <= NOW()
            AND (claimed_until IS NULL OR claimed_until < NOW())
          ORDER BY next_attempt_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       UPDATE payment_notice_retries n
          SET claimed_until = NOW() + ($1 * INTERVAL '1 second'), claim_id = $2, attempts = attempts + 1
         FROM due WHERE n.id = due.id RETURNING n.*`,
      [LEASE_SECONDS, claimId]
    )).rows[0];
    if (!job) break;
    result.checked += 1;
    let leaseLost = false;
    let renewal = null;
    const timer = setInterval(() => {
      if (renewal || leaseLost) return;
      renewal = db.query(
        `UPDATE payment_notice_retries SET claimed_until = NOW() + ($3 * INTERVAL '1 second')
          WHERE id = $1 AND claim_id = $2 AND claimed_until > NOW()
            AND status IN ('pending', 'retry') RETURNING id`,
        [job.id, claimId, LEASE_SECONDS]
      ).then(stored => { if (!stored.rows.length) leaseLost = true; })
        .catch(() => { leaseLost = true; })
        .finally(() => { renewal = null; });
    }, LEASE_SECONDS * 1000 / 3);
    timer.unref?.();
    let delivery;
    let failure;
    let status;
    let transportReference;
    try {
      const intent = Object.freeze({ ...job, payload: freezePayload(job.payload) });
      delivery = await deliver(intent);
      if (delivery?.simulated === true || delivery?.mocked === true || delivery?.status === 'simulated') status = 'simulated';
      else if (delivery?.queued === true || delivery?.status === 'queued') status = 'queued';
      else if (delivery?.sent === true || delivery?.status === 'sent') status = 'sent';
      else failure = safeCode({ code: delivery?.reason });
      const reference = delivery?.id || delivery?.messageId || delivery?.reference || delivery?.providerMessageId;
      transportReference = typeof reference === 'string' && reference.length <= 200 && !/[\u0000-\u001f\u007f]/.test(reference) ? reference : null;
      if (status === 'queued' && !transportReference) failure = 'queue_reference_missing';
    } catch (error) {
      failure = safeCode(error);
    } finally {
      clearInterval(timer);
      if (renewal) await renewal;
    }
    if (leaseLost) continue;
    if (!failure) {
      const stored = await db.query(
        `UPDATE payment_notice_retries SET status = $2, claimed_until = NULL, claim_id = NULL,
                delivered_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE NULL END,
                transport_reference = $3, last_error_code = NULL
          WHERE id = $1 AND claim_id = $4 AND claimed_until > NOW()
            AND status IN ('pending', 'retry')`,
        [job.id, status, transportReference, claimId]
      );
      if (stored.rowCount) result[status] += 1;
    } else {
      const code = /^[A-Za-z0-9_:-]{1,60}$/.test(failure) ? failure : 'delivery_failed';
      const state = job.attempts >= 12 ? 'review' : 'retry';
      const delay = Math.min(21600, 30 * (2 ** Math.min(10, Number(job.attempts))));
      const stored = await db.query(
        `UPDATE payment_notice_retries SET status = $2, claimed_until = NULL, claim_id = NULL,
                next_attempt_at = NOW() + ($3 * INTERVAL '1 second'), last_error_code = $4
          WHERE id = $1 AND claim_id = $5 AND claimed_until > NOW()
            AND status IN ('pending', 'retry')`,
        [job.id, state, delay, code, claimId]
      );
      if (stored.rowCount) {
        result[state] += 1;
        logger.warn('Payment notice needs retry', { noticeId: job.id, code, state });
      }
    }
  }
  return result;
}

let scheduled = false;
function kickPaymentNotices(db) {
  if (scheduled || process.env.PAYMENT_NOTICE_DISPATCH_ENABLED === 'false') return;
  scheduled = true;
  setImmediate(() => {
    drainPaymentNotices(db).catch((error) => {
      logger.warn('Payment notice worker failed', { code: safeCode(error) });
    }).finally(() => { scheduled = false; });
  }).unref?.();
}

module.exports = { enqueueNotice, drainPaymentNotices, kickPaymentNotices };
