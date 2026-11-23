'use strict';
// King PR 1 (Arthur, 21 Nov 2026): paid = closed, staff can't remove agents,
// Call now is locked behind a mic + live-notes check, phone-link drops pause
// calls, and calls with no transcript are flagged for King.
// Run: node --test tests/king-pr1-paid-closed-mic-gate-removal.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const c = require('../services/callingScreen');
const removal = require('../services/agentRemovalRequestService');
const { isStaffSharedKingTool } = require('../utils/staffSharedKingTools');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('closed means paid: signed up is interest, paid and renewed are closes', () => {
  assert.equal(c.closedPaid({ is_close: true, outcome: 'signed_up' }), false);
  assert.equal(c.closedPaid({ is_close: true, outcome: 'interested' }), false);
  assert.equal(c.closedPaid({ is_close: true, outcome: 'paid' }), true);
  assert.equal(c.closedPaid({ is_close: true, outcome: 'renewed' }), true);
  assert.equal(c.closedPaid({ is_close: false, outcome: 'paid' }), false);
  const done = (o) => ({ status: 'done', spoke: true, tapped_at: '2026-11-21T07:00:00Z', task_key: 'new_agents', ...o });
  const s = c.summarize([done({ outcome: 'signed_up', is_close: true }), done({ outcome: 'paid', is_close: true, task_key: 'payments' }), done({ outcome: 'interested' })], []);
  assert.equal(s.closes, 1);
});

test('mic check report: only a fresh passed check with the link up counts as passed', () => {
  const now = new Date('2026-11-21T08:00:00Z');
  assert.equal(c.notesCheckOk(null, now), false);
  assert.equal(c.notesCheckOk({}, now), false);
  assert.equal(c.notesCheckOk({ notes: 'failed', at: '2026-11-21T07:59:00Z' }, now), false);
  assert.equal(c.notesCheckOk({ notes: 'ok', at: '2026-11-21T07:59:00Z' }, now), true);
  assert.equal(c.notesCheckOk({ notes: 'ok', at: '2026-11-21T07:59:00Z', link: 'down' }, now), false);
  assert.equal(c.notesCheckOk({ notes: 'ok', at: '2026-11-20T18:00:00Z' }, now), false, 'older than 12 hours');
  assert.equal(c.notesCheckOk({ notes: 'ok', at: 'nonsense' }, now), false);
});

test('a spoken call with no live-notes text is flagged no_transcript for King', () => {
  const rec = { tapped_at: '2026-11-21T08:00:00Z', ended_at: '2026-11-21T08:03:00Z' };
  assert.ok(c.flagsFor(rec, { key: 'interested', spoke: true }, null, null).includes('no_transcript'));
  assert.ok(c.flagsFor(rec, { key: 'interested', spoke: true }, null, { text: '  ' }).includes('no_transcript'));
  assert.ok(!c.flagsFor(rec, { key: 'interested', spoke: true }, null, { text: 'hello we spoke about the film' }).includes('no_transcript'));
  assert.ok(!c.flagsFor(rec, { key: 'no_answer', spoke: false }, null, null).includes('no_transcript'), 'no answer has nothing to transcribe');
  assert.ok(c.FLAG_LABELS.no_transcript);
});

test('staff logins can request a removal but never remove, preview or restore', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  assert.equal(isStaffSharedKingTool(`/agents/${id}/remove`, 'POST'), false);
  assert.equal(isStaffSharedKingTool(`/agents/${id}/remove-preview`, 'GET'), false);
  assert.equal(isStaffSharedKingTool(`/agents/${id}/restore`, 'POST'), false);
  assert.equal(isStaffSharedKingTool(`/agents/${id}/removal-request`, 'POST'), true);
  assert.equal(isStaffSharedKingTool('/agent-removal-requests', 'GET'), false, 'the queue is King-only');
  assert.equal(isStaffSharedKingTool('/agent-removal-requests/x/decline', 'POST'), false);
});

test('a removal request needs a valid agent, a reason and a note', () => {
  const id = '11111111-2222-3333-4444-555555555555';
  assert.throws(() => removal.validateRequest({ agentId: 'x', reasonCode: 'duplicate', note: 'same phone' }), /Invalid agent/);
  assert.throws(() => removal.validateRequest({ agentId: id, reasonCode: 'nope', note: 'same phone' }), /Choose why/);
  assert.throws(() => removal.validateRequest({ agentId: id, reasonCode: 'duplicate', note: 'x' }), /Say why/);
  const ok = removal.validateRequest({ agentId: id, reasonCode: 'duplicate', note: 'Same phone and photos as Kato Homes' });
  assert.equal(ok.reason.code, 'duplicate');
});

test('migration 243 backs up before it changes anything, and has a rollback', () => {
  const sql = read('db/migrations/243_paid_is_closed_and_agent_removal_requests.sql');
  const backupAt = sql.indexOf('INSERT INTO call_attempts_close_243_backup');
  const changeAt = sql.indexOf('UPDATE call_attempts SET is_close = false');
  assert.ok(backupAt > 0 && changeAt > backupAt);
  assert.ok(sql.indexOf('INSERT INTO call_tasks_243_backup') < sql.indexOf('UPDATE call_tasks t'));
  assert.match(sql, /CREATE TABLE IF NOT EXISTS agent_removal_requests/);
  const rb = read('scripts/rollback-243-paid-is-closed.sql');
  assert.match(rb, /call_tasks_243_backup/);
  assert.match(rb, /call_attempts_close_243_backup/);
});

test('calling screen: live notes never lock Call now (23 Nov 2026), the check is still sent and logged', () => {
  const js = read('assets/calling-screen.js');
  assert.doesNotMatch(js, /toast\('Do the mic check first\.'/);
  assert.doesNotMatch(js, /!checkPassed\(\)\) \{\n\s+body = gateHtml\(\);/);
  assert.match(js, /\/tap', \{ session_id: S\.id, check: checkPayload\(\) \}/);
  assert.match(js, /devicechange/);
  assert.match(js, /ev\('link_drop'/);
  assert.match(js, /Phone Link/);
  assert.match(js, /notes_check_passed/);
  assert.match(read('index.html'), /\/assets\/calling-screen\.js\?v=2026112\d-[a-z0-9]+/);
});

test('agent manager: staff get "Send removal request", never Remove or Restore', () => {
  const js = read('assets/makaug-app.js');
  assert.match(js, /a\.removed_at \|\| !\(typeof deskPageIsStaff === "function" && deskPageIsStaff\(\)\) \? "" : adminAgentManagerRemovalRequestHtml\(id\)/);
  assert.match(js, /a\.removed_at \|\| \(typeof deskPageIsStaff === "function" && deskPageIsStaff\(\)\) \? "" : `<section class="rounded-xl border border-red-200 bg-red-50 p-3" data-agent-remove>/);
  assert.match(js, /\/removal-request`/);
  assert.match(js, /\/api\/admin\/agent-removal-requests\?status=open/);
});

test('Connect your phone: four lights, picture guides for every setup, opened from the gate', () => {
  const js = read('assets/calling-screen.js');
  for (const k of ['bt', 'link', 'sms', 'momo', 'fix']) assert.match(js, new RegExp(`\\n    ${k}: \\{ title: `), `guide ${k}`);
  const steps = (js.match(/svgWrap\(/g) || []).length;
  assert.ok(steps >= 20, 'every step has a drawn picture');
  assert.match(js, /data-mkc-connect="fix">📱 Show me how/);
  assert.match(js, /data-mkc-connect="bt">📱 Connect your phone/);
  for (const l of ['Phone link / Bluetooth', 'Mic & live notes', 'SMS gateway app', 'MoMo forwarder']) assert.ok(js.includes(l), l);
  assert.match(read('routes/calling.js'), /router\.get\('\/calling\/connect-status'/);
  assert.doesNotMatch(read('routes/calling.js'), /MONEY_SMS_WEBHOOK_TOKEN \|\| ''\)\s*}/, 'never returns the token itself');
});
