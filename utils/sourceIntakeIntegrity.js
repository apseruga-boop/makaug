'use strict';

const { maskRoadDistanceAmounts, sourcePriceAmount } = require('./propertyPriceCurrency');
const { preferEachPlotPrice } = require('./listingIntakeQuality');
const { resolveCanonicalUgandaLocationFromText } = require('./ugandaLocationRegistry');

const ACTIVE_COUNTRY_CODE = String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase();
const IS_SOUTH_AFRICA = ACTIVE_COUNTRY_CODE === 'ZA';

const UGANDA_FOREIGN_MARKET_SIGNALS = [
  { pattern: /\b(?:rwf|frw|rwandan francs?)\b/i, reason: 'foreign_currency_rwf' },
  { pattern: /\b(?:kes|kshs?|kenyan shillings?)\b/i, reason: 'foreign_currency_kes' },
  { pattern: /\b(?:tzs|tshs?|tanzanian shillings?)\b/i, reason: 'foreign_currency_tzs' },
  { pattern: /(?:₹|\binr\b|\bindian rupees?\b|\brs\.?\s*\d|\blakhs?\b|\bcrores?\b)/i, reason: 'foreign_currency_inr' },
  { pattern: /\b(?:idr|rp)\b|(?:^|[^\w])rp\.?\s*\d/i, reason: 'foreign_currency_idr' },
  { pattern: /\bzar\b|(?:^|[^\w])r\s*\d/i, reason: 'foreign_currency_zar' },
  { pattern: /\b(?:lkr|sri lankan rupees?)\b/i, reason: 'foreign_currency_lkr' },
  { pattern: /(?:£|\bgbp\b|\bpounds?\s+sterling\b|\d\s*pcm\b)/i, reason: 'foreign_currency_gbp' },
  { pattern: /(?:€|\beur\b|\beuros?\b)/i, reason: 'foreign_currency_eur' },
  { pattern: /(?:₦|\bngn\b|\bnaira\b)/i, reason: 'foreign_currency_ngn' },
  { pattern: /\bbaerz(?:\s*&\s*co\.?)?\b/i, reason: 'foreign_channel' },
  { pattern: /\b(?:zagreb|croatia|amsterdam|netherlands|holland|rotterdam|utrecht|sotogrande|spain|madrid|barcelona|marbella|m[aá]laga|valencia|seville|sevilla|paris|france|lyon|berlin|germany|munich|m[uü]nchen|frankfurt|rome|roma|italy|milan|milano|florence|venice|lisbon|lisboa|portugal|porto|brussels|belgium|vienna|austria|prague|czech(?:ia| republic)?|budapest|hungary|warsaw|poland|stockholm|sweden|oslo|norway|copenhagen|denmark|helsinki|finland|athens|greece|zurich|z[uü]rich|geneva|switzerland|dublin|ireland|manchester|edinburgh|scotland|sydney|melbourne|australia|auckland|new zealand|toronto|vancouver|montreal|doha|qatar|riyadh|jeddah|abu dhabi|singapore|hong kong|tokyo|japan|seoul|korea|beijing|shanghai|bangkok|thailand|bali|jakarta|indonesia|istanbul|casablanca|morocco|cairo|egypt|luxembourg|monaco|ibiza|mallorca|majorca|algarve|tuscany|provence)\b/i, reason: 'foreign_market_location' },
  { pattern: /\b(?:rwanda|kigali|kenya|nairobi|mombasa|tanzania|dar es salaam|sri lanka|sinhala|india|kolkata|kolhapur|hyderabad|mumbai|delhi|karnataka|hassan,\s*karnataka|bengaluru|bangalore|nigeria|abuja|lagos|pakistan|karachi|lahore|islamabad|rawalpindi|dha\s+phase|ohio|pickerington|memphis|ridgecrest|fort garland|little rock|united states|usa|united kingdom)\b/i, reason: 'foreign_market_location' },
  { pattern: /\b(?:tangerang|bandung|badung|darmawangsa|cirendeu|pondok indah|bsd|umhlanga|uttarakhand|jaipur|godhavari|godavari|bharat ratna|johannesburg|durban|pretoria|cape town|south africa|kwazulu(?:-natal)?)\b/i, reason: 'foreign_market_location' },
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
// C17: `\\b$` never matched after a space, so "$2,000 Month" lost its currency.
const SOURCE_PRICE_EVIDENCE_PATTERN = new RegExp(`(?:(?:\\b|(?=[$€£]))${PRICE_CURRENCY_SOURCE}\\s*)?\\d[\\d,.]*(?:\\s*(?:bn|b|billion|billions|m|mn|million|millions|k|thousand|thousands)(?![a-z]))?(?:\\s*${PRICE_CURRENCY_SOURCE})?(?:\\s*(?:\\/\\s*(?:month|mo|m²|sqm)|per\\s+(?:month|m²|square\\s+metre)|monthly))?`, 'gi');
const SOURCE_PRICE_CONTEXT_PATTERN = new RegExp(`\\b(?:price|asking|guide\\s+price|at|only|going\\s+for|selling\\s+at|rent(?:ed)?\\s+at)\\s*(?:is|of|:|-)?\\s*(${PRICE_CURRENCY_SOURCE}?\\s*\\d[\\d,.]*(?:\\s*(?:bn|b|billion|billions|m|mn|million|millions|k|thousand|thousands)(?=ugx|ush|shs|usd|[^a-z]|$))?(?:\\s*${PRICE_CURRENCY_SOURCE})?)`, 'gi');
const SOURCE_PRICE_MAX_RELATIVE_DRIFT = 0.001;
const CONSTRUCTION_MONEY_TOKEN_SOURCE = `(?:${PRICE_CURRENCY_SOURCE}\\s*)?\\d[\\d,.]*(?:\\s*(?:bn|b|billion|billions|m|mn|million|millions|k|thousand|thousands))?`;

function compactText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const STRONG_UGANDA_PLACE_LEVELS = new Set(['district', 'city', 'town']);

function knownUgandanChannelMention(text = '') {
  if (IS_SOUTH_AFRICA) return '';
  const { knownUgandanChannelMention: mention } = require('../services/propertySourceRegistryService');
  return mention(text) || '';
}

function ugandaRegistryPlaceMention(text = '') {
  const resolution = resolveCanonicalUgandaLocationFromText(text);
  if (resolution.status !== 'matched' || !resolution.match) return null;
  const level = String(resolution.match.level || '');
  const letters = String(resolution.match.name || '').replace(/[^a-zA-Z]/g, '');
  // Parish, subcounty and short area aliases are fuzzy collisions
  // ("omel" -> Gulu, "kakwa" -> Maracha, "kuru" -> Yumbe). They are not
  // positive Uganda evidence on their own.
  if (STRONG_UGANDA_PLACE_LEVELS.has(level) && letters.length >= 4) return resolution.match;
  if (level === 'area' && letters.length >= 5) return resolution.match;
  return null;
}

function ugandaFoundOnlineEvidence(text = '') {
  const sourceText = compactText(text);
  const country = sourceText.match(/\buganda(?:n)?\b/i)?.[0] || '';
  if (country) return { ok: true, kind: 'country_name', matched: country };
  const kampala = sourceText.match(/\bkampala\b/i)?.[0] || '';
  if (kampala) return { ok: true, kind: 'kampala', matched: kampala };
  const currency = sourceText.match(/\b(?:ugx|ush|shs|ugandan shillings?)\b/i)?.[0] || '';
  if (currency) return { ok: true, kind: 'currency', matched: currency };
  const phone = ugandanPhoneFromSourceText(sourceText);
  if (phone) return { ok: true, kind: 'phone', matched: phone };
  const channel = knownUgandanChannelMention(sourceText);
  if (channel) return { ok: true, kind: 'channel', matched: channel };
  const place = ugandaRegistryPlaceMention(sourceText);
  if (place) return { ok: true, kind: 'place', matched: place.name || place.district || '' };
  return { ok: false, kind: '', matched: '' };
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
  // South Africa stays a denylist. Uganda found-online intake is an allowlist:
  // no positive Uganda evidence means the post is not queued.
  if (IS_SOUTH_AFRICA) {
    return { allowed: true, reason: '', matched: '' };
  }
  const evidence = ugandaFoundOnlineEvidence(sourceText);
  if (!evidence.ok) {
    return {
      allowed: false,
      reason: 'no_uganda_evidence',
      matched: '',
    };
  }
  return {
    allowed: true,
    reason: '',
    matched: evidence.matched,
    evidence: evidence.kind,
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
  const masked = maskRoadDistanceAmounts(maskConstructionCostsForPriceExtraction(maskPhonesForPriceExtraction(text)));
  const candidates = [];
  for (const match of masked.matchAll(SOURCE_PRICE_EVIDENCE_PATTERN)) {
    const token = compactText(match[0]);
    if (!token || !/(?:zar|\br\s*\d|ugx|ush|shs?|usd|us\$|\$|eur|€|gbp|£|bn|b|billion|m(?:n|illion)?|k|thousand|\/\s*(?:month|mo|m²|sqm)|per\s+(?:month|m²|square\s+metre)|monthly)/i.test(token)) continue;
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
  const eachPlot = preferEachPlotPrice(sourceText, numericValue);
  if (eachPlot && eachPlot !== numericValue) {
    return { value: eachPlot, reason: 'quoted_unit_price' };
  }
  return { value, reason: '' };
}

module.exports = {
  foreignSourceMarketStatus,
  ugandaFoundOnlineEvidence,
  maskConstructionCostsForPriceExtraction,
  maskPhonesForPriceExtraction,
  normalizeUgandanSourcePhone,
  safeSourcePriceCandidate,
  sourcePriceEvidenceAmounts,
  sourcePriceHasEvidence,
  sourcePriceMatchesPhone,
  ugandanPhoneFromSourceText,
};
