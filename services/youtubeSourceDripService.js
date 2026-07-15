'use strict';

const logger = require('../config/logger');
const { getPropertySourceRegistry } = require('./propertySourceRegistryService');
const {
  runSocialPlatformPostSweep,
  youtubeSearchQuotaExceededFromReports,
} = require('./socialPlatformPostDiscoveryService');
const { logNotification } = require('./notificationLogService');

const YOUTUBE_DRIP_MARKER = 'youtube-drip-20260715';
const YOUTUBE_SOURCE_DRIP_KEY = 'youtube_source_drip';
const BASE_INTERVAL_MINUTES = 10;
const MAX_BACKOFF_MINUTES = 360;
const MAX_BATCH_SIZE = 5;
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_MAX_RESULTS = 10;
const DEFAULT_PUBLISHED_AFTER = '2026-06-01T00:00:00.000Z';
const DEFAULT_JOB_MODE = 'all';
const TARGET_REVIEWABLE = 3000;
const DEFAULT_MONTHLY_READ_CAP = 10000;
const SCHEDULER_POLL_MS = 60 * 1000;

let schedulerTimer = null;
let schedulerRunning = false;
let schedulerArmedAt = null;
let schedulerLastTickAt = null;
let schedulerLastResult = null;

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

function normalizeIsoDate(value, fallback = DEFAULT_PUBLISHED_AFTER) {
  const raw = String(value || '').trim();
  const parsed = raw ? new Date(raw) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return fallback;
}

function normalizeJobMode(value, fallback = DEFAULT_JOB_MODE) {
  const normalized = String(value || fallback || DEFAULT_JOB_MODE)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (['channel', 'channels', 'channel_upload', 'channel_uploads', 'uploads', 'known_channels'].includes(normalized)) return 'channel_uploads';
  if (['search', 'broad_search', 'hashtag_search', 'hashtags'].includes(normalized)) return 'search';
  return 'all';
}

function monthWindowStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function normalizeMonthWindow(value) {
  const parsed = value ? new Date(value) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return monthWindowStart().toISOString();
}

function youtubeSourceCount() {
  return getPropertySourceRegistry().filter((source) => String(source.platform || '').toLowerCase() === 'youtube').length;
}

function schedulerDisabledByEnv() {
  return String(process.env.YOUTUBE_DRIP_SCHEDULER_ENABLED || process.env.YOUTUBE_SOURCE_DRIP_SCHEDULER_ENABLED || 'true').toLowerCase() === 'false';
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

function normalizeStateRow(row = {}) {
  const sourceCount = Number(row.source_count || 0) || youtubeSourceCount();
  const offset = numberInRange(row.cursor_offset, 0, 0, Math.max(sourceCount - 1, 0));
  const monthlyReadCap = numberInRange(row.monthly_read_cap, DEFAULT_MONTHLY_READ_CAP, 1, 10000000);
  const monthlyReadCount = Math.max(0, Number(row.monthly_read_count || 0) || 0);
  return {
    drip_key: row.drip_key || YOUTUBE_SOURCE_DRIP_KEY,
    platform: 'youtube',
    enabled: row.enabled === true,
    cursor_offset: offset,
    source_count: sourceCount,
    percent_crawled: sourceCount ? Number(((offset / sourceCount) * 100).toFixed(2)) : 0,
    base_interval_minutes: numberInRange(row.base_interval_minutes, BASE_INTERVAL_MINUTES, 1, 1440),
    current_interval_minutes: numberInRange(row.current_interval_minutes, BASE_INTERVAL_MINUTES, 1, 1440),
    batch_size: numberInRange(row.batch_size, DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE),
    max_results: numberInRange(row.max_results, DEFAULT_MAX_RESULTS, 1, 50),
    job_mode: normalizeJobMode(row.search_mode),
    search_mode: normalizeJobMode(row.search_mode),
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

async function ensureYouTubeSourceDripState(db) {
  const sourceCount = youtubeSourceCount();
  const baseInterval = numberInRange(process.env.YOUTUBE_DRIP_BASE_INTERVAL_MINUTES || process.env.YOUTUBE_SOURCE_DRIP_BASE_INTERVAL_MINUTES, BASE_INTERVAL_MINUTES, 1, 1440);
  const jobMode = normalizeJobMode(process.env.YOUTUBE_DRIP_JOB_MODE || process.env.YOUTUBE_SOURCE_DRIP_JOB_MODE);
  const batchSize = numberInRange(process.env.YOUTUBE_DRIP_BATCH_SIZE || process.env.YOUTUBE_SOURCE_DRIP_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
  const maxResults = numberInRange(process.env.YOUTUBE_DRIP_MAX_RESULTS || process.env.YOUTUBE_SOURCE_DRIP_MAX_RESULTS, DEFAULT_MAX_RESULTS, 1, 50);
  const publishedAfter = normalizeIsoDate(process.env.YOUTUBE_DRIP_PUBLISHED_AFTER || process.env.YOUTUBE_SOURCE_DRIP_PUBLISHED_AFTER);
  const monthlyReadCap = numberInRange(process.env.YOUTUBE_DRIP_MONTHLY_READ_CAP || process.env.YOUTUBE_SOURCE_DRIP_MONTHLY_READ_CAP, DEFAULT_MONTHLY_READ_CAP, 1, 10000000);
  await db.query(
    `INSERT INTO source_drip_state (
       drip_key, platform, enabled, cursor_offset, source_count,
       base_interval_minutes, current_interval_minutes, batch_size, max_results,
       search_mode, published_after, target_reviewable, monthly_read_cap, status, next_run_at
     )
     VALUES ($1,'youtube',FALSE,0,$2,$3,$3,$4,$5,$6,$7,$8,$9,'paused',NULL)
     ON CONFLICT (drip_key) DO UPDATE
       SET platform = 'youtube',
           source_count = EXCLUDED.source_count,
           batch_size = LEAST(source_drip_state.batch_size, 5),
           monthly_read_cap = COALESCE(source_drip_state.monthly_read_cap, EXCLUDED.monthly_read_cap),
           updated_at = NOW()
     RETURNING *`,
    [YOUTUBE_SOURCE_DRIP_KEY, sourceCount, baseInterval, batchSize, maxResults, jobMode, publishedAfter, TARGET_REVIEWABLE, monthlyReadCap]
  );
}

async function getYouTubeSourceDripStatus(db, { limit = 12 } = {}) {
  await ensureYouTubeSourceDripState(db);
  const stateResult = await db.query('SELECT * FROM source_drip_state WHERE drip_key = $1', [YOUTUBE_SOURCE_DRIP_KEY]);
  const runs = await db.query(
    `SELECT *
     FROM source_drip_run_logs
     WHERE drip_key = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [YOUTUBE_SOURCE_DRIP_KEY, numberInRange(limit, 12, 1, 50)]
  );
  const counts = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE LOWER(COALESCE(status,'')) IN ('approved','live','published'))::int AS live_count,
       COUNT(*) FILTER (WHERE LOWER(COALESCE(status,'')) IN ('pending','submitted') OR LOWER(COALESCE(moderation_stage,'')) IN ('submitted','review_queue','pending_review'))::int AS reviewable_count
     FROM properties
     WHERE source = 'found_online_property_source_v1'
        OR listed_via = 'found_online'
        OR LOWER(COALESCE(extra_fields->>'source_platform','')) = 'youtube'
        OR COALESCE(extra_fields->>'youtube_url','') <> ''`,
  );
  return {
    marker: YOUTUBE_DRIP_MARKER,
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

async function updateYouTubeSourceDripConfig(db, input = {}) {
  await ensureYouTubeSourceDripState(db);
  const current = await getYouTubeSourceDripStatus(db);
  const state = current.state;
  const sourceCount = youtubeSourceCount();
  const jobMode = normalizeJobMode(input.youtube_job_mode || input.youtubeJobMode || input.job_mode || input.jobMode || input.search_mode || input.searchMode || state.job_mode);
  const batchSize = numberInRange(input.batch_size ?? input.batchSize ?? state.batch_size, state.batch_size, 1, MAX_BATCH_SIZE);
  const baseInterval = numberInRange(input.interval_minutes ?? input.intervalMinutes ?? input.base_interval_minutes ?? state.base_interval_minutes, state.base_interval_minutes, 1, 1440);
  const maxResults = numberInRange(input.max_results ?? input.maxResults ?? state.max_results, state.max_results, 1, 50);
  const cursorOffset = numberInRange(input.cursor_offset ?? input.cursorOffset ?? state.cursor_offset, state.cursor_offset, 0, Math.max(sourceCount - 1, 0));
  const publishedAfter = normalizeIsoDate(input.published_after ?? input.publishedAfter ?? input.youtube_published_after ?? input.youtubePublishedAfter ?? state.published_after, state.published_after);
  const target = numberInRange(input.target_reviewable ?? input.targetReviewable ?? state.target_reviewable, state.target_reviewable, 1, 1000000);
  const monthlyReadCap = numberInRange(input.monthly_read_cap ?? input.monthlyReadCap ?? state.monthly_read_cap, state.monthly_read_cap || DEFAULT_MONTHLY_READ_CAP, 1, 10000000);
  const enabled = input.enabled == null ? state.enabled : boolLike(input.enabled, state.enabled);
  const nextRunAt = enabled ? addMinutes(new Date(), baseInterval).toISOString() : null;
  const result = await db.query(
    `UPDATE source_drip_state
     SET platform = 'youtube',
         enabled = $2,
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
    [YOUTUBE_SOURCE_DRIP_KEY, enabled, cursorOffset, sourceCount, baseInterval, batchSize, maxResults, jobMode, publishedAfter, target, monthlyReadCap, nextRunAt]
  );
  return normalizeStateRow(result.rows[0]);
}

async function startYouTubeSourceDrip(db, input = {}) {
  await updateYouTubeSourceDripConfig(db, { ...input, enabled: true });
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
    [YOUTUBE_SOURCE_DRIP_KEY]
  );
  return normalizeStateRow(result.rows[0]);
}

async function pauseYouTubeSourceDrip(db, reason = 'paused_by_admin') {
  await ensureYouTubeSourceDripState(db);
  const result = await db.query(
    `UPDATE source_drip_state
     SET enabled = FALSE,
         status = 'paused',
         pause_reason = $2,
         next_run_at = NULL,
         updated_at = NOW()
     WHERE drip_key = $1
     RETURNING *`,
    [YOUTUBE_SOURCE_DRIP_KEY, String(reason || 'paused_by_admin').slice(0, 240)]
  );
  return normalizeStateRow(result.rows[0]);
}

function reportStatus(report = {}) {
  return Number(report.status || report.statusCode || 0);
}

function reportText(report = {}) {
  return String(`${report.reason || ''} ${report.error_reason || ''}`).toLowerCase();
}

function isQuotaLimitedReport(report = {}) {
  const status = reportStatus(report);
  return [403, 429].includes(status) && /quota|rate|daily limit|search queries|limit exceeded|too many/i.test(reportText(report));
}

function firstQuotaLimitedSourceOffset(summary = {}, fallbackOffset = 0) {
  const reports = Array.isArray(summary.fetch_reports) ? summary.fetch_reports : [];
  const quotaLimited = reports.find((report) => isQuotaLimitedReport(report));
  const offset = Number(quotaLimited?.source_registry_offset);
  return Number.isFinite(offset) && offset >= 0 ? offset : fallbackOffset;
}

function summarizeYouTubeDripSweepResult(result = {}) {
  const youtube = result.youtube || {};
  const reports = Array.isArray(youtube.fetch_reports) ? youtube.fetch_reports : [];
  const importResult = result.import_result || {};
  const quotaLimitedCount = reports.filter((report) => isQuotaLimitedReport(report)).length;
  const authErrorCount = reports.filter((report) => {
    const status = reportStatus(report);
    return status === 401 || (status === 403 && !isQuotaLimitedReport(report));
  }).length;
  return {
    search_job_count: Number(youtube.search_job_count || reports.length || 0),
    api_read_count: Number(youtube.search_job_count || reports.length || 0),
    fetched_posts_count: Number(youtube.fetched_posts_count || 0),
    discovered_posts_count: Number(result.discovered_posts_count || 0),
    created_properties: Number(importResult.created_properties || 0),
    review_queue_properties: Number(importResult.review_queue_properties || 0),
    existing_properties: Number(importResult.existing_properties || 0),
    duplicate_warning_count: Array.isArray(importResult.duplicate_warnings) ? importResult.duplicate_warnings.length : Number(importResult.duplicate_warning_count || 0),
    source_review_count: Array.isArray(importResult.source_review_records) ? importResult.source_review_records.length : Number(importResult.source_review_count || 0),
    suppressed_source_count: Number(importResult.suppressed_source_count || importResult.skipped_suppressed_count || 0),
    low_signal_source_location_count: Number(importResult.low_signal_source_location_count || 0),
    quota_limited_count: quotaLimitedCount,
    rate_limited_count: quotaLimitedCount,
    auth_error_count: authErrorCount,
    billing_error_count: 0,
    source_count: Number(youtube.source_count || 0),
    source_offset: Number(youtube.source_offset || 0),
    next_source_offset: Number(youtube.next_source_offset || 0),
    published_after: youtube.published_after || '',
    fetch_reports: reports.map((report) => ({
      source_key: report.source_key,
      source_name: report.source_name,
      source_registry_offset: Number.isFinite(Number(report.source_registry_offset)) ? Number(report.source_registry_offset) : null,
      source_window_index: Number.isFinite(Number(report.source_window_index)) ? Number(report.source_window_index) : null,
      search_method: report.search_method || '',
      ok: report.ok === true,
      status: report.status || null,
      reason: report.reason || '',
      error_reason: report.error_reason || '',
      result_count: report.result_count || 0,
      normalized_post_count: report.normalized_post_count || 0,
    })).slice(0, 12),
  };
}

async function resetMonthlyReadWindowIfNeeded(db, state) {
  const currentWindow = monthWindowStart();
  const stateWindow = new Date(state.monthly_window_started_at || 0);
  if (stateWindow && !Number.isNaN(stateWindow.getTime()) && stateWindow.getTime() === currentWindow.getTime()) return state;
  const result = await db.query(
    `UPDATE source_drip_state
     SET monthly_read_count = 0,
         monthly_window_started_at = $2,
         updated_at = NOW()
     WHERE drip_key = $1
     RETURNING *`,
    [YOUTUBE_SOURCE_DRIP_KEY, currentWindow.toISOString()]
  );
  return normalizeStateRow(result.rows[0]);
}

function nextBackoff({ summary, state }) {
  const jobCount = Math.max(1, summary.search_job_count || 0);
  const mostlyQuotaLimited = summary.quota_limited_count / jobCount >= 0.6;
  if (!mostlyQuotaLimited) {
    return { status: 'completed', interval: state.base_interval_minutes, consecutive: 0, reason: '' };
  }
  const consecutive = Number(state.consecutive_rate_limited_runs || 0) + 1;
  return {
    status: 'rate_limited',
    interval: Math.min(MAX_BACKOFF_MINUTES, Math.max(state.base_interval_minutes, state.current_interval_minutes) * 2),
    consecutive,
    reason: `youtube_quota_limited_${summary.quota_limited_count}_of_${jobCount}`,
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
     VALUES ($1,'youtube',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb)`,
    [
      YOUTUBE_SOURCE_DRIP_KEY,
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
    type: 'youtube_source_drip_run',
    status,
    payloadSummary: {
      marker: YOUTUBE_DRIP_MARKER,
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
      quota_limited_count: summary.quota_limited_count,
      auth_error_count: summary.auth_error_count,
      published_after: summary.published_after,
    },
    failureReason: failureReason || null,
    sentAt: new Date(),
  });
}

async function runYouTubeSourceDripOnce(db, { force = false, actorId = 'system' } = {}) {
  await ensureYouTubeSourceDripState(db);
  const lock = await db.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [YOUTUBE_SOURCE_DRIP_KEY]);
  if (!lock.rows[0]?.locked) {
    return { ok: true, skipped: true, reason: 'youtube_source_drip_already_running' };
  }
  const started = Date.now();
  try {
    const stateResult = await db.query('SELECT * FROM source_drip_state WHERE drip_key = $1', [YOUTUBE_SOURCE_DRIP_KEY]);
    let state = normalizeStateRow(stateResult.rows[0]);
    const now = new Date();
    if (!force) {
      if (!state.enabled) return { ok: true, skipped: true, reason: 'youtube_source_drip_paused', state };
      if (state.next_run_at && new Date(state.next_run_at) > now) return { ok: true, skipped: true, reason: 'youtube_source_drip_not_due', state };
    }
    state = await resetMonthlyReadWindowIfNeeded(db, state);
    const sourceCount = youtubeSourceCount();
    const offset = sourceCount ? state.cursor_offset % sourceCount : 0;
    const batchSize = numberInRange(state.batch_size, DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE);
    const maxResults = numberInRange(state.max_results, DEFAULT_MAX_RESULTS, 1, 50);
    const plannedApiReads = sourceCount ? Math.min(batchSize, sourceCount) : 0;
    if (state.monthly_read_count + plannedApiReads > state.monthly_read_cap) {
      const capResult = {
        marker: YOUTUBE_DRIP_MARKER,
        actor_id: actorId,
        status: 'blocked',
        reason: 'youtube_monthly_read_cap_reached',
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
             pause_reason = 'youtube_monthly_read_cap_reached',
             next_run_at = NULL,
             last_result = $2::jsonb,
             updated_at = NOW()
         WHERE drip_key = $1`,
        [YOUTUBE_SOURCE_DRIP_KEY, JSON.stringify(capResult)]
      );
      await logDripNotification(db, capResult, 'failed', 'youtube_monthly_read_cap_reached');
      return { ok: true, skipped: true, marker: YOUTUBE_DRIP_MARKER, reason: 'youtube_monthly_read_cap_reached', state: (await getYouTubeSourceDripStatus(db)).state, result: capResult };
    }
    await db.query(
      `UPDATE source_drip_state
       SET status = 'running', updated_at = NOW()
       WHERE drip_key = $1`,
      [YOUTUBE_SOURCE_DRIP_KEY]
    );
    const result = await runSocialPlatformPostSweep({
      db,
      platform: 'youtube',
      dryRun: false,
      maxSources: batchSize,
      sourceOffset: offset,
      maxResultsPerSource: maxResults,
      maxPagesPerSource: 1,
      youtubeJobMode: state.job_mode || 'all',
      youtubePublishedAfter: state.published_after || DEFAULT_PUBLISHED_AFTER,
      fetchX: false,
      fetchYouTube: true,
      timeBudgetMs: 45000,
    });
    const summary = summarizeYouTubeDripSweepResult(result);
    const elapsedMs = Date.now() - started;
    const sweepNextOffset = sourceCount ? (offset + batchSize) % sourceCount : offset + batchSize;
    const nextOffset = summary.quota_limited_count > 0
      ? firstQuotaLimitedSourceOffset(summary, offset)
      : Number(summary.next_source_offset || sweepNextOffset);
    const apiReadCount = Math.max(0, Number(summary.api_read_count || summary.search_job_count || 0) || 0);
    const monthlyReadCountAfter = state.monthly_read_count + apiReadCount;
    const hardStop = summary.auth_error_count > 0
      ? { status: 'blocked', reason: 'youtube_auth_or_quota_permission_error' }
      : youtubeSearchQuotaExceededFromReports(summary.fetch_reports) && summary.quota_limited_count >= Math.max(1, summary.search_job_count)
        ? { status: 'rate_limited', reason: 'youtube_quota_exhausted' }
        : null;
    const capReached = !hardStop && monthlyReadCountAfter >= state.monthly_read_cap;
    const backoff = hardStop || nextBackoff({ summary, state });
    const enabled = hardStop?.status === 'blocked' || capReached ? false : state.enabled === true;
    const nextRunAt = enabled ? addMinutes(now, backoff.interval || state.base_interval_minutes).toISOString() : null;
    const lastResult = {
      marker: YOUTUBE_DRIP_MARKER,
      actor_id: actorId,
      status: capReached ? 'blocked' : backoff.status,
      reason: capReached ? 'youtube_monthly_read_cap_reached' : backoff.reason,
      elapsed_ms: elapsedMs,
      api_read_count: apiReadCount,
      monthly_read_count: monthlyReadCountAfter,
      monthly_read_cap: state.monthly_read_cap,
      ...summary,
      next_source_offset: nextOffset,
      requeued_quota_limited_source_offset: summary.quota_limited_count > 0 ? nextOffset : null,
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
        YOUTUBE_SOURCE_DRIP_KEY,
        enabled,
        hardStop?.status === 'blocked' ? offset : nextOffset,
        sourceCount,
        backoff.interval || state.base_interval_minutes,
        capReached ? 'blocked' : backoff.status,
        hardStop?.status === 'blocked' ? backoff.reason : (capReached ? 'youtube_monthly_read_cap_reached' : null),
        hardStop || capReached ? state.consecutive_rate_limited_runs : backoff.consecutive,
        nextRunAt,
        JSON.stringify(lastResult),
        apiReadCount,
      ]
    );
    await logDripNotification(db, lastResult, hardStop?.status === 'blocked' || capReached ? 'failed' : 'logged', hardStop?.status === 'blocked' ? hardStop.reason : (capReached ? 'youtube_monthly_read_cap_reached' : ''));
    return { ok: true, marker: YOUTUBE_DRIP_MARKER, state: (await getYouTubeSourceDripStatus(db)).state, result: lastResult };
  } catch (error) {
    const elapsedMs = Date.now() - started;
    const failure = {
      marker: YOUTUBE_DRIP_MARKER,
      status: 'error',
      reason: error.message || 'youtube_source_drip_failed',
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
      [YOUTUBE_SOURCE_DRIP_KEY, failure.reason.slice(0, 240), JSON.stringify(failure)]
    ).catch(() => {});
    await logDripNotification(db, failure, 'failed', failure.reason).catch(() => {});
    return { ok: false, marker: YOUTUBE_DRIP_MARKER, error: failure.reason, result: failure };
  } finally {
    await db.query('SELECT pg_advisory_unlock(hashtext($1))', [YOUTUBE_SOURCE_DRIP_KEY]).catch(() => {});
  }
}

async function tickYouTubeSourceDripScheduler(db, actorId = 'youtube_source_drip_scheduler') {
  if (schedulerRunning) {
    schedulerLastResult = {
      ok: true,
      skipped: true,
      reason: 'youtube_source_drip_scheduler_already_running',
      at: new Date().toISOString(),
    };
    return schedulerLastResult;
  }
  schedulerRunning = true;
  schedulerLastTickAt = new Date().toISOString();
  try {
    schedulerLastResult = await runYouTubeSourceDripOnce(db, { force: false, actorId });
    return schedulerLastResult;
  } catch (error) {
    schedulerLastResult = {
      ok: false,
      error: error.message || 'youtube_source_drip_scheduler_tick_failed',
      at: new Date().toISOString(),
    };
    logger.warn('YouTube source drip scheduler tick failed', error.message);
    return schedulerLastResult;
  } finally {
    schedulerRunning = false;
  }
}

function startYouTubeSourceDripScheduler(db) {
  if (schedulerTimer || schedulerDisabledByEnv()) return;
  schedulerArmedAt = new Date().toISOString();
  schedulerTimer = setInterval(() => {
    tickYouTubeSourceDripScheduler(db).catch((error) => {
      logger.warn('YouTube source drip scheduler interval failed', error.message);
    });
  }, SCHEDULER_POLL_MS);
  setTimeout(() => {
    tickYouTubeSourceDripScheduler(db, 'youtube_source_drip_scheduler_boot').catch((error) => {
      logger.warn('YouTube source drip scheduler boot tick failed', error.message);
    });
  }, 5000);
  logger.info('YouTube source drip scheduler armed');
}

module.exports = {
  YOUTUBE_DRIP_MARKER,
  YOUTUBE_SOURCE_DRIP_KEY,
  firstQuotaLimitedSourceOffset,
  ensureYouTubeSourceDripState,
  getYouTubeSourceDripStatus,
  updateYouTubeSourceDripConfig,
  startYouTubeSourceDrip,
  pauseYouTubeSourceDrip,
  runYouTubeSourceDripOnce,
  startYouTubeSourceDripScheduler,
  schedulerStatus,
  tickYouTubeSourceDripScheduler,
  summarizeYouTubeDripSweepResult,
};
