'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const tags = [...html.matchAll(/<link\b[^>]*data-home-hero-preload[^>]*>/g)].map(match => match[0]);
const desktopCss = html.match(/\.hero-bg\s*\{([\s\S]*?)\}/)?.[1];
const mobileCss = html.slice(html.indexOf('@media (max-width: 767px)')).match(/\.hero-bg\s*\{([\s\S]*?)\}/)?.[1];

test('the homepage hero is a brand gradient and does not preload a stock photo', () => {
  assert.equal(tags.length, 0);
  assert.doesNotMatch(html, /photo-1560518883-ce09059eeffa/);
  assert.doesNotMatch(desktopCss, /unsplash\.com/);
  assert.doesNotMatch(desktopCss, /url\(/);
  assert.match(desktopCss, /linear-gradient\(145deg, #041521 0%, #134e4a 100%\)/);
  assert.doesNotMatch(mobileCss, /url\(/);
  assert.match(mobileCss, /linear-gradient\(145deg, #041521 0%, #134e4a 100%\)/);
  const sharedCss = fs.readFileSync(path.join(__dirname, '../packages/shared-country-core/assets/homepage.css'), 'utf8');
  assert.doesNotMatch(sharedCss, /unsplash\.com/);
  const sharedDesktop = sharedCss.match(/\.hero-bg\s*\{([\s\S]*?)\}/)?.[1];
  assert.doesNotMatch(sharedDesktop, /url\(/);
  assert.match(sharedDesktop, /linear-gradient\(145deg, #041521 0%, #134e4a 100%\)/);
  assert.equal(fs.existsSync(path.join(__dirname, '../assets/home-hero-640.source.json')), false);
  assert.equal(fs.existsSync(path.join(__dirname, '../assets/home-hero-640.306cd8edb8f0.webp')), false);
});

test('actual route transform keeps other routes free of a home-hero preload', () => {
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
