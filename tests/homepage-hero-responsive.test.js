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

test('phones have a CSS-only hero and desktop preloads its matching image', () => {
  assert.equal(tags.length, 1);
  const desktop = tags[0];
  assert.equal(attribute(desktop, 'media'), '(min-width: 768px)');
  assert.equal(attribute(desktop, 'href'), imageUrl(desktopCss));
  assert.equal(attribute(desktop, 'fetchpriority'), 'high');
  assert.doesNotMatch(mobileCss, /url\(/);
  assert.match(mobileCss, /linear-gradient\(145deg, #041521 0%, #134e4a 100%\)/);
  for (const width of [320, 390, 767, 768, 1024, 1440]) {
    const selected = tags.filter(tag => width >= 768);
    assert.equal(selected.length, width >= 768 ? 1 : 0, `matching image preloads at ${width}px`);
  }
});

test('desktop photo remains unchanged and the published trial asset stays available for cached HTML', () => {
  const crypto = require('node:crypto');
  const desktop = new URL(imageUrl(desktopCss));
  const provenance = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/home-hero-640.source.json'), 'utf8'));
  const original = new URL(provenance.originalSource);
  const image = fs.readFileSync(path.join(__dirname, '../assets', provenance.file));
  assert.equal(crypto.createHash('sha256').update(image).digest('hex'), provenance.sha256);
  assert.equal(original.origin, desktop.origin);
  assert.equal(original.pathname, desktop.pathname);
  assert.equal(desktop.searchParams.get('w'), '1200');
  assert.equal(desktop.searchParams.get('q'), '60');
  assert.match(desktopCss, /linear-gradient\(180deg, rgba\(4, 21, 33, 0\.35\)/);
  assert.match(mobileCss, /background-position:\s*center top/);
  const sharedCss = fs.readFileSync(path.join(__dirname, '../packages/shared-country-core/assets/homepage.css'), 'utf8');
  const sharedMobileCss = sharedCss.slice(sharedCss.indexOf('@media (max-width: 767px)')).match(/\.hero-bg\s*\{([\s\S]*?)\}/)?.[1];
  assert.doesNotMatch(sharedMobileCss, /url\(/);
  assert.match(sharedMobileCss, /linear-gradient\(145deg, #041521 0%, #134e4a 100%\)/);
});

test('actual route transform keeps the desktop home preload and removes it from detail/other routes', () => {
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
