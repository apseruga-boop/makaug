'use strict';

// Marketplace Verified is parked (PR G, rate card 2026-10-08): not sold, not
// shown. The amount lives only in config/pricing.js (off_sale).
const PRICING = require('./pricing');

const MARKETPLACE_VERIFIED = PRICING.off_sale.marketplace_verified;
const MARKETPLACE_VERIFIED_PRICE_UGX = MARKETPLACE_VERIFIED.amount_ugx;
const MARKETPLACE_VERIFIED_BILLING_PERIOD = MARKETPLACE_VERIFIED.period;
const MARKETPLACE_VERIFIED_ACTIVE = MARKETPLACE_VERIFIED.active === true && MARKETPLACE_VERIFIED.sellable === true;
const MARKETPLACE_POLISH_MARKER = 'marketplace-polish-20260719';
const MARKETPLACE_FINAL_TWEAKS_MARKER = 'marketplace-final-tweaks-20260719';

module.exports = {
  MARKETPLACE_FINAL_TWEAKS_MARKER,
  MARKETPLACE_POLISH_MARKER,
  MARKETPLACE_VERIFIED,
  MARKETPLACE_VERIFIED_ACTIVE,
  MARKETPLACE_VERIFIED_BILLING_PERIOD,
  MARKETPLACE_VERIFIED_PRICE_UGX
};
