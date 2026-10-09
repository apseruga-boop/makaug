'use strict';

/** S6: edge-cacheable public HTML, in-process cache, SSR /brokers, found-online rank. */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const cache = require('../services/publicHtmlResponseCache');
const { injectBrokerCards, loadBrokerCards } = require('../services/publicBrokersSsr');
const { agentFirstRankSql } = require('../utils/agentFirstRank');

const req = (headers = {}, url = '/for-sale', method = 'GET') => ({
  method, originalUrl: url, url,
  get: (name) => headers[String(name).toLowerCase()] || ''
});

test('anonymous cookie-less GET gets the edge cache header', () => {
  assert.strictEqual(cache.EDGE_CACHE_CONTROL, 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
  assert.strictEqual(cache.cacheDecision(req()), 'edge');
  assert.strictEqual(cache.cacheDecision(req({ cookie: '_ga=GA1.1.123; _gid=GA1.2.9' })), 'edge');
});

test('a session cookie, auth cookie or auth header is private, no-store and never public', () => {
  assert.strictEqual(cache.cacheDecision(req({ cookie: 'makaug_auth_token=abc' })), 'private');
  assert.strictEqual(cache.cacheDecision(req({ authorization: 'Bearer x' })), 'private');
  assert.strictEqual(cache.cacheDecision(req({ 'x-api-key': 'k' })), 'private');
  assert.strictEqual(cache.PRIVATE_CACHE_CONTROL, 'private, no-store');
  assert.strictEqual(cache.cacheDecision(req({ cookie: 'sid=abc123' })), 'default', 'unknown cookies are never shared-cached');
  assert.strictEqual(cache.cacheDecision(req({ cookie: '_ga=1; sid=abc' })), 'default');
  assert.strictEqual(cache.cacheKeyFor(req({ cookie: 'sid=1' })) && cache.cacheDecision(req({ cookie: 'sid=1' })) === 'edge', false);
});

test('only the home page, three hubs and /brokers are cached in process, and never with a query string', () => {
  for (const p of ['/', '/for-sale', '/to-rent', '/land', '/brokers']) assert.strictEqual(cache.cacheKeyFor(req({}, p)), p);
  assert.strictEqual(cache.cacheKeyFor(req({}, '/for-sale?utm_source=x')), '');
  assert.strictEqual(cache.cacheKeyFor(req({}, '/property/1')), '');
  assert.strictEqual(cache.cacheKeyFor(req({}, '/for-sale', 'POST')), '');
});

test('the in-process cache expires after 120 s and clears on inventory change', () => {
  cache.clear();
  cache.set('/for-sale', { html: 'x', headers: {} }, 1000);
  assert.ok(cache.get('/for-sale', 1000 + 119000));
  assert.strictEqual(cache.get('/for-sale', 1000 + 121000), null);
  cache.set('/land', { html: 'y', headers: {} });
  process.env.NODE_ENV = 'test';
  require('../services/publicInventoryMetricsService').invalidatePublicInventoryMetricsCache('test');
  assert.strictEqual(cache.get('/land'), null);
});

test('server wiring: private guard kept, edge header applied only to the default public HTML cache control', () => {
  const server = read('server.js');
  assert.match(server, /function requestCarriesAuth/);
  assert.match(server, /'private, no-store'/);
  assert.match(server, /cacheControl === PUBLIC_HTML_CACHE_CONTROL && isProduction && res\.statusCode === 200/);
  assert.match(server, /publicHtmlResponseCache\.cacheDecision\(req\)/);
  assert.match(server, /injectBrokerCards\(html, await brokersSsr\.loadBrokerCards\(db\)\)/);
});

test('a degraded page (database error) is never share-cached', () => {
  const server = read('server.js');
  assert.match(server, /!res\.locals\?\.publicHtmlDegraded/);
  assert.ok((server.match(/res\.locals\.publicHtmlDegraded = true/g) || []).length >= 6);
});

test('/brokers HTML carries /agents/ links for the first 24 agents', () => {
  const page = read('index.html');
  assert.ok(!/\/agents\//.test(page.split('id="page-brokers"')[1].split('id="brokers-grid"')[0] || ''));
  const rows = Array.from({ length: 30 }, (_, i) => ({ id: `id-${i}`, full_name: `Agent ${i} <b>`, company_name: 'Co & Sons', districts_covered: ['Kampala', 'Wakiso'], listings_count: i + 1 }));
  const html = injectBrokerCards(page, rows);
  const links = html.match(/href="\/agents\/id-\d+"/g) || [];
  assert.strictEqual(links.length, 24);
  assert.ok(html.includes('Agent 0 &lt;b&gt;'), 'names are escaped');
  assert.ok(!html.includes('Broker directory loading.'), 'placeholder replaced');
  assert.strictEqual(injectBrokerCards(page, []), page, 'no agents leaves the page untouched');
});

test('broker query uses the public eligibility filters and a 24 limit', async () => {
  const seen = [];
  await loadBrokerCards({ async query(sql, values) { seen.push({ sql, values }); return { rows: [] }; } });
  assert.match(seen[0].sql, /a\.status = \$1/);
  assert.match(seen[0].sql, /LIMIT \$\d+/);
  assert.strictEqual(seen[0].values[seen[0].values.length - 1], 24);
  assert.match(seen[0].sql, /SOCIAL\|FOUND-ONLINE|source profile/i);
});

test('found-online rows rank last even when they carry an agent_id (server and client)', () => {
  const sql = agentFirstRankSql('p');
  assert.ok(sql.indexOf('THEN 2') < sql.indexOf('THEN 0'), 'found-online test comes before the agent test');
  const app = read('assets/makaug-app.js');
  const start = app.indexOf('function publicAgentFirstRank(');
  const body = app.slice(start, app.indexOf('\n}\n', start) + 3);
  const ctx = vm.createContext({ publicListingOrigin: (p) => p.__origin });
  vm.runInContext(body, ctx);
  assert.strictEqual(ctx.publicAgentFirstRank({ __origin: 'found_online', agent_id: 'a1' }), 2);
  assert.strictEqual(ctx.publicAgentFirstRank({ __origin: 'agent', agent_id: 'a1' }), 0);
  assert.strictEqual(ctx.publicAgentFirstRank({ __origin: 'owner' }), 1);
  assert.ok(read('assets/build/makaug-app.min.js').length > 1000);
});
