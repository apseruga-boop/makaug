'use strict';

// Published makaug fees. Code defaults are Arthur's rates (23 Oct 2026).
// AGENT_MONTHLY_FEE_UGX and AGENT_TRIAL_DAYS override those defaults when set.
// They are not required, and nothing here asks for them to be deleted.

const CODE_DEFAULTS = Object.freeze({
  currency: 'UGX',
  agentMonthlyUgx: 50000,
  agentTrialDays: 14,
  ownerListingMonthlyUgx: 20000,
  ownerFreeDays: 7,
  shortStayMonthlyUgx: 20000
});

function agentMonthlyUgx(env = process.env) {
  return Math.max(0, Number(env.AGENT_MONTHLY_FEE_UGX || CODE_DEFAULTS.agentMonthlyUgx) || CODE_DEFAULTS.agentMonthlyUgx);
}

function agentTrialDays(env = process.env) {
  const days = Math.round(Number(env.AGENT_TRIAL_DAYS || CODE_DEFAULTS.agentTrialDays));
  return Number.isFinite(days) && days >= 1 && days <= 366 ? days : CODE_DEFAULTS.agentTrialDays;
}

function ugxLabel(amount) {
  return `UGX ${Number(amount || 0).toLocaleString('en-US')}`;
}

function publishedPricing(env = process.env) {
  const agentMonthly = agentMonthlyUgx(env);
  const trialDays = agentTrialDays(env);
  const ownerMonthly = CODE_DEFAULTS.ownerListingMonthlyUgx;
  const ownerFreeDays = CODE_DEFAULTS.ownerFreeDays;
  const shortStayMonthly = CODE_DEFAULTS.shortStayMonthlyUgx;
  return {
    currency: CODE_DEFAULTS.currency,
    agent: {
      monthly_ugx: agentMonthly,
      trial_days: trialDays,
      per: 'month',
      includes_short_stays: true,
      label: `${ugxLabel(agentMonthly)} a month after ${trialDays} days free`
    },
    owner_listing: {
      monthly_ugx: ownerMonthly,
      free_days: ownerFreeDays,
      per: 'listing',
      label: `${ugxLabel(ownerMonthly)} per listing, per month after ${ownerFreeDays} free days`
    },
    short_stay: {
      monthly_ugx: shortStayMonthly,
      free_days: 0,
      per: 'month',
      applies_to: 'non_agent',
      included_in_agent_plan: true,
      label: `${ugxLabel(shortStayMonthly)} a month for non-agents. Included in the agent plan.`
    }
  };
}

module.exports = {
  CODE_DEFAULTS,
  agentMonthlyUgx,
  agentTrialDays,
  publishedPricing,
  ugxLabel
};
