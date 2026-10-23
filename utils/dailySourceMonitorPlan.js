'use strict';

const {
  harvestAutomationEnabled,
  tiktokSourceSweepEnabled,
} = require('./harvestFeatureFlags');

function normalizePlatforms(platforms) {
  const list = Array.isArray(platforms)
    ? platforms
    : String(platforms || '').split(',');
  const normalized = list
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .map((platform) => (platform === 'twitter' ? 'x' : platform));
  return normalized.length ? [...new Set(normalized)] : ['youtube', 'x'];
}

function dailySourceMonitorPlan({ env = process.env, platforms = ['youtube', 'x'] } = {}) {
  const harvestOn = harvestAutomationEnabled(env);
  const tiktokOn = tiktokSourceSweepEnabled(env);
  const requested = normalizePlatforms(platforms);
  const withTikTok = tiktokOn && !requested.includes('tiktok')
    ? [...requested, 'tiktok']
    : requested;
  const sweepPlatforms = withTikTok.filter((platform) => (
    platform === 'tiktok' ? tiktokOn : harvestOn
  ));
  const skipped = withTikTok
    .filter((platform) => !sweepPlatforms.includes(platform))
    .map((platform) => ({
      platform,
      reason: platform === 'tiktok' ? 'tiktok_source_sweep_disabled' : 'harvest_automation_disabled',
    }));
  return {
    harvest_enabled: harvestOn,
    tiktok_sweep_enabled: tiktokOn,
    requested_platforms: withTikTok,
    sweep_platforms: sweepPlatforms,
    skipped,
  };
}

module.exports = {
  dailySourceMonitorPlan,
};
