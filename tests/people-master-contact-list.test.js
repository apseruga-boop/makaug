'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const router = require('../routes/people');
const people = require('../services/peopleService');
const { BOOT_DELAY_MS } = require('../utils/schedulerStagger');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function routeHandler(routePath) {
  const layer = router.stack.find((entry) => entry.route?.path === routePath && entry.route.methods.get);
  assert.ok(layer, `missing GET ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; }
  };
}

test('every /api/people route sits behind signed-in staff access', () => {
  assert.equal(router.stack[0]?.name, 'requireStaffAccess');
  const paths = router.stack.map((layer) => layer.route?.path).filter(Boolean);
  assert.deepEqual(paths.sort(), ['/', '/:id', '/export.csv', '/report'].sort());
  assert.match(read('server.js'), /app\.use\('\/api\/people', require\('\.\/routes\/people'\)\)/);
});

test('CSV export refuses moderators and admins before touching the database', async () => {
  const handler = routeHandler('/export.csv');
  for (const role of ['moderator', 'admin']) {
    const res = fakeRes();
    let nextCalled = false;
    await handler({ userAuth: { id: 'u1', role }, query: {} }, res, () => { nextCalled = true; });
    assert.equal(res.statusCode, 403, role);
    assert.equal(nextCalled, false);
  }
});

test('CSV cells cannot start a spreadsheet formula, E.164 numbers stay readable', () => {
  assert.equal(people.csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(people.csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(people.csvCell('-1+2'), "'-1+2");
  assert.equal(people.csvCell('+256700000000'), '+256700000000');
  assert.equal(people.csvCell('+256 700'), "'+256 700");
  assert.equal(people.csvCell(['lead', 'contact']), 'lead;contact');
  assert.equal(people.csvCell(null), '');
});

test('filters accept known values only and cap the page size', () => {
  const f = people.parsePeopleFilters({ role: 'agent', source: 'nope', consent: 'consented', sort: 'DROP', limit: '9999', page: '3' });
  assert.equal(f.role, 'agent');
  assert.ok(!f.source);
  assert.equal(f.consent, 'consented');
  assert.equal(f.sort, 'last_activity');
  assert.equal(f.limit, 200);
  assert.equal(f.offset, 400);
});

test('search is parameterised and matches a number typed with its trunk 0', () => {
  const injected = people.buildPeopleWhere(people.parsePeopleFilters({ q: "x' OR 1=1 --" }));
  assert.ok(!injected.sql.includes('OR 1=1'));
  const local = people.buildPeopleWhere(people.parsePeopleFilters({ q: '0772 123' }));
  assert.ok(local.params.includes('%772123%'));
  const intl = people.buildPeopleWhere(people.parsePeopleFilters({ q: '+256 700 000 001' }));
  assert.ok(intl.params.includes('%700000001%'));
  const escaped = people.buildPeopleWhere(people.parsePeopleFilters({ q: '50%_off' }));
  assert.equal(escaped.params[0], '%50\\%\\_off%');
});

test('person detail rejects ids that are not UUIDs without a query', async () => {
  const db = { query: () => { throw new Error('should not query'); } };
  assert.equal(await people.getPersonDetail(db, "1' OR '1'='1"), null);
});

test('the nightly reconcile has its own boot slot', () => {
  assert.equal(typeof BOOT_DELAY_MS.people_reconcile, 'number');
  assert.match(read('server.js'), /staggeredBootDelay\('people_reconcile'\)/);
});

test('people code logs counts and ids, never names, numbers or emails', () => {
  for (const file of ['services/peopleService.js', 'routes/people.js']) {
    const calls = read(file).match(/logger\.(info|warn|error)\([^;]*\);?/gs) || [];
    assert.ok(calls.length > 0, file);
    for (const call of calls) {
      assert.doesNotMatch(call, /phone|email|display_name|first_name|\bq\b|req\.query/i, `${file}: ${call}`);
    }
  }
});

test('migration 188 keeps a backup table, a UG guard and a rollback script', () => {
  const migration = read('db/migrations/188_people_master_contact_list.sql');
  assert.match(migration, /data_change_188_backup/);
  assert.match(migration, /app\.country_code/);
  assert.doesNotMatch(migration, /\b(DELETE FROM|TRUNCATE|DROP TABLE)\s+(users|contacts|leads|whatsapp_user_profiles|property_seeker_profiles)\b/i);
  const rollback = read('scripts/rollback-188-people-master-contact-list.sql');
  assert.match(rollback, /DROP TABLE IF EXISTS people\b/);
  assert.doesNotMatch(rollback, /DROP TABLE IF EXISTS data_change_188_backup/);
});

test('people UI marks personal data and keeps CSV export to super_admin', () => {
  const app = read('assets/makaug-app.js');
  assert.match(app, /data-pii="phone"/);
  assert.match(app, /function staffPeopleExportCsv/);
  assert.match(app, /can_export/);
  const html = read('index.html');
  assert.match(html, /data-people-root="staff"/);
  assert.match(html, /data-admin-tab-panel="accounts"[^>]*>\s*<div data-people-root="admin"/);
});

test('the change poll runs every 15 minutes and never faster than 5', () => {
  assert.equal(people.POLL_MS, 15 * 60_000);
  const source = read('services/peopleService.js');
  assert.match(source, /Math\.max\(POLL_MIN_MS/);
  assert.match(source, /POLL_MIN_MS = 5 \* 60_000/);
  assert.match(source, /03:15|NIGHTLY/);
});

test('the change poll is index lookups only: no counts, every probe has a matching index', () => {
  assert.doesNotMatch(people.FINGERPRINT_SQL, /count\s*\(/i);
  const migration = read('db/migrations/188_people_master_contact_list.sql');
  for (const [table, expr] of people.FINGERPRINT_PROBES) {
    assert.match(people.FINGERPRINT_SQL, new RegExp(`max\\(${expr.replace(/[()]/g, '\\$&')}\\)`));
    const indexed = expr === 'created_at'
      ? new RegExp(`ON ${table} \\(created_at DESC\\)`)
      : new RegExp(`ON ${table} \\(\\(${expr.replace(/[()]/g, '\\$&')}\\)\\)`);
    assert.match(migration, indexed, `${table} probe needs an index`);
  }
});

test('migration 188 records the in-person consents without writing users', () => {
  const migration = read('db/migrations/188_people_master_contact_list.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS people_consent_records/);
  assert.match(migration, /source IN \('in_person'\)/);
  assert.match(migration, /marketing_opt_in[\s\S]{0,200}created_at < cutoff/);
  assert.match(migration, /ON CONFLICT \(user_id, channel, purpose, source\) DO NOTHING/);
  assert.doesNotMatch(migration, /UPDATE\s+users\b/i);
  const rollback = read('scripts/rollback-188-people-master-contact-list.sql');
  assert.doesNotMatch(rollback, /DROP TABLE IF EXISTS people_consent_records/);
  assert.doesNotMatch(rollback, /DROP INDEX IF EXISTS idx_saved_properties_created/);
});
