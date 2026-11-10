'use strict';

const { canonicalUgPhone, phoneKey9 } = require('../utils/ugPhone');

// The agent who already has this line, matched on the last 9 digits so a
// local 0… number and a +256… number cannot both create a profile.
async function findAgentByNormalisedPhone(db, phone, { exceptId = null } = {}) {
  const key = phoneKey9(phone);
  if (key.length < 9) return null;
  const row = (await db.query(
    `SELECT id, full_name, makaug_agent_number, status
       FROM agents
      WHERE ($2::uuid IS NULL OR id <> $2::uuid)
        AND (
          RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 9) = $1
          OR RIGHT(regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g'), 9) = $1
        )
      ORDER BY (removed_at IS NULL) DESC, (LOWER(COALESCE(status, '')) = 'approved') DESC, created_at ASC
      LIMIT 1`,
    [key, exceptId]
  )).rows[0];
  return row || null;
}

function duplicatePhoneBody(row = {}) {
  const number = row.makaug_agent_number ? ` (${row.makaug_agent_number})` : '';
  const name = row.full_name || 'Another agent';
  return {
    ok: false,
    error: `${name}${number} already uses this phone number. Open that agent instead.`,
    existing_agent_id: row.id || null,
    existing_agent_number: row.makaug_agent_number || null,
    existing_agent_name: row.full_name || ''
  };
}

// Old agent numbers (after a merge) resolve to the surviving profile.
async function resolveAgentByNumber(db, number) {
  const value = String(number || '').trim();
  if (!value) return null;
  const row = (await db.query(
    `SELECT a.id, a.makaug_agent_number, a.full_name, a.company_name, a.phone, a.whatsapp, a.email, a.status
       FROM agents a
      WHERE a.id = (SELECT al.agent_id FROM agent_number_aliases al WHERE UPPER(al.alias) = UPPER($1) LIMIT 1)
         OR (
           NOT EXISTS (SELECT 1 FROM agent_number_aliases al WHERE UPPER(al.alias) = UPPER($1))
           AND UPPER(COALESCE(a.makaug_agent_number, '')) = UPPER($1)
         )
      LIMIT 1`,
    [value]
  )).rows[0];
  return row || null;
}

function takenFromDbError(error) {
  const match = String(error?.message || '').match(/agent_phone_taken:([^:]*):([0-9a-f-]{36})/i);
  if (!match) return null;
  return {
    ok: false,
    error: `${match[1] || 'Another agent'} already uses this phone number. Open that agent instead.`,
    existing_agent_id: match[2],
    existing_agent_number: match[1] || null
  };
}

module.exports = {
  canonicalUgPhone,
  phoneKey9,
  findAgentByNormalisedPhone,
  duplicatePhoneBody,
  resolveAgentByNumber,
  takenFromDbError
};
