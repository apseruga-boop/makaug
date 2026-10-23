const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { getAdvertisingPlacements } = require('../services/advertisingCatalogService');

const source = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
const renderer = source.slice(source.indexOf('const HOUSE_AD_SAMPLES = {'), source.indexOf('function ensureRevenuePlacements()'));
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function loadRenderer() {
  const context = { translateListingLabel: (text) => text, adminEscape: escape, adminAttr: escape };
  vm.runInNewContext(`${renderer}\nthis.render = buildRevenuePlacementMarkup; this.placements = liveRevenuePlacements;`, context);
  return context;
}

test('all house placements render the supplied copy and dedicated mobile source', () => {
  const { render } = loadRenderer();
  for (const placement of getAdvertisingPlacements()) {
    const markup = render(placement.key, placement.label);
    assert.ok(markup.includes(escape(placement.headline)), placement.key);
    assert.ok(markup.includes(escape(placement.subline)), placement.key);
    assert.ok(markup.includes(placement.preview_image_url.replace('.webp', '-mobile.webp')), placement.key);
    assert.ok(markup.includes(`${placement.preview_image_url}?v=house-banners-20261023`), placement.key);
    assert.ok(markup.includes(`${placement.preview_image_url.replace('.webp', '-mobile.webp')}?v=house-banners-20261023`), placement.key);
    assert.ok(markup.includes(`data-copy-side="${placement.copy_side}"`), placement.key);
    assert.ok(markup.includes(`object-position:${placement.background_position}`), placement.key);
    assert.ok(markup.includes('Sponsored — Advertise here'), placement.key);
    assert.doesNotMatch(markup, /Independence|64 years/i);
  }
});

test('subline is optional and explicit clearing is respected', () => {
  const { render, placements } = loadRenderer();
  placements.set('home-featured', { subline: null });
  assert.doesNotMatch(render('home-featured'), /mk-house-band__subline/);
  placements.set('home-featured', { subline: '' });
  assert.doesNotMatch(render('home-featured'), /mk-house-band__subline/);
  placements.set('home-featured', { headline: 'Custom headline' });
  assert.match(render('home-featured'), /Search homes, land and rentals by area\./);
});

test('admin subline is escaped and custom images keep the existing behavior', () => {
  const { render, placements } = loadRenderer();
  placements.set('home-featured', { subline: '<img src=x onerror=alert(1)>', preview_image_url: 'https://example.com/custom.webp' });
  const markup = render('home-featured');
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(markup, /<img src=x/);
  assert.match(markup, /srcset="https:\/\/example.com\/custom.webp"/);
  placements.set('home-featured', { is_active: false });
  assert.equal(render('home-featured'), '');
});
