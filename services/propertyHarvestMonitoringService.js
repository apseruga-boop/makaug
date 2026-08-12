'use strict';

const { stablePlatformPostIdentity } = require('../utils/sourceUrlNormalization');

const ACTIVE_COUNTRY_CODE = String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase();

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
  requestCount = 0,
  estimatedCostUsd = 0,
} = {}) {
  if (!db?.query) return { ok: false, skipped: true, reason: 'missing_db_connection', recorded: 0 };
  const rows = Array.isArray(result.per_url_results)
    ? result.per_url_results
    : Array.isArray(result.import_result?.per_url_results)
      ? result.import_result.per_url_results
      : [];
  let recorded = 0;
  for (const [rowIndex, row] of rows.entries()) {
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
          country_code: clean(row.country_code || result.country_code || ACTIVE_COUNTRY_CODE).toUpperCase(),
          source_track: clean(row.source_track || row.seller_track || row.track || (row.private_seller ? 'fsbo' : 'agent')).toLowerCase(),
          source_query: clean(row.source_query || row.search_query || row.query || result.source_query),
          parsed_complete: row.parsed_complete === true || row.intake?.parsed_complete === true,
          complete_price: row.complete_price === true || row.intake?.complete_price === true,
          complete_location: row.complete_location === true || row.intake?.complete_location === true,
          complete_classification: row.complete_classification === true || row.intake?.complete_classification === true,
          auto_publish_eligible: row.auto_publish_eligible === true,
          auto_published: row.auto_live_ready === true || row.auto_published === true,
          human_review_required: row.human_review_required === true,
          auto_publish_blockers: Array.isArray(row.auto_publish_blockers) ? row.auto_publish_blockers : [],
          request_count: Number(row.request_count || (rowIndex === 0 ? requestCount : 0) || 0),
          estimated_cost_usd: Number(row.estimated_cost_usd || (rowIndex === 0 ? estimatedCostUsd : 0) || 0),
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
  const maxWindowDays = ACTIVE_COUNTRY_CODE === 'ZA' ? 183 : 90;
  const windowDays = Math.max(1, Math.min(maxWindowDays, Number(days) || 14));
  const [daily, sourceDaily, waveDaily, freshness, reasons, channels, submissions] = await Promise.all([
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
      `SELECT DATE_TRUNC('day', e.occurred_at) AS wave,
              e.platform,
              COALESCE(NULLIF(e.metadata->>'source_track', ''), 'agent') AS track,
              COUNT(DISTINCT NULLIF(e.metadata->>'source_query', ''))::int AS queries,
              COUNT(*)::int AS discovered,
              COUNT(*) FILTER (WHERE e.outcome = 'created')::int AS new,
              ROUND(100.0 * COUNT(*) FILTER (
                WHERE LOWER(COALESCE(e.metadata->>'parsed_complete', 'false')) IN ('true','1','yes')
              ) / NULLIF(COUNT(*), 0), 1) AS parsed_complete_pct,
              COUNT(*) FILTER (WHERE e.outcome = 'created' AND p.status = 'pending')::int AS queued,
              COUNT(*) FILTER (
                WHERE e.outcome = 'created'
                  AND LOWER(COALESCE(e.metadata->>'auto_publish_eligible', 'false')) IN ('true','1','yes')
              )::int AS auto_publish_eligible,
              COUNT(*) FILTER (
                WHERE e.outcome = 'created'
                  AND LOWER(COALESCE(e.metadata->>'auto_published', 'false')) IN ('true','1','yes')
                  AND p.status = 'approved'
              )::int AS auto_published,
              COUNT(*) FILTER (
                WHERE LOWER(COALESCE(e.metadata->>'human_review_required', 'false')) IN ('true','1','yes')
              )::int AS human_review_required,
              COALESCE(SUM(NULLIF(e.metadata->>'request_count', '')::numeric), 0)::int AS request_count,
              ROUND(COALESCE(SUM(NULLIF(e.metadata->>'estimated_cost_usd', '')::numeric), 0), 4) AS estimated_cost_usd,
              COUNT(*) FILTER (WHERE e.outcome = 'created' AND p.status = 'approved')::int AS live
       FROM property_harvest_events e
       LEFT JOIN properties p ON p.id = e.property_id
       WHERE e.occurred_at >= NOW() - ($1::int * INTERVAL '1 day')
         AND COALESCE(NULLIF(e.metadata->>'country_code', ''), $2) = $2
       GROUP BY 1,2,3
       ORDER BY wave DESC, platform, track`,
      [windowDays, ACTIVE_COUNTRY_CODE]
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
              COALESCE(NULLIF(metadata->>'source_track', ''), 'agent') AS track,
              COALESCE(NULLIF(metadata->>'classification', ''), reason, 'none') AS reason,
              COUNT(*)::int AS count
       FROM property_harvest_events
       WHERE occurred_at >= NOW() - ($1::int * INTERVAL '1 day')
         AND outcome IN ('skipped','failed')
         AND COALESCE(NULLIF(metadata->>'country_code', ''), $2) = $2
       GROUP BY platform, COALESCE(NULLIF(metadata->>'source_track', ''), 'agent'),
                COALESCE(NULLIF(metadata->>'classification', ''), reason, 'none')
       ORDER BY count DESC
       LIMIT 50`,
      [windowDays, ACTIVE_COUNTRY_CODE]
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
  ]);
  return {
    review_only: ACTIVE_COUNTRY_CODE !== 'ZA' || !/^(1|true|yes|on)$/i.test(String(process.env.ZA_CONFIDENCE_AUTO_PUBLISH_ENABLED || '')),
    confidence_auto_publish_policy: ACTIVE_COUNTRY_CODE === 'ZA',
    target_auto_publish_rate: ACTIVE_COUNTRY_CODE === 'ZA' ? 0.8 : null,
    window_days: windowDays,
    daily_counts: daily.rows,
    source_daily_counts: sourceDaily.rows,
    wave_counts: waveDaily.rows,
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
