'use strict';

const { sourcePriceAmount } = require('./propertyPriceCurrency');

const ACTIVE_COUNTRY_CODE = String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase();
const IS_SOUTH_AFRICA = ACTIVE_COUNTRY_CODE === 'ZA';

const UGANDA_FOREIGN_MARKET_SIGNALS = [
  { pattern: /\b(?:rwf|frw|rwandan francs?)\b/i, reason: 'foreign_currency_rwf' },
  { pattern: /\b(?:kes|kshs?|kenyan shillings?)\b/i, reason: 'foreign_currency_kes' },
  { pattern: /\b(?:tzs|tshs?|tanzanian shillings?)\b/i, reason: 'foreign_currency_tzs' },
  { pattern: /(?:₹|\binr\b|\bindian rupees?\b)/i, reason: 'foreign_currency_inr' },
  { pattern: /\b(?:lkr|sri lankan rupees?)\b/i, reason: 'foreign_currency_lkr' },
  { pattern: /(?:£|\bgbp\b|\bpounds?\s+sterling\b|\d\s*pcm\b)/i, reason: 'foreign_currency_gbp' },
  { pattern: /(?:₦|\bngn\b|\bnaira\b)/i, reason: 'foreign_currency_ngn' },
  { pattern: /\b(?:rwanda|kigali|kenya|nairobi|mombasa|tanzania|dar es salaam|sri lanka|sinhala|india|kolkata|kolhapur|hyderabad|mumbai|delhi|nigeria|abuja|lagos|memphis|ridgecrest|fort garland|little rock|united states|usa|united kingdom)\b/i, reason: 'foreign_market_location' },
  { pattern: /[\u0D80-\u0DFF\u0900-\u097F\u0B80-\u0BFF]/u, reason: 'foreign_market_script' },
];

const SOUTH_AFRICA_FOREIGN_MARKET_SIGNALS = [
  { pattern: /\b(?:ugx|ush|ugandan shillings?)\b/i, reason: 'foreign_currency_ugx' },
  { pattern: /\b(?:rwf|frw|rwandan francs?)\b/i, reason: 'foreign_currency_rwf' },
  { pattern: /\b(?:kes|kshs?|kenyan shillings?)\b/i, reason: 'foreign_currency_kes' },
  { pattern: /\b(?:tzs|tshs?|tanzanian shillings?)\b/i, reason: 'foreign_currency_tzs' },
  { pattern: /(?:₦|\bngn\b|\bnaira\b)/i, reason: 'foreign_currency_ngn' },
  { pattern: /\b(?:uganda|kampala|wakiso|kenya|nairobi|mombasa|rwanda|kigali|tanzania|dar es salaam|nigeria|abuja|lagos|united states|usa)\b/i, reason: 'foreign_market_location' },
  { pattern: /[\u0D80-\u0DFF\u0900-\u097F\u0B80-\u0BFF]/u, reason: 'foreign_market_script' },
];

const FOREIGN_MARKET_SIGNALS = IS_SOUTH_AFRICA
  ? SOUTH_AFRICA_FOREIGN_MARKET_SIGNALS
  : UGANDA_FOREIGN_MARKET_SIGNALS;

const EXPLICIT_LISTING_INTENT_PATTERN = /\b(?:for sale|on sale|selling|for rent|to rent|to let|for lease|available for (?:sale|rent)|asking price|guide price|price\s*:)\b/i;
const CONSTRUCTION_COST_PATTERN = /\b(?:build(?:ing)? costs?|cost to build|construction costs?|material costs?|cost breakdown|roofing materials?|bill of quantities|boq)\b/i;
const FOREIGN_INTERNATIONAL_PHONE_PATTERN = IS_SOUTH_AFRICA
  ? /\+(?!27)\d{1,3}(?:[\s().-]*\d){7,14}/g
  : /\+(?!256)\d{1,3}(?:[\s().-]*\d){7,14}/g;
const UGANDA_PHONE_CANDIDATE_PATTERN = IS_SOUTH_AFRICA
  ? /(^|[^\d+])((?:\+?27[\s().-]*|0)[6-8](?:[\s().-]*\d){8}|[6-8]\d{8})(?=$|[^\d])/g
  : /(^|[^\d+])((?:\+?256[\s().-]*|0)7\d{2}[\s().-]*\d{3}[\s().-]*\d{3}|7\d{2}[\s().-]*\d{3}[\s().-]*\d{3})(?=$|[^\d])/g;
const PRICE_CURRENCY_SOURCE = IS_SOUTH_AFRICA ? '(?:zar|r|usd|us\\$|\\$|eur|€|gbp|£)' : '(?:ugx|ush|shs?|usd|us\\$|\\$)';
const SOURCE_PRICE_EVIDENCE_PATTERN = new RegExp(`(?:\\b${PRICE_CURRENCY_SOURCE}\\s*)?\\d[\\d,.]*(?:\\s+\\d{3})*(?:\\s*(?:bn|b|billion|billions|m|mn|mil|million|millions|k|thousand|thousands)(?![a-z]))?(?:\\s*${PRICE_CURRENCY_SOURCE})?(?:\\s*(?:\\/\\s*(?:month|mo|m²|sqm)|per\\s+(?:month|m²|square\\s+metre)|monthly))?`, 'gi');
const SOURCE_PRICE_CONTEXT_PATTERN = new RegExp(`\\b(?:price|asking|guide\\s+price|offers?\\s+from|from|at|only|going\\s+for|selling\\s+at|rent(?:ed)?\\s+at)\\s*(?:is|of|:|-)?\\s*(${PRICE_CURRENCY_SOURCE}?\\s*\\d[\\d,.]*(?:\\s+\\d{3})*(?:\\s*(?:bn|b|billion|billions|m|mn|mil|million|millions|k|thousand|thousands))?(?:\\s*${PRICE_CURRENCY_SOURCE})?)`, 'gi');
const SOURCE_PRICE_MAX_RELATIVE_DRIFT = 0.001;
const CONSTRUCTION_MONEY_TOKEN_SOURCE = `(?:${PRICE_CURRENCY_SOURCE}\\s*)?\\d[\\d,.]*(?:\\s+\\d{3})*(?:\\s*(?:bn|b|billion|billions|m|mn|mil|million|millions|k|thousand|thousands))?`;

function compactText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function foreignSourceMarketStatus(text = '') {
  const sourceText = compactText(text);
  const foreignPhone = sourceText.match(FOREIGN_INTERNATIONAL_PHONE_PATTERN)?.[0] || '';
  if (foreignPhone) {
    return {
      allowed: false,
      reason: 'foreign_phone_country_code',
      matched: foreignPhone,
    };
  }
  for (const signal of FOREIGN_MARKET_SIGNALS) {
    const matched = sourceText.match(signal.pattern)?.[0] || '';
    if (matched) {
      return {
        allowed: false,
        reason: signal.reason,
        matched,
      };
    }
  }
  return {
    allowed: true,
    reason: '',
    matched: '',
  };
}

function normalizeUgandanSourcePhone(value = '') {
  const raw = compactText(value);
  if (!raw) return '';
  if (IS_SOUTH_AFRICA) {
    if (/^\+(?!27)/.test(raw) || /^00(?!27)/.test(raw)) return '';
    const digits = raw.replace(/\D/g, '');
    if (/^27[6-8]\d{8}$/.test(digits)) return `+${digits}`;
    if (/^0[6-8]\d{8}$/.test(digits)) return `+27${digits.slice(1)}`;
    if (/^[6-8]\d{8}$/.test(digits)) return `+27${digits}`;
    return '';
  }
  if (/^\+(?!256)/.test(raw) || /^00(?!256)/.test(raw)) return '';
  const digits = raw.replace(/\D/g, '');
  if (/^2567\d{8}$/.test(digits)) return `+${digits}`;
  if (/^07\d{8}$/.test(digits)) return `+256${digits.slice(1)}`;
  if (/^7\d{8}$/.test(digits)) return `+256${digits}`;
  return '';
}

function ugandanPhoneFromSourceText(text = '') {
  const sourceText = compactText(text).replace(FOREIGN_INTERNATIONAL_PHONE_PATTERN, ' ');
  const candidates = [];
  for (const match of sourceText.matchAll(UGANDA_PHONE_CANDIDATE_PATTERN)) {
    candidates.push(match[2]);
  }
  for (const candidate of candidates) {
    const normalized = normalizeUgandanSourcePhone(candidate);
    if (normalized) return normalized;
  }
  return '';
}

function maskPhonesForPriceExtraction(text = '') {
  return compactText(text)
    .replace(FOREIGN_INTERNATIONAL_PHONE_PATTERN, ' [phone] ')
    .replace(UGANDA_PHONE_CANDIDATE_PATTERN, (_, prefix) => `${prefix || ''}[phone]`)
    .replace(/\s+/g, ' ')
    .trim();
}

function maskConstructionCostsForPriceExtraction(text = '') {
  const afterCostLabel = new RegExp(`(${CONSTRUCTION_COST_PATTERN.source})(?:\\s+(?:is|of|at|around|approximately|about))?\\s*[:=-]?\\s*(${CONSTRUCTION_MONEY_TOKEN_SOURCE})`, 'gi');
  const beforeCostLabel = new RegExp(`(${CONSTRUCTION_MONEY_TOKEN_SOURCE})\\s*(?:for|in)?\\s*(${CONSTRUCTION_COST_PATTERN.source})`, 'gi');
  return compactText(text)
    .replace(afterCostLabel, '$1 [construction-cost]')
    .replace(beforeCostLabel, '[construction-cost] $2');
}

function sourcePriceMatchesPhone(value, text = '') {
  if (value == null || value === '') return false;
  const candidateDigits = String(value).replace(/\D/g, '');
  if (!candidateDigits) return false;
  const phone = ugandanPhoneFromSourceText(text).replace(/\D/g, '');
  if (!phone) return false;
  const localPhone = phone.replace(IS_SOUTH_AFRICA ? /^27/ : /^256/, '');
  return candidateDigits === phone
    || candidateDigits === localPhone
    || candidateDigits === `0${localPhone}`;
}

function sourcePriceEvidenceAmounts(text = '') {
  const masked = maskConstructionCostsForPriceExtraction(maskPhonesForPriceExtraction(text));
  const candidates = [];
  for (const match of masked.matchAll(SOURCE_PRICE_EVIDENCE_PATTERN)) {
    const token = compactText(match[0]);
    if (!token || !/(?:zar|\br\s*\d|ugx|ush|shs?|usd|us\$|\$|eur|€|gbp|£|bn|b|billion|m(?:n|il|illion)?|k|thousand|\/\s*(?:month|mo|m²|sqm)|per\s+(?:month|m²|square\s+metre)|monthly)/i.test(token)) continue;
    const amount = sourcePriceAmount(token);
    if (Number.isFinite(amount) && amount > 0) candidates.push(amount);
  }
  for (const match of masked.matchAll(SOURCE_PRICE_CONTEXT_PATTERN)) {
    const amount = sourcePriceAmount(match[1]);
    if (Number.isFinite(amount) && amount > 0) candidates.push(amount);
  }
  return [...new Set(candidates)];
}

function sourcePriceHasEvidence(value, text = '') {
  const candidate = sourcePriceAmount(value);
  if (!Number.isFinite(candidate) || candidate <= 0) return false;
  return sourcePriceEvidenceAmounts(text).some((amount) => {
    const drift = Math.abs(amount - candidate) / Math.max(amount, candidate);
    return drift <= SOURCE_PRICE_MAX_RELATIVE_DRIFT;
  });
}

function safeSourcePriceCandidate(value, text = '') {
  const sourceText = compactText(text);
  if (value == null || value === '') {
    return { value: null, reason: 'missing_source_price' };
  }
  if (sourcePriceMatchesPhone(value, sourceText)) {
    return { value: null, reason: 'phone_number_is_not_price' };
  }
  if (CONSTRUCTION_COST_PATTERN.test(sourceText) && !EXPLICIT_LISTING_INTENT_PATTERN.test(sourceText)) {
    return { value: null, reason: 'construction_cost_is_not_listing_price' };
  }
  const numericValue = sourcePriceAmount(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return { value: null, reason: 'invalid_source_price' };
  }
  const explicitUsdValue = /(?:\$|\b(?:usd|us\$)\b)/i.test(String(value));
  const minimumPlausibleListingPrice = IS_SOUTH_AFRICA ? 500 : 10000;
  if (numericValue < minimumPlausibleListingPrice && !explicitUsdValue) {
    return { value: null, reason: 'implausible_unit_count_is_not_price' };
  }
  if (!sourcePriceHasEvidence(value, sourceText)) {
    return { value: null, reason: 'source_price_not_in_evidence' };
  }
  return { value, reason: '' };
}

module.exports = {
  foreignSourceMarketStatus,
  maskConstructionCostsForPriceExtraction,
  maskPhonesForPriceExtraction,
  normalizeUgandanSourcePhone,
  safeSourcePriceCandidate,
  sourcePriceEvidenceAmounts,
  sourcePriceHasEvidence,
  sourcePriceMatchesPhone,
  ugandanPhoneFromSourceText,
};
