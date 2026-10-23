const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const acorn = require('acorn');
const source = fs.readFileSync(require.resolve('../assets/makaug-app.js'), 'utf8');
const tree = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
function code(name) {
  const node = tree.body.find((n) => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert.ok(node, name); return source.slice(node.start, node.end);
}

function mapFixture() {
  const nodes = new Map();
  const events = {}; const pending = []; const initialized = []; let observer;
  let active = ['map-rent']; let leafLoads = 0;
  const rent = { id: 'map-rent', rendered: true, rect: { width: 400, height: 300, top: 100, bottom: 400, left: 0, right: 400 }, innerHTML: 'map placeholder' };
  const sale = { ...rent, id: 'map-sale' };
  [rent, sale].forEach((el) => { el.getClientRects = () => el.rendered ? [el.rect] : []; el.getBoundingClientRect = () => el.rect; nodes.set(el.id, el); });
  const activePage = { id: 'page-rent', querySelector(selector) { return active.some((id) => selector.includes(`#${id}`)) ? nodes.get(active[0]) : null; } };
  const context = vm.createContext({
    document: { getElementById(id) { return nodes.get(id); }, querySelector() { return activePage; } },
    window: { innerHeight: 700, innerWidth: 390, getComputedStyle() { return { visibility: 'visible' }; },
      addEventListener(type, handler) { events[type] = handler; }, setTimeout(fn) { pending.push(fn); }, requestIdleCallback(fn) { pending.push(fn); } },
    IntersectionObserver: class { constructor(callback) { this.callback = callback; this.observed = []; observer = this; } observe(el) { this.observed.push(el); } disconnect() { this.observed = []; } },
    PUBLIC_MAP_IDS: ['map-rent', 'map-sale'], PUBLIC_MAP_SELECTOR: '#map-rent, #map-sale',
    maps: {}, mapProviders: {}, markers: {},
    ensureGoogleMapsApi: async () => false,
    ensureLeafletApi: async () => { leafLoads += 1; return true; },
    getPublicListings() { return []; }, normalizeType(x) { return x; }, isStudentDiscoverable() { return false; },
    mapInstanceMatchesDom() { return true; }, publicMapNeedsInit(id) { return !context.maps[id]; }, clearStaleMapRegistry() {},
    getBrokerDirectory() { return []; }, setBrokerMapMarkers() {}, setMapMarkers() {}, resizePublicMap() {}, resetMaps() {},
    destroyMapInstance() {}, addMarkers() {}, fitMapToListings() {},
    MAP_DEFAULT_CENTER: { lat: 0, lng: 0 }, MAP_DEFAULT_ZOOM: 7, MAP_BROKER_DEFAULT_ZOOM: 7,
    OSM_TILE_URL: 'tiles', OSM_TILE_ATTRIBUTION: 'OSM', OSM_REFERRER_POLICY: 'strict-origin',
    L: { map(id) { initialized.push(id); return { setView() { return this; } }; }, tileLayer() { return { addTo() {} }; } },
    console
  });
  vm.runInContext(`let publicMapVisibilityObserver=null, publicMapVisibilityElements=[], publicMapVisibilityListenersInstalled=false;
    let mapsInitScheduled=false, mapsInitStarted=false, mapsInitPromise=null;
    ${['getActivePublicMapIds','publicMapIsVisible','getReadyPublicMapIds','watchActivePublicMapVisibility','activePublicMapsNeedInit','scheduleMapsInit','initMaps','refreshActivePublicMapsAfterRoute'].map(code).join('\n')}`, context);
  async function flush() { while (pending.length) { pending.shift()(); await new Promise((resolve) => setImmediate(resolve)); } }
  return { context, rent, sale, events, initialized, pending, flush, setActive(ids) { active = ids; }, get observer() { return observer; }, get leafLoads() { return leafLoads; } };
}

test('CSS-hidden mobile maps do not request Leaflet; desktop resize initializes only the active visible map', async () => {
  const f = mapFixture(); f.rent.rendered = false;
  vm.runInContext('scheduleMapsInit()', f.context); await f.flush();
  assert.equal(f.leafLoads, 0); assert.deepEqual(f.initialized, []);
  assert.ok(f.observer.observed.includes(f.rent));
  f.rent.rendered = true; f.events.resize(); await f.flush();
  assert.equal(f.leafLoads, 1); assert.deepEqual(f.initialized, ['map-rent']);
});

test('offscreen maps wait for visibility and observer notification without fixed eager loading', async () => {
  const f = mapFixture(); f.rent.rect.top = 1000; f.rent.rect.bottom = 1300;
  vm.runInContext('scheduleMapsInit()', f.context); await f.flush(); assert.equal(f.leafLoads, 0);
  f.rent.rect.top = 300; f.rent.rect.bottom = 600;
  f.observer.callback([{ isIntersecting: true }]); await f.flush();
  assert.deepEqual(f.initialized, ['map-rent']);
});

test('maps recheck active route and visibility after an asynchronous provider download', async () => {
  const f = mapFixture(); let resolveLeaf;
  f.context.ensureLeafletApi = () => new Promise((resolve) => { resolveLeaf = resolve; });
  const promise = vm.runInContext('initMaps()', f.context);
  await new Promise((resolve) => setImmediate(resolve));
  f.setActive(['map-sale']); f.sale.rendered = false; resolveLeaf(true); await promise;
  assert.deepEqual(f.initialized, [], 'no stale rent map or hidden sale map');
  f.sale.rendered = true; f.context.ensureLeafletApi = async () => true;
  vm.runInContext('scheduleMapsInit({force:true})', f.context); await f.flush();
  assert.deepEqual(f.initialized, ['map-sale'], 'SPA re-entry initializes the new visible route');
});

test('fallback scroll visibility works when IntersectionObserver is unavailable', async () => {
  const f = mapFixture(); f.context.IntersectionObserver = undefined;
  f.rent.rect.top = 1000; f.rent.rect.bottom = 1300;
  vm.runInContext('scheduleMapsInit()', f.context); assert.equal(f.leafLoads, 0);
  f.rent.rect.top = 200; f.rent.rect.bottom = 500; f.events.scroll(); await f.flush();
  assert.deepEqual(f.initialized, ['map-rent']);
});

function bootstrapFixture(pageId, existingPack = null) {
  const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
  const start = html.indexOf('      var aboutAdvertiseI18nPromise = null;');
  const end = html.indexOf('        // Staff/admin/King code', start);
  const code = html.slice(start, end) + '\n}';
  const scripts = [];
  const context = vm.createContext({ Promise,
    window: { __MAKAUG_ABOUT_ADVERTISE_I18N__: existingPack },
    document: { querySelector() { return { id: pageId }; }, createElement() { return { remove() { this.removed = true; } }; }, body: { appendChild(script) { scripts.push(script); } } }
  });
  vm.runInContext(code, context);
  return { context, scripts };
}

test('listing bootstraps skip the About pack while direct About/Advertise retains ordered hashed script loading', async () => {
  for (const page of ['page-rent', 'page-students', 'page-mortgage']) {
    const f = bootstrapFixture(page); vm.runInContext('loadMakaugApp()', f.context); assert.equal(f.scripts.length, 0, page);
  }
  for (const page of ['page-about', 'page-advertise']) {
    const f = bootstrapFixture(page); vm.runInContext('loadMakaugApp()', f.context);
    assert.equal(f.scripts.length, 1); assert.equal(f.scripts[0].async, false);
    assert.equal(f.scripts[0].src, '/assets/about-advertise-i18n.js?v=short-stay-fee-20261023');
    const promise = f.context.window.__makaugLoadAboutAdvertiseI18n();
    assert.equal(f.scripts.length, 1, 'on-demand calls share the same loading promise');
    f.context.window.__MAKAUG_ABOUT_ADVERTISE_I18N__ = { lg: { 'about.heroLabel': 'pack' } };
    f.scripts[0].onload(); assert.ok(await promise);
  }
});

test('a failed language download allows a later route retry and existing packs need no duplicate script', async () => {
  const f = bootstrapFixture('page-rent');
  const failed = f.context.window.__makaugLoadAboutAdvertiseI18n(); f.scripts[0].onerror(); assert.equal(await failed, null);
  assert.equal(f.scripts[0].removed, true);
  const retry = f.context.window.__makaugLoadAboutAdvertiseI18n(); assert.equal(f.scripts.length, 2);
  f.context.window.__MAKAUG_ABOUT_ADVERTISE_I18N__ = { sw: {} }; f.scripts[1].onload(); await retry;
  await f.context.window.__makaugLoadAboutAdvertiseI18n(); assert.equal(f.scripts.length, 2);
});

test('a script load without the expected translation global permits a later retry', async () => {
  const f = bootstrapFixture('page-rent');
  const empty = f.context.window.__makaugLoadAboutAdvertiseI18n();
  f.scripts[0].onload(); assert.equal(await empty, null); assert.equal(f.scripts[0].removed, true);
  f.context.window.__makaugLoadAboutAdvertiseI18n(); assert.equal(f.scripts.length, 2);
});

test('late About translations merge all languages with local overrides and current language UI', async () => {
  const tables = Object.fromEntries(['en','lg','sw','ac','ny','rn','sm','am','ar'].map((lang) => [lang, { 'about.test': 'English fallback', unrelated: 'Keep' }]));
  let resolvePack; let loads = 0; let updates = 0;
  const context = vm.createContext({ Promise, CONTENT_I18N: tables, currentPage: 'rent', currentLang: 'lg',
    window: { __makaugLoadAboutAdvertiseI18n() { loads += 1; return new Promise((resolve) => { resolvePack = resolve; }); } },
    applyAboutLanguageUI() { updates += 1; }, applyAdvertisingLanguageUI() { updates += 1; }
  });
  vm.runInContext(`let aboutAdvertiseTranslationsPromise=null; ${['applyAboutAdvertiseLocalOverrides','mergeAboutAdvertiseLanguagePack','ensureAboutAdvertiseTranslations'].map(code).join('\n')}`, context);
  assert.equal(await vm.runInContext('ensureAboutAdvertiseTranslations("rent")', context), false); assert.equal(loads, 0);
  const promise = vm.runInContext('ensureAboutAdvertiseTranslations("about")', context);
  vm.runInContext('ensureAboutAdvertiseTranslations("advertise")', context); assert.equal(loads, 1);
  context.currentLang = 'sw';
  resolvePack({ lg: { 'about.test': 'Luganda', 'about.heroLabel': 'Old generated label' }, sw: { 'about.test': 'Swahili' }, ar: { 'advertise.test': 'Arabic' } });
  assert.equal(await promise, true); assert.equal(tables.lg['about.test'], 'Luganda');
  assert.equal(tables.lg['about.heroLabel'], 'Ebitukwatako', 'reviewed local override wins');
  assert.equal(tables.sw['about.test'], 'Swahili'); assert.equal(tables.ar['advertise.test'], 'Arabic');
  assert.equal(tables.lg.unrelated, 'Keep'); assert.equal(context.currentLang, 'sw'); assert.equal(updates, 2);
});

test('mortgage rates are fetched on route entry once and explicit refresh still requests updated data', async () => {
  let requests = 0; let renders = 0;
  const context = vm.createContext({ Promise, initialSsrCategoryGrid: null, currentPage: 'rent', lastPage: '',
    PUBLIC_PAGINATION_CATEGORIES: [], normalizePageKey(x) { return x; }, beginPublicRouteIntent() {},
    document: { getElementById() { return { classList: { contains() { return true; } } }; } },
    window: { setTimeout() {}, requestAnimationFrame() {}, scrollTo() {} },
    isPublicRouteSkeletonElement() { return false; }, ensureAboutAdvertiseTranslations() {},
    clearDashboardRefresh() {}, closeRouteTransientModals() {}, mountSectionSearchShell() {}, updateHomeAskAiLanguageCopy() {},
    closeMobile() {}, trackEvent() {}, syncPublicWhatsappLinks() {},
    apiRequest: async (path) => { assert.equal(path, '/api/mortgage-rates'); requests += 1; return { data: {} }; },
    hydrateMortgageProvidersFromApi() {}, renderMortgageFinder() { renders += 1; }, toast() {}, mortgageTr(x) { return x; }, Date
  });
  vm.runInContext(`let mortgageRatesHydrating=false, mortgageRatesHydratedOnce=false, MORTGAGE_RATE_LAST_CHECKED_RAW='', landingAnalyticsPageViewSkipped=false;
    ${code('loadMortgageRates')} ${code('ensurePublicPageModule')} ${code('skipDuplicateLandingPageView')} ${code('showPage')}`, context);
  vm.runInContext('showPage("rent", {history:false})', context); await new Promise((resolve) => setImmediate(resolve)); assert.equal(requests, 0);
  vm.runInContext('showPage("mortgage", {history:false})', context); await new Promise((resolve) => setImmediate(resolve)); assert.equal(requests, 1);
  vm.runInContext('showPage("mortgage", {history:false})', context); await new Promise((resolve) => setImmediate(resolve)); assert.equal(requests, 1, 'returning to loaded route reuses existing rates');
  await vm.runInContext('loadMortgageRates(true)', context); assert.equal(requests, 2); assert.equal(renders, 3);
  assert.doesNotMatch(code('initializeMakaugApp'), /\bloadMortgageRates\s*\(/);
});

test('real About/Advertise content renders the current language after late pack loading and later language changes', async () => {
  function declaration(name) {
    const node = tree.body.find((n) => n.type === 'VariableDeclaration' && n.declarations.some((d) => d.id.name === name));
    assert.ok(node, name); return source.slice(node.start, node.end);
  }
  const aboutLabel = { textContent: '', getAttribute() { return 'about.title'; } };
  const advertLabel = { textContent: '', getAttribute() { return 'advertise.title'; } };
  const about = { querySelectorAll(selector) { return selector === '[data-content-i18n]' ? [aboutLabel] : []; } };
  const advert = { querySelectorAll(selector) { return selector === '[data-content-i18n]' ? [advertLabel] : []; } };
  let resolvePack;
  const context = vm.createContext({ Promise, currentLang: 'lg', currentPage: 'about',
    window: { __makaugLoadAboutAdvertiseI18n: () => new Promise((resolve) => { resolvePack = resolve; }) },
    document: { getElementById() { return about; } }, updateAboutPageUi() {},
    applyAdvertisingLanguageUI() { context.applyContentLanguageUI(advert); }
  });
  vm.runInContext(['CONTENT_I18N','ABOUT_PAGE_I18N_EN','ADVERTISING_UI_I18N_EN','LANG_FALLBACK'].map(declaration).join('\n'), context);
  // Execute the real base-table setup and local override definitions.
  const tableStart = source.indexOf('Object.assign(CONTENT_I18N.en, ABOUT_PAGE_I18N_EN, ADVERTISING_UI_I18N_EN);');
  const tableEnd = source.indexOf('\nfunction contentTr(key)', tableStart);
  vm.runInContext(source.slice(tableStart, tableEnd) + ['contentTr','applyContentLanguageUI','applyAboutLanguageUI'].map(code).join('\n'), context);
  const pending = context.ensureAboutAdvertiseTranslations('about');
  context.currentLang = 'ar';
  const packContext = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(require.resolve('../assets/about-advertise-i18n.js'), 'utf8'), packContext);
  const pack = packContext.window.__MAKAUG_ABOUT_ADVERTISE_I18N__;
  resolvePack(pack); await pending;
  assert.equal(aboutLabel.textContent, pack.ar['about.title']); assert.equal(advertLabel.textContent, pack.ar['advertise.title']);
  context.currentLang = 'en'; context.applyAboutLanguageUI(); context.applyAdvertisingLanguageUI();
  const englishTitle = vm.runInContext('ABOUT_PAGE_I18N_EN["about.title"]', context);
  assert.equal(aboutLabel.textContent, englishTitle);
  context.currentLang = 'lg'; context.applyAboutLanguageUI(); context.applyAdvertisingLanguageUI();
  assert.equal(aboutLabel.textContent, pack.lg['about.title']); assert.equal(advertLabel.textContent, pack.lg['advertise.title']);
});
