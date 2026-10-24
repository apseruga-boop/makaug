'use strict';

// has_public_media must match the old public photo-or-video expression on
// seeded rows, and stay matched when images or extra_fields change.
// The database test starts its own cluster. It never reads DATABASE_URL.

process.env.S3_PUBLIC_BASE_URL = 'https://media.makaug.com';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const {
  legacyPublicHasPhotoOrVideoSql,
  publicHasPhotoOrVideoSql
} = require('../utils/realListingPhoto');
const { publicVisibleInventoryWhere } = require('../services/publicInventoryMetricsService');
const { approvedAgentListingsCountSql } = require('../services/agentListingCount');

const root = path.join(__dirname, '..');
const MIGRATION = path.join(root, 'db/migrations/180_property_has_public_media.sql');
const ROLLBACK = path.join(root, 'scripts/rollback-180-has-public-media.sql');
const CHECK = path.join(root, 'scripts/check-has-public-media-flag.js');
const migrationSql = fs.readFileSync(MIGRATION, 'utf8');
const rollbackSql = fs.readFileSync(ROLLBACK, 'utf8');
const checkSource = fs.readFileSync(CHECK, 'utf8');
const HOSTED = 'https://media.makaug.com/listings/front.jpg';
const STOCK = 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=900';

const PG_BIN = [
  process.env.LFM_PG_BIN,
  '/usr/lib/postgresql/16/bin',
  '/usr/lib/postgresql/17/bin',
  '/usr/lib/postgresql/18/bin'
].filter(Boolean).find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));

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

test('public listing filters read has_public_media and the migration keeps the old rule', () => {
  const names = fs.readdirSync(path.join(root, 'db/migrations')).filter((name) => name.endsWith('.sql'));
  assert.equal(names.filter((name) => name.startsWith('180_')).length, 1);
  assert.equal(names.includes('180_property_has_public_media.sql'), true);
  assert.equal(publicHasPhotoOrVideoSql('p'), 'p.has_public_media');
  assert.equal(publicHasPhotoOrVideoSql('properties'), 'properties.has_public_media');
  assert.equal(publicHasPhotoOrVideoSql(''), 'has_public_media');
  assert.throws(() => publicHasPhotoOrVideoSql('p;drop'), /Invalid SQL alias/);
  assert.equal(legacyPublicHasPhotoOrVideoSql('p').includes('property_images'), true);
  assert.equal(migrationSql.includes(legacyPublicHasPhotoOrVideoSql('p')), true);
  assert.match(migrationSql, /ADD COLUMN IF NOT EXISTS has_public_media boolean NOT NULL DEFAULT false/);
  assert.match(migrationSql, /BEFORE INSERT OR UPDATE OF extra_fields/);
  assert.match(migrationSql, /AFTER INSERT ON property_images/);
  assert.match(migrationSql, /AFTER DELETE ON property_images/);
  assert.match(migrationSql, /AFTER UPDATE ON property_images/);
  assert.match(migrationSql, /DISABLE TRIGGER trg_properties_updated_at/);
  assert.match(migrationSql, /ENABLE TRIGGER trg_properties_updated_at/);
  assert.match(migrationSql, /idx_properties_has_public_media_live/);
  assert.match(migrationSql, /WHERE has_public_media/);
  assert.match(migrationSql, /LOWER\(COALESCE\(status, ''\)\) IN \('approved', 'live', 'published'\)/);
  assert.match(migrationSql, /listing_type/);
  assert.doesNotMatch(migrationSql, /CREATE INDEX CONCURRENTLY/);
  assert.match(publicVisibleInventoryWhere('p'), /p\.has_public_media/);
  assert.match(approvedAgentListingsCountSql('a'), /p\.has_public_media/);
  for (const file of [
    'routes/properties.js',
    'services/publicInventoryMetricsService.js',
    'services/agentListingCount.js',
    'services/agentPublicProfileService.js'
  ]) {
    assert.match(fs.readFileSync(path.join(root, file), 'utf8'), /publicHasPhotoOrVideoSql\(/, file);
  }
  assert.match(rollbackSql, /DROP COLUMN IF EXISTS has_public_media/);
  assert.match(rollbackSql, /DROP INDEX IF EXISTS idx_properties_has_public_media_live/);
  assert.match(rollbackSql, /DROP TRIGGER IF EXISTS properties_set_has_public_media/);
  assert.match(rollbackSql, /DROP FUNCTION IF EXISTS property_has_public_media\(properties\)/);
  assert.match(checkSource, /BEGIN TRANSACTION READ ONLY/);
  assert.match(checkSource, /--approve-read/);
  assert.match(checkSource, /legacyPublicHasPhotoOrVideoSql/);
  assert.doesNotMatch(checkSource, /client\.query\(\s*[`'"]\s*(insert|update|delete|alter|drop)\b/i);
});

test('the check script refuses to connect without approval', () => {
  const ran = spawnSync(process.execPath, [CHECK], {
    env: { ...process.env, DATABASE_URL: 'postgres://127.0.0.1:1/none' },
    encoding: 'utf8'
  });
  assert.equal(ran.status, 2);
  assert.match(ran.stderr, /--approve-read/);
  assert.equal(ran.stdout, '');
});

test('seeded rows and later image or video writes keep the flag equal to the old SQL', {
  skip: PG_BIN ? false : 'Install PostgreSQL or set LFM_PG_BIN for the isolated database test.'
}, async () => {
  const port = await freePort();
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'hpm-180-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'sock');
  fs.mkdirSync(socket);
  const legacy = legacyPublicHasPhotoOrVideoSql('p');
  let client;
  const stop = () => {
    try {
      execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-w', '-t', '20', '-m', 'immediate', 'stop'], { stdio: 'pipe' });
    } catch (_) {}
  };
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=hpm', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    execFileSync(path.join(PG_BIN, 'pg_ctl'), [
      '-D', data,
      '-l', path.join(cluster, 'postgres.log'),
      '-w', '-t', '20',
      '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`,
      'start'
    ], { stdio: 'pipe' });
    client = new Client({ host: '127.0.0.1', port, user: 'hpm', database: 'postgres' });
    await client.connect();
    await client.query(`
      CREATE TABLE properties (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        listing_type text NOT NULL DEFAULT 'sale',
        status text NOT NULL DEFAULT 'pending',
        title text NOT NULL DEFAULT 'Fixture',
        description text NOT NULL DEFAULT 'Fixture description',
        property_type text,
        price_period text,
        students_welcome boolean NOT NULL DEFAULT false,
        source text NOT NULL DEFAULT 'website',
        listed_via text NOT NULL DEFAULT 'website',
        lister_name text,
        lister_email text,
        inquiry_reference text,
        extra_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT '2020-01-01T00:00:00Z',
        updated_at timestamptz NOT NULL DEFAULT '2020-01-01T00:00:00Z'
      );
      CREATE TABLE property_images (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
        url text NOT NULL,
        is_primary boolean NOT NULL DEFAULT false,
        sort_order integer NOT NULL DEFAULT 0,
        slot_key text,
        room_label text,
        created_at timestamptz NOT NULL DEFAULT '2020-01-01T00:00:00Z'
      );
      CREATE INDEX idx_property_images_property_id ON property_images (property_id);
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $fn$;
      CREATE TRIGGER trg_properties_updated_at
        BEFORE UPDATE ON properties
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    `);
    await client.query('BEGIN');
    await client.query(migrationSql);
    await client.query('COMMIT');

    async function flagOf(id) {
      const found = await client.query('SELECT has_public_media, updated_at FROM properties WHERE id = $1', [id]);
      return found.rows[0];
    }

    async function disagreements() {
      const found = await client.query(
        `SELECT p.id::text AS id, p.has_public_media, ((${legacy}) IS TRUE) AS legacy_true
           FROM properties p
          WHERE p.has_public_media IS DISTINCT FROM ((${legacy}) IS TRUE)
          ORDER BY p.id`
      );
      return found.rows;
    }

    async function insertListing({ extra = {}, images = [], title = 'Fixture', status = 'approved', listingType = 'sale' } = {}) {
      const created = await client.query(
        `INSERT INTO properties (listing_type, status, title, description, extra_fields)
         VALUES ($1, $2, $3, 'Fixture description', $4::jsonb)
         RETURNING id::text AS id, has_public_media, updated_at`,
        [listingType, status, title, JSON.stringify(extra)]
      );
      const id = created.rows[0].id;
      const atInsert = created.rows[0];
      for (const image of images) {
        await client.query(
          `INSERT INTO property_images (property_id, url, room_label, slot_key)
           VALUES ($1, $2, $3, $4)`,
          [id, image.url, image.room_label || null, image.slot_key || null]
        );
      }
      return { id, atInsert, after: await flagOf(id) };
    }

    const real = await insertListing({ images: [{ url: HOSTED, slot_key: 'exterior' }] });
    assert.equal(real.atInsert.has_public_media, false);
    assert.equal(real.after.has_public_media, true);
    assert.notEqual(real.after.updated_at.toISOString(), real.atInsert.updated_at.toISOString());

    const httpPhoto = await insertListing({ images: [{ url: 'http://media.makaug.com/a.jpg' }] });
    assert.equal(httpPhoto.after.has_public_media, true);
    const upper = await insertListing({ images: [{ url: 'HTTPS://MEDIA.MAKAUG.COM/A.JPG' }] });
    assert.equal(upper.after.has_public_media, true);
    const stock = await insertListing({ images: [{ url: STOCK }, { url: `https://media.makaug.com/photo-1560518883-ce09059eeffa.jpg` }] });
    assert.equal(stock.after.has_public_media, false);
    assert.equal(stock.after.updated_at.toISOString(), stock.atInsert.updated_at.toISOString());
    const pendingUrl = await insertListing({ images: [{ url: 'https://media.makaug.com/image-pending.png' }] });
    assert.equal(pendingUrl.after.has_public_media, false);
    const pendingLabel = await insertListing({ images: [{ url: HOSTED, room_label: 'Image pending' }] });
    assert.equal(pendingLabel.after.has_public_media, false);
    const evidence = await insertListing({ images: [{ url: HOSTED, slot_key: 'source_evidence_card' }] });
    assert.equal(evidence.after.has_public_media, false);
    const tiktokCover = await insertListing({ images: [{ url: 'https://p16-sign.tiktokcdn.com/cover.jpeg' }, { url: 'https://p16.byteimg.com/x.jpeg' }] });
    assert.equal(tiktokCover.after.has_public_media, false);
    const bareHost = await insertListing({ images: [{ url: 'https://media.makaug.com/' }] });
    assert.equal(bareHost.after.has_public_media, false);
    const otherHost = await insertListing({ images: [{ url: 'https://example.com/house.jpg' }] });
    assert.equal(otherHost.after.has_public_media, false);

    const video = await insertListing({ extra: { video_url: 'https://www.tiktok.com/@agent/video/7691604548967763208' } });
    assert.equal(video.atInsert.has_public_media, true);
    assert.equal(video.after.updated_at.toISOString(), '2020-01-01T00:00:00.000Z');
    const unavailable = await insertListing({ extra: { video_url: 'https://www.tiktok.com/@agent/video/1', source_unavailable: true } });
    assert.equal(unavailable.after.has_public_media, false);
    const unavailableWord = await insertListing({ extra: { youtube_url: 'https://youtu.be/abc123', source_unavailable: 'yes' } });
    assert.equal(unavailableWord.after.has_public_media, false);
    const removed = await insertListing({ extra: { tiktok_url: 'https://www.tiktok.com/@a/video/2', source_url_status: 'Removed' } });
    assert.equal(removed.after.has_public_media, false);
    const privateSource = await insertListing({ extra: { video_url: 'https://www.tiktok.com/@a/video/3', source_status: 'private' } });
    assert.equal(privateSource.after.has_public_media, false);
    const youtube = await insertListing({ extra: { youtube_url: 'https://www.youtube.com/watch?v=abc' } });
    assert.equal(youtube.after.has_public_media, true);
    const mp4List = await insertListing({ extra: { video_urls: ['https://cdn.example/tour.mp4'] } });
    assert.equal(mp4List.after.has_public_media, true);
    const cdnList = await insertListing({ extra: { video_urls: ['https://v16.tiktokcdn.com/cover.jpeg'] } });
    assert.equal(cdnList.after.has_public_media, false);
    const cdnMp4 = await insertListing({ extra: { video_url: 'https://v16.tiktokcdn.com/clip.mp4' } });
    assert.equal(cdnMp4.after.has_public_media, true);
    const tour = await insertListing({ extra: { video_tours: [{ url: 'https://youtu.be/abc' }] } });
    assert.equal(tour.after.has_public_media, true);
    const tourString = await insertListing({ extra: { video_tours: ['https://media.makaug.com/v.mp4?x=1'] } });
    assert.equal(tourString.after.has_public_media, true);
    const vimeo = await insertListing({ extra: { video_tours: [{ url: 'https://vimeo.com/123' }] } });
    assert.equal(vimeo.after.has_public_media, false);
    const tourVideoUrl = await insertListing({ extra: { video_tours: [{ video_url: 'https://www.tiktok.com/@a/video/9' }] } });
    assert.equal(tourVideoUrl.after.has_public_media, true);
    const empty = await insertListing();
    assert.equal(empty.after.has_public_media, false);
    const photoWins = await insertListing({
      extra: { video_url: 'https://www.tiktok.com/@a/video/1', source_unavailable: true },
      images: [{ url: HOSTED }]
    });
    assert.equal(photoWins.after.has_public_media, true);
    const hidden = await insertListing({ status: 'pending', images: [{ url: HOSTED }] });
    assert.equal(hidden.after.has_public_media, true);
    const testListing = await insertListing({ title: 'QA TEST - DELETE sample', images: [{ url: HOSTED }] });
    assert.equal(testListing.after.has_public_media, true);

    const bulk = await insertListing();
    await client.query(
      `INSERT INTO property_images (property_id, url) VALUES
         ($1, $2),
         ($1, $3)`,
      [bulk.id, STOCK, HOSTED]
    );
    assert.equal((await flagOf(bulk.id)).has_public_media, true);

    const beforeClear = await flagOf(real.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await client.query('DELETE FROM property_images WHERE property_id = $1', [real.id]);
    const cleared = await flagOf(real.id);
    assert.equal(cleared.has_public_media, false);
    assert.notEqual(cleared.updated_at.toISOString(), beforeClear.updated_at.toISOString());

    const kept = await flagOf(video.id);
    await client.query(`UPDATE properties SET title = 'Renamed only' WHERE id = $1`, [video.id]);
    await client.query(`UPDATE properties SET has_public_media = false WHERE id = $1`, [video.id]);
    assert.equal((await flagOf(video.id)).has_public_media, false);
    await client.query(`UPDATE properties SET title = 'Renamed again' WHERE id = $1`, [video.id]);
    assert.equal((await flagOf(video.id)).has_public_media, false, 'a title edit does not recompute the flag');
    const staleAt = (await flagOf(video.id)).updated_at;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await client.query(`UPDATE properties SET extra_fields = extra_fields WHERE id = $1`, [video.id]);
    const restored = await flagOf(video.id);
    assert.equal(restored.has_public_media, true);
    assert.notEqual(restored.updated_at.toISOString(), staleAt.toISOString());
    assert.equal(kept.has_public_media, true);

    const donor = await insertListing({ images: [{ url: HOSTED }] });
    const receiver = await insertListing();
    assert.equal(receiver.after.has_public_media, false);
    await client.query('UPDATE property_images SET property_id = $2 WHERE property_id = $1', [donor.id, receiver.id]);
    assert.equal((await flagOf(donor.id)).has_public_media, false);
    assert.equal((await flagOf(receiver.id)).has_public_media, true);

    await client.query('DELETE FROM properties WHERE id = $1', [receiver.id]);
    const gone = await client.query('SELECT 1 FROM properties WHERE id = $1', [receiver.id]);
    assert.equal(gone.rows.length, 0);

    await client.query('UPDATE properties SET has_public_media = NOT has_public_media');
    const stamped = await client.query(`SELECT id::text AS id, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') AS updated_at FROM properties ORDER BY id`);
    await client.query('ALTER TABLE properties DISABLE TRIGGER trg_properties_updated_at');
    await client.query(`
      UPDATE properties AS p
         SET has_public_media = property_has_public_media(p)
       WHERE p.has_public_media IS DISTINCT FROM property_has_public_media(p)
    `);
    await client.query('ALTER TABLE properties ENABLE TRIGGER trg_properties_updated_at');
    const restamped = await client.query(`SELECT id::text AS id, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') AS updated_at FROM properties ORDER BY id`);
    assert.deepEqual(
      restamped.rows.map((row) => [row.id, row.updated_at]),
      stamped.rows.map((row) => [row.id, row.updated_at])
    );

    const mismatched = await disagreements();
    assert.deepEqual(mismatched, []);

    const legacyPublicWhere = publicVisibleInventoryWhere('p').replace('p.has_public_media', () => `((${legacy}) IS TRUE)`);
    const counts = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE ${publicVisibleInventoryWhere('p')})::int AS flag_public,
         COUNT(*) FILTER (WHERE ${legacyPublicWhere})::int AS legacy_public
       FROM properties p`
    );
    assert.equal(counts.rows[0].flag_public, counts.rows[0].legacy_public);
    assert.ok(counts.rows[0].flag_public > 0);
    const index = await client.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_properties_has_public_media_live'`);
    assert.match(index.rows[0].indexdef, /has_public_media/);
    assert.match(index.rows[0].indexdef, /listing_type/);

    const ran = spawnSync(process.execPath, [CHECK, '--approve-read'], {
      env: {
        ...process.env,
        DATABASE_URL: `postgres://hpm@127.0.0.1:${port}/postgres`,
        S3_PUBLIC_BASE_URL: 'https://media.makaug.com',
        DB_SSL: ''
      },
      encoding: 'utf8'
    });
    assert.equal(ran.status, 0, `${ran.stdout}\n${ran.stderr}`);
    assert.match(ran.stdout, /differing 0/);
    assert.match(ran.stdout, /public_flag /);

    await client.query('BEGIN');
    await client.query(rollbackSql);
    await client.query('COMMIT');
    const column = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'properties' AND column_name = 'has_public_media'`
    );
    assert.equal(column.rows.length, 0);
  } finally {
    if (client) await client.end().catch(() => {});
    stop();
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});
