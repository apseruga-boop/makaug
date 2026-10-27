'use strict';

const crypto = require('crypto');
const revenue = require('./revenueService');
const billingOps = require('./billingOpsService');
const { foundOnlinePropertySql } = require('../utils/foundOnlineSql');
const { isPublicLivePropertyStatus } = require('../utils/publicInventoryStatus');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIRECT_LISTER_SQL = `p.agent_id IS NULL AND NOT ${foundOnlinePropertySql('p')}`;
const PAYMENT_FIELDS = ['amount_ugx', 'amount', 'amount_original', 'amount_usd', 'fx_rate_ugx', 'method', 'reference',
  'transaction_id', 'payment_code', 'paid_at', 'payer_name', 'payer_phone', 'note', 'receipt_url', 'account_key'];

function pagination(query = {}, prefix = '') {
  const integer = (value, fallback, max) => /^\d+$/.test(String(value || ''))
    ? Math.min(max, Math.max(1, Number(value))) : fallback;
  return { page: integer(query[`${prefix}page`], 1, 100000), limit: integer(query[`${prefix}limit`], 25, 100) };
}

function pageInfo(page, limit, total) {
  return { page, limit, total: Number(total || 0), pages: Math.ceil(Number(total || 0) / limit) };
}

function publicListingUrl(row) {
  return isPublicLivePropertyStatus(row.status) && !['sold', 'let_agreed', 'unavailable'].includes(String(row.availability_status || ''))
    ? `/property/${encodeURIComponent(row.id)}` : null;
}

async function paymentHistory(db, { kind, id, page = 1, limit = 25 }) {
  const column = kind === 'agent_subscription' ? 'agent_id' : 'property_id';
  const where = `${column} = $1 AND kind = $2 AND direction = 'in' AND voided_at IS NULL`;
  const [summary, payments] = await Promise.all([
    db.query(`SELECT COALESCE(SUM(amount_ugx), 0)::bigint AS lifetime_paid_ugx, COUNT(*)::int AS payment_count,
      (array_agg(paid_at ORDER BY paid_at DESC, recorded_at DESC, id DESC))[1] AS last_payment_on,
      (array_agg(amount_ugx ORDER BY paid_at DESC, recorded_at DESC, id DESC))[1] AS last_payment_ugx,
      (array_agg(period_start ORDER BY paid_at DESC, recorded_at DESC, id DESC))[1]::text AS last_period_start,
      (array_agg(period_end ORDER BY paid_at DESC, recorded_at DESC, id DESC))[1]::text AS last_period_end
      FROM revenue_entries WHERE ${where}`, [id, kind]),
    db.query(`SELECT id, amount_ugx, method, account_key, reference, paid_at, recorded_at, recorded_by,
      verified_status, note, currency, amount_original, fx_rate_ugx,
      to_char(period_start, 'YYYY-MM-DD') AS period_start, to_char(period_end, 'YYYY-MM-DD') AS period_end
      FROM revenue_entries WHERE ${where}
      ORDER BY paid_at DESC, recorded_at DESC, id DESC LIMIT $3 OFFSET $4`, [id, kind, limit, (page - 1) * limit])
  ]);
  const row = summary.rows[0] || {};
  return {
    payments: payments.rows,
    payment_summary: { ...row, lifetime_paid_ugx: Number(row.lifetime_paid_ugx || 0), payment_count: Number(row.payment_count || 0),
      last_payment_on: row.last_payment_on || null, last_payment_ugx: row.last_payment_ugx == null ? null : Number(row.last_payment_ugx) },
    payment_pagination: pageInfo(page, limit, row.payment_count)
  };
}

function validatedPayment(body, { now = new Date() } = {}) {
  const payment = Object.fromEntries(PAYMENT_FIELDS.filter((key) => body[key] !== undefined).map((key) => [key, body[key]]));
  if (!['absa_usd', 'revolut_card'].includes(String(payment.method || ''))) {
    const raw = String(payment.amount_ugx ?? payment.amount ?? '').replace(/[,\s]/g, '');
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) <= 0 || Number(raw) > 100000000) {
      throw revenue.httpError(400, 'Enter a positive whole amount of UGX, up to 100,000,000.');
    }
    payment.amount_ugx = Number(raw);
  } else {
    const raw = String(payment.amount_original ?? payment.amount_usd ?? payment.amount ?? '').replace(/[,\s]/g, '');
    if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || !Number.isFinite(Number(raw)) || Number(raw) <= 0) {
      throw revenue.httpError(400, 'Enter a positive amount in US dollars, with at most two decimal places.');
    }
  }
  if (payment.paid_at) {
    const date = new Date(payment.paid_at);
    const raw = String(payment.paid_at);
    const day = raw.slice(0, 10);
    const calendarDate = new Date(`${day}T00:00:00Z`);
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
    const future = dateOnly ? day > revenue.kampalaDate(now) : date.getTime() > now.getTime() + 5 * 60000;
    if (Number.isNaN(date.getTime()) || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw)
      || Number.isNaN(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== day || future) {
      throw revenue.httpError(400, 'Enter a valid payment date that is not in the future.');
    }
  }
  revenue.normalizeEntry(payment);
  return payment;
}

async function recordManagerPayment(db, { kind, id, body = {}, actor = 'staff' }) {
  if (!UUID_RE.test(String(id))) throw revenue.httpError(400, 'Invalid payment target id');
  if (!UUID_RE.test(String(body.request_id || ''))) throw revenue.httpError(400, 'A payment request id is required. Reopen the payment form.');
  const payment = validatedPayment(body);
  const requestId = body.request_id.toLowerCase();
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ kind, id, payment })).digest('hex');
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`dashboard-payment:${requestId}`]);
    const previous = (await client.query(`SELECT r.fingerprint, r.result, e.voided_at FROM dashboard_payment_requests r
      JOIN revenue_entries e ON e.id = r.entry_id WHERE r.request_id = $1`, [requestId])).rows[0];
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw revenue.httpError(409, 'This payment request was already used for different details. Reopen the payment form.');
      if (previous.voided_at) throw revenue.httpError(409, 'This recorded payment was voided. Reopen the payment form to record a replacement.');
      await client.query('COMMIT');
      return { ...previous.result, replayed: true };
    }
    let result;
    if (kind === 'agent_subscription') {
      const agent = (await client.query('SELECT * FROM agents WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!agent || agent.removed_at) throw revenue.httpError(404, 'Active agent not found');
      result = await revenue.recordAgentPayment(client, { agent, payment, actor });
      result.reinstatement = await billingOps.reinstateAgentAfterPayment(db, { agentId: id, actor, notify: false, transactionClient: client });
    } else {
      const listing = (await client.query(`SELECT p.* FROM properties p WHERE p.id = $1 AND ${DIRECT_LISTER_SQL} FOR UPDATE`, [id])).rows[0];
      if (!listing || !['approved', 'pending', 'hidden'].includes(listing.status)) {
        throw revenue.httpError(404, 'Direct non-agent listing not found, or its status does not accept payments');
      }
      result = await billingOps.recordListingPayment(client, { propertyId: id, payment: {
        ...payment, payer_name: payment.payer_name || listing.lister_name, payer_phone: payment.payer_phone || listing.lister_phone
      }, actor });
    }
    await client.query(`INSERT INTO audit_logs (actor_id, action, details) VALUES ($1, 'admin_manager_payment_recorded', $2::jsonb)`,
      [actor, JSON.stringify({ [kind === 'agent_subscription' ? 'agent_id' : 'property_id']: id, entry_id: result.entry.id,
        request_id: requestId, amount_ugx: result.entry.amount_ugx, kind })]);
    await client.query(`INSERT INTO dashboard_payment_requests (request_id, fingerprint, entry_id, result, recorded_by)
      VALUES ($1, $2, $3, $4::jsonb, $5)`, [requestId, fingerprint, result.entry.id, JSON.stringify(result), actor]);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { UUID_RE, DIRECT_LISTER_SQL, pagination, pageInfo, publicListingUrl, paymentHistory, validatedPayment, recordManagerPayment };
