'use strict';

function envFlagEnabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value == null ? '' : value).trim());
}

function harvestAutomationEnabled(env = process.env) {
  return envFlagEnabled(env.HARVEST_AUTOMATION_ENABLED);
}

function harvestPublicSubmissionsEnabled(env = process.env) {
  return envFlagEnabled(env.HARVEST_PUBLIC_SUBMISSIONS_ENABLED);
}

function tiktokSourceSweepEnabled(env = process.env) {
  return envFlagEnabled(env.TIKTOK_SOURCE_SWEEP_ENABLED);
}

// The in-process daily monitor is on unless this is explicitly turned off.
function sourceMonitorSchedulerEnabled(env = process.env) {
  const raw = env.SOURCE_MONITOR_SCHEDULER_ENABLED;
  if (raw == null || String(raw).trim() === '') return true;
  return !/^(0|false|no|off)$/i.test(String(raw).trim());
}

function applyHarvestPublicSubmissionVisibility(html, env = process.env) {
  const source = String(html || '');
  if (harvestPublicSubmissionsEnabled(env)) return source;
  return source.replace(
    /(<(?:button|div)\b(?=[^>]*\bdata-harvest-public-submission\b)[^>]*)(>)/gi,
    '$1 hidden aria-hidden="true" style="display:none!important"$2'
  );
}

module.exports = {
  applyHarvestPublicSubmissionVisibility,
  envFlagEnabled,
  harvestAutomationEnabled,
  harvestPublicSubmissionsEnabled,
  sourceMonitorSchedulerEnabled,
  tiktokSourceSweepEnabled,
};
