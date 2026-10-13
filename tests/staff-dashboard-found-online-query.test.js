'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const assert = require('node:assert/strict');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../routes/staff.js'), 'utf8');

async function capturePanelQueries() {
  const declarations = acorn.parse(source, { ecmaVersion: 'latest' }).body;
  const functions = ['sqlList', 'sourceQualitySuppressedFlagSql', 'indexedSourceQualitySuppressedFlagSql',
    'launchTestListingWhere', 'actionablePendingReviewWhere', 'foundOnlineReviewWhere',
    'staffPanelLeadRows', 'staffPanelWhatsappConversationRows', 'staffPanelWhatsappBridgeStatus',
    'staffPanelSourceRegistryRows', 'staffFoundOnlinePanelMeta', 'buildDashboardPanelsPayload'];
  const constants = ['ACTIONABLE_PENDING_REVIEW_STATUSES', 'OPEN_LEAD_STATUSES', 'STAFF_DASHBOARD_QUEUE_LIMIT',
    'STAFF_DASHBOARD_PANEL_LIMIT', 'STAFF_DASHBOARD_PANEL_SCAN_LIMIT', 'STAFF_DASHBOARD_PANEL_QUERY_TIMEOUT_MS',
    'STAFF_REVIEW_QUEUE_ORDER'];
  const calls = [];
  const foundRows = [{ id: 'fixture-oldest' }, { id: 'fixture-next' }];
  const context = vm.createContext({
    process: { env: {} }, actorId: () => 'fixture-staff', publicStaffUser: () => ({}),
    rowIsBrokerReview: () => false, staffModerationPanelRows: () => [], staffReviewQueueMeta: () => ({}),
    safeRows: async (sql, params, options) => {
      calls.push({ sql, params, options });
      return options.label === 'staff_panel_found_online' ? foundRows : [];
    },
    safeOne: async (sql, params, fallback, options) => {
      calls.push({ sql, params, options });
      return options.label === 'staff_panel_found_online_count' ? { total: 11 } : fallback;
    },
    safeRowsResult: async (sql, params, options) => { calls.push({ sql, params, options }); return { rows: [], ok: true }; }
  });
  for (const node of declarations) {
    if (node.type === 'FunctionDeclaration' && functions.includes(node.id.name)) {
      vm.runInContext(source.slice(node.start, node.end), context);
    }
    if (node.type === 'VariableDeclaration') {
      for (const declaration of node.declarations) {
        if (constants.includes(declaration.id.name)) vm.runInContext(`const ${source.slice(declaration.start, declaration.end)};`, context);
      }
    }
  }
  const payload = await vm.runInContext('buildDashboardPanelsPayload({userAuth:{}})', context);
  return { calls, payload, foundRows };
}

module.exports = { capturePanelQueries };

if (require.main === module) {
  const normalize = (sql) => sql.replace(/\s+/g, ' ').trim();
  function clause(fixture, startMarker, endMarker) {
    const start = fixture.indexOf(startMarker) + startMarker.length;
    const end = fixture.indexOf(endMarker, start);
    assert(start >= startMarker.length && end > start, 'missing fixture clause');
    return fixture.slice(start, end);
  }

  test('actual panel query filters all eligible IDs before oldest-first limiting and payload reads', async () => {
    const { calls } = await capturePanelQueries();
    const list = calls.find((call) => call.options.label === 'staff_panel_found_online');
    const count = calls.find((call) => call.options.label === 'staff_panel_found_online_count');
    assert.deepEqual(Array.from(list.params), [8]);
    assert.equal(list.options.timeoutMs, 5000);
    const boundary = list.sql.indexOf('paged_found_online AS MATERIALIZED');
    const candidates = list.sql.slice(0, boundary);
    assert(boundary > 0);
    assert.doesNotMatch(candidates, /LIMIT/i, 'no arbitrary cutoff before complete eligibility filtering');
    assert.equal(normalize(candidates.slice(candidates.indexOf('WHERE ') + 6).replace(/\),\s*$/, '')),
      normalize(count.sql.slice(count.sql.indexOf('WHERE ') + 6)), 'list and exact count use identical eligibility');
    const limit = list.sql.indexOf('LIMIT $1');
    assert(limit > boundary && list.sql.indexOf('SELECT p.id, p.title') > limit);
    assert.equal((list.sql.match(/ORDER BY p.created_at ASC NULLS LAST, p.id ASC/g) || []).length, 2);
  });

  test('actual payload keeps exact-count metadata and the reachable found-online paging endpoint', async () => {
    const { payload, foundRows } = await capturePanelQueries();
    assert.equal(payload.source_intake.queued_found_online, foundRows);
    const meta = payload.source_intake.queued_found_online_meta;
    assert.equal(meta.total, 11);
    assert.equal(meta.returned_count, 2);
    assert.equal(meta.has_more, true);
    assert.equal(meta.order, 'oldest_first');
    assert.equal(meta.page_endpoint, '/api/staff/properties/review-queue?segment=found_online&limit=8');
  });

  test('synthetic PostgreSQL fixture contains the exact current list and unchanged count queries', async () => {
    const { calls } = await capturePanelQueries();
    const list = calls.find((call) => call.options.label === 'staff_panel_found_online');
    const count = calls.find((call) => call.options.label === 'staff_panel_found_online_count');
    const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/staff-found-online-panel-semantics.sql'), 'utf8');
    assert.equal(normalize(clause(fixture, 'new_eight AS (', '),\nold_all AS (')), normalize(list.sql.replace(/\$1\b/g, '8')));
    assert.equal(normalize(clause(fixture, 'new_all AS (', '),\nexact_count AS (')), normalize(list.sql.replace(/\$1\b/g, '20')));
    assert.equal(normalize(clause(fixture, 'exact_count AS (', '),\ndifferences AS (')), normalize(count.sql));
    assert.doesNotMatch(fixture, /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b/i);
  });
}
