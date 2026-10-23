'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { dailySourceMonitorPlan } = require('../utils/dailySourceMonitorPlan');
const {
  LISTING_SOURCE_HEALTH_AUDIT_ACTION,
  buildListingSourceHealthReport,
  classifyDripState,
  classifyPlatformFreshness,
  classifySourceProbe,
  isDirectPublicSourceUrl,
  probeListingSources,
  selectDailyProbeSources,
} = require('../services/listingSourceHealthService');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('direct profile URLs are probed and search pages are not', () => {
  assert.equal(isDirectPublicSourceUrl('https://www.tiktok.com/@kampalahomes'), true);
  assert.equal(isDirectPublicSourceUrl('https://www.tiktok.com/tag/ugandarealestate'), false);
  assert.equal(isDirectPublicSourceUrl('https://www.tiktok.com/search?q=kira+house'), false);
  assert.equal(isDirectPublicSourceUrl('https://www.youtube.com/@agent'), true);
  assert.equal(isDirectPublicSourceUrl('https://www.youtube.com/results?search_query=kampala'), false);
  assert.equal(isDirectPublicSourceUrl('https://www.facebook.com/106671800937273'), true);
  assert.equal(isDirectPublicSourceUrl('https://www.facebook.com/search/groups/?q=kampala'), false);
  assert.equal(isDirectPublicSourceUrl('https://x.com/kampalahomes'), true);
  assert.equal(isDirectPublicSourceUrl('https://x.com/search?q=kampala'), false);
  const sources = [
    { key: 'search', url: 'https://www.tiktok.com/tag/land', platform: 'tiktok' },
    { key: 'profile', url: 'https://www.tiktok.com/@kampalahomes', platform: 'tiktok' },
  ];
  assert.deepEqual(selectDailyProbeSources(sources, { limit: 8 }).map((item) => item.key), ['profile']);
});

test('probe classification keeps login walls out of the broken list', () => {
  assert.equal(classifySourceProbe({ status: 404 }).classification, 'broken');
  assert.equal(classifySourceProbe({ status: 410 }).classification, 'broken');
  assert.equal(classifySourceProbe({ status: 403 }).classification, 'auth_wall');
  assert.equal(classifySourceProbe({ status: 302, location: 'https://www.tiktok.com/login' }).classification, 'auth_wall');
  assert.equal(classifySourceProbe({ status: 200 }).classification, 'ok');
  assert.equal(classifySourceProbe({ status: 503 }).classification, 'unreachable');
});

test('stale drips and quiet platforms are reported from stored dates', async () => {
  const now = new Date('2026-10-23T04:30:00.000Z');
  const blocked = classifyDripState({
    drip_key: 'x_source_drip',
    platform: 'x',
    enabled: false,
    status: 'blocked',
    pause_reason: 'x_monthly_read_cap_reached',
    last_run_at: '2026-10-12T17:57:00.000Z',
  }, now, 7);
  assert.equal(blocked.status, 'stale');
  assert.equal(blocked.reason, 'x_monthly_read_cap_reached');
  const fresh = classifyPlatformFreshness({
    platform: 'youtube',
    lastPropertyAt: '2026-10-22T10:00:00.000Z',
    now,
    staleAfterDays: 7,
  });
  assert.equal(fresh.status, 'fresh');
  const quiet = classifyPlatformFreshness({
    platform: 'tiktok',
    lastPropertyAt: '2026-10-01T06:00:00.000Z',
    now,
    staleAfterDays: 7,
  });
  assert.equal(quiet.status, 'stale');

  const queries = [];
  const db = {
    query: async (sql) => {
      queries.push(sql);
      if (sql.includes('source_drip_state')) {
        return { rows: [{
          drip_key: 'x_source_drip',
          platform: 'x',
          enabled: false,
          status: 'blocked',
          pause_reason: 'x_monthly_read_cap_reached',
          last_run_at: '2026-10-12T17:57:00.000Z',
        }] };
      }
      if (sql.includes('property_harvest_events')) return { rows: [] };
      if (sql.includes('FROM properties')) {
        return { rows: [{ platform: 'youtube', last_property_at: '2026-10-22T10:00:00.000Z' }] };
      }
      if (sql.includes('continuous_social_monitor_run')) return { rows: [] };
      return { rows: [] };
    },
  };
  const report = await buildListingSourceHealthReport({
    db,
    now,
    probes: [{
      platform: 'tiktok',
      source_key: 'gone-profile',
      source_name: 'Gone profile',
      source_url: 'https://www.tiktok.com/@gone',
      http_status: 404,
      status: 'broken',
      reason: 'http_404',
    }],
    tiktokSweepEnabled: false,
    sweepSkipped: [{ platform: 'youtube', reason: 'harvest_automation_disabled' }],
  });
  assert.equal(report.action, LISTING_SOURCE_HEALTH_AUDIT_ACTION);
  assert.equal(report.broken_count, 1);
  assert.equal(report.broken[0].source_key, 'gone-profile');
  assert.equal(report.stale.some((row) => row.reason === 'x_monthly_read_cap_reached'), true);
  assert.equal(report.stale.some((row) => row.platform === 'tiktok' && row.status === 'stale'), true);
  assert.equal(report.platforms.find((row) => row.platform === 'youtube').status, 'fresh');
  assert.equal(report.tiktok_sweep_enabled, false);
  assert.match(report.summary, /broken/);
  assert.equal(queries.length, 4);
});

test('a failed freshness query is a data gap, not a false stale report', async () => {
  const report = await buildListingSourceHealthReport({
    db: { query: async () => { throw new Error('timeout'); } },
    now: new Date('2026-10-23T04:30:00.000Z'),
    probes: [],
  });
  assert.equal(report.platforms.length, 0);
  assert.equal(report.stale_count, 0);
  assert.equal(report.data_gaps.length >= 2, true);
});

test('probes are HEAD requests with no credentials', async () => {
  const calls = [];
  const result = await probeListingSources({
    pacingMs: 0,
    sources: [
      { key: 'profile', name: 'Kampala Homes', platform: 'tiktok', url: 'https://www.tiktok.com/@kampalahomes' },
      { key: 'search', name: 'Search', platform: 'tiktok', url: 'https://www.tiktok.com/tag/kampala' },
    ],
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      assert.equal(options.method, 'HEAD');
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.headers.Cookie, undefined);
      return { status: 410, headers: { get: () => '' } };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(result.results[0].status, 'broken');
  assert.equal(result.results[0].reason, 'http_410');
});

test('the daily cron definition and staff report path are wired without WhatsApp', () => {
  const yaml = read('render.yaml');
  const monitor = read('scripts/run-continuous-social-monitor.js');
  const staff = read('routes/staff.js');
  const health = read('services/listingSourceHealthService.js');
  const app = read('assets/makaug-app.js');
  const scheduler = read('services/dailySourceMonitorScheduler.js');
  assert.match(yaml, /#\s*- type: cron/);
  assert.match(yaml, /#\s*name: makaug-daily-source-monitor/);
  assert.doesNotMatch(yaml, /^ {2}- type: cron/m);
  assert.match(scheduler, /Europe\/London/);
  assert.match(scheduler, /pg_try_advisory_lock/);
  assert.match(scheduler, /daily_source_monitor_ran/);
  assert.doesNotMatch(scheduler, /whatsapp/i);
  assert.match(monitor, /storeListingSourceHealthReport/);
  assert.match(monitor, /listing_source_health_report/);
  assert.doesNotMatch(monitor, /whatsapp/i);
  assert.match(staff, /listing_source_health_report/);
  assert.match(staff, /staffSourceMonitorPayload/);
  assert.match(staff, /05:30 Europe\/London/);
  assert.match(app, /staff-source-monitor-health/);
  assert.match(health, /channel: 'in_app'/);
  assert.doesNotMatch(health, /sendWhatsApp|waha/i);
  const plan = dailySourceMonitorPlan({
    env: { HARVEST_AUTOMATION_ENABLED: 'false', TIKTOK_SOURCE_SWEEP_ENABLED: 'false' },
    platforms: 'youtube,x',
  });
  assert.deepEqual(plan.sweep_platforms, []);
  assert.equal(plan.skipped.map((item) => item.reason).every((reason) => reason === 'harvest_automation_disabled'), true);
});
