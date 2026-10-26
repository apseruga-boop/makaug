'use strict';

// People list: delete (suppression), restore, permissions, quick filters and
// the "original query" ranking. No database needed; a gated block at the end
// runs the real migration 189 trigger when PEOPLE_PG_TEST_URL is set.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const router = require('../routes/people');
const people = require('../services/peopleService');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

function postHandler(routePath) {
  const layer = router.stack.find((entry) => entry.route?.path === routePath && entry.route.methods.post);
  assert.ok(layer, `missing POST ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

// A fake db: answers by matching SQL; records every statement in order.
function fakeDb(answers = []) {
  const log = [];
  const answer = (sql, params) => {
    log.push({ sql, params });
    for (const [re, rows] of answers) {
      if (re.test(sql)) return typeof rows === 'function' ? rows(sql, params) : { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  };
  const client = { query: async (sql, params) => answer(sql, params), released: 0, release() { this.released += 1; } };
  return { log, client, query: async (sql, params) => answer(sql, params), getClient: async () => client };
}

test('delete and restore refuse moderators and admins before touching the database', async () => {
  for (const routePath of ['/delete', '/restore']) {
    const handler = postHandler(routePath);
    for (const role of ['moderator', 'admin', undefined]) {
      const res = fakeRes();
      let nextCalled = false;
      await handler({ userAuth: role ? { id: ACTOR, role } : undefined, body: { ids: [ID1], confirm: true } }, res, () => { nextCalled = true; });
      assert.equal(res.statusCode, 403, `${routePath} ${role}`);
      assert.equal(nextCalled, false);
    }
  }
});

test('delete needs ids, a sane batch size and an explicit confirm', async () => {
  const handler = postHandler('/delete');
  const sa = { id: ACTOR, role: 'super_admin' };
  const cases = [
    { body: {}, why: 'no ids' },
    { body: { ids: [], confirm: true }, why: 'empty ids' },
    { body: { ids: [ID1] }, why: 'no confirm' },
    { body: { ids: [ID1], confirm: 'true' }, why: 'confirm must be boolean true' },
    { body: { ids: Array.from({ length: people.DELETE_MAX + 1 }, () => ID1), confirm: true }, why: 'too many' }
  ];
  for (const c of cases) {
    const res = fakeRes();
    await postHandler('/delete')({ userAuth: sa, body: c.body }, res, (e) => { throw e || new Error('next'); });
    assert.equal(res.statusCode, 400, c.why);
  }
  assert.equal(typeof handler, 'function');
});

test('deletePeople writes a suppression and deletes the person under the reconcile lock', async () => {
  const db = fakeDb([
    [/WITH target AS/, [{ deleted: 1, suppressed: 1 }]],
    [/FROM people WHERE id = ANY/, [{ id: ID1, phone_e164: '+256700000001', user_id: null }]]
  ]);
  const out = await people.deletePeople(db, [ID1, ID1, 'not-a-uuid', "x'; DROP TABLE people"], { actorId: ACTOR });
  assert.deepEqual(out, { requested: 1, deleted: 1, suppressed: 1 });
  const sqls = db.log.map((q) => q.sql);
  const lock = sqls.findIndex((sql) => /pg_advisory_xact_lock\(hashtext\('makaug_people_reconcile'\)\)/.test(sql));
  const write = sqls.findIndex((sql) => /WITH target AS/.test(sql));
  assert.ok(sqls.indexOf('BEGIN') > -1 && sqls.indexOf('BEGIN') < lock && lock < write, 'BEGIN, lock, then write');
  assert.ok(sqls.indexOf('COMMIT') > write);
  assert.equal(db.client.released, 1);
  const stmt = db.log[write];
  assert.match(stmt.sql, /INSERT INTO people_suppressions/);
  assert.match(stmt.sql, /DELETE FROM people p USING target/);
  assert.match(stmt.sql, /ON CONFLICT \(person_key\) WHERE restored_at IS NULL DO NOTHING/);
  assert.deepEqual(stmt.params[0], [ID1]);
  assert.equal(stmt.params[3], ACTOR);
  // Never touches source tables.
  for (const sql of sqls) {
    assert.doesNotMatch(sql, /(DELETE FROM|UPDATE|INSERT INTO)\s+(whatsapp_|users|leads|saved_searches|property_seeker)/i);
  }
});

test('deletePeople rolls back and releases the client when the write fails', async () => {
  const db = fakeDb([
    [/WITH target AS/, () => { throw new Error('boom'); }],
    [/FROM people WHERE id = ANY/, []]
  ]);
  await assert.rejects(people.deletePeople(db, [ID2], { actorId: ACTOR }), /boom/);
  assert.ok(db.log.some((q) => q.sql === 'ROLLBACK'));
  assert.equal(db.log.some((q) => q.sql === 'COMMIT'), false);
  assert.equal(db.client.released, 1);
});

test('deletePeople with no valid ids does nothing', async () => {
  const db = fakeDb();
  assert.deepEqual(await people.deletePeople(db, ['nope', null]), { requested: 0, deleted: 0, suppressed: 0 });
  assert.equal(db.log.length, 0);
});

test('restorePeople lifts the suppression then rebuilds from the untouched source rows', async () => {
  const db = fakeDb([
    [/UPDATE people_suppressions SET restored_at/, (sql, params) => ({ rows: params[0].map((id) => ({ id })), rowCount: params[0].length })],
    [/SELECT people_reconcile\(/, [{ stats: { written: { people_inserted: 1 } } }]]
  ]);
  const out = await people.restorePeople(db, ['7', 7, 'x', '-1'], { actorId: ACTOR });
  assert.equal(out.requested, 1);
  assert.equal(out.restored, 1);
  const sqls = db.log.map((q) => q.sql);
  const update = sqls.findIndex((sql) => /UPDATE people_suppressions/.test(sql));
  assert.ok(sqls.findIndex((sql) => /pg_advisory_xact_lock/.test(sql)) < update);
  assert.ok(sqls.findIndex((sql) => /SELECT people_reconcile\(/.test(sql)) > update, 'reconcile runs after restore');
  assert.match(sqls[update], /restored_at IS NULL/);
});

test('migration 189 suppresses on insert only and ships a rollback with a backup manifest', () => {
  const up = read('db/migrations/189_people_suppressions.sql');
  assert.match(up, /CREATE TABLE IF NOT EXISTS people_suppressions/);
  assert.match(up, /uq_people_suppressions_active_key[\s\S]*WHERE restored_at IS NULL/);
  assert.match(up, /BEFORE INSERT ON people/);
  assert.match(up, /data_change_189_backup/);
  assert.doesNotMatch(up, /(DELETE FROM|UPDATE|ALTER TABLE)\s+(whatsapp_|users|leads)/i);
  const down = read('scripts/rollback-189-people-suppressions.sql');
  assert.match(down, /DROP TRIGGER IF EXISTS trg_people_skip_suppressed/);
  assert.match(down, /people_suppressions_rolled_back_189/);
  assert.doesNotMatch(down, /DROP TABLE/i, 'rollback keeps the suppression history');
});

test('quick filters: only known values, and the SQL is parameter-free', () => {
  assert.deepEqual(people.QUICK_FILTERS, ['unnamed', 'test']);
  assert.equal(people.parsePeopleFilters({ quick: 'unnamed' }).quick, 'unnamed');
  assert.ok(!people.parsePeopleFilters({ quick: "x' OR 1=1" }).quick);
  const w = people.buildPeopleWhere(people.parsePeopleFilters({ quick: 'test' }));
  assert.ok(w.sql.includes(people.QUICK_SQL.test));
  assert.equal(w.params.length, 0);
  const u = people.buildPeopleWhere(people.parsePeopleFilters({ quick: 'unnamed' }));
  assert.match(u.sql, /display_name/);
});

test('original query ranks a listing enquiry above a WhatsApp greeting', async () => {
  const P = { id: ID1, phone_e164: '+256700000001', user_id: null };
  const db = fakeDb([
    [/whatsapp_messages/, [{
      wa_phone: '256700000001', first_at: '2026-10-01T10:00:00Z', first_body: 'Hi', first_type: 'text',
      real_at: null, real_body: null, intent_at: null, detected_intent: null
    }]],
    [/FROM people_links/, (sql) => (/leads/.test(sql) ? { rows: [{
      person_id: ID1, id: 'lead-1', lead_type: 'enquiry', source: 'website', message: 'Is this flat still available?',
      created_at: '2026-10-02T09:00:00Z', listing_id: 'abc', listing_title: '2 bed flat, Ntinda'
    }], rowCount: 1 } : { rows: [], rowCount: 0 })]
  ]);
  const map = await people.originalQueriesFor(db, [P]);
  const items = map.get(ID1) || [];
  assert.ok(items.length >= 1, 'has items');
  assert.equal(items[0].kind, 'listing_enquiry', JSON.stringify(items.map((i) => i.kind)));
  assert.equal(items[0].listing.url, '/property/abc');
  const wa = items.find((i) => i.kind === 'whatsapp_first');
  if (wa) assert.match(wa.label, /greeting only/i);
  for (const i of items) assert.ok(i.at && i.source, 'each item has a date and a source');
});

test('original query for a greeting-only WhatsApp contact says nothing was asked yet', async () => {
  const P = { id: ID2, phone_e164: '+256700000002', user_id: null };
  const db = fakeDb([
    [/whatsapp_messages/, [{ wa_phone: '256700000002', first_at: '2026-10-25T16:33:00Z', first_body: 'Hi', first_type: 'text', real_at: null, real_body: null, intent_at: null, detected_intent: null }]]
  ]);
  const items = (await people.originalQueriesFor(db, [P])).get(ID2) || [];
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'whatsapp_first');
  assert.match(items[0].label, /greeting only, nothing asked yet/);
  assert.equal(items[0].source, 'whatsapp');
});

test('the People UI shows the original query, delete confirm and the Deleted view', () => {
  const app = read('assets/makaug-app.js');
  for (const name of ['staffPeopleOriginalQueryHtml', 'staffPeopleConfirmDelete', 'staffPeopleLoadDeleted', 'staffPeopleRestore', 'staffPeopleSetQuick']) {
    assert.match(app, new RegExp(`function ${name}\\(`), name);
  }
  assert.match(app, /\/api\/people\/delete", \{ method: "POST", body: \{ ids, confirm: true \} \}/);
  assert.match(read('assets/build/makaug-admin.min.js'), /staffPeopleConfirmDelete/);
});

// Real-database check of the trigger. Opt-in: PEOPLE_PG_TEST_URL=postgres://...
// It runs inside one transaction and rolls back, so nothing is kept.
test('trigger keeps a suppressed person out of the reconcile (real Postgres)', { skip: !process.env.PEOPLE_PG_TEST_URL }, async () => {
  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.PEOPLE_PG_TEST_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.country_code','UG',true)");
    await client.query(read('db/migrations/189_people_suppressions.sql'));
    const victim = (await client.query('SELECT id, person_key FROM people ORDER BY first_seen_at LIMIT 1')).rows[0];
    assert.ok(victim, 'needs at least one person');
    const before = (await client.query('SELECT count(*)::int n FROM people')).rows[0].n;
    await client.query(`INSERT INTO people_suppressions (person_key, key_kind, phone_e164, email)
      SELECT person_key, key_kind, phone_e164, email FROM people WHERE id = $1`, [victim.id]);
    await client.query('DELETE FROM people WHERE id = $1', [victim.id]);
    await client.query("SELECT people_reconcile('test_189', '256')");
    const kept = (await client.query('SELECT count(*)::int n FROM people WHERE person_key = $1', [victim.person_key])).rows[0].n;
    assert.equal(kept, 0, 'suppressed person stays out after reconcile');
    await client.query('UPDATE people_suppressions SET restored_at = NOW()');
    await client.query("SELECT people_reconcile('test_189', '256')");
    const after = (await client.query('SELECT count(*)::int n FROM people')).rows[0].n;
    assert.equal(after, before, 'restore brings them back');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    await client.end();
  }
});
