'use strict';

/**
 * Whose property a buyer sees first.
 *
 * Every WhatsApp search was ORDER BY created_at DESC — newest wins, whoever it
 * belongs to. So a listing scraped off Facebook an hour ago outranked a
 * registered agent's property from last week, and the agents paying us
 * UGX 50,000 a month watched their stock sit underneath inventory nobody is
 * accountable for.
 *
 * Three tiers now, best first:
 *   0  a registered agent's listing
 *   1  listed with us directly by an owner
 *   2  found online — scraped, nobody has vouched for it
 *
 * Newest-first still decides the order inside a tier, so nothing else changes.
 */

const test = require('node:test');
const assert = require('node:assert');

const { searchRankingSql, searchOrderBySql } = require('../utils/searchRankingSql');
const { foundOnlinePropertySql } = require('../utils/foundOnlineSql');

test('the three tiers are ranked in the order we want them shown', () => {
  const sql = searchRankingSql('p');
  const agentTier = sql.indexOf('THEN 0');
  const ownerTier = sql.indexOf('THEN 1');
  const foundTier = sql.indexOf('ELSE 2');
  assert.ok(agentTier > -1 && ownerTier > -1 && foundTier > -1, 'all three tiers must exist');
  assert.ok(agentTier < ownerTier && ownerTier < foundTier, 'agent, then owner, then found online');
  assert.match(sql, /agent_id IS NOT NULL/, 'tier 0 is a registered agent');
});

test('a found-online listing cannot reach the top tier even with an agent on it', () => {
  // Scraped rows sometimes carry an agent_id from the matching step. The first
  // branch requires NOT found-online precisely so those cannot jump the queue.
  const sql = searchRankingSql('p');
  const firstBranch = sql.slice(0, sql.indexOf('THEN 0'));
  assert.match(firstBranch, /NOT \(/, 'the agent tier has to exclude found-online rows');
});

test('the ranking uses the one shared definition of "found online"', () => {
  const sql = searchRankingSql('p');
  // Same predicate the public routes, the lead handoff and billing all use, so
  // a change there cannot leave search behind.
  assert.ok(sql.includes(foundOnlinePropertySql('p')),
    'search must not carry its own idea of what found-online means');
});

test('newest-first still orders within a tier', () => {
  assert.match(searchOrderBySql('p'), /p\.created_at DESC$/,
    'the behaviour people are used to is unchanged inside each tier');
});

test('the alias is respected, so it can be used wherever the table is joined', () => {
  assert.match(searchRankingSql('prop'), /prop\.agent_id IS NOT NULL/);
  // Word-boundary: "prop.agent_id" naturally contains "p.agent_id".
  assert.ok(!/(?:^|[^a-z_])p\.agent_id/.test(searchRankingSql('prop')),
    'the default alias must not leak through when another is given');
  assert.match(searchRankingSql(''), /(?:^|\s)agent_id IS NOT NULL/, 'no alias means no prefix');
});

/**
 * Every WhatsApp search path has to agree, or the order depends on which one
 * happened to run: the natural-language finder, the type-and-area finder and
 * the two nearby finders.
 */
test('every WhatsApp search path ranks, and none is left on newest-first', () => {
  const source = require('fs').readFileSync(require.resolve('../routes/whatsapp'), 'utf8');
  const ranked = (source.match(/ORDER BY \$\{searchOrderBySql\('p'\)\}/g) || []).length;
  assert.strictEqual(ranked, 4, 'two result queries and two nearby candidate pools');

  // Nothing in a property search may still sort purely by recency. The one
  // remaining use is findPendingOwnerForwardMediaTarget, which is matching a
  // photo to the listing it belongs to, not showing anybody results.
  const stillNewestFirst = (source.match(/ORDER BY p\.created_at DESC/g) || []).length;
  assert.strictEqual(stillNewestFirst, 1,
    'a search path left on newest-first puts scraped listings above our agents again');
});

test('sharing your location still sorts by distance', () => {
  const source = require('fs').readFileSync(require.resolve('../routes/whatsapp'), 'utf8');
  assert.match(source, /\.sort\(\(a, b\) => a\.distance_km - b\.distance_km\)/,
    'somebody who shared their location wants the nearest thing first; ranking only decides which rows are measured');
});
