'use strict';

const { stablePlatformPostIdentity } = require('../utils/sourceUrlNormalization');

function clean(value = '') {
  return String(value || '').trim();
}

function normalizedPlatform(value = '') {
  const platform = clean(value).toLowerCase();
  return platform === 'twitter' ? 'x' : (platform || 'unknown');
}

async function recordHarvestImportResult(db, result = {}, {
  eventType = 'source_import',
  sourceKey = '',
} = {}) {
  if (!db?.query) return { ok: false, skipped: true, reason: 'missing_db_connection', recorded: 0 };
  const rows = Array.isArray(result.per_url_results)
    ? result.per_url_results
    : Array.isArray(result.import_result?.per_url_results)
      ? result.import_result.per_url_results
      : [];
  let recorded = 0;
  for (const row of rows) {
    const identity = stablePlatformPostIdentity(row.source_url || '');
    await db.query(
      `INSERT INTO property_harvest_events (
         platform, source_key, source_url, source_platform_id,
         event_type, outcome, reason, property_id, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [
        normalizedPlatform(row.platform || identity.platform),
        clean(sourceKey || row.source_key || row.key) || null,
        clean(row.source_url) || null,
        identity.key || null,
        clean(eventType) || 'source_import',
        clean(row.outcome) || 'unknown',
        clean(row.reason) || null,
        row.property_id || null,
        JSON.stringify({
          status: row.status || '',
          moderation_stage: row.moderation_stage || '',
          title: row.title || '',
          raw_outcome: row.outcome || '',
          classification: row.classification || '',
        }),
      ]
    );
    recorded += 1;
  }
  return { ok: true, recorded };
}

async function loadHarvestSummary(db, { days = 14 } = {}) {
  const windowDays = Math.max(1, Math.min(90, Number(days) || 14));
  const [daily, sourceDaily, freshness, reasons, channels, submissions, checkedCoverage, checkedByPlatform] = await Promise.all([
    db.query(
      `SELECT DATE_TRUNC('day', occurred_at) AS day, platform, outcome, COUNT(*)::int AS count
       FROM property_harvest_events
       WHERE occurred_at >= NOW() - ($1::int * INTERVAL '1 day')
       GROUP BY 1,2,3
       ORDER BY day DESC, platform, outcome`,
      [windowDays]
    ),
    db.query(
      `SELECT DATE_TRUNC('day', e.occurred_at) AS day,
              e.platform,
              COALESCE(NULLIF(e.source_key, ''), 'unattributed') AS source_key,
              COUNT(*)::int AS discovered,
              COUNT(*) FILTER (WHERE e.outcome = 'created')::int AS imported,
              COUNT(*) FILTER (WHERE e.outcome = 'duplicate')::int AS duplicate,
              COUNT(*) FILTER (WHERE e.outcome IN ('skipped','failed'))::int AS dropped,
              COUNT(*) FILTER (WHERE e.outcome = 'created' AND p.status = 'approved')::int AS approved
       FROM property_harvest_events e
       LEFT JOIN properties p ON p.id = e.property_id
       WHERE e.occurred_at >= NOW() - ($1::int * INTERVAL '1 day')
       GROUP BY 1,2,3
       ORDER BY day DESC, platform, source_key`,
      [windowDays]
    ),
    db.query(
      `SELECT platform, MAX(occurred_at) AS newest_ingested_at,
              COUNT(*) FILTER (WHERE occurred_at >= NOW() - INTERVAL '24 hours')::int AS last_24h
       FROM property_harvest_events
       GROUP BY platform
       ORDER BY platform`
    ),
    db.query(
      `SELECT platform,
              COALESCE(NULLIF(metadata->>'classification', ''), reason, 'none') AS reason,
              COUNT(*)::int AS count
       FROM property_harvest_events
       WHERE occurred_at >= NOW() - ($1::int * INTERVAL '1 day')
         AND outcome IN ('skipped','failed')
       GROUP BY platform, COALESCE(NULLIF(metadata->>'classification', ''), reason, 'none')
       ORDER BY count DESC
       LIMIT 50`,
      [windowDays]
    ),
    db.query(
      `SELECT platform, subscription_status, COUNT(*)::int AS count,
              MAX(last_ingested_at) AS newest_ingested_at,
              MIN(last_checked_at) AS oldest_check_at
       FROM property_harvest_channels
       GROUP BY platform, subscription_status
       ORDER BY platform, subscription_status`
    ),
    db.query(
      `SELECT status, COUNT(*)::int AS count, MAX(created_at) AS newest_submission_at
       FROM property_harvest_submissions
       GROUP BY status
       ORDER BY status`
    ),
    db.query(
      `SELECT COUNT(*)::int AS event_count,
              COUNT(DISTINCT COALESCE(NULLIF(source_platform_id, ''), NULLIF(source_url, '')))::int AS unique_posts_checked,
              COUNT(*) FILTER (WHERE outcome = 'duplicate')::int AS duplicate_events,
              COUNT(DISTINCT COALESCE(NULLIF(source_platform_id, ''), NULLIF(source_url, '')))
                FILTER (WHERE occurred_at >= NOW() - ($1::int * INTERVAL '1 day'))::int AS unique_posts_checked_in_window,
              MIN(occurred_at) AS coverage_started_at,
              MAX(occurred_at) AS newest_check_at
       FROM property_harvest_events
       WHERE COALESCE(NULLIF(source_platform_id, ''), NULLIF(source_url, '')) IS NOT NULL`,
      [windowDays]
    ),
    db.query(
      `SELECT platform,
              COUNT(*)::int AS event_count,
              COUNT(DISTINCT COALESCE(NULLIF(source_platform_id, ''), NULLIF(source_url, '')))::int AS unique_posts_checked,
              COUNT(*) FILTER (WHERE outcome = 'duplicate')::int AS duplicate_events,
              MAX(occurred_at) AS newest_check_at
       FROM property_harvest_events
       WHERE COALESCE(NULLIF(source_platform_id, ''), NULLIF(source_url, '')) IS NOT NULL
       GROUP BY platform
       ORDER BY platform`
    ),
  ]);
  const coverageTarget = 30000;
  const coverage = checkedCoverage.rows[0] || {};
  const uniquePostsChecked = Number(coverage.unique_posts_checked || 0);
  return {
    review_only: true,
    window_days: windowDays,
    post_check_coverage: {
      target_unique_posts: coverageTarget,
      unique_posts_checked: uniquePostsChecked,
      unique_posts_remaining: Math.max(0, coverageTarget - uniquePostsChecked),
      percent_complete: coverageTarget ? Number(((uniquePostsChecked / coverageTarget) * 100).toFixed(2)) : 0,
      unique_posts_checked_in_window: Number(coverage.unique_posts_checked_in_window || 0),
      event_count: Number(coverage.event_count || 0),
      duplicate_events: Number(coverage.duplicate_events || 0),
      coverage_started_at: coverage.coverage_started_at || null,
      newest_check_at: coverage.newest_check_at || null,
      by_platform: checkedByPlatform.rows,
      counting_rule: 'Distinct exact platform post IDs or canonical exact post URLs only. Generated source pages, hashtag tasks, and repeated checks do not inflate this number.',
    },
    daily_counts: daily.rows,
    source_daily_counts: sourceDaily.rows,
    platform_freshness: freshness.rows,
    dropped_reasons: reasons.rows,
    channel_coverage: channels.rows,
    public_submissions: submissions.rows,
  };
}

module.exports = {
  loadHarvestSummary,
  recordHarvestImportResult,
};
