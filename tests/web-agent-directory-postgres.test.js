'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const { Pool } = require('pg');
const express = require('express');
const request = require('supertest');
const { loadBrokerCards } = require('../services/publicBrokersSsr');

const PG_BIN = [process.env.LFM_PG_BIN, '/opt/homebrew/opt/postgresql@18/bin', '/opt/homebrew/opt/postgresql@16/bin',
  '/usr/lib/postgresql/18/bin', '/usr/lib/postgresql/17/bin', '/usr/lib/postgresql/16/bin'].filter(Boolean)
  .find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer(); server.on('error', reject);
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});

test('web directory advertises every approved real lister with public inventory and protects unclaimed contacts', {
  skip: PG_BIN ? false : 'Install PostgreSQL or set LFM_PG_BIN for the isolated directory test.'
}, async (t) => {
  const port = await freePort();
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'web-agent-directory-'));
  const data = path.join(cluster, 'data'); const socket = path.join(cluster, 'sock'); fs.mkdirSync(socket);
  let pool;
  const db = require('../config/database'); const originalQuery = db.query;
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=directory', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '20',
      '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`, 'start'], { stdio: 'pipe' });
    pool = new Pool({ host: '127.0.0.1', port, user: 'directory', database: 'postgres', ssl: false });
    db.query = (...args) => pool.query(...args);
    await pool.query(`CREATE TABLE agents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), full_name text, company_name text, phone text, whatsapp text, email text,
      user_id uuid, registration_status text, featured_homepage boolean, featured_at timestamptz, bio text, profile_photo_url text,
      profile_photo_kind text, licence_number text, verification_reason text, status text DEFAULT 'approved', rating numeric,
      sales_count integer, districts_covered text[] DEFAULT '{Kampala}', specializations text[], removed_at timestamptz,
      contact_phone_verified_at timestamptz, identity_document_url text, created_at timestamptz DEFAULT now()
    ); CREATE TABLE properties (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agent_id uuid, status text DEFAULT 'approved', has_public_media boolean DEFAULT true,
      district text DEFAULT 'Kampala', title text, description text, listing_type text, property_type text, bedrooms integer,
      bathrooms integer, area text, address text, price bigint, price_period text, extra_fields jsonb DEFAULT '{}',
      title_type text, nearest_university text, amenities text[], approved_at timestamptz, updated_at timestamptz, created_at timestamptz DEFAULT now()
    );`);
    const ids = {};
    async function agent(name, count, options = {}) {
      const row = (await pool.query(`INSERT INTO agents(full_name, user_id, status, verification_reason, licence_number,
        removed_at, identity_document_url, contact_phone_verified_at, email)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [name, options.user_id || null, options.status || 'approved',
        options.reason || '', options.licence || '', options.removed_at || null, options.id_document || null,
        options.phone_checked || null, `${name.replace(/\s/g, '').toLowerCase()}@real-agency.com`])).rows[0];
      ids[name] = row.id;
      if (count) await pool.query(`INSERT INTO properties(agent_id, has_public_media, status)
        SELECT $1,$2,$3 FROM generate_series(1,$4::int)`, [row.id, options.media !== false, options.property_status || 'approved', count]);
    }
    await agent('One listing no account', 1);
    await agent('Two listings no account', 2);
    await agent('One listing registered', 1, { user_id: '11111111-1111-4111-8111-111111111111' });
    await agent('Reviewed verified', 2, { reason: '[DIRECT_AGENT_AUTHORISED] [STAFF_REVIEWED_PRIVATE_ID_PROFILE]',
      id_document: 's3://private/id.jpg', phone_checked: '2026-10-01' });
    await agent('Reviewed zero inventory', 0, { reason: '[DIRECT_AGENT_AUTHORISED] [STAFF_REVIEWED_PRIVATE_ID_PROFILE]', id_document: 's3://private/id.jpg' });
    await agent('Ordinary zero inventory', 0);
    await agent('Removed agent', 2, { user_id: '11111111-1111-4111-8111-111111111111', removed_at: '2026-10-01' });
    await agent('Blocked agent', 2, { status: 'blocked', user_id: '11111111-1111-4111-8111-111111111111' });
    await agent('Pending agent', 2, { status: 'pending', user_id: '11111111-1111-4111-8111-111111111111' });
    await agent('QA TEST - DELETE agent', 2, { user_id: '11111111-1111-4111-8111-111111111111' });
    await agent('Social imported agent', 2, { user_id: '11111111-1111-4111-8111-111111111111', reason: 'public social source onboarding', licence: 'SOCIAL-123' });
    await agent('No public media', 2, { user_id: '11111111-1111-4111-8111-111111111111', media: false });
    await agent('Only pending listings', 2, { user_id: '11111111-1111-4111-8111-111111111111', property_status: 'pending' });
    const app = express(); app.use('/api/agents', require('../routes/agents'));
    app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
    const expectedNames = ['One listing no account', 'Two listings no account', 'One listing registered', 'Reviewed verified'].sort();
    let directory;
    await t.test('one approved public listing is enough without an account; reviewed empty profiles stay out', async () => {
      directory = (await request(app).get('/api/agents?limit=100').expect(200)).body;
      assert.deepEqual(directory.data.map((row) => row.full_name).sort(), expectedNames);
      assert.equal(directory.pagination.total, 4);
    });
    await t.test('unclaimed cards omit email and private evidence; verified full profiles retain their badge', async () => {
      directory = (await request(app).get('/api/agents?limit=100').expect(200)).body;
      const unclaimed = directory.data.find((row) => row.id === ids['One listing no account']);
      assert.ok(unclaimed, 'one-listing unclaimed agent appears');
      assert.equal(unclaimed.profile_kind, 'unclaimed');
      assert.equal(unclaimed.verified_by_makaug, false);
      assert.equal(Object.hasOwn(unclaimed, 'email'), false);
      for (const row of directory.data) for (const key of ['identity_document_url', 'identity_document_stored', 'verification_reason', 'user_id', 'nin']) {
        assert.equal(Object.hasOwn(row, key), false, key);
      }
      const verified = directory.data.find((row) => row.id === ids['Reviewed verified']);
      assert.equal(verified.profile_kind, 'full');
      assert.equal(verified.verified_by_makaug, true);
      assert.ok(verified.email);
    });
    await t.test('status queries cannot expose removed, blocked or unapproved profiles', async () => {
      const all = (await request(app).get('/api/agents?status=all&limit=100').expect(200)).body;
      assert.deepEqual(all.data.map((row) => row.full_name).sort(), expectedNames);
      for (const status of ['pending', 'rejected', 'blocked']) {
        const response = (await request(app).get(`/api/agents?status=${status}`).expect(200)).body;
        assert.deepEqual(response.data, []); assert.equal(response.pagination.total, 0);
      }
    });
    await t.test('search, district and pagination retain the same eligible cohort', async () => {
      const search = (await request(app).get('/api/agents?search=no%20account&district=Kampala&limit=1&page=2').expect(200)).body;
      assert.equal(search.pagination.total, 2); assert.equal(search.data.length, 1);
      assert.equal(search.data[0].profile_kind, 'unclaimed');
      assert.equal((await request(app).get('/api/agents?district=Gulu').expect(200)).body.pagination.total, 0);
    });
    await t.test('server rendered cards match API eligibility and the public-media listing count', async () => {
      const ssr = await loadBrokerCards(db, 100);
      assert.deepEqual(ssr.map((row) => row.full_name).sort(), expectedNames);
      const api = (await request(app).get('/api/agents?limit=100').expect(200)).body.data;
      assert.deepEqual(new Map(ssr.map((row) => [row.id, Number(row.listings_count)])), new Map(api.map((row) => [row.id, row.listings_count])));
    });
  } finally {
    db.query = originalQuery;
    if (pool) await pool.end();
    try { execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' }); } catch (_) {}
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});
