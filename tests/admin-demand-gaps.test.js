'use strict';

/**
 * The demand makaug could not meet.
 *
 * Every WhatsApp search that finds nothing tells the person "I have saved this
 * request so makaug can follow up when a matching listing appears" and writes a
 * row to property_leads. Nothing read that table: the admin leads list unions
 * `leads` and `mortgage_enquiries` and never included it. So the promise was
 * made every time and kept none of the times, and the clearest signal about
 * what stock to go and find was invisible.
 *
 * Worse, the row did not even record the budget — the one number that makes a
 * supply gap actionable. Someone wanting a rental in Bunga at UGX 500K a month
 * was stored as "rent, Bunga", indistinguishable from someone with five
 * million.
 *
 * These tests run the real statements against a real PostgreSQL. Two SQL faults
 * have reached production this week that only a parser would have caught — an
 * ungrouped column in a correlated subquery was the third, and it was caught
 * here rather than by Ronald.
 */

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert');

const HAS_DB = Boolean(process.env.DATABASE_URL);

after(async () => {
  if (!HAS_DB) return;
  await require('../config/database').pool.end().catch(() => {});
});

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS property_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT, phone TEXT, email TEXT,
    preferred_area TEXT, purpose TEXT, category TEXT, budget NUMERIC, notes TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS properties (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), title TEXT, status TEXT,
    listing_type TEXT, area TEXT, district TEXT, price NUMERIC
  );
`;

// The statement the endpoint runs, kept in step with routes/admin.js.
function demandGapsSql() {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  const start = source.indexOf("router.get('/demand-gaps'");
  assert.ok(start > 0, 'the demand-gaps endpoint must exist');
  const segment = source.slice(start, start + 8000);
  const open = segment.indexOf('`WITH unmet AS (');
  const body = segment.slice(open + 1);
  return body.slice(0, body.indexOf('`'));
}

test('the demand-gaps statement is one PostgreSQL will actually run', async (t) => {
  if (!HAS_DB) {
    t.skip('no DATABASE_URL: this needs a real PostgreSQL to parse the statement');
    return;
  }
  const db = require('../config/database');
  await db.query(SCHEMA);
  await db.query('DELETE FROM property_leads');
  await db.query('DELETE FROM properties');

  // Bunga as it actually was: three people wanting to rent at 450k-600k, and
  // nothing to rent below a million.
  await db.query(
    `INSERT INTO property_leads (phone, preferred_area, purpose, category, budget) VALUES
       ('256770661200','Bunga','search','rent',500000),
       ('256700111222','Bunga','search','rent',600000),
       ('256700333444','Bunga','search','rent',450000),
       ('256700555666','Ntinda','search','rent',800000)`
  );
  await db.query(
    `INSERT INTO properties (title,status,listing_type,area,district,price) VALUES
       ('1-bed rent Bunga','approved','rent','Bunga','Kampala',1000000),
       ('2-bed rent Bunga','approved','rent','Bunga','Kampala',1200000),
       ('7bdrm sale Bunga','approved','sale','Bunga','Kampala',1500000000),
       ('rent Ntinda','approved','rent','Ntinda','Kampala',700000)`
  );

  const result = await db.query(demandGapsSql(), ['90', 25]);
  const bunga = result.rows.find((row) => row.area === 'Bunga');

  assert.ok(bunga, 'Bunga must appear as a gap');
  assert.strictEqual(bunga.search_type, 'rent', 'and as a rental gap, not a sale one');
  assert.strictEqual(bunga.people, 3, 'three different people asked');
  assert.strictEqual(Number(bunga.lowest_budget), 450000);
  assert.strictEqual(Number(bunga.highest_budget), 600000);
  assert.strictEqual(bunga.supply_now, 2, 'there are two rentals in Bunga');
  assert.strictEqual(bunga.supply_within_budget, 0,
    'but none of them is within what anyone offered — that is the gap');

  const ntinda = result.rows.find((row) => row.area === 'Ntinda');
  assert.strictEqual(ntinda.supply_within_budget, 1,
    'Ntinda has stock inside the budget, so that person is owed a call back');
});

test('the busiest gap is listed first', async (t) => {
  if (!HAS_DB) {
    t.skip('no DATABASE_URL');
    return;
  }
  const db = require('../config/database');
  const result = await db.query(demandGapsSql(), ['90', 25]);
  const counts = result.rows.map((row) => row.times_asked);
  assert.deepStrictEqual([...counts].sort((a, b) => b - a), counts,
    'the thing most people asked for is the thing to go and find first');
});

test('an empty table is an empty answer, not an error', async (t) => {
  if (!HAS_DB) {
    t.skip('no DATABASE_URL');
    return;
  }
  const db = require('../config/database');
  await db.query('DELETE FROM property_leads');
  const result = await db.query(demandGapsSql(), ['90', 25]);
  assert.deepStrictEqual(result.rows, []);
});

test('the budget is written to the row, not thrown away', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
  const start = source.indexOf('function createNoMatchLead(');
  const insert = source.slice(start, start + 2000);
  assert.match(insert, /INSERT INTO property_leads \(phone, preferred_area, purpose, category, budget, notes, payload\)/,
    'the budget column exists and must be populated');
  assert.match(insert, /max_budget_ugx/, 'and kept in the payload for anything that reads it');
  assert.match(insert, /query_text/, 'along with what they actually typed');
});
