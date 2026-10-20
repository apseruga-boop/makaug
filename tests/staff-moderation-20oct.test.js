'use strict';

// 20 Oct 2026 moderation dashboard: YouTube cover, category_ambiguous,
// Nkoowe/Kakiri towns, recognised-location warning, live search, and
// "500M from tarmac" prices.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseSourcePrice, maskRoadDistanceAmounts } = require('../utils/propertyPriceCurrency');
const { priceTextFromText } = require('../services/socialPlatformPostDiscoveryService');
const { sourcePriceEvidenceAmounts } = require('../utils/sourceIntakeIntegrity');
const { canonicalizeUgandaLocation } = require('../utils/ugandaLocationRegistry');
const { getDistrictLocationTree } = require('../utils/ugandaLocationHierarchy');
const {
  categoryAmbiguousClearedExtra,
  deriveListingClassification,
  listingDataIntegrityReport,
  moderationReasonWithoutCategoryAmbiguous
} = require('../utils/listingDataIntegrity');
const scheduler = require('../services/videoStillScheduler');

const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
const CAPTION = '500M From Tarmac. Plots from 30M to 40M. Also 500 metres from the main road.';

test('a YouTube listing can make a cover, and a disabled cover button explains why', async () => {
  assert.match(app, /id="staff-preview-video-cover-button"/);
  assert.match(app, /title="Tick the rights box below to make a cover from this listing's video\."/);
  assert.match(app, /function staffCoverDisableReason/);
  assert.match(app, /cover\.disabled = !consent/);
  assert.match(app, /cover\.title = reason/);
  assert.match(app, /staffSyncPreviewPhotoActions\(\)/);
  const syncStart = app.indexOf('function staffCoverDisableReason');
  const sync = app.slice(syncStart, app.indexOf('function staffPreviewPhotoUploadHtml', syncStart));
  assert.match(sync, /Tick the rights box below/);
  assert.match(sync, /TikTok or Facebook page/);
  assert.match(sync, /including a YouTube video/);

  const jpeg = Buffer.alloc(4000, 7);
  const calls = [];
  const made = await scheduler.makeVideoCoverForListing({
    pool: { waitingCount: 0 },
    async query() {
      return { rows: [{ id: 'p-yt', status: 'pending', extra_fields: { youtube_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } }] };
    }
  }, 'p-yt', {
    backfill: {
      async attachStills(id, uploaded, options) {
        calls.push([id, uploaded.map((item) => item.url), options.keepListingText]);
        return { attached: uploaded.length };
      }
    },
    fetchImpl: async (url) => ({
      ok: String(url).includes('maxresdefault'),
      async arrayBuffer() { return jpeg; }
    }),
    uploadBuffer: async () => ({ publicUrl: 'https://media.example/youtube-cover.jpg', sha256: 'abc', bytes: jpeg.length })
  });
  assert.equal(made.ok, true, made.error || '');
  assert.equal(made.attached, 1);
  assert.deepEqual(calls, [['p-yt', ['https://media.example/youtube-cover.jpg'], true]]);
  assert.equal(scheduler.youtubeVideoId('https://youtu.be/abc_DEF123'), 'abc_DEF123');
});

test('saving an explicit listing type clears category_ambiguous', () => {
  const mixed = {
    listing_type: 'sale',
    title: 'House for sale and for rent',
    description: 'A place with no single category.',
    price: 180000000,
    price_currency: 'UGX',
    price_period: 'once',
    district: 'Wakiso',
    area: 'Nkoowe'
  };
  const before = listingDataIntegrityReport(mixed);
  assert.ok(before.issue_codes.includes('category_ambiguous'), before.issue_codes.join(','));
  const cleared = categoryAmbiguousClearedExtra({
    data_integrity_review_required: true,
    data_integrity_issue_codes: ['category_ambiguous', 'missing_public_contact_path'],
    data_integrity_review: { issue_codes: ['category_ambiguous'], issues: [{ code: 'category_ambiguous' }] }
  }, 'land', { by: 'moderator' });
  assert.equal(cleared.staff_confirmed_listing_type, 'land');
  assert.deepEqual(cleared.data_integrity_issue_codes, ['missing_public_contact_path']);
  assert.equal(cleared.data_integrity_review_required, true);
  assert.deepEqual(cleared.data_integrity_review.issue_codes, []);
  const onlyAmbiguous = categoryAmbiguousClearedExtra({
    data_integrity_review_required: true,
    data_integrity_issue_codes: ['category_ambiguous']
  }, 'land');
  assert.equal(onlyAmbiguous.data_integrity_review_required, false);
  assert.equal(moderationReasonWithoutCategoryAmbiguous('Data integrity review required: category_ambiguous'), '');
  assert.equal(
    moderationReasonWithoutCategoryAmbiguous('Data integrity review required: category_ambiguous, missing_public_contact_path.'),
    'Data integrity review required: missing_public_contact_path.'
  );
  const after = deriveListingClassification({
    ...mixed,
    listing_type: 'land',
    extra_fields: onlyAmbiguous
  });
  assert.equal(after.category_ambiguous, false);
  assert.equal(after.listing_type, 'land');
  assert.equal(after.physical_type, 'land');
  const report = listingDataIntegrityReport({ ...mixed, listing_type: 'land', extra_fields: onlyAmbiguous });
  assert.equal(report.issue_codes.includes('category_ambiguous'), false);
});

test('Nkoowe is a town, and Gobero keeps Wakiso while also offering Kakiri', () => {
  const nkoowe = canonicalizeUgandaLocation('Nkoowe', 'Wakiso');
  assert.equal(nkoowe.district, 'Wakiso');
  assert.equal(nkoowe.town, 'Nkoowe');
  assert.equal(nkoowe.level, 'town');
  const gobero = canonicalizeUgandaLocation('Gobero', 'Wakiso');
  assert.equal(gobero.town, 'Wakiso');
  assert.equal(gobero.subcounty, 'Kakiri');
  const towns = getDistrictLocationTree('Wakiso').map((item) => item.city);
  assert.ok(towns.includes('Nkoowe'), towns.join(', '));
  assert.ok(towns.includes('Kakiri'), towns.join(', '));
  assert.ok(towns.includes('Wakiso'), towns.join(', '));
  const kakiri = getDistrictLocationTree('Wakiso').find((item) => item.city === 'Kakiri');
  assert.ok(kakiri.neighborhoods.some((item) => item.name === 'Gobero'));
  assert.match(app, /function adminReviewExtraTowns/);
  assert.match(app, /source\.subcounty/);
  assert.match(app, /adminReviewRecognisedLocationSelected/);
  const auto = app.slice(app.indexOf('async function adminReviewAutoPopulateLocationFromSource'), app.indexOf('function adminLocationReclassificationReviewHtml'));
  assert.match(auto, /adminReviewRecognisedLocationSelected\(review\)\) return/);
  assert.match(auto, /if \(seq !== adminReviewLocationAutofillSeq\) return/);
});

test('500M from tarmac is a distance, and a price range is kept', () => {
  assert.equal(maskRoadDistanceAmounts(CAPTION).includes('500M'), false);
  assert.deepEqual(parseSourcePrice('500M From Tarmac'), null);
  assert.deepEqual(parseSourcePrice('500m from the main road'), null);
  assert.deepEqual(parseSourcePrice('500 metres from road'), null);
  assert.deepEqual(parseSourcePrice(CAPTION), { amount: 30_000_000, currency: '' });
  assert.deepEqual(parseSourcePrice('UGX 500M'), { amount: 500_000_000, currency: 'UGX' });
  const extracted = priceTextFromText(CAPTION);
  assert.doesNotMatch(extracted, /500/);
  assert.equal(parseSourcePrice(extracted).amount, 30_000_000);
  assert.equal(sourcePriceEvidenceAmounts(CAPTION).includes(500_000_000), false);
  assert.ok(sourcePriceEvidenceAmounts(CAPTION).includes(30_000_000));
});
