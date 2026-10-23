#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { publicListingTransaction, publicListingPricePeriod, publicListingTitleContradictsFacts } = require('../services/publicListingCopy');
const { isPriceImplausible } = require('../utils/pricePlausibility');

function sourceEvidence(row) {
  const extra = row.extra_fields || {};
  return String(extra.source_caption || extra.raw_source_caption || extra.source_text
    || extra.source_description || extra.raw_source_description || extra.source_title || '').trim();
}

function auditListingFacts(input) {
  const rows = Array.isArray(input) ? input : input.rows;
  if (!Array.isArray(rows)) throw new Error('Input must be an array or an object with rows.');
  if (rows.some((row) => !row || typeof row.id !== 'string' || !row.id.trim())) throw new Error('Every listing needs a non-empty string ID.');
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new Error('Duplicate listing IDs in input.');
  const candidates = [];
  const counts = { listings: rows.length, sourceEvidence: 0, missingPropertyType: 0, usdWithRecordedFx: 0 };
  for (const row of rows) {
    const source = sourceEvidence(row);
    if (source) counts.sourceEvidence += 1;
    if (!String(row.property_type || '').trim()) counts.missingPropertyType += 1;
    const transaction = publicListingTransaction(row);
    const reasons = [];
    const sale = /\b(?:(?:for|on)\s+sale|selling|asking\s+price)\b/i.test(source);
    const rent = /\b(?:for\s+rent|to\s+rent|to\s+let|for\s+lease)\b/i.test(source);
    if (sale && rent) reasons.push('source_contains_both_sale_and_rent');
    else if (sale && transaction === 'rent') reasons.push('source_sale_vs_rent_fields');
    else if (rent && transaction === 'sale') reasons.push('source_rent_vs_sale_fields');
    if (['sale', 'rent'].includes(row.listing_type) && ['sale', 'rent'].includes(row.transaction_type)
      && row.listing_type !== row.transaction_type) reasons.push('transaction_fields_disagree');
    if (transaction === 'sale' && /^(?:mo|month|monthly|week|wk|year|yr|night|sem|semester|acre_yr)$/.test(row.price_period || '')) {
      reasons.push('sale_with_recurring_period');
    }
    if (publicListingTitleContradictsFacts(row, row.title)) reasons.push('stored_title_vs_structured_facts');
    const builtAsset = /\b(?:apartment\s+(?:block|complex)|\d+\s+(?:double\s+)?rental\s+units|residential\s+house|bungalow|mansion)\b/i.test(source);
    if (row.listing_type === 'land' && builtAsset) reasons.push('land_category_with_built_asset_source');
    const income = /\b(?:monthly|rental)\s+income\b|\b(?:making|collects?|collecting|earning)\s+(?:ugx\s*)?[\d,.]+\s*(?:k|m|b|million|billion)\b/i.test(source);
    if (income && sale) reasons.push('income_and_sale_amount_need_separate_review');
    const original = Number(row.price_original);
    const price = Number(row.price);
    const rate = Number(row.price_fx_rate_ugx);
    const currency = String(row.price_original_currency || '').toUpperCase();
    if (original > 0 && price > 0 && currency === 'UGX' && Math.abs(price - original) > 1) {
      reasons.push('ugx_original_and_canonical_differ');
    }
    if (currency === 'USD' && original > 0 && rate > 0) {
      counts.usdWithRecordedFx += 1;
      if (price > 0 && Math.abs(price - original * rate) > Math.max(1, original * rate * 0.00001)) {
        reasons.push('recorded_fx_arithmetic_differs');
      }
    }
    const sourceUsd = /\b(?:usd|us\$)\s*[\d,.]|\$\s*\d|\d[\d,.]*\s*(?:k|m|b|million|billion)?\s*(?:usd|us\s+dollars?)\b/i.test(source);
    if (currency !== 'USD' && sourceUsd) reasons.push('source_usd_with_non_usd_price_metadata');
    if (price > 0 && isPriceImplausible({ ...row, price_period: publicListingPricePeriod(row), listing_type: ['sale', 'rent'].includes(row.listing_type) ? transaction : row.listing_type })) {
      reasons.push('price_hidden_by_plausibility_bounds');
    }
    if (reasons.length) candidates.push({ id: row.id, reasons, listing_type: row.listing_type,
      transaction_type: row.transaction_type, property_type: row.property_type, price: row.price,
      price_original: row.price_original, price_original_currency: row.price_original_currency,
      price_period: row.price_period, source });
  }
  const reasonCounts = {};
  for (const row of candidates) for (const reason of row.reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  return { readOnly: true, scope: input.scope || 'Supplied inventory snapshot', extractedAt: input.extractedAt || null,
    counts, candidateCount: candidates.length, reasonCounts, candidates,
    limitation: 'Candidates require source review. This report neither confirms errors nor applies corrections. Missing type alone does not prove a mismatch. Mixed offers, plot suitability and historical captions can be ambiguous.' };
}

if (require.main === module) {
  try {
    const [input, output] = process.argv.slice(2);
    if (!input || !output) throw new Error('Usage: node scripts/audit-listing-facts.js input.json report.json');
    const report = auditListingFacts(JSON.parse(fs.readFileSync(input, 'utf8')));
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ counts: report.counts, candidateCount: report.candidateCount, reasonCounts: report.reasonCounts }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { auditListingFacts };
