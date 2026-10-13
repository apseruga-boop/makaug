'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../routes/staff.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../db/migrations/148_staff_source_registry_panel_index.sql'), 'utf8');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/staff-source-registry-panel-semantics.sql'), 'utf8');
const normalize = (value) => value.replace(/\s+/g, ' ').trim();

function captureRegistryQuery(limit = 8) {
  const start = source.indexOf('function staffPanelSourceRegistryRows(');
  const end = source.indexOf('async function dashboardPayload(', start);
  assert(start >= 0 && end > start, 'missing actual source-registry helper');
  const calls = [];
  const rows = [{ id: 'fixture-result' }];
  const context = vm.createContext({ safeRows: (...args) => { calls.push(args); return rows; } });
  vm.runInContext(`${source.slice(start, end)}; this.actual = staffPanelSourceRegistryRows;`, context);
  const options = { timeoutMs: 5000, label: 'staff_panel_source_registry' };
  assert.equal(context.actual(limit, options), rows);
  assert.equal(calls.length, 1);
  assert.deepEqual(Array.from(calls[0][1]), [limit]);
  assert.equal(calls[0][2], options);
  return calls[0][0];
}

function statuses(sql) {
  const match = sql.match(/WHERE\s+status\s+IN\s*\(([^)]+)\)/i);
  assert(match, 'missing eligibility predicate');
  return [...match[1].matchAll(/'([^']+)'/g)].map((row) => row[1]).sort();
}

function between(startMarker, endMarker) {
  const start = fixture.indexOf(startMarker) + startMarker.length;
  const end = fixture.indexOf(endMarker, start);
  assert(start >= startMarker.length && end > start, 'missing fixture clause');
  return fixture.slice(start, end);
}

test('actual registry helper keeps its bounded query, timeout and labelled result contract', () => {
  const sql = captureRegistryQuery();
  assert.match(sql, /LIMIT \$1/);
  assert.match(sql, /COALESCE\(last_seen_at, last_checked_at, created_at\) DESC/);
  assert.deepEqual(statuses(sql), ['active', 'candidate', 'review_needed']);
});

test('index eligibility and recency precedence exactly match the executed panel query', () => {
  const sql = captureRegistryQuery();
  assert.deepEqual(statuses(migration), statuses(sql));
  const order = sql.match(/ORDER BY\s+(COALESCE\([^)]+\))\s+DESC/i);
  assert(order, 'missing panel recency order');
  const escaped = order[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*');
  assert.match(migration, new RegExp(`\\(${escaped}\\)\\s+DESC`, 'i'));
  assert.doesNotMatch(migration, /NULLS\s+LAST|GREATEST/i, 'preserve existing ordering semantics');
});

test('the PostgreSQL fixture uses the current helper at both limits and the actual index predicate', () => {
  const sql = captureRegistryQuery();
  assert.equal(normalize(between('limited_panel AS (', '),\nall_panel AS (')), normalize(sql.replace(/\$1\b/g, '3')));
  assert.equal(normalize(between('all_panel AS (', '),\nindex_eligible AS (')), normalize(sql.replace(/\$1\b/g, '8')));
  const predicate = migration.match(/WHERE\s+(.+?);/s)[1];
  assert.equal(normalize(between('index_eligible AS (SELECT id FROM property_source_registry WHERE ', '),\neligibility_difference AS (')), normalize(predicate));
  assert.doesNotMatch(fixture, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i);
});
