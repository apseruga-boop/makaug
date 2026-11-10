'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const crypto = require('crypto');

const {
  approvedSignedUpAgentListingSql,
  featuredAgentDailyOrderSql,
  featuredAgentDailyRank,
  featuredAgentDateKey,
  sortFeaturedAgentListings
} = require('../utils/featuredAgentSelection');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Kampala date key is the calendar day, stable through the day', () => {
  const morning = new Date('2026-11-10T00:30:00Z'); // 03:30 in Kampala
  const evening = new Date('2026-11-10T20:30:00Z'); // 23:30 in Kampala
  const next = new Date('2026-11-10T21:30:00Z'); // 00:30 the next Kampala day
  assert.equal(featuredAgentDateKey(morning), '2026-11-10');
  assert.equal(featuredAgentDateKey(evening), '2026-11-10');
  assert.equal(featuredAgentDateKey(next), '2026-11-11');
});

test('daily shuffle matches md5(date + id) and does not change within a day', () => {
  const rows = [
    { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }
  ];
  const first = sortFeaturedAgentListings(rows, '2026-11-10').map((row) => row.id);
  const again = sortFeaturedAgentListings(rows, '2026-11-10').map((row) => row.id);
  const nextDay = sortFeaturedAgentListings(rows, '2026-11-11').map((row) => row.id);
  const expected = [...rows].sort((left, right) => featuredAgentDailyRank(left.id, '2026-11-10')
    .localeCompare(featuredAgentDailyRank(right.id, '2026-11-10'))).map((row) => row.id);
  assert.deepEqual(first, again);
  assert.deepEqual(first, expected);
  rows.forEach((row) => {
    const digest = crypto.createHash('md5').update(`2026-11-10${row.id}`).digest('hex');
    assert.equal(featuredAgentDailyRank(row.id, '2026-11-10'), digest);
  });
  assert.notDeepEqual(first, nextDay);
  assert.match(featuredAgentDailyOrderSql('p', '2026-11-10'), /md5\('2026-11-10' \|\| p\.id::text\) ASC/);
});

test('featured SQL keeps found-online and unsigned agents out of the public feed', () => {
  const sql = approvedSignedUpAgentListingSql('p');
  assert.match(sql, /NOT \(/);
  assert.match(sql, /found_online_property_source_v1/);
  assert.match(sql, /p\.agent_id IS NOT NULL/);
  assert.match(sql, /lower\(featured_agent\.status\) IN \('approved', 'verified'\)/);
  assert.match(sql, /featured_agent\.user_id IS NOT NULL/);
  assert.match(sql, /featured_agent\.removed_at IS NULL/);

  const properties = read('routes/properties.js');
  const featuredBranch = properties.slice(
    properties.indexOf('const featuredAgentDate = featuredAgentDateKey();'),
    properties.indexOf('if (listingOrigin)')
  );
  assert.match(featuredBranch, /approvedSignedUpAgentListingSql\('p'\)/);
  assert.doesNotMatch(featuredBranch, /extra_fields->>'featured', 'false'\) IN \('true'/);
  assert.match(properties, /featured: featuredAgentDailyOrderSql\('p', featuredAgentDate\)/);

  const homepage = read('services/publicSeoRenderService.js');
  assert.match(homepage, /approvedSignedUpAgentListingSql\('p'\)/);
  assert.match(homepage, /featuredAgentDailyOrderSql\('p', featuredDateRef\)/);
  assert.match(homepage, /id="home-featured"/);

  const app = read('assets/makaug-app.js');
  const picker = app.slice(app.indexOf('function getHomepageFeaturedListings'), app.indexOf('function getKnownUsersForAdmin'));
  assert.match(picker, /isFoundOnlineListing/);
  assert.doesNotMatch(picker, /sortListingsByNewest/);
  assert.match(app, /function syncFeaturedSectionVisibility/);
});

test('the daily rotation no longer refills a short day from found-online imports', () => {
  const rotation = read('services/featuredRotationService.js');
  const candidate = rotation.slice(rotation.indexOf('WITH ranked AS'), rotation.indexOf('const selection = selectFeaturedCandidates'));
  assert.match(candidate, /approvedSignedUpAgentListingSql\('p'\)/);
  assert.match(rotation, /selectFeaturedCandidates\(candidates\.rows, perCategory, dateKey\)/);
  assert.match(rotation, /if \(!selection\.selectedRows\.length\)/);
});
