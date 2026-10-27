'use strict';

// Migration 191: the four listings Arthur approved on 27 Oct 2026
// (3F73F8, B9466B, A64E8E, 99C69E). Applied on an isolated PostgreSQL.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { canonicalizeUgandaLocation } = require('../utils/ugandaLocationRegistry');
const { publicLandSizeLabel, computedListingTotal } = require('../utils/listingLandPrice');

const MIGRATION = path.join(__dirname, '../db/migrations/191_moderator_listing_corrections_27oct.sql');
const ROLLBACK = path.join(__dirname, '../scripts/rollback-191-listing-corrections.sql');
const MIGRATIONS = path.join(__dirname, '../db/migrations');
const PG_BIN = [process.env.LFM_PG_BIN, '/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/18/bin']
  .filter(Boolean)
  .find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));

const K3 = '25cb20a5-1098-45f0-ba88-f52de03f8467';
const K5 = '018b5d39-86f2-47aa-a876-d3faefa0e591';
const A64 = 'a90d30c5-78eb-4896-ab34-b84b7e2d0da1';
const GARUGA = 'c75c3e0a-1156-482f-a37c-35afbabd8587';
const DECOY = '00000000-0000-4000-8000-000000000191';
const STILL_1 = 'https://media.makaug.com/whatsapp-employee-intake/video-key-frame/a90d30c5-78eb-4896-ab34-b84b7e2d0da1/1793078133960-32e174d6-8a31-4228-9ce6-ef297b6545d4.jpg';
const STILL_2 = 'https://media.makaug.com/whatsapp-employee-intake/video-key-frame/a90d30c5-78eb-4896-ab34-b84b7e2d0da1/1793078134831-aebfa086-93b6-468f-a728-3655fafa806f.jpg';
const sql = fs.readFileSync(MIGRATION, 'utf8');
const rollbackSql = fs.readFileSync(ROLLBACK, 'utf8');

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

function rowNotices(list) {
  return list.flatMap((message) => {
    const match = String(message).match(/^listing_correction_191 ([0-9a-f-]{36}) (applied|skipped) (\S+)/);
    return match ? [{ id: match[1], verb: match[2], reason: match[3] }] : [];
  });
}

test('migration 191 is the only 191, backs up first, ships a rollback, and only names the four listings', () => {
  const names = fs.readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql'));
  assert.equal(names.filter((name) => name.startsWith('191_')).length, 1);
  assert.equal(fs.existsSync(path.join(MIGRATIONS, 'rollback-191-listing-corrections.sql')), false);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS listing_correction_191_backup/);
  assert.match(rollbackSql, /listing_correction_191_backup/);
  assert.doesNotMatch(sql, /DELETE\s+FROM/i);
  assert.doesNotMatch(rollbackSql, /DELETE\s+FROM|DROP TABLE listing_correction_191_backup/i);
  const ids = new Set(sql.match(/(?<=')[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=')/g));
  assert.deepEqual([...ids].sort(), [K5, K3, A64, GARUGA].sort());
  // The neighbourhood is the canonical place #606 added.
  assert.equal(canonicalizeUgandaLocation('Kisowera', 'Mukono').key, 'mukono:kisowera');
  // 99C69E reads as 4 acres and a 3.2bn total once price_unit is per_acre.
  const garuga = { price: 800000000, price_unit: 'per_acre', price_period: 'acre', land_size_value: 4, land_size_unit: 'acres' };
  assert.equal(publicLandSizeLabel(garuga), '4 acres');
  assert.equal(computedListingTotal(garuga), 3200000000);
});

test('migration 191 applies once, skips moved values, and rolls back', {
  skip: PG_BIN ? false : 'Install PostgreSQL or set LFM_PG_BIN for the isolated database test.',
  timeout: 120000
}, async (t) => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-migration-191-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'socket');
  fs.mkdirSync(socket);
  let client;
  let started = false;
  const notices = [];
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=lfm_191', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    const port = await freePort();
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '20', '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`, 'start'], { stdio: 'pipe' });
    started = true;
    client = new Client({ host: '127.0.0.1', port, user: 'lfm_191', database: 'postgres' });
    await client.connect();
    client.on('notice', (notice) => notices.push(notice.message || String(notice)));
    await client.query(`
      CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;
      CREATE TABLE properties (
        id uuid PRIMARY KEY, inquiry_reference text, title text, description text, status text,
        listing_type text, property_type text, bedrooms integer, area text, district text,
        price bigint, price_currency text, price_unit text, price_period text,
        land_size_value numeric, land_size_unit text, latitude numeric, longitude numeric,
        extra_fields jsonb, updated_at timestamptz
      );
      CREATE TRIGGER trg_properties_updated_at BEFORE UPDATE ON properties
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      CREATE TABLE property_images (
        id uuid PRIMARY KEY, property_id uuid, url text, is_primary boolean, sort_order integer,
        created_at timestamptz, slot_key text, room_label text
      );
      CREATE TABLE property_video_ocr (
        property_id uuid PRIMARY KEY, status text, ocr_text text, parsed_facts jsonb, updated_at timestamptz
      );
    `);

    const stamp = '2026-10-27T05:28:06.019575Z';
    const kisoweraExtra = { neighborhood: 'Kisowera', region: 'Central', resolved_location_label: 'Kisowera, Mukono, Central', location_resolution_status: 'unresolved' };
    const videoFacts = { type: 'land', price: 4000000000, currency: 'UGX' };

    async function seed({ k5Title = '5-bed property for sale in Kisowera' } = {}) {
      await client.query('DELETE FROM properties; DELETE FROM property_images; DELETE FROM property_video_ocr; DROP TABLE IF EXISTS listing_correction_191_backup');
      const insert = `INSERT INTO properties (id, inquiry_reference, title, status, listing_type, property_type, bedrooms, area, district,
        price, price_currency, price_unit, price_period, land_size_value, land_size_unit, latitude, longitude, extra_fields, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'UGX',$11,$12,$13,$14,$15,$16,$17::jsonb,$18)`;
      await client.query(insert, [K3, 'MK-20261026-3F73F8', '3-bed property for sale in Kisowera', 'approved', 'sale', 'house', 3, 'Kisowera', 'Mukono', 180000000, null, 'once', 25, 'decimals', null, null, JSON.stringify(kisoweraExtra), stamp]);
      await client.query(insert, [K5, 'MK-20261026-B9466B', k5Title, 'approved', 'sale', 'house', 5, 'Kisowera', 'Mukono', 280000000, null, 'once', 1, 'acres', null, null, JSON.stringify(kisoweraExtra), stamp]);
      await client.query(insert, [A64, 'MK-20261026-A64E8E', 'Land for sale in Mutundwe', 'rejected', 'sale', null, null, 'Mutundwe', 'Kampala', 1400000000, 'total', 'once', 1, 'acres', null, null,
        JSON.stringify({ city: 'Rubaga', public_image_count: 0, media_validation_status: 'blocked_no_usable_property_image', video_caption_ocr: { status: 'done', facts: videoFacts } }), stamp]);
      await client.query(insert, [GARUGA, 'MK-20261026-99C69E', 'Land for sale in Garuga', 'approved', 'land', null, null, 'Garuga', 'Wakiso', 800000000, null, 'acre', 4, 'acres', null, null, JSON.stringify({ city: 'Wakiso' }), stamp]);
      await client.query(insert, [DECOY, 'MK-DECOY', '3-bed property for sale in Kisowera', 'approved', 'sale', 'house', 3, 'Kisowera', 'Mukono', 180000000, null, 'once', 25, 'decimals', null, null, JSON.stringify(kisoweraExtra), stamp]);
      await client.query(`INSERT INTO property_images VALUES
        ('9a1d1caf-10cd-42c1-9f8d-9cb0869f594a', $1, $2, true, 0, '2026-10-27T05:15:35Z', 'video_key_frame_1', 'Distinct video key image 1 of 2'),
        ('24a68e92-8f99-421f-b534-eabde2f73d55', $1, $3, false, 1, '2026-10-27T05:15:35Z', 'video_key_frame_2', 'Distinct video key image 2 of 2')`, [A64, STILL_1, STILL_2]);
      await client.query(`INSERT INTO property_video_ocr VALUES ($1, 'done', 'UGX 14', $2::jsonb, NOW())`, [A64, JSON.stringify(videoFacts)]);
    }
    async function apply(text) {
      const before = notices.length;
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.country_code', 'UG', true)");
      await client.query(text);
      await client.query('COMMIT');
      return rowNotices(notices.slice(before));
    }
    const row = async (id) => (await client.query('SELECT * FROM properties WHERE id = $1', [id])).rows[0];

    await t.test('applies the approved values and nothing else', async () => {
      await seed();
      const first = await apply(sql);
      assert.deepEqual(first.map((n) => n.verb), ['applied', 'applied', 'applied', 'applied'], JSON.stringify(first));

      for (const [id, beds] of [[K3, 3], [K5, 5]]) {
        const p = await row(id);
        assert.equal(p.title, `${beds}-bed house for sale in Kisowera, Mukono`);
        assert.equal(p.extra_fields.city, 'Mukono');
        assert.equal(p.extra_fields.neighborhood, 'Kisowera');
        assert.equal(p.extra_fields.canonical_location_id, 'mukono:kisowera');
        assert.equal(p.district, 'Mukono');
        assert.equal(Number(p.latitude), 0.4175);
        assert.equal(Number(p.longitude), 32.7703);
        assert.equal(p.updated_at.toISOString(), new Date(p.extra_fields.listing_correction_191.applied_at).toISOString());
      }
      const a64 = await row(A64);
      assert.equal(Number(a64.price), 1400000000);
      assert.equal(a64.status, 'rejected');
      assert.equal(a64.extra_fields.public_image_count, 2);
      assert.equal(a64.extra_fields.primary_image_url, STILL_1);
      assert.equal(a64.extra_fields.media_validation_status, 'passed_repair_image_gate');
      assert.equal(a64.extra_fields.video_caption_ocr.facts.price, null);
      assert.equal(a64.extra_fields.video_caption_ocr.facts.type, 'land');
      const ocr = (await client.query('SELECT parsed_facts FROM property_video_ocr WHERE property_id = $1', [A64])).rows[0];
      assert.equal(ocr.parsed_facts.price, null);
      assert.equal(ocr.parsed_facts.type, 'land');
      const garuga = await row(GARUGA);
      assert.equal(garuga.price_unit, 'per_acre');
      assert.equal(Number(garuga.price), 800000000);
      const decoy = await row(DECOY);
      assert.equal(decoy.title, '3-bed property for sale in Kisowera');
      assert.equal(decoy.extra_fields.city, undefined);
      assert.equal(decoy.latitude, null);

      const second = await apply(sql);
      assert.deepEqual(second.map((n) => n.reason), Array(4).fill('already_in_target_state'));
      const backups = (await client.query('SELECT row_kind, COUNT(*)::int n FROM listing_correction_191_backup GROUP BY 1 ORDER BY 1')).rows;
      assert.deepEqual(backups, [{ row_kind: 'property', n: 4 }, { row_kind: 'video_ocr', n: 1 }]);
    });

    await t.test('the rollback restores every touched value', async () => {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.country_code', 'UG', true)");
      await client.query(rollbackSql);
      await client.query('COMMIT');
      const k3 = await row(K3);
      assert.equal(k3.title, '3-bed property for sale in Kisowera');
      assert.equal(k3.latitude, null);
      assert.equal(k3.extra_fields.city, undefined);
      assert.equal(k3.extra_fields.listing_correction_191, undefined);
      assert.equal(k3.updated_at.toISOString(), new Date(stamp).toISOString());
      const a64 = await row(A64);
      assert.equal(a64.extra_fields.media_validation_status, 'blocked_no_usable_property_image');
      assert.equal(a64.extra_fields.video_caption_ocr.facts.price, 4000000000);
      const ocr = (await client.query('SELECT parsed_facts FROM property_video_ocr WHERE property_id = $1', [A64])).rows[0];
      assert.equal(ocr.parsed_facts.price, 4000000000);
      assert.equal((await row(GARUGA)).price_unit, null);
    });

    await t.test('a listing whose title moved is skipped, not guessed', async () => {
      await seed({ k5Title: 'Country home for sale in Kisowera' });
      const result = await apply(sql);
      assert.deepEqual(result.find((n) => n.id === K5), { id: K5, verb: 'skipped', reason: 'guard' });
      assert.equal((await row(K5)).title, 'Country home for sale in Kisowera');
      assert.equal((await row(K3)).title, '3-bed house for sale in Kisowera, Mukono');
    });
  } finally {
    if (client) await client.end().catch(() => {});
    if (started) {
      try {
        execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], { stdio: 'pipe' });
      } catch (error) { /* already stopped */ }
    }
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});
