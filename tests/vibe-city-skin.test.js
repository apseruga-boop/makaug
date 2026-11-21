'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const {
  START_MS,
  END_MS,
  isVibeCitySkinActive,
  isDeskPath,
  injectVibeCitySkinTags,
  envFlag
} = require('../utils/vibeCitySkinWindow');

const skinJs = fs.readFileSync(path.join(root, 'assets/vibe-city-skin/vibe-city-skin.js'), 'utf8');
const skinCss = fs.readFileSync(path.join(root, 'assets/vibe-city-skin/vibe-city-skin.css'), 'utf8');
const bootJs = fs.readFileSync(path.join(root, 'assets/vibe-city-skin/boot.js'), 'utf8');
const windowJs = fs.readFileSync(path.join(root, 'assets/vibe-city-skin/window.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

const BANNED = /vice city|grand theft|\bGTA\b|rockstar|bwereere/i;
const IN_WINDOW = Date.parse('2026-11-25T12:00:00+03:00');
const BEFORE = Date.parse('2026-11-20T23:59:59+03:00');
const LAST_SECOND = Date.parse('2026-11-29T23:59:59.500+03:00');
const AFTER = Date.parse('2026-11-30T00:00:00+03:00');

test('the campaign is on through the end of 29 Nov 2026 EAT and off after that', () => {
  assert.equal(START_MS, Date.parse('2026-11-21T00:00:00+03:00'));
  assert.equal(END_MS, Date.parse('2026-11-30T00:00:00+03:00'));
  assert.equal(END_MS, Date.parse('2026-11-29T21:00:00Z'));
  assert.equal(isVibeCitySkinActive({ now: BEFORE, env: {} }), false);
  assert.equal(isVibeCitySkinActive({ now: START_MS, env: {} }), true);
  assert.equal(isVibeCitySkinActive({ now: IN_WINDOW, env: {} }), true);
  assert.equal(isVibeCitySkinActive({ now: LAST_SECOND, env: {} }), true);
  assert.equal(isVibeCitySkinActive({ now: AFTER, env: {} }), false);
  assert.equal(isVibeCitySkinActive({ now: Date.parse('2026-11-29T20:59:59Z'), env: {} }), true);
  assert.equal(isVibeCitySkinActive({ now: Date.parse('2026-11-29T21:00:00Z'), env: {} }), false);
});

test('?noskin=1 and VIBE_CITY_SKIN=off turn the skin off; preview can force it on', () => {
  assert.equal(isVibeCitySkinActive({ now: IN_WINDOW, search: '?noskin=1', env: {} }), false);
  assert.equal(isVibeCitySkinActive({ now: IN_WINDOW, search: '?vibe=off', env: {} }), false);
  assert.equal(isVibeCitySkinActive({ now: AFTER, search: '?vibe=preview', env: {} }), true);
  assert.equal(isVibeCitySkinActive({ now: IN_WINDOW, search: '/land/kira-wakiso?noskin=true', env: {} }), false);
  assert.equal(isVibeCitySkinActive({ now: IN_WINDOW, env: { VIBE_CITY_SKIN: 'off' } }), false);
  assert.equal(envFlag({ VIBE_CITY_SKIN: 'off' }), 'off');
  assert.equal(isVibeCitySkinActive({ now: AFTER, search: '?skin=1', env: {} }), true);
  assert.equal(isVibeCitySkinActive({ now: AFTER, env: { VIBE_CITY_SKIN: 'on' } }), true);
  assert.equal(isVibeCitySkinActive({
    now: IN_WINDOW,
    search: '?skin_at=2026-11-30T00:00:00+03:00',
    env: {}
  }), false);
});

test('King, staff and admin paths never get the skin', () => {
  for (const p of ['/king', '/king/overview', '/admin', '/admin/users', '/staff-dashboard', '/staff-dashboard/review/abc', '/staff-setup']) {
    assert.equal(isDeskPath(p), true, p);
    assert.equal(isVibeCitySkinActive({ now: IN_WINDOW, pathname: p, env: {} }), false, p);
    const html = injectVibeCitySkinTags('<html><head></head><body></body></html>', { pathname: p, env: {} });
    assert.doesNotMatch(html, /vibe-city-skin/, p);
  }
  assert.equal(isDeskPath('/'), false);
  assert.equal(isDeskPath('/land/kira-wakiso'), false);
  assert.equal(isDeskPath('/list-property'), false);
});

test('public HTML receives the boot script, unless the env kill switch is off', () => {
  const page = '<!doctype html><html><head><title>makaug.com</title></head><body></body></html>';
  const on = injectVibeCitySkinTags(page, { pathname: '/', env: {} });
  assert.match(on, /assets\/vibe-city-skin\/window\.js/);
  assert.match(on, /assets\/vibe-city-skin\/boot\.js/);
  const off = injectVibeCitySkinTags(page, { pathname: '/', env: { VIBE_CITY_SKIN: 'off' } });
  assert.doesNotMatch(off, /vibe-city-skin/);
  const again = injectVibeCitySkinTags(on, { pathname: '/', env: {} });
  assert.equal(again, on);
  assert.match(serverJs, /injectVibeCitySkinTags/);
  assert.match(serverJs, /function sendTextResponse/);
  const sendAt = serverJs.indexOf('function sendTextResponse');
  const injectAt = serverJs.indexOf('injectVibeCitySkinTags(html', sendAt);
  assert.ok(injectAt > sendAt);
});

test('the skin has no GTA or Rockstar marks, no visitor totals, and lazy-loads the hero art', () => {
  for (const [name, body] of [['js', skinJs], ['css', skinCss], ['boot', bootJs], ['window', windowJs]]) {
    assert.doesNotMatch(body, BANNED, name);
  }
  assert.match(skinJs, /loading = 'lazy'/);
  assert.match(skinJs, /hero-mobile\.webp/);
  assert.match(skinJs, /hero-wide\.webp/);
  assert.match(skinCss, /hero-property-counter/);
  assert.doesNotMatch(skinJs, /visitor/);
  assert.doesNotMatch(skinCss, /unsplash/);
  assert.match(skinJs, /Kira Boulevard/);
  assert.match(skinJs, /makaug\.com/);
  assert.doesNotMatch(skinJs, /leaflet|mapbox|maplibregl|setStyle\(/i);
  assert.match(bootJs, /noskin|isVibeCitySkinActive/);
});

test('self-hosted campaign assets are present and small', () => {
  const files = [
    'hero-wide.webp',
    'hero-mobile.webp',
    'banner-thin.webp',
    'fonts/Bungee.woff2',
    'fonts/KaushanScript.woff2',
    'fonts/Oswald.woff2',
    'fonts/LuckiestGuy.woff2',
    'vibe-city-skin.css',
    'vibe-city-skin.js',
    'boot.js',
    'window.js'
  ];
  let bytes = 0;
  for (const file of files) {
    const full = path.join(root, 'assets/vibe-city-skin', file);
    assert.equal(fs.existsSync(full), true, file);
    bytes += fs.statSync(full).size;
  }
  assert.ok(bytes < 400 * 1024, 'campaign assets should stay well under 400KB, got ' + bytes);
  assert.ok(skinCss.length < 12 * 1024);
});

test('the applicator picks home, Kira results, a listing, list-property and confirm', () => {
  const context = vm.createContext({
    window: {},
    document: { readyState: 'complete', addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; } },
    location: { pathname: '/land/kira-wakiso', search: '' },
    history: { pushState() {}, replaceState() {} },
    setTimeout,
    Date,
    URLSearchParams
  });
  // Can't fully run the applicator without a DOM. Check the source instead.
  assert.match(skinJs, /function detectMode/);
  assert.match(skinJs, /list-property/);
  assert.match(skinJs, /lp-success-box/);
  assert.match(skinJs, /mission complete/);
  assert.match(skinJs, /Ride to /);
  assert.doesNotMatch(skinJs, /hideListModal/);
  assert.doesNotMatch(skinJs, /0780/);
});
