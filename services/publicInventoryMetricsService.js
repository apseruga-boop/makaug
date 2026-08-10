const crypto = require('crypto');

const db = require('../config/database');
const logger = require('../config/logger');
const { publicLivePropertyStatusSql } = require('../utils/publicInventoryStatus');

const PUBLIC_INVENTORY_METRICS_MARKER = 'properties-list-count-fast-20260718';
const PUBLIC_INVENTORY_METRICS_CACHE_TTL_MS = Math.max(
  1000,
  Math.min(600000, parseInt(process.env.PUBLIC_INVENTORY_METRICS_CACHE_TTL_MS || '180000', 10) || 180000)
);
const PUBLIC_INVENTORY_METRICS_TIMEOUT_MS = Math.max(
  250,
  Math.min(5000, parseInt(process.env.PUBLIC_INVENTORY_METRICS_TIMEOUT_MS || '900', 10) || 900)
);
const PUBLIC_INVENTORY_METRICS_CACHE_MAX_ENTRIES = Math.max(
  20,
  Math.min(300, parseInt(process.env.PUBLIC_INVENTORY_METRICS_CACHE_MAX_ENTRIES || '120', 10) || 120)
);

const LAUNCH_SEED_LISTING_MARKERS = [
  'SOFT LAUNCH TEST - DELETE',
  'QA TEST - DELETE',
  'MAKAUG TRAINING',
  'REMOVE AFTER QA'
];
const LAUNCH_DUMMY_LISTING_TITLES = ['sdgsdgd', 'sgsgsgsgs'];
const publicInventoryMetricsCache = new Map();

function invalidatePublicInventoryMetricsCache(reason = 'public_inventory_changed') {
  const cleared = publicInventoryMetricsCache.size;
  publicInventoryMetricsCache.clear();
  logger.info('Public inventory metrics cache invalidated', {
    marker: PUBLIC_INVENTORY_METRICS_MARKER,
    reason,
    cleared
  });
  return cleared;
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
  return `(${publicLivePropertyStatusSql(alias)} AND NOT ${publicLaunchTestListingFastCondition(alias)})`;
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
  const total = Number(row.total || 0) || (sale + rent + student + commercial + land + other);
  return {
    total,
    sale,
    rent,
    student,
    commercial,
    land,
    other,
    by_type: {
      sale,
      rent,
      student,
      commercial,
      land,
      other
    }
  };
}

function publicInventoryCacheKey(where = '', values = []) {
  const raw = JSON.stringify({ where, values });
  return crypto.createHash('sha1').update(raw).digest('hex');
}

function getCachedPublicInventoryMetrics(key) {
  const cached = publicInventoryMetricsCache.get(key);
  if (!cached) return null;
  if ((Date.now() - cached.createdAt) <= PUBLIC_INVENTORY_METRICS_CACHE_TTL_MS) {
    return { ...cached, cache: 'hit' };
  }
  return { ...cached, cache: 'stale' };
}

function setCachedPublicInventoryMetrics(key, summary) {
  publicInventoryMetricsCache.set(key, { createdAt: Date.now(), summary });
  if (publicInventoryMetricsCache.size <= PUBLIC_INVENTORY_METRICS_CACHE_MAX_ENTRIES) return;
  const oldestKey = publicInventoryMetricsCache.keys().next().value;
  if (oldestKey) publicInventoryMetricsCache.delete(oldestKey);
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

async function loadPublicOpportunitySummary({ where = '', values = [], timeoutMs = PUBLIC_INVENTORY_METRICS_TIMEOUT_MS } = {}) {
  const normalizedWhere = where && String(where).trim() ? where : `WHERE ${publicVisibleInventoryWhere('p')}`;
  const key = publicInventoryCacheKey(normalizedWhere, values);
  const cached = getCachedPublicInventoryMetrics(key);
  if (cached?.cache === 'hit') {
    return {
      summary: cached.summary,
      meta: {
        cache: 'hit',
        marker: PUBLIC_INVENTORY_METRICS_MARKER
      }
    };
  }

  const bucketSql = publicOpportunityBucketSql('p');
  const sql = `SELECT
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

  try {
    const result = await timedQuery(sql, values, timeoutMs);
    const summary = normalizePublicOpportunitySummary(result.rows[0] || {});
    setCachedPublicInventoryMetrics(key, summary);
    return {
      summary,
      meta: {
        cache: cached ? 'refresh' : 'miss',
        marker: PUBLIC_INVENTORY_METRICS_MARKER
      }
    };
  } catch (error) {
    if (cached?.summary) {
      logger.warn('Using stale public inventory metrics after count timeout/error', {
        marker: PUBLIC_INVENTORY_METRICS_MARKER,
        code: error.code,
        message: error.message
      });
      return {
        summary: cached.summary,
        meta: {
          cache: 'stale',
          marker: PUBLIC_INVENTORY_METRICS_MARKER,
          fallback_reason: error.code === '57014'
            ? 'statement_timeout'
            : error.code === 'POOL_TIMEOUT' ? 'pool_timeout' : 'query_failed'
        }
      };
    }
    throw error;
  }
}

module.exports = {
  PUBLIC_INVENTORY_METRICS_MARKER,
  invalidatePublicInventoryMetricsCache,
  loadPublicOpportunitySummary,
  normalizePublicOpportunitySummary,
  publicLaunchTestListingFastCondition,
  publicOpportunityBucketSql,
  publicVisibleInventoryWhere
};
