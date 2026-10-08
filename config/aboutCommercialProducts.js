'use strict';

// The /about product grid and display-ad table: a thin view over the rate card
// in config/pricing.js (PR G). No amount is written here.
// In the browser, /config/pricing.js must load first (index.html <head>).

(function (root) {
  const PRICING = (typeof module !== 'undefined' && module.exports)
    ? require('./pricing')
    : root.__MAKAUG_PRICING__;
  if (!PRICING) return;

  const line = (key) => PRICING[key];
  const ABOUT_COMMERCIAL_PRODUCTS = Object.freeze({
    version: `about-commercial-products-${PRICING.version}`,
    currency: PRICING.currency,
    fourWeekDiscountPercent: PRICING.display.four_week_discount_percent,
    vatLabel: PRICING.vat.label,
    products: Object.freeze({
      privateListing: { amount: line('private_listing').amount_ugx, period: 'property / month', trialDays: line('private_listing').trial_days },
      agentSubscription: { amount: line('agent_subscription').amount_ugx, period: 'month', includes: line('agent_subscription').includes },
      offPlanDevelopment: { amount: line('off_plan').amount_ugx, period: 'project / 3 months' },
      featuredListing: { amount: line('featured').amount_ugx, period: '7 days' },
      premiumListing: { amount: line('premium').amount_ugx, period: '7 days' },
      boostedListing: { amount: line('boosted').amount_ugx, period: 'listing / month' },
      marketReport: { amount: line('market_report').amount_ugx, period: 'report' },
      agencyWebsiteSetup: { amount: line('agency_website').amount_ugx, period: 'setup' },
      agencyWebsiteMonthly: { amount: line('agency_website').monthly_amount_ugx, period: 'month' },
      professionalListing: { amount: line('professional_listing').amount_ugx, period: 'property' },
      advertisingMinimum: { amount: PRICING.display.min_weekly_ugx, period: 'placement / week' },
      advertisingMaximum: { amount: PRICING.display.max_weekly_ugx, period: 'placement / week' }
    }),
    // amount is null for "Price on request" placements.
    advertisingPlacements: Object.freeze(PRICING.display.placements.map((p) => Object.freeze({
      page: p.page,
      placement: p.placement,
      format: p.format,
      amount: p.amount_ugx,
      quoteOnRequest: p.quote_on_request
    })))
  });

  if (typeof window !== 'undefined') window.__MAKAUG_ABOUT_COMMERCIAL_PRODUCTS__ = ABOUT_COMMERCIAL_PRODUCTS;
  if (typeof module !== 'undefined' && module.exports) module.exports = ABOUT_COMMERCIAL_PRODUCTS;
}(typeof globalThis !== 'undefined' ? globalThis : this));
