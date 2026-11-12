'use strict';

/**
 * The people we have pitched, before they are agents.
 *
 * An employee sends the join-as-an-agent film from WhatsApp (Agent 007,
 * option 3 — or option 4 when a new prospect also gets the payment link).
 * This is the book for "who did Arthur or Ronald send the video to, when,
 * what happened, and may we contact them again".
 *
 * A second send of the same film to the same number is blocked. Staff can
 * log a send they already made by hand, mark the follow-up, or mark
 * "do not contact again". Found-online listers are never messaged.
 */

const db = require('../config/database');
const { isFoundOnlineListerPhone } = require('./foundOnlineListerPhone');

const PROSPECT_STATUSES = Object.freeze([
  'pitched', 'interested', 'signed_up', 'approved', 'declined', 'archived'
]);

const FOLLOW_UP_LABELS = Object.freeze({
  pitched: 'No reply yet',
  interested: 'Yes — they want to join',
  signed_up: 'Yes — they signed up',
  approved: 'Yes — they are an approved agent',
  declined: 'No — they said no',
  archived: 'Archived'
});

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

/** Last nine digits — the key every other phone match in this codebase uses. */
function prospectPhoneKey(value) {
  return digitsOnly(value).slice(-9);
}

/** Public reports and the desk show only the last three digits. */
function maskPhoneLast3(value) {
  const digits = digitsOnly(value);
  if (!digits) return '';
  return `•••${digits.slice(-3)}`;
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

function followUpLabel(row = {}) {
  if (row.do_not_contact) return 'Do not contact again';
  return FOLLOW_UP_LABELS[row.status] || 'No reply yet';
}

function daysSince(value, now = new Date()) {
  if (!value) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 86400000));
}

function senderLabel(row = {}) {
  return String(row.pitched_by_name || '').trim() || maskPhoneLast3(row.pitched_by) || 'Staff';
}

function videoLabel(row = {}) {
  const kind = String(row.video_kind || 'agent').trim() || 'agent';
  if (kind === 'agent') return 'Joining film (Agent 007 option 3)';
  return kind;
}

function formatAlreadyContactedMessage(row = {}) {
  const name = String(row.full_name || 'This person').trim() || 'This person';
  const when = row.pitched_at ? new Date(row.pitched_at) : null;
  const whenText = when && !Number.isNaN(when.getTime())
    ? when.toLocaleString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric' })
    : 'an earlier date';
  const days = daysSince(row.pitched_at);
  const daysText = days == null ? '' : days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
  const follow = followUpLabel(row);
  if (row.do_not_contact) {
    return `${name} is marked “do not contact again”. Do not send them another message.`;
  }
  return `${name} has already been sent this video on ${whenText} by ${senderLabel(row)}. `
    + `Follow-up: ${follow}${daysText ? ` (${daysText})` : ''}. `
    + 'Do not send the same video again. Call them instead, or update the follow-up in Outreach.';
}

function publicProspect(row = {}, activity = {}) {
  const days = row.days_since_pitch != null ? Number(row.days_since_pitch) : daysSince(row.pitched_at);
  return {
    id: row.id,
    full_name: row.full_name,
    phone_masked: maskPhoneLast3(row.phone || row.phone_key),
    video_kind: row.video_kind || 'agent',
    video_label: videoLabel(row),
    status: row.status,
    follow_up: followUpLabel(row),
    follow_up_note: row.follow_up_note || row.notes || '',
    pitched_at: row.pitched_at,
    days_ago: days,
    pitched_by_name: senderLabel(row),
    logged_manually: row.logged_manually === true,
    do_not_contact: row.do_not_contact === true,
    can_reach_out_again: row.do_not_contact !== true && !['declined', 'approved'].includes(String(row.status || '')),
    agent_id: row.agent_id || null,
    agent_status: row.agent_status || null,
    next_step: prospectNextStep({ ...row, days_since_pitch: days }),
    activity: {
      last_reply_at: activity.last_reply_at || row.replied_at || null,
      last_activity_at: activity.last_activity_at || null,
      signed_up: Boolean(row.agent_id || ['signed_up', 'approved'].includes(row.status))
    }
  };
}

/**
 * May we send this film to this number? Checks do-not-contact, a previous
 * send of the same video, and found-online lister numbers.
 */
async function evaluateOutreachSend({ phone = '', videoKind = 'agent' } = {}) {
  if (!isUsableProspectPhone(phone)) {
    const error = new Error('A prospect needs a phone number we can dial');
    error.status = 400;
    error.code = 'invalid_phone';
    throw error;
  }
  if (await isFoundOnlineListerPhone(db, phone)) {
    return {
      ok: false,
      code: 'found_online',
      message: 'That number belongs to a found-online listing. We never message those people.'
    };
  }
  const existing = await findProspectByPhone(phone);
  if (!existing) return { ok: true, existing: null };
  if (existing.do_not_contact) {
    return {
      ok: false,
      code: 'do_not_contact',
      existing,
      message: formatAlreadyContactedMessage(existing)
    };
  }
  const sameVideo = String(existing.video_kind || 'agent') === String(videoKind || 'agent');
  if (sameVideo && existing.pitched_at) {
    return {
      ok: false,
      code: 'already_sent',
      existing,
      message: formatAlreadyContactedMessage(existing)
    };
  }
  return { ok: true, existing };
}

/**
 * Record that the film went out. A second pitch of the same film to the same
 * number is rejected so the employee is told to follow up, not send again.
 */
async function recordProspectPitch({
  fullName = '',
  phone = '',
  pitchedBy = '',
  pitchedByName = '',
  videoKind = 'agent',
  metadata = {},
  pitchedAt = null,
  loggedManually = false,
  allowDuplicate = false
} = {}) {
  const phoneKey = prospectPhoneKey(phone);
  if (!phoneKey || phoneKey.length < 9) {
    const error = new Error('A prospect needs a phone number we can dial');
    error.status = 400;
    throw error;
  }
  if (!allowDuplicate && !loggedManually) {
    const decision = await evaluateOutreachSend({ phone, videoKind });
    if (!decision.ok && decision.code !== 'found_online') {
      // Found-online is blocked at the send hook, before anything is recorded.
      // A manual log of an already-sent film still uses logManualOutreach.
      const error = new Error(decision.message);
      error.status = 409;
      error.code = decision.code;
      error.existing = decision.existing;
      throw error;
    }
  }
  const result = await db.query(
    `INSERT INTO agent_prospects (
        full_name, phone, phone_key, video_kind, pitched_by, pitched_by_name,
        pitched_at, logged_manually, metadata
     )
     VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), COALESCE($7::timestamptz, NOW()), $8, $9::jsonb)
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
      pitchedAt || null,
      loggedManually === true,
      JSON.stringify(metadata && typeof metadata === 'object' ? metadata : {})
    ]
  );
  const row = result.rows[0];
  return { prospect: row, repeat: row?.newly_created === false };
}

/**
 * Staff log of a video they already sent (for example this week, off the
 * desk). Does not send a message. Refuses if that person is already tracked
 * for the same film, or if the number is a found-online lister.
 */
async function logManualOutreach({
  fullName = '',
  phone = '',
  pitchedBy = '',
  pitchedByName = '',
  videoKind = 'agent',
  pitchedAt = null,
  note = '',
  metadata = {}
} = {}) {
  const decision = await evaluateOutreachSend({ phone, videoKind });
  if (!decision.ok) {
    const error = new Error(decision.message);
    error.status = decision.code === 'found_online' ? 400 : 409;
    error.code = decision.code;
    error.existing = decision.existing || null;
    throw error;
  }
  return recordProspectPitch({
    fullName,
    phone,
    pitchedBy,
    pitchedByName,
    videoKind,
    pitchedAt,
    loggedManually: true,
    allowDuplicate: true,
    metadata: {
      ...metadata,
      logged_manually: true,
      note: String(note || '').trim().slice(0, 500)
    }
  });
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
        AND p.do_not_contact IS NOT TRUE
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

async function activityForPhoneKeys(keys = []) {
  const list = [...new Set((keys || []).map((k) => String(k || '')).filter((k) => k.length === 9))];
  const map = new Map();
  if (!list.length) return map;
  try {
    const replies = await db.query(
      `SELECT RIGHT(REGEXP_REPLACE(COALESCE(phone, from_phone, sender, ''), '[^0-9]', '', 'g'), 9) AS phone_key,
              MAX(COALESCE(created_at, received_at, sent_at)) AS last_reply_at
         FROM whatsapp_messages
        WHERE LOWER(COALESCE(direction, '')) IN ('inbound', 'in', 'received')
          AND RIGHT(REGEXP_REPLACE(COALESCE(phone, from_phone, sender, ''), '[^0-9]', '', 'g'), 9) = ANY($1::text[])
        GROUP BY 1`,
      [list]
    );
    for (const row of replies.rows || []) {
      map.set(row.phone_key, { ...(map.get(row.phone_key) || {}), last_reply_at: row.last_reply_at });
    }
  } catch (_) { /* optional table / columns */ }
  return map;
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

async function listOutreach({ status = '', pitchedBy = '', limit = 200 } = {}) {
  const rows = await listProspects({ status, pitchedBy, limit });
  const activity = await activityForPhoneKeys(rows.map((row) => row.phone_key));
  return rows.map((row) => publicProspect(row, activity.get(row.phone_key) || {}));
}

/**
 * The next thing a human has to do, in words. This is what makes the list a
 * worklist rather than a log.
 */
function prospectNextStep(row = {}) {
  if (row.do_not_contact) return 'Nothing — do not contact again';
  const days = Number(row.days_since_pitch || 0);
  switch (row.status) {
    case 'pitched':
      return days >= 1
        ? `Call them — pitched ${days} day${days === 1 ? '' : 's'} ago, no reply yet`
        : 'Waiting for them to come back';
    case 'interested':
      return 'Register them with *Agent 007* → option 1';
    case 'signed_up':
      return 'Approve them in the Agents tab';
    case 'approved':
      return row.paid_until ? 'Done — paid up' : 'Chase the monthly payment';
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

async function findProspectById(id) {
  if (!id) return null;
  const result = await db.query('SELECT * FROM agent_prospects WHERE id = $1 LIMIT 1', [id]);
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

const FOLLOW_UP_TO_STATUS = Object.freeze({
  yes: 'interested',
  interested: 'interested',
  no: 'declined',
  declined: 'declined',
  no_reply: 'pitched',
  pitched: 'pitched',
  signed_up: 'signed_up',
  approved: 'approved'
});

async function setFollowUp(id, { status = '', note = '', actor = '' } = {}) {
  const mapped = FOLLOW_UP_TO_STATUS[String(status || '').trim().toLowerCase()];
  if (!mapped) {
    const error = new Error('Follow-up must be yes, no, or no_reply');
    error.status = 400;
    throw error;
  }
  const result = await db.query(
    `UPDATE agent_prospects
        SET status = $2,
            follow_up_note = COALESCE(NULLIF($3, ''), follow_up_note),
            follow_up_at = NOW(),
            follow_up_by = NULLIF($4, ''),
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, mapped, String(note || '').trim().slice(0, 500), String(actor || '').trim().slice(0, 160)]
  );
  if (!result.rows[0]) {
    const error = new Error('Outreach record not found');
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}

async function setDoNotContact(id, { value = true, actor = '' } = {}) {
  const flag = value !== false;
  const result = await db.query(
    `UPDATE agent_prospects
        SET do_not_contact = $2,
            do_not_contact_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
            do_not_contact_by = CASE WHEN $2 THEN NULLIF($3, '') ELSE do_not_contact_by END,
            updated_at = NOW()
      WHERE id = $1
      RETURNING *`,
    [id, flag, String(actor || '').trim().slice(0, 160)]
  );
  if (!result.rows[0]) {
    const error = new Error('Outreach record not found');
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}

module.exports = {
  PROSPECT_STATUSES,
  FOLLOW_UP_LABELS,
  prospectPhoneKey,
  normalizeProspectPhone,
  isUsableProspectPhone,
  maskPhoneLast3,
  followUpLabel,
  daysSince,
  formatAlreadyContactedMessage,
  publicProspect,
  evaluateOutreachSend,
  recordProspectPitch,
  logManualOutreach,
  reconcileProspectsWithAgents,
  listProspects,
  listOutreach,
  prospectNextStep,
  findProspectByPhone,
  findProspectById,
  setProspectStatus,
  setFollowUp,
  setDoNotContact
};
