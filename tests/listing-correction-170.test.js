'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const MIGRATION = path.join(__dirname, '../db/migrations/170_correct_remaining_mislabelled_listings.sql');
const PREVIOUS = path.join(__dirname, '../db/migrations/169_correct_mislabelled_listings_and_duplicates.sql');
const ROLLBACK = path.join(__dirname, '../scripts/rollback-170-listing-corrections.sql');
const DOUBLE_UNITS = 'c25256a2-82e1-4668-8afc-48c4801d88d3';
const KOLOLO = '950e10f7-fc22-4ef6-9b88-d39dc825d2cb';
const NTINDA = 'bfbc521d-9f76-4caf-a30c-d8fedeb4cd78';
const PLOT_BEDS = 'c3499df6-955d-468d-93fd-1624500edf48';
const KITUKUTWE = '08f29aca-7e92-401f-ad90-f8636830e88c';
const DUP = '15ca0488-2702-4a93-8dd8-c30225d65c8d';
const DUP_KEEPER = '250495cb-ddef-4499-a6d8-b977c2287193';
const KAZI = '31846e1b-167a-472b-b197-b16d48bed01b';
const BRIAN = '7316f714-29eb-46fe-8bb2-2752108eed61';
const ALREADY = '01bf0f1d-9f8e-4cb8-8929-c8bb1e41aa2c';
const DECOY = '00000000-0000-4000-8000-000000000170';
const PG_BIN = [process.env.LFM_PG_BIN, '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/18/bin', '/opt/homebrew/opt/postgresql@16/bin']
  .filter(Boolean)
  .find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));

function loadSpecs(sql, tag) {
  const open = sql.indexOf(tag);
  assert.ok(open >= 0, `${tag} missing`);
  const from = open + tag.length;
  const close = sql.indexOf(tag, from);
  assert.ok(close > from, `${tag} is not closed`);
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
const previousSql = fs.readFileSync(PREVIOUS, 'utf8');
const rollbackSql = fs.readFileSync(ROLLBACK, 'utf8');
const specs = loadSpecs(sql, '$listing_corrections_170$');
const applied = specs.filter((spec) => spec.action !== 'skip');

test('listing correction 170 finishes 169 without repeating it or deleting rows', () => {
  const ids = applied.map((spec) => spec.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(applied.length, 50);
  const ntindaSpec = specs.find((spec) => spec.id === NTINDA);
  assert.equal(ntindaSpec.action, 'relabel');
  assert.equal(ntindaSpec.patch.title, 'Commercial building for sale in Ntinda');
  assert.equal(ntindaSpec.patch.property_type, 'Commercial building');
  assert.equal(ntindaSpec.patch.price, undefined);
  assert.equal(ntindaSpec.patch.price_on_application, undefined);
  assert.equal(ntindaSpec.patch.description_prefix_to, undefined);
  assert.doesNotMatch(sql, /17100000000/);
  assert.doesNotMatch(JSON.stringify(ntindaSpec.patch), /USD 4,500,000/);
  assert.equal(specs.filter((spec) => spec.action === 'skip').length, 2);
  assert.equal(specs.filter((spec) => spec.action === 'relabel').length, 15);
  assert.equal(specs.filter((spec) => spec.action === 'area').length, 14);
  assert.equal(specs.filter((spec) => spec.action === 'clear_bedrooms').length, 6);
  assert.equal(specs.filter((spec) => spec.action === 'unpublish').length, 15);
  assert.equal(specs.some((spec) => spec.id === ALREADY), false);
  assert.equal(specs.some((spec) => spec.id.startsWith('2da4bffc')), false);
  assert.equal(specs.some((spec) => spec.id === '3d8ba7e2-2081-484d-a79c-c8ad1342c30d'), false);
  assert.equal(specs.filter((spec) => spec.action === 'skip').map((spec) => spec.id).sort().join(), [BRIAN, KAZI].sort().join());
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+properties/i);
  assert.doesNotMatch(sql, /COALESCE\(p\.area, ''\) = COALESCE\(s\.expect->>'area', ''\)/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS listing_correction_170_backup/);
  assert.match(sql, /NOT \(COALESCE\(p\.extra_fields, '\{\}'::jsonb\) \? 'listing_correction_169'\)/);
  assert.match(sql, /NOT \(COALESCE\(p\.extra_fields, '\{\}'::jsonb\) \? 'listing_correction_170'\)/);
  assert.match(sql, /current_setting\('app\.country_code', true\) = 'UG'/);
  assert.match(sql, /value->>'action' <> 'skip'/);
  assert.match(sql, /WHERE p\.id = e\.id;/);
  assert.doesNotMatch(sql.split('WHERE p.id = e.id;')[1] || '', /backed_up/);
  assert.equal(fs.existsSync(ROLLBACK), true);
  assert.equal(fs.existsSync(path.join(__dirname, '../db/migrations/rollback-170-listing-corrections.sql')), false);
  assert.match(rollbackSql, /listing_correction_170_backup/);
  assert.doesNotMatch(rollbackSql, /DELETE\s+FROM\s+properties/i);
  assert.doesNotMatch(rollbackSql, /DROP TABLE/i);
  for (const spec of applied.filter((item) => item.action === 'unpublish')) {
    assert.ok(spec.kept_id && spec.kept_id !== spec.id);
  }
});

test('listing correction 170 applies rows 169 skipped for area text, then rolls back', {
  skip: PG_BIN ? false : 'Install PostgreSQL or set LFM_PG_BIN for the isolated database test.',
  timeout: 90000
}, async (t) => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-migration-170-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'socket');
  fs.mkdirSync(socket);
  let client;
  let started = false;
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=lfm_170', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    const port = await freePort();
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '20', '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`, 'start'], { stdio: 'pipe' });
    started = true;
    client = new Client({ host: '127.0.0.1', port, user: 'lfm_170', database: 'postgres' });
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
        price_period, price_on_application, area, district, latitude, longitude,
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
        FALSE,
        'stored-area-not-the-public-label',
        'stored-district',
        CASE WHEN s->'expect' ? 'old_latitude' THEN (s->'expect'->>'old_latitude')::numeric ELSE NULL END,
        CASE WHEN s->'expect' ? 'old_longitude' THEN (s->'expect'->>'old_longitude')::numeric ELSE NULL END,
        'approved', 'approved', '{}'::jsonb,
        TIMESTAMPTZ '2026-10-23 06:21:45+00'
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
        id, title, description, listing_type, price, price_period, area, district,
        status, moderation_stage, price_on_application, extra_fields, updated_at
      ) VALUES
        ($1::uuid, '5-Bed property for sale in Najjera', '13Decimals title on the table', 'sale',
          750000000, 'once', 'Najjera', 'Wakiso', 'approved', 'approved', FALSE, '{}'::jsonb,
          TIMESTAMPTZ '2026-09-16 00:00:00+00'),
        ($2::uuid, 'House for sale in Najjera', '650 million slightly negotiable', 'sale',
          650000000, 'once', 'Najjera', 'Wakiso', 'approved', 'approved', FALSE, '{}'::jsonb,
          TIMESTAMPTZ '2026-10-18 00:00:00+00'),
        ($3::uuid, 'Land for sale in Bweyogerere', '8 double units monthly income 3.4 million different plot', 'land',
          320000000, 'once', 'Bweyogerere', 'Wakiso', 'approved', 'approved', FALSE, '{}'::jsonb,
          TIMESTAMPTZ '2026-10-01 00:00:00+00')
    `, [KAZI, BRIAN, DECOY]);

    const apply = async (statement, country = 'UG') => {
      await client.query("SELECT set_config('app.country_code', $1, true)", [country]);
      return updates(await client.query(statement));
    };
    const row = async (id) => (await client.query('SELECT * FROM properties WHERE id = $1', [id])).rows[0];

    await t.test('169 matches none of these rows and 170 corrects them', async () => {
      await client.query('BEGIN');
      await client.query(
        `UPDATE properties
         SET price = 4500000, price_original = 4500000, price_currency = 'UGX',
             price_original_currency = 'UGX', price_on_application = TRUE,
             price_fx_rate_ugx = NULL, price_fx_as_of = NULL,
             description = 'Commercial property in Ntinda, Kampala, listed at UGX 4,500,000. selling $4.5M usd'
         WHERE id = $1`,
        [NTINDA]
      );
      assert.equal(await apply(previousSql), 0, 'migration 169 still rejects stored area text that is not the public label');
      assert.equal(await apply(sql), applied.length);
      const units = await row(DOUBLE_UNITS);
      assert.equal(units.title, '8 double rental units for sale in Bweyogerere');
      assert.equal(units.listing_type, 'sale');
      assert.equal(units.property_type, 'Rental units');
      assert.equal(units.price, '320000000');
      assert.equal(units.land_size_value, '17');
      assert.equal(units.land_size_unit, 'decimals');
      assert.match(units.description, /^8 double rental units for sale in Bweyogerere, Wakiso, listed at UGX 320,000,000\. CAPTION TAIL /);
      const kololo = await row(KOLOLO);
      assert.equal(kololo.title, '15-decimal plot for sale in Kololo');
      assert.equal(kololo.bedrooms, null);
      assert.equal(kololo.listing_type, 'commercial');
      const ntinda = await row(NTINDA);
      assert.equal(ntinda.title, 'Commercial building for sale in Ntinda');
      assert.equal(ntinda.property_type, 'Commercial building');
      assert.equal(ntinda.price, '4500000');
      assert.equal(ntinda.price_on_application, true);
      assert.equal(ntinda.price_original_currency, 'UGX');
      assert.equal(ntinda.price_fx_rate_ugx, null);
      assert.match(ntinda.description, /^Commercial property in Ntinda, Kampala, listed at UGX 4,500,000\. /);
      const plot = await row(PLOT_BEDS);
      assert.equal(plot.bedrooms, null);
      const moved = await row(KITUKUTWE);
      assert.equal(moved.area, 'Kitukutwe');
      assert.equal(moved.extra_fields.canonical_location_id, 'wakiso:kitukutwe');
      const duplicate = await row(DUP);
      assert.equal(duplicate.status, 'hidden');
      assert.equal(duplicate.moderation_stage, 'hidden');
      assert.equal(duplicate.extra_fields.listing_correction_170.kept_property_id, DUP_KEEPER);
      assert.equal((await row(DUP_KEEPER)).status, 'approved');
      assert.equal((await row(KAZI)).status, 'approved');
      assert.equal((await row(KAZI)).price, '750000000');
      assert.equal((await row(BRIAN)).price, '650000000');
      assert.equal((await row(KAZI)).extra_fields.listing_correction_170, undefined);
      assert.equal((await row(DECOY)).title, 'Land for sale in Bweyogerere');
      const backup = await client.query('SELECT COUNT(*)::int AS n FROM listing_correction_170_backup');
      assert.equal(backup.rows[0].n, applied.length);
      assert.equal(await apply(sql), 0, 'a second run changes nothing');
      assert.equal(updates(await client.query(rollbackSql)), applied.length);
      assert.equal((await row(DOUBLE_UNITS)).title, 'Land for sale in Bweyogerere');
      assert.equal((await row(DOUBLE_UNITS)).listing_type, 'land');
      assert.equal((await row(NTINDA)).title, 'Commercial land for sale in Ntinda');
      assert.equal((await row(NTINDA)).price, '4500000');
      assert.equal((await row(NTINDA)).price_on_application, true);
      assert.equal((await row(KOLOLO)).bedrooms, 15);
      assert.equal((await row(DUP)).status, 'approved');
      assert.equal((await row(KITUKUTWE)).area, 'stored-area-not-the-public-label');
      const backupAfter = await client.query('SELECT COUNT(*)::int AS n FROM listing_correction_170_backup');
      assert.equal(backupAfter.rows[0].n, applied.length);
      await client.query('ROLLBACK');
    });

    await t.test('a row already stamped by 169 is left alone', async () => {
      await client.query('BEGIN');
      await client.query(
        "UPDATE properties SET extra_fields = jsonb_build_object('listing_correction_169', jsonb_build_object('action', 'relabel')) WHERE id = $1",
        [KOLOLO]
      );
      assert.equal(await apply(sql), applied.length - 1);
      assert.equal((await row(KOLOLO)).title, '15-bed commercial land for sale in Kololo');
      await client.query('ROLLBACK');
    });

    await t.test('country guard rejects ZA and an unset country', async () => {
      for (const country of ['ZA', '']) {
        await client.query('BEGIN');
        assert.equal(await apply(sql, country), 0);
        assert.equal((await row(DOUBLE_UNITS)).listing_type, 'land');
        await client.query('ROLLBACK');
      }
    });

    await t.test('changed evidence blocks that one row', async () => {
      await client.query('BEGIN');
      await client.query("UPDATE properties SET description = 'unrelated caption' WHERE id = $1", [DUP]);
      assert.equal(await apply(sql), applied.length - 1);
      assert.equal((await row(DUP)).status, 'approved');
      await client.query('ROLLBACK');
    });

    await t.test('a duplicate stays live when its keeper is not public', async () => {
      await client.query('BEGIN');
      try {
        await client.query("UPDATE properties SET status = 'draft' WHERE id = $1", [DUP_KEEPER]);
        // Both Naguru copies (15ca0488 and c7c9e859) keep this one listing.
        assert.equal(await apply(sql), applied.length - 2);
        assert.equal((await row(DUP)).status, 'approved');
        assert.equal((await row('c7c9e859-2c2a-429a-b565-3a27c4cc3d55')).status, 'approved');
      } finally {
        await client.query('ROLLBACK');
      }
    });

    await t.test('rollback refuses a later edit and the wrong country', async () => {
      await client.query('BEGIN');
      assert.equal(await apply(sql), applied.length);
      await client.query("UPDATE properties SET updated_at = updated_at + INTERVAL '1 second' WHERE id = $1", [DUP]);
      assert.equal(updates(await client.query(rollbackSql)), applied.length - 1);
      assert.equal((await row(DUP)).status, 'hidden');
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      assert.equal(await apply(sql), applied.length);
      await client.query("SELECT set_config('app.country_code', 'ZA', true)");
      assert.equal(updates(await client.query(rollbackSql)), 0);
      assert.equal((await row(DOUBLE_UNITS)).title, '8 double rental units for sale in Bweyogerere');
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
