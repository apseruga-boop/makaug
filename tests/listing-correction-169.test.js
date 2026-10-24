'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const MIGRATION = path.join(__dirname, '../db/migrations/169_correct_mislabelled_listings_and_duplicates.sql');
const ROLLBACK = path.join(__dirname, '../scripts/rollback-169-listing-corrections.sql');
const BWEYOGERERE = '2da4bffc-d685-480f-96ec-a071a64d3792';
const KOLOLO = '950e10f7-fc22-4ef6-9b88-d39dc825d2cb';
const NTINDA_BUILDING = 'bfbc521d-9f76-4caf-a30c-d8fedeb4cd78';
const KYANJA_RENT = '01bf0f1d-9f8e-4cb8-8929-c8bb1e41aa2c';
const PLOT_BEDS = 'c3499df6-955d-468d-93fd-1624500edf48';
const NAMUGONGO = '1f511792-551c-488d-bddf-461e86f13fd5';
const NAALYA_HOUSE = '6927c520-ca3f-4f45-8004-d562d119cac0';
const DUP = '57344404-9f57-4030-8bb4-485e606da27e';
const DUP_KEEPER = '723bb908-a360-47db-ae4a-b6e893693a6b';
const SKIP = '69c7ccb6-15be-4c48-baca-e7566753181f';
const DECOY = '00000000-0000-4000-8000-000000000169';
const PG_BIN = [process.env.LFM_PG_BIN, '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/18/bin', '/opt/homebrew/opt/postgresql@16/bin']
  .filter(Boolean)
  .find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));

function loadSpecs(sql) {
  const open = sql.indexOf('$listing_corrections$');
  assert.ok(open >= 0, 'migration payload tag missing');
  const from = open + '$listing_corrections$'.length;
  const close = sql.indexOf('$listing_corrections$', from);
  assert.ok(close > from, 'migration payload tag is not closed');
  return JSON.parse(sql.slice(from, close));
}

function updates(result) {
  return (Array.isArray(result) ? result : [result])
    .filter((item) => item && item.command === 'UPDATE')
    .reduce((sum, item) => sum + item.rowCount, 0);
}

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

const sql = fs.readFileSync(MIGRATION, 'utf8');
const rollbackSql = fs.readFileSync(ROLLBACK, 'utf8');
const specs = loadSpecs(sql);
const applied = specs.filter((spec) => spec.action !== 'skip');

test('listing correction 169 is idempotent, keyed, and does not delete rows', () => {
  const ids = applied.map((spec) => spec.id);
  assert.equal(new Set(ids).size, ids.length, 'each applied property id appears once');
  assert.equal(applied.length, 94);
  assert.equal(specs.filter((spec) => spec.action === 'skip').length, 14);
  assert.equal(specs.filter((spec) => spec.action === 'unpublish').length, 49);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+properties/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS listing_correction_169_backup/);
  assert.match(sql, /current_setting\('app\.country_code', true\) = 'UG'/);
  assert.match(sql, /NOT \(COALESCE\(p\.extra_fields, '\{\}'::jsonb\) \? 'listing_correction_169'\)/);
  assert.match(sql, /value->>'action' <> 'skip'/);
  assert.match(sql, /WHEN e\.action = 'unpublish' THEN 'hidden'/);
  assert.match(sql, /WHERE p\.id = e\.id;/);
  assert.doesNotMatch(sql.split('WHERE p.id = e.id;')[1], /backed_up/);
  assert.equal(fs.existsSync(ROLLBACK), true);
  assert.equal(fs.existsSync(path.join(__dirname, '../db/migrations/rollback-169-listing-corrections.sql')), false);
  assert.match(rollbackSql, /listing_correction_169_backup/);
  assert.match(rollbackSql, /current_setting\('app\.country_code', true\) = 'UG'/);
  assert.doesNotMatch(rollbackSql, /DELETE\s+FROM\s+properties/i);
  assert.doesNotMatch(rollbackSql, /DROP TABLE/i);
  for (const spec of applied.filter((item) => item.action === 'unpublish')) {
    assert.ok(spec.kept_id && spec.kept_id !== spec.id);
  }
  const unpublished = new Set(specs.filter((spec) => spec.action === 'unpublish').map((spec) => spec.id));
  const kept = new Set(specs.filter((spec) => spec.action === 'unpublish').map((spec) => spec.kept_id));
  for (const id of unpublished) assert.equal(kept.has(id), false);
});

test('listing correction 169 applies and rolls back on an isolated database', {
  skip: PG_BIN ? false : 'Install PostgreSQL or set LFM_PG_BIN for the isolated database test.',
  timeout: 90000
}, async (t) => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-migration-169-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'socket');
  fs.mkdirSync(socket);
  let client;
  let started = false;
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=lfm_169', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    const port = await freePort();
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '20', '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`, 'start'], { stdio: 'pipe' });
    started = true;
    client = new Client({ host: '127.0.0.1', port, user: 'lfm_169', database: 'postgres' });
    await client.connect();
    await client.query("SET TIME ZONE 'UTC'");
    await client.query(`CREATE TABLE properties (
      id uuid PRIMARY KEY,
      title text,
      description text,
      listing_type text,
      transaction_type text,
      property_type text,
      bedrooms integer,
      bathrooms integer,
      price numeric,
      price_original numeric,
      price_currency text,
      price_original_currency text,
      price_period text,
      price_fx_rate_ugx numeric,
      price_fx_as_of timestamptz,
      price_on_application boolean NOT NULL DEFAULT FALSE,
      area text,
      district text,
      latitude numeric,
      longitude numeric,
      land_size_value numeric,
      land_size_unit text,
      status text,
      moderation_stage text,
      extra_fields jsonb,
      updated_at timestamptz
    )`);
    await client.query(`
      INSERT INTO properties (
        id, title, description, listing_type, transaction_type, property_type,
        bedrooms, bathrooms, price, price_original, price_currency, price_original_currency,
        price_period, price_fx_rate_ugx, price_fx_as_of, price_on_application,
        area, district, latitude, longitude, land_size_value, land_size_unit,
        status, moderation_stage, extra_fields, updated_at
      )
      SELECT
        (s->>'id')::uuid,
        s->'expect'->>'title',
        CASE
          WHEN COALESCE(s->'patch'->>'description_prefix_from', '') <> ''
            THEN s->'patch'->>'description_prefix_from' || 'CAPTION TAIL ' || COALESCE(s->>'evidence', '')
          WHEN COALESCE(s->>'evidence', '') <> '' THEN s->>'evidence'
          ELSE 'listing body'
        END,
        s->'expect'->>'listing_type',
        'sale',
        'Old type',
        CASE WHEN s->'expect' ? 'bedrooms' THEN (s->'expect'->>'bedrooms')::integer ELSE NULL END,
        NULL,
        CASE
          WHEN COALESCE(s->'expect'->>'price_optional', '') = 'true' THEN NULL
          WHEN s->'expect' ? 'price' THEN (s->'expect'->>'price')::numeric
          ELSE NULL
        END,
        CASE
          WHEN COALESCE(s->'expect'->>'price_optional', '') = 'true' THEN NULL
          WHEN s->'expect' ? 'price' THEN (s->'expect'->>'price')::numeric
          ELSE NULL
        END,
        'UGX', 'UGX',
        NULLIF(s->'expect'->>'price_period', ''),
        NULL, NULL, FALSE,
        s->'expect'->>'area',
        s->'expect'->>'district',
        CASE WHEN s->'expect' ? 'old_latitude' THEN (s->'expect'->>'old_latitude')::numeric ELSE NULL END,
        CASE WHEN s->'expect' ? 'old_longitude' THEN (s->'expect'->>'old_longitude')::numeric ELSE NULL END,
        NULL, NULL,
        'approved', 'approved', '{}'::jsonb,
        TIMESTAMPTZ '2026-10-01 00:00:00+00'
      FROM jsonb_array_elements($1::jsonb) s
      WHERE s->>'action' <> 'skip'
    `, [JSON.stringify(specs)]);
    await client.query(`
      INSERT INTO properties (
        id, title, description, listing_type, status, moderation_stage,
        price_on_application, extra_fields, updated_at
      )
      SELECT DISTINCT (s->>'kept_id')::uuid, 'Kept copy', 'keeper stays live', 'sale',
        'approved', 'approved', FALSE, '{}'::jsonb, TIMESTAMPTZ '2026-10-01 00:00:00+00'
      FROM jsonb_array_elements($1::jsonb) s
      WHERE s->>'action' = 'unpublish'
        AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.id = (s->>'kept_id')::uuid)
    `, [JSON.stringify(specs)]);
    await client.query(`
      INSERT INTO properties (
        id, title, description, listing_type, price_period, area, district, price,
        status, moderation_stage, price_on_application, extra_fields, updated_at
      ) VALUES (
        $1::uuid, 'Land for sale in Nakawuka', 'different plot, not a duplicate', 'land',
        NULL, NULL, NULL, NULL, 'approved', 'approved', FALSE, '{}'::jsonb,
        TIMESTAMPTZ '2026-10-01 00:00:00+00'
      )
    `, [SKIP]);
    await client.query(`
      INSERT INTO properties (
        id, title, description, listing_type, price, price_period, area, district,
        status, moderation_stage, price_on_application, price_currency, price_original_currency,
        extra_fields, updated_at
      )
      SELECT $2::uuid, 'Land for sale in Bweyogerere changed',
        description, listing_type, price, price_period, area, district,
        status, moderation_stage, price_on_application, price_currency, price_original_currency,
        extra_fields, updated_at
      FROM properties WHERE id = $1::uuid
    `, [BWEYOGERERE, DECOY]);

    const apply = async (country = 'UG') => {
      await client.query("SELECT set_config('app.country_code', $1, true)", [country]);
      return updates(await client.query(sql));
    };
    const row = async (id) => (await client.query('SELECT * FROM properties WHERE id = $1', [id])).rows[0];

    await t.test('corrects labels, clears false bedrooms, moves verified areas, and hides duplicates', async () => {
      await client.query('BEGIN');
      assert.equal(await apply(), applied.length);
      const bweyo = await row(BWEYOGERERE);
      assert.equal(bweyo.title, '5 rental units for sale in Bweyogerere');
      assert.equal(bweyo.listing_type, 'sale');
      assert.equal(bweyo.property_type, 'Rental units');
      assert.match(bweyo.description, /^5 rental units for sale in Bweyogerere, Wakiso, listed at UGX 370,000,000\. CAPTION TAIL /);
      const kololo = await row(KOLOLO);
      assert.equal(kololo.title, '15-decimal plot for sale in Kololo');
      assert.equal(kololo.listing_type, 'commercial');
      assert.equal(kololo.bedrooms, null);
      assert.equal(kololo.land_size_value, '15');
      const building = await row(NTINDA_BUILDING);
      assert.equal(building.price, '17100000000');
      assert.equal(building.price_original, '4500000');
      assert.equal(building.price_original_currency, 'USD');
      assert.equal(building.price_fx_rate_ugx, '3800');
      assert.equal(building.price_on_application, false);
      const rentNote = await row(KYANJA_RENT);
      assert.equal(rentNote.listing_type, 'land');
      assert.equal(rentNote.price, '400000000');
      assert.match(rentNote.description, /25-decimal plot/);
      assert.doesNotMatch(rentNote.description, /Apartment for rent/);
      const plot = await row(PLOT_BEDS);
      assert.equal(plot.bedrooms, null);
      assert.equal(plot.title, '14-Decimal plot on Namugongo Road in Mbalwa');
      const namugongo = await row(NAMUGONGO);
      assert.equal(namugongo.area, 'Namugongo');
      assert.equal(namugongo.extra_fields.canonical_location_id, 'wakiso:namugongo');
      assert.equal(Number(namugongo.latitude), 0.363);
      const duplicate = await row(DUP);
      assert.equal(duplicate.status, 'hidden');
      assert.equal(duplicate.moderation_stage, 'hidden');
      assert.equal(duplicate.title, 'Bungalow for sale in Kiwatule');
      assert.equal(duplicate.extra_fields.listing_correction_169.kept_property_id, DUP_KEEPER);
      assert.equal(duplicate.extra_fields.listing_correction_169.action, 'unpublish');
      assert.equal((await row(DUP_KEEPER)).status, 'approved');
      const skipped = await row(SKIP);
      assert.equal(skipped.extra_fields.listing_correction_169, undefined);
      assert.equal(skipped.title, 'Land for sale in Nakawuka');
      const decoy = await row(DECOY);
      assert.equal(decoy.title, 'Land for sale in Bweyogerere changed');
      assert.equal(decoy.extra_fields.listing_correction_169, undefined);
      const backup = await client.query('SELECT COUNT(*)::int AS n FROM listing_correction_169_backup');
      assert.equal(backup.rows[0].n, applied.length);
      assert.equal(await apply(), 0, 'a second run changes nothing');
      assert.equal(updates(await client.query(rollbackSql)), applied.length);
      assert.equal((await row(BWEYOGERERE)).title, 'Land for sale in Bweyogerere');
      assert.equal((await row(DUP)).status, 'approved');
      assert.equal((await row(PLOT_BEDS)).bedrooms, 1);
      assert.equal((await row(NAMUGONGO)).area, 'Entebbe');
      const backupAfter = await client.query('SELECT COUNT(*)::int AS n FROM listing_correction_169_backup');
      assert.equal(backupAfter.rows[0].n, applied.length, 'rollback keeps the backup table');
      assert.equal(updates(await client.query(rollbackSql)), 0);
      await client.query('ROLLBACK');
    });

    await t.test('country guard rejects ZA and an unset country', async () => {
      for (const country of ['ZA', '']) {
        await client.query('BEGIN');
        assert.equal(await apply(country), 0);
        assert.equal((await row(BWEYOGERERE)).title, 'Land for sale in Bweyogerere');
        await client.query('ROLLBACK');
      }
    });

    await t.test('a moved pin is left alone when it is no longer the old centroid', async () => {
      await client.query('BEGIN');
      await client.query('UPDATE properties SET latitude = 9, longitude = 9 WHERE id = $1', [NAALYA_HOUSE]);
      assert.equal(await apply(), applied.length);
      const house = await row(NAALYA_HOUSE);
      assert.equal(house.title, '4-bed house for sale in Naalya');
      assert.equal(Number(house.latitude), 9);
      assert.equal(Number(house.longitude), 9);
      await client.query('ROLLBACK');
    });

    await t.test('a duplicate stays live when its keeper is not public', async () => {
      await client.query('BEGIN');
      await client.query("UPDATE properties SET status = 'draft' WHERE id = $1", [DUP_KEEPER]);
      const changed = await apply();
      assert.equal(changed, applied.length - 1);
      const duplicate = await row(DUP);
      assert.equal(duplicate.status, 'approved');
      assert.equal(duplicate.extra_fields.listing_correction_169, undefined);
      await client.query('ROLLBACK');
    });

    await t.test('changed evidence blocks that one row', async () => {
      await client.query('BEGIN');
      await client.query("UPDATE properties SET description = 'unrelated caption' WHERE id = $1", [DUP]);
      assert.equal(await apply(), applied.length - 1);
      assert.equal((await row(DUP)).status, 'approved');
      await client.query('ROLLBACK');
    });

    await t.test('rollback refuses a later edit and the wrong country', async () => {
      await client.query('BEGIN');
      assert.equal(await apply(), applied.length);
      await client.query("UPDATE properties SET updated_at = updated_at + INTERVAL '1 second' WHERE id = $1", [DUP]);
      assert.equal(updates(await client.query(rollbackSql)), applied.length - 1);
      assert.equal((await row(DUP)).status, 'hidden');
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      assert.equal(await apply(), applied.length);
      await client.query("SELECT set_config('app.country_code', 'ZA', true)");
      assert.equal(updates(await client.query(rollbackSql)), 0);
      assert.equal((await row(BWEYOGERERE)).title, '5 rental units for sale in Bweyogerere');
      await client.query('ROLLBACK');
    });
  } finally {
    if (client) await client.end().catch(() => {});
    if (started) {
      try {
        execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-w', '-m', 'immediate', 'stop'], { stdio: 'pipe' });
      } catch (error) {
        fs.writeFileSync(path.join(cluster, 'stop-error.txt'), String(error.stderr || error.message || error));
      }
    }
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});
