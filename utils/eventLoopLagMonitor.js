'use strict';

// Event-loop lag log (C4, 10 Oct 2026). On 10 Oct 09:24-09:36 one CPU-heavy
// step blocked the only web core for minutes: the once-a-minute memory log
// skipped, every scheduler timed out, and nothing in the logs said what was
// running. Each minute this logs the event-loop delay p99/max when p99 is
// above 500 ms, with the requests and jobs that were in flight, so the next
// stall names itself.
//
// 25 Oct 2026: /healthz (no database) took 5-9 s about every few minutes while
// this monitor stayed silent. One 8 s block is a single sample in a minute's
// histogram, so p99 never moves. A half-second tick now logs any single block
// of 2 s or more as soon as the loop is free again, with memory and the work
// still in flight (the blocking request or job has not finished yet).

const { monitorEventLoopDelay } = require('perf_hooks');

const DEFAULT_THRESHOLD_MS = 500;
const DEFAULT_STALL_MS = 2000;
const STALL_TICK_MS = 500;
const inFlight = new Map();
let nextWorkId = 1;

// Mark a piece of work (a request or a job) as running; returns done().
function trackWork(label) {
  const id = nextWorkId++;
  inFlight.set(id, { label: String(label || 'work').slice(0, 160), startedAt: Date.now() });
  return () => { inFlight.delete(id); };
}

// The longest-running work first, at most `limit` entries.
function inFlightSummary(limit = 5, now = Date.now()) {
  return [...inFlight.values()]
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(0, limit)
    .map((item) => `${item.label} (${Math.round((now - item.startedAt) / 1000)}s)`);
}

// Express middleware: label = METHOD path (no query string).
function lagTrackingMiddleware(req, res, next) {
  const done = trackWork(`${req.method} ${String(req.originalUrl || req.url || '').split('?')[0].slice(0, 120)}`);
  let finished = false;
  const finish = () => { if (!finished) { finished = true; done(); } };
  res.on('finish', finish);
  res.on('close', finish);
  next();
}

function formatLagLine(stats, work = []) {
  return `event_loop_lag p99_ms=${stats.p99} max_ms=${stats.max} mean_ms=${stats.mean} in_flight=${work.length ? work.join(' | ') : 'none'}`;
}

function memoryMb() {
  const usage = process.memoryUsage();
  const mb = (bytes) => Math.round(Number(bytes || 0) / 1048576);
  return `rss_mb=${mb(usage.rss)} heap_used_mb=${mb(usage.heapUsed)} heap_total_mb=${mb(usage.heapTotal)}`;
}

function formatStallLine(blockedMs, work = [], memory = '') {
  return `event_loop_stall blocked_ms=${blockedMs}${memory ? ` ${memory}` : ''} in_flight=${work.length ? work.join(' | ') : 'none'}`;
}

// Calls onStall(blockedMs) when a tick lands at least stallMs late.
function startStallDetector({ stallMs = DEFAULT_STALL_MS, tickMs = STALL_TICK_MS, onStall, now = Date.now } = {}) {
  let last = now();
  const timer = setInterval(() => {
    const at = now();
    const blockedMs = at - last - tickMs;
    last = at;
    if (blockedMs >= stallMs && onStall) onStall(blockedMs);
  }, tickMs);
  timer.unref?.();
  return timer;
}

function histogramStats(histogram) {
  const ms = (ns) => Math.round(Number(ns || 0) / 1e6);
  return { p99: ms(histogram.percentile(99)), max: ms(histogram.max), mean: ms(histogram.mean) };
}

function startEventLoopLagMonitor({
  logger,
  thresholdMs = DEFAULT_THRESHOLD_MS,
  intervalMs = 60_000,
  stallMs = DEFAULT_STALL_MS,
  stallTickMs = STALL_TICK_MS
} = {}) {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  const timer = setInterval(() => {
    const stats = histogramStats(histogram);
    histogram.reset();
    if (stats.p99 >= thresholdMs && logger) logger.warn(formatLagLine(stats, inFlightSummary()));
  }, intervalMs);
  timer.unref?.();
  const stallTimer = startStallDetector({
    stallMs,
    tickMs: stallTickMs,
    onStall: (blockedMs) => logger?.warn(formatStallLine(blockedMs, inFlightSummary(8), memoryMb()))
  });
  return {
    stop() { clearInterval(timer); clearInterval(stallTimer); histogram.disable(); },
    histogram
  };
}

module.exports = {
  DEFAULT_THRESHOLD_MS,
  DEFAULT_STALL_MS,
  formatStallLine,
  startStallDetector,
  trackWork,
  inFlightSummary,
  lagTrackingMiddleware,
  formatLagLine,
  histogramStats,
  startEventLoopLagMonitor
};
