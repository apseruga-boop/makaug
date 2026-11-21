'use strict';
// Rejections & lessons (ops 3c part 2): rejection counts, the learnings store, King approval, team tips on the calling screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../config/database');
const tl = require('../services/teamLearnings');
const scripts = require('../services/callingScripts');
const { registerStaffDeskRoutes } = require('../routes/staffDesk');
const { registerKingDeskRoutes } = require('../routes/kingDesk');
const { isStaffSharedKingTool } = require('../utils/staffSharedKingTools');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const AMINA = '11111111-2222-4333-8444-5555555555aa';

function withDb(handler, fn) {
  const orig = db.query; const calls = [];
  db.query = async (sql, params) => { calls.push({ sql, params }); const out = handler(sql, params) || []; return Array.isArray(out) ? { rows: out, rowCount: out.length } : out; };
  return Promise.resolve(fn(calls)).finally(() => { db.query = orig; });
}
function fakeRouter() { const r = { routes: {} }; ['get', 'post', 'put', 'patch', 'delete'].forEach((m) => { r[m] = (p, ...h) => { r.routes[`${m.toUpperCase()} ${p}`] = h[h.length - 1]; }; }); return r; }
function call(handler, req) { return new Promise((resolve) => { const res = { code: 200, set() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } }; handler(req, res, (e) => resolve({ code: 500, body: String(e) })); }); }

test('call rejections are grouped by the real wrap-up wording (production examples)', () => {
  const c = (t) => (tl.classify(tl.CALL_REASONS, t) || {}).key;
  assert.equal(c('Not interested (Not interested → Just not interested)'), 'not_interested');
  assert.equal(c('Not interested: uses another site (Not interested → Uses another site)'), 'other_site');
  assert.equal(c('Not interested (I am an agent → I already use Jiji / Facebook)'), 'other_site');
  assert.equal(c('Wants to stop: no clients calling (I want to stop → No clients)'), 'no_clients');
  assert.equal(c('Not an agent (Not interested → Not an agent)'), 'not_agent');
  assert.equal(c('Not interested (Who is this? Where did you get my number? → Not interested)'), 'number');
  assert.equal(c('Other: Free trial first'), 'free_trial');
  assert.equal(c('Other: He wants free trials'), 'free_trial');
  assert.equal(c('Other: Free trail first'), 'free_trial');
  assert.equal(c('Already an agent'), 'already_agent');
  assert.equal(c('Do not contact (asked us to stop)'), 'stop_calling');
  assert.equal(c('Not intrested at the moment'), 'not_interested');
  assert.equal(c('Busy'), undefined);
});

test('listing rejections are grouped too', () => {
  const l = (t) => (tl.classify(tl.LISTING_REASONS, t) || {}).key;
  assert.equal(l('No specific area / location too vague'), 'no_area');
  assert.equal(l('No actaul prices'), 'no_price');
  assert.equal(l('No contacts and prices'), 'no_contact');
  assert.equal(l('Not a property listing (weighing scales advert)'), 'not_property');
  assert.equal(l('Duplicate of MK-20261016-3307F2.'), 'duplicate');
  assert.equal(l('NO PHOTOS'), 'photos');
  assert.equal(l('Rejected - other moderation issue. Please review the notes.'), 'other_listing');
});

test('rejection counts carry no names or numbers, and show what the script already says', async () => {
  await withDb((sql) => (/FROM call_attempts/.test(sql) ? [{ why: 'Other: Free trial first' }, { why: 'Other: Free trial first' }, { why: 'Not interested (Not interested → Just not interested)' }]
    : /FROM properties/.test(sql) ? [{ why: 'No prices' }] : []), async (calls) => {
    const r = await tl.rejections();
    assert.deepEqual(r.calls.reasons.map((x) => [x.key, x.count]), [['free_trial', 2], ['not_interested', 1]]);
    assert.equal(r.calls.reasons[0].script.if_they_say, 'Can I try it free first?');
    assert.equal(r.listings.total, 1);
    const sql = calls.map((c) => c.sql).join('\n');
    assert.doesNotMatch(sql, /SELECT[^;]*\b(phone|full_name)\b[^;]*FROM call_attempts/);
    assert.match(sql, /sandbox/, 'practice calls are left out');
    assert.doesNotMatch(JSON.stringify(r), /\d{9}/);
  });
});

test('a suggestion needs a theme and a real lesson; a script line needs both halves and a call type', async () => {
  await withDb(() => ({ rows: [{ id: 5, status: 'suggested' }], rowCount: 1 }), async (calls) => {
    const me = { userId: AMINA, name: 'Amina' };
    await assert.rejects(tl.suggest(me, { theme: 'nope', lesson: 'A long enough lesson' }), /Pick what/);
    await assert.rejects(tl.suggest(me, { theme: 'price', lesson: 'short' }), /sentence/);
    await assert.rejects(tl.suggest(me, { theme: 'price', lesson: 'A long enough lesson', if_they_say: 'Too dear' }), /which calls/);
    await assert.rejects(tl.suggest(me, { theme: 'price', lesson: 'A long enough lesson', task_key: 'new_agents', if_they_say: 'Too dear' }), /both/);
    await assert.rejects(tl.suggest({}, { theme: 'price', lesson: 'A long enough lesson' }), /Sign in/);
    const out = await tl.suggest(me, { theme: 'free_trial', lesson: 'Saying they can stop any month works.', task_key: 'new_agents', if_they_say: 'I want a free trial', we_say: 'No trial, but you can stop any month.' });
    assert.equal(out.status, 'suggested');
    const ins = calls.find((c) => /INSERT INTO team_learnings/.test(c.sql));
    assert.equal(ins.params[5], 'suggested', 'staff suggestions wait for King');
    assert.equal(ins.params[6], AMINA);
    await tl.suggest({ userId: 'k', name: 'Arthur', king: true }, { theme: 'price', lesson: 'Lead with what one client is worth.' });
    assert.equal(calls.filter((c) => /INSERT INTO team_learnings/.test(c.sql))[1].params[5], 'approved', "King's own lessons are approved straight away");
  });
});

test('King approves (with edits), declines with a note, retires; decided ones cannot be decided again', async () => {
  let cur = { id: 9, theme: 'price', lesson: 'Old words here ok', task_key: 'new_agents', if_they_say: 'Too dear', we_say: 'Old answer', status: 'suggested' };
  await withDb((sql) => (/^SELECT id, theme/.test(sql) ? [cur] : { rows: [], rowCount: 1 }), async (calls) => {
    await assert.rejects(tl.decide(9, { action: 'decline' }), /Say why/);
    await tl.decide(9, { action: 'approve', we_say: 'One tenant pays it back many times.' }, { actor: 'Arthur' });
    const up = calls.find((c) => /SET status = 'approved'/.test(c.sql));
    assert.deepEqual(up.params.slice(0, 7), [9, 'price', 'Old words here ok', 'new_agents', 'Too dear', 'One tenant pays it back many times.', 'Arthur']);
    assert.match(up.sql, /WHERE id = \$1 AND status = 'suggested'/);
    cur = { ...cur, status: 'approved' };
    await assert.rejects(tl.decide(9, { action: 'approve' }), /already been decided/);
    await assert.rejects(tl.decide(9, { action: 'decline', note: 'nope' }), /already been decided/);
    const r = await tl.decide(9, { action: 'retire' });
    assert.equal(r.status, 'retired');
    cur = { ...cur, status: 'declined' };
    await assert.rejects(tl.decide(9, { action: 'retire' }), /Only an approved/);
    await assert.rejects(tl.decide(9, { action: 'delete' }), /Approve, decline or retire/);
  });
});

test('only approved script lines reach the calling screen, after the written answers, marked as team tips', async () => {
  await withDb((sql) => (/status = 'approved' AND task_key IS NOT NULL/.test(sql) ? [{ task_key: 'new_agents', if_they_say: 'I want a free trial', we_say: 'You can stop any month.' }] : []), async (calls) => {
    const tips = await tl.approvedTips();
    assert.match(calls[0].sql, /WHERE status = 'approved'/);
    const merged = tl.withTips(scripts.OBJECTIONS, tips);
    const na = merged.new_agents;
    assert.equal(na.length, scripts.OBJECTIONS.new_agents.length + 1);
    assert.deepEqual(na[na.length - 1], ['I want a free trial', 'You can stop any month.', 'team']);
    assert.equal(scripts.OBJECTIONS.new_agents.length, na.length - 1, 'the written script is not changed');
  });
  const cs = read('services/callingScreen.js');
  assert.match(cs, /objections: require\('\.\/teamLearnings'\)\.withTips\(scripts\.OBJECTIONS, tips\)/);
  assert.match(cs, /approvedTips\(\)\.catch\(\(\) => \(\{\}\)\)/, 'a failing tips query never breaks the calling screen');
  assert.match(read('assets/calling-screen.js'), /o\[2\] === 'team' \? '<span class="mkc-teamtip">💡 Team tip, approved by King<\/span>'/);
});

test('routes and allowlist: staff read and suggest only; approving is King-only', async () => {
  const s = fakeRouter(); registerStaffDeskRoutes(s);
  assert.ok(s.routes['GET /desk/lessons'] && s.routes['POST /desk/lessons']);
  const k = fakeRouter(); registerKingDeskRoutes(k, {});
  const staff = { adminAuth: { type: 'moderator' }, userAuth: { id: AMINA, first_name: 'Amina', profile_data: {} }, query: {}, params: { id: '1' }, body: { action: 'approve' }, get: () => 'makaug.com' };
  for (const kp of ['GET /king/lessons', 'POST /king/lessons', 'POST /king/lessons/:id/decide']) { assert.ok(k.routes[kp], kp); assert.equal((await call(k.routes[kp], staff)).code, 403, kp); }
  // A staff suggestion is always theirs and always waits for King, whatever they send.
  await withDb(() => ({ rows: [{ id: 1, status: 'suggested' }], rowCount: 1 }), async (calls) => {
    const out = await call(s.routes['POST /desk/lessons'], { ...staff, body: { theme: 'price', lesson: 'A long enough lesson', status: 'approved', king: true, proposed_by_user_id: 'x' } });
    assert.equal(out.code, 201);
    const ins = calls.find((c) => /INSERT INTO team_learnings/.test(c.sql));
    assert.equal(ins.params[5], 'suggested'); assert.equal(ins.params[6], AMINA);
  });
  assert.equal(isStaffSharedKingTool('/desk/lessons', 'GET'), true);
  assert.equal(isStaffSharedKingTool('/desk/lessons', 'POST'), true);
  for (const [p, m] of [['/king/lessons', 'GET'], ['/king/lessons', 'POST'], ['/king/lessons/1/decide', 'POST']]) assert.equal(isStaffSharedKingTool(p, m), false, p);
});

test('migration 250: new table only, a half script line is impossible; rollback drops it', () => {
  const sql = read('db/migrations/250_team_learnings.sql');
  assert.doesNotMatch(sql, /^\s*(ALTER TABLE|DROP |DELETE FROM|UPDATE )/im);
  assert.match(sql, /CHECK \(\(if_they_say = '' AND we_say = ''\) OR \(task_key IS NOT NULL AND if_they_say <> '' AND we_say <> ''\)\)/);
  assert.match(sql, /status IN \('suggested', 'approved', 'declined', 'retired'\)/);
  const rb = read('scripts/rollback-250-team-learnings.sql');
  assert.match(rb, /DROP TABLE IF EXISTS team_learnings;/);
  assert.match(rb, /DELETE FROM schema_migrations WHERE filename = '250_team_learnings\.sql'/);
});

test('pages: staff "Rejections & lessons" for every login; King Team hub has a Rejections & lessons chip with a badge', () => {
  assert.match(read('assets/staff-desk.js'), /\['lessons', '💡', 'Rejections & lessons'\]/);
  const kd = read('assets/king-desk.js');
  assert.match(kd, /'v:hub': \[\['Messages, rules & videos', 'k-hub', null\], \['Rejections & lessons', 'k-lessons', null\]\]/);
  assert.match(kd, /\['v:hub', '📣', 'Team hub', 'lessons_waiting'\]/);
  assert.match(read('services/kingDesk.js'), /lessons_waiting: await require\('\.\/teamLearnings'\)\.waitingCount\(\)\.catch\(\(\) => 0\)/);
  const idx = read('index.html');
  assert.match(idx, /id="king-lessons" data-admin-tab-panel="k-lessons"/);
  assert.match(idx, /team-lessons\.js\?v=20261121-tl1/);
  const js = read('assets/team-lessons.js');
  assert.doesNotMatch(js, /wa\.me|sms:|tel:/i);
  assert.match(js, /Note to them \(needed to decline\)/);
});
