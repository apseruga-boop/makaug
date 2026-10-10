'use strict';

// Event-loop lag log (C4, 10 Oct 2026). On 10 Oct 09:24-09:36 one CPU-heavy
// step blocked the only web core for minutes: the once-a-minute memory log
// skipped, every scheduler timed out, and nothing in the logs said what was
// running. Each minute this logs the event-loop delay p99/max when p99 is
// above 500 ms, with the requests and jobs that were in flight, so the next
// stall names itself.

const { monitorEventLoopDelay } = require('perf_hooks');

const DEFAULT_THRESHOLD_MS = 500;
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

function histogramStats(histogram) {
  const ms = (ns) => Math.round(Number(ns || 0) / 1e6);
  return { p99: ms(histogram.percentile(99)), max: ms(histogram.max), mean: ms(histogram.mean) };
}

function startEventLoopLagMonitor({ logger, thresholdMs = DEFAULT_THRESHOLD_MS, intervalMs = 60_000 } = {}) {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  const timer = setInterval(() => {
    const stats = histogramStats(histogram);
    histogram.reset();
    if (stats.p99 >= thresholdMs && logger) logger.warn(formatLagLine(stats, inFlightSummary()));
  }, intervalMs);
  timer.unref?.();
  return { stop() { clearInterval(timer); histogram.disable(); }, histogram };
}

module.exports = {
  DEFAULT_THRESHOLD_MS,
  trackWork,
  inFlightSummary,
  lagTrackingMiddleware,
  formatLagLine,
  histogramStats,
  startEventLoopLagMonitor
};
