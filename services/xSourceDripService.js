'use strict';

const logger = require('../config/logger');
const { getPropertySourceRegistry } = require('./propertySourceRegistryService');
const { runSocialPlatformPostSweep } = require('./socialPlatformPostDiscoveryService');
const { logNotification } = require('./notificationLogService');

const X_SOURCE_DRIP_MARKER = 'x-source-drip-20260714';
const X_SOURCE_DRIP_FAST_MODE_MARKER = 'x-source-drip-fast-mode-20260714';
const X_SOURCE_DRIP_FULL_ARCHIVE_PACING_MARKER = 'x-drip-fullarchive-pacing-20260715';
const X_SOURCE_DRIP_KEY = 'x_source_drip';
const BASE_INTERVAL_MINUTES = 2;
const MAX_BACKOFF_MINUTES = 240;
const FULL_ARCHIVE_MAX_BATCH_SIZE = 5;
const RECENT_MAX_BATCH_SIZE = 25;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_X_PUBLISHED_AFTER = '2026-01-01T00:00:00.000Z';
const DEFAULT_SEARCH_MODE = 'recent';
const TARGET_REVIEWABLE = 3000;
const DEFAULT_MONTHLY_READ_CAP = 10000;
const SCHEDULER_POLL_MS = 60 * 1000;
let schedulerTimer = null;
let schedulerRunning = false;
let schedulerArmedAt = null;
let schedulerLastTickAt = null;
let schedulerLastResult = null;

function schedulerDisabledByEnv() {
  return String(process.env.X_SOURCE_DRIP_SCHEDULER_ENABLED || 'true').toLowerCase() === 'false';
}

function schedulerStatus() {
  return {
    armed: Boolean(schedulerTimer),
    disabled_by_env: schedulerDisabledByEnv(),
    running: schedulerRunning,
    poll_ms: SCHEDULER_POLL_MS,
    armed_at: schedulerArmedAt,
    last_tick_at: schedulerLastTickAt,
    last_result: schedulerLastResult,
  };
}

function numberInRange(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.round(parsed), max));
}

function boolLike(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = String(value || '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on', 'start', 'enabled'].includes(text)) return true;
  if (['0', 'false', 'no', 'off', 'pause', 'paused', 'disabled'].includes(text)) return false;
  return fallback;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + Math.max(1, Number(minutes) || 1) * 60 * 1000);
}

function normalizeIsoDate(value, fallback = DEFAULT_X_PUBLISHED_AFTER) {
  const raw = String(value || '').trim();
  const parsed = raw ? new Date(raw) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return fallback;
}

function normalizeSearchMode(value, fallback = DEFAULT_SEARCH_MODE) {
  const mode = String(value || fallback || DEFAULT_SEARCH_MODE).trim().toLowerCase();
  return mode === 'all' ? 'all' : 'recent';
}

function maxBatchSizeForMode(searchMode = DEFAULT_SEARCH_MODE) {
  return normalizeSearchMode(searchMode) === 'all' ? FULL_ARCHIVE_MAX_BATCH_SIZE : RECENT_MAX_BATCH_SIZE;
}

function monthWindowStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function normalizeMonthWindow(value) {
  const parsed = value ? new Date(value) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return monthWindowStart().toISOString();
}

function xSourceCount() {
  return getPropertySourceRegistry().filter((source) => String(source.platform || '').toLowerCase() === 'x').length;
}

function normalizeStateRow(row = {}) {
  const sourceCount = Number(row.source_count || 0) || xSourceCount();
  const offset = numberInRange(row.cursor_offset, 0, 0, Math.max(sourceCount - 1, 0));
  const searchMode = normalizeSearchMode(row.search_mode);
  const monthlyReadCap = numberInRange(row.monthly_read_cap, DEFAULT_MONTHLY_READ_CAP, 1, 10000000);
  const monthlyReadCount = Math.max(0, Number(row.monthly_read_count || 0) || 0);
  return {
    drip_key: row.drip_key || X_SOURCE_DRIP_KEY,
    platform: 'x',
    enabled: row.enabled === true,
    cursor_offset: offset,
    source_count: sourceCount,
    percent_crawled: sourceCount ? Number(((offset / sourceCount) * 100).toFixed(2)) : 0,
    base_interval_minutes: numberInRange(row.base_interval_minutes, BASE_INTERVAL_MINUTES, 1, 1440),
    current_interval_minutes: numberInRange(row.current_interval_minutes, BASE_INTERVAL_MINUTES, 1, 1440),
    batch_size: numberInRange(row.batch_size, DEFAULT_BATCH_SIZE, 1, maxBatchSizeForMode(searchMode)),
    max_results: numberInRange(row.max_results, DEFAULT_MAX_RESULTS, 10, 100),
    search_mode: searchMode,
    published_after: normalizeIsoDate(row.published_after),
    target_reviewable: numberInRange(row.target_reviewable, TARGET_REVIEWABLE, 1, 1000000),
    monthly_read_cap: monthlyReadCap,
    monthly_read_count: monthlyReadCount,
    monthly_read_remaining: Math.max(0, monthlyReadCap - monthlyReadCount),
    monthly_window_started_at: normalizeMonthWindow(row.monthly_window_started_at),
    status: row.status || 'paused',
    pause_reason: row.pause_reason || '',
    consecutive_rate_limited_runs: Number(row.consecutive_rate_limited_runs || 0),
    last_run_at: row.last_run_at || null,
    next_run_at: row.next_run_at || null,
    last_result: row.last_result || {},
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

async function ensureXSourceDripState(db) {
  const sourceCount = xSourceCount();
  const baseInterval = numberInRange(process.env.X_SOURCE_DRIP_BASE_INTERVAL_MINUTES, BASE_INTERVAL_MINUTES, 1, 1440);
  const searchMode = normalizeSearchMode(process.env.X_SOURCE_DRIP_SEARCH_MODE);
  const batchSize = numberInRange(process.env.X_SOURCE_DRIP_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, maxBatchSizeForMode(searchMode));
  const maxResults = numberInRange(process.env.X_SOURCE_DRIP_MAX_RESULTS, DEFAULT_MAX_RESULTS, 10, 100);
  const publishedAfter = normalizeIsoDate(process.env.X_SOURCE_DRIP_PUBLISHED_AFTER);
  const monthlyReadCap = numberInRange(process.env.X_SOURCE_DRIP_MONTHLY_READ_CAP, DEFAULT_MONTHLY_READ_CAP, 1, 10000000);
  await db.query(
    `INSERT INTO source_drip_state (
       drip_key, platform, enabled, cursor_offset, source_count,
       base_interval_minutes, current_interval_minutes, batch_size, max_results,
       search_mode, published_after, target_reviewable, monthly_read_cap, status, next_run_at
     )
     VALUES ($1,'x',FALSE,0,$2,$3,$3,$4,$5,$6,$7,$8,$9,'paused',NULL)
     ON CONFLICT (drip_key) DO UPDATE
       SET source_count = EXCLUDED.source_count,
           batch_size = CASE
             WHEN source_drip_state.search_mode = 'all' THEN LEAST(source_drip_state.batch_size, 5)
             ELSE LEAST(source_drip_state.batch_size, 25)
           END,
           monthly_read_cap = COALESCE(source_drip_state.monthly_read_cap, EXCLUDED.monthly_read_cap),
           updated_at = NOW()
     RETURNING *`,
    [X_SOURCE_DRIP_KEY, sourceCount, baseInterval, batchSize, maxResults, searchMode, publishedAfter, TARGET_REVIEWABLE, monthlyReadCap]
  );
}

async function getXSourceDripStatus(db, { limit = 12 } = {}) {
  await ensureXSourceDripState(db);
  const stateResult = await db.query('SELECT * FROM source_drip_state WHERE drip_key = $1', [X_SOURCE_DRIP_KEY]);
  const runs = await db.query(
    `SELECT *
     FROM source_drip_run_logs
     WHERE drip_key = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [X_SOURCE_DRIP_KEY, numberInRange(limit, 12, 1, 50)]
  );
  const counts = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE LOWER(COALESCE(status,'')) IN ('approved','live','published'))::int AS live_count,
       COUNT(*) FILTER (WHERE LOWER(COALESCE(status,'')) IN ('pending','submitted') OR LOWER(COALESCE(moderation_stage,'')) IN ('submitted','review_queue','pending_review'))::int AS reviewable_count
     FROM properties
     WHERE source = 'found_online_property_source_v1'
        OR listed_via = 'found_online'
        OR COALESCE(extra_fields->>'source_platform','') = 'x'`,
  );
  return {
    marker: X_SOURCE_DRIP_MARKER,
    fast_mode_marker: X_SOURCE_DRIP_FAST_MODE_MARKER,
    full_archive_pacing_marker: X_SOURCE_DRIP_FULL_ARCHIVE_PACING_MARKER,
    scheduler: schedulerStatus(),
    state: normalizeStateRow(stateResult.rows[0]),
    recent_runs: runs.rows,
    inventory: {
      live_count: counts.rows[0]?.live_count || 0,
      reviewable_count: counts.rows[0]?.reviewable_count || 0,
      target: TARGET_REVIEWABLE,
    },
  };
}

async function updateXSourceDripConfig(db, input = {}) {
  await ensureXSourceDripState(db);
  const current = await getXSourceDripStatus(db);
  const state = current.state;
  const sourceCount = xSourceCount();
  const searchMode = normalizeSearchMode(input.x_search_mode || input.search_mode || input.searchMode || state.search_mode);
  const batchSize = numberInRange(input.batch_size ?? input.batchSize ?? state.batch_size, state.batch_size, 1, maxBatchSizeForMode(searchMode));
  const baseInterval = numberInRange(input.interval_minutes ?? input.intervalMinutes ?? input.base_interval_minutes ?? state.base_interval_minutes, state.base_interval_minutes, 1, 1440);
  const maxResults = numberInRange(input.max_results ?? input.maxResults ?? state.max_results, state.max_results, 10, 100);
  const cursorOffset = numberInRange(input.cursor_offset ?? input.cursorOffset ?? state.cursor_offset, state.cursor_offset, 0, Math.max(sourceCount - 1, 0));
  const publishedAfter = normalizeIsoDate(input.published_after ?? input.publishedAfter ?? input.x_published_after ?? input.xPublishedAfter ?? state.published_after, state.published_after);
  const target = numberInRange(input.target_reviewable ?? input.targetReviewable ?? state.target_reviewable, state.target_reviewable, 1, 1000000);
  const monthlyReadCap = numberInRange(input.monthly_read_cap ?? input.monthlyReadCap ?? state.monthly_read_cap, state.monthly_read_cap || DEFAULT_MONTHLY_READ_CAP, 1, 10000000);
  const enabled = input.enabled == null ? state.enabled : boolLike(input.enabled, state.enabled);
  const nextRunAt = enabled ? addMinutes(new Date(), baseInterval).toISOString() : null;
  const result = await db.query(
    `UPDATE source_drip_state
     SET enabled = $2,
         cursor_offset = $3,
         source_count = $4,
         base_interval_minutes = $5,
         current_interval_minutes = $5,
         batch_size = $6,
         max_results = $7,
         search_mode = $8,
         published_after = $9,
         target_reviewable = $10,
         monthly_read_cap = $11,
         status = CASE WHEN $2 THEN 'scheduled' ELSE 'paused' END,
         pause_reason = CASE WHEN $2 THEN NULL ELSE pause_reason END,
         next_run_at = $12,
         consecutive_rate_limited_runs = CASE WHEN $2 THEN 0 ELSE consecutive_rate_limited_runs END,
         updated_at = NOW()
     WHERE drip_key = $1
     RETURNING *`,
    [X_SOURCE_DRIP_KEY, enabled, cursorOffset, sourceCount, baseInterval, batchSize, maxResults, searchMode, publishedAfter, target, monthlyReadCap, nextRunAt]
  );
  return normalizeStateRow(result.rows[0]);
}

async function startXSourceDrip(db, input = {}) {
  await updateXSourceDripConfig(db, { ...input, enabled: true });
  const result = await db.query(
    `UPDATE source_drip_state
     SET enabled = TRUE,
         status = 'scheduled',
         pause_reason = NULL,
         current_interval_minutes = base_interval_minutes,
         consecutive_rate_limited_runs = 0,
         next_run_at = NOW() + (base_interval_minutes * INTERVAL '1 minute'),
         updated_at = NOW()
     WHERE drip_key = $1
     RETURNING *`,
    [X_SOURCE_DRIP_KEY]
  );
  return normalizeStateRow(result.rows[0]);
}

async function pauseXSourceDrip(db, reason = 'paused_by_admin') {
  await ensureXSourceDripState(db);
  const result = await db.query(
    `UPDATE source_drip_state
     SET enabled = FALSE,
         status = 'paused',
         pause_reason = $2,
         next_run_at = NULL,
         updated_at = NOW()
     WHERE drip_key = $1
     RETURNING *`,
    [X_SOURCE_DRIP_KEY, String(reason || 'paused_by_admin').slice(0, 240)]
  );
  return normalizeStateRow(result.rows[0]);
}

function reportStatus(report = {}) {
  return Number(report.status || report.statusCode || 0);
}

function firstRateLimitedSourceOffset(summary = {}, fallbackOffset = 0) {
  const reports = Array.isArray(summary.fetch_reports) ? summary.fetch_reports : [];
  const rateLimited = reports.find((report) => reportStatus(report) === 429 || /rate|too many/i.test(String(report.reason || '')));
  const offset = Number(rateLimited?.source_registry_offset);
  return Number.isFinite(offset) && offset >= 0 ? offset : fallbackOffset;
}

function summarizeSweepResult(result = {}) {
  const x = result.x || {};
  const reports = Array.isArray(x.fetch_reports) ? x.fetch_reports : [];
  const importResult = result.import_result || {};
  const rateLimitedCount = reports.filter((report) => reportStatus(report) === 429 || /rate|too many/i.test(String(report.reason || ''))).length;
  const authErrorCount = reports.filter((report) => [401, 403].includes(reportStatus(report))).length;
  const billingErrorCount = reports.filter((report) => reportStatus(report) === 402 || /payment required|credits/i.test(String(report.reason || ''))).length;
  return {
    search_job_count: Number(x.search_job_count || reports.length || 0),
    api_read_count: Number(x.search_job_count || reports.length || 0),
    fetched_posts_count: Number(x.fetched_posts_count || 0),
    discovered_posts_count: Number(result.discovered_posts_count || 0),
    created_properties: Number(importResult.created_properties || 0),
    review_queue_properties: Number(importResult.review_queue_properties || 0),
    existing_properties: Number(importResult.existing_properties || 0),
    duplicate_warning_count: Array.isArray(importResult.duplicate_warnings) ? importResult.duplicate_warnings.length : Number(importResult.duplicate_warning_count || 0),
    source_review_count: Array.isArray(importResult.source_review_records) ? importResult.source_review_records.length : Number(importResult.source_review_count || 0),
    suppressed_source_count: Number(importResult.suppressed_source_count || importResult.skipped_suppressed_count || 0),
    low_signal_source_location_count: Number(importResult.low_signal_source_location_count || 0),
    rate_limited_count: rateLimitedCount,
    auth_error_count: authErrorCount,
    billing_error_count: billingErrorCount,
    source_count: Number(x.source_count || 0),
    source_offset: Number(x.source_offset || 0),
    next_source_offset: Number(x.next_source_offset || 0),
    published_after: x.published_after || x.archive_start_time || '',
    fetch_reports: reports.map((report) => ({
      source_key: report.source_key,
      source_name: report.source_name,
      source_registry_offset: Number.isFinite(Number(report.source_registry_offset)) ? Number(report.source_registry_offset) : null,
      source_window_index: Number.isFinite(Number(report.source_window_index)) ? Number(report.source_window_index) : null,
      ok: report.ok === true,
      status: report.status || null,
      reason: report.reason || '',
      result_count: report.result_count || 0,
    })).slice(0, 12),
  };
}

async function resetMonthlyReadWindowIfNeeded(db, state) {
  const currentWindow = monthWindowStart();
  const stateWindow = new Date(state.monthly_window_started_at || 0);
  if (stateWindow && !Number.isNaN(stateWindow.getTime()) && stateWindow.getTime() === currentWindow.getTime()) {
    return state;
  }
  const result = await db.query(
    `UPDATE source_drip_state
     SET monthly_read_count = 0,
         monthly_window_started_at = $2,
         updated_at = NOW()
     WHERE drip_key = $1
     RETURNING *`,
    [X_SOURCE_DRIP_KEY, currentWindow.toISOString()]
  );
  return normalizeStateRow(result.rows[0]);
}

function nextBackoff({ summary, state }) {
  const jobCount = Math.max(1, summary.search_job_count || 0);
  const mostlyRateLimited = summary.rate_limited_count / jobCount >= 0.6;
  if (!mostlyRateLimited) {
    return {
      status: 'completed',
      interval: state.base_interval_minutes,
      consecutive: 0,
      reason: '',
    };
  }
  const consecutive = Number(state.consecutive_rate_limited_runs || 0) + 1;
  return {
    status: 'rate_limited',
    interval: Math.min(MAX_BACKOFF_MINUTES, Math.max(state.base_interval_minutes, state.current_interval_minutes) * 2),
    consecutive,
    reason: `rate_limited_${summary.rate_limited_count}_of_${jobCount}`,
  };
}

async function insertRunLog(db, payload = {}) {
  await db.query(
     `INSERT INTO source_drip_run_logs (
       drip_key, platform, source_offset, next_source_offset, source_count,
       batch_size, max_results, status, fetched_posts_count, discovered_posts_count,
       published_after,
       created_properties, review_queue_properties, existing_properties,
       duplicate_warning_count, source_review_count, suppressed_source_count,
       low_signal_source_location_count, rate_limited_count, auth_error_count,
       billing_error_count, api_read_count, elapsed_ms, result_summary
     )
     VALUES ($1,'x',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb)`,
    [
      X_SOURCE_DRIP_KEY,
      payload.source_offset || 0,
      payload.next_source_offset || 0,
      payload.source_count || 0,
      payload.batch_size || DEFAULT_BATCH_SIZE,
      payload.max_results || DEFAULT_MAX_RESULTS,
      payload.status || 'completed',
      payload.fetched_posts_count || 0,
      payload.discovered_posts_count || 0,
      payload.published_after || null,
      payload.created_properties || 0,
      payload.review_queue_properties || 0,
      payload.existing_properties || 0,
      payload.duplicate_warning_count || 0,
      payload.source_review_count || 0,
      payload.suppressed_source_count || 0,
      payload.low_signal_source_location_count || 0,
      payload.rate_limited_count || 0,
      payload.auth_error_count || 0,
      payload.billing_error_count || 0,
      payload.api_read_count || 0,
      payload.elapsed_ms || 0,
      JSON.stringify(payload.result_summary || {}),
    ]
  );
}

async function logDripNotification(db, summary = {}, status = 'logged', failureReason = '') {
  await logNotification(db, {
    channel: 'in_app',
    type: 'x_source_drip_run',
    status,
    payloadSummary: {
      marker: X_SOURCE_DRIP_MARKER,
      source_offset: summary.source_offset,
      next_source_offset: summary.next_source_offset,
      fetched_posts_count: summary.fetched_posts_count,
      discovered_posts_count: summary.discovered_posts_count,
      created_properties: summary.created_properties,
      review_queue_properties: summary.review_queue_properties,
      existing_properties: summary.existing_properties,
      api_read_count: summary.api_read_count,
      monthly_read_count: summary.monthly_read_count,
      monthly_read_cap: summary.monthly_read_cap,
      rate_limited_count: summary.rate_limited_count,
      auth_error_count: summary.auth_error_count,
      billing_error_count: summary.billing_error_count,
      published_after: summary.published_after,
    },
    failureReason: failureReason || null,
    sentAt: new Date(),
  });
}

async function runXSourceDripOnce(db, { force = false, actorId = 'system' } = {}) {
  await ensureXSourceDripState(db);
  const lock = await db.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [X_SOURCE_DRIP_KEY]);
  if (!lock.rows[0]?.locked) {
    return { ok: true, skipped: true, reason: 'x_source_drip_already_running' };
  }
  const started = Date.now();
  try {
    const stateResult = await db.query('SELECT * FROM source_drip_state WHERE drip_key = $1', [X_SOURCE_DRIP_KEY]);
    let state = normalizeStateRow(stateResult.rows[0]);
    const now = new Date();
    if (!force) {
      if (!state.enabled) return { ok: true, skipped: true, reason: 'x_source_drip_paused', state };
      if (state.next_run_at && new Date(state.next_run_at) > now) return { ok: true, skipped: true, reason: 'x_source_drip_not_due', state };
    }
    state = await resetMonthlyReadWindowIfNeeded(db, state);
    const sourceCount = xSourceCount();
    const offset = sourceCount ? state.cursor_offset % sourceCount : 0;
    const batchSize = numberInRange(state.batch_size, DEFAULT_BATCH_SIZE, 1, maxBatchSizeForMode(state.search_mode));
    const maxResults = numberInRange(state.max_results, DEFAULT_MAX_RESULTS, 10, 100);
    const plannedApiReads = sourceCount ? Math.min(batchSize, sourceCount) : 0;
    if (state.monthly_read_count + plannedApiReads > state.monthly_read_cap) {
      const capResult = {
        marker: X_SOURCE_DRIP_MARKER,
        fast_mode_marker: X_SOURCE_DRIP_FAST_MODE_MARKER,
        full_archive_pacing_marker: X_SOURCE_DRIP_FULL_ARCHIVE_PACING_MARKER,
        actor_id: actorId,
        status: 'blocked',
        reason: 'x_monthly_read_cap_reached',
        elapsed_ms: Date.now() - started,
        source_offset: offset,
        next_source_offset: offset,
        source_count: sourceCount,
        batch_size: batchSize,
        api_read_count: 0,
        planned_api_read_count: plannedApiReads,
        monthly_read_count: state.monthly_read_count,
        monthly_read_cap: state.monthly_read_cap,
      };
      await insertRunLog(db, {
        source_offset: offset,
        next_source_offset: offset,
        source_count: sourceCount,
        batch_size: batchSize,
        max_results: maxResults,
        status: 'blocked',
        api_read_count: 0,
        elapsed_ms: capResult.elapsed_ms,
        result_summary: capResult,
      });
      await db.query(
        `UPDATE source_drip_state
         SET enabled = FALSE,
             status = 'blocked',
             pause_reason = 'x_monthly_read_cap_reached',
             next_run_at = NULL,
             last_result = $2::jsonb,
             updated_at = NOW()
         WHERE drip_key = $1`,
        [X_SOURCE_DRIP_KEY, JSON.stringify(capResult)]
      );
      await logDripNotification(db, capResult, 'failed', 'x_monthly_read_cap_reached');
      return { ok: true, skipped: true, marker: X_SOURCE_DRIP_MARKER, full_archive_pacing_marker: X_SOURCE_DRIP_FULL_ARCHIVE_PACING_MARKER, reason: 'x_monthly_read_cap_reached', state: (await getXSourceDripStatus(db)).state, result: capResult };
    }
    await db.query(
      `UPDATE source_drip_state
       SET status = 'running', updated_at = NOW()
       WHERE drip_key = $1`,
      [X_SOURCE_DRIP_KEY]
    );
    const result = await runSocialPlatformPostSweep({
      db,
      platform: 'x',
      dryRun: false,
      maxSources: batchSize,
      sourceOffset: offset,
      maxResultsPerSource: maxResults,
      searchMode: state.search_mode || 'all',
      xPublishedAfter: state.published_after || DEFAULT_X_PUBLISHED_AFTER,
    });
    const summary = summarizeSweepResult(result);
    const elapsedMs = Date.now() - started;
    const sweepNextOffset = sourceCount ? (offset + batchSize) % sourceCount : offset + batchSize;
    const nextOffset = summary.rate_limited_count > 0
      ? firstRateLimitedSourceOffset(summary, offset)
      : Number(summary.next_source_offset || sweepNextOffset);
    const apiReadCount = Math.max(0, Number(summary.api_read_count || summary.search_job_count || 0) || 0);
    const monthlyReadCountAfter = state.monthly_read_count + apiReadCount;
    const hardStop = summary.billing_error_count > 0
      ? { status: 'blocked', reason: 'x_payment_required_or_credits_exhausted' }
      : summary.auth_error_count > 0
        ? { status: 'blocked', reason: 'x_auth_or_permission_error' }
        : null;
    const capReached = !hardStop && monthlyReadCountAfter >= state.monthly_read_cap;
    const backoff = hardStop || nextBackoff({ summary, state });
    const enabled = hardStop || capReached ? false : state.enabled === true;
    const nextRunAt = enabled ? addMinutes(now, backoff.interval).toISOString() : null;
    const lastResult = {
      marker: X_SOURCE_DRIP_MARKER,
      fast_mode_marker: X_SOURCE_DRIP_FAST_MODE_MARKER,
      full_archive_pacing_marker: X_SOURCE_DRIP_FULL_ARCHIVE_PACING_MARKER,
      actor_id: actorId,
      status: capReached ? 'blocked' : backoff.status,
      reason: capReached ? 'x_monthly_read_cap_reached' : backoff.reason,
      elapsed_ms: elapsedMs,
      api_read_count: apiReadCount,
      monthly_read_count: monthlyReadCountAfter,
      monthly_read_cap: state.monthly_read_cap,
      ...summary,
      next_source_offset: nextOffset,
      requeued_rate_limited_source_offset: summary.rate_limited_count > 0 ? nextOffset : null,
    };
    await insertRunLog(db, {
      ...summary,
      source_offset: offset,
      next_source_offset: nextOffset,
      source_count: sourceCount,
      batch_size: batchSize,
      max_results: maxResults,
      status: capReached ? 'blocked' : backoff.status,
      api_read_count: apiReadCount,
      elapsed_ms: elapsedMs,
      result_summary: lastResult,
    });
    await db.query(
      `UPDATE source_drip_state
       SET enabled = $2,
           cursor_offset = $3,
           source_count = $4,
           current_interval_minutes = $5,
           status = $6,
           pause_reason = $7,
           consecutive_rate_limited_runs = $8,
           last_run_at = NOW(),
           next_run_at = $9,
           last_result = $10::jsonb,
           monthly_read_count = COALESCE(monthly_read_count, 0) + $11,
           updated_at = NOW()
       WHERE drip_key = $1`,
      [
        X_SOURCE_DRIP_KEY,
        enabled,
        hardStop ? offset : nextOffset,
        sourceCount,
        backoff.interval || state.base_interval_minutes,
        capReached ? 'blocked' : backoff.status,
        hardStop ? backoff.reason : (capReached ? 'x_monthly_read_cap_reached' : null),
        hardStop || capReached ? state.consecutive_rate_limited_runs : backoff.consecutive,
        nextRunAt,
        JSON.stringify(lastResult),
        apiReadCount,
      ]
    );
    await logDripNotification(db, lastResult, hardStop || capReached ? 'failed' : 'logged', hardStop?.reason || (capReached ? 'x_monthly_read_cap_reached' : ''));
    return { ok: true, marker: X_SOURCE_DRIP_MARKER, full_archive_pacing_marker: X_SOURCE_DRIP_FULL_ARCHIVE_PACING_MARKER, state: (await getXSourceDripStatus(db)).state, result: lastResult };
  } catch (error) {
    const elapsedMs = Date.now() - started;
    const failure = {
      marker: X_SOURCE_DRIP_MARKER,
      full_archive_pacing_marker: X_SOURCE_DRIP_FULL_ARCHIVE_PACING_MARKER,
      status: 'error',
      reason: error.message || 'x_source_drip_failed',
      elapsed_ms: elapsedMs,
    };
    await insertRunLog(db, {
      status: 'error',
      elapsed_ms: elapsedMs,
      result_summary: failure,
    }).catch(() => {});
    await db.query(
      `UPDATE source_drip_state
       SET status = 'error',
           pause_reason = $2,
           last_result = $3::jsonb,
           next_run_at = NOW() + (current_interval_minutes * INTERVAL '1 minute'),
           updated_at = NOW()
       WHERE drip_key = $1`,
      [X_SOURCE_DRIP_KEY, failure.reason.slice(0, 240), JSON.stringify(failure)]
    ).catch(() => {});
    await logDripNotification(db, failure, 'failed', failure.reason).catch(() => {});
    return { ok: false, marker: X_SOURCE_DRIP_MARKER, full_archive_pacing_marker: X_SOURCE_DRIP_FULL_ARCHIVE_PACING_MARKER, error: failure.reason, result: failure };
  } finally {
    await db.query('SELECT pg_advisory_unlock(hashtext($1))', [X_SOURCE_DRIP_KEY]).catch(() => {});
  }
}

async function tickXSourceDripScheduler(db, actorId = 'x_source_drip_scheduler') {
  if (schedulerRunning) {
    schedulerLastResult = {
      ok: true,
      skipped: true,
      reason: 'x_source_drip_scheduler_already_running',
      at: new Date().toISOString(),
    };
    return schedulerLastResult;
  }
  schedulerRunning = true;
  schedulerLastTickAt = new Date().toISOString();
  try {
    schedulerLastResult = await runXSourceDripOnce(db, { force: false, actorId });
    return schedulerLastResult;
  } catch (error) {
    schedulerLastResult = {
      ok: false,
      error: error.message || 'x_source_drip_scheduler_tick_failed',
      at: new Date().toISOString(),
    };
    logger.warn('X source drip scheduler tick failed', error.message);
    return schedulerLastResult;
  } finally {
    schedulerRunning = false;
  }
}

function startXSourceDripScheduler(db) {
  if (schedulerTimer || schedulerDisabledByEnv()) {
    return;
  }
  schedulerArmedAt = new Date().toISOString();
  schedulerTimer = setInterval(() => {
    tickXSourceDripScheduler(db).catch((error) => {
      logger.warn('X source drip scheduler interval failed', error.message);
    });
  }, SCHEDULER_POLL_MS);
  setTimeout(() => {
    tickXSourceDripScheduler(db, 'x_source_drip_scheduler_boot').catch((error) => {
      logger.warn('X source drip scheduler boot tick failed', error.message);
    });
  }, 5000);
  logger.info('X source drip scheduler armed');
}

module.exports = {
  X_SOURCE_DRIP_MARKER,
  X_SOURCE_DRIP_FAST_MODE_MARKER,
  X_SOURCE_DRIP_FULL_ARCHIVE_PACING_MARKER,
  X_SOURCE_DRIP_KEY,
  firstRateLimitedSourceOffset,
  maxBatchSizeForMode,
  ensureXSourceDripState,
  getXSourceDripStatus,
  updateXSourceDripConfig,
  startXSourceDrip,
  pauseXSourceDrip,
  runXSourceDripOnce,
  startXSourceDripScheduler,
  schedulerStatus,
  tickXSourceDripScheduler,
  summarizeSweepResult,
};
