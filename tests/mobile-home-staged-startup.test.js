'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const acorn = require('acorn');

const source = fs.readFileSync(process.env.MAKAUG_BOOT_TEST_SOURCE || require.resolve('../assets/makaug-app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest' });
const fn = (name) => ast.body.find((node) => node.type === 'FunctionDeclaration' && node.id.name === name);
function code(name) { const node = fn(name); assert.ok(node, name); return source.slice(node.start, node.end); }
function variable(name) {
  const node = ast.body.find((node) => node.type === 'VariableDeclaration' && node.declarations.some((item) => item.id.name === name));
  return node ? source.slice(node.start, node.end) : '';
}
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => walk(child, visit));
    else if (value && typeof value === 'object') walk(value, visit);
  }
}

function fixture(options = {}) {
  const calls = [], timers = [], documents = {}, windows = {};
  const mutable = { mobile: true, active: true, country: 'UG', storage: {}, language: 'lg', ...options };
  const location = { origin: 'https://makaug.test', pathname: options.pathname || '/', search: options.search || '', hash: options.hash || '' };
  const elements = { 'page-home': { classList: { contains: () => mutable.active } } };
  if (options.protectedShell) elements[options.protectedShell] = {};
  const context = vm.createContext({
    URL, Promise, String, console, ACTIVE_LOCATION_COUNTRY: { countryCode: mutable.country },
    currentPage: options.page || 'home', currentTab: 'rent', currentLang: mutable.language,
    authState: options.authState || { token: null, user: null },
    AUTH_STORAGE_KEY: 'makaug_auth', ADMIN_API_KEY_STORAGE_KEY: 'makaug_admin_api_key',
    authSignInAudience: 'finder', authSignUpAudience: 'finder', authSignUpOtpChannel: 'phone', typeaheadState: { input: null },
    window: { location, history: { pushState(_state, _title, value) {
      const url = new URL(value, location.origin);
      Object.assign(location, { pathname: url.pathname, search: url.search, hash: url.hash });
      calls.push(['route', value]);
    } },
    matchMedia: () => ({ matches: mutable.mobile }),
    setTimeout(callback, delay) { timers.push({ callback, delay }); },
    addEventListener(type, callback, settings) { (windows[type] ||= []).push(callback); calls.push(['window-listener', type, settings]); } },
    document: { getElementById: (id) => elements[id] || null,
      addEventListener(type, callback, settings) { (documents[type] ||= []).push(callback); calls.push(['document-listener', type, settings]); } },
    localStorage: { getItem(key) { if (mutable.storageError) throw new Error('fixture storage denied'); return mutable.storage[key] || null; } }
  });
  if (options.noMatchMedia) delete context.window.matchMedia;
  const names = new Set();
  walk(fn('initializeMakaugApp'), (node) => {
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier') names.add(node.callee.name);
  });
  for (const name of names) if (!context[name]) context[name] = (...args) => { calls.push([name, ...args]); };
  context.getStoredMakaugLanguagePreference = () => { calls.push(['saved-language']); return mutable.language; };
  context.getStartupLanguagePreference = (value) => value;
  context.captureInitialSsrCategoryGrid = () => calls.push(['capture', location.pathname]);
  context.refreshPublicListingsFromApi = () => { calls.push(['listings']); return Promise.resolve(false); };
  context.refreshBrokersFromApi = () => { calls.push(['brokers']); return Promise.resolve(false); };
  context.parseInitialDeepLink = () => calls.push(['parse', location.pathname, location.search]);
  context.finishInitialSsrCategoryGridSetup = () => false;
  context.lpVal = () => '';
  context.getListType = () => 'rent';
  context.adminControlForPath = () => '';
  context.authAudienceFromLoginParams = (params) => params.get('audience') || 'finder';
  context.currentPathWithQueryAndHash = () => location.pathname + location.search + location.hash;
  context.pageForPublicRoute = (path) => path === '/to-rent' ? 'rent' : '';
  context.beginPublicRouteIntent = () => 'fixture-intent';
  context.isPublicRouteSkeletonElement = () => false;
  context.mountPublicRouteSkeleton = (page) => { context.currentPage = page; };
  context.loadPublicRouteFragment = (url, page) => { calls.push(['fragment', url, page]); return Promise.resolve(true); };
  vm.runInContext(variable('publicRouteInterceptorInstalled') + variable('makaugAppStartupQueued') +
    ['normalizeRoutePath', 'isActiveUgandaHomepage', 'navigatePublicRoute', 'installPublicRouteInterceptor',
      'shouldYieldMobileHomepageStartup', 'initializeMakaugApp', 'startMakaugApp'].map(code).join('\n'), context);
  return { context, calls, timers, location, mutable, elements, documents, windows,
    start: () => context.startMakaugApp(),
    pendingStages: () => timers.filter((task) => task.delay === 0).length,
    stage() {
      const index = timers.findIndex((task) => task.delay === 0);
      assert.ok(index >= 0, 'the next startup stage must be queued');
      timers.splice(index, 1)[0].callback();
    },
    drain() {
      let index, count = 0;
      while ((index = timers.findIndex((task) => task.delay === 0)) >= 0) {
        assert.ok(++count <= 8, 'startup must not queue an endless continuation');
        timers.splice(index, 1)[0].callback();
      }
    },
    click(href) {
      const event = { button: 0, target: { closest: () => ({ target: '', dataset: {}, hasAttribute: () => false, getAttribute: () => href }) },
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
      for (const callback of [...(documents.click || [])]) callback(event);
      return event;
    }
  };
}

function names(fixture) { return fixture.calls.map((call) => call[0]); }
// The observable adapter and listener sequence from deployed 9c180. This also
// catches deleted actions that a staged-vs-synchronous comparison would miss.
const ORIGINAL_ACTION_ORDER = [
  'document-listener', 'window-listener', 'capture', 'saved-language', 'addAdUnits', 'initGoogleAds',
  'populateDistricts', 'populateBrokerFilterOptions', 'populateUniversitySelects', 'populateListAddressSuggestions',
  'loadDashboardState', 'loadAuthState', 'hydrateMonetizationConfig', 'handleOAuthReturnFromUrl', 'setLang',
  'initFrontendAnalytics', 'initWebVitalsTracking', 'populateLpRegionOptions', 'onLpRegionChange', 'setListType',
  'setListWizardStep', 'setLpOtpChannel', 'toggleLpFieldAgentId', 'updateLpPhotoRequirements', 'updateListPreview',
  'renderLpPhotoFeedback', 'onLpVerifyPhoneInput', 'onLpVerifyEmailInput', 'onLpVerifyNinInput', 'renderAll',
  'hydrateRevenuePlacementCatalog', 'renderHowToVideoSections', 'listings', 'renderMortgageFinder',
  'scheduleInitialPublicMaps', 'brokers', 'filterStudents', 'filterCommercial', 'filterLand', 'wireSearchTypeahead',
  'parse', 'syncAgentRegistrationForm', 'toggleAgentFieldIdInput', 'setAuthSignInAudience', 'updateAdminAccessEntrypoints',
  'document-listener', 'setAuthSignUpAudience', 'setAuthSignUpOtpChannel', 'document-listener', 'window-listener', 'window-listener'
];
function assertComplete(fixture) {
  for (const name of ['capture', 'saved-language', 'loadAuthState', 'setLang', 'initFrontendAnalytics',
    'initWebVitalsTracking', 'listings', 'brokers', 'wireSearchTypeahead', 'parse', 'setAuthSignUpAudience']) {
    assert.equal(names(fixture).filter((value) => value === name).length, 1, `${name} starts exactly once`);
  }
  assert.equal(fixture.documents.click.length, 2);
  assert.equal(fixture.documents.keydown.length, 1);
  assert.equal(fixture.windows.popstate.length, 1);
  assert.equal(fixture.windows.resize.length, 1);
  assert.equal(fixture.windows.scroll.length, 1);
}

test('clean anonymous mobile home runs four distinct startup tasks in the original synchronous order', () => {
  const immediate = fixture();
  immediate.context.initializeMakaugApp();
  assert.deepEqual(names(immediate), ORIGINAL_ACTION_ORDER, 'the baseline actions remain present in their original order');
  const queued = fixture();
  queued.start();
  assert.equal(names(queued).includes('capture'), false, 'only navigation is installed before the first startup task');
  let previous = queued.calls.length;
  for (let stage = 1; stage <= 4; stage++) {
    assert.equal(queued.pendingStages(), 1, `stage ${stage} has one scheduled continuation`);
    queued.stage();
    assert.ok(queued.calls.length > previous, `stage ${stage} performs a nonempty part of startup`);
    if (stage < 4) assert.ok(queued.calls.length < immediate.calls.length, `stage ${stage} leaves work for a later task`);
    previous = queued.calls.length;
  }
  assert.equal(queued.pendingStages(), 0);
  assert.deepEqual(queued.calls, immediate.calls, 'the four tasks retain all original actions, arguments and listener order');
  assert.deepEqual(queued.calls.find((call) => call[0] === 'setLang'), ['setLang', 'lg', true, false]);
  assertComplete(queued);
});

test('scope changes at every boundary drain all remaining stages synchronously and once', () => {
  const mutations = {
    route: (f) => { f.location.pathname = '/to-rent'; f.context.currentPage = 'rent'; },
    query: (f) => { f.location.search = '?q=Kyanja'; }, hash: (f) => { f.location.hash = '#/to-rent'; },
    memoryToken: (f) => { f.context.authState.token = 'fixture'; }, memoryUser: (f) => { f.context.authState.user = { id: 'fixture' }; },
    storedAuth: (f) => { f.mutable.storage.makaug_auth = '{"token":"fixture"}'; },
    storedAdmin: (f) => { f.mutable.storage.makaug_admin_api_key = 'fixture'; },
    tenant: (f) => { f.context.ACTIVE_LOCATION_COUNTRY.countryCode = 'CD'; },
    viewport: (f) => { f.mutable.mobile = false; }, inactiveHome: (f) => { f.mutable.active = false; },
    protectedShell: (f) => { f.elements['page-admin-dashboard'] = {}; },
    deniedStorage: (f) => { f.mutable.storageError = true; }, missingMatchMedia: (f) => { delete f.context.window.matchMedia; }
  };
  const reference = fixture(); reference.context.initializeMakaugApp();
  for (let boundary = 1; boundary <= 3; boundary++) for (const [name, mutate] of Object.entries(mutations)) {
    const f = fixture(); f.start();
    for (let stage = 0; stage < boundary; stage++) f.stage();
    mutate(f);
    f.stage();
    assert.equal(f.pendingStages(), 0, `${name} at boundary ${boundary}: no later continuation is queued`);
    assert.deepEqual(names(f), names(reference), `${name} at boundary ${boundary}: remainder keeps its original order`);
    assertComplete(f);
  }
});

test('desktop, deep links, queries, hashes, auth, protected shells and excluded scopes stay synchronous', () => {
  for (const options of [
    { mobile: false }, { country: 'CD' }, { pathname: '/index.html' }, { pathname: '/property/fixture' },
    { pathname: '/to-rent', page: 'rent' }, { pathname: '/login' }, { pathname: '/signup' },
    { page: 'rent' }, { active: false }, { storageError: true }, { noMatchMedia: true },
    { search: '?q=Kyanja' }, { search: '?auth=create&role=student' }, { search: '?utm_source=fixture' }, { hash: '#/to-rent' },
    { authState: { token: 'fixture', user: null } }, { authState: { token: null, user: { id: 'fixture' } } },
    { storage: { makaug_auth: '{"token":"fixture"}' } }, { storage: { makaug_admin_api_key: 'fixture' } },
    ...['page-account', 'page-staff-dashboard', 'page-admin-dashboard'].map((protectedShell) => ({ protectedShell }))
  ]) {
    const f = fixture(options); f.start();
    assert.equal(f.pendingStages(), 0, JSON.stringify(options));
    assertComplete(f);
  }
});

test('repeated starts and direct initialization before or during queued work never duplicate startup', () => {
  const reference = fixture(); reference.context.initializeMakaugApp();
  const f = fixture(); f.start(); f.start();
  assert.equal(f.pendingStages(), 1);
  for (let stage = 0; stage < 4; stage++) {
    f.stage(); f.start(); f.context.initializeMakaugApp();
  }
  assert.deepEqual(f.calls, reference.calls);
  assertComplete(f);
  const beforeFirst = fixture(); beforeFirst.start(); beforeFirst.context.initializeMakaugApp(); beforeFirst.drain();
  assert.deepEqual(beforeFirst.calls, reference.calls);
  assertComplete(beforeFirst);
});

test('a nested initializer request from an existing startup adapter stays idempotent', () => {
  const f = fixture();
  f.context.loadAuthState = () => { f.calls.push(['loadAuthState']); f.start(); f.context.initializeMakaugApp(); };
  f.start(); f.drain();
  assertComplete(f);
  assert.equal(f.pendingStages(), 0);
});

test('early route navigation preserves the search query and drains startup on the new route', () => {
  const f = fixture(); f.start();
  assert.equal(f.click('/to-rent?q=Kyanja%20apartments').defaultPrevented, true);
  assert.equal(f.location.pathname, '/to-rent');
  assert.equal(f.location.search, '?q=Kyanja%20apartments');
  f.stage();
  assert.equal(f.pendingStages(), 0);
  assert.deepEqual(f.calls.find((call) => call[0] === 'parse'), ['parse', '/to-rent', '?q=Kyanja%20apartments']);
  assertComplete(f);
});

function vitalFixture(readyState) {
  const calls = [], listeners = [], observers = [];
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(options) { this.options = options; }
  }
  const document = { readyState };
  const context = vm.createContext({
    document, PerformanceObserver: Observer,
    window: { PerformanceObserver: Observer, location: { pathname: '/' }, innerWidth: 390,
      addEventListener(type, callback, options) { listeners.push({ type, callback, options }); } },
    navigator: { connection: { effectiveType: '4g' } },
    performance: { getEntriesByType: () => [{ responseStart: 160 }],
      getEntriesByName: () => [{ startTime: 450 }] },
    apiUrl: (url) => url, getAnalyticsClientId: () => 'synthetic-session',
    fetch(url, options) { calls.push({ url, payload: JSON.parse(options.body), options }); return Promise.resolve({ text: async () => 'accepted' }); }
  });
  vm.runInContext(variable('sentWebVitalMetrics') + code('sendWebVitalMetric') + code('initWebVitalsTracking'), context);
  return { context, calls, listeners, observers, document,
    load() {
      document.readyState = 'complete';
      for (const listener of [...listeners]) if (listener.type === 'load') {
        listener.callback();
        if (listener.options?.once) listeners.splice(listeners.indexOf(listener), 1);
      }
    } };
}

test('Web Vitals initialized after load immediately catches up TTFB/FCP and keeps metric dedup', () => {
  const f = vitalFixture('complete');
  f.context.initWebVitalsTracking();
  assert.deepEqual(f.calls.map((call) => [call.payload.metricName, call.payload.value]), [['TTFB', 160], ['FCP', 450]]);
  assert.equal(f.listeners.filter((listener) => listener.type === 'load').length, 0, 'an already complete document needs no load listener');
  f.context.initWebVitalsTracking(); f.load();
  assert.equal(f.calls.length, 2, 'catch-up and repeated initialization never send duplicate metrics');
  assert.ok(f.calls.every((call) => call.options.keepalive === true && call.payload.route === '/'));
});

test('Web Vitals initialized before load waits for one load event and sends each metric once', () => {
  for (const readyState of ['loading', 'interactive']) {
    const f = vitalFixture(readyState);
    f.context.initWebVitalsTracking();
    assert.equal(f.calls.length, 0);
    assert.equal(f.listeners.length, 1);
    assert.equal(f.listeners[0].type, 'load');
    assert.equal(f.listeners[0].options.once, true);
    f.load(); f.load();
    assert.deepEqual(f.calls.map((call) => [call.payload.metricName, call.payload.value]), [['TTFB', 160], ['FCP', 450]]);
    assert.deepEqual(f.observers.map((observer) => observer.options.type), ['largest-contentful-paint', 'layout-shift', 'event']);
  }
});
