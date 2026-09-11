'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const eligibility = require('../services/publicAgentEligibilityService');

test('a staff-reviewed private-ID profile can go public without publishing pending listings', () => {
  const filters = ["a.status = 'approved'"];
  const values = [];
  eligibility.addPublicAgentEligibilityFilters(filters, values, 'a');
  const sql = filters.join('\n');

  assert.equal(eligibility.PUBLIC_DIRECT_AGENT_MIN_LIVE_LISTINGS, 1);
  assert.equal(eligibility.REVIEWED_PRIVATE_ID_PROFILE_MARKER, '[STAFF_REVIEWED_PRIVATE_ID_PROFILE]');
  assert.match(sql, /STAFF_REVIEWED_PRIVATE_ID_PROFILE/);
  assert.match(sql, /identity_document_url/);
  assert.match(sql, /p\.status = 'approved'/);
});

test('the protected admin approval requires three explicit checks and does not update properties', () => {
  const admin = read('routes/admin.js');
  const start = admin.indexOf("router.post('/agents/:id/public-profile-approval'");
  const end = admin.indexOf("router.patch('/agents/:id/featured'", start);
  assert.ok(start > admin.indexOf('router.use(requireAdminApiKey)'));
  assert.ok(end > start);
  const route = admin.slice(start, end);

  assert.match(route, /identity_document_reviewed/);
  assert.match(route, /contact_permission_confirmed/);
  assert.match(route, /profile_facts_confirmed/);
  assert.match(route, /identity_document_url/);
  assert.match(route, /listing_status_unchanged: true/);
  assert.doesNotMatch(route, /UPDATE properties/);
  assert.doesNotMatch(route, /identity_document_url[\s\S]*RETURNING[\s\S]*identity_document_url/);
});

test('King dashboard exposes the reviewed-profile action and keeps property moderation separate', () => {
  const app = read('assets/makaug-app.js');
  const html = read('index.html');
  assert.match(app, /async function adminApproveAgentPublicProfile/);
  assert.match(app, /Approve public profile/);
  assert.match(app, /Linked properties will remain in staff review/);
  assert.match(app, /identity_document_reviewed: true/);
  assert.match(html, /staff-reviewed-agent-public-profile-20260911/);
});
