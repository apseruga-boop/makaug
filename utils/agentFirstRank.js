'use strict';

const { foundOnlinePropertySql } = require('./foundOnlineSql');

/**
 * "Agent-listed first" order for the three money pages (/for-sale, /land,
 * /to-rent/kampala-kampala), shared by the server-rendered cards and the
 * client's `sort=agent_first`, so hydration does not reshuffle what Google saw.
 *
 *   1. agent-listed (agent_id set or lister_type 'agent'), same test as the
 *      listed_by CASE in routes/properties.js
 *   2. owner-listed
 *   3. found online
 * then, on /for-sale only, houses and apartments before land,
 * then the most recently updated.
 */
function agentFirstRankSql(alias = 'p') {
  const a = alias ? `${alias}.` : '';
  return `(CASE
    WHEN ${a}agent_id IS NOT NULL OR LOWER(COALESCE(${a}lister_type, '')) = 'agent' THEN 0
    WHEN ${foundOnlinePropertySql(alias)} THEN 2
    ELSE 1
  END)`;
}

function landRowRankSql(alias = 'p') {
  const a = alias ? `${alias}.` : '';
  return `(CASE WHEN LOWER(COALESCE(${a}property_type, '')) ~ '(^|[^a-z])(land|plot|plots)([^a-z]|$)' OR LOWER(COALESCE(${a}listing_type, '')) = 'land' THEN 1 ELSE 0 END)`;
}

function agentFirstOrderSql(alias = 'p', { homesBeforeLand = false } = {}) {
  const a = alias ? `${alias}.` : '';
  const parts = [`${agentFirstRankSql(alias)} ASC`];
  if (homesBeforeLand) parts.push(`${landRowRankSql(alias)} ASC`);
  parts.push(`${a}updated_at DESC NULLS LAST`, `${a}created_at DESC`, `${a}id DESC`);
  return parts.join(', ');
}

module.exports = { agentFirstRankSql, landRowRankSql, agentFirstOrderSql };
