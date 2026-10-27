'use strict';

/**
 * 26 Oct 2026, 14:10 UK: merging the duplicate "Charles" agent into the one with
 * the login failed with "inconsistent types deduced for parameter $2" (a 500).
 * PostgreSQL saw $2 as uuid in `SET agent_id = $2` and as text in
 * `to_jsonb($2::text)`. A text-only check of the SQL could not see that, so this
 * runs the real route against a throwaway PostgreSQL cluster on 127.0.0.1.
 * It never reads the DATABASE_URL it was started with.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { execFileSync } = require('child_process');

const PG_BIN = [
  process.env.LFM_PG_BIN,
  '/usr/lib/postgresql/16/bin',
  '/usr/lib/postgresql/17/bin',
  '/usr/lib/postgresql/18/bin'
].filter(Boolean).find((dir) => fs.existsSync(path.join(dir, 'initdb')) && fs.existsSync(path.join(dir, 'pg_ctl')));

// The 14:10 form of the listings UPDATE, kept to prove the cluster catches it.
const PRE_FIX_SQL = `UPDATE properties
    SET agent_id = $2,
        lister_name = COALESCE(NULLIF($3, ''), lister_name),
        extra_fields = CASE
          WHEN COALESCE(extra_fields, '{}'::jsonb) ? 'broker_agent_id'
            THEN jsonb_set(extra_fields, '{broker_agent_id}', to_jsonb($2::text))
          ELSE extra_fields END
          || jsonb_build_object('merged_from_agent_id', $1::text),
        updated_at = NOW()
  WHERE agent_id = $1 OR COALESCE(extra_fields, '{}'::jsonb)->>'broker_agent_id' = $1::text
  RETURNING id`;

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

test('merge-into moves every listing to the target and retires the duplicate on real PostgreSQL', {
  skip: PG_BIN ? false : 'Install PostgreSQL or set LFM_PG_BIN for the isolated database test.'
}, async () => {
  const port = await freePort();
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-merge-'));
  const data = path.join(cluster, 'data');
  const socket = path.join(cluster, 'sock');
  fs.mkdirSync(socket);
  const stop = () => {
    try {
      execFileSync(path.join(PG_BIN, 'pg_ctl'), ['-D', data, '-w', '-t', '20', '-m', 'immediate', 'stop'], { stdio: 'pipe' });
    } catch (_) {}
  };
  let db;
  try {
    execFileSync(path.join(PG_BIN, 'initdb'), ['-D', data, '--username=merge', '--auth=trust', '--encoding=UTF8', '--no-locale'], { stdio: 'pipe' });
    execFileSync(path.join(PG_BIN, 'pg_ctl'), [
      '-D', data, '-l', path.join(cluster, 'postgres.log'), '-w', '-t', '20',
      '-o', `-h 127.0.0.1 -p ${port} -k '${socket}' -c fsync=off -c synchronous_commit=off`,
      'start'
    ], { stdio: 'pipe' });

    // Point the app's pool at the throwaway cluster before anything loads it.
    process.env.DATABASE_URL = `postgres://merge@127.0.0.1:${port}/postgres`;
    process.env.DB_SSL = 'false';
    process.env.COUNTRY_CODE = 'UG';
    process.env.ADMIN_API_KEY = 'agent-merge-test-key';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'agent-merge-test-secret';
    db = require('../config/database');

    await db.query(`
      CREATE TABLE agents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        full_name text NOT NULL,
        phone text,
        whatsapp text,
        status text NOT NULL DEFAULT 'pending',
        removed_at timestamptz,
        removed_reason text,
        removed_by text,
        removal_snapshot jsonb,
        updated_at timestamptz NOT NULL DEFAULT NOW()
      );
      CREATE TABLE properties (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id uuid REFERENCES agents(id),
        lister_name text,
        status text NOT NULL DEFAULT 'pending',
        extra_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
        updated_at timestamptz NOT NULL DEFAULT NOW()
      );
      CREATE TABLE audit_logs (
        id bigserial PRIMARY KEY,
        actor_id text,
        action text NOT NULL,
        details jsonb,
        created_at timestamptz NOT NULL DEFAULT NOW()
      );
    `);
    const source = (await db.query(`INSERT INTO agents (full_name, phone) VALUES ('Charles', '0700000001') RETURNING id`)).rows[0].id;
    const target = (await db.query(`INSERT INTO agents (full_name, phone) VALUES ('CHARLES', '0700000002') RETURNING id`)).rows[0].id;
    const other = (await db.query(`INSERT INTO agents (full_name, phone) VALUES ('Someone Else', '0700000003') RETURNING id`)).rows[0].id;
    for (let i = 0; i < 8; i += 1) {
      await db.query(`INSERT INTO properties (agent_id, lister_name) VALUES ($1, 'Charles')`, [source]);
    }
    // Two listings that name the duplicate only as the broker in extra_fields.
    for (let i = 0; i < 2; i += 1) {
      await db.query(`INSERT INTO properties (agent_id, lister_name, extra_fields) VALUES (NULL, 'Charles', $1::jsonb)`, [JSON.stringify({ broker_agent_id: source })]);
    }
    await db.query(`INSERT INTO properties (agent_id, lister_name) VALUES ($1, 'Someone Else')`, [other]);

    // The 14:10 SQL fails on a real server, so this test would have caught it.
    await assert.rejects(db.query(PRE_FIX_SQL, [source, target, 'CHARLES']), /inconsistent types deduced for parameter \$2/);

    const express = require('express');
    const request = require('supertest');
    const app = express();
    app.use(express.json());
    app.use('/api/admin', require('../routes/admin'));
    app.use((error, _req, res, _next) => res.status(500).json({ ok: false, error: error.message }));

    const response = await request(app)
      .post(`/api/admin/agents/${source}/merge-into`)
      .set('x-api-key', 'agent-merge-test-key')
      .send({ target_id: target });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.data.listings_moved, 10);

    const moved = (await db.query(`SELECT agent_id, lister_name, extra_fields FROM properties WHERE lister_name <> 'Someone Else'`)).rows;
    assert.equal(moved.length, 10);
    for (const row of moved) {
      assert.equal(row.agent_id, target);
      assert.equal(row.lister_name, 'CHARLES');
      assert.equal(row.extra_fields.merged_from_agent_id, source);
      if (row.extra_fields.broker_agent_id) assert.equal(row.extra_fields.broker_agent_id, target);
    }
    const untouched = (await db.query(`SELECT agent_id, lister_name, extra_fields FROM properties WHERE lister_name = 'Someone Else'`)).rows[0];
    assert.equal(untouched.agent_id, other);
    assert.equal(untouched.extra_fields.merged_from_agent_id, undefined);

    const retired = (await db.query('SELECT status, removed_at, removed_reason, removal_snapshot FROM agents WHERE id = $1', [source])).rows[0];
    assert.equal(retired.status, 'suspended');
    assert.ok(retired.removed_at);
    assert.match(retired.removed_reason, /^Merged into CHARLES/);
    assert.equal(retired.removal_snapshot.merged_into, target);
    assert.equal(retired.removal_snapshot.listings_moved.length, 10);
    const kept = (await db.query('SELECT status, removed_at FROM agents WHERE id = $1', [target])).rows[0];
    assert.equal(kept.removed_at, null);

    const audit = (await db.query(`SELECT details FROM audit_logs WHERE action = 'admin_agent_merged'`)).rows;
    assert.equal(audit.length, 1);
    assert.equal(audit[0].details.listings_moved, 10);

    // A second merge of the retired record into another agent moves nothing it
    // does not own, and merging into a removed agent is refused.
    const intoRemoved = await request(app)
      .post(`/api/admin/agents/${other}/merge-into`)
      .set('x-api-key', 'agent-merge-test-key')
      .send({ target_id: source });
    assert.equal(intoRemoved.status, 409);
    assert.equal((await db.query('SELECT agent_id FROM properties WHERE lister_name = $1', ['Someone Else'])).rows[0].agent_id, other);
  } finally {
    if (db) {
      await Promise.allSettled([db.pool?.end?.(), db.backgroundPool?.end?.(), db.end?.()]);
    }
    stop();
    fs.rmSync(cluster, { recursive: true, force: true });
  }
});
