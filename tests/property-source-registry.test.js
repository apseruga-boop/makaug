'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const service = read('services/propertySourceRegistryService.js');
const migration = read('db/migrations/042_property_source_registry.sql');
const tiktokDeepSweepMigration = read('db/migrations/046_tiktok_deep_sweep_source_profiles.sql');
const tiktokVideoIndexMigration = read('db/migrations/047_tiktok_realtor_mahad_video_index.sql');
const tiktokFacebookDoubleDownMigration = read('db/migrations/048_tiktok_facebook_double_down_profiles.sql');
const socialFirstXPriorityMigration = read('db/migrations/049_social_first_x_priority_profiles.sql');
const script = read('scripts/seed-property-source-registry.js');
const dailySweepScript = read('scripts/run-daily-found-online-source-sweep.js');
const adminRoute = read('routes/admin.js');
const frontend = read('assets/makaug-app.js');
const html = read('index.html');
const whatsappRoute = read('routes/whatsapp.js');
const agentsRoute = read('routes/agents.js');
const healthRoute = read('routes/health.js');
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
  assert.strictEqual(summary.target_count, 30000, 'source database should have a 30,000-record operating target after adding cross-platform hashtag fishing');
  assert(summary.count >= 29900 && summary.count <= 30000, 'expanded database should sit at the 30,000 source-discovery ceiling');
  assert(summary.by_platform.x >= 8000, 'source database should include at least 8,000 X/Twitter hashtag discovery records');
  assert(summary.by_platform.tiktok >= 5000, 'source database should include at least 5,000 TikTok discovery records');
  assert(summary.by_platform.instagram >= 5000, 'source database should include at least 5,000 Instagram discovery records');
  assert(summary.by_platform.facebook >= 5000, 'source database should include at least 5,000 Facebook discovery records');
  assert(summary.by_platform.youtube >= 5000, 'source database should include at least 5,000 YouTube creator/search sources');
  assert(!summary.by_platform.website, 'website-only source records should stay out of the social-first registry');
  assert.strictEqual(PROPERTY_SOURCE_REGISTRY.length, PROPERTY_SOURCE_REGISTRY_TARGET_COUNT, 'source registry should load exactly the configured 30,000 records');
  assert(summary.reviewed_source_pages_count >= 10, 'source registry should separately count reviewed pages/channels/accounts');
  assert(summary.discovery_feed_count >= 10000, 'source registry should separately count broad discovery feeds');
  ['carnelian-properties-uganda', 'realtor-mahad', 'ezra-homes-ug', 'tiktok-uganda-real-estate-hashtag', 'x-uganda-real-estate-hashtag'].forEach((key) => {
    assert(PROPERTY_SOURCE_REGISTRY.some((item) => item.key === key), `missing source key ${key}`);
  });
  assert(summary.direct_contact_sources >= 2, 'authorised/direct-contact sources should be explicit');
  assert(summary.hashtags.includes('UgandaRealEstate'), 'source watchlist should include core hashtags');
  assert(summary.hashtags.includes('RealEstateUganda'), 'source watchlist should include X-style real-estate hashtag variants');
  assert(service.includes('SOURCE_FRESHNESS_WINDOW_DAYS = 366'), 'source records should keep 2026 launch-window freshness metadata for prioritisation');
  assert(service.includes('first published from 1 January 2026 through today'), 'source records should scan from the 2026 found-online window start');
  assert(service.includes('target_source_year: TARGET_SOURCE_YEAR'), 'source records should flag 2026 as the active target source year');
  assert(service.includes('SOCIAL_FIRST_PLATFORM_PRIORITY'), 'source registry should encode social-first platform priority');
  assert(service.includes('SOCIAL_PROFILE_CREATION_RULE'), 'source registry should encode the no-auto-profile source attribution policy');
  assert(service.includes('SOCIAL_ONE_OFF_LISTING_RULE'), 'source registry should keep social posts listing-only until the source owner registers or claims a profile');
  assert(service.includes('Do not automatically create or update a public Makaug source/broker profile'), 'source registry should not create broker profiles from social discovery alone');
  assert(service.includes('Website/portal sources are disabled'), 'source registry should disable website-only sources for launch inventory');
  assert(service.includes('PROPERTY_SOURCE_REGISTRY_TARGET_COUNT = 30000'), 'source registry should enforce the 30,000 ceiling');
  assert(service.includes('X_HASHTAG_DISCOVERY_TARGET_COUNT = 8000'), 'source registry should reserve an 8,000-record X hashtag sweep');
  assert(service.includes('CROSS_PLATFORM_HASHTAG_DISCOVERY_TARGET_COUNT = 12000'), 'source registry should reserve a 12,000-record Instagram/Facebook/TikTok/YouTube hashtag sweep');
  assert(service.includes('PROPERTY_HASHTAG_WATCHLIST'), 'source registry should maintain a cross-platform property hashtag watchlist');
  assert(service.includes('function getPropertySourceRegistry()'), 'source registry should lazy-load generated sources instead of building them during server startup');
  assert(service.includes("Object.defineProperty(exported, 'PROPERTY_SOURCE_REGISTRY'"), 'legacy registry export should stay available through a lazy getter');
  assert(!service.includes('const PROPERTY_SOURCE_REGISTRY = ['), 'source registry must not eagerly allocate the expanded 30,000-record registry at module import');
  assert(!PROPERTY_SOURCE_REGISTRY.some((item) => /(?:youtube\.com\/watch|youtu\.be\/|\/shorts\/|tiktok\.com\/@[^/]+\/video|instagram\.com\/(?:p|reel)\/|facebook\.com\/watch|facebook\.com\/.+\/(?:posts|videos)\/)/i.test(item.url || '')), 'source registry must not store individual post/video links as source records');
  assert(PROPERTY_SOURCE_REGISTRY.some((item) => sourceRecordKind(item) === 'source_page'), 'source registry should contain real page/channel/account records');
  assert(PROPERTY_SOURCE_REGISTRY.some((item) => sourceRecordKind(item) === 'discovery_feed'), 'source registry should contain discovery feeds that find new pages/posts');
  assert(PROPERTY_SOURCE_REGISTRY.some((item) => item.platform === 'x' && item.sourceType === 'hashtag_search_feed' && /x\.com\/search/i.test(item.url || '')), 'source registry should include X hashtag search feeds');
  assert(PROPERTY_SOURCE_REGISTRY.some((item) => item.platform === 'instagram' && item.sourceType === 'hashtag_search_feed' && /instagram\.com\/explore\/tags/i.test(item.url || '')), 'source registry should include Instagram hashtag search feeds');
  assert(PROPERTY_SOURCE_REGISTRY.some((item) => item.platform === 'facebook' && item.sourceType === 'hashtag_search_feed' && /facebook\.com\/hashtag/i.test(item.url || '')), 'source registry should include Facebook hashtag search feeds');
  assert(PROPERTY_SOURCE_REGISTRY.some((item) => item.platform === 'tiktok' && item.sourceType === 'hashtag_search_feed' && /tiktok\.com\/tag/i.test(item.url || '')), 'source registry should include TikTok hashtag/tag feeds');
  assert(PROPERTY_SOURCE_REGISTRY.some((item) => item.platform === 'youtube' && item.sourceType === 'hashtag_search_feed' && /youtube\.com\/hashtag/i.test(item.url || '')), 'source registry should include YouTube hashtag feeds');
  ['StudentHostelUganda', 'HouseForRentKampala', 'CommercialSpaceUganda', 'OfficeForRentKampala', 'LandForSaleWakiso', '50x100Uganda'].forEach((tag) => {
    assert(summary.hashtags.includes(tag) || PROPERTY_SOURCE_REGISTRY.some((item) => (item.hashtags || []).includes(tag)), `source watchlist should include ${tag}`);
  });
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
  assert(frontend.includes('/api/admin/property-source-registry?limit=500'), 'frontend should load a bounded source-registry page to avoid Render 502s');
  assert(frontend.includes('stays server-side so this panel does not time out'), 'King should explain the full source registry is not rendered in one response');
  assert(service.includes('PROPERTY_SOURCE_REGISTRY_RESPONSE_SAMPLE_LIMIT = 500'), 'seed response should sample source rows instead of returning all 30,000 records');
  assert(service.includes('Math.min(Number(limit) || 250, PROPERTY_SOURCE_REGISTRY_TARGET_COUNT)'), 'source registry list API should allow the full expanded registry');
  assert(frontend.includes('fishing net, not the approval queue'), 'King should explain source records are not listing records');
  assert(frontend.includes('reviewed pages/channels/accounts'), 'King should separate reviewed source pages from broad feeds');
  assert(frontend.includes('Queue Found-Online Properties'), 'King should label candidate creation separately from source database creation');
  assert.strictEqual(pkg.scripts['inventory:seed-source-registry'], 'node scripts/seed-property-source-registry.js');
});

test('daily source sweep is scriptable and keeps King queue guardrails', () => {
  assert.strictEqual(pkg.scripts['inventory:daily-source-sweep'], 'node scripts/run-daily-found-online-source-sweep.js');
  assert(dailySweepScript.includes('source_window_days: 366'), 'daily sweep should cover the full 2026 launch source window');
  assert(dailySweepScript.includes('source_post_window_start: LAUNCH_SOURCE_POST_WINDOW_START'), 'daily sweep should expose the 1 January 2026 found-online intake start');
  assert(dailySweepScript.includes('target_source_year: 2026'), 'daily sweep should prioritise 2026+ source posts');
  assert(dailySweepScript.includes('daily_property_queue_minimum'), 'daily sweep should expose the 200/day property queue minimum');
  assert(dailySweepScript.includes('hard_queue_rule'), 'daily sweep should report target gaps instead of padding weak records');
  assert(dailySweepScript.includes('daily_target_status'), 'daily sweep should print evidence-ready target status');
  assert(dailySweepScript.includes('King dashboard pending review'), 'daily sweep should queue into King review');
  assert(dailySweepScript.includes('seedPropertySourceRegistry'), 'daily sweep should refresh the 15k source registry');
  assert(dailySweepScript.includes('seedSocialSearchAuthorisedListings'), 'daily sweep should queue eligible found-online listings');
  assert(dailySweepScript.includes('Refusing to write without --confirm'), 'daily sweep should require explicit write confirmation');
});

test('public pages explain the search-engine model and expose found-online source metadata', () => {
  assert(html.includes('A property search engine for Uganda'), 'homepage hero should explain search-engine positioning simply');
  assert(!html.includes('broker listings, reviewed online sources, and official UgNLIS land checks in one place'), 'homepage hero should not carry the old long positioning copy');
  assert(html.includes('about.searchEngineTitle'), 'about page should include search-engine section');
  assert(frontend.includes('How makaug finds property information'), 'about i18n should include source model copy');
  assert(frontend.includes('listingOnlineSourceDisclosureHtml'), 'property detail should render source disclosure');
  assert(frontend.includes('Third-party property result'), 'found-online detail should label imported listings as third-party property results');
  assert(frontend.includes('Makaug provides a search and discovery preview only'), 'found-online detail should include search/discovery legal positioning');
  assert(frontend.includes('Makaug does not claim ownership of third-party photos, videos, captions, descriptions, trademarks, or contact details'), 'found-online detail should disclaim third-party ownership');
  assert(frontend.includes('Claim this listing'), 'found-online detail should expose claim flow');
  assert(frontend.includes('Request correction'), 'found-online detail should expose correction flow');
  assert(frontend.includes('Request removal'), 'found-online detail should expose removal flow');
  assert(frontend.includes('Report fraud or incorrect information'), 'found-online detail should expose fraud/incorrect-info reporting');
  assert(frontend.includes('openThirdPartyListingRequest'), 'claim/correction/removal/report actions should open the in-app request workflow');
  assert(frontend.includes('third_party_listing_removal'), 'removal requests should be categorized for admin review');
  assert(!frontend.includes('mailto:info@makaug.com?subject=Request%20listing%20removal'), 'removal requests should not rely on mailto links');
  assert(read('routes/contact.js').includes("router.post('/report-listing', handleReportListing)"), 'third-party listing requests should submit into the backend report queue');
  assert(read('routes/contact.js').includes('request_type: requestType'), 'backend report queue should retain claim/correction/removal/report request type metadata');
  assert(read('services/publicHtmlSanitizer.js').includes("preserve.add('report-modal')"), 'public property and report routes should keep the report modal available');
  assert(frontend.includes('foundOnlineSourceVisualHtml'), 'found-online public cards should use a source/video placeholder instead of copied social photos');
  assert(frontend.includes('thirdPartyDiscovery ? [] : imageItems'), 'remote found-online rows should not keep imported social image arrays in the public UI');
  assert(frontend.includes('Watch on the original platform before you enquire'), 'found-online detail should put the original platform video/source before the description');
  assert(frontend.includes('First picked up by makaug'), 'source disclosure should show first-picked-up metadata');
  assert(frontend.includes('First posted online'), 'source disclosure should show original source post metadata');
  assert(frontend.includes('Being confirmed from source'), 'source disclosure should show a clear fallback while the original post date is being confirmed');
  assert(frontend.includes('Added to makaug'), 'source disclosure should show when makaug added the sourced record');
  assert(frontend.includes('Audience'), 'source disclosure should show follower/subscriber metadata when available');
  assert(frontend.includes('translateFoundOnlineSourceText'), 'source disclosure should translate stored source metadata phrases before rendering');
  assert(frontend.includes('"Third-party property result": "Property ezuuliddwa okuva ku nsibuko ey'), 'source disclosure should translate the third-party block title in Luganda');
  assert(frontend.includes('"Third-party property result": "Matokeo ya mali kutoka chanzo cha nje"'), 'source disclosure should translate the third-party block title in Kiswahili');
  assert(frontend.includes('"Claim this listing": "Sabira listing eno"'), 'source disclosure should translate claim action copy');
  assert(frontend.includes('"Request correction": "Omba marekebisho"'), 'source disclosure should translate correction action copy');
  assert(frontend.includes('"Audience count to confirm from source"'), 'source disclosure should translate audience fallback metadata');
  assert(frontend.includes('Contact via source'), 'source disclosure should support social/source contact fallback when no phone is published');
  assert(frontend.includes('Open source'), 'source disclosure should link to source evidence');
  assert(read('routes/properties.js').includes('isFoundOnlinePublicRow'), 'public property API should identify third-party discovery rows');
  assert(read('routes/properties.js').includes('redactThirdPartyPublicText'), 'public property API should redact copied captions, source URLs, emails, hashtags, and phone numbers from found-online copy');
  assert(read('routes/properties.js').includes('buildThirdPartyPublicSummary'), 'public property API should publish a Makaug-written factual summary for found-online rows');
  assert(read('routes/properties.js').includes('lister_phone: foundOnlinePublic ? null'), 'public property detail API should suppress found-online lister phone fields unless the record is not third-party');
  assert(read('routes/properties.js').includes('primaryImageUrl = foundOnlinePublic ? null'), 'public property API should suppress found-online primary images');
  assert(read('routes/properties.js').includes('images: foundOnlinePublic ? [] : images'), 'public property detail API should suppress found-online gallery images');
  assert(read('services/publicHtmlSanitizer.js').includes('Third-party property results are discovery previews'), 'public terms route should explain third-party discovery positioning');
  assert(read('services/publicHtmlSanitizer.js').includes('limited publicly available property information'), 'public privacy route should explain third-party source data handling');
});

test('social search candidate records carry source registry and first-seen fields', () => {
  assert(SOCIAL_SEARCH_AGENTS.length >= 7, 'social search agents should be loaded');
  assert(SOCIAL_SEARCH_LISTINGS.length >= 18, 'social search listings should be loaded');
  assert(service.includes('realtor-mahad'), 'registry should include Realtor Mahad');
  assert(read('services/socialSearchSourcedListingsService.js').includes('source_registry_key'), 'social search listings should reference source registry keys');
  assert(read('services/socialSearchSourcedListingsService.js').includes('first_seen_online_at'), 'social search listings should store first-seen online timestamp');
  assert(read('services/socialSearchSourcedListingsService.js').includes('first_posted_online_at'), 'social search listings should store source publish timestamp when available');
  assert(read('services/socialSearchSourcedListingsService.js').includes('source_platform'), 'social search listings should store source platform');
  assert(read('services/socialSearchSourcedListingsService.js').includes('source_audience_label'), 'social search listings should store source audience/follower metadata');
  assert(read('services/socialSearchSourcedListingsService.js').includes('source_contact_method'), 'social search listings should store source contact fallback metadata');
});

test('TikTok deep sweep creates source profiles without fabricating hidden posts', () => {
  assert(tiktokDeepSweepMigration.includes('tiktok_deep_sweep_20260524'), 'TikTok deep sweep migration should carry a traceable batch id');
  assert(tiktokDeepSweepMigration.includes('tiktok-realtor-mahad-profile'), 'TikTok sweep should create the Realtor Mahad TikTok source profile');
  assert(tiktokDeepSweepMigration.includes('tiktok-carnelian-properties-uganda-profile'), 'TikTok sweep should create the Carnelian TikTok source profile');
  assert(tiktokDeepSweepMigration.includes('tiktok-deep-search-uganda-property-agent-2026'), 'TikTok sweep should add a 2026 property-agent search feed');
  assert(tiktokDeepSweepMigration.includes('authenticated_tiktok_review_or_api_export_required_for_complete_item_list'), 'TikTok sweep should record the authenticated ingestion requirement');
  assert(tiktokDeepSweepMigration.includes("WHERE platform = 'tiktok'"), 'TikTok sweep should refresh every existing TikTok source record');
  assert(!tiktokDeepSweepMigration.includes('INSERT INTO properties'), 'TikTok sweep must not fabricate property rows from feed/search pages');
  assert(agentsRoute.includes('https://www.tiktok.com/@realtor_mahad'), 'public broker profiles should expose Realtor Mahad TikTok');
  assert(healthRoute.includes('046_tiktok_deep_sweep_source_profiles.sql'), 'migration health should expose the TikTok deep sweep status');
});

test('TikTok Realtor Mahad index stores recent video evidence for authenticated extraction', () => {
  assert(tiktokVideoIndexMigration.includes('tiktok_realtor_mahad_video_index_20260524'), 'TikTok video index migration should carry a traceable batch id');
  assert(tiktokVideoIndexMigration.includes('tiktok-realtor-mahad-urlebird-video-index'), 'TikTok video index should create a source profile for the public mirror/index');
  assert(tiktokVideoIndexMigration.includes('public_2026_video_snippets'), 'TikTok video index should store reviewed 2026 video snippets');
  assert(tiktokVideoIndexMigration.includes('needs exact TikTok post URL and stills before property import'), 'TikTok video evidence should block review-queue import until exact post media is extracted');
  assert(!tiktokVideoIndexMigration.includes('INSERT INTO properties'), 'TikTok video index must not fabricate property rows from mirror snippets');
  assert(healthRoute.includes('047_tiktok_realtor_mahad_video_index.sql'), 'migration health should expose the TikTok video index status');
});

test('TikTok and Facebook double-down adds named broker profiles without fake listings', () => {
  assert(tiktokFacebookDoubleDownMigration.includes('tiktok_facebook_double_down_20260524'), 'TikTok/Facebook double-down migration should carry a traceable batch id');
  assert(tiktokFacebookDoubleDownMigration.includes('tiktok-robs-properties-travels-profile'), 'double-down sweep should add Robs Properties TikTok source profile');
  assert(tiktokFacebookDoubleDownMigration.includes('tiktok-knight-frank-uganda-profile'), 'double-down sweep should add Knight Frank Uganda TikTok source profile');
  assert(tiktokFacebookDoubleDownMigration.includes('facebook-khp-estates-page'), 'double-down sweep should add KHP Estates Facebook source profile');
  assert(tiktokFacebookDoubleDownMigration.includes('facebook-kingmaker-properties-uganda-page'), 'double-down sweep should add Kingmaker Facebook source profile');
  assert(tiktokFacebookDoubleDownMigration.includes('SOCIAL-ROBS-PROPERTIES-TRAVELS-20260524'), 'double-down sweep should create Robs Properties broker profile');
  assert(tiktokFacebookDoubleDownMigration.includes('SOCIAL-KINGMAKER-PROPERTIES-UGANDA-20260524'), 'double-down sweep should create Kingmaker broker profile');
  assert(tiktokFacebookDoubleDownMigration.includes("WHERE platform IN ('tiktok', 'facebook')"), 'double-down sweep should refresh all TikTok and Facebook registry rows');
  assert(tiktokFacebookDoubleDownMigration.includes('specific Facebook post URLs and image URLs required before property import'), 'Facebook import should require exact posts and images');
  assert(tiktokFacebookDoubleDownMigration.includes('exact TikTok post URLs, captions, posted dates, and still images'), 'TikTok import should require exact post and media evidence');
  assert(!tiktokFacebookDoubleDownMigration.includes('INSERT INTO properties'), 'double-down sweep must not fabricate review-queue properties');
  assert(agentsRoute.includes('facebook_url'), 'agent API should expose Facebook social link fields');
  assert(agentsRoute.includes('SOCIAL-KNIGHT-FRANK-UGANDA-20260524'), 'public broker profiles should expose Knight Frank social links');
  assert(agentsRoute.includes('SOCIAL-ROBS-PROPERTIES-TRAVELS-20260524'), 'public broker profiles should expose Robs Properties TikTok link');
  assert(healthRoute.includes('048_tiktok_facebook_double_down_profiles.sql'), 'migration health should expose the TikTok/Facebook double-down status');
});

test('social-first X sweep adds named Twitter sources while current policy defers public profiles', () => {
  assert(socialFirstXPriorityMigration.includes('social_first_x_priority_20260524'), 'social-first X migration should carry a traceable batch id');
  assert(socialFirstXPriorityMigration.includes('x-knight-frank-uganda-profile'), 'social-first X sweep should add Knight Frank Uganda X source profile');
  assert(socialFirstXPriorityMigration.includes('x-broll-uganda-profile'), 'social-first X sweep should add Broll Uganda X source profile');
  assert(socialFirstXPriorityMigration.includes('x-chris-property-uganda-profile'), 'social-first X sweep should add Chris Property Uganda X source profile');
  assert(socialFirstXPriorityMigration.includes('x-ecoland-property-services-profile'), 'social-first X sweep should add Ecoland Property Services X source profile');
  assert(socialFirstXPriorityMigration.includes('x-bigways-ug-profile'), 'social-first X sweep should add Bigways X source profile');
  assert(socialFirstXPriorityMigration.includes('profile_creation_status'), 'legacy social-first X sweep should track discovery-only profile status');
  assert(socialFirstXPriorityMigration.includes('blocked_until_repeated_inventory_or_cross_platform_presence'), 'legacy single-profile/single-listing sources should not create broker profiles');
  assert(service.includes('source owner registers or claims'), 'current source registry policy should defer every public broker profile until claim/registration');
  assert(socialFirstXPriorityMigration.includes('platform_priority_tier'), 'social-first X sweep should tag platform priority metadata');
  assert(socialFirstXPriorityMigration.includes('priority_social_channel'), 'social-first X sweep should mark social platforms as priority channels');
  assert(socialFirstXPriorityMigration.includes('secondary_website_or_portal'), 'social-first X sweep should mark websites as secondary confirmation sources');
  assert(socialFirstXPriorityMigration.includes('single isolated property post stays as a found-online listing without a profile'), 'social-first X sweep should enforce listing-only one-off posts');
  assert(socialFirstXPriorityMigration.includes('Queue only exact 2026+ property posts/listings with source URL'), 'social-first X sweep should require exact source evidence before import');
  assert(socialFirstXPriorityMigration.includes('Do not fabricate from account shells or search pages'), 'social-first X sweep should block fabricated review-queue rows');
  assert(socialFirstXPriorityMigration.includes('SOCIAL-BROLL-UGANDA-X-20260524'), 'legacy social-first X migration should retain Broll source-profile cleanup coverage');
  assert(socialFirstXPriorityMigration.includes('SOCIAL-CHRIS-PROPERTY-UGANDA-X-20260524'), 'legacy social-first X migration should retain Chris Property source-profile cleanup coverage');
  assert(socialFirstXPriorityMigration.includes('SOCIAL-ECOLAND-PROPERTY-SERVICES-X-20260524'), 'legacy social-first X migration should retain Ecoland source-profile cleanup coverage');
  assert(!socialFirstXPriorityMigration.includes('INSERT INTO properties'), 'social-first X sweep must not fabricate property rows from account/search shells');
  assert(agentsRoute.includes('x_url'), 'agent API should expose X/Twitter social link fields');
  assert(agentsRoute.includes('SOCIAL-BROLL-UGANDA-X-20260524'), 'public broker profiles should expose Broll X link');
  assert(agentsRoute.includes('SOCIAL-CHRIS-PROPERTY-UGANDA-X-20260524'), 'public broker profiles should expose Chris Property X link');
  assert(agentsRoute.includes('SOCIAL-ECOLAND-PROPERTY-SERVICES-X-20260524'), 'public broker profiles should expose Ecoland X link');
  assert(agentsRoute.includes('SOCIAL-BIGWAYS-UG-X-20260524'), 'public broker profiles should expose Bigways X link');
  assert(healthRoute.includes('049_social_first_x_priority_profiles.sql'), 'migration health should expose the social-first X priority status');
});

test('WhatsApp search results disclose found-online source without losing makaug links', () => {
  assert(whatsappRoute.includes('formatFoundOnlineSourceLine'), 'WhatsApp formatter should include found-online source line');
  assert(whatsappRoute.includes('first_seen_online_at'), 'WhatsApp source line should read first-seen metadata');
  assert(whatsappRoute.includes('first_posted_online_at'), 'WhatsApp source line should read first-posted metadata');
  assert(whatsappRoute.includes('post date being confirmed'), 'WhatsApp source line should not invent missing source post dates');
  assert(whatsappRoute.includes('source_name'), 'WhatsApp source line should read source name');
  assert(whatsappRoute.includes('source_followers_label'), 'WhatsApp source line should include audience metadata when present');
  assert(whatsappRoute.includes('Every result opens on makaug'), 'WhatsApp results should still drive to makaug listing pages');
});
