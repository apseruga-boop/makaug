'use strict';

const logger = require('../config/logger');
const { getPropertySourceRegistry, releasePropertySourceRegistryCache } = require('./propertySourceRegistryService');
const { logNotification } = require('./notificationLogService');

const LISTING_SOURCE_HEALTH_AUDIT_ACTION = 'listing_source_health_report';
const HEALTH_PLATFORMS = ['tiktok', 'youtube', 'x', 'facebook', 'instagram'];
const DEFAULT_STALE_AFTER_DAYS = 7;
const DEFAULT_PROBE_LIMIT = 8;
const DEFAULT_PROBE_PACING_MS = 1100;
const PROBE_USER_AGENT = 'makaug-found-online-source-review/1.0';

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function ageDays(value, now) {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return (now.getTime() - ms) / 86400000;
}

function newestIso(values = []) {
  let best = '';
  let bestMs = 0;
  for (const value of values) {
    const ms = Date.parse(value);
    if (!Number.isFinite(ms) || ms < bestMs) continue;
    bestMs = ms;
    best = new Date(ms).toISOString();
  }
  return best;
}

function platformKey(value = '') {
  const platform = String(value || '').trim().toLowerCase();
  return platform === 'twitter' ? 'x' : platform;
}

function isDirectPublicSourceUrl(value = '') {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch (_error) {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname || '/';
  const query = parsed.search || '';
  if (/search|hashtag|\/tag\/|marketplace|explore|\/results/i.test(`${path}${query}`)) return false;
  if (host === 'tiktok.com') return /\/@[^/]+\/?$/.test(path);
  if (host === 'youtube.com') return /\/@[^/]+\/?$/.test(path) || /\/channel\/[^/]+\/?$/.test(path);
  if (host === 'facebook.com' || host === 'fb.watch') {
    const parts = path.split('/').filter(Boolean);
    return parts.length >= 1 && !['watch', 'share', 'sharer.php'].includes(parts[0]);
  }
  if (host === 'x.com' || host === 'twitter.com') {
    const handle = path.split('/').filter(Boolean)[0] || '';
    return Boolean(handle) && !['home', 'explore', 'i', 'intent', 'share', 'search'].includes(handle.toLowerCase());
  }
  return false;
}

function selectDailyProbeSources(sources = [], { now = new Date(), limit = DEFAULT_PROBE_LIMIT } = {}) {
  const direct = (Array.isArray(sources) ? sources : []).filter((source) => (
    isDirectPublicSourceUrl(source?.url || source?.source_url)
  ));
  const capped = boundedInt(limit, DEFAULT_PROBE_LIMIT, 1, 20);
  if (direct.length <= capped) return direct;
  const day = Math.floor(now.getTime() / 86400000);
  const start = (day * capped) % direct.length;
  return [...direct.slice(start), ...direct.slice(0, start)].slice(0, capped);
}

function classifySourceProbe({ status = 0, location = '' } = {}) {
  const code = Number(status) || 0;
  const dest = String(location || '');
  if (code === 404 || code === 410) return { classification: 'broken', reason: `http_${code}` };
  if (code === 401 || code === 403) return { classification: 'auth_wall', reason: `http_${code}` };
  if (code === 429) return { classification: 'rate_limited', reason: 'http_429' };
  if (code >= 300 && code < 400 && /login|signup|checkpoint|captcha|challenge/i.test(dest)) {
    return { classification: 'auth_wall', reason: 'login_redirect' };
  }
  if (code >= 300 && code < 400) return { classification: 'redirect', reason: `http_${code}` };
  if (!code || code >= 500) return { classification: 'unreachable', reason: code ? `http_${code}` : 'request_failed' };
  return { classification: 'ok', reason: '' };
}

function classifyPlatformFreshness({ platform, lastEventAt = '', lastPropertyAt = '', now = new Date(), staleAfterDays = DEFAULT_STALE_AFTER_DAYS } = {}) {
  const lastActivityAt = newestIso([lastEventAt, lastPropertyAt]);
  const age = ageDays(lastActivityAt, now);
  if (!lastActivityAt || age == null) {
    return {
      kind: 'platform',
      platform,
      status: 'stale',
      reason: 'no_recorded_activity',
      last_activity_at: null,
      age_days: null,
    };
  }
  const stale = age > staleAfterDays;
  return {
    kind: 'platform',
    platform,
    status: stale ? 'stale' : 'fresh',
    reason: stale ? 'no_activity_within_window' : '',
    last_activity_at: lastActivityAt,
    age_days: Number(age.toFixed(1)),
  };
}

function classifyDripState(row = {}, now = new Date(), staleAfterDays = DEFAULT_STALE_AFTER_DAYS) {
  const pauseReason = String(row.pause_reason || '').trim();
  const status = String(row.status || '').trim().toLowerCase();
  const lastRunAt = row.last_run_at ? new Date(row.last_run_at).toISOString() : '';
  const age = ageDays(lastRunAt, now);
  const base = {
    kind: 'drip',
    platform: platformKey(row.platform),
    source_key: row.drip_key || '',
    source_name: row.drip_key || 'source drip',
    pause_reason: pauseReason,
    drip_status: status,
    last_run_at: lastRunAt || null,
    age_days: age == null ? null : Number(age.toFixed(1)),
  };
  if (pauseReason || status === 'blocked') {
    return { ...base, status: 'stale', reason: pauseReason || status || 'blocked' };
  }
  if (row.enabled === true && (age == null || age > staleAfterDays)) {
    return { ...base, status: 'stale', reason: age == null ? 'enabled_but_never_run' : 'last_run_outside_window' };
  }
  if (row.enabled !== true) return { ...base, status: 'paused', reason: 'drip_disabled' };
  return { ...base, status: 'fresh', reason: '' };
}

async function optionalQuery(db, sql, params = []) {
  if (!db?.query) return { ok: false, rows: [], reason: 'missing_db' };
  try {
    const result = await db.query(sql, params);
    return { ok: true, rows: result.rows || [], reason: '' };
  } catch (error) {
    return { ok: false, rows: [], reason: error?.code || error?.message || 'query_failed' };
  }
}

function probeRecord(source, classification, extra = {}) {
  return {
    kind: 'probe',
    platform: platformKey(source.platform),
    source_key: source.key || source.source_key || '',
    source_name: source.name || source.source_name || source.key || '',
    source_url: source.url || source.source_url || '',
    http_status: extra.http_status || null,
    status: classification.classification,
    reason: classification.reason,
  };
}

async function probeListingSources({
  sources = null,
  fetchImpl = fetch,
  now = new Date(),
  limit = DEFAULT_PROBE_LIMIT,
  pacingMs = DEFAULT_PROBE_PACING_MS,
  sleep = delay,
} = {}) {
  const loadedRegistry = !Array.isArray(sources);
  const registry = loadedRegistry ? getPropertySourceRegistry() : sources;
  const selected = selectDailyProbeSources(registry, { now, limit }).map((source) => ({ ...source }));
  // The probe only needs the handful of URLs it is about to HEAD. Drop the
  // 60,000-row registry before the paced requests so it can be collected.
  if (loadedRegistry) releasePropertySourceRegistryCache();
  const results = [];
  let paced = false;
  for (const source of selected) {
    const url = source.url || source.source_url;
    if (!paced) paced = true;
    else if (pacingMs > 0) await sleep(pacingMs);
    try {
      const response = await fetchImpl(url, {
        method: 'HEAD',
        redirect: 'manual',
        headers: {
          Accept: 'text/html',
          'User-Agent': PROBE_USER_AGENT,
        },
      });
      const location = typeof response?.headers?.get === 'function'
        ? response.headers.get('location') || ''
        : '';
      const classification = classifySourceProbe({ status: response?.status, location });
      results.push(probeRecord(source, classification, { http_status: Number(response?.status) || null }));
      if (classification.classification === 'rate_limited') break;
    } catch (error) {
      results.push(probeRecord(source, { classification: 'unreachable', reason: error?.message || 'request_failed' }));
    }
  }
  return {
    skipped: false,
    checked: results.length,
    note: selected.length
      ? 'HEAD requests against direct public profile, page, or channel URLs. HTTP 404 and 410 are broken. Login responses are auth walls, not broken sources. A 200 only means the URL answered.'
      : 'No direct public profile, page, or channel URLs were in the registry sample.',
    results,
  };
}

async function buildListingSourceHealthReport({
  db,
  now = new Date(),
  staleAfterDays = DEFAULT_STALE_AFTER_DAYS,
  probes = [],
  tiktokSweepEnabled = false,
  sweepSkipped = [],
} = {}) {
  const windowDays = boundedInt(staleAfterDays, DEFAULT_STALE_AFTER_DAYS, 1, 90);
  const [events, properties, drips, lastMonitor] = await Promise.all([
    optionalQuery(
      db,
      `SELECT LOWER(platform) AS platform, MAX(occurred_at) AS last_event_at
       FROM property_harvest_events
       GROUP BY LOWER(platform)`
    ),
    optionalQuery(
      db,
      `SELECT LOWER(COALESCE(extra_fields->>'source_platform', '')) AS platform,
              MAX(created_at) AS last_property_at
       FROM properties
       WHERE LOWER(COALESCE(extra_fields->>'source_platform', '')) IN ('tiktok','youtube','x','twitter','facebook','instagram')
       GROUP BY 1`
    ),
    optionalQuery(
      db,
      `SELECT drip_key, platform, enabled, status, pause_reason, last_run_at,
              monthly_read_count, monthly_read_cap
       FROM source_drip_state`
    ),
    optionalQuery(
      db,
      `SELECT created_at
       FROM audit_logs
       WHERE action = 'continuous_social_monitor_run'
       ORDER BY created_at DESC
       LIMIT 1`
    ),
  ]);
  const dataGaps = [
    events.ok ? '' : `harvest_events:${events.reason}`,
    properties.ok ? '' : `properties:${properties.reason}`,
    drips.ok ? '' : `drip_state:${drips.reason}`,
  ].filter(Boolean);
  const eventAt = new Map((events.rows || []).map((row) => [platformKey(row.platform), row.last_event_at]));
  const propertyAt = new Map();
  for (const row of properties.rows || []) {
    const key = platformKey(row.platform);
    const current = propertyAt.get(key);
    const candidate = row.last_property_at;
    if (!current || Date.parse(candidate) > Date.parse(current)) propertyAt.set(key, candidate);
  }
  const freshnessAvailable = events.ok && properties.ok;
  const platforms = freshnessAvailable
    ? HEALTH_PLATFORMS.map((platform) => classifyPlatformFreshness({
      platform,
      lastEventAt: eventAt.get(platform) || '',
      lastPropertyAt: propertyAt.get(platform) || '',
      now,
      staleAfterDays: windowDays,
    }))
    : [];
  const dripRows = drips.ok ? (drips.rows || []).map((row) => classifyDripState(row, now, windowDays)) : [];
  const probeRows = (Array.isArray(probes) ? probes : []).map((row) => ({
    kind: 'probe',
    platform: platformKey(row.platform),
    source_key: row.source_key || '',
    source_name: row.source_name || '',
    source_url: row.source_url || '',
    http_status: row.http_status || null,
    status: row.status || row.classification || '',
    reason: row.reason || '',
  }));
  const stale = [
    ...platforms.filter((row) => row.status === 'stale'),
    ...dripRows.filter((row) => row.status === 'stale'),
  ];
  const broken = probeRows.filter((row) => row.status === 'broken');
  const authWalls = probeRows.filter((row) => row.status === 'auth_wall');
  const unreachable = probeRows.filter((row) => row.status === 'unreachable');
  const summary = [
    `${broken.length} broken`,
    `${stale.length} stale`,
    `${authWalls.length} auth-walled`,
    `TikTok public sweep ${tiktokSweepEnabled ? 'on' : 'off'}`,
  ].join(', ');
  return {
    action: LISTING_SOURCE_HEALTH_AUDIT_ACTION,
    reported_at: now.toISOString(),
    stale_after_days: windowDays,
    summary,
    broken_count: broken.length,
    stale_count: stale.length,
    auth_wall_count: authWalls.length,
    unreachable_count: unreachable.length,
    tiktok_sweep_enabled: tiktokSweepEnabled === true,
    sweep_skipped: sweepSkipped,
    last_continuous_monitor_at: lastMonitor.rows?.[0]?.created_at || null,
    data_gaps: dataGaps,
    platforms,
    drips: dripRows,
    broken: broken.slice(0, 40),
    stale: stale.slice(0, 40),
    auth_walls: authWalls.slice(0, 20),
    unreachable: unreachable.slice(0, 20),
    probe_note: 'Broken means the public URL returned HTTP 404 or 410. Login and captcha responses are listed as auth walls. Stale means no harvest event or new source property inside the window, or a drip row is blocked or paused by its recorded reason.',
  };
}

async function storeListingSourceHealthReport(db, report = {}) {
  if (!db?.query) return { ok: false, reason: 'missing_db' };
  try {
    await db.query(
      `INSERT INTO audit_logs (actor_id, action, details)
       VALUES ($1, $2, $3::jsonb)`,
      ['daily_source_monitor', LISTING_SOURCE_HEALTH_AUDIT_ACTION, JSON.stringify(report || {})]
    );
  } catch (error) {
    logger.warn('listing source health audit failed', { error: error.message });
    return { ok: false, reason: error.message || 'audit_insert_failed' };
  }
  await logNotification(db, {
    channel: 'in_app',
    type: LISTING_SOURCE_HEALTH_AUDIT_ACTION,
    status: 'logged',
    payloadSummary: {
      summary: report.summary || '',
      broken_count: report.broken_count || 0,
      stale_count: report.stale_count || 0,
      reported_at: report.reported_at || null,
    },
  });
  const brokenLine = (report.broken || []).map((row) => (
    `${row.platform || 'source'}:${row.source_key || row.source_url || 'unknown'}:${row.reason || 'broken'}`
  )).join('; ');
  const staleLine = (report.stale || []).map((row) => (
    `${row.kind || 'source'}:${row.platform || ''}:${row.source_key || row.reason || 'stale'}`
  )).join('; ');
  logger.info(`listing_source_health ${report.summary || ''}`);
  if (brokenLine) logger.warn(`listing_source_broken ${brokenLine}`);
  if (staleLine) logger.warn(`listing_source_stale ${staleLine}`);
  return { ok: true };
}

module.exports = {
  DEFAULT_PROBE_LIMIT,
  DEFAULT_STALE_AFTER_DAYS,
  LISTING_SOURCE_HEALTH_AUDIT_ACTION,
  buildListingSourceHealthReport,
  classifyDripState,
  classifyPlatformFreshness,
  classifySourceProbe,
  isDirectPublicSourceUrl,
  probeListingSources,
  selectDailyProbeSources,
  storeListingSourceHealthReport,
};
