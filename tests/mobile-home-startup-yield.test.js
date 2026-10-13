'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');

const source = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest' });
const node = name => ast.body.find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
const code = name => { const n = node(name); assert(n, name); return source.slice(n.start, n.end); };
const optional = name => node(name) ? code(name) : '';
const variable = name => {
  const n = ast.body.find(n => n.type === 'VariableDeclaration' && n.declarations.some(d => d.id.name === name));
  return n ? source.slice(n.start, n.end) : '';
};
const startup = ast.body.filter(n => n.type === 'ExpressionStatement'
  && n.expression.type === 'CallExpression'
  && ['initializeMakaugApp', 'startMakaugApp'].includes(n.expression.callee.name)).at(-1);
assert(startup, 'actual top-level startup expression');

function walk(n, callback) {
  if (!n || typeof n !== 'object') return;
  callback(n);
  for (const value of Object.values(n)) {
    if (Array.isArray(value)) value.forEach(child => walk(child, callback));
    else if (value && typeof value === 'object') walk(value, callback);
  }
}

function fixture(options = {}) {
  const calls = [], timers = [], documentListeners = {}, windowListeners = {};
  const location = { origin: 'https://makaug.test', pathname: options.pathname || '/',
    search: options.search || '', hash: options.hash || '' };
  const elements = { 'page-home': { classList: { contains: () => options.active !== false } } };
  if (options.protectedShell) elements['page-staff-dashboard'] = {};
  const pushState = (_state, _title, value) => {
    const url = new URL(value, location.origin);
    Object.assign(location, { pathname: url.pathname, search: url.search, hash: url.hash });
    calls.push(['route', value]);
  };
  const context = vm.createContext({
    URL, Promise, String, console,
    ACTIVE_LOCATION_COUNTRY: { countryCode: options.country || 'UG' },
    currentPage: options.page || 'home', authState: options.authState || { token: null, user: null },
    AUTH_STORAGE_KEY: 'makaug_auth', ADMIN_API_KEY_STORAGE_KEY: 'makaug_admin_api_key',
    currentTab: 'rent', authSignInAudience: 'finder', authSignUpAudience: 'finder', authSignUpOtpChannel: 'phone',
    typeaheadState: { input: null },
    window: { location, history: { pushState },
      matchMedia: () => ({ matches: options.mobile !== false }),
      setTimeout(callback, delay) { timers.push({ callback, delay }); calls.push(['timer', delay]); },
      addEventListener(type, callback) { (windowListeners[type] ||= []).push(callback); } },
    document: { getElementById: id => elements[id] || null,
      addEventListener(type, callback) { (documentListeners[type] ||= []).push(callback); } },
    localStorage: { getItem(key) {
      if (options.storageError) throw new Error('fixture storage denied');
      return options.storage?.[key] || null;
    } }
  });
  // Execute the real entire initializer. Only its external UI/network adapters
  // are replaced; the initialized guard, call order and callbacks remain real.
  const names = new Set();
  walk(node('initializeMakaugApp'), n => {
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier') names.add(n.callee.name);
  });
  for (const name of names) {
    if (!context[name]) context[name] = (...args) => { calls.push([name, ...args]); };
  }
  context.refreshPublicListingsFromApi = () => { calls.push(['listings']); return Promise.resolve(false); };
  context.refreshBrokersFromApi = () => { calls.push(['brokers']); return Promise.resolve(false); };
  context.parseInitialDeepLink = () => { calls.push(['parse', location.pathname, location.search]); };
  context.finishInitialSsrCategoryGridSetup = () => false;
  context.captureInitialSsrCategoryGrid = () => { calls.push(['capture', location.pathname]); };
  context.getStoredMakaugLanguagePreference = () => 'en';
  context.getStartupLanguagePreference = value => value;
  context.lpVal = () => '';
  context.getListType = () => 'rent';
  context.adminControlForPath = () => '';
  context.authAudienceFromLoginParams = params => params.get('audience') || 'finder';
  context.currentPathWithQueryAndHash = () => location.pathname + location.search + location.hash;
  context.pageForPublicRoute = p => p === '/to-rent' ? 'rent' : '';
  context.beginPublicRouteIntent = page => { calls.push(['intent', page]); return 'fixture-intent'; };
  context.isPublicRouteSkeletonElement = () => false;
  context.mountPublicRouteSkeleton = page => { context.currentPage = page; calls.push(['skeleton', page]); };
  context.loadPublicRouteFragment = (url, page) => { calls.push(['fragment', url, page]); return Promise.resolve(true); };
  vm.runInContext(variable('publicRouteInterceptorInstalled') + variable('makaugAppStartupQueued')
    + ['normalizeRoutePath', 'isActiveUgandaHomepage', 'navigatePublicRoute',
    'installPublicRouteInterceptor', 'initializeMakaugApp'].map(code).join('\n')
    + optional('shouldYieldMobileHomepageStartup') + optional('startMakaugApp'), context);
  return { context, calls, timers, location, documentListeners, windowListeners,
    start() { vm.runInContext(source.slice(startup.start, startup.end), context); },
    flush() { const task = timers.shift(); assert(task, 'queued task'); task.callback(); return task.delay; },
    click(href, extra = {}) {
      const event = { button: 0, target: { closest: () => ({ target: '', dataset: {}, hasAttribute: () => false,
        getAttribute: () => href }) }, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra };
      for (const listener of [...(documentListeners.click || [])]) listener(event);
      return event;
    } };
}

test('anonymous mobile Uganda home yields a real zero-delay task before full initialization', () => {
  const f = fixture();
  f.start();
  assert.equal(f.context.window.__makaugAppInitialized, undefined);
  assert.deepEqual(f.calls, [['timer', 0]], 'no initialization or SSR category capture runs in script evaluation');
  assert.equal(f.documentListeners.click.length, 1, 'navigation is installed synchronously');
  assert.equal(f.windowListeners.popstate.length, 1);
  f.calls.push(['script-finished']);
  assert.equal(f.flush(), 0);
  assert.equal(f.context.window.__makaugAppInitialized, true);
  assert.deepEqual(f.calls.slice(0, 3), [['timer', 0], ['script-finished'], ['capture', '/']]);
  const analytics = f.calls.findIndex(c => c[0] === 'initFrontendAnalytics');
  const vitals = f.calls.findIndex(c => c[0] === 'initWebVitalsTracking');
  assert(analytics > 2 && vitals > analytics, 'telemetry remains in full startup within the task');
  assert.equal(f.documentListeners.click.length, 2, 'idempotent route interceptor plus existing suggestion listener');
  assert.equal(f.windowListeners.popstate.length, 1);
});

test('all deep links, non-home, desktop, other tenants, authenticated and protected startup remain immediate', () => {
  for (const options of [
    { mobile: false }, { country: 'CD' }, { pathname: '/index.html' }, { pathname: '/property/fixture' },
    { pathname: '/staff-dashboard', page: 'staff-dashboard' }, { pathname: '/signup' }, { pathname: '/login' },
    { page: 'rent' }, { active: false }, { protectedShell: true }, { storageError: true },
    { search: '?auth=create&role=student' }, { search: '?q=Kyanja' }, { search: '?utm_source=fixture' },
    { hash: '#/to-rent' }, { authState: { token: 'synthetic', user: null } },
    { authState: { token: null, user: { id: 'synthetic' } } },
    { storage: { makaug_auth: '{"token":"synthetic"}' } },
    { storage: { makaug_admin_api_key: 'synthetic' } }
  ]) {
    const f = fixture(options);
    f.start();
    assert.equal(f.context.window.__makaugAppInitialized, true, JSON.stringify(options));
    assert.equal(f.calls[0][0], 'capture');
    assert(!f.timers.some(t => t.delay === 0), JSON.stringify(options));
    assert.equal(f.calls.filter(c => c[0] === 'loadAuthState').length, 1);
    assert.equal(f.calls.filter(c => c[0] === 'setAuthSignUpAudience')[0][1], 'finder');
    assert.equal(f.calls.filter(c => c[0] === 'setAuthSignUpOtpChannel')[0][1], 'phone');
  }
});

test('repeated startup requests and an already initialized app never duplicate timers or initialization', () => {
  const f = fixture();
  f.start(); f.start();
  assert.equal(f.timers.length, 1);
  f.flush(); f.start();
  assert.equal(f.calls.filter(c => c[0] === 'loadAuthState').length, 1);
  assert.equal(f.calls.filter(c => c[0] === 'initWebVitalsTracking').length, 1);
  const initialized = fixture();
  initialized.context.window.__makaugAppInitialized = true;
  initialized.start();
  assert.equal(initialized.calls.length, 0);
});

test('a synchronous initialization before the queued task is not repeated by that task', () => {
  const f = fixture(); f.start();
  f.context.initializeMakaugApp();
  f.flush();
  assert.equal(f.calls.filter(c => c[0] === 'loadAuthState').length, 1);
  assert.equal(f.calls.filter(c => c[0] === 'initWebVitalsTracking').length, 1);
});

test('early route/search navigation preserves the query and queued initialization uses the current route', () => {
  const f = fixture(); f.start();
  const event = f.click('/to-rent?q=Kyanja%20apartments');
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.context.currentPage, 'rent');
  assert.equal(f.location.pathname, '/to-rent');
  assert.equal(f.location.search, '?q=Kyanja%20apartments');
  assert.deepEqual(f.calls.find(c => c[0] === 'fragment'), ['fragment', '/to-rent?q=Kyanja%20apartments', 'rent']);
  assert.equal(f.context.window.__makaugAppInitialized, undefined);
  f.flush();
  assert.deepEqual(f.calls.find(c => c[0] === 'parse'), ['parse', '/to-rent', '?q=Kyanja%20apartments']);
  assert.equal(f.calls.filter(c => c[0] === 'capture').length, 1);
});

test('early sign-up/sign-in links keep their existing audience defaults and run startup once', () => {
  for (const [url, fn, audience] of [
    ['/signup', 'openAuthSignUp', 'finder'], ['/student-signup', 'openAuthSignUp', 'student'],
    ['/broker-signup', 'openAuthSignUp', 'agent'], ['/field-agent-signup', 'openAuthSignUp', 'field_agent'],
    ['/advertiser-signup', 'openAuthSignUp', 'advertiser'], ['/login', 'openAuthSignIn', 'finder']
  ]) {
    const f = fixture(); f.start();
    f.context[fn] = value => f.calls.push([fn, value]);
    assert.equal(f.click(url).defaultPrevented, true);
    assert.deepEqual(f.calls.find(c => c[0] === fn), [fn, audience]);
    assert.equal(f.location.pathname, url);
    f.flush();
    assert.equal(f.calls.filter(c => c[0] === 'loadAuthState').length, 1);
    assert.deepEqual(f.calls.find(c => c[0] === 'parse'), ['parse', url, '']);
  }
});

test('early external or modified clicks preserve native navigation', () => {
  const f = fixture(); f.start();
  assert.equal(f.click('https://external.test/path').defaultPrevented, undefined);
  assert.equal(f.click('/to-rent', { ctrlKey: true }).defaultPrevented, undefined);
  assert.equal(f.location.pathname, '/');
  f.flush();
  assert.equal(f.calls.filter(c => c[0] === 'loadAuthState').length, 1);
});
