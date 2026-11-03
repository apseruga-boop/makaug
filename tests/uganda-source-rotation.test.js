'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const svc = require('../services/ugandaSourceRotationService');
const curated = require('../config/ugandaPropertyHarvestSources');

function fakeDb({ pending = 0, settings = {} } = {}) {
  const state = {
    sources: new Map(),
    daily: new Map(),
    settings: { id: 1, ...svc.DEFAULT_SETTINGS, ...settings, run_lease_until: null },
    pending,
  };
  return {
    state,
    async query(sql, params = []) {
      const q = sql.replace(/\s+/g, ' ').trim();
      if (q.startsWith('INSERT INTO uganda_source_rotation_sources')) {
        const [key, platform, kind, value, url, from] = params;
        if (!state.sources.has(key)) state.sources.set(key, { source_key: key, platform, kind, value, source_url: url, discovered_from: from || null, last_harvested_at: null, enabled: true, harvest_count: 0 });
        return { rows: [] };
      }
      if (q.startsWith('SELECT * FROM uganda_source_rotation_settings')) return { rows: [state.settings] };
      if (q.startsWith('UPDATE uganda_source_rotation_settings SET run_lease_until = NOW()')) {
        if (state.settings.run_lease_until) return { rows: [] };
        state.settings.run_lease_until = 'leased';
        return { rows: [{ id: 1 }] };
      }
      if (q.startsWith('UPDATE uganda_source_rotation_settings SET run_lease_until = NULL')) { state.settings.run_lease_until = null; return { rows: [] }; }
      if (q.startsWith('INSERT INTO uganda_source_rotation_settings')) {
        const [daily_cap, pending_pause_threshold, youtube_daily_unit_budget, min_reharvest_hours, sources_per_run, timer_enabled] = params;
        Object.assign(state.settings, { daily_cap, pending_pause_threshold, youtube_daily_unit_budget, min_reharvest_hours, sources_per_run, timer_enabled });
        return { rows: [] };
      }
      if (q.startsWith('SELECT items_queued, youtube_units FROM uganda_source_rotation_daily')) {
        const d = state.daily.get(params[0]);
        return { rows: d ? [d] : [] };
      }
      if (q.startsWith('SELECT runs FROM uganda_source_rotation_daily')) {
        const d = state.daily.get(params[0]);
        return { rows: d ? [d] : [] };
      }
      if (q.startsWith('INSERT INTO uganda_source_rotation_daily')) {
        const [day, items, units, runs] = params;
        const d = state.daily.get(day) || { items_queued: 0, youtube_units: 0, runs: 0 };
        d.items_queued += items; d.youtube_units += units; d.runs += runs;
        state.daily.set(day, d);
        return { rows: [] };
      }
      if (q.startsWith("SELECT COUNT(*)::int AS n FROM properties WHERE status = 'pending'")) return { rows: [{ n: state.pending }] };
      if (q.startsWith('SELECT source_key, platform, kind, value, source_url, last_harvested_at, enabled FROM uganda_source_rotation_sources')) {
        return { rows: [...state.sources.values()].map((s) => ({ ...s })) };
      }
      if (q.startsWith('UPDATE uganda_source_rotation_sources SET last_harvested_at')) {
        const s = state.sources.get(params[0]);
        s.last_harvested_at = params[1];
        s.last_result = JSON.parse(params[2]);
        s.harvest_count += 1;
        return { rows: [] };
      }
      if (q.startsWith('SELECT platform, kind, COUNT(*)')) return { rows: [] };
      throw new Error(`unexpected SQL: ${q}`);
    },
  };
}

function fakeDeps({ perSource = 10, apiKey = 'k' } = {}) {
  const calls = { tiktok: [], search: [], uploads: [], imports: [] };
  let n = 0;
  return {
    calls,
    deps: {
      apiKey,
      async fetchTikTok(source) {
        calls.tiktok.push(source.source_key);
        return { urls: Array.from({ length: perSource }, () => `https://www.tiktok.com/@creator${n % 3}/video/70000000000${String(n++).padStart(8, "0")}`) };
      },
      async youtubeSearch(source) {
        calls.search.push(source.source_key);
        return { posts: Array.from({ length: perSource }, () => ({ post_url: `https://www.youtube.com/watch?v=v${n++}`, source_page_url: 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', source_name: 'Kampala Homes' })) };
      },
      async youtubeChannelUploads(source) {
        calls.uploads.push(source.source_key);
        return { posts: [] };
      },
      async importUrls(_db, urls) {
        calls.imports.push(urls);
        return { created_properties: urls.length, created_auto_live_properties: 0, auto_live_properties: 0 };
      },
    },
  };
}

test('curated list covers the required hashtags, Luganda terms and district/town combinations', () => {
  const sources = svc.buildCuratedSources();
  const keys = new Set(sources.map((s) => s.source_key));
  for (const tag of ['ugandarealestate', 'landforsaleinuganda', 'housesforsaleinkampala', 'kampalarentals']) {
    assert.ok(keys.has(`tiktok:tag:${tag}`), tag);
    assert.ok(keys.has(`youtube:search:${tag}`), tag);
  }
  assert.ok(sources.some((s) => s.value === 'Mukono land for sale'));
  assert.ok(sources.some((s) => s.value === 'Ntinda house for sale'));
  assert.ok(sources.some((s) => s.value === 'Kira rent'));
  assert.ok(sources.some((s) => /ettaka/i.test(s.value)), 'Luganda search term');
  assert.equal(keys.size, sources.length, 'source keys unique');
  assert.ok(sources.every((s) => s.platform !== 'tiktok' || s.source_url.startsWith('https://www.tiktok.com/tag/')));
  assert.ok(curated.places.length >= 30);
});

test('selectSourcesForRun picks never-harvested first, then oldest, and skips recently harvested', () => {
  const now = new Date('2026-11-03T12:00:00Z');
  const picked = svc.selectSourcesForRun([
    { source_key: 'a', last_harvested_at: '2026-11-03T06:00:00Z' },
    { source_key: 'b', last_harvested_at: '2026-11-01T06:00:00Z' },
    { source_key: 'c', last_harvested_at: null },
    { source_key: 'd', last_harvested_at: '2026-10-30T06:00:00Z' },
    { source_key: 'e', last_harvested_at: null, enabled: false },
  ], { now, minReharvestHours: 24, limit: 10 });
  assert.deepEqual(picked.map((s) => s.source_key), ['c', 'd', 'b']);
});

test('planRunBudget enforces the daily cap and the pending-queue pause', () => {
  assert.equal(svc.planRunBudget({ queuedToday: 0, pendingCount: 10 }).remainingItems, 150);
  assert.deepEqual(svc.planRunBudget({ queuedToday: 150, pendingCount: 0 }).reason, 'daily_cap_reached');
  assert.deepEqual(svc.planRunBudget({ queuedToday: 0, pendingCount: 51 }).reason, 'pending_queue_over_threshold');
  assert.equal(svc.planRunBudget({ queuedToday: 0, pendingCount: 50 }).paused, false);
  assert.equal(svc.normalizeSettings({ youtube_daily_unit_budget: 99999 }).youtube_daily_unit_budget, 5000, 'YouTube budget can never exceed 5k units');
  assert.equal(svc.DEFAULT_SETTINGS.timer_enabled, false, 'daily timer off by default');
});

test('creators are discovered from TikTok video URLs and YouTube channel results', () => {
  const creators = svc.creatorSourcesFromResults({
    tiktokUrls: ['https://www.tiktok.com/@Kampala.Homes/video/7123456789012345678'],
    youtubePosts: [{ source_page_url: 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv', source_name: 'Homes UG' }],
  });
  assert.deepEqual(creators.map((c) => c.source_key).sort(), ['tiktok:creator:kampala.homes', 'youtube:creator:UCabcdefghijklmnopqrstuv']);
});

test('a run stops at the daily cap, records last-harvested time, discovers creators and does not refetch', async () => {
  const db = fakeDb({ settings: { daily_cap: 25, sources_per_run: 10 } });
  const { deps, calls } = fakeDeps({ perSource: 10 });
  const now = new Date('2026-11-03T09:00:00Z');
  const run = await svc.runUgandaSourceRotation(db, { now, deps });
  assert.equal(run.items_queued, 25);
  assert.equal(run.reason, 'daily_cap_reached');
  assert.ok(calls.imports.flat().length === 25);
  assert.ok(run.creators_discovered > 0);
  assert.ok([...db.state.sources.values()].some((s) => s.kind === 'creator' && s.discovered_from));
  const harvested = [...db.state.sources.values()].filter((s) => s.last_harvested_at).map((s) => s.source_key);
  assert.equal(harvested.length, run.sources.length);
  assert.equal(db.state.settings.run_lease_until, null, 'lease released');

  const again = await svc.runUgandaSourceRotation(db, { now, deps });
  assert.equal(again.paused, true);
  assert.equal(again.reason, 'daily_cap_reached');
  assert.equal(calls.imports.length, 3, 'nothing more imported once the cap is hit');

  db.state.daily.clear();
  const nextDay = await svc.runUgandaSourceRotation(db, { now: new Date('2026-11-03T10:00:00Z'), deps });
  for (const s of nextDay.sources) assert.ok(!harvested.includes(s.source_key), `${s.source_key} re-fetched inside 24h`);
});

test('a run pauses when the pending queue is over 50 and fetches nothing', async () => {
  const db = fakeDb({ pending: 51 });
  const { deps, calls } = fakeDeps();
  const run = await svc.runUgandaSourceRotation(db, { deps });
  assert.equal(run.paused, true);
  assert.equal(run.reason, 'pending_queue_over_threshold');
  assert.equal(calls.tiktok.length + calls.search.length, 0);
});

test('YouTube searches stay inside the daily unit budget', async () => {
  const db = fakeDb({ settings: { daily_cap: 2000, sources_per_run: 60, youtube_daily_unit_budget: 350 } });
  const { deps, calls } = fakeDeps({ perSource: 1 });
  deps.fetchTikTok = async () => ({ urls: [] });
  const run = await svc.runUgandaSourceRotation(db, { deps });
  assert.ok(run.youtube_units <= 350, `used ${run.youtube_units}`);
  assert.ok(calls.search.length >= 1 && calls.search.length <= 3);
});

test('an import that reports automatic publication aborts the run', async () => {
  const db = fakeDb();
  const { deps } = fakeDeps();
  deps.importUrls = async () => ({ created_properties: 1, created_auto_live_properties: 1 });
  await assert.rejects(() => svc.runUgandaSourceRotation(db, { deps }), /Review-only/);
  assert.equal(db.state.settings.run_lease_until, null);
});

test('a second concurrent run is refused while the lease is held', async () => {
  const db = fakeDb();
  db.state.settings.run_lease_until = 'leased';
  const { deps, calls } = fakeDeps();
  const run = await svc.runUgandaSourceRotation(db, { deps });
  assert.equal(run.reason, 'run_already_in_progress');
  assert.equal(calls.imports.length, 0);
});

test('wiring: staff routes, staff buttons, timer off by default, imports through the exact importer', () => {
  const root = path.join(__dirname, '..');
  const staff = fs.readFileSync(path.join(root, 'routes/staff.js'), 'utf8');
  assert.match(staff, /router\.post\('\/harvest\/uganda-rotation\/run'/);
  assert.match(staff, /router\.get\('\/harvest\/uganda-rotation'/);
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /onclick="staffRunUgandaRotation\(\)"/);
  const app = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');
  assert.match(app, /\/api\/staff\/harvest\/uganda-rotation\/run/);
  const migration = fs.readFileSync(path.join(root, 'db/migrations/199_uganda_source_rotation.sql'), 'utf8');
  assert.match(migration, /timer_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration, /daily_cap INTEGER NOT NULL DEFAULT 150/);
  const src = fs.readFileSync(path.join(root, 'services/ugandaSourceRotationService.js'), 'utf8');
  assert.match(src, /importExactSocialSourcePosts/);
  assert.doesNotMatch(src, /whatsapp/i);
});
