'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const adminRoute = read('routes/admin.js');
const pkg = JSON.parse(read('package.json'));
const serviceSource = read('services/tiktokAutopublishAgentService.js');
const {
  buildTikTokExactPostImportRows,
} = require('../services/socialPlatformPostDiscoveryService');

const {
  AGENT_NAME,
  agentProfile,
  buildAgentBuckets,
  buildHashtagWorkflow,
  hardGateTikTokRow,
  normalizeHashtag,
  runTikTokAutopublishAgent,
} = require('../services/tiktokAutopublishAgentService');

const pending = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      pending.push(result
        .then(() => console.log(`ok - ${name}`))
        .catch((error) => {
          console.error(`not ok - ${name}`);
          throw error;
        }));
      return undefined;
    }
    console.log(`ok - ${name}`);
    return result;
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function goodRow(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'House for rent in Nansana',
    description: 'TikTok caption says two bedroom house for rent in Nansana, Wakiso. Call +256760112587.',
    listing_type: 'rent',
    property_type: 'house',
    area: 'Nansana',
    district: 'Wakiso',
    address: 'Nansana, Wakiso',
    bedrooms: 2,
    lister_name: 'TikTok Source',
    lister_phone: '+256760112587',
    status: 'pending',
    moderation_stage: 'submitted',
    duplicate_count: 0,
    extra_fields: {
      source_platform: 'TikTok',
      source_post_url: 'https://www.tiktok.com/@agentug/video/7350000000000000000',
      source_post_date_status: 'confirmed_2026_plus_source_window',
      first_posted_online_at: '2026-04-10T09:00:00.000Z',
      source_text: 'Two bedroom house for rent in Nansana Wakiso. WhatsApp +256760112587. Posted in 2026.',
      source_visual_text: 'Nansana Wakiso rent',
      source_price_label: 'USh 800,000/month',
    },
    ...overrides,
  };
}

test('TikTok autopublish hard gate accepts only exact 2026 phone-location property posts', () => {
  const decision = hardGateTikTokRow(goodRow());
  assert.strictEqual(decision.eligible, true);
  assert.strictEqual(decision.reasons.length, 0);
  assert(decision.title.includes('Nansana, Wakiso'), 'rewritten title should include specific location');
  assert(decision.title.includes('TikTok 2026'), 'rewritten title should include 2026 source signal');
  assert(decision.description.includes('Source date: 2026-04-10'), 'rewritten description should include source date');
});

test('Maka Scout identity is exposed for staff chat and visual surfaces', () => {
  const profile = agentProfile();
  assert.strictEqual(AGENT_NAME, 'Maka Scout');
  assert.strictEqual(profile.name, 'Maka Scout');
  assert.strictEqual(profile.display_name, 'Maka Scout AI');
  assert.strictEqual(profile.initials, 'MS');
  assert.strictEqual(profile.chat_route, '/staff-dashboard');
  assert(profile.avatar_prompt.includes('Uganda property scout AI'), 'visual prompt should describe the agent representation');
  assert(profile.status_label.includes('one TikTok hashtag at a time'), 'profile should explain the hashtag workflow');
});

test('TikTok autopublish can use exact video ID timestamp when stored source date is missing', () => {
  const row = goodRow({
    extra_fields: {
      ...goodRow().extra_fields,
      source_post_url: 'https://www.tiktok.com/@rawlings2025/video/7651202396844084501',
      source_post_date_status: '',
      first_posted_online_at: 'Original post date is being confirmed from the source platform.',
      source_published_at: '',
    },
  });
  const decision = hardGateTikTokRow(row);
  assert.strictEqual(decision.eligible, true);
  assert.strictEqual(decision.source_date, '2026-06-14T10:52:58.000Z');
});

test('Maka Scout relaxed mode can publish exact TikTok posts with phone, location, duplicate safety, and Price upon application', () => {
  const row = goodRow({
    listing_type: '',
    price: null,
    price_period: 'once',
    description: '',
    extra_fields: {
      ...goodRow().extra_fields,
      source_post_date_status: 'needs_source_platform_date_confirmation',
      first_posted_online_at: '',
      source_published_at: '',
      source_text: '',
      source_visual_text: '',
      source_price_label: '',
      price_label: '',
    },
  });
  const strict = hardGateTikTokRow(row);
  assert.strictEqual(strict.eligible, false, 'strict mode should still reject missing date/type/text evidence');

  const relaxed = hardGateTikTokRow(row, { policyMode: 'relaxed' });
  assert.strictEqual(relaxed.eligible, true);
  assert.strictEqual(relaxed.policy_mode, 'phone_location_price_optional');
  assert.strictEqual(relaxed.price_label, 'Price upon application');
  assert.strictEqual(relaxed.price_status, 'price_upon_application');
  assert(relaxed.title.includes('TikTok source'), 'unclear type should not be forced into a sale/rent title');
});

test('TikTok autopublish hard gate blocks missing exact URL, date, phone, location, text, and duplicates', () => {
  const cases = [
    [goodRow({ extra_fields: { ...goodRow().extra_fields, source_post_url: 'https://www.tiktok.com/tag/ugandarealestate' } }), 'missing_exact_tiktok_video_url'],
    [goodRow({ extra_fields: { ...goodRow().extra_fields, source_post_date_status: 'needs_source_platform_date_confirmation', first_posted_online_at: '' } }), 'missing_confirmed_2026_source_date'],
    [goodRow({ lister_phone: '', extra_fields: { ...goodRow().extra_fields, contact_phone: '' } }), 'missing_source_phone_number'],
    [goodRow({ area: 'Kampala', district: 'Kampala', address: '' }), 'missing_specific_area_and_district'],
    [goodRow({ area: 'Kampala', district: 'Kampala', address: 'Kampala' }), 'missing_specific_area_and_district'],
    [goodRow({ listing_type: '' }), 'unclear_listing_type'],
    [goodRow({ description: '', extra_fields: { ...goodRow().extra_fields, source_text: '', source_visual_text: '' } }), 'missing_caption_transcript_or_visual_text'],
    [goodRow({ duplicate_count: 1 }), 'duplicate_source_or_contact_location_match'],
  ];
  cases.forEach(([row, reason]) => {
    const decision = hardGateTikTokRow(row);
    assert.strictEqual(decision.eligible, false, `${reason} should block live publish`);
    assert(decision.reasons.includes(reason), `${reason} should be reported`);
  });
});

test('Maka Scout relaxed mode still blocks missing exact source, phone, location, and duplicates', () => {
  const cases = [
    [goodRow({ extra_fields: { ...goodRow().extra_fields, source_post_url: 'https://www.tiktok.com/tag/ugandarealestate' } }), 'missing_exact_tiktok_video_url'],
    [goodRow({ lister_phone: '', extra_fields: { ...goodRow().extra_fields, contact_phone: '' } }), 'missing_source_phone_number'],
    [goodRow({ area: 'Kampala', district: 'Kampala', address: 'Kampala' }), 'missing_specific_area_and_district'],
    [goodRow({ duplicate_count: 1 }), 'duplicate_source_or_contact_location_match'],
  ];
  cases.forEach(([row, reason]) => {
    const decision = hardGateTikTokRow(row, { policyMode: 'relaxed' });
    assert.strictEqual(decision.eligible, false, `${reason} should block relaxed live publish`);
    assert(decision.reasons.includes(reason), `${reason} should be reported`);
  });
});

test('TikTok exact post parser preserves local-language listing and price evidence', () => {
  const rows = buildTikTokExactPostImportRows({
    posts: [{
      post_url: 'https://www.tiktok.com/@lugandaproperty/video/7651202396844084501',
      caption: 'Ettaka e Wakiso 12 obukadde negotiable. Call 0760112587',
    }],
  });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].listing_type, 'land');
  assert.strictEqual(rows[0].price_text, '12 obukadde negotiable');
  assert.strictEqual(rows[0].contact_phone, '+256760112587');

  const rentalRows = buildTikTokExactPostImportRows({
    posts: [{
      post_url: 'https://www.tiktok.com/@lugandarentals/video/7651202396844084502',
      caption: 'Muzigo gwa renti e Nansana bei 250 emitwalo za mwezi. 0700112233',
    }],
  });
  assert.strictEqual(rentalRows[0].listing_type, 'rent');
  assert.strictEqual(rentalRows[0].price_text, 'bei 250 emitwalo za mwezi');
});

test('Maka Scout returns explicit live, review, duplicate, and excluded buckets', () => {
  const buckets = buildAgentBuckets({
    published: [{ id: 'live-1', title: 'Live property' }],
    readyReview: [{ id: 'review-1', reasons: ['missing_source_phone_number'] }],
    blocked: [{ id: 'blocked-1', reasons: ['review_queue_cap_reached'] }],
    importResult: {
      already_present_properties: [{ id: 'existing-1', reason: 'already_queued' }],
      source_review_records: [{ title: 'Old TikTok post', source_url: 'https://www.tiktok.com/@old/video/1', reason: 'missing_2026_launch_intake_evidence' }],
    },
  });
  assert.strictEqual(buckets.live.count, 1);
  assert.strictEqual(buckets.review.count, 1);
  assert.strictEqual(buckets.existing_or_duplicate.count, 1);
  assert.strictEqual(buckets.excluded.count, 2);
  assert(buckets.review.meaning.includes('human review queue'), 'review bucket should explain action');
  assert(buckets.excluded.meaning.includes('not allowed live'), 'excluded bucket should explain action');
});

test('Maka Scout plans one hashtag at a time and pauses at the review cap', () => {
  const workflow = buildHashtagWorkflow({
    hashtag: '#UgandaRealEstate',
    hashtagSequence: ['UgandaRealEstate', 'HousesForSaleUganda', 'KampalaRentals'],
    reviewQueueAfter: 12,
    reviewLimit: 100,
    reviewSlotsAvailable: 88,
  });
  assert.strictEqual(workflow.agent, 'Maka Scout');
  assert.strictEqual(workflow.mode, 'one_hashtag_at_a_time');
  assert.strictEqual(workflow.current_hashtag, '#ugandarealestate');
  assert.strictEqual(workflow.next_hashtag, '#housesforsaleuganda');
  assert.strictEqual(workflow.status, 'ready_for_next_hashtag');
  assert.strictEqual(workflow.review_queue_remaining_slots, 88);

  const paused = buildHashtagWorkflow({
    hashtag: '#KampalaRentals',
    hashtagSequence: ['UgandaRealEstate', 'HousesForSaleUganda', 'KampalaRentals'],
    reviewQueueAfter: 100,
    reviewLimit: 100,
  });
  assert.strictEqual(paused.status, 'paused_review_queue_cap_reached');
  assert.strictEqual(paused.next_hashtag, '');
});

test('TikTok autopublish route and script are protected production surfaces', () => {
  assert(adminRoute.includes("router.post('/tiktok-autopublish-agent/run'"), 'admin route should exist');
  assert(adminRoute.includes('requireAdminApiKey'), 'admin router should remain API-key protected');
  assert(adminRoute.includes('confirm_live'), 'route should expose explicit confirm_live control');
  assert(adminRoute.includes('hashtag_sequence'), 'route should accept explicit hashtag sequence control');
  assert(adminRoute.includes('policy_mode'), 'route should accept explicit relaxed policy control');
  assert(adminRoute.includes('admin_tiktok_autopublish_agent_run'), 'route should write an audit trail');
  assert.strictEqual(pkg.scripts['inventory:tiktok-autopublish'], 'node scripts/run-tiktok-autopublish-agent.js');
  assert(read('scripts/run-tiktok-autopublish-agent.js').includes('--hashtag-sequence'), 'CLI should support explicit hashtag sequence control');
  assert(read('scripts/run-tiktok-autopublish-agent.js').includes('--policy-mode'), 'CLI should support explicit policy mode control');
});

test('TikTok autopublish service enforces review cap and no accidental live writes', async () => {
  assert(serviceSource.includes('Math.max(0, maxReview - reviewQueueBefore)'), 'review queue cap should be computed before imports');
  assert(serviceSource.includes('.slice(0, reviewSlotsAvailable)'), 'exact TikTok imports should be limited by remaining review slots');
  assert(serviceSource.includes('exactUrlPostsWithInferredDates'), 'URL imports should infer TikTok video dates before queueing');
  assert(serviceSource.includes('buildAgentBuckets'), 'agent output should separate live/review/duplicate/excluded buckets');
  assert(serviceSource.includes('buildHashtagWorkflow'), 'agent output should include one-hashtag workflow state');
  assert(serviceSource.includes('phone_location_price_optional'), 'agent should expose explicit relaxed phone/location/price-optional mode');
  assert(serviceSource.includes('Price upon application'), 'agent should use Price upon application when source price is missing');
  const result = await runTikTokAutopublishAgent({
    db: { pool: { connect: async () => { throw new Error('should not connect without confirm_live'); } } },
    dryRun: false,
    confirmLive: false,
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'confirm_live_required');
  assert.strictEqual(result.agent.name, 'Maka Scout');
});

test('TikTok hashtag normalization is stable for one-hashtag runs', () => {
  assert.strictEqual(normalizeHashtag('#UgandaRealEstate'), 'ugandarealestate');
  assert.strictEqual(normalizeHashtag('Land For Sale Uganda!'), 'landforsaleuganda');
});

Promise.all(pending).catch(() => {
  process.exitCode = 1;
});
