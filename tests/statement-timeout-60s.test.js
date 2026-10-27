'use strict';

// The live pool cancels any single statement after 60 s (25 Oct 2026: one
// query ran 2 h 29 min and pinned the database CPU). The work that is
// legitimately longer must lift the limit for itself, and only for itself.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const db = require('../config/database');

function recordingClient({ failOn = null } = {}) {
  const queries = [];
  const client = {
    queries,
    releasedWith: 'not released',
    on() {},
    removeListener() {},
    async query(sql) {
      const text = String(sql);
      queries.push(text.trim().split('\n')[0].trim());
      if (failOn && text.includes(failOn)) throw new Error(`stub failure on ${failOn}`);
      return { rows: [], rowCount: 0 };
    },
    release(err) {
      client.releasedWith = err;
    },
  };
  return client;
}

function poolOptionsWithEnv(env) {
  const script = "const d=require('./config/database');" +
    "process.stdout.write(JSON.stringify({live:d.pool.options.statement_timeout," +
    "idle:d.pool.options.idle_in_transaction_session_timeout," +
    "background:d.backgroundPool.options.statement_timeout??null}))";
  const childEnv = { ...process.env, ...env, LOG_LEVEL: 'error' };
  delete childEnv.DATABASE_URL;
  const out = spawnSync(process.execPath, ['-e', script], { cwd: root, env: childEnv, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  return JSON.parse(out.stdout.slice(out.stdout.indexOf('{')));
}

test('live pool connections start with a 60 s statement limit and a 5 min idle-in-transaction limit', () => {
  assert.equal(db.DEFAULT_STATEMENT_TIMEOUT_MS, 60000);
  const opts = poolOptionsWithEnv({ DB_STATEMENT_TIMEOUT_MS: '', DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: '' });
  assert.deepEqual(opts, { live: 60000, idle: 300000, background: null });
});

test('the limits can be overridden, and 0 turns them off', () => {
  assert.deepEqual(
    poolOptionsWithEnv({ DB_STATEMENT_TIMEOUT_MS: '0', DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: '0' }),
    { live: 0, idle: 0, background: null }
  );
  assert.equal(poolOptionsWithEnv({ DB_STATEMENT_TIMEOUT_MS: '15000' }).live, 15000);
  assert.equal(poolOptionsWithEnv({ DB_STATEMENT_TIMEOUT_MS: 'nonsense' }).live, 60000);
});

test('the exemption is transaction-scoped, so the connection keeps its limit afterwards', async () => {
  const client = recordingClient();
  await db.exemptTransactionFromStatementTimeout(client);
  assert.deepEqual(client.queries, ['SET LOCAL statement_timeout = 0']);
});

test('a transactional migration lifts the limit inside its own transaction', async (t) => {
  const migrate = require('../scripts/migrate');
  const client = recordingClient();
  const original = db.getClient;
  db.getClient = async () => client;
  t.after(() => { db.getClient = original; });

  await migrate.applyMigration('999_fixture.sql', 'UPDATE properties SET title = title');
  assert.deepEqual(client.queries.slice(0, 2), ['BEGIN', 'SET LOCAL statement_timeout = 0']);
  assert.ok(client.queries.indexOf('UPDATE properties SET title = title') > 1);
  assert.equal(client.queries.at(-1), 'COMMIT');
});

test('an autocommit migration lifts the limit for the session and puts it back before release', async (t) => {
  const migrate = require('../scripts/migrate');
  const client = recordingClient();
  const original = db.getClient;
  db.getClient = async () => client;
  t.after(() => { db.getClient = original; });

  await migrate.applyAutocommitMigration('998_fixture.sql', 'CREATE INDEX CONCURRENTLY IF NOT EXISTS ix ON t (c);');
  assert.equal(client.queries[0], 'SET statement_timeout = 0');
  assert.equal(client.queries.at(-1), 'RESET statement_timeout');
  assert.equal(client.releasedWith, undefined);

  // A failed migration still puts the limit back.
  const failing = recordingClient({ failOn: 'CREATE INDEX' });
  db.getClient = async () => failing;
  await assert.rejects(migrate.applyAutocommitMigration('997_fixture.sql', 'CREATE INDEX CONCURRENTLY ix2 ON t (c);'));
  assert.equal(failing.queries.at(-1), 'RESET statement_timeout');

  // A connection that cannot get its limit back is destroyed, not reused.
  const stuck = recordingClient({ failOn: 'RESET statement_timeout' });
  db.getClient = async () => stuck;
  await migrate.applyAutocommitMigration('996_fixture.sql', 'CREATE INDEX CONCURRENTLY ix3 ON t (c);');
  assert.ok(stuck.releasedWith instanceof Error);
});

test('the SEO snapshot cursor lifts the limit after BEGIN, before the cursor opens', async () => {
  const seo = require('../services/publicSeoService');
  const client = recordingClient();
  const stubDb = {
    getClient: async () => client,
    exemptTransactionFromStatementTimeout: db.exemptTransactionFromStatementTimeout,
    async query() { throw new Error('paged query must not run when getClient exists'); },
  };
  seo.__seoSnapshotCache.clear();
  await seo.loadPublicSeoInventorySnapshot(stubDb, { force: true });
  seo.__seoSnapshotCache.clear();
  assert.deepEqual(client.queries.slice(0, 2), ['BEGIN', 'SET LOCAL statement_timeout = 0']);
  assert.ok(client.queries[2].startsWith('DECLARE makaug_seo_snapshot'));
});

const post = {
  post_url: 'https://x.com/agent/status/1890000000000000101',
  caption: 'Three bedroom house for rent in Kalagi Mukono at USD 800 per month call via this profile',
  source_name: 'Agent UG',
  source_page_url: 'https://x.com/agent',
  first_posted_at: '2026-08-02T00:00:00.000Z',
};

function harvestDb(client) {
  return {
    pool: { connect: async () => client },
    async query() { return { rows: [], rowCount: 0 }; },
  };
}

test('the harvester duplicate-check preview lifts the limit and restores it before release', async () => {
  const { queueFoundOnlineSourcePostListings } = require('../services/socialSearchSourcedListingsService');
  const client = recordingClient();
  await queueFoundOnlineSourcePostListings({ dryRun: true, posts: [post], db: harvestDb(client) });
  const duplicateCheck = client.queries.findIndex((q) => q.startsWith('WITH matching_property_ids'));
  assert.ok(duplicateCheck > 0, `duplicate check did not run: ${client.queries.join(' | ')}`);
  assert.equal(client.queries[0], 'SET statement_timeout = 0');
  assert.equal(client.queries.at(-1), 'RESET statement_timeout');
  assert.equal(client.releasedWith, undefined);
});

test('the harvester import transaction lifts the limit right after BEGIN', async () => {
  const { queueFoundOnlineSourcePostListings } = require('../services/socialSearchSourcedListingsService');
  const client = recordingClient();
  try {
    await queueFoundOnlineSourcePostListings({ dryRun: false, posts: [post], db: harvestDb(client) });
  } catch (_error) {
    // The stub returns no rows, so the insert path may fail; only the order matters here.
  }
  assert.deepEqual(client.queries.slice(0, 2), ['BEGIN', 'SET LOCAL statement_timeout = 0']);
  const duplicateCheck = client.queries.findIndex((q) => q.startsWith('WITH matching_property_ids'));
  assert.ok(duplicateCheck > 1, `duplicate check did not run after the exemption: ${client.queries.join(' | ')}`);
  assert.ok(!client.queries.includes('SET statement_timeout = 0'), 'the import must not lift the limit for the whole session');
});
