'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');

const source = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest' });
const fn = (name) => ast.body.find((n) => n.type === 'FunctionDeclaration' && n.id.name === name);
const code = (name) => { const n = fn(name); assert(n, name); return source.slice(n.start, n.end); };
const optionalCode = (name) => fn(name) ? code(name) : '';
function walk(node, callback) {
  if (!node || typeof node !== 'object') return;
  callback(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => walk(child, callback));
    else if (value && typeof value === 'object') walk(value, callback);
  }
}
function startupExpression(names) {
  let statement;
  walk(fn('initializeMakaugApp'), (n) => {
    if (n.type === 'ExpressionStatement' && names.some((name) => source.slice(n.start, n.end).startsWith(name + '('))) statement = n;
  });
  assert(statement, names.join('/'));
  return source.slice(statement.start, statement.end);
}
function summaryCallback() {
  let callback;
  walk(fn('refreshPublicListingsFromApi'), (n) => {
    if (n.type === 'CallExpression' && n.callee.type === 'MemberExpression'
      && n.callee.property.name === 'then'
      && n.callee.object.type === 'CallExpression'
      && n.callee.object.callee.name === 'fetchPublicOpportunityStatsFromApi') callback = n.arguments[0];
  });
  assert(callback, 'actual summary callback');
  return source.slice(callback.start, callback.end);
}

test('actual startup broker refresh applies API state and renders/maps exactly once', async () => {
  const calls = [];
  const context = vm.createContext({
    REMOTE_BROKERS: [], remoteBrokersLoaded: false,
    apiRequest: async (url, options) => { calls.push(['api', url, options.skipAuth]); return { data: [{ id: 'a' }] }; },
    mapRemoteAgentForUi: (row) => ({ ...row, name: 'Synthetic agent' }),
    populateBrokerFilterOptions: () => calls.push(['filters']),
    renderAll: () => calls.push(['render']),
    getBrokerDirectory: () => context.REMOTE_BROKERS,
    setBrokerMapMarkers: (rows) => calls.push(['maps', rows.map((r) => r.id)]),
    refreshOpenPropertyContact: () => calls.push(['detail-contact']),
    toast: () => {}
  });
  vm.runInContext(code('refreshBrokersFromApi'), context);
  await vm.runInContext(startupExpression(['refreshBrokersFromApi']), context);
  assert.equal(context.remoteBrokersLoaded, true);
  assert.equal(context.REMOTE_BROKERS[0].id, 'a');
  assert.deepEqual(calls, [['api', '/api/agents?status=approved&limit=100', true], ['filters'], ['render'], ['maps', ['a']], ['detail-contact']]);
});

test('failed broker startup preserves API state and performs no render/map work', async () => {
  let renders = 0;
  const existing = [{ id: 'existing' }];
  const context = vm.createContext({ REMOTE_BROKERS: existing, remoteBrokersLoaded: false,
    apiRequest: async () => { throw new Error('fixture offline'); },
    renderAll: () => renders++, setBrokerMapMarkers: () => renders++, toast() {} });
  vm.runInContext(code('refreshBrokersFromApi'), context);
  await vm.runInContext(startupExpression(['refreshBrokersFromApi']), context);
  assert.equal(context.REMOTE_BROKERS, existing);
  assert.equal(context.remoteBrokersLoaded, false);
  assert.equal(renders, 0);
});

test('summary applies the counter data without a full render only on active Uganda home', () => {
  for (const [pathname, page, country, active, expectedRenders] of [
    ['/', 'home', 'UG', true, 0], ['/index.html', 'home', 'UG', true, 0],
    ['/to-rent/kyanja-kampala', 'home', 'UG', true, 1], // deep link not yet prepared
    ['/', 'sale', 'UG', true, 1], ['/', 'home', 'UG', false, 1],
    ['/', 'home', 'ZA', true, 1], ['/brokers', 'brokers', 'UG', true, 1]
  ]) {
    let applied = 0, renders = 0;
    const context = vm.createContext({ currentPage: page, ACTIVE_LOCATION_COUNTRY: { countryCode: country },
      window: { location: { pathname } },
      document: { getElementById: (id) => id === 'page-home' ? { classList: { contains: () => active } } : null },
      applyPublicOpportunityStats: () => { applied++; return true; }, renderAll: () => renders++ });
    vm.runInContext(code('normalizeRoutePath') + optionalCode('isActiveUgandaHomepage'), context);
    const callback = vm.runInContext('(' + summaryCallback() + ')', context);
    const stats = { total: 20, rent: 8 };
    assert.equal(callback(stats), stats);
    assert.equal(applied, 1);
    assert.equal(renders, expectedRenders, `${country} ${pathname} ${page} active=${active}`);
  }
});

function mapFixture({ nativeObserver = true, pathname = '/', page = 'home', country = 'UG' } = {}) {
  const observers = [], reads = [], scheduled = [], listeners = [];
  const state = { visible: false };
  const map = { id: 'map-home', getClientRects: () => { reads.push('rects'); return [{}]; },
    getBoundingClientRect: () => { reads.push('bounds'); return { width: 400, height: 200, top: state.visible ? 10 : 5000, bottom: state.visible ? 210 : 5200, left: 0, right: 400 }; } };
  const activePage = { querySelector: (selector) => selector === '#map-home' ? map : null };
  const context = vm.createContext({ currentPage: page, ACTIVE_LOCATION_COUNTRY: { countryCode: country },
    PUBLIC_MAP_IDS: ['map-home'], publicMapVisibilityObserver: null, publicMapVisibilityElements: [], publicMapVisibilityListenersInstalled: false,
    window: { location: { pathname }, innerHeight: 823, innerWidth: 412,
      getComputedStyle: () => { reads.push('style'); return { visibility: 'visible' }; },
      addEventListener: (name) => listeners.push(name) },
    document: { querySelector: () => activePage,
      getElementById: (id) => id === 'page-home' ? { classList: { contains: () => page === 'home' } } : id === 'map-home' ? map : null },
    scheduleMapsInit: () => { context.watchActivePublicMapVisibility(); scheduled.push([...context.getReadyPublicMapIds()]); }
  });
  if (nativeObserver) context.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.elements = []; observers.push(this); }
    observe(el) { this.elements.push(el.id); }
    disconnect() {}
  };
  vm.runInContext(['normalizeRoutePath', 'getActivePublicMapIds', 'publicMapIsVisible', 'getReadyPublicMapIds', 'watchActivePublicMapVisibility'].map(code).join('\n')
    + optionalCode('isActiveUgandaHomepage') + optionalCode('scheduleInitialPublicMaps'), context);
  return { context, reads, scheduled, observers, listeners, state };
}

test('actual home startup observes maps without synchronous layout reads and reacts when visible', () => {
  const f = mapFixture();
  vm.runInContext(startupExpression(['scheduleMapsInit', 'scheduleInitialPublicMaps']), f.context);
  assert.deepEqual(f.reads, []);
  assert.deepEqual(f.scheduled, []);
  assert.deepEqual(f.observers[0].elements, ['map-home']);
  f.observers[0].callback([{ isIntersecting: false }]);
  assert.deepEqual(f.scheduled, []);
  f.state.visible = true;
  f.observers[0].callback([{ isIntersecting: true }]);
  assert.deepEqual(f.scheduled, [['map-home']]);
});

test('direct category, other country and no-observer startup keep existing map readiness path', () => {
  for (const options of [{ pathname: '/to-rent', page: 'rent' }, { country: 'ZA' }, { nativeObserver: false }]) {
    const f = mapFixture(options);
    vm.runInContext(startupExpression(['scheduleMapsInit', 'scheduleInitialPublicMaps']), f.context);
    assert.equal(f.scheduled.length, 1);
    assert.ok(f.reads.length > 0);
    if (!options.nativeObserver && options.nativeObserver !== undefined) assert.deepEqual(f.listeners, ['resize', 'scroll']);
  }
});
