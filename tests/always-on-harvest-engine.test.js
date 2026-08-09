'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  buildHarvestFingerprints,
  captionSimHash,
  dHashFromGrayscalePixels,
  hammingDistanceHex,
  pHashFromGrayscalePixels,
} = require('../services/propertyHarvestDedupService');
const {
  fetchXAuthorExpansion,
  importExactSocialSourcePosts,
} = require('../services/socialPlatformPostDiscoveryService');
const {
  normalizeFoundOnlineSourcePost,
  queueFoundOnlineSourcePostListings,
  sourcePostAutoLiveStatusFor,
  sourcePostMeetsLaunchIntakeRule,
} = require('../services/socialSearchSourcedListingsService');
const {
  channelIdFromTopic,
  parseYouTubeWebSubAtom,
  requestYouTubeWebSubSubscription,
  verifyYouTubeWebSubChallenge,
  webSubSignatureValid,
  youtubeFeedTopic,
} = require('../services/youtubeWebSubService');
const {
  maskConstructionCostsForPriceExtraction,
  sourcePriceEvidenceAmounts,
} = require('../utils/sourceIntakeIntegrity');
const { sourcePositiveListingGateForRecord } = require('../utils/sourceContentQuality');
const { normalizeSourceUrl, stablePlatformPostIdentity } = require('../utils/sourceUrlNormalization');
const {
  applyHarvestPublicSubmissionVisibility,
  envFlagEnabled,
  harvestAutomationEnabled,
  harvestPublicSubmissionsEnabled,
} = require('../utils/harvestFeatureFlags');
const { buildDateWindows } = require('../scripts/backfill-youtube-harvest');

const root = path.resolve(__dirname, '..');

async function run() {
  assert.strictEqual(envFlagEnabled('true'), true);
  assert.strictEqual(envFlagEnabled('ON'), true);
  assert.strictEqual(envFlagEnabled('false'), false);
  assert.strictEqual(harvestAutomationEnabled({}), false);
  assert.strictEqual(harvestAutomationEnabled({ HARVEST_AUTOMATION_ENABLED: 'true' }), true);
  assert.strictEqual(harvestPublicSubmissionsEnabled({}), false);
  assert.strictEqual(harvestPublicSubmissionsEnabled({ HARVEST_PUBLIC_SUBMISSIONS_ENABLED: '1' }), true);
  const publicHarvestControl = '<button data-harvest-public-submission>Paste listing link</button>';
  assert.match(applyHarvestPublicSubmissionVisibility(publicHarvestControl, {}), /display:none!important/);
  assert.strictEqual(
    applyHarvestPublicSubmissionVisibility(publicHarvestControl, { HARVEST_PUBLIC_SUBMISSIONS_ENABLED: 'true' }),
    publicHarvestControl
  );
  assert.strictEqual(
    normalizeSourceUrl('https://twitter.com/Agent/status/1890000000000000000?utm_source=test'),
    'https://x.com/agent/status/1890000000000000000'
  );
  assert.deepStrictEqual(
    stablePlatformPostIdentity('https://youtu.be/abc_DEF123?si=tracker'),
    {
      platform: 'youtube',
      id: 'abc_DEF123',
      key: 'youtube:abc_DEF123',
      canonical_url: 'https://www.youtube.com/watch?v=abc_DEF123',
    }
  );

  const captionHash = captionSimHash('Three-bedroom house for rent in Kalagi, Mukono.');
  assert.match(captionHash, /^[0-9a-f]{16}$/);
  assert.strictEqual(captionHash, captionSimHash('Three bedroom house for rent in Kalagi Mukono'));
  assert.strictEqual(hammingDistanceHex('0000000000000000', '000000000000000f'), 4);
  const descendingPixels = Array.from({ length: 8 }, () => [9, 8, 7, 6, 5, 4, 3, 2, 1]).flat();
  assert.strictEqual(dHashFromGrayscalePixels(descendingPixels), 'ffffffffffffffff');
  const pHashPixels = Array.from({ length: 32 * 32 }, (_, index) => index % 256);
  const perceptualHash = pHashFromGrayscalePixels(pHashPixels);
  assert.match(perceptualHash, /^[0-9a-f]{16}$/);
  assert.strictEqual(perceptualHash, pHashFromGrayscalePixels(pHashPixels));
  const fingerprints = buildHarvestFingerprints({
    source_url: 'https://x.com/agent/status/1890000000000000000',
    caption: 'House for rent in Kalagi',
    contact_phone: '+256 700 111 222',
    area: 'Kalagi',
    price: 3040000,
  }, { imageHash: 'ffffffffffffffff', imagePHash: perceptualHash });
  assert.strictEqual(fingerprints.source_platform_id, 'x:1890000000000000000');
  assert.strictEqual(fingerprints.contact_cluster_key, 'phone:256700111222');
  assert.strictEqual(fingerprints.primary_image_phash, perceptualHash);
  assert.match(fingerprints.composite_listing_key, /^[0-9a-f]{32}$/);

  const unknownUgandaPlace = sourcePositiveListingGateForRecord({
    title: 'Three-bedroom house for rent in Lukaya',
    description: 'Available for rent at UGX 900,000 per month',
    area: 'Lukaya',
    listing_type: 'rent',
  });
  assert.strictEqual(unknownUgandaPlace.ok, true);
  assert.strictEqual(unknownUgandaPlace.reason, 'unknown_uganda_location_review');
  const explicitForeign = sourcePositiveListingGateForRecord({
    title: 'Three-bedroom house for rent in Nairobi, Kenya',
    description: 'Available at KSH 90,000 per month',
    listing_type: 'rent',
  });
  assert.strictEqual(explicitForeign.ok, false);
  assert.strictEqual(explicitForeign.reason, 'non_uganda_location');
  const explicitForeignWithUgandaContact = sourcePositiveListingGateForRecord({
    title: 'House for sale in Nairobi, Kenya',
    description: 'Call our Uganda desk on +256700111222',
    listing_type: 'sale',
  });
  assert.strictEqual(explicitForeignWithUgandaContact.ok, false);
  assert.strictEqual(explicitForeignWithUgandaContact.reason, 'non_uganda_location');

  const priceEvidence = 'Construction costs $80,000. Finished house for sale in Kalagi. Asking price $800. Call +256700111222.';
  assert(maskConstructionCostsForPriceExtraction(priceEvidence).includes('[construction-cost]'));
  assert.deepStrictEqual(sourcePriceEvidenceAmounts(priceEvidence), [800]);
  const normalizedUsd = normalizeFoundOnlineSourcePost({
    post_url: 'https://x.com/agent/status/1890000000000000000',
    title: priceEvidence,
    caption: priceEvidence,
    source_name: 'Agent',
    source_page_url: 'https://x.com/agent',
    first_posted_at: '2026-08-01T00:00:00.000Z',
  });
  assert.strictEqual(normalizedUsd.priceCurrency, 'USD');
  assert.strictEqual(normalizedUsd.priceOriginal, 800);
  assert.strictEqual(normalizedUsd.price, 800 * normalizedUsd.priceFxRateUgx);
  assert.strictEqual(normalizedUsd.area, 'Kalagi');
  const intakeGate = sourcePostMeetsLaunchIntakeRule(normalizedUsd, normalizedUsd.sourceAgent);
  assert.strictEqual(intakeGate.eligible, true);
  const publishGate = sourcePostAutoLiveStatusFor(normalizedUsd, normalizedUsd.sourceAgent);
  assert.strictEqual(publishGate.approved, false);
  assert.strictEqual(publishGate.status, 'pending');
  assert.strictEqual(publishGate.policy, 'always_on_harvest_review_only_v1');

  const atom = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><entry><yt:videoId>video123</yt:videoId><yt:channelId>UCchannel123</yt:channelId><title>Kalagi house</title><published>2026-08-09T00:00:00Z</published><author><name>Agent UG</name></author></entry></feed>`;
  const topic = youtubeFeedTopic('UCchannel123');
  assert.strictEqual(topic, 'https://www.youtube.com/xml/feeds/videos.xml?channel_id=UCchannel123');
  assert.strictEqual(channelIdFromTopic(topic), 'UCchannel123');
  assert.deepStrictEqual(parseYouTubeWebSubAtom(atom), {
    video_id: 'video123',
    channel_id: 'UCchannel123',
    title: 'Kalagi house',
    published_at: '2026-08-09T00:00:00Z',
    updated_at: '',
    author_name: 'Agent UG',
    deleted: false,
  });
  const rawAtom = Buffer.from(atom);
  const secret = 'websub-test-secret';
  const signature = `sha1=${crypto.createHmac('sha1', secret).update(rawAtom).digest('hex')}`;
  assert.strictEqual(webSubSignatureValid(rawAtom, signature, secret), true);
  assert.strictEqual(webSubSignatureValid(rawAtom, 'sha1=00', secret), false);
  const missingSecretSubscription = await requestYouTubeWebSubSubscription(null, 'UCchannel123', {
    env: { YOUTUBE_WEBSUB_CALLBACK_URL: 'https://makaug.com/api/harvest/youtube/websub' },
    fetchImpl: async () => { throw new Error('should not call the hub without a signature secret'); },
  });
  assert.strictEqual(missingSecretSubscription.reason, 'missing_youtube_websub_secret');
  const unrequestedChallenge = await verifyYouTubeWebSubChallenge({
    query: async () => ({ rows: [] }),
  }, {
    'hub.mode': 'subscribe',
    'hub.topic': topic,
    'hub.challenge': 'challenge-value',
  });
  assert.strictEqual(unrequestedChallenge.reason, 'unrequested_websub_channel');

  let xFetchCount = 0;
  const xFetch = async () => {
    xFetchCount += 1;
    if (xFetchCount === 1) {
      return { ok: false, status: 503, json: async () => ({ title: 'temporary error' }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: [{
          id: '1890000000000000000',
          author_id: 'user1',
          created_at: '2026-08-01T00:00:00.000Z',
          text: 'Three-bedroom house for rent in Kalagi USD 800 per month. Call +256700111222.',
        }],
        includes: { users: [{ id: 'user1', username: 'agent', name: 'Agent UG' }] },
      }),
    };
  };
  const previousHashLimit = process.env.HARVEST_IMAGE_HASH_LOOKUP_LIMIT;
  process.env.HARVEST_IMAGE_HASH_LOOKUP_LIMIT = '0';
  const exactImport = await importExactSocialSourcePosts({
    posts: ['https://x.com/agent/status/1890000000000000000'],
    dryRun: true,
    xBearerToken: 'test-token',
    fetchImpl: xFetch,
  });
  if (previousHashLimit == null) delete process.env.HARVEST_IMAGE_HASH_LOOKUP_LIMIT;
  else process.env.HARVEST_IMAGE_HASH_LOOKUP_LIMIT = previousHashLimit;
  assert.strictEqual(xFetchCount, 2);
  assert.strictEqual(exactImport.metadata_reports[0].method, 'x_api_v2_tweet_lookup');
  assert.strictEqual(exactImport.metadata_reports[0].retried, true);
  assert.strictEqual(exactImport.metadata_reports[0].attempts, 2);
  assert.strictEqual(exactImport.exact_social_import_rows[0].title.includes('Three-bedroom house'), true);
  assert.strictEqual(exactImport.exact_social_import_rows[0].first_posted_at, '2026-08-01T00:00:00.000Z');
  assert.strictEqual(exactImport.exact_social_import_rows[0].source_platform_id, 'x:1890000000000000000');
  assert.strictEqual(exactImport.per_url_results[0].outcome, 'would_create');
  assert.strictEqual(exactImport.per_url_results[0].reason, 'would_create_in_review_queue');

  let authorTimelineUrl = '';
  const authorExpansion = await fetchXAuthorExpansion([{
    source_name: 'Agent UG',
    source_page_url: 'https://x.com/agent',
    raw_source_post: { tweet: { author_id: 'user1' } },
  }], {
    bearerToken: 'test-token',
    fetchImpl: async (url) => {
      authorTimelineUrl = String(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: '1890000000000000003', author_id: 'user1', text: '#Kalagi house for rent', created_at: '2026-08-04T00:00:00.000Z' }],
          includes: { users: [{ id: 'user1', username: 'agent', name: 'Agent UG' }] },
        }),
      };
    },
  });
  assert(authorTimelineUrl.includes('/2/users/user1/tweets'));
  assert.strictEqual(authorExpansion.posts.length, 1);
  assert.deepStrictEqual(authorExpansion.hashtag_terms, ['kalagi']);

  const nearDuplicatePreview = await queueFoundOnlineSourcePostListings({
    dryRun: true,
    posts: [
      {
        post_url: 'https://x.com/agent/status/1890000000000000001',
        caption: 'Three bedroom house for rent in Kalagi Mukono at USD 800 per month call via this profile',
        source_name: 'Agent UG',
        source_page_url: 'https://x.com/agent',
        first_posted_at: '2026-08-02T00:00:00.000Z',
      },
      {
        post_url: 'https://x.com/agent/status/1890000000000000002',
        caption: 'Three bedroom house for rent in Kalagi Mukono at USD 900 per month call via this profile now',
        source_name: 'Agent UG',
        source_page_url: 'https://x.com/agent',
        first_posted_at: '2026-08-03T00:00:00.000Z',
      },
    ],
  });
  assert.strictEqual(nearDuplicatePreview.would_create_properties, 1);
  assert.strictEqual(nearDuplicatePreview.existing_properties, 1);
  assert.strictEqual(nearDuplicatePreview.per_url_results[1].outcome, 'duplicate');
  assert.strictEqual(nearDuplicatePreview.per_url_results[1].reason, 'caption_simhash_near_duplicate');

  const staffRoute = require('../routes/staff');
  const usdPatch = staffRoute._test.normalizeStaffListingPatch({ price_currency: 'UGX' }, {
    price_currency: 'USD',
    price_original: 1200,
    price_fx_rate_ugx: 3800,
  });
  assert.deepStrictEqual(usdPatch.errors, []);
  assert.strictEqual(usdPatch.patch.price, 4560000);
  assert.strictEqual(usdPatch.patch.price_currency, 'USD');

  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'db/migrations/112_always_on_property_harvest.sql'), 'utf8');
  assert(html.includes('always-on-harvest-review-only-20260809'));
  assert(html.includes('Paste listing link'));
  assert(html.includes('Source Fishing / Harvest coverage'));
  const frontend = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');
  assert(frontend.includes('/api/admin/harvest/summary?days=14'));
  assert(frontend.includes('/api/staff/harvest/creators/next'));
  assert(frontend.includes('/api/staff/source-intake/discover-helper'));
  assert(migration.includes('property_harvest_events'));
  assert(migration.includes('property_harvest_cursors'));
  assert(migration.includes('idx_properties_harvest_composite_listing_key'));
  assert(migration.includes('idx_properties_harvest_primary_image_phash'));
  assert(fs.readFileSync(path.join(root, 'scripts/backfill-youtube-harvest.js'), 'utf8').includes('useSavedCursors: false'));
  const backfillWindows = buildDateWindows('2026-06-01T00:00:00.000Z', '2026-06-16T00:00:00.000Z', 7);
  assert.strictEqual(backfillWindows.length, 3);
  assert.strictEqual(backfillWindows[0].published_before, '2026-06-08T00:00:00.000Z');

  console.log('Always-on harvest engine tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
