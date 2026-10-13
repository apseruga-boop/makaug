'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../routes/staff.js'), 'utf8');

function loadFunction(name, nextName, values = {}) {
  const marker = new RegExp(`(?:async )?function ${name}\\(`);
  const start = source.search(marker);
  const tail = source.slice(start);
  const end = tail.search(new RegExp(`(?:async )?function ${nextName}\\(`));
  assert(start >= 0 && end > 0, `missing actual ${name}`);
  const context = vm.createContext(values);
  vm.runInContext(`${tail.slice(0, end)}; this.actual = ${name};`, context);
  return context.actual;
}

function normalize(sql) { return sql.replace(/\s+/g, ' ').trim(); }
function fixtureQuery(fixture, marker, nextMarker) {
  const start = fixture.indexOf(marker) + marker.length;
  const end = fixture.indexOf(nextMarker, start);
  assert(start >= marker.length && end > start, 'missing SQL fixture query');
  return fixture.slice(start, end);
}

async function capturePanelQuery() {
  const calls = [];
  const rows = [{ phone: 'fixture-phone', latest_preview: 'kept' }];
  const fn = loadFunction('staffPanelWhatsappConversationRows', 'staffPanelWhatsappBridgeStatus', {
    safeRows: async (...args) => { calls.push(args); return rows; }
  });
  const options = { timeoutMs: 5000, label: 'staff_panel_whatsapp' };
  const result = await fn('fixture-staff', 8, options);
  assert.equal(result, rows);
  assert.equal(calls.length, 1);
  assert.deepEqual(Array.from(calls[0][1]), ['fixture-staff', 8]);
  assert.equal(calls[0][2], options, 'keep timeout/label options');
  return calls[0][0];
}

test('actual panel helper preserves parameters, options and returned rows', async () => {
  const sql = await capturePanelQuery();
  assert.match(sql, /WITH candidate_conversations AS MATERIALIZED/);
  const limit = sql.indexOf('LIMIT $2');
  const enrich = sql.indexOf('FROM candidate_conversations c');
  assert(limit >= 0 && enrich > limit, 'limit conversations before payload enrichment');
  assert.equal((sql.slice(enrich).match(/LEFT JOIN LATERAL/g) || []).length, 2);
  assert.doesNotMatch(sql, /DISTINCT ON/, 'no complete-history latest-row scans');
});

test('PostgreSQL semantic fixture contains the exact current helper query at both limits', async () => {
  const sql = await capturePanelQuery();
  const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/staff-whatsapp-panel-semantics.sql'), 'utf8');
  const bind = (limit) => sql.replace(/\$1\b/g, "'fixture-staff'").replace(/\$2\b/g, String(limit));
  assert.equal(normalize(fixtureQuery(fixture, 'candidate_rows AS (', '),\nold_all AS (')), normalize(bind(8)));
  assert.equal(normalize(fixtureQuery(fixture, 'candidate_all AS (', '),\ndifferences AS (')), normalize(bind(20)));
  assert.match(fixture, /old_new_difference_rows/);
  assert.match(fixture, /exact_order_matches/);
});

test('row-query timeouts keep their fallback and identify the failing panel safely', async () => {
  const warnings = [];
  const fn = loadFunction('safeRows', 'safeRowsResult', {
    staffQuery: async () => { throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }); },
    logger: { warn: (...args) => warnings.push(args) }
  });
  const rows = await fn('DO NOT LOG QUERY', ['DO NOT LOG PARAMETERS'], { timeoutMs: 5000, label: 'staff_panel_whatsapp' });
  assert.equal(rows.length, 0);
  assert.equal(warnings.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(warnings[0][1])), {
    label: 'staff_panel_whatsapp', code: '57014', message: 'canceling statement due to statement timeout'
  });
  assert.doesNotMatch(JSON.stringify(warnings), /DO NOT LOG/);
});

test('count-query timeouts preserve stale-count metadata and log their label', async () => {
  const warnings = [];
  const fn = loadFunction('safeOne', 'safeRows', {
    staffQuery: async () => { throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' }); },
    logger: { warn: (...args) => warnings.push(args) }
  });
  const row = await fn('DO NOT LOG QUERY', [], { total: null }, { label: 'staff_panel_found_online_count' });
  assert.deepEqual(JSON.parse(JSON.stringify(row)), { total: null, _fallback_reason: 'statement_timeout' });
  assert.equal(warnings[0][1].label, 'staff_panel_found_online_count');
  assert.equal(warnings[0][1].code, '57014');
});

test('successful row reads are returned without warning', async () => {
  const rows = [{ id: 'fixture-result' }];
  const fn = loadFunction('safeRows', 'safeRowsResult', {
    staffQuery: async () => ({ rows }),
    logger: { warn: () => assert.fail('successful query should not warn') }
  });
  assert.equal(await fn('SELECT fixture', [], {}), rows);
});

test('optional-table absence keeps the existing quiet empty fallback', async () => {
  const fn = loadFunction('safeRows', 'safeRowsResult', {
    staffQuery: async () => { throw Object.assign(new Error('fixture optional table missing'), { code: '42P01' }); },
    logger: { warn: () => assert.fail('optional-table absence should remain quiet') }
  });
  assert.equal((await fn('SELECT fixture', [], {})).length, 0);
});
