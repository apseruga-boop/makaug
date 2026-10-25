const crypto = require('crypto');

const db = require('../config/database');
const logger = require('../config/logger');
const { publicLivePropertyStatusSql } = require('../utils/publicInventoryStatus');
const { publicHasPhotoOrVideoSql } = require('../utils/realListingPhoto');
const { shortTermEnabled } = require('../utils/shortTermFeatureFlags');

const PUBLIC_INVENTORY_METRICS_MARKER = 'properties-list-count-fast-20260718';
const PUBLIC_INVENTORY_METRICS_CACHE_TTL_MS = Math.max(
  1000,
  Math.min(600000, parseInt(process.env.PUBLIC_INVENTORY_METRICS_CACHE_TTL_MS || '60000', 10) || 60000)
);
const PUBLIC_INVENTORY_METRICS_TIMEOUT_MS = Math.max(
  250,
  Math.min(5000, parseInt(process.env.PUBLIC_INVENTORY_METRICS_TIMEOUT_MS || '900', 10) || 900)
);
const PUBLIC_INVENTORY_METRICS_CACHE_MAX_ENTRIES = Math.max(
  20,
  Math.min(300, parseInt(process.env.PUBLIC_INVENTORY_METRICS_CACHE_MAX_ENTRIES || '120', 10) || 120)
);
// Background refreshes use the same 4s budget as the public list route.
// Callers never wait on this; it only lets a refresh finish and fill the cache.
const PUBLIC_INVENTORY_BACKGROUND_REFRESH_TIMEOUT_MS = 4000;

const LAUNCH_SEED_LISTING_MARKERS = [
  'SOFT LAUNCH TEST - DELETE',
  'QA TEST - DELETE',
  'MAKAUG TRAINING',
  'REMOVE AFTER QA'
];
const LAUNCH_DUMMY_LISTING_TITLES = ['sdgsdgd', 'sgsgsgsgs'];
const publicInventoryMetricsCache = new Map();
const publicInventoryMetricsInflight = new Map();
const loggedInventoryRefreshes = new WeakSet();
let inventoryCacheGeneration = 0;
let inventoryCacheLimitOverride = 0;
let inventoryNow = () => Date.now();
let inventoryQueryRunner = null;
let inventoryWarmChain = Promise.resolve();

function inventoryCacheLimit() {
  const override = Number(inventoryCacheLimitOverride);
  if (Number.isFinite(override) && override >= 1) return Math.floor(override);
  return PUBLIC_INVENTORY_METRICS_CACHE_MAX_ENTRIES;
}

function clonePublicOpportunitySummary(summary = {}) {
  return {
    ...summary,
    by_type: { ...(summary.by_type || {}) }
  };
}

function invalidatePublicInventoryMetricsCache(reason = 'public_inventory_changed') {
  inventoryCacheGeneration += 1;
  let marked = 0;
  for (const entry of publicInventoryMetricsCache.values()) {
    entry.stale = true;
    entry.createdAt = 0;
    marked += 1;
  }
  require('./publicHtmlResponseCache').clear();
  logger.info('Public inventory metrics cache invalidated', {
    marker: PUBLIC_INVENTORY_METRICS_MARKER,
    reason,
    cleared: marked,
    mode: 'mark_stale'
  });
  return marked;
}

function sqlLiteral(value = '') {
  return String(value).replace(/'/g, "''");
}

function column(alias = 'p', name = '') {
  return alias ? `${alias}.${name}` : name;
}

function publicLaunchTestListingFastCondition(alias = 'p') {
  const col = (name) => column(alias, name);
  const markerSql = LAUNCH_SEED_LISTING_MARKERS
    .map((marker) => {
      const safe = sqlLiteral(marker);
      return `(COALESCE(${col('title')}, '') ILIKE '%${safe}%' OR COALESCE(${col('description')}, '') ILIKE '%${safe}%')`;
    })
    .join(' OR ');
  const dummySql = LAUNCH_DUMMY_LISTING_TITLES.map((title) => `'${sqlLiteral(title)}'`).join(', ');
  return `(
    ${markerSql}
    OR LOWER(TRIM(COALESCE(${col('title')}, ''))) IN (${dummySql})
    OR COALESCE(${col('source')}, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(${col('listed_via')}, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(${col('lister_name')}, '') ~* '(qa test delete|qa owner|dummy|sample)'
    OR COALESCE(${col('lister_email')}, '') ~* '(makaug\\.invalid|test@|qa@|dummy|sample)'
    OR COALESCE(${col('inquiry_reference')}, '') ~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'
    OR COALESCE(${col('extra_fields')}->>'qa_test_delete', '') ~* '^(true|1|yes)$'
    OR COALESCE(${col('extra_fields')}->>'soft_launch_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(${col('extra_fields')}->>'is_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(${col('extra_fields')}->>'launch_proof', '') ~* '^(true|1|yes)$'
    OR COALESCE(${col('extra_fields')}->>'non_public_test', '') ~* '^(true|1|yes)$'
  )`;
}

function publicVisibleInventoryWhere(alias = 'p') {
  return `(${publicLivePropertyStatusSql(alias)} AND NOT ${publicLaunchTestListingFastCondition(alias)} AND ${publicHasPhotoOrVideoSql(alias)})`;
}

function publicOpportunityBucketSql(alias = 'p') {
  const directType = `LOWER(TRIM(COALESCE(${column(alias, 'listing_type')}, '')))`;
  const propertyType = `LOWER(COALESCE(${column(alias, 'property_type')}, ''))`;
  const period = `LOWER(COALESCE(${column(alias, 'price_period')}, ''))`;
  return `CASE
    WHEN ${directType} IN ('sale', 'rent', 'commercial', 'land') THEN ${directType}
    WHEN ${directType} IN ('student', 'students') THEN 'student'
    WHEN ${directType} = 'rent' AND ${column(alias, 'students_welcome')} = TRUE THEN 'student'
    WHEN ${propertyType} ~* '(land|plot|acre|decimal|estate plots?)' THEN 'land'
    WHEN ${propertyType} ~* '(commercial|office|shop|retail|warehouse|showroom|restaurant|industrial)' THEN 'commercial'
    WHEN ${propertyType} ~* '(hostel|student|campus|dorm|bedsitter)' THEN 'student'
    WHEN ${period} IN ('mo', 'month', 'monthly', 'per_month') THEN 'rent'
    ELSE 'sale'
  END`;
}

function normalizePublicOpportunitySummary(row = {}) {
  const sale = Number(row.sale || 0) || 0;
  const rent = Number(row.rent || 0) || 0;
  const student = Number(row.student || 0) || 0;
  const commercial = Number(row.commercial || 0) || 0;
  const land = Number(row.land || 0) || 0;
  const other = Number(row.other || 0) || 0;
  // Short term stays live in st_listing, not properties, so they are never in
  // `row`. They are folded into the site-wide figure below, and only there.
  const shortTerm = Number(row.short_term || 0) || 0;
  const total = Number(row.total || 0) || (sale + rent + student + commercial + land + other + shortTerm);
  return {
    total,
    sale,
    rent,
    student,
    commercial,
    land,
    other,
    short_term: shortTerm,
    by_type: {
      sale,
      rent,
      student,
      commercial,
      land,
      other,
      short_term: shortTerm
    }
  };
}

function publicInventoryCacheKey(where = '', values = []) {
  const raw = JSON.stringify({ where, values });
  return crypto.createHash('sha1').update(raw).digest('hex');
}

function readCachedPublicInventoryMetrics(key) {
  const cached = publicInventoryMetricsCache.get(key);
  if (!cached?.summary) return null;
  publicInventoryMetricsCache.delete(key);
  publicInventoryMetricsCache.set(key, cached);
  const ageMs = inventoryNow() - Number(cached.createdAt || 0);
  const fresh = !cached.stale && ageMs <= PUBLIC_INVENTORY_METRICS_CACHE_TTL_MS;
  return { summary: cached.summary, cache: fresh ? 'hit' : 'stale' };
}

function rememberCachedPublicInventoryMetrics(key, summary, generation) {
  const existing = publicInventoryMetricsCache.get(key);
  if (existing && Number(existing.generation) > generation) return;
  const stale = generation !== inventoryCacheGeneration;
  if (
    existing
    && !existing.stale
    && existing.generation === inventoryCacheGeneration
    && generation < inventoryCacheGeneration
  ) return;
  if (publicInventoryMetricsCache.has(key)) publicInventoryMetricsCache.delete(key);
  publicInventoryMetricsCache.set(key, {
    createdAt: stale ? 0 : inventoryNow(),
    stale,
    generation,
    summary: clonePublicOpportunitySummary(summary)
  });
  const limit = inventoryCacheLimit();
  while (publicInventoryMetricsCache.size > limit) {
    const oldestKey = publicInventoryMetricsCache.keys().next().value;
    if (oldestKey === undefined) break;
    publicInventoryMetricsCache.delete(oldestKey);
  }
}

async function timedQuery(sql, values = [], timeoutMs = PUBLIC_INVENTORY_METRICS_TIMEOUT_MS) {
  let acquireTimedOut = false;
  const acquireTimeoutMs = Math.max(250, Math.min(Number(timeoutMs) || PUBLIC_INVENTORY_METRICS_TIMEOUT_MS, 900));
  const clientPromise = db.getClient().then((client) => {
    if (acquireTimedOut) {
      client.release();
      return null;
    }
    return client;
  });
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      acquireTimedOut = true;
      const error = new Error('Database client acquisition timed out');
      error.code = 'POOL_TIMEOUT';
      reject(error);
    }, acquireTimeoutMs);
  });
  const client = await Promise.race([clientPromise, timeoutPromise]);
  if (!client) {
    const error = new Error('Database client acquisition timed out');
    error.code = 'POOL_TIMEOUT';
    throw error;
  }
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', [
      'statement_timeout',
      `${Math.max(250, Number(timeoutMs) || PUBLIC_INVENTORY_METRICS_TIMEOUT_MS)}ms`
    ]);
    const result = await client.query(sql, values);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Adds live short term stays to the SITE-WIDE property total.
 *
 * Only the unfiltered, site-wide call is adjusted. A caller counting, say,
 * rentals in Kampala passes its own `where`, and adding every short stay in
 * Uganda to that would be wrong, so those counts are left exactly as they are.
 *
 * Fails soft in every direction: the feature flag, a missing st_listing table
 * and any query error all resolve to "add nothing". The existing count can
 * never break because of short term.
 */
async function addShortTermToSiteWideSummary(summary, callerWhere = '') {
  if (callerWhere && String(callerWhere).trim()) return summary;
  if (!shortTermEnabled()) return summary;
  try {
    const { loadShortTermPublicCount } = require('./shortTermService');
    const shortTerm = await loadShortTermPublicCount(db);
    if (!Number.isFinite(shortTerm) || shortTerm <= 0) return summary;
    summary.short_term = shortTerm;
    summary.by_type.short_term = shortTerm;
    summary.total = Number(summary.total || 0) + shortTerm;
  } catch (error) {
    logger.warn('Site-wide total is continuing without short term stays', {
      marker: PUBLIC_INVENTORY_METRICS_MARKER,
      code: error?.code,
      message: error?.message
    });
  }
  return summary;
}

function countFallbackReason(error) {
  if (error?.code === '57014') return 'statement_timeout';
  if (error?.code === 'POOL_TIMEOUT') return 'pool_timeout';
  return 'query_failed';
}

function logStaleInventoryCount(error) {
  logger.warn('Using stale public inventory metrics after count timeout/error', {
    marker: PUBLIC_INVENTORY_METRICS_MARKER,
    code: error?.code,
    message: error?.message
  });
}

function inventoryCountSql(normalizedWhere) {
  const bucketSql = publicOpportunityBucketSql('p');
  return `SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE bucket = 'sale')::int AS sale,
      COUNT(*) FILTER (WHERE bucket = 'rent')::int AS rent,
      COUNT(*) FILTER (WHERE bucket = 'student')::int AS student,
      COUNT(*) FILTER (WHERE bucket = 'commercial')::int AS commercial,
      COUNT(*) FILTER (WHERE bucket = 'land')::int AS land,
      COUNT(*) FILTER (WHERE bucket = 'other')::int AS other
    FROM (
      SELECT ${bucketSql} AS bucket
      FROM properties p
      ${normalizedWhere}
    ) public_inventory`;
}

async function executePublicInventoryCount({ key, normalizedWhere, callerWhere, values, timeoutMs, generation }) {
  const sql = inventoryCountSql(normalizedWhere);
  const runQuery = inventoryQueryRunner || timedQuery;
  const result = await runQuery(sql, values, timeoutMs);
  const summary = normalizePublicOpportunitySummary(result.rows[0] || {});
  await addShortTermToSiteWideSummary(summary, callerWhere);
  rememberCachedPublicInventoryMetrics(key, summary, generation);
  return summary;
}

function beginPublicInventoryCount({ key, normalizedWhere, callerWhere, values, timeoutMs }) {
  const existing = publicInventoryMetricsInflight.get(key);
  if (existing && existing.generation === inventoryCacheGeneration) return existing.promise;
  if (!existing && publicInventoryMetricsInflight.size >= inventoryCacheLimit()) return null;
  const generation = inventoryCacheGeneration;
  let promise;
  promise = executePublicInventoryCount({
    key,
    normalizedWhere,
    callerWhere,
    values,
    timeoutMs,
    generation
  }).finally(() => {
    const current = publicInventoryMetricsInflight.get(key);
    if (current?.promise === promise) publicInventoryMetricsInflight.delete(key);
  });
  // Callers may stop waiting before this settles. A later rejection must not
  // become an unhandled rejection once they have moved on.
  promise.catch(() => {});
  publicInventoryMetricsInflight.set(key, { promise, generation });
  return promise;
}

function watchInventoryRefresh(promise) {
  if (!promise || loggedInventoryRefreshes.has(promise)) return;
  loggedInventoryRefreshes.add(promise);
  promise.catch((error) => logStaleInventoryCount(error));
}

function awaitInventoryCount(promise, timeoutMs) {
  const budget = Math.max(1, Number(timeoutMs) || PUBLIC_INVENTORY_METRICS_TIMEOUT_MS);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Public inventory count exceeded the request budget');
      error.code = '57014';
      reject(error);
    }, budget);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function inventoryResult(summary, meta) {
  return {
    summary: clonePublicOpportunitySummary(summary),
    meta: {
      marker: PUBLIC_INVENTORY_METRICS_MARKER,
      ...meta
    }
  };
}

async function loadPublicOpportunitySummary({
  where = '',
  values = [],
  timeoutMs = PUBLIC_INVENTORY_METRICS_TIMEOUT_MS,
  preferFresh = false
} = {}) {
  const normalizedWhere = where && String(where).trim() ? where : `WHERE ${publicVisibleInventoryWhere('p')}`;
  const key = publicInventoryCacheKey(normalizedWhere, values);
  const cached = readCachedPublicInventoryMetrics(key);
  if (cached?.cache === 'hit') {
    return inventoryResult(cached.summary, { cache: 'hit' });
  }

  if (cached?.summary && !preferFresh) {
    const refresh = beginPublicInventoryCount({
      key,
      normalizedWhere,
      callerWhere: where,
      values,
      timeoutMs: PUBLIC_INVENTORY_BACKGROUND_REFRESH_TIMEOUT_MS
    });
    watchInventoryRefresh(refresh);
    return inventoryResult(cached.summary, { cache: 'stale' });
  }

  let pending = beginPublicInventoryCount({
    key,
    normalizedWhere,
    callerWhere: where,
    values,
    timeoutMs
  });
  if (!pending) {
    pending = executePublicInventoryCount({
      key,
      normalizedWhere,
      callerWhere: where,
      values,
      timeoutMs,
      generation: inventoryCacheGeneration
    });
    pending.catch(() => {});
  }

  try {
    const summary = await awaitInventoryCount(pending, timeoutMs);
    const stored = readCachedPublicInventoryMetrics(key);
    const cache = stored?.cache === 'stale' ? 'stale' : (cached ? 'refresh' : 'miss');
    return inventoryResult(summary, { cache });
  } catch (error) {
    if (cached?.summary) {
      logStaleInventoryCount(error);
      return inventoryResult(cached.summary, {
        cache: 'stale',
        fallback_reason: countFallbackReason(error)
      });
    }
    throw error;
  }
}

function warmPublicInventoryCounts(queries = []) {
  const jobs = [
    {
      label: 'site-wide',
      where: '',
      values: [],
      timeoutMs: PUBLIC_INVENTORY_BACKGROUND_REFRESH_TIMEOUT_MS
    },
    ...queries
  ];
  const run = inventoryWarmChain.catch(() => {}).then(async () => {
    const results = [];
    for (const job of jobs) {
      try {
        const result = await loadPublicOpportunitySummary({
          where: job.where || '',
          values: Array.isArray(job.values) ? job.values : [],
          timeoutMs: job.timeoutMs || PUBLIC_INVENTORY_BACKGROUND_REFRESH_TIMEOUT_MS,
          preferFresh: true
        });
        logger.info('Public inventory count warmed', {
          label: job.label,
          total: result?.summary?.total ?? null,
          cache: result?.meta?.cache || null
        });
        results.push({
          label: job.label,
          ok: true,
          total: result?.summary?.total ?? null,
          cache: result?.meta?.cache || null
        });
      } catch (error) {
        logger.warn('Public inventory count warmup failed; pages render without waiting for this count', {
          label: job.label,
          code: error?.code,
          message: error?.message
        });
        results.push({ label: job.label, ok: false, code: error?.code || null });
      }
    }
    return results;
  });
  inventoryWarmChain = run;
  return run;
}

function resetPublicInventoryMetricsForTests() {
  publicInventoryMetricsCache.clear();
  publicInventoryMetricsInflight.clear();
  inventoryCacheGeneration = 0;
  inventoryCacheLimitOverride = 0;
  inventoryNow = () => Date.now();
  inventoryQueryRunner = null;
  inventoryWarmChain = Promise.resolve();
}

function setPublicInventoryQueryRunnerForTests(runner) {
  inventoryQueryRunner = typeof runner === 'function' ? runner : null;
}

function setPublicInventoryClockForTests(clock) {
  inventoryNow = typeof clock === 'function' ? clock : () => Date.now();
}

function setPublicInventoryCacheLimitForTests(limit) {
  inventoryCacheLimitOverride = Number(limit) || 0;
}

function publicInventoryMetricsCacheSizeForTests() {
  return publicInventoryMetricsCache.size;
}

module.exports = {
  PUBLIC_INVENTORY_BACKGROUND_REFRESH_TIMEOUT_MS,
  PUBLIC_INVENTORY_METRICS_CACHE_MAX_ENTRIES,
  PUBLIC_INVENTORY_METRICS_CACHE_TTL_MS,
  PUBLIC_INVENTORY_METRICS_MARKER,
  addShortTermToSiteWideSummary,
  invalidatePublicInventoryMetricsCache,
  loadPublicOpportunitySummary,
  normalizePublicOpportunitySummary,
  publicInventoryMetricsCacheSizeForTests,
  publicLaunchTestListingFastCondition,
  publicOpportunityBucketSql,
  publicVisibleInventoryWhere,
  resetPublicInventoryMetricsForTests,
  setPublicInventoryCacheLimitForTests,
  setPublicInventoryClockForTests,
  setPublicInventoryQueryRunnerForTests,
  warmPublicInventoryCounts
};
