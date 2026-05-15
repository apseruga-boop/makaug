'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const appSource = fs.readFileSync('assets/makaug-app.js', 'utf8');
const probeSource = fs.readFileSync('scripts/probe-public-routes-browser.js', 'utf8');
const htmlSource = fs.readFileSync('index.html', 'utf8');

test('public route loader detects and replaces temporary skeleton pages', () => {
  assert.match(appSource, /function isPublicRouteSkeletonElement/);
  assert.match(appSource, /function getHydratedPublicRoutePage/);
  assert.match(appSource, /isPublicRouteSkeletonElement\(existingPublicRoutePage\)/);
  assert.match(appSource, /show_page_skeleton_recovery/);
  assert.match(appSource, /imported\.removeAttribute\("data-public-route-skeleton"\)/);
});

test('browser public route probe fails when the temporary route skeleton is visible', () => {
  assert.match(probeSource, /public route skeleton fallback still visible/);
  assert.match(probeSource, /active temporary route skeleton/);
  assert.match(probeSource, /is still showing the temporary route skeleton/);
});

test('public app cache version is bumped for the route skeleton fix', () => {
  assert.match(htmlSource, /section-search-shell-20260512/);
});
