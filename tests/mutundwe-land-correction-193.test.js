'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { publicLandSizeLabel } = require('../utils/listingLandPrice');

const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/193_mutundwe_land_duplicate_correction.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(__dirname, '../scripts/rollback-193-mutundwe-land.sql'), 'utf8');
const PG_BIN = [process.env.LFM_PG_BIN, '/opt/homebrew/opt/postgresql@18/bin', '/usr/lib/postgresql/18/bin', '/usr/lib/postgresql/16/bin']
  .filter(Boolean).find((dir) => fs.existsSync(path.join(dir, 'initdb')));
const K = '26883a3f-e5ba-4dd1-8aed-6ff02e05dd0d';
const D = 'a90d30c5-78eb-4896-ab34-b84b7e2d0da1';
const A = '5674f6cb-37a0-4e1e-904f-06e03ec401ab';
const oldUrls = [
  `https://media.makaug.com/whatsapp-employee-intake/video-key-frame/${K}/1792479220194-47768686-d78b-47da-a8ad-9d8440475e7a.jpg`,
  `https://media.makaug.com/whatsapp-employee-intake/video-key-frame/${K}/1792479220993-c834d5e0-a248-47ee-9b9e-1060d1c65c10.jpg`
];
const sourceUrls = [
  `https://media.makaug.com/whatsapp-employee-intake/video-key-frame/${D}/1793078133960-32e174d6-8a31-4228-9ce6-ef297b6545d4.jpg`,
  `https://media.makaug.com/whatsapp-employee-intake/video-key-frame/${D}/1793078134831-aebfa086-93b6-468f-a728-3655fafa806f.jpg`
];

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('approved Mutundwe correction applies, guards drift and rolls back in isolated PostgreSQL', {
  skip: PG_BIN ? false : 'Set LFM_PG_BIN to an installed PostgreSQL bin directory', timeout: 120000
}, async (t) => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-193-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'socket');
  fs.mkdirSync(socket);
  let client;
  let started = false;
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=correction_193_test', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    const port = await freePort();
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-o', `-h 127.0.0.1 -p ${port} -k ${socket} -c fsync=off`, 'start'], { stdio: 'pipe' });
    started = true;
    client = new Client({ host: '127.0.0.1', port, user: 'correction_193_test', database: 'postgres' });
    await client.connect();
    await client.query(`
      CREATE TABLE properties (
        id uuid PRIMARY KEY, inquiry_reference text, title text, status text,
        listing_type text, transaction_type text, property_type text, agent_id uuid,
        price bigint, price_currency text, area text, district text,
        land_size_value numeric, land_size_unit text, moderation_reason text,
        latitude numeric, longitude numeric, extra_fields jsonb, updated_at timestamptz, price_unit text
      );
      CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=NOW(); RETURN NEW; END $$;
      CREATE TRIGGER trg_properties_updated_at BEFORE UPDATE ON properties FOR EACH ROW EXECUTE FUNCTION set_updated_at();
      CREATE TABLE property_images (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_id uuid, url text,
        is_primary boolean, sort_order int, slot_key text, room_label text, created_at timestamptz DEFAULT NOW()
      );
      CREATE TABLE property_moderation_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), property_id uuid, actor_id text,
        action text, status_from text, status_to text, reason text, notes text, delivery jsonb
      );
    `);
    async function seed({ keeperImages = true } = {}) {
      await client.query('TRUNCATE properties, property_images, property_moderation_events; DROP TABLE IF EXISTS listing_correction_193_backup');
      for (const [id, ref, status, size] of [[K, 'MK-20261016-3307F2', 'approved', null], [D, 'MK-20261026-A64E8E', 'rejected', 1]]) {
        await client.query(`INSERT INTO properties VALUES ($1,$2,'Land for sale in Mutundwe',$3,'sale',NULL,NULL,$4,
          1400000000,'UGX','Mutundwe','Kampala',$5,$6,'Old moderation reason',0.282726,32.532664,
          '{"keep_this":"unchanged"}', '2026-10-24T09:04:07.160884Z', NULL)`, [id, ref, status, A, size, size ? 'acres' : null]);
      }
      for (const [id, urls] of [[K, keeperImages ? oldUrls : []], [D, sourceUrls]]) {
        for (const [i, url] of urls.entries()) await client.query(`INSERT INTO property_images
          (property_id,url,is_primary,sort_order,slot_key,room_label) VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, url, i === 0, i, `video_key_frame_${i + 1}`, `Video image ${i + 1}`]);
      }
    }
    const row = async (id) => (await client.query('SELECT to_jsonb(p) data FROM properties p WHERE id=$1', [id])).rows[0].data;
    const images = async (id) => (await client.query('SELECT * FROM property_images WHERE property_id=$1 ORDER BY sort_order,id', [id])).rows;
    async function apply(text, country = 'UG') {
      await client.query('BEGIN');
      try {
        await client.query("SELECT set_config('app.country_code',$1,true)", [country]);
        await client.query(text);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
    await t.test('sets Land and one acre, copies the approved stills, preserves status/price/pin and remains idempotent', async () => {
      await seed();
      const before = await row(K);
      const beforeImages = await images(K);
      await apply(sql);
      const keeper = await row(K);
      const duplicate = await row(D);
      assert.equal(keeper.listing_type, 'land');
      assert.equal(keeper.transaction_type, 'sale');
      assert.equal(keeper.price_unit, 'total');
      assert.equal(publicLandSizeLabel(keeper), '1 acre');
      assert.equal(keeper.status, 'approved');
      for (const key of ['price', 'title', 'latitude', 'longitude', 'agent_id', 'property_type']) assert.deepEqual(keeper[key], before[key]);
      assert.equal(keeper.extra_fields.keep_this, 'unchanged');
      assert.equal(duplicate.status, 'rejected');
      assert.equal(duplicate.listing_type, 'land');
      assert.match(duplicate.moderation_reason, /Duplicate of MK-20261016-3307F2/);
      assert.equal((await client.query("SELECT COUNT(*)::int n FROM properties WHERE status='approved' AND listing_type='land'")).rows[0].n, 1);
      const copied = await images(K);
      assert.deepEqual(copied.map((i) => i.url), sourceUrls);
      assert.deepEqual(copied.map((i) => i.id), beforeImages.map((i) => i.id));
      assert.equal(copied.filter((i) => i.is_primary).length, 1);
      assert.equal(keeper.extra_fields.public_image_count, 2);
      const corrected = [keeper, duplicate, copied];
      await apply(sql);
      assert.deepEqual([await row(K), await row(D), await images(K)], corrected);
      assert.equal((await client.query('SELECT COUNT(*)::int n FROM listing_correction_193_backup')).rows[0].n, 2);
      assert.equal((await client.query('SELECT COUNT(*)::int n FROM property_moderation_events')).rows[0].n, 1);
      await apply(rollback);
      assert.deepEqual(await row(K), before);
      assert.deepEqual(await images(K), beforeImages);
      assert.equal((await row(D)).status, 'rejected');
      assert.equal((await row(D)).listing_type, 'sale');
    });
    for (const [label, drift] of [
      ['changed price', `UPDATE properties SET price=1500000000 WHERE id='${K}'`],
      ['changed duplicate approval', `UPDATE properties SET status='approved' WHERE id='${D}'`],
      ['different agent', `UPDATE properties SET agent_id=gen_random_uuid() WHERE id='${D}'`],
      ['new staff photo', `UPDATE property_images SET url='https://media.makaug.com/new-staff-photo.jpg' WHERE property_id='${K}' AND is_primary`]
    ]) {
      await t.test(`skips the complete correction for ${label}`, async () => {
        await seed(); await client.query(drift);
        const before = [await row(K), await row(D), await images(K)];
        await apply(sql);
        assert.deepEqual([await row(K), await row(D), await images(K)], before);
        assert.equal((await client.query('SELECT COUNT(*)::int n FROM listing_correction_193_backup')).rows[0].n, 0);
      });
    }
    await t.test('inserts missing video slots and rollback removes only those new rows', async () => {
      await seed({ keeperImages: false }); await apply(sql);
      assert.deepEqual((await images(K)).map((i) => i.url), sourceUrls);
      await apply(rollback);
      assert.deepEqual(await images(K), []);
    });
    for (const [label, edit] of [
      ['property edit', `UPDATE properties SET title='Staff edited title' WHERE id='${K}'`],
      ['image edit', `UPDATE property_images SET room_label='Staff edited label' WHERE property_id='${K}' AND is_primary`]
    ]) await t.test(`rollback preserves a later ${label}`, async () => {
      await seed(); await apply(sql); await client.query(edit);
      const before = [await row(K), await images(K)];
      await apply(rollback);
      assert.deepEqual([await row(K), await images(K)], before);
    });
    await t.test('rollback locks all image rows before comparing and restoring them', async () => {
      await seed(); await apply(sql);
      const control = new Client({ host: '127.0.0.1', port, user: 'correction_193_test', database: 'postgres' });
      const editor = new Client({ host: '127.0.0.1', port, user: 'correction_193_test', database: 'postgres' });
      await control.connect(); await editor.connect();
      let restoring;
      try {
        await control.query('SELECT pg_advisory_lock(193193)');
        await client.query(`CREATE FUNCTION pause_193_restore() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN PERFORM pg_advisory_xact_lock(193193); RETURN NEW; END $$;
          CREATE TRIGGER pause_restore BEFORE UPDATE ON property_images FOR EACH ROW
            WHEN (NEW.room_label IS DISTINCT FROM 'Concurrent staff edit') EXECUTE FUNCTION pause_193_restore()`);
        restoring = apply(rollback);
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
          const state = await control.query('SELECT wait_event FROM pg_stat_activity WHERE pid=$1', [client.processID]);
          waiting = state.rows[0]?.wait_event === 'advisory';
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assert.equal(waiting, true, 'rollback should pause while holding its row locks');
        const last = (await control.query('SELECT id FROM property_images WHERE property_id=$1 ORDER BY id DESC LIMIT 1', [K])).rows[0];
        await editor.query("SET lock_timeout='150ms'");
        await assert.rejects(editor.query("UPDATE property_images SET room_label='Concurrent staff edit' WHERE id=$1", [last.id]),
          (error) => error.code === '55P03');
        await control.query('SELECT pg_advisory_unlock(193193)');
        await restoring;
        restoring = null;
        await editor.query("UPDATE property_images SET room_label='Concurrent staff edit' WHERE id=$1", [last.id]);
        assert.equal((await control.query('SELECT room_label FROM property_images WHERE id=$1', [last.id])).rows[0].room_label, 'Concurrent staff edit');
      } finally {
        await control.query('SELECT pg_advisory_unlock_all()');
        if (restoring) await restoring.catch(() => {});
        await client.query('DROP TRIGGER IF EXISTS pause_restore ON property_images; DROP FUNCTION IF EXISTS pause_193_restore()');
        await control.end(); await editor.end();
      }
    });
    await t.test('does not apply outside Uganda', async () => {
      await seed(); const before = await row(K); await apply(sql, 'ZA');
      assert.deepEqual(await row(K), before);
      assert.equal((await client.query('SELECT COUNT(*)::int n FROM listing_correction_193_backup')).rows[0].n, 0);
    });
  } finally {
    if (client) await client.end().catch(() => {});
    if (started) execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], { stdio: 'pipe' });
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});
