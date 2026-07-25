'use strict';

const FOREIGN_MARKET_SIGNALS = [
  { pattern: /\b(?:rwf|frw|rwandan francs?)\b/i, reason: 'foreign_currency_rwf' },
  { pattern: /\b(?:kes|kshs?|kenyan shillings?)\b/i, reason: 'foreign_currency_kes' },
  { pattern: /\b(?:tzs|tshs?|tanzanian shillings?)\b/i, reason: 'foreign_currency_tzs' },
  { pattern: /(?:₹|\binr\b|\bindian rupees?\b)/i, reason: 'foreign_currency_inr' },
  { pattern: /\b(?:lkr|sri lankan rupees?)\b/i, reason: 'foreign_currency_lkr' },
  { pattern: /\b(?:rwanda|kigali|kenya|nairobi|mombasa|tanzania|dar es salaam|sri lanka|sinhala|india|kolkata|hyderabad|mumbai|delhi)\b/i, reason: 'foreign_market_location' },
  { pattern: /[\u0D80-\u0DFF\u0900-\u097F\u0B80-\u0BFF]/u, reason: 'foreign_market_script' },
];

const EXPLICIT_LISTING_INTENT_PATTERN = /\b(?:for sale|on sale|selling|for rent|to rent|to let|for lease|available for (?:sale|rent)|asking price|guide price|price\s*:)\b/i;
const CONSTRUCTION_COST_PATTERN = /\b(?:build(?:ing)? costs?|cost to build|construction costs?|material costs?|cost breakdown|roofing materials?|bill of quantities|boq)\b/i;
const FOREIGN_INTERNATIONAL_PHONE_PATTERN = /\+(?!256)\d{1,3}(?:[\s().-]*\d){7,14}/g;
const UGANDA_PHONE_CANDIDATE_PATTERN = /(^|[^\d+])((?:\+?256[\s().-]*|0)7\d{2}[\s().-]*\d{3}[\s().-]*\d{3}|7\d{2}[\s().-]*\d{3}[\s().-]*\d{3})(?=$|[^\d])/g;

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

function sourcePriceMatchesPhone(value, text = '') {
  if (value == null || value === '') return false;
  const candidateDigits = String(value).replace(/\D/g, '');
  if (!candidateDigits) return false;
  const phone = ugandanPhoneFromSourceText(text).replace(/\D/g, '');
  if (!phone) return false;
  const localPhone = phone.replace(/^256/, '');
  return candidateDigits === phone
    || candidateDigits === localPhone
    || candidateDigits === `0${localPhone}`;
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
  return { value, reason: '' };
}

module.exports = {
  foreignSourceMarketStatus,
  maskPhonesForPriceExtraction,
  normalizeUgandanSourcePhone,
  safeSourcePriceCandidate,
  sourcePriceMatchesPhone,
  ugandanPhoneFromSourceText,
};
