'use strict';

// 26 Oct 2026: "Preview & edit" opened FA7807 (the top card) because panels
// above the queue repainted between aiming and clicking; stat tiles sat on
// "Loading" after timeouts; retries came in bursts.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function grab(name) {
  const start = APP.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  let depth = 0;
  for (let i = APP.indexOf(') {', start) + 2; i < APP.length; i += 1) {
    if (APP[i] === '{') depth += 1;
    else if (APP[i] === '}' && --depth === 0) return APP.slice(start, i + 1);
  }
  throw new Error(name);
}
const grabConst = (name) => {
  const start = APP.indexOf(`const ${name} =`);
  assert.ok(start >= 0, name);
  return APP.slice(start, APP.indexOf(';\n', start) + 1);
};

test('a queue click right after the list moved, or on a card that changed under the pointer, is ignored', () => {
  const ctx = {};
  vm.runInNewContext(`${grabConst('STAFF_QUEUE_CLICK_GUARD_MS')}\n${grab('staffQueueClickShouldBeIgnored')}\nthis.fn = staffQueueClickShouldBeIgnored;`, ctx);
  assert.equal(ctx.fn(10_000, 9_700, 'b', 'b'), 'moved');
  assert.equal(ctx.fn(10_000, 9_400, 'b', 'b'), '');
  assert.equal(ctx.fn(10_000, 0, 'b', 'a'), 'changed', 'pressed on B, released on A (FA7807)');
  assert.equal(ctx.fn(10_000, 0, null, 'a'), '', 'keyboard activation has no pointerdown');
});

test('the guard runs in the capture phase and the queue repaints keep their height', () => {
  assert.match(APP, /document\.addEventListener\("click", \(event\) => \{[\s\S]{0,400}\[data-staff-queue-card\] button[\s\S]{0,600}stopImmediatePropagation\(\)/);
  const paint = grab('staffPaintReviewQueue');
  assert.doesNotMatch(paint, /wrap\.innerHTML\s*=/, 'paints go through staffSetQueueHtml');
  assert.match(grab('staffSetQueueHtml'), /minHeight/);
});

test('loaded queue rows are never swapped back to the loading placeholder', () => {
  const main = grab('renderStaffReviewQueue');
  assert.match(main, /!staffReviewQueueState\.main\.rows\.length\) staffSetQueueHtml\(wrap, staffReviewQueueLoadingHtml/);
  const broker = grab('renderStaffBrokerReviewQueue');
  assert.doesNotMatch(broker, /wrap\.innerHTML\s*=/);
  assert.equal((broker.match(/if \(!brokerRowsShown\) staffSetQueueHtml/g) || []).length, 3);
});

test('panels above the queue keep the queue in place when they fill in', () => {
  assert.ok(HTML.indexOf('id="staff-video-caption-conflicts-list"') < HTML.indexOf('id="staff-review-queue"'));
  assert.match(grab('adminLoadVideoCaptionConflicts'), /staffReplaceHtmlAboveQueue\(host, html\)/);
  assert.match(grab('loadAgentBookingStaffFlags'), /staffReplaceHtmlAboveQueue\(list,/);
  const helper = grab('staffReplaceHtmlAboveQueue');
  assert.match(helper, /getBoundingClientRect\(\)\.top - before/);
  assert.match(helper, /window\.scrollBy\(0, delta\)/);
});

test('video caption conflicts load alongside the dashboard, not after it', () => {
  const once = grab('renderStaffDashboardOnce');
  const conflicts = once.indexOf('adminLoadVideoCaptionConflicts("staff")');
  const fast = once.indexOf('"/api/staff/dashboard?fast=1"');
  assert.ok(conflicts > 0 && fast > 0 && conflicts < fast, 'started before the awaited dashboard call');
  assert.equal((once.match(/adminLoadVideoCaptionConflicts\(/g) || []).length, 1);
});

test('retries back off with jitter and full renders are spaced out', () => {
  const ctx = { Math: Object.create(Math) };
  ctx.Math.random = () => 0.5;
  vm.runInNewContext(`${grab('staffDashboardRetryDelayMs')}\nthis.fn = staffDashboardRetryDelayMs;`, ctx);
  assert.deepEqual([1, 2, 3, 4, 5, 9].map((n) => ctx.fn(n, 1500, 20000)), [1500, 3000, 6000, 12000, 20000, 20000]);
  assert.match(grab('renderStaffDashboard'), /sinceLast < STAFF_DASHBOARD_MIN_RENDER_GAP_MS/);
  // Panel retries keep their existing capped linear backoff (pinned by staff-dashboard-panel-retry-scheduler.test.js).
  assert.match(grab('renderStaffDashboardOnce'), /staffDashboardRetryDelayMs\(staffDashboardAuthRetryCount, 1500, 20000\)/);
});

function statSandbox(stored = {}) {
  const elements = {};
  const el = (id) => (elements[id] ||= { textContent: 'Loading', dataset: {}, title: '', removeAttribute(name) { this[name] = ''; } });
  const storage = new Map(Object.entries(stored));
  const sandbox = {
    authState: { user: { id: 'mod-1' } },
    document: { getElementById: el },
    window: { localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } },
    staffStatCopy: () => '',
    setTextById: (id, text) => { el(id).textContent = text; },
    Date, Number, JSON, String
  };
  vm.runInNewContext([
    grabConst('STAFF_STAT_CACHE_PREFIX'), grabConst('staffStatCache'),
    grab('staffNumber'), grab('staffKampalaDateTime'), grab('staffStatCacheOwner'), grab('staffStatCacheValues'),
    grab('staffRememberStat'), grab('staffShowCachedStat'), grab('setStaffStat'), grab('setStaffDashboardLoadingState'),
    'this.api = { setStaffStat, setStaffDashboardLoadingState };'
  ].join('\n'), sandbox);
  return { api: sandbox.api, el, storage };
}

test('a timed-out count shows the last known value, not Loading or a dash', () => {
  const first = statSandbox();
  first.api.setStaffStat('staff-stat-leads', 42);
  assert.equal(first.el('staff-stat-leads').textContent, '42');
  first.api.setStaffStat('staff-stat-leads', null);
  assert.equal(first.el('staff-stat-leads').textContent, '42');
  assert.equal(first.el('staff-stat-leads').dataset.staffStatCached, '1');
  assert.match(first.el('staff-stat-leads').title, /Last known count/);

  // A new page load reads it back from localStorage.
  const reload = statSandbox(Object.fromEntries(first.storage));
  reload.api.setStaffDashboardLoadingState();
  assert.equal(reload.el('staff-stat-leads').textContent, '42');
  assert.equal(reload.el('staff-stat-ads').textContent, 'Loading', 'never loaded: still Loading');
  reload.api.setStaffStat('staff-stat-ads', null);
  assert.equal(reload.el('staff-stat-ads').textContent, '—');
});

test('the preview editor shows the listing ref prominently', () => {
  const ctx = { adminEscape: (v) => String(v), adminAttr: (v) => String(v) };
  vm.runInNewContext(`${grab('staffPreviewRefBadgeHtml')}\nthis.fn = staffPreviewRefBadgeHtml;`, ctx);
  assert.match(ctx.fn({ id: 'abc', inquiry_reference: 'MK-20261020-FA7807' }), /data-staff-preview-ref[\s\S]*MK-20261020-FA7807/);
  assert.match(ctx.fn({ id: '12345678-aaaa' }), /ID 12345678/);
  assert.match(grab('renderStaffListingPreviewModal'), /\$\{staffPreviewRefBadgeHtml\(preview\)\}/);
});

test('a refused or failed save says the note was saved', () => {
  const fn = grab('staffShowPreviewSaveError');
  assert.match(fn, /The internal note was saved/);
  assert.match(fn, /Note saved\. Other changes were not saved\./);
  assert.doesNotMatch(fn, /The location was not saved/);
});
