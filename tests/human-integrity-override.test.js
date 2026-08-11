'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  HUMAN_INTEGRITY_OVERRIDE_MARKER,
  HUMAN_INTEGRITY_OVERRIDE_NOTE,
  humanIntegrityOverrideAccess
} = require('../utils/humanIntegrityOverride');

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

test('status endpoint skips only the integrity gate and records an attributable review event', () => {
  const route = read('routes/properties.js');

  assert.match(route, /parseBooleanLike\(req\.body\.integrity_override, false\)/);
  assert.match(route, /if \(!dataIntegrity\.ok && !integrityOverrideAccess\.allowed\)/);
  assert.match(route, /action,[\s\S]*'human_integrity_override_approved'/);
  assert.match(route, /reviewNotes = HUMAN_INTEGRITY_OVERRIDE_NOTE/);
  assert.match(route, /data_integrity_issue_codes: \[\]/);
  assert.match(route, /human_integrity_override: humanIntegrityOverride/);
  assert.match(route, /if \(humanIntegrityOverride\) \{\s*await writeModerationAuditEvents\(\)/, 'override audit must finish before the response');
});

test('King and staff surfaces reveal one human-verified retry after a normal integrity rejection', () => {
  const app = read('assets/makaug-app.js');
  const server = read('server.js');

  assert.match(app, /Approve anyway \(human verified\)/);
  assert.match(app, /error\.response\?\.data_integrity/);
  assert.match(app, /e\.response\?\.data_integrity/);
  assert.match(app, /integrity_override: true/);
  assert.match(app, /HUMAN_INTEGRITY_OVERRIDE_REVIEW_NOTE/);
  assert.match(server, /'human-integrity-override-20260811'/);
});
