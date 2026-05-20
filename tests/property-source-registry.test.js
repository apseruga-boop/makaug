'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const service = read('services/propertySourceRegistryService.js');
const migration = read('db/migrations/042_property_source_registry.sql');
const script = read('scripts/seed-property-source-registry.js');
const dailySweepScript = read('scripts/run-daily-found-online-source-sweep.js');
const adminRoute = read('routes/admin.js');
const frontend = read('assets/makaug-app.js');
const html = read('index.html');
const whatsappRoute = read('routes/whatsapp.js');
const pkg = JSON.parse(read('package.json'));
const {
  PROPERTY_SOURCE_REGISTRY,
  PROPERTY_SOURCE_REGISTRY_TARGET_COUNT,
  sourceRecordKind,
  summarizePropertySourceRegistry,
} = require('../services/propertySourceRegistryService');
const {
  SOCIAL_SEARCH_LISTINGS,
  SOCIAL_SEARCH_AGENTS,
} = require('../services/socialSearchSourcedListingsService');

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test('source registry service defines a multi-platform Uganda property source database', () => {
  const summary = summarizePropertySourceRegistry();
  assert.strictEqual(summary.target_count, 20000, 'source database should have a 20,000-record operating target after adding X hashtag search');
  assert(summary.count >= 19900 && summary.count <= 20000, 'expanded database should sit at the 20,000 source-discovery ceiling');
  assert(summary.by_platform.x >= 5000, 'source database should include at least 5,000 X/Twitter hashtag discovery records');
  assert(summary.by_platform.tiktok >= 3000, 'source database should include at least 3,000 TikTok discovery records');
  assert(summary.by_platform.instagram >= 3000, 'source database should include at least 3,000 Instagram discovery records');
  assert(summary.by_platform.facebook >= 3000, 'source database should include at least 3,000 Facebook discovery records');
  assert(summary.by_platform.youtube >= 3000, 'source database should include at least 3,000 YouTube creator/search sources');
  assert(summary.by_platform.website >= 10, 'source database should keep website/portal sources');
  assert.strictEqual(PROPERTY_SOURCE_REGISTRY.length, PROPERTY_SOURCE_REGISTRY_TARGET_COUNT, 'source registry should load exactly the configured 15,000 records');
  assert(summary.reviewed_source_pages_count >= 10, 'source registry should separately count reviewed pages/channels/accounts');
  assert(summary.discovery_feed_count >= 10000, 'source registry should separately count broad discovery feeds');
  ['carnelian-properties-uganda', 'bakaima-real-estate-agents', 'realtor-mahad', 'ezra-homes-ug', 'opulent-properties-uganda', 'real-estate-database-uganda', 'tiktok-uganda-real-estate-hashtag', 'x-uganda-real-estate-hashtag'].forEach((key) => {
    assert(PROPERTY_SOURCE_REGISTRY.some((item) => item.key === key), `missing source key ${key}`);
  });
  assert(summary.direct_contact_sources >= 2, 'authorised/direct-contact sources should be explicit');
  assert(summary.hashtags.includes('UgandaRealEstate'), 'source watchlist should include core hashtags');
  assert(summary.hashtags.includes('RealEstateUganda'), 'source watchlist should include X-style real-estate hashtag variants');
  assert(service.includes('freshness_window_days: 90'), 'source records should carry a 90-day freshness window');
  assert(service.includes('PROPERTY_SOURCE_REGISTRY_TARGET_COUNT = 20000'), 'source registry should enforce the 20,000 ceiling');
  assert(service.includes('X_HASHTAG_DISCOVERY_TARGET_COUNT = 5000'), 'source registry should reserve a 5,000-record X hashtag sweep');
  assert(service.includes('PROPERTY_HASHTAG_WATCHLIST'), 'source registry should maintain a cross-platform property hashtag watchlist');
  assert(!PROPERTY_SOURCE_REGISTRY.some((item) => /(?:youtube\.com\/watch|youtu\.be\/|\/shorts\/|tiktok\.com\/@[^/]+\/video|instagram\.com\/(?:p|reel)\/|facebook\.com\/watch|facebook\.com\/.+\/(?:posts|videos)\/)/i.test(item.url || '')), 'source registry must not store individual post/video links as source records');
  assert(PROPERTY_SOURCE_REGISTRY.some((item) => sourceRecordKind(item) === 'source_page'), 'source registry should contain real page/channel/account records');
  assert(PROPERTY_SOURCE_REGISTRY.some((item) => sourceRecordKind(item) === 'discovery_feed'), 'source registry should contain discovery feeds that find new pages/posts');
  assert(PROPERTY_SOURCE_REGISTRY.some((item) => item.platform === 'x' && item.sourceType === 'hashtag_search_feed' && /x\.com\/search/i.test(item.url || '')), 'source registry should include X hashtag search feeds');
  assert(PROPERTY_SOURCE_REGISTRY.some((item) => item.platform === 'instagram' && item.sourceType === 'hashtag_search_feed' && /instagram\.com\/explore\/tags/i.test(item.url || '')), 'source registry should include Instagram hashtag search feeds');
  assert(PROPERTY_SOURCE_REGISTRY.some((item) => item.platform === 'facebook' && item.sourceType === 'hashtag_search_feed' && /facebook\.com\/hashtag/i.test(item.url || '')), 'source registry should include Facebook hashtag search feeds');
});

test('source registry has production table, indexes, and safe upsert logic', () => {
  assert(migration.includes('CREATE TABLE IF NOT EXISTS property_source_registry'), 'registry table migration missing');
  assert(migration.includes('source_key TEXT NOT NULL UNIQUE'), 'source key must be unique');
  assert(migration.includes('first_seen_at TIMESTAMPTZ'), 'first-seen timestamp should be stored');
  assert(migration.includes('scrape_policy TEXT NOT NULL'), 'scrape policy should be explicit');
  assert(migration.includes('USING GIN (hashtags)'), 'hashtag index should support discovery searches');
  assert(service.includes('ON CONFLICT (source_key) DO UPDATE'), 'seed should upsert without duplicating sources');
  assert(service.includes('pruned_stale_sources'), 'seed should report stale source records pruned back to the configured ceiling');
  assert(service.includes("metadata->>'launch_batch'"), 'seed should prune only generated records from the current launch batch');
  assert(service.includes('manual_review_only'), 'registry should default to manual review');
  assert(script.includes('Refusing to write without --confirm'), 'write script should require explicit confirmation');
});

test('King dashboard exposes source database create and review controls', () => {
  assert(adminRoute.includes("router.post('/property-source-registry/seed'"), 'admin seed endpoint missing');
  assert(adminRoute.includes("router.get('/property-source-registry'"), 'admin list endpoint missing');
  assert(adminRoute.includes('admin_property_source_registry_seeded'), 'source registry seed must be audited');
  assert(html.includes('admin-seed-source-registry-btn'), 'King review queue should include source database create button');
  assert(html.includes('admin-source-registry-panel'), 'King review queue should include source database panel');
  assert(frontend.includes('async function adminSeedPropertySourceRegistry'), 'frontend should seed source database');
  assert(frontend.includes('async function adminLoadPropertySourceRegistry'), 'frontend should load source database');
  assert(frontend.includes('/api/admin/property-source-registry/seed'), 'frontend should call protected seed API');
  assert(frontend.includes('/api/admin/property-source-registry?limit=20000'), 'frontend should call protected list API with the 20,000 source-registry ceiling');
  assert(service.includes('Math.min(Number(limit) || 250, PROPERTY_SOURCE_REGISTRY_TARGET_COUNT)'), 'source registry list API should allow the full expanded registry');
  assert(frontend.includes('fishing net, not the approval queue'), 'King should explain source records are not listing records');
  assert(frontend.includes('reviewed pages/channels/accounts'), 'King should separate reviewed source pages from broad feeds');
  assert(frontend.includes('Queue Found-Online Properties'), 'King should label candidate creation separately from source database creation');
  assert.strictEqual(pkg.scripts['inventory:seed-source-registry'], 'node scripts/seed-property-source-registry.js');
});

test('daily source sweep is scriptable and keeps King queue guardrails', () => {
  assert.strictEqual(pkg.scripts['inventory:daily-source-sweep'], 'node scripts/run-daily-found-online-source-sweep.js');
  assert(dailySweepScript.includes('source_window_days: 90'), 'daily sweep should enforce the three-month source window');
  assert(dailySweepScript.includes('King dashboard pending review'), 'daily sweep should queue into King review');
  assert(dailySweepScript.includes('seedPropertySourceRegistry'), 'daily sweep should refresh the 15k source registry');
  assert(dailySweepScript.includes('seedSocialSearchAuthorisedListings'), 'daily sweep should queue eligible found-online listings');
  assert(dailySweepScript.includes('Refusing to write without --confirm'), 'daily sweep should require explicit write confirmation');
});

test('public pages explain the search-engine model and expose found-online source metadata', () => {
  assert(html.includes('Search Uganda property like a search engine'), 'homepage hero should explain search-engine positioning');
  assert(html.includes('about.searchEngineTitle'), 'about page should include search-engine section');
  assert(frontend.includes('How makaug finds property information'), 'about i18n should include source model copy');
  assert(frontend.includes('listingOnlineSourceDisclosureHtml'), 'property detail should render source disclosure');
  assert(frontend.includes('First seen by makaug'), 'source disclosure should show first-seen metadata');
  assert(frontend.includes('Open source'), 'source disclosure should link to source evidence');
});

test('social search candidate records carry source registry and first-seen fields', () => {
  assert(SOCIAL_SEARCH_AGENTS.length >= 7, 'social search agents should be loaded');
  assert(SOCIAL_SEARCH_LISTINGS.length >= 18, 'social search listings should be loaded');
  assert(service.includes('realtor-mahad'), 'registry should include Realtor Mahad');
  assert(read('services/socialSearchSourcedListingsService.js').includes('source_registry_key'), 'social search listings should reference source registry keys');
  assert(read('services/socialSearchSourcedListingsService.js').includes('first_seen_online_at'), 'social search listings should store first-seen online timestamp');
  assert(read('services/socialSearchSourcedListingsService.js').includes('source_platform'), 'social search listings should store source platform');
});

test('WhatsApp search results disclose found-online source without losing makaug links', () => {
  assert(whatsappRoute.includes('formatFoundOnlineSourceLine'), 'WhatsApp formatter should include found-online source line');
  assert(whatsappRoute.includes('first_seen_online_at'), 'WhatsApp source line should read first-seen metadata');
  assert(whatsappRoute.includes('source_name'), 'WhatsApp source line should read source name');
  assert(whatsappRoute.includes('Every result opens on makaug'), 'WhatsApp results should still drive to makaug listing pages');
});
