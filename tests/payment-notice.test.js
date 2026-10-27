'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Pool } = require('pg');
const { assertDisposableDatabase } = require('./helpers/pesapalFixture');
const { withPaymentTransaction } = require('../services/paymentTransaction');
const notices = require('../services/paymentNoticeService');

describe('Durable payment notifications on disposable PostgreSQL', {
  skip: !process.env.PESAPAL_TEST_SENTINEL && 'Run node scripts/test-pesapal-payments.js for an owned PostgreSQL cluster', concurrency: false
}, () => {
  let pool;
  let db;
  before(async () => {
    pool = new Pool({ connectionString: process.env.PESAPAL_TEST_DATABASE_URL, max: 6 });
    await assertDisposableDatabase(pool);
    db = { query: pool.query.bind(pool), getClient: pool.connect.bind(pool) };
  });
  after(async () => { if (pool) await pool.end(); });

  async function fixture(t, extra = {}) {
    const id = randomUUID();
    await pool.query(`INSERT INTO pay_links(id,code,purpose,description,amount_ugx,card_currency,card_amount_minor,fx_rate_ugx)
      VALUES ($1,$2,'other','Local notification proof',50000,'USD',1352,3700)`, [id, `MN${randomUUID().replace(/-/g, '').slice(0, 12)}`]);
    t.after(async () => {
      await pool.query('DELETE FROM payment_notice_retries WHERE pay_link_id=$1', [id]);
      await pool.query('DELETE FROM pay_links WHERE id=$1', [id]);
    });
    const input = { eventKey: `local-notice:${randomUUID()}`, payLinkId: id, kind: 'payment_receipt', recipient: '256700000001', body: 'Your exact payment receipt. Reference LOCAL-123.', payload: { receipt: 'LOCAL-123', details: { amountUgx: 50000 } }, ...extra };
    const row = await withPaymentTransaction(db, tx => notices.enqueueNotice(tx, input));
    // This suite shares an owned test database with integration fixtures. Give
    // its own rows priority and delete only its own rows during cleanup.
    await pool.query("UPDATE payment_notice_retries SET next_attempt_at='2000-01-01' WHERE id=$1", [row.id]);
    return { input, row, stored: async () => (await pool.query('SELECT * FROM payment_notice_retries WHERE id=$1', [row.id])).rows[0] };
  }

  test('same event key reuses exact intent and rejects changed recipient/body/payload', async t => {
    const job = await fixture(t);
    const duplicate = await withPaymentTransaction(db, tx => notices.enqueueNotice(tx, { ...job.input, payload: { details: { amountUgx: 50000 }, receipt: 'LOCAL-123' } }));
    assert.equal(duplicate, null);
    for (const override of [{ recipient: '256700000002' }, { body: 'Changed receipt' }, { payload: { receipt: 'LOCAL-999' } }]) {
      await assert.rejects(withPaymentTransaction(db, tx => notices.enqueueNotice(tx, { ...job.input, ...override })), { code: 'PAYMENT_NOTICE_INTENT_CONFLICT' });
    }
    const stored = await job.stored();
    assert.equal(stored.recipient, '256700000001');
    assert.equal(stored.body, 'Your exact payment receipt. Reference LOCAL-123.');
    assert.deepEqual(stored.payload, { receipt: 'LOCAL-123', details: { amountUgx: 50000 } });
    assert.equal(stored.attempts, 0);
    await assert.rejects(pool.query('UPDATE payment_notice_retries SET recipient=$2 WHERE id=$1', [stored.id, '256700000003']), { code: '23514' });
  });

  test('no notice survives rollback and a transaction cannot run transport work', async t => {
    const job = await fixture(t);
    const key = `rolled-back:${randomUUID()}`;
    await assert.rejects(withPaymentTransaction(db, async tx => {
      await notices.enqueueNotice(tx, { ...job.input, eventKey: key });
      throw Object.assign(new Error('Local rollback'), { code: 'LOCAL_ROLLBACK' });
    }), { code: 'LOCAL_ROLLBACK' });
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM payment_notice_retries WHERE event_key=$1', [key])).rows[0].n, 0);
    await assert.rejects(withPaymentTransaction(db, tx => notices.drainPaymentNotices(tx, { deliver: async () => ({ status: 'sent' }) })), { code: 'PAYMENT_TRANSACTION_WRAPPER' });
    assert.equal((await job.stored()).status, 'pending');
  });

  test('queued transport keeps its durable reference without claiming sent or resending', async t => {
    const job = await fixture(t);
    const delivered = [];
    const result = await notices.drainPaymentNotices(db, { limit: 1, deliver: async intent => {
      delivered.push({ recipient: intent.recipient, body: intent.body, key: intent.event_key });
      return { status: 'queued', reference: 'LOCAL-QUEUE-123' };
    } });
    assert.equal(result.queued, 1);
    assert.deepEqual(delivered, [{ recipient: job.input.recipient, body: job.input.body, key: job.input.eventKey }]);
    const stored = await job.stored();
    assert.equal(stored.status, 'queued');
    assert.equal(stored.delivered_at, null);
    assert.equal(stored.transport_reference, 'LOCAL-QUEUE-123');
    assert.equal(stored.claim_id, null);
    assert.equal(stored.claimed_until, null);
    // A terminal queued job cannot be reclaimed even when its due date is old.
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM payment_notice_retries
      WHERE id=$1 AND status IN ('pending','retry') AND next_attempt_at<=now()`, [stored.id])).rows[0].n, 0);
  });

  test('simulated or mocked transport never claims sent, even with a sent flag', async t => {
    const job = await fixture(t);
    const result = await notices.drainPaymentNotices(db, { limit: 1, deliver: async () => ({ status: 'sent', sent: true, simulated: true, id: 'LOCAL-SIMULATED' }) });
    assert.equal(result.simulated, 1);
    assert.equal(result.sent, 0);
    const stored = await job.stored();
    assert.equal(stored.status, 'simulated');
    assert.equal(stored.delivered_at, null);
    assert.equal(stored.transport_reference, 'LOCAL-SIMULATED');
  });

  test('missing queue proof and blocked/skipped deliveries remain retryable with safe errors', async t => {
    const job = await fixture(t);
    for (const [delivery, code] of [[null, 'delivery_failed'], [{ status: 'queued' }, 'queue_reference_missing'], [{ status: 'skipped', reason: 'blocked_by_provider' }, 'blocked_by_provider'], [{ status: 'failed', reason: 'SECRET account 256700000001' }, 'delivery_failed']]) {
      await pool.query("UPDATE payment_notice_retries SET next_attempt_at='2000-01-01' WHERE id=$1", [job.row.id]);
      const result = await notices.drainPaymentNotices(db, { limit: 1, deliver: async () => delivery });
      assert.equal(result.retry, 1);
      const stored = await job.stored();
      assert.equal(stored.status, 'retry');
      assert.equal(stored.last_error_code, code);
      assert.equal(stored.delivered_at, null);
      assert.equal(stored.claim_id, null);
    }
    await pool.query("UPDATE payment_notice_retries SET attempts=11,next_attempt_at='2000-01-01' WHERE id=$1", [job.row.id]);
    const result = await notices.drainPaymentNotices(db, { limit: 1, deliver: async () => { throw new Error('private failure text'); } });
    assert.equal(result.review, 1);
    assert.equal((await job.stored()).status, 'review');
  });

  test('a stale owner cannot overwrite a new queued owner', async t => {
    const job = await fixture(t);
    const first = await notices.drainPaymentNotices(db, { limit: 1, deliver: async intent => {
      await pool.query("UPDATE payment_notice_retries SET claimed_until=now()-interval '1 second' WHERE id=$1", [intent.id]);
      const second = await notices.drainPaymentNotices(db, { limit: 1, deliver: async current => {
        assert.equal(current.event_key, job.input.eventKey);
        return { status: 'queued', id: 'LOCAL-NEW-OWNER' };
      } });
      assert.equal(second.queued, 1);
      return { status: 'sent', id: 'LOCAL-STALE-OWNER' };
    } });
    assert.equal(first.sent, 0);
    const stored = await job.stored();
    assert.equal(stored.status, 'queued');
    assert.equal(stored.transport_reference, 'LOCAL-NEW-OWNER');
    assert.equal(stored.delivered_at, null);
    assert.equal(stored.attempts, 2);
  });

  test('lease expiry before acknowledgement leaves the exact intent recoverable', async t => {
    const job = await fixture(t);
    const first = await notices.drainPaymentNotices(db, { limit: 1, deliver: async intent => {
      assert.throws(() => { intent.recipient = '256700000099'; }, TypeError);
      assert.throws(() => { intent.payload.details.amountUgx = 1; }, TypeError);
      await pool.query("UPDATE payment_notice_retries SET claimed_until=now()-interval '1 second' WHERE id=$1", [intent.id]);
      return { status: 'sent', id: 'LOCAL-UNRECORDED-SEND' };
    } });
    assert.equal(first.sent, 0);
    assert.equal((await job.stored()).status, 'pending');
    const second = await notices.drainPaymentNotices(db, { limit: 1, deliver: async intent => {
      assert.equal(intent.recipient, job.input.recipient);
      assert.equal(intent.body, job.input.body);
      assert.deepEqual(intent.payload, job.input.payload);
      return { status: 'sent', id: 'LOCAL-RECOVERY-SEND' };
    } });
    assert.equal(second.sent, 1);
    const stored = await job.stored();
    assert.equal(stored.status, 'sent');
    assert.ok(stored.delivered_at instanceof Date);
    assert.equal(stored.transport_reference, 'LOCAL-RECOVERY-SEND');
    assert.equal(stored.attempts, 2);
  });

  test('concurrent drains cannot deliver the same unexpired claim', async t => {
    const job = await fixture(t);
    const other = await fixture(t);
    await pool.query("UPDATE payment_notice_retries SET next_attempt_at='1999-01-01' WHERE id=$1", [job.row.id]);
    const seen = [];
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    let started;
    const entered = new Promise(resolve => { started = resolve; });
    const first = notices.drainPaymentNotices(db, { limit: 1, deliver: async intent => {
      seen.push(intent.event_key);
      started();
      await blocked;
      return { status: 'sent', id: 'LOCAL-CONCURRENT' };
    } });
    await entered;
    // Inspect the actual claim from a different connection while delivery waits.
    const stored = await job.stored();
    assert.equal(stored.status, 'pending');
    assert.ok(stored.claim_id);
    assert.ok(stored.claimed_until > new Date());
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM payment_notice_retries WHERE id=$1
      AND status IN ('pending','retry') AND (claimed_until IS NULL OR claimed_until<now())`, [job.row.id])).rows[0].n, 0);
    const second = await notices.drainPaymentNotices(db, { limit: 1, deliver: async intent => {
      assert.equal(intent.id, other.row.id);
      return { status: 'sent', id: 'LOCAL-OTHER-CONCURRENT' };
    } });
    assert.equal(second.sent, 1);
    release();
    assert.equal((await first).sent, 1);
    assert.deepEqual(seen, [job.input.eventKey]);
    assert.equal((await other.stored()).status, 'sent');
  });

  test('internal payment event awaits its exact payload and retries asynchronous consumer failure', async t => {
    const job = await fixture(t, { kind: 'payment.succeeded', channel: 'event', recipient: '', body: '', payload: { id: 'LOCAL-PAYMENT', status: 'paid' } });
    const filename = require.resolve('../services/paymentProviderService');
    const prior = require.cache[filename];
    const priorDispatch = process.env.PAYMENT_NOTICE_DISPATCH_ENABLED;
    process.env.PAYMENT_NOTICE_DISPATCH_ENABLED = 'true';
    const events = new EventEmitter();
    const received = [];
    events.on('payment.succeeded', async payload => {
      await Promise.resolve();
      received.push(payload);
      throw Object.assign(new Error('Local asynchronous consumer failure'), { code: 'LOCAL_EVENT_FAILURE' });
    });
    require.cache[filename] = { id: filename, filename, loaded: true, exports: { paymentEvents: events } };
    try {
      const first = await notices.drainPaymentNotices(db, { limit: 1 });
      assert.equal(first.retry, 1);
      assert.equal((await job.stored()).last_error_code, 'LOCAL_EVENT_FAILURE');
      assert.deepEqual(received, [{ id: 'LOCAL-PAYMENT', status: 'paid' }]);
      events.removeAllListeners();
      events.on('payment.succeeded', async payload => { await Promise.resolve(); received.push(payload); });
      await pool.query("UPDATE payment_notice_retries SET next_attempt_at='2000-01-01' WHERE id=$1", [job.row.id]);
      assert.equal((await notices.drainPaymentNotices(db, { limit: 1 })).sent, 1);
      assert.equal((await job.stored()).status, 'sent');
      assert.deepEqual(received, [{ id: 'LOCAL-PAYMENT', status: 'paid' }, { id: 'LOCAL-PAYMENT', status: 'paid' }]);
    } finally {
      if (prior) require.cache[filename] = prior; else delete require.cache[filename];
      if (priorDispatch === undefined) delete process.env.PAYMENT_NOTICE_DISPATCH_ENABLED;
      else process.env.PAYMENT_NOTICE_DISPATCH_ENABLED = priorDispatch;
    }
  });

  test('dispatcher disable flag blocks default transport without claiming a committed notice', async t => {
    const job = await fixture(t);
    const priorDispatch = process.env.PAYMENT_NOTICE_DISPATCH_ENABLED;
    process.env.PAYMENT_NOTICE_DISPATCH_ENABLED = 'false';
    try {
      const result = await notices.drainPaymentNotices({ query: async () => { throw new Error('Disabled dispatcher must not claim work.'); } }, { limit: 1 });
      assert.deepEqual(result, { checked: 0, sent: 0, queued: 0, simulated: 0, retry: 0, review: 0 });
      const stored = await job.stored();
      assert.equal(stored.status, 'pending');
      assert.equal(stored.attempts, 0);
      assert.equal(stored.claim_id, null);
      assert.equal((await notices.drainPaymentNotices(db, { limit: 1, deliver: async () => ({ status: 'simulated' }) })).simulated, 1);
    } finally {
      if (priorDispatch === undefined) delete process.env.PAYMENT_NOTICE_DISPATCH_ENABLED;
      else process.env.PAYMENT_NOTICE_DISPATCH_ENABLED = priorDispatch;
    }
  });
});
