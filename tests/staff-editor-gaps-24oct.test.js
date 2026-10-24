'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('assets/makaug-app.js');
const staff = read('routes/staff.js');
const properties = read('routes/properties.js');
const migration = read('db/migrations/173_listing_refs_price_unit_and_staff_indexes.sql');
const seo = read('services/publicSeoRenderService.js');

const {
  computedListingTotal,
  listingComparablePriceSql,
  publicLandSizeLabel,
  priceUnitCaption
} = require('../utils/listingLandPrice');
const { listingDirectLookup, listingDirectLookupClause, uuidPrefixBounds } = require('../utils/listingReferenceSearch');
const { canonicalizeUgandaLocation } = require('../utils/locationRegistry');
const { normalizeReviewLocationHierarchy } = require('../utils/ugandaLocationHierarchy');

function extract(source, signature, nextSignature) {
  const start = source.indexOf(signature);
  assert.ok(start >= 0, signature);
  const end = nextSignature ? source.indexOf(nextSignature, start + signature.length) : source.length;
  assert.ok(end > start, nextSignature || signature);
  return source.slice(start, end);
}

test('plot size and per-unit price compute a total without rewriting the stored price', () => {
  const row = {
    price: 270000000,
    price_unit: 'per_acre',
    land_size_value: 10,
    land_size_unit: 'acres'
  };
  assert.equal(publicLandSizeLabel(row), '10 acres');
  assert.equal(priceUnitCaption('per_acre'), 'per acre');
  assert.equal(computedListingTotal(row), 2700000000);
  assert.equal(row.price, 270000000);
  assert.equal(computedListingTotal({ price: 270000000, price_unit: null, land_size_value: 10, land_size_unit: 'acres' }), 270000000);
  assert.equal(computedListingTotal({ price: 5000000, price_unit: 'per_decimal', land_size_value: 10, land_size_unit: 'acres' }), 5000000000);
  const sql = listingComparablePriceSql('p');
  assert.match(sql, /per_acre/);
  assert.match(sql, /per_decimal/);
  assert.match(sql, /43560/);
  assert.doesNotMatch(migration, /UPDATE\s+properties[\s\S]*\bSET\s+price\b/i);
  assert.match(properties, /listingComparablePriceSql\('p'\)/);
  assert.match(properties, /price_unit: perUnit \? facts\.priceUnit : null/);
  assert.match(app, /data-plot-size="1"/);
  assert.match(app, /data-price-unit-field="1"/);
  assert.match(app, /id="admin-review-land-size-value-edit"/);
  assert.match(app, /id="admin-review-price-unit-edit"/);
  assert.match(app, /land_size_value: get\("admin-review-land-size-value-edit"\)/);
  assert.match(app, /data-land-size="1"/);
  assert.match(app, /data-price-total="1"/);
  assert.match(app, /function listingPriceUnitCaption/);
  assert.match(app, /const computed = listingComputedTotal\(property\)/);
  assert.match(seo, /function priceTotalLabel/);
  assert.match(seo, /data-price-total="1"/);
  assert.match(staff, /land_size_value: \(value\) => toNullableFloat\(value\)/);
  assert.match(staff, /price_unit: \(value\) => normalizePriceUnit\(value\) \|\| null/);
});

test('a saved town outside the dropdown is kept, and Matuga is a Wakiso town', () => {
  const matuga = canonicalizeUgandaLocation('Matuga', 'Wakiso');
  assert.equal(matuga?.district, 'Wakiso');
  assert.equal(matuga?.town, 'Matuga');
  assert.equal(matuga?.level, 'town');
  const kept = normalizeReviewLocationHierarchy({
    district: 'Wakiso',
    region: 'Central',
    city: 'Custom Hamlet',
    area: 'Nkoowe',
    neighborhood: 'Nkoowe'
  }, { preferChosenCity: true });
  assert.equal(kept.city, 'Custom Hamlet');
  assert.equal(kept.errors.some((error) => /city\/town must belong/.test(error)), false);
  const context = {
    getDistrictLocationTree: () => [
      { city: 'Kampala', neighborhoods: [{ name: 'Gangu' }] },
      { city: 'Nakawa', neighborhoods: [{ name: 'Luzira' }] },
      { city: 'Wakiso', neighborhoods: [{ name: 'Nkoowe' }] }
    ]
  };
  vm.createContext(context);
  vm.runInContext(`${extract(app, 'function adminReviewTownForNeighborhood', 'function adminReviewRefreshHierarchyControls')}; this.fn = adminReviewTownForNeighborhood;`, context);
  assert.equal(context.fn('Wakiso', 'Nkoowe', 'Somewhere Else'), 'Nkoowe');
  assert.equal(context.fn('Kampala', 'Kampala', 'Luzira'), 'Nakawa');
  assert.equal(context.fn('Kampala', 'Nakawa', 'Luzira'), 'Nakawa');
  assert.equal(context.fn('Kampala', 'Kampala', 'Gangu'), 'Kampala');
  assert.match(app, /id === "admin-review-city-edit"/);
});

test('a location failure keeps the internal note and a successful save clears the banner', () => {
  const saveStart = staff.indexOf('async function updateStaffEditableListing');
  const save = staff.slice(saveStart, staff.indexOf('async function loadStaffPropertyPreview', saveStart));
  assert.match(save, /persistStaffReviewNoteOnly/);
  assert.match(staff, /staff_listing_note_saved/);
  assert.match(staff, /note_saved: error\.note_saved === true/);
  const clientSave = extract(app, 'async function saveStaffListingPreview', 'function staffClearLocationBannerAfterSave');
  assert.match(clientSave, /staffShowPreviewSaveError\(error\)/);
  assert.doesNotMatch(clientSave, /admin-review-notes"\)\.value = ""/);
  assert.match(app, /data-staff-save-error/);
  assert.match(app, /The internal note was saved/);
  assert.match(app, /function staffClearLocationBannerAfterSave/);
  assert.match(app, /data-staff-location-warnings/);
  assert.match(app, /Location saved\./);
});

test('the editor loads the saved public title', () => {
  assert.match(app, /review\.editor_title \|\| review\.title/);
  assert.match(app, /const editorTitle = String\(preview\.editor_title \|\| preview\.title \|\| ""\)/);
  assert.match(app, /titleInput\.value = editorTitle/);
  assert.match(staff, /editor_title: staffEditorTitle\(property, extra\)/);
  assert.match(staff, /function staffEditorTitle/);
  assert.match(staff, /buildThirdPartyPublicTitle/);
});

test('staff search matches an 8-hex property id prefix and an MK ref', () => {
  assert.deepEqual(listingDirectLookup('d032ea26'), { kind: 'id_prefix', value: 'd032ea26' });
  assert.deepEqual(listingDirectLookup('EFB4A3'), { kind: 'suffix', value: 'EFB4A3' });
  assert.equal(listingDirectLookup('Ntinda'), null);
  const bounds = uuidPrefixBounds('d032ea26');
  const values = [];
  const clause = listingDirectLookupClause('p', listingDirectLookup('d032ea26'), values);
  assert.match(clause, /p\.id >= \$1::uuid AND p\.id < \$2::uuid/);
  assert.equal(values[0], bounds.start);
  assert.match(app, /return "id_prefix"/);
  const queue = staff.slice(staff.indexOf("router.get('/properties/review-queue'"), staff.indexOf("router.patch('/profile'"));
  assert.match(queue, /listingDirectLookup\(search\)/);
  const list = staff.slice(staff.indexOf("router.get('/properties'"), staff.indexOf("router.get('/properties/review-queue'"));
  assert.match(list, /propertyListingSearchClause\('p', search, values\)/);
});

test('migration 173 assigns an MK ref on insert and backfills blanks without touching WhatsApp', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION properties_assign_inquiry_reference/);
  assert.match(migration, /BEFORE INSERT ON properties/);
  assert.match(migration, /EXECUTE FUNCTION properties_assign_inquiry_reference/);
  assert.match(migration, /MK-/);
  assert.match(migration, /UPDATE properties AS target/);
  assert.match(migration, /inquiry_reference/);
  assert.doesNotMatch(migration, /BEGIN;/);
  assert.match(migration, /without\n-- changing the WhatsApp bridge/);
  const changed = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' });
  assert.doesNotMatch(changed, /scripts\/whatsapp-web-copilot\.js/);
  assert.doesNotMatch(changed, /routes\/whatsapp\.js/);
  assert.doesNotMatch(read('routes/whatsapp.js'), /videos\/move/);
});

test('staff can move or swap a video with a required audit note, and no listing pair is swapped in data', () => {
  assert.match(app, /Move\/swap video/);
  assert.match(app, /function staffSubmitVideoMove/);
  assert.match(app, /An audit note is required/);
  assert.match(app, /\/videos\/move/);
  assert.match(staff, /router\.post\('\/properties\/:id\/videos\/move'/);
  const media = read('services/staffPropertyMediaService.js');
  assert.match(media, /An audit note is required to move or swap a video/);
  assert.match(media, /staff_listing_video_moved/);
  assert.match(media, /staff_listing_video_swapped/);
  assert.doesNotMatch(migration, /deb68eb2|87543468/);
  assert.doesNotMatch(media, /deb68eb2|87543468/);
});

test('older videos show Not checked with Run check now instead of staying on being read', () => {
  const record = extract(app, 'function adminVideoCaptionOcrRecord', 'function adminVideoCaptionFactRows');
  assert.match(record, /status: "not_checked"/);
  assert.doesNotMatch(record, /status: "pending"/);
  assert.match(app, /Not checked/);
  assert.match(app, /Run check now/);
  assert.match(app, /function staffRunVideoCaptionOcr/);
  assert.match(staff, /router\.post\('\/properties\/:id\/video-caption-ocr'/);
  assert.match(staff, /runVideoCaptionOcr/);
  assert.match(app, /Video text is still being read\./);
  const context = {
    adminReviewExtraFields: (review) => review.extra_fields || {}
  };
  vm.createContext(context);
  vm.runInContext(`${record}; this.record = adminVideoCaptionOcrRecord;`, context);
  assert.equal(context.record({ extra_fields: { video_urls: ['https://cdn.example/a.mp4'] } }).status, 'not_checked');
  assert.equal(context.record({
    extra_fields: { video_caption_ocr: { status: 'done', text: '10 acres', facts: {}, conflicts: [] } }
  }).status, 'done');
  assert.equal(context.record({
    video_caption_ocr: { status: 'done', text: 'stored', facts: { acres: 10 }, conflicts: [] },
    extra_fields: { video_urls: ['https://cdn.example/a.mp4'] }
  }).text, 'stored');
});

test('unpublish shows reason required and publish again asks for confirmation', () => {
  assert.match(app, /Reason required\. Type why this live listing is being unpublished\./);
  assert.match(app, /data-staff-republish-confirm/);
  assert.match(app, /Yes, publish again/);
  assert.match(app, /function staffShowRepublishConfirm/);
  const republish = extract(app, 'async function staffRepublishPreviewListing', 'async function staffClaimLead');
  assert.match(republish, /confirmed !== true/);
  assert.match(republish, /staffShowRepublishConfirm\(modal, true\)/);
  assert.doesNotMatch(republish, /window\.confirm/);
});

test('the pending review tile uses the review-queue count and dashes when that query fails', () => {
  const fast = extract(staff, 'async function buildStaffFastListingSummary', 'async function runStaffDashboardTasks');
  assert.match(fast, /staffReviewQueueWhereSql\('all', 'p'\)/);
  assert.match(fast, /pending_review: null, broker_pending_review: null/);
  assert.match(fast, /_pending_count_ok: !reviewFailed/);
  assert.match(app, /function staffCountOrDash/);
  assert.match(app, /listings\._pending_count_ok === false/);
  assert.match(app, /staffCountOrDash\(data\.summary\?\.listings, "pending_review"\)/);
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${extract(app, 'function staffCountOrDash', 'function openHarvestSubmissionModal')}; this.count = staffCountOrDash;`, context);
  assert.equal(context.count({ pending_review: 0, _pending_count_ok: false }, 'pending_review'), null);
  assert.equal(context.count({ pending_review: 4, _pending_count_ok: true }, 'pending_review'), 4);
  assert.equal(context.count({ pending_review: null, _pending_count_ok: true }, 'pending_review'), null);
});

test('staff list and moderation counts avoid the slow scans, and the 05:30 monitor yields', () => {
  assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_property_moderation_events_actor_created/);
  assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_pending_review_created/);
  assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_lister_phone_lookup/);
  assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_lister_email_lookup/);
  assert.match(migration, /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_staff_list_updated/);
  const list = staff.slice(staff.indexOf("router.get('/properties'"), staff.indexOf("router.get('/properties/review-queue'"));
  assert.doesNotMatch(list, /SELECT p\.\*/);
  assert.doesNotMatch(list, /p\.extra_fields,/);
  assert.match(list, /jsonb_build_object/);
  assert.match(list, /ORDER BY p\.updated_at DESC NULLS LAST/);
  assert.match(staff, /lower\(lister_email\) = lower\(\$3\)/);
  assert.match(staff, /label: 'staff_fast_my_moderation'/);
  assert.match(staff, /total_actions: null, approvals: null/);
  const scheduler = read('services/dailySourceMonitorScheduler.js');
  assert.match(scheduler, /06:00–06:30/);
  assert.match(scheduler, /22 Oct 05:20/);
  assert.match(scheduler, /maxSources: 3/);
  assert.match(scheduler, /maxResults: 4/);
  assert.match(scheduler, /yieldBetweenPlatforms: true/);
  assert.match(read('scripts/run-continuous-social-monitor.js'), /yieldBetweenPlatforms === true/);
  assert.equal(require('../services/dailySourceMonitorScheduler').SCHEDULED_MONITOR_SETTINGS.maxSources, 3);
});
