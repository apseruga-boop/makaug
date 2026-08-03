'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const {
  REPORT_LISTING_REMOVAL_STATUS,
  hideReportedProperty
} = require('../services/reportListingModerationService');

test('report removal uses rejected moderation status and preserves audit metadata', async () => {
  const calls = [];
  const row = await hideReportedProperty({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ id: params[0], status: params[1] }] };
    },
    propertyId: '79337fe4-1111-4222-8333-123456789012',
    reportId: '02064bea-1111-4222-8333-123456789012',
    note: 'Confirmed non-property content.',
    actorId: 'staff-user'
  });

  assert.equal(REPORT_LISTING_REMOVAL_STATUS, 'rejected');
  assert.equal(row.status, 'rejected');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /status = \$2/);
  assert.match(calls[0].sql, /hidden_by_report_id/);
  assert.match(calls[0].params[3], /Confirmed non-property content/);
});

test('report removal falls back to core status fields when moderation columns fail', async () => {
  const calls = [];
  const row = await hideReportedProperty({
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (calls.length === 1) {
        const error = new Error('column moderation_reason does not exist');
        error.code = '42703';
        throw error;
      }
      return { rows: [{ id: params[0], status: params[1], extra_fields: {} }] };
    },
    propertyId: '79337fe4-1111-4222-8333-123456789012',
    reportId: '02064bea-1111-4222-8333-123456789012',
    note: 'Remove from public results.',
    actorId: 'admin-user'
  });

  assert.equal(calls.length, 2);
  assert.equal(row.status, 'rejected');
  assert.equal(row.moderation_stage, 'rejected');
  assert.equal(row.compatibility_fallback_used, true);
  assert.equal(row.compatibility_fallback_reason, '42703');
  assert.match(calls[1].sql, /report_removal_fallback/);
});

test('admin and staff report routes share the robust report removal service', () => {
  const root = path.resolve(__dirname, '..');
  const admin = fs.readFileSync(path.join(root, 'routes/admin.js'), 'utf8');
  const staff = fs.readFileSync(path.join(root, 'routes/staff.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  assert.match(admin, /require\('\.\.\/services\/reportListingModerationService'\)/);
  assert.match(staff, /require\('\.\.\/services\/reportListingModerationService'\)/);
  assert.match(admin, /return hideReportedProperty\(/);
  assert.match(staff, /return hideReportedProperty\(/);
  assert(admin.indexOf('const hiddenProperty = hideListing ? await hidePropertyForReport') > admin.indexOf('UPDATE report_listings'));
  assert(staff.indexOf('const hiddenProperty = hideListing ? await staffHidePropertyForReport') > staff.indexOf('UPDATE report_listings'));
  assert.match(html, /k26-report-hide-cascade-20260803/);
});
