'use strict';

const logger = require('../config/logger');
const {
  canonicalizeUgandaLocation,
  normalizeLocationKey,
  resolveCanonicalUgandaLocationFromText,
} = require('../utils/ugandaLocationRegistry');
const { publicVisibleInventoryWhere } = require('./publicInventoryMetricsService');

const FEATURED_ROTATION_MARKER = 'featured-daily-rotation-20260725';
const FEATURED_CATEGORIES = Object.freeze(['sale', 'rent', 'land', 'commercial', 'student']);
const DEFAULT_TIME_ZONE = 'Africa/Kampala';
const DEFAULT_HOUR = 7;
const DEFAULT_PER_CATEGORY = 2;
const DEFAULT_CANDIDATE_LIMIT = 250;
const ADVISORY_LOCK_KEY = 716250725;

let schedulerTimer = null;
let schedulerRunning = false;

function clean(value = '') {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function featuredCategory(row = {}) {
  const type = clean(row.listing_type || row.type || row.category).toLowerCase();
  return type === 'students' ? 'student' : type;
}

function normalizedPeriod(row = {}) {
  return clean(row.price_period || row.period).toLowerCase().replace(/[\s-]+/g, '_');
}

function rowEvidenceText(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  return [
    row.title,
    row.description,
    row.property_type,
    extra.source_title,
    extra.source_caption,
    extra.source_text,
    extra.source_visual_text,
    extra.source_card_description
  ]
    .map(clean)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function titleLocationContradictsRow(row = {}) {
  const title = clean(row.title);
  const area = clean(row.area);
  const district = clean(row.district);
  if (!title || !area || !district) return false;

  // Do not bias title parsing with the stored district: the purpose of this
  // check is to catch a title that names a different place.
  const titleResolution = resolveCanonicalUgandaLocationFromText(title);
  const titleLocation = titleResolution.status === 'matched' ? titleResolution.match : null;
  const areaLocation = canonicalizeUgandaLocation(area, district);
  if (!titleLocation || !areaLocation) return false;

  const titleKey = normalizeLocationKey(title);
  const titleNames = [titleLocation.name, ...(titleLocation.aliases || [])]
    .map(normalizeLocationKey)
    .filter(Boolean);
  const titleNamesLocation = titleNames.some((name) => (` ${titleKey} `).includes(` ${name} `));
  if (!titleNamesLocation) return false;

  if (titleLocation.district !== areaLocation.district) return true;
  return titleLocation.level !== 'district'
    && areaLocation.level !== 'district'
    && titleLocation.key !== areaLocation.key;
}

function featuredCleanliness(row = {}) {
  const reasons = [];
  const category = featuredCategory(row);
  const price = Number(row.price);
  const period = normalizedPeriod(row);
  const text = rowEvidenceText(row);
  const recurring = ['month', 'monthly', 'mo', 'per_month', 'week', 'weekly', 'per_week', 'night', 'nightly', 'day', 'daily', 'semester', 'sem', 'term', 'year', 'yearly', 'annual', 'annually'].includes(period);
  const nightly = ['night', 'nightly', 'day', 'daily'].includes(period);
  const oneOff = ['once', 'one_off', 'total', 'sale', 'cash'].includes(period);
  const sourceSaysSale = /\b(for sale|on sale|available for sale|selling|asking price)\b/.test(text);
  const sourceSaysRent = /\b(for rent|to rent|to let|for lease|monthly rent|per month)\b/.test(text);

  if (!FEATURED_CATEGORIES.includes(category)) reasons.push('unsupported_category');
  if (!Number.isFinite(price) || price <= 1) reasons.push('missing_or_placeholder_price');
  if (!clean(row.area) || !clean(row.district)) reasons.push('missing_location');
  if (category === 'land' && recurring) reasons.push('land_priced_recurring');
  if (category === 'sale' && recurring) reasons.push('sale_priced_recurring');
  if (category === 'rent' && oneOff) reasons.push('rent_priced_once');
  if (category === 'student' && oneOff) reasons.push('student_sale_asset');
  if (recurring && price >= 400_000_000) reasons.push('implausible_high_recurring_price');
  if (
    recurring
    && !nightly
    && price > 1
    && price < 30_000
    && ['rent', 'student'].includes(category)
  ) reasons.push('implausible_low_recurring_price');
  if (category === 'student' && recurring && price > 5_000_000) reasons.push('implausible_student_monthly_price');
  if (category === 'commercial' && clean(row.property_type).toLowerCase() === 'commercial_land' && recurring) {
    reasons.push('commercial_land_priced_recurring');
  }
  if (sourceSaysSale && recurring) reasons.push('source_sale_period_conflict');
  if (sourceSaysRent && oneOff) reasons.push('source_rent_period_conflict');
  if (titleLocationContradictsRow(row)) reasons.push('title_location_conflict');
  if (/\b(qa test|demo listing|test zone|soft launch test|sample listing)\b/.test(text)) reasons.push('test_like_content');

  return { clean: reasons.length === 0, reasons };
}

function selectFeaturedCandidates(rows = [], perCategory = DEFAULT_PER_CATEGORY) {
  const selected = Object.fromEntries(FEATURED_CATEGORIES.map((category) => [category, []]));
  const rejected = Object.fromEntries(FEATURED_CATEGORIES.map((category) => [category, {}]));
  const ordered = [...rows].sort((a, b) => {
    const dateDelta = new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    return dateDelta || String(b.id || '').localeCompare(String(a.id || ''));
  });

  for (const row of ordered) {
    const category = featuredCategory(row);
    if (!FEATURED_CATEGORIES.includes(category) || selected[category].length >= perCategory) continue;
    const assessment = featuredCleanliness(row);
    if (assessment.clean) {
      selected[category].push(row);
      continue;
    }
    assessment.reasons.forEach((reason) => {
      rejected[category][reason] = (rejected[category][reason] || 0) + 1;
    });
  }

  const selectedRows = FEATURED_CATEGORIES.flatMap((category) => selected[category]);
  const missing = FEATURED_CATEGORIES.filter((category) => selected[category].length < perCategory);
  return { selected, selectedRows, rejected, missing };
}

function featuredPoolHealth(rows = [], perCategory = DEFAULT_PER_CATEGORY) {
  const byCategory = Object.fromEntries(FEATURED_CATEGORIES.map((category) => [category, 0]));
  const dirty = [];

  for (const row of rows) {
    const category = featuredCategory(row);
    if (FEATURED_CATEGORIES.includes(category)) byCategory[category] += 1;
    const assessment = featuredCleanliness(row);
    if (!assessment.clean) dirty.push({ id: row.id, category, reasons: assessment.reasons });
  }

  const expectedTotal = FEATURED_CATEGORIES.length * perCategory;
  const wrongCounts = FEATURED_CATEGORIES.filter((category) => byCategory[category] !== perCategory);
  return {
    healthy: rows.length === expectedTotal && wrongCounts.length === 0 && dirty.length === 0,
    total: rows.length,
    expectedTotal,
    byCategory,
    wrongCounts,
    dirty
  };
}

function timeZoneParts(now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value || '';
  return {
    dateKey: `${value('year')}-${value('month')}-${value('day')}`,
    hour: Number(value('hour') || 0),
    minute: Number(value('minute') || 0)
  };
}

async function writeRotationAudit(client, actorId, details) {
  try {
    await client.query(
      `INSERT INTO audit_logs (actor_id, action, details)
       VALUES ($1, 'featured_daily_rotation', $2::jsonb)`,
      [actorId, JSON.stringify(details || {})]
    );
  } catch (_error) {
    // The rotation itself must not fail if legacy audit storage is unavailable.
  }
}

async function loadFeaturedRotationStatus(db) {
  const [latest, current] = await Promise.all([
    db.query(
      `SELECT rotation_date, status, selected_count, selected_ids, rejection_summary,
              actor_id, started_at, completed_at, error_message
       FROM featured_rotation_runs
       ORDER BY rotation_date DESC
       LIMIT 1`
    ),
    db.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE listing_type = 'sale')::int AS sale,
         COUNT(*) FILTER (WHERE listing_type = 'rent')::int AS rent,
         COUNT(*) FILTER (WHERE listing_type = 'land')::int AS land,
         COUNT(*) FILTER (WHERE listing_type = 'commercial')::int AS commercial,
         COUNT(*) FILTER (WHERE listing_type IN ('student', 'students'))::int AS student
       FROM properties
       WHERE ${publicVisibleInventoryWhere('properties')}
         AND COALESCE(extra_fields->>'featured', 'false') IN ('true', '1', 'yes')`
    )
  ]);
  return {
    marker: FEATURED_ROTATION_MARKER,
    scheduler_enabled: process.env.FEATURED_ROTATION_SCHEDULER_ENABLED !== 'false',
    timezone: clean(process.env.FEATURED_ROTATION_TIMEZONE || DEFAULT_TIME_ZONE),
    hour: Math.max(0, Math.min(23, Number(process.env.FEATURED_ROTATION_HOUR || DEFAULT_HOUR))),
    latest_run: latest.rows[0] || null,
    current_featured: current.rows[0] || { total: 0 }
  };
}

async function runFeaturedRotation(db, options = {}) {
  const timeZone = clean(options.timeZone || process.env.FEATURED_ROTATION_TIMEZONE || DEFAULT_TIME_ZONE);
  const now = options.now instanceof Date ? options.now : new Date();
  const { dateKey } = timeZoneParts(now, timeZone);
  const actorId = clean(options.actorId || 'featured_rotation_scheduler');
  const perCategory = Math.max(1, Math.min(5, Number(options.perCategory || DEFAULT_PER_CATEGORY)));
  const candidateLimit = Math.max(30, Math.min(1000, Number(options.candidateLimit || DEFAULT_CANDIDATE_LIMIT)));
  const force = options.force === true;
  const client = await db.getClient();
  let lockHeld = false;

  try {
    const lock = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [ADVISORY_LOCK_KEY]);
    lockHeld = lock.rows[0]?.acquired === true;
    if (!lockHeld) return { ok: true, skipped: true, reason: 'rotation_locked', rotation_date: dateKey };

    if (!force) {
      const prior = await client.query(
        `SELECT status, selected_count
         FROM featured_rotation_runs
         WHERE rotation_date = $1::date AND status = 'completed'
         LIMIT 1`,
        [dateKey]
      );
      if (prior.rows[0]) {
        const currentFeatured = await client.query(
          `SELECT
             p.id, p.listing_type, p.title, p.description, p.district, p.area,
             p.price, p.price_period, p.property_type, p.transaction_type,
             p.extra_fields, p.created_at
           FROM properties p
           WHERE ${publicVisibleInventoryWhere('p')}
             AND COALESCE(p.extra_fields->>'featured', 'false') IN ('true', '1', 'yes')`
        );
        const health = featuredPoolHealth(currentFeatured.rows, perCategory);
        if (health.healthy) {
          return {
            ok: true,
            skipped: true,
            reason: 'already_completed',
            rotation_date: dateKey,
            selected_count: Number(prior.rows[0].selected_count || 0)
          };
        }
        await writeRotationAudit(client, actorId, {
          marker: FEATURED_ROTATION_MARKER,
          rotation_date: dateKey,
          status: 'repairing_unhealthy_pool',
          health
        });
      }
    }

    const candidates = await client.query(
      `WITH ranked AS (
         SELECT
           p.id, p.listing_type, p.title, p.description, p.district, p.area,
           p.price, p.price_period, p.property_type, p.transaction_type,
           p.extra_fields, p.created_at,
           ROW_NUMBER() OVER (
             PARTITION BY CASE WHEN p.listing_type IN ('student', 'students') THEN 'student' ELSE p.listing_type END
             ORDER BY p.created_at DESC, p.id DESC
           ) AS category_rank
         FROM properties p
         WHERE ${publicVisibleInventoryWhere('p')}
           AND p.listing_type IN ('sale', 'rent', 'land', 'commercial', 'student', 'students')
           AND (p.expires_at IS NULL OR p.expires_at > NOW())
       )
       SELECT *
       FROM ranked
       WHERE category_rank <= $1
       ORDER BY created_at DESC, id DESC`,
      [candidateLimit]
    );
    const selection = selectFeaturedCandidates(candidates.rows, perCategory);
    const selectedIds = selection.selectedRows.map((row) => row.id);

    if (selection.missing.length) {
      await client.query(
        `INSERT INTO featured_rotation_runs (
           rotation_date, status, selected_count, selected_ids, rejection_summary,
           actor_id, started_at, completed_at, error_message
         ) VALUES ($1::date, 'insufficient_clean_inventory', $2, $3::jsonb, $4::jsonb, $5, NOW(), NOW(), $6)
         ON CONFLICT (rotation_date) DO UPDATE
           SET status = EXCLUDED.status,
               selected_count = EXCLUDED.selected_count,
               selected_ids = EXCLUDED.selected_ids,
               rejection_summary = EXCLUDED.rejection_summary,
               actor_id = EXCLUDED.actor_id,
               completed_at = NOW(),
               error_message = EXCLUDED.error_message`,
        [
          dateKey,
          selectedIds.length,
          JSON.stringify(selectedIds),
          JSON.stringify(selection.rejected),
          actorId,
          `Missing two clean rows for: ${selection.missing.join(', ')}`
        ]
      );
      await writeRotationAudit(client, actorId, {
        marker: FEATURED_ROTATION_MARKER,
        rotation_date: dateKey,
        status: 'insufficient_clean_inventory',
        missing: selection.missing,
        selected_count: selectedIds.length,
        rejection_summary: selection.rejected
      });
      return {
        ok: false,
        changed: false,
        status: 'insufficient_clean_inventory',
        rotation_date: dateKey,
        missing: selection.missing,
        selected_count: selectedIds.length,
        rejection_summary: selection.rejected
      };
    }

    await client.query('BEGIN');
    await client.query(
      `UPDATE properties
       SET extra_fields = (
         COALESCE(extra_fields, '{}'::jsonb)
         || jsonb_build_object(
           'featured', false,
           'featured_removed_at', NOW()::text,
           'featured_removed_by', $1::text
         )
       )
       WHERE COALESCE(extra_fields->>'featured', 'false') IN ('true', '1', 'yes')`,
      [actorId]
    );
    await client.query(
      `UPDATE properties
       SET extra_fields = (
         COALESCE(extra_fields, '{}'::jsonb)
         || jsonb_build_object(
           'featured', true,
           'featured_at', NOW()::text,
           'featured_by', $2::text,
           'featured_rotation_date', $3::text,
           'featured_rotation_marker', $4::text
         )
       )
       WHERE id = ANY($1::uuid[])`,
      [selectedIds, actorId, dateKey, FEATURED_ROTATION_MARKER]
    );
    await client.query(
      `INSERT INTO featured_rotation_runs (
         rotation_date, status, selected_count, selected_ids, rejection_summary,
         actor_id, started_at, completed_at, error_message
       ) VALUES ($1::date, 'completed', $2, $3::jsonb, $4::jsonb, $5, NOW(), NOW(), NULL)
       ON CONFLICT (rotation_date) DO UPDATE
         SET status = EXCLUDED.status,
             selected_count = EXCLUDED.selected_count,
             selected_ids = EXCLUDED.selected_ids,
             rejection_summary = EXCLUDED.rejection_summary,
             actor_id = EXCLUDED.actor_id,
             started_at = NOW(),
             completed_at = NOW(),
             error_message = NULL`,
      [dateKey, selectedIds.length, JSON.stringify(selectedIds), JSON.stringify(selection.rejected), actorId]
    );
    await writeRotationAudit(client, actorId, {
      marker: FEATURED_ROTATION_MARKER,
      rotation_date: dateKey,
      status: 'completed',
      selected_count: selectedIds.length,
      selected_ids: selectedIds,
      by_category: Object.fromEntries(
        FEATURED_CATEGORIES.map((category) => [category, selection.selected[category].map((row) => row.id)])
      ),
      rejection_summary: selection.rejected
    });
    await client.query('COMMIT');

    return {
      ok: true,
      changed: true,
      status: 'completed',
      rotation_date: dateKey,
      selected_count: selectedIds.length,
      selected_ids: selectedIds,
      by_category: Object.fromEntries(
        FEATURED_CATEGORIES.map((category) => [category, selection.selected[category].map((row) => row.id)])
      ),
      rejection_summary: selection.rejected
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_rollbackError) {}
    logger.error('Featured rotation failed', { error: error.message, code: error.code });
    throw error;
  } finally {
    if (lockHeld) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
      } catch (_unlockError) {}
    }
    client.release();
  }
}

async function tickFeaturedRotationScheduler(db, options = {}) {
  if (schedulerRunning) return { skipped: true, reason: 'already_running' };
  const timeZone = clean(process.env.FEATURED_ROTATION_TIMEZONE || DEFAULT_TIME_ZONE);
  const hour = Math.max(0, Math.min(23, Number(process.env.FEATURED_ROTATION_HOUR || DEFAULT_HOUR)));
  const now = options.now instanceof Date ? options.now : new Date();
  const local = timeZoneParts(now, timeZone);
  if (local.hour < hour) return { skipped: true, reason: 'before_daily_window', local };

  schedulerRunning = true;
  try {
    return await runFeaturedRotation(db, {
      now,
      timeZone,
      actorId: options.actorId || 'featured_rotation_scheduler'
    });
  } finally {
    schedulerRunning = false;
  }
}

function startFeaturedRotationScheduler(db) {
  if (
    schedulerTimer
    || !process.env.DATABASE_URL
    || process.env.FEATURED_ROTATION_SCHEDULER_ENABLED === 'false'
  ) return;
  const pollMs = Math.max(60_000, Number(process.env.FEATURED_ROTATION_POLL_MS || 60_000));
  schedulerTimer = setInterval(() => {
    tickFeaturedRotationScheduler(db).catch((error) => {
      logger.error('Featured rotation scheduler tick failed', { error: error.message });
    });
  }, pollMs);
  schedulerTimer.unref?.();
  setTimeout(() => {
    tickFeaturedRotationScheduler(db, { actorId: 'featured_rotation_scheduler_boot' }).catch((error) => {
      logger.error('Featured rotation boot tick failed', { error: error.message });
    });
  }, 15_000).unref?.();
  logger.info('Featured rotation scheduler armed', {
    marker: FEATURED_ROTATION_MARKER,
    timeZone: clean(process.env.FEATURED_ROTATION_TIMEZONE || DEFAULT_TIME_ZONE),
    hour: Math.max(0, Math.min(23, Number(process.env.FEATURED_ROTATION_HOUR || DEFAULT_HOUR))),
    pollMs
  });
}

module.exports = {
  FEATURED_ROTATION_MARKER,
  FEATURED_CATEGORIES,
  featuredCategory,
  featuredCleanliness,
  featuredPoolHealth,
  loadFeaturedRotationStatus,
  runFeaturedRotation,
  selectFeaturedCandidates,
  startFeaturedRotationScheduler,
  tickFeaturedRotationScheduler,
  timeZoneParts,
  titleLocationContradictsRow
};
