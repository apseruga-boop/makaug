'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { cleanListingTitle } = require('../services/publicListingCopy');

const MIGRATION = path.join(__dirname, '../db/migrations/172_correct_listings_skipped_by_170.sql');
const PREVIOUS = path.join(__dirname, '../db/migrations/170_correct_remaining_mislabelled_listings.sql');
const ROLLBACK = path.join(__dirname, '../scripts/rollback-172-listing-corrections.sql');
const KOLOLO = '950e10f7-fc22-4ef6-9b88-d39dc825d2cb';
const NTINDA = 'bfbc521d-9f76-4caf-a30c-d8fedeb4cd78';
const KYANJA = '8277cd47-12fe-4702-8d03-89539766fadb';
const NAALYA_HOUSE = '6927c520-ca3f-4f45-8004-d562d119cac0';
const KITUKUTWE = '08f29aca-7e92-401f-ad90-f8636830e88c';
const BWEBAJJA = 'f05f3a50-6786-43bd-a4d2-da6e8ba330b6';
const BULINDO = '7c066fe5-af0d-476c-8648-829e2291525d';
const MUTUNGO = '84967db4-d0e7-473b-a064-01e8c47b7f3a';
const DUP = '15ca0488-2702-4a93-8dd8-c30225d65c8d';
const DUP_KEEPER = '250495cb-ddef-4499-a6d8-b977c2287193';
const LUWERO_DUP = '42f256d4-24f7-4adb-82a0-7875caef88fc';
const LUWERO_KEEPER = 'df969b6a-ff97-4ba8-ab3c-c70c8b184465';
const DELETED_ROW = '6f7186ab-a57a-455f-83de-70ae756f24fb';
const DECOY = '00000000-0000-4000-8000-000000000172';
const CUTOFF = '2026-10-24 09:51:00+01';
const PG_BIN = [process.env.LFM_PG_BIN, '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/18/bin', '/opt/homebrew/opt/postgresql@16/bin']
  .filter(Boolean)
  .find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));

// Production stored shapes. The public API rewrites these titles, which is why
// migration 170's expect-title guard skipped the row.
const STORED = {
  '6927c520-ca3f-4f45-8004-d562d119cac0': { title: 'Commercial property in Naalya', property_type: 'commercial_land', area: 'Naalya', district: 'Wakiso', canonical: 'wakiso:gayaza', bedrooms: 4, transaction_type: 'sale', latitude: 0.452, longitude: 32.606 },
  '950e10f7-fc22-4ef6-9b88-d39dc825d2cb': { title: 'Commercial property in Kololo', property_type: 'commercial_land', area: 'Kololo', district: 'Kampala', canonical: 'kampala:kololo', bedrooms: 15, transaction_type: 'sale' },
  '8277cd47-12fe-4702-8d03-89539766fadb': { title: 'Commercial property in Kyanja', property_type: 'commercial_land', area: 'Kyanja', district: 'Kampala', canonical: 'kampala:kyanja', bedrooms: null, transaction_type: 'sale' },
  'bfbc521d-9f76-4caf-a30c-d8fedeb4cd78': { title: 'Commercial property in Ntinda', property_type: 'commercial_land', area: 'Ntinda', district: 'Kampala', canonical: 'kampala:ntinda', bedrooms: null, transaction_type: 'sale' },
  '496006a9-d203-437c-a722-d99fe7d8df03': { title: 'Commercial property in Seeta', property_type: 'other', area: 'Seeta', district: 'Mukono', canonical: 'mukono:seeta', bedrooms: 3, transaction_type: 'sale' },
  'df969b6a-ff97-4ba8-ab3c-c70c8b184465': { title: 'Commercial property in Kikyusa', property_type: 'commercial_land', area: 'Luwero', district: 'Luwero', canonical: 'luwero:luwero', bedrooms: null, transaction_type: 'sale' },
  '6f7186ab-a57a-455f-83de-70ae756f24fb': { title: 'Commercial property in Kikyusa', property_type: 'commercial_land', area: 'Luwero', district: 'Luwero', canonical: 'luwero:luwero', bedrooms: null, transaction_type: 'sale' },
  '84967db4-d0e7-473b-a064-01e8c47b7f3a': { title: 'property for rent in Mutungo', property_type: 'apartment', area: 'Mutungo', district: 'Kisoro', canonical: 'kisoro:cyanika', bedrooms: null, transaction_type: null },
  '72ee6627-ba07-4f70-a596-c8c4edafdcec': { title: 'property for rent in Mutungo', property_type: 'apartment', area: 'Mutungo', district: 'Kisoro', canonical: 'kisoro:cyanika', bedrooms: null, transaction_type: null },
  '08f29aca-7e92-401f-ad90-f8636830e88c': { title: '4-bed property for sale in Kitukutwe', property_type: 'house', area: 'Kitukutwe', district: 'Wakiso', canonical: 'wakiso:gayaza', bedrooms: 4, transaction_type: null },
  'f05f3a50-6786-43bd-a4d2-da6e8ba330b6': { title: '3-bed property for sale in Bwebajja', property_type: 'house', area: 'Bwebajja', district: 'Wakiso', canonical: 'wakiso:gayaza', bedrooms: 3, transaction_type: null, latitude: 0.452, longitude: 32.606 },
  'c35a0d7e-6f89-4c56-bee3-a498ae7f0f22': { title: 'property for sale in Nabusugwe', property_type: 'house', area: 'Nabusugwe', district: 'Wakiso', canonical: 'wakiso:gayaza', bedrooms: null, transaction_type: null },
  '7c066fe5-af0d-476c-8648-829e2291525d': { title: '3-bed property for sale in Bulindo', property_type: 'house', area: 'Bulindo', district: 'Wakiso', canonical: 'wakiso:gayaza', bedrooms: 3, transaction_type: null, latitude: 0.452, longitude: 32.606 },
  '15ca0488-2702-4a93-8dd8-c30225d65c8d': { title: '3-bed property for sale in Naguru', property_type: 'Apartment complex', area: 'Naguru', district: 'Kampala', canonical: 'kampala:naguru', bedrooms: null, transaction_type: 'sale' },
  'c7c9e859-2c2a-429a-b565-3a27c4cc3d55': { title: '3-bed property for sale in Naguru', property_type: 'Apartment complex', area: 'Naguru', district: 'Kampala', canonical: 'kampala:naguru', bedrooms: null, transaction_type: 'sale' },
  'd1cf79a4-f7b7-4c86-b538-0e25423a5da2': { title: 'Commercial property in Naalya', property_type: 'commercial_land', area: 'Naalya', district: 'Wakiso', canonical: 'wakiso:naalya', bedrooms: null, transaction_type: 'sale' },
  'c9ab858d-dcb5-4f05-bf62-86daa29b0721': { title: '5-bed property for sale in Naalya', property_type: 'house', area: 'Naalya', district: 'Wakiso', canonical: 'wakiso:naalya', bedrooms: 5, transaction_type: null },
  '42f256d4-24f7-4adb-82a0-7875caef88fc': { title: 'Commercial property in Kikyusa', property_type: 'commercial_land', area: 'Kikyusa', district: 'Nakaseke', canonical: 'nakaseke:kikyusa', bedrooms: null, transaction_type: 'sale' }
};

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

function rowNotices(list) {
  return list.flatMap((message) => {
    const match = String(message).match(/^listing_correction_172 ([0-9a-f-]{36}) (applied|skipped) (\S+)$/);
    return match ? [{ id: match[1], verb: match[2], reason: match[3] }] : [];
  });
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
const specs = loadSpecs(sql, '$listing_corrections_172$');
const previousSpecs = loadSpecs(previousSql, '$listing_corrections_170$');

test('listing correction 172 is the 18 rows migration 170 skipped', () => {
  assert.equal(specs.length, 18);
  assert.equal(new Set(specs.map((spec) => spec.id)).size, 18);
  const ids = new Set(specs.map((spec) => spec.id));
  for (const id of Object.keys(STORED)) assert.equal(ids.has(id), true, id);
  assert.equal(specs.filter((spec) => spec.action === 'relabel').length, 7);
  assert.equal(specs.filter((spec) => spec.action === 'area').length, 6);
  assert.equal(specs.filter((spec) => spec.action === 'unpublish').length, 5);
  const previousIds = new Set(previousSpecs.filter((spec) => spec.action !== 'skip').map((spec) => spec.id));
  for (const spec of specs) {
    assert.equal(previousIds.has(spec.id), true, spec.id);
    const stored = STORED[spec.id];
    const shown = cleanListingTitle({
      title: stored.title,
      listing_type: spec.expect.listing_type,
      property_type: stored.property_type,
      bedrooms: stored.bedrooms,
      transaction_type: stored.transaction_type,
      price_period: spec.expect.price_period,
      area: stored.area
    });
    assert.equal(shown.toLowerCase(), spec.expect.title.toLowerCase(), spec.id);
    assert.notEqual(stored.title.toLowerCase().replace(/\s+/g, ' ').trim(), spec.expect.title.toLowerCase(), spec.id);
  }
  const ntinda = specs.find((spec) => spec.id === NTINDA);
  assert.equal(ntinda.patch.title, 'Commercial building for sale in Ntinda');
  assert.equal(ntinda.patch.price, undefined);
  assert.equal(ntinda.patch.price_on_application, undefined);
  assert.equal(ntinda.patch.description_prefix_to, undefined);
  const kololo = specs.find((spec) => spec.id === KOLOLO);
  assert.equal(kololo.patch.title, '15-decimal plot for sale in Kololo');
  assert.equal(kololo.patch.bedrooms, null);
  assert.equal(kololo.patch.land_size_value, 15);
  assert.equal(kololo.patch.land_size_unit, 'decimals');
  assert.doesNotMatch(sql, /\blatitude\b/i);
  assert.doesNotMatch(sql, /\blongitude\b/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+properties/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS listing_correction_172_backup/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_172 % applied %'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_172 % skipped deleted'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_172 % skipped already_in_target_state'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_172 % skipped edited_since_2026-10-24_09:51_BST'/);
  assert.match(sql, /TIMESTAMPTZ '2026-10-24 09:51:00\+01'/);
  assert.match(sql, /pg_temp\.norm_listing_title/);
  assert.match(sql, /current_setting\('app\.country_code', true\) IS DISTINCT FROM 'UG'/);
  assert.equal(fs.existsSync(path.join(__dirname, '../db/migrations/171_correct_listings_skipped_by_170.sql')), false);
  assert.equal(fs.existsSync(ROLLBACK), true);
  assert.equal(fs.existsSync(path.join(__dirname, '../db/migrations/rollback-172-listing-corrections.sql')), false);
  assert.match(rollbackSql, /listing_correction_172_backup/);
  assert.match(rollbackSql, /current_setting\('app\.country_code', true\) = 'UG'/);
  assert.doesNotMatch(rollbackSql, /DELETE\s+FROM\s+properties/i);
  assert.doesNotMatch(rollbackSql, /DROP TABLE/i);
  assert.doesNotMatch(JSON.stringify(ntinda.patch), /USD 4,500,000/);
  for (const spec of specs.filter((item) => item.action === 'unpublish')) {
    assert.ok(spec.kept_id && spec.kept_id !== spec.id);
  }
});

test('listing correction 172 applies the stored titles migration 170 rejected', {
  skip: PG_BIN ? false : 'Install PostgreSQL or set LFM_PG_BIN for the isolated database test.',
  timeout: 120000
}, async (t) => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-migration-172-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'socket');
  fs.mkdirSync(socket);
  let client;
  let started = false;
  const notices = [];
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=lfm_172', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    const port = await freePort();
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '20', '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`, 'start'], { stdio: 'pipe' });
    started = true;
    client = new Client({ host: '127.0.0.1', port, user: 'lfm_172', database: 'postgres' });
    await client.connect();
    client.on('notice', (notice) => notices.push(notice.message || String(notice)));
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
        (s.spec->>'id')::uuid,
        s.stored->>'title',
        CASE
          WHEN COALESCE(s.spec->'patch'->>'description_prefix_from', '') <> ''
            THEN s.spec->'patch'->>'description_prefix_from' || 'CAPTION TAIL ' || COALESCE(s.spec->>'evidence', '')
          WHEN COALESCE(s.spec->>'evidence', '') <> '' THEN s.spec->>'evidence'
          ELSE 'listing body'
        END,
        s.spec->'expect'->>'listing_type',
        NULLIF(s.stored->>'transaction_type', ''),
        s.stored->>'property_type',
        CASE WHEN s.stored ? 'bedrooms' AND s.stored->>'bedrooms' IS NOT NULL THEN (s.stored->>'bedrooms')::integer ELSE NULL END,
        NULL,
        CASE
          WHEN COALESCE(s.spec->'expect'->>'price_optional', '') = 'true' THEN (s.spec->'expect'->'price_one_of'->>0)::numeric
          WHEN s.spec->'expect' ? 'price' THEN (s.spec->'expect'->>'price')::numeric
          ELSE NULL
        END,
        CASE
          WHEN COALESCE(s.spec->'expect'->>'price_optional', '') = 'true' THEN (s.spec->'expect'->'price_one_of'->>0)::numeric
          WHEN s.spec->'expect' ? 'price' THEN (s.spec->'expect'->>'price')::numeric
          ELSE NULL
        END,
        'UGX', 'UGX',
        NULLIF(s.spec->'expect'->>'price_period', ''),
        FALSE,
        s.stored->>'area',
        s.stored->>'district',
        CASE WHEN s.stored ? 'latitude' THEN (s.stored->>'latitude')::numeric ELSE NULL END,
        CASE WHEN s.stored ? 'longitude' THEN (s.stored->>'longitude')::numeric ELSE NULL END,
        'approved', 'approved',
        jsonb_build_object('canonical_location_id', s.stored->>'canonical', 'source_caption', COALESCE(s.spec->>'evidence', '')),
        TIMESTAMPTZ '2026-10-23 06:21:45+00'
      FROM (
        SELECT spec.value AS spec, stored.value AS stored
        FROM jsonb_array_elements($1::jsonb) spec(value)
        JOIN jsonb_each($2::jsonb) stored(key, value) ON stored.key = spec.value->>'id'
      ) s
    `, [JSON.stringify(specs), JSON.stringify(STORED)]);
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
      ) VALUES (
        $1::uuid, 'Commercial property in Kololo', 'Size 15 decimals decoy', 'commercial',
        1349000000, 'once', 'Kololo', 'Kampala', 'approved', 'approved', FALSE, '{}'::jsonb,
        TIMESTAMPTZ '2026-10-01 00:00:00+00'
      )
    `, [DECOY]);

    const apply = async (statement, country = 'UG') => {
      const start = notices.length;
      await client.query("SELECT set_config('app.country_code', $1, true)", [country]);
      const result = await client.query(statement);
      return { result, notices: notices.slice(start) };
    };
    const row = async (id) => (await client.query('SELECT * FROM properties WHERE id = $1', [id])).rows[0];

    await t.test('170 matches none of the stored titles and 172 corrects all 18', async () => {
      await client.query('BEGIN');
      const first170 = await apply(previousSql);
      assert.equal(updates(first170.result), 0, 'migration 170 still rejects the stored generic title');
      const first = await apply(sql);
      const applied = rowNotices(first.notices).filter((item) => item.verb === 'applied');
      assert.deepEqual(applied.map((item) => item.id).sort(), specs.map((spec) => spec.id).sort(), first.notices.join('\n'));
      const kololo = await row(KOLOLO);
      assert.equal(kololo.title, '15-decimal plot for sale in Kololo');
      assert.equal(kololo.bedrooms, null);
      assert.equal(kololo.listing_type, 'commercial');
      assert.equal(kololo.property_type, 'commercial_land');
      assert.equal(Number(kololo.land_size_value), 15);
      assert.equal(kololo.land_size_unit, 'decimals');
      assert.equal(Number(kololo.price), 1349000000);
      assert.match(kololo.description, /^15-decimal plot for sale in Kololo, Kampala, listed at USD 355,000\. CAPTION TAIL /);
      const ntinda = await row(NTINDA);
      assert.equal(ntinda.title, 'Commercial building for sale in Ntinda');
      assert.equal(ntinda.property_type, 'Commercial building');
      assert.equal(Number(ntinda.price), 4500000);
      assert.equal(ntinda.price_on_application, false);
      assert.equal(ntinda.price_currency, 'UGX');
      assert.doesNotMatch(ntinda.description, /USD 4,500,000/);
      assert.match(ntinda.description, /selling \$4\.5M usd/);
      const kyanja = await row(KYANJA);
      assert.equal(kyanja.title, 'Commercial building for sale in Kyanja');
      assert.equal(Number(kyanja.price), 2400000000);
      assert.equal(Number(kyanja.price_original), 2400000000);
      assert.equal(kyanja.price_on_application, false);
      assert.match(kyanja.description, /^Commercial building for sale in Kyanja, Kampala, listed at UGX 2,400,000,000\. /);
      const house = await row(NAALYA_HOUSE);
      assert.equal(house.title, '4-bed house for sale in Naalya');
      assert.equal(house.listing_type, 'sale');
      assert.equal(house.property_type, 'House');
      assert.equal(house.bathrooms, 4);
      assert.equal(house.extra_fields.canonical_location_id, 'wakiso:naalya');
      assert.equal(Number(house.latitude), 0.452);
      assert.equal(Number(house.longitude), 32.606);
      const kitukutwe = await row(KITUKUTWE);
      assert.equal(kitukutwe.title, '4-bed property for sale in Kitukutwe');
      assert.equal(kitukutwe.area, 'Kitukutwe');
      assert.equal(kitukutwe.extra_fields.canonical_location_id, 'wakiso:kitukutwe');
      assert.equal(Number(kitukutwe.price), 285000000);
      const movedPin = await row(BWEBAJJA);
      assert.equal(Number(movedPin.latitude), 0.452);
      assert.equal(Number(movedPin.longitude), 32.606);
      assert.equal(movedPin.extra_fields.canonical_location_id, 'wakiso:bwebajja');
      assert.equal(Number((await row(BULINDO)).latitude), 0.452);
      const mutungo = await row(MUTUNGO);
      assert.equal(mutungo.title, 'property for rent in Mutungo');
      assert.equal(mutungo.district, 'Kampala');
      assert.equal(mutungo.extra_fields.canonical_location_id, 'kampala:mutungo');
      assert.match(mutungo.description, /^Apartment for rent in Mutungo, Kampala, listed at UGX 500,000\. /);
      const duplicate = await row(DUP);
      assert.equal(duplicate.status, 'hidden');
      assert.equal(duplicate.moderation_stage, 'hidden');
      assert.equal(duplicate.title, '3-bed property for sale in Naguru');
      assert.equal(duplicate.extra_fields.listing_correction_172.kept_property_id, DUP_KEEPER);
      assert.equal((await row(DUP_KEEPER)).status, 'approved');
      const luweroDup = await row(LUWERO_DUP);
      assert.equal(luweroDup.status, 'hidden');
      assert.equal(luweroDup.extra_fields.listing_correction_172.kept_property_id, LUWERO_KEEPER);
      const luweroKeeper = await row(LUWERO_KEEPER);
      assert.equal(luweroKeeper.status, 'approved');
      assert.equal(luweroKeeper.title, '200 acres of commercial land for sale in Kamira');
      assert.equal(luweroKeeper.area, 'Kamira');
      assert.equal((await row(DECOY)).title, 'Commercial property in Kololo');
      assert.equal((await row(DECOY)).extra_fields.listing_correction_172, undefined);
      const backup = await client.query('SELECT COUNT(*)::int AS n FROM listing_correction_172_backup');
      assert.equal(backup.rows[0].n, 18);
      const stampedAt = kololo.updated_at.toISOString();
      const second = await apply(sql);
      const skipped = rowNotices(second.notices);
      assert.equal(skipped.length, 18, second.notices.join('\n'));
      assert.equal(skipped.every((item) => item.verb === 'skipped' && item.reason === 'already_in_target_state'), true);
      assert.equal((await row(KOLOLO)).updated_at.toISOString(), stampedAt);
      assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM listing_correction_172_backup')).rows[0].n, 18);
      assert.equal(updates(await client.query(rollbackSql)), 18);
      assert.equal((await row(KOLOLO)).title, 'Commercial property in Kololo');
      assert.equal((await row(KOLOLO)).bedrooms, 15);
      assert.equal((await row(NTINDA)).title, 'Commercial property in Ntinda');
      assert.equal(Number((await row(NTINDA)).price), 4500000);
      assert.equal((await row(DUP)).status, 'approved');
      assert.equal((await row(KITUKUTWE)).extra_fields.canonical_location_id, 'wakiso:gayaza');
      assert.equal((await row(KYANJA)).title, 'Commercial property in Kyanja');
      assert.equal(Number((await row(KYANJA)).price), 24000000);
      await client.query('ROLLBACK');
    });

    await t.test('a normalised target title is already applied, ahead of a later edit', async () => {
      await client.query('BEGIN');
      await client.query(
        `UPDATE properties
         SET title = $2,
             listing_type = 'commercial',
             property_type = 'commercial_land',
             transaction_type = 'sale',
             bedrooms = NULL,
             land_size_value = 15,
             land_size_unit = 'decimals',
             description = '15-decimal plot for sale in Kololo, Kampala, listed at USD 355,000. already done',
             updated_at = TIMESTAMPTZ '2026-10-24 12:00:00+01'
         WHERE id = $1`,
        [KOLOLO, '  15-DECIMAL\u00A0plot   for sale in Kololo ']
      );
      const run = await apply(sql);
      const kololoNotice = rowNotices(run.notices).find((item) => item.id === KOLOLO);
      assert.equal(kololoNotice.reason, 'already_in_target_state');
      assert.equal((await row(KOLOLO)).title, '  15-DECIMAL\u00A0plot   for sale in Kololo ');
      assert.equal((await row(KOLOLO)).bedrooms, null);
      await client.query('ROLLBACK');
    });

    await t.test('an edit after 2026-10-24 09:51 BST skips that row only', async () => {
      await client.query('BEGIN');
      await client.query(
        `UPDATE properties SET updated_at = TIMESTAMPTZ '2026-10-24 09:52:00+01' WHERE id = $1`,
        [KYANJA]
      );
      const run = await apply(sql);
      const noticesById = new Map(rowNotices(run.notices).map((item) => [item.id, item]));
      assert.equal(noticesById.get(KYANJA).reason, 'edited_since_2026-10-24_09:51_BST');
      assert.equal((await row(KYANJA)).title, 'Commercial property in Kyanja');
      assert.equal(Number((await row(KYANJA)).price), 24000000);
      assert.equal((await row(KOLOLO)).title, '15-decimal plot for sale in Kololo');
      assert.equal(noticesById.get(KOLOLO).verb, 'applied');
      await client.query('ROLLBACK');
    });

    await t.test('a missing row is skipped as deleted and the other rows still apply', async () => {
      await client.query('BEGIN');
      await client.query('DELETE FROM properties WHERE id = $1', [DELETED_ROW]);
      const run = await apply(sql);
      const noticesById = new Map(rowNotices(run.notices).map((item) => [item.id, item]));
      assert.equal(noticesById.get(DELETED_ROW).reason, 'deleted');
      assert.equal(noticesById.get(KOLOLO).verb, 'applied');
      assert.equal((await row(DELETED_ROW)), undefined);
      await client.query('ROLLBACK');
    });

    await t.test('a duplicate stays live when its keeper is not public', async () => {
      await client.query('BEGIN');
      await client.query("UPDATE properties SET status = 'draft' WHERE id = $1", [DUP_KEEPER]);
      const run = await apply(sql);
      const noticesById = new Map(rowNotices(run.notices).map((item) => [item.id, item]));
      assert.equal(noticesById.get(DUP).reason, 'keeper_not_public');
      assert.equal(noticesById.get('c7c9e859-2c2a-429a-b565-3a27c4cc3d55').reason, 'keeper_not_public');
      assert.equal((await row(DUP)).status, 'approved');
      assert.equal(noticesById.get(LUWERO_DUP).verb, 'applied');
      await client.query('ROLLBACK');
    });

    await t.test('country guard rejects ZA and an unset country', async () => {
      for (const country of ['ZA', '']) {
        await client.query('BEGIN');
        const run = await apply(sql, country);
        assert.match(run.notices.join('\n'), /country_not_ug/);
        assert.equal(rowNotices(run.notices).length, 0);
        assert.equal((await row(KOLOLO)).title, 'Commercial property in Kololo');
        await client.query('ROLLBACK');
      }
    });

    await t.test('rollback leaves a later edit in place', async () => {
      await client.query('BEGIN');
      await apply(sql);
      await client.query("UPDATE properties SET updated_at = updated_at + INTERVAL '1 second' WHERE id = $1", [DUP]);
      assert.equal(updates(await client.query(rollbackSql)), 17);
      assert.equal((await row(DUP)).status, 'hidden');
      assert.equal((await row(KOLOLO)).title, 'Commercial property in Kololo');
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
