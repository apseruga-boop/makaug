'use strict';

const catalog = require('../config/aboutCommercialProducts');
const { publishedPricing } = require('../config/publishedPricing');

function formatUgxPrice(amount) {
  return `UGX ${Number(amount || 0).toLocaleString('en-UG')}`;
}

function aboutCommercialPrice(key) {
  const entry = catalog.products[key];
  if (!entry) return '';
  return `${formatUgxPrice(entry.amount)} / ${entry.period}`;
}

function publishedProductAmount(key, entry) {
  const pricing = publishedPricing();
  if (key === 'agentSubscription') return pricing.agent.monthly_ugx;
  if (key === 'privateListing') return pricing.owner_listing.monthly_ugx;
  if (key === 'shortStayListing') return pricing.short_stay.monthly_ugx;
  return entry.amount;
}

function injectAboutCommercialProducts(html) {
  let rendered = String(html || '');
  for (const [key, entry] of Object.entries(catalog.products)) {
    const amount = publishedProductAmount(key, entry);
    rendered = rendered.replaceAll(`{{ABOUT_PRICE:${key}}}`, `${formatUgxPrice(amount)} / ${entry.period}`);
    rendered = rendered.replaceAll(`{{ABOUT_PRICE_ONLY:${key}}}`, formatUgxPrice(amount));
  }
  return rendered;
}

module.exports = {
  aboutCommercialPrice,
  formatUgxPrice,
  injectAboutCommercialProducts
};
