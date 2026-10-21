'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const acorn = require('acorn');

const source = fs.readFileSync(process.env.MAKAUG_STARTUP_TEST_SOURCE || require.resolve('../assets/makaug-app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest' });
const fn = (name) => ast.body.find((node) => node.type === 'FunctionDeclaration' && node.id.name === name);
function code(name) {
  const node = fn(name);
  assert.ok(node, name);
  return source.slice(node.start, node.end);
}
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

function select(value = '') {
  let html = '', selected = value;
  return {
    writes: 0,
    classList: { toggle() {} },
    get value() { return selected; },
    set value(next) { selected = next; },
    get innerHTML() { return html; },
    set innerHTML(next) { html = next; selected = ''; this.writes++; },
    get options() {
      return [...html.matchAll(/<option value="([^"]*)"/g)].map((match) => ({ value: match[1] }));
    }
  };
}

function languageFixture() {
  const calls = [], attributes = { lang: 'en', dir: 'ltr' }, writes = [];
  const html = {};
  for (const name of ['lang', 'dir']) Object.defineProperty(html, name, {
    get: () => attributes[name],
    set(value) { writes.push([name, value]); attributes[name] = value; }
  });
  const elements = {
    'lang-sel': select('en'), 'lang-sel-spotlight': select('en'),
    'hero-district': select('Kampala'), 'hero-radius-f': select('10'),
    'hero-context-f': select('2'), 'hero-q': { placeholder: '' },
    'page-home': { classList: { contains: () => true } }
  };
  const context = vm.createContext({
    String,
    currentLang: 'en', currentTab: 'rent', currentPage: 'home', activeDetailPropertyId: '',
    authSignInAudience: 'finder', authSignUpAudience: 'finder', authSignUpOtpChannel: 'phone',
    typeaheadState: { input: null }, ACTIVE_LOCATION_COUNTRY: { countryCode: 'UG' },
    DISTRICTS: ['Kampala', 'Wakiso'], UGANDA_UNIVERSITIES: ['Makerere'],
    HERO_CONTEXT_FILTERS: { rent: { inputPlaceholder: 'Rent', options: [{ value: '', label: 'Bedrooms' }, { value: '2', label: '2 beds' }] } },
    SEARCH_RADIUS_KM_OPTIONS: [0, 10],
    document: { documentElement: html, getElementById: (id) => elements[id] || null, addEventListener() {} },
    window: { location: { pathname: '/' }, setTimeout() {}, addEventListener() {} },
    normalizeMakaugLanguageCode: (lang) => ['en', 'lg', 'ar'].includes(lang) ? lang : 'en',
    getStoredMakaugLanguagePreference: () => 'en', getStartupLanguagePreference: (value) => value,
    tr: (key) => `${context.currentLang}:${key}`, lpVal: () => '', getListType: () => 'rent',
    formatRadiusDistanceText: String,
    refreshPublicListingsFromApi: async () => false, refreshBrokersFromApi: async () => false,
    parseInitialDeepLink() {}, finishInitialSsrCategoryGridSetup: () => false
  });
  // Run the actual initializer and language/control functions. Replace only
  // unrelated network, telemetry and UI adapters, so option rebuilding remains real.
  for (const name of ['initializeMakaugApp', 'setLang']) walk(fn(name), (node) => {
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && !context[node.callee.name]) {
      const called = node.callee.name;
      context[called] = (...args) => calls.push([called, ...args]);
    }
  });
  vm.runInContext(['setLang', 'setHtmlIfChanged', 'setHeroLocationFilter', 'localizeHeroContextOption', 'setHeroContextFilter',
    'populateRadiusSelects', 'radiusLabel', 'setHeroRadiusState', 'initializeMakaugApp'].map(code).join('\n'), context);
  for (const name of ['setHeroLocationFilter', 'setHeroRadiusState', 'setHeroContextFilter']) {
    const actual = context[name];
    context[name] = (...args) => { calls.push([name, ...args]); return actual(...args); };
  }
  return { context, calls, writes, attributes, elements };
}

test('setting the current language keeps existing HTML language and direction attributes untouched', () => {
  const fixture = languageFixture();
  fixture.context.setLang('en', true, false);
  assert.deepEqual(fixture.writes, [], 'unchanged language must not trigger another language mutation');
  assert.equal(fixture.attributes.lang, 'en');
  assert.equal(fixture.attributes.dir, 'ltr');
  assert.equal(fixture.elements['hero-district'].value, 'Kampala');
  assert.equal(fixture.elements['hero-context-f'].value, '2');
  assert.equal(fixture.elements['hero-radius-f'].value, '10');
});

test('EN to LG to AR to EN retains real language and direction changes', () => {
  const fixture = languageFixture();
  for (const language of ['lg', 'ar', 'en']) {
    fixture.context.setLang(language, true, false);
    assert.equal(fixture.attributes.lang, language);
    assert.equal(fixture.attributes.dir, language === 'ar' ? 'rtl' : 'ltr');
    assert.equal(fixture.elements['lang-sel'].value, language);
    assert.equal(fixture.elements['lang-sel-spotlight'].value, language);
    assert.equal(fixture.elements['hero-context-f'].value, '2');
    assert.equal(fixture.elements['hero-q'].placeholder, `${language}:phRent`);
  }
  assert.deepEqual(fixture.writes, [
    ['lang', 'lg'], ['lang', 'ar'], ['dir', 'rtl'], ['lang', 'en'], ['dir', 'ltr']
  ]);
});

test('the real initializer builds usable hero controls once and preserves selected search filters', () => {
  const fixture = languageFixture();
  fixture.context.initializeMakaugApp();
  for (const name of ['setHeroLocationFilter', 'setHeroRadiusState', 'setHeroContextFilter']) {
    assert.equal(fixture.calls.filter((call) => call[0] === name).length, 1, name);
  }
  assert.equal(fixture.elements['hero-district'].writes, 1);
  assert.deepEqual(fixture.elements['hero-district'].options.map((option) => option.value), ['', 'Kampala', 'Wakiso']);
  assert.equal(fixture.elements['hero-district'].value, 'Kampala');
  assert.equal(fixture.elements['hero-context-f'].writes, 1);
  assert.equal(fixture.elements['hero-context-f'].value, '2');
  assert.equal(fixture.elements['hero-radius-f'].value, '10');
  assert.equal(fixture.calls.filter((call) => call[0] === 'initFrontendAnalytics').length, 1);
  assert.equal(fixture.calls.filter((call) => call[0] === 'initWebVitalsTracking').length, 1);
});

let refreshStatement;
walk(fn('initializeMakaugApp'), (node) => {
  if (node.type === 'ExpressionStatement' && source.slice(node.start, node.end).startsWith('refreshPublicListingsFromApi(')) {
    refreshStatement = node;
  }
});
assert.ok(refreshStatement, 'actual startup inventory refresh callback');

test('completed inventory startup keeps maps and route handoff without an extra active-home render', async () => {
  for (const [pathname, page, country, active, renders] of [
    ['/', 'home', 'UG', true, 0], ['/index.html', 'home', 'UG', true, 0],
    ['/to-rent/kyanja-kampala', 'rent', 'UG', true, 1],
    ['/', 'home', 'UG', false, 1], ['/', 'home', 'CD', true, 1]
  ]) {
    const calls = [];
    const context = vm.createContext({
      currentPage: page, ACTIVE_LOCATION_COUNTRY: { countryCode: country },
      window: { location: { pathname } },
      document: { getElementById: (id) => id === 'page-home' ? { classList: { contains: () => active } } : null },
      refreshPublicListingsFromApi: async () => true,
      renderAll: () => calls.push('render'), resetMaps: () => calls.push('maps'),
      syncActiveRouteSearchHandoff: (reason) => calls.push(reason)
    });
    vm.runInContext(code('normalizeRoutePath') + '\n' + code('isActiveUgandaHomepage'), context);
    await vm.runInContext(source.slice(refreshStatement.start, refreshStatement.end), context);
    assert.deepEqual(calls, [...Array(renders).fill('render'), 'maps', 'public_inventory_route_query'],
      `${country} ${pathname} active=${active}`);
  }
});

test('failed inventory startup performs no completion render, map reset or route handoff', async () => {
  const calls = [];
  const context = vm.createContext({ refreshPublicListingsFromApi: async () => false,
    renderAll: () => calls.push('render'), resetMaps: () => calls.push('maps'),
    syncActiveRouteSearchHandoff: () => calls.push('handoff') });
  await vm.runInContext(source.slice(refreshStatement.start, refreshStatement.end), context);
  assert.deepEqual(calls, []);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function inventoryFixture({ category = false } = {}) {
  const flights = { main: deferred(), featured: deferred(), summary: deferred() };
  const calls = [], pageState = {};
  let actor = 'startup';
  const visible = { cards: [], total: null };
  const context = vm.createContext({
    console: { warn: (...args) => calls.push({ actor, kind: 'warning', message: args[0] }) },
    currentPage: category ? 'rent' : 'home', ACTIVE_LOCATION_COUNTRY: { countryCode: 'UG' },
    window: { location: { pathname: category ? '/to-rent' : '/' }, setTimeout() {}, clearTimeout() {} },
    document: { getElementById: (id) => id === 'page-home' ? { classList: { contains: () => !category } } : null },
    PROPERTIES: [], BROKERS: [], REMOTE_BROKERS: [], remoteBrokersLoaded: false,
    publicFeaturedListingsFromApi: [], publicListingsFromApiLoaded: false,
    publicListingsApiLoading: false, publicListingsApiStats: null, publicListingsApiTotal: null,
    PUBLIC_CANONICAL_LOCATION_MATCH_BY_PROPERTY_ID: new Map(),
    PUBLIC_LISTINGS_FAST_PAGE_LIMIT: 8, PUBLIC_RESULTS_PAGE_SIZE: 24,
    fetchPublicFeaturedListingsFromApi: () => { calls.push({ actor, kind: 'featured-request' }); return flights.featured.promise; },
    fetchPublicOpportunityStatsFromApi: () => flights.summary.promise,
    fetchPublicPaginatedRows: () => flights.main.promise,
    adminRecordLooksLikeTest: () => false, isListingPublicVisible: (row) => row.status === 'approved',
    isPublicDemoTrainingListing: () => false, publicSampleListingsEnabled: () => false,
    isFoundOnlineListing: () => false, normalizeType: (value) => value,
    parseDateSafe: (value) => new Date(value),
    sortListingsByNewest: (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    hasActivePublicCategoryFilter: () => false, publicCategoryHasRouteSearch: () => false,
    publicCategoryRenderTotal: (_key, rows) => rows.length,
    renderPublicCategoryPageWithAuthoritativeCache() {}, getFeaturedBrokers: (rows) => rows,
    renderBrokers() {}, renderSaved() {}, renderActiveAuthDashboard() {},
    ensureRevenuePlacements() {}, syncPublicWhatsappLinks() {}, setAboutPublicListingsTotal() {},
    renderHeroPropertyOpportunityCounter() {
      visible.total = context.publicListingsApiStats?.total ?? context.publicListingsApiTotal;
      calls.push({ actor, kind: 'counter', total: visible.total });
    },
    renderGrid(id, rows) {
      if (id !== 'home-grid') return;
      visible.cards = rows.map((row) => ({ id: row.id, title: row.title }));
      calls.push({ actor, kind: 'home-grid', ids: rows.map((row) => row.id) });
    },
    resetMaps: () => calls.push({ actor, kind: 'maps' }),
    syncActiveRouteSearchHandoff: (reason) => calls.push({ actor, kind: 'handoff', reason }),
    publicPaginationStateFor: () => pageState,
    publicInventoryRouteSearchPath: () => '', publicInventoryCategoryPath: () => '/api/properties?category=rent',
    renderPublicCategoryPagination() {}, syncPublicCategoryPaginationSource() {}, cachePublicCategoryPageRows() {},
    publicCategoryTotalForPagination: (_key, _count, response) => response.pagination.total,
    exactPublicPaginationTotalValue: (response) => response.pagination.total,
    publicPaginationHasMore: () => false, clearPublicSearchDelayNotice() {}, publicOpportunityStatForCategory: () => 0
  });
  // Network requests and DOM/map writes are adapters. Actual state application,
  // home selection, rendering orchestration and async completion remain real.
  vm.runInContext(['normalizeRoutePath', 'isActiveUgandaHomepage', 'activePublicInventoryCategoryFromRoute',
    'normalizeHeroOpportunityStats', 'upsertPropertyForUi', 'applyPublicRowsForUi', 'applyPublicFeaturedRows',
    'applyPublicOpportunityStats', 'isBackendControlledListing', 'getPublicListings', 'isFeaturedListing',
    'getFeaturedListings', 'getHomepageFeaturedListings', 'isStudentDiscoverable', 'getBrokerDirectory',
    'featuredBrokerLimit', 'renderAll', 'refreshPublicListingsFromApi'].map(code).join('\n'), context);
  const render = context.renderAll;
  context.renderAll = () => { calls.push({ actor, kind: 'render' }); return render(); };
  const completion = vm.runInContext(source.slice(refreshStatement.start, refreshStatement.end), context);
  let completed = false;
  completion.then(() => { completed = true; });
  return { context, calls, visible, flights, completion, pageState,
    completed: () => completed, setActor: (value) => { actor = value; } };
}

const mainRows = [
  { id: 'main-old', title: 'Approved rental one', type: 'rent', status: 'approved', created_at: '2026-10-01T00:00:00Z' },
  { id: 'main-new', title: 'Approved rental two', type: 'rent', status: 'approved', created_at: '2026-10-02T00:00:00Z' }
];
const featuredRows = [{ id: 'featured', title: 'Approved featured property', type: 'sale', status: 'approved', featured: true }];
const settle = () => new Promise((resolve) => setImmediate(resolve));
function resolveInventory(fixture, kind, featuredResult = 'rows') {
  fixture.setActor(kind);
  if (kind === 'main') fixture.flights.main.resolve({ rows: mainRows.map((row) => ({ ...row })), firstResponse: { pagination: { total: 2 } } });
  if (kind === 'summary') fixture.flights.summary.resolve({ total: 100, rent: 90, sale: 10 });
  if (kind === 'featured') {
    if (featuredResult === 'failure') fixture.flights.featured.reject(new Error('fixture featured unavailable'));
    else fixture.flights.featured.resolve(featuredResult === 'empty' ? [] : featuredRows.map((row) => ({ ...row })));
  }
}

test('real inventory continuation renders main and featured updates and directly applies summary in every response order', async () => {
  const orders = [
    ['main', 'featured', 'summary'], ['main', 'summary', 'featured'],
    ['featured', 'main', 'summary'], ['featured', 'summary', 'main'],
    ['summary', 'main', 'featured'], ['summary', 'featured', 'main']
  ];
  for (const order of orders) {
    const fixture = inventoryFixture();
    for (const [index, kind] of order.entries()) {
      resolveInventory(fixture, kind);
      await settle();
      if (index < 2) assert.equal(fixture.completed(), false, `${order}: completion waits for all responses`);
      if (kind === 'main') assert.ok(fixture.calls.some((call) => call.actor === 'main' && call.kind === 'render'), `${order}: main rows rendered`);
      if (kind === 'featured') assert.ok(fixture.calls.some((call) => call.actor === 'featured' && call.kind === 'home-grid' && call.ids[0] === 'featured'), `${order}: featured cards rendered`);
      if (kind === 'summary') {
        assert.ok(fixture.calls.some((call) => call.actor === 'summary' && call.kind === 'counter' && call.total === 100), `${order}: direct summary counter update`);
      }
    }
    await fixture.completion;
    assert.equal(fixture.completed(), true);
    assert.deepEqual(fixture.visible.cards, [{ id: 'featured', title: 'Approved featured property' }]);
    assert.equal(fixture.visible.total, 100);
    assert.deepEqual(fixture.context.PROPERTIES.filter((row) => row.type === 'rent').map((row) => row.title), mainRows.map((row) => row.title));
    assert.equal(fixture.calls.filter((call) => call.kind === 'render').length, 2, `${order}: no redundant completion render`);
    assert.equal(fixture.calls.filter((call) => call.kind === 'maps').length, 1);
    assert.deepEqual(fixture.calls.filter((call) => call.kind === 'handoff').map((call) => call.reason), ['public_inventory_route_query']);
    assert.equal(fixture.context.publicListingsApiLoading, false);
  }
});

test('empty or unavailable featured response keeps rendered main fallback and complete summary', async () => {
  for (const result of ['empty', 'failure']) {
    const fixture = inventoryFixture();
    for (const kind of ['main', 'summary', 'featured']) {
      resolveInventory(fixture, kind, result);
      await settle();
    }
    await fixture.completion;
    assert.deepEqual(fixture.visible.cards.map((row) => row.id), ['main-new', 'main-old']);
    assert.equal(fixture.visible.total, 100);
    assert.equal(fixture.calls.filter((call) => call.kind === 'render').length, 1);
    assert.equal(fixture.calls.filter((call) => call.kind === 'maps').length, 1);
    assert.deepEqual(fixture.calls.filter((call) => call.kind === 'handoff').map((call) => call.reason), ['public_inventory_route_query']);
    assert.equal(fixture.calls.filter((call) => call.kind === 'warning').length, result === 'failure' ? 1 : 0);
  }
});

test('real category continuation retains its completion render after final pagination state is ready', async () => {
  for (const order of [['main', 'summary'], ['summary', 'main']]) {
    const fixture = inventoryFixture({ category: true });
    for (const kind of order) {
      resolveInventory(fixture, kind);
      await settle();
    }
    await fixture.completion;
    assert.equal(fixture.calls.filter((call) => call.kind === 'featured-request').length, 0);
    assert.equal(fixture.calls.filter((call) => call.kind === 'render').length, 3, 'main, summary and completion each retain category rendering');
    assert.equal(fixture.pageState.total, 2);
    assert.equal(fixture.pageState.loading, false);
    assert.equal(fixture.pageState.totalAuthoritative, true);
    assert.equal(fixture.calls.filter((call) => call.kind === 'maps').length, 1);
    assert.deepEqual(fixture.calls.filter((call) => call.kind === 'handoff').map((call) => call.reason), ['public_inventory_route_query']);
  }
});
