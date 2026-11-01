'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/195_listing_correction_1101.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(__dirname, '../scripts/rollback-195-listing-correction-1101.sql'), 'utf8');
const PG_BIN = [process.env.LFM_PG_BIN, '/opt/homebrew/opt/postgresql@18/bin', '/usr/lib/postgresql/18/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin']
  .filter(Boolean).find((dir) => fs.existsSync(path.join(dir, 'initdb')));

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

const staleReview = { ok: false, issue_codes: ['price_period_conflicts_with_category'], issues: [{ code: 'price_period_conflicts_with_category' }], classification: { listing_type: 'land' } };
const ROWS = [
  { ref: 'MK-20261031-0C0E8C', status: 'pending', listing_type: 'land', price: 58231200, price_original: 15324, price_original_currency: 'USD', price_fx_rate_ugx: 3800, price_period: 'once', price_unit: null, area: 'Entebbe', title: 'Plot', extra: { keep: 1 } },
  { ref: 'MK-20261031-BE17A0', status: 'pending', listing_type: 'land', price: 16000000, price_original: 16000000, price_original_currency: 'UGX', price_period: 'acre', price_unit: null, area: 'Mpangalo', title: 'Land', extra: { keep: 1 } },
  { ref: 'MK-20261030-C95C82', status: 'approved', listing_type: 'land', price: 24000000, price_original: 24000000, price_original_currency: 'UGX', price_period: 'once', price_unit: 'per_acre', area: 'Tororo Eastern', title: 'Land', extra: { keep: 1, data_integrity_review: staleReview } },
  { ref: 'MK-20261031-46B103', status: 'approved', listing_type: 'sale', price: 350000000, price_original: 350000000, price_original_currency: 'UGX', price_period: 'once', price_unit: 'total', area: 'Nakwero', district: 'Wakiso', title: 'House for sale in Nakweru', extra: { keep: 1, area_highlights: ' is a Uganda property search area.' } },
  { ref: 'MK-20261031-19F6B4', status: 'approved', listing_type: 'sale', price: 1500000000, price_original: null, price_original_currency: 'UGX', price_period: 'once', price_unit: 'total', area: 'Kyanja', title: 'Block', extra: { keep: 1, data_integrity_review: staleReview } }
];

test('listing correction 195 applies guarded fixes, is idempotent and rolls back', {
  skip: PG_BIN ? false : 'Set LFM_PG_BIN to an installed PostgreSQL bin directory', timeout: 120000
}, async (t) => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-195-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'socket');
  fs.mkdirSync(socket);
  let client;
  let started = false;
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=c195', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    const port = await freePort();
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'pg.log'), '-w', '-o', `-h 127.0.0.1 -p ${port} -k ${socket} -c fsync=off`, 'start'], { stdio: 'pipe' });
    started = true;
    client = new Client({ host: '127.0.0.1', port, user: 'c195', database: 'postgres' });
    await client.connect();
    await client.query(`
      CREATE TABLE properties (
        id uuid PRIMARY KEY, inquiry_reference text, title text, status text, listing_type text,
        price bigint, price_currency text, price_original numeric, price_original_currency text,
        price_fx_rate_ugx numeric, price_fx_as_of timestamptz, price_period text, price_unit text,
        area text, district text, extra_fields jsonb, updated_at timestamptz
      );
      CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=NOW(); RETURN NEW; END $$;
      CREATE TRIGGER trg_properties_updated_at BEFORE UPDATE ON properties FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);
    async function seed(overrides = {}) {
      await client.query('TRUNCATE properties; DROP TABLE IF EXISTS listing_correction_195_backup');
      for (const base of ROWS) {
        const r = { ...base, ...(overrides[base.ref] || {}) };
        await client.query(`INSERT INTO properties VALUES ($1,$2,$3,$4,$5,$6,'UGX',$7,$8,$9,NULL,$10,$11,$12,$13,$14,'2026-10-31T10:00:00Z')`,
          [crypto.randomUUID(), r.ref, r.title, r.status, r.listing_type, r.price, r.price_original, r.price_original_currency,
            r.price_fx_rate_ugx || null, r.price_period, r.price_unit, r.area, r.district || 'Wakiso', JSON.stringify(r.extra)]);
      }
    }
    const row = async (ref) => (await client.query('SELECT to_jsonb(p) d FROM properties p WHERE inquiry_reference=$1', [ref])).rows[0].d;
    const all = async () => (await client.query('SELECT to_jsonb(p) d FROM properties p ORDER BY inquiry_reference')).rows.map((r) => r.d);
    async function apply(text, country = 'UG') {
      await client.query('BEGIN');
      try {
        await client.query("SELECT set_config('app.country_code',$1,true)", [country]);
        await client.query(text);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }

    await t.test('applies each fix and keeps other facts', async () => {
      await seed();
      await apply(sql);
      const a = await row('MK-20261031-0C0E8C');
      assert.equal(Number(a.price), 65000000);
      assert.equal(a.price_original_currency, 'UGX');
      assert.equal(a.price_fx_rate_ugx, null);
      assert.equal(a.extra_fields.keep, 1);
      assert.equal((await row('MK-20261031-BE17A0')).price_unit, 'per_acre');
      const c = await row('MK-20261030-C95C82');
      assert.equal(c.price_period, 'acre');
      assert.equal(c.extra_fields.data_integrity_review.ok, true);
      assert.deepEqual(c.extra_fields.data_integrity_review.issue_codes, []);
      assert.equal(c.extra_fields.data_integrity_review.classification.listing_type, 'land');
      const n = await row('MK-20261031-46B103');
      assert.equal(n.area, 'Nakweru');
      assert.equal(n.extra_fields.area_highlights, 'Nakweru is a Uganda property search area.');
      assert.equal((await row('MK-20261031-19F6B4')).extra_fields.data_integrity_review.ok, true);
      const after = await all();
      await apply(sql);
      assert.deepEqual(await all(), after);
    });

    await t.test('skips a listing that staff already changed', async () => {
      await seed({ 'MK-20261031-0C0E8C': { price: 70000000 } });
      await apply(sql);
      assert.equal(Number((await row('MK-20261031-0C0E8C')).price), 70000000);
      assert.equal((await row('MK-20261031-46B103')).area, 'Nakweru');
    });

    await t.test('does nothing outside Uganda', async () => {
      await seed();
      const before = await all();
      await apply(sql, 'ZA');
      assert.deepEqual(await all(), before);
    });

    await t.test('rollback restores untouched rows only', async () => {
      await seed();
      const before = await all();
      await apply(sql);
      await client.query("UPDATE properties SET title='Staff edit' WHERE inquiry_reference='MK-20261031-BE17A0'");
      await apply(rollback);
      const restored = await all();
      for (const r of restored) {
        const b = before.find((x) => x.inquiry_reference === r.inquiry_reference);
        if (r.inquiry_reference === 'MK-20261031-BE17A0') assert.equal(r.price_unit, 'per_acre');
        else assert.deepEqual(r, b);
      }
    });
  } finally {
    if (client) await client.end().catch(() => {});
    if (started) execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], { stdio: 'pipe' });
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});
