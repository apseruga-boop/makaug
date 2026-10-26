'use strict';

// King → Agents: one place to see an agent, everything on file about them and
// every listing they have, and to correct it. Nothing here hard-deletes: a
// listing that is taken down or marked sold/let keeps its previous status so
// "Put back live" returns it, and an agent is removed with the existing
// /agents/:id/remove (Restore puts it all back). Every write lands in
// audit_logs with the staff member who did it.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_KEYS = new Set(['id_expiry_date', 'paid_until']);

const LISTING_ACTIONS = Object.freeze({
  take_down: { label: 'Taken down by staff', status: 'hidden', availability: null },
  mark_sold: { label: 'Marked sold by staff', status: 'sold', availability: 'sold' },
  mark_let: { label: 'Marked let by staff', status: 'sold', availability: 'let_agreed' },
  put_back: { label: 'Put back by staff', status: null, availability: 'available' }
});
const RESTORABLE_STATUSES = new Set(['approved', 'pending', 'draft', 'rejected']);

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

  // List: who is who, at a glance — what is missing and how many listings.
  router.get('/agent-manager/agents', async (req, res, next) => {
    try {
      const show = ['active', 'removed', 'all'].includes(String(req.query.show)) ? String(req.query.show) : 'active';
      const search = cleanText(req.query.search || '').slice(0, 120);
      const values = [];
      const filters = [];
      if (show === 'active') filters.push('a.removed_at IS NULL');
      if (show === 'removed') filters.push('a.removed_at IS NOT NULL');
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
                (COALESCE(a.identity_document_url, '') <> '') AS has_id_document,
                (COALESCE(a.licence_number, '') <> '' AND a.licence_number !~* '^(STAFF-|WA-|AUTO-|PENDING|EMPLOYEE-INTAKE-|DIRECT-)') AS has_licence,
                a.paid_until, a.fee_exempt, a.paid_awaiting_approval_at,
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
           ${where}
          ORDER BY a.removed_at IS NULL DESC, a.created_at DESC
          LIMIT 500`,
        values
      );
      const counts = await db.query(
        `SELECT COUNT(*) FILTER (WHERE removed_at IS NULL)::int AS active,
                COUNT(*) FILTER (WHERE removed_at IS NOT NULL)::int AS removed,
                COUNT(*) FILTER (WHERE removed_at IS NULL AND COALESCE(btrim(nin), '') = '')::int AS missing_id
           FROM agents`
      );
      const rows = result.rows.map((row) => ({ ...row, payment: paymentState(row) }));
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
                a.identity_document_uploaded_at, (COALESCE(a.identity_document_url, '') <> '') AS has_id_document,
                (COALESCE(a.profile_photo_url, '') <> '') AS has_profile_photo,
                a.verification_reason, a.privacy_consent_accepted, a.privacy_consent_at, a.approved_at,
                a.makaug_agent_number, a.id_expiry_date, a.experience_years, a.contact_phone_verified_at,
                a.agent_application_channel, a.plan, a.verified_badge, a.greeting_name, a.billing_plan,
                a.monthly_fee_ugx, a.paid_until, a.fee_exempt, a.fee_exempt_reason, a.removed_at, a.removed_reason,
                a.removed_by, a.welcome_sent_at, a.billing_suspended_at, a.paid_awaiting_approval_at,
                a.registered_by_phone, a.registered_by_name, a.pay_link_sent_at, a.fee_offer_mode,
                a.fee_offer_reason, a.fee_offer_until, a.listing_limit, a.featured_homepage,
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
                (SELECT MAX(e.created_at) FROM property_moderation_events e
                  WHERE e.property_id = p.id AND e.status_to IN ('hidden', 'sold', 'archived', 'deleted')) AS taken_down_at
           FROM properties p
          WHERE p.agent_id = $1 AND p.status <> 'deleted'
          ORDER BY p.created_at DESC
          LIMIT 1000`,
        [agent.id]
      )).rows;
      const ids = listings.map((row) => row.id);
      const [views, leads, history, duplicates] = await Promise.all([
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
          [agent.id, String(agent.phone || agent.whatsapp || '').replace(/\D/g, '').slice(-9)])
      ]);
      const viewMap = new Map(views.rows.map((row) => [row.property_id, row.views]));
      const leadMap = new Map(leads.rows.map((row) => [row.property_id, row.leads]));
      const lastActivity = [agent.updated_at, agent.user_last_login_at, listings[0]?.created_at]
        .filter(Boolean).map((v) => new Date(v)).sort((a, b) => b - a)[0] || null;
      return res.json({
        ok: true,
        data: {
          agent: { ...agent, payment: paymentState(agent), last_activity_at: lastActivity },
          listings: listings.map((row) => ({ ...row, views: viewMap.get(row.id) || 0, leads: leadMap.get(row.id) || 0 })),
          history: history.rows,
          same_phone_agents: duplicates.rows
        }
      });
    } catch (error) {
      return next(error);
    }
  });

  const TEXT_FIELDS = {
    full_name: 160, company_name: 160, licence_number: 80, nin: 32, bio: 1500, fee_exempt_reason: 300, billing_plan: 40
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
    for (const key of ['id_expiry_date', 'paid_until']) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      const value = cleanText(body[key]);
      if (value && !DATE_RE.test(value)) errors.push(`${key === 'paid_until' ? 'Paid until' : 'ID expiry'} must be a date`);
      patch[key] = value || null;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'monthly_fee_ugx')) {
      const raw = cleanText(body.monthly_fee_ugx).replace(/[,\s]/g, '');
      const fee = raw === '' ? null : Number(raw);
      if (fee !== null && (!Number.isInteger(fee) || fee < 0 || fee > 100000000)) errors.push('Monthly fee must be a whole number of UGX');
      patch.monthly_fee_ugx = fee;
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
    if (key === 'monthly_fee_ugx') return (before == null ? null : Number(before)) === (after == null ? null : Number(after));
    if (key === 'fee_exempt') return Boolean(before) === Boolean(after);
    if (key === 'districts_covered') return JSON.stringify(before || []) === JSON.stringify(after || []);
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
      const sets = changed.map((key, i) => `${key} = $${i + 2}${key === 'districts_covered' ? '::text[]' : ''}`);
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

module.exports = { registerAgentManagerRoutes, paymentState, maskNin, LISTING_ACTIONS };
