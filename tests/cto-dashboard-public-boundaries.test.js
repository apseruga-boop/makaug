'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sanitizePublicHtml, isProtectedPath, isKnownPublicRoute, roleCanAccessProtectedPath } = require('../services/publicHtmlSanitizer');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

test('new Public and agent receipt controls are absent from anonymous public HTML', () => {
  for (const pathname of ['/', '/land', '/for-sale', '/to-rent', '/brokers', '/agents/fixture', '/property/fixture', '/list-property', '/login', '/about', '/advertise', '/pay/fixture']) {
    const publicHtml = sanitizePublicHtml(html, { pathname });
    for (const marker of ['id="admin-public-manager"', 'data-admin-control="public"', 'adminPublicManagerLoad(', 'adminPublicManagerFindCandidate(', 'data-manager-add-payment', 'data-agent-personal-whatsapp', 'id="page-admin-dashboard"']) {
      assert.equal(publicHtml.includes(marker), false, `${pathname} must not include ${marker}`);
    }
  }
});

test('Public manager deep link follows the existing admin role boundary', () => {
  assert.equal(isKnownPublicRoute('/admin/public'), true);
  assert.equal(isProtectedPath('/admin/public'), true);
  for (const role of ['buyer_renter', 'agent_broker', 'moderator', 'field_agent', 'student']) {
    assert.equal(roleCanAccessProtectedPath({ role }, '/admin/public'), false, role);
  }
  for (const role of ['admin', 'super_admin']) assert.equal(roleCanAccessProtectedPath({ role }, '/admin/public'), true);
});
