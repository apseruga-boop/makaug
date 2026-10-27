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
    'admin-marketplace-queue', 'admin-off-plan-control', 'admin-short-term-king-control',
    'staff-off-plan-control', 'staff-short-term-control', 'staff-marketplace-panel',
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
    'admin-video-caption-conflicts', 'admin-field-agent-control', 'admin-agents-control', 'staff-reports-panel', 'staff-whatsapp-panel', 'staff-source-panel'
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
