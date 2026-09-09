'use strict';

const { getPropertySourceRegistry, sourceRecordKind } = require('./propertySourceRegistryService');
const {
  buildYouTubeSearchJobs,
  fetchYouTubePostsForJobs,
  YOUTUBE_API_KEY_ENV_NAMES,
} = require('./socialPlatformPostDiscoveryService');
const { queueFoundOnlineSourcePostListings } = require('./socialSearchSourcedListingsService');
const { recordHarvestImportResult } = require('./propertyHarvestMonitoringService');

const SOURCE_COVERAGE_MARKER = 'source-coverage-manifest-20260909';
const DEFAULT_SECTION_SIZE = 500;
const DEFAULT_CLAIM_SIZE = 25;
const MAX_CLAIM_SIZE = 25;
const MANIFEST_INSERT_BATCH_SIZE = 250;
const TERMINAL_ITEM_STATUSES = new Set(['completed', 'checked_empty', 'blocked', 'duplicate_source']);
const COVERAGE_PLATFORMS = new Set(['tiktok', 'youtube', 'x']);

function clean(value = '') {
  return String(value || '').trim();
}

function cappedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
}

function normalizeCoveragePlatforms(value = 'tiktok,youtube') {
  const raw = Array.isArray(value) ? value : clean(value).split(',');
  const normalized = raw
    .map((item) => clean(item).toLowerCase())
    .flatMap((item) => item === 'all' ? [...COVERAGE_PLATFORMS] : [item])
    .filter((item) => COVERAGE_PLATFORMS.has(item));
  return [...new Set(normalized.length ? normalized : ['tiktok', 'youtube'])].sort();
}

function normalizedSourceUrl(value = '') {
  const raw = clean(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid|gclid|ref|share_)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch (_) {
    return raw.replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
  }
}

function canonicalSourceKey(source = {}) {
  const platform = clean(source.platform).toLowerCase() || 'unknown';
  const url = normalizedSourceUrl(source.url || source.source_url);
  if (url) return `${platform}:${url}`;
  const hashtag = (source.hashtags || [])[0] || source.handle || source.key || source.source_key || '';
  return `${platform}:${clean(hashtag).replace(/^#/, '').toLowerCase()}`;
}

function sourceSnapshot(source = {}) {
  return {
    key: clean(source.key || source.source_key),
    name: clean(source.name || source.source_name),
    platform: clean(source.platform).toLowerCase(),
    sourceType: clean(source.sourceType || source.source_type),
    source_record_kind: source.source_record_kind || sourceRecordKind(source),
    url: clean(source.url || source.source_url),
    handle: clean(source.handle),
    phone: clean(source.phone || source.contact_phone),
    phoneAlt: clean(source.phoneAlt || source.contact_phone_alt),
    email: clean(source.email || source.contact_email),
    listingTypes: source.listingTypes || source.listing_types || [],
    hashtags: source.hashtags || [],
    status: clean(source.status || 'active'),
    trustLevel: clean(source.trustLevel || source.trust_level),
    consentStatus: clean(source.consentStatus || source.consent_status),
    canContactDirectly: source.canContactDirectly === true || source.can_contact_directly === true,
    metadata: source.metadata && typeof source.metadata === 'object' ? source.metadata : {},
  };
}

function buildCoverageManifestRows(sources = [], {
  platforms = ['tiktok', 'youtube'],
  sectionSize = DEFAULT_SECTION_SIZE,
} = {}) {
  const allowedPlatforms = new Set(normalizeCoveragePlatforms(platforms));
  const boundedSectionSize = cappedInteger(sectionSize, DEFAULT_SECTION_SIZE, 25, 2000);
  const selected = sources
    .map(sourceSnapshot)
    .filter((source) => allowedPlatforms.has(source.platform))
    .filter((source) => ['active', 'candidate'].includes(source.status));
  const firstSequenceByCanonicalKey = new Map();
  const platformOffsets = new Map();
  return selected.map((source, index) => {
    const sequenceNumber = index + 1;
    const canonicalKey = canonicalSourceKey(source);
    const primarySequence = firstSequenceByCanonicalKey.get(canonicalKey);
    if (!primarySequence) firstSequenceByCanonicalKey.set(canonicalKey, sequenceNumber);
    const sourceOffset = platformOffsets.get(source.platform) || 0;
    platformOffsets.set(source.platform, sourceOffset + 1);
    return {
      source_key: source.key || `${source.platform}-source-${sequenceNumber}`,
      canonical_source_key: canonicalKey,
      source_name: source.name,
      platform: source.platform,
      source_type: source.sourceType,
      source_url: source.url,
      source_offset: sourceOffset,
      sequence_number: sequenceNumber,
      section_number: Math.floor(sourceOffset / boundedSectionSize) + 1,
      status: primarySequence ? 'duplicate_source' : 'pending',
      metadata: {
        marker: SOURCE_COVERAGE_MARKER,
        source_snapshot: source,
        duplicate_of_sequence: primarySequence || null,
      },
    };
  });
}

async function insertManifestBatch(client, runId, rows = []) {
  if (!rows.length) return;
  const values = [];
  const placeholders = rows.map((row, index) => {
    const offset = index * 12;
    values.push(
      runId,
      row.source_key,
      row.canonical_source_key,
      row.source_name || null,
      row.platform,
      row.source_type || null,
      row.source_url,
      row.source_offset,
      row.sequence_number,
      row.section_number,
      row.status,
      JSON.stringify(row.metadata || {})
    );
    return `($${offset + 1}::uuid,$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8}::int,$${offset + 9}::int,$${offset + 10}::int,$${offset + 11},$${offset + 12}::jsonb)`;
  });
  await client.query(
    `INSERT INTO source_coverage_items (
       run_id, source_key, canonical_source_key, source_name, platform,
       source_type, source_url, source_offset, sequence_number, section_number,
       status, metadata
     ) VALUES ${placeholders.join(',')}
     ON CONFLICT (run_id, sequence_number) DO NOTHING`,
    values
  );
}

async function createSourceCoverageRun({
  db,
  platforms = ['tiktok', 'youtube'],
  lookbackDays = 30,
  sectionSize = DEFAULT_SECTION_SIZE,
  createdBy = '',
  registrySources,
  reuseActive = true,
} = {}) {
  if (!db?.pool?.connect) throw new Error('db.pool.connect is required');
  const platformScope = normalizeCoveragePlatforms(platforms);
  const boundedLookback = cappedInteger(lookbackDays, 30, 1, 366);
  const boundedSectionSize = cappedInteger(sectionSize, DEFAULT_SECTION_SIZE, 25, 2000);
  const sources = registrySources || getPropertySourceRegistry();
  const rows = buildCoverageManifestRows(sources, { platforms: platformScope, sectionSize: boundedSectionSize });
  const canonicalCount = rows.filter((row) => row.status !== 'duplicate_source').length;
  const sectionCount = new Set(rows.map((row) => `${row.platform}:${row.section_number}`)).size;
  const client = await db.pool.connect();
  let runId = '';
  let reusedExistingRun = false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`source-coverage:${platformScope.join(',')}`]);
    if (reuseActive) {
      const active = await client.query(
        `SELECT id::text
         FROM source_coverage_runs
         WHERE status IN ('queued','running','paused')
           AND platform_scope = $1::text[]
         ORDER BY created_at DESC
         LIMIT 1`,
        [platformScope]
      );
      if (active.rows[0]) {
        runId = active.rows[0].id;
        reusedExistingRun = true;
        await client.query('COMMIT');
      }
    }
    if (!runId) {
      const inserted = await client.query(
        `INSERT INTO source_coverage_runs (
           platform_scope, lookback_days, section_size, status,
           source_record_count, canonical_source_count, section_count,
           counters, configuration, created_by
         ) VALUES ($1::text[],$2,$3,'queued',$4,$5,$6,$7::jsonb,$8::jsonb,$9)
         RETURNING id::text`,
        [
          platformScope,
          boundedLookback,
          boundedSectionSize,
          rows.length,
          canonicalCount,
          sectionCount,
          JSON.stringify({ pending: canonicalCount, duplicate_source: rows.length - canonicalCount, remaining: canonicalCount }),
          JSON.stringify({ marker: SOURCE_COVERAGE_MARKER, review_only: true, auto_publish: false }),
          clean(createdBy) || null,
        ]
      );
      runId = inserted.rows[0].id;
      for (let index = 0; index < rows.length; index += MANIFEST_INSERT_BATCH_SIZE) {
        await insertManifestBatch(client, runId, rows.slice(index, index + MANIFEST_INSERT_BATCH_SIZE));
      }
      await client.query('COMMIT');
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const run = await getSourceCoverageRun(db, runId);
  return { ...run, reused_existing_run: reusedExistingRun };
}

function publicCoverageRun(run = {}, statusCounts = {}, sections = []) {
  const sourceCount = Number(run.source_record_count || 0);
  const terminalCount = [...TERMINAL_ITEM_STATUSES].reduce((sum, status) => sum + Number(statusCounts[status] || 0), 0);
  const checkedCount = ['completed', 'checked_empty', 'duplicate_source']
    .reduce((sum, status) => sum + Number(statusCounts[status] || 0), 0);
  return {
    id: run.id,
    marker: SOURCE_COVERAGE_MARKER,
    platform_scope: run.platform_scope || [],
    lookback_days: Number(run.lookback_days || 30),
    section_size: Number(run.section_size || DEFAULT_SECTION_SIZE),
    status: run.status,
    source_record_count: sourceCount,
    canonical_source_count: Number(run.canonical_source_count || 0),
    section_count: Number(run.section_count || 0),
    checked_count: checkedCount,
    resolved_count: terminalCount,
    blocked_count: Number(statusCounts.blocked || 0),
    remaining_count: Math.max(0, sourceCount - terminalCount),
    counters: { ...(run.counters || {}), ...statusCounts },
    sections,
    configuration: run.configuration || {},
    started_at: run.started_at,
    heartbeat_at: run.heartbeat_at,
    finished_at: run.finished_at,
    created_at: run.created_at,
    updated_at: run.updated_at,
  };
}

async function getSourceCoverageRun(db, runId) {
  if (!db?.query) throw new Error('db.query is required');
  const [runResult, statusResult, sectionResult] = await Promise.all([
    db.query('SELECT *, id::text AS id FROM source_coverage_runs WHERE id = $1::uuid LIMIT 1', [runId]),
    db.query('SELECT status, COUNT(*)::int AS count FROM source_coverage_items WHERE run_id = $1::uuid GROUP BY status', [runId]),
    db.query(
      `SELECT section_number,
              platform,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status IN ('completed','checked_empty','blocked','duplicate_source'))::int AS checked,
              COUNT(*) FILTER (WHERE status = 'awaiting_capture')::int AS awaiting_capture
       FROM source_coverage_items
       WHERE run_id = $1::uuid
       GROUP BY platform, section_number
       ORDER BY platform, section_number
       LIMIT 100`,
      [runId]
    ),
  ]);
  if (!runResult.rows[0]) {
    const error = new Error('Source coverage run not found');
    error.status = 404;
    throw error;
  }
  const statusCounts = statusResult.rows.reduce((acc, row) => {
    acc[row.status] = Number(row.count || 0);
    return acc;
  }, {});
  return publicCoverageRun(runResult.rows[0], statusCounts, sectionResult.rows);
}

async function listSourceCoverageRuns(db, { limit = 10, platform = '' } = {}) {
  const cappedLimit = cappedInteger(limit, 10, 1, 50);
  const values = [];
  let where = '';
  if (clean(platform)) {
    values.push(clean(platform).toLowerCase());
    where = 'WHERE $1 = ANY(platform_scope)';
  }
  values.push(cappedLimit);
  const result = await db.query(
    `SELECT *, id::text AS id
     FROM source_coverage_runs
     ${where}
     ORDER BY created_at DESC
     LIMIT $${values.length}`,
    values
  );
  return result.rows.map((row) => publicCoverageRun(row, row.counters || {}, []));
}

async function getSourceCoverageItem(db, itemId) {
  if (!db?.query) throw new Error('db.query is required');
  const result = await db.query(
    'SELECT *, id::text AS id, run_id::text AS run_id FROM source_coverage_items WHERE id = $1::uuid LIMIT 1',
    [itemId]
  );
  if (!result.rows[0]) {
    const error = new Error('Source coverage item not found');
    error.status = 404;
    throw error;
  }
  return result.rows[0];
}

async function claimSourceCoverageBatch(db, runId, {
  platform = '',
  batchSize = DEFAULT_CLAIM_SIZE,
  leaseMinutes = 15,
} = {}) {
  if (!db?.pool?.connect) throw new Error('db.pool.connect is required');
  const boundedBatchSize = cappedInteger(batchSize, DEFAULT_CLAIM_SIZE, 1, MAX_CLAIM_SIZE);
  const boundedLease = cappedInteger(leaseMinutes, 15, 5, 120);
  const normalizedPlatform = clean(platform).toLowerCase();
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE source_coverage_items
       SET status = 'retry', lease_expires_at = NULL, updated_at = NOW(),
           last_error = COALESCE(last_error, 'processing_lease_expired')
       WHERE run_id = $1::uuid AND status = 'processing' AND lease_expires_at < NOW()`,
      [runId]
    );
    const activeValues = [runId, boundedBatchSize];
    const activePlatformSql = normalizedPlatform ? 'AND platform = $3' : '';
    if (normalizedPlatform) activeValues.push(normalizedPlatform);
    const active = await client.query(
      `SELECT *, id::text AS id, run_id::text AS run_id
       FROM source_coverage_items
       WHERE run_id = $1::uuid
         AND status = 'processing'
         AND lease_expires_at >= NOW()
         ${activePlatformSql}
       ORDER BY section_number, sequence_number
       LIMIT $2`,
      activeValues
    );
    if (active.rows.length) {
      await client.query('COMMIT');
      return active.rows;
    }
    const values = [runId, boundedBatchSize, boundedLease];
    const platformSql = normalizedPlatform ? 'AND platform = $4' : '';
    if (normalizedPlatform) values.push(normalizedPlatform);
    const claimed = await client.query(
      `WITH next_items AS (
         SELECT id
         FROM source_coverage_items
         WHERE run_id = $1::uuid
           AND status IN ('pending','retry')
           AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
           ${platformSql}
         ORDER BY section_number, sequence_number
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE source_coverage_items item
       SET status = 'processing', attempts = item.attempts + 1,
           lease_expires_at = NOW() + ($3::text || ' minutes')::interval,
           started_at = COALESCE(item.started_at, NOW()), updated_at = NOW()
       FROM next_items
       WHERE item.id = next_items.id
       RETURNING item.*, item.id::text AS id, item.run_id::text AS run_id`,
      values
    );
    await client.query(
      `UPDATE source_coverage_runs
       SET status = CASE WHEN status = 'queued' THEN 'running' ELSE status END,
           started_at = COALESCE(started_at, NOW()), heartbeat_at = NOW(), updated_at = NOW()
       WHERE id = $1::uuid`,
      [runId]
    );
    await client.query('COMMIT');
    return claimed.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function normalizedItemStatus(outcome = '') {
  const value = clean(outcome).toLowerCase();
  if (['empty', 'checked_empty', 'no_results'].includes(value)) return 'checked_empty';
  if (['retry', 'rate_limited', 'provider_error'].includes(value)) return 'retry';
  if (['blocked', 'login_required', 'captcha'].includes(value)) return 'blocked';
  if (['awaiting_capture', 'manual_capture'].includes(value)) return 'awaiting_capture';
  return 'completed';
}

async function refreshSourceCoverageRun(db, runId) {
  const aggregate = await db.query(
    `SELECT status, COUNT(*)::int AS count,
            COALESCE(SUM(exact_url_count),0)::int AS exact_url_count,
            COALESCE(SUM(discovered_count),0)::int AS discovered_count,
            COALESCE(SUM(review_queued_count),0)::int AS review_queued_count,
            COALESCE(SUM(duplicate_count),0)::int AS duplicate_count,
            COALESCE(SUM(excluded_count),0)::int AS excluded_count
     FROM source_coverage_items
     WHERE run_id = $1::uuid
     GROUP BY status`,
    [runId]
  );
  const counters = aggregate.rows.reduce((acc, row) => {
    acc[row.status] = Number(row.count || 0);
    acc.exact_url_count = (acc.exact_url_count || 0) + Number(row.exact_url_count || 0);
    acc.discovered_count = (acc.discovered_count || 0) + Number(row.discovered_count || 0);
    acc.review_queued_count = (acc.review_queued_count || 0) + Number(row.review_queued_count || 0);
    acc.duplicate_count = (acc.duplicate_count || 0) + Number(row.duplicate_count || 0);
    acc.excluded_count = (acc.excluded_count || 0) + Number(row.excluded_count || 0);
    return acc;
  }, {});
  const remaining = Number(counters.pending || 0) + Number(counters.processing || 0) + Number(counters.retry || 0) + Number(counters.awaiting_capture || 0);
  counters.remaining = remaining;
  await db.query(
    `UPDATE source_coverage_runs
     SET counters = $2::jsonb, heartbeat_at = NOW(), updated_at = NOW(),
         status = CASE WHEN $3::int = 0 THEN 'completed' WHEN status = 'queued' THEN 'running' ELSE status END,
         finished_at = CASE WHEN $3::int = 0 THEN COALESCE(finished_at, NOW()) ELSE NULL END
     WHERE id = $1::uuid`,
    [runId, JSON.stringify(counters), remaining]
  );
  return getSourceCoverageRun(db, runId);
}

async function completeSourceCoverageItem(db, itemId, {
  outcome = 'completed',
  exactUrlCount = 0,
  discoveredCount = 0,
  reviewQueuedCount = 0,
  duplicateCount = 0,
  excludedCount = 0,
  failureReason = '',
  error = '',
  result = {},
  retryAfterMinutes = 60,
} = {}) {
  const status = normalizedItemStatus(outcome);
  const nextAttemptAt = status === 'retry'
    ? new Date(Date.now() + cappedInteger(retryAfterMinutes, 60, 5, 1440) * 60000).toISOString()
    : null;
  const updated = await db.query(
    `UPDATE source_coverage_items
     SET status = $2,
         exact_url_count = $3, discovered_count = $4,
         review_queued_count = $5, duplicate_count = $6, excluded_count = $7,
         failure_reason = NULLIF($8,''), last_error = NULLIF($9,''),
         result = $10::jsonb, next_attempt_at = $11::timestamptz,
         lease_expires_at = NULL,
         checked_at = CASE WHEN $2 IN ('completed','checked_empty','blocked') THEN NOW() ELSE checked_at END,
         updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING *, id::text AS id, run_id::text AS run_id`,
    [
      itemId,
      status,
      Math.max(0, Number(exactUrlCount) || 0),
      Math.max(0, Number(discoveredCount) || 0),
      Math.max(0, Number(reviewQueuedCount) || 0),
      Math.max(0, Number(duplicateCount) || 0),
      Math.max(0, Number(excludedCount) || 0),
      clean(failureReason),
      clean(error).slice(0, 500),
      JSON.stringify(result || {}),
      nextAttemptAt,
    ]
  );
  if (!updated.rows[0]) {
    const notFound = new Error('Source coverage item not found');
    notFound.status = 404;
    throw notFound;
  }
  if (TERMINAL_ITEM_STATUSES.has(status)) {
    await db.query(
      `UPDATE property_source_registry
       SET last_checked_at = NOW(), updated_at = NOW()
       WHERE source_key = $1`,
      [updated.rows[0].source_key]
    ).catch(() => {});
  }
  const run = await refreshSourceCoverageRun(db, updated.rows[0].run_id);
  return { item: updated.rows[0], run };
}

async function requeueFalsePositiveSafetyBlocks(db, runId) {
  const repaired = await db.query(
    `UPDATE source_coverage_items
     SET status = 'retry', failure_reason = NULL, last_error = NULL,
         next_attempt_at = NOW(), checked_at = NULL, updated_at = NOW()
     WHERE run_id = $1::uuid
       AND status = 'blocked'
       AND failure_reason = 'review_only_safety_check_failed'
       AND COALESCE((result->'import_summary'->>'created_auto_live_properties')::int, 0) = 0
     RETURNING id::text AS id, source_key`,
    [runId]
  );
  return {
    repaired_count: repaired.rowCount,
    repaired_items: repaired.rows,
    run: await refreshSourceCoverageRun(db, runId),
  };
}

function youtubeApiKey(env = process.env) {
  for (const name of YOUTUBE_API_KEY_ENV_NAMES) {
    const value = clean(env[name]);
    if (value) return { name, value };
  }
  return { name: '', value: '' };
}

function quotaLimitedReport(reports = []) {
  return reports.find((report) => report.status === 429 || /quota|rate.?limit/i.test(`${report.reason || ''} ${report.error_reason || ''}`));
}

function youtubeProviderFailureDisposition(reports = []) {
  const failed = (Array.isArray(reports) ? reports : []).find((report) => report?.ok !== true);
  if (!failed) return null;
  const status = Number(failed.status || 0);
  const reason = clean(failed.error_reason || failed.reason || 'youtube_provider_error');
  const blocked = [400, 401, 403, 404].includes(status)
    || /auth|credential|api.?key|permission|forbidden|not.?found/i.test(reason);
  return {
    outcome: blocked ? 'blocked' : 'retry',
    reason,
    retryAfterMinutes: blocked ? 60 : 15,
    report: failed,
  };
}

async function processYouTubeCoverageBatch({
  db,
  runId,
  batchSize = 5,
  lookbackDays = 30,
  env = process.env,
  fetchImpl = fetch,
  dryRun = false,
} = {}) {
  const api = youtubeApiKey(env);
  if (!api.value) return { ok: false, blocked: true, reason: 'youtube_api_key_required', processed: 0 };
  const items = await claimSourceCoverageBatch(db, runId, { platform: 'youtube', batchSize: Math.min(5, batchSize) });
  const reports = [];
  const publishedAfter = new Date(Date.now() - cappedInteger(lookbackDays, 30, 1, 366) * 86400000).toISOString();
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    const item = items[itemIndex];
    const source = item.metadata?.source_snapshot || {
      key: item.source_key,
      name: item.source_name,
      platform: 'youtube',
      sourceType: item.source_type,
      url: item.source_url,
    };
    const jobs = buildYouTubeSearchJobs({
      sources: [source],
      limit: 1,
      publishedAfter,
      maxPagesPerSource: 1,
      jobMode: 'all',
    });
    if (!jobs.length) {
      const completed = await completeSourceCoverageItem(db, item.id, {
        outcome: 'blocked',
        failureReason: 'youtube_source_could_not_build_job',
      });
      reports.push({ item_id: item.id, source_key: item.source_key, status: completed.item.status, reason: completed.item.failure_reason });
      continue;
    }
    const fetched = await fetchYouTubePostsForJobs(jobs, {
      apiKey: api.value,
      maxResults: 25,
      maxPagesPerSource: 1,
      fetchImpl,
      deadlineAt: Date.now() + 35000,
      minRemainingMs: 8000,
    });
    const quotaReport = quotaLimitedReport(fetched.reports);
    if (quotaReport) {
      await completeSourceCoverageItem(db, item.id, {
        outcome: 'retry',
        failureReason: quotaReport.error_reason || 'youtube_quota_limited',
        error: quotaReport.reason || '',
        result: { provider_report: quotaReport },
        retryAfterMinutes: 1440,
      });
      reports.push({ item_id: item.id, source_key: item.source_key, status: 'retry', reason: quotaReport.reason || 'youtube_quota_limited' });
      for (const deferred of items.slice(itemIndex + 1)) {
        await completeSourceCoverageItem(db, deferred.id, {
          outcome: 'retry',
          failureReason: 'youtube_batch_deferred_after_quota_limit',
          retryAfterMinutes: 1440,
        });
        reports.push({ item_id: deferred.id, source_key: deferred.source_key, status: 'retry', reason: 'youtube_batch_deferred_after_quota_limit' });
      }
      break;
    }
    const providerFailure = youtubeProviderFailureDisposition(fetched.reports);
    if (providerFailure) {
      const completed = await completeSourceCoverageItem(db, item.id, {
        outcome: providerFailure.outcome,
        failureReason: providerFailure.reason,
        error: providerFailure.reason,
        result: { provider_report: providerFailure.report },
        retryAfterMinutes: providerFailure.retryAfterMinutes,
      });
      reports.push({ item_id: item.id, source_key: item.source_key, status: completed.item.status, reason: providerFailure.reason });
      continue;
    }
    const posts = fetched.posts || [];
    const importResult = posts.length
      ? await queueFoundOnlineSourcePostListings({ db, posts, dryRun, createProfilesForRepeatedSourcesOnly: false })
      : { created_properties: 0, existing_properties: 0, review_queue_properties: 0, source_review_count: 0, auto_live_properties: 0 };
    if (!dryRun && posts.length) {
      await recordHarvestImportResult(db, importResult, { eventType: 'source_coverage_youtube' }).catch(() => {});
    }
    if (Number(importResult.created_auto_live_properties || 0) !== 0) {
      await completeSourceCoverageItem(db, item.id, {
        outcome: 'blocked',
        failureReason: 'review_only_safety_check_failed',
        result: { import_summary: importResult },
      });
      for (const deferred of items.slice(itemIndex + 1)) {
        await completeSourceCoverageItem(db, deferred.id, {
          outcome: 'retry',
          failureReason: 'youtube_batch_deferred_after_safety_stop',
          retryAfterMinutes: 15,
        });
      }
      throw new Error('Review-only safety check failed: YouTube coverage reported automatic publication.');
    }
    const outcome = posts.length ? 'completed' : 'checked_empty';
    const completed = await completeSourceCoverageItem(db, item.id, {
      outcome,
      exactUrlCount: posts.length,
      discoveredCount: posts.length,
      reviewQueuedCount: Number(importResult.review_queue_properties || 0),
      duplicateCount: Number(importResult.existing_properties || 0),
      excludedCount: Number(importResult.source_review_count || 0),
      result: {
        provider_reports: fetched.reports || [],
        import_summary: {
          created_properties: Number(importResult.created_properties || 0),
          existing_properties: Number(importResult.existing_properties || 0),
          review_queue_properties: Number(importResult.review_queue_properties || 0),
          source_review_count: Number(importResult.source_review_count || 0),
          created_auto_live_properties: Number(importResult.created_auto_live_properties || 0),
          existing_auto_live_properties: Number(importResult.existing_auto_live_properties || 0),
          auto_live_properties: Number(importResult.auto_live_properties || 0),
        },
      },
    });
    reports.push({ item_id: item.id, source_key: item.source_key, status: completed.item.status, discovered: posts.length, review_queued: Number(importResult.review_queue_properties || 0), created_auto_live: Number(importResult.created_auto_live_properties || 0), existing_auto_live: Number(importResult.existing_auto_live_properties || 0) });
  }
  return { ok: true, marker: SOURCE_COVERAGE_MARKER, run_id: runId, processed: reports.length, reports, run: await refreshSourceCoverageRun(db, runId) };
}

module.exports = {
  SOURCE_COVERAGE_MARKER,
  DEFAULT_SECTION_SIZE,
  DEFAULT_CLAIM_SIZE,
  MAX_CLAIM_SIZE,
  normalizeCoveragePlatforms,
  normalizedSourceUrl,
  canonicalSourceKey,
  sourceSnapshot,
  buildCoverageManifestRows,
  createSourceCoverageRun,
  getSourceCoverageRun,
  listSourceCoverageRuns,
  getSourceCoverageItem,
  claimSourceCoverageBatch,
  completeSourceCoverageItem,
  refreshSourceCoverageRun,
  requeueFalsePositiveSafetyBlocks,
  youtubeProviderFailureDisposition,
  processYouTubeCoverageBatch,
};
