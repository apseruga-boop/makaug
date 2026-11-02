'use strict';

/**
 * The "Verified by makaug" tick, granted automatically.
 *
 * Complete details (Arthur, 2 Nov 2026):
 *   - status approved and not removed;
 *   - not a social or found-online import;
 *   - an ID on file: a NIN (at least 10 letters/digits), a sign-up
 *     identity_document_url, or a live staff-uploaded ID front;
 *   - a valid phone or WhatsApp number (9 to 15 digits).
 *
 * When an agent reaches complete details, grantVerifiedTickIfComplete() adds
 * [STAFF_REVIEWED_PRIVATE_ID_PROFILE] plus [AUTO_VERIFIED_COMPLETE_DETAILS],
 * stamps contact_phone_verified_at if empty, and writes one audit row.
 * It never changes status. The public tick (verifiedByMakaugSql) re-checks
 * status, removal and ID on every read, so it disappears if the ID is
 * removed or the agent is suspended or removed.
 */

const { REVIEWED_PRIVATE_ID_PROFILE_MARKER, agentIdOnFileSql } = require('./publicAgentEligibilityService');

const AUTO_VERIFIED_MARKER = '[AUTO_VERIFIED_COMPLETE_DETAILS]';

function q(alias) {
  return /^[a-z_][a-z0-9_]*$/i.test(alias) ? alias : 'a';
}

function agentValidPhoneSql(alias = 'a') {
  const a = q(alias);
  return `(regexp_replace(COALESCE(NULLIF(BTRIM(${a}.phone), ''), ${a}.whatsapp, ''), '\\D', '', 'g') ~ '^[0-9]{9,15}$')`;
}

function agentNotImportedSql(alias = 'a') {
  const a = q(alias);
  return `(
    COALESCE(${a}.verification_reason, '') NOT ILIKE '%public social source onboarding%'
    AND COALESCE(${a}.verification_reason, '') NOT ILIKE '%source profile%'
    AND COALESCE(${a}.licence_number, '') !~* '^(SOCIAL|FOUND-ONLINE|TIKTOK|FACEBOOK|X)-'
  )`;
}

function agentHasCompleteDetailsSql(alias = 'a') {
  const a = q(alias);
  return `(
    LOWER(COALESCE(${a}.status, '')) = 'approved'
    AND ${a}.removed_at IS NULL
    AND ${agentNotImportedSql(a)}
    AND ${agentIdOnFileSql(a)}
    AND ${agentValidPhoneSql(a)}
  )`;
}

/** Plain-JS mirror of agentHasCompleteDetailsSql, for tests and callers with a row. */
function agentHasCompleteDetails(row = {}) {
  if (!row || typeof row !== 'object') return false;
  if (String(row.status || '').toLowerCase() !== 'approved') return false;
  if (row.removed_at) return false;
  const reason = String(row.verification_reason || '');
  const licence = String(row.licence_number || '');
  if (/public social source onboarding/i.test(reason) || /source profile/i.test(reason)) return false;
  if (/^(SOCIAL|FOUND-ONLINE|TIKTOK|FACEBOOK|X)-/i.test(licence)) return false;
  const nin = String(row.nin || '').replace(/[^A-Za-z0-9]/g, '');
  const idOnFile = nin.length >= 10
    || String(row.identity_document_url || '').trim() !== ''
    || row.has_id_file === true;
  if (!idOnFile) return false;
  const phone = String((String(row.phone || '').trim() || row.whatsapp || '')).replace(/\D/g, '');
  return /^[0-9]{9,15}$/.test(phone);
}

/**
 * Grant the tick if the agent now has complete details. Idempotent: an agent
 * already carrying the reviewed marker is left alone. Never throws — a save
 * must not fail because the tick could not be granted.
 */
async function grantVerifiedTickIfComplete(db, agentId, { source = 'unknown', actorId = 'system', writeAudit = null, logger = null } = {}) {
  if (!db || !agentId) return { granted: false };
  try {
    const result = await db.query(
      `UPDATE agents a
         SET verification_reason = CONCAT_WS(' ', NULLIF(BTRIM(COALESCE(a.verification_reason, '')), ''), $2::text, $3::text),
             contact_phone_verified_at = COALESCE(a.contact_phone_verified_at, NOW()),
             updated_at = NOW()
       WHERE a.id::text = $1::text
         AND POSITION($2::text IN COALESCE(a.verification_reason, '')) = 0
         AND ${agentHasCompleteDetailsSql('a')}
       RETURNING a.id, a.full_name`,
      [String(agentId), REVIEWED_PRIVATE_ID_PROFILE_MARKER, `${AUTO_VERIFIED_MARKER} Verified tick granted automatically: approved, ID and valid phone on file (${source}).`]
    );
    const row = result.rows?.[0];
    if (!row) return { granted: false };
    const details = { agent_id: row.id, source, rule: 'approved+not_removed+not_import+id_on_file+valid_phone' };
    if (typeof writeAudit === 'function') {
      await Promise.resolve(writeAudit('agent_verified_tick_auto_granted', details, actorId)).catch(() => {});
    } else {
      await db.query('INSERT INTO audit_logs (actor_id, action, details) VALUES ($1, $2, $3::jsonb)',
        [String(actorId || 'system'), 'agent_verified_tick_auto_granted', JSON.stringify(details)]).catch(() => {});
    }
    return { granted: true, agent_id: row.id };
  } catch (error) {
    logger?.warn?.(`Verified tick auto-grant failed for ${agentId}: ${error.message}`);
    return { granted: false, error: error.message };
  }
}

module.exports = {
  AUTO_VERIFIED_MARKER,
  agentHasCompleteDetails,
  agentHasCompleteDetailsSql,
  agentIdOnFileSql,
  agentValidPhoneSql,
  grantVerifiedTickIfComplete
};
