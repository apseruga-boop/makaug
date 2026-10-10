'use strict';

// C21 (10 Oct 2026, Arthur and Finance): every price sentence is built from
// the Admin fees (billingOpsService.currentFees / revenue.feeConfig), so a
// change in Admin › Revenue › Billing settings reaches every page, message and
// translation with no deploy. Prices are fixed in UGX and VAT-inclusive; the
// owner fee is per listing, per month; new agents get agent_trial_days free
// from approval (0 = pay first).

const revenue = require('./revenueService');

function ugx(amount) {
  return `UGX ${Math.round(Number(amount || 0)).toLocaleString('en-US')}`;
}

/** The fees as revenueService currently has them (Admin values once read). */
function feesSnapshot() {
  const d = revenue.FEE_DEFAULTS;
  const fees = revenue.currentAdminFees ? revenue.currentAdminFees() : null;
  return {
    agent: {
      monthly_ugx: revenue.feeConfig().feeUgx,
      trial_days: revenue.agentTrialDays()
    },
    lister: {
      monthly_ugx: Number.isFinite(Number(fees?.lister?.monthly_ugx)) ? Number(fees.lister.monthly_ugx) : d.lister_monthly_ugx,
      free_days: Number.isFinite(Number(fees?.lister?.free_days)) ? Number(fees.lister.free_days) : d.lister_free_days
    }
  };
}

/** Plain values and the sentences the site uses. */
function feeLabels(fees = feesSnapshot()) {
  const agentUgx = ugx(fees.agent.monthly_ugx);
  const listerUgx = ugx(fees.lister.monthly_ugx);
  const trial = Math.max(0, Math.round(Number(fees.agent.trial_days || 0)));
  const free = Math.max(0, Math.round(Number(fees.lister.free_days || 0)));
  return {
    agent_ugx: agentUgx,
    lister_ugx: listerUgx,
    agent_trial_days: String(trial),
    lister_free_days: String(free),
    vat: 'VAT incl.',
    agent_price: `${agentUgx}/month (VAT incl.)`,
    lister_price: `${listerUgx} per listing, per month (VAT incl.)`,
    agent_offer: trial > 0 ? `${trial} days free from approval` : 'first month paid before approval',
    agent_plan: trial > 0
      ? `Agent plan: ${agentUgx} a month (VAT incl.). New agents get the first ${trial} days free from approval; we send a payment link before it ends. Nothing is charged automatically.`
      : `Agent plan: ${agentUgx} a month (VAT incl.). Your account is approved once the first month is paid.`,
    lister_plan: free > 0
      ? `Your first ${free} days are free, then ${listerUgx} per listing, per month (VAT incl.).`
      : `${listerUgx} per listing, per month (VAT incl.).`,
    admin_agent_line: trial > 0
      ? `Agent fees are ${agentUgx} a month (new agents: ${trial} days free).`
      : `Agent fees are ${agentUgx} a month (new agents pay first).`
  };
}

const TOKEN_RE = /\{\{(PRICE|TRIAL|FREE|FEE|ABOUT_PRICE|ABOUT_PRICE_ONLY):([A-Za-z_]+)\}\}/g;

/** Fill {{PRICE:agent}}, {{PRICE:lister}}, {{TRIAL:agent}}, {{FREE:lister}}, {{FEE:<label>}} and the two Admin-fed about prices. */
function applyFeeTokens(html, fees = feesSnapshot()) {
  const text = String(html ?? '');
  if (!text.includes('{{')) return text;
  const labels = feeLabels(fees);
  return text.replace(TOKEN_RE, (all, kind, key) => {
    if (kind === 'PRICE' && key === 'agent') return labels.agent_ugx;
    if (kind === 'PRICE' && key === 'lister') return labels.lister_ugx;
    if (kind === 'TRIAL' && key === 'agent') return labels.agent_trial_days;
    if (kind === 'FREE' && key === 'lister') return labels.lister_free_days;
    if (kind === 'FEE' && Object.prototype.hasOwnProperty.call(labels, key)) return labels[key];
    if (kind === 'ABOUT_PRICE' && key === 'privateListing') return `${labels.lister_ugx} / listing / month`;
    if (kind === 'ABOUT_PRICE' && key === 'agentSubscription') return `${labels.agent_ugx} / month`;
    if (kind === 'ABOUT_PRICE_ONLY' && key === 'privateListing') return labels.lister_ugx;
    if (kind === 'ABOUT_PRICE_ONLY' && key === 'agentSubscription') return labels.agent_ugx;
    return all;
  });
}

/** What GET /api/pricing and window.MAKAUG_PRICING carry. */
function publicPricing(fees = feesSnapshot()) {
  const labels = feeLabels(fees);
  return {
    currency: 'UGX',
    vat_inclusive: true,
    agent: { monthly_ugx: fees.agent.monthly_ugx, trial_days: Number(labels.agent_trial_days), per: 'month' },
    lister: { monthly_ugx: fees.lister.monthly_ugx, free_days: Number(labels.lister_free_days), per: 'listing' },
    labels
  };
}

module.exports = {
  applyFeeTokens,
  feeLabels,
  feesSnapshot,
  publicPricing,
  ugx
};
