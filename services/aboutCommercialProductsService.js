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

function advertisingRowsHtml() {
  return catalog.advertisingPlacements.map((item) => `
    <tr data-about-ad-row>
      <td>${item.page}</td>
      <td><strong>${item.placement}</strong><span>${item.format}</span></td>
      <td>${formatUgxPrice(item.amount)}</td>
    </tr>`).join('');
}

function injectAboutCommercialProducts(html) {
  let rendered = String(html || '');
  for (const [key, entry] of Object.entries(catalog.products)) {
    rendered = rendered.replaceAll(`{{ABOUT_PRICE:${key}}}`, `${formatUgxPrice(entry.amount)} / ${entry.period}`);
    rendered = rendered.replaceAll(`{{ABOUT_PRICE_ONLY:${key}}}`, formatUgxPrice(entry.amount));
  }
  return rendered.replace('{{ABOUT_ADVERTISING_ROWS}}', advertisingRowsHtml());
}

module.exports = {
  aboutCommercialPrice,
  advertisingRowsHtml,
  formatUgxPrice,
  injectAboutCommercialProducts
};
