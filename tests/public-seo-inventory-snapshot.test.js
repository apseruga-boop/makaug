'use strict';

// The inventory snapshot used by homepage, category and detail SEO started
// failing in production after PR 526: SELECT id ... ORDER BY id DESC became
// ambiguous once the public_agent lateral also exposed id. These tests run
// that statement on a private Postgres cluster and reject the old shape.

process.env.COUNTRY_CODE = 'UG';
process.env.S3_PUBLIC_BASE_URL = 'https://media.makaug.com';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');

const {
  publicSeoInventorySnapshotSql,
  loadPublicSeoInventorySnapshot,
  sitemapEntries,
  __seoSnapshotCache
} = require('../services/publicSeoService');

const PUBLIC_AGENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PRIVATE_AGENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PUBLIC_PROPERTY_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const PRIVATE_AGENT_PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const PENDING_PROPERTY_ID = '22222222-2222-4222-8222-222222222222';
const QA_PROPERTY_ID = '33333333-3333-4333-8333-333333333333';
const SAME_TIME = '2026-10-20T00:00:00.000Z';

const pgBin = [
  process.env.SEO_SNAPSHOT_PG_BIN,
  '/usr/lib/postgresql/16/bin',
  '/usr/lib/postgresql/17/bin',
  '/usr/lib/postgresql/18/bin',
  '/opt/homebrew/opt/postgresql@16/bin',
  '/opt/homebrew/opt/postgresql@18/bin',
  '/usr/local/pgsql/bin'
].filter(Boolean).find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));

function unqualifiedIdentifiers(sql, name) {
  const stripped = String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .replace(/'(?:''|[^'])*'/g, "''");
  const re = new RegExp(`(^|[^\\w.])${name}\\b`, 'gi');
  const hits = [];
  let match;
  while ((match = re.exec(stripped))) {
    hits.push(stripped.slice(Math.max(0, match.index - 24), match.index + name.length + 24).replace(/\s+/g, ' ').trim());
  }
  return hits;
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

test('snapshot SQL has no unqualified id while the public_agent lateral is present', () => {
  const sql = publicSeoInventorySnapshotSql();
  assert.match(sql, /LEFT JOIN LATERAL \([\s\S]*SELECT a\.id[\s\S]*\) public_agent ON TRUE/);
  assert.match(sql, /\(public_agent\.id IS NOT NULL\) AS agent_public/);
  assert.match(sql, /SELECT properties\.id,/);
  assert.match(sql, /ORDER BY properties\.updated_at DESC NULLS LAST, properties\.created_at DESC, properties\.id DESC/);
  assert.deepEqual(unqualifiedIdentifiers(sql, 'id'), []);
});

test('PR 526 listing and detail SQL qualifies id beside its lateral joins', async () => {
  const render = require('../services/publicSeoRenderService');
  render.clearSeoListingCache();
  const captured = [];
  const db = {
    async query(sql) {
      captured.push(sql);
      return { rows: [] };
    }
  };
  await render.loadPublicSeoListings(db, { limit: 1, homepage: true });
  await render.loadPublicSeoListings(db, { limit: 1, categoryKey: 'sale' });
  await render.loadPublicSeoListing(db, '00000000-0000-4000-8000-000000000099');
  assert.equal(captured.length, 3);
  for (const sql of captured) {
    assert.match(sql, /LEFT JOIN LATERAL/);
    assert.deepEqual(unqualifiedIdentifiers(sql, 'id'), []);
  }
});

test('refreshPublicSeoInventorySnapshot runs on Postgres and keeps property ids', {
  skip: pgBin ? false : 'Install PostgreSQL or set SEO_SNAPSHOT_PG_BIN to run the snapshot statement.',
  timeout: 120000
}, async () => {
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-seo-snapshot-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'socket');
  fs.mkdirSync(socket);
  let started = false;
  let client;
  try {
    execFileSync(path.join(pgBin, 'initdb'), [
      '-D', data, '--username=seo_snapshot_test', '--auth=trust', '--encoding=UTF8', '--no-locale'
    ], { stdio: 'pipe' });
    const port = await freePort();
    execFileSync(path.join(pgBin, 'pg_ctl'), [
      '-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '20',
      '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`,
      'start'
    ], { stdio: 'pipe' });
    started = true;
    client = new Client({ host: '127.0.0.1', port, user: 'seo_snapshot_test', database: 'postgres' });
    await client.connect();
    await client.query(`
      CREATE TABLE agents (
        id uuid PRIMARY KEY,
        full_name text,
        company_name text,
        licence_number text,
        email text,
        bio text,
        status text,
        user_id uuid,
        verification_reason text,
        specializations text[] NOT NULL DEFAULT '{}'
      );
      CREATE TABLE properties (
        id uuid PRIMARY KEY,
        listing_type text,
        students_welcome boolean,
        area text,
        district text,
        title text,
        description text,
        price bigint,
        price_period text,
        bedrooms integer,
        property_type text,
        transaction_type text,
        title_type text,
        nearest_university text,
        extra_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
        source text,
        listed_via text,
        agent_id uuid,
        status text,
        lister_name text,
        lister_email text,
        inquiry_reference text,
        updated_at timestamptz,
        created_at timestamptz
      );
      CREATE TABLE property_images (
        id uuid PRIMARY KEY,
        property_id uuid,
        url text,
        room_label text,
        slot_key text
      );
    `);
    await client.query(
      `INSERT INTO agents (id, full_name, licence_number, email, status, user_id, verification_reason)
       VALUES
         ($1, 'Ada Agent', 'LIC-ADA', 'ada@example.com', 'approved', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ''),
         ($2, 'Pending Agent', 'LIC-PEND', 'pending@example.com', 'pending', NULL, '')`,
      [PUBLIC_AGENT_ID, PRIVATE_AGENT_ID]
    );
    await client.query(
      `INSERT INTO properties (
         id, listing_type, students_welcome, area, district, title, description,
         price, price_period, bedrooms, property_type, transaction_type, title_type,
         extra_fields, source, listed_via, agent_id, status, updated_at, created_at
       ) VALUES
         ($1, 'sale', false, 'Ntinda', 'Kampala', 'House in Ntinda', 'A family house with a garden in Ntinda.',
          150000000, 'once', 3, 'house', 'sale', 'mailo',
          '{"canonical_location_id":"kampala:ntinda"}'::jsonb, 'website', 'website', $2, 'approved', $3, $3),
         ($4, 'sale', false, 'Ntinda', 'Kampala', 'Second house in Ntinda', 'Another family house in Ntinda.',
          180000000, 'once', 4, 'house', 'sale', 'mailo',
          '{"canonical_location_id":"kampala:ntinda"}'::jsonb, 'website', 'website', $5, 'approved', $3, $3),
         ($6, 'sale', false, 'Ntinda', 'Kampala', 'Hidden pending house', 'Not live.',
          150000000, 'once', 3, 'house', 'sale', 'mailo', '{}'::jsonb, 'website', 'website', $2, 'pending', $3, $3),
         ($7, 'sale', false, 'Ntinda', 'Kampala', 'QA TEST - DELETE house', 'Launch fixture.',
          150000000, 'once', 3, 'house', 'sale', 'mailo', '{}'::jsonb, 'website', 'website', $2, 'approved', $3, $3)`,
      [PUBLIC_PROPERTY_ID, PUBLIC_AGENT_ID, SAME_TIME, PRIVATE_AGENT_PROPERTY_ID, PRIVATE_AGENT_ID, PENDING_PROPERTY_ID, QA_PROPERTY_ID]
    );
    await client.query(
      `INSERT INTO property_images (id, property_id, url, room_label, slot_key)
       VALUES ('99999999-9999-4999-8999-999999999999', $1, 'https://media.makaug.com/listings/front.jpg', '', 'front')`,
      [PUBLIC_PROPERTY_ID]
    );

    await assert.rejects(
      () => client.query(`
        SELECT id
        FROM properties
        LEFT JOIN LATERAL (
          SELECT a.id FROM agents a WHERE a.id = properties.agent_id LIMIT 1
        ) public_agent ON TRUE
        ORDER BY updated_at DESC NULLS LAST, created_at DESC, id DESC
      `),
      (error) => /column reference "id" is ambiguous/.test(error.message)
    );

    let rows;
    __seoSnapshotCache.clear();
    const snapshot = await loadPublicSeoInventorySnapshot({
      async query(sql, params) {
        assert.equal(sql, publicSeoInventorySnapshotSql());
        const result = await client.query(sql, params);
        rows = result.rows;
        return result;
      }
    }, { force: true });

    assert.deepEqual(rows.map((row) => row.id), [PUBLIC_PROPERTY_ID, PRIVATE_AGENT_PROPERTY_ID]);
    assert.equal(rows[0].agent_id, PUBLIC_AGENT_ID);
    assert.equal(rows[0].agent_public, true);
    assert.equal(rows[0].has_real_photo, true);
    assert.equal(rows[1].agent_id, PRIVATE_AGENT_ID);
    assert.equal(rows[1].agent_public, true);
    assert.equal(rows[1].has_real_photo, false);
    assert.equal(snapshot.categoryTotals.sale, 2);
    assert.equal(snapshot.properties[0].id, PUBLIC_PROPERTY_ID);
    assert.equal(snapshot.properties[0].noindex, false);
    const locs = sitemapEntries(snapshot, 'https://makaug.com').map((entry) => entry.loc);
    assert.ok(locs.includes(`https://makaug.com/property/${PUBLIC_PROPERTY_ID}`));
    assert.ok(locs.includes(`https://makaug.com/property/${PRIVATE_AGENT_PROPERTY_ID}`));
    assert.ok(locs.includes(`https://makaug.com/agents/${PUBLIC_AGENT_ID}`));
    assert.ok(locs.includes(`https://makaug.com/agents/${PRIVATE_AGENT_ID}`));
    assert.equal(locs.includes(`https://makaug.com/property/${PENDING_PROPERTY_ID}`), false);
    assert.equal(locs.includes(`https://makaug.com/property/${QA_PROPERTY_ID}`), false);
  } catch (error) {
    const logPath = path.join(cluster, 'postgres.log');
    if (fs.existsSync(logPath)) error.message += `\n${fs.readFileSync(logPath, 'utf8').slice(-2000)}`;
    throw error;
  } finally {
    __seoSnapshotCache.clear();
    if (client) await client.end().catch(() => {});
    if (started) execFileSync(path.join(pgBin, 'pg_ctl'), ['-D', data, '-w', '-m', 'immediate', 'stop'], { stdio: 'pipe' });
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});
