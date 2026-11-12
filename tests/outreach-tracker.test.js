'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const prospects = require('../services/agentProspectService');
const { isStaffSharedKingTool } = require('../utils/staffSharedKingTools');

test('same-video outreach is blocked with the date, sender and follow-up', () => {
  const message = prospects.formatAlreadyContactedMessage({
    full_name: 'Kato Brian',
    pitched_at: '2026-11-10T08:00:00.000Z',
    pitched_by_name: 'Ronald',
    status: 'pitched',
    video_kind: 'agent'
  });
  assert.match(message, /Kato Brian/);
  assert.match(message, /10 Nov 2026/);
  assert.match(message, /Ronald/);
  assert.match(message, /No reply yet/);
  assert.match(message, /Call them instead/i);
  assert.doesNotMatch(message, /0772|256772|123456/);
});

test('do-not-contact and found-online codes are not treated as a new send', () => {
  const dnc = prospects.formatAlreadyContactedMessage({
    full_name: 'Amina',
    do_not_contact: true,
    pitched_at: '2026-11-11T08:00:00.000Z'
  });
  assert.match(dnc, /do not contact again/i);
});

test('public outreach rows mask the phone to the last three digits', () => {
  const row = prospects.publicProspect({
    id: '11111111-1111-1111-1111-111111111111',
    full_name: 'Kato Brian',
    phone: '256772123456',
    phone_key: '772123456',
    status: 'pitched',
    pitched_at: '2026-11-10T08:00:00.000Z',
    pitched_by_name: 'Arthur',
    video_kind: 'agent',
    days_since_pitch: 2
  });
  assert.equal(row.phone_masked, '•••456');
  assert.equal(row.follow_up, 'No reply yet');
  assert.equal(row.pitched_by_name, 'Arthur');
  assert.equal(row.days_ago, 2);
  assert.match(row.next_step, /Call them/);
  assert.equal(row.can_reach_out_again, true);
  assert.ok(!JSON.stringify(row).includes('772123456'));
  assert.ok(!JSON.stringify(row).includes('256772'));
});

test('logging a send and follow-up status are exported for the desk', () => {
  assert.equal(typeof prospects.logManualOutreach, 'function');
  assert.equal(typeof prospects.setFollowUp, 'function');
  assert.equal(typeof prospects.setDoNotContact, 'function');
  assert.equal(typeof prospects.evaluateOutreachSend, 'function');
});

test('staff can use outreach, agents, public and featured tools, but not lead-outreach sends', () => {
  assert.equal(isStaffSharedKingTool('/outreach-tracker', 'GET'), true);
  assert.equal(isStaffSharedKingTool('/outreach-tracker/log', 'POST'), true);
  assert.equal(isStaffSharedKingTool('/agent-manager/agents', 'GET'), true);
  assert.equal(isStaffSharedKingTool('/agent-manager/public', 'GET'), true);
  assert.equal(isStaffSharedKingTool('/agents', 'POST'), true);
  assert.equal(isStaffSharedKingTool('/agents/abc/status', 'PATCH'), true);
  assert.equal(isStaffSharedKingTool('/properties/abc/featured', 'PATCH'), true);
  assert.equal(isStaffSharedKingTool('/properties/live', 'GET'), true);
  assert.equal(isStaffSharedKingTool('/outreach/email/send', 'POST'), false);
  assert.equal(isStaffSharedKingTool('/outreach/whatsapp/send', 'POST'), false);
  assert.equal(isStaffSharedKingTool('/agents/abc/temporary-password', 'POST'), false);
  assert.equal(isStaffSharedKingTool('/users', 'GET'), false);
  assert.equal(isStaffSharedKingTool('/command-centre', 'GET'), false);
});

test('the King and staff dashboards have a separate Outreach section', () => {
  const html = read('index.html');
  const app = read('assets/makaug-app.js');
  assert.match(html, /data-admin-tab-button="outreach"/);
  assert.match(html, /data-admin-tab-panel="outreach"/);
  assert.match(html, /data-staff-tools-tab="outreach"/);
  assert.match(html, /data-staff-tools-tab="agents"/);
  assert.match(html, /data-staff-tools-tab="public"/);
  assert.match(html, /data-staff-tools-tab="live"/);
  assert.match(html, /id="staff-agent-manager"/);
  assert.match(html, /id="staff-public-manager"/);
  assert.match(html, /id="staff-featured-listings-table"/);
  assert.match(html, /data-outreach-root="admin"/);
  assert.match(html, /data-outreach-root="staff"/);
  assert.match(html, />Accounts</);
  assert.doesNotMatch(html, /data-admin-tab-button="accounts"[^>]*>Accounts & Outreach/);
  assert.match(app, /function setStaffToolsTab/);
  assert.match(app, /function staffOutreachEnsureLoaded/);
  assert.match(app, /Do not contact again/);
  assert.match(app, /Log a send already made/);
  assert.match(app, /canUseSharedKingToolsApi/);
});

test('agent approval and featured writes record who did it', () => {
  const admin = read('routes/admin.js');
  assert.match(admin, /approved_by = CASE WHEN \$2 = 'approved'/);
  assert.match(admin, /approved_by_name = CASE WHEN \$2 = 'approved'/);
  assert.match(admin, /featured_by', \$3::text/);
  assert.match(admin, /featured_removed_by', \$3::text/);
  assert.match(admin, /approved_by_name: approvalActorName/);
  const migration = read('db/migrations/222_outreach_tracker_and_agent_approval_audit.sql');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS do_not_contact/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS approved_by UUID/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS approved_by_name TEXT/);
  assert.doesNotMatch(migration, /INSERT INTO agent_prospects/);
});

test('this week\'s backfill is a post-boot script with backup and rollback, not a boot migration', () => {
  const script = read('scripts/backfill-outreach-week-2026-11-10.js');
  const rollback = read('scripts/rollback-outreach-week-2026-11-10.js');
  assert.match(script, /--apply/);
  assert.match(script, /batches of 20|BATCH = 20/);
  assert.match(script, /lock_timeout.*3s/);
  assert.match(script, /statement_timeout.*30s/);
  assert.match(script, /explainer_video_sent/);
  assert.match(script, /2026-11-10/);
  assert.match(rollback, /backfill_week_2026_11_10/);
  assert.match(rollback, /--apply/);
});
