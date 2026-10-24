'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { canonicalDisplayLocationForRow } = require('../utils/ugandaLocationRegistry');

const MIGRATION = path.join(__dirname, '../db/migrations/178_namuseera_location_and_gayaza_captions.sql');
const ROLLBACK = path.join(__dirname, '../scripts/rollback-178-listing-corrections.sql');
const MIGRATIONS = path.join(__dirname, '../db/migrations');
const NAMUSEERA = 'ee920882-bd61-4f1d-9156-75f45851edf9';
const GAYAZA = '36760196-c98d-41c9-b1e5-31e1417067c6';
const DECOY = '00000000-0000-4000-8000-000000000178';
const LIVE_TITLE = 'Land for sale in Namuseera, Wakiso';
const LIVE_ADDRESS = 'Namuseera Estate, Namuseera, Wakiso';
const GAYAZA_IMAGES = [
  ['1ac894fb-1fd4-4051-825e-985eb020862b', 'https://media.makaug.com/whatsapp-employee-intake/image/1791469069110-69693ce0-4c80-48f0-bade-2f83aa187bc9-09402189-false_58248765960252-lid_A52ED8578561170968DF6A8862B5FA95-1.jpg', true, 0, 'primary', 'Primary property photo'],
  ['9d993706-cec3-4f94-babe-9da1eed4b759', 'https://media.makaug.com/whatsapp-employee-intake/image/1791469076303-9990269d-8932-4869-bdb9-81d3c881d612-09402189-false_58248765960252-lid_A5938867B99490044240E4C17FBD5279-1.jpg', false, 1, 'extra_2', 'Property photo 2'],
  ['1deb664e-adb6-4d37-8dfb-68737945d5cc', 'https://media.makaug.com/whatsapp-employee-intake/video-key-frame/36760196-c98d-41c9-b1e5-31e1417067c6/1791469753059-a48bc2cc-a7a9-4533-9dff-6f09d2fbbb53.jpg', false, 3, 'video_key_frame_2', 'Distinct video key image 2 of 5'],
  ['12cd9bd0-27a9-4ddd-b19e-4cbd4652c5cd', 'https://media.makaug.com/whatsapp-employee-intake/video-key-frame/36760196-c98d-41c9-b1e5-31e1417067c6/1791469754056-340587ac-4481-49c8-a541-10d6ea1ec54f.jpg', false, 4, 'video_key_frame_3', 'Distinct video key image 3 of 5'],
  ['e874532d-6f31-4182-85ca-e1d4561a1452', 'https://media.makaug.com/whatsapp-employee-intake/video-key-frame/36760196-c98d-41c9-b1e5-31e1417067c6/1791469755967-8e099cef-c55f-4b78-a1f2-f9405f83af48.jpg', false, 5, 'video_key_frame_4', 'Distinct video key image 4 of 5'],
  ['8832dfa5-ae70-47f0-81ab-16fbd612a60f', 'https://media.makaug.com/whatsapp-employee-intake/video-key-frame/36760196-c98d-41c9-b1e5-31e1417067c6/1791469757651-067a1603-b10d-4df1-9258-2ed9f8f018c0.jpg', false, 6, 'video_key_frame_5', 'Distinct video key image 5 of 5']
];
const PG_BIN = [process.env.LFM_PG_BIN, '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/18/bin']
  .filter(Boolean)
  .find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));

function updates(result) {
  return (Array.isArray(result) ? result : [result])
    .filter((item) => item && item.command === 'UPDATE')
    .reduce((sum, item) => sum + item.rowCount, 0);
}

function rowNotices(list) {
  return list.flatMap((message) => {
    const match = String(message).match(/^listing_correction_178 ([0-9a-f-]{36}) (applied|skipped) (\S+)$/);
    return match ? [{ id: match[1], verb: match[2], reason: match[3] }] : [];
  });
}

function detailLocation(row) {
  const extra = row.extra_fields || {};
  const parts = [];
  for (const part of [row.area || extra.neighborhood || extra.city, extra.city, row.district]) {
    const value = String(part || '').trim();
    if (!value || parts.some((item) => item.toLowerCase() === value.toLowerCase())) continue;
    parts.push(value);
  }
  return parts.join(', ');
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

test('listing correction 178 guards the live Namuseera fields and clears Gayaza captions', () => {
  const names = fs.readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql'));
  assert.equal(names.includes('178_namuseera_location_and_gayaza_captions.sql'), true);
  assert.equal(names.filter((name) => name.startsWith('178_')).length, 1);
  assert.match(sql, /SET LOCAL lock_timeout = '8s'/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS listing_correction_178_backup/);
  assert.match(sql, /DISABLE TRIGGER trg_properties_updated_at/);
  assert.match(sql, /ENABLE TRIGGER trg_properties_updated_at/);
  assert.match(sql, /current_setting\('app\.country_code', true\) IS DISTINCT FROM 'UG'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_178 % applied namuseera_location'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_178 % applied gayaza_captions'/);
  assert.match(sql, /clear_caption/);
  assert.match(sql, /distinct video key image/);
  assert.match(sql, /primary property photo/);
  assert.match(sql, new RegExp(NAMUSEERA));
  assert.match(sql, new RegExp(GAYAZA));
  assert.match(sql, /Land for sale in Namuseera, Wakiso/);
  assert.match(sql, /Commercial land/);
  assert.match(sql, /property_type = 'Land'/);
  assert.match(sql, /area = 'Namuseera'/);
  assert.match(sql, /Namuseera, Wakiso/);
  assert.match(sql, /From, Kampala, Central/);
  assert.match(sql, /Wakiso Town/);
  assert.doesNotMatch(sql, /skipped area_guard', pid;\s*ELSIF p\.area/s);
  assert.doesNotMatch(sql, /wakiso:namuseera/);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+properties/i);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+property_images/i);
  assert.doesNotMatch(sql, /routes\/whatsapp|services\/whatsapp/);
  assert.equal(fs.existsSync(ROLLBACK), true);
  assert.equal(fs.existsSync(path.join(MIGRATIONS, 'rollback-178-listing-corrections.sql')), false);
  assert.match(rollbackSql, /listing_correction_178_backup/);
  assert.match(rollbackSql, /current_setting\('app\.country_code', true\) = 'UG'/);
  assert.match(rollbackSql, /image_caption/);
  assert.match(rollbackSql, /clear_caption/);
  assert.match(rollbackSql, /room_label = NULLIF\(b\.before_row->>'room_label', ''\)/);
  assert.match(rollbackSql, /address = b\.before_row->>'address'/);
  assert.doesNotMatch(rollbackSql, /DELETE\s+FROM\s+properties/i);
  assert.doesNotMatch(rollbackSql, /DROP TABLE listing_correction_178_backup/i);
  GAYAZA_IMAGES.forEach(([id, url]) => {
    assert.match(sql, new RegExp(id));
    assert.match(sql, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  const hidden = canonicalDisplayLocationForRow({
    area: 'Wakiso',
    district: 'Wakiso',
    extra_fields: { canonical_location_id: 'wakiso:wakiso', canonical_location_level: 'district' }
  });
  assert.equal(hidden.area, null);
  assert.equal(hidden.district, 'Wakiso');
  const shown = canonicalDisplayLocationForRow({
    area: 'Namuseera',
    district: 'Wakiso',
    extra_fields: { canonical_location_id: 'wakiso:wakiso', canonical_location_level: 'district' }
  });
  assert.equal(shown.area, 'Namuseera');
  assert.equal([shown.area, shown.district].filter(Boolean).join(', '), 'Namuseera, Wakiso');
});

test('listing correction 178 applies once, skips a second run, and rolls back', {
  skip: PG_BIN ? false : 'Install PostgreSQL or set LFM_PG_BIN for the isolated database test.',
  timeout: 120000
}, async (t) => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-migration-178-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'socket');
  fs.mkdirSync(socket);
  let client;
  let started = false;
  const notices = [];
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=lfm_178', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    const port = await freePort();
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '20', '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`, 'start'], { stdio: 'pipe' });
    started = true;
    client = new Client({ host: '127.0.0.1', port, user: 'lfm_178', database: 'postgres' });
    await client.connect();
    client.on('notice', (notice) => notices.push(notice.message || String(notice)));
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
      status text,
      area text,
      district text,
      address text,
      price numeric,
      price_original numeric,
      price_currency text,
      price_unit text,
      price_period text,
      price_on_application boolean,
      land_size_value numeric,
      land_size_unit text,
      extra_fields jsonb,
      updated_at timestamptz,
      created_at timestamptz
    )`);
    await client.query(`CREATE TRIGGER trg_properties_updated_at
      BEFORE UPDATE ON properties
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()`);
    await client.query(`CREATE TABLE property_images (
      id uuid PRIMARY KEY,
      property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
      url text NOT NULL,
      is_primary boolean NOT NULL DEFAULT false,
      sort_order integer NOT NULL DEFAULT 0,
      slot_key text,
      room_label text,
      created_at timestamptz NOT NULL DEFAULT NOW()
    )`);

    async function apply(text, country = 'UG') {
      const before = notices.length;
      await client.query("SELECT set_config('app.country_code', $1, true)", [country]);
      const result = await client.query(text);
      return { result, notices: notices.slice(before) };
    }

    async function row(id) {
      const found = await client.query('SELECT * FROM properties WHERE id = $1', [id]);
      return found.rows[0];
    }

    async function images(id) {
      const found = await client.query(
        'SELECT id, url, is_primary, sort_order, room_label FROM property_images WHERE property_id = $1 ORDER BY sort_order, id',
        [id]
      );
      return found.rows;
    }

    async function seed(namuseeraArea = 'Wakiso') {
      await client.query('DELETE FROM property_images');
      await client.query('DELETE FROM properties');
      await client.query('DROP TABLE IF EXISTS listing_correction_178_backup');
      const namuseeraExtra = {
        canonical_location_id: 'wakiso:wakiso',
        canonical_location_level: 'district',
        city: 'Wakiso Town',
        neighborhood: 'Wakiso',
        region: 'Central',
        resolved_location_label: 'From, Kampala, Central',
        location_resolution_status: 'canonical_human_confirmed'
      };
      const gayazaExtra = {
        canonical_location_id: 'wakiso:gayaza',
        canonical_location_level: 'area',
        city: 'Wakiso Town',
        neighborhood: 'Gayaza',
        region: 'Central',
        resolved_location_label: 'Gayaza, Wakiso, Central',
        location_resolution_status: 'canonical_human_confirmed'
      };
      await client.query(
        `INSERT INTO properties (
           id, title, description, listing_type, transaction_type, property_type, status,
           area, district, address, price, price_currency, price_period, price_on_application,
           extra_fields, updated_at, created_at
         ) VALUES
         ($1, $2, 'Plots for sale in Namuseera Estate, Wakiso.', 'land', 'sale', 'Commercial land', 'approved',
          $3, 'Wakiso', $4, 30000000, 'UGX', 'once', false, $5::jsonb, '2026-10-24T10:56:23.942Z', '2026-10-01T00:00:00Z'),
         ($6, 'Land for sale in Gayaza', 'Land for sale in Gayaza, Wakiso.', 'land', 'sale', 'Land', 'approved',
          'Gayaza', 'Wakiso', 'Gayaza, Wakiso', 40000000, 'UGX', 'once', false, $7::jsonb, '2026-10-24T14:36:49.614Z', '2026-10-01T00:00:00Z'),
         ($8, 'Land for sale in Gayaza', 'Leave this caption alone.', 'land', 'sale', 'Land', 'approved',
          'Gayaza', 'Wakiso', 'Gayaza, Wakiso', 1000, 'UGX', 'once', false, $7::jsonb, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z')`,
        [NAMUSEERA, LIVE_TITLE, namuseeraArea, LIVE_ADDRESS, JSON.stringify(namuseeraExtra), GAYAZA, JSON.stringify(gayazaExtra), DECOY]
      );
      for (const [id, url, primary, order, slot, room] of GAYAZA_IMAGES) {
        await client.query(
          `INSERT INTO property_images (id, property_id, url, is_primary, sort_order, slot_key, room_label)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, GAYAZA, url, primary, order, slot, room]
        );
      }
      await client.query(
        `INSERT INTO property_images (id, property_id, url, is_primary, sort_order, room_label)
         VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', $1, 'https://media.makaug.com/decoy.jpg', true, 0, 'Distinct video key image 1 of 5')`,
        [DECOY]
      );
    }

    await t.test('a non-Namuseera area is overwritten and Gayaza captions are cleared once', async () => {
      await client.query('BEGIN');
      await seed('Wakiso');
      const before = await row(NAMUSEERA);
      assert.equal(detailLocation({ ...before, area: null }), 'Wakiso, Wakiso Town');
      const first = await apply(sql);
      const applied = rowNotices(first.notices);
      assert.deepEqual(
        applied.filter((item) => item.verb === 'applied').map((item) => `${item.id.slice(0, 8)}:${item.reason}`).sort(),
        [`${GAYAZA.slice(0, 8)}:gayaza_captions`, `${NAMUSEERA.slice(0, 8)}:namuseera_location`].sort(),
        first.notices.join('\n')
      );
      assert.equal(applied.filter((item) => item.verb === 'skipped').length, 0, first.notices.join('\n'));

      const namuseera = await row(NAMUSEERA);
      assert.equal(namuseera.title, LIVE_TITLE);
      assert.equal(namuseera.area, 'Namuseera');
      assert.equal(namuseera.district, 'Wakiso');
      assert.equal(namuseera.address, LIVE_ADDRESS);
      assert.equal(namuseera.property_type, 'Land');
      assert.equal(namuseera.listing_type, 'land');
      assert.equal(namuseera.extra_fields.canonical_location_id, 'wakiso:wakiso');
      assert.equal(namuseera.extra_fields.neighborhood, 'Namuseera');
      assert.equal(namuseera.extra_fields.city, undefined);
      assert.equal(namuseera.extra_fields.resolved_location_label, 'Namuseera, Wakiso');
      assert.equal(namuseera.extra_fields.region, 'Central');
      assert.equal(detailLocation(namuseera), 'Namuseera, Wakiso');
      assert.equal(namuseera.updated_at.toISOString(), new Date(namuseera.extra_fields.listing_correction_178.applied_at).toISOString());
      assert.ok(namuseera.extra_fields.listing_correction_178.actions.includes('namuseera_location'));
      const publicArea = canonicalDisplayLocationForRow(namuseera);
      assert.equal([publicArea.area, publicArea.district].filter(Boolean).join(', '), 'Namuseera, Wakiso');

      const gayaza = await images(GAYAZA);
      assert.equal(gayaza.length, 6);
      assert.equal(gayaza.find((image) => image.id === '9d993706-cec3-4f94-babe-9da1eed4b759').room_label, 'Property photo 2');
      assert.equal(gayaza.find((image) => image.id === '9d993706-cec3-4f94-babe-9da1eed4b759').url, GAYAZA_IMAGES[1][1]);
      for (const image of gayaza) {
        if (image.id === '9d993706-cec3-4f94-babe-9da1eed4b759') continue;
        assert.equal(image.room_label, null, image.id);
      }
      assert.equal((await images(DECOY))[0].room_label, 'Distinct video key image 1 of 5');
      const gayazaRow = await row(GAYAZA);
      assert.equal(gayazaRow.title, 'Land for sale in Gayaza');
      assert.equal(gayazaRow.area, 'Gayaza');
      assert.equal(gayazaRow.property_type, 'Land');
      assert.equal(gayazaRow.extra_fields.city, 'Wakiso Town');
      assert.equal(gayazaRow.updated_at.toISOString(), new Date(gayazaRow.extra_fields.listing_correction_178.applied_at).toISOString());
      const stampedAt = namuseera.updated_at.toISOString();

      const second = await apply(sql);
      const skipped = rowNotices(second.notices);
      assert.equal(skipped.length, 2, second.notices.join('\n'));
      assert.ok(skipped.every((item) => item.verb === 'skipped' && item.reason === 'already_in_target_state'), second.notices.join('\n'));
      assert.equal((await row(NAMUSEERA)).updated_at.toISOString(), stampedAt);
      assert.equal((await client.query(`SELECT COUNT(*)::int AS n FROM listing_correction_178_backup WHERE property_id = $1 AND row_kind = 'property'`, [NAMUSEERA])).rows[0].n, 1);
      assert.equal((await client.query(`SELECT COUNT(*)::int AS n FROM listing_correction_178_backup WHERE action = 'clear_caption' AND property_id = $1`, [GAYAZA])).rows[0].n, 5);

      const propertyUpdates = updates(await client.query(rollbackSql));
      assert.ok(propertyUpdates >= 2);
      const restored = await row(NAMUSEERA);
      assert.equal(restored.area, 'Wakiso');
      assert.equal(restored.property_type, 'Commercial land');
      assert.equal(restored.title, LIVE_TITLE);
      assert.equal(restored.extra_fields.city, 'Wakiso Town');
      assert.equal(restored.extra_fields.neighborhood, 'Wakiso');
      assert.equal(restored.extra_fields.resolved_location_label, 'From, Kampala, Central');
      assert.equal(restored.extra_fields.listing_correction_178, undefined);
      const restoredGayaza = await images(GAYAZA);
      assert.equal(restoredGayaza.find((image) => image.id === '1deb664e-adb6-4d37-8dfb-68737945d5cc').room_label, 'Distinct video key image 2 of 5');
      assert.equal(restoredGayaza.find((image) => image.id === '1ac894fb-1fd4-4051-825e-985eb020862b').room_label, 'Primary property photo');
      assert.equal(restoredGayaza.find((image) => image.id === '9d993706-cec3-4f94-babe-9da1eed4b759').room_label, 'Property photo 2');
      assert.equal((await row(GAYAZA)).extra_fields.listing_correction_178, undefined);
      assert.equal((await client.query(`SELECT to_regclass('listing_correction_178_backup') AS name`)).rows[0].name, 'listing_correction_178_backup');
      await client.query('ROLLBACK');
    });

    await t.test('Namuseera Estate and a null area are still corrected', async () => {
      await client.query('BEGIN');
      await seed('Namuseera Estate');
      const estate = await apply(sql);
      assert.equal(rowNotices(estate.notices).find((item) => item.id === NAMUSEERA).reason, 'namuseera_location');
      assert.equal((await row(NAMUSEERA)).area, 'Namuseera');
      assert.equal((await row(NAMUSEERA)).property_type, 'Land');
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await seed(null);
      const blank = await apply(sql);
      assert.equal(rowNotices(blank.notices).find((item) => item.id === NAMUSEERA).reason, 'namuseera_location');
      const rowAfter = await row(NAMUSEERA);
      assert.equal(rowAfter.area, 'Namuseera');
      assert.equal(detailLocation(rowAfter), 'Namuseera, Wakiso');
      await client.query('ROLLBACK');
    });

    await t.test('a moved title, type, or caption is left in place', async () => {
      await client.query('BEGIN');
      await seed('Wakiso');
      await client.query(`UPDATE properties SET title = 'Land for sale in Namuseera' WHERE id = $1`, [NAMUSEERA]);
      await client.query(`UPDATE property_images SET room_label = 'Road frontage' WHERE id = '1deb664e-adb6-4d37-8dfb-68737945d5cc'`);
      const moved = await apply(sql);
      const notes = rowNotices(moved.notices);
      assert.equal(notes.find((item) => item.id === NAMUSEERA).reason, 'title_guard');
      assert.equal((await row(NAMUSEERA)).area, 'Wakiso');
      assert.equal((await row(NAMUSEERA)).property_type, 'Commercial land');
      assert.equal(notes.find((item) => item.id === GAYAZA).reason, 'caption_guard');
      assert.equal((await images(GAYAZA)).find((image) => image.id === '8832dfa5-ae70-47f0-81ab-16fbd612a60f').room_label, 'Distinct video key image 5 of 5');
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await seed('Wakiso');
      await client.query(`UPDATE properties SET property_type = 'Plot' WHERE id = $1`, [NAMUSEERA]);
      await client.query(`UPDATE property_images SET url = url || '?changed' WHERE id = '8832dfa5-ae70-47f0-81ab-16fbd612a60f'`);
      const guarded = await apply(sql);
      const reasons = rowNotices(guarded.notices);
      assert.equal(reasons.find((item) => item.id === NAMUSEERA).reason, 'type_guard');
      assert.equal((await row(NAMUSEERA)).area, 'Wakiso');
      assert.equal(reasons.find((item) => item.id === GAYAZA).reason, 'url_guard');
      assert.equal((await images(GAYAZA)).find((image) => image.id === '1deb664e-adb6-4d37-8dfb-68737945d5cc').room_label, 'Distinct video key image 2 of 5');
      await client.query('ROLLBACK');
    });

    await t.test('another country and a deleted row are skipped', async () => {
      await client.query('BEGIN');
      await seed('Wakiso');
      const other = await apply(sql, 'ZA');
      assert.match(other.notices.join('\n'), /country_not_ug/);
      assert.equal(rowNotices(other.notices).length, 0);
      assert.equal((await row(NAMUSEERA)).property_type, 'Commercial land');
      assert.equal((await row(NAMUSEERA)).area, 'Wakiso');
      assert.equal((await images(GAYAZA)).find((image) => image.id === '1ac894fb-1fd4-4051-825e-985eb020862b').room_label, 'Primary property photo');
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await seed('Wakiso');
      await client.query(`UPDATE properties SET status = 'deleted' WHERE id = $1`, [NAMUSEERA]);
      const deleted = await apply(sql);
      assert.equal(rowNotices(deleted.notices).find((item) => item.id === NAMUSEERA).reason, 'deleted');
      assert.equal((await row(NAMUSEERA)).area, 'Wakiso');
      assert.equal(rowNotices(deleted.notices).find((item) => item.id === GAYAZA).reason, 'gayaza_captions');
      await client.query('ROLLBACK');
    });
  } finally {
    if (client) {
      await client.end().catch(() => {});
    }
    if (started) {
      execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-w', '-t', '20', '-m', 'immediate', 'stop'], { stdio: 'pipe' });
    }
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});
