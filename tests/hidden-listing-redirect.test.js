'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  categoryPageSeoMeta,
  locationForRouteSlug,
  publicListingAreaRedirectPath
} = require('../services/publicSeoService');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function assertAreaPath(actual, expected) {
  assert.equal(actual, expected);
  assert.ok(!actual.includes('73fbf51d') && !actual.includes('d8c78ccd'), 'the redirect must not point at the listing');
  const meta = categoryPageSeoMeta(actual);
  assert.ok(meta, `${actual} is not a category route`);
  if (actual.split('/').length > 2) {
    assert.ok(meta.location, `${actual} is not a known area page`);
    assert.equal(locationForRouteSlug(actual.split('/').pop())?.canonical_key, meta.location.canonical_key);
  }
}

test('Ntinda redirects to the Ntinda for-sale page', () => {
  const pathName = publicListingAreaRedirectPath({
    listing_type: 'sale',
    area: 'Ntinda',
    district: 'Kampala',
    canonical_location_id: 'kampala:ntinda'
  });
  assertAreaPath(pathName, '/for-sale/ntinda-kampala');
});

test('Kasanje redirects to the Nakawuka land page', () => {
  const pathName = publicListingAreaRedirectPath({
    listing_type: 'land',
    area: 'Nakawuka',
    district: 'Wakiso',
    canonical_location_id: 'wakiso:nakawuka',
    extra_fields: { canonical_location_id: 'wakiso:nakawuka' }
  });
  assertAreaPath(pathName, '/land/nakawuka-wakiso');
});

test('an unknown area falls back to the district page, then the category root', () => {
  const district = publicListingAreaRedirectPath({
    listing_type: 'land',
    area: 'Not A Real Place',
    district: 'Wakiso'
  });
  assertAreaPath(district, '/land/wakiso-wakiso');

  const rootPath = publicListingAreaRedirectPath({ listing_type: 'sale' });
  assert.equal(rootPath, '/for-sale');
  assert.ok(categoryPageSeoMeta(rootPath));
});

test('the public property URL redirects, stays noindex, and stays out of the sitemap', () => {
  const server = read('server.js');
  const properties = read('routes/properties.js');
  const client = read('assets/makaug-app.js');
  assert.match(server, /return res\.redirect\(302, target\)/);
  assert.match(server, /X-makaug-Listing-Redirect', 'area'/);
  assert.match(server, /X-Robots-Tag', 'noindex, noarchive'/);
  assert.match(server, /return res\.status\(404\)\.send\('Property not found'\)/);
  assert.match(server, /hasStaffOrAdminAccess\(req\)/);
  assert.match(server, /staffView \? 'private, no-store'/);
  assert.match(properties, /sendHiddenListingRedirect\(res, property\)/);
  assert.match(client, /function followPublicListingAreaRedirect/);
  const sitemap = read('services/publicSeoService.js');
  assert.match(sitemap, /WHERE \$\{publicVisibleInventoryWhere\('properties'\)\}/);
  assert.match(sitemap, /if \(property\.thin \|\| property\.noindex\) continue/);
});
