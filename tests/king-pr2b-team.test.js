'use strict';
// King PR 2b (Arthur, 21 Nov 2026): Team performance per-staff page, day compare, call detail with lessons.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const kc = require('../services/kingCalls');
const { registerKingDeskRoutes } = require('../routes/kingDesk');
const { isStaffSharedKingTool } = require('../utils/staffSharedKingTools');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('lessons: themes and key points come from what was said, the caller pitch is skipped', () => {
  const l = kc.extractLessons({ text: 'Hello this is Ronald from MakaUg. It is too expensive for me right now. Is this a scam or real? Call me next week please.', outcome: 'interested' });
  assert.deepEqual(l.themes, ['price', 'trust', 'timing']);
  assert.deepEqual(l.key_points, ['It is too expensive for me right now.', 'Is this a scam or real?', 'Call me next week please.']);
  assert.ok(l.suggestions.some((s) => /Price came up/.test(s)));
  assert.ok(l.suggestions.some((s) => /no follow-up was set/.test(s)));
  assert.ok(l.suggestions.some((s) => /say Hi on WhatsApp/.test(s)));
});

test('lessons: a follow-up silences the "no follow-up" hint; no notes asks for a mic check', () => {
  const l = kc.extractLessons({ text: 'Call me tomorrow, I am busy.', nextStep: 'Call back tomorrow 10am' });
  assert.ok(!l.suggestions.some((s) => /no follow-up/.test(s)));
  const none = kc.extractLessons({ flags: ['no_transcript'] });
  assert.deepEqual(none.themes, []); assert.deepEqual(none.key_points, []);
  assert.match(none.suggestions[0], /check the mic/);
});

test('lessons never repeat a phone number in full', () => {
  const l = kc.extractLessons({ text: 'Send the code to 0700 000 123 please, it is too expensive otherwise.' });
  assert.equal(l.key_points.length, 1);
  assert.doesNotMatch(l.key_points[0], /\d{6,}|\d{3} \d{3} \d{3}/);
  assert.match(l.key_points[0], /•••123/);
});

test('call window: an unfinished call looks 15 minutes past the tap', () => {
  const ev = [{ kind: 'link_drop', at: '2026-11-21T07:40:00Z' }, { kind: 'link_drop', at: '2026-11-21T08:00:00Z' }];
  assert.equal(kc.windowEvents(ev, { tapped_at: '2026-11-21T07:31:00Z' }).length, 1);
  assert.equal(kc.windowEvents(ev, { tapped_at: '2026-11-21T07:31:00Z', wrapped_at: '2026-11-21T07:35:00Z' }).length, 0);
});

function routes() {
  const h = {}; const router = { get: (p, f) => { h[`GET ${p}`] = f; }, put: (p, f) => { h[`PUT ${p}`] = f; } };
  registerKingDeskRoutes(router); return h;
}
function call(fn, req) {
  return new Promise((resolve, reject) => {
    const res = { code: 200, set() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    fn(req, res, reject);
  });
}

test('call detail and lesson routes are King-only and reject bad ids before touching the database', async () => {
  const h = routes();
  assert.ok(h['GET /king/calls/:id'] && h['PUT /king/calls/:id/lesson']);
  assert.equal(isStaffSharedKingTool('/king/calls/x', 'GET'), false);
  assert.equal(isStaffSharedKingTool('/king/calls/x/lesson', 'PUT'), false);
  const mod = await call(h['GET /king/calls/:id'], { adminAuth: { type: 'moderator' }, params: { id: '11111111-2222-4333-8444-555555555501' } });
  assert.equal(mod.code, 403);
  const modPut = await call(h['PUT /king/calls/:id/lesson'], { adminAuth: { type: 'moderator' }, params: { id: '11111111-2222-4333-8444-555555555501' }, body: { note: 'x' } });
  assert.equal(modPut.code, 403);
  const bad = await call(h['GET /king/calls/:id'], { adminAuth: { type: 'bearer' }, params: { id: "1' OR 1=1" } });
  assert.equal(bad.code, 400);
});

test('migration 244 only adds the lessons table and has a rollback', () => {
  const m = read('db/migrations/244_call_lessons.sql').replace(/--.*$/gm, '');
  assert.match(m, /CREATE TABLE IF NOT EXISTS call_lessons/);
  assert.doesNotMatch(m, /\b(UPDATE|DELETE|DROP)\b|ALTER TABLE (?!call_lessons)/i);
  const r = read('scripts/rollback-244-call-lessons.sql');
  assert.match(r, /DROP TABLE IF EXISTS call_lessons/);
  assert.match(r, /DELETE FROM schema_migrations WHERE filename = '244_call_lessons.sql'/);
});

test('Team performance is a sidebar page; blue calls in the evidence graph open the call', () => {
  const desk = read('assets/king-desk.js');
  assert.match(desk, /\['k-team', '👥', 'Team performance'\]/);
  assert.match(desk, /\['performance', '📞', 'Calling desk & targets'\]/);
  const html = read('index.html');
  assert.match(html, /id="king-team" data-admin-tab-panel="k-team"/);
  assert.match(html, /\/assets\/king-team\.js\?v=/);
  const cs = read('assets/calling-screen.js');
  assert.match(cs, /K\.evCallList = allCalls/);
  assert.match(cs, /window\.kingTeam\.openCall\(c\.attempt_id\)/);
  assert.match(cs, /evidence: function \(host, person\)/);
  const team = read('assets/king-team.js');
  assert.match(team, /REFRESH_MS = 30000/);
  assert.match(team, /'\/king\/calls\/' \+ encodeURIComponent\(id\)/);
});

test('Kampala clock helpers line two days up minute for minute', () => {
  global.window = global.window || {}; global.document = global.document || { getElementById() { return null; }, addEventListener() {}, head: { appendChild() {} }, createElement() { return {}; } };
  delete global.window.kingTeam;
  global.window.kingDesk = { util: { currentTab: () => 'k-overview', esc: String } };
  require('../assets/king-team.js');
  const kt = global.window.kingTeam;
  assert.equal(kt._kDay(Date.parse('2026-11-21T21:30:00Z')), '2026-11-22');
  assert.equal(kt._minOfDay('2026-11-21T06:00:00Z'), 9 * 60);
  assert.deepEqual(kt._span([{ sessions: [{ started_at: '2026-11-21T06:10:00Z', ended_at: '2026-11-21T09:20:00Z' }] }, { sessions: [{ started_at: '2026-11-20T05:00:00Z', ended_at: '2026-11-20T07:00:00Z' }] }]), [8 * 60, 13 * 60]);
});

test('time on the screen counts overlapping sessions once, and a past open session ends at its last heartbeat', () => {
  const kt = global.window.kingTeam;
  const m = kt._metrics({ summary: { calls: 2 }, sessions: [
    { started_at: '2026-11-20T06:00:00Z', ended_at: '2026-11-20T09:00:00Z' },
    { started_at: '2026-11-20T08:00:00Z', ended_at: '2026-11-20T10:00:00Z' },
    { started_at: '2026-11-20T12:00:00Z', ended_at: null, last_heartbeat_at: '2026-11-20T12:30:00Z' }
  ] });
  assert.equal(m.screen_s, 4.5 * 3600);
  assert.equal(m.calls, 2);
});
