'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const app = read('assets/makaug-app.js');
const adminRoute = read('routes/admin.js');
const propertiesRoute = read('routes/properties.js');
const server = read('server.js');
const migration = read('db/migrations/094_featured_daily_rotation_and_period_repair.sql');

test('public featured view replaces the old for-sale View all target', () => {
  assert.match(html, /featured-daily-rotation-20260725/);
  assert.match(html, /id="page-featured"/);
  assert.match(html, /id="featured-grid"/);
  assert.match(html, /id="home-featured-link" href="\/featured"/);
  assert.match(app, /featured: "\/featured"/);
  assert.match(app, /"\/featured": "featured"/);
  assert.match(app, /renderGrid\("featured-grid", getHomepageFeaturedListings\(publicListings\)\)/);
});

test('found-online cards expose category labels and category-correct fallback subtypes', () => {
  assert.match(app, /listingBadgeRowHtml\(p,/);
  assert.match(app, /land: "Land"/);
  assert.match(app, /student: "Student accommodation"/);
  assert.match(app, /commercial: "Commercial property"/);
  assert.match(app, /subtype: p\?\.property_type \|\| p\?\.subtype \|\| defaultSubtype/);
  assert.match(propertiesRoute, /type === 'student' \|\| type === 'students'/);
});

test('rotation is scheduled, auditable and exposed to protected admin controls', () => {
  assert.match(server, /startFeaturedRotationScheduler\(db\)/);
  assert.match(adminRoute, /router\.get\('\/featured-rotation'/);
  assert.match(adminRoute, /router\.post\('\/featured-rotation\/run-once'/);
  assert.match(html, /id="admin-featured-rotation-status"/);
  assert.match(app, /async function adminRunFeaturedRotation/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS featured_rotation_runs/);
  assert.match(migration, /id::text LIKE 'b345d8e9%'/);
  assert.match(migration, /id::text LIKE '956ce9d6%'/);
  assert.match(migration, /id::text LIKE '39e9513e%'/);
});
