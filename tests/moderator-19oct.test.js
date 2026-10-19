'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  normalizeFoundOnlineSourcePost,
  queueFoundOnlineSourcePostListings,
  sourcePostMeetsLaunchIntakeRule,
} = require('../services/socialSearchSourcedListingsService');
const { foreignSourceMarketStatus } = require('../utils/sourceIntakeIntegrity');
const { notAListingClassification } = require('../utils/sourceContentQuality');
const { propertyPriceMetadata } = require('../utils/propertyPriceCurrency');
const { rejectionForPendingRow, PENDING_SQL, assertReadOnly } = require('../scripts/report-pending-intake-rejections');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const staff = read('routes/staff.js');
const app = read('assets/makaug-app.js');

function youtubePost(overrides = {}) {
  return {
    source_url: 'https://www.youtube.com/watch?v=E813C2example',
    source_platform: 'youtube',
    platform: 'YouTube',
    source_name: 'Baerz & Co',
    title: 'Home for sale',
    caption: 'Home for sale',
    area: '',
    district: '',
    price: undefined,
    ingested_at: '2026-10-18T12:00:00.000Z',
    ...overrides,
  };
}

test('the Pending Review tile counts the same rows as review-queue segment=all', () => {
  const fastStart = staff.indexOf('async function buildStaffFastListingSummary');
  const fast = staff.slice(fastStart, staff.indexOf('\nasync function runStaffDashboardTasks', fastStart));
  const queueStart = staff.indexOf("router.get('/properties/review-queue'");
  const queue = staff.slice(queueStart, queueStart + 2500);
  assert.match(fast, /staffReviewQueueWhereSql\('all', 'p'\)/);
  assert.match(queue, /staffReviewQueueWhereSql\(segment, 'p'\)/);
  assert.doesNotMatch(fast, /SELECT p\.listed_via, p\.source, p\.lister_type, p\.agent_id, p\.extra_fields/);
  assert.match(fast, /_pending_count_ok/);
  assert.match(fast, /count_source: 'review_queue_segment_all'/);
  assert.match(staff, /label: 'staff_panel_pending_review_count'/);
  assert.match(app, /panels\.summary\?\.listings/);
  const merge = require('../routes/staff').__mergeStaffFastDashboardPayload;
  const merged = merge(
    { summary: { listings: { live: 4300, pending_review: 0, broker_pending_review: 0 } } },
    {
      summary: {
        listings: {
          live: null,
          pending_review: 9,
          broker_pending_review: 1,
          count_source: 'review_queue_segment_all',
          _pending_count_ok: true,
          _fallback_reason: 'statement_timeout',
        },
      },
    }
  );
  assert.equal(merged.summary.listings.pending_review, 9);
  assert.equal(merged.summary.listings.broker_pending_review, 1);
  assert.equal(merged.summary.listings.live, 4300);
  assert.equal(merged.summary.listings._fallback_reason, undefined);
});

test('YouTube overseas homes are rejected and a euro price is not stored as UGX', () => {
  const cases = [
    ['Zagreb', { title: 'Villa for sale in Zagreb', caption: 'Villa for sale in Zagreb, Croatia.', source_name: 'Baerz & Co' }],
    ['Amsterdam', { title: 'Canal house in Amsterdam', caption: 'For sale in Amsterdam.', price_text: '€159.000', price: '€159.000', source_name: 'Baerz & Co' }],
    ['Sotogrande', { title: 'Villa in Sotogrande', caption: 'For sale in Sotogrande, Spain.', source_name: 'Baerz & Co' }],
    ['Spain', { title: 'Home for sale in Spain', caption: 'A home for sale on the Spanish coast.', source_name: 'Example Estates' }],
  ];
  for (const [label, overrides] of cases) {
    const listing = normalizeFoundOnlineSourcePost(youtubePost(overrides));
    const intake = sourcePostMeetsLaunchIntakeRule(listing, listing.sourceAgent);
    assert.equal(listing.countryGate.allowed, false, label);
    assert.equal(listing.price, null, label);
    assert.equal(listing.priceOriginal, null, label);
    assert.equal(listing.priceFxRateUgx, null, label);
    assert.equal(intake.eligible, false, label);
    assert.equal(intake.country_gate_passed, false, label);
  }
  assert.equal(foreignSourceMarketStatus('House for sale in Kitende, Wakiso UGX 35m').allowed, true);
  assert.equal(propertyPriceMetadata('€159.000').price, null);
  assert.equal(propertyPriceMetadata('€159.000').rejection_reason, 'unsupported_property_price_currency');
  const usd = normalizeFoundOnlineSourcePost(youtubePost({
    source_name: 'Kololo Homes',
    title: 'Apartment for rent in Kololo',
    caption: 'Apartment for rent in Kololo, Kampala. $2,500/Month.',
    area: 'Kololo',
    district: 'Kampala',
    price: '$2,500/Month',
    price_currency: 'USD',
    listing_type: 'rent',
  }));
  assert.equal(usd.countryGate.allowed, true);
  assert.equal(usd.priceOriginalCurrency, 'USD');
  assert.equal(usd.priceOriginal, 2500);
  assert.equal(usd.price, 9500000);
});

test('construction-cost and how-to videos are rejected, including a suppressed channel', async () => {
  const boq = normalizeFoundOnlineSourcePost(youtubePost({
    source_url: 'https://www.youtube.com/watch?v=C8F0C9example',
    source_name: 'Building Classroom',
    title: 'BOQ explained',
    caption: 'How to read a bill of quantities and construction cost tips. No plot is offered.',
    price_text: '',
    price: undefined,
  }));
  const boqIntake = sourcePostMeetsLaunchIntakeRule(boq, boq.sourceAgent);
  assert.equal(boqIntake.eligible, false);
  assert.equal(boqIntake.positive_listing_gate_reason, 'not_a_listing');
  assert.equal(notAListingClassification({
    title: 'BOQ explained',
    description: 'How to read a bill of quantities.',
    source_name: 'Building Classroom',
  }).reason, 'not_a_listing');

  const sushi = normalizeFoundOnlineSourcePost(youtubePost({
    source_url: 'https://www.youtube.com/watch?v=7B1FA9example',
    source_name: 'Sushi M99 Consultant',
    title: 'What a 4 bedroom house costs to build',
    caption: 'Construction cost walkthrough.',
  }));
  const sushiIntake = sourcePostMeetsLaunchIntakeRule(sushi, sushi.sourceAgent);
  assert.equal(sushiIntake.eligible, false);
  assert.equal(sushiIntake.source_quality_reason, 'suppressed_channel');

  const real = normalizeFoundOnlineSourcePost(youtubePost({
    source_url: 'https://www.youtube.com/watch?v=kitende-plot',
    source_name: 'Segawa Frederick Kevin SFK',
    title: 'Plot for sale in Kitende',
    caption: 'Plot for sale in Kitende, Wakiso. UGX 35m. Call 0700000000.',
    area: 'Kitende',
    district: 'Wakiso',
    price_text: 'UGX 35m',
    price: 'UGX 35m',
    listing_type: 'land',
  }));
  const realIntake = sourcePostMeetsLaunchIntakeRule(real, real.sourceAgent);
  assert.equal(real.countryGate.allowed, true);
  assert.equal(realIntake.positive_listing_gate_reason, '');
  assert.equal(realIntake.source_quality_reason, '');
  assert.equal(notAListingClassification({
    title: 'House for sale in Ntinda, construction cost included',
    description: 'House for sale in Ntinda. Asking price UGX 350m.',
    source_name: 'Ntinda Homes',
  }).not_a_listing, false);

  const dry = await queueFoundOnlineSourcePostListings({
    dryRun: true,
    posts: [
      {
        source_url: 'https://www.youtube.com/watch?v=7B1FA9example',
        source_contact_url: 'https://www.youtube.com/@sushim99',
        source_name: 'Sushi M99 Consultant',
        platform: 'YouTube',
        title: 'What a 4 bedroom house costs to build',
        description: 'Construction cost walkthrough.',
        published_at: '2026-10-18T12:00:00.000Z',
      },
      {
        source_url: 'https://www.youtube.com/watch?v=C8F0C9example',
        source_contact_url: 'https://www.youtube.com/@buildingclassroom',
        source_name: 'Building Classroom',
        platform: 'YouTube',
        title: 'BOQ explained',
        description: 'How to read a bill of quantities.',
        published_at: '2026-10-18T12:00:00.000Z',
      },
      {
        source_url: 'https://www.youtube.com/watch?v=30F9E7example',
        source_contact_url: 'https://www.youtube.com/@baerz',
        source_name: 'Baerz & Co',
        platform: 'YouTube',
        title: 'Villa for sale in Zagreb',
        description: 'Villa for sale in Zagreb, Croatia.',
        published_at: '2026-10-18T12:00:00.000Z',
      },
    ],
  });
  const logged = Object.fromEntries((dry.source_review_records || []).map((row) => [row.title, row.reason]));
  assert.equal(logged['What a 4 bedroom house costs to build'], 'suppressed_channel');
  assert.equal(logged['BOQ explained'], 'not_a_listing');
  assert.equal(logged['Villa for sale in Zagreb'], 'non_uganda_location');
});

test('the pending rejection report only SELECTs and classifies the examples', () => {
  assertReadOnly(PENDING_SQL);
  assert.match(PENDING_SQL, /^\s*SELECT/i);
  assert.doesNotMatch(read('scripts/report-pending-intake-rejections.js'), /\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/);
  assert.match(read('package.json'), /inventory:report-pending-intake-rejections/);
  const foreign = rejectionForPendingRow({
    inquiry_reference: 'MK-20261018-E813C2',
    title: 'Canal house in Amsterdam',
    description: 'For sale €159.000',
    source_name: 'Baerz & Co',
    price: 159000000,
  });
  assert.equal(foreign.reason, 'foreign_currency_eur');
  const explainer = rejectionForPendingRow({
    inquiry_reference: 'MK-20261018-7B1FA9',
    title: 'BOQ for a house',
    description: 'How to price construction cost.',
    source_name: 'Sushi M99 Consultant',
  });
  assert.equal(explainer.reason, 'suppressed_channel');
  assert.equal(rejectionForPendingRow({
    title: 'Plot for sale in Kitende',
    description: 'Plot for sale in Kitende, Wakiso. UGX 35m.',
    source_name: 'Segawa Frederick Kevin SFK',
  }), null);
});
