'use strict';

// Migration 183 deletes every laundry / dry-cleaning business (Arthur, 25 Oct
// 2026) after backing each one, and every row that points at it, up.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const { classifyMarketplaceRelevance } = require('../utils/marketplaceRelevance');

const ROOT = path.join(__dirname, '..');
const MIGRATIONS = path.join(ROOT, 'db/migrations');
const SQL = fs.readFileSync(path.join(MIGRATIONS, '183_delete_marketplace_laundries.sql'), 'utf8');
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'scripts/rollback-183-delete-marketplace-laundries.sql'), 'utf8');
const PG_BIN = [process.env.LFM_PG_BIN, '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/18/bin']
  .filter(Boolean)
  .find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));

const LAUNDRIES = [
  ['0633da18-02dc-455e-ae3a-825aca62ea8b', "LA'BOS LAUNDRY AND CLEANING SERVICES", 'live'],
  ['0003209c-3b09-4543-beb0-da73160c72b1', 'Bomboka Vintage Dry Cleaners, Laundry, Fumigation', 'hidden'],
  ['daadbc0b-82eb-41d6-b262-9a74660653f9', 'Elohim Laundry And Dry Cleaners', 'hidden'],
  ['562375e8-b766-4a75-b3dd-bbe99f093617', 'Holaz Laundry Cleaning Services, Mbale', 'hidden'],
  ['ffe92b48-6613-4759-a32b-ae293f287da7', "La'Bos Laundry & Cleaning Services", 'hidden'],
  ['8409d9f6-e7ad-42a7-b99b-c1c7e0942db5', 'Washy Cleaning Services Ltd (Washy Drycleaners)', 'hidden'],
  ['d0f24e74-089a-4db4-8fc5-947cee775dcc', 'SwiftKlean Laundry and Cleaning Services', 'hidden'],
  ['5ed71dfe-d8a8-4e11-beb1-9d1483b3b47c', 'Dunwell Dry Cleaners', 'hidden'],
  ['12f61b89-8968-413f-ba9c-6cb235cd549f', "Gango's Laundry, Dry Cleaner & General Cleaning Services", 'hidden']
];
// Building and home cleaners that must stay.
const KEEP = [
  ['beb5c287-8567-4177-b0be-b1d33e65b999', 'Phimar Cleaners mbarara'],
  ['69b6e7bc-cb2f-4749-b999-9d8822f40772', 'clear choice cleaners services gulu'],
  ['5c52d580-8799-4a89-838e-c5299a31f122', "Smile Fumigators and Cleaner's limited"],
  ['bd831164-4732-4997-8948-138c6636f433', 'Trained Housemaids and Home Cleaners Uganda'],
  ['a01ab9a8-83f1-4520-b596-38da9f0b527a', 'Mwashi Works construction limited']
];
const EXTRA = ['7a1f0c2e-1111-4c2b-9d1e-000000000183', 'Kira Laundromat', 'pending_review'];

test('migration 183 is Uganda-only, lists the reviewed laundries and backs up before it deletes', () => {
  assert.match(SQL, /current_setting\('app\.country_code', true\) IS DISTINCT FROM 'UG'/);
  assert.match(SQL, /SET LOCAL lock_timeout/);
  for (const [id] of LAUNDRIES) assert.match(SQL, new RegExp(`'${id}'`));
  for (const [id] of KEEP) assert.doesNotMatch(SQL.replace(/--.*$/gm, ''), new RegExp(id));
  const statements = SQL.replace(/--.*$/gm, '');
  assert.ok(statements.indexOf('INSERT INTO marketplace_laundry_delete_183_backup') < statements.indexOf('DELETE FROM marketplace_businesses'));
  assert.doesNotMatch(statements, /DROP\s+TABLE|TRUNCATE|UPDATE\s+marketplace_businesses/i);
  assert.match(ROLLBACK, /jsonb_populate_record\(NULL::marketplace_businesses/);
  assert.match(ROLLBACK, /restored_at/);
  assert.ok(!fs.existsSync(path.join(MIGRATIONS, path.basename('rollback-183-delete-marketplace-laundries.sql'))));
});

test('the relevance gate rejects laundries so the drip cannot import them again', () => {
  for (const [, name] of [...LAUNDRIES, EXTRA]) {
    const decision = classifyMarketplaceRelevance({ name, category: 'cleaning' });
    assert.equal(decision.decision, 'reject', name);
    assert.equal(decision.reason, 'excluded_name:laundry', name);
  }
  assert.equal(classifyMarketplaceRelevance({ name: 'Fresh Home Services', category: 'cleaning', website: 'https://freshlaundry.ug' }).reason, 'excluded_name:laundry');
  for (const name of ['Phimar Cleaners mbarara', "Smile Fumigators and Cleaner's limited", 'Kampala Office Cleaning Services']) {
    assert.equal(classifyMarketplaceRelevance({ name, category: 'cleaning' }).decision, 'qualified', name);
  }
  // A description that mentions laundry does not reject a building cleaner.
  assert.equal(classifyMarketplaceRelevance({
    name: 'Kampala Office Cleaning Services', category: 'cleaning', relevance_text: 'Office, carpet and laundry room cleaning'
  }).decision, 'qualified');
  assert.equal(classifyMarketplaceRelevance({
    name: 'Kampala Office Cleaning Services', category: 'cleaning', google_types: ['laundry']
  }).decision, 'pending_review');
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

test('migration 183 deletes only laundries, keeps backups, is idempotent and rolls back', {
  skip: PG_BIN ? false : 'Install PostgreSQL or set LFM_PG_BIN for the isolated database test.',
  timeout: 180000
}, async (t) => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-migration-183-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'socket');
  fs.mkdirSync(socket);
  let client;
  let started = false;
  const notices = [];
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=lfm_183', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    const port = await freePort();
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '20', '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`, 'start'], { stdio: 'pipe' });
    started = true;
    client = new Client({ host: '127.0.0.1', port, user: 'lfm_183', database: 'postgres' });
    await client.connect();
    client.on('notice', (notice) => notices.push(notice.message || String(notice)));
    await client.query(`
      CREATE TABLE users (id uuid PRIMARY KEY);
      CREATE TABLE payments (id uuid PRIMARY KEY);
      CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;
    `);
    for (const name of fs.readdirSync(MIGRATIONS).filter((file) => /^08[1-4]_marketplace|^088_marketplace/.test(file)).sort()) {
      await client.query(fs.readFileSync(path.join(MIGRATIONS, name), 'utf8'));
    }
    const insertBusiness = (id, name, status) => client.query(
      `INSERT INTO marketplace_businesses (id, name, slug, category, district, phone, tier, status, source_type, source, description)
       VALUES ($1::uuid, $2, $1::text, 'cleaning', 'Kampala', '+256700000000', 'found_online', $3, 'found_online', 'google_maps', $2 || ' description')`,
      [id, name, status]
    );
    for (const [id, name, status] of [...LAUNDRIES, EXTRA]) await insertBusiness(id, name, status);
    for (const [id, name] of KEEP) await insertBusiness(id, name, 'live');

    const labos = LAUNDRIES[0][0];
    const keep = KEEP[0][0];
    await client.query(`
      INSERT INTO marketplace_reviews (business_id, rating, review_text) VALUES ($1, 5, 'Clean shirts'), ($2, 4, 'Good');
      INSERT INTO marketplace_leads (id, business_id, message) VALUES ('11111111-0000-4000-8000-000000000183', $1, 'Need laundry');
      INSERT INTO marketplace_events (business_id, lead_id, event_type) VALUES ($1, '11111111-0000-4000-8000-000000000183', 'lead_created');
      INSERT INTO marketplace_payments (business_id, amount) VALUES ($1, 50000);
      INSERT INTO marketplace_claims (id, business_id, reference, claimant_name, claimant_phone, claimant_role, proof_notes)
        VALUES ('22222222-0000-4000-8000-000000000183', $1, 'CLM-183', 'Owner', '+256700000002', 'owner', 'Shop photo');
      INSERT INTO marketplace_edit_tokens (business_id, claim_id, token_hash, expires_at)
        VALUES ($1, '22222222-0000-4000-8000-000000000183', 'hash-183', NOW() + interval '1 day');
      INSERT INTO marketplace_verified_waitlist (business_id, name) VALUES ($1, 'Owner');
      INSERT INTO marketplace_owner_notifications (business_id, lead_id, notification_type, trigger_key)
        VALUES ($1, '11111111-0000-4000-8000-000000000183', 'new_lead', 'trigger-183');
    `.replace(/\$1/g, `'${labos}'`).replace(/\$2/g, `'${keep}'`));

    const apply = async (text, country = 'UG') => {
      const before = notices.length;
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.country_code', $1, true)", [country]);
      await client.query(text);
      await client.query('COMMIT');
      return notices.slice(before).join('\n');
    };
    const tables = ['marketplace_businesses', 'marketplace_reviews', 'marketplace_leads', 'marketplace_events', 'marketplace_payments',
      'marketplace_claims', 'marketplace_edit_tokens', 'marketplace_verified_waitlist', 'marketplace_owner_notifications'];
    const snapshot = async () => {
      const out = {};
      for (const table of tables) {
        out[table] = (await client.query(`SELECT to_jsonb(t) - 'updated_at' AS row FROM ${table} t ORDER BY id`)).rows.map((r) => r.row);
      }
      return out;
    };
    const before = await snapshot();

    await t.test('another country is skipped', async () => {
      assert.match(await apply(SQL, 'ZA'), /skipped/);
      assert.deepEqual(await snapshot(), before);
    });

    await t.test('the first run deletes the nine reviewed laundries and the extra one, nothing else', async () => {
      const notice = await apply(SQL);
      assert.match(notice, /deleted=10 reviewed_live=1 reviewed_hidden=8 extra_by_name=1 dependents_backed_up=8 skipped=0/);
      const left = (await client.query('SELECT id::text FROM marketplace_businesses ORDER BY id')).rows.map((r) => r.id);
      assert.deepEqual(left, KEEP.map(([id]) => id).sort());
      const backups = (await client.query('SELECT business_id::text, match_reason FROM marketplace_laundry_delete_183_backup')).rows;
      assert.equal(backups.length, 10);
      assert.equal(backups.find((r) => r.business_id === EXTRA[0]).match_reason, 'name_keyword');
      const deps = (await client.query(`SELECT source_table, on_delete FROM marketplace_laundry_delete_183_dependents ORDER BY source_table`)).rows;
      assert.deepEqual(deps.map((r) => `${r.source_table}:${r.on_delete}`), [
        'marketplace_claims:cascade', 'marketplace_edit_tokens:cascade', 'marketplace_events:set_null', 'marketplace_leads:set_null',
        'marketplace_owner_notifications:cascade', 'marketplace_payments:cascade', 'marketplace_reviews:cascade', 'marketplace_verified_waitlist:set_null'
      ]);
      // The other business keeps its review; the lead stays but loses the link.
      assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM marketplace_reviews')).rows[0].n, 1);
      assert.equal((await client.query('SELECT business_id FROM marketplace_leads')).rows[0].business_id, null);
    });

    await t.test('a second run changes nothing', async () => {
      const after = await snapshot();
      assert.match(await apply(SQL), /deleted=0 .*dependents_backed_up=0 skipped=0/);
      assert.deepEqual(await snapshot(), after);
    });

    await t.test('the rollback restores every business and dependent row exactly', async () => {
      const notice = await apply(ROLLBACK);
      assert.match(notice, /businesses_restored=10 children_restored=5 links_restored=3/);
      assert.deepEqual(await snapshot(), before);
      assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM marketplace_laundry_delete_183_backup WHERE restored_at IS NULL')).rows[0].n, 0);
      assert.match(await apply(ROLLBACK), /businesses_restored=0 children_restored=0 links_restored=0/);
    });

    await t.test('after a rollback the migration can be applied again', async () => {
      assert.match(await apply(SQL), /deleted=10 .*dependents_backed_up=8/);
      assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM marketplace_businesses')).rows[0].n, KEEP.length);
    });
  } finally {
    if (client) await client.end().catch(() => {});
    if (started) execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-w', '-t', '20', '-m', 'immediate', 'stop'], { stdio: 'pipe' });
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});
