'use strict';

// Fisher, 28 Nov 2026: the shared found-online queue stopped around 200 cards,
// footers mixed totals between panels, Found online had no MK search, and the
// edit form filled Wakiso / Kawuku for MK-20261119-F96C7C when the source
// also names Wamala.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { resolveCanonicalUgandaLocation } = require('../utils/ugandaLocationRegistry');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const staff = fs.readFileSync(path.join(root, 'routes', 'staff.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function grab(source, name, next) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  let end = source.indexOf(`function ${next}(`, start + 10);
  assert.ok(end > start, `${next} follows ${name}`);
  if (source.slice(end - 'async '.length, end) === 'async ') end -= 'async '.length;
  return source.slice(start, end);
}

const sandbox = {};
vm.createContext(sandbox);
const placeHelpersStart = app.indexOf('const ADMIN_REVIEW_PLACE_STOP');
const placeHelpersEnd = app.indexOf('async function adminReviewSourceLocationDecision');
vm.runInContext([
  grab(app, 'staffQueueFooterModel', 'staffDedupeRows'),
  app.slice(placeHelpersStart, placeHelpersEnd)
].join('\n'), sandbox);

test('found-online paging does not stop at 200 and uses the review-queue endpoint', () => {
  const loader = grab(app, 'staffLoadMoreFoundOnline', 'staffFoundOnlineSearchUrl');
  assert.match(loader, /segment=found_online&page=\$\{nextPage\}&limit=\$\{limit\}&include_total=1/);
  assert.match(loader, /STAFF_FOUND_ONLINE_PAGE_LIMIT/);
  assert.match(loader, /fetchedPage/);
  assert.doesNotMatch(loader, /Math\.floor\(shown \/ limit\)/);
  assert.doesNotMatch(app, /STAFF_FOUND_ONLINE_MAX_ROWS/);
  const fill = grab(app, 'staffFillFoundOnlineQueue', 'staffFoundOnlineSettleCount');
  assert.match(fill, /staffFoundOnlineSettleCount\(\)/);
  assert.match(fill, /guard < 4/);
});

test('a footer never prints more rows than its own total', () => {
  const mixed = sandbox.staffQueueFooterModel(100, 58, true);
  assert.equal(mixed.label, 'Showing 100');
  assert.equal(mixed.foreignTotal, true);
  assert.equal(mixed.hasMore, true);
  const own = sandbox.staffQueueFooterModel(8, 268, false);
  assert.equal(own.label, 'Showing 8 of 268');
  assert.equal(own.hasMore, true);
  assert.equal(own.foreignTotal, false);
  const done = sandbox.staffQueueFooterModel(268, 268, true);
  assert.equal(done.label, 'Showing 268 of 268');
  assert.equal(done.hasMore, false);
  assert.match(grab(app, 'staffSetReviewQueue', 'renderStaffReviewQueue'), /const total = meta\?\.total;/);
  assert.doesNotMatch(grab(app, 'staffSetReviewQueue', 'renderStaffReviewQueue'), /meta\?\.total \?\? meta\?\.expected_count/);
  assert.match(app, /state\.epoch = \(Number\(state\.epoch\) \|\| 0\) \+ 1/);
});

test('Found online has the same MK search, kept on the found-online segment', () => {
  assert.match(html, /id="staff-found-online-search"/);
  assert.match(html, /oninput="staffSearchFoundOnlineQueue\(this\.value\)"/);
  const search = grab(app, 'staffLoadMoreFoundOnlineSearch', 'staffSearchFoundOnlineQueue');
  assert.match(search, /staffListingDirectLookup\(search\.term\)/);
  assert.match(search, /openStaffListingPreview\(openId\)/);
  assert.match(grab(app, 'staffSearchFoundOnlineQueue', 'renderStaffSourceIntake'), /staffLoadMoreFoundOnlineSearch\(seq\)/);
  const url = grab(app, 'staffFoundOnlineSearchUrl', 'staffLoadMoreFoundOnlineSearch');
  assert.match(url, /segment: "found_online"/);
  assert.match(url, /search: term/);
  const route = staff.slice(staff.indexOf("router.get('/properties/review-queue'"), staff.indexOf("router.patch('/profile'"));
  assert.match(route, /if \(segment === 'found_online'\) filters\.push\(foundOnlineReviewWhere\('p'\)\);/);
  assert.match(route, /if \(directLookup\) \{[\s\S]*filters\.length = 0;/);
});

test('F96C7C caption names Kawuku and Wamala, so the form does not pick one', () => {
  const caption = 'Kawuku, Uganda - Bank pressure sale, fully occupied 21-unit rentals for sale in Kawuku Wamala, Entebbe road, mailo land';
  const tokens = sandbox.adminReviewSourcePlaceTokens(caption);
  assert.ok(tokens.some((token) => token.toLowerCase() === 'kawuku'));
  assert.ok(tokens.some((token) => token.toLowerCase() === 'wamala'));
  assert.equal(tokens.some((token) => token.toLowerCase() === 'entebbe'), false);
  const kawuku = resolveCanonicalUgandaLocation('Kawuku');
  const wamala = resolveCanonicalUgandaLocation('Wamala');
  assert.equal(kawuku.status, 'matched');
  assert.equal(kawuku.match.district, 'Wakiso');
  assert.equal(kawuku.match.name, 'Kawuku');
  assert.equal(wamala.status, 'matched');
  assert.equal(wamala.match.name, 'Wamala');
  const decision = sandbox.adminReviewLocationAutofillDecision([
    { canonical_location_id: kawuku.match.key, name: kawuku.match.name, district: kawuku.match.district, match: 'exact_alias', confidence: 1 },
    { canonical_location_id: wamala.match.key, name: wamala.match.name, district: wamala.match.district, match: 'exact_alias', confidence: 1 }
  ]);
  assert.equal(decision.apply, null);
  assert.equal(decision.suggestions.length, 2);
  const only = sandbox.adminReviewLocationAutofillDecision([
    { canonical_location_id: 'najjera', name: 'Najjera', district: 'Wakiso', match: 'exact_alias', confidence: 1 }
  ]);
  assert.equal(only.apply.name, 'Najjera');
  const auto = grab(app, 'adminReviewAutoPopulateLocationFromSource', 'adminLocationReclassificationReviewHtml');
  assert.match(auto, /adminReviewSourceLocationDecision\(review\)/);
  assert.match(auto, /resolved_by === "nearest_area"/);
  assert.match(auto, /left blank/);
});
