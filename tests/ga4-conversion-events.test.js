'use strict';

/**
 * C16 (10 Oct 2026, Marketing KPIs). GA4 loaded only after
 * /api/analytics/config answered (no tag in the server HTML), and the events
 * Marketing reports on didn't exist. Now: one gtag loader in the SSR <head>,
 * whatsapp_click / call_click / enquiry / listing_started / listing_submitted /
 * sign_up with listing_id, listing_type and area, and no GA from staff/admin.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'assets', 'makaug-app.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

function grab(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  let depth = 0;
  for (let i = source.indexOf(') {', start) + 2; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(name);
}
const grabConst = (source, name) => {
  const start = source.indexOf(`const ${name} =`);
  return source.slice(start, source.indexOf(';\n', start) + 1);
};

test('the server HTML has exactly one gtag loader in <head>, with anonymize_ip; never on admin or staff pages', () => {
  const sandbox = { process: { env: { GA4_MEASUREMENT_ID: 'G-QMQKMY2XCV' } } };
  vm.runInNewContext(`${grabConst(SERVER, 'GA4_ID_PATTERN')}\n${grab(SERVER, 'ga4HeadSnippet')}\n${grab(SERVER, 'injectGa4HeadTag')}\nthis.inject = injectGa4HeadTag;`, sandbox);
  const html = '<html><head><title>x</title></head><body></body></html>';
  const out = sandbox.inject(html, '/for-sale');
  assert.equal((out.match(/gtag\/js\?id=G-QMQKMY2XCV/g) || []).length, 1);
  assert.ok(out.indexOf('gtag/js') < out.indexOf('</head>'));
  assert.match(out, /gtag\('config',"G-QMQKMY2XCV",\{anonymize_ip:true\}\)/);
  assert.match(out, /window\.__MAKAUG_GA_SSR="G-QMQKMY2XCV"/);
  assert.equal(sandbox.inject(out, '/for-sale'), out, 'never twice');
  for (const page of ['/admin', '/admin/listings', '/staff-dashboard', '/staff-dashboard/review/x']) {
    assert.equal(sandbox.inject(html, page), html, page);
  }
  sandbox.process.env.GA4_MEASUREMENT_ID = '';
  assert.equal(sandbox.inject(html, '/'), html, 'no id, no tag');
  assert.match(SERVER, /rendered = injectGa4HeadTag\(rendered, normalizedBasePath\);/);
});

function spaSandbox({ role = '', path: pagePath = '/property/abc', currentPage = 'detail' } = {}) {
  const calls = [];
  const gtagCalls = [];
  const sandbox = {
    window: { location: { pathname: pagePath }, gtag: (...args) => gtagCalls.push(args) },
    authState: { user: role ? { role } : null },
    currentPage,
    activeDetailPropertyId: 'abc',
    trackEvent: (name, params) => { calls.push([name, params]); return Promise.resolve(); },
    findPropertyForUi: (id) => ({ id, backend_id: id, type: 'rent', district: 'Wakiso', city: 'Kira', area: 'Kyanja' }),
    normalizeType: (value) => String(value || '').toLowerCase().replace(/^students$/, 'student')
  };
  vm.runInNewContext([
    grabConst(APP, 'GA_INTERNAL_ROLES'),
    grab(APP, 'gaInternalTraffic'), grab(APP, 'gaListingType'), grab(APP, 'gaListingParams'),
    grab(APP, 'fireClientGaEvent'), grab(APP, 'gaContactContextForElement'), grab(APP, 'gaHandleContactClick'),
    'this.api = { gaListingParams, fireClientGaEvent, gaHandleContactClick };'
  ].join('\n'), sandbox);
  return { api: sandbox.api, calls, gtagCalls };
}

const linkEvent = (href, holderAttrs = {}) => {
  const holder = { getAttribute: (name) => holderAttrs[name] ?? null };
  const link = { getAttribute: () => href, closest: () => (Object.keys(holderAttrs).length ? holder : null) };
  return { target: { closest: () => link } };
};

test('WhatsApp and phone links on a listing fire whatsapp_click / call_click with listing_id, listing_type and area', () => {
  const { api, calls } = spaSandbox();
  assert.equal(api.gaHandleContactClick(linkEvent('https://wa.me/256700000000?text=Hi')), 'whatsapp_click');
  assert.equal(api.gaHandleContactClick(linkEvent('tel:+256700000000')), 'call_click');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['whatsapp_click', { listing_id: 'abc', listing_type: 'rent', area: 'Wakiso', contact_for: 'listing' }],
    ['call_click', { listing_id: 'abc', listing_type: 'rent', area: 'Wakiso', contact_for: 'listing' }]
  ]);
  // A card in a grid carries its own id; an agent card fires with agent_id.
  const grid = spaSandbox({ currentPage: 'for-sale', path: '/for-sale' });
  grid.api.gaHandleContactClick(linkEvent('https://api.whatsapp.com/send?phone=256700', { 'data-property-id': 'card-1' }));
  assert.equal(grid.calls[0][1].listing_id, 'card-1');
  grid.api.gaHandleContactClick(linkEvent('tel:0700', { 'data-agent-id': 'agent-9' }));
  assert.deepEqual(JSON.parse(JSON.stringify(grid.calls[1])), ['call_click', { agent_id: 'agent-9', contact_for: 'agent' }]);
  // makaug's own support WhatsApp (no listing or agent) isn't a listing contact.
  assert.equal(grid.api.gaHandleContactClick(linkEvent('https://wa.me/256780863394')), null);
  assert.equal(grid.api.gaHandleContactClick(linkEvent('/for-sale')), null);
});

test('staff and admin sessions send nothing to GA and are marked internal', () => {
  for (const scenario of [{ role: 'moderator' }, { role: 'super_admin' }, { path: '/staff-dashboard' }, { path: '/admin' }]) {
    const { api, gtagCalls } = spaSandbox(scenario);
    api.fireClientGaEvent('whatsapp_click', { listing_id: 'x' });
    assert.deepEqual(JSON.parse(JSON.stringify(gtagCalls)), [['set', { traffic_type: 'internal' }]], JSON.stringify(scenario));
  }
  const visitor = spaSandbox({ role: 'buyer_renter' });
  visitor.api.fireClientGaEvent('whatsapp_click', { listing_id: 'x' });
  assert.deepEqual(JSON.parse(JSON.stringify(visitor.gtagCalls)), [['event', 'whatsapp_click', { listing_id: 'x' }]]);
});

test('enquiry, listing_started, listing_submitted and sign_up fire from their handlers', () => {
  assert.match(APP, /await trackEvent\("property_inquiry_submit", \{[\s\S]{0,200}\}\);\n\s*trackEvent\("enquiry", gaListingParams\(property\)\);/);
  assert.match(APP, /if \(currentPage === "list-property"\) trackEvent\("listing_started", \{ listing_type: gaListingType\(type\)/);
  assert.match(APP, /trackEvent\("listing_submitted", gaListingParams\(\{ id: response\?\.data\?\.id \|\| null, listing_type: payload\.listing_type, district: payload\.district, area: payload\.area \}\)\);/);
  assert.match(APP, /if \(\/signup\/i\.test\(String\(source \|\| ""\)\)\) trackEvent\("sign_up"/);
  // The SPA doesn't load a second copy or send a second page_view when the server tag is there.
  assert.match(APP, /if \(typeof window !== "undefined" && window\.__MAKAUG_GA_SSR\) \{\n\s*gaMeasurementId = window\.__MAKAUG_GA_SSR;/);
  const { api } = spaSandbox();
  assert.deepEqual(JSON.parse(JSON.stringify(api.gaListingParams({ id: 'p1', type: 'students', district: 'Kampala' }))), { listing_id: 'p1', listing_type: 'student', area: 'Kampala' });
});
