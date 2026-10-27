'use strict';

const { DIRECT_LISTER_SQL, UUID_RE, pagination, pageInfo, publicListingUrl, paymentHistory, recordManagerPayment } = require('../services/adminManagerPaymentService');

const PAID_SQL = `EXISTS (SELECT 1 FROM revenue_entries paid WHERE paid.property_id = p.id
  AND paid.kind = 'listing_fee' AND paid.direction = 'in' AND paid.voided_at IS NULL)`;
const ROW_COLUMNS = `p.id, p.title, p.inquiry_reference, p.lister_name, p.lister_phone, p.status, p.availability_status,
  p.district, p.area, p.created_at, p.updated_at, to_char(p.lister_paid_until, 'YYYY-MM-DD') AS paid_until,
  to_char(p.lister_paid_until + 1, 'YYYY-MM-DD') AS next_due, p.lister_billing_suspended_at`;
const TOTALS_JOIN = `LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(amount_ugx), 0)::bigint AS lifetime_paid_ugx, COUNT(*)::int AS payment_count,
    (array_agg(paid_at ORDER BY paid_at DESC, recorded_at DESC, id DESC))[1] AS last_payment_on,
    (array_agg(amount_ugx ORDER BY paid_at DESC, recorded_at DESC, id DESC))[1] AS last_payment_ugx
  FROM revenue_entries WHERE property_id = p.id AND kind = 'listing_fee' AND direction = 'in' AND voided_at IS NULL
) money ON true`;

function serializeListing(row) {
  return { ...row, public_url: publicListingUrl(row), lifetime_paid_ugx: Number(row.lifetime_paid_ugx || 0),
    payment_count: Number(row.payment_count || 0), last_payment_ugx: row.last_payment_ugx == null ? null : Number(row.last_payment_ugx) };
}

function sendError(res, error, next) {
  return error.status ? res.status(error.status).json({ ok: false, error: error.message }) : next(error);
}

function registerPublicListerRoutes(router, { db, cleanText, adminActorId, onListingsChanged }) {
  router.get('/agent-manager/public', async (req, res, next) => {
    try {
      const { page, limit } = pagination(req.query);
      const search = cleanText(req.query.search || '').slice(0, 120);
      const filters = `${DIRECT_LISTER_SQL} AND ${PAID_SQL}`;
      const searchSql = search ? ` AND (COALESCE(p.lister_name, '') ILIKE $1 OR COALESCE(p.lister_phone, '') ILIKE $1
        OR p.title ILIKE $1 OR COALESCE(p.inquiry_reference, '') ILIKE $1)` : '';
      const values = search ? [`%${search}%`] : [];
      const count = await db.query(`SELECT COUNT(*)::int AS total FROM properties p WHERE ${filters}${searchSql}`, values);
      const result = await db.query(`SELECT ${ROW_COLUMNS}, money.* FROM properties p ${TOTALS_JOIN}
        WHERE ${filters}${searchSql} ORDER BY money.last_payment_on DESC, p.id
        LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, (page - 1) * limit]);
      return res.json({ ok: true, data: result.rows.map(serializeListing), pagination: pageInfo(page, limit, count.rows[0]?.total) });
    } catch (error) { return next(error); }
  });

  // Selecting a real direct listing records its first payment. Unpaid listings do not appear in the paid roster.
  router.get('/agent-manager/public/candidates', async (req, res, next) => {
    try {
      const search = cleanText(req.query.search || '').slice(0, 120);
      if (search.length < 3) return res.json({ ok: true, data: [] });
      const result = await db.query(`SELECT ${ROW_COLUMNS} FROM properties p WHERE ${DIRECT_LISTER_SQL}
        AND p.status IN ('approved', 'pending', 'hidden')
        AND (p.title ILIKE $1 OR COALESCE(p.lister_name, '') ILIKE $1 OR COALESCE(p.lister_phone, '') ILIKE $1
          OR COALESCE(p.inquiry_reference, '') ILIKE $1 OR p.id::text = $2)
        ORDER BY p.created_at DESC, p.id LIMIT 30`, [`%${search}%`, search]);
      return res.json({ ok: true, data: result.rows.map(serializeListing) });
    } catch (error) { return next(error); }
  });

  router.get('/agent-manager/public/:id', async (req, res, next) => {
    try {
      if (!UUID_RE.test(String(req.params.id))) return res.status(400).json({ ok: false, error: 'Invalid listing id' });
      const result = await db.query(`SELECT ${ROW_COLUMNS}, money.* FROM properties p ${TOTALS_JOIN}
        WHERE p.id = $1 AND ${DIRECT_LISTER_SQL}`, [req.params.id]);
      if (!result.rows[0]) return res.status(404).json({ ok: false, error: 'Direct non-agent listing not found' });
      const page = pagination(req.query, 'payments_');
      const history = await paymentHistory(db, { kind: 'listing_fee', id: req.params.id, ...page });
      return res.json({ ok: true, data: { listing: serializeListing(result.rows[0]), ...history } });
    } catch (error) { return next(error); }
  });

  router.post('/agent-manager/public/:id/payments', async (req, res, next) => {
    try {
      const result = await recordManagerPayment(db, { kind: 'listing_fee', id: req.params.id, body: req.body || {}, actor: adminActorId(req) });
      if (!result.replayed) onListingsChanged('public_lister_payment');
      return res.json({ ok: true, data: result });
    } catch (error) { return sendError(res, error, next); }
  });
}

module.exports = { registerPublicListerRoutes };
