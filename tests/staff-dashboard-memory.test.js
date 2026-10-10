'use strict';

/**
 * P6 (10 Oct 2026): moderators' /staff-dashboard and /admin tabs crashed about
 * once a minute. These tests pin the fixes:
 *   - one background-refresh timer for both dashboards, replaced (not stacked)
 *     on each schedule, cleared when the page changes, deferred while hidden;
 *   - one staff dashboard render at a time;
 *   - one reused Google review map (a Google map can't be destroyed);
 *   - review screens stop their TikTok/YouTube players when they go away;
 *   - the found-online "Load more" list is capped;
 *   - object URLs are released;
 *   - /staff-dashboard/review/<id> opens one listing's review without the dashboard.
 */

process.env.JWT_SECRET = process.env.JWT_SECRET || 'staff-dashboard-memory-test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const APP = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');

function slice(startMarker, endMarker) {
  const start = APP.indexOf(startMarker);
  const end = APP.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return APP.slice(start, end);
}

function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(fn, ms) { const id = nextId++; timers.set(id, { fn, at: now + (Number(ms) || 0) }); return id; },
    clearTimeout(id) { timers.delete(id); },
    pending() { return timers.size; },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at <= now && timers.has(id)) { timers.delete(id); timer.fn(); }
      }
    }
  };
}

function loadScheduler() {
  const timers = fakeTimers();
  const listeners = {};
  const context = {
    window: { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout },
    document: { hidden: false, addEventListener: (name, fn) => { listeners[name] = fn; } },
    currentPage: 'staff-dashboard'
  };
  vm.createContext(context);
  const code = slice('const dashboardRefreshScheduler', 'let lpGalleryObjectUrls');
  vm.runInContext(`${code}; this.api = { scheduleDashboardRefresh, clearDashboardRefresh, dashboardRefreshPending, dashboardRefreshScheduler };`, context);
  return { ...context.api, timers, context, listeners };
}

test('scheduling again replaces the pending refresh instead of stacking timers', () => {
  const s = loadScheduler();
  let runs = 0;
  for (let i = 0; i < 25; i += 1) s.scheduleDashboardRefresh('staff_after_moderation', 700, () => { runs += 1; });
  assert.equal(s.timers.pending(), 1, 'one timer, not 25');
  s.timers.advance(700);
  assert.equal(runs, 1);
  assert.equal(s.dashboardRefreshPending(), false);
});

test('a hidden tab defers the refresh until it is visible again', () => {
  const s = loadScheduler();
  let runs = 0;
  s.context.document.hidden = true;
  s.scheduleDashboardRefresh('staff_dashboard_retry', 1000, () => { runs += 1; });
  s.timers.advance(5000);
  assert.equal(runs, 0, 'no re-render while hidden');
  assert.equal(s.dashboardRefreshPending(), true);
  s.context.document.hidden = false;
  s.listeners.visibilitychange();
  s.timers.advance(400);
  assert.equal(runs, 1);
});

test('leaving the dashboard drops its pending refresh', () => {
  const s = loadScheduler();
  let runs = 0;
  s.scheduleDashboardRefresh('staff_dashboard_retry', 1000, () => { runs += 1; }, { page: 'staff-dashboard' });
  s.context.currentPage = 'home';
  s.timers.advance(1000);
  assert.equal(runs, 0);
  assert.equal(s.dashboardRefreshPending(), false);
  assert.match(APP, /if \(targetPage !== previousPage\) clearDashboardRefresh\(\);/, 'showPage clears it');
});

test('every staff/admin background refresh goes through the one scheduler', () => {
  const retry = slice('function scheduleStaffDashboardPanelRetry', 'function clearStaffDashboardPanelRetry');
  assert.match(retry, /scheduleDashboardRefresh\("staff_panels_retry"/);
  assert.doesNotMatch(retry, /window\.setTimeout/);
  const render = slice('async function renderStaffDashboardOnce', 'function staffPreviewVideosHtml');
  assert.doesNotMatch(render, /window\.setTimeout\(\(\) => \{\s*if \(currentPage === "staff-dashboard"\) renderStaffDashboard\(\);/);
  assert.equal((render.match(/scheduleDashboardRefresh\("staff_dashboard_retry"/g) || []).length, 2);
  assert.match(render, /scheduleDashboardRefresh\("staff_dashboard_retry", 30000/, 'the open-ended retry is every 30 s, not 10 s');
  const after = slice('function queueStaffDashboardRefreshAfterModeration', 'async function staffApprovePreviewListing');
  assert.match(after, /scheduleDashboardRefresh\("staff_after_moderation", 700/);
  const adminTab = slice('function adminScheduleDashboardRefreshForTab', 'function adminListingIdArg');
  assert.match(adminTab, /scheduleDashboardRefresh\("admin_tab", 80/);
});

test('only one staff dashboard render runs at a time', () => {
  const wrapper = slice('async function renderStaffDashboard()', 'async function renderStaffDashboardOnce');
  assert.match(wrapper, /if \(currentPage === "staff-review"\) return;/);
  assert.match(wrapper, /if \(staffDashboardRenderInFlight\) \{\s*staffDashboardRenderQueued = true;\s*return;/);
  assert.match(wrapper, /finally \{\s*staffDashboardRenderInFlight = false;/);
});

test('the Google review map is created once and reused', () => {
  const init = slice('async function initAdminReviewLocationMap', 'function adminReviewTimestampField');
  assert.equal((init.match(/new google\.maps\.Map\(/g) || []).length, 1);
  assert.match(init, /const reused = reviewGoogleMapCache\.map && reviewGoogleMapCache\.host;/);
  assert.match(init, /el\.appendChild\(reviewGoogleMapCache\.host\)/);
  assert.match(init, /reviewGoogleMapCache\.map = map;/);
});

test('closing or replacing a review screen stops its players', () => {
  const context = { reviewGoogleMapCache: { host: null }, adminReviewLocationMap: { remove() { context.removed = true; } }, adminReviewLocationProvider: 'leaflet', adminReviewLocationMarker: {} };
  vm.createContext(context);
  vm.runInContext(`${slice('function releaseReviewModal', 'function closeStaffListingPreview')}; this.releaseReviewModal = releaseReviewModal;`, context);
  const frames = [{ src: 'https://www.tiktok.com/embed/v2/1', removed: false, remove() { this.removed = true; } }];
  let modalRemoved = false;
  const modal = {
    querySelectorAll: (selector) => (selector === 'iframe' ? frames : []),
    contains: () => false,
    remove() { modalRemoved = true; }
  };
  context.releaseReviewModal(modal);
  assert.equal(frames[0].src, 'about:blank');
  assert.equal(frames[0].removed, true);
  assert.equal(modalRemoved, true);
  assert.equal(context.removed, true, 'a Leaflet map is removed');
  const render = slice('function renderStaffListingPreviewModal', 'const source = preview.source_evidence');
  assert.match(render, /releaseReviewModal\(existing\)/, 're-rendering releases the old screen');
  assert.match(slice('function closeAdminReviewPanel', 'function getAdminReviewChecklistFromDom'), /frame\.src = "about:blank"/);
});

test('the found-online "Load more" list stops at 200 rows', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`const STAFF_FOUND_ONLINE_MAX_ROWS = 200; ${slice('function staffFoundOnlineQueueView', 'function renderStaffFoundOnlineQueue')}; this.view = staffFoundOnlineQueueView;`, context);
  const rows = (n, offset = 0) => Array.from({ length: n }, (_, i) => ({ id: `r${i + offset}` }));
  const state = { data: { queued_found_online: rows(8), queued_found_online_meta: { total: 900, page_limit: 8 } }, extra: rows(192, 8), page: 25, moreHint: true };
  const view = context.view(state);
  assert.equal(view.rows.length, 200);
  assert.equal(view.hasMore, false);
  assert.match(view.label, /search the review queue/);
  const below = context.view({ ...state, extra: rows(40, 8) });
  assert.equal(below.hasMore, true);
  assert.match(slice('async function staffLoadMoreFoundOnline', 'function renderStaffSourceIntake'), /rows\.length >= STAFF_FOUND_ONLINE_MAX_ROWS\) return;/);
});

test('object URLs are released', () => {
  assert.match(APP, /lpGalleryObjectUrls\.forEach\(\(url\) => \{ try \{ URL\.revokeObjectURL\(url\); \} catch \(e\) \{\} \}\);/);
  assert.match(APP, /payout-slip\.pdf`;\s*document\.body\.appendChild\(link\);\s*link\.click\(\);\s*link\.remove\(\);\s*window\.setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 2000\);/);
  assert.match(APP, /makaug-lead-desk-[\s\S]{0,200}window\.setTimeout\(\(\) => URL\.revokeObjectURL\(url\), 2000\);/);
});

test('hidden placeholder rotations and the lead-desk countdown pause', () => {
  assert.match(APP, /if \(document\.hidden \|\| \/dashboard\$\/\.test\(String\(currentPage \|\| ""\)\) \|\| currentPage === "staff-review"\) return;/);
  assert.match(APP, /if \(document\.hidden \|\| currentPage !== "list-property"\) return;/);
  assert.match(APP, /leadDeskTimer = setInterval\(\(\) => \{\s*if \(document\.hidden\) return;/);
});

test('/staff-dashboard/review/<id> is a staff-only protected route', () => {
  const { isProtectedPath, roleCanAccessProtectedPath, isKnownPublicRoute } = require('../services/publicHtmlSanitizer');
  const route = '/staff-dashboard/review/56ec3ed3-3962-4aa1-aea1-4bf333279083';
  assert.equal(isProtectedPath(route), true);
  assert.equal(isKnownPublicRoute(route), true, 'served (behind the sign-in check), not a 404');
  assert.equal(roleCanAccessProtectedPath({ role: 'moderator' }, route), true);
  assert.equal(roleCanAccessProtectedPath({ role: 'admin' }, route), true);
  assert.equal(roleCanAccessProtectedPath({ role: 'buyer_renter', audience: 'finder' }, route), false);
  assert.equal(roleCanAccessProtectedPath({ role: 'agent_broker', audience: 'agent' }, route), false);
});

test('the direct review page loads only that listing\'s review payload', () => {
  assert.match(APP, /const directReviewMatch = String\(path \|\| ""\)\.match\(\/\^\\\/staff-dashboard\\\/review\\\/\(\[0-9a-f\]\{8\}/);
  const direct = slice('const staffDirectReviewState', 'function ensureStaffModerationActionDelegates');
  const calls = direct.match(/apiRequest\(`[^`]+`/g) || [];
  assert.deepEqual(calls, ['apiRequest(`/api/staff/properties/${encodeURIComponent(id)}/preview`'], 'one request: the listing preview');
  assert.doesNotMatch(direct, /renderStaffDashboard|hydrateStaffDashboardPanels|\/api\/staff\/dashboard/);
  assert.match(direct, /renderStaffListingPreviewModal\(response\?\.data \|\| \{\}\)/, 'same Preview & edit screen: save, approve, reject, photo upload');
  const after = slice('function queueStaffDashboardRefreshAfterModeration', 'async function staffApprovePreviewListing');
  assert.match(after, /if \(currentPage === "staff-review"\) \{[\s\S]*staffReloadDirectReview\(reviewId\)/, 'after a decision it reloads just this listing');
  assert.match(APP, /const directReviewNext = \["moderator", "admin"\]\.includes\(resolvedUser\.portal_mode\) \? directReviewNextPathAfterAuth\(\) : "";/, 'signing in returns to the listing');
  assert.match(APP, /normalizedNext === "\/staff-dashboard" \|\| normalizedNext\.startsWith\("\/staff-dashboard\/"\)\) return "moderator";/, 'the login page opens the staff sign-in');
  const build = fs.readFileSync(path.join(__dirname, '../scripts/build-js.js'), 'utf8');
  assert.match(build, /'openStaffDirectReview'/, 'the router can reach it from the public bundle');
});

test('the staff preview API still needs a staff session', async () => {
  const express = require('express');
  const request = require('supertest');
  const app = express();
  app.use(express.json());
  app.use('/api/staff', require('../routes/staff'));
  const res = await request(app).get('/api/staff/properties/56ec3ed3-3962-4aa1-aea1-4bf333279083/preview');
  assert.ok([401, 403].includes(res.status), `got ${res.status}`);
});

test.after(async () => {
  try { await require('../config/database').pool.end(); } catch (_) {}
});
