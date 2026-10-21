'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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

test('mobile hero ships the existing photo as an immutable local WebP while desktop is unchanged', () => {
  const crypto = require('node:crypto');
  const mobile = new URL(imageUrl(mobileCss), 'https://makaug.com');
  const desktop = new URL(imageUrl(desktopCss));
  const provenance = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/home-hero-640.source.json'), 'utf8'));
  const original = new URL(provenance.originalSource);
  const image = fs.readFileSync(path.join(__dirname, '..', mobile.pathname));
  assert.equal(mobile.origin, 'https://makaug.com');
  assert.match(mobile.pathname, /^\/assets\/home-hero-640\.[a-f0-9]{12}\.webp$/);
  assert.equal(crypto.createHash('sha256').update(image).digest('hex'), provenance.sha256);
  assert.equal(image.toString('ascii', 0, 4), 'RIFF');
  assert.equal(image.toString('ascii', 8, 12), 'WEBP');
  assert.equal(original.origin, desktop.origin);
  assert.equal(original.pathname, desktop.pathname);
  for (const key of ['auto', 'fit']) assert.equal(original.searchParams.get(key), desktop.searchParams.get(key));
  assert.equal(original.searchParams.get('w'), '640');
  assert.equal(original.searchParams.get('q'), '50');
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
