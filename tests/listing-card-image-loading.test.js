'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const { propertyPublicHeading } = require('../services/publicSeoRenderService');

const app = fs.readFileSync(path.join(__dirname, '..', 'assets/makaug-app.js'), 'utf8');
const seo = fs.readFileSync(path.join(__dirname, '..', 'services/publicSeoRenderService.js'), 'utf8');
const asts = new Map([app, seo].map((source) => [source, acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' })]));
function declaration(source, name) {
  const node = asts.get(source).body.find((item) => item.type === 'FunctionDeclaration' && item.id.name === name);
  assert.ok(node, `${name} exists in the real source`);
  return source.slice(node.start, node.end);
}
function images(html) {
  return [...html.matchAll(/<img\b[^>]*>/g)].map((match) => match[0]);
}
function attr(tag, name) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}
function listing(id, extra = {}) {
  return { id, title: `Property ${id}`, type: 'rent', img: `/images/property-${id}.webp`, ...extra };
}

function fixture() {
  const grids = { 'rent-grid': { innerHTML: '' }, 'home-grid': { innerHTML: '' }, 'student-grid': { innerHTML: '' } };
  const context = vm.createContext({
    document: { getElementById: (id) => grids[id] },
    publicListingsFromApiLoaded: true,
    isFoundOnlineListing: (property) => property.foundOnline === true,
    propertyIdArg: (id) => JSON.stringify(id),
    isPropertySaved: () => false,
    findBrokerById: () => null,
    listingDateMeta: () => 'Today',
    propertyAvailabilityText: () => '',
    propertyVideoFirstMedia: () => null,
    publicImageSrc: (url, fallback) => url || fallback,
    getLocalizedPropertyTitle: (property) => property.title,
    getPropertyDetailPath: (property) => `/property/${property.id}`,
    publicPropertyLocationLabel: () => 'Kireka, Wakiso',
    propertyLocationMatchHtml: () => '',
    publicCardTheme: () => ({}),
    studentCardFooterText: () => 'Makerere',
    translateListingLabel: (text) => text,
    listingBadgeRowHtml: () => '',
    propertyDescriptionHoverHtml: () => '',
    adminAttr: (value) => String(value),
    adminEscape: (value) => String(value),
    getCardSaveButtonTitle: () => 'Save',
    getCardSaveButtonClasses: () => '',
    getCardSaveButtonIconClasses: () => '',
    listingPriceHtml: () => 'USh 500,000',
    propertyOriginalCurrencyGuideHtml: () => '',
    studentCardExtraHtml: () => '<span data-student-mode="1">Student property</span>',
    renderPropertyShareActions: () => '',
    renderListingBoostHook: () => '',
    SOCIAL_IMPORT_TILES_MARKER: 'existing-social-card',
    socialImportPlatformMeta: () => ({ key: 'facebook', label: 'Facebook', chipClass: '', icon: '' }),
    socialImportMediaType: () => 'photo',
    socialImportSourceUrl: () => '',
    foundOnlineConsentedPhotoUrl: (property) => property.img,
    foundOnlineSourceThumbnailUrl: () => '',
    foundOnlineSourceFallbackVisualHtml: () => '',
    socialImportMediaBadgeHtml: () => '',
    socialImportPriceHtml: () => '',
    socialImportSpecsHtml: () => '',
    socialImportProvenanceHtml: () => ''
  });
  for (const name of ['publicListerAttribution', 'propCard', 'studentCard', 'setHtmlIfChanged', 'renderGrid', 'renderStudentGrid', 'noResultsCardForGrid', 'loadingPropertyGridHtml', 'socialImportListingCardHtml', 'socialImportTileMediaHtml']) {
    vm.runInContext(declaration(app, name), context);
  }
  return { context, grids };
}

test('ordinary rental and home grids fetch the first image eagerly and defer later images', () => {
  for (const id of ['rent-grid', 'home-grid']) {
    const f = fixture();
    f.context.renderGrid(id, [listing(1), listing(2), listing(3)], { categoryPage: 'rent' });
    const cards = images(f.grids[id].innerHTML);
    assert.equal(cards.length, 3);
    assert.deepEqual(cards.map((image) => attr(image, 'loading')), ['eager', 'lazy', 'lazy']);
    assert.ok(cards.every((image) => attr(image, 'decoding') === 'async'));
    assert.deepEqual(cards.map((image) => attr(image, 'src')), ['/images/property-1.webp', '/images/property-2.webp', '/images/property-3.webp']);
  }
});

test('student grids retain student rendering while deferring photos after the first card', () => {
  const f = fixture();
  f.context.renderStudentGrid([listing(1), listing(2), listing(3)]);
  const cards = images(f.grids['student-grid'].innerHTML);
  assert.deepEqual(cards.map((image) => attr(image, 'loading')), ['eager', 'lazy', 'lazy']);
  assert.ok(cards.every((image) => attr(image, 'decoding') === 'async'));
  assert.equal((f.grids['student-grid'].innerHTML.match(/data-student-mode="1"/g) || []).length, 3);
});

test('nested card options still render and direct card callers retain eager photos', () => {
  const f = fixture();
  f.context.renderGrid('rent-grid', [listing(1), listing(2)], { cardOptions: { student: true } });
  assert.equal((f.grids['rent-grid'].innerHTML.match(/data-student-mode="1"/g) || []).length, 2);
  assert.deepEqual(images(f.grids['rent-grid'].innerHTML).map((image) => attr(image, 'loading')), ['eager', 'lazy']);
  const direct = images(f.context.propCard(listing(4)))[0];
  assert.equal(attr(direct, 'loading'), 'eager');
  assert.equal(attr(direct, 'decoding'), 'async');
});

test('found-online previews retain their existing lazy loading even in the first grid position', () => {
  const f = fixture();
  const rows = [listing(1, { foundOnline: true, img: '/staff-images/consented.webp' }), listing(2)];
  f.context.renderGrid('rent-grid', rows);
  let cards = images(f.grids['rent-grid'].innerHTML);
  assert.deepEqual(cards.map((image) => attr(image, 'loading')), ['lazy', 'lazy']);
  assert.ok(cards.every((image) => attr(image, 'decoding') === 'async'));
  assert.equal(attr(cards[0], 'src'), '/staff-images/consented.webp');
  f.context.renderStudentGrid(rows);
  cards = images(f.grids['student-grid'].innerHTML);
  assert.deepEqual(cards.map((image) => attr(image, 'loading')), ['lazy', 'lazy']);
});

test('the actual SSR property-detail renderer keeps its high-priority hero image', () => {
  const context = vm.createContext({
    CATEGORY_SEO: { rent: { label: 'To Rent', route: '/to-rent' } },
    ACTIVE_BRAND: 'makaug.com', ACTIVE_COUNTRY_CODE: 'UG', ACTIVE_CURRENCY: 'UGX',
    absoluteUrl: (url) => new URL(url, 'https://makaug.com').href,
    listingAreaLocation: () => null,
    escapeHtml: (value) => String(value),
    renderBreadcrumbs: () => '',
    seoPriceDataAttributes: () => '',
    priceLabel: () => 'USh 500,000 / month',
    propertySeoDescription: () => 'Property details',
    propertySeoTitle: (property) => property.title,
    propertyPublicHeading,
    popularAreaLinks: () => [],
    renderFooterAreaLinks: () => '',
    insertBeforeClosingTag: (html) => html,
    breadcrumbStructuredData: () => ({})
  });
  for (const name of ['findElementBoundsById', 'replaceElementInnerHtml', 'renderPropertySeoHtml']) vm.runInContext(declaration(seo, name), context);
  const result = context.renderPropertySeoHtml('<main id="detail-content"></main>', {
    id: 'detail-1', listing_type: 'rent', title: 'Rental details', area: 'Kireka', district: 'Wakiso', primary_image_url: '/images/detail.webp'
  });
  const hero = images(result.html)[0];
  assert.equal(attr(hero, 'src'), 'https://makaug.com/images/detail.webp');
  assert.equal(attr(hero, 'fetchpriority'), 'high');
  assert.equal(attr(hero, 'decoding'), 'async');
  assert.equal(attr(hero, 'width'), '1200');
  assert.equal(attr(hero, 'height'), '675');
  assert.notEqual(attr(hero, 'loading'), 'lazy');
});
