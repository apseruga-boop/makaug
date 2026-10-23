'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('saving the moderation editor does not rebuild it or wait for the dashboard', () => {
  const app = read('assets/makaug-app.js');
  const start = app.indexOf('async function saveStaffListingPreview');
  const end = app.indexOf('function openStaffOwnerStatusWhatsApp', start);
  const save = app.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(save, /renderStaffListingPreviewModal/);
  assert.doesNotMatch(save, /await renderStaffDashboard/);
  assert.match(save, /queueStaffDashboardRefreshAfterModeration\(\{ keepPreviewOpen: true \}\)/);
  assert.match(app, /if \(keepPreviewOpen && currentPage === "staff-review"\) return/);
});

test('a live listing can be unpublished with a reason and published again', () => {
  const app = read('assets/makaug-app.js');
  const staff = read('routes/staff.js');
  assert.match(app, /data-staff-unpublish="1"/);
  assert.match(app, /data-staff-republish="1"/);
  assert.match(app, /function staffUnpublishPreviewListing/);
  assert.match(app, /function staffRepublishPreviewListing/);
  assert.match(app, /staffListingIsLive\(preview\.status\)/);
  assert.match(app, /function staffListingCanRepublish/);
  assert.match(staff, /router\.post\('\/properties\/:id\/unpublish'/);
  assert.match(staff, /router\.post\('\/properties\/:id\/republish'/);
  assert.match(staff, /A reason is required to unpublish a live listing/);
  assert.match(staff, /STAFF_UNPUBLISH_LIVE_STATUSES/);
  assert.match(staff, /staff_listing_unpublished/);
  assert.match(staff, /staff_listing_republished/);
  assert.match(staff, /unpublished_from_status/);
  assert.match(staff, /Only a listing unpublished from the editor can be published again/);
  const unpublish = staff.slice(staff.indexOf("router.post('/properties/:id/unpublish'"), staff.indexOf("router.post('/properties/:id/republish'"));
  assert.match(unpublish, /status = 'hidden'/);
  assert.doesNotMatch(unpublish, /status = 'pending'/);
});

test('approval records the staff member and the editor shows that name', () => {
  const app = read('assets/makaug-app.js');
  const staff = read('routes/staff.js');
  const properties = read('routes/properties.js');
  const sql = read('db/migrations/163_property_approved_by.sql');
  assert.match(app, /function staffApprovedByHtml/);
  assert.match(app, /data-staff-approved-by/);
  assert.match(app, /Approved by/);
  assert.match(staff, /staff_preview_approved_by/);
  assert.match(staff, /approved_by_name: await staffApprovedByName/);
  assert.match(properties, /approved_by = CASE WHEN \$2 = 'approved' THEN COALESCE\(\$7::uuid, approved_by\) ELSE approved_by END/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users\(id\)/);
  assert.match(sql, /listing_status_changed/);
  assert.match(sql, /status_to = 'approved'/);
  assert.match(sql, /DISABLE TRIGGER trg_properties_updated_at/);
  assert.match(sql, /ENABLE TRIGGER trg_properties_updated_at/);
  assert.match(sql, /p\.approved_by IS NULL/);
  assert.match(sql, /u\.id::text = e\.actor_id/);
  assert.match(sql, /approved_by = latest\.actor_id::uuid/);
  const numbers = fs.readdirSync(path.join(__dirname, '../db/migrations'))
    .map((name) => Number(name.split('_')[0]))
    .filter((n) => Number.isFinite(n));
  assert.equal(Math.max(...numbers), 163);
});
