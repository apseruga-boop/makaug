'use strict';

const { buildSouthAfricaSearchCorpus, summarizeSouthAfricaScaleCorpus } = require('./southAfricaScaleCorpusService');
const { envFlagEnabled } = require('../utils/harvestFeatureFlags');

const PILOT_SCOPE = Object.freeze({
  country_code: 'ZA',
  province: 'Gauteng',
  platforms: Object.freeze(['facebook', 'tiktok']),
  tracks: Object.freeze(['agent', 'fsbo']),
  query_job_cap: 50,
  max_results_per_query: 10,
  harvested_row_cap: 500,
  target_auto_publish_rate: 0.8,
  pilot_auto_publish: false,
});

const PLATFORM_CONTROLS = Object.freeze({
  facebook: Object.freeze({
    allowed_methods: Object.freeze(['official_graph_api', 'operator_supplied_exact_public_post']),
    prohibited_methods: Object.freeze(['browser_scraping', 'login_wall_bypass', 'rate_limit_evasion']),
    minimum_interval_ms: 3000,
    max_requests_per_hour: 120,
    retry: Object.freeze({ max_attempts: 4, retry_statuses: [429, 500, 502, 503, 504], base_delay_ms: 5000, rate_limit_delay_ms: 60000, max_delay_ms: 900000 }),
  }),
  tiktok: Object.freeze({
    allowed_methods: Object.freeze(['official_display_api_with_creator_consent', 'official_oembed_exact_video', 'approved_platform_export']),
    prohibited_methods: Object.freeze(['search_result_scraping', 'login_wall_bypass', 'rate_limit_evasion']),
    minimum_interval_ms: 2000,
    max_requests_per_hour: 120,
    retry: Object.freeze({ max_attempts: 4, retry_statuses: [429, 500, 502, 503, 504], base_delay_ms: 5000, rate_limit_delay_ms: 60000, max_delay_ms: 900000 }),
  }),
});

function envText(name, env = process.env) {
  return String(env[name] || '').trim();
}

function platformAccessStatus(env = process.env) {
  const facebookMethod = envText('ZA_FACEBOOK_GROUPS_ACCESS_METHOD', env).toLowerCase();
  const facebookApproved = envFlagEnabled(env.ZA_FACEBOOK_GROUPS_ACCESS_APPROVED)
    && PLATFORM_CONTROLS.facebook.allowed_methods.includes(facebookMethod)
    && (facebookMethod === 'operator_supplied_exact_public_post'
      || Boolean(envText('META_ACCESS_TOKEN', env) && envText('FACEBOOK_PAGE_IDS', env)));
  const tiktokMethod = envText('ZA_TIKTOK_ACCESS_METHOD', env).toLowerCase();
  const tiktokApproved = envFlagEnabled(env.ZA_TIKTOK_SOURCE_ACCESS_APPROVED)
    && PLATFORM_CONTROLS.tiktok.allowed_methods.includes(tiktokMethod)
    && (tiktokMethod === 'official_oembed_exact_video'
      || Boolean(envText('TIKTOK_DATA_SOURCE_URL', env) || envText('TIKTOK_ACCESS_TOKEN', env)));
  return {
    facebook: {
      approved: facebookApproved,
      method: facebookMethod || 'not_declared',
      reason: facebookApproved
        ? 'Approved access method and credentials are configured.'
        : 'Facebook Groups pilot remains blocked until an approved official method or operator-supplied exact public posts are documented and configured.',
    },
    tiktok: {
      approved: tiktokApproved,
      method: tiktokMethod || 'not_declared',
      reason: tiktokApproved
        ? 'Approved access method and source are configured.'
        : 'TikTok broad discovery remains blocked; Display API is creator-consent scoped and oEmbed only accepts known exact videos. Configure an approved source/export or exact-URL pilot.',
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
  const configuredUsdPerThousand = Number(env.ZA_SCALE_PROVIDER_COST_USD_PER_1000_REQUESTS || 0);
  const safeRate = Number.isFinite(configuredUsdPerThousand) && configuredUsdPerThousand >= 0
    ? configuredUsdPerThousand
    : 0;
  const providerCost = Number(((Number(requestCount) || 0) * safeRate / 1000).toFixed(4));
  const currentMonthlySpend = Number(env.ZA_CURRENT_MONTHLY_SPEND_USD || 7.25);
  const monthlyCap = Number(env.ZA_MONTHLY_SPEND_CAP_USD || 13);
  return {
    request_count_upper_bound: Number(requestCount) || 0,
    provider_cost_usd_per_1000_requests: safeRate,
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
    !access.facebook.approved ? access.facebook.reason : '',
    !access.tiktok.approved ? access.tiktok.reason : '',
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
