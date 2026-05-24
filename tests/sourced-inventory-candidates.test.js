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
const bakaimaPublicCopyMigration = read('db/migrations/041_remove_bakaima_public_approval_copy.sql');
const foundOnlineSecondSweepMigration = read('db/migrations/045_expand_found_online_sweep_images_and_sources.sql');
const foundOnlinePublicLaunchMigration = read('db/migrations/050_publish_found_online_launch_inventory.sql');
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
  normalizeFoundOnlineSourcePost,
  plannedSocialSearchListings,
  queueFoundOnlineSourcePostListings,
  summarizeSocialSearchListings,
  sourcePostMeetsLaunchIntakeRule,
  sourceImageRowsFor,
  whatsappShareMessage: socialSearchWhatsappShareMessage,
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
  assert(frontend.includes('verify consent, contact details, authorised photos'), 'review panel should show verification warning');
  assert(frontend.includes('function adminSourcedCandidateSourceLinks'), 'review panel should expose stored source/photo evidence links');
  assert(frontend.includes('image.source_url, image.source_link, image.original_url, image.url'), 'source links should include attached image URLs such as YouTube stills');
  assert(frontend.includes('function adminFoundOnlineSourceSummaryHtml'), 'dashboard should summarize source name, first-posted date, and source link inline');
  assert(frontend.includes('First posted/seen'), 'pending queue should display the first posted/seen source date');
  assert(frontend.includes('Open source'), 'pending queue should expose source click-through links');
  assert(frontend.includes('adminApproveSourcedCandidateOverride'), 'dashboard should expose found-online approval control');
  assert(frontend.includes('function adminEvidenceDownloadFilename'), 'evidence downloads should use a filename matching the actual mime type');
  assert(frontend.includes('function adminIsGeneratedPlaceholderPhoto'), 'dashboard should detect generated placeholder images');
  assert(frontend.includes('Placeholder images are attached'), 'dashboard should warn when images are placeholders');
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
  assert(propertiesRoute.includes('consent_confirmed'), 'override should require consent confirmation');
  assert(propertiesRoute.includes('image_rights_confirmed'), 'override should require image rights confirmation');
  assert(propertiesRoute.includes('sourcedCandidateRecordReadyForOverride'), 'override should verify the stored record is ready, not only the request body');
  assert(propertiesRoute.includes('generated_placeholder_images_only'), 'override should reject records that still use generated placeholders');
  assert(propertiesRoute.includes('Authorised found-online photos must be imported before approval'), 'override error should explain authorised photos are required');
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
  assert(frontend.includes('adminPendingQueueFilter = "found_online"'), 'found-online sweep should switch the Review Queue to the found-online filter');
  assert(frontend.includes('Show all found-online pending records'), 'seed status should expose a direct action to the full found-online queue');
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
  assert(frontend.includes('sourceBatch === "social_search_authorised_20260520"'), 'public UI should recognise the social-search batch');
  assert(frontend.includes('listingFreshnessBadgeHtml(p)'), 'property cards should render the found-online badge helper');
  assert(frontend.includes('"Found online": "Kizuuliddwa ku mutimbagano"'), 'Luganda should include found-online copy');
  assert(frontend.includes('"Found online": "Imepatikana mtandaoni"'), 'Kiswahili should include found-online copy');
  assert(frontend.includes('"First posted online"'), 'source disclosure should translate first-posted metadata');
  assert(frontend.includes('"First picked up by makaug"'), 'source disclosure should translate first-picked-up metadata');
  assert(frontend.includes('"Contact via source"'), 'source disclosure should translate contact-through-source action');
  assert(frontend.includes('Original post date is being confirmed from the source platform'), 'source disclosure should explain when platform post date is not exposed');
  assert(frontend.includes('function selectDetailGalleryPhoto'), 'detail gallery thumbnails should switch the main image before opening the lightbox');
  assert(frontend.includes('detail-broker-profile-link'), 'detail contact card should make broker logo/name click through to the profile');
});

test('public property images escape and normalize generated SVG evidence cards', () => {
  assert(frontend.includes('function normalizeImageSrcForDisplay'), 'frontend should normalize generated SVG data URLs before rendering');
  assert(frontend.includes('data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}'), 'SVG data URLs should be encoded for mobile browsers');
  assert(frontend.includes('const photoSrc = publicImageSrc(p.img'), 'public listing cards should normalize the main image source');
  assert(frontend.includes('<img src="${adminAttr(photoSrc)}" alt="${adminAttr(p.title)}"'), 'public listing cards should escape image src and title attributes');
  assert(frontend.includes('const selectedPhotoSrc = publicImageSrc(selectedPhoto?.url || p.img'), 'detail gallery should normalize the selected image source');
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
  assert(frontend.includes('mergeNearbyPlacesForUi(savedNearbyRaw, suggestedNearbyRaw)'), 'detail page should enrich saved amenities with nearby hospitals and schools');
  assert(frontend.includes('extra.nearby_facilities'), 'property search should include persisted nearby facility names');
});

test('Carnelian broker profile is click-through with social links and live listings', () => {
  assert.strictEqual(CARNELIAN_CONTACT.tiktok, 'https://www.tiktok.com/@carnelian.propert');
  assert(agentsRoute.includes('CARNELIAN-YOUTUBE-20260519'), 'agent API should identify the Carnelian sourced profile');
  assert(agentsRoute.includes('youtube_url'), 'agent API should expose YouTube social link fields');
  assert(agentsRoute.includes('tiktok_url'), 'agent API should expose TikTok social link fields');
  assert(agentsRoute.includes("WHERE p.agent_id = $1 AND p.status = 'approved'"), 'agent detail should only publish approved profile listings');
  assert(agentsRoute.includes('img.url AS primary_image_url'), 'agent profile listings should carry primary images');
  assert(frontend.includes('async function loadRemoteBrokerProfileForUi'), 'frontend should fetch broker detail before opening profile');
  assert(frontend.includes('async function openBrokerProfile'), 'broker profile open should wait for the remote profile when needed');
  assert(frontend.includes('renderBrokerSocialLinks(b)'), 'broker profile should render socials');
  assert(frontend.includes('remote_listings'), 'broker profile should use live listings returned by the agent API');
  assert(frontend.includes('View Profile'), 'broker cards should expose a visible profile action');
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

test('found-online social search batch creates pending listings with agent profiles and evidence', () => {
  const summary = summarizeSocialSearchListings();
  const listings = plannedSocialSearchListings(Object.fromEntries(SOCIAL_SEARCH_AGENTS.map((agent, index) => [agent.key, `agent-${index}`])));
  assert.strictEqual(SOCIAL_SEARCH_BATCH_ID, 'social_search_authorised_20260520');
  assert.strictEqual(summary.count, 18, 'social search batch should contain the high-confidence recent public property records');
  assert.strictEqual(summary.agents_count, 7, 'social search batch should prepare the seven permitted agent profiles');
  assert.strictEqual(summary.daily_target_status.target, 200, 'morning sweep should expose the 200/day property queue target');
  assert.strictEqual(summary.daily_target_status.eligible_to_queue_count, summary.seed_eligible_count, 'daily target status should count every launch-intake candidate with source evidence and a contact path');
  assert(summary.daily_target_status.target_gap > 0, 'daily target status should make the current evidence gap visible');
  assert.strictEqual(summary.daily_target_status.meets_daily_minimum, false, 'current curated list should not pretend it meets the 200/day minimum');
  assert(/from 1 January 2026 onward/i.test(summary.daily_target_status.evidence_policy), 'daily target status should express the 2026+ found-online intake rule');
  assert.strictEqual(LAUNCH_SOURCE_POST_WINDOW_START, '2026-01-01T00:00:00.000Z', 'launch intake should scan from 1 January 2026');
  assert(/Facebook/i.test(FOUND_ONLINE_LAUNCH_INTAKE_POLICY.facebook_image_rule), 'launch intake should define how Facebook images are handled');
  assert(/No public phone number is not a blocker/i.test(summary.daily_target_status.no_phone_source_contact_policy), 'daily target status should explain social/source contact fallback');
  assert(/X\/Twitter, Instagram, TikTok, YouTube, Facebook/i.test(summary.daily_target_status.source_page_vs_property_policy), 'daily target status should separate monitored cross-platform sources from queued properties');
  assert.strictEqual(SOCIAL_SEARCH_LISTINGS.length, listings.length, 'planned social search listings should match source records');
  assert(summary.by_type.sale >= 14, 'social search batch should prioritise sale listings from the provided channels');
  assert(summary.by_type.land >= 2, 'social search batch should include land records where the source gives land detail');
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
    assert.strictEqual(extra.image_rights_status, 'authorised_public_source_images_or_evidence');
    assert.strictEqual(extra.map_pin_confirmed, false);
    assert(/^https:\/\/www\.youtube\.com\/watch\?v=/.test(extra.youtube_url), `${listing.title} should keep the source video URL`);
    assert(Array.isArray(extra.source_urls) && extra.source_urls.some((url) => /youtube\.com/i.test(url)), `${listing.title} should keep public source URLs`);
    assert(Array.isArray(extra.photo_source_urls) && extra.photo_source_urls.length >= 5, `${listing.title} should keep five source image URLs for video evidence`);
    assert(extra.photo_source_urls.some((url) => /\/0\.jpg$/i.test(url)), `${listing.title} should keep the YouTube preview still`);
    assert(extra.photo_source_urls.some((url) => /\/3\.jpg$/i.test(url)), `${listing.title} should keep the fifth YouTube still`);
    assert.strictEqual(extra.minimum_reliable_image_count, 1, `${listing.title} should allow launch intake with one usable source image plus evidence`);
    assert(/Do not invent property-room photos/i.test(extra.image_evidence_policy), `${listing.title} should keep strict image evidence guidance`);
    assert(/bypass private platform restrictions/i.test(extra.image_evidence_policy), `${listing.title} should avoid private platform image workarounds`);
    assert(/Facebook/i.test(extra.facebook_image_policy), `${listing.title} should keep Facebook image handling guidance`);
    if (listing.source_item.listingType === 'land') {
      assert(/land-size guide illustration/i.test(listing.images.map((image) => image.room_label).join(' ')), `${listing.title} should include a generated land-size guide image`);
      assert.strictEqual(extra.generated_land_size_diagram, true, `${listing.title} should flag generated land-size support imagery`);
      assert(/source\/agent-authorised land images/i.test(extra.land_visual_strategy), `${listing.title} should keep the land image strategy for reviewers`);
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
  });
  const intake = sourcePostMeetsLaunchIntakeRule(imported, imported.sourceAgent);
  assert.strictEqual(imported.sourceBatch, FOUND_ONLINE_SOURCE_POST_IMPORT_BATCH_ID, 'imported posts should use the source-post import batch');
  assert.strictEqual(imported.price, 350000000, 'importer should parse Uganda shorthand prices');
  assert.strictEqual(intake.eligible, true, 'imported no-phone posts with public source contact should be queueable');
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
  });
  const intake = sourcePostMeetsLaunchIntakeRule(imported, imported.sourceAgent);
  assert.strictEqual(imported.sourcePlatform, 'TikTok', 'TikTok post imports should keep the platform');
  assert.strictEqual(imported.sourceAgent.tiktokUrl, 'https://www.tiktok.com/@realtor_mahad/video/7330000000000000000', 'exact TikTok URL should be usable as contact/source path');
  assert.strictEqual(intake.date_status, 'needs_source_platform_date_confirmation', 'missing TikTok post dates should stay visible as confirmation-needed');
  assert.strictEqual(intake.eligible, true, 'exact TikTok URLs with source contact, area, and price should queue even while date/images are being confirmed');
  assert.strictEqual(sourceImageRowsFor(imported).length, 0, 'TikTok posts without direct media URLs should not pretend to have copied images');
  assert(socialSearchServiceSource.includes('sourceEvidenceCardDataUrl'), 'TikTok no-image imports should fall back to a labelled makaug evidence card');
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
  assert(read('services/socialSearchSourcedListingsService.js').includes('skipped_listings'), 'seed should skip incomplete evidence sources instead of crashing the whole batch');
  assert(read('services/socialSearchSourcedListingsService.js').includes('source_contact_url'), 'seed should keep a social/source contact URL for no-phone sourced listings');
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
  assert(read('services/socialSearchSourcedListingsService.js').includes('PUBLIC_SOURCE_CONTACT_POLICY'), 'daily found-online sweeps should treat public source/contact pages as contact routes');
  assert(read('services/socialSearchSourcedListingsService.js').includes('facebook_image_policy'), 'daily found-online sweeps should explain Facebook image handling');
  assert(frontend.includes('async function adminSeedSocialSearchAuthorisedListings'), 'dashboard should implement found-online seed action');
  assert(frontend.includes('async function adminImportFoundOnlineSourcePosts'), 'dashboard should implement source-post import action');
  assert(frontend.includes('Queue Found-Online Properties'), 'dashboard should label the found-online queue action');
  assert(frontend.includes('Import Source Posts'), 'dashboard should expose source-post import action');
  assert(frontend.includes('already live/approved records were hidden from this pending panel'), 'dashboard should hide approved/live records from pending moderation status cards');
  assert(frontend.includes('adminSourceReviewRecordSummaryHtml'), 'dashboard should render source-review records with source/contact links');
  assert(frontend.includes('A public social/source profile counts as the contact path when no phone is published'), 'dashboard should make no-phone social contact acceptable');
  assert(frontend.includes('source pages/feeds are parked for source review, not hidden properties'), 'dashboard should clarify source-review records are not pending properties');
  assert(frontend.includes('from 1 January 2026 onward'), 'dashboard should communicate the found-online source window');
  assert(frontend.includes('No phone number is not a blocker if a social/source profile exists'), 'dashboard should explain source-review no-phone policy');
  assert(frontend.includes('A page without a phone can still be usable'), 'source database should explain public social/source URLs can be contact paths');
  assert(frontend.includes('Open Source'), 'seed summaries should use a platform-neutral source action label');
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

test('found-online launch inventory is published publicly with disclosure guardrails', () => {
  assert(foundOnlinePublicLaunchMigration.includes('found_online_public_launch_20260524'), 'public launch migration should carry a traceable batch id');
  assert(foundOnlinePublicLaunchMigration.includes("status = 'approved'"), 'found-online launch rows should become public approved listings');
  assert(foundOnlinePublicLaunchMigration.includes("source = 'found_online_property_source_v1'"), 'public launch migration should only target found-online source rows');
  assert(foundOnlinePublicLaunchMigration.includes("extra_fields->>'source_url'"), 'public launch migration should require source URL evidence');
  assert(foundOnlinePublicLaunchMigration.includes('price IS NOT NULL'), 'public launch migration should require price evidence');
  assert(foundOnlinePublicLaunchMigration.includes("COALESCE(area, '') <> ''"), 'public launch migration should require location/area evidence');
  assert(foundOnlinePublicLaunchMigration.includes('approval_disclaimer'), 'public launch migration should keep public verification disclaimer metadata');
  assert(foundOnlinePublicLaunchMigration.includes('ownership_verification_status'), 'public launch migration should not pretend ownership is fully verified');
  assert(foundOnlinePublicLaunchMigration.includes('source_rights_status'), 'public launch migration should keep media/source rights review metadata');
  assert(foundOnlinePublicLaunchMigration.includes('found_online_public_launch_published'), 'public launch migration should log moderation events');
  assert(healthRoute.includes('050_publish_found_online_launch_inventory.sql'), 'migration health should expose found-online public launch migration');
});

test('King review preview opens pending listings through a protected admin route', () => {
  assert(adminRoute.includes("router.get('/properties/:id/live-preview'"), 'admin live-style preview endpoint should exist');
  assert(adminRoute.includes('buildAdminLivePreviewPayload'), 'admin preview should return a consumer-shaped listing payload');
  assert(adminRoute.includes('p.id::text = $1 OR p.inquiry_reference = $1'), 'admin preview should find listings by UUID or reference');
  assert(frontend.includes('/api/admin/properties/${encodeURIComponent(listingId)}/live-preview'), 'review button should call the protected admin preview route');
  assert(frontend.includes('admin_live_style_preview'), 'admin preview opens should be tracked separately from public views');
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
