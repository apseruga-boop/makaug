'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  HUMAN_APPROVAL_OVERRIDE_MARKER,
  HUMAN_INTEGRITY_OVERRIDE_MARKER,
  HUMAN_INTEGRITY_OVERRIDE_NOTE,
  humanApprovalOverrideAccess,
  humanIntegrityOverrideAccess
} = require('../utils/humanIntegrityOverride');
const { normalizeReviewLocationHierarchy } = require('../utils/ugandaLocationHierarchy');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('only a signed-in super-admin or moderator can request the human override', () => {
  const superAdmin = humanIntegrityOverrideAccess({
    requested: true,
    nextStatus: 'approved',
    adminAuth: { type: 'bearer', userId: 'human-1', role: 'super_admin' }
  });
  const moderator = humanIntegrityOverrideAccess({
    requested: true,
    nextStatus: 'approved',
    adminAuth: { type: 'moderator', userId: 'human-2', role: 'moderator' }
  });

  assert.equal(superAdmin.allowed, true);
  assert.equal(moderator.allowed, true);
  assert.equal(HUMAN_INTEGRITY_OVERRIDE_NOTE, 'human override — verified manually');
  assert.equal(HUMAN_INTEGRITY_OVERRIDE_MARKER, 'human-integrity-override-20260811');
  assert.equal(HUMAN_APPROVAL_OVERRIDE_MARKER, 'human-approval-overlord-20260811');
  assert.equal(humanApprovalOverrideAccess({
    requested: true,
    nextStatus: 'approved',
    adminAuth: { type: 'bearer', userId: 'human-1', role: 'super_admin' }
  }).allowed, true);
});

test('API keys, automation, unsupported roles, and non-approval statuses remain blocked', () => {
  const cases = [
    { requested: true, nextStatus: 'approved', adminAuth: { type: 'api_key' } },
    { requested: true, nextStatus: 'approved', adminAuth: { type: 'api_key', userId: 'fake', role: 'super_admin' } },
    { requested: true, nextStatus: 'approved', adminAuth: { type: 'bearer', userId: 'human-3', role: 'admin' } },
    { requested: true, nextStatus: 'rejected', adminAuth: { type: 'bearer', userId: 'human-4', role: 'super_admin' } },
    { requested: false, nextStatus: 'approved', adminAuth: { type: 'bearer', userId: 'human-5', role: 'super_admin' } }
  ];

  cases.forEach((input) => assert.equal(humanIntegrityOverrideAccess(input).allowed, false));
});

test('status endpoint applies one human-only override policy to every approval blocker', () => {
  const route = read('routes/properties.js');

  assert.match(route, /req\.body\.human_approval_override[\s\S]+req\.body\.integrity_override/);
  assert.match(route, /const handleApprovalBlocker =/);
  assert.match(route, /canonical_location_confirmation/);
  assert.match(route, /price_quality/);
  assert.match(route, /data_integrity/);
  assert.match(route, /location_reclassification_confirmation/);
  assert.match(route, /commercial_classification/);
  assert.match(route, /approval_checklist/);
  assert.match(route, /identity_verification/);
  assert.match(route, /action,[\s\S]*'human_integrity_override_approved'/);
  assert.match(route, /action,[\s\S]*'human_approval_override_approved'/);
  assert.match(route, /reviewNotes = HUMAN_INTEGRITY_OVERRIDE_NOTE/);
  assert.match(route, /data_integrity_issue_codes: \[\]/);
  assert.match(route, /human_integrity_override: humanIntegrityOverride/);
  assert.match(route, /human_approval_override: humanApprovalOverride/);
  assert.match(route, /if \(humanApprovalOverride \|\| humanIntegrityOverride\) \{\s*await writeModerationAuditEvents\(\)/, 'override audit must finish before the response');
});

test('King and staff surfaces render full approval errors in the Decision panel', () => {
  const app = read('assets/makaug-app.js');
  const server = read('server.js');

  assert.match(app, /Approve anyway \(human verified\)/);
  assert.match(app, /data-approval-blocker-host/);
  assert.match(app, /Approval blocked — full reason/);
  assert.match(app, /showApprovalBlockerBanner\(response/);
  assert.match(app, /human_approval_override: true/);
  assert.match(app, /missing_fields/);
  assert.match(app, /HUMAN_INTEGRITY_OVERRIDE_REVIEW_NOTE/);
  assert.match(server, /'human-integrity-override-20260811'/);
  assert.match(server, /'human-approval-overlord-20260811'/);
});

test('Kayunga exact Find result fills the human review cascade and is persisted for status validation', () => {
  const app = read('assets/makaug-app.js');
  const route = read('routes/properties.js');
  const admin = read('routes/admin.js');
  const hierarchy = normalizeReviewLocationHierarchy({
    canonical_location_id: 'kayunga:kayunga',
    region: 'Central',
    district: 'Kayunga',
    city: 'Kayunga Town',
    neighborhood: 'Kayunga',
    area: 'Kayunga'
  }, {
    allowDistrictNode: true,
    allowCanonicalHierarchy: true
  });

  assert.deepEqual(hierarchy.errors, []);
  assert.equal(hierarchy.region, 'Central');
  assert.equal(hierarchy.district, 'Kayunga');
  assert.equal(hierarchy.city, 'Kayunga Town');
  assert.equal(hierarchy.neighborhood, 'Kayunga');
  assert.equal(hierarchy.canonical?.key, 'kayunga:kayunga');
  assert.match(app, /function canonicalTownForLocation[\s\S]+`\$\{name\} Town`/);
  assert.match(app, /function applyAdminReviewCanonicalLocation[\s\S]+canonicalTownForLocation/);
  assert.match(app, /human_location_confirmed: locationConfirmation\.confirmed/);
  assert.match(route, /'canonical_location_id',[\s\S]+'location_resolution_status'/);
  assert.match(route, /allowDistrictNode: humanLocationConfirmed/);
  assert.match(admin, /allowDistrictNode: true/);
});
