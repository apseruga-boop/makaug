'use strict';

// Published makaug fees.
// From 10 Nov 2026 there is no automatic free period: agents pay UGX 50,000
// a month, and an ordinary owner pays UGX 20,000 per listing per month from
// the day the listing is approved. AGENT_TRIAL_DAYS is no longer applied.
// Listings that went live before that date keep the old 7 free days; that
// is computed from the listing date, not by rewriting stored rows.
// A staff member can still waive a fee or grant a free period by hand.

const STRAIGHT_PAY_FROM = '2026-11-10';
const LEGACY_OWNER_FREE_DAYS = 7;

const CODE_DEFAULTS = Object.freeze({
  currency: 'UGX',
  agentMonthlyUgx: 50000,
  agentTrialDays: 0,
  ownerListingMonthlyUgx: 20000,
  ownerFreeDays: 0,
  shortStayMonthlyUgx: 20000
});

function agentMonthlyUgx(env = process.env) {
  return Math.max(0, Number(env.AGENT_MONTHLY_FEE_UGX || CODE_DEFAULTS.agentMonthlyUgx) || CODE_DEFAULTS.agentMonthlyUgx);
}

function agentTrialDays() {
  return 0;
}

function kampalaCalendarDay(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Date(date.getTime() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

// Listings that went live before 10 Nov 2026 keep the 7 free days they were
// offered. Anything from that date on pays from the first day. Existing
// paid-until dates are not rewritten.
function ownerFreeDaysForListing(property = {}) {
  const started = kampalaCalendarDay(property.reviewed_at || property.approved_at || property.created_at);
  if (started && started < STRAIGHT_PAY_FROM) return LEGACY_OWNER_FREE_DAYS;
  return 0;
}

function ugxLabel(amount) {
  return `UGX ${Number(amount || 0).toLocaleString('en-US')}`;
}

function publishedPricing(env = process.env) {
  const agentMonthly = agentMonthlyUgx(env);
  const trialDays = agentTrialDays();
  const ownerMonthly = CODE_DEFAULTS.ownerListingMonthlyUgx;
  const ownerFreeDays = CODE_DEFAULTS.ownerFreeDays;
  const shortStayMonthly = CODE_DEFAULTS.shortStayMonthlyUgx;
  return {
    currency: CODE_DEFAULTS.currency,
    straight_pay_from: STRAIGHT_PAY_FROM,
    agent: {
      monthly_ugx: agentMonthly,
      trial_days: trialDays,
      per: 'month',
      includes_short_stays: true,
      label: `${ugxLabel(agentMonthly)} a month`
    },
    owner_listing: {
      monthly_ugx: ownerMonthly,
      free_days: ownerFreeDays,
      per: 'listing',
      label: `${ugxLabel(ownerMonthly)} per listing, per month`
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
  STRAIGHT_PAY_FROM,
  LEGACY_OWNER_FREE_DAYS,
  agentMonthlyUgx,
  agentTrialDays,
  ownerFreeDaysForListing,
  publishedPricing,
  ugxLabel
};
