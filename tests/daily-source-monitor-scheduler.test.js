'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { dailySourceMonitorPlan } = require('../utils/dailySourceMonitorPlan');
const { sourceMonitorSchedulerEnabled } = require('../utils/harvestFeatureFlags');
const {
  RAN_TODAY_ACTION,
  SCHEDULED_MONITOR_SETTINGS,
  clearDailySourceMonitorSchedule,
  insideCatchUpWindow,
  nextSourceMonitorRun,
  registrationLine,
  runScheduledSourceMonitor,
  scheduledFireAt,
  startDailySourceMonitorScheduler,
} = require('../services/dailySourceMonitorScheduler');

function memoryDb() {
  const rows = [];
  const state = { locked: false, refuseLock: false };
  return {
    rows,
    state,
    async getClient() {
      let held = false;
      return {
        async query(sql, params = []) {
          if (sql.includes('pg_try_advisory_lock')) {
            if (state.refuseLock || state.locked) return { rows: [{ locked: false }] };
            state.locked = true;
            held = true;
            return { rows: [{ locked: true }] };
          }
          if (sql.includes('pg_advisory_unlock')) {
            if (held) state.locked = false;
            held = false;
            return { rows: [] };
          }
          if (sql.includes('FROM audit_logs')) {
            const found = rows.find((row) => row.action === params[0] && row.details.london_date === params[1]);
            return { rows: found ? [found] : [] };
          }
          if (sql.includes('INSERT INTO audit_logs')) {
            rows.push({ actor_id: params[0], action: params[1], details: JSON.parse(params[2]) });
            return { rows: [] };
          }
          throw new Error(`unexpected sql: ${sql}`);
        },
        release() {},
      };
    },
  };
}

test('the kill switch defaults on and an explicit false turns it off', () => {
  assert.equal(sourceMonitorSchedulerEnabled({}), true);
  assert.equal(sourceMonitorSchedulerEnabled({ SOURCE_MONITOR_SCHEDULER_ENABLED: 'true' }), true);
  assert.equal(sourceMonitorSchedulerEnabled({ SOURCE_MONITOR_SCHEDULER_ENABLED: 'false' }), false);
  assert.equal(sourceMonitorSchedulerEnabled({ SOURCE_MONITOR_SCHEDULER_ENABLED: '0' }), false);
});

test('05:30 Europe/London is the next run in summer and winter', () => {
  const before = nextSourceMonitorRun(new Date('2026-10-23T04:00:00.000Z'));
  assert.equal(before.toISOString(), '2026-10-23T04:30:00.000Z');
  const after = nextSourceMonitorRun(new Date('2026-10-23T07:10:00.000Z'));
  assert.equal(after.toISOString(), '2026-10-24T04:30:00.000Z');
  const winter = nextSourceMonitorRun(new Date('2026-11-01T05:00:00.000Z'));
  assert.equal(winter.toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(insideCatchUpWindow(new Date('2026-10-23T04:45:00.000Z')), true);
  assert.equal(insideCatchUpWindow(new Date('2026-10-23T05:30:00.000Z')), false);
  assert.equal(scheduledFireAt(new Date('2026-10-23T07:10:00.000Z')).toISOString(), '2026-10-24T04:30:00.000Z');
});

test('registration logs the next run and the kill switch can refuse to arm', () => {
  const logs = [];
  const logger = { info: (line) => logs.push(line), warn() {}, error() {} };
  const armed = startDailySourceMonitorScheduler({}, {
    force: true,
    arm: false,
    allowWithoutDatabase: true,
    now: new Date('2026-10-23T07:10:00.000Z'),
    env: { DATABASE_URL: 'postgres://example' },
    logger,
  });
  assert.equal(armed.started, true);
  assert.equal(armed.next_run_at, '2026-10-24T04:30:00.000Z');
  assert.equal(logs[0], registrationLine(new Date('2026-10-24T04:30:00.000Z')));
  const disabled = startDailySourceMonitorScheduler({}, {
    force: true,
    allowWithoutDatabase: true,
    env: { SOURCE_MONITOR_SCHEDULER_ENABLED: 'false' },
    logger,
  });
  assert.equal(disabled.reason, 'disabled');
  assert.equal(logs.at(-1), 'source monitor scheduler disabled next_run=none');
  clearDailySourceMonitorSchedule();
});

test('the scheduled run matches the daily command and includes TikTok unless the flag is false', () => {
  assert.deepEqual(SCHEDULED_MONITOR_SETTINGS.platforms, ['youtube', 'x', 'tiktok']);
  assert.equal(SCHEDULED_MONITOR_SETTINGS.youtubeJobMode, 'channel_uploads');
  assert.equal(SCHEDULED_MONITOR_SETTINGS.maxSources, 3);
  assert.equal(SCHEDULED_MONITOR_SETTINGS.maxResults, 4);
  assert.equal(SCHEDULED_MONITOR_SETTINGS.yieldBetweenPlatforms, true);
  assert.equal(SCHEDULED_MONITOR_SETTINGS.maxPages, 1);
  assert.equal(SCHEDULED_MONITOR_SETTINGS.tiktokWhenUnset, true);
  const included = dailySourceMonitorPlan({
    env: { HARVEST_AUTOMATION_ENABLED: 'false' },
    platforms: SCHEDULED_MONITOR_SETTINGS.platforms,
    tiktokWhenUnset: true,
  });
  assert.deepEqual(included.sweep_platforms, ['tiktok']);
  const off = dailySourceMonitorPlan({
    env: { HARVEST_AUTOMATION_ENABLED: 'true', TIKTOK_SOURCE_SWEEP_ENABLED: 'false' },
    platforms: SCHEDULED_MONITOR_SETTINGS.platforms,
    tiktokWhenUnset: true,
  });
  assert.equal(off.sweep_platforms.includes('tiktok'), false);
  assert.equal(off.skipped.some((item) => item.reason === 'tiktok_source_sweep_disabled'), true);
  assert.deepEqual(off.sweep_platforms, ['youtube', 'x']);
});

test('a second run on the same London day is skipped after the audit marker', async () => {
  const db = memoryDb();
  const calls = [];
  const first = await runScheduledSourceMonitor(db, {
    ignoreKillSwitch: true,
    env: {},
    now: new Date('2026-10-24T04:30:00.000Z'),
    runMonitor: async (settings) => {
      calls.push(settings.platforms);
      return { ok: true };
    },
  });
  const second = await runScheduledSourceMonitor(db, {
    ignoreKillSwitch: true,
    env: {},
    now: new Date('2026-10-24T04:40:00.000Z'),
    runMonitor: async () => {
      calls.push('again');
      return { ok: true };
    },
  });
  assert.equal(first.skipped, false);
  assert.equal(second.skipped, true);
  assert.equal(second.reason, 'already_ran_today');
  assert.deepEqual(calls, [['youtube', 'x', 'tiktok']]);
  assert.equal(db.rows[0].action, RAN_TODAY_ACTION);
  assert.equal(db.rows[0].details.london_date, '2026-10-24');
  assert.equal(db.state.locked, false);
});

test('a held advisory lock skips the run', async () => {
  const db = memoryDb();
  db.state.refuseLock = true;
  let called = false;
  const result = await runScheduledSourceMonitor(db, {
    ignoreKillSwitch: true,
    env: {},
    runMonitor: async () => {
      called = true;
      return { ok: true };
    },
  });
  assert.equal(result.reason, 'locked');
  assert.equal(called, false);
});

test('a monitor failure or timeout does not throw', async () => {
  const failed = await runScheduledSourceMonitor(memoryDb(), {
    ignoreKillSwitch: true,
    env: {},
    runMonitor: async () => {
      throw new Error('sweep broke');
    },
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, 'run_failed');

  let sawStop = false;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const pending = runScheduledSourceMonitor(memoryDb(), {
    ignoreKillSwitch: true,
    env: {},
    timeoutMs: 20,
    unrefTimer: false,
    runMonitor: async (settings) => {
      await gate;
      sawStop = settings.shouldStop();
      return { ok: true };
    },
  });
  const timed = await pending;
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(timed.timed_out, true);
  assert.equal(sawStop, true);
});

test('the web service arms the scheduler and the cron blueprint stays a comment', () => {
  const root = path.resolve(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const yaml = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');
  assert.match(server, /startDailySourceMonitorScheduler\(db\)/);
  assert.match(yaml, /#\s*- type: cron/);
  assert.doesNotMatch(yaml, /^ {2}- type: cron/m);
});
