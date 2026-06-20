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

test('TikTok autopublish hard gate blocks missing exact URL, date, phone, location, text, and duplicates', () => {
  const cases = [
    [goodRow({ extra_fields: { ...goodRow().extra_fields, source_post_url: 'https://www.tiktok.com/tag/ugandarealestate' } }), 'missing_exact_tiktok_video_url'],
    [goodRow({ extra_fields: { ...goodRow().extra_fields, source_post_date_status: 'needs_source_platform_date_confirmation', first_posted_online_at: '' } }), 'missing_confirmed_2026_source_date'],
    [goodRow({ lister_phone: '', extra_fields: { ...goodRow().extra_fields, contact_phone: '' } }), 'missing_source_phone_number'],
    [goodRow({ area: 'Kampala', district: 'Kampala', address: '' }), 'missing_specific_area_and_district'],
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

test('TikTok autopublish route and script are protected production surfaces', () => {
  assert(adminRoute.includes("router.post('/tiktok-autopublish-agent/run'"), 'admin route should exist');
  assert(adminRoute.includes('requireAdminApiKey'), 'admin router should remain API-key protected');
  assert(adminRoute.includes('confirm_live'), 'route should expose explicit confirm_live control');
  assert(adminRoute.includes('admin_tiktok_autopublish_agent_run'), 'route should write an audit trail');
  assert.strictEqual(pkg.scripts['inventory:tiktok-autopublish'], 'node scripts/run-tiktok-autopublish-agent.js');
});

test('TikTok autopublish service enforces review cap and no accidental live writes', async () => {
  assert(serviceSource.includes('Math.max(0, maxReview - reviewQueueBefore)'), 'review queue cap should be computed before imports');
  assert(serviceSource.includes('posts.slice(0, reviewSlotsAvailable)'), 'post imports should be limited by remaining review slots');
  assert(serviceSource.includes('urls.slice(0, reviewSlotsAvailable)'), 'URL imports should be limited by remaining review slots');
  const result = await runTikTokAutopublishAgent({
    db: { pool: { connect: async () => { throw new Error('should not connect without confirm_live'); } } },
    dryRun: false,
    confirmLive: false,
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'confirm_live_required');
});

test('TikTok hashtag normalization is stable for one-hashtag runs', () => {
  assert.strictEqual(normalizeHashtag('#UgandaRealEstate'), 'ugandarealestate');
  assert.strictEqual(normalizeHashtag('Land For Sale Uganda!'), 'landforsaleuganda');
});

Promise.all(pending).catch(() => {
  process.exitCode = 1;
});
