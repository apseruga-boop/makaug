'use strict';
// PR 3a (Arthur, 21 Nov 2026): staff sidebar + own dashboard, own-data guards,
// profile masking, behind pace, and the staff live-check fixes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../config/database');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test.after(async () => { try { await db.pool.end(); } catch (_) {} });

test('pace flags behind only when 5+ calls were expected and under 70% done', () => {
  const { pace } = require('../services/callingPlanner');
  const plan = { blocks: [
    { kind: 'new_agents', start: '08:00', end: '10:00', target: 10, done: 3 },
    { kind: 'lunch', start: '13:00', end: '14:00', target: 0, done: 0 },
    { kind: 'existing', start: '10:00', end: '12:00', target: 10, done: 0 }
  ] };
  const at11 = pace(plan, 11 * 60);
  assert.equal(at11.expected, 15);
  assert.equal(at11.done, 3);
  assert.equal(at11.behind, true);
  assert.equal(at11.short_by, 12);
  const early = pace(plan, 8 * 60 + 20); // 2 expected: too early to nag
  assert.equal(early.behind, false);
  const good = pace({ blocks: [{ kind: 'new_agents', start: '08:00', end: '10:00', target: 10, done: 9 }] }, 10 * 60);
  assert.equal(good.behind, false);
});

test('maskTail shows only the last 3 characters', () => {
  const { maskTail } = require('../services/staffDesk');
  assert.equal(maskTail('CM00000000XYZ'), '•••XYZ');
  assert.equal(maskTail('07 0000 0123'), '•••123');
  assert.equal(maskTail('12'), '•••');
  assert.equal(maskTail(''), '');
});

test('profileOf masks ID and emergency phone for staff; only King gets them in full', async () => {
  const sd = require('../services/staffDesk');
  const orig = db.query;
  db.query = async () => ({ rows: [{ user_id: 'u1', photo_data: '', id_type: 'national_id', id_number: 'CM0000000000ABC', id_expiry: null, home_area: 'Ntinda', emergency_name: 'Test Person', emergency_phone: '0700000123' }] });
  try {
    const mine = await sd.profileOf('u1');
    assert.equal(mine.id_number_masked, '•••ABC');
    assert.equal(mine.emergency_phone_masked, '•••123');
    assert.equal(mine.id_number, undefined);
    assert.equal(mine.emergency_phone, undefined);
    assert.ok(!JSON.stringify(mine).includes('CM0000000000ABC'));
    assert.deepEqual(mine.missing, ['photo']);
    const king = await sd.profileOf('u1', { king: true });
    assert.equal(king.id_number, 'CM0000000000ABC');
  } finally { db.query = orig; }
});

test('ownPersonOnly forces a staff login onto its own person_key; King may choose', () => {
  const { ownPersonOnly } = require('../routes/staffDesk');
  const staff = { adminAuth: { type: 'moderator' }, userAuth: { profile_data: { person_key: 'ronald' } }, query: { person_key: 'grace' }, body: { person_key: 'grace', x: 1 } };
  let called = 0; ownPersonOnly(staff, {}, () => { called += 1; });
  assert.equal(called, 1);
  assert.equal(staff.query.person_key, 'ronald');
  assert.equal(staff.body.person_key, 'ronald');
  const noKeyGiven = { adminAuth: { type: 'moderator' }, userAuth: { profile_data: { person_key: 'ronald' } }, query: {}, body: {} };
  ownPersonOnly(noKeyGiven, {}, () => {});
  assert.equal(noKeyGiven.query.person_key, undefined);
  const king = { adminAuth: { type: 'admin' }, userAuth: {}, query: { person_key: 'grace' }, body: {} };
  ownPersonOnly(king, {}, () => {});
  assert.equal(king.query.person_key, 'grace');
});

test('ownOnly strips other staff from the performance payload', () => {
  const { ownOnly } = require('../routes/staffPerformance');
  const out = ownOnly({
    people: [{ key: 'ronald' }, { key: 'grace' }], top_today: { key: 'grace' },
    follow_ups: [{ person_key: 'grace' }, { person_key: 'ronald' }],
    activity: [{ day: 'd', people: [{ key: 'ronald' }, { key: 'grace' }] }],
    log: [{ person_key: 'grace' }], targets_history: [{ person_key: 'ronald' }]
  }, 'ronald');
  assert.deepEqual(out.people, [{ key: 'ronald' }]);
  assert.equal(out.top_today, null);
  assert.deepEqual(out.follow_ups, [{ person_key: 'ronald' }]);
  assert.deepEqual(out.activity[0].people, [{ key: 'ronald' }]);
  assert.deepEqual(out.log, []);
  assert.equal(ownOnly({ people: [{ key: 'a' }] }, '').people.length, 0);
});

test('callers may reach /desk and /calling only; desk routes are wired and shared', () => {
  const auth = read('middleware/auth.js');
  const m = auth.match(/CALLER_ALLOWED\s*=\s*(\/.+\/)\s*;/);
  assert.ok(m, 'CALLER_ALLOWED regex present');
  const re = eval(m[1]); // eslint-disable-line no-eval
  assert.ok(re.test('/api/admin/desk/home'));
  assert.ok(re.test('/api/admin/calling/today?x=1'));
  assert.ok(!re.test('/api/admin/properties'));
  assert.ok(!re.test('/api/admin/desktop'));
  const admin = read('routes/admin.js');
  assert.match(admin, /registerStaffDeskRoutes\(router/);
  assert.match(admin, /router\.use\('\/calling', ownPersonOnly\)/);
  const { isStaffSharedKingTool } = require('../utils/staffSharedKingTools');
  assert.ok(isStaffSharedKingTool('/desk/home', 'GET'));
  assert.ok(isStaffSharedKingTool('/desk/profile', 'PUT'));
  assert.ok(!isStaffSharedKingTool('/king/staff/1/profile', 'GET'));
});

test('migration 246 is additive with a rollback script', () => {
  const up = read('db/migrations/246_staff_profiles.sql');
  assert.match(up, /CREATE TABLE IF NOT EXISTS staff_profiles/);
  assert.doesNotMatch(up, /\bDROP\b|\bDELETE\b|\bUPDATE\b/i);
  const down = read('scripts/rollback-246-staff-profiles.sql');
  assert.match(down, /DROP TABLE IF EXISTS staff_profiles/);
});

test('staff desk: sidebar pages, one caller control, no public chrome or KPI tiles', () => {
  const sd = read('assets/staff-desk.js');
  ['home', 'calls', 'perf', 'pay', 'connect', 'profile', 'settings'].forEach((p) => assert.ok(sd.includes(`['${p}'`), p));
  assert.ok(sd.includes("'staff-home-seekers'"));
  assert.match(sd, /body\.sd-on > nav/);
  assert.match(sd, /body\.sd-on #staff-kpi-grid\{display:none!important\}/);
  assert.ok(!/\['staff-booking-escalations', 'staff-kpi-grid'/.test(sd));
  assert.match(sd, /type="password"|type=\\"password\\"|'password'/);
  const html = read('index.html');
  assert.match(html, /assets\/staff-desk\.js\?v=/);
});

test('live-check: plain copy, no debug text or env-flag names for staff', () => {
  const app = read('assets/makaug-app.js');
  assert.ok(!app.includes('Dashboard matches the public listing API'));
  assert.ok(!/Public: <code|\/api\/properties\?status=approved&limit=1/.test(app.slice(app.indexOf('function renderAdminLiveParitySummary'), app.indexOf('function renderAdminFeaturedRows'))));
  assert.match(app, /STAFF_ACTIVITY_NOISE = new Set\(\["staff_dashboard_opened"/);
  assert.match(app, /!live\.length && !backfill\.length/);
  const staff = read('routes/staff.js');
  const cadence = staff.slice(staff.indexOf('high_frequency_cadence'), staff.indexOf('lookback_days: 30'));
  assert.ok(!/HARVEST_AUTOMATION_ENABLED|TIKTOK_SOURCE_SWEEP_ENABLED|SOURCE_MONITOR_SCHEDULER_ENABLED/.test(cadence));
  const html = read('index.html');
  assert.ok(!html.includes('Coverage manifest has not been loaded'));
});

test('live-check: caller select is read on change and before Start; chip says "to call"', () => {
  const cs = read('assets/calling-screen.js');
  assert.match(cs, /var syncPerson = function \(\) \{ if \(sel\) \{ pick\.person = sel\.value;/);
  assert.match(cs, /sel\.onchange = syncPerson; sel\.oninput = syncPerson; setTimeout\(syncPerson, 0\)/);
  assert.match(cs, /to call/);
});

test('test stay ST-000001 is hidden from staff short-stay counts without deleting it', () => {
  const st = read('assets/short-term-admin.js');
  const m = st.match(/function isTestStay\(l\) \{[\s\S]*?\n  \}/);
  assert.ok(m);
  const isTestStay = new Function(`${m[0]}; return isTestStay;`)();
  assert.equal(isTestStay({ reference: 'ST-000001' }), true);
  assert.equal(isTestStay({ title: 'TEST LISTING DO NOT APPROVE - end to end check' }), true);
  assert.equal(isTestStay({ reference: 'ST-000002', title: 'Kololo flat' }), false);
  assert.doesNotMatch(st, /DELETE[^\n]*ST-000001/);
});

test('a calling-only login is never signed out by staff-panel 403s', () => {
  const app = read('assets/makaug-app.js');
  assert.match(app, /function staffLoginIsCallerOnly\(error\)/);
  assert.match(app, /if \(staffLoginIsCallerOnly\(\)\) return;\n  if \(!staffDashboardHasLiveData\) setStaffDashboardLoadingState\(\);/);
  const i = app.indexOf('if (error?.status === 403 && staffLoginIsCallerOnly(error))');
  assert.ok(i > 0 && i < app.indexOf('if (authSessionFailure) {', i), 'caller 403 handled before any sign-out path');
  assert.match(read('middleware/auth.js'), /CALLER_ONLY_ERROR = 'Your login is for the calling screen only\.'/);
});
