'use strict';
// King live-check fixes (Arthur, 21 Nov 2026): true funnel, "not tracked" weeks,
// no stuck "Loading…", live rows, spelled-out report week, lighter tab switches.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const slice = (src, from, to) => { const a = src.indexOf(from); const b = src.indexOf(to, a + from.length); assert.ok(a >= 0 && b > a, `slice ${from}`); return src.slice(a, b); };

test('pipeline is a true funnel: each step filters on the step above', () => {
  const src = read('services/kingDesk.js');
  const sql = slice(src, 'WITH called AS (', '[startOf(r.monthStart)]');
  assert.match(sql, /COUNT\(\*\) FROM called WHERE interested\)/);
  assert.match(sql, /COUNT\(\*\) FROM called WHERE interested AND said_hi\)/);
  assert.match(sql, /c\.interested AND c\.said_hi AS from_call/);
  assert.match(sql, /FROM j WHERE from_call\)/);
  assert.match(sql, /FROM j WHERE from_call AND approved_at IS NOT NULL\)/);
  assert.match(sql, /FROM j WHERE from_call AND approved_at IS NOT NULL AND paid\)/);
  assert.match(sql, /FROM j WHERE NOT from_call\)::int AS other_submitted/);
  assert.match(src, /paid: num\(p\.paid_funnel\), paid_all: num\(paidNow\[0\]\?\.v\)/);
  const ui = read('assets/king-desk.js');
  assert.match(ui, /data-kd-funnel-note>Each step counts only the people who passed the step above/);
});

test('weeks before the calling screen started say "not tracked", not 0', () => {
  const cs = read('services/callingScreen.js');
  assert.match(cs, /async function trackingSince\(\)/);
  assert.match(cs, /tracking_since: await trackingSince\(\)/);
  const kd = read('services/kingDesk.js');
  assert.match(kd, /last_week_tracked: Boolean\(trackedFrom && trackedFrom <= r\.lastWeekStart\)/);
  assert.match(read('assets/king-desk.js'), /data-kd-week-note/);
  const team = read('assets/king-team.js');
  assert.match(team, /untracked = Boolean\(since && prev\.k && prev\.k < since && !prev\.calls && !prev\.talk_s\)/);
  assert.match(team, /vs not tracked/);
});

test('King calling panels never stay on "Loading…"', () => {
  const src = read('assets/calling-screen.js');
  assert.doesNotMatch(src, /\}, function \(e\) \{ box\.innerHTML = '<div class="mkc-err">' \+ esc\(e\.message\) \+ '<\/div>'; \}\);/);
  assert.equal((src.match(/\}\)\.catch\(function \(e\) \{ panelFailed\(box, e\); \}\);/g) || []).length, 9);
  assert.match(src, /function panelFailed\(box, e\)/);
  assert.match(src, /setTimeout\(function \(\) \{ ctl\.abort\(\); \}, opts\.timeoutMs \|\| 30000\)/);
  const app = read('assets/makaug-app.js');
  const load = slice(app, 'async function staffPerfLoad(scope)', 'function staffPerfColor');
  assert.match(load, /Promise\.race\(/);
  assert.match(load, /data-perf-retry/);
});

test('a tab switch only reloads the full King snapshot when it is over a minute old', () => {
  const app = read('assets/makaug-app.js');
  const fn = slice(app, 'function adminScheduleDashboardRefreshForTab', 'function adminListingIdArg');
  const calls = [];
  const ctx = { adminDashboardRendering: false, canUseLiveAdminApi: () => true, document: { getElementById: () => ({ classList: { contains: () => false } }) },
    adminDashboardTabRefreshTimer: null, clearTimeout() {}, scheduleDashboardRefresh: (k) => calls.push(k), renderAdminDashboard: async () => {}, console,
    ADMIN_TAB_REFRESH_MIN_MS: 60000, adminDashboardLoadedAt: Date.now() - 5000 };
  vm.createContext(ctx);
  vm.runInContext(`${fn}; this.run = adminScheduleDashboardRefreshForTab;`, ctx);
  ctx.run(); assert.equal(calls.length, 0, 'fresh snapshot: no reload');
  vm.runInContext('adminDashboardLoadedAt = Date.now() - 120000', ctx);
  ctx.run(); assert.deepEqual(calls, ['admin_tab']);
  assert.match(slice(app, 'async function renderAdminDashboard(options = {})', 'refreshMarketplaceModerationQueue("admin"'), /adminDashboardLoadedAt = Date\.now\(\);/);
});

test('Live & featured fetches its own rows when the snapshot has none', () => {
  const app = read('assets/makaug-app.js');
  assert.match(app, /if \(!adminLiveEndpointRows\(adminLiveRows\)\.length\) loadKingLiveRows\(\)\.catch/);
  const fn = slice(app, 'async function loadKingLiveRows', 'async function loadStaffLiveFeatured');
  assert.match(fn, /fetchAdminPaginatedRows\("\/api\/admin\/properties\/live"/);
  assert.match(fn, /admin_live_endpoint: true/);
});

test('agent report week is spelled out, not left to the browser date format', () => {
  const app = read('assets/makaug-app.js');
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(`${slice(app, 'function adminAgentReportWeekText', 'function syncAdminAgentReportWeekLabel')}; this.f = adminAgentReportWeekText;`, ctx);
  assert.equal(ctx.f('2026-11-09'), 'Mon 9 Nov – Sun 15 Nov 2026');
  assert.equal(ctx.f('2026-12-28'), 'Mon 28 Dec – Sun 3 Jan 2027');
  assert.equal(ctx.f(''), '');
  assert.match(read('index.html'), /id="admin-agent-report-week-label"/);
});

test('first WhatsApp replies are matched with one normalised pass', () => {
  const src = read('services/staffPerformance.js');
  const fn = slice(src, 'async function loadFirstReplies', 'async function payingAgents');
  assert.match(fn, /WITH m AS MATERIALIZED/);
  assert.match(fn, /JOIN m ON m\.k = p\.phone_key AND m\.created_at > p\.pitched_at/);
  assert.doesNotMatch(fn, /\bUPDATE\b|\bDELETE\b|\bINSERT\b/);
});
