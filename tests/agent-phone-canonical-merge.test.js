'use strict';

// Uganda agent phones collapse to +256…, a second profile on the same line is
// refused with a link to the existing agent, and the Quick auctioneers
// duplicate is merged into Quickway. No full phone number is written here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { execFileSync } = require('child_process');
const { Pool } = require('pg');
const { canonicalUgPhone, maskPhoneLast3 } = require('../utils/ugPhone');
const { duplicatePhoneBody, resolveAgentByNumber } = require('../services/agentPhoneService');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

function line(last3) {
  const national = `700000${last3}`;
  return { local: `0${national}`, e164: `+256${national}`, key: national };
}

const PG_BIN = [process.env.LFM_PG_BIN, '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/18/bin']
  .filter(Boolean)
  .find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

test('local, 256 and +256 forms of one line become the same +256 number', () => {
  const sample = line('123');
  assert.equal(canonicalUgPhone(sample.local), sample.e164);
  assert.equal(canonicalUgPhone(`256${sample.key}`), sample.e164);
  assert.equal(canonicalUgPhone(sample.e164), sample.e164);
  assert.equal(canonicalUgPhone(sample.key), sample.e164);
  assert.equal(maskPhoneLast3(sample.local), '+256•••123');
  const body = duplicatePhoneBody({ id: '11111111-1111-4111-8111-111111111111', full_name: 'Quickway Auctioneers', makaug_agent_number: 'MKA-AG-5282286' });
  assert.match(body.error, /Quickway Auctioneers \(MKA-AG-5282286\) already uses this phone number/);
  assert.match(body.error, /Open that agent instead/);
  assert.equal(body.existing_agent_id, '11111111-1111-4111-8111-111111111111');
  assert.doesNotMatch(body.error, /\d{9}/);
});

test('the migration merges only Quick auctioneers and does not embed a phone number', () => {
  const sql = read('db/migrations/212_canonical_agent_phone_and_quick_auctioneers_merge.sql');
  const rollback = read('scripts/rollback-212-canonical-agent-phone-and-quick-auctioneers-merge.sql');
  assert.match(sql, /MKA-AG-3822248/);
  assert.match(sql, /MKA-AG-5282286/);
  assert.match(sql, /migration_212_agent_phone_merge_backup/);
  assert.match(sql, /agent_number_aliases/);
  assert.match(sql, /agents_block_duplicate_phone/);
  assert.match(sql, /dropped_rows/);
  for (const table of ['listing_availability_checkins', 'agent_weekly_reports', 'agent_viewing_defaults', 'agent_identity_files']) {
    assert.match(sql, new RegExp(`DELETE FROM ${table}`), `${table} collisions are removed instead of moved`);
  }
  assert.match(rollback, /jsonb_populate_recordset/);
  assert.match(sql, /No message was sent/);
  assert.doesNotMatch(sql, /MKA-AG-6967927/);
  assert.doesNotMatch(sql, /MKA-AG-9146513/);
  assert.doesNotMatch(`${sql}\n${rollback}`, /\d{9,}/);
  assert.match(rollback, /DISABLE TRIGGER agents_block_duplicate_phone/);
  assert.match(rollback, /ENABLE TRIGGER agents_block_duplicate_phone/);
  const intake = read('routes/whatsapp.js');
  assert.match(intake, /already uses this phone number/);
  assert.match(intake, /RIGHT\(regexp_replace\(COALESCE\(phone, ''\), '\\\\D', '', 'g'\), 9\)/);
});

test('Quick auctioneers merges into Quickway and a second phone is refused', {
  skip: PG_BIN ? false : 'Install PostgreSQL or set LFM_PG_BIN for the isolated database test.'
}, async () => {
  const port = await freePort();
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-phone-merge-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'sock');
  fs.mkdirSync(socket);
  let pool;
  const stopPg = () => {
    try { execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-w', '-t', '20', 'stop'], { stdio: 'pipe' }); } catch (_) { /* stopped */ }
  };
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=phonemerge', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '20',
      '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`, 'start'], { stdio: 'pipe' });
    pool = new Pool({ host: '127.0.0.1', port, user: 'phonemerge', database: 'postgres', ssl: false });
    const sample = line('959');
    await pool.query(`
      CREATE TABLE agents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        full_name text, company_name text, phone text, whatsapp text, email text, nin text,
        greeting_name text, bio text, identity_document_url text, identity_document_name text,
        identity_document_type text, verification_reason text, status text, removed_at timestamptz,
        removed_reason text, removed_by text, removal_snapshot jsonb, makaug_agent_number text,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE properties (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid, status text, lister_name text,
        extra_fields jsonb, updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE revenue_entries (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid);
      CREATE TABLE agent_identity_files (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid NOT NULL, kind text NOT NULL,
        label text, archived_at timestamptz, archived_reason text
      );
      CREATE UNIQUE INDEX agent_identity_files_one_live_side
        ON agent_identity_files (agent_id, kind)
        WHERE archived_at IS NULL AND kind IN ('id_front', 'id_back');
      CREATE TABLE listing_availability_checkins (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id uuid NOT NULL, week_key text NOT NULL, sent_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (agent_id, week_key)
      );
      CREATE TABLE agent_weekly_reports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id uuid NOT NULL, week_start date NOT NULL, week_end date NOT NULL,
        metrics jsonb NOT NULL DEFAULT '{}',
        UNIQUE (agent_id, week_start)
      );
      CREATE TABLE agent_viewing_defaults (
        agent_id uuid PRIMARY KEY,
        notice_period_hours integer NOT NULL
      );
    `);
    const survivor = (await pool.query(
      `INSERT INTO agents (full_name, company_name, phone, whatsapp, status, makaug_agent_number, identity_document_url, identity_document_name, verification_reason)
       VALUES ('Quickway Auctioneers', 'Quickway Auctioneers & Court Bailiffs', $1, $1, 'approved', 'MKA-AG-5282286', 'private://id', 'national-id', '[STAFF_LISTING_REASSIGNMENT] kept')
       RETURNING id`,
      [sample.e164]
    )).rows[0];
    const source = (await pool.query(
      `INSERT INTO agents (full_name, company_name, phone, whatsapp, status, makaug_agent_number, bio, verification_reason, created_at)
       VALUES ('Quick auctioneers', 'Independent agent', $1, $1, 'approved', 'MKA-AG-3822248', 'Auction notes', '[WHATSAPP_EMPLOYEE_AGENT_007] kept', now() + interval '1 hour')
       RETURNING id`,
      [sample.local]
    )).rows[0];
    await pool.query(`INSERT INTO properties (agent_id, status, lister_name) VALUES ($1, 'approved', 'Quick auctioneers'), ($1, 'pending', 'Quick auctioneers')`, [source.id]);
    await pool.query(`INSERT INTO properties (agent_id, status) VALUES ($1, 'approved')`, [survivor.id]);
    await pool.query(`INSERT INTO revenue_entries (agent_id) VALUES ($1)`, [source.id]);
    await pool.query(
      `INSERT INTO agent_identity_files (agent_id, kind, label) VALUES
         ($1, 'id_front', 'survivor-front'),
         ($2, 'id_front', 'source-front'),
         ($2, 'id_back', 'source-back')`,
      [survivor.id, source.id]
    );
    await pool.query(
      `INSERT INTO listing_availability_checkins (agent_id, week_key, sent_at) VALUES
         ($1, '2026-W45', '2026-01-01'),
         ($2, '2026-W45', '2026-02-01'),
         ($2, '2026-W46', '2026-03-01')`,
      [survivor.id, source.id]
    );
    await pool.query(
      `INSERT INTO agent_weekly_reports (agent_id, week_start, week_end, metrics) VALUES
         ($1, '2026-11-02', '2026-11-08', '{"who":"survivor"}'),
         ($2, '2026-11-02', '2026-11-08', '{"who":"source"}'),
         ($2, '2026-11-09', '2026-11-15', '{"who":"source-only"}')`,
      [survivor.id, source.id]
    );
    await pool.query(
      `INSERT INTO agent_viewing_defaults (agent_id, notice_period_hours) VALUES ($1, 24), ($2, 48)`,
      [survivor.id, source.id]
    );
    const shared = line('222');
    await pool.query(
      `INSERT INTO agents (full_name, phone, whatsapp, status, makaug_agent_number)
       VALUES ('Left as-is', $1, $1, 'approved', 'MKA-AG-0000222'),
              ('Also left', $2, $2, 'suspended', 'MKA-AG-0000223')`,
      [shared.e164, shared.local]
    );

    const started = Date.now();
    await pool.query(read('db/migrations/212_canonical_agent_phone_and_quick_auctioneers_merge.sql'));
    const migrationMs = Date.now() - started;
    assert.ok(migrationMs < 1000, `migration took ${migrationMs}ms`);

    const after = (await pool.query(
      `SELECT makaug_agent_number, full_name, company_name, phone, whatsapp, status, removed_at IS NOT NULL AS removed,
              identity_document_url, bio, verification_reason
         FROM agents ORDER BY makaug_agent_number`
    )).rows;
    const kept = after.find((row) => row.makaug_agent_number === 'MKA-AG-5282286');
    const retired = after.find((row) => row.makaug_agent_number === 'MKA-AG-3822248');
    assert.equal(kept.company_name, 'Quickway Auctioneers & Court Bailiffs');
    assert.equal(kept.phone, sample.e164);
    assert.equal(kept.whatsapp, sample.e164);
    assert.equal(kept.identity_document_url, 'private://id');
    assert.equal(kept.bio, 'Auction notes');
    assert.match(kept.verification_reason, /STAFF_LISTING_REASSIGNMENT/);
    assert.match(kept.verification_reason, /WHATSAPP_EMPLOYEE_AGENT_007/);
    assert.match(kept.verification_reason, /No message was sent/);
    assert.equal(retired.phone, null);
    assert.equal(retired.status, 'suspended');
    assert.equal(retired.removed, true);
    const listings = (await pool.query(`SELECT COUNT(*)::int AS n FROM properties WHERE agent_id = $1`, [survivor.id])).rows[0];
    assert.equal(listings.n, 3);
    const payments = (await pool.query(`SELECT COUNT(*)::int AS n FROM revenue_entries WHERE agent_id = $1`, [survivor.id])).rows[0];
    assert.equal(payments.n, 1);
    const checkins = (await pool.query(
      `SELECT week_key, sent_at::date::text AS sent FROM listing_availability_checkins WHERE agent_id = $1 ORDER BY week_key`,
      [survivor.id]
    )).rows;
    assert.deepEqual(checkins.map((row) => row.week_key), ['2026-W45', '2026-W46']);
    assert.equal((await pool.query(
      `SELECT to_char(sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS sent
         FROM listing_availability_checkins WHERE agent_id = $1 AND week_key = '2026-W45'`,
      [survivor.id]
    )).rows[0].sent, '2026-01-01');
    assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM listing_availability_checkins WHERE agent_id = $1`, [source.id])).rows[0].n, 0);
    const reports = (await pool.query(
      `SELECT week_start::text AS week, metrics->>'who' AS who FROM agent_weekly_reports WHERE agent_id = $1 ORDER BY week_start`,
      [survivor.id]
    )).rows;
    assert.deepEqual(reports, [
      { week: '2026-11-02', who: 'survivor' },
      { week: '2026-11-09', who: 'source-only' }
    ]);
    assert.equal((await pool.query(`SELECT notice_period_hours FROM agent_viewing_defaults WHERE agent_id = $1`, [survivor.id])).rows[0].notice_period_hours, 24);
    assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM agent_viewing_defaults WHERE agent_id = $1`, [source.id])).rows[0].n, 0);
    const files = (await pool.query(
      `SELECT kind, label FROM agent_identity_files WHERE agent_id = $1 ORDER BY kind`,
      [survivor.id]
    )).rows;
    assert.deepEqual(files, [
      { kind: 'id_back', label: 'source-back' },
      { kind: 'id_front', label: 'survivor-front' }
    ]);
    const dropped = (await pool.query(
      `SELECT dropped_rows FROM migration_212_agent_phone_merge_backup WHERE agent_number = 'MKA-AG-3822248'`
    )).rows[0].dropped_rows;
    assert.equal(dropped.listing_availability_checkins[0].week_key, '2026-W45');
    assert.equal(dropped.listing_availability_checkins[0].sent_at.slice(0, 10), '2026-02-01');
    assert.equal(dropped.agent_weekly_reports[0].metrics.who, 'source');
    assert.equal(dropped.agent_viewing_defaults[0].notice_period_hours, 48);
    assert.equal(dropped.agent_identity_files[0].label, 'source-front');
    const resolved = await resolveAgentByNumber({ query: (sql, params) => pool.query(sql, params) }, 'MKA-AG-3822248');
    assert.equal(resolved.id, survivor.id);
    assert.equal(resolved.makaug_agent_number, 'MKA-AG-5282286');

    await assert.rejects(
      pool.query(
        `INSERT INTO agents (full_name, phone, whatsapp, status, makaug_agent_number) VALUES ('Again', $1, $1, 'pending', 'MKA-AG-0000001')`,
        [sample.local]
      ),
      (error) => {
        assert.equal(error.code, '23505');
        assert.match(error.message, /agent_phone_taken:MKA-AG-5282286:/);
        assert.doesNotMatch(error.message, new RegExp(sample.key));
        return true;
      }
    );

    const keptPair = (await pool.query(
      `UPDATE agents SET phone = $1, whatsapp = $1, updated_at = NOW()
        WHERE makaug_agent_number = 'MKA-AG-0000223'
        RETURNING phone`,
      [shared.local]
    )).rows[0];
    assert.equal(keptPair.phone, shared.e164);
    const stillTwo = (await pool.query(
      `SELECT COUNT(*)::int AS n FROM agents
        WHERE RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 9) = $1`,
      [shared.key]
    )).rows[0];
    assert.equal(stillTwo.n, 2);
    await assert.rejects(
      pool.query(
        `INSERT INTO agents (full_name, phone, status, makaug_agent_number) VALUES ('Third', $1, 'pending', 'MKA-AG-0000224')`,
        [shared.local]
      ),
      (error) => error.code === '23505'
    );

    const other = line('111');
    const created = (await pool.query(
      `INSERT INTO agents (full_name, phone, status) VALUES ('Someone else', $1, 'pending') RETURNING phone`,
      [other.local]
    )).rows[0];
    assert.equal(created.phone, other.e164);

    await pool.query(read('scripts/rollback-212-canonical-agent-phone-and-quick-auctioneers-merge.sql'));
    const restoredListings = (await pool.query(`SELECT COUNT(*)::int AS n FROM properties WHERE agent_id = $1`, [source.id])).rows[0];
    const restoredPhone = (await pool.query(`SELECT phone, status FROM agents WHERE id = $1`, [source.id])).rows[0];
    assert.equal(restoredListings.n, 2);
    assert.equal(restoredPhone.phone, sample.local);
    assert.equal(restoredPhone.status, 'approved');
    const alias = (await pool.query(`SELECT COUNT(*)::int AS n FROM agent_number_aliases WHERE alias = 'MKA-AG-3822248'`)).rows[0];
    assert.equal(alias.n, 0);
    const sourceCheckins = (await pool.query(
      `SELECT week_key FROM listing_availability_checkins WHERE agent_id = $1 ORDER BY week_key`,
      [source.id]
    )).rows.map((row) => row.week_key);
    assert.deepEqual(sourceCheckins, ['2026-W45', '2026-W46']);
    const survivorCheckin = (await pool.query(
      `SELECT to_char(sent_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS sent
         FROM listing_availability_checkins WHERE agent_id = $1 AND week_key = '2026-W45'`,
      [survivor.id]
    )).rows[0];
    assert.equal(survivorCheckin.sent, '2026-01-01');
    assert.equal((await pool.query(`SELECT notice_period_hours FROM agent_viewing_defaults WHERE agent_id = $1`, [source.id])).rows[0].notice_period_hours, 48);
    assert.equal((await pool.query(`SELECT notice_period_hours FROM agent_viewing_defaults WHERE agent_id = $1`, [survivor.id])).rows[0].notice_period_hours, 24);
    const sourceFiles = (await pool.query(
      `SELECT label FROM agent_identity_files WHERE agent_id = $1 ORDER BY label`,
      [source.id]
    )).rows.map((row) => row.label);
    assert.deepEqual(sourceFiles, ['source-back', 'source-front']);
    assert.equal((await pool.query(
      `SELECT label FROM agent_identity_files WHERE agent_id = $1 AND kind = 'id_front'`,
      [survivor.id]
    )).rows[0].label, 'survivor-front');
  } finally {
    if (pool) await pool.end().catch(() => {});
    stopPg();
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});
