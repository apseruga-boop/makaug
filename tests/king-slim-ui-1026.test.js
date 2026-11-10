'use strict';

// King dashboard slim-down (26 Oct 2026): retired panels leave the page, their
// backends and data stay, and old dashboard links land somewhere that explains the move.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const html = read('index.html');
const app = read('assets', 'makaug-app.js');
const server = read('server.js');

test('retired King and staff panels are gone from the page', () => {
  for (const id of [
    'admin-ai-ceo-panel', 'admin-ai-agent-results', 'admin-backlog-recovery-lab', 'admin-control-shortcuts',
    'admin-crm-shell', 'admin-launch-control', 'king-control-map-legacy',
    'admin-marketplace-queue', 'admin-off-plan-control',
    'staff-off-plan-control', 'staff-marketplace-panel',
    'staff-ai-panel', 'staff-advertising-panel', 'staff-bank-panel', 'admin-x-drip-btn'
  ]) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`), `${id} should be removed`);
  }
  assert.ok(!app.includes('adminCleanupApril29TestBatch'), 'the one-off 29 April clean-up button is gone');
});

test('kept panels and merge targets are still on the page', () => {
  for (const id of [
    'admin-review-queue-control', 'admin-live-followup-control', 'admin-accounts-control', 'admin-staff-control',
    'admin-revenue-control', 'admin-whatsapp-control', 'admin-notifications-control', 'admin-listings-control',
    'admin-actioned-listings-control', 'admin-featured-agents-control', 'admin-crm-tasks-table',
    'admin-video-caption-conflicts', 'admin-field-agent-control', 'admin-agents-control', 'staff-reports-panel', 'staff-whatsapp-panel', 'staff-source-panel',
    'staff-short-term-control', 'staff-short-term-queue', 'admin-short-term-king-control', 'admin-short-term-king-queue'
  ]) {
    assert.match(html, new RegExp(`id="${id}`), `${id} should stay`);
  }
});

test('backends for removed panels stay mounted (no data is dropped)', () => {
  for (const mount of ["'/api/marketplace'", "'/api/ai-ceo'", "'/api/field-agent'", "'/api/staff/off-plan'", "'/api/short-term'"]) {
    assert.ok(server.includes(`app.use(${mount}`), `${mount} must stay mounted`);
  }
});

test('old dashboard links open the new home with a moved note', () => {
  for (const route of ['/admin/launch-control', '/admin/student-sweep', '/admin/language']) {
    const line = app.split('\n').find((l) => l.includes(`"${route}": {`));
    assert.ok(line, `${route} still resolves`);
    assert.match(line, /moved: "/, `${route} explains where it went`);
  }
  const allowed = app.match(/const moved = \{[^}]+\}/);
  assert.ok(allowed, 'removed tabs map to where their content now lives');
});

test('short-stay desks are restored and off-plan and marketplace desks stay retired', () => {
  assert.match(html, /id="staff-short-term-control"/);
  assert.match(html, />Short stays</);
  assert.match(html, /id="admin-short-term-king-control"/);
  assert.match(html, /Short stays — final gate/);
  assert.doesNotMatch(html, /id="staff-off-plan-control"/);
  assert.doesNotMatch(html, /id="admin-off-plan-control"/);
  assert.doesNotMatch(html, /id="staff-marketplace-panel"/);
  assert.doesNotMatch(html, /id="admin-marketplace-queue"/);
  assert.match(app, /"short-term": "staff-short-term-control"/);
});

test('found-online short stays are labelled and never offered a message', () => {
  const desk = read('assets', 'short-term-admin.js');
  const route = read('routes', 'short-term.js');
  const moderation = require('../services/shortTermModerationService');

  assert.equal(moderation.listingDoNotMessage({ do_not_message: true }), true);
  assert.equal(moderation.listingDoNotMessage({ extra_fields: { do_not_message: 'true' } }), true);
  assert.equal(moderation.listingDoNotMessage({ do_not_message: false, extra_fields: {} }), false);
  assert.equal(moderation.staffCanReachApproved(), true);

  assert.match(desk, /function isFoundOnline/);
  assert.match(desk, /function allowsHostMessage/);
  assert.match(desk, /Found online/);
  const staffActions = desk.slice(desk.indexOf('function staffActionsHtml'), desk.indexOf('function kingActionsHtml'));
  assert.match(staffActions, />Approve</);
  assert.match(staffActions, />Reject</);
  assert.match(staffActions, /allowsHostMessage\(listing\)[\s\S]{0,280}request_changes/);
  const sheet = desk.slice(desk.indexOf('function renderReviewSheet'), desk.indexOf('function openReviewSheet'));
  assert.match(sheet, /photosHtml\(payload\.photos\)/);
  assert.match(sheet, /factsFormHtml/);
  assert.match(sheet, /allowsHostMessage\(l\)[\s\S]{0,500}data-st-paylink/);
  assert.match(desk, /data-st-save-facts/);

  assert.match(route, /router\.post\('\/staff\/listings\/:id\/facts', requireStaffAccess/);
  assert.match(route, /skipped: 'do_not_message'/);
  assert.match(route, /This stay was found online\. Nothing is sent to the host\./);
  assert.match(route, /action === 'approve' && listing\?\.id && !silentHost/);
});

test('the moderator desk hides host-check boxes and still offers approve and reject', () => {
  const desk = read('assets', 'short-term-admin.js');
  const sheet = desk.slice(desk.indexOf('function renderReviewSheet'), desk.indexOf('function openReviewSheet'));
  const staffActions = desk.slice(desk.indexOf('function staffActionsHtml'), desk.indexOf('function kingActionsHtml'));
  assert.match(staffActions, />Approve</);
  assert.match(staffActions, />Reject</);
  assert.match(sheet, /which === 'king'[\s\S]{0,120}Review checks/);
  assert.match(sheet, /checkRowsHtml/);
});
