'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const seo = require('../services/publicSeoRenderService');
const cache = require('../services/publicHtmlResponseCache');
const db = require('../config/database');
const { isAllowedCorsOrigin } = require('../utils/corsOrigin');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('area and category SQL pages ids before image joins and counts once', async () => {
  seo.clearSeoListingCache();
  const queries = [];
  const fakeDb = { async query(sql, values) { queries.push({ sql, values }); return { rows: [] }; } };
  await seo.loadPublicSeoListings(fakeDb, {
    categoryKey: 'sale',
    location: { canonical_key: 'wakiso:kira', level: 'area', district: 'Wakiso', location: 'Kira' },
    limit: 12
  });
  const sql = queries[0].sql;
  assert.match(sql, /WITH page AS MATERIALIZED/);
  assert.match(sql, /COUNT\(\*\)::int AS seo_total/);
  assert.equal(sql.includes('COUNT(*) OVER()'), false);
  assert.ok(sql.indexOf('AS MATERIALIZED') < sql.indexOf('LEFT JOIN LATERAL'), 'images are loaded after the page of ids');
  assert.equal((sql.match(/LEFT\(COALESCE\(p\.description, ''\), 600\)/g) || []).length, 1);
  const limitCount = queries[0].values.filter((value) => value === 12).length;
  assert.equal(limitCount, 1, 'the limit placeholder is not pushed twice');
});

test('anonymous area HTML is cacheable and personalised paths are not', () => {
  const req = (url, method = 'GET') => ({ method, originalUrl: url, url, get: () => '' });
  assert.equal(cache.cacheKeyFor(req('/for-sale/kira-wakiso')), '/for-sale/kira-wakiso');
  assert.equal(cache.cacheKeyFor(req('/commercial/for-sale/kira-wakiso')), '/commercial/for-sale/kira-wakiso');
  assert.equal(cache.cacheKeyFor(req('/property/00000000-0000-4000-8000-000000000001')), '');
  assert.equal(cache.cacheKeyFor(req('/admin')), '');
  assert.equal(cache.cacheKeyFor(req('/for-sale/kira-wakiso?page=2')), '');
  assert.equal(cache.TTL_MS, 180 * 1000);
  assert.equal(cache.MAX_BYTES, 8 * 1024 * 1024);
  cache.clear();
  cache.set('/for-sale/too-big', { html: 'x'.repeat(cache.MAX_BYTES + 1) });
  assert.equal(cache.get('/for-sale/too-big'), null);
  assert.equal(cache.cacheBytes(), 0);
});

test('web-vitals origins: apex, www, missing and null are allowed; other sites are not', () => {
  const opts = { allowedOrigins: ['https://makaug.com'], tenantHost: 'makaug.com' };
  assert.equal(isAllowedCorsOrigin(undefined, opts), true);
  assert.equal(isAllowedCorsOrigin('', opts), true);
  assert.equal(isAllowedCorsOrigin('null', opts), true);
  assert.equal(isAllowedCorsOrigin('https://makaug.com', opts), true);
  assert.equal(isAllowedCorsOrigin('https://www.makaug.com', opts), true);
  assert.equal(isAllowedCorsOrigin('https://makaug.com/', opts), true);
  assert.equal(isAllowedCorsOrigin('https://makaug.com:443', opts), true);
  assert.equal(isAllowedCorsOrigin('https://evil.example', opts), false);
  assert.equal(isAllowedCorsOrigin('https://notmakaug.com', opts), false);
  assert.equal(isAllowedCorsOrigin('https://evil.example', { allowedOrigins: [], tenantHost: 'makaug.com' }), true);
  assert.match(read('server.js'), /isAllowedCorsOrigin\(origin/);
  assert.match(read('server.js'), /CORS origin not allowed/);
});

test('uuid parameters are not compared as both uuid and text', () => {
  for (const file of [
    'services/agentWeeklyReportService.js',
    'services/agentWelcomeService.js',
    'routes/agents.js'
  ]) {
    assert.match(read(file), /p\.agent_id::text = \$1::text/);
    assert.doesNotMatch(read(file), /p\.agent_id = \$1 OR/);
  }
  assert.match(read('services/paymentProviderService.js'), /pl\.id::text = \$1 OR pl\.provider_reference = \$1/);
  assert.match(read('services/leadDeskService.js'), /u\.id::text = nr\.user_id::text/);
  assert.match(read('services/agentPublicProfileService.js'), /l\.host_user_id::text = a\.user_id::text/);
  const migration = read('db/migrations/163_property_approved_by.sql');
  assert.match(migration, /u\.id::text = e\.actor_id/);
  assert.match(migration, /actor_id ~\* '\^\[0-9a-fA-F\]\{8\}-/);
});

test('area lookup indexes are additive and do not change row data', () => {
  const sql = read('db/migrations/168_area_category_lookup_indexes.sql');
  assert.match(sql, /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_area_type_canonical_updated/);
  assert.match(sql, /CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_properties_canonical_id_prefix/);
  assert.match(sql, /ANALYZE properties/);
  assert.doesNotMatch(sql, /\bUPDATE\b/i);
  assert.doesNotMatch(sql, /\bDELETE\b/i);
  assert.doesNotMatch(sql, /\bINSERT\b/i);
});

test('background database work is a separate one-connection pool', () => {
  assert.equal(db.poolPressure().background_pool_max, 1);
  assert.match(read('services/agentBookingService.js'), /runBackgroundWork\(/);
  assert.match(read('config/database.js'), /backgroundPool/);
  assert.doesNotMatch(read('config/database.js'), /DB_BACKGROUND_BUSY/);
});

test('large responses are not synchronously compressed and bundles are read from disk', () => {
  const server = read('server.js');
  assert.match(server, /SYNC_COMPRESS_MAX_BYTES = 128 \* 1024/);
  assert.match(server, /function sendDiskJavaScript/);
  assert.match(server, /fs\.statSync\(builtPublicAppPath\)/);
  assert.match(server, /function readCountryAppAsset\(\)/);
  assert.match(server, /dynamicCompression: false/);
});
