'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const script = read('scripts/seed-sourced-inventory-candidates.js');
const imageImportScript = read('scripts/import-sourced-candidate-images.js');
const frontend = read('assets/makaug-app.js');
const adminRoute = read('routes/admin.js');
const html = read('index.html');
const propertiesRoute = read('routes/properties.js');
const bakaimaPublicCopyMigration = read('db/migrations/041_remove_bakaima_public_approval_copy.sql');
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

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test('sourced candidate seed creates 200 pending records with approval guardrails', () => {
  assert(script.includes("const DEFAULT_COUNT = 200"), 'default seed size should be 200');
  assert(script.includes("const SOURCE = 'sourced_inventory_candidate_v1'"), 'source should be explicit and searchable');
  assert(script.includes("status: 'pending'"), 'seeded listings must enter pending review');
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

test('sourced candidate image import requires authorised photos and only updates candidates', () => {
  assert(imageImportScript.includes('source = $1'), 'image import should match the sourced candidate source only');
  assert(imageImportScript.includes('consent_confirmed'), 'image import should require consent confirmation');
  assert(imageImportScript.includes('image_rights_confirmed'), 'image import should require image rights confirmation');
  assert(imageImportScript.includes('authorised_imported'), 'image import should mark images as authorised imports');
  assert(imageImportScript.includes('sourced_candidate_authorised_images_imported'), 'image import should write moderation event history');
  assert(imageImportScript.includes('Refusing to write in production without --confirm'), 'production writes should require explicit confirmation');
  assert(imageImportScript.includes('source_urls'), 'image import should retain source URLs for King review');
});

test('King dashboard visibly separates sourced candidates from ordinary reviews', () => {
  assert(frontend.includes('function adminIsSourcedInventoryCandidate'), 'dashboard should have sourced candidate detection helper');
  assert(frontend.includes('function adminSourcedInventoryCandidateBadge'), 'dashboard should have sourced candidate badge helper');
  assert(frontend.includes('Sourced candidate'), 'dashboard should display sourced candidate copy');
  assert(frontend.includes('Sourcing review required before public approval'), 'all-listings view should warn before approval');
  assert(frontend.includes('verify consent, contact details, authorised photos'), 'review panel should show verification warning');
  assert(frontend.includes('function adminSourcedCandidateSourceLinks'), 'review panel should expose stored source/photo evidence links');
  assert(frontend.includes('adminApproveSourcedCandidateOverride'), 'dashboard should expose sourced candidate special approval control');
  assert(frontend.includes('function adminEvidenceDownloadFilename'), 'evidence downloads should use a filename matching the actual mime type');
  assert(frontend.includes('function adminIsGeneratedPlaceholderPhoto'), 'dashboard should detect generated placeholder images');
  assert(frontend.includes('Placeholder images are attached'), 'dashboard should warn when images are placeholders');
});

test('admin listing API exposes sourcing metadata only behind admin access', () => {
  assert(propertiesRoute.includes('p.extra_fields AS admin_extra_fields'), 'admin rows should fetch full extra fields for dashboard review');
  assert(propertiesRoute.includes('if (adminAccess)'), 'admin-only response fields must be gated by admin access');
  assert(propertiesRoute.includes('responseRow.extra_fields = adminExtraFields || {}'), 'full extra_fields should only be attached for admin rows');
  assert(propertiesRoute.includes('sourced_inventory_candidate'), 'admin API should surface the candidate flag');
});

test('package script exposes the safe inventory intake command', () => {
  assert.strictEqual(
    pkg.scripts['inventory:seed-sourced-candidates'],
    'node scripts/seed-sourced-inventory-candidates.js',
    'package.json should expose inventory seed command'
  );
  assert.strictEqual(
    pkg.scripts['inventory:import-sourced-images'],
    'node scripts/import-sourced-candidate-images.js',
    'package.json should expose sourced candidate image import command'
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
});

test('admin-only endpoint can seed production candidates without public submission notifications', () => {
  assert(adminRoute.includes("router.use(requireAdminApiKey)"), 'admin routes must be protected before seed endpoint');
  assert(adminRoute.includes("router.post('/sourced-inventory-candidates/seed'"), 'admin seed endpoint should exist');
  assert(adminRoute.includes('seedSourcedInventoryCandidates'), 'admin endpoint should use direct DB seed service');
  assert(adminRoute.includes('admin_sourced_inventory_candidates_seeded'), 'admin endpoint should write audit trail');
});

test('sourced candidate approval override is server-side limited and audited', () => {
  assert(propertiesRoute.includes('function isSourcedInventoryCandidateRecord'), 'status route should identify sourced candidate records server-side');
  assert(propertiesRoute.includes('sourced_candidate_override'), 'status route should require explicit sourced override flag');
  assert(propertiesRoute.includes('consent_confirmed'), 'override should require consent confirmation');
  assert(propertiesRoute.includes('image_rights_confirmed'), 'override should require image rights confirmation');
  assert(propertiesRoute.includes('sourcedCandidateRecordReadyForOverride'), 'override should verify the stored record is ready, not only the request body');
  assert(propertiesRoute.includes('generated_placeholder_images_only'), 'override should reject records that still use generated placeholders');
  assert(propertiesRoute.includes('Authorised sourced candidate photos must be imported before approval'), 'override error should explain authorised photos are required');
  assert(propertiesRoute.includes('Sourced candidate override is only available'), 'override should reject ordinary listings');
  assert(propertiesRoute.includes('sourced_candidate_special_dispensation'), 'override should be stored on the property record');
  assert(propertiesRoute.includes('sourced_candidate_special_dispensation_used'), 'override should be written to moderation history');
});

test('admin has a guarded April 29 test-batch cleanup path', () => {
  assert(adminRoute.includes("router.post('/test-listings/cleanup-april-29'"), 'admin cleanup endpoint should exist');
  assert(adminRoute.includes("created_at >= TIMESTAMPTZ '2026-04-29 00:00:00+00'"), 'cleanup should be scoped to April 29 only');
  assert(adminRoute.includes('april_29_test_batch_cleanup'), 'cleanup should write audit metadata');
  assert(frontend.includes('adminCleanupApril29TestBatch'), 'dashboard should expose cleanup action');
  assert(frontend.includes('/api/admin/test-listings/cleanup-april-29'), 'dashboard should call protected cleanup endpoint');
  assert(html.includes('admin-clean-april29-tests-btn'), 'all-listings panel should include cleanup control');
});

test('King review queue has one-click sourced candidate creation', () => {
  assert(html.includes('admin-seed-sourced-candidates-btn'), 'review queue should expose sourced candidate button');
  assert(html.includes('admin-sourced-candidates-status'), 'review queue should expose seed status output');
  assert(frontend.includes('function ensureAdminSourcedCandidateControls'), 'frontend should inject seed controls when cached HTML is stale');
  assert(frontend.includes('async function adminSeedSourcedInventoryCandidates'), 'frontend should implement seed action');
  assert(frontend.includes('/api/admin/sourced-inventory-candidates/seed'), 'frontend should call protected admin seed endpoint');
  assert(frontend.includes('renderAdminDashboard()'), 'frontend should refresh King queue after seeding');
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
