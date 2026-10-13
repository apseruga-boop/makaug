'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const tags = [...html.matchAll(/<link\b[^>]*data-home-hero-preload[^>]*>/g)].map(match => match[0]);
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];
const imageUrl = (css) => css.match(/url\("([^"]+)"\)/)?.[1];
const desktopCss = html.match(/\.hero-bg\s*\{([\s\S]*?)\}/)?.[1];
const mobileCss = html.slice(html.indexOf('@media (max-width: 767px)')).match(/\.hero-bg\s*\{([\s\S]*?)\}/)?.[1];

test('mobile and desktop hero preload exactly their matching CSS source with mutually exclusive media', () => {
  assert.equal(tags.length, 2);
  const mobile = tags.find(tag => attribute(tag, 'media') === '(max-width: 767px)');
  const desktop = tags.find(tag => attribute(tag, 'media') === '(min-width: 768px)');
  assert(mobile && desktop);
  assert.equal(attribute(mobile, 'href'), imageUrl(mobileCss));
  assert.equal(attribute(desktop, 'href'), imageUrl(desktopCss));
  for (const tag of tags) assert.equal(attribute(tag, 'fetchpriority'), 'high');
  for (const width of [320, 390, 767, 768, 1024, 1440]) {
    const selected = tags.filter(tag => attribute(tag, 'media').startsWith('(max') ? width <= 767 : width >= 768);
    assert.equal(selected.length, 1, `one request at ${width}px`);
  }
});

test('mobile hero uses the pinned same-origin WebP bytes in both preload and CSS', () => {
  const mobileSource = imageUrl(mobileCss);
  assert.equal(mobileSource, '/assets/home-hero-mobile-640-q50.306cd8edb8f0.webp');
  const file = path.join(__dirname, '..', mobileSource.slice(1));
  assert(fs.existsSync(file), 'the referenced image is shipped with the site');
  const image = fs.readFileSync(file);
  assert.equal(image.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(image.subarray(8, 12).toString('ascii'), 'WEBP', 'image/webp format');
  assert.equal(image.readUInt32LE(4) + 8, image.length, 'complete WebP container');
  assert(image.length < 25000, 'mobile critical image stays below 25 KB');
  const hash = crypto.createHash('sha256').update(image).digest('hex');
  assert.equal(hash, '306cd8edb8f0afbc78858655f11487dd366d955126b03e112ab07b437cba38d0', 'unchanged downloaded source bytes');
  assert(mobileSource.includes(`.${hash.slice(0, 12)}.`), 'immutable filename matches content');
});

test('desktop retains the original photo source and both viewport crops and overlays remain', () => {
  const desktop = new URL(imageUrl(desktopCss));
  assert.equal(desktop.href, 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=1200&q=60');
  assert.equal(desktop.searchParams.get('w'), '1200');
  assert.equal(desktop.searchParams.get('q'), '60');
  assert.match(desktopCss, /linear-gradient\(180deg, rgba\(4, 21, 33, 0\.35\)/);
  assert.match(mobileCss, /linear-gradient\(180deg, rgba\(4, 21, 33, 0\.35\)/);
  assert.match(mobileCss, /background-position:\s*center top/);
});

test('actual route transform keeps both home preloads and removes both from detail/other routes', () => {
  const start = server.indexOf('function applyHomeHeroPreload(');
  const end = server.indexOf('function applyShortTermStylesheetLoading(', start);
  assert(start >= 0 && end > start);
  const context = vm.createContext({});
  vm.runInContext(server.slice(start, end), context);
  for (const route of ['/', '/index.html']) assert.equal(context.applyHomeHeroPreload(html, route), html);
  for (const route of ['/property/fixture-id', '/to-rent', '/student-accommodation', '/off-plan', '/short-term']) {
    assert.doesNotMatch(context.applyHomeHeroPreload(html, route), /data-home-hero-preload/, route);
  }
});
