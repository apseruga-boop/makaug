'use strict';

// Migration 184 (Arthur, 26 Oct 2026): hide duplicate listing 67E51F (keeps
// 400346) and cancel the one stuck agent_booking WhatsApp queue row.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const { publicVisibleInventoryWhere } = require('../services/publicInventoryMetricsService');

const ROOT = path.join(__dirname, '..');
const MIGRATIONS = path.join(ROOT, 'db/migrations');
const SQL = fs.readFileSync(path.join(MIGRATIONS, '184_hide_duplicate_67e51f_and_cancel_agent_booking_row.sql'), 'utf8');
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'scripts/rollback-184-hide-duplicate-67e51f-and-cancel-agent-booking-row.sql'), 'utf8');
const PG_BIN = [process.env.LFM_PG_BIN, '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/18/bin']
  .filter(Boolean)
  .find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));

const DUP = '70fb505f-48e7-4132-92d1-393dbfc90a93';
const KEEPER = '2a4353f2-6bd9-4c59-bbd1-ad7ed797488f';
const OTHER = '684f49bb-0000-4000-8000-000000000184';
const QUEUE = '202c93a9-6dad-457f-84aa-0699142ebd6b';
const OTHER_QUEUE = '11111111-0000-4000-8000-000000000184';

test('migration 184 is Uganda-only, names exactly its two rows and backs up before it writes', () => {
  assert.match(SQL, /current_setting\('app\.country_code', true\) IS DISTINCT FROM 'UG'/);
  assert.match(SQL, /SET LOCAL lock_timeout/);
  const statements = SQL.replace(/--.*$/gm, '');
  assert.ok(statements.indexOf("VALUES ('property'") < statements.indexOf('UPDATE properties'));
  assert.ok(statements.indexOf("VALUES ('outbound_message_queue'") < statements.indexOf('UPDATE outbound_message_queue'));
  assert.doesNotMatch(statements, /DELETE\s+FROM|DROP\s+TABLE|TRUNCATE|UPDATE\s+featured_rotation_runs/i);
  assert.equal((statements.match(/UPDATE properties/g) || []).length, 1);
  assert.match(statements, /WHERE id = listing_id;/);
  assert.match(statements, /WHERE id = queue_id;/);
  assert.match(ROLLBACK, /app\.rollback_184_requeue/);
  assert.ok(!fs.existsSync(path.join(MIGRATIONS, 'rollback-184-hide-duplicate-67e51f-and-cancel-agent-booking-row.sql')));
});

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

test('migration 184 hides 67E51F, cancels the queue row, is idempotent and rolls back', {
  skip: PG_BIN ? false : 'Install PostgreSQL or set LFM_PG_BIN for the isolated database test.',
  timeout: 180000
}, async (t) => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-migration-184-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'socket');
  fs.mkdirSync(socket);
  let client;
  let started = false;
  const notices = [];
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=lfm_184', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    const port = await freePort();
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '20', '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`, 'start'], { stdio: 'pipe' });
    started = true;
    client = new Client({ host: '127.0.0.1', port, user: 'lfm_184', database: 'postgres' });
    await client.connect();
    client.on('notice', (notice) => notices.push(notice.message || String(notice)));
    await client.query(`
      CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;
      CREATE TABLE properties (
        id UUID PRIMARY KEY, inquiry_reference TEXT, title TEXT, description TEXT, listing_type TEXT,
        status TEXT CHECK (status IN ('draft','pending','approved','rejected','hidden','deleted','archived','sold')),
        moderation_stage TEXT, moderation_notes TEXT, moderation_reason TEXT,
        source TEXT, listed_via TEXT, lister_name TEXT, lister_email TEXT,
        has_public_media BOOLEAN NOT NULL DEFAULT TRUE,
        extra_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TRIGGER trg_properties_updated_at BEFORE UPDATE ON properties FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      CREATE TABLE property_moderation_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        actor_id TEXT, action TEXT NOT NULL, status_from TEXT, status_to TEXT, checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
        reason TEXT, notes TEXT, delivery JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE outbound_message_queue (
        id UUID PRIMARY KEY, user_phone TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','retry','sent','failed')),
        attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), sent_at TIMESTAMPTZ,
        last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        channel TEXT NOT NULL DEFAULT 'whatsapp', metadata JSONB NOT NULL DEFAULT '{}'::jsonb
      );
      CREATE TABLE featured_rotation_runs (
        rotation_date DATE PRIMARY KEY, status TEXT NOT NULL, selected_count INTEGER NOT NULL DEFAULT 0,
        selected_ids JSONB NOT NULL DEFAULT '[]'::jsonb
      );
    `);
    await client.query(`
      INSERT INTO properties (id, inquiry_reference, title, listing_type, status, moderation_stage, moderation_notes, extra_fields) VALUES
        ('${DUP}', 'MK-20261024-67E51F', 'Land in Kira-Nsasa', 'land', 'approved', 'approved', 'Staff preview completed before approval',
         '{"featured":"true","featured_at":"2026-10-26 04:00:58+00","featured_by":"featured_rotation_scheduler","featured_removed_at":"2026-10-26 04:00:58+00"}'),
        ('${KEEPER}', 'MK-20261024-400346', 'Plot for sale in Kira-Nsasa', 'land', 'approved', 'approved', NULL, '{}'),
        ('${OTHER}', 'MK-20261024-684F49', 'Plots for sale in Bujuuko', 'land', 'approved', 'approved', NULL, '{"featured":"true"}');
      INSERT INTO outbound_message_queue (id, user_phone, payload, status, attempts, metadata) VALUES
        ('${QUEUE}', '+256700000232', '{"text":"hi"}', 'pending', 0, '{"source":"agent_booking","delivery_mode":"web_bridge"}'),
        ('${OTHER_QUEUE}', '+256700000999', '{"text":"hi"}', 'pending', 0, '{"source":"agent_booking","delivery_mode":"web_bridge"}');
      INSERT INTO featured_rotation_runs VALUES
        ('2026-10-25', 'completed', 10, '["${DUP}","${OTHER}"]'),
        ('2026-10-26', 'completed', 10, '["${DUP}","${OTHER}"]'),
        ('2026-10-24', 'completed', 10, '["${OTHER}"]');
    `);

    const apply = async (text, country = 'UG', extra = {}) => {
      const before = notices.length;
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.country_code', $1, true)", [country]);
      for (const [key, value] of Object.entries(extra)) await client.query('SELECT set_config($1, $2, true)', [key, value]);
      await client.query(text);
      await client.query('COMMIT');
      return notices.slice(before).join('\n');
    };
    const snapshot = async () => ({
      properties: (await client.query("SELECT to_jsonb(t) - 'updated_at' AS row FROM properties t ORDER BY id")).rows.map((r) => r.row),
      queue: (await client.query("SELECT to_jsonb(t) - 'updated_at' AS row FROM outbound_message_queue t ORDER BY id")).rows.map((r) => r.row),
      runs: (await client.query('SELECT to_jsonb(t) AS row FROM featured_rotation_runs t ORDER BY rotation_date')).rows.map((r) => r.row),
      events: (await client.query('SELECT COUNT(*)::int AS n FROM property_moderation_events')).rows[0].n
    });
    const visibleIds = async () => (await client.query(
      `SELECT p.id::text FROM properties p WHERE ${publicVisibleInventoryWhere('p')} ORDER BY id`
    )).rows.map((r) => r.id);
    const before = await snapshot();

    await t.test('another country is skipped', async () => {
      assert.match(await apply(SQL, 'ZA'), /skipped/);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test('the first run hides 67E51F and cancels only the target queue row', async () => {
      const notice = await apply(SQL);
      assert.match(notice, /listing_hidden=1 queue_cancelled=1 featured_runs_backed_up=2/);
      const dup = (await client.query('SELECT * FROM properties WHERE id = $1', [DUP])).rows[0];
      assert.equal(dup.status, 'hidden');
      assert.equal(dup.moderation_stage, 'hidden');
      assert.match(dup.moderation_notes, /Duplicate of MK-20261024-400346 .*70M.*Arthur 26 Oct 2026/);
      assert.equal(dup.extra_fields.featured, false);
      assert.equal(dup.extra_fields.featured_removed_by, 'migration_184');
      assert.equal(dup.extra_fields.listing_hide_184.duplicate_of_property_id, KEEPER);
      assert.deepEqual(await visibleIds(), [KEEPER, OTHER].sort());
      const after = await snapshot();
      assert.deepEqual(after.properties.filter((r) => r.id !== DUP), before.properties.filter((r) => r.id !== DUP));
      assert.deepEqual(after.runs, before.runs);
      const event = (await client.query('SELECT * FROM property_moderation_events')).rows;
      assert.equal(event.length, 1);
      assert.equal(event[0].status_to, 'hidden');
      const q = (await client.query('SELECT * FROM outbound_message_queue WHERE id = $1', [QUEUE])).rows[0];
      assert.equal(q.status, 'failed');
      assert.equal(q.attempts, 0);
      assert.equal(q.sent_at, null);
      assert.equal(q.last_error, 'cancelled_by_admin');
      assert.deepEqual(after.queue.find((r) => r.id === OTHER_QUEUE), before.queue.find((r) => r.id === OTHER_QUEUE));
      const kinds = (await client.query('SELECT row_kind, row_key FROM data_change_184_backup ORDER BY row_kind, row_key')).rows;
      assert.deepEqual(kinds.map((r) => `${r.row_kind}:${r.row_key}`), [
        '2026-10-25', '2026-10-26'].map((d) => `featured_rotation_runs:${d}`).concat([`outbound_message_queue:${QUEUE}`, `property:${DUP}`]).sort());
    });

    await t.test('a second run changes nothing', async () => {
      const after = await snapshot();
      assert.match(await apply(SQL), /listing_hidden=0 queue_cancelled=0 featured_runs_backed_up=0/);
      assert.deepEqual(await snapshot(), after);
    });

    await t.test('the default rollback restores the listing and leaves the queue row cancelled', async () => {
      const notice = await apply(ROLLBACK);
      assert.match(notice, /listing_restored=1 events_removed=1 queue_restored=0/);
      const now = await snapshot();
      assert.deepEqual(now.properties, before.properties);
      assert.equal(now.events, 0);
      assert.equal(now.queue.find((r) => r.id === QUEUE).status, 'failed');
      assert.match(await apply(ROLLBACK), /listing_restored=0 events_removed=0 queue_restored=0/);
    });

    await t.test('the queue row goes back to pending only when asked for on purpose', async () => {
      assert.match(await apply(ROLLBACK, 'UG', { 'app.rollback_184_requeue': 'yes' }), /queue_restored=1/);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test('after a rollback the migration can be applied again', async () => {
      assert.match(await apply(SQL), /listing_hidden=1 queue_cancelled=1/);
    });

    await t.test('nothing happens when the keeper 400346 is no longer public', async () => {
      await apply(ROLLBACK, 'UG', { 'app.rollback_184_requeue': 'yes' });
      await client.query(`UPDATE properties SET status = 'pending' WHERE id = '${KEEPER}'`);
      assert.match(await apply(SQL), /keeper MK-20261024-400346 is not approved[\s\S]*listing_hidden=0 queue_cancelled=1/);
      assert.equal((await client.query('SELECT status FROM properties WHERE id = $1', [DUP])).rows[0].status, 'approved');
    });
  } finally {
    if (client) await client.end().catch(() => {});
    if (started) execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-w', '-t', '20', '-m', 'immediate', 'stop'], { stdio: 'pipe' });
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});
