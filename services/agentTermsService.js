'use strict';

/**
 * Agent terms: which agents have accepted them, and when.
 *
 * An agent is sent the terms PDF in their welcome pack and replies AGREE. The
 * acceptance (version, number, time) is written to audit_logs — the same place
 * the lister terms and explainer sends are recorded — so it needs no migration
 * and is a permanent record. The free-trial tracker reads it to show who has
 * signed and who still has to.
 */

const docs = require('./listingDocsService');

const ACTION = 'agent_terms_accepted';

const AGREE_PATTERN = /^\s*(i\s+)?agree(d)?[\s.!👍✅]*$/i;

function isAgreeReply(text = '') {
  return AGREE_PATTERN.test(String(text || ''));
}

async function acceptedAt(db, agentId) {
  const row = (await db.query(
    `SELECT created_at FROM audit_logs WHERE action = $1 AND details->>'agent_id' = $2 ORDER BY created_at ASC LIMIT 1`,
    [ACTION, String(agentId)]
  ).catch(() => ({ rows: [] }))).rows[0];
  return row ? row.created_at : null;
}

/** Record an acceptance once; a second AGREE reports the first. */
async function recordAcceptance(db, { agent, phone = '' } = {}) {
  const already = await acceptedAt(db, agent.id);
  if (already) return { recorded: false, accepted_at: already };
  await db.query(
    `INSERT INTO audit_logs (actor_id, action, details) VALUES ($1, $2, $3::jsonb)`,
    [String(phone || 'whatsapp'), ACTION, JSON.stringify({ agent_id: String(agent.id), agent_name: agent.full_name || '', phone: String(phone || ''), version: docs.AGENT_TERMS_VERSION })]
  );
  return { recorded: true, accepted_at: new Date() };
}

function thanksMessage({ name = '', repeat = false } = {}) {
  if (repeat) return `✅ ${name ? `${name}, y` : 'Y'}ou have already accepted the makaug agent terms — nothing more to do. Send your next property whenever you are ready.`;
  return `✅ *Thank you${name ? `, ${name}` : ''} — your agent terms are accepted.*\n\nWe have recorded it against this number. You can read them again any time: ${docs.docUrls('agent_terms').pdf}\n\nSend your first property whenever you are ready — photos and a caption with the type, area and price.`;
}

module.exports = { ACTION, isAgreeReply, acceptedAt, recordAcceptance, thanksMessage };
