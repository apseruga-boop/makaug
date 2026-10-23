'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const walk = require('acorn-walk');
const { sanitizePublicHtml, PUBLIC_FORBIDDEN_STRINGS } = require('../services/publicHtmlSanitizer');
const { affiliateOffersFor } = require('../services/bookingAffiliateService');
const travelpayouts = require('../services/travelpayoutsAffiliate');
const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const shortTerm = fs.readFileSync(path.join(root, 'assets/short-term.js'), 'utf8');
const asts = new Map([app, server, shortTerm].map((source) => [source, acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' })]));
function declaration(source, name) {
  let found;
  walk.simple(asts.get(source), { FunctionDeclaration(node) { if (node.id.name === name) found = node; } });
  assert.ok(found, name); return source.slice(found.start, found.end);
}
function publicRenderer(env = {}) {
  const context = vm.createContext({
    process: { env: { SHARED_CORE_PHASE1_ENABLED: 'false', GA4_MEASUREMENT_ID: 'G-FIXTURE123', ...env } },
    isProduction: false, ACTIVE_COUNTRY_CODE: 'UG', publicHtmlCache: new Map(), readIndexHtml: () => index, sanitizePublicHtml,
    applyHarvestPublicSubmissionVisibility: (html) => html, applyShortTermVisibility: (html) => html,
    injectShortTermRuntimeConfig: (html) => html,
    patchStructuredData: (html) => html,
    travelpayoutsAffiliate: travelpayouts,
    inlinePublicCoreStylesheets: require('../services/publicCoreStylesheets'),
    inlinePublicFontFaces: require('../services/publicFontFaces')
  });
  vm.runInContext(`const GA4_ID_PATTERN=/^G-[A-Z0-9]{4,20}$/;
    ${['applyHomeHeroPreload','applyShortTermStylesheetLoading','applyPublicFontDisplayOptional','ga4HeadSnippet','injectGa4HeadTag','injectTravelpayoutsDriveHeadTag','renderPublicHtml'].map((name) => declaration(server, name)).join('\n')}`, context);
  return context.renderPublicHtml;
}

const PUBLIC_ROUTES = ['/', '/student-accommodation', '/student-accommodation/university/makerere', '/to-rent/kireka-wakiso', '/to-rent/kyanja-kampala/apartments', '/short-term', '/short-term/example', '/about', '/advertise'];

test('public pages omit the Travelpayouts Drive loader unless TRAVELPAYOUTS_DRIVE_ENABLED is on', () => {
  const render = publicRenderer();
  assert.doesNotMatch(index, /data-makaug-affiliate="travelpayouts-drive"|emrldtp\.cc|NTgxODU0|581854/);
  for (const route of PUBLIC_ROUTES) {
    const html = render(route);
    assert.doesNotMatch(html, /emrldtp\.cc|NTgxODU0|581854/, route);
    assert.equal((html.match(/data-ga-ssr="1"/g) || []).length, 1, `${route}: GA4 remains one configured loader`);
    assert.ok(html.includes('https://www.googletagmanager.com/gtag/js?id=G-FIXTURE123'), route);
    assert.ok(html.includes('/assets/makaug-app.js'), `${route}: the property application still loads`);
    for (const forbidden of PUBLIC_FORBIDDEN_STRINGS) assert.ok(!html.includes(forbidden), `${route}: ${forbidden}`);
  }
});

test('an enabled Drive loader is one head script, using TRAVELPAYOUTS_DRIVE_PROJECT_ID or 581854', () => {
  const fallback = publicRenderer({ TRAVELPAYOUTS_DRIVE_ENABLED: 'true' });
  const custom = publicRenderer({ TRAVELPAYOUTS_DRIVE_ENABLED: 'true', TRAVELPAYOUTS_DRIVE_PROJECT_ID: '424242' });
  const customSrc = 'emrldtp.cc/NDI0MjQy.js?t=424242';
  for (const route of PUBLIC_ROUTES) {
    const html = fallback(route);
    assert.equal((html.match(/emrldtp\.cc\/NTgxODU0\.js\?t=581854/g) || []).length, 1, route);
    assert.ok(html.indexOf('emrldtp.cc') < html.indexOf('</head>'), `${route}: Drive is in head`);
    assert.equal((html.match(/data-ga-ssr="1"/g) || []).length, 1, `${route}: GA4 remains one configured loader`);
    const customHtml = custom(route);
    assert.equal(customHtml.split(customSrc).length - 1, 1, route);
    assert.doesNotMatch(customHtml, /NTgxODU0\.js\?t=581854/, route);
    for (const forbidden of PUBLIC_FORBIDDEN_STRINGS) assert.ok(!customHtml.includes(forbidden), `${route}: ${forbidden}`);
  }
  for (const route of ['/admin', '/staff-dashboard', '/staff', '/king']) {
    assert.doesNotMatch(fallback(route), /emrldtp\.cc/, route);
  }
});

test('explicit booking offers retain chosen destinations and sponsored user-click links', () => {
  const offers = affiliateOffersFor({ q: 'Entebbe', check_in: '2026-11-10', check_out: '2026-11-13', guests: '3' }, {
    TRAVELPAYOUTS_BOOKING_TEMPLATE: 'https://tp.media/r?marker=123456&u={url}',
    TRAVELPAYOUTS_AGODA_TEMPLATE: 'https://tp.media/r?marker=123456&p=2&u={url}'
  });
  assert.deepEqual(offers.map((offer) => offer.network), ['travelpayouts', 'travelpayouts']);
  const context = vm.createContext({ state: { bookingOffers: offers }, esc: (value) => String(value).replace(/&/g, '&amp;'), t: (key) => key });
  vm.runInContext(declaration(shortTerm, 'bookingBlockHtml'), context);
  const html = context.bookingBlockHtml();
  assert.equal((html.match(/data-st-contact="partner-clickout"/g) || []).length, 2);
  assert.equal((html.match(/target="_blank" rel="sponsored noopener noreferrer"/g) || []).length, 2);
  for (const offer of offers) assert.ok(html.includes(offer.url.replace(/&/g, '&amp;')));
  assert.doesNotMatch(html, /<script|window\.open|emrldtp/);
});

test('configured property sponsorship still renders its own image and explicit destination', () => {
  const context = vm.createContext({
    HOUSE_AD_SAMPLES: { 'rent-grid': { image: '/house.webp', mobileImage: '/house-mobile.webp', headline: 'Default' } },
    liveRevenuePlacements: new Map([['rent-grid', { is_active: true, preview_image_url: '/sponsor.webp', headline: 'Sponsor', cta_label: 'View offer', cta_url: 'https://sponsor.example/offer' }]]),
    translateListingLabel: (x) => x, adminAttr: (x) => x, adminEscape: (x) => x
  });
  vm.runInContext([declaration(app, 'safeHouseAdUrl'), declaration(app, 'buildRevenuePlacementMarkup')].join('\n'), context);
  const html = context.buildRevenuePlacementMarkup('rent-grid', 'Rental listings');
  assert.match(html, /data-house-placement="rent-grid"/);
  assert.match(html, /src="\/sponsor.webp"/);
  assert.match(html, /href="https:\/\/sponsor.example\/offer"/);
  assert.match(html, /Sponsored — View offer/);
});

test('configured Google Ads initialization retains its separate loader and slot render callback', () => {
  const scripts = []; let slotRenders = 0;
  const context = vm.createContext({ GOOGLE_ADSENSE_CLIENT: 'ca-pub-fixture',
    document: { getElementById() { return null; }, createElement() { return {}; }, head: { appendChild(script) { scripts.push(script); } } },
    renderGoogleAdsSlots() { slotRenders += 1; }
  });
  vm.runInContext(declaration(app, 'initGoogleAds'), context); context.initGoogleAds();
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-fixture');
  assert.equal(scripts[0].async, true); scripts[0].onload(); assert.equal(slotRenders, 1);
});
