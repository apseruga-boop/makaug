'use strict';

const {
  PRICE_PERIODS,
  RECURRING_CANONICAL_PERIODS,
  normalizePricePeriod,
  pricePeriodSuffix,
} = require('../config/pricePeriods');
const { humanPropertyTypeLabel } = require('../utils/commercialClassification');
const { publicListingTransaction } = require('../services/publicListingCopy');

const EMPLOYEE_LABELS = Object.freeze({
  sale: 'Property for sale', rent: 'Rental property', land: 'Land for sale',
  commercial: 'Commercial property', student: 'Student accommodation',
});
const EMPLOYEE_PRICED_LEAD = /^(?:Property for sale|Rental property|Land for sale|Commercial property|Student accommodation|Property listing)(?: in [^.!?\r\n]+)?, listed at [A-Z]{3} (?:0|[1-9]\d{0,2}(?:,\d{3})*)\./;
const UNIT_PERIODS = new Set(['unit', 'per_unit', '/unit']);

function compact(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function locationLabel(row) {
  return [row.area, row.district].map(compact)
    .filter((value, index, values) => value && values.findIndex((other) => other.toLowerCase() === value.toLowerCase()) === index)
    .join(', ');
}

function quotedAmount(row) {
  const original = Number(row.price_original);
  const currency = compact(row.price_original_currency).toUpperCase();
  if (Number.isFinite(original) && original > 0 && currency) return { amount: original, currency };
  const amount = Number(row.price);
  return Number.isFinite(amount) && amount > 0
    ? { amount, currency: compact(row.price_currency || 'UGX').toUpperCase() }
    : null;
}

function quoteSuffix(row, transaction) {
  const raw = compact(row.price_period).toLowerCase().replace(/[ -]+/g, '_');
  if (UNIT_PERIODS.has(raw)) return '/unit';
  const period = normalizePricePeriod(raw);
  if (period && !PRICE_PERIODS[period]) throw new Error(`Unsupported price period: ${row.price_period}`);
  if (transaction === 'sale' && RECURRING_CANONICAL_PERIODS.has(period)) return '';
  return pricePeriodSuffix(period);
}

function canonicalListingTitle(row) {
  const transaction = publicListingTransaction(row);
  const listingType = compact(row.listing_type).toLowerCase();
  const type = humanPropertyTypeLabel(row.property_type).replace(/\s+(?:for sale|for rent|to rent)\s*$/i, '') || ({
    land: 'Land', commercial: 'Commercial property', student: 'Student accommodation',
  }[listingType] || 'Property');
  const bedrooms = Number(row.bedrooms);
  const isLand = listingType === 'land' || /^(?:land|plots?|commercial_land)$/i.test(compact(row.property_type));
  const heading = !isLand && Number.isInteger(bedrooms) && bedrooms > 0
    ? `${bedrooms}-bedroom ${type.toLowerCase()}` : type;
  const location = locationLabel(row);
  const value = `${heading}${transaction ? ` for ${transaction}` : ''}${location ? ` in ${location}` : ''}`;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function canonicalListingLead(row) {
  const title = canonicalListingTitle(row);
  const period = normalizePricePeriod(row.price_period);
  const quote = quotedAmount(row);
  if (row.price_on_application === true || period === 'poa' || !quote) return `${title}, price on application.`;
  const amount = Math.round(quote.amount).toLocaleString('en-GB');
  return `${title}, listed at ${quote.currency} ${amount}${quoteSuffix(row, publicListingTransaction(row))}.`;
}

function employeeTemplateLead(row) {
  const description = String(row.description ?? '');
  const label = EMPLOYEE_LABELS[compact(row.listing_type).toLowerCase()] || 'Property listing';
  const location = locationLabel(row);
  const quote = quotedAmount(row);
  const price = quote ? `, listed at ${quote.currency} ${Math.round(quote.amount).toLocaleString('en-GB')}` : '';
  const reconstructed = `${label}${location ? ` in ${location}` : ''}${price}.`;
  if (description.startsWith(reconstructed) && /^(?:\s|$)/.test(description.slice(reconstructed.length))) return reconstructed;
  const matched = description.match(EMPLOYEE_PRICED_LEAD)?.[0];
  return matched && /^(?:\s|$)/.test(description.slice(matched.length)) ? matched : null;
}

function replaceEmployeeTemplateLead(before, corrected) {
  const description = String(before.description ?? '');
  const previousLead = employeeTemplateLead(before);
  if (!previousLead) return { changed: false, description, previousLead: null, lead: null };
  const lead = canonicalListingLead(corrected);
  const replacement = lead + description.slice(previousLead.length);
  return { changed: replacement !== description, description: replacement, previousLead, lead };
}

module.exports = { canonicalListingTitle, canonicalListingLead, replaceEmployeeTemplateLead };
