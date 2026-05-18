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
const pkg = JSON.parse(read('package.json'));

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
