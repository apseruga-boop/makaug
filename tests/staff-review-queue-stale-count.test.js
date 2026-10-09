'use strict';

/**
 * 9 Oct 2026: with the CPU pinned by the cover-photo job, the review queue's
 * COUNT could not get a database connection inside 900 ms and the whole
 * endpoint answered 503, so moderators saw nothing at all. When only the count
 * fails, the list is still returned, with count: null and count_status 'stale'.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'review-queue-stale-count-test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const db = require('../config/database');

const MODERATOR = {
  id: '7b2e0c1a-5d3f-4c8e-9a61-0f2d4b6c8e10',
  first_name: 'Stale',
  last_name: 'Count',
  phone: '+256700000123',
  email: null,
  role: 'moderator',
  status: 'active',
  preferred_language: 'en',
  preferred_contact_channel: 'whatsapp',
  profile_data: {}
};
const ROW = { id: '9d1f3a2b-1111-4222-8333-444455556666', title: 'Pending listing', status: 'pending', extra_fields: {} };

function stubDb({ countError = null, rowsError = null } = {}) {
  const original = { query: db.query, getClient: db.getClient };
  const seen = { count: 0, rows: 0, acquireTimeouts: [] };
  db.query = async (sql) => {
    if (/FROM users WHERE id = \$1/i.test(sql)) return { rows: [MODERATOR] };
    return { rows: [] };
  };
  db.getClient = async () => ({
    async query(sql) {
      if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/i.test(String(sql).trim())) return { rows: [] };
      if (/SELECT COUNT\(\*\)::int AS total FROM properties p/i.test(sql)) {
        seen.count += 1;
        if (countError) throw countError;
        return { rows: [{ total: 1 }] };
      }
      if (/paged_review_queue/.test(sql)) {
        seen.rows += 1;
        if (rowsError) throw rowsError;
        return { rows: [ROW] };
      }
      return { rows: [] };
    },
    release() {}
  });
  return { seen, restore() { db.query = original.query; db.getClient = original.getClient; } };
}

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/staff', require('../routes/staff'));
  return a;
}

const token = () => jwt.sign({ sub: MODERATOR.id, role: 'moderator' }, process.env.JWT_SECRET, { expiresIn: '5m' });

test('a count that times out still returns the list, marked stale', async () => {
  const poolTimeout = Object.assign(new Error('Staff database client acquisition timed out'), { code: 'POOL_TIMEOUT' });
  const stub = stubDb({ countError: poolTimeout });
  try {
    const res = await request(app()).get('/api/staff/properties/review-queue').set('Authorization', `Bearer ${token()}`);
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 400));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.count, null);
    assert.equal(res.body.count_status, 'stale');
    assert.equal(res.body.meta.count_status, 'stale');
    assert.equal(res.body.meta.count_error, 'POOL_TIMEOUT');
    assert.equal(res.body.pagination.total, null, 'no made-up total');
    assert.deepEqual(res.body.data.map((r) => r.id), [ROW.id]);
    assert.equal(stub.seen.count, 1);
  } finally {
    stub.restore();
  }
});

test('a healthy count is exact', async () => {
  const stub = stubDb();
  try {
    const res = await request(app()).get('/api/staff/properties/review-queue').set('Authorization', `Bearer ${token()}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.count, 1);
    assert.equal(res.body.count_status, 'exact');
    assert.equal(res.body.pagination.total, 1);
  } finally {
    stub.restore();
  }
});

test('if the list itself fails, it is still a 503 (nothing to show)', async () => {
  const stub = stubDb({ rowsError: Object.assign(new Error('timeout'), { code: 'POOL_TIMEOUT' }) });
  try {
    const res = await request(app()).get('/api/staff/properties/review-queue').set('Authorization', `Bearer ${token()}`);
    assert.equal(res.status, 503);
  } finally {
    stub.restore();
  }
});

test('the review queue waits up to 3 s for a connection, not 900 ms', () => {
  const source = require('node:fs').readFileSync(require.resolve('../routes/staff'), 'utf8');
  assert.match(source, /STAFF_REVIEW_QUEUE_ACQUIRE_TIMEOUT_MS \|\| '3000'/);
  assert.equal((source.match(/acquireTimeoutMs: STAFF_REVIEW_QUEUE_ACQUIRE_TIMEOUT_MS/g) || []).length, 2, 'both the list and the count');
  assert.match(source, /Math\.min\(timeoutMs, Number\(options\.acquireTimeoutMs\) \|\| 900\)/, 'other staff queries keep 900 ms');
});

test.after(async () => {
  await db.pool.end().catch(() => {});
});
