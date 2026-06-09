const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const migration = read('db/migrations/063_rejected_property_source_url_blocklist.sql');
const propertiesRoute = read('routes/properties.js');
const socialSearchService = read('services/socialSearchSourcedListingsService.js');
const frontend = read('assets/makaug-app.js');
const healthRoute = read('routes/health.js');

const {
  normalizeSourceUrlForBlocklist,
  rejectedListingSourceUrlCandidates
} = require('../services/rejectedListingSourceBlocklistService');

test('rejected source URL blocklist migration purges old rejected/deleted property rows', () => {
  assert(migration.includes('CREATE TABLE IF NOT EXISTS rejected_property_source_urls'), 'migration must create durable rejected source URL blocklist');
  assert(migration.includes("blocked_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 years')"), 'blocklist should keep rejected URLs blocked for a long window');
  assert(migration.includes("WHERE LOWER(COALESCE(p.status, '')) IN ('rejected', 'deleted')"), 'migration should target existing rejected/deleted rows');
  assert(migration.includes('ON CONFLICT (normalized_source_url)'), 'same URL should update the existing block record');
  assert(migration.includes("DELETE FROM properties\nWHERE LOWER(COALESCE(status, '')) IN ('rejected', 'deleted')"), 'migration should physically purge rejected/deleted property rows');
  assert(healthRoute.includes('063_rejected_property_source_url_blocklist.sql'), 'health migration endpoint should expose rejected URL blocklist deployment');
});

test('King status rejection writes URL blocklist before deleting property row', () => {
  assert(propertiesRoute.includes("require('../services/rejectedListingSourceBlocklistService')"), 'properties route should load rejected source blocklist service');
  assert(propertiesRoute.includes('function shouldPurgePropertyRecordForStatus'), 'properties route should centralize purge status policy');
  assert(propertiesRoute.includes("normalized === 'rejected' || normalized === 'deleted'"), 'rejected and deleted statuses should purge property rows');
  assert(propertiesRoute.includes('recordRejectedListingSourceUrls(client'), 'status endpoint should write URL block rows');
  assert(propertiesRoute.includes('DELETE FROM properties'), 'status endpoint should hard-delete purged property rows');
  assert(propertiesRoute.includes('blocked_source_urls'), 'status response should report retained blocklist evidence');
});

test('found-online imports refuse URLs that were rejected before', () => {
  assert(socialSearchService.includes('findRejectedListingSourceUrlBlocks'), 'source importer should consult rejected source URL blocklist');
  assert(socialSearchService.includes('normalizeSourceUrlForBlocklist(sourceUrl)'), 'source importer should check normalized source URLs');
  assert(socialSearchService.includes('previously_rejected_source_url'), 'source importer should tag blocked re-import attempts');
  assert(socialSearchService.includes('rejected_source_url_blocked'), 'source importer should report blocked URL warnings');
});

test('homepage opportunity counter trusts backend approved total after API load', () => {
  assert(frontend.includes('const apiTotal = Number(publicListingsApiTotal)'), 'homepage counter should read backend API total');
  assert(frontend.includes('publicListingsFromApiLoaded && Number.isFinite(apiTotal) && apiTotal > stats.total'), 'homepage counter should use API total when it exceeds loaded rows');
  assert(frontend.includes('stats.other += apiTotal - stats.total'), 'counter breakdown should account for approved rows beyond loaded buckets');
  assert(frontend.includes('await refreshPublicListingsFromApi({ silent: true })'), 'King approval should refresh the public API snapshot after a listing goes live');
  assert(frontend.includes('function removePropertyForUiById'), 'client should remove purged listings from in-memory public/admin lists');
  assert(frontend.includes('statusResponse?.purged === true || statusResponse?.purge?.purged === true'), 'client should detect backend purge confirmation');
});

test('source URL normalization and candidate extraction are stable', () => {
  assert.strictEqual(
    normalizeSourceUrlForBlocklist('https://TikTok.com/@Agent/video/123/?utm_source=x#share'),
    'https://tiktok.com/@agent/video/123'
  );
  const urls = rejectedListingSourceUrlCandidates({
    source_url: 'https://example.com/listing/1',
    extra_fields: {
      source_post_url: 'https://facebook.com/post/2/',
      source_urls: ['https://x.com/agent/status/3?utm_medium=social']
    }
  });
  assert.deepStrictEqual(urls, [
    'https://example.com/listing/1',
    'https://facebook.com/post/2/',
    'https://x.com/agent/status/3?utm_medium=social'
  ]);
});
