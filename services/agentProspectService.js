'use strict';

/**
 * The people we have pitched, before they are agents.
 *
 * An employee sends the join-as-an-agent film from WhatsApp. Until this
 * existed, the only trace was an audit_logs row and an outbound queue entry,
 * neither of which carries a status — so nobody could answer "who did Ronald
 * pitch last week, and which of them signed up".
 *
 * A prospect graduates by phone number: the moment an agents row exists for the
 * same last nine digits, the prospect is marked signed_up and carries the agent
 * id, so the two halves of the funnel join up without anyone retyping anything.
 */

const db = require('../config/database');

const PROSPECT_STATUSES = Object.freeze([
  'pitched', 'interested', 'signed_up', 'approved', 'declined', 'archived'
]);

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

/** Last nine digits — the key every other phone match in this codebase uses. */
function prospectPhoneKey(value) {
  return digitsOnly(value).slice(-9);
}

/**
 * Ugandan numbers arrive as 0751…, 256751… and +256751… all in the same week.
 * Store something dialable so the pay link and the welcome pack can reuse it.
 */
function normalizeProspectPhone(value) {
  const digits = digitsOnly(value);
  if (!digits) return '';
  if (digits.startsWith('256')) return digits;
  if (digits.startsWith('0')) return `256${digits.slice(1)}`;
  if (digits.length === 9) return `256${digits}`;
  return digits;
}

function isUsableProspectPhone(value) {
  return prospectPhoneKey(value).length === 9;
}

/**
 * Record that the film went out. A second pitch to the same number updates the
 * row rather than creating another one, and the caller is told which it was so
 * the employee can be told "already sent on …" instead of a bare confirmation.
 */
async function recordProspectPitch({
  fullName = '',
  phone = '',
  pitchedBy = '',
  pitchedByName = '',
  videoKind = 'agent',
  metadata = {}
} = {}) {
  const phoneKey = prospectPhoneKey(phone);
  if (!phoneKey || phoneKey.length < 9) {
    const error = new Error('A prospect needs a phone number we can dial');
    error.status = 400;
    throw error;
  }
  const result = await db.query(
    `INSERT INTO agent_prospects (full_name, phone, phone_key, video_kind, pitched_by, pitched_by_name, metadata)
     VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), $7::jsonb)
     ON CONFLICT (phone_key) DO UPDATE
        SET full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), agent_prospects.full_name),
            last_nudged_at = NOW(),
            updated_at = NOW(),
            metadata = agent_prospects.metadata || EXCLUDED.metadata
     RETURNING *, (xmax = 0) AS newly_created`,
    [
      String(fullName || '').trim() || 'Unnamed prospect',
      normalizeProspectPhone(phone),
      phoneKey,
      String(videoKind || 'agent'),
      digitsOnly(pitchedBy),
      String(pitchedByName || '').trim(),
      JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {})
    ]
  );
  const row = result.rows[0];
  return { prospect: row, repeat: row?.newly_created === false };
}

/**
 * Has this prospect become an agent? Called when the pipeline is read, so the
 * answer is never stale and nothing has to fire at sign-up time.
 */
async function reconcileProspectsWithAgents() {
  const result = await db.query(
    `UPDATE agent_prospects AS p
        SET status = CASE WHEN a.status = 'approved' THEN 'approved' ELSE 'signed_up' END,
            agent_id = a.id,
            signed_up_at = COALESCE(p.signed_up_at, a.created_at, NOW()),
            updated_at = NOW()
       FROM agents AS a
      WHERE p.status IN ('pitched', 'interested', 'signed_up')
        AND (
          RIGHT(REGEXP_REPLACE(COALESCE(a.whatsapp, ''), '[^0-9]', '', 'g'), 9) = p.phone_key
          OR RIGHT(REGEXP_REPLACE(COALESCE(a.phone, ''), '[^0-9]', '', 'g'), 9) = p.phone_key
        )
        AND (p.agent_id IS DISTINCT FROM a.id
          OR p.status <> CASE WHEN a.status = 'approved' THEN 'approved' ELSE 'signed_up' END)
      RETURNING p.id`,
    []
  );
  return result.rows.length;
}

async function listProspects({ status = '', pitchedBy = '', limit = 200 } = {}) {
  await reconcileProspectsWithAgents().catch(() => 0);
  const filters = [];
  const values = [];
  if (status && PROSPECT_STATUSES.includes(status)) {
    values.push(status);
    filters.push(`p.status = $${values.length}`);
  }
  if (pitchedBy) {
    values.push(prospectPhoneKey(pitchedBy));
    filters.push(`RIGHT(REGEXP_REPLACE(COALESCE(p.pitched_by, ''), '[^0-9]', '', 'g'), 9) = $${values.length}`);
  }
  values.push(Math.min(500, Math.max(1, Number(limit) || 200)));
  const result = await db.query(
    `SELECT p.*,
            a.status AS agent_status,
            a.paid_until,
            a.welcome_sent_at,
            EXTRACT(DAY FROM NOW() - p.pitched_at)::int AS days_since_pitch
       FROM agent_prospects p
       LEFT JOIN agents a ON a.id = p.agent_id
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY p.pitched_at DESC
      LIMIT $${values.length}`,
    values
  );
  return result.rows;
}

/**
 * The next thing a human has to do, in words. This is what makes the list a
 * worklist rather than a log.
 */
function prospectNextStep(row = {}) {
  const days = Number(row.days_since_pitch || 0);
  switch (row.status) {
    case 'pitched':
      return days >= 3
        ? `Follow up — pitched ${days} days ago, no sign-up yet`
        : 'Waiting for them to come back';
    case 'interested':
      return 'Register them with *Agent 007* → option 1';
    case 'signed_up':
      return 'Approve them in the Accounts tab';
    case 'approved':
      return row.paid_until ? 'Done — paid up' : `Chase the ${require('./pricingCopy').feeLabels().agent_ugx} payment`;
    case 'declined':
      return 'Nothing — they said no';
    default:
      return '';
  }
}

async function findProspectByPhone(phone) {
  const key = prospectPhoneKey(phone);
  if (!key || key.length < 9) return null;
  const result = await db.query('SELECT * FROM agent_prospects WHERE phone_key = $1 LIMIT 1', [key]);
  return result.rows[0] || null;
}

async function setProspectStatus(phone, status) {
  if (!PROSPECT_STATUSES.includes(status)) return null;
  const key = prospectPhoneKey(phone);
  if (!key) return null;
  const result = await db.query(
    `UPDATE agent_prospects SET status = $2, updated_at = NOW() WHERE phone_key = $1 RETURNING *`,
    [key, status]
  );
  return result.rows[0] || null;
}

module.exports = {
  PROSPECT_STATUSES,
  prospectPhoneKey,
  normalizeProspectPhone,
  isUsableProspectPhone,
  recordProspectPitch,
  reconcileProspectsWithAgents,
  listProspects,
  prospectNextStep,
  findProspectByPhone,
  setProspectStatus
};
