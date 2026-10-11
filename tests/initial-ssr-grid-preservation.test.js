'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets/makaug-app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
const helpers = ['captureInitialSsrCategoryGrid', 'finishInitialSsrCategoryGridSetup', 'invalidateInitialSsrCategoryGrid', 'shouldPreserveInitialSsrCategoryGrid', 'renderPublicCategoryPage'];
const declarations = helpers.map((name) => {
  const node = ast.body.find((item) => item.type === 'FunctionDeclaration' && item.id.name === name);
  assert.ok(node, `${name} is declared in the actual application`);
  return source.slice(node.start, node.end);
}).join('\n');

function fixture({ category = 'students', pathname = '/student-accommodation', search = '', ssr = true, active = true, headingPath = pathname, controls = [] } = {}) {
  const key = category === 'student' ? 'students' : category;
  const gridId = key === 'students' ? 'student-grid' : `${key}-grid`;
  const initialHtml = '<article data-ssr-property-card="approved-1"><img src="/approved.webp"></article>';
  const grid = { innerHTML: initialHtml, querySelector: () => ssr ? { id: 'approved-1' } : null };
  const heading = { dataset: { ssrSeoPath: headingPath } };
  const page = {
    classList: { contains: () => active },
    querySelector: () => heading,
    querySelectorAll: () => controls,
    contains: (target) => target.inside === true
  };
  const nodes = { [`page-${key}`]: page, [gridId]: grid };
  const state = { page: 1, mode: 'api', total: 70, sourcePath: '', loading: false };
  const cache = {};
  const listeners = {};
  const calls = [];
  let apiPath = `/api/properties?category=${key}`;
  const context = vm.createContext({
    URLSearchParams,
    PUBLIC_RESULTS_PAGE_SIZE: 24,
    publicListingsFromApiLoaded: false,
    currentLang: 'en',
    window: { location: { pathname, search } },
    document: {
      getElementById: (id) => nodes[id] || null,
      addEventListener: (type, handler, capture) => { assert.equal(capture, true); listeners[type] = handler; }
    },
    publicPaginationKey: (value) => value === 'student' ? 'students' : value,
    activePublicInventoryCategoryFromRoute: () => category,
    publicPaginationGridId: (value) => value === 'students' ? 'student-grid' : `${value}-grid`,
    normalizeRoutePath: (value) => String(value || '/').replace(/\/+$/, '') || '/',
    publicPaginationStateFor: (value) => value === key ? state : null,
    publicCategoryApiPathForPagination: () => apiPath,
    publicPaginationCacheFor: () => cache,
    ensurePublicResultsHeader: () => calls.push('header'),
    syncPublicCategoryPaginationSource: (_key, value) => { state.sourcePath = value; },
    hasActivePublicCategoryFilter: () => false,
    authoritativePublicCategoryPageRows: () => null,
    publicCategoryTotalForPagination: (_key, length) => length,
    exactPublicPaginationTotalValue: (response) => response?.pagination?.total ?? null,
    publicPaginationPageCount: (total) => Math.max(1, Math.ceil(total / 24)),
    publicPaginationHasMore: () => false,
    renderStudentGrid: (rows) => { calls.push(['grid', rows.length]); grid.innerHTML = rows.length ? '<div data-client-card="1"></div>' : '<div>No matches</div>'; },
    renderGrid: (_id, rows) => { calls.push(['grid', rows.length]); grid.innerHTML = rows.length ? '<div data-client-card="1"></div>' : '<div>No matches</div>'; },
    updateStudentHeader: () => calls.push('count'),
    setPublicCategoryCount: () => calls.push('count'),
    publicPaginationMapId: () => '',
    renderCanonicalWideningNotice: () => {},
    renderCanonicalThinResultsAlert: () => {},
    updateCanonicalMobileFilterCount: () => {},
    renderPublicCategoryPagination: () => calls.push('pagination')
  });
  vm.runInContext(`let initialSsrCategoryGrid = null;\n${declarations}`, context);
  return { context, key, grid, state, cache, calls, listeners, nodes, initialHtml, setApiPath: (value) => { apiPath = value; }, apiPath: () => apiPath };
}

test('student hub, Makerere, Kireka and Kyanja keep the exact SSR grid through initial rendering', () => {
  for (const options of [
    { category: 'student', pathname: '/student-accommodation' },
    { category: 'student', pathname: '/student-accommodation/university/makerere' },
    { category: 'rent', pathname: '/to-rent/kireka-wakiso/' },
    { category: 'rent', pathname: '/to-rent/kyanja-kampala/apartments', search: '?utm_source=qa&page=1' }
  ]) {
    const f = fixture(options);
    assert.equal(f.context.captureInitialSsrCategoryGrid(), true);
    f.context.renderPublicCategoryPage(f.key, [], { total: 0 });
    assert.equal(f.grid.innerHTML, f.initialHtml);
    assert.deepEqual(f.calls, [], 'no header, count, pagination or grid writes occur before category readiness');
    f.context.finishInitialSsrCategoryGridSetup();
    f.context.publicListingsFromApiLoaded = true;
    f.context.currentLang = 'lg';
    f.context.renderPublicCategoryPage(f.key, [], { total: 0 });
    assert.equal(f.grid.innerHTML, f.initialHtml, 'unrelated inventory/summary and language rerenders retain SSR');
    assert.deepEqual(f.calls, []);
  }
});

test('a successful matching category answer releases preservation, including an empty result', () => {
  for (const rows of [[], [{ id: 'fresh' }]]) {
    const f = fixture();
    f.context.captureInitialSsrCategoryGrid();
    f.state.sourcePath = f.apiPath();
    f.cache[1] = rows;
    assert.equal(f.context.shouldPreserveInitialSsrCategoryGrid(f.key), true, 'programmatic route setup completes before releasing');
    f.context.finishInitialSsrCategoryGridSetup();
    f.context.renderPublicCategoryPage(f.key, rows, { total: rows.length, rowsOverride: rows });
    assert.notEqual(f.grid.innerHTML, f.initialHtml);
    assert.equal(f.grid.innerHTML.includes('No matches'), rows.length === 0);
    assert.deepEqual(f.calls, ['header', ['grid', rows.length], 'count', 'pagination']);
    assert.equal(f.context.shouldPreserveInitialSsrCategoryGrid(f.key), false, 'release is permanent');
  }
});

test('unrelated caches and a failed request do not discard the initial SSR inventory', () => {
  const f = fixture();
  f.context.captureInitialSsrCategoryGrid();
  f.context.finishInitialSsrCategoryGridSetup();
  f.state.sourcePath = '/api/properties?category=rent';
  f.cache[1] = [{ id: 'other-category' }];
  f.state.loading = false;
  assert.equal(f.context.shouldPreserveInitialSsrCategoryGrid(f.key), true);
  f.context.renderPublicCategoryPage(f.key, []);
  assert.equal(f.grid.innerHTML, f.initialHtml);
});

test('a matching empty category cache does not resurrect stale fallback rows without an override', () => {
  const f = fixture();
  f.context.captureInitialSsrCategoryGrid();
  f.context.finishInitialSsrCategoryGridSetup();
  f.state.sourcePath = f.apiPath();
  f.cache[1] = [];
  f.context.renderPublicCategoryPage(f.key, [{ id: 'stale-model-from-another-response' }], { total: 0 });
  assert.equal(f.grid.innerHTML, '<div>No matches</div>', 'a successful zero answer is authoritative even when old models remain');
  assert.deepEqual(f.calls, ['header', ['grid', 0], 'count', 'pagination']);
});

test('changed API filters, pathname, query, grid node or pagination invalidate preservation', () => {
  const variants = [
    (f) => f.setApiPath(`${f.apiPath()}&university=Makerere`),
    (f) => { f.context.window.location.pathname = '/student-accommodation/university/makerere'; },
    (f) => { f.context.window.location.search = '?q=hostel'; },
    (f) => { f.nodes['student-grid'] = { querySelector: () => ({}) }; },
    (f) => { f.state.page = 2; }
  ];
  for (const change of variants) {
    const f = fixture();
    f.context.captureInitialSsrCategoryGrid();
    f.context.finishInitialSsrCategoryGridSetup();
    change(f);
    assert.equal(f.context.shouldPreserveInitialSsrCategoryGrid(f.key), false);
    f.context.window.location.pathname = '/student-accommodation';
    f.context.window.location.search = '';
    f.state.page = 1;
    assert.equal(f.context.shouldPreserveInitialSsrCategoryGrid(f.key), false, 'returning to the old route cannot restore the guard');
  }
});

test('user filter events invalidate before inline handlers, while events outside the page do not', () => {
  for (const type of ['input', 'change', 'submit']) {
    const f = fixture();
    f.context.captureInitialSsrCategoryGrid();
    f.context.finishInitialSsrCategoryGridSetup();
    const target = { inside: false, closest: () => ({ matches: () => false }) };
    f.listeners[type]({ type, target });
    assert.equal(f.context.shouldPreserveInitialSsrCategoryGrid(f.key), true);
    target.inside = true;
    f.listeners[type]({ type, target });
    assert.equal(f.context.shouldPreserveInitialSsrCategoryGrid(f.key), false, type);
  }
});

test('opening More filters and typing an Ask AI prompt retain the initial listing grid', () => {
  const f = fixture();
  f.context.captureInitialSsrCategoryGrid();
  f.context.finishInitialSsrCategoryGridSetup();
  assert.equal(f.listeners.click, undefined, 'opening the filter sheet does not count as changing search criteria');
  const askInput = { inside: true, closest: () => null };
  f.listeners.input({ type: 'input', target: askInput });
  assert.equal(f.context.shouldPreserveInitialSsrCategoryGrid(f.key), true);
  assert.equal(f.grid.innerHTML, f.initialHtml);
});

test('capture rejects noncanonical queries, changed controls, inactive pages and missing SSR cards', () => {
  const changedInput = { tagName: 'INPUT', value: 'Kikoni', defaultValue: '' };
  const changedSelect = { tagName: 'SELECT', selectedIndex: 1, options: [{ defaultSelected: true }, {}] };
  for (const options of [{ search: '?page=2' }, { search: '?q=hostel' }, { headingPath: '/student-accommodation/university/makerere' }, { ssr: false }, { active: false }, { controls: [changedInput] }, { controls: [changedSelect] }]) {
    const f = fixture(options);
    assert.equal(f.context.captureInitialSsrCategoryGrid(), false);
    assert.equal(f.context.shouldPreserveInitialSsrCategoryGrid(f.key), false);
  }
});

test('default-selected controls and tracking/language parameters can preserve the initial page', () => {
  const f = fixture({ search: '?lang=lg&gclid=example&fbclid=example&utm_campaign=test', controls: [
    { tagName: 'INPUT', value: '1', defaultValue: '1' },
    { tagName: 'SELECT', selectedIndex: 1, options: [{}, { defaultSelected: true }] }
  ] });
  assert.equal(f.context.captureInitialSsrCategoryGrid(), true);
  f.context.invalidateInitialSsrCategoryGrid('rent');
  assert.equal(f.context.shouldPreserveInitialSsrCategoryGrid('students'), true, 'an unrelated category does not invalidate');
  f.context.invalidateInitialSsrCategoryGrid('student');
  assert.equal(f.context.shouldPreserveInitialSsrCategoryGrid('students'), false);
});

test('pages without a preserved SSR grid continue rendering their regular empty state', () => {
  const f = fixture({ ssr: false, category: 'rent', pathname: '/to-rent' });
  assert.equal(f.context.captureInitialSsrCategoryGrid(), false);
  f.context.renderPublicCategoryPage('rent', [], { total: 0 });
  assert.equal(f.grid.innerHTML, '<div>No matches</div>');
  assert.deepEqual(f.calls, ['header', ['grid', 0], 'count', 'pagination']);
});

test('the actual initial deep-link promise finishes setup before a fast route response can replace SSR', async () => {
  const deepLink = ast.body.find((node) => node.type === 'FunctionDeclaration' && node.id.name === 'parseInitialDeepLink');
  const initialize = ast.body.find((node) => node.type === 'FunctionDeclaration' && node.id.name === 'initializeMakaugApp');
  const setup = initialize.body.body.find((node) => node.type === 'ExpressionStatement'
    && source.slice(node.start, node.end).startsWith('Promise.resolve(parseInitialDeepLink())'));
  assert.ok(setup, 'the real startup pipeline awaits deep-link setup before finishing preservation');
  for (const options of [
    { category: 'student', pathname: '/student-accommodation/university/makerere' },
    { category: 'rent', pathname: '/to-rent/kyanja-kampala/apartments' }
  ]) {
    const f = fixture(options);
    let routePrepared = false;
    Object.assign(f.context, {
      console,
      normalizeLegacyHashPublicRoute() {},
      adminControlForPath: () => null,
      pageForPublicRoute: () => f.key,
      isPublicRouteSkeletonElement: () => false,
      showPage() {},
      applyHeroSearchHandoff() {},
      syncActiveRouteSearchHandoff() {
        f.setApiPath(`${f.apiPath()}&route=canonical`);
        f.state.sourcePath = f.apiPath();
        f.cache[1] = [];
        f.context.renderPublicCategoryPage(f.key, [], { total: 0, rowsOverride: [] });
        assert.equal(f.grid.innerHTML, f.initialHtml, 'even a fast empty API answer waits for programmatic route setup');
        assert.deepEqual(f.calls, []);
        routePrepared = true;
      },
      renderAll() { f.context.renderPublicCategoryPage(f.key, [], { total: 0, rowsOverride: [] }); }
    });
    vm.runInContext(source.slice(deepLink.start, deepLink.end), f.context);
    f.context.captureInitialSsrCategoryGrid();
    await vm.runInContext(source.slice(setup.start, setup.end), f.context);
    assert.equal(routePrepared, true);
    assert.equal(f.grid.innerHTML, '<div>No matches</div>', 'the final rerender uses the completed canonical route response');
    assert.equal(f.context.shouldPreserveInitialSsrCategoryGrid(f.key), false);
  }
});
