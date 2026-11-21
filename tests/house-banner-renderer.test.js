const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { getAdvertisingPlacements } = require('../services/advertisingCatalogService');

const source = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
const renderer = source.slice(source.indexOf('const HOUSE_AD_SAMPLES = {'), source.indexOf('function ensureRevenuePlacements()'));
const escape = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function loadRenderer(search = '?noskin=1') {
  const context = { translateListingLabel: (text) => text, adminEscape: escape, adminAttr: escape, URLSearchParams, window: { location: { search, pathname: '/' } } };
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

test('vibe week campaign swaps bundled banners only, and only inside its window', () => {
  const { render, placements } = loadRenderer('?skin=preview');
  for (const placement of getAdvertisingPlacements()) {
    const markup = render(placement.key, placement.label);
    const file = placement.preview_image_url.split('/').pop();
    assert.ok(markup.includes(`/assets/house-ads-vibe/${file}?v=vibe-week-20261121`), placement.key);
    assert.ok(markup.includes(`/assets/house-ads-vibe/${file.replace('.webp', '-mobile.webp')}?v=vibe-week-20261121`), placement.key);
    assert.ok(markup.includes('mk-house-band--vibe-week'), placement.key);
    assert.ok(fs.existsSync(path.join(__dirname, '../assets/house-ads-vibe', file)), file);
    assert.ok(fs.existsSync(path.join(__dirname, '../assets/house-ads-vibe', file.replace('.webp', '-mobile.webp'))), file);
    assert.doesNotMatch(markup, /vice city|grand theft|\bGTA\b|rockstar/i);
    assert.doesNotMatch(markup, /0780\s*863\s*394|\+256/);
  }
  placements.set('home-featured', { preview_image_url: 'https://example.com/custom.webp', headline: 'Paid ad' });
  const paid = render('home-featured');
  assert.doesNotMatch(paid, /house-ads-vibe|mk-house-band--vibe-week/);
  assert.match(paid, /Paid ad/);

  const ctx = { translateListingLabel: (t) => t, adminEscape: escape, adminAttr: escape, URLSearchParams, window: { location: { search: '', pathname: '/' } } };
  vm.runInNewContext(`${renderer}\nthis.active = activeHouseAdCampaign;`, ctx);
  assert.equal(ctx.active(Date.parse('2026-11-20T23:00:00+03:00')), null);
  assert.ok(ctx.active(Date.parse('2026-11-25T12:00:00+03:00')));
  assert.equal(ctx.active(Date.parse('2026-11-30T00:00:00+03:00')), null);

  const off = loadRenderer('?noskin=1').render('home-brokers');
  assert.ok(off.includes('/assets/house-ads-v3/'), 'kill-switch keeps the ordinary house banner');
  assert.doesNotMatch(off, /house-ads-vibe|mk-house-band--vibe-week/);
  const vibeOff = loadRenderer('?vibe=off').render('home-brokers');
  assert.doesNotMatch(vibeOff, /house-ads-vibe/);
});
