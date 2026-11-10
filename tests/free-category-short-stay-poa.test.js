'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  FREE_CATEGORY_LOOKBACK_DAYS,
  SHORT_STAY_HASHTAGS,
  STUDENT_HOSTEL_HASHTAGS,
  classifyFreeCategoryImport,
  freeCategoryHashtagDescriptors,
  isShortStayImport,
} = require('../services/freeCategoryHashtagSources');
const { getPropertySourceRegistry, releasePropertySourceRegistryCache } = require('../services/propertySourceRegistryService');
const { buildFoundOnlineShortStayRecord, stripContradictoryPricePeriodText } = require('../services/foundOnlineShortStayIntake');
const { listingDataIntegrityReport } = require('../utils/listingDataIntegrity');
const { listingPriceQuality } = require('../utils/listingPriceQuality');
const { listingTypeMatchSql } = require('../utils/constants');
const { normalizeFoundOnlineSourcePost, queueFoundOnlineSourcePostListings, sourcePostMeetsLaunchIntakeRule } = require('../services/socialSearchSourcedListingsService');

const root = path.resolve(__dirname, '..');

test('free hashtag sources are public, unpaid, and look back two months', () => {
  const rows = freeCategoryHashtagDescriptors();
  const tags = new Set(rows.map((row) => row.tag));
  for (const entry of STUDENT_HOSTEL_HASHTAGS) assert.equal(tags.has(entry.tag), true, entry.tag);
  for (const entry of SHORT_STAY_HASHTAGS) assert.equal(tags.has(entry.tag), true, entry.tag);
  assert.equal(rows.length, (STUDENT_HOSTEL_HASHTAGS.length + SHORT_STAY_HASHTAGS.length) * 4);
  for (const row of rows) {
    assert.equal(row.lookbackDays, 62);
    assert.equal(FREE_CATEGORY_LOOKBACK_DAYS, 62);
    assert.equal(/^https:\/\//.test(row.url), true, row.url);
    assert.equal(JSON.stringify(row).includes('+256'), false);
    assert.equal(row.destination === 'student' || row.destination === 'short_stay', true);
  }
  const student = rows.filter((row) => row.destination === 'student');
  const stay = rows.filter((row) => row.destination === 'short_stay');
  assert.equal(student.every((row) => row.listingTypes[0] === 'student'), true);
  assert.equal(stay.every((row) => row.listingTypes[0] === 'short_stay'), true);

  releasePropertySourceRegistryCache();
  const registry = getPropertySourceRegistry();
  const makerere = registry.find((item) => item.key === 'tiktok-hashtag-makererehostels');
  const airbnb = registry.find((item) => item.key === 'tiktok-hashtag-airbnbkampala');
  assert.ok(makerere, 'student hashtag is in the source registry');
  assert.equal(makerere.metadata.lookback_days, 62);
  assert.equal(makerere.metadata.paid_api, false);
  assert.equal(makerere.metadata.destination_category, 'student');
  assert.equal(makerere.canContactDirectly, false);
  assert.equal(makerere.phone || '', '');
  assert.ok(airbnb);
  assert.equal(airbnb.metadata.destination_category, 'short_stay');
  assert.equal(airbnb.metadata.do_not_message, true);
  releasePropertySourceRegistryCache();
});

test('nightly and Airbnb adverts are short stays; a monthly Airbnb flat is not', () => {
  const nightly = isShortStayImport({
    title: 'Apartment in Kololo',
    description: 'UGX 180,000 per night',
    price: 180000,
    price_period: 'night',
    listing_type: 'rent',
  });
  assert.equal(nightly, true);
  const airbnb = classifyFreeCategoryImport({
    title: 'Kololo Airbnb',
    description: 'Short stay in Kololo',
    source_key: 'instagram-hashtag-airbnbkampala',
    price: 200000,
    price_period: 'night',
  });
  assert.equal(airbnb.destination, 'st_listing');
  assert.equal(airbnb.lookback_days, 62);
  assert.equal(airbnb.do_not_message, true);
  const monthly = isShortStayImport({
    title: 'Furnished Airbnb apartment for rent in Kololo',
    description: 'UGX 3,000,000 per month',
    price: 3000000,
    price_period: 'month',
    listing_type: 'rent',
  });
  assert.equal(monthly, false);
});

test('hostel hashtags land in the student category, spelled student', () => {
  const route = classifyFreeCategoryImport({
    title: 'Room available',
    description: 'Hostel room near campus',
    source_key: 'facebook-hashtag-kikonihostels',
    listing_type: 'students',
    price: 450000,
    price_period: 'semester',
  });
  assert.equal(route.destination, 'properties');
  assert.equal(route.listing_type, 'student');
  const normalized = normalizeFoundOnlineSourcePost({
    source_url: 'https://www.tiktok.com/@hostel/video/7000000000000000991',
    source_platform: 'tiktok',
    source_key: 'tiktok-hashtag-makererehostels',
    source_registry_key: 'tiktok-hashtag-makererehostels',
    title: 'Makerere hostel room',
    caption: 'Student hostel room in Kikoni, Kampala. UGX 400,000 per semester.',
    area: 'Kikoni',
    district: 'Kampala',
    price: 400000,
    price_period: 'semester',
  });
  assert.equal(normalized.listingType, 'student');
});

test('the importer dry-run sends nightly adverts to short stay and hostels to student', async () => {
  const result = await queueFoundOnlineSourcePostListings({
    db: {},
    dryRun: true,
    posts: [
      {
        source_url: 'https://www.tiktok.com/@host/video/7000000000000000116',
        source_platform: 'tiktok',
        source_name: 'Host',
        title: 'Airbnb apartment in Kira',
        caption: 'Short-stay apartment in Kira, Wakiso for UGX 180,000 per night. Contact this profile.',
        area: 'Kira',
        district: 'Wakiso',
        price: 180000,
        price_period: 'night',
        listing_type: 'rent',
      },
      {
        source_url: 'https://www.tiktok.com/@hostel/video/7000000000000000991',
        source_platform: 'tiktok',
        source_key: 'tiktok-hashtag-makererehostels',
        source_registry_key: 'tiktok-hashtag-makererehostels',
        title: 'Makerere hostel room',
        caption: 'Student hostel room in Kikoni, Kampala. UGX 400,000 per semester.',
        area: 'Kikoni',
        district: 'Kampala',
        price: 400000,
        price_period: 'semester',
      },
    ],
  });
  assert.equal(result.would_create_properties, 1);
  assert.equal(result.would_create_short_stay_listings, 1);
  assert.equal(result.short_stay_listings[0].status, 'pending');
  assert.equal(result.short_stay_listings[0].source, 'imported');
  assert.equal(result.short_stay_listings[0].found_online_label, 'Found online');
  assert.equal(result.short_stay_listings[0].do_not_message, true);
  assert.equal(result.queued_listings.some((row) => row.destination === 'st_listing'), false);
  assert.equal(result.queued_listings[0].listing_type, 'student');

  const oldStay = normalizeFoundOnlineSourcePost({
    source_url: 'https://www.tiktok.com/@host/video/7000000000000000117',
    source_platform: 'tiktok',
    source_key: 'tiktok-hashtag-airbnbkampala',
    source_registry_key: 'tiktok-hashtag-airbnbkampala',
    title: 'Old Entebbe Airbnb',
    caption: 'Short stay in Entebbe for UGX 200,000 per night.',
    area: 'Entebbe',
    district: 'Wakiso',
    price: 200000,
    price_period: 'night',
    first_posted_at: '2026-01-15T00:00:00.000Z',
  });
  const oldIntake = sourcePostMeetsLaunchIntakeRule(oldStay, oldStay.sourceAgent);
  assert.equal(oldIntake.eligible, false);
  assert.equal(oldIntake.blocking_reasons.includes('outside_free_source_lookback'), true);
});

test('a found-online short stay is queued pending, labelled Found online, and not messaged', () => {
  const record = buildFoundOnlineShortStayRecord({
    title: 'Entebbe Airbnb cottage',
    description: 'A quiet cottage in Entebbe for UGX 250,000 per night, with parking and Wi-Fi.',
    district: 'Wakiso',
    area: 'Entebbe',
    price: 250000,
    price_period: 'night',
    sourceUrl: 'https://www.tiktok.com/@stay/video/7000000000000000881',
    key: 'stay-881',
  }, { name: 'Public page' });
  assert.equal(record.status, 'pending');
  assert.equal(record.moderation_stage, 'submitted');
  assert.equal(record.source, 'imported');
  assert.equal(record.found_online_label, 'Found online');
  assert.equal(record.do_not_message, true);
  assert.equal(record.host_phone, '');
  assert.equal(record.host_whatsapp, null);
  assert.equal(record.base_nightly_ugx, 250000);
  assert.equal(record.extra_fields.messaging_policy, 'found_online_never_message');
  const blank = buildFoundOnlineShortStayRecord({
    title: 'Jinja short stay',
    description: 'A Jinja guest cottage with no published nightly figure.',
    district: 'Jinja',
    area: 'Jinja',
  }, {});
  assert.equal(blank.base_nightly_ugx, 0);
  assert.equal(blank.extra_fields.price_label, 'POA');
  assert.equal(blank.extra_fields.do_not_message, true);
});

test('generated short-stay descriptions never keep contradictory price or period wording', () => {
  assert.equal(
    stripContradictoryPricePeriodText(
      'A stay in Kyanja. The source did not publish a price, so makaug shows Price upon application until the source confirms it. The guide price shown in the source is USh 150,000/month. Also 1,800,000 ugx per month, monthly available.'
    ),
    'A stay in Kyanja. The guide price shown in the source is USh 150,000. Also 1,800,000 ugx, available.'
  );
  const priced = buildFoundOnlineShortStayRecord({
    title: 'Kyanja Airbnb',
    description: '1 bedroom Airbnb in Kyanja. The source did not publish a price, so makaug shows Price upon application until the source confirms it. Guide price USh 150,000/month.',
    district: 'Kampala',
    area: 'Kyanja',
    price: 150000,
    sourceUrl: 'https://www.tiktok.com/@stay/video/7000000000000000999',
  }, {});
  assert.doesNotMatch(priced.description, /price (?:on|upon) application|\/month|per month|\bmonthly\b/i);
  assert.match(priced.description, /1 bedroom Airbnb in Kyanja/);
  assert.equal(priced.base_nightly_ugx, 150000);
  assert.equal(priced.extra_fields.price_on_application, false);
});

test('a missing price is POA and only a missing location blocks; implausible prices stay flagged', () => {
  const noPrice = listingDataIntegrityReport({
    listing_type: 'rent',
    title: 'Apartment for rent in Ntinda',
    description: 'Two-bedroom apartment for rent in Ntinda, Kampala.',
    district: 'Kampala',
    area: 'Ntinda',
    price: null,
    price_currency: 'UGX',
    price_original_currency: 'UGX',
    price_period: 'month',
  });
  assert.equal(noPrice.issue_codes.includes('missing_price_without_poa'), false);
  assert.equal(noPrice.price_on_application, true);
  assert.equal(listingPriceQuality(noPrice && {
    listing_type: 'rent',
    title: 'Apartment for rent in Ntinda',
    description: 'Two-bedroom apartment for rent in Ntinda, Kampala.',
    district: 'Kampala',
    area: 'Ntinda',
    price: null,
    price_period: 'month',
  }).ok, true);

  const unlocated = listingDataIntegrityReport({
    listing_type: 'rent',
    title: 'Apartment for rent',
    description: 'Apartment for rent somewhere in Uganda.',
    price: null,
    price_currency: 'UGX',
    price_original_currency: 'UGX',
    price_period: 'month',
  }, { requireCompleteEvidence: true });
  assert.equal(unlocated.issue_codes.includes('missing_specific_canonical_location'), true);

  const tiny = listingDataIntegrityReport({
    listing_type: 'sale',
    title: 'House for sale in Muyenga',
    description: 'Four-bedroom house for sale in Muyenga, Kampala.',
    district: 'Kampala',
    area: 'Muyenga',
    price: 1000,
    price_currency: 'UGX',
    price_original_currency: 'UGX',
    price_original: 1000,
    price_period: 'once',
  });
  assert.equal(tiny.issue_codes.includes('whole_property_price_below_sanity_floor'), true);
  const huge = listingPriceQuality({
    listing_type: 'rent',
    price: 9000000000000,
    price_period: 'month',
    price_original_currency: 'USD',
    price_original: 9000000000,
    title: 'House for rent in Kololo',
    description: 'House for rent in Kololo',
  });
  assert.equal(huge.hard_reasons.includes('price_impossible_above_1e12') || huge.hard_reasons.includes('usd_original_looks_like_ugx'), true);

  const values = [];
  const sql = listingTypeMatchSql('p', 'student', values);
  assert.match(sql, /listing_type/);
  assert.deepEqual(values, ['student', 'students']);
  const plural = [];
  assert.deepEqual(listingTypeMatchSql('p', 'students', plural) && plural, ['student', 'students']);
});

test('migration 207 backs up the student alias and the rollback file stays out of migrations', () => {
  const migration = fs.readFileSync(path.join(root, 'db/migrations/207_student_listing_type_and_free_hashtag_sources.sql'), 'utf8');
  const rollback = fs.readFileSync(path.join(root, 'scripts/rollback-207-student-alias-and-free-hashtags.sql'), 'utf8');
  assert.match(migration, /listing_type_student_alias_207_backup/);
  assert.match(migration, /free_hashtag_sources_207_backup/);
  assert.match(migration, /tiktok-hashtag-makererehostels/);
  assert.match(migration, /tiktok-hashtag-jinjaairbnb/);
  assert.equal(migration.includes('+256'), false);
  assert.match(migration, /whatsapp/i);
  assert.doesNotMatch(migration, /UPDATE\s+whatsapp|INSERT\s+INTO\s+whatsapp/i);
  assert.match(rollback, /listing_type = b\.listing_type/);
  assert.equal(fs.existsSync(path.join(root, 'db/migrations/rollback-207-student-alias-and-free-hashtags.sql')), false);
});
