'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const script = read('scripts/seed-sourced-inventory-candidates.js');
const imageImportScript = read('scripts/import-found-online-images.js');
const videoStillScript = read('scripts/prepare-found-online-video-stills.js');
const frontend = read('assets/makaug-app.js');
const adminRoute = read('routes/admin.js');
const html = read('index.html');
const propertiesRoute = read('routes/properties.js');
const agentsRoute = read('routes/agents.js');
const socialSearchServiceSource = read('services/socialSearchSourcedListingsService.js');
const socialPlatformSweepServiceSource = read('services/socialPlatformPostDiscoveryService.js');
const propertySourceRegistrySource = read('services/propertySourceRegistryService.js');
const socialPlatformSweepScript = read('scripts/sweep-social-platform-posts.js');
const bakaimaPublicCopyMigration = read('db/migrations/041_remove_bakaima_public_approval_copy.sql');
const foundOnlineSecondSweepMigration = read('db/migrations/045_expand_found_online_sweep_images_and_sources.sql');
const foundOnlinePublicLaunchMigration = read('db/migrations/050_publish_found_online_launch_inventory.sql');
const socialOnlyPreapprovedCleanupMigration = read('db/migrations/051_enforce_social_only_preapproved_inventory.sql');
const strictFoundOnlinePreapprovalMigration = read('db/migrations/052_remove_implicit_found_online_approvals.sql');
const youtubeSocialRestoreMigration = read('db/migrations/054_restore_youtube_social_found_online_inventory.sql');
const youtubeSocialRepublishMigration = read('db/migrations/055_republish_curated_youtube_social_inventory.sql');
const socialSourceLocationPinMigration = read('db/migrations/056_fix_social_source_location_pins.sql');
const autoSourceProfileCleanupMigration = read('db/migrations/057_suspend_auto_source_agent_profiles.sql');
const healthRoute = read('routes/health.js');
const pkg = JSON.parse(read('package.json'));
const {
  BAKAIMA_BATCH_ID,
  BAKAIMA_CONTACT,
  BAKAIMA_SOURCE,
  plannedBakaimaListings,
  summarizeBakaimaListings,
  whatsappShareMessage,
} = require('../services/bakaimaSourcedListingsService');
const {
  CARNELIAN_BATCH_ID,
  CARNELIAN_CONTACT,
  CARNELIAN_SOURCE,
  plannedCarnelianListings,
  summarizeCarnelianListings,
  whatsappShareMessage: carnelianWhatsappShareMessage,
} = require('../services/carnelianSourcedListingsService');
const {
  SOCIAL_SEARCH_BATCH_ID,
  SOCIAL_SEARCH_AGENTS,
  SOCIAL_SEARCH_LISTINGS,
  SOCIAL_SEARCH_SOURCE,
  FOUND_ONLINE_LAUNCH_INTAKE_POLICY,
  FOUND_ONLINE_SOURCE_POST_IMPORT_BATCH_ID,
  LAUNCH_SOURCE_POST_WINDOW_START,
  PRICE_UPON_APPLICATION_LABEL,
  normalizeFoundOnlineSourcePost,
  plannedSocialSearchListings,
  queueFoundOnlineSourcePostListings,
  summarizeSocialSearchListings,
  sourcePostMeetsLaunchIntakeRule,
  sourceImageRowsFor,
  whatsappShareMessage: socialSearchWhatsappShareMessage,
} = require('../services/socialSearchSourcedListingsService');
const {
  SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
  MAX_PLATFORM_SWEEP_SOURCES,
  YOUTUBE_SOURCE_POST_WINDOW_START,
  TIKTOK_OEMBED_URL,
  YOUTUBE_OEMBED_URL,
  buildExactSocialPostImportRows,
  buildTikTokCaptureTasks,
  buildTikTokExactPostImportRows,
  buildYouTubeSearchJobs,
  buildXSearchJobs,
  extractExactSocialPostUrls,
  extractTikTokVideoUrls,
  normalizeExactSocialPostUrl,
  normalizeYouTubeApiPost,
  normalizeXApiPost,
} = require('../services/socialPlatformPostDiscoveryService');
const { buildAutomatedListingReview } = require('../services/listingModerationService');
const { getPropertySourceRegistry } = require('../services/propertySourceRegistryService');

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test('generic sourced candidate seed is retired from launch intake', () => {
  assert(!pkg.scripts['inventory:seed-sourced-candidates'], 'package scripts should not expose generic sourced-candidate creation');
  assert(script.includes('Generic sourced-candidate seeding is retired'), 'direct script runs should refuse generic sourced-candidate creation');
  assert(script.includes('process.exit(2)'), 'retired generic seed should exit before writing records');
  assert(script.includes("const DEFAULT_COUNT = 200"), 'legacy default seed size should stay searchable for cleanup history');
  assert(script.includes("const SOURCE = 'sourced_inventory_candidate_v1'"), 'source should be explicit and searchable');
  assert(script.includes("status: 'pending'"), 'legacy listings should remain identifiable during cleanup');
  assert(script.includes("verification_terms_accepted: false"), 'verification must block direct approval until reviewed');
  assert(script.includes("id_document_url: null"), 'seeded candidates must not fake ID documents');
  assert(script.includes("consent_required: true"), 'candidate metadata must flag consent requirement');
  assert(script.includes("do_not_approve_until"), 'candidate metadata must name the approval blocker');
  assert(script.includes("Refusing to write without --confirm"), 'production writes should require explicit confirmation');
  assert(script.includes("sourced_inventory_candidate_created"), 'seed should write moderation events for traceability');
  assert(!script.includes('--approve'), 'sourced candidate seed must not expose an approve shortcut');
  assert(!/status:\s*['"]approved['"]/.test(script), 'sourced candidate seed must not create approved listings');
});

test('sourced candidate seed avoids copied third-party images and source URLs', () => {
  assert(script.includes('data:image/svg+xml'), 'seed should use generated placeholder media');
  assert(script.includes('generated_placeholder_images_only'), 'image rights status should be explicit');
  assert(script.includes('Internal placeholder - import authorised photo before approval'), 'placeholder artwork must clearly say it is not an approved property photo');
  assert(script.includes('source_urls: []'), 'seed should not store scraped third-party URLs by default');
  ['images.unsplash.com', 'facebook.com', 'jiji', 'lamudi', 'ugandapropertycentre'].forEach((needle) => {
    assert(!script.toLowerCase().includes(needle), `seed must not pull copied third-party media/source: ${needle}`);
  });
});

test('found-online image import requires authorised photos and only updates intake records', () => {
  assert(imageImportScript.includes('source = ANY($1::text[])'), 'image import should match found-online/legacy intake sources only');
  assert(imageImportScript.includes('consent_confirmed'), 'image import should require consent confirmation');
  assert(imageImportScript.includes('image_rights_confirmed'), 'image import should require image rights confirmation');
  assert(imageImportScript.includes('authorised_imported'), 'image import should mark images as authorised imports');
  assert(imageImportScript.includes('found_online_authorised_images_imported'), 'image import should write moderation event history');
  assert(imageImportScript.includes('Refusing to write in production without --confirm'), 'production writes should require explicit confirmation');
  assert(imageImportScript.includes('source_urls'), 'image import should retain source URLs for King review');
});

test('found-online video still preparation requires deliberate timestamps and rights', () => {
  assert.strictEqual(pkg.scripts['inventory:prepare-video-stills'], 'node scripts/prepare-found-online-video-stills.js');
  assert(videoStillScript.includes('yt-dlp'), 'video still workflow should use yt-dlp to fetch authorised source videos');
  assert(videoStillScript.includes('ffmpeg'), 'video still workflow should use ffmpeg to extract exact frames');
  assert(videoStillScript.includes('tiktok_url'), 'video still workflow should accept exact TikTok video URLs');
  assert(videoStillScript.includes('tiktok\\.com'), 'video still workflow should allow public TikTok URLs');
  assert(videoStillScript.includes('timestamps: exterior=00:00:05'), 'video still workflow should require labelled timestamps');
  assert(videoStillScript.includes('Refusing to extract/import-ready frames without --confirm-rights'), 'video still extraction should require rights confirmation');
  assert(videoStillScript.includes('found-online-image-import.csv'), 'video still workflow should produce importer-compatible CSV');
});

test('King dashboard shows found-online intake instead of generic sourced candidates', () => {
  assert(frontend.includes('function adminIsSourcedInventoryCandidate'), 'dashboard should have sourced candidate detection helper');
  assert(frontend.includes('function adminSourcedInventoryCandidateBadge'), 'dashboard should have sourced candidate badge helper');
  assert(!frontend.includes('>Sourced candidate<'), 'dashboard should not show generic sourced-candidate badges');
  assert(!frontend.includes('Approve Sourced Candidate'), 'review panel should not show generic sourced-candidate approval copy');
  assert(!html.includes('Create 200 Sourced Candidates'), 'review queue should not expose generic sourced-candidate creation');
  assert(frontend.includes('Found-online/source record'), 'review panel should use found-online/source wording');
  assert(frontend.includes('location is non-negotiable before approval'), 'review panel should show the found-online location gate');
  assert(frontend.includes('function adminSourcedCandidateSourceLinks'), 'review panel should expose stored source/photo evidence links');
  assert(frontend.includes('image.source_url, image.source_link, image.original_url, image.url'), 'source links should include attached image URLs such as YouTube stills');
  assert(frontend.includes('function adminFoundOnlineSourceSummaryHtml'), 'dashboard should summarize source name, first-posted date, and source link inline');
  assert(frontend.includes('First posted/seen'), 'pending queue should display the first posted/seen source date');
  assert(frontend.includes('Open source'), 'pending queue should expose source click-through links');
  assert(frontend.includes('adminApproveSourcedCandidateOverride'), 'dashboard should expose found-online approval control');
  assert(frontend.includes('function adminEvidenceDownloadFilename'), 'evidence downloads should use a filename matching the actual mime type');
  assert(frontend.includes('function adminIsGeneratedPlaceholderPhoto'), 'dashboard should detect generated placeholder images');
  assert(frontend.includes('Placeholder/support images are attached'), 'dashboard should warn when images are placeholders');
  assert(frontend.includes('function adminIsFoundOnlineSourcedListing'), 'dashboard should detect found-online sourced records');
  assert(frontend.includes('source === "found_online_property_source_v1"'), 'found-online filter should count rows by production source marker');
  assert(frontend.includes('listedVia === "found_online"'), 'found-online filter should count rows by production listed_via marker');
  assert(frontend.includes('Found online'), 'dashboard should display found-online copy');
  assert(frontend.includes('function adminPendingQueueCounts'), 'dashboard should count pending queue categories');
  assert(frontend.includes('function adminSetPendingQueueFilter'), 'dashboard should let King filter the pending queue');
  assert(frontend.includes('Pending queue view'), 'dashboard should show which pending queue filter is active');
  const cleanupMigration = read('db/migrations/044_clean_sourced_candidates_seed_found_online_2026.sql');
  assert(cleanupMigration.includes("title ILIKE 'Sourced candidate - %'"), 'production migration should delete old generic sourced-candidate rows');
  assert(cleanupMigration.includes("'found_online_2026_platform_sweep_20260524'"), 'production migration should seed the 2026 found-online sweep batch');
});

test('admin listing API exposes sourcing metadata only behind admin access', () => {
  assert(propertiesRoute.includes('p.extra_fields AS admin_extra_fields'), 'admin rows should fetch full extra fields for dashboard review');
  assert(propertiesRoute.includes('if (adminAccess)'), 'admin-only response fields must be gated by admin access');
  assert(propertiesRoute.includes('responseRow.extra_fields = adminExtraFields || {}'), 'full extra_fields should only be attached for admin rows');
  assert(propertiesRoute.includes('found_online_candidate'), 'admin API should surface the found-online candidate flag');
});

test('package script exposes the safe inventory intake command', () => {
  assert(!pkg.scripts['inventory:seed-sourced-candidates'], 'package.json should not expose retired generic inventory seed command');
  assert.strictEqual(
    pkg.scripts['inventory:import-found-online-images'],
    'node scripts/import-found-online-images.js',
    'package.json should expose found-online image import command'
  );
  assert.strictEqual(
    pkg.scripts['inventory:seed-bakaima'],
    'node scripts/seed-bakaima-authorised-land-listings.js',
    'package.json should expose Bakaima authorised listing seed command'
  );
  assert.strictEqual(
    pkg.scripts['inventory:seed-carnelian'],
    'node scripts/seed-carnelian-authorised-listings.js',
    'package.json should expose Carnelian authorised listing seed command'
  );
  assert.strictEqual(
    pkg.scripts['inventory:seed-social-search'],
    'node scripts/seed-social-search-authorised-listings.js',
    'package.json should expose found-online social search seed command'
  );
  assert(script.includes('--start=') && script.includes('--type='), 'seed script should support appending typed candidate ranges');
});

test('admin-only endpoint rejects retired generic sourced candidates', () => {
  assert(adminRoute.includes("router.use(requireAdminApiKey)"), 'admin routes must be protected before seed endpoint');
  assert(adminRoute.includes("router.post('/sourced-inventory-candidates/seed'"), 'admin seed endpoint should exist');
  assert(adminRoute.includes('admin_generic_candidate_seed_rejected'), 'admin endpoint should audit rejected generic seed attempts');
  assert(adminRoute.includes('Generic placeholder candidates are retired'), 'admin endpoint should block generic placeholder candidates');
  assert(!adminRoute.includes('seedSourcedInventoryCandidates({'), 'admin endpoint should not call the generic seed service');
});

test('sourced candidate approval override is server-side limited and audited', () => {
  assert(propertiesRoute.includes('function isSourcedInventoryCandidateRecord'), 'status route should identify sourced candidate records server-side');
  assert(propertiesRoute.includes('sourced_candidate_override'), 'status route should require explicit sourced override flag');
  assert(propertiesRoute.includes('found_online_location_confirmed'), 'override should record location confirmation');
  assert(propertiesRoute.includes('sourcedCandidateRecordHasApprovalLocation'), 'override should verify location from the stored record, not only the request body');
  assert(propertiesRoute.includes('Location is required before found-online approval'), 'override error should explain that location is required');
  assert(propertiesRoute.includes('cannot override missing location'), 'override details should make location non-negotiable');
  assert(propertiesRoute.includes('non-location review checks'), 'override should document that non-location checks are overridden');
  assert(propertiesRoute.includes('Found-online approval is only available'), 'override should reject ordinary listings');
  assert(propertiesRoute.includes('sourced_candidate_special_dispensation'), 'override should be stored on the property record');
  assert(propertiesRoute.includes('found_online_approval_used'), 'override should be written to moderation history');
});

test('admin has a guarded April 29 test-batch cleanup path', () => {
  assert(adminRoute.includes("router.post('/test-listings/cleanup-april-29'"), 'admin cleanup endpoint should exist');
  assert(adminRoute.includes("created_at >= TIMESTAMPTZ '2026-04-29 00:00:00+00'"), 'cleanup should be scoped to April 29 only');
  assert(adminRoute.includes('april_29_test_batch_cleanup'), 'cleanup should write audit metadata');
  assert(frontend.includes('adminCleanupApril29TestBatch'), 'dashboard should expose cleanup action');
  assert(frontend.includes('/api/admin/test-listings/cleanup-april-29'), 'dashboard should call protected cleanup endpoint');
  assert(html.includes('admin-clean-april29-tests-btn'), 'all-listings panel should include cleanup control');
});

test('King review queue exposes found-online intake only', () => {
  assert(!html.includes('admin-seed-sourced-candidates-btn'), 'review queue should not expose generic sourced candidate button');
  assert(!frontend.includes('async function adminSeedSourcedInventoryCandidates'), 'frontend should not implement generic sourced candidate creation');
  assert(html.includes('admin-found-online-status'), 'review queue should expose found-online status output');
  assert(html.includes('admin-seed-social-search-listings-btn'), 'review queue should expose found-online listing button');
  assert(frontend.includes('function ensureAdminFoundOnlineControls'), 'frontend should inject found-online controls when cached HTML is stale');
  assert(frontend.includes('async function adminSeedSocialSearchAuthorisedListings'), 'frontend should implement found-online seed action');
  assert(!frontend.includes('/api/admin/sourced-inventory-candidates/seed'), 'frontend should not call generic sourced candidate seed endpoint');
  assert(frontend.includes('/api/admin/social-search-authorised-listings/seed'), 'frontend should call protected found-online endpoint');
  assert(frontend.includes('renderAdminDashboard()'), 'frontend should refresh King queue after seeding');
});

test('found-online seed panel hides approved and live records from pending moderation', () => {
  assert(frontend.includes('function adminSeedItemStatuses'), 'frontend should normalize seed result statuses before rendering');
  assert(frontend.includes('function adminIsFinalReviewSeedItem'), 'frontend should detect final approved/live statuses');
  assert(frontend.includes('function adminUniqueSeedItems'), 'frontend should dedupe seed result summaries');
  assert(frontend.includes('function adminScrubPendingSeedStatusPanel'), 'frontend should defensively remove stale final-state cards from the pending panel');
  assert(frontend.includes('adminSeededListingSummaryHtml(item, { pendingPanel: true })'), 'pending panel should render summaries through the pending-only guard');
  assert(frontend.includes('ensureAdminFoundOnlineControls();\n  adminScrubPendingSeedStatusPanel();'), 'dashboard refresh should scrub stale approved/live found-online cards from the pending panel');
  assert(frontend.includes('No pending found-online records need review in this run'), 'pending panel should explain when only approved/live matches remain');
  assert(frontend.includes('data-admin-seed-final'), 'seed summaries should expose final-state metadata for UI regression checks');
  assert(frontend.includes('(pendingRows || []).map(normalizeRemoteAdminListing).filter(adminIsPendingReviewSeedItem)'), 'remote pending rows should drop approved/live records before rendering');
  assert(frontend.includes('fetchAdminPaginatedRows("/api/properties?status=pending", headers, { maxPages: 500 })'), 'dashboard should fetch enough pending pages for launch sweep volume');
  assert(frontend.includes('adminApplyLaunchCleanFilter(listings).filter(adminIsPendingReviewSeedItem)'), 'pending renderer should refuse final-state records even if an API response leaks them');
  assert(html.includes('found-online-pending-filter-20260521'), 'index should bump the app asset version so production browsers fetch the fixed admin JS');
  assert(html.includes('source-fishing-policy-20260523'), 'index should bump the app asset version so production browsers fetch the source-fishing policy UI');
  assert(html.includes('found-online-queue-tabs-20260524'), 'index should bump the app asset version so production browsers fetch the found-online queue filter UI');
  assert(html.includes('found-online-evidence-sweep-20260524'), 'index should bump the app asset version so production browsers fetch found-online source/date/evidence fixes');
  assert(html.includes('public-image-src-fix-20260524'), 'index should bump the app asset version so production browsers fetch public image source fixes');
  assert(html.includes('found-online-admin-archive-20260524'), 'index should bump the app asset version so production browsers fetch the found-online admin archive view');
  assert(html.includes('live-review-separation-20260525'), 'index should bump the app asset version so production browsers fetch the live/review separation fix');
  assert(html.includes('social-only-preapproved-20260525'), 'index should bump the app asset version so production browsers fetch the social-only preapproval cleanup');
  assert(html.includes('strict-preapproval-20260525'), 'index should bump the app asset version so production browsers fetch the strict explicit-preapproval cleanup');
  assert(html.includes('youtube-social-restore-20260525'), 'index should bump the app asset version so production browsers fetch the YouTube social restore copy');
  assert(html.includes('youtube-social-republish-20260525'), 'index should bump the app asset version so production browsers fetch the YouTube social republish fix');
  assert(frontend.includes('adminPendingQueueFilter = "found_online"'), 'found-online sweep should switch the Review Queue to the found-online filter');
  assert(frontend.includes('function adminFoundOnlineAllRows'), 'dashboard should keep a pending-only found-online helper for cached code paths');
  assert(!frontend.includes('approved/live source records stay visible here for audit'), 'Review Queue must not describe approved/live listings as still visible there');
  assert(frontend.includes('Approved/live records move to Live & Featured and do not stay in Review Queue.'), 'dashboard should explain final records leave Review Queue');
  assert(frontend.includes('return source.filter(adminIsFoundOnlineSourcedListing).filter(adminIsPendingReviewSeedItem);'), 'found-online filter should only return pending review rows');
  assert(frontend.includes('return raw || "unknown";'), 'unknown listing statuses must not silently become live/approved in admin UI');
  assert(frontend.includes('Open Public Listing') && frontend.includes('Review Preview'), 'Live & Featured should open actual public listings separately from admin previews');
  assert(socialSearchServiceSource.includes('function normalizedStatusValue'), 'service should trim and normalize stored statuses');
  assert(socialSearchServiceSource.includes('const reviewQueueVisible = isReviewQueueStatus(existing);'), 'service should evaluate existing records with status and moderation stage together');
  assert(socialSearchServiceSource.includes('item.review_queue_visible && !item.already_live_or_approved && isReviewQueueStatus(item)'), 'service should exclude final records from review_queue_listings');
  assert(socialSearchServiceSource.includes('already_present_properties: alreadyPresentReviewQueue'), 'legacy already_present_properties response should only include pending review records');
  assert(socialSearchServiceSource.includes('already_present_all_properties: alreadyPresent'), 'service should keep full already-present records in a separate non-pending field');
});

test('public property cards keep NEW freshness and replace registered badge with sourced-online status', () => {
  assert(frontend.includes('function isFoundOnlineListing'), 'public UI should detect found-online listing records');
  assert(frontend.includes('function listingFreshnessBadgeHtml'), 'public UI should render listing freshness through a shared helper');
  assert(frontend.includes('translateListingLabel("Found online")'), 'public UI should translate the found-online badge');
  const freshnessHelper = frontend.slice(frontend.indexOf('function listingFreshnessBadgeHtml'), frontend.indexOf('function foundOnlineSourceMeta'));
  assert(freshnessHelper.indexOf('if (isListingNew(p))') < freshnessHelper.indexOf('if (isFoundOnlineListing(p))'), 'fresh found-online listings should still show NEW first');
  assert(frontend.includes('if (isFoundOnlineListing(p))') && frontend.includes('translateListingLabel("Sourced online")'), 'found-online cards should show sourced-online instead of registered');
  assert(frontend.includes('function listingRouteBadgeMeta') && frontend.includes('if (isFoundOnlineListing(p)) return null;'), 'found-online cards should not show broker/private listing route badges');
  assert(frontend.includes('sourceBatch === "social_search_authorised_20260520"'), 'public UI should recognise the social-search batch');
  assert(frontend.includes('listingFreshnessBadgeHtml(p)'), 'property cards should render the found-online badge helper');
  assert(frontend.includes('"Found online": "Kizuuliddwa ku mutimbagano"'), 'Luganda should include found-online copy');
  assert(frontend.includes('"Found online": "Imepatikana mtandaoni"'), 'Kiswahili should include found-online copy');
  assert(frontend.includes('"First posted online"'), 'source disclosure should translate first-posted metadata');
  assert(frontend.includes('"First picked up by makaug"'), 'source disclosure should translate first-picked-up metadata');
  assert(frontend.includes('translateFoundOnlineSourceText'), 'source disclosure should translate database-supplied source phrases');
  assert(frontend.includes('"Open original source": "Ggulawo ensibuko eyasooka"'), 'source disclosure should translate original-source action');
  assert(frontend.includes('"Contact original poster": "Wasiliana na aliyechapisha awali"'), 'source disclosure should translate original-poster action');
  assert(frontend.includes('"Report fraud or incorrect information": "Ripoti udanganyifu au taarifa zisizo sahihi"'), 'source disclosure should translate report action');
  assert(frontend.includes('"Contact via source"'), 'source disclosure should translate contact-through-source action');
  assert(frontend.includes('Original post date is being confirmed from the source platform'), 'source disclosure should explain when platform post date is not exposed');
  assert(frontend.includes('function selectDetailGalleryPhoto'), 'detail gallery thumbnails should switch the main image before opening the lightbox');
  assert(frontend.includes('detail-broker-profile-link'), 'detail contact card should make broker logo/name click through to the profile');
});

test('public property images escape and normalize generated SVG evidence cards', () => {
  assert(frontend.includes('function normalizeImageSrcForDisplay'), 'frontend should normalize generated SVG data URLs before rendering');
  assert(frontend.includes('data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}'), 'SVG data URLs should be encoded for mobile browsers');
  assert(frontend.includes('const photoSrc = isThirdPartyResult ? "" : publicImageSrc(p.img'), 'public listing cards should suppress copied social/gallery media for third-party results while normalizing owned/direct images');
  assert(frontend.includes('foundOnlineSourceVisualHtml(p, { compact: true })'), 'third-party result cards should render the source-first discovery visual instead of copied social media photos');
  assert(frontend.includes('<img src="${adminAttr(photoSrc)}" alt="${adminAttr(p.title)}"'), 'public listing cards should escape image src and title attributes');
  assert(frontend.includes('const selectedPhotoSrc = thirdPartyDetail ? "" : publicImageSrc(selectedPhoto?.url || p.img'), 'detail gallery should suppress third-party media and normalize owned/direct selected image sources');
  assert(frontend.includes('<img id="detail-gallery-hero-img" src="${adminAttr(selectedPhotoSrc)}"'), 'detail hero image should escape the selected image src');
  assert(!frontend.includes('<img src="${p.img || "https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=900&q=80"}"'), 'public cards should not inject raw p.img values into src');
  assert(!frontend.includes('<img src="${p.img}" alt="${p.title}"'), 'student cards should not inject raw p.img values into src');
  assert(propertiesRoute.includes('function normalizePublicImageUrl'), 'properties API should normalize generated SVG image URLs');
  assert(propertiesRoute.includes('primary_image_url: primaryImageUrl'), 'properties API should return the normalized primary image URL');
  assert(propertiesRoute.includes('image: primaryImageUrl'), 'properties API should return the normalized card image URL');
});

test('Bakaima authorised batch creates 33 pending land listings with evidence photos', () => {
  const summary = summarizeBakaimaListings();
  const listings = plannedBakaimaListings();
  assert.strictEqual(BAKAIMA_BATCH_ID, 'bakaima_authorised_land_20260518');
  assert.strictEqual(summary.count, 33, 'flyer-derived Bakaima batch should contain 33 estate rows');
  assert.strictEqual(summary.by_type.land, 33, 'Bakaima batch should be land only');
  assert.strictEqual(listings.length, 33, 'planned Bakaima listings should match summary count');
  for (const listing of listings) {
    const extra = JSON.parse(listing.extra_fields);
    assert.strictEqual(listing.listing_type, 'land');
    assert.strictEqual(listing.status, 'pending');
    assert.strictEqual(listing.moderation_stage, 'submitted');
    assert.strictEqual(listing.source, BAKAIMA_SOURCE);
    assert.strictEqual(listing.listed_via, 'sourced_inventory');
    assert.strictEqual(listing.lister_name, BAKAIMA_CONTACT.name);
    assert.strictEqual(listing.lister_phone, BAKAIMA_CONTACT.phone);
    assert.strictEqual(listing.lister_email, BAKAIMA_CONTACT.email);
    assert.strictEqual(extra.source_batch, BAKAIMA_BATCH_ID);
    assert.strictEqual(extra.consent_confirmed, true);
    assert.strictEqual(extra.image_rights_confirmed, true);
    assert.strictEqual(extra.map_pin_confirmed, false);
    assert(!/Verify exact plot number/i.test(listing.description), `${listing.title} should not expose admin verification copy in public description`);
    assert(!/before public approval/i.test(listing.description), `${listing.title} should not expose admin approval copy in public description`);
    assert(extra.review_required_steps.some((step) => /Confirm exact plot pin\/boundaries/i.test(step)), `${listing.title} should keep exact pin verification in review steps`);
    assert(listing.moderation_notes.includes('Exact plot pin'), `${listing.title} should keep exact pin verification in moderation notes`);
    assert(Array.isArray(extra.authorised_flyer_urls) && extra.authorised_flyer_urls.length >= 1);
    assert(listing.images.length >= 2, `${listing.title} should include generated card plus authorised flyer evidence`);
    assert(listing.images.some((image) => image.url.startsWith('data:image/svg+xml')), `${listing.title} should include generated primary card`);
    assert(listing.images.some((image) => image.url.includes('/assets/sourced/bakaima/')), `${listing.title} should include Bakaima supplied flyer image`);
  }
});

test('Bakaima admin warnings stay out of existing public descriptions', () => {
  assert(bakaimaPublicCopyMigration.includes("extra_fields->>'source_batch' = 'bakaima_authorised_land_20260518'"), 'migration should only target the Bakaima authorised batch');
  assert(bakaimaPublicCopyMigration.includes('Verify exact plot number, access road, title particulars, boundary marks, and availability with Bakaima before public approval.'), 'migration should remove the exact leaked admin sentence');
  assert(bakaimaPublicCopyMigration.includes('description = replace('), 'migration should preserve the rest of the consumer description');
});

test('Bakaima admin path and dashboard action are protected and auditable', () => {
  assert(adminRoute.includes("router.post('/bakaima-authorised-land-listings/seed'"), 'admin Bakaima seed endpoint should exist');
  assert(adminRoute.includes('seedBakaimaAuthorisedListings'), 'admin endpoint should use Bakaima seed service');
  assert(adminRoute.includes('admin_bakaima_authorised_land_listings_seeded'), 'admin endpoint should write Bakaima audit trail');
  assert(html.includes('admin-seed-bakaima-listings-btn'), 'review queue should include Bakaima creation button');
  assert(frontend.includes('async function adminSeedBakaimaAuthorisedListings'), 'frontend should implement Bakaima seed action');
  assert(frontend.includes('/api/admin/bakaima-authorised-land-listings/seed'), 'frontend should call protected Bakaima endpoint');
  assert(frontend.includes('function adminOpenReviewShareWhatsApp'), 'review panel should expose stored WhatsApp share card');
  assert(frontend.includes('WhatsApp share card'), 'review panel should label the WhatsApp share copy clearly');
});

test('Carnelian authorised batch creates two pending sale listings with YouTube evidence', () => {
  const summary = summarizeCarnelianListings();
  const listings = plannedCarnelianListings('00000000-0000-4000-8000-000000000000');
  assert.strictEqual(CARNELIAN_BATCH_ID, 'carnelian_youtube_authorised_20260519');
  assert.strictEqual(summary.count, 2, 'Carnelian batch should contain the two recent YouTube tours');
  assert.strictEqual(summary.by_type.sale, 2, 'Carnelian batch should be sale listings only');
  for (const listing of listings) {
    const extra = JSON.parse(listing.extra_fields);
    assert.strictEqual(listing.listing_type, 'sale');
    assert.strictEqual(listing.status, 'pending');
    assert.strictEqual(listing.moderation_stage, 'submitted');
    assert.strictEqual(listing.source, CARNELIAN_SOURCE);
    assert.strictEqual(listing.listed_via, 'sourced_inventory');
    assert.strictEqual(listing.lister_name, CARNELIAN_CONTACT.name);
    assert.strictEqual(listing.lister_phone, CARNELIAN_CONTACT.phone);
    assert.strictEqual(listing.lister_email, CARNELIAN_CONTACT.email);
    assert.strictEqual(extra.source_batch, CARNELIAN_BATCH_ID);
    assert.strictEqual(extra.consent_confirmed, true);
    assert.strictEqual(extra.image_rights_confirmed, true);
    assert.strictEqual(extra.image_rights_status, 'authorised_youtube_stills_from_agent_channel');
    assert.strictEqual(extra.map_pin_confirmed, false);
    assert.strictEqual(extra.property_url_status, 'public_after_approval');
    assert(extra.map_pin_label && /Kira/i.test(extra.map_pin_label), `${listing.title} should carry a close Kira-area map label`);
    assert(extra.map_pin_accuracy_note && /confirm the exact/i.test(extra.map_pin_accuracy_note), `${listing.title} should keep exact-gate confirmation in review metadata`);
    assert(Array.isArray(extra.nearby_facilities) && extra.nearby_facilities.length >= 7, `${listing.title} should carry named nearby amenities`);
    assert(extra.nearby_facilities.every((item) => item && typeof item.name === 'string' && item.name.trim() && item.name !== 'Nearby'), `${listing.title} should not store generic Nearby amenity chips`);
    assert(extra.nearby_facilities.some((item) => /hospital|clinic/i.test(`${item.type} ${item.name}`)), `${listing.title} should include nearby health facilities`);
    assert(extra.nearby_facilities.some((item) => /school|college|secondary/i.test(`${item.type} ${item.name}`)), `${listing.title} should include schools or secondary schools`);
    assert(/^https:\/\/www\.youtube\.com\/watch\?v=/.test(extra.youtube_url), `${listing.title} should keep the YouTube source`);
    assert(!/before public approval/i.test(listing.description), `${listing.title} should not expose admin approval copy publicly`);
    assert(!/sourced candidate/i.test(listing.description), `${listing.title} should not expose sourced-candidate copy publicly`);
    assert(listing.images.length === 5, `${listing.title} should include one main image and four video stills`);
    assert(listing.images.every((image) => image.url.includes('/assets/sourced/carnelian/')), `${listing.title} should use Carnelian authorised assets`);
  }
});

test('Carnelian admin path and dashboard action are protected and auditable', () => {
  assert(adminRoute.includes("router.post('/carnelian-authorised-listings/seed'"), 'admin Carnelian seed endpoint should exist');
  assert(adminRoute.includes('seedCarnelianAuthorisedListings'), 'admin endpoint should use Carnelian seed service');
  assert(adminRoute.includes('admin_carnelian_authorised_listings_seeded'), 'admin endpoint should write Carnelian audit trail');
  assert(html.includes('admin-seed-carnelian-listings-btn'), 'review queue should include Carnelian creation button');
  assert(frontend.includes('async function adminSeedCarnelianAuthorisedListings'), 'frontend should implement Carnelian seed action');
  assert(frontend.includes('/api/admin/carnelian-authorised-listings/seed'), 'frontend should call protected Carnelian endpoint');
  assert(frontend.includes('adminSeededListingSummaryHtml'), 'seed status should expose review and preview actions instead of raw pending public URLs only');
  assert(frontend.includes('adminCreateShareablePreviewLink'), 'review panel should expose shareable private preview link creation');
  assert(frontend.includes('/review-token'), 'review panel should call the protected preview-token route');
  assert(frontend.includes('normalizeNearbyPlaceForUi'), 'frontend should normalize old string amenities and new amenity objects');
  assert(frontend.includes('formatNearbyDistanceKm'), 'public detail should render nearby amenities with km distances');
  assert(frontend.includes('const detailMapPoint = getListingMapPoint(p);'), 'public detail amenities should use the same resolved point as the map');
  assert(frontend.includes('getNearbyAmenitySuggestions({ lat: detailMapPoint.lat, lng: detailMapPoint.lng'), 'nearby amenities should be calculated from the visible map pin');
  assert(frontend.includes('UG_AREA_PIN_OVERRIDES'), 'public map resolver should carry known Uganda area pins for social imports without exact coordinates');
  assert(frontend.includes('getKnownUgandaAreaPoint(property)'), 'public map resolver should use the listing area/address/title before falling back to district centres');
  assert(frontend.includes('if (district && !hasCoords)'), 'nearby amenities should not lock to a wrong district when a resolved map pin is available');
  assert(propertiesRoute.includes('publicLocationOverrideForListing'), 'public API should correct social-source district/lat/lng from visible area evidence');
  assert(propertiesRoute.includes('cleanPublicListingCopy'), 'public API should strip review/approval instructions from public listing copy');
  assert(socialSourceLocationPinMigration.includes('social_area_pin_repair_20260527'), 'migration should repair already-live social-source location pins');
  assert(frontend.includes('mergeNearbyPlacesForUi(savedNearbyRaw, suggestedNearbyRaw)'), 'detail page should enrich saved amenities with nearby hospitals and schools');
  assert(frontend.includes('selected.slice(0, 8)'), 'nearby amenities should be distance-filtered before display');
  assert(frontend.includes('extra.nearby_facilities'), 'property search should include persisted nearby facility names');
  assert(html.includes('social-location-pin-repair-20260527'), 'index should cache-bust the frontend map/contact repair bundle');
});

test('source-only broker profiles are deferred until the agent self-registers', () => {
  assert.strictEqual(CARNELIAN_CONTACT.tiktok, 'https://www.tiktok.com/@carnelian.propert');
  assert(agentsRoute.includes('function addPublicAgentSelfRegistrationFilter'), 'public agent API should centralize the self-registration filter');
  assert(agentsRoute.includes('a.user_id IS NOT NULL'), 'public agent profiles should require a registered/claimed user account');
  assert(agentsRoute.includes("COALESCE(a.verification_reason, '') NOT ILIKE '%public social source onboarding%'"), 'public agent profiles should hide source-discovery onboarding rows');
  assert(agentsRoute.includes("COALESCE(a.verification_reason, '') NOT ILIKE '%source profile%'"), 'public agent profiles should hide legacy source profile rows');
  assert(agentsRoute.includes("COALESCE(a.licence_number, '') !~* '^(SOCIAL|FOUND-ONLINE|TIKTOK|FACEBOOK|X)-'"), 'public agent profiles should hide auto-created social source licences');
  assert(propertiesRoute.includes('agent_id: foundOnlinePublic ? null : publicRow.agent_id'), 'found-online listing cards should not attach source-created public agent profile ids');
  assert(propertiesRoute.includes('agent_id: foundOnlinePublic ? null : safeProperty.agent_id'), 'found-online listing detail should not attach source-created public agent profile ids');
  assert(socialSearchServiceSource.includes('FOUND_ONLINE_PROFILE_CREATION_POLICY'), 'source import policy should be explicit in the found-online service');
  assert(socialSearchServiceSource.includes('auto_create_source_profiles: false'), 'source imports should not automatically create Makaug broker profiles');
  assert(socialSearchServiceSource.includes('defer_until_agent_claims_profile'), 'source imports should keep poster attribution deferred until the agent claims/registers');
  assert(autoSourceProfileCleanupMigration.includes('auto_source_agent_profile_removed'), 'cleanup migration should detach found-online listings from source-created profiles');
  assert(autoSourceProfileCleanupMigration.includes('auto_source_agent_profile_hidden'), 'cleanup migration should audit hidden source-created profiles');
  assert(autoSourceProfileCleanupMigration.includes('source_discovery_profiles_require_agent_claim_or_registration'), 'cleanup migration should record the new source profile policy');
  assert(healthRoute.includes('057_suspend_auto_source_agent_profiles.sql'), 'migration health should expose source-profile cleanup deployment status');
});

test('Carnelian WhatsApp share card carries listing URL, video and agent contact', () => {
  const listing = plannedCarnelianListings('00000000-0000-4000-8000-000000000000')[0];
  const card = carnelianWhatsappShareMessage(
    listing.source_item,
    'https://makaug.com/property/example-id',
    'https://makaug.com/?listing_preview=1&listing=example-id&token=example-token'
  );
  assert(card.includes('https://makaug.com/property/example-id'), 'share card should include live listing URL');
  assert(card.includes('https://makaug.com/?listing_preview=1'), 'share card should include working private preview URL while pending');
  assert(card.includes(listing.source_item.youtubeUrl), 'share card should include the source video tour');
  assert(card.includes(CARNELIAN_CONTACT.phone), 'share card should include primary Carnelian phone');
  assert(card.includes(CARNELIAN_CONTACT.phoneAlt), 'share card should include alternate Carnelian phone');
});

test('found-online social search batch accepts curated YouTube source records', () => {
  const summary = summarizeSocialSearchListings();
  const listings = plannedSocialSearchListings(Object.fromEntries(SOCIAL_SEARCH_AGENTS.map((agent, index) => [agent.key, `agent-${index}`])));
  assert.strictEqual(SOCIAL_SEARCH_BATCH_ID, 'social_search_authorised_20260520');
  assert.strictEqual(summary.count, 18, 'social search batch should contain the high-confidence recent public YouTube property records');
  assert.strictEqual(summary.seed_eligible_count, 18, 'curated exact YouTube source rows should be eligible found-online properties');
  assert.strictEqual(summary.agents_count, 0, 'social search batch should not auto-create public broker profiles from source discovery');
  assert.strictEqual(summary.source_profiles_deferred_count, SOCIAL_SEARCH_AGENTS.length, 'all source-only profiles should stay deferred until the source owner registers or claims them');
  assert(/registers or claims/i.test(summary.profile_policy), 'summary should expose the source-profile claim/registration policy');
  assert.strictEqual(summary.daily_target_status.target, 200, 'morning sweep should expose the 200/day property queue target');
  assert.strictEqual(summary.daily_target_status.eligible_to_queue_count, summary.seed_eligible_count, 'daily target status should count every launch-intake candidate with source evidence and a contact path');
  assert(summary.daily_target_status.target_gap > 0, 'daily target status should make the current evidence gap visible');
  assert.strictEqual(summary.daily_target_status.meets_daily_minimum, false, 'current curated list should not pretend it meets the 200/day minimum');
  assert(/from 1 January 2026 onward/i.test(summary.daily_target_status.evidence_policy), 'daily target status should express the 2026+ found-online intake rule');
  assert.strictEqual(LAUNCH_SOURCE_POST_WINDOW_START, '2026-01-01T00:00:00.000Z', 'launch intake should scan from 1 January 2026');
  assert(/Facebook/i.test(FOUND_ONLINE_LAUNCH_INTAKE_POLICY.facebook_image_rule), 'launch intake should define how Facebook images are handled');
  assert(/No public phone number is not a blocker/i.test(summary.daily_target_status.no_phone_source_contact_policy), 'daily target status should explain social/source contact fallback');
  assert(/X\/Twitter, Instagram, TikTok, YouTube, Facebook/i.test(summary.daily_target_status.source_page_vs_property_policy), 'daily target status should separate monitored cross-platform sources from queued properties');
  assert(/Website-only sources are ignored/i.test(summary.daily_target_status.evidence_policy), 'daily target status should block website-only sources');
  assert.strictEqual(SOCIAL_SEARCH_LISTINGS.length, listings.length, 'planned social search listings should match source records');
  assert(summary.by_type.sale >= 14, 'social search batch should prioritise sale listings from the provided channels');
  assert(summary.by_type.land >= 2, 'social search batch should include land records where the source gives land detail');
  assert.strictEqual(
    sourcePostMeetsLaunchIntakeRule(SOCIAL_SEARCH_LISTINGS[0], SOCIAL_SEARCH_AGENTS.find((agent) => agent.key === SOCIAL_SEARCH_LISTINGS[0].agentKey)).eligible,
    true,
    'curated exact YouTube source rows should be eligible after King confirmed YouTube social rows are acceptable'
  );
  for (const listing of listings) {
    const extra = JSON.parse(listing.extra_fields);
    assert.strictEqual(listing.status, 'pending');
    assert.strictEqual(listing.moderation_stage, 'submitted');
    assert.strictEqual(listing.source, SOCIAL_SEARCH_SOURCE);
    assert.strictEqual(listing.listed_via, 'found_online');
    assert.strictEqual(extra.source_batch, SOCIAL_SEARCH_BATCH_ID);
    assert.strictEqual(extra.found_online_candidate, true);
    assert.strictEqual(extra.found_online, true);
    assert.strictEqual(extra.social_search_candidate, true);
    assert.strictEqual(extra.source_badge, 'found_online');
    assert(extra.source_platform, `${listing.title} should store the source platform`);
    assert.strictEqual(extra.source_contact_platform, extra.source_platform, `${listing.title} should keep the contact platform aligned with the source platform`);
    assert(extra.source_contact_url && /^https?:\/\//.test(extra.source_contact_url), `${listing.title} should expose a public source/social contact URL`);
    assert(extra.source_contact_method, `${listing.title} should expose a contact method even when no phone is present`);
    assert.strictEqual(extra.source_post_window_start, '2026-01-01T00:00:00.000Z', `${listing.title} should store the launch source window`);
    assert(extra.source_post_date_status, `${listing.title} should store source post date status`);
    assert.strictEqual(extra.public_contact_path_available, true, `${listing.title} should mark source/social contact paths as usable`);
    assert(extra.source_audience_label || extra.source_followers_label, `${listing.title} should show source audience/follower metadata`);
    assert(extra.added_to_makaug_at, `${listing.title} should store when makaug added the sourced record`);
    assert(/No public phone number is not a blocker/i.test(extra.source_no_phone_policy), `${listing.title} should store the no-phone source contact policy`);
    if (!listing.lister_phone) {
      assert.strictEqual(extra.source_contact_method, 'social', `${listing.title} should fall back to social contact when no phone is published`);
      assert(/source|social|channel/i.test(extra.source_contact_label), `${listing.title} should explain the social contact fallback`);
      assert.strictEqual(extra.source_contact_available_without_phone, true, `${listing.title} should mark source contact as available without a phone`);
    } else {
      assert.strictEqual(extra.source_contact_available_without_phone, false, `${listing.title} should not mark source-only contact when a phone is published`);
    }
    assert.strictEqual(extra.consent_confirmed, true);
    assert.strictEqual(extra.image_rights_confirmed, true);
    assert.strictEqual(extra.preapproved_source_post, true);
    assert.strictEqual(extra.permission_status, 'founder_reported_agent_authorised_upload');
    assert.strictEqual(extra.image_rights_status, 'preapproved_social_source_media_or_evidence');
    assert.strictEqual(extra.map_pin_confirmed, false);
    assert(/^https:\/\/www\.youtube\.com\/watch\?v=/.test(extra.youtube_url), `${listing.title} should keep the source video URL`);
    assert(Array.isArray(extra.source_urls) && extra.source_urls.some((url) => /youtube\.com/i.test(url)), `${listing.title} should keep public source URLs`);
    assert(Array.isArray(extra.photo_source_urls) && extra.photo_source_urls.length >= 5, `${listing.title} should keep five source image URLs for video evidence`);
    assert(extra.photo_source_urls.some((url) => /\/0\.jpg$/i.test(url)), `${listing.title} should keep the YouTube preview still`);
    assert(extra.photo_source_urls.some((url) => /\/3\.jpg$/i.test(url)), `${listing.title} should keep the fifth YouTube still`);
    assert.strictEqual(extra.minimum_reliable_image_count, 1, `${listing.title} should allow launch intake with one usable source image plus evidence`);
    assert(/do not rehost downloaded TikTok, Facebook, Instagram, YouTube, X, LinkedIn, WhatsApp, or website photos\/videos/i.test(extra.image_evidence_policy), `${listing.title} should keep strict third-party media guidance`);
    assert(/source links or official embeds first/i.test(extra.image_evidence_policy), `${listing.title} should prefer source links and official embeds over copied media`);
    assert(/Facebook/i.test(extra.facebook_image_policy), `${listing.title} should keep Facebook image handling guidance`);
    if (listing.source_item.listingType === 'land') {
      assert(/land-size guide illustration/i.test(listing.images.map((image) => image.room_label).join(' ')), `${listing.title} should include a generated land-size guide image`);
      assert.strictEqual(extra.generated_land_size_diagram, true, `${listing.title} should flag generated land-size support imagery`);
      assert(/source links or official embeds rather than copied social photos/i.test(extra.land_visual_strategy), `${listing.title} should keep the source-first land image strategy for reviewers`);
    }
    assert(Array.isArray(extra.nearby_facilities) && extra.nearby_facilities.length >= 5, `${listing.title} should include nearby places`);
    assert(extra.nearby_facilities.some((item) => /hospital|clinic/i.test(`${item.type} ${item.name}`)), `${listing.title} should include health facilities`);
    assert(extra.nearby_facilities.some((item) => /school|college|secondary/i.test(`${item.type} ${item.name}`)), `${listing.title} should include schools or secondary schools`);
    assert(Array.isArray(extra.review_required_steps) && extra.review_required_steps.length >= 5, `${listing.title} should keep approval checks in King review metadata`);
    assert(!/before (public )?approval/i.test(listing.description), `${listing.title} should not expose approval warnings in public copy`);
    assert(!/founder-reported|prepared from|King review/i.test(listing.description), `${listing.title} should not expose internal sourcing language in public copy`);
    assert(!/sourced candidate/i.test(listing.description), `${listing.title} should not expose sourced-candidate wording publicly`);
    assert(listing.images.length >= 3 && listing.images.length <= 5, `${listing.title} should include 3-5 source images only when evidence-based`);
    assert(listing.images.some((image) => image.url.includes(`https://i.ytimg.com/vi/${listing.source_item.youtubeId}/`)), `${listing.title} should use the matching YouTube image source`);
    assert(listing.images.every((image) => image.url.includes(`https://i.ytimg.com/vi/${listing.source_item.youtubeId}/`) || image.url.startsWith('data:image/svg+xml')), `${listing.title} should use only matching source images or generated support diagrams`);
    assert(!listing.images.some((image) => /bedroom|bathroom|kitchen/i.test(image.room_label)), `${listing.title} should not guess room labels from generic source stills`);
  }
});

test('found-online second sweep migration expands source-backed 2026 records and YouTube stills', () => {
  assert(foundOnlineSecondSweepMigration.includes('found_online_2026_second_sweep_20260524'), 'second sweep migration should tag the new launch source batch');
  assert(foundOnlineSecondSweepMigration.includes('upc-11056-ntinda-ministers-5bed-1-5b'), 'second sweep should include additional confirmed Uganda Property Centre 2026 records');
  assert(foundOnlineSecondSweepMigration.includes('jiji-rent-kampala-munyonyo-3bed-duplex-2-1m'), 'second sweep should include first-seen Jiji rent category rows');
  assert(foundOnlineSecondSweepMigration.includes('first_seen_2026_live_category_pending_exact_post_date'), 'category rows should clearly mark exact post dates as pending confirmation');
  assert(foundOnlineSecondSweepMigration.includes('first_posted_online_label'), 'new rows should carry first-posted/first-seen labels for King review');
  assert(foundOnlineSecondSweepMigration.includes('source_url_is_exact_listing'), 'new rows should distinguish exact listing URLs from category evidence URLs');
  assert(foundOnlineSecondSweepMigration.includes("'hqdefault.jpg'"), 'YouTube evidence should keep the cover still');
  assert(foundOnlineSecondSweepMigration.includes("'0.jpg'"), 'YouTube evidence should keep the preview still');
  assert(foundOnlineSecondSweepMigration.includes("'3.jpg'"), 'YouTube evidence should keep five frame URLs');
  assert(foundOnlineSecondSweepMigration.includes("'video_still_count', 5"), 'YouTube rows should be marked with five stills');
  assert(healthRoute.includes('045_expand_found_online_sweep_images_and_sources.sql'), 'migration health should expose the second sweep deployment status');
  assert(socialOnlyPreapprovedCleanupMigration.includes('website_or_non_social_source_blocked'), 'cleanup should remove website/non-social found-online rows from launch inventory');
  assert(socialOnlyPreapprovedCleanupMigration.includes('missing_preapproval_or_image_rights'), 'cleanup should remove rows without pre-approval and image-rights confirmation');
  assert(strictFoundOnlinePreapprovalMigration.includes('implicit_found_online_approval_removed'), 'strict cleanup should remove legacy rows that were only implicitly approved');
  assert(strictFoundOnlinePreapprovalMigration.includes('preapproved_source_post'), 'strict cleanup should require explicit preapproved source-post metadata');
  assert(autoSourceProfileCleanupMigration.includes("status = 'suspended'"), 'cleanup should hide source-created agent profiles until the source owner registers or claims them');
  assert(autoSourceProfileCleanupMigration.includes("a.user_id IS NULL"), 'cleanup should target only unclaimed/source-created profiles');
});

test('launch intake policy accepts no-phone source contact and non-YouTube evidence cards', () => {
  const facebookPost = {
    key: 'facebook-kampala-hostel-jan-2026',
    title: 'Student Hostel Rooms near Makerere',
    sourceTitle: 'Rooms available near Makerere',
    sourceUrl: 'https://www.facebook.com/example/posts/2026-launch-hostel',
    sourcePlatform: 'Facebook',
    sourcePublishedAt: '2026-01-04T08:00:00.000Z',
    area: 'Makerere',
    district: 'Kampala',
    address: 'Makerere, Kampala',
    price: 450000,
    listingType: 'students',
    pre_approved: true,
    consent_confirmed: true,
    image_rights_confirmed: true,
    permission_status: 'agent_preapproved',
  };
  const sourceOnlyAgent = {
    key: 'facebook-source-only',
    name: 'Facebook Source Only',
    facebookUrl: 'https://www.facebook.com/example',
  };
  const intake = sourcePostMeetsLaunchIntakeRule(facebookPost, sourceOnlyAgent);
  assert.strictEqual(intake.eligible, true, 'a source-only public Facebook contact route should be eligible without a phone');
  assert.strictEqual(intake.no_phone_ok_with_source_contact, true, 'no-phone source contact should be explicit');
  const images = sourceImageRowsFor(facebookPost);
  assert.strictEqual(images.length, 0, 'non-direct Facebook media should not be treated as a copied image');
  assert(socialSearchServiceSource.includes('sourceEvidenceCardDataUrl'), 'service should generate a labelled evidence card when no public image URL is available');
});

test('found-online source-post importer normalizes extracted posts for King review', () => {
  assert.strictEqual(FOUND_ONLINE_SOURCE_POST_IMPORT_BATCH_ID, 'found_online_source_post_import');
  assert.strictEqual(typeof queueFoundOnlineSourcePostListings, 'function', 'source-post importer should expose a queue function');
  const imported = normalizeFoundOnlineSourcePost({
    post_url: 'https://www.facebook.com/example/posts/kira-2026-house',
    source_page_url: 'https://www.facebook.com/example',
    source_name: 'Example Facebook Agent',
    platform: 'Facebook',
    title: 'Kira house for sale',
    area: 'Kira',
    district: 'Wakiso',
    price_text: 'USh 350m',
    first_posted_at: '2026-02-10T09:00:00.000Z',
    source_contact_url: 'https://www.facebook.com/example',
    pre_approved: true,
    consent_confirmed: true,
    image_rights_confirmed: true,
    permission_status: 'agent_preapproved',
  });
  const intake = sourcePostMeetsLaunchIntakeRule(imported, imported.sourceAgent);
  assert.strictEqual(imported.sourceBatch, FOUND_ONLINE_SOURCE_POST_IMPORT_BATCH_ID, 'imported posts should use the source-post import batch');
  assert.strictEqual(imported.price, 350000000, 'importer should parse Uganda shorthand prices');
  assert.strictEqual(intake.eligible, true, 'imported no-phone social posts with location and public source contact should be queueable');

  const captionContact = normalizeFoundOnlineSourcePost({
    post_url: 'https://www.instagram.com/reel/example-kololo-rent',
    source_page_url: 'https://www.instagram.com/exampleagent',
    source_name: 'Example Agent',
    platform: 'Instagram',
    caption: 'Luxury apartment for rent in Kololo. Call +256743694821 or email hello@example.com.',
    area: 'Kololo',
    district: 'Kampala',
    price_text: 'USh 3.5m/month',
  });
  assert.strictEqual(captionContact.sourceAgent.phone, '+256743694821', 'generic source-post importer should reverse public WhatsApp/phone from captions');
  assert.strictEqual(captionContact.sourceAgent.email, 'hello@example.com', 'generic source-post importer should reverse public email from captions');
  assert(socialSearchServiceSource.includes('normalizedContactKeyForSource'), 'source-post importer should group repeated phone/email/source contacts');
  assert(socialSearchServiceSource.includes('existingFoundOnlineContactCounts'), 'source-post importer should check existing listings before deciding profile creation');
  assert(socialSearchServiceSource.includes('duplicate_warnings'), 'source-post importer should return visible duplicate warnings for exact source URLs');
  assert(socialSearchServiceSource.includes('exact_source_url_duplicate'), 'duplicate warnings should explain when the exact social link was loaded before');
  assert(frontend.includes('Duplicate social links blocked'), 'King dashboard should show duplicate social links instead of quietly ignoring them');
  assert(frontend.includes('duplicate/existing links were blocked'), 'King dashboard import summary should name duplicate/existing link blocks');
  assert(frontend.includes('adminCopySocialCaptureHelper'), 'King dashboard should expose a no-API browser capture helper for social source pages');
  assert(frontend.includes('API-block workaround'), 'social platform sweep should explain the browser-capture workaround when APIs are unavailable');
});

test('TikTok minimum viable source posts can queue with evidence card and date confirmation', () => {
  const imported = normalizeFoundOnlineSourcePost({
    post_url: 'https://www.tiktok.com/@realtor_mahad/video/7330000000000000000',
    source_page_url: 'https://www.tiktok.com/@realtor_mahad',
    source_name: 'Realtor Mahad',
    platform: 'TikTok',
    title: 'Kira bungalow for sale',
    caption: 'House tour of this bungalow in Kira, Uganda. Contact via profile.',
    area: 'Kira',
    district: 'Wakiso',
    price_text: 'USh 450m',
    listing_type: 'sale',
    pre_approved: true,
    consent_confirmed: true,
    image_rights_confirmed: true,
    permission_status: 'agent_preapproved',
  });
  const intake = sourcePostMeetsLaunchIntakeRule(imported, imported.sourceAgent);
  assert.strictEqual(imported.sourcePlatform, 'TikTok', 'TikTok post imports should keep the platform');
  assert.strictEqual(imported.sourceAgent.tiktokUrl, 'https://www.tiktok.com/@realtor_mahad/video/7330000000000000000', 'exact TikTok URL should be usable as contact/source path');
  assert.strictEqual(intake.date_status, 'needs_source_platform_date_confirmation', 'missing TikTok post dates should stay visible as confirmation-needed');
  assert.strictEqual(intake.eligible, true, 'exact TikTok URLs with source contact, area, and price should queue even while date/images are being confirmed');
  assert.strictEqual(sourceImageRowsFor(imported).length, 0, 'TikTok posts without direct media URLs should not pretend to have copied images');
  assert(socialSearchServiceSource.includes('sourceEvidenceCardDataUrl'), 'TikTok no-image imports should fall back to a labelled makaug evidence card');

  const exactRows = buildTikTokExactPostImportRows({
    rawText: [
      'https://www.tiktok.com/@agentug/video/7330000000000000001',
      'title: 4 bed house for sale in Kira, Wakiso',
      'price: USh 650M',
      'posted: 2026-05-20',
      'pre_approved: true',
      'consent_confirmed: true',
      'image_rights_confirmed: true',
      'permission_status: agent_preapproved',
    ].join('\n'),
    oembedByUrl: {
      'https://www.tiktok.com/@agentug/video/7330000000000000001': {
        title: '4 bed house for sale in Kira, Wakiso. USh 650M',
        author_name: 'Agent UG',
        author_url: 'https://www.tiktok.com/@agentug',
        thumbnail_url: 'https://p16-sign-va.tiktokcdn.com/example.jpg',
      },
    },
  });
  assert.strictEqual(TIKTOK_OEMBED_URL, 'https://www.tiktok.com/oembed');
  assert.deepStrictEqual(extractTikTokVideoUrls('Watch https://www.tiktok.com/@agentug/video/7330000000000000001 now'), ['https://www.tiktok.com/@agentug/video/7330000000000000001']);
  assert.strictEqual(exactRows.length, 1, 'exact TikTok importer should turn pasted video URLs into import rows');
  assert.strictEqual(exactRows[0].source_url, 'https://www.tiktok.com/@agentug/video/7330000000000000001');
  assert.strictEqual(exactRows[0].source_page_url, 'https://www.tiktok.com/@agentug');
  assert.strictEqual(exactRows[0].source_name, 'Agent UG');
  assert.strictEqual(exactRows[0].area, 'Kira');
  assert.strictEqual(exactRows[0].district, 'Wakiso');
  assert.strictEqual(exactRows[0].price_text, 'USh 650M');
  assert.strictEqual(exactRows[0].pre_approved, 'true');
  assert.strictEqual(exactRows[0].image_rights_confirmed, 'true');
  assert.deepStrictEqual(exactRows[0].image_urls, ['https://p16-sign-va.tiktokcdn.com/example.jpg']);

  const ndejjeRows = buildTikTokExactPostImportRows({
    rawText: [
      'https://www.tiktok.com/@homes_in_uganda/video/7330000000000000004',
      '#kampalarentals loft studio apartments @400k monthly in Ndejje just call me 0706110456',
    ].join('\n'),
  });
  assert.strictEqual(ndejjeRows[0].area, 'Ndejje', 'TikTok importer should keep Ndejje as the listing area');
  assert.strictEqual(ndejjeRows[0].district, 'Wakiso', 'TikTok importer should not map Ndejje rentals to Kampala district fallback');
  assert.strictEqual(ndejjeRows[0].latitude, 0.244, 'TikTok importer should attach a Ndejje area-level map pin');
  assert.strictEqual(ndejjeRows[0].longitude, 32.553, 'TikTok importer should attach a Ndejje area-level map pin');

  const hoimaRoadRows = buildTikTokExactPostImportRows({
    posts: [{
      post_url: 'https://www.tiktok.com/@plotsug/video/7330000000000000005',
      title: 'Estate plots in Kakiri masulita hoima road from 10million ugx',
      area: 'Hoima',
      platform: 'TikTok',
    }],
  });
  assert.strictEqual(hoimaRoadRows[0].area, 'Kakiri', 'Hoima Road captions should resolve to the Wakiso corridor, not Hoima district');
  assert.strictEqual(hoimaRoadRows[0].district, 'Wakiso', 'Hoima Road captions should stay in Wakiso for map pins');

  const captionOnlyRows = buildTikTokExactPostImportRows({
    rawText: [
      'https://www.tiktok.com/@ismaelssekatawa25/video/7330000000000000002',
      '*KATOSI MPUNGE LAKE VIEW ESTATE PLOTS FOR SALE!* 100ft x 50ft at 4millions Acre. 30millions negotiable Located in a tranquil and secure environment. Call +256749966423 Email. ismaelssekatawa25@gmail.com #realestateinvesting #plotsforsale',
    ].join('\n'),
  });
  const captionOnly = normalizeFoundOnlineSourcePost(captionOnlyRows[0]);
  const captionOnlyIntake = sourcePostMeetsLaunchIntakeRule(captionOnly, captionOnly.sourceAgent);
  assert.strictEqual(captionOnlyRows[0].area, 'Katosi', 'TikTok caption import should extract Katosi/Mpunge area evidence');
  assert.strictEqual(captionOnlyRows[0].district, 'Mukono', 'TikTok caption import should map Katosi/Mpunge to Mukono district');
  assert.strictEqual(captionOnlyRows[0].price_text, '30millions negotiable', 'TikTok caption import should parse plural/no-space Uganda price text');
  assert.strictEqual(captionOnlyRows[0].contact_phone, '+256749966423', 'TikTok caption import should extract public phone contact');
  assert.strictEqual(captionOnlyRows[0].contact_email, 'ismaelssekatawa25@gmail.com', 'TikTok caption import should extract public email contact');
  assert.strictEqual(captionOnly.price, 30000000, 'plural TikTok price text should normalize to UGX amount');
  assert.strictEqual(captionOnlyIntake.preapproved, false, 'caption-only TikTok posts should not pretend consent is already confirmed');
  assert.strictEqual(captionOnlyIntake.pending_king_source_review, true, 'social posts can enter King review while consent/date is confirmed');
  assert.strictEqual(captionOnlyIntake.eligible, true, 'exact TikTok posts with caption evidence should queue instead of failing with source-review only');

  const noPriceRows = buildTikTokExactPostImportRows({
    rawText: [
      'https://www.tiktok.com/@lizibweproperties/video/7330000000000000003',
      'Luxurious villa with swimming pool for sale in kololo +256743694821 #lizibweproperties #Kololo #KampalaRealEstate',
    ].join('\n'),
  });
  const noPricePost = normalizeFoundOnlineSourcePost(noPriceRows[0]);
  const noPriceIntake = sourcePostMeetsLaunchIntakeRule(noPricePost, noPricePost.sourceAgent);
  assert.strictEqual(noPriceRows[0].area, 'Kololo', 'TikTok no-price caption should still extract Kololo location evidence');
  assert.strictEqual(noPriceRows[0].price_text, '', 'TikTok no-price caption should not invent a numeric price');
  assert.strictEqual(noPricePost.price, null, 'TikTok no-price import should store a null numeric price');
  assert.strictEqual(noPriceIntake.has_price_or_guide_price, false, 'missing source price should stay visible in the intake metadata');
  assert.strictEqual(noPriceIntake.price_upon_application, true, 'missing source price should be marked Price upon application');
  assert.strictEqual(noPriceIntake.price_label, PRICE_UPON_APPLICATION_LABEL, 'missing source price should use the public price label');
  assert.strictEqual(noPriceIntake.eligible, true, 'exact TikTok posts with location/contact/source evidence should queue even when price is missing');

  const normalizedNdejje = normalizeFoundOnlineSourcePost(ndejjeRows[0]);
  assert.strictEqual(normalizedNdejje.district, 'Wakiso', 'source-post normalizer should preserve Ndejje as Wakiso for future imports');
  assert.strictEqual(normalizedNdejje.lat, 0.244, 'source-post normalizer should store an area-level pin when the source gives a known area');
  assert.strictEqual(normalizedNdejje.lng, 32.553, 'source-post normalizer should store an area-level pin when the source gives a known area');

  const automatedReview = buildAutomatedListingReview({
    listing: {
      title: 'Kololo villa for sale',
      description: 'Exact TikTok source post for King review.',
      district: 'Kampala',
      area: 'Kololo',
      listing_type: 'sale',
      price: null,
      extra_fields: { price_upon_application: true, price_label: PRICE_UPON_APPLICATION_LABEL }
    }
  });
  const pricingCheck = automatedReview.checks.find((check) => check.key === 'pricing_checked');
  assert.strictEqual(pricingCheck.status, 'pass', 'Price upon application should satisfy the pricing check for review imports');
});

test('social platform sweeps promote TikTok hashtags, YouTube videos, and X posts to import rows', () => {
  assert.strictEqual(SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID, 'social_platform_post_discovery_20260525');
  assert.strictEqual(MAX_PLATFORM_SWEEP_SOURCES, 30000);
  assert.strictEqual(YOUTUBE_SOURCE_POST_WINDOW_START, '2026-02-01T00:00:00.000Z');
  assert(propertySourceRegistrySource.includes("'CommercialPropertyKampala'"), 'TikTok/social watchlist should include commercial Kampala property hashtags');
  assert(propertySourceRegistrySource.includes("'StudentAccommodationMakerere'"), 'TikTok/social watchlist should include student accommodation hashtags');
  assert(propertySourceRegistrySource.includes("'StudentAccommodationUganda2026'"), 'TikTok/social watchlist should include 2026 student accommodation hashtags');
  assert(propertySourceRegistrySource.includes("'HostelsKampala'"), 'TikTok/social watchlist should include Kampala hostel hashtags');
  assert(propertySourceRegistrySource.includes("'CampusHostelsUganda'"), 'TikTok/social watchlist should include campus hostel hashtags');
  assert(propertySourceRegistrySource.includes("'KikuuboShops'"), 'TikTok/social watchlist should include commercial shop hashtags');
  assert(propertySourceRegistrySource.includes("'BujjukoLand'"), 'TikTok/social watchlist should include land/location-specific plot hashtags');
  assert(propertySourceRegistrySource.includes("'TikTok Uganda student hostels'"), 'generated discovery intents should target TikTok student property posts');
  assert(propertySourceRegistrySource.includes("'Facebook Uganda land plots'"), 'generated discovery intents should target Facebook land property posts');
  const sourceRegistry = getPropertySourceRegistry();
  const tiktokSourceUrls = sourceRegistry
    .filter((source) => String(source.platform || '').toLowerCase() === 'tiktok')
    .map((source) => String(source.url || '').toLowerCase());
  assert.strictEqual(sourceRegistry.length, 30000, 'source registry should still build the full 30,000-source discovery database');
  assert(tiktokSourceUrls.some((url) => url.includes('/tag/studentaccommodationmakerere')), 'TikTok registry should track student-specific hashtags');
  assert(tiktokSourceUrls.some((url) => url.includes('/tag/studentaccommodationuganda2026')), 'TikTok registry should track new student accommodation hashtags');
  assert(tiktokSourceUrls.some((url) => url.includes('/tag/hostelskampala')), 'TikTok registry should track wider Kampala hostel hashtags');
  assert(tiktokSourceUrls.some((url) => url.includes('/tag/commercialpropertykampala')), 'TikTok registry should track commercial property hashtags');
  assert(tiktokSourceUrls.some((url) => url.includes('/tag/kikuuboshops')), 'TikTok registry should track commercial shop hashtags');
  assert(tiktokSourceUrls.some((url) => url.includes('/tag/bujjukoland') || url.includes('/tag/bujuukoland')), 'TikTok registry should track Bujjuko/Bujuuko land hashtags');
  assert.strictEqual(pkg.scripts['inventory:sweep-social-platforms'], 'node scripts/sweep-social-platform-posts.js');
  assert(socialPlatformSweepScript.includes('--platform=tiktok --dry-run'), 'social sweep script should expose TikTok hashtag capture mode');
  assert(socialPlatformSweepScript.includes('--platform=youtube --confirm'), 'social sweep script should expose YouTube API import mode');
  assert(socialPlatformSweepScript.includes('--published-after=2026-02-01T00:00:00.000Z'), 'social sweep script should expose the February YouTube start date');
  assert(socialPlatformSweepScript.includes('--platform=x --confirm'), 'social sweep script should expose X import mode');
  assert(socialPlatformSweepScript.includes('--lookback-days'), 'social sweep script should support two-week X/Twitter lookback sweeps');
  assert(adminRoute.includes("router.post('/social-platform-posts/sweep'"), 'admin should expose a protected social platform sweep endpoint');
  assert(adminRoute.includes("router.post('/exact-social-source-posts/import'"), 'admin should expose a no-API exact social link import endpoint');
  assert(adminRoute.includes("router.post('/tiktok-source-posts/import'"), 'admin should expose a protected exact TikTok post import endpoint');
  assert(adminRoute.includes('admin_exact_social_source_posts_imported'), 'exact social link imports should write an audit event');
  assert(adminRoute.includes('admin_tiktok_exact_posts_imported'), 'exact TikTok post imports should write an audit event');
  assert(adminRoute.includes('admin_social_platform_posts_sweep'), 'social platform sweeps should write an audit event');
  assert(frontend.includes('adminSweepSocialPlatformPosts'), 'King dashboard should expose social platform sweep controls');
  assert(frontend.includes('adminImportExactSocialLinks'), 'King dashboard should expose no-API exact social link import controls');
  assert(frontend.includes('adminImportTikTokExactPosts'), 'King dashboard should expose exact TikTok video import controls');
  assert(frontend.includes('Import Social Links'), 'King dashboard should expose exact social link import action');
  assert(frontend.includes('Sweep TikTok Hashtags'), 'King dashboard should expose TikTok hashtag sweep action');
  assert(frontend.includes('Import TikTok Videos'), 'King dashboard should expose exact TikTok video import action');
  assert(frontend.includes('Sweep YouTube Videos'), 'King dashboard should expose YouTube video sweep action');
  assert(frontend.includes('published_after: "2026-02-01T00:00:00.000Z"'), 'King dashboard should sweep YouTube from February 2026 onward');
  assert(frontend.includes('getTikTokEmbedUrl'), 'public property detail should support TikTok video embeds');
  assert(frontend.includes('https://www.tiktok.com/embed/v2/'), 'TikTok source videos should render with TikTok embed URLs');
  assert(frontend.includes('safeVideoIsTikTok'), 'TikTok videos should be labelled separately from YouTube videos');
  assert(propertiesRoute.includes('tiktok_url: tiktokUrl || null'), 'public property API should expose exact TikTok source video URLs');
  assert(frontend.includes('Sweep X Posts'), 'King dashboard should expose X post sweep action');
  assert(socialPlatformSweepServiceSource.includes('YOUTUBE_API_KEY'), 'YouTube sweep should use an explicit API key env var');
  assert.strictEqual(YOUTUBE_OEMBED_URL, 'https://www.youtube.com/oembed', 'no-API YouTube imports should use public oEmbed metadata');
  assert(socialPlatformSweepServiceSource.includes('no_api_exact_social_url_intake'), 'exact social link import should provide a no-API workaround path');
  assert(socialPlatformSweepServiceSource.includes('inferTikTokPostedAtFromVideoId'), 'TikTok exact-link import should infer visible-date evidence from public video IDs when no API exists');
  assert(socialPlatformSweepServiceSource.includes('inferXPostedAtFromStatusId'), 'X exact-link import should infer post dates from public status IDs when no API exists');
  assert(socialPlatformSweepServiceSource.includes('snippet.publishedAt'), 'YouTube sweep policy should explain the source publish date comes from YouTube snippet.publishedAt');
  assert(socialPlatformSweepServiceSource.includes('X_BEARER_TOKEN'), 'X sweep should use an explicit bearer-token env var');
  assert(socialPlatformSweepServiceSource.includes('createProfilesForRepeatedSourcesOnly: false'), 'platform sweep should not auto-create source broker profiles');
  assert(frontend.includes('max_sources: normalized === "tiktok" ? 30000 : normalized === "youtube" ? 250 : 40'), 'TikTok sweep should request every tracked TikTok source and YouTube should use a Render-safe API batch');
  assert(socialSearchServiceSource.includes('defer_until_agent_claims_profile'), 'source-post import should defer source profiles until the source owner registers or claims them');

  const tiktokTasks = buildTikTokCaptureTasks({
    sources: [{
      key: 'tiktok-uganda-real-estate-hashtag',
      name: 'TikTok #UgandaRealEstate',
      platform: 'tiktok',
      sourceType: 'hashtag_feed',
      url: 'https://www.tiktok.com/tag/ugandarealestate',
      hashtags: ['UgandaRealEstate'],
    }],
    limit: 1,
  });
  assert.strictEqual(tiktokTasks.length, 1);
  assert.strictEqual(tiktokTasks[0].exact_post_url_required, true);
  assert(tiktokTasks[0].exact_post_url_pattern.includes('/@{handle}/video/{video_id}'), 'TikTok task should name the exact-video URL pattern');

  assert.deepStrictEqual(extractExactSocialPostUrls('Watch https://youtu.be/abc123XYZ90 and https://www.tiktok.com/@agentug/video/7330000000000000001'), [
    'https://www.youtube.com/watch?v=abc123XYZ90',
    'https://www.tiktok.com/@agentug/video/7330000000000000001',
  ]);
  assert.strictEqual(normalizeExactSocialPostUrl('https://twitter.com/agentug/status/1800000000000000000'), 'https://x.com/agentug/status/1800000000000000000');
  const noApiRows = buildExactSocialPostImportRows({
    rawText: [
      'https://www.tiktok.com/@agentug/video/7608944105338457364',
      'title: Luxury Kampala apartment 3 bedrooms USh 3.5M',
      'location: Makerere, Kampala',
      'source: Space Residences Uganda',
      'phone: +256700000000',
    ].join('\n'),
    metadataByUrl: {
      'https://www.tiktok.com/@agentug/video/7608944105338457364': {
        oembed: {
          title: 'Luxury Kampala apartment 3 bedrooms USh 3.5M',
          author_name: 'Space Residences Uganda',
          author_url: 'https://www.tiktok.com/@agentug',
          thumbnail_url: 'https://p16-sign.tiktokcdn-us.com/example.jpeg',
        },
      },
    },
  });
  assert.strictEqual(noApiRows.length, 1, 'no-API exact social import should create one import row');
  assert.strictEqual(noApiRows[0].platform, 'TikTok');
  assert.strictEqual(noApiRows[0].area, 'Makerere');
  assert.strictEqual(noApiRows[0].listing_type, 'students');
  assert.strictEqual(noApiRows[0].source_contact_url, 'https://www.tiktok.com/@agentug');
  assert(noApiRows[0].first_posted_at.startsWith('2026-'), 'TikTok public video ID should infer a 2026 first-posted timestamp');

  const youtubeJobs = buildYouTubeSearchJobs({
    sources: [{
      key: 'youtube-student-hostels-kampala-search',
      name: 'YouTube search: Kampala student hostels',
      platform: 'youtube',
      sourceType: 'public_video_search_feed',
      url: 'https://www.youtube.com/results?search_query=Kampala+student+hostel+rooms+Uganda',
      hashtags: ['StudentAccommodationUganda2026', 'HostelsKampala'],
    }],
    limit: 1,
    publishedAfter: '2026-02-01T00:00:00.000Z',
  });
  assert.strictEqual(youtubeJobs.length, 1);
  assert.strictEqual(youtubeJobs[0].published_after, '2026-02-01T00:00:00.000Z', 'YouTube jobs should start from the requested February window');
  assert.strictEqual(youtubeJobs[0].includes_shorts_and_long_form, true, 'YouTube jobs should not exclude Shorts or long-form videos');
  const normalizedYoutube = normalizeYouTubeApiPost({
    id: { videoId: 'abc123XYZ90' },
    snippet: {
      publishedAt: '2026-02-12T08:30:00.000Z',
      title: 'Kampala student hostel room near Makerere USh 450k',
      description: 'Self contained room near Makerere. Call +256700000000',
      channelId: 'UCexample',
      channelTitle: 'Student Rooms UG',
      thumbnails: { high: { url: 'https://i.ytimg.com/vi/abc123XYZ90/hqdefault.jpg' } },
    },
  }, youtubeJobs[0]);
  assert.strictEqual(normalizedYoutube.source_url, 'https://www.youtube.com/watch?v=abc123XYZ90');
  assert.strictEqual(normalizedYoutube.youtube_published_at, '2026-02-12T08:30:00.000Z');
  assert.strictEqual(normalizedYoutube.first_posted_at, '2026-02-12T08:30:00.000Z', 'YouTube imports should carry the first-posted platform date');
  assert.strictEqual(normalizedYoutube.source_page_url, 'https://www.youtube.com/channel/UCexample');
  assert.strictEqual(normalizedYoutube.area, 'Makerere');
  assert.strictEqual(normalizedYoutube.listing_type, 'students');
  assert.deepStrictEqual(normalizedYoutube.image_urls, ['https://i.ytimg.com/vi/abc123XYZ90/hqdefault.jpg']);

  const xJobs = buildXSearchJobs({
    sources: [{
      key: 'x-uganda-property',
      name: 'X Uganda property search',
      platform: 'x',
      sourceType: 'search_feed',
      url: 'https://x.com/search?q=%23UgandaRealEstate%20Uganda%20property&src=typed_query&f=live',
    }],
    limit: 1,
  });
  assert.strictEqual(xJobs.length, 1);
  assert(xJobs[0].query.includes('has:media'), 'X search jobs should request media-backed posts');
  assert(xJobs[0].endpoint.includes('/2/tweets/search/all'), 'X full archive search should be available for 2026-onward sweeps');
  const xLookbackJobs = buildXSearchJobs({
    sources: [{
      key: 'x-uganda-property-lookback',
      name: 'X Uganda property lookback',
      platform: 'x',
      sourceType: 'search_feed',
      url: 'https://x.com/search?q=%23UgandaRealEstate%20Uganda%20property&src=typed_query&f=live',
    }],
    limit: 1,
    startTime: '2026-05-12T00:00:00.000Z',
  });
  assert.strictEqual(xLookbackJobs[0].start_time, '2026-05-12T00:00:00.000Z', 'X full archive jobs should accept a 14-day lookback start time');

  const normalized = normalizeXApiPost({
    id: '1800000000000000000',
    author_id: '42',
    created_at: '2026-05-20T10:00:00.000Z',
    text: '4 bed house for sale in Kira, Wakiso. USh 650M. DM for viewing.',
    attachments: { media_keys: ['3_1'] },
  }, {
    users: [{ id: '42', username: 'agentug', name: 'Agent UG', public_metrics: { followers_count: 1200 } }],
    media: [{ media_key: '3_1', type: 'photo', url: 'https://pbs.twimg.com/media/example.jpg' }],
  }, xJobs[0]);
  assert.strictEqual(normalized.source_url, 'https://x.com/agentug/status/1800000000000000000');
  assert.strictEqual(normalized.platform, 'x');
  assert.strictEqual(normalized.area, 'Kira');
  assert.strictEqual(normalized.district, 'Wakiso');
  assert.strictEqual(normalized.price_text, 'USh 650M');
  assert.deepStrictEqual(normalized.image_urls, ['https://pbs.twimg.com/media/example.jpg']);
});

test('found-online rebuild protects live approved social-search listings', () => {
  assert(socialSearchServiceSource.includes("COALESCE(status, 'pending') NOT IN ('approved', 'live', 'published', 'sold')"), 'replace cleanup must not delete already-live found-online records');
  assert(socialSearchServiceSource.includes('const existingListingKeys = await existingSocialSearchListingKeys(client);'), 'seed should skip preserved live records after cleanup');
});

test('found-online social search admin path and share cards are protected and auditable', () => {
  assert(adminRoute.includes("router.post('/social-search-authorised-listings/seed'"), 'admin found-online seed endpoint should exist');
  assert(adminRoute.includes('seedSocialSearchAuthorisedListings'), 'admin endpoint should use the social search seed service');
  assert(adminRoute.includes('admin_social_search_authorised_listings_seeded'), 'admin endpoint should write found-online audit trail');
  assert(adminRoute.includes("router.post('/found-online-source-posts/import'"), 'admin should expose a protected source-post import endpoint');
  assert(adminRoute.includes('queueFoundOnlineSourcePostListings'), 'admin import endpoint should queue extracted source posts');
  assert(adminRoute.includes('admin_found_online_source_posts_imported'), 'admin source-post import should be audited');
  assert.strictEqual(pkg.scripts['inventory:import-source-posts'], 'node scripts/import-found-online-source-posts.js', 'package should expose the source-post import command');
  assert(read('scripts/import-found-online-source-posts.js').includes('--input posts.csv --confirm'), 'source-post import script should accept CSV/JSON files');
  assert(read('scripts/import-found-online-source-posts.js').includes('location or area is required'), 'source-post import script should make location the non-negotiable field');
  assert(read('scripts/import-found-online-source-posts.js').includes('King can override non-location checks'), 'source-post import script should explain relaxed source-review approval');
  assert(read('scripts/import-found-online-source-posts.js').includes('createProfilesForRepeatedSourcesOnly: false'), 'source-post import script should not auto-create source broker profiles');
  assert(read('services/socialSearchSourcedListingsService.js').includes('skipped_listings'), 'seed should skip incomplete evidence sources instead of crashing the whole batch');
  assert(read('services/socialSearchSourcedListingsService.js').includes('source_contact_url'), 'seed should keep a social/source contact URL for no-phone sourced listings');
  assert(read('routes/properties.js').includes('sourceContactUrl = safePublicSourceUrl'), 'public property API should expose a source/contact URL fallback for found-online records');
  assert(read('routes/properties.js').includes("`Contact via ${sourceContactPlatform || 'source'} source`"), 'public property API should label source contact by platform when direct phone is absent');
  assert(read('services/socialSearchSourcedListingsService.js').includes('missing_any_public_contact_path'), 'seed should treat social pages as a usable contact path before skipping a source');
  assert(read('services/socialSearchSourcedListingsService.js').includes('existingSocialSearchListingKeys'), 'daily found-online sweeps should skip already queued listing keys');
  assert(read('services/socialSearchSourcedListingsService.js').includes("'already_queued'"), 'daily found-online sweeps should report already queued records');
  assert(read('services/socialSearchSourcedListingsService.js').includes("'already_live_or_approved'"), 'daily found-online sweeps should report already-live records separately from queued records');
  assert(read('services/socialSearchSourcedListingsService.js').includes('already_present_properties'), 'daily found-online sweeps should return existing records with direct review/live links');
  assert(read('services/socialSearchSourcedListingsService.js').includes('review_queue_listings'), 'daily found-online sweeps should return only pending review records for the King pending panel');
  assert(read('services/socialSearchSourcedListingsService.js').includes('already_live_or_approved_properties'), 'daily found-online sweeps should separate already-live records from the pending panel');
  assert(read('services/socialSearchSourcedListingsService.js').includes('source_review_records'), 'daily found-online sweeps should expose source-review records separately');
  assert(read('services/socialSearchSourcedListingsService.js').includes('daily_target_status'), 'daily found-online sweeps should return 200/day target status for King');
  assert(read('services/socialSearchSourcedListingsService.js').includes('function sourcePlatformFor'), 'daily found-online sweeps should normalize source platform metadata');
  assert(read('services/socialSearchSourcedListingsService.js').includes('sourcePlatformFeedLabel'), 'daily found-online sweeps should label platform-specific feeds');
  assert(read('services/socialSearchSourcedListingsService.js').includes('no_phone_source_contact_policy'), 'daily found-online sweeps should expose no-phone source contact policy');
  assert(read('services/socialSearchSourcedListingsService.js').includes('source_page_vs_property_policy'), 'daily found-online sweeps should explain source pages versus queued properties');
  assert(read('services/socialSearchSourcedListingsService.js').includes('sourcePostMeetsLaunchIntakeRule'), 'daily found-online sweeps should gate property posts through the 2026+ found-online intake rule');
  assert(read('services/socialSearchSourcedListingsService.js').includes('PUBLIC_SOURCE_CONTACT_POLICY'), 'daily found-online sweeps should treat public social pages as contact routes');
  assert(read('services/socialSearchSourcedListingsService.js').includes('facebook_image_policy'), 'daily found-online sweeps should explain Facebook image handling');
  assert(frontend.includes('async function adminSeedSocialSearchAuthorisedListings'), 'dashboard should implement found-online seed action');
  assert(frontend.includes('async function adminImportFoundOnlineSourcePosts'), 'dashboard should implement source-post import action');
  assert(frontend.includes('Queue Found-Online Properties'), 'dashboard should label the found-online queue action');
  assert(frontend.includes('Import Source Posts'), 'dashboard should expose source-post import action');
  assert(frontend.includes('already live/approved records were hidden from this pending panel'), 'dashboard should hide approved/live records from pending moderation status cards');
  assert(frontend.includes('adminSourceReviewRecordSummaryHtml'), 'dashboard should render source-review records with source/contact links');
  assert(frontend.includes('Website-only sources are ignored'), 'dashboard should explain website-only sources are blocked');
  assert(frontend.includes('source pages/feeds are parked for source review, not hidden properties'), 'dashboard should clarify source-review records are not pending properties');
  assert(frontend.includes('from 1 January 2026 onward'), 'dashboard should communicate the found-online source window');
  assert(frontend.includes('No phone number is not a blocker if a public social profile exists'), 'dashboard should explain source-review no-phone policy');
  assert(frontend.includes('Website-only sources are disabled'), 'source database should explain website sources are not imported as properties');
  assert(frontend.includes('Open Source'), 'seed summaries should use a platform-neutral source action label');
  assert(frontend.includes('getYouTubeEmbedUrl(videoUrl)'), 'found-online source cards should use official YouTube embeds when available');
  assert(frontend.includes('getTikTokEmbedUrl(videoUrl)'), 'found-online source cards should use official TikTok embeds when available');
  assert(frontend.includes('Official platform embed. Makaug does not re-host social media photos or videos.'), 'found-online source cards should label official embeds without rehosting media');
  assert(frontend.includes('foundOnlineSourceContactButtonLabel'), 'public listing detail should build a platform-specific source contact CTA');
  assert(frontend.includes('p.source_contact_url'), 'public listing detail should fall back to top-level source contact fields as well as extra_fields');
  assert(frontend.includes('Contact via {platform} source'), 'public listing detail should label TikTok/Facebook/X source contact buttons by platform');
  assert(frontend.includes('Contact through source'), 'public listing detail should replace internal enquiry forms on found-online listings');
  assert(frontend.includes('Makaug does not send enquiries to this lister'), 'found-online contact copy should not promise internal enquiry delivery');
  assert(frontend.includes('admin-review-location-map'), 'King review should include an editable map pin section');
  assert(frontend.includes('initAdminReviewLocationMap'), 'King review should initialize the editable review map');
  assert(frontend.includes('adminReviewUseMapPin'), 'King review should save map pin coordinates back to the listing fields');
  assert(frontend.includes('Land image rule'), 'dashboard should explain the land-image fallback strategy');
  assert(frontend.includes('Morning sweep target'), 'dashboard should show the daily evidence-ready target/gap after a sweep');
  const listing = plannedSocialSearchListings()[0];
  const card = socialSearchWhatsappShareMessage(
    listing.source_item,
    'https://makaug.com/property/example-id',
    'https://makaug.com/?listing_preview=1&listing=example-id&token=example-token'
  );
  assert(card.includes('https://makaug.com/property/example-id'), 'share card should include the future public listing URL');
  assert(card.includes('https://makaug.com/?listing_preview=1'), 'share card should include the private preview URL');
  assert(card.includes(`https://www.youtube.com/watch?v=${listing.source_item.youtubeId}`), 'share card should include the source video');
  assert(card.includes('Call/WhatsApp'), 'share card should include contact wording when a phone exists');
});

test('found-online public-launch migration is superseded by social-only preapproval cleanup', () => {
  assert(foundOnlinePublicLaunchMigration.includes('found_online_public_launch_20260524'), 'public launch migration should carry a traceable batch id');
  assert(foundOnlinePublicLaunchMigration.includes("status = 'approved'"), 'legacy launch migration should remain traceable');
  assert(foundOnlinePublicLaunchMigration.includes("source = 'found_online_property_source_v1'"), 'public launch migration should only target found-online source rows');
  assert(foundOnlinePublicLaunchMigration.includes("extra_fields->>'source_url'"), 'public launch migration should require source URL evidence');
  assert(foundOnlinePublicLaunchMigration.includes('price IS NOT NULL'), 'public launch migration should require price evidence');
  assert(foundOnlinePublicLaunchMigration.includes("COALESCE(area, '') <> ''"), 'public launch migration should require location/area evidence');
  assert(foundOnlinePublicLaunchMigration.includes('approval_disclaimer'), 'public launch migration should keep public verification disclaimer metadata');
  assert(foundOnlinePublicLaunchMigration.includes('ownership_verification_status'), 'public launch migration should not pretend ownership is fully verified');
  assert(foundOnlinePublicLaunchMigration.includes('source_rights_status'), 'public launch migration should keep media/source rights review metadata');
  assert(foundOnlinePublicLaunchMigration.includes('found_online_public_launch_published'), 'public launch migration should log moderation events');
  assert(socialOnlyPreapprovedCleanupMigration.includes("status = 'deleted'"), 'social-only cleanup should remove unapproved found-online rows from public inventory');
  assert(socialOnlyPreapprovedCleanupMigration.includes('preapproval_required_for_reimport'), 'cleanup should require preapproval before any reimport');
  assert(strictFoundOnlinePreapprovalMigration.includes("status = 'deleted'"), 'strict cleanup should delete legacy implicitly approved found-online rows');
  assert(strictFoundOnlinePreapprovalMigration.includes('strict_found_online_preapproval_20260525'), 'strict cleanup should tag the exact removal batch');
  assert(youtubeSocialRestoreMigration.includes('youtube_social_found_online_restore_20260525'), 'restore migration should tag the YouTube social restoration batch');
  assert(youtubeSocialRestoreMigration.includes("status = 'approved'"), 'restore migration should return accepted YouTube social rows to public approved inventory');
  assert(youtubeSocialRestoreMigration.includes("LOWER(COALESCE(p.extra_fields->>'source_platform', '')) = 'youtube'"), 'restore migration should be scoped to YouTube social rows only');
  assert(youtubeSocialRepublishMigration.includes('youtube_social_batch_republish_20260525'), 'republish migration should tag the deterministic YouTube source repair batch');
  assert(youtubeSocialRepublishMigration.includes("'approved_youtube_social_source'"), 'republish migration should approve curated YouTube social-source rows');
  assert(youtubeSocialRepublishMigration.includes("'source_batch', 'social_search_authorised_20260520'"), 'republish migration should preserve the curated social-search batch id');
  assert(youtubeSocialRepublishMigration.includes('https://i.ytimg.com/vi/'), 'republish migration should attach YouTube source stills for public cards');
  assert(healthRoute.includes('050_publish_found_online_launch_inventory.sql'), 'migration health should expose found-online public launch migration');
  assert(healthRoute.includes('051_enforce_social_only_preapproved_inventory.sql'), 'migration health should expose social-only cleanup migration');
  assert(healthRoute.includes('052_remove_implicit_found_online_approvals.sql'), 'migration health should expose strict implicit-approval cleanup migration');
  assert(healthRoute.includes('054_restore_youtube_social_found_online_inventory.sql'), 'migration health should expose YouTube social restore migration');
  assert(healthRoute.includes('055_republish_curated_youtube_social_inventory.sql'), 'migration health should expose deterministic YouTube social republish migration');
});

test('King review preview opens pending listings through a protected admin route', () => {
  assert(adminRoute.includes("router.get('/properties/:id/live-preview'"), 'admin live-style preview endpoint should exist');
  assert(adminRoute.includes('buildAdminLivePreviewPayload'), 'admin preview should return a consumer-shaped listing payload');
  assert(adminRoute.includes('p.id::text = $1 OR p.inquiry_reference = $1'), 'admin preview should find listings by UUID or reference');
  assert(frontend.includes('/api/admin/properties/${encodeURIComponent(listingId)}/live-preview'), 'review button should call the protected admin preview route');
  assert(frontend.includes('admin_live_style_preview'), 'admin preview opens should be tracked separately from public views');
});

test('King review can correct sourced listing facts before approval', () => {
  assert(adminRoute.includes('listing_type = $'), 'admin review edits should be able to correct sale/rent/student/commercial/land type');
  assert(adminRoute.includes('LISTING_TYPES.includes'), 'admin review listing type edits should be validated');
  assert(adminRoute.includes('latitude = $') && adminRoute.includes('longitude = $'), 'admin review edits should be able to correct map coordinates');
  assert(frontend.includes('Edit public listing facts before approval'), 'King review should expose a listing fact editor');
  assert(frontend.includes('Use extracted source details'), 'King review should offer source-caption extraction into card fields');
  assert(frontend.includes('function adminExtractReviewFacts'), 'King review should parse source text into editable listing facts');
  assert(frontend.includes('function collectAdminReviewListingPatch'), 'King review save should collect edited listing fields');
  assert(frontend.includes('listing: listingPatch'), 'King review save should send listing edits through the review endpoint');
  assert(frontend.includes('admin-review-listing-type-edit'), 'King review should allow changing sale/rent type');
  assert(frontend.includes('admin-review-area-edit') && frontend.includes('admin-review-district-edit'), 'King review should allow location correction');
  assert(frontend.includes('Shorten description'), 'King review should provide a concise public description action');
});

test('King review queue can manage authorised listing photos', () => {
  assert(adminRoute.includes("router.post('/properties/:id/images'"), 'admin should be able to add listing photos');
  assert(adminRoute.includes("router.patch('/properties/:id/images/:imageId'"), 'admin should be able to replace/set primary listing photos');
  assert(adminRoute.includes("router.delete('/properties/:id/images/:imageId'"), 'admin should be able to delete listing photos');
  assert(adminRoute.includes('Admin image upload requires image rights confirmation'), 'admin photo upload should require rights confirmation');
  assert(adminRoute.includes('admin_uploaded_authorised_images'), 'admin uploads should mark sourced candidates as having authorised images');
  assert(frontend.includes('function adminUploadListingPhotos'), 'dashboard should expose bulk listing photo upload');
  assert(frontend.includes('function adminReplaceListingPhoto'), 'dashboard should expose per-photo replacement');
  assert(frontend.includes('function adminSetListingPhotoPrimary'), 'dashboard should allow choosing the primary image');
  assert(frontend.includes('function adminDeleteListingPhoto'), 'dashboard should allow deleting bad listing images');
  assert(frontend.includes('data-admin-photo-delete-button'), 'photo delete should use stable inline confirmation buttons');
  assert(frontend.includes('Confirm delete'), 'photo delete confirmation should stay inside the photo card');
  assert(!frontend.includes('window.confirm("Remove this photo from the listing?")'), 'photo delete should not use unstable native confirm dialogs');
  assert(frontend.includes('Upload authorised agent photos'), 'photo panel should make the agent-photo workflow visible');
  assert(frontend.includes('Replace all current photos'), 'photo panel should support replacing poor existing images');
});

test('Bakaima WhatsApp share card carries listing URL and agent contact', () => {
  const platinum = plannedBakaimaListings().find((listing) => /Platinum Estate/i.test(listing.title));
  assert(platinum, 'Platinum Estate listing should be prepared from the supplied flyer');
  assert(platinum.images.length >= 3, 'Platinum listing should include share card, specific flyer, and price sheet');
  const card = whatsappShareMessage(platinum.source_item, 'https://makaug.com/property/example-id');
  assert(card.includes('https://makaug.com/property/example-id'), 'share card should include live listing URL');
  assert(card.includes(BAKAIMA_CONTACT.phone), 'share card should include primary Bakaima phone');
  assert(card.includes(BAKAIMA_CONTACT.phoneAlt), 'share card should include alternate Bakaima phone');
  assert(card.includes('Price: USh 70,000,000'), 'share card should carry flyer price');
});
