'use strict';

/**
 * Uganda source rotation: step 2 of the 30,000-listing plan.
 *
 * Rotates through every curated Uganda property hashtag / search term and every
 * creator discovered from them, on TikTok (public tag/profile pages + oEmbed)
 * and YouTube (API v3, free quota). Found videos go through the same exact
 * import as the staff "Import" button, so the #628 canonical-video locks and the
 * #637 harvest-time capture apply unchanged. Nothing publishes: every new row is
 * pending for staff review.
 *
 * Caps (editable by staff, stored in uganda_source_rotation_settings):
 *  - daily_cap (default 150) new pending items per UK day;
 *  - pauses while the pending review queue is over pending_pause_threshold (50);
 *  - youtube_daily_unit_budget (default 4500, under the free 10k and the 5k
 *    plan ceiling); a search costs ~101 units, a channel uploads read 1, the
 *    #637 capture of an imported YouTube video ~2;
 *  - a source is not re-fetched within min_reharvest_hours (default 24).
 *
 * Triggered by the staff button. An optional daily timer exists and is OFF by
 * default (timer_enabled = false).
 */

const curated = require('../config/ugandaPropertyHarvestSources');

const ROTATION_MARKER = 'uganda-source-rotation-20261103';
const DEFAULT_SETTINGS = Object.freeze({
  daily_cap: 150,
  pending_pause_threshold: 50,
  youtube_daily_unit_budget: 4500,
  min_reharvest_hours: 24,
  sources_per_run: 12,
  timer_enabled: false,
});
const YOUTUBE_SEARCH_UNITS = 101;
const YOUTUBE_CHANNEL_UPLOADS_UNITS = 1;
const YOUTUBE_CAPTURE_UNITS_PER_ITEM = 2;
const RUN_LEASE_MINUTES = 20;
const TIMER_POLL_MS = 60 * 60 * 1000;

function slug(value = '') {
  return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120);
}

function intIn(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function normalizeSettings(row = {}) {
  return {
    daily_cap: intIn(row.daily_cap, DEFAULT_SETTINGS.daily_cap, 0, 2000),
    pending_pause_threshold: intIn(row.pending_pause_threshold, DEFAULT_SETTINGS.pending_pause_threshold, 0, 100000),
    youtube_daily_unit_budget: intIn(row.youtube_daily_unit_budget, DEFAULT_SETTINGS.youtube_daily_unit_budget, 0, 5000),
    min_reharvest_hours: intIn(row.min_reharvest_hours, DEFAULT_SETTINGS.min_reharvest_hours, 1, 24 * 60),
    sources_per_run: intIn(row.sources_per_run, DEFAULT_SETTINGS.sources_per_run, 1, 60),
    timer_enabled: row.timer_enabled === true,
  };
}

function ukDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Every curated source, expanded into concrete platform sources. */
function buildCuratedSources(config = curated) {
  const out = [];
  const seen = new Set();
  const add = (row) => {
    if (seen.has(row.source_key)) return;
    seen.add(row.source_key);
    out.push(row);
  };
  for (const raw of config.hashtags || []) {
    const tag = String(raw).replace(/^#/, '').trim().toLowerCase();
    if (!tag) continue;
    add({ source_key: `tiktok:tag:${tag}`, platform: 'tiktok', kind: 'hashtag', value: `#${tag}`, source_url: `https://www.tiktok.com/tag/${encodeURIComponent(tag)}` });
    add({ source_key: `youtube:search:${slug(`#${tag}`)}`, platform: 'youtube', kind: 'hashtag', value: `#${tag}`, source_url: '' });
  }
  const terms = [...(config.searchTerms || [])];
  for (const place of config.places || []) {
    for (const kind of config.placeKinds || []) terms.push(`${place} ${kind}`);
  }
  for (const term of terms) {
    const value = String(term).trim();
    if (!value) continue;
    add({ source_key: `youtube:search:${slug(value)}`, platform: 'youtube', kind: 'search', value, source_url: '' });
  }
  return out;
}

/** Creators found in imported results become their own rotating sources. */
function creatorSourcesFromResults({ tiktokUrls = [], youtubePosts = [] } = {}) {
  const out = new Map();
  for (const url of tiktokUrls) {
    const m = String(url).match(/tiktok\.com\/@([A-Za-z0-9._-]+)\/video\//i);
    if (!m) continue;
    const handle = m[1].toLowerCase();
    out.set(`tiktok:creator:${handle}`, { source_key: `tiktok:creator:${handle}`, platform: 'tiktok', kind: 'creator', value: `@${handle}`, source_url: `https://www.tiktok.com/@${handle}` });
  }
  for (const post of youtubePosts) {
    const channelUrl = String(post?.source_page_url || '');
    const m = channelUrl.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{20,})/);
    if (!m) continue;
    out.set(`youtube:creator:${m[1]}`, { source_key: `youtube:creator:${m[1]}`, platform: 'youtube', kind: 'creator', value: String(post.source_name || m[1]).slice(0, 200), source_url: `https://www.youtube.com/channel/${m[1]}` });
  }
  return [...out.values()];
}

/**
 * Pick the sources for one run: never-harvested first, then the longest ago;
 * anything harvested within min_reharvest_hours is skipped.
 */
function selectSourcesForRun(sources = [], { now = new Date(), minReharvestHours = 24, limit = 12 } = {}) {
  const cutoff = now.getTime() - minReharvestHours * 3600 * 1000;
  return sources
    .filter((s) => s.enabled !== false)
    .filter((s) => !s.last_harvested_at || new Date(s.last_harvested_at).getTime() <= cutoff)
    .sort((a, b) => {
      const at = a.last_harvested_at ? new Date(a.last_harvested_at).getTime() : -Infinity;
      const bt = b.last_harvested_at ? new Date(b.last_harvested_at).getTime() : -Infinity;
      if (at !== bt) return at - bt;
      return String(a.source_key).localeCompare(String(b.source_key));
    })
    .slice(0, limit);
}

/** Decide whether a run may go ahead and how much it may take. */
function planRunBudget({ settings = DEFAULT_SETTINGS, queuedToday = 0, pendingCount = 0, youtubeUnitsToday = 0 } = {}) {
  const s = normalizeSettings(settings);
  const remainingItems = Math.max(0, s.daily_cap - Number(queuedToday || 0));
  const youtubeUnitsLeft = Math.max(0, s.youtube_daily_unit_budget - Number(youtubeUnitsToday || 0));
  if (Number(pendingCount) > s.pending_pause_threshold) {
    return { paused: true, reason: 'pending_queue_over_threshold', remainingItems, youtubeUnitsLeft };
  }
  if (remainingItems <= 0) return { paused: true, reason: 'daily_cap_reached', remainingItems, youtubeUnitsLeft };
  return { paused: false, reason: '', remainingItems, youtubeUnitsLeft };
}

function rowCount(result, key = 'n') {
  return Number(result?.rows?.[0]?.[key] || 0);
}

async function loadSettings(db) {
  const r = await db.query('SELECT * FROM uganda_source_rotation_settings WHERE id = 1');
  return normalizeSettings(r.rows[0] || {});
}

async function updateSettings(db, input = {}) {
  const current = await loadSettings(db);
  const next = normalizeSettings({ ...current, ...input, timer_enabled: input.timer_enabled === undefined ? current.timer_enabled : input.timer_enabled === true });
  await db.query(
    `INSERT INTO uganda_source_rotation_settings (id, daily_cap, pending_pause_threshold, youtube_daily_unit_budget, min_reharvest_hours, sources_per_run, timer_enabled, updated_at)
     VALUES (1, $1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (id) DO UPDATE SET daily_cap = $1, pending_pause_threshold = $2, youtube_daily_unit_budget = $3,
       min_reharvest_hours = $4, sources_per_run = $5, timer_enabled = $6, updated_at = NOW()`,
    [next.daily_cap, next.pending_pause_threshold, next.youtube_daily_unit_budget, next.min_reharvest_hours, next.sources_per_run, next.timer_enabled]
  );
  return next;
}

async function upsertSources(db, sources = [], discoveredFrom = '') {
  for (const s of sources) {
    await db.query(
      `INSERT INTO uganda_source_rotation_sources (source_key, platform, kind, value, source_url, discovered_from)
       VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''))
       ON CONFLICT (source_key) DO NOTHING`,
      [s.source_key, s.platform, s.kind, s.value, s.source_url || '', discoveredFrom]
    );
  }
}

async function loadDaily(db, day) {
  const r = await db.query('SELECT items_queued, youtube_units FROM uganda_source_rotation_daily WHERE day = $1', [day]);
  return { queuedToday: Number(r.rows[0]?.items_queued || 0), youtubeUnitsToday: Number(r.rows[0]?.youtube_units || 0) };
}

async function addDaily(db, day, { items = 0, units = 0, runs = 0 } = {}) {
  await db.query(
    `INSERT INTO uganda_source_rotation_daily (day, items_queued, youtube_units, runs) VALUES ($1, $2, $3, $4)
     ON CONFLICT (day) DO UPDATE SET items_queued = uganda_source_rotation_daily.items_queued + $2,
       youtube_units = uganda_source_rotation_daily.youtube_units + $3, runs = uganda_source_rotation_daily.runs + $4, updated_at = NOW()`,
    [day, items, units, runs]
  );
}

async function pendingQueueCount(db) {
  return rowCount(await db.query("SELECT COUNT(*)::int AS n FROM properties WHERE status = 'pending'"));
}

async function acquireRunLease(db) {
  const r = await db.query(
    `UPDATE uganda_source_rotation_settings SET run_lease_until = NOW() + ($1 || ' minutes')::interval
      WHERE id = 1 AND (run_lease_until IS NULL OR run_lease_until < NOW()) RETURNING id`,
    [String(RUN_LEASE_MINUTES)]
  );
  return r.rows.length === 1;
}

async function releaseRunLease(db) {
  await db.query('UPDATE uganda_source_rotation_settings SET run_lease_until = NULL WHERE id = 1');
}

function defaultDeps() {
  const discovery = require('./socialPlatformPostDiscoveryService');
  const { fetchTikTokPublicSourcePosts } = require('./tiktokPublicSweepService');
  return {
    apiKey: (discovery.YOUTUBE_API_KEY_ENV_NAMES || []).map((n) => process.env[n]).find(Boolean) || '',
    async fetchTikTok(source) {
      const result = await fetchTikTokPublicSourcePosts({ enabled: true, sources: [{ source_key: source.source_key, source_name: source.value, source_url: source.source_url }] });
      const urls = (result.posts || []).map((p) => p.post_url || p.source_url || p.url).filter(Boolean);
      return { urls, note: result.skipped_reason || (result.auth_wall_sources?.length ? 'auth_wall' : '') };
    },
    async youtubeSearch(source, apiKey) {
      const r = await discovery.fetchYouTubeSearchJob({ query: source.value, source_key: source.source_key, source_name: source.value }, { apiKey, maxResults: 25, commentLookupBudget: { remaining: 0 } });
      return { posts: r.posts || [], note: r.ok ? '' : (r.reason || 'youtube_search_failed'), quotaExceeded: /quota/i.test(`${r.reason} ${r.error_reason}`) };
    },
    async youtubeChannelUploads(source, apiKey) {
      const channelId = source.source_key.split(':').pop();
      const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
      url.searchParams.set('part', 'contentDetails');
      url.searchParams.set('maxResults', '25');
      url.searchParams.set('playlistId', `UU${channelId.slice(2)}`);
      url.searchParams.set('key', apiKey);
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const body = await res.json().catch(() => ({}));
      const posts = (body.items || []).map((i) => i.contentDetails?.videoId).filter(Boolean)
        .map((id) => ({ post_url: `https://www.youtube.com/watch?v=${id}`, source_page_url: source.source_url, source_name: source.value }));
      return { posts, note: res.ok ? '' : (body?.error?.message || 'youtube_uploads_failed'), quotaExceeded: /quota/i.test(JSON.stringify(body?.error || '')) };
    },
    async importUrls(db, urls) {
      return discovery.importExactSocialSourcePosts({ db, urls, dryRun: false, fetchOembed: true, fetchPublicMetadata: false, skipImageHashLookup: true });
    },
    async recordImport(db, result) {
      const { recordHarvestImportResult } = require('./propertyHarvestMonitoringService');
      return recordHarvestImportResult(db, result, { eventType: 'uganda_source_rotation' });
    },
  };
}

/** One rotation run. Safe to call from the staff button or the optional timer. */
async function runUgandaSourceRotation(db, { now = new Date(), deps = defaultDeps(), trigger = 'staff' } = {}) {
  await upsertSources(db, buildCuratedSources());
  const settings = await loadSettings(db);
  const day = ukDay(now);
  const daily = await loadDaily(db, day);
  const pendingCount = await pendingQueueCount(db);
  const budget = planRunBudget({ settings, pendingCount, ...daily });
  const summary = { marker: ROTATION_MARKER, trigger, day, settings, pending_count: pendingCount, ...daily, paused: budget.paused, reason: budget.reason, sources: [], items_queued: 0, youtube_units: 0, creators_discovered: 0, auto_live_properties: 0 };
  if (budget.paused) return summary;
  if (!(await acquireRunLease(db))) return { ...summary, paused: true, reason: 'run_already_in_progress' };
  try {
    const all = (await db.query('SELECT source_key, platform, kind, value, source_url, last_harvested_at, enabled FROM uganda_source_rotation_sources')).rows;
    let remaining = budget.remainingItems;
    let unitsLeft = budget.youtubeUnitsLeft;
    let youtubeBlocked = !deps.apiKey;
    const picked = selectSourcesForRun(all.filter((s) => s.platform !== 'youtube' || !youtubeBlocked), { now, minReharvestHours: settings.min_reharvest_hours, limit: settings.sources_per_run });
    for (const source of picked) {
      if (remaining <= 0) break;
      const report = { source_key: source.source_key, urls_found: 0, queued: 0, note: '' };
      let urls = [];
      let youtubePosts = [];
      try {
        if (source.platform === 'tiktok') {
          const r = await deps.fetchTikTok(source);
          urls = r.urls || [];
          report.note = r.note || '';
        } else {
          const cost = source.kind === 'creator' ? YOUTUBE_CHANNEL_UPLOADS_UNITS : YOUTUBE_SEARCH_UNITS;
          if (youtubeBlocked || unitsLeft < cost + YOUTUBE_CAPTURE_UNITS_PER_ITEM) { report.note = 'youtube_budget_left_for_today'; summary.sources.push(report); continue; }
          const r = source.kind === 'creator' ? await deps.youtubeChannelUploads(source, deps.apiKey) : await deps.youtubeSearch(source, deps.apiKey);
          unitsLeft -= cost;
          summary.youtube_units += cost;
          if (r.quotaExceeded) youtubeBlocked = true;
          youtubePosts = r.posts || [];
          urls = youtubePosts.map((p) => p.post_url).filter(Boolean);
          report.note = r.note || '';
        }
      } catch (error) {
        report.note = `fetch_failed: ${String(error.message || error).slice(0, 200)}`;
      }
      urls = [...new Set(urls)];
      report.urls_found = urls.length;
      if (source.platform === 'youtube') {
        const affordable = Math.floor(unitsLeft / YOUTUBE_CAPTURE_UNITS_PER_ITEM);
        urls = urls.slice(0, affordable);
      }
      const batch = urls.slice(0, Math.min(remaining, 25));
      if (batch.length) {
        const result = await deps.importUrls(db, batch);
        if (Number(result?.created_auto_live_properties || 0) !== 0 || Number(result?.auto_live_properties || 0) !== 0) {
          throw Object.assign(new Error('Review-only safety check failed: rotation import reported automatic publication.'), { status: 503 });
        }
        const created = Number(result?.created_properties || 0);
        report.queued = created;
        remaining -= created;
        summary.items_queued += created;
        if (source.platform === 'youtube') {
          const units = batch.length * YOUTUBE_CAPTURE_UNITS_PER_ITEM;
          unitsLeft -= units;
          summary.youtube_units += units;
        }
        await deps.recordImport?.(db, result)?.catch?.(() => {});
        const creators = creatorSourcesFromResults({ tiktokUrls: source.platform === 'tiktok' ? batch : [], youtubePosts })
          .filter((c) => c.source_key !== source.source_key);
        if (creators.length) {
          const before = all.length;
          await upsertSources(db, creators, source.source_key);
          summary.creators_discovered += creators.length;
          void before;
        }
      }
      await db.query(
        'UPDATE uganda_source_rotation_sources SET last_harvested_at = $2, last_result = $3::jsonb, harvest_count = harvest_count + 1 WHERE source_key = $1',
        [source.source_key, now.toISOString(), JSON.stringify(report)]
      );
      summary.sources.push(report);
    }
    await addDaily(db, day, { items: summary.items_queued, units: summary.youtube_units, runs: 1 });
    if (remaining <= 0) summary.reason = 'daily_cap_reached';
    return summary;
  } finally {
    await releaseRunLease(db).catch(() => {});
  }
}

async function getUgandaSourceRotationStatus(db, { now = new Date() } = {}) {
  await upsertSources(db, buildCuratedSources());
  const settings = await loadSettings(db);
  const day = ukDay(now);
  const daily = await loadDaily(db, day);
  const pendingCount = await pendingQueueCount(db);
  const counts = (await db.query(
    `SELECT platform, kind, COUNT(*)::int AS total, COUNT(last_harvested_at)::int AS harvested
       FROM uganda_source_rotation_sources GROUP BY platform, kind ORDER BY platform, kind`
  )).rows;
  return { marker: ROTATION_MARKER, day, settings, pending_count: pendingCount, ...daily, budget: planRunBudget({ settings, pendingCount, ...daily }), sources: counts };
}

let timer = null;
/** Optional daily timer: polls hourly, runs at most once per UK day, only when staff switch timer_enabled on. */
function startUgandaSourceRotationTimer(db, { logger = console } = {}) {
  if (timer) return timer;
  timer = setInterval(async () => {
    try {
      const settings = await loadSettings(db);
      if (!settings.timer_enabled) return;
      const daily = await db.query('SELECT runs FROM uganda_source_rotation_daily WHERE day = $1', [ukDay()]);
      if (Number(daily.rows[0]?.runs || 0) > 0) return;
      await runUgandaSourceRotation(db, { trigger: 'daily_timer' });
    } catch (error) {
      if (error?.code !== '42P01') logger.warn?.('Uganda source rotation timer failed', { message: error.message });
    }
  }, TIMER_POLL_MS);
  timer.unref?.();
  return timer;
}

module.exports = {
  DEFAULT_SETTINGS,
  ROTATION_MARKER,
  YOUTUBE_SEARCH_UNITS,
  buildCuratedSources,
  creatorSourcesFromResults,
  getUgandaSourceRotationStatus,
  normalizeSettings,
  planRunBudget,
  runUgandaSourceRotation,
  selectSourcesForRun,
  startUgandaSourceRotationTimer,
  ukDay,
  updateSettings,
};
