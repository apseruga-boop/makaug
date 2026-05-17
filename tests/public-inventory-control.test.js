'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const appSource = fs.readFileSync('assets/makaug-app.js', 'utf8');
const browserProbeSource = fs.readFileSync('scripts/probe-public-routes-browser.js', 'utf8');
const htmlSource = fs.readFileSync('index.html', 'utf8');

function functionSource(name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected ${name} to exist`);
  const next = appSource.indexOf('\nfunction ', start + 1);
  return appSource.slice(start, next === -1 ? appSource.length : next);
}

test('public listings are backend-controlled, not frontend seed inventory', () => {
  assert.match(appSource, /function publicSampleListingsEnabled\(\)/);
  assert.match(appSource, /window\.MAKAUG_ALLOW_SAMPLE_LISTINGS === true/);
  assert.match(appSource, /function isBackendControlledListing\(property\)/);
  assert.match(appSource, /function getPublicListings\(\) \{\s*return PROPERTIES\.filter\(\(p\) => \(\s*isListingPublicVisible\(p\)[\s\S]*isBackendControlledListing\(p\)[\s\S]*publicSampleListingsEnabled\(\)/);
  assert.doesNotMatch(appSource, /function getPublicListings\(\) \{\s*return PROPERTIES\.filter\(\(p\) => isListingPublicVisible\(p\)\);\s*\}/);
});

test('admin live controls use paginated backend snapshots', () => {
  assert.match(appSource, /async function fetchAdminPaginatedRows\(path, headers, options = \{\}\)/);
  assert.match(appSource, /fetchAdminPaginatedRows\("\/api\/properties\?status=all", headers, \{ maxPages: 10 \}\)/);
  assert.match(appSource, /fetchAdminPaginatedRows\("\/api\/admin\/properties\/live", headers, \{ maxPages: 10 \}\)/);
  assert.match(appSource, /renderAdminFeaturedRows\(remoteSnap\?\.liveListings \|\| localSnap\.liveListings \|\| \[\]\)/);
  assert.doesNotMatch(appSource, /renderAdminFeaturedRows\(remoteSnap\?\.allListings \|\| localSnap\.allListings/);
});

test('remove and status actions can target listings loaded only through the live endpoint', () => {
  assert.match(appSource, /adminLiveListings\.find\(\s*\(p\) => String\(p\.id\) === String\(localId\)/);
  assert.match(appSource, /const liveIdx = adminLiveListings\.findIndex/);
  assert.match(appSource, /if \(liveIdx >= 0\) adminLiveListings\[liveIdx\]/);
});

test('admin public action surfaces do not clean-filter live backend listings', () => {
  assert.match(appSource, /function adminPublicControlVisibilityBadge\(row = \{\}\)/);
  assert.match(appSource, /Test-like public listing/);
  for (const name of ['renderAdminLiveListingsRows', 'renderAdminFeaturedRows', 'renderAdminAllListingsRows']) {
    const source = functionSource(name);
    assert.doesNotMatch(source, /adminApplyLaunchCleanFilter/);
    assert.match(source, /adminPublicControlVisibilityBadge/);
  }
});

test('browser release probe blocks uncontrolled seed listings from public pages', () => {
  assert.match(browserProbeSource, /FORBIDDEN_PUBLIC_LISTING_TEXT/);
  assert.match(browserProbeSource, /Luxury Villa in Kololo/);
  assert.match(browserProbeSource, /uncontrolled seed listing visible/);
});

test('anonymous public property APIs suppress launch seed QA listings', () => {
  const routeSource = fs.readFileSync('routes/properties.js', 'utf8');
  assert.match(routeSource, /LAUNCH_SEED_LISTING_MARKERS = \['SOFT LAUNCH TEST - DELETE', 'QA TEST - DELETE'\]/);
  assert.match(routeSource, /function addPublicLaunchSeedFilter/);
  assert.match(routeSource, /COALESCE\(p\.title, ''\) NOT ILIKE/);
  assert.match(routeSource, /isLaunchSeedListing\(property\) && !ownerCanPreview && !adminAccess/);
});

test('public app cache version is bumped for controlled inventory rollout', () => {
  assert.match(htmlSource, /controlled-public-inventory-20260514/);
  assert.match(htmlSource, /admin-live-control-parity-20260515/);
});
