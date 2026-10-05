'use strict';

const { foundOnlinePropertySql } = require('./foundOnlineSql');

/**
 * Whose listing gets shown first.
 *
 * Every WhatsApp search used to be ORDER BY created_at DESC — newest wins,
 * whoever it belongs to. So a listing we scraped off Facebook an hour ago
 * outranked a registered agent's property from last week, and the agents paying
 * us UGX 50,000 a month watched their stock sit below inventory nobody is
 * accountable for.
 *
 * Three tiers, best first:
 *
 *   0  a registered agent's listing — somebody who signed up with us, whose ID
 *      we hold and who answers the phone when a buyer calls
 *   1  listed with us directly by an owner — ours, just not an agent's
 *   2  found online — scraped from social media, nobody has vouched for it
 *
 * Within a tier it is still newest first, so the behaviour people are used to
 * is unchanged; only the order between tiers is new.
 *
 * Shared by every search path so they cannot drift apart: the natural-language
 * finder, the type-and-area finder, and the nearby finder all rank the same way.
 */
function searchRankingSql(alias = 'p') {
  const a = alias ? `${alias}.` : '';
  return `CASE
    WHEN ${a}agent_id IS NOT NULL AND NOT ${foundOnlinePropertySql(alias)} THEN 0
    WHEN NOT ${foundOnlinePropertySql(alias)} THEN 1
    ELSE 2
  END`;
}

/** The full ORDER BY: our people first, then newest within each tier. */
function searchOrderBySql(alias = 'p', tiebreak = 'created_at DESC') {
  const a = alias ? `${alias}.` : '';
  return `${searchRankingSql(alias)}, ${a}${tiebreak}`;
}

module.exports = { searchRankingSql, searchOrderBySql };
