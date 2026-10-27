'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const MIGRATION = path.join(__dirname, '../db/migrations/176_correct_makerere_building_listing.sql');
const ROLLBACK = path.join(__dirname, '../scripts/rollback-176-listing-corrections.sql');
const MIGRATIONS = path.join(__dirname, '../db/migrations');
const MAKERERE = '3d8ba7e2-2081-484d-a79c-c8ad1342c30d';
const KOLOLO = '950e10f7-fc22-4ef6-9b88-d39dc825d2cb';
const OTHER_PROMISE = '81348c47-27a6-47ff-8dd1-445c18eeb36b';
const DECOY = '00000000-0000-4000-8000-000000000176';
const TARGET_TITLE = 'Commercial building (55 rooms) for sale in Makerere';
const HOTEL_TITLE = 'Hotel / hostel (55 rooms) for sale in Makerere';
const LAND_TITLE = 'Land for sale in Makerere';
const HOTEL_PREFIX = 'Hotel / hostel (55 rooms) for sale in Makerere, Kampala, listed at USD 2,000,000. ';
const LAND_PREFIX = 'Land for sale in Makerere, Kampala, listed at USD 2,000,000. ';
const TARGET_PREFIX = 'Commercial building (55 rooms) for sale in Makerere, Kampala, listed at USD 2,000,000. ';
const CAPTION = 'Last price USD 2 M 55 Rooms 1.6 Acres of Mailo land Conference Hall of 350 people Gym Gardens Makerere kikoni. Contact Promise Ahimbisibwe to confirm current availability, full specifications and viewing arrangements.';
const PG_BIN = [process.env.LFM_PG_BIN, '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/18/bin', '/opt/homebrew/opt/postgresql@16/bin']
  .filter(Boolean)
  .find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));

function loadSpec(sql, tag) {
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
    const match = String(message).match(/^listing_correction_176 ([0-9a-f-]{36}) (applied|skipped) (\S+)$/);
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
const rollbackSql = fs.readFileSync(ROLLBACK, 'utf8');
const spec = loadSpec(sql, '$listing_correction_176$');

test('listing correction 176 relabels only the Makerere building', () => {
  const names = fs.readdirSync(MIGRATIONS);
  assert.equal(names.includes('176_correct_makerere_building_listing.sql'), true);
  assert.equal(names.filter((name) => name.startsWith('176_')).length, 1);
  assert.equal(names.includes('174_delete_hidden_duplicate_listings.sql'), true);
  // 173 and 175 are on main. This correction is the only migration after 169
  // that names the Makerere listing. 169 is the earlier hotel/hostel relabel.
  const makerereMigrations = names
    .filter((name) => name.endsWith('.sql'))
    .filter((name) => fs.readFileSync(path.join(MIGRATIONS, name), 'utf8').includes(MAKERERE))
    .sort();
  assert.deepEqual(makerereMigrations, [
    '169_correct_mislabelled_listings_and_duplicates.sql',
    '176_correct_makerere_building_listing.sql',
    // 192 only adds an area-centre pin (it has no pin); it does not relabel.
    '192_auto_pin_unpinned_listings.sql'
  ]);
  assert.equal(spec.id, MAKERERE);
  assert.equal(spec.lister_name, 'Promise Ahimbisibwe');
  assert.deepEqual(spec.source_titles, [LAND_TITLE, HOTEL_TITLE]);
  assert.equal(spec.patch.title, TARGET_TITLE);
  assert.equal(TARGET_TITLE.length <= 60, true);
  assert.match(spec.patch.title, /for sale/);
  assert.equal(spec.patch.listing_type, 'commercial');
  assert.equal(spec.patch.property_type, 'Commercial building');
  assert.equal(spec.patch.transaction_type, 'sale');
  assert.equal(spec.patch.land_size_value, null);
  assert.equal(spec.patch.land_size_unit, null);
  assert.equal(spec.patch.bedrooms, undefined);
  assert.equal(spec.patch.price, undefined);
  assert.equal(spec.patch.description_prefix_to, TARGET_PREFIX);
  assert.equal(JSON.stringify(spec).includes(KOLOLO), false);
  assert.equal(JSON.stringify(spec).includes(OTHER_PROMISE), false);
  assert.match(sql, /15-decimal plot for sale in Kololo/);
  assert.match(sql, /Arthur and Ronald/);
  assert.match(sql, /no rooms column/i);
  assert.match(sql, /SET LOCAL lock_timeout = '8s'/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS listing_correction_176_backup/);
  assert.match(sql, /to_jsonb\(p\)/);
  assert.match(sql, /ON CONFLICT \(property_id\) DO NOTHING/);
  assert.match(sql, /pg_temp\.norm_listing_title_176/);
  assert.match(sql, /current_setting\('app\.country_code', true\) IS DISTINCT FROM 'UG'/);
  assert.match(sql, /DISABLE TRIGGER trg_properties_updated_at/);
  assert.match(sql, /ENABLE TRIGGER trg_properties_updated_at/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_176 % applied %'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_176 % skipped deleted'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_176 % skipped already_in_target_state'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_176 % skipped title_guard'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_176 % skipped lister_guard'/);
  assert.doesNotMatch(sql, /\bbedrooms\s*=/);
  assert.doesNotMatch(sql, /\bbathrooms\s*=/);
  assert.doesNotMatch(sql, /\broom_type\s*=/);
  assert.doesNotMatch(sql, /\broom_arrangement\s*=/);
  assert.doesNotMatch(sql, /\bprice\s*=/);
  assert.doesNotMatch(sql, /\bprice_original\s*=/);
  assert.doesNotMatch(sql, /\bprice_currency\s*=/);
  assert.doesNotMatch(sql, /\blatitude\s*=/);
  assert.doesNotMatch(sql, /\blongitude\s*=/);
  assert.doesNotMatch(sql, /\barea\s*=/);
  assert.doesNotMatch(sql, /\bdistrict\s*=/);
  assert.doesNotMatch(sql, /property_images/);
  assert.doesNotMatch(sql, /video_url\s*=/);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+properties/i);
  assert.doesNotMatch(sql, /whatsapp/i);
  assert.equal(fs.existsSync(ROLLBACK), true);
  assert.equal(fs.existsSync(path.join(MIGRATIONS, 'rollback-176-listing-corrections.sql')), false);
  assert.match(rollbackSql, /listing_correction_176_backup/);
  assert.match(rollbackSql, /current_setting\('app\.country_code', true\) = 'UG'/);
  assert.doesNotMatch(rollbackSql, /DELETE\s+FROM\s+properties/i);
  assert.doesNotMatch(rollbackSql, /DROP TABLE/i);
  assert.doesNotMatch(rollbackSql, /\bprice\s*=/);
  assert.doesNotMatch(rollbackSql, /\blatitude\s*=/);
});

test('listing correction 176 updates the guarded Makerere row and leaves Kololo', {
  skip: PG_BIN ? false : 'Install PostgreSQL or set LFM_PG_BIN for the isolated database test.',
  timeout: 120000
}, async (t) => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-migration-176-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'socket');
  fs.mkdirSync(socket);
  let client;
  let started = false;
  const notices = [];
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=lfm_176', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    const port = await freePort();
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '20', '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`, 'start'], { stdio: 'pipe' });
    started = true;
    client = new Client({ host: '127.0.0.1', port, user: 'lfm_176', database: 'postgres' });
    await client.connect();
    client.on('notice', (notice) => notices.push(notice.message || String(notice)));
    await client.query("SET TIME ZONE 'UTC'");
    await client.query(`
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$
    `);
    await client.query(`CREATE TABLE properties (
      id uuid PRIMARY KEY,
      title text,
      description text,
      listing_type text,
      transaction_type text,
      property_type text,
      bedrooms integer,
      bathrooms integer,
      room_type text,
      room_arrangement text,
      price numeric,
      price_original numeric,
      price_currency text,
      price_original_currency text,
      price_period text,
      price_on_application boolean NOT NULL DEFAULT FALSE,
      area text,
      district text,
      latitude numeric,
      longitude numeric,
      land_size_value numeric,
      land_size_unit text,
      floor_area_sqm numeric,
      status text,
      lister_name text,
      agent_id uuid,
      extra_fields jsonb,
      updated_at timestamptz
    )`);
    await client.query(`
      CREATE TRIGGER trg_properties_updated_at
      BEFORE UPDATE ON properties
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);
    await client.query(`CREATE TABLE property_images (
      id uuid PRIMARY KEY,
      property_id uuid NOT NULL,
      url text NOT NULL
    )`);

    const insertRow = async (row) => {
      await client.query(`
        INSERT INTO properties (
          id, title, description, listing_type, transaction_type, property_type,
          bedrooms, bathrooms, room_type, room_arrangement,
          price, price_original, price_currency, price_original_currency,
          price_period, price_on_application, area, district, latitude, longitude,
          land_size_value, land_size_unit, floor_area_sqm, status, lister_name, agent_id,
          extra_fields, updated_at
        ) VALUES (
          $1::uuid, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13, $14,
          $15, FALSE, $16, $17, $18, $19,
          $20, $21, $22, $23, $24, $25::uuid,
          $26::jsonb, $27::timestamptz
        )
      `, [
        row.id, row.title, row.description, row.listing_type, row.transaction_type, row.property_type,
        row.bedrooms, row.bathrooms ?? null, row.room_type ?? null, row.room_arrangement ?? null,
        row.price, row.price_original, row.price_currency, row.price_original_currency,
        row.price_period, row.area, row.district, row.latitude, row.longitude,
        row.land_size_value, row.land_size_unit, row.floor_area_sqm ?? null, row.status, row.lister_name, row.agent_id,
        JSON.stringify(row.extra_fields || {}), row.updated_at
      ]);
    };

    const makerere = (overrides = {}) => ({
      id: MAKERERE,
      title: HOTEL_TITLE,
      description: `${HOTEL_PREFIX}${CAPTION}`,
      listing_type: 'commercial',
      transaction_type: 'sale',
      property_type: 'hospitality',
      bedrooms: null,
      price: 7600000000,
      price_original: 2000000,
      price_currency: 'UGX',
      price_original_currency: 'USD',
      price_period: 'once',
      area: 'Makerere',
      district: 'Kampala',
      latitude: 0.335,
      longitude: 32.568,
      land_size_value: null,
      land_size_unit: null,
      floor_area_sqm: null,
      status: 'approved',
      lister_name: 'Promise Ahimbisibwe',
      agent_id: '32da8dbd-900e-477a-986d-8dc0a9e5701a',
      extra_fields: {
        canonical_location_id: 'kampala:makerere',
        video_url: 'https://media.makaug.com/makerere-building.mp4'
      },
      updated_at: '2026-10-24 08:09:47.105+00',
      ...overrides
    });

    const seed = async (overrides = {}) => {
      await insertRow(makerere(overrides));
      await insertRow({
        id: KOLOLO,
        title: '15-decimal plot for sale in Kololo',
        description: '15-decimal plot for sale in Kololo, Kampala, listed at USD 355,000. Property for sale in Kololo Size 15 decimals. Price $355,000 Freehold Title Future use: Tear down for new construction (Apartments, Offices, Hotel).',
        listing_type: 'commercial',
        transaction_type: 'sale',
        property_type: 'commercial_land',
        bedrooms: null,
        price: 1349000000,
        price_original: 355000,
        price_currency: 'UGX',
        price_original_currency: 'USD',
        price_period: 'once',
        area: 'Kololo',
        district: 'Kampala',
        latitude: 0.356,
        longitude: 32.612,
        land_size_value: 15,
        land_size_unit: 'decimals',
        status: 'approved',
        lister_name: 'Kimuli Brian',
        agent_id: '5aeed103-cda3-4d75-930c-4c43ee1659eb',
        extra_fields: { canonical_location_id: 'kampala:kololo' },
        updated_at: '2026-10-24 09:17:40.779+00'
      });
      await insertRow({
        id: OTHER_PROMISE,
        title: '55 - Room Commerical property on 1.6 Arces for sale',
        description: 'Rental property in Makerere, Kampala, listed at UGX 7,000,000. House for rent for 7 million.',
        listing_type: 'commercial',
        transaction_type: 'sale',
        property_type: 'hospitality',
        bedrooms: null,
        price: 7556708000,
        price_original: 7556708000,
        price_currency: 'UGX',
        price_original_currency: 'UGX',
        price_period: 'once',
        area: 'Makerere',
        district: 'Kampala',
        latitude: 0.335,
        longitude: 32.568,
        land_size_value: null,
        land_size_unit: null,
        status: 'approved',
        lister_name: 'Promise Ahimbisibwe',
        agent_id: null,
        extra_fields: {},
        updated_at: '2026-10-23 06:21:45.533+00'
      });
      await insertRow({
        id: DECOY,
        title: LAND_TITLE,
        description: `${LAND_PREFIX}decoy caption`,
        listing_type: 'land',
        transaction_type: 'sale',
        property_type: 'land',
        bedrooms: null,
        price: 7600000000,
        price_original: 2000000,
        price_currency: 'UGX',
        price_original_currency: 'USD',
        price_period: 'once',
        area: 'Makerere',
        district: 'Kampala',
        latitude: 0.335,
        longitude: 32.568,
        land_size_value: 1.6,
        land_size_unit: 'acres',
        status: 'approved',
        lister_name: 'Promise Ahimbisibwe',
        agent_id: null,
        extra_fields: {},
        updated_at: '2026-10-01 00:00:00+00'
      });
      await client.query(
        'INSERT INTO property_images (id, property_id, url) VALUES ($1::uuid, $2::uuid, $3)',
        ['0fae1450-497f-4c4e-8105-3bcc851d2eec', MAKERERE, 'https://media.makaug.com/makerere-photo.jpg']
      );
    };

    const apply = async (statement, country = 'UG') => {
      const start = notices.length;
      await client.query("SELECT set_config('app.country_code', $1, true)", [country]);
      const result = await client.query(statement);
      return { result, notices: notices.slice(start) };
    };
    const row = async (id) => (await client.query('SELECT * FROM properties WHERE id = $1', [id])).rows[0];

    await t.test('the live hotel title becomes a commercial building and a second run is a no-op', async () => {
      await client.query('BEGIN');
      await seed();
      const first = await apply(sql);
      const applied = rowNotices(first.notices);
      assert.deepEqual(applied, [{ id: MAKERERE, verb: 'applied', reason: 'relabel' }], first.notices.join('\n'));
      const building = await row(MAKERERE);
      assert.equal(building.title, TARGET_TITLE);
      assert.equal(building.listing_type, 'commercial');
      assert.equal(building.property_type, 'Commercial building');
      assert.equal(building.transaction_type, 'sale');
      assert.equal(building.bedrooms, null);
      assert.equal(building.land_size_value, null);
      assert.equal(building.land_size_unit, null);
      assert.equal(building.price_period, 'once');
      assert.equal(Number(building.price), 7600000000);
      assert.equal(Number(building.price_original), 2000000);
      assert.equal(building.price_currency, 'UGX');
      assert.equal(building.price_original_currency, 'USD');
      assert.equal(building.area, 'Makerere');
      assert.equal(building.district, 'Kampala');
      assert.equal(Number(building.latitude), 0.335);
      assert.equal(Number(building.longitude), 32.568);
      assert.equal(building.lister_name, 'Promise Ahimbisibwe');
      assert.equal(building.agent_id, '32da8dbd-900e-477a-986d-8dc0a9e5701a');
      assert.equal(building.extra_fields.video_url, 'https://media.makaug.com/makerere-building.mp4');
      assert.equal(building.extra_fields.canonical_location_id, 'kampala:makerere');
      assert.equal(building.extra_fields.listing_correction_176.action, 'relabel');
      assert.equal(building.description, `${TARGET_PREFIX}${CAPTION}`);
      assert.equal(building.updated_at.toISOString(), new Date(building.extra_fields.listing_correction_176.applied_at).toISOString());
      const kololo = await row(KOLOLO);
      assert.equal(kololo.title, '15-decimal plot for sale in Kololo');
      assert.equal(kololo.property_type, 'commercial_land');
      assert.equal(Number(kololo.land_size_value), 15);
      assert.equal(kololo.land_size_unit, 'decimals');
      assert.equal(Number(kololo.price), 1349000000);
      assert.equal(kololo.extra_fields.listing_correction_176, undefined);
      const other = await row(OTHER_PROMISE);
      assert.equal(other.title, '55 - Room Commerical property on 1.6 Arces for sale');
      assert.equal(other.property_type, 'hospitality');
      assert.equal(Number(other.price), 7556708000);
      const decoy = await row(DECOY);
      assert.equal(decoy.title, LAND_TITLE);
      assert.equal(decoy.listing_type, 'land');
      assert.equal(Number(decoy.land_size_value), 1.6);
      const photo = await client.query('SELECT url FROM property_images WHERE property_id = $1', [MAKERERE]);
      assert.equal(photo.rows[0].url, 'https://media.makaug.com/makerere-photo.jpg');
      const backup = await client.query('SELECT before_row FROM listing_correction_176_backup WHERE property_id = $1', [MAKERERE]);
      assert.equal(backup.rows.length, 1);
      assert.equal(backup.rows[0].before_row.title, HOTEL_TITLE);
      assert.equal(backup.rows[0].before_row.property_type, 'hospitality');
      const stampedAt = building.updated_at.toISOString();
      const second = await apply(sql);
      const skipped = rowNotices(second.notices);
      assert.deepEqual(skipped, [{ id: MAKERERE, verb: 'skipped', reason: 'already_in_target_state' }]);
      assert.equal((await row(MAKERERE)).updated_at.toISOString(), stampedAt);
      assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM listing_correction_176_backup')).rows[0].n, 1);
      assert.equal(updates(await client.query(rollbackSql)), 1);
      const restored = await row(MAKERERE);
      assert.equal(restored.title, HOTEL_TITLE);
      assert.equal(restored.property_type, 'hospitality');
      assert.equal(restored.description, `${HOTEL_PREFIX}${CAPTION}`);
      assert.equal(restored.extra_fields.listing_correction_176, undefined);
      assert.equal(restored.extra_fields.video_url, 'https://media.makaug.com/makerere-building.mp4');
      assert.equal(Number(restored.price), 7600000000);
      await client.query('ROLLBACK');
    });

    await t.test('the land title clears plot size and a per-acre period without changing the price', async () => {
      await client.query('BEGIN');
      await seed({
        title: LAND_TITLE,
        description: `${LAND_PREFIX}${CAPTION}`,
        listing_type: 'land',
        property_type: 'land',
        transaction_type: 'sale',
        land_size_value: 1.6,
        land_size_unit: 'acres',
        price_period: 'acre',
        bedrooms: 7
      });
      const run = await apply(sql);
      assert.equal(rowNotices(run.notices)[0].reason, 'relabel');
      const building = await row(MAKERERE);
      assert.equal(building.title, TARGET_TITLE);
      assert.equal(building.listing_type, 'commercial');
      assert.equal(building.property_type, 'Commercial building');
      assert.equal(building.land_size_value, null);
      assert.equal(building.land_size_unit, null);
      assert.equal(building.price_period, 'once');
      assert.equal(Number(building.price), 7600000000);
      assert.equal(Number(building.price_original), 2000000);
      assert.equal(building.bedrooms, 7);
      assert.equal(building.floor_area_sqm, null);
      assert.equal(building.description, `${TARGET_PREFIX}${CAPTION}`);
      assert.equal(Number((await row(DECOY)).land_size_value), 1.6);
      assert.equal((await row(DECOY)).price_period, 'once');
      assert.equal(updates(await client.query(rollbackSql)), 1);
      const restored = await row(MAKERERE);
      assert.equal(restored.title, LAND_TITLE);
      assert.equal(restored.listing_type, 'land');
      assert.equal(Number(restored.land_size_value), 1.6);
      assert.equal(restored.land_size_unit, 'acres');
      assert.equal(restored.price_period, 'acre');
      assert.equal(restored.bedrooms, 7);
      await client.query('ROLLBACK');
    });

    await t.test('a normalised source title matches and a finished target title is not rewritten', async () => {
      await client.query('BEGIN');
      await seed({
        title: '  HOTEL\u00A0/   hostel (55 rooms) for sale in Makerere ',
        land_size_value: 15,
        land_size_unit: 'decimals',
        price_period: 'per decimal'
      });
      const run = await apply(sql);
      assert.equal(rowNotices(run.notices)[0].verb, 'applied');
      const building = await row(MAKERERE);
      assert.equal(building.title, TARGET_TITLE);
      assert.equal(building.land_size_value, null);
      assert.equal(building.land_size_unit, null);
      assert.equal(building.price_period, 'once');
      assert.equal(Number(building.price), 7600000000);
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await seed({
        title: '  Commercial\u00A0building   (55 rooms) for sale in Makerere ',
        listing_type: 'commercial',
        property_type: 'Commercial building',
        transaction_type: 'sale',
        description: `${TARGET_PREFIX}already done`,
        land_size_value: null,
        land_size_unit: null,
        price_period: 'once',
        updated_at: '2026-10-24 12:00:00+00'
      });
      const done = await apply(sql);
      assert.equal(rowNotices(done.notices)[0].reason, 'already_in_target_state');
      assert.equal((await row(MAKERERE)).title, '  Commercial\u00A0building   (55 rooms) for sale in Makerere ');
      assert.equal((await client.query('SELECT to_regclass($1) AS name', ['listing_correction_176_backup'])).rows[0].name, 'listing_correction_176_backup');
      assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM listing_correction_176_backup')).rows[0].n, 0);
      await client.query('ROLLBACK');
    });

    await t.test('a caption without the generated prefix stays, and the title still changes', async () => {
      await client.query('BEGIN');
      await seed({ description: CAPTION });
      const run = await apply(sql);
      assert.equal(rowNotices(run.notices)[0].verb, 'applied');
      const building = await row(MAKERERE);
      assert.equal(building.title, TARGET_TITLE);
      assert.equal(building.description, CAPTION);
      await client.query('ROLLBACK');
    });

    await t.test('a different title, a different lister, a deleted row and another country are skipped', async () => {
      await client.query('BEGIN');
      await seed({ title: 'House for sale in Makerere' });
      const titled = await apply(sql);
      assert.equal(rowNotices(titled.notices)[0].reason, 'title_guard');
      assert.equal((await row(MAKERERE)).title, 'House for sale in Makerere');
      assert.equal((await row(MAKERERE)).property_type, 'hospitality');
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await seed({ lister_name: 'Someone Else' });
      const lister = await apply(sql);
      assert.equal(rowNotices(lister.notices)[0].reason, 'lister_guard');
      assert.equal((await row(MAKERERE)).title, HOTEL_TITLE);
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await seed();
      await client.query('DELETE FROM properties WHERE id = $1', [MAKERERE]);
      const missing = await apply(sql);
      assert.equal(rowNotices(missing.notices)[0].reason, 'deleted');
      assert.equal(await row(MAKERERE), undefined);
      assert.equal((await row(KOLOLO)).title, '15-decimal plot for sale in Kololo');
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await seed({ status: 'purged' });
      const purged = await apply(sql);
      assert.equal(rowNotices(purged.notices)[0].reason, 'deleted');
      assert.equal((await row(MAKERERE)).title, HOTEL_TITLE);
      await client.query('ROLLBACK');

      for (const country of ['ZA', '']) {
        await client.query('BEGIN');
        await seed();
        const run = await apply(sql, country);
        assert.match(run.notices.join('\n'), /country_not_ug/);
        assert.equal(rowNotices(run.notices).length, 0);
        assert.equal((await row(MAKERERE)).title, HOTEL_TITLE);
        assert.equal((await row(MAKERERE)).property_type, 'hospitality');
        await client.query('ROLLBACK');
      }
    });

    await t.test('rollback leaves a later edit in place', async () => {
      await client.query('BEGIN');
      await seed();
      await apply(sql);
      await client.query("UPDATE properties SET title = 'Commercial building (55 rooms) for sale in Makerere edited', updated_at = updated_at + INTERVAL '1 second' WHERE id = $1", [MAKERERE]);
      assert.equal(updates(await client.query(rollbackSql)), 0);
      assert.equal((await row(MAKERERE)).title, 'Commercial building (55 rooms) for sale in Makerere edited');
      assert.equal((await row(KOLOLO)).title, '15-decimal plot for sale in Kololo');
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
