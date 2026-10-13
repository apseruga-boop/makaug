'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets/makaug-app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
const functions = [
  'getPublicListings', 'getHomepageFeaturedListings', 'renderGrid', 'renderAll',
  'loadingPropertyGridHtml', 'noResultsCardForGrid', 'applyPublicFeaturedRows',
  'applyPublicRowsForUi', 'applyPublicOpportunityStats', 'refreshPublicListingsFromApi',
  'normalizeRoutePath', 'isActiveUgandaHomepage'
].map((name) => {
  const node = ast.body.find((item) => item.type === 'FunctionDeclaration' && item.id.name === name);
  assert.ok(node, `${name} exists in the actual application`);
  return source.slice(node.start, node.end);
}).join('\n');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function fixture({ ssr = true } = {}) {
  const initialHtml = ssr ? Array.from({ length: 6 }, (_, index) =>
    `<article data-ssr-property-card="approved-${index}"><a href="/property/approved-${index}"><img src="/approved-${index}.webp"></a></article>`
  ).join('') : '';
  let html = initialHtml;
  const writes = [];
  const grid = {
    get innerHTML() { return html; },
    set innerHTML(value) { writes.push(value); html = value; },
    querySelector(selector) {
      assert.equal(selector, '[data-ssr-property-card]');
      return html.includes('data-ssr-property-card') ? {} : null;
    }
  };
  const grids = { 'home-grid': grid, 'rent-grid': { innerHTML: '' },
    'page-home': { classList: { contains: (name) => name === 'active' } } };
  const warnings = [];
  const featured = deferred();
  const summary = deferred();
  const primary = deferred();
  const context = vm.createContext({
    Promise, Number, Set, Array,
    PROPERTIES: [],
    publicListingsFromApiLoaded: false,
    publicFeaturedListingsFromApi: [],
    publicListingsApiLoading: false,
    publicListingsApiStats: null,
    publicListingsApiTotal: 0,
    PUBLIC_LISTINGS_FAST_PAGE_LIMIT: 40,
    currentPage: 'home',
    ACTIVE_LOCATION_COUNTRY: { countryCode: 'UG' },
    document: { getElementById: (id) => grids[id] || null },
    window: { location: { pathname: '/' } },
    console: { warn: (...args) => warnings.push(args) },
    normalizeType: (type) => type,
    isListingPublicVisible: () => true,
    isPublicDemoTrainingListing: () => false,
    isBackendControlledListing: (property) => property.remote_source === 'api',
    publicSampleListingsEnabled: () => false,
    getFeaturedListings: (rows) => rows.filter((property) => property.featured),
    sortListingsByNewest: () => 0,
    hasActivePublicCategoryFilter: () => false,
    publicCategoryHasRouteSearch: () => false,
    publicCategoryRenderTotal: (_category, rows) => rows.length,
    isStudentDiscoverable: () => false,
    getBrokerDirectory: () => [],
    getFeaturedBrokers: () => [],
    propCard: (property, options) => `<article data-client-property-card="${property.id}"><a href="/property/${property.id}"><img src="/${property.id}.webp" loading="${options.imageLoading}"></a></article>`,
    renderHeroPropertyOpportunityCounter() {},
    renderPublicCategoryPageWithAuthoritativeCache() {},
    renderBrokers() {},
    renderSaved() {},
    renderActiveAuthDashboard() {},
    ensureRevenuePlacements() {},
    syncPublicWhatsappLinks() {},
    activePublicInventoryCategoryFromRoute: () => '',
    fetchPublicFeaturedListingsFromApi: () => featured.promise,
    fetchPublicOpportunityStatsFromApi: () => summary.promise,
    fetchPublicPaginatedRows: () => primary.promise,
    adminRecordLooksLikeTest: () => false,
    normalizeHeroOpportunityStats: (stats) => stats,
    upsertPropertyForUi(property) {
      const row = { ...property, remote_source: 'api' };
      context.PROPERTIES.push(row);
      return row;
    }
  });
  vm.runInContext(functions, context);
  return { context, grid, grids, initialHtml, writes, featured, summary, primary, warnings };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test('startup and repeated summary/broker renders leave all six server-delivered cards and images untouched', async () => {
  const f = fixture();
  f.context.renderAll();
  assert.equal(f.grid.innerHTML, f.initialHtml);
  assert.deepEqual(f.writes, [], 'startup must not replace existing card DOM with placeholders');
  const refresh = f.context.refreshPublicListingsFromApi();
  f.summary.resolve({ total: 80 });
  await flush();
  assert.equal(f.context.publicListingsApiStats.total, 80);
  assert.deepEqual(f.warnings, [], 'metadata callbacks execute real dependencies without swallowed errors');
  f.context.renderAll(); // The broker API itself invokes this same renderer.
  assert.equal(f.grid.innerHTML, f.initialHtml);
  assert.deepEqual(f.writes, [], 'independent metadata and broker results do not remove visible listings');
  f.featured.resolve([]);
  f.primary.resolve({ rows: [{ id: 'live-1', type: 'rent' }], firstResponse: {} });
  assert.equal(await refresh, true);
  assert.match(f.grid.innerHTML, /data-client-property-card="live-1"/);
  assert.doesNotMatch(f.grid.innerHTML, /data-ssr-property-card|animate-pulse/);
});

test('real featured rows can replace SSR before the main catalogue response completes', async () => {
  const f = fixture();
  f.context.renderAll();
  const refresh = f.context.refreshPublicListingsFromApi();
  f.featured.resolve([{ id: 'featured-live', type: 'sale', featured: true }]);
  await flush();
  assert.equal(f.context.publicListingsFromApiLoaded, false);
  assert.match(f.grid.innerHTML, /data-client-property-card="featured-live"/);
  f.summary.resolve({ total: 80 });
  await flush();
  assert.match(f.grid.innerHTML, /data-client-property-card="featured-live"/);
  f.primary.resolve({ rows: [], firstResponse: {} });
  await refresh;
  assert.match(f.grid.innerHTML, /data-client-property-card="featured-live"/);
});

test('a successful empty catalogue response releases SSR and shows the existing empty state', async () => {
  const f = fixture();
  f.context.renderAll();
  const refresh = f.context.refreshPublicListingsFromApi();
  f.summary.resolve({ total: 0 });
  f.featured.resolve([]);
  f.primary.resolve({ rows: [], firstResponse: { pagination: { total: 0 } } });
  assert.equal(await refresh, true);
  assert.equal(f.context.publicListingsFromApiLoaded, true);
  assert.match(f.grid.innerHTML, /No exact matches yet/);
  assert.doesNotMatch(f.grid.innerHTML, /data-ssr-property-card|animate-pulse/);
  f.context.renderAll();
  assert.match(f.grid.innerHTML, /No exact matches yet/, 'later unrelated renders cannot resurrect initial cards');
});

test('failed listing requests retain SSR while metadata callbacks finish', async () => {
  const f = fixture();
  f.context.renderAll();
  const refresh = f.context.refreshPublicListingsFromApi();
  f.summary.resolve({ total: 80 });
  f.featured.reject(new Error('featured unavailable'));
  f.primary.reject(new Error('catalogue unavailable'));
  assert.equal(await refresh, false);
  await flush();
  f.context.renderAll();
  assert.equal(f.grid.innerHTML, f.initialHtml);
  assert.deepEqual(f.writes, []);
});

test('a home grid without SSR still shows loading placeholders before the API response', () => {
  const f = fixture({ ssr: false });
  f.context.renderAll();
  assert.match(f.grid.innerHTML, /animate-pulse/);
  assert.equal((f.grid.innerHTML.match(/aria-hidden="true"/g) || []).length, 3);
});

test('the guard does not change category filters or loaded empty home results', () => {
  const f = fixture();
  f.context.renderGrid('rent-grid', [{ id: 'filtered-rent', type: 'rent' }]);
  assert.match(f.grids['rent-grid'].innerHTML, /filtered-rent/);
  f.context.renderGrid('rent-grid', []);
  assert.match(f.grids['rent-grid'].innerHTML, /No exact matches yet/);
  f.context.publicListingsFromApiLoaded = true;
  f.context.renderGrid('home-grid', []);
  assert.match(f.grid.innerHTML, /No exact matches yet/);
  assert.doesNotMatch(f.grid.innerHTML, /data-ssr-property-card/);
});
