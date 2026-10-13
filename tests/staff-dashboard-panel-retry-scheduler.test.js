'use strict';

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
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, at: now + (Number(ms) || 0) });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    pending() { return timers.size; },
    advance(ms) {
      const until = now + ms;
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > until) break;
        const [id, timer] = next;
        now = timer.at;
        timers.delete(id);
        timer.fn();
      }
      now = until;
    }
  };
}

function loadRetryScheduler() {
  const timers = fakeTimers();
  const listeners = {};
  const hydrations = [];
  const context = {
    window: { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout },
    document: { hidden: false, addEventListener: (name, fn) => { listeners[name] = fn; } },
    currentPage: 'staff-dashboard',
    authState: { token: 'fixture-token', user: { id: 'fixture-staff' } },
    setTextById() {},
    hydrateStaffDashboardPanels: (...args) => { hydrations.push(args); }
  };
  vm.createContext(context);
  vm.runInContext([
    slice('const dashboardRefreshScheduler', 'let lpGalleryObjectUrls'),
    slice('let staffDashboardData', 'let staffAiLastCsv'),
    slice('function scheduleStaffDashboardPanelRetry', '// Both moderation lists page'),
    'this.api = { scheduleStaffDashboardPanelRetry, clearStaffDashboardPanelRetry, scheduleDashboardRefresh, clearDashboardRefresh, dashboardRefreshPending, retryCount: () => staffDashboardPanelRetryCount };'
  ].join('\n'), context);
  return { ...context.api, context, timers, listeners, hydrations };
}

test('a post-moderation refresh can replace a panel retry without blocking the next retry', () => {
  const s = loadRetryScheduler();
  let refreshes = 0;
  s.scheduleStaffDashboardPanelRetry();
  s.scheduleDashboardRefresh('staff_after_moderation', 700, () => { refreshes += 1; }, { page: 'staff-dashboard' });
  s.timers.advance(700);
  assert.equal(refreshes, 1);
  assert.equal(s.hydrations.length, 0, 'the replaced panel retry did not run');
  assert.equal(s.retryCount(), 1, 'cancellation preserves the attempted retry count');
  s.scheduleStaffDashboardPanelRetry();
  assert.equal(s.timers.pending(), 1, 'the next retry remains schedulable');
  assert.equal(s.retryCount(), 2);
  s.timers.advance(3599);
  assert.equal(s.hydrations.length, 0);
  s.timers.advance(1);
  assert.equal(s.hydrations.length, 1);
});

test('a late panel retry preserves the pending moderation refresh and remains possible afterwards', () => {
  const s = loadRetryScheduler();
  let refreshes = 0;
  s.scheduleStaffDashboardPanelRetry();
  s.scheduleDashboardRefresh('staff_after_moderation', 700, () => { refreshes += 1; }, { page: 'staff-dashboard' });
  s.scheduleStaffDashboardPanelRetry();
  assert.equal(s.retryCount(), 1, 'waiting for the moderation refresh does not consume another attempt');
  assert.equal(s.timers.pending(), 1);
  s.timers.advance(700);
  assert.equal(refreshes, 1, 'the late panel retry cannot replace the moderation refresh');
  assert.equal(s.hydrations.length, 0);
  assert.equal(s.dashboardRefreshPending(), false);
  s.scheduleStaffDashboardPanelRetry();
  assert.equal(s.retryCount(), 2);
  assert.equal(s.timers.pending(), 1);
  s.timers.advance(3600);
  assert.equal(refreshes, 1);
  assert.equal(s.hydrations.length, 1);
});

test('leaving and returning to the dashboard allows a new retry after the route clears the scheduler', () => {
  const s = loadRetryScheduler();
  s.scheduleStaffDashboardPanelRetry();
  s.context.currentPage = 'home';
  s.clearDashboardRefresh();
  s.timers.advance(5000);
  assert.equal(s.hydrations.length, 0);
  s.context.currentPage = 'staff-dashboard';
  s.scheduleStaffDashboardPanelRetry();
  assert.equal(s.timers.pending(), 1, 'a cancelled retry cannot block the returned dashboard');
  assert.equal(s.retryCount(), 2);
  s.timers.advance(3600);
  assert.equal(s.hydrations.length, 1);
});

test('a retry dropped by the scheduler route check also allows a new retry on return', () => {
  const s = loadRetryScheduler();
  s.scheduleStaffDashboardPanelRetry();
  s.context.currentPage = 'home';
  s.timers.advance(1800);
  assert.equal(s.hydrations.length, 0);
  assert.equal(s.dashboardRefreshPending(), false);
  s.context.currentPage = 'staff-dashboard';
  s.scheduleStaffDashboardPanelRetry();
  assert.equal(s.timers.pending(), 1);
  s.timers.advance(3600);
  assert.equal(s.hydrations.length, 1);
});

test('a hidden panel retry stays deferred once and resumes once when the tab becomes visible', () => {
  const s = loadRetryScheduler();
  s.scheduleStaffDashboardPanelRetry();
  s.context.document.hidden = true;
  s.timers.advance(1800);
  assert.equal(s.timers.pending(), 0);
  assert.equal(s.dashboardRefreshPending(), true);
  assert.equal(s.hydrations.length, 0);
  s.scheduleStaffDashboardPanelRetry();
  assert.equal(s.retryCount(), 1, 'the deferred retry is still pending');
  s.context.document.hidden = false;
  s.listeners.visibilitychange();
  s.scheduleStaffDashboardPanelRetry();
  assert.equal(s.timers.pending(), 1);
  assert.equal(s.retryCount(), 1, 'visibility resume does not add an attempt');
  s.timers.advance(399);
  assert.equal(s.hydrations.length, 0);
  s.timers.advance(1);
  assert.equal(s.hydrations.length, 1);
  assert.deepEqual(s.hydrations[0], ['/api/staff/dashboard?panels=1', 'fixture-staff']);
  assert.equal(s.dashboardRefreshPending(), false);
});

test('ordinary retries keep their backoff, suppress duplicate schedules and stop at the limit', () => {
  const s = loadRetryScheduler();
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    s.scheduleStaffDashboardPanelRetry();
    s.scheduleStaffDashboardPanelRetry();
    assert.equal(s.retryCount(), attempt);
    assert.equal(s.timers.pending(), 1);
    s.timers.advance(1800 * attempt - 1);
    assert.equal(s.hydrations.length, attempt - 1);
    s.timers.advance(1);
    assert.equal(s.hydrations.length, attempt);
  }
  s.scheduleStaffDashboardPanelRetry();
  assert.equal(s.retryCount(), 4);
  assert.equal(s.timers.pending(), 0);
  s.clearStaffDashboardPanelRetry();
  s.scheduleStaffDashboardPanelRetry();
  assert.equal(s.retryCount(), 1);
  s.timers.advance(1800);
  assert.equal(s.hydrations.length, 5);
});

test('clearing panel retry state preserves a replacement moderation refresh', () => {
  const s = loadRetryScheduler();
  let refreshes = 0;
  s.scheduleStaffDashboardPanelRetry();
  s.scheduleDashboardRefresh('staff_after_moderation', 700, () => { refreshes += 1; }, { page: 'staff-dashboard' });
  s.clearStaffDashboardPanelRetry();
  assert.equal(s.retryCount(), 0);
  assert.equal(s.timers.pending(), 1);
  s.timers.advance(700);
  assert.equal(refreshes, 1);
  assert.equal(s.hydrations.length, 0);
});
