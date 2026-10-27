'use strict';

const { registerAgentIdFileRoutes, listIdFiles } = require('./adminAgentIdFiles');
const { registerPublicListerRoutes } = require('./adminPublicListers');
const { pagination, paymentHistory, recordManagerPayment, publicListingUrl } = require('../services/adminManagerPaymentService');

// King → Agents: one place to see an agent, everything on file about them and
// every listing they have, and to correct it. Nothing here hard-deletes: a
// listing that is taken down or marked sold/let keeps its previous status so
// "Put back live" returns it, and an agent is removed with the existing
// /agents/:id/remove (Restore puts it all back). Every write lands in
// audit_logs with the staff member who did it.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_KEYS = new Set(['id_expiry_date', 'paid_until', 'plan_started_on', 'last_payment_on']);

const LISTING_ACTIONS = Object.freeze({
  take_down: { label: 'Taken down by staff', status: 'hidden', availability: null },
  mark_sold: { label: 'Marked sold by staff', status: 'sold', availability: 'sold' },
  mark_let: { label: 'Marked let by staff', status: 'sold', availability: 'let_agreed' },
  put_back: { label: 'Put back by staff', status: null, availability: 'available' }
});
const RESTORABLE_STATUSES = new Set(['approved', 'pending', 'draft', 'rejected']);
const PUBLIC_FIELDS = new Set(['full_name', 'company_name', 'greeting_name', 'bio', 'phone', 'whatsapp', 'email', 'districts_covered', 'specializations', 'experience_years', 'licence_number']);

function maskNin(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length <= 4 ? '••••' : `••••${text.slice(-4)}`;
}

function paymentState(agent = {}, today = new Date()) {
  if (agent.fee_exempt) return { key: 'free', label: 'Free (staff override)' };
  if (agent.paid_until) {
    const until = new Date(agent.paid_until);
    const startOfToday = new Date(today.toISOString().slice(0, 10));
    if (!Number.isNaN(until.getTime()) && until >= startOfToday) return { key: 'paid', label: 'Paid' };
    return { key: 'expired', label: 'Payment expired' };
  }
  if (agent.paid_awaiting_approval_at) return { key: 'paid_awaiting', label: 'Paid, awaiting approval' };
  return { key: 'unpaid', label: 'Unpaid' };
}

// Kampala is UTC+3 all year; the fee and the paid-until dates are Kampala days.
function kampalaDay(now = new Date()) {
  return new Date(now.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function isoDay(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : kampalaDay(value);
  const text = String(value).trim();
  if (DATE_RE.test(text.slice(0, 10)) && (text.length === 10 || /^\d{4}-\d{2}-\d{2}T/.test(text))) {
    if (text.length === 10) return text;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? text.slice(0, 10) : kampalaDay(parsed);
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function dayNumber(day) {
  return Math.round(Date.parse(`${day}T00:00:00Z`) / 86400000);
}

function addDay(day, n) {
  return new Date((dayNumber(day) + n) * 86400000).toISOString().slice(0, 10);
}

/**
 * The payment countdown for one agent, from what is on file — never guessed.
 * paid_until is the last paid (or free) day, so the next payment is due the
 * day after it. Sources, best first: what staff typed (plan_started_on,
 * last_payment_*), the payment ledger (revenue_entries), the free-trial offer.
 */
function paymentTracker(agent = {}, ledger = null, now = new Date()) {
  const today = kampalaDay(now);
  const state = paymentState(agent, new Date(`${today}T12:00:00Z`));
  const paidUntil = isoDay(agent.paid_until);
  const offerMode = String(agent.fee_offer_mode || '').toLowerCase();
  let plan = 'Not set';
  if (agent.fee_exempt) plan = 'Free (staff override)';
  else if (offerMode === 'free_period' && paidUntil && isoDay(agent.fee_offer_until) === paidUntil) plan = 'Free trial';
  else if (offerMode === 'pay_later' && !paidUntil) plan = 'Pay later (approved before paying)';
  else if (agent.billing_plan === 'agent_monthly' || ledger?.period_end) plan = 'Monthly';
  else if (paidUntil) plan = 'Paid until a set date';

  let periodStart = isoDay(agent.plan_started_on);
  let periodSource = periodStart ? 'staff' : null;
  if (!periodStart && ledger?.period_start && paidUntil && isoDay(ledger.period_end) === paidUntil) {
    periodStart = isoDay(ledger.period_start); periodSource = 'ledger';
  }
  if (!periodStart && offerMode === 'free_period' && agent.fee_offer_at && paidUntil && isoDay(agent.fee_offer_until) === paidUntil) {
    periodStart = isoDay(agent.fee_offer_at); periodSource = 'free_trial';
  }
  const daysOnPeriod = periodStart && dayNumber(periodStart) <= dayNumber(today) ? dayNumber(today) - dayNumber(periodStart) + 1 : null;

  const nextDue = agent.fee_exempt || !paidUntil ? null : addDay(paidUntil, 1);
  const daysLeft = nextDue ? dayNumber(nextDue) - dayNumber(today) : null;
  let tone = null;
  if (daysLeft !== null) tone = daysLeft < 0 ? 'red' : daysLeft <= 7 ? 'amber' : 'ok';

  const manualOn = isoDay(agent.last_payment_on);
  const ledgerOn = ledger?.paid_at ? isoDay(ledger.paid_at) : null;
  let lastPaymentOn = null;
  let lastPaymentUgx = null;
  let lastPaymentSource = null;
  if (ledgerOn && (!manualOn || ledgerOn >= manualOn)) {
    lastPaymentOn = ledgerOn; lastPaymentUgx = ledger.amount_ugx == null ? null : Number(ledger.amount_ugx); lastPaymentSource = 'ledger';
  } else if (manualOn || agent.last_payment_ugx != null) {
    lastPaymentOn = manualOn; lastPaymentUgx = agent.last_payment_ugx == null ? null : Number(agent.last_payment_ugx); lastPaymentSource = 'staff';
  }

  return {
    status_key: state.key,
    status_label: state.label,
    plan,
    paid_until: paidUntil,
    period_start: periodStart,
    period_source: periodSource,
    days_on_period: daysOnPeriod,
    next_due: nextDue,
    days_left: daysLeft,
    overdue: daysLeft !== null && daysLeft < 0,
    days_overdue: daysLeft !== null && daysLeft < 0 ? -daysLeft : 0,
    tone,
    last_payment_on: lastPaymentOn,
    last_payment_ugx: lastPaymentUgx,
    last_payment_source: lastPaymentSource,
    today
  };
}

// The latest "Approve anyway" in an agent's audit history (newest first).
function approvedAnyway(history = []) {
  const row = history.find((entry) => entry.action === 'admin_agent_approved_anyway');
  if (!row) return null;
  const details = row.details || {};
  return { at: row.created_at, by: details.by || row.actor_id || null, reason: details.reason || '', missing: details.missing || [] };
}

// Approved and live, but the national ID (NIN) was never filled in.
function idStillNeeded(agent = {}) {
  return String(agent.status || '').toLowerCase() === 'approved' && !agent.removed_at
    && !String(agent.nin ?? '').trim() && agent.has_nin !== true;
}

// SQL: a live (not archived) "ID front" uploaded by staff for agent a.
const LIVE_ID_FRONT_SQL = `EXISTS (SELECT 1 FROM agent_identity_files f
  WHERE f.agent_id = a.id AND f.kind = 'id_front' AND f.archived_at IS NULL)`;
// SQL: an ID document is on file, either from sign-up or uploaded by staff.
const HAS_ID_DOCUMENT_SQL = `(COALESCE(a.identity_document_url, '') <> '' OR ${LIVE_ID_FRONT_SQL})`;

function registerAgentManagerRoutes(router, deps) {
  const { db, writeAudit, adminActorId, cleanText, isValidEmail, normalizePhone, actorLabel, onListingsChanged } = deps;
  const actorOf = async (req) => {
    const id = adminActorId(req);
    let label = '';
    if (req.adminAuth?.userId) {
      const user = (await db.query('SELECT first_name, last_name, email, phone FROM users WHERE id = $1', [req.adminAuth.userId]).catch(() => ({ rows: [] }))).rows[0];
      if (user) label = actorLabel(user);
    }
    return { id, label: label || (req.adminAuth?.type === 'api_key' ? 'admin key' : 'staff') };
  };
  const badId = (res, what = 'agent') => res.status(400).json({ ok: false, error: `Invalid ${what} id` });
  registerAgentIdFileRoutes(router, { db, writeAudit, actorOf, UUID_RE });
  registerPublicListerRoutes(router, { db, cleanText, adminActorId, onListingsChanged });

  // List: who is who, at a glance — what is missing and how many listings.
  router.get('/agent-manager/agents', async (req, res, next) => {
    try {
      const show = ['active', 'removed', 'all'].includes(String(req.query.show)) ? String(req.query.show) : 'active';
      const only = ['id_needed', 'id_doc_missing', 'pending', 'overdue', 'due_soon'].includes(String(req.query.only)) ? String(req.query.only) : '';
      const search = cleanText(req.query.search || '').slice(0, 120);
      const values = [];
      const filters = [];
      if (show === 'active') filters.push('a.removed_at IS NULL');
      if (show === 'removed') filters.push('a.removed_at IS NOT NULL');
      if (only === 'id_needed') filters.push(`a.status = 'approved' AND COALESCE(btrim(a.nin), '') = ''`);
      if (only === 'id_doc_missing') filters.push(`NOT ${HAS_ID_DOCUMENT_SQL}`);
      if (only === 'pending') filters.push(`a.status = 'pending'`);
      if (search) {
        values.push(`%${search}%`);
        const digits = search.replace(/\D/g, '');
        let phoneClause = '';
        if (digits.length >= 3) {
          values.push(`%${digits.slice(-9)}%`);
          phoneClause = `OR regexp_replace(COALESCE(a.phone, '') || ' ' || COALESCE(a.whatsapp, ''), '\\D', '', 'g') LIKE $${values.length}`;
        }
        filters.push(`(a.full_name ILIKE $1 OR COALESCE(a.company_name, '') ILIKE $1 OR COALESCE(a.email, '') ILIKE $1
          OR COALESCE(a.makaug_agent_number, '') ILIKE $1 ${phoneClause})`);
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const result = await db.query(
        `SELECT a.id, a.full_name, a.company_name, a.phone, a.whatsapp, a.email, a.status, a.makaug_agent_number,
                a.created_at, a.updated_at, a.removed_at, a.removed_reason, a.user_id, a.agent_application_channel,
                (COALESCE(btrim(a.nin), '') <> '') AS has_nin,
                ${HAS_ID_DOCUMENT_SQL} AS has_id_document,
                (COALESCE(a.identity_document_url, '') <> '') AS has_signup_id_document,
                ${LIVE_ID_FRONT_SQL} AS has_id_front_file,
                (COALESCE(a.licence_number, '') <> '' AND a.licence_number !~* '^(STAFF-|WA-|AUTO-|PENDING|EMPLOYEE-INTAKE-|DIRECT-)') AS has_licence,
                to_char(a.paid_until, 'YYYY-MM-DD') AS paid_until, a.fee_exempt, a.paid_awaiting_approval_at,
                a.approved_at, a.billing_plan, a.monthly_fee_ugx, a.fee_offer_mode, a.fee_offer_at,
                to_char(a.fee_offer_until, 'YYYY-MM-DD') AS fee_offer_until,
                to_char(a.plan_started_on, 'YYYY-MM-DD') AS plan_started_on,
                to_char(a.last_payment_on, 'YYYY-MM-DD') AS last_payment_on, a.last_payment_ugx,
                to_char(r.period_start, 'YYYY-MM-DD') AS ledger_period_start,
                to_char(r.period_end, 'YYYY-MM-DD') AS ledger_period_end,
                r.paid_at AS ledger_paid_at, r.amount_ugx AS ledger_amount_ugx,
                COALESCE(p.total, 0)::int AS total_listings,
                COALESCE(p.live, 0)::int AS live_listings,
                COALESCE(p.pending, 0)::int AS pending_listings,
                COALESCE(p.taken_down, 0)::int AS taken_down_listings,
                COALESCE(p.sold, 0)::int AS sold_listings,
                p.last_listing_at
           FROM agents a
           LEFT JOIN LATERAL (
             SELECT COUNT(*) AS total,
                    COUNT(*) FILTER (WHERE status = 'approved') AS live,
                    COUNT(*) FILTER (WHERE status = 'pending') AS pending,
                    COUNT(*) FILTER (WHERE status IN ('hidden', 'archived')) AS taken_down,
                    COUNT(*) FILTER (WHERE status = 'sold') AS sold,
                    MAX(created_at) AS last_listing_at
               FROM properties WHERE agent_id = a.id AND status <> 'deleted'
           ) p ON true
           LEFT JOIN LATERAL (
             SELECT period_start, period_end, paid_at, amount_ugx
               FROM revenue_entries
              WHERE agent_id = a.id AND kind = 'agent_subscription' AND voided_at IS NULL
              ORDER BY paid_at DESC NULLS LAST, recorded_at DESC
              LIMIT 1
           ) r ON true
           ${where}
          ORDER BY a.removed_at IS NULL DESC, a.created_at DESC
          LIMIT 500`,
        values
      );
      const counts = await db.query(
        `SELECT COUNT(*) FILTER (WHERE removed_at IS NULL)::int AS active,
                COUNT(*) FILTER (WHERE removed_at IS NOT NULL)::int AS removed,
                COUNT(*) FILTER (WHERE removed_at IS NULL AND COALESCE(btrim(nin), '') = '')::int AS missing_id,
                COUNT(*) FILTER (WHERE removed_at IS NULL AND status = 'approved' AND COALESCE(btrim(nin), '') = '')::int AS approved_missing_id,
                COUNT(*) FILTER (WHERE removed_at IS NULL AND NOT ${HAS_ID_DOCUMENT_SQL})::int AS id_document_missing,
                COUNT(*) FILTER (WHERE removed_at IS NULL AND status = 'pending')::int AS pending,
                COUNT(*) FILTER (WHERE removed_at IS NULL AND paid_until IS NOT NULL AND fee_exempt IS NOT TRUE)::int AS due_date_set
           FROM agents a`
      );
      const now = new Date();
      let rows = result.rows.map((row) => {
        const ledger = row.ledger_paid_at || row.ledger_period_end
          ? { period_start: row.ledger_period_start, period_end: row.ledger_period_end, paid_at: row.ledger_paid_at, amount_ugx: row.ledger_amount_ugx }
          : null;
        const { ledger_period_start, ledger_period_end, ledger_paid_at, ledger_amount_ugx, ...rest } = row;
        return {
          ...rest,
          payment: paymentState(row),
          tracker: paymentTracker(row, ledger, now),
          id_still_needed: idStillNeeded(row)
        };
      });
      if (only === 'overdue') rows = rows.filter((row) => row.tracker.overdue);
      if (only === 'due_soon') rows = rows.filter((row) => row.tracker.days_left !== null && row.tracker.days_left >= 0 && row.tracker.days_left <= 7);
      return res.json({ ok: true, data: rows, counts: counts.rows[0] || {} });
    } catch (error) {
      return next(error);
    }
  });

  // Everything on file for one agent: profile, ID, payment, listings, history.
  router.get('/agent-manager/agents/:id', async (req, res, next) => {
    try {
      if (!UUID_RE.test(String(req.params.id))) return badId(res);
      const agentResult = await db.query(
        `SELECT a.id, a.full_name, a.company_name, a.licence_number, a.phone, a.whatsapp, a.email,
                a.districts_covered, a.specializations, a.nin, a.bio, a.status, a.registration_status,
                a.created_at, a.updated_at, a.user_id, a.identity_document_name, a.identity_document_type,
                a.identity_document_uploaded_at, ${HAS_ID_DOCUMENT_SQL} AS has_id_document,
                (COALESCE(a.identity_document_url, '') <> '') AS has_signup_id_document,
                CASE WHEN a.identity_document_url ILIKE 's3://%' THEN 'private_bucket'
                     WHEN a.identity_document_url ILIKE 'data:%' THEN 'inline'
                     WHEN COALESCE(a.identity_document_url, '') <> '' THEN 'link' END AS signup_id_storage,
                ${LIVE_ID_FRONT_SQL} AS has_id_front_file,
                a.profile_photo_url, (COALESCE(a.profile_photo_url, '') <> '') AS has_profile_photo,
                a.verification_reason, a.privacy_consent_accepted, a.privacy_consent_at, a.approved_at,
                a.makaug_agent_number, to_char(a.id_expiry_date, 'YYYY-MM-DD') AS id_expiry_date, a.experience_years, a.contact_phone_verified_at,
                a.agent_application_channel, a.plan, a.verified_badge, a.greeting_name, a.billing_plan,
                a.monthly_fee_ugx, to_char(a.paid_until, 'YYYY-MM-DD') AS paid_until, a.fee_exempt, a.fee_exempt_reason, a.removed_at, a.removed_reason,
                to_char(a.plan_started_on, 'YYYY-MM-DD') AS plan_started_on,
                to_char(a.last_payment_on, 'YYYY-MM-DD') AS last_payment_on, a.last_payment_ugx, a.fee_offer_at,
                a.removed_by, a.welcome_sent_at, a.billing_suspended_at, a.paid_awaiting_approval_at,
                a.registered_by_phone, a.registered_by_name, a.pay_link_sent_at, a.fee_offer_mode,
                a.fee_offer_reason, to_char(a.fee_offer_until, 'YYYY-MM-DD') AS fee_offer_until, a.listing_limit, a.featured_homepage,
                u.last_login_at AS user_last_login_at, u.email AS user_email, u.role AS user_role
           FROM agents a LEFT JOIN users u ON u.id = a.user_id
          WHERE a.id = $1`,
        [req.params.id]
      );
      const agent = agentResult.rows[0];
      if (!agent) return res.status(404).json({ ok: false, error: 'Agent not found' });

      const listings = (await db.query(
        `SELECT p.id, p.title, p.listing_type, p.status, p.availability_status, p.district, p.area, p.price,
                p.price_period, p.created_at, p.approved_at, p.updated_at, p.sold_at, p.expires_at, p.inquiry_reference,
                p.extra_fields->>'agent_manager_previous_status' AS previous_status,
                p.extra_fields->>'agent_manager_last_action' AS last_staff_action,
                p.extra_fields->>'agent_manager_last_action_at' AS last_staff_action_at,
                event.reason AS moderation_reason, event.created_at AS moderation_at, event.status_to AS moderation_status,
                (SELECT MAX(e.created_at) FROM property_moderation_events e
                  WHERE e.property_id = p.id AND e.status_to IN ('hidden', 'sold', 'archived', 'deleted')) AS taken_down_at
           FROM properties p
           LEFT JOIN LATERAL (SELECT COALESCE(NULLIF(e.reason, ''), NULLIF(e.notes, '')) AS reason, e.created_at, e.status_to FROM property_moderation_events e
             WHERE e.property_id = p.id AND e.status_to = p.status
             ORDER BY e.created_at DESC, e.id DESC LIMIT 1) event ON true
          WHERE p.agent_id = $1
          ORDER BY p.created_at DESC
          LIMIT 1000`,
        [agent.id]
      )).rows;
      const ids = listings.map((row) => row.id);
      const paymentPage = pagination(req.query, 'payments_');
      const [views, leads, history, duplicates, ledger, idFiles] = await Promise.all([
        ids.length ? db.query(
          `SELECT payload->>'property_id' AS property_id, COUNT(*)::int AS views
             FROM analytics_events
            WHERE event_name IN ('property_open', 'property_view') AND payload->>'property_id' = ANY($1::text[])
            GROUP BY 1`, [ids]).catch(() => ({ rows: [] })) : { rows: [] },
        ids.length ? db.query(
          `SELECT listing_id::text AS property_id, COUNT(*)::int AS leads
             FROM leads WHERE listing_id = ANY($1::uuid[]) GROUP BY 1`, [ids]).catch(() => ({ rows: [] })) : { rows: [] },
        db.query(
          `SELECT id, actor_id, action, details, created_at FROM audit_logs
            WHERE details->>'agent_id' = $1
            ORDER BY created_at DESC LIMIT 60`, [agent.id]).catch(() => ({ rows: [] })),
        db.query(
          `SELECT id, full_name, status, created_at, removed_at, makaug_agent_number,
                  (SELECT COUNT(*)::int FROM properties p WHERE p.agent_id = a.id AND p.status <> 'deleted') AS total_listings
             FROM agents a
            WHERE a.id <> $1 AND length($2::text) >= 9 AND (
                  RIGHT(regexp_replace(COALESCE(a.phone, ''), '\\D', '', 'g'), 9) = $2
               OR RIGHT(regexp_replace(COALESCE(a.whatsapp, ''), '\\D', '', 'g'), 9) = $2)
            ORDER BY a.created_at`,
          [agent.id, String(agent.phone || agent.whatsapp || '').replace(/\D/g, '').slice(-9)]),
        paymentHistory(db, { kind: 'agent_subscription', id: agent.id, ...paymentPage }),
        listIdFiles(db, agent.id)
      ]);
      const viewMap = new Map(views.rows.map((row) => [row.property_id, row.views]));
      const leadMap = new Map(leads.rows.map((row) => [row.property_id, row.leads]));
      const lastActivity = [agent.updated_at, agent.user_last_login_at, listings[0]?.created_at]
        .filter(Boolean).map((v) => new Date(v)).sort((a, b) => b - a)[0] || null;
      return res.json({
        ok: true,
        data: {
          agent: {
            ...agent,
            payment: paymentState(agent),
            tracker: paymentTracker(agent, { paid_at: ledger.payment_summary.last_payment_on,
              amount_ugx: ledger.payment_summary.last_payment_ugx, period_start: ledger.payment_summary.last_period_start,
              period_end: ledger.payment_summary.last_period_end }),
            id_still_needed: idStillNeeded(agent),
            approved_anyway: approvedAnyway(history.rows),
            last_activity_at: lastActivity
          },
          ...ledger,
          listings: listings.map((row) => ({ ...row, public_url: publicListingUrl(row), views: viewMap.get(row.id) || 0, leads: leadMap.get(row.id) || 0 })),
          history: history.rows,
          id_files: idFiles,
          same_phone_agents: duplicates.rows
        }
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/agent-manager/agents/:id/payments', async (req, res, next) => {
    try {
      const result = await recordManagerPayment(db, { kind: 'agent_subscription', id: req.params.id,
        body: req.body || {}, actor: adminActorId(req) });
      if (!result.replayed) onListingsChanged('agent_manager_payment');
      return res.json({ ok: true, data: result });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
      return next(error);
    }
  });

  const TEXT_FIELDS = {
    full_name: 160, company_name: 160, greeting_name: 80, licence_number: 80, nin: 32, bio: 1500, fee_exempt_reason: 300, billing_plan: 40
  };

  function readDetails(body = {}, { creating = false } = {}) {
    const patch = {};
    const errors = [];
    for (const [key, max] of Object.entries(TEXT_FIELDS)) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      let value = cleanText(body[key]).slice(0, max);
      if (key === 'nin') value = value.replace(/\s+/g, '').toUpperCase();
      patch[key] = value || null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'full_name') && !patch.full_name) errors.push('Name cannot be empty');
    for (const key of ['phone', 'whatsapp']) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      const raw = cleanText(body[key]);
      if (!raw) { patch[key] = null; continue; }
      const normalized = normalizePhone(raw);
      if (!normalized) errors.push(`${key === 'phone' ? 'Phone' : 'WhatsApp'} number is not valid`);
      else patch[key] = normalized;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'phone') && !patch.phone && !creating) errors.push('Phone cannot be empty');
    if (Object.prototype.hasOwnProperty.call(body, 'email')) {
      const email = cleanText(body.email).toLowerCase().slice(0, 200);
      if (email && !isValidEmail(email)) errors.push('Email is not valid');
      patch.email = email || null;
    }
    const DATE_LABELS = { id_expiry_date: 'ID expiry', paid_until: 'Paid until', plan_started_on: 'Plan start', last_payment_on: 'Last payment date' };
    for (const key of Object.keys(DATE_LABELS)) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      const value = cleanText(body[key]);
      if (value && (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) errors.push(`${DATE_LABELS[key]} must be a date`);
      patch[key] = value || null;
    }
    const UGX_LABELS = { monthly_fee_ugx: 'Monthly fee', last_payment_ugx: 'Last payment amount' };
    for (const key of Object.keys(UGX_LABELS)) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      const raw = cleanText(body[key]).replace(/[,\s]/g, '');
      const fee = raw === '' ? null : Number(raw);
      if (fee !== null && (!Number.isInteger(fee) || fee < 0 || fee > 100000000)) errors.push(`${UGX_LABELS[key]} must be a whole number of UGX`);
      patch[key] = fee;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'experience_years')) {
      const raw = cleanText(body.experience_years);
      const years = raw === '' ? null : Number(raw);
      if (years !== null && (!Number.isInteger(years) || years < 0 || years > 80)) errors.push('Years of experience must be a whole number');
      patch.experience_years = years;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'specializations')) {
      patch.specializations = (Array.isArray(body.specializations) ? body.specializations : String(body.specializations || '').split(','))
        .map((v) => cleanText(v).slice(0, 60)).filter(Boolean).slice(0, 20);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'fee_exempt')) {
      patch.fee_exempt = body.fee_exempt === true || ['true', '1', 'yes', 'on'].includes(String(body.fee_exempt).toLowerCase());
    }
    if (Object.prototype.hasOwnProperty.call(body, 'districts_covered')) {
      const list = (Array.isArray(body.districts_covered) ? body.districts_covered : String(body.districts_covered || '').split(','))
        .map((v) => cleanText(v).slice(0, 60)).filter(Boolean).slice(0, 30);
      patch.districts_covered = list;
    }
    return { patch, errors };
  }

  // The form sends every field; only real edits count. Phones stored in an old
  // format (07…) are not rewritten just because the form re-normalised them.
  function sameValue(key, before, after) {
    if (key === 'phone' || key === 'whatsapp') return (before ? (normalizePhone(before) || before) : null) === (after || null);
    if (['monthly_fee_ugx', 'last_payment_ugx', 'experience_years'].includes(key)) return (before == null ? null : Number(before)) === (after == null ? null : Number(after));
    if (key === 'fee_exempt') return Boolean(before) === Boolean(after);
    if (key === 'districts_covered' || key === 'specializations') return JSON.stringify(before || []) === JSON.stringify(after || []);
    return (before ?? null) === (after ?? null);
  }

  function auditValue(key, value) {
    if (key === 'nin') return value ? maskNin(value) : null;
    return value;
  }

  function uniqueViolation(error) {
    if (error?.code !== '23505') return null;
    const field = /phone/.test(error.constraint || '') ? 'phone number'
      : /email/.test(error.constraint || '') ? 'email'
        : /licence/.test(error.constraint || '') ? 'licence number' : 'value';
    return `Another agent already has this ${field}. Open that agent instead, or remove the duplicate first.`;
  }

  // Correct or fill in any field (the ID / NIN included).
  router.patch('/agent-manager/agents/:id', async (req, res, next) => {
    try {
      if (!UUID_RE.test(String(req.params.id))) return badId(res);
      const { patch, errors } = readDetails(req.body || {});
      if (errors.length) return res.status(400).json({ ok: false, error: errors.join('. ') });
      if (Object.prototype.hasOwnProperty.call(patch, 'licence_number') && !patch.licence_number) delete patch.licence_number;
      const keys = Object.keys(patch);
      if (!keys.length) return res.status(400).json({ ok: false, error: 'Nothing to change' });
      const selectList = keys.map((key) => (DATE_KEYS.has(key) ? `to_char(${key}, 'YYYY-MM-DD') AS ${key}` : key));
      const before = (await db.query(`SELECT id, ${selectList.join(', ')} FROM agents WHERE id = $1`, [req.params.id])).rows[0];
      if (!before) return res.status(404).json({ ok: false, error: 'Agent not found' });
      const changed = keys.filter((key) => !sameValue(key, before[key], patch[key]));
      if (!changed.length) return res.json({ ok: true, data: { id: before.id, changed: [] } });
      const sets = changed.map((key, i) => `${key} = $${i + 2}${key === 'districts_covered' || key === 'specializations' ? '::text[]' : ''}`);
      try {
        await db.query(`UPDATE agents SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, [req.params.id, ...changed.map((key) => patch[key])]);
      } catch (error) {
        const message = uniqueViolation(error);
        if (message) return res.status(409).json({ ok: false, error: message });
        throw error;
      }
      const actor = await actorOf(req);
      await writeAudit('admin_agent_details_updated', {
        agent_id: before.id,
        by: actor.label,
        changes: Object.fromEntries(changed.map((key) => [key, { from: auditValue(key, before[key]) ?? null, to: auditValue(key, patch[key]) ?? null }]))
      }, actor.id);
      // The public agent page and listing cards read the name live; drop the cached copies.
      if (changed.some((key) => PUBLIC_FIELDS.has(key))) onListingsChanged('agent_manager_details');
      return res.json({ ok: true, data: { id: before.id, changed } });
    } catch (error) {
      return next(error);
    }
  });

  // Add an agent by hand — paid or unpaid — marked as staff-added.
  router.post('/agent-manager/agents', async (req, res, next) => {
    try {
      const body = req.body || {};
      const { patch, errors } = readDetails(body, { creating: true });
      if (!patch.full_name) errors.push('Name is required');
      if (!patch.phone) errors.push('Phone is required');
      const payment = ['paid', 'unpaid', 'free'].includes(String(body.payment_status)) ? String(body.payment_status) : '';
      if (!payment) errors.push('Choose Paid, Unpaid or Free');
      if (payment === 'paid' && !patch.paid_until) errors.push('Say until when they have paid');
      const status = String(body.status) === 'approved' ? 'approved' : 'pending';
      if (errors.length) return res.status(400).json({ ok: false, error: errors.join('. ') });
      const actor = await actorOf(req);
      const digits = String(patch.phone).replace(/\D/g, '').slice(-9);
      const existing = (await db.query(
        `SELECT id, full_name FROM agents
          WHERE RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 9) = $1
             OR RIGHT(regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g'), 9) = $1 LIMIT 1`, [digits])).rows[0];
      if (existing) {
        return res.status(409).json({ ok: false, error: `${existing.full_name} already uses this number. Open that agent instead.`, existing_agent_id: existing.id });
      }
      const licence = patch.licence_number || `STAFF-ADDED-${Date.now().toString(36).toUpperCase()}`;
      const note = `[STAFF_ADDED] Added by hand by ${actor.label} on ${new Date().toISOString().slice(0, 10)}; payment set to ${payment}${payment === 'free' && patch.fee_exempt_reason ? ` (${patch.fee_exempt_reason})` : ''}.`;
      let inserted;
      try {
        inserted = (await db.query(
          `INSERT INTO agents (
             full_name, company_name, licence_number, phone, whatsapp, email, nin, id_expiry_date, bio,
             districts_covered, status, registration_status, agent_application_channel, registered_by_name,
             verification_reason, paid_until, fee_exempt, fee_exempt_reason, monthly_fee_ugx, billing_plan,
             approved_at, pay_link_on_approval
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::text[],$11,'not_registered','staff_added',$12,$13,$14,$15,$16,$17,$18,
                     CASE WHEN $11 = 'approved' THEN NOW() ELSE NULL END, FALSE)
           RETURNING id, full_name, status`,
          [
            patch.full_name, patch.company_name || null, licence, patch.phone, patch.whatsapp || patch.phone, patch.email || null,
            patch.nin || null, patch.id_expiry_date || null, patch.bio || null, patch.districts_covered || [], status,
            actor.label, note, payment === 'paid' ? patch.paid_until : null, payment === 'free',
            payment === 'free' ? (patch.fee_exempt_reason || 'Staff override') : null, patch.monthly_fee_ugx ?? null,
            patch.billing_plan || null
          ]
        )).rows[0];
      } catch (error) {
        const message = uniqueViolation(error);
        if (message) return res.status(409).json({ ok: false, error: message });
        throw error;
      }
      await writeAudit('admin_agent_added_manually', {
        agent_id: inserted.id, by: actor.label, payment_status: payment, status,
        paid_until: payment === 'paid' ? patch.paid_until : null, staff_added: true
      }, actor.id);
      return res.status(201).json({ ok: true, data: inserted });
    } catch (error) {
      return next(error);
    }
  });

  // Take a listing down, mark it sold / let, or put it back — always reversible.
  router.post('/agent-manager/listings/:propertyId/state', async (req, res, next) => {
    const client = await db.getClient();
    try {
      if (!UUID_RE.test(String(req.params.propertyId))) return badId(res, 'listing');
      const action = String(req.body?.action || '');
      const spec = LISTING_ACTIONS[action];
      if (!spec) return res.status(400).json({ ok: false, error: 'Unknown action' });
      const reason = cleanText(req.body?.reason || '').slice(0, 300) || null;
      await client.query('BEGIN');
      const row = (await client.query(
        `SELECT id, agent_id, status, availability_status, extra_fields->>'agent_manager_previous_status' AS previous_status
           FROM properties WHERE id = $1 FOR UPDATE`, [req.params.propertyId])).rows[0];
      if (!row) { await client.query('ROLLBACK'); return res.status(404).json({ ok: false, error: 'Listing not found' }); }
      if (row.status === 'deleted') { await client.query('ROLLBACK'); return res.status(409).json({ ok: false, error: 'This listing was deleted and cannot be changed here' }); }
      let nextStatus;
      let rememberPrevious;
      if (action === 'put_back') {
        if (!['hidden', 'sold', 'archived'].includes(row.status)) {
          await client.query('ROLLBACK');
          return res.status(409).json({ ok: false, error: 'This listing is not taken down or sold' });
        }
        nextStatus = RESTORABLE_STATUSES.has(row.previous_status) ? row.previous_status : 'approved';
        rememberPrevious = null;
      } else {
        if (row.status === spec.status && (!spec.availability || row.availability_status === spec.availability)) {
          await client.query('ROLLBACK');
          return res.status(409).json({ ok: false, error: 'The listing is already in that state' });
        }
        nextStatus = spec.status;
        // Keep the status it had before the first staff action, so "Put back" restores that.
        rememberPrevious = ['hidden', 'sold', 'archived'].includes(row.status) ? (row.previous_status || 'approved') : row.status;
      }
      const at = new Date().toISOString();
      await client.query(
        `UPDATE properties
            SET status = $2,
                availability_status = COALESCE($3, availability_status),
                sold_at = CASE WHEN $2 = 'sold' THEN COALESCE(sold_at, NOW()) WHEN $4 = 'put_back' THEN NULL ELSE sold_at END,
                extra_fields = (COALESCE(extra_fields, '{}'::jsonb) - 'agent_manager_previous_status')
                  || CASE WHEN $5::text IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('agent_manager_previous_status', $5::text) END
                  || jsonb_build_object('agent_manager_last_action', $4::text, 'agent_manager_last_action_at', $6::text),
                updated_at = NOW()
          WHERE id = $1`,
        [row.id, nextStatus, spec.availability, action, rememberPrevious, at]
      );
      const actor = await actorOf(req);
      await client.query(
        `INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, reason, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [row.id, actor.id, `agent_manager_${action}`, row.status, nextStatus, reason || spec.label, `By ${actor.label}`]
      );
      await client.query('COMMIT');
      await writeAudit(`admin_agent_listing_${action}`, {
        agent_id: row.agent_id, property_id: row.id, by: actor.label, status_from: row.status, status_to: nextStatus,
        availability_to: spec.availability, reason
      }, actor.id);
      onListingsChanged(`agent_manager_${action}`);
      return res.json({ ok: true, data: { id: row.id, status: nextStatus, previous_status: row.status } });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      return next(error);
    } finally {
      client.release();
    }
  });

  // Move a listing to another agent (the old agent is recorded so it can be moved back).
  router.post('/agent-manager/listings/:propertyId/move', async (req, res, next) => {
    const client = await db.getClient();
    try {
      if (!UUID_RE.test(String(req.params.propertyId))) return badId(res, 'listing');
      const toId = cleanText(req.body?.agent_id);
      if (!UUID_RE.test(toId)) return res.status(400).json({ ok: false, error: 'Choose the agent to move it to' });
      await client.query('BEGIN');
      const row = (await client.query('SELECT id, agent_id, status, lister_name FROM properties WHERE id = $1 FOR UPDATE', [req.params.propertyId])).rows[0];
      if (!row) { await client.query('ROLLBACK'); return res.status(404).json({ ok: false, error: 'Listing not found' }); }
      if (String(row.agent_id) === toId) { await client.query('ROLLBACK'); return res.status(409).json({ ok: false, error: 'The listing is already with that agent' }); }
      const target = (await client.query('SELECT id, full_name, removed_at FROM agents WHERE id = $1', [toId])).rows[0];
      if (!target) { await client.query('ROLLBACK'); return res.status(404).json({ ok: false, error: 'Agent not found' }); }
      if (target.removed_at) { await client.query('ROLLBACK'); return res.status(409).json({ ok: false, error: 'That agent has been removed. Restore them first.' }); }
      await client.query(
        `UPDATE properties SET agent_id = $2, lister_type = 'agent', lister_name = $3, updated_at = NOW() WHERE id = $1`,
        [row.id, target.id, target.full_name]
      );
      const actor = await actorOf(req);
      await client.query(
        `INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, reason, notes)
         VALUES ($1, $2, 'agent_manager_move', $3, $3, $4, $5)`,
        [row.id, actor.id, row.status, `Moved to ${target.full_name}`, `From agent ${row.agent_id || 'none'} (${row.lister_name || ''}) by ${actor.label}`]
      );
      await client.query('COMMIT');
      const details = { property_id: row.id, from_agent_id: row.agent_id, to_agent_id: target.id, by: actor.label };
      await writeAudit('admin_agent_listing_moved', { ...details, agent_id: row.agent_id }, actor.id);
      await writeAudit('admin_agent_listing_received', { ...details, agent_id: target.id }, actor.id);
      onListingsChanged('agent_manager_move');
      return res.json({ ok: true, data: { id: row.id, from_agent_id: row.agent_id, to_agent_id: target.id, to_agent_name: target.full_name } });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      return next(error);
    } finally {
      client.release();
    }
  });
}

module.exports = { HAS_ID_DOCUMENT_SQL, LIVE_ID_FRONT_SQL, registerAgentManagerRoutes, paymentState, paymentTracker, idStillNeeded, approvedAnyway, kampalaDay, maskNin, LISTING_ACTIONS };
