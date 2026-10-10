'use strict';

const catalog = require('../config/aboutCommercialProducts');

function formatUgxPrice(amount) {
  return `UGX ${Number(amount || 0).toLocaleString('en-UG')}`;
}

// C21: privateListing and agentSubscription take Admin's fees.
function productAmount(entry = {}) {
  if (!entry.adminFee) return entry.amount;
  const snapshot = require('./pricingCopy').feesSnapshot();
  return entry.adminFee === 'agent' ? snapshot.agent.monthly_ugx : snapshot.lister.monthly_ugx;
}

function aboutCommercialPrice(key) {
  const entry = catalog.products[key];
  if (!entry) return '';
  return `${formatUgxPrice(productAmount(entry))} / ${entry.period}`;
}

function injectAboutCommercialProducts(html) {
  let rendered = String(html || '');
  for (const [key, entry] of Object.entries(catalog.products)) {
    // Admin-fed prices stay as tokens here (this HTML is cached); they are
    // filled at send time by pricingCopy.applyFeeTokens.
    if (entry.adminFee) continue;
    rendered = rendered.replaceAll(`{{ABOUT_PRICE:${key}}}`, `${formatUgxPrice(entry.amount)} / ${entry.period}`);
    rendered = rendered.replaceAll(`{{ABOUT_PRICE_ONLY:${key}}}`, formatUgxPrice(entry.amount));
  }
  return rendered;
}

module.exports = {
  productAmount,
  aboutCommercialPrice,
  formatUgxPrice,
  injectAboutCommercialProducts
};
