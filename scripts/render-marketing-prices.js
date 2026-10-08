#!/usr/bin/env node
'use strict';

// Writes rate-card prices into static marketing files that can't run code
// (SVG cards). Every element marked data-rate="<key>" gets its text from
// config/pricing.js; run this after changing the rate card:
//   node scripts/render-marketing-prices.js
// tests/pricing-single-source.test.js checks the values still match.

const fs = require('fs');
const path = require('path');
const PRICING = require('../config/pricing');

const ROOT = path.join(__dirname, '..');
const FILES = ['assets/marketing/makaug-agent-welcome-card.svg'];

const RATES = Object.freeze({
  agent_plan_month: () => `${PRICING.ugx(PRICING.agent_subscription.amount_ugx)} a month`,
  lister_fee_month: () => `${PRICING.ugx(PRICING.private_listing.amount_ugx)} a month`
});

function renderRates(text) {
  return String(text).replace(/(<([a-z]+)\b[^>]*\sdata-rate="([a-z_]+)"[^>]*>)([^<]*)(<\/\2>)/g, (match, open, _tag, key, _old, close) => {
    if (!RATES[key]) throw new Error(`Unknown data-rate key: ${key}`);
    return `${open}${RATES[key]()}${close}`;
  });
}

module.exports = { RATES, renderRates, FILES };

if (require.main === module) {
  for (const file of FILES) {
    const abs = path.join(ROOT, file);
    const before = fs.readFileSync(abs, 'utf8');
    const after = renderRates(before);
    if (after !== before) fs.writeFileSync(abs, after);
    console.log(`${file}: ${after === before ? 'up to date' : 'updated'}`);
  }
}
