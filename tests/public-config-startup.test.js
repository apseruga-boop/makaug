'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const acorn = require('acorn');
const walk = require('acorn-walk');
const { sanitizePublicHtml } = require('../services/publicHtmlSanitizer');
const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
const app = fs.readFileSync(require.resolve('../assets/makaug-app.js'), 'utf8');
const server = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const catalog = fs.readFileSync(require.resolve('../config/aboutCommercialProducts.js'), 'utf8');
const appTree = acorn.parse(app, { ecmaVersion: 'latest' });
const serverTree = acorn.parse(server, { ecmaVersion: 'latest' });
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
const bootstrap = inlineScripts.find((script) => script.includes('function loadMakaugApp()'));
assert.ok(bootstrap);
let configHandler;
walk.simple(serverTree, { CallExpression(node) {
  if (node.callee.type === 'MemberExpression' && node.callee.object.name === 'app'
    && node.callee.property.name === 'get' && node.arguments[0]?.value === '/config.js') configHandler = node.arguments[1];
} });
assert.ok(configHandler);
function appDeclaration(name) {
  const node = appTree.body.find((node) => node.type === 'VariableDeclaration'
    && node.declarations.some((decl) => decl.id.name === name));
  assert.ok(node, name); return app.slice(node.start, node.end);
}
function appFunction(name) {
  const node = appTree.body.find((node) => node.type === 'FunctionDeclaration' && node.id.name === name);
  assert.ok(node, name); return app.slice(node.start, node.end);
}
function generatedConfig(env = {}) {
  let body; const headers = {};
  const res = { type(value) { headers.type = value; }, set(key, value) { headers[key] = value; }, send(value) { body = value; } };
  const context = vm.createContext({ process: { env },
    PRICE_PERIOD_FORM_OPTIONS: { rent: [{ value: 'custom-month', label: 'Configured month' }] },
    PRICE_BOUNDS_UGX: { rent: { min: 50000, max: 7000000 } },
    publicDisplayFx: () => ({ base: 'UGX', as_of: '2026-10-11', rates: { USD: 3700 } })
  });
  const handler = vm.runInContext(`(${server.slice(configHandler.start, configHandler.end)})`, context);
  handler({}, res); assert.equal(headers['Cache-Control'], 'no-store'); return body;
}
function fixture({ readyState = 'loading', page = 'page-rent', protectedShell = false, shortTerm = false, globals = {} } = {}) {
  const appended = []; const listeners = new Map();
  const window = { __makaugAppVersion: 'fixture hash/with?chars', ...globals };
  if (shortTerm) window.__makaugShortTerm = { enabled: true };
  const document = {
    readyState,
    createElement(tagName) { return { tagName, remove() { this.removed = true; } }; },
    querySelector() { return { id: page }; },
    getElementById(id) { return protectedShell && id === 'page-staff-dashboard' ? { id } : null; },
    addEventListener(type, callback, options) { listeners.set(type, { callback, options }); },
    head: { appendChild(node) { appended.push(node); } }, body: { appendChild(node) { appended.push(node); } }
  };
  const context = vm.createContext({ window, document, Promise, console,
    LISTING_PRICE_PERIOD_OPTIONS_FALLBACK: { rent: [{ value: 'mo', label: 'Per Month' }] },
    FX_FALLBACK: { base: 'UGX', rates: { USD: 3800 } }
  });
  vm.runInContext(bootstrap, context);
  return { context, window, document, appended, listeners,
    scripts() { return appended.filter((node) => node.tagName === 'script'); },
    config(env) { vm.runInContext(generatedConfig(env), context); },
    catalog() { vm.runInContext(catalog, context); },
    dcl() { document.readyState = 'interactive'; listeners.get('DOMContentLoaded')?.callback(); },
    captureApp() {
      vm.runInContext(['API_BASE', 'GOOGLE_ADSENSE_CLIENT', 'GOOGLE_ADSENSE_SLOTS', 'LISTING_PRICE_PERIOD_OPTIONS'].map(appDeclaration).join('\n')
        + appFunction('publicFx') + appFunction('aboutCommercialCatalog'), context);
      return JSON.parse(vm.runInContext('JSON.stringify({api:API_BASE,client:GOOGLE_ADSENSE_CLIENT,slots:GOOGLE_ADSENSE_SLOTS,periods:LISTING_PRICE_PERIOD_OPTIONS,fx:publicFx(),bounds:window.MAKAUG_PRICE_BOUNDS,catalog:aboutCommercialCatalog()})', context));
    }
  };
}

test('config scripts defer parsing and inline code cannot mask custom AdSense slots', () => {
  for (const url of ['/config.js', '/config/aboutCommercialProducts.js?v=about-commercial-products-20260910-v1']) {
    const tag = [...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g)].find((match) => match[1] === url)?.[0];
    assert.ok(tag, url); assert.match(tag, /\bdefer\b/); assert.doesNotMatch(tag, /\basync\b/);
  }
  for (const script of inlineScripts) {
    assert.doesNotMatch(script, /window\.(?:MAKAUG_CONFIG|MAKAUG_API_BASE|MAKAUG_ADSENSE_CLIENT|MAKAUG_ADSENSE_SLOTS|MAKAUG_FX|MAKAUG_PRICE_PERIOD_OPTIONS|MAKAUG_PRICE_BOUNDS)\b/);
  }
});

test('loading and interactive shells preload once but wait for deferred custom config before app constants', () => {
  for (const readyState of ['loading', 'interactive']) {
    const f = fixture({ readyState });
    assert.equal(f.scripts().length, 0, readyState);
    const preload = f.appended[0]; assert.equal(preload.tagName, 'link'); assert.equal(preload.rel, 'preload'); assert.equal(preload.as, 'script');
    assert.equal(f.listeners.get('DOMContentLoaded').options.once, true);
    f.catalog(); f.config({ PUBLIC_API_BASE: 'https://api.example/custom/', GOOGLE_ADSENSE_CLIENT: 'ca-pub-configured', GOOGLE_ADSENSE_SLOT_DEFAULT: '987654321', COUNTRY_CODE: 'UG' });
    f.dcl(); const scripts = f.scripts(); assert.equal(scripts.length, 1);
    assert.equal(scripts[0].async, false); assert.equal(preload.href, scripts[0].src);
    assert.equal(preload.href, '/assets/makaug-app.js?v=fixture%20hash%2Fwith%3Fchars');
    const captured = f.captureApp();
    assert.equal(captured.api, 'https://api.example/custom'); assert.equal(captured.client, 'ca-pub-configured');
    assert.equal(captured.slots.default, '987654321'); assert.equal(captured.periods.rent[0].value, 'custom-month');
    assert.equal(captured.fx.rates.USD, 3700); assert.deepEqual(captured.bounds, { rent: { min: 50000, max: 7000000 } });
    assert.equal(captured.catalog.products.privateListing.amount, 20000);
    f.dcl(); assert.equal(f.scripts().length, 1, 'boot remains idempotent even if the callback is repeated');
  }
});

test('failed deferred config still starts at DCL with the same native application fallbacks', () => {
  const f = fixture(); assert.equal(f.scripts().length, 0);
  // A failed defer script still lets the browser dispatch DOMContentLoaded.
  f.dcl(); assert.equal(f.scripts().length, 1); const captured = f.captureApp();
  assert.equal(captured.api, ''); assert.equal(captured.client, ''); assert.deepEqual(captured.slots, {});
  assert.equal(captured.periods.rent[0].value, 'mo'); assert.equal(captured.fx.rates.USD, 3800); assert.equal(captured.catalog, null);
});

test('protected admin and direct About/Advertise keep their ordered scripts after config readiness', () => {
  const admin = fixture({ protectedShell: true }); admin.config({}); admin.dcl();
  assert.deepEqual(admin.scripts().map((script) => script.src), ['/assets/makaug-admin.js?v=fixture%20hash%2Fwith%3Fchars', '/assets/makaug-app.js?v=fixture%20hash%2Fwith%3Fchars']);
  assert.ok(admin.scripts().every((script) => script.async === false));
  for (const page of ['page-about', 'page-advertise']) {
    const f = fixture({ page }); f.catalog(); f.config({}); f.dcl();
    assert.deepEqual(f.scripts().map((script) => script.src), ['/assets/about-advertise-i18n.js?v=whatsapp-number-20260911', '/assets/makaug-app.js?v=fixture%20hash%2Fwith%3Fchars']);
    assert.ok(f.scripts().every((script) => script.async === false)); assert.equal(f.captureApp().catalog.currency, 'UGX');
  }
});

test('an already complete document starts once and Short Term keeps its parallel independent startup', () => {
  const f = fixture({ readyState: 'complete', shortTerm: true });
  assert.equal(f.listeners.size, 0);
  assert.deepEqual(f.scripts().map((script) => script.src), ['/assets/short-term.js?v=20260916-short-term-v23', '/assets/makaug-app.js?v=fixture%20hash%2Fwith%3Fchars']);
  assert.equal(f.appended.filter((node) => node.tagName === 'link').length, 1);
});

test('existing explicit config overrides and non-Uganda price bounds remain intact', () => {
  const f = fixture({ globals: { MAKAUG_API_BASE: 'https://override.example/', MAKAUG_ADSENSE_CLIENT: 'ca-pub-override', MAKAUG_ADSENSE_SLOTS: { default: 'override-slot' } } });
  f.config({ PUBLIC_API_BASE: 'https://server.example/', GOOGLE_ADSENSE_CLIENT: 'ca-pub-server', GOOGLE_ADSENSE_SLOT_DEFAULT: 'server-slot', COUNTRY_CODE: 'ZA' }); f.dcl();
  const captured = f.captureApp(); assert.equal(captured.api, 'https://override.example');
  assert.equal(captured.client, 'ca-pub-override'); assert.equal(captured.slots.default, 'override-slot'); assert.equal(captured.bounds, false);
});

test('public route sanitization retains SSR sections and the same deferred config/preloaded bootstrap', () => {
  for (const route of ['/student-accommodation', '/student-accommodation/university/makerere', '/to-rent/kireka-wakiso', '/to-rent/kyanja-kampala/apartments', '/about', '/advertise']) {
    const publicHtml = sanitizePublicHtml(html, { pathname: route });
    assert.match(publicHtml, /<script src="\/config\.js" defer><\/script>/, route);
    assert.match(publicHtml, /<script src="\/config\/aboutCommercialProducts\.js\?v=about-commercial-products-20260910-v1" defer><\/script>/, route);
    assert.match(publicHtml, /DOMContentLoaded/); assert.match(publicHtml, /appPreload\.href = makaugAppSrc/);
    assert.match(publicHtml, /<h1\b/); assert.doesNotMatch(publicHtml, /id="page-(?:staff|admin)-dashboard"/);
  }
});
