'use strict';

const { buildSouthAfricaSearchCorpus, summarizeSouthAfricaScaleCorpus } = require('./southAfricaScaleCorpusService');
const { envFlagEnabled } = require('../utils/harvestFeatureFlags');

const PILOT_SCOPE = Object.freeze({
  country_code: 'ZA',
  province: 'Gauteng',
  platforms: Object.freeze(['youtube', 'x']),
  tracks: Object.freeze(['agent', 'fsbo']),
  query_job_cap: 50,
  max_results_per_query: 10,
  harvested_row_cap: 500,
  target_auto_publish_rate: 0.8,
  pilot_auto_publish: false,
});

const PLATFORM_CONTROLS = Object.freeze({
  youtube: Object.freeze({
    allowed_methods: Object.freeze(['youtube_data_api_v3_search']),
    prohibited_methods: Object.freeze(['search_page_scraping', 'login_wall_bypass', 'rate_limit_evasion']),
    minimum_interval_ms: 1500,
    max_requests_per_day: 100,
    retry: Object.freeze({ max_attempts: 4, retry_statuses: [429, 500, 502, 503, 504], base_delay_ms: 5000, rate_limit_delay_ms: 60000, max_delay_ms: 900000 }),
  }),
  x: Object.freeze({
    allowed_methods: Object.freeze(['x_api_v2_recent_search']),
    prohibited_methods: Object.freeze(['search_page_scraping', 'login_wall_bypass', 'rate_limit_evasion']),
    minimum_interval_ms: 2000,
    max_requests_per_hour: 120,
    retry: Object.freeze({ max_attempts: 4, retry_statuses: [429, 500, 502, 503, 504], base_delay_ms: 5000, rate_limit_delay_ms: 60000, max_delay_ms: 900000 }),
  }),
});

function envText(name, env = process.env) {
  return String(env[name] || '').trim();
}

function platformAccessStatus(env = process.env) {
  const youtubeMethod = envText('ZA_YOUTUBE_ACCESS_METHOD', env).toLowerCase();
  const youtubeApproved = envFlagEnabled(env.ZA_YOUTUBE_SEARCH_ACCESS_APPROVED)
    && PLATFORM_CONTROLS.youtube.allowed_methods.includes(youtubeMethod)
    && Boolean(envText('YOUTUBE_API_KEY', env));
  const xMethod = envText('ZA_X_ACCESS_METHOD', env).toLowerCase();
  const xApproved = envFlagEnabled(env.ZA_X_API_ACCESS_APPROVED)
    && PLATFORM_CONTROLS.x.allowed_methods.includes(xMethod)
    && Boolean(envText('X_API_BEARER_TOKEN', env));
  return {
    youtube: {
      approved: youtubeApproved,
      method: youtubeMethod || 'not_declared',
      reason: youtubeApproved
        ? 'YouTube Data API v3 Search access is configured.'
        : 'YouTube pilot remains blocked until an API key and the approved YouTube Data API v3 Search method are configured.',
    },
    x: {
      approved: xApproved,
      method: xMethod || 'not_declared',
      reason: xApproved
        ? 'X API v2 recent-search access is configured.'
        : 'X pilot remains blocked until an X API bearer token, approved recent-search method, and cost approval are configured.',
    },
  };
}

function selectPilotQueries() {
  const rows = buildSouthAfricaSearchCorpus().corpus
    .filter((row) => row.province === PILOT_SCOPE.province && PILOT_SCOPE.tracks.includes(row.track));
  const buckets = new Map();
  for (const platform of PILOT_SCOPE.platforms) {
    for (const track of PILOT_SCOPE.tracks) {
      buckets.set(`${platform}:${track}`, rows.filter((row) => row.track === track));
    }
  }
  const selected = [];
  const keys = [...buckets.keys()];
  let index = 0;
  while (selected.length < PILOT_SCOPE.query_job_cap && keys.some((key) => buckets.get(key).length)) {
    const key = keys[index % keys.length];
    const [platform, track] = key.split(':');
    const row = buckets.get(key).shift();
    if (row) selected.push({ ...row, platform, track });
    index += 1;
  }
  return selected;
}

function estimatePilotCost({ requestCount = PILOT_SCOPE.harvested_row_cap, env = process.env } = {}) {
  const xPostReadCost = Number(env.ZA_X_POST_READ_COST_USD || 0.005);
  const safeXPostReadCost = Number.isFinite(xPostReadCost) && xPostReadCost >= 0 ? xPostReadCost : 0.005;
  const xPostReadUpperBound = Math.ceil((Number(requestCount) || 0) / PILOT_SCOPE.platforms.length);
  const youtubeRequestUpperBound = PILOT_SCOPE.query_job_cap / PILOT_SCOPE.platforms.length;
  const providerCost = Number((xPostReadUpperBound * safeXPostReadCost).toFixed(4));
  const currentMonthlySpend = Number(env.ZA_CURRENT_MONTHLY_SPEND_USD || 7.25);
  const monthlyCap = Number(env.ZA_MONTHLY_SPEND_CAP_USD || 13);
  return {
    request_count_upper_bound: Number(requestCount) || 0,
    youtube_search_request_upper_bound: youtubeRequestUpperBound,
    youtube_estimated_incremental_cost_usd: 0,
    x_post_read_upper_bound: xPostReadUpperBound,
    x_cost_usd_per_post_read: safeXPostReadCost,
    x_estimated_incremental_cost_usd: providerCost,
    estimated_incremental_provider_cost_usd: providerCost,
    current_monthly_spend_usd: currentMonthlySpend,
    monthly_cap_usd: monthlyCap,
    remaining_monthly_budget_usd: Number(Math.max(0, monthlyCap - currentMonthlySpend).toFixed(2)),
    within_cap: currentMonthlySpend + providerCost <= monthlyCap,
    requires_live_provider_console_confirmation: true,
  };
}

function buildPilotPlan(env = process.env) {
  const access = platformAccessStatus(env);
  const queries = selectPilotQueries();
  const cost = estimatePilotCost({ requestCount: PILOT_SCOPE.harvested_row_cap, env });
  const blockers = [
    !envFlagEnabled(env.HARVEST_AUTOMATION_ENABLED) ? 'HARVEST_AUTOMATION_ENABLED is off' : '',
    !envFlagEnabled(env.ZA_SCALE_PILOT_ENABLED) ? 'ZA_SCALE_PILOT_ENABLED is off' : '',
    !access.youtube.approved ? access.youtube.reason : '',
    !access.x.approved ? access.x.reason : '',
    !cost.within_cap ? 'Estimated monthly spend would exceed the approved USD 13 cap' : '',
  ].filter(Boolean);
  return {
    ok: blockers.length === 0,
    mode: 'controlled_pilot',
    scope: PILOT_SCOPE,
    access,
    platform_controls: PLATFORM_CONTROLS,
    selected_query_count: queries.length,
    selected_queries: queries,
    cost,
    blockers,
    stop_conditions: [
      'Stop at 500 harvested rows across all pilot buckets.',
      'Stop on any access-method mismatch, 401/403, repeated 429, or provider terms uncertainty.',
      'Stop before the next X page or read if the observed X cost would breach the approved wave budget.',
      'Stop before public auto-publication; pilot rows remain held until Dave passes the sampled audit.',
      'Stop if estimated or observed monthly spend would exceed USD 13.',
    ],
    full_scale_summary: summarizeSouthAfricaScaleCorpus(),
  };
}

function assertPilotCanRun(env = process.env) {
  const plan = buildPilotPlan(env);
  if (!plan.ok) {
    const error = new Error(`South Africa controlled pilot is blocked: ${plan.blockers.join(' | ')}`);
    error.code = 'ZA_SCALE_PILOT_BLOCKED';
    error.plan = plan;
    throw error;
  }
  return plan;
}

module.exports = {
  PILOT_SCOPE,
  PLATFORM_CONTROLS,
  assertPilotCanRun,
  buildPilotPlan,
  estimatePilotCost,
  platformAccessStatus,
  selectPilotQueries,
};
