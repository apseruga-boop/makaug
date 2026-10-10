'use strict';

/**
 * P3 (10 Oct 2026), MK-20261009-1B005F: the source panel said "Added to
 * makaug: 20 May 2026" for a listing harvested from an 8 Oct post and created
 * on 9 Oct. The harvest stamped a fixed 20 May 2026 seed date into
 * extra_fields.added_to_makaug_at on every row. "Added to makaug" is now the
 * listing's created_at (UK date, e.g. "9 Oct 2026"), and the source's own date
 * shows separately as "Posted on <platform>".
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { publicPropertyRow } = require('../routes/properties')._test;

const APP = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');

const row = {
  id: '56ec3ed3-3962-4aa1-aea1-4bf333279083',
  title: 'House for sale in Akright City',
  description: 'Six bedrooms.',
  listing_type: 'sale',
  area: 'Akright City',
  district: 'Wakiso',
  status: 'approved',
  source: 'social_search',
  listed_via: 'found_online',
  created_at: '2026-10-09T07:17:21.034Z',
  extra_fields: {
    found_online: true,
    source_platform: 'TikTok',
    // Old source metadata, as stored on the live row.
    added_to_makaug_at: '2026-05-20T00:00:00.000Z',
    added_to_makaug_label: 'Added to makaug source review on 20 May 2026',
    first_seen_online_at: '2026-05-20T00:00:00.000Z',
    source_published_at: '2026-10-08T12:00:00.000Z'
  }
};

function formatter() {
  const start = APP.indexOf('function formatAddedToMakaugDate');
  const end = APP.indexOf('function formatListingDate', start);
  assert.ok(start > 0 && end > start);
  const context = { parseDateSafe: (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? null : d; }, formatListingDate: () => 'fallback' };
  vm.createContext(context);
  vm.runInContext(`${APP.slice(start, end)}; this.fn = formatAddedToMakaugDate;`, context);
  return context.fn;
}

test('the API sends created_at as added_to_makaug_at, not the old source date', () => {
  const out = publicPropertyRow(row, []);
  assert.equal(out.extra_fields.added_to_makaug_at, '2026-10-09T07:17:21.034Z');
  assert.equal(out.extra_fields.added_to_makaug_label, null, 'no "20 May 2026" label');
  assert.doesNotMatch(JSON.stringify(out), /source review on 20 May 2026/);
});

test('the date reads "9 Oct 2026" on the UK calendar day', () => {
  const format = formatter();
  assert.equal(format('2026-10-09T07:17:21.034Z'), '9 Oct 2026');
  // 23:30 UTC on 8 Oct is 00:30 BST on 9 Oct.
  assert.equal(format('2026-10-08T23:30:00.000Z'), '9 Oct 2026');
  assert.equal(format(''), '');
});

test('the SPA source panel uses created_at first and shows "Posted on <platform>" apart', () => {
  assert.match(APP, /const addedToMakaugRaw = p\.created_at \|\| p\.createdAt \|\| extra\.added_to_makaug_at \|\| firstSeenRaw;/);
  assert.match(APP, /const addedToMakaug = formatAddedToMakaugDate\(addedToMakaugRaw\);/);
  assert.match(APP, /\(meta\.platform \? `\$\{translateListingLabel\("Posted on"\)\} \$\{meta\.platform\}` : translateListingLabel\("First posted online"\)\)/);
  assert.match(APP, /<strong>\$\{translateListingLabel\("Added to makaug"\)\}<\/strong><br>\$\{adminEscape\(meta\.addedToMakaug\)\}/);
});

test('harvest no longer stamps the fixed 20 May 2026 date on new rows', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/socialSearchSourcedListingsService.js'), 'utf8');
  assert.doesNotMatch(source, /SOCIAL_SEARCH_ADDED_TO_MAKAUG_AT|SOCIAL_SEARCH_FIRST_SEEN_AT/);
  assert.doesNotMatch(source, /source review on 20 May 2026|source watch on 20 May 2026/);
  assert.doesNotMatch(source, /added_to_makaug_at:/);
});

test.after(async () => {
  try { await require('../config/database').pool.end(); } catch (_) {}
});
