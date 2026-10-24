'use strict';

const logger = require('../config/logger');
const { runBackgroundWork } = require('../config/database');
const { sourceMonitorSchedulerEnabled } = require('../utils/harvestFeatureFlags');
const { BOOT_DELAY_MS } = require('../utils/schedulerStagger');

const TIME_ZONE = 'Europe/London';
const RUN_HOUR = 5;
const RUN_MINUTE = 30;
const CATCH_UP_MINUTES = 60;
const LOCK_KEY = 'makaug_daily_source_monitor';
const RAN_TODAY_ACTION = 'daily_source_monitor_ran';
const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000;

// 24 Oct 2026, about 06:00–06:30 UK: Chrome timed out opening Preview & edit.
// This job runs inside the web process at 05:30 London and can still start
// during the 60-minute catch-up, through 06:30, on a 512 MB instance. The
// scheduled pass is smaller and yields between platforms so requests can run.
// 22 Oct 05:20 was before 05:30. That pass was the unindexed actor_id count.
const SCHEDULED_MONITOR_SETTINGS = Object.freeze({
  confirm: true,
  platforms: ['youtube', 'x', 'tiktok'],
  youtubeJobMode: 'channel_uploads',
  maxSources: 3,
  maxResults: 4,
  maxPages: 1,
  tiktokWhenUnset: true,
  yieldBetweenPlatforms: true,
  yieldMs: 250,
});

let timer = null;
let tickRunning = false;

function londonParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  let hour = Number(pick('hour'));
  if (hour === 24) hour = 0;
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    dateKey: `${pick('year')}-${pick('month')}-${pick('day')}`,
    hour,
    minute: Number(pick('minute') || 0),
  };
}

function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utc.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function utcFromLondon(dateKey, hour, minute) {
  const [year, month, day] = dateKey.split('-').map(Number);
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = londonParts(new Date(utc));
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), parts.hour, parts.minute, 0);
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
    const delta = asUtc - desired;
    if (delta === 0) return new Date(utc);
    utc -= delta;
  }
  return new Date(utc);
}

function nextSourceMonitorRun(now = new Date()) {
  const local = londonParts(now);
  const before = local.hour < RUN_HOUR || (local.hour === RUN_HOUR && local.minute < RUN_MINUTE);
  const dateKey = before ? local.dateKey : addDays(local.dateKey, 1);
  return utcFromLondon(dateKey, RUN_HOUR, RUN_MINUTE);
}

function insideCatchUpWindow(now = new Date()) {
  const local = londonParts(now);
  const minutes = local.hour * 60 + local.minute;
  const start = RUN_HOUR * 60 + RUN_MINUTE;
  return minutes >= start && minutes < start + CATCH_UP_MINUTES;
}

function scheduledFireAt(now = new Date(), catchUpDelayMs = BOOT_DELAY_MS.source_monitor) {
  if (insideCatchUpWindow(now)) return new Date(now.getTime() + Math.max(0, catchUpDelayMs));
  return nextSourceMonitorRun(now);
}

function registrationLine(nextRun) {
  return `source monitor scheduler registered next_run=${nextRun.toISOString()}`;
}

function runWithTimeout(work, timeoutMs, onTimeout, { unref = true } = {}) {
  let timerId;
  const timeout = new Promise((resolve) => {
    timerId = setTimeout(() => {
      onTimeout?.();
      resolve({ ok: false, timed_out: true, reason: 'source_monitor_timeout' });
    }, timeoutMs);
    if (unref) timerId.unref?.();
  });
  return Promise.race([
    Promise.resolve().then(work).then((report) => ({ ok: true, timed_out: false, report })),
    timeout,
  ]).finally(() => clearTimeout(timerId));
}

async function claimToday(db, now, log) {
  if (typeof db?.getClient !== 'function') return { claimed: false, reason: 'no_database_client' };
  const londonDate = londonParts(now).dateKey;
  const client = await db.getClient();
  let locked = false;
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [LOCK_KEY]);
    locked = lock.rows[0]?.locked === true;
    if (!locked) return { claimed: false, reason: 'locked', london_date: londonDate };
    const prior = await client.query(
      `SELECT id
       FROM audit_logs
       WHERE action = $1
         AND details->>'london_date' = $2
       LIMIT 1`,
      [RAN_TODAY_ACTION, londonDate]
    );
    if (prior.rows[0]) return { claimed: false, reason: 'already_ran_today', london_date: londonDate };
    await client.query(
      `INSERT INTO audit_logs (actor_id, action, details)
       VALUES ($1, $2, $3::jsonb)`,
      ['daily_source_monitor_scheduler', RAN_TODAY_ACTION, JSON.stringify({
        london_date: londonDate,
        status: 'started',
        time_zone: TIME_ZONE,
        local_time: '05:30',
      })]
    );
    return { claimed: true, london_date: londonDate };
  } catch (error) {
    log.warn('source monitor scheduler could not claim today', { message: error?.message || String(error) });
    return { claimed: false, reason: 'claim_failed', london_date: londonDate };
  } finally {
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [LOCK_KEY]);
      } catch (_) {}
    }
    client.release?.();
  }
}

async function runScheduledSourceMonitor(db, options = {}) {
  const log = options.logger || logger;
  if (tickRunning) return { ok: true, skipped: true, reason: 'already_running' };
  if (!sourceMonitorSchedulerEnabled(options.env || process.env) && options.ignoreKillSwitch !== true) {
    return { ok: true, skipped: true, reason: 'disabled' };
  }
  tickRunning = true;
  const now = options.now instanceof Date ? options.now : new Date();
  const configuredTimeout = Number(options.timeoutMs || process.env.SOURCE_MONITOR_RUN_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : DEFAULT_TIMEOUT_MS;
  let stop = false;
  try {
    const claim = await claimToday(db, now, log);
    if (!claim.claimed) return { ok: true, skipped: true, ...claim };
    const runMonitor = options.runMonitor || ((settings) => {
      const { runContinuousSocialMonitor } = require('../scripts/run-continuous-social-monitor');
      return runContinuousSocialMonitor(settings);
    });
    const outcome = await runWithTimeout(
      () => runMonitor({
        ...SCHEDULED_MONITOR_SETTINGS,
        env: options.env || process.env,
        shouldStop: () => stop,
      }),
      timeoutMs,
      () => { stop = true; },
      { unref: options.unrefTimer !== false }
    );
    if (outcome.timed_out) {
      stop = true;
      log.warn('source monitor scheduler timed out; the rest of today is left alone', { timeout_ms: timeoutMs });
      return { ok: false, skipped: false, timed_out: true, london_date: claim.london_date };
    }
    log.info('source monitor scheduler finished', { london_date: claim.london_date });
    return { ok: true, skipped: false, london_date: claim.london_date, report: outcome.report };
  } catch (error) {
    log.error('source monitor scheduler run failed', { message: error?.message || String(error) });
    return { ok: false, skipped: false, reason: 'run_failed', message: error?.message || String(error) };
  } finally {
    tickRunning = false;
    // The timeout does not cancel the sweep. Dropping the registry here means
    // a timed-out run does not keep the ~100 MB cache for the rest of its TTL.
    // The sweep copies the window it needs before its own first await.
    try {
      require('./propertySourceRegistryService').releasePropertySourceRegistryCache();
    } catch (_error) { /* the monitor result is already decided */ }
  }
}

function clearDailySourceMonitorSchedule() {
  if (timer) clearTimeout(timer);
  timer = null;
}

function armDailySourceMonitor(db, options, delayMs) {
  clearDailySourceMonitorSchedule();
  timer = setTimeout(() => {
    timer = null;
    const finish = () => {
      const next = nextSourceMonitorRun(new Date());
      (options.logger || logger).info(registrationLine(next));
      armDailySourceMonitor(db, options, Math.max(1000, next.getTime() - Date.now()));
    };
    const tracked = runBackgroundWork(() => runScheduledSourceMonitor(db, options))
      .catch((error) => {
        (options.logger || logger).error('source monitor scheduler tick failed', { message: error?.message || String(error) });
      })
      .finally(finish);
    if (options.track === true) options.lastTick = tracked;
  }, Math.max(0, delayMs));
  timer.unref?.();
}

function startDailySourceMonitorScheduler(db, options = {}) {
  const log = options.logger || logger;
  const env = options.env || process.env;
  if (env.NODE_ENV === 'test' && options.force !== true) return { started: false, reason: 'test' };
  if (!sourceMonitorSchedulerEnabled(env)) {
    log.info('source monitor scheduler disabled next_run=none');
    return { started: false, reason: 'disabled' };
  }
  if (!env.DATABASE_URL && options.allowWithoutDatabase !== true) {
    log.info('source monitor scheduler disabled next_run=none');
    return { started: false, reason: 'no_database' };
  }
  const now = options.now instanceof Date ? options.now : new Date();
  const next = scheduledFireAt(now, options.catchUpDelayMs);
  log.info(registrationLine(next));
  if (options.arm === false) return { started: true, next_run_at: next.toISOString(), armed: false };
  armDailySourceMonitor(db, options, next.getTime() - now.getTime());
  return { started: true, next_run_at: next.toISOString(), armed: true };
}

module.exports = {
  CATCH_UP_MINUTES,
  LOCK_KEY,
  RAN_TODAY_ACTION,
  RUN_HOUR,
  RUN_MINUTE,
  SCHEDULED_MONITOR_SETTINGS,
  TIME_ZONE,
  clearDailySourceMonitorSchedule,
  insideCatchUpWindow,
  londonParts,
  nextSourceMonitorRun,
  registrationLine,
  runScheduledSourceMonitor,
  scheduledFireAt,
  startDailySourceMonitorScheduler,
};
