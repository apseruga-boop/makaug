'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  KING_HARVEST_ROUTE_CONTRACT_MARKER,
  KING_TIKTOK_HARVEST_E2E_MARKER,
  listHarvestCreators,
  loadNextHarvestCreator,
  markHarvestCreatorChecked,
  registryCreators,
} = require('../services/propertyHarvestCreatorRotationService');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

async function run() {
  const server = read('server.js');
  const adminRoutes = read('routes/admin.js');
  const staffRoutes = read('routes/staff.js');
  const app = read('assets/makaug-app.js');
  const html = read('index.html');
  const migration = read('db/migrations/112_always_on_property_harvest.sql');
  const creatorMigration = read('db/migrations/113_tiktok_creator_rotation_profiles.sql');

  assert(server.includes("app.use('/api/admin', adminRoutes)"), 'admin routes must be mounted in production');
  assert(server.includes("app.use('/api/staff', staffRoutes)"), 'staff routes must be mounted in production');
  assert(server.includes('kingHarvesterRouteContractVersion'), 'the browser bundle must be cache-busted for this route contract');

  assert(adminRoutes.includes("router.post('/exact-social-source-posts/import'"), 'King exact social import must be POST');
  assert(adminRoutes.includes("router.post('/tiktok-source-posts/import'"), 'King TikTok import button route must be registered');
  assert(adminRoutes.includes("router.post('/social-platform-posts/sweep'"), 'King social sweep route must be registered');
  assert(adminRoutes.includes("router.get('/harvest/coverage'"), 'King harvest coverage route must be registered');
  assert(adminRoutes.includes("router.get('/harvest/creators'"), 'King creator list route must be registered');
  assert(adminRoutes.includes("router.get('/harvest/next-creator'"), 'King next-creator route must be registered');
  assert(adminRoutes.includes("router.get('/harvest/creators/next'"), 'King canonical creator-next alias must be registered');
  assert(adminRoutes.includes("router.post('/harvest/creators/:sourceKey/checked'"), 'King creator rotation write must be registered');

  assert(staffRoutes.includes("router.post('/source-intake/exact-social/import'"), 'staff exact import must be registered');
  assert(staffRoutes.includes("router.post('/source-intake/social-sweep'"), 'staff social sweep must be registered');
  assert(staffRoutes.includes("router.get('/harvest/summary'"), 'staff harvest summary must be registered');
  assert(staffRoutes.includes("router.get('/harvest/creators'"), 'staff creator list must be registered');
  assert(staffRoutes.includes("router.get('/harvest/next-creator'"), 'staff next-creator alias must be registered');

  assert(html.includes('id="admin-harvest-next-creator-btn"'), 'King dashboard must render Harvest next creator');
  assert(html.includes('id="admin-harvest-summary-btn"'), 'King dashboard must render Harvest Coverage');
  assert(html.includes('id="admin-harvest-creator-card"'), 'King dashboard must render the creator result card');
  assert(html.includes(`data-king-harvest-route-contract="${KING_HARVEST_ROUTE_CONTRACT_MARKER}"`), 'King dashboard must expose the release marker');
  assert(html.includes(`data-king-tiktok-harvest-e2e="${KING_TIKTOK_HARVEST_E2E_MARKER}"`), 'King dashboard must expose the end-to-end fix marker');
  assert(app.includes('/api/admin/harvest/coverage?days=14'), 'King coverage control must call the authenticated coverage route');
  assert(app.includes('/api/admin/harvest/next-creator?platform='), 'King creator control must call the authenticated next-creator route');
  assert(app.includes('/api/staff/source-intake/social-sweep'), 'staff sweep control must call the registered POST route');
  assert(app.includes('Published automatically: <strong>0</strong>'), 'manual import result must hard-report zero automatic publishing');
  assert(app.includes('adminOpenSocialQuickPastePanel(seedText, { mode: "tiktok" })'), 'TikTok import must use an in-page intake surface instead of a native prompt');
  assert(app.includes('Verify with TikTok & Preview'), 'TikTok import must expose the server verification action');
  assert(app.includes('normalized !== "tiktok"'), 'TikTok sweep must not be blocked behind a native confirmation dialog');
  assert(app.includes('data-tiktok-server-enrichment'), 'TikTok preview must display server-side provider evidence');
  assert(app.includes('admin-harvest-summary-btn') && app.includes('admin-harvest-next-creator-btn'), 'dynamic dashboard recovery must restore both Harvest controls');

  for (const table of [
    'property_harvest_events',
    'property_harvest_submissions',
    'property_harvest_channels',
    'property_harvest_cursors',
  ]) {
    assert(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `migration 112 must create ${table}`);
  }
  for (const index of [
    'idx_properties_harvest_source_platform_id',
    'idx_properties_harvest_caption_simhash',
    'idx_properties_harvest_primary_image_dhash',
    'idx_properties_harvest_primary_image_phash',
    'idx_properties_harvest_contact_cluster_key',
    'idx_properties_harvest_composite_listing_key',
  ]) {
    assert(migration.includes(`CREATE INDEX IF NOT EXISTS ${index}`), `migration 112 must create ${index}`);
  }

  const tiktokCreators = registryCreators('tiktok', 5);
  assert(tiktokCreators.length > 0, 'the shipped registry must contain assisted TikTok sources');
  assert(tiktokCreators.every((creator) => /^https:\/\/www\.tiktok\.com\/@[A-Za-z0-9._-]+$/.test(creator.profile_url)), 'creator rotation must use actual TikTok creator profiles');
  assert(tiktokCreators.every((creator) => !creator.profile_url.includes('/tag/')), 'creator rotation must exclude hashtag pages');
  assert(tiktokCreators.every((creator) => creator.metadata.rotation_kind === 'creator_profile'), 'creator rows must be explicitly typed');
  assert(creatorMigration.includes("subscription_status = 'discovery_feed'"), 'migration 113 must reclassify old tag/search rotation rows');
  assert(creatorMigration.includes('idx_property_harvest_channels_creator_rotation'), 'migration 113 must index creator rotation');

  const queries = [];
  const fakeDb = {
    async query(sql, params) {
      queries.push({ sql, params });
      if (/SELECT \* FROM property_harvest_channels/.test(sql)) {
        return { rows: [{ platform: 'tiktok', source_key: 'fixture', display_name: 'Fixture creator', profile_url: 'https://www.tiktok.com/@fixture' }] };
      }
      if (/UPDATE property_harvest_channels/.test(sql)) {
        return { rows: [{ platform: 'tiktok', source_key: params[1], last_checked_at: '2026-08-09T00:00:00.000Z' }] };
      }
      return { rows: [] };
    },
  };

  const listed = await listHarvestCreators(fakeDb, { platform: 'tiktok', limit: 10 });
  assert.strictEqual(listed.marker, KING_HARVEST_ROUTE_CONTRACT_MARKER);
  assert.strictEqual(listed.e2e_marker, KING_TIKTOK_HARVEST_E2E_MARKER);
  assert.strictEqual(listed.review_only, true);
  assert.strictEqual(listed.creators.length, 1);
  const next = await loadNextHarvestCreator(fakeDb, { platform: 'tiktok' });
  assert.strictEqual(next.creator.source_key, 'fixture');
  assert.match(next.workflow, /No automated scraping/);
  const checked = await markHarvestCreatorChecked(fakeDb, { platform: 'tiktok', sourceKey: 'fixture' });
  assert.strictEqual(checked.source_key, 'fixture');
  assert(queries.some(({ sql }) => /INSERT INTO property_harvest_channels/.test(sql)), 'registry creators must be added idempotently');
  assert(queries.some(({ sql }) => /FROM property_source_registry/.test(sql) && /tiktok\\\.com\/@/.test(sql)), 'production creator records must come from exact TikTok profile URLs');
  assert(queries.some(({ sql }) => /subscription_status = 'assisted_rotation'/.test(sql) && /rotation_kind/.test(sql)), 'creator reads must exclude discovery feeds');
  assert(queries.some(({ sql }) => /last_checked_at = NOW\(\)/.test(sql)), 'Done must advance creator rotation');

  console.log('king-harvester-route-contract: ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
