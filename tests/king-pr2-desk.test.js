'use strict';
// King PR 2 (Arthur, 21 Nov 2026): King sidebar desk, Overview, Payments & MoMo, Removal requests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const kd = require('../services/kingDesk');
const { isStaffSharedKingTool } = require('../utils/staffSharedKingTools');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('Kampala ranges: Monday week start, month to date vs the same days last month', () => {
  const r = kd.ranges(new Date('2026-11-21T08:00:00Z')); // Saturday 11:00 Kampala
  assert.equal(r.today, '2026-11-21');
  assert.equal(r.weekStart, '2026-11-16');
  assert.equal(r.lastWeekStart, '2026-11-09');
  assert.equal(r.monthStart, '2026-11-01');
  assert.equal(r.lastMonthStart, '2026-10-01');
  assert.equal(r.sameDayLastMonth, '2026-10-22');
  assert.equal(r.elapsedWeekDays, 6);
  const late = kd.ranges(new Date('2026-11-22T22:30:00Z')); // Monday 01:30 Kampala
  assert.equal(late.today, '2026-11-23'); assert.equal(late.weekStart, '2026-11-23');
});

test('week series counts calls per Kampala weekday', () => {
  const s = kd.weekSeries([{ at: '2026-11-16T05:00:00Z' }, { at: '2026-11-16T20:59:00Z' }, { at: '2026-11-16T21:01:00Z' }, { at: '2026-11-22T20:00:00Z' }, { at: '2026-11-23T00:00:00Z' }], '2026-11-16');
  assert.deepEqual(s, [2, 1, 0, 0, 0, 0, 1]);
  assert.equal(kd.pctChange(12, 10), 20); assert.equal(kd.pctChange(5, 0), null);
});

test('phones are masked to the last 3 digits, words kept', () => {
  assert.equal(kd.mask('+256 700 900 321'), '•••321');
  assert.equal(kd.maskText('J. NAKATO 0700900321'), 'J. NAKATO •••321');
  assert.equal(kd.maskText('KATO HOMES'), 'KATO HOMES');
});

test('King desk APIs are King-only: not shared with staff logins, and moderators are refused', () => {
  assert.equal(isStaffSharedKingTool('/king/overview', 'GET'), false);
  assert.equal(isStaffSharedKingTool('/king/payments', 'GET'), false);
  const r = read('routes/kingDesk.js');
  assert.match(r, /req\.adminAuth\.type !== 'moderator'/);
  assert.match(r, /status\(403\)/);
  assert.match(read('routes/admin.js'), /registerKingDeskRoutes\(router/);
});

test('payments never return SMS bodies or full numbers', () => {
  const s = read('services/kingDesk.js');
  const payments = s.slice(s.indexOf('async function payments'), s.indexOf('module.exports'));
  assert.doesNotMatch(payments, /SELECT[^;]*\bbody\b/);
  assert.match(payments, /phone: mask\(e\.payer_phone\)/);
  assert.match(payments, /from: maskText\(s\.counterparty\)/);
});

test('sidebar reaches every King tab, and the new pages are real tabs', () => {
  const app = read('assets/makaug-app.js');
  const allowed = app.match(/const allowed = (\[[^\]]+\]);\n  const previousTab = activeAdminWorkflowTab;/)[1];
  const tabs = JSON.parse(allowed);
  for (const t of ['k-overview', 'k-payments', 'k-removals', 'k-staff']) assert.ok(tabs.includes(t), t);
  assert.match(app, /makaug:admin-tab/);
  const desk = read('assets/king-desk.js');
  for (const t of tabs.filter((x) => x !== 'k-staff')) assert.ok(desk.includes(`['${t}', `), `sidebar has ${t}`);
  const html = read('index.html');
  for (const t of ['k-overview', 'k-payments', 'k-removals', 'k-staff']) assert.match(html, new RegExp(`data-admin-tab-panel="${t}"`));
  assert.match(html, /\/assets\/king-desk\.js\?v=/);
});
