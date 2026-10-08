'use strict';

// Runs the real "full" listing status UPDATE from routes/properties.js against
// the test database: approving must set approved_at, reviewed_by and
// moderation_stage; rejecting must set rejected_at and store the new owner edit
// token hash (so the link emailed with a rejection actually works).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');
const { hashOwnerEditToken, isOwnerEditTokenValid } = require('../services/listingModerationService');

const source = fs.readFileSync(require.resolve('../routes/properties'), 'utf8');
const marker = "logger.error('Full listing status update failed";
const queryStart = source.lastIndexOf('await db.query(', source.indexOf(marker));
const sqlStart = source.indexOf('`', queryStart) + 1;
const SQL = source.slice(sqlStart, source.indexOf('`', sqlStart));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function fixture() {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO properties (id, listing_type, title, description, district, area, price, status, extra_fields, listed_via)
     VALUES ($1, 'sale', 'Status column test', 'test', 'Kampala', 'Ntinda', 100000000, 'pending', '{}'::jsonb, 'website')`,
    [id]
  );
  return id;
}

async function reviewerId() {
  const row = (await pool.query(`SELECT id FROM users ORDER BY created_at LIMIT 1`)).rows[0];
  return row?.id || null;
}

function params({ id, status, actor, reviewer, tokenHash = null, tokenExpires = null }) {
  return [id, status, status === 'rejected' ? 'Photos are not of this property' : null, JSON.stringify({ photos: status === 'approved' }),
    'checked', actor, reviewer, status === 'approved' ? 'approved' : 'rejected', tokenHash, tokenExpires, JSON.stringify([]), null];
}

test('approving sets approved_at, reviewed_by and moderation_stage (no fallback)', async () => {
  const id = await fixture();
  const reviewer = await reviewerId();
  const result = await pool.query(SQL, params({ id, status: 'approved', actor: reviewer || 'admin_api_key', reviewer }));
  const row = result.rows[0];
  assert.equal(row.status, 'approved');
  assert.ok(row.approved_at, 'approved_at set');
  assert.equal(row.moderation_stage, 'approved');
  const stored = (await pool.query('SELECT reviewed_by, extra_fields FROM properties WHERE id = $1', [id])).rows[0];
  if (reviewer) assert.equal(stored.reviewed_by, reviewer);
  assert.equal(stored.extra_fields.last_reviewed_by_actor, reviewer || 'admin_api_key');
  await pool.query('DELETE FROM properties WHERE id = $1', [id]);
});

test('rejecting sets rejected_at and stores the token hash the emailed link needs', async () => {
  const id = await fixture();
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + 7 * 864e5).toISOString();
  await pool.query(SQL, params({ id, status: 'rejected', actor: 'admin_api_key', reviewer: null, tokenHash: hashOwnerEditToken(token), tokenExpires: expires }));
  const stored = (await pool.query('SELECT status, rejected_at, moderation_stage, moderation_reason, owner_edit_token_hash, owner_edit_token_expires_at FROM properties WHERE id = $1', [id])).rows[0];
  assert.equal(stored.status, 'rejected');
  assert.ok(stored.rejected_at);
  assert.equal(stored.moderation_stage, 'rejected');
  assert.equal(stored.moderation_reason, 'Photos are not of this property');
  assert.ok(isOwnerEditTokenValid(token, stored.owner_edit_token_hash), 'the emailed token validates');
  assert.ok(new Date(stored.owner_edit_token_expires_at) > new Date());
  await pool.query('DELETE FROM properties WHERE id = $1', [id]);
});

test.after(() => pool.end());
