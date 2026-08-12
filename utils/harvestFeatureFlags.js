'use strict';

function envFlagEnabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value == null ? '' : value).trim());
}

function harvestAutomationEnabled(env = process.env) {
  const countryCode = String(env.COUNTRY_CODE || 'UG').trim().toUpperCase();
  if (countryCode === 'ZA') {
    return envFlagEnabled(env.HARVEST_AUTOMATION_ENABLED)
      && envFlagEnabled(env.ZA_SCALE_HARVEST_ENABLED);
  }
  return envFlagEnabled(env.HARVEST_AUTOMATION_ENABLED);
}

function harvestPublicSubmissionsEnabled(env = process.env) {
  return envFlagEnabled(env.HARVEST_PUBLIC_SUBMISSIONS_ENABLED);
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
};
