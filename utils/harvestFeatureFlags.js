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

module.exports = {
  envFlagEnabled,
  harvestAutomationEnabled,
  harvestPublicSubmissionsEnabled,
};
