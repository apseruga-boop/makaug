'use strict';
// Team hub (ops 3c part 1): King's messages, Rules, T&Cs, Working hours, how-to video slots.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../config/database');
const hub = require('../services/teamHub');
const { registerStaffDeskRoutes } = require('../routes/staffDesk');
const { registerKingDeskRoutes } = require('../routes/kingDesk');
const { isStaffSharedKingTool } = require('../utils/staffSharedKingTools');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const AMINA = '11111111-2222-4333-8444-5555555555aa';
const RONALD = '11111111-2222-4333-8444-5555555555bb';
const PEOPLE = [{ id: AMINA, first_name: 'Amina', last_name: 'Makaug', person_key: '', scope: 'staff' }, { id: RONALD, first_name: 'Ronald', last_name: '', person_key: 'ronald', scope: 'caller' }];

function withDb(handler, fn) {
  const orig = db.query; const calls = [];
  db.query = async (sql, params) => { calls.push({ sql, params }); const out = handler(sql, params) || []; return Array.isArray(out) ? { rows: out, rowCount: out.length } : out; };
  return Promise.resolve(fn(calls)).finally(() => { db.query = orig; });
}
const staffDb = (extra) => (sql, params) => (/FROM users WHERE role = 'moderator'/.test(sql) ? PEOPLE : extra ? extra(sql, params) : []);
function fakeRouter() { const r = { routes: {} }; ['get', 'post', 'put', 'patch', 'delete'].forEach((m) => { r[m] = (p, ...h) => { r.routes[`${m.toUpperCase()} ${p}`] = h[h.length - 1]; }; }); return r; }
function call(handler, req) { return new Promise((resolve) => { const res = { code: 200, set() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } }; handler(req, res, (e) => resolve({ code: 500, body: String(e) })); }); }

test('a target never goes to the whole team; messages need words and a real team member', async () => {
  await withDb(staffDb(), async (calls) => {
    await assert.rejects(hub.send({ audience: 'team', kind: 'target', body: '40 calls a day' }), /one person/);
    await assert.rejects(hub.send({ audience: 'person', to_user_id: AMINA, body: ' ' }), /Write the message/);
    await assert.rejects(hub.send({ audience: 'person', to_user_id: '99999999-2222-4333-8444-555555555500', body: 'Hello' }), /Pick someone/);
    await assert.rejects(hub.send({ body: 'Hello' }), /whole team or one person/);
    assert.equal(calls.filter((c) => /INSERT INTO team_messages/.test(c.sql)).length, 0);
  });
});

test('a target to one person and a note to the team are saved as such', async () => {
  await withDb(staffDb((sql) => (/INSERT INTO team_messages/.test(sql) ? [{ id: 7, created_at: '2026-11-21T10:00:00Z' }] : [])), async (calls) => {
    const t = await hub.send({ audience: 'person', to_user_id: RONALD, kind: 'target', title: 'Monday', body: '40 calls, 3 paid' }, { actor: 'Arthur' });
    assert.deepEqual([t.audience, t.kind], ['person', 'target']);
    const ins = calls.find((c) => /INSERT INTO team_messages/.test(c.sql));
    assert.deepEqual(ins.params, ['person', RONALD, 'target', 'Monday', '40 calls, 3 paid', 'Arthur']);
    const n = await hub.send({ audience: 'team', to_user_id: RONALD, body: 'Team meeting 9am' });
    assert.equal(n.kind, 'note');
    const ins2 = calls.filter((c) => /INSERT INTO team_messages/.test(c.sql))[1];
    assert.equal(ins2.params[1], null, 'a team message has no single recipient');
  });
});

test('staff only see messages to the team or to themselves, and "Got it" only marks those', async () => {
  await withDb((sql) => (/INSERT INTO team_message_reads/.test(sql) ? { rows: [], rowCount: 1 } : /COUNT\(\*\)/.test(sql) ? [{ n: 0 }] : []), async (calls) => {
    await hub.staffHub(AMINA);
    const sel = calls.find((c) => /FROM team_messages m LEFT JOIN team_message_reads/.test(c.sql));
    assert.match(sel.sql, /m\.withdrawn_at IS NULL AND \(m\.audience = 'team' OR m\.to_user_id = \$1\)/);
    assert.deepEqual(sel.params, [AMINA]);
    const r = await hub.markRead(AMINA, [3, 'x', -1, 4]);
    const ins = calls.find((c) => /INSERT INTO team_message_reads/.test(c.sql));
    assert.match(ins.sql, /\(m\.audience = 'team' OR m\.to_user_id = \$1\)/);
    assert.deepEqual(ins.params, [AMINA, [3, 4]]);
    assert.equal(r.marked, 1);
  });
  await assert.rejects(hub.markRead('', [1]), /Sign in/);
});

test('King sees who has and has not read each message', async () => {
  const msgs = [
    { id: 2, audience: 'team', to_user_id: null, kind: 'note', title: '', body: 'Hi all', created_by: 'Arthur', created_at: '2026-11-21T10:00:00Z', withdrawn_at: null, read_by: [AMINA] },
    { id: 1, audience: 'person', to_user_id: RONALD, kind: 'target', title: '', body: '40 calls', created_by: 'Arthur', created_at: '2026-11-21T09:00:00Z', withdrawn_at: null, read_by: [] }
  ];
  await withDb(staffDb((sql) => (/FROM team_messages m LEFT JOIN/.test(sql) ? msgs : /FROM team_pages/.test(sql) ? [{ key: 'rules', body: 'A\nB', updated_by: 'starter' }] : [])), async () => {
    const d = await hub.kingHub();
    assert.deepEqual(d.messages.map((m) => [m.to_name, m.read, m.of, m.not_read.join(',')]), [['Whole team', 1, 2, 'Ronald'], ['Ronald', 0, 1, 'Ronald']]);
    assert.deepEqual(d.people.map((p) => p.name), ['Amina', 'Ronald']);
    assert.deepEqual(d.pages.map((p) => p.key), ['rules', 'terms', 'hours']);
    assert.equal(d.pages[0].updated_at, null, 'the starter text does not claim King wrote it');
  });
});

test('video links must be plain https links; pages and slots validate', async () => {
  assert.equal(hub.safeVideoUrl(''), '');
  assert.equal(hub.safeVideoUrl('https://youtu.be/abc'), 'https://youtu.be/abc');
  for (const bad of ['javascript:alert(1)', 'http://youtu.be/abc', 'youtube', 'data:text/html,hi', 'https://localhost/x']) assert.throws(() => hub.safeVideoUrl(bad), /https:\/\//, bad);
  await withDb(() => ({ rows: [{ id: 3 }], rowCount: 1 }), async (calls) => {
    await assert.rejects(hub.savePage('salary', 'x'), /Unknown page/);
    await hub.savePage('hours', 'Mon–Fri 08:30–17:30\r\nSat 09:00–13:00');
    assert.equal(calls[0].params[1], 'Mon–Fri 08:30–17:30\nSat 09:00–13:00');
    await assert.rejects(hub.saveVideo(3, { title: 'x' }), /title/);
    const v = await hub.saveVideo('new', { title: 'Using Missed calls', url: 'https://youtu.be/abc' });
    assert.equal(v.ready, true);
    await assert.rejects(hub.saveVideo('abc', { title: 'Good title' }), /Unknown item/);
  });
});

test('routes: staff read their own hub and say "Got it"; every King write is King-only', async () => {
  const s = fakeRouter(); registerStaffDeskRoutes(s);
  assert.ok(s.routes['GET /desk/hub'] && s.routes['POST /desk/hub/read']);
  const k = fakeRouter(); registerKingDeskRoutes(k, {});
  const kingPaths = ['GET /king/hub', 'POST /king/hub/messages', 'POST /king/hub/messages/:id/withdraw', 'PUT /king/hub/pages/:key', 'PUT /king/hub/videos/:id', 'POST /king/hub/videos/:id/remove'];
  const staff = { adminAuth: { type: 'moderator' }, userAuth: { id: AMINA, profile_data: {} }, query: {}, params: { id: '1', key: 'rules' }, body: { audience: 'team', body: 'x' }, get: () => 'makaug.com' };
  for (const kp of kingPaths) { assert.ok(k.routes[kp], kp); const out = await call(k.routes[kp], staff); assert.equal(out.code, 403, kp); }
  // A staff login always reads its own messages, whatever it sends.
  await withDb((sql) => (/COUNT/.test(sql) ? [{ n: 0 }] : []), async (calls) => {
    const out = await call(s.routes['GET /desk/hub'], { ...staff, query: { user_id: RONALD, person_key: 'ronald' } });
    assert.equal(out.code, 200);
    const sel = calls.find((c) => /FROM team_messages m LEFT JOIN team_message_reads/.test(c.sql));
    assert.deepEqual(sel.params, [AMINA]);
  });
});

test('allowlist: staff get /desk/hub and /desk/hub/read only, never /king/hub', () => {
  assert.equal(isStaffSharedKingTool('/desk/hub', 'GET'), true);
  assert.equal(isStaffSharedKingTool('/desk/hub/read', 'POST'), true);
  assert.equal(isStaffSharedKingTool('/desk/hub', 'POST'), false);
  for (const [p, m] of [['/king/hub', 'GET'], ['/king/hub/messages', 'POST'], ['/king/hub/pages/rules', 'PUT'], ['/king/hub/videos/1', 'PUT']]) assert.equal(isStaffSharedKingTool(p, m), false, p);
});

test('migration 249: new tables only, a team target is impossible, rollback drops them', () => {
  const sql = read('db/migrations/249_team_hub.sql');
  assert.doesNotMatch(sql, /^\s*(ALTER TABLE|DROP |DELETE FROM|UPDATE )/im);
  assert.match(sql, /CHECK \(kind <> 'target' OR audience = 'person'\)/);
  assert.match(sql, /CHECK \(key IN \('rules', 'terms', 'hours'\)\)/);
  assert.match(sql, /We never send WhatsApp messages or videos/);
  const rb = read('scripts/rollback-249-team-hub.sql');
  for (const t of ['team_message_reads', 'team_messages', 'team_pages', 'team_videos']) assert.match(rb, new RegExp(`DROP TABLE IF EXISTS ${t};`));
  assert.match(rb, /DELETE FROM schema_migrations WHERE filename = '249_team_hub\.sql'/);
});

test('pages: staff Team menu for everyone (callers too), unread badge, King Team hub item; nothing sends', () => {
  const sd = read('assets/staff-desk.js');
  assert.match(sd, /\['Team', \[\['msgs', '📣', 'Messages from King'\], \['rules', '📘', 'Rules, T&Cs & hours'\], \['videos', '🎬', 'How-to videos'\]\]\]/);
  assert.match(sd, /data-sd-badge="msgs"/);
  assert.match(sd, /data-sd-hub-nudge/);
  assert.match(read('assets/king-desk.js'), /\['k-hub', '📣', 'Team hub'\]/);
  assert.match(read('assets/makaug-app.js'), /"k-team", "k-hub"\]/);
  const idx = read('index.html');
  assert.match(idx, /id="king-hub" data-admin-tab-panel="k-hub"/);
  assert.match(idx, /team-hub\.js\?v=20261121-th1/);
  assert.match(idx, /king-desk\.js\?v=20261121-kd8/);
  const th = read('assets/team-hub.js');
  assert.doesNotMatch(th, /wa\.me|sms:|tel:|whatsapp\/send|\/send-sms/i);
  assert.match(th, /kind\.options\[1\]\.disabled = team/, 'Target is greyed out when Whole team is picked');
  assert.match(th, /rel="noopener noreferrer"/);
  assert.match(th, /Nothing is sent by WhatsApp, text or email/);
});
