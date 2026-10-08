'use strict';

const catalog = require('../config/aboutCommercialProducts');

function formatUgxPrice(amount) {
  return `UGX ${Number(amount || 0).toLocaleString('en-UG')}`;
}

function aboutCommercialPrice(key) {
  const entry = catalog.products[key];
  if (!entry) return '';
  return `${formatUgxPrice(entry.amount)} / ${entry.period}`;
}

function injectAboutCommercialProducts(html) {
  let rendered = String(html || '');
  rendered = rendered.replaceAll('{{ABOUT_FOUR_WEEK_DISCOUNT}}', `${catalog.fourWeekDiscountPercent}% off 4-week bookings`);
  for (const [key, entry] of Object.entries(catalog.products)) {
    rendered = rendered.replaceAll(`{{ABOUT_PRICE:${key}}}`, `${formatUgxPrice(entry.amount)} / ${entry.period}`);
    rendered = rendered.replaceAll(`{{ABOUT_PRICE_ONLY:${key}}}`, formatUgxPrice(entry.amount));
  }
  return rendered;
}

module.exports = {
  aboutCommercialPrice,
  formatUgxPrice,
  injectAboutCommercialProducts
};
