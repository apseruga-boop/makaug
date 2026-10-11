'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { categoryPageSeoMeta } = require('../services/publicSeoService');
const { resolvePublicSeoLanding, publicSeoLandingMeta } = require('../services/publicSeoLandingService');
const { universityLinks, renderCategorySeoHtml } = require('../services/publicSeoRenderService');
const { sanitizePublicHtml, PUBLIC_FORBIDDEN_STRINGS } = require('../services/publicHtmlSanitizer');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const snapshot = { universityCounts: new Map([['makerere', 10], ['kyambogo', 8], ['mubs', 2], ['unknown-campus', 99]]) };

function render(meta, route, options = {}) {
  return renderCategorySeoHtml(sanitizePublicHtml(shell, { pathname: route }), {
    meta, snapshot, listings: [], baseUrl: 'https://makaug.com', ...options
  });
}

test('student hub renders inventory-qualified canonical university anchors in raw HTML', () => {
  const route = '/student-accommodation';
  const meta = categoryPageSeoMeta(route, snapshot, 'https://makaug.com');
  const { html } = render(meta, route);
  assert.match(html, /data-ssr-university-links="1"/);
  assert.match(html, /href="\/student-accommodation\/university\/makerere"/);
  assert.match(html, /href="\/student-accommodation\/university\/kyambogo"/);
  assert.doesNotMatch(html, /href="\/student-accommodation\/university\/(?:mubs|unknown-campus)"/);
  assert.match(html, /aria-label="10 listings"/);
  assert.equal(meta.canonical, 'https://makaug.com/student-accommodation');
  for (const forbidden of PUBLIC_FORBIDDEN_STRINGS) assert.ok(!html.includes(forbidden), forbidden);
});

test('university page links qualified siblings and excludes itself from its university nav', () => {
  const route = '/student-accommodation/university/makerere';
  const meta = publicSeoLandingMeta(resolvePublicSeoLanding(route), snapshot, 'https://makaug.com', { count: 10 });
  assert.equal(meta.universitySlug, 'makerere');
  const { html } = render(meta, route);
  const nav = html.match(/<nav[^>]*data-ssr-university-links="1"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(nav);
  assert.match(nav, /Browse other universities/);
  assert.match(nav, /href="\/student-accommodation\/university\/kyambogo"/);
  assert.doesNotMatch(nav, /href="\/student-accommodation\/university\/makerere"/);
  assert.equal(meta.canonical, `https://makaug.com${route}`);
  assert.match(html, /data-student-campus="Makerere University"/);
});

test('empty/sparse inventory and non-student routes do not acquire university navigation', () => {
  assert.deepEqual(universityLinks({ universityCounts: new Map([['makerere', 2]]) }), []);
  assert.deepEqual(universityLinks(null), []);
  const meta = categoryPageSeoMeta('/to-rent/kyanja-kampala', null, 'https://makaug.com');
  assert.doesNotMatch(render(meta, '/to-rent/kyanja-kampala').html, /data-ssr-university-links/);
});

test('Uganda university navigation and targeted copy stay absent for another tenant', () => {
  const script = `const r=require('./services/publicSeoRenderService');
    const s=require('./services/publicSeoLandingService');
    const l=${JSON.stringify(resolvePublicSeoLanding('/to-rent/kyanja-kampala/apartments'))};
    console.log(JSON.stringify({links:r.universityLinks({universityCounts:new Map([['makerere',10]])}),copy:s.publicSeoLandingMeta(l,null,'https://seshaikhaya.com',{count:10}).landingBodyHtml}));`;
  const output = JSON.parse(execFileSync(process.execPath, ['-e', script], { cwd: root, env: { ...process.env, COUNTRY_CODE: 'ZA' }, encoding: 'utf8' }));
  assert.deepEqual(output.links, []);
  assert.equal(output.copy, undefined);
});

const apartment = (price, period = 'month', extra = {}) => ({ price, price_period: period, price_on_application: false, ...extra });
const kyanjaRoute = '/to-rent/kyanja-kampala/apartments';
const kyanjaLanding = resolvePublicSeoLanding(kyanjaRoute);

test('Kyanja apartment copy keeps exact inventory and practical guidance without frozen card statistics', () => {
  const listings = [apartment(900000), apartment(1200000), apartment(1600000), apartment(100, 'week'), apartment(90000000, 'year'), apartment(2000000, 'month', { price_on_application: true }), apartment(3000000, 'month', { price_implausible: true })];
  const meta = publicSeoLandingMeta(kyanjaLanding, null, 'https://makaug.com', { count: 21, listings });
  assert.equal(meta.canonical, `https://makaug.com${kyanjaRoute}`);
  assert.equal(meta.routeState.locationId, 'kampala:kyanja');
  assert.equal(meta.routeState.propertyType, 'apartment');
  assert.match(meta.landingIntroHtml, /Compare 21 apartment rental listings in Kyanja, Kampala/);
  assert.ok(meta.description.startsWith('Apartments for rent in Kyanja'));
  assert.ok(meta.description.length <= 160);
  assert.doesNotMatch(meta.landingBodyHtml, /cards shown here|asking rent range|900k|1\.6M|90M/);
  const { html } = render(meta, kyanjaRoute);
  assert.match(html, /data-landing-copy="1"/);
  assert.ok(html.indexOf('data-landing-copy="1"') > html.indexOf('id="rent-grid"'), 'body survives grid replacement');
  assert.match(html, /advance rent, deposits, utilities and any agent fee/);
});

test('Kyanja price guidance remains useful with unknown periods/prices and page 2 has no repeated body', () => {
  const meta = publicSeoLandingMeta(kyanjaLanding, null, 'https://makaug.com', { count: 21, listings: [apartment(900000), apartment(1200000), apartment(1000000, '')] });
  assert.match(meta.landingBodyHtml, /Before arranging a viewing/);
  assert.doesNotMatch(meta.landingBodyHtml, /cards shown here|per month/);
  const page2 = publicSeoLandingMeta(kyanjaLanding, null, 'https://makaug.com', { count: 21, page: 2 });
  assert.ok(page2.landingIntroHtml);
  assert.equal(page2.landingBodyHtml, '');
  const sparse = publicSeoLandingMeta(kyanjaLanding, null, 'https://makaug.com', { count: 2 });
  assert.equal(sparse.landingBodyHtml, undefined);
  const other = publicSeoLandingMeta(resolvePublicSeoLanding('/to-rent/ntinda-kampala/apartments'), null, 'https://makaug.com', { count: 21 });
  assert.equal(other.landingBodyHtml, undefined);
});
