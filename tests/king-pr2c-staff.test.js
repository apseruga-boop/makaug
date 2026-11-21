'use strict';
// King PR 2c (Arthur, 21 Nov 2026): Staff, pay & targets: add/remove staff, monthly salary history, daily targets.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ks = require('../services/kingStaff');
const { registerKingDeskRoutes } = require('../routes/kingDesk');
const { isStaffSharedKingTool } = require('../utils/staffSharedKingTools');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('phone numbers: local, 256 and international forms; junk refused', () => {
  assert.equal(ks.normalizePhone('0700 000 111'), '+256700000111');
  assert.equal(ks.normalizePhone('256700000111'), '+256700000111');
  assert.equal(ks.normalizePhone('700000111'), '+256700000111');
  assert.equal(ks.normalizePhone('+44 7000 000000'), '+447000000000');
  assert.equal(ks.normalizePhone('12345'), null);
  assert.equal(ks.normalizePhone(''), null);
});

test('salary: amounts are whole UGX; the month carries the last salary set', () => {
  assert.equal(ks.ugxAmount('500,000'), 500000);
  assert.equal(ks.ugxAmount('UGX 450000'), 450000);
  assert.throws(() => ks.ugxAmount('-1'), /whole number/);
  assert.throws(() => ks.ugxAmount('abc'), /whole number/);
  const h = [
    { month: '2026-09-01', salary_ugx: 400000, set_at: '2026-09-01T08:00:00Z', set_by: 'King' },
    { month: '2026-11-01', salary_ugx: 500000, set_at: '2026-11-02T08:00:00Z', set_by: 'King' },
    { month: '2026-11-01', salary_ugx: 550000, set_at: '2026-11-03T08:00:00Z', set_by: 'King' }
  ];
  assert.deepEqual([ks.salaryFor(h, '2026-11-01').ugx, ks.salaryFor(h, '2026-11-01').carried], [550000, false]);
  assert.deepEqual([ks.salaryFor(h, '2026-10-01').ugx, ks.salaryFor(h, '2026-10-01').carried], [400000, true]);
  assert.equal(ks.salaryFor(h, '2026-08-01').ugx, null);
  assert.equal(ks.monthOf('2026-11-21'), '2026-11-01');
});

function routes() {
  const h = {}; const router = { get: (p, f) => { h[`GET ${p}`] = f; }, put: (p, f) => { h[`PUT ${p}`] = f; }, post: (p, f) => { h[`POST ${p}`] = f; } };
  registerKingDeskRoutes(router, {}); return h;
}
function call(fn, req) {
  return new Promise((resolve, reject) => {
    const res = { code: 200, set() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    fn({ get: () => 'makaug.com', ...req }, res, reject);
  });
}

test('every staff route is King-only (moderators get 403, nothing shared with staff logins)', async () => {
  const h = routes();
  const list = ['GET /king/staff', 'POST /king/staff', 'POST /king/staff/:id/remove', 'POST /king/staff/:id/reactivate', 'PUT /king/staff/salary', 'PUT /king/staff/targets', 'POST /king/staff/targets/keep'];
  for (const k of list) {
    assert.ok(h[k], k);
    const [method, p] = k.split(' ');
    assert.equal(isStaffSharedKingTool(p.replace(':id', 'x'), method), false, k);
    const r = await call(h[k], { adminAuth: { type: 'moderator' }, params: { id: 'x' }, body: {} });
    assert.equal(r.code, 403, k);
  }
});

test('add and remove refuse bad input before touching the database', async () => {
  const h = routes(); const king = { type: 'bearer' };
  assert.equal((await call(h['POST /king/staff'], { adminAuth: king, body: { first_name: '', phone: '0700000111' } })).code, 400);
  assert.equal((await call(h['POST /king/staff'], { adminAuth: king, body: { first_name: 'Grace', phone: '12' } })).code, 400);
  assert.equal((await call(h['POST /king/staff'], { adminAuth: king, body: { first_name: 'Grace', phone: '0700000111', calls_per_day: 5000 } })).code, 400);
  assert.equal((await call(h['POST /king/staff'], { adminAuth: king, body: { first_name: 'Grace', phone: '0700000111', salary_ugx: 'lots' } })).code, 400);
  assert.equal((await call(h['POST /king/staff/:id/remove'], { adminAuth: king, params: { id: "1' or 1=1" }, body: {} })).code, 400);
  assert.equal((await call(h['PUT /king/staff/targets'], { adminAuth: king, body: { targets: [] } })).code, 400);
});

test('migration 245 only adds tables and has a rollback', () => {
  const m = read('db/migrations/245_staff_pay_history.sql').replace(/--.*$/gm, '');
  assert.match(m, /CREATE TABLE IF NOT EXISTS staff_salaries/);
  assert.match(m, /CREATE TABLE IF NOT EXISTS staff_changes/);
  assert.doesNotMatch(m, /\b(UPDATE|DELETE|DROP)\b|ALTER TABLE/i);
  const r = read('scripts/rollback-245-staff-pay-history.sql');
  assert.match(r, /DROP TABLE IF EXISTS staff_salaries/);
  assert.match(r, /DELETE FROM schema_migrations WHERE filename = '245_staff_pay_history.sql'/);
});

test('remove keeps history: login off (suspended), reason kept, nothing deleted; removed people leave the desk', () => {
  const s = read('services/kingStaff.js');
  const rm = s.slice(s.indexOf('async function removeStaff'), s.indexOf('async function reactivateStaff'));
  assert.match(rm, /status = 'suspended'/);
  assert.match(rm, /removed_reason/);
  assert.doesNotMatch(rm, /DELETE FROM/);
  assert.match(rm, /UPDATE staff_setup_links SET revoked_at/);
  assert.match(read('services/callingScreen.js'), /status <> 'active' AND profile_data \? 'removed_at'"\)\) people\.delete/);
  assert.match(read('middleware/auth.js'), /user\.status !== 'active'\) return null/);
});

test('sidebar: Staff, pay & targets is the new page; the old staff tab stays reachable', () => {
  const desk = read('assets/king-desk.js');
  assert.match(desk, /\['k-staff', '🧾', 'Staff, pay & targets'\]/);
  assert.match(desk, /\['staff', '🗂️', 'Staff accounts \(advanced\)'\]/);
  assert.match(desk, /data-kd-open="k-staff" data-kd-chip="targets"/);
  assert.match(read('index.html'), /\/assets\/king-staff\.js\?v=/);
});
