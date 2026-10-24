'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const MIGRATION = path.join(__dirname, '../db/migrations/177_marketing_recheck_fixes.sql');
const ROLLBACK = path.join(__dirname, '../scripts/rollback-177-listing-corrections.sql');
const MIGRATIONS = path.join(__dirname, '../db/migrations');
const KASANJE = 'd8c78ccd-81ec-4e92-9126-8e603d7c5071';
const NTINDA = '73fbf51d-58f9-47df-8080-ffee9abb9b2f';
const GAYAZA = '36760196-c98d-41c9-b1e5-31e1417067c6';
const KITENDE = '673e383b-3480-423a-acce-74fb6f192ba7';
const BUSIKA = 'db4d4516-5008-4c25-a677-04c0459427c6';
const KAKIRI = '82ac1527-9193-4318-ac0f-02ebeb0a7012';
const NAMUSEERA = 'ee920882-bd61-4f1d-9156-75f45851edf9';
const KIKYUSA = '9b7058b6-5790-4759-851e-f86d7a47351f';
const MBALWA = 'c8bebd69-2006-4796-a591-65e97be82e37';
const NAMULANDA = 'e2085b5b-95e2-4359-aea4-6c3de6b4b4fd';
const DECOY = '00000000-0000-4000-8000-000000000177';
const MBALWA_VIDEO_2 = 'https://media.makaug.com/whatsapp-employee-intake/video/1791548942015-d720afea-9ba7-42f3-b270-5db2f8d634d7-57773202-false_95365487423704-lid_3A4A54B8E62E2CFC1166-1.mp4';
const MBALWA_VIDEO_1 = 'https://media.makaug.com/whatsapp-employee-intake/video/1791548938523-83e7db4e-1625-4c0e-b9fb-30fdf80bd59d-57773202-false_95365487423704-lid_3A73562F677A78EE4C68-1.mp4';
const KASANJE_PHOTOS = [
  ['bfd2d7fe-db42-4229-9bd5-762d9504b986', 'https://media.makaug.com/properties/d8c78ccd-81ec-4e92-9126-8e603d7c5071/admin-images/1791474722663-8a17ee3c-e443-4568-92f2-53bffc174795-plot-photo.jpg'],
  ['388d01c0-3652-4629-8ea1-932889c01b5f', 'https://media.makaug.com/properties/d8c78ccd-81ec-4e92-9126-8e603d7c5071/admin-images/1791474723650-37cfdf88-d88b-4461-977c-d149bbb72000-plot-photo-2.jpg'],
  ['f6b80177-a95c-452b-aae7-ed40c2292688', 'https://media.makaug.com/properties/d8c78ccd-81ec-4e92-9126-8e603d7c5071/admin-images/1791474724636-2b0b1ab3-c36f-4cb2-b3e5-b5200ed675b8-plot-photo-3.jpg'],
  ['17598569-617d-47b3-971e-487207c3755f', 'https://media.makaug.com/properties/d8c78ccd-81ec-4e92-9126-8e603d7c5071/admin-images/1791474725429-e7bd2413-600e-43e7-b37b-b7ab68c38abc-plot-photo-4.jpg']
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
    const match = String(message).match(/^listing_correction_177 ([0-9a-f-]{36}) (applied|skipped) (\S+)$/);
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

test('listing correction 177 is one guarded migration with a droppable Busika block', () => {
  const names = fs.readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql'));
  assert.equal(names.includes('177_marketing_recheck_fixes.sql'), true);
  assert.equal(names.filter((name) => name.startsWith('177_')).length, 1);
  assert.equal(names.some((name) => /^178_/.test(name)), false);
  assert.match(sql, /SET LOCAL lock_timeout = '8s'/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS listing_correction_177_backup/);
  assert.match(sql, /property_image/);
  assert.match(sql, /video_tour/);
  assert.match(sql, /DISABLE TRIGGER trg_properties_updated_at/);
  assert.match(sql, /ENABLE TRIGGER trg_properties_updated_at/);
  assert.match(sql, /current_setting\('app\.country_code', true\) IS DISTINCT FROM 'UG'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_177 % applied property_type_land'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_177 % applied busika_luwero'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_177 % applied kakiri_land'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_177 % applied namuseera_area'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_177 % applied kikyusa_per_acre'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_177 % applied remove_copied_photos'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_177 % applied mbalwa_media'/);
  assert.match(sql, /Watch the attached video tour and browse the 3 plot photos before enquiring\./);
  assert.match(sql, /RAISE NOTICE 'listing_correction_177 % applied namulanda_primary'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_177 % applied remove_stock_photo'/);
  assert.match(sql, /RAISE NOTICE 'listing_correction_177 % applied hide_no_real_photos'/);
  assert.match(sql, /hidden: no real photos/);
  assert.match(sql, /status = 'hidden'/);
  assert.match(sql, new RegExp(NTINDA));
  assert.match(sql, /photo-1560518883-ce09059eeffa/);
  assert.match(sql, /unsplash\\\.com/);
  assert.match(sql, /clear_caption/);
  assert.match(sql, /distinct video key image/);
  assert.match(sql, /to_regclass\('public\.advertising_placements'\)/);
  assert.match(sql, /\/assets\/icons\/makaug-icon-512\.png/);
  assert.doesNotMatch(sql, /images\.unsplash\.com/);
  assert.match(sql, /price = 13000000/);
  assert.match(sql, /price_unit = 'per_acre'/);
  assert.match(sql, /price_period = 'acre'/);
  assert.match(sql, /AND target\.price IS NULL/);
  assert.doesNotMatch(sql, /land_size_value\s*=/);
  assert.doesNotMatch(sql, /land_size_unit\s*=/);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+properties/i);
  assert.doesNotMatch(sql, /routes\/whatsapp|services\/whatsapp/);
  assert.doesNotMatch(sql, /wakiso:namuseera/);
  assert.doesNotMatch(sql, /kyankwanzi:busika/);
  assert.match(sql, /luwero:busika/);
  const open = sql.indexOf('$do_177_busika$');
  const close = sql.indexOf('$do_177_busika$;');
  assert.ok(open > 0 && close > open);
  const busikaBlock = sql.slice(open, close);
  const withoutBusika = `${sql.slice(0, open)}${sql.slice(close + '$do_177_busika$;'.length)}`;
  assert.match(busikaBlock, new RegExp(BUSIKA));
  assert.equal(withoutBusika.includes(BUSIKA), false);
  assert.match(busikaBlock, /DROP THIS BLOCK/);
  assert.equal(fs.existsSync(ROLLBACK), true);
  assert.equal(fs.existsSync(path.join(MIGRATIONS, 'rollback-177-listing-corrections.sql')), false);
  assert.match(rollbackSql, /listing_correction_177_backup/);
  assert.match(rollbackSql, /current_setting\('app\.country_code', true\) = 'UG'/);
  assert.match(rollbackSql, /delete_image/);
  assert.match(rollbackSql, /reorder_image/);
  assert.match(rollbackSql, /image_caption/);
  assert.match(rollbackSql, /room_label = NULLIF\(b\.before_row->>'room_label', ''\)/);
  assert.match(rollbackSql, /status = COALESCE\(b\.before_row->>'status', p\.status\)/);
  assert.match(rollbackSql, /advertising_placement/);
  assert.doesNotMatch(rollbackSql, /DELETE\s+FROM\s+properties/i);
  assert.doesNotMatch(rollbackSql, /DROP TABLE listing_correction_177_backup/i);
  KASANJE_PHOTOS.forEach(([id, url]) => {
    assert.match(sql, new RegExp(id));
    assert.match(sql, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
  assert.match(sql, new RegExp(MBALWA_VIDEO_2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('listing correction 177 applies once, skips the second run, and rolls back photos and video', {
  skip: PG_BIN ? false : 'Install PostgreSQL or set LFM_PG_BIN for the isolated database test.',
  timeout: 120000
}, async (t) => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-migration-177-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'socket');
  fs.mkdirSync(socket);
  let client;
  let started = false;
  const notices = [];
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=lfm_177', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    const port = await freePort();
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '20', '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`, 'start'], { stdio: 'pipe' });
    started = true;
    client = new Client({ host: '127.0.0.1', port, user: 'lfm_177', database: 'postgres' });
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

    async function seed() {
      await client.query('DELETE FROM property_images');
      await client.query('DELETE FROM properties');
      await client.query('DROP TABLE IF EXISTS listing_correction_177_backup');
      const rows = [
        [KASANJE, 'Land for sale in Kasanje-Nakawuka', 'Land for sale in Kasanje-Nakawuka, Wakiso, listed at UGX 24,000,000. Caption.', 'land', 'sale', 'house', 'Nakawuka', 'Wakiso', 24000000, { canonical_location_id: 'wakiso:nakawuka' }],
        [GAYAZA, 'Land for sale in Gayaza', 'Land for sale in Gayaza, Wakiso, listed at UGX 40,000,000. Caption.', 'land', 'sale', 'house', 'Gayaza', 'Wakiso', 40000000, { canonical_location_id: 'wakiso:gayaza' }],
        [KITENDE, 'Land for sale in Kitende', 'Land for sale in Kitende, Wakiso, listed at UGX 45,000,000. Caption.', 'land', 'sale', 'house', null, 'Wakiso', 45000000, { canonical_location_id: 'wakiso:wakiso' }],
        [BUSIKA, 'Property for sale in Busika', 'Property for sale in Busika, Wakiso, listed at UGX 40,000,000. Caption.', 'sale', null, null, null, 'Wakiso', 40000000, { canonical_location_id: 'wakiso:wakiso', city: 'Wakiso Town', neighborhood: 'Wakiso', region: 'Central', resolved_location_label: 'Busika, Wakiso, Central' }],
        [KAKIRI, 'Property for sale in Kakiri', 'Property for sale in Kakiri, Wakiso, listed at UGX 45,000,000. Caption.', 'sale', null, null, null, 'Wakiso', 45000000, { canonical_location_id: 'wakiso:kakiri' }],
        [NAMUSEERA, 'Land for sale in Namuseera, Wakiso', 'Plots for sale in Namuseera Estate, Wakiso. About 2.5 km from Namuseera town.', 'land', 'sale', 'Commercial land', null, 'Wakiso', 30000000, { canonical_location_id: 'wakiso:wakiso', canonical_location_level: 'district', city: 'Wakiso Town', neighborhood: 'Wakiso', region: 'Central', resolved_location_label: 'From, Kampala, Central' }],
        [KIKYUSA, 'Land for sale in Kikyusa', 'Land for sale in Kikyusa, Nakaseke, listed at UGX 13,000,000. Farmland For Sale. Plot Size; 70 acres. Price ; 13m per Acre.', 'land', 'sale', null, 'Kikyusa', 'Nakaseke', null, { canonical_location_id: 'nakaseke:kikyusa', price_original: 13000000 }],
        [MBALWA, 'Land for sale in Mbalwa', 'Land for sale in Mbalwa, Wakiso, listed at UGX 190,000,000. Watch the 2 attached video tours and browse 5 extracted key images before enquiring. Contact Francis Isabirye.', 'land', 'sale', null, 'Mbalwa', 'Wakiso', 190000000, {
          canonical_location_id: 'wakiso:mbalwa',
          video_url: MBALWA_VIDEO_1,
          video_tours: [
            { url: MBALWA_VIDEO_1, label: 'WhatsApp property video 1', sort_order: 0 },
            { url: MBALWA_VIDEO_2, label: 'WhatsApp property video 2', sort_order: 1 }
          ],
          video_urls: [MBALWA_VIDEO_1, MBALWA_VIDEO_2]
        }],
        [NAMULANDA, 'Commercial land for sale in Namulanda', 'Commercial property in Namulanda, Wakiso, listed at UGX 270,000,000. Caption.', 'commercial', 'sale', 'Commercial land', 'Namulanda', 'Wakiso', 270000000, { canonical_location_id: 'wakiso:namulanda' }],
        [NTINDA, '6-Bed house for sale in Ntinda', 'Ntinda 6 bedrooms 4 bathrooms on 20 decimals plot private mailo UGX 700 million.', 'sale', 'sale', 'House', 'Ntinda', 'Kampala', 700000000, { canonical_location_id: 'kampala:ntinda' }],
        [DECOY, 'Property for sale in Busika', 'Property for sale in Busika, Wakiso, listed at UGX 40,000,000. Leave me.', 'sale', null, 'house', null, 'Wakiso', 1000, { canonical_location_id: 'wakiso:wakiso' }]
      ];
      for (const [id, title, description, listingType, transactionType, propertyType, area, district, price, extra] of rows) {
        await client.query(
          `INSERT INTO properties (
             id, title, description, listing_type, transaction_type, property_type, status,
             area, district, price, price_original, price_currency, price_unit, price_period,
             price_on_application, land_size_value, land_size_unit, extra_fields, updated_at, created_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, 'approved',
             $7, $8, $9, $9, 'UGX', NULL, 'once',
             false, NULL, NULL, $10::jsonb, '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z'
           )`,
          [id, title, description, listingType, transactionType, propertyType, area, district, price, JSON.stringify(extra)]
        );
      }
      await client.query(
        `UPDATE properties SET price = NULL, price_original = NULL WHERE id = $1`,
        [KIKYUSA]
      );
      let sort = 0;
      for (const [id, url] of KASANJE_PHOTOS) {
        await client.query(
          `INSERT INTO property_images (id, property_id, url, is_primary, sort_order) VALUES ($1, $2, $3, $4, $5)`,
          [id, KASANJE, url, sort === 0, sort]
        );
        sort += 1;
      }
      await client.query(
        `INSERT INTO property_images (id, property_id, url, is_primary, sort_order) VALUES
          ('9d993706-0000-4000-8000-000000000001', $1, 'https://media.makaug.com/gayaza-original.jpg', true, 0)`,
        [GAYAZA]
      );
      const mbalwaImages = [
        ['a18c7a45-8c4e-433b-8c50-becee8f53e71', 'https://media.makaug.com/whatsapp-employee-intake/image/1791548952370-ed03e6be-5268-471c-b17c-dfdb80e98045-57773202-false_95365487423704-lid_3A138919FC8A463C8315-1.jpg', true, 0, 'primary', 'Primary property photo'],
        ['9aabcdde-3d49-4df5-9dbf-41992ddb4c5f', 'https://media.makaug.com/whatsapp-employee-intake/video-key-frame/c8bebd69-2006-4796-a591-65e97be82e37/1791549685740-8eb446a5-a67f-4799-b689-ce5166594ae9.jpg', false, 1, 'video_key_frame_1', 'Distinct video key image 1 of 5'],
        ['c7bd7386-7306-4b7e-a14b-899092fbdf1d', 'https://media.makaug.com/keep-c7.jpg', false, 2, 'video_key_frame_2', 'Distinct video key image 2 of 5'],
        ['0cbf2b94-204d-4aed-a3d7-21d18afa1a44', 'https://media.makaug.com/keep-0c.jpg', false, 3, 'video_key_frame_3', 'Distinct video key image 3 of 5'],
        ['5e4bf216-980e-4472-9a3a-649ead4643f6', 'https://media.makaug.com/whatsapp-employee-intake/video-key-frame/c8bebd69-2006-4796-a591-65e97be82e37/1791549688621-7ac8b128-8489-4d98-b004-6ffba7f9f070.jpg', false, 4, 'video_key_frame_4', 'Distinct video key image 4 of 5'],
        ['7890d2d9-d325-4784-b142-b3525f07462c', 'https://media.makaug.com/whatsapp-employee-intake/video-key-frame/c8bebd69-2006-4796-a591-65e97be82e37/1791549689421-d515da14-fa4f-4ffa-ae92-881d5031e946.jpg', false, 5, 'video_key_frame_5', 'Distinct video key image 5 of 5']
      ];
      for (const [id, url, primary, order, slot, room] of mbalwaImages) {
        await client.query(
          `INSERT INTO property_images (id, property_id, url, is_primary, sort_order, slot_key, room_label)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, MBALWA, url, primary, order, slot, room]
        );
      }
      const namulandaImages = [
        ['e07d9155-226c-4921-9086-bd6e66abc454', true, 0, 'Distinct video key image 1 of 3'],
        ['d5a58fa6-04b1-4501-b9d6-f0b4e0d5142d', false, 1, 'Distinct video key image 2 of 3'],
        ['3f92067d-2354-4ece-bf18-6ffecaf7c856', false, 2, 'Distinct video key image 3 of 3']
      ];
      for (const [id, primary, order, room] of namulandaImages) {
        await client.query(
          `INSERT INTO property_images (id, property_id, url, is_primary, sort_order, slot_key, room_label)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, NAMULANDA, `https://media.makaug.com/${id}.jpg`, primary, order, 'video_key_frame_1', room]
        );
      }
      await client.query(
        `INSERT INTO property_images (id, property_id, url, is_primary, sort_order, room_label) VALUES
          ('11111111-1111-4111-8111-111111111111', $1, 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=900&q=80', true, 0, 'Stock house'),
          ('22222222-2222-4222-8222-222222222222', $1, 'https://media.makaug.com/photo-1560518883-ce09059eeffa.jpg', false, 1, 'Hosted stock'),
          ('33333333-3333-4333-8333-333333333333', $1, 'https://media.makaug.com/decoy-real.jpg', false, 2, 'Real plot')`,
        [DECOY]
      );
    }

    await t.test('the live guards apply and a second run skips every listing', async () => {
      await client.query('BEGIN');
      await seed();
      const first = await apply(sql);
      const applied = rowNotices(first.notices);
      const appliedIds = applied.filter((item) => item.verb === 'applied').map((item) => `${item.id.slice(0, 8)}:${item.reason}`).sort();
      assert.deepEqual(appliedIds, [
        `${BUSIKA.slice(0, 8)}:busika_luwero`,
        `${GAYAZA.slice(0, 8)}:property_type_land`,
        `${KAKIRI.slice(0, 8)}:kakiri_land`,
        `${KASANJE.slice(0, 8)}:hide_no_real_photos`,
        `${KASANJE.slice(0, 8)}:property_type_land`,
        `${KASANJE.slice(0, 8)}:remove_copied_photos`,
        `${KIKYUSA.slice(0, 8)}:kikyusa_per_acre`,
        `${KITENDE.slice(0, 8)}:property_type_land`,
        `${MBALWA.slice(0, 8)}:mbalwa_media`,
        `${NAMULANDA.slice(0, 8)}:namulanda_primary`,
        `${NAMUSEERA.slice(0, 8)}:namuseera_area`,
        `${NTINDA.slice(0, 8)}:hide_no_real_photos`,
        `${DECOY.slice(0, 8)}:remove_stock_photo`
      ].sort(), first.notices.join('\n'));
      assert.equal(applied.filter((item) => item.verb === 'skipped').length, 0, first.notices.join('\n'));

      const kasanje = await row(KASANJE);
      assert.equal(kasanje.property_type, 'Land');
      assert.equal(kasanje.listing_type, 'land');
      assert.equal(kasanje.area, 'Nakawuka');
      assert.equal(Number(kasanje.price), 24000000);
      assert.equal((await images(KASANJE)).length, 0);
      assert.equal(kasanje.status, 'hidden');
      assert.equal(kasanje.extra_fields.hidden_reason, 'hidden: no real photos');
      assert.equal(kasanje.updated_at.toISOString(), new Date(kasanje.extra_fields.listing_correction_177.applied_at).toISOString());
      assert.ok(kasanje.extra_fields.listing_correction_177.actions.includes('property_type_land'));
      assert.ok(kasanje.extra_fields.listing_correction_177.actions.includes('remove_copied_photos'));
      assert.ok(kasanje.extra_fields.listing_correction_177.actions.includes('hide_no_real_photos'));
      const ntinda = await row(NTINDA);
      assert.equal(ntinda.status, 'hidden');
      assert.equal(ntinda.extra_fields.hidden_reason, 'hidden: no real photos');
      assert.equal(ntinda.title, '6-Bed house for sale in Ntinda');

      assert.equal((await row(GAYAZA)).property_type, 'Land');
      assert.equal((await images(GAYAZA)).length, 1);
      assert.equal((await row(KITENDE)).property_type, 'Land');
      assert.equal((await row(KITENDE)).area, null);

      const busika = await row(BUSIKA);
      assert.equal(busika.title, 'Land for sale in Busika');
      assert.equal(busika.listing_type, 'land');
      assert.equal(busika.property_type, 'Land');
      assert.equal(busika.area, 'Busika');
      assert.equal(busika.district, 'Luwero');
      assert.equal(busika.extra_fields.canonical_location_id, 'luwero:busika');
      assert.equal(busika.extra_fields.city, 'Luwero');
      assert.equal(busika.extra_fields.neighborhood, 'Busika');
      assert.equal(busika.extra_fields.region, 'Central');
      assert.match(busika.description, /^Land for sale in Busika, Luwero, listed at UGX 40,000,000\. Caption\./);

      const kakiri = await row(KAKIRI);
      assert.equal(kakiri.title, 'Land for sale in Kakiri');
      assert.equal(kakiri.listing_type, 'land');
      assert.equal(kakiri.property_type, 'Land');
      assert.match(kakiri.description, /^Land for sale in Kakiri, Wakiso, listed at UGX 45,000,000\. Caption\./);
      assert.equal((await images(KAKIRI)).length, 0);

      const namuseera = await row(NAMUSEERA);
      assert.equal(namuseera.title, 'Land for sale in Namuseera');
      assert.equal(namuseera.area, 'Namuseera');
      assert.equal(namuseera.district, 'Wakiso');
      assert.equal(namuseera.property_type, 'Commercial land');
      assert.equal(namuseera.extra_fields.canonical_location_id, 'wakiso:wakiso');
      assert.equal(namuseera.extra_fields.neighborhood, 'Namuseera');
      assert.equal(namuseera.extra_fields.city, undefined);
      assert.equal(namuseera.extra_fields.resolved_location_label, 'Namuseera, Wakiso');
      assert.match(namuseera.description, /^Plots for sale in Namuseera Estate/);

      const kikyusa = await row(KIKYUSA);
      assert.equal(Number(kikyusa.price), 13000000);
      assert.equal(kikyusa.price_unit, 'per_acre');
      assert.equal(kikyusa.price_period, 'acre');
      assert.equal(kikyusa.price_original, null);
      assert.equal(kikyusa.land_size_value, null);
      assert.equal(kikyusa.land_size_unit, null);
      assert.match(kikyusa.description, /^Land for sale in Kikyusa, Nakaseke, listed at UGX 13,000,000 per acre\. /);
      assert.match(kikyusa.description, /70 acres/);

      const mbalwaImages = await images(MBALWA);
      assert.deepEqual(mbalwaImages.map((image) => image.id), [
        '9aabcdde-3d49-4df5-9dbf-41992ddb4c5f',
        'c7bd7386-7306-4b7e-a14b-899092fbdf1d',
        '0cbf2b94-204d-4aed-a3d7-21d18afa1a44'
      ]);
      assert.equal(mbalwaImages[0].is_primary, true);
      assert.equal(mbalwaImages[0].sort_order, 0);
      assert.ok(mbalwaImages.every((image) => image.room_label == null));
      const mbalwa = await row(MBALWA);
      assert.match(mbalwa.description, /Watch the attached video tour and browse the 3 plot photos before enquiring\./);
      assert.doesNotMatch(mbalwa.description, /2 attached video tours/);
      assert.equal(mbalwa.extra_fields.video_url, MBALWA_VIDEO_1);
      assert.equal(mbalwa.extra_fields.video_tours.length, 1);
      assert.equal(mbalwa.extra_fields.video_tours[0].url, MBALWA_VIDEO_1);
      assert.deepEqual(mbalwa.extra_fields.video_urls, [MBALWA_VIDEO_1]);

      const namulandaImages = await images(NAMULANDA);
      assert.equal(namulandaImages.find((image) => image.is_primary).id, 'd5a58fa6-04b1-4501-b9d6-f0b4e0d5142d');
      assert.deepEqual(namulandaImages.map((image) => [image.id, image.sort_order, image.is_primary]), [
        ['d5a58fa6-04b1-4501-b9d6-f0b4e0d5142d', 0, true],
        ['3f92067d-2354-4ece-bf18-6ffecaf7c856', 1, false],
        ['e07d9155-226c-4921-9086-bd6e66abc454', 2, false]
      ]);
      assert.ok(namulandaImages.every((image) => image.room_label == null));

      const decoy = await row(DECOY);
      assert.equal(decoy.title, 'Property for sale in Busika');
      assert.equal(decoy.property_type, 'house');
      assert.ok(decoy.extra_fields.listing_correction_177.actions.includes('remove_stock_photo'));
      assert.equal(Number(decoy.price), 1000);
      const decoyImages = await images(DECOY);
      assert.deepEqual(decoyImages.map((image) => image.id), ['33333333-3333-4333-8333-333333333333']);
      assert.equal(decoyImages[0].room_label, 'Real plot');

      const backupImages = await client.query(
        `SELECT row_kind, action FROM listing_correction_177_backup WHERE property_id = $1 ORDER BY action, row_key`,
        [KASANJE]
      );
      assert.equal(backupImages.rows.filter((item) => item.action === 'delete_image').length, 4);
      const videoBackup = await client.query(
        `SELECT before_row->>'url' AS url FROM listing_correction_177_backup
          WHERE property_id = $1 AND row_kind = 'video_tour'`,
        [MBALWA]
      );
      assert.equal(videoBackup.rows[0].url, MBALWA_VIDEO_2);
      const backedPhoto = await client.query(
        `SELECT before_row->>'url' AS url FROM listing_correction_177_backup
          WHERE row_key = 'bfd2d7fe-db42-4229-9bd5-762d9504b986'`
      );
      assert.match(backedPhoto.rows[0].url, /plot-photo\.jpg$/);

      const stampedAt = kasanje.updated_at.toISOString();
      const second = await apply(sql);
      const skipped = rowNotices(second.notices);
      assert.equal(skipped.length, 13, second.notices.join('\n'));
      assert.ok(skipped.every((item) => item.verb === 'skipped' && item.reason === 'already_in_target_state'), second.notices.join('\n'));
      assert.equal((await row(KASANJE)).updated_at.toISOString(), stampedAt);
      assert.equal((await client.query('SELECT COUNT(*)::int AS n FROM listing_correction_177_backup WHERE action = \'delete_image\' AND property_id = $1', [KASANJE])).rows[0].n, 4);

      const propertyUpdates = updates(await client.query(rollbackSql));
      assert.ok(propertyUpdates >= 1);
      const restored = await row(KASANJE);
      assert.equal(restored.property_type, 'house');
      assert.equal(restored.status, 'approved');
      assert.equal(restored.extra_fields.listing_correction_177, undefined);
      assert.equal(restored.extra_fields.hidden_reason, undefined);
      assert.equal((await images(KASANJE)).length, 4);
      const restoredNtinda = await row(NTINDA);
      assert.equal(restoredNtinda.status, 'approved');
      assert.equal(restoredNtinda.extra_fields.hidden_reason, undefined);
      assert.equal((await images(KASANJE))[0].is_primary, true);
      const restoredMbalwa = await row(MBALWA);
      assert.match(restoredMbalwa.description, /Watch the 2 attached video tours and browse 5 extracted key images before enquiring\./);
      assert.equal(restoredMbalwa.extra_fields.video_tours.length, 2);
      assert.equal(restoredMbalwa.extra_fields.video_tours[1].url, MBALWA_VIDEO_2);
      const restoredPrimary = await images(MBALWA);
      assert.equal(restoredPrimary.find((image) => image.is_primary).id, 'a18c7a45-8c4e-433b-8c50-becee8f53e71');
      assert.equal((await images(MBALWA)).length, 6);
      assert.equal((await images(MBALWA)).find((image) => image.id === '9aabcdde-3d49-4df5-9dbf-41992ddb4c5f').room_label, 'Distinct video key image 1 of 5');
      const restoredNamulanda = await images(NAMULANDA);
      assert.equal(restoredNamulanda.find((image) => image.is_primary).id, 'e07d9155-226c-4921-9086-bd6e66abc454');
      assert.equal(restoredNamulanda.find((image) => image.id === 'd5a58fa6-04b1-4501-b9d6-f0b4e0d5142d').room_label, 'Distinct video key image 2 of 3');
      assert.equal((await images(DECOY)).length, 3);
      const restoredKikyusa = await row(KIKYUSA);
      assert.equal(restoredKikyusa.price, null);
      assert.equal(restoredKikyusa.price_unit, null);
      assert.equal(restoredKikyusa.price_period, 'once');
      assert.equal(restoredKikyusa.land_size_value, null);
      assert.match(restoredKikyusa.description, /listed at UGX 13,000,000\. /);
      const restoredBusika = await row(BUSIKA);
      assert.equal(restoredBusika.title, 'Property for sale in Busika');
      assert.equal(restoredBusika.district, 'Wakiso');
      assert.equal(restoredBusika.extra_fields.canonical_location_id, 'wakiso:wakiso');
      const restoredNamuseera = await row(NAMUSEERA);
      assert.equal(restoredNamuseera.area, null);
      assert.equal(restoredNamuseera.extra_fields.resolved_location_label, 'From, Kampala, Central');
      assert.equal((await client.query(`SELECT to_regclass('listing_correction_177_backup') AS name`)).rows[0].name, 'listing_correction_177_backup');
      await client.query('ROLLBACK');
    });

    await t.test('a price that is already set, a POA row, and a changed title are skipped', async () => {
      await client.query('BEGIN');
      await seed();
      await client.query(`UPDATE properties SET price = 20000000, price_original = 20000000 WHERE id = $1`, [KIKYUSA]);
      await client.query(`UPDATE properties SET title = 'House for sale in Busika' WHERE id = $1`, [BUSIKA]);
      await client.query(`UPDATE properties SET property_type = 'apartment' WHERE id = $1`, [KITENDE]);
      await client.query(`UPDATE properties SET area = 'Namuseera Estate' WHERE id = $1`, [NAMUSEERA]);
      const run = await apply(sql);
      const notes = rowNotices(run.notices);
      assert.equal(notes.find((item) => item.id === KIKYUSA).reason, 'price_guard');
      assert.equal(Number((await row(KIKYUSA)).price), 20000000);
      assert.equal((await row(KIKYUSA)).price_unit, null);
      assert.equal((await row(KIKYUSA)).land_size_value, null);
      assert.equal(notes.find((item) => item.id === BUSIKA).reason, 'title_guard');
      assert.equal((await row(BUSIKA)).district, 'Wakiso');
      assert.equal(notes.find((item) => item.id === KITENDE).reason, 'type_guard');
      assert.equal((await row(KITENDE)).property_type, 'apartment');
      assert.equal(notes.find((item) => item.id === NAMUSEERA).reason, 'area_guard');
      assert.equal((await row(NAMUSEERA)).area, 'Namuseera Estate');
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await seed();
      await client.query(`UPDATE properties SET price_on_application = true WHERE id = $1`, [KIKYUSA]);
      const poa = await apply(sql);
      assert.equal(rowNotices(poa.notices).find((item) => item.id === KIKYUSA).reason, 'poa_guard');
      assert.equal((await row(KIKYUSA)).price, null);
      await client.query('ROLLBACK');
    });

    await t.test('a photo url mismatch and a non-primary bungalow are left in place', async () => {
      await client.query('BEGIN');
      await seed();
      await client.query(`UPDATE property_images SET url = url || '?changed' WHERE id = 'bfd2d7fe-db42-4229-9bd5-762d9504b986'`);
      const photos = await apply(sql);
      assert.equal(rowNotices(photos.notices).find((item) => item.id === KASANJE && item.reason === 'url_guard').reason, 'url_guard');
      assert.equal(rowNotices(photos.notices).find((item) => item.id === KASANJE && item.reason === 'has_media').reason, 'has_media');
      assert.equal((await images(KASANJE)).length, 4);
      assert.equal((await row(KASANJE)).status, 'approved');
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await seed();
      await client.query(`UPDATE property_images SET is_primary = false WHERE id = 'a18c7a45-8c4e-433b-8c50-becee8f53e71'`);
      await client.query(`UPDATE property_images SET is_primary = true WHERE id = 'c7bd7386-7306-4b7e-a14b-899092fbdf1d'`);
      const primary = await apply(sql);
      assert.equal(rowNotices(primary.notices).find((item) => item.id === MBALWA).reason, 'primary_guard');
      assert.equal((await images(MBALWA)).length, 6);
      assert.equal((await row(MBALWA)).extra_fields.video_tours.length, 2);
      await client.query('ROLLBACK');
    });

    await t.test('another country and a deleted row are skipped', async () => {
      await client.query('BEGIN');
      await seed();
      const other = await apply(sql, 'ZA');
      assert.match(other.notices.join('\n'), /country_not_ug/);
      assert.equal(rowNotices(other.notices).length, 0);
      assert.equal((await row(KASANJE)).property_type, 'house');
      assert.equal((await images(KASANJE)).length, 4);
      assert.equal((await images(DECOY)).length, 3);
      await client.query('ROLLBACK');

      await client.query('BEGIN');
      await seed();
      await client.query(`UPDATE properties SET status = 'deleted' WHERE id = $1`, [GAYAZA]);
      const deleted = await apply(sql);
      assert.equal(rowNotices(deleted.notices).find((item) => item.id === GAYAZA).reason, 'deleted');
      assert.equal((await row(GAYAZA)).property_type, 'house');
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
