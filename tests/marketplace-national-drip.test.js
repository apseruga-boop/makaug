'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  MARKETPLACE_P2_MARKER,
  PRIORITY_DISTRICTS,
  SOURCE_DEFINITIONS,
  googleCandidate,
  importMarketplaceSourceCandidates,
  registryRows,
  sourceDefinitions
} = require('../services/marketplaceNationalDripService');
const { DISTRICTS, MARKETPLACE_CATEGORIES } = require('../services/marketplaceService');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('national registry covers every category, district and declared source exactly once', () => {
  const rows = registryRows();
  const expected = MARKETPLACE_CATEGORIES.length * DISTRICTS.length * SOURCE_DEFINITIONS.length;
  assert.equal(MARKETPLACE_CATEGORIES.length, 20);
  assert.equal(DISTRICTS.length, 146);
  assert.equal(rows.length, expected);
  assert.equal(new Set(rows.map((row) => row.source_key)).size, expected);
  assert.equal(new Set(rows.map((row) => row.category)).size, 20);
  assert.equal(new Set(rows.map((row) => row.district)).size, 146);
  assert.equal(new Set(rows.map((row) => row.source)).size, SOURCE_DEFINITIONS.length);
});

test('registry walks Kampala metro and major urban districts before the national tail', () => {
  const googleRows = registryRows().filter((row) => row.source === 'google_maps');
  const firstThirtyDistricts = [...new Set(googleRows.map((row) => row.district))].slice(0, 30);
  assert.deepEqual(firstThirtyDistricts, PRIORITY_DISTRICTS);
  assert.deepEqual(firstThirtyDistricts.slice(0, 3), ['Kampala', 'Wakiso', 'Mukono']);
  assert.equal(PRIORITY_DISTRICTS.every((district) => DISTRICTS.includes(district)), true);
});

test('provider truth only enables Google when a real key is configured', () => {
  const originalGoogle = process.env.GOOGLE_MAPS_API_KEY;
  const originalPublic = process.env.PUBLIC_GOOGLE_MAPS_API_KEY;
  const originalLinkedIn = process.env.LINKEDIN_ACCESS_TOKEN;
  const originalLinkedInClient = process.env.LINKEDIN_CLIENT_ID;
  const originalMeta = process.env.META_GRAPH_ACCESS_TOKEN;
  const originalFacebookPages = process.env.FACEBOOK_PAGE_IDS;
  delete process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.PUBLIC_GOOGLE_MAPS_API_KEY;
  delete process.env.LINKEDIN_ACCESS_TOKEN;
  delete process.env.LINKEDIN_CLIENT_ID;
  delete process.env.META_GRAPH_ACCESS_TOKEN;
  delete process.env.FACEBOOK_PAGE_IDS;
  assert.equal(sourceDefinitions().filter((source) => source.enabled).length, 0);
  assert.equal(sourceDefinitions().find((source) => source.key === 'linkedin').configured, false);
  assert.equal(sourceDefinitions().find((source) => source.key === 'facebook').configured, false);
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  process.env.LINKEDIN_CLIENT_ID = 'linkedin-client';
  process.env.META_GRAPH_ACCESS_TOKEN = 'meta-token';
  const enabled = sourceDefinitions().filter((source) => source.enabled);
  assert.deepEqual(enabled.map((source) => source.key), ['google_maps']);
  assert.equal(sourceDefinitions().find((source) => source.key === 'linkedin').configured, true);
  assert.equal(sourceDefinitions().find((source) => source.key === 'facebook').configured, true);
  if (originalGoogle === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = originalGoogle;
  if (originalPublic === undefined) delete process.env.PUBLIC_GOOGLE_MAPS_API_KEY;
  else process.env.PUBLIC_GOOGLE_MAPS_API_KEY = originalPublic;
  if (originalLinkedIn === undefined) delete process.env.LINKEDIN_ACCESS_TOKEN;
  else process.env.LINKEDIN_ACCESS_TOKEN = originalLinkedIn;
  if (originalLinkedInClient === undefined) delete process.env.LINKEDIN_CLIENT_ID;
  else process.env.LINKEDIN_CLIENT_ID = originalLinkedInClient;
  if (originalMeta === undefined) delete process.env.META_GRAPH_ACCESS_TOKEN;
  else process.env.META_GRAPH_ACCESS_TOKEN = originalMeta;
  if (originalFacebookPages === undefined) delete process.env.FACEBOOK_PAGE_IDS;
  else process.env.FACEBOOK_PAGE_IDS = originalFacebookPages;
});

function sourceRow(overrides = {}) {
  return {
    id: 'source-1',
    source_key: 'google_maps:plumbers:kampala',
    source: 'google_maps',
    category: 'plumbers',
    district: 'Kampala',
    query_text: 'plumber Kampala Uganda',
    source_url: 'https://www.google.com/maps',
    metadata: {},
    ...overrides
  };
}

function place(overrides = {}) {
  return {
    id: 'places/ChIJ-test',
    displayName: { text: 'Kampala Plumbing Services' },
    formattedAddress: 'Kampala, Uganda',
    addressComponents: [
      { longText: 'Kampala', shortText: 'Kampala', types: ['administrative_area_level_1'] },
      { longText: 'Uganda', shortText: 'UG', types: ['country'] }
    ],
    internationalPhoneNumber: '+256 700 000 001',
    websiteUri: 'https://example.com',
    googleMapsUri: 'https://maps.google.com/?cid=123',
    location: { latitude: 0.3476, longitude: 32.5825 },
    ...overrides
  };
}

test('Google candidates require an exact source URL, canonical Uganda district and phone', () => {
  const accepted = googleCandidate(place(), sourceRow());
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.district, 'Kampala');
  assert.equal(accepted.phone, '+256700000001');
  assert.equal(accepted.source_url, 'https://maps.google.com/?cid=123');

  assert.equal(googleCandidate(place({ googleMapsUri: '' }), sourceRow()).reason, 'missing_source');
  assert.equal(googleCandidate(place({ internationalPhoneNumber: '' }), sourceRow()).reason, 'missing_contact');
  assert.equal(googleCandidate(place({ formattedAddress: 'Nairobi, Kenya', addressComponents: [{ longText: 'Kenya', shortText: 'KE', types: ['country'] }], location: { latitude: -1.286, longitude: 36.817 } }), sourceRow()).reason, 'location_unresolved');
});

test('migration creates persistent registry, state and run logs with caps', () => {
  const migration = read('db/migrations/085_marketplace_national_drip.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS marketplace_source_registry/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS marketplace_drip_state/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS marketplace_drip_run_logs/);
  assert.match(migration, /batch_size BETWEEN 1 AND 25/);
  assert.match(migration, /enabled BOOLEAN NOT NULL DEFAULT FALSE/);
});

test('protected admin API exposes registry, config, start, pause, import and run-once controls', () => {
  const admin = read('routes/admin.js');
  assert.match(admin, /router\.get\('\/marketplace-drip'/);
  assert.match(admin, /router\.post\('\/marketplace-drip\/seed-registry'/);
  assert.match(admin, /router\.post\('\/marketplace-drip\/import-source-candidates'/);
  assert.match(admin, /router\.patch\('\/marketplace-drip'/);
  assert.match(admin, /router\.post\('\/marketplace-drip\/start'/);
  assert.match(admin, /router\.post\('\/marketplace-drip\/pause'/);
  assert.match(admin, /router\.post\('\/marketplace-drip\/run-once'/);
});

test('admin dashboard renders provider truth, coverage, caps, controls and run logs', () => {
  const html = read('index.html');
  const app = read('assets/makaug-app.js');
  assert.match(html, /id="admin-marketplace-drip-panel"/);
  assert.match(app, /function marketplaceDripHtml/);
  assert.match(app, /Provider truth/);
  assert.match(app, /Monthly requests/);
  assert.match(app, /Build national registry/);
  assert.match(app, /Run one batch/);
});

test('public Marketplace publishes the P2 marker and crawlable national links', () => {
  const html = read('index.html');
  const app = read('assets/makaug-app.js');
  const marketplaceRoute = read('routes/marketplace.js');
  const server = read('server.js');
  assert.match(html, new RegExp(MARKETPLACE_P2_MARKER));
  assert.match(html, /href="\/marketplace-sitemap\.xml"/);
  assert.match(html, /\/marketplace\?category=surveyors/);
  assert.match(html, /\/marketplace\?district=Kampala/);
  assert.match(marketplaceRoute, /router\.get\('\/seo-links'/);
  assert.match(server, /app\.get\('\/marketplace-sitemap\.xml'/);
  assert.match(html, /data-marketplace-i18n="directoryLinksTitle"/);
  assert.match(app, /const MARKETPLACE_P2_I18N = Object\.freeze/);
  for (const language of ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar']) {
    assert.match(app, new RegExp(`${language}: \\{ directoryLinksTitle:`));
  }
});

test('server arms the drip scheduler but the scheduler is environment disabled by default', () => {
  const server = read('server.js');
  const service = read('services/marketplaceNationalDripService.js');
  assert.match(server, /startMarketplaceDripScheduler\(db\)/);
  assert.match(service, /MARKETPLACE_DRIP_SCHEDULER_ENABLED !== 'true'/);
  assert.match(service, /monthly_request_cap_reached/);
  assert.match(service, /provider_auth_or_config_error/);
  assert.match(service, /provider_rate_limited/);
});

test('contactless URSB candidates are hidden for enrichment, never public', async () => {
  const service = read('services/marketplaceNationalDripService.js');
  assert.match(service, /hidden \? 'hidden' : 'live'/);
  assert.match(service, /source !== 'ursb'/);
  assert.match(service, /business_enrichment_pending/);
  assert.match(service, /contactless_public/);

  const rejected = await importMarketplaceSourceCandidates({
    query: async () => assert.fail('a contactless directory row must be rejected before querying the database')
  }, [{
    source: 'yellow_pages',
    name: 'Contactless Directory Business',
    category: 'surveyors',
    district: 'Kampala',
    source_url: 'https://www.yellow.ug/company/contactless-directory-business'
  }]);
  assert.equal(rejected.rejected, 1);
  assert.equal(rejected.reasons.missing_contact, 1);

  const writes = [];
  const hidden = await importMarketplaceSourceCandidates({
    query: async (sql, params) => {
      writes.push({ sql, params });
      if (/SELECT id FROM marketplace_businesses/.test(sql)) return { rows: [] };
      if (/INSERT INTO marketplace_businesses/.test(sql)) return { rows: [{ id: 'hidden-ursb-business' }] };
      return { rows: [] };
    }
  }, [{
    source: 'ursb',
    name: 'Registered Survey Business Uganda Limited',
    category: 'surveyors',
    district: 'Kampala',
    source_url: 'https://ursb.go.ug/search-ursb-registries/registered-survey-business'
  }]);
  const businessWrite = writes.find((write) => /INSERT INTO marketplace_businesses/.test(write.sql));
  const eventWrite = writes.find((write) => /INSERT INTO marketplace_events/.test(write.sql));
  assert.equal(hidden.hidden_enrichment, 1);
  assert.equal(hidden.inserted, 0);
  assert.equal(businessWrite.params[10], 'hidden');
  assert.equal(eventWrite.params[1], 'business_enrichment_pending');
});
