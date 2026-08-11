'use strict';

const COUNTRY_QUERY_ALIASES = Object.freeze({
  UG: Object.freeze(['uganda', 'ug', 'republic of uganda', 'east africa']),
  ZA: Object.freeze(['south africa', 'za', 'rsa', 'republic of south africa'])
});

const ROAD_NOISE_PART_PATTERN = /\b(?:road|rd|street|st|avenue|ave|highway|bypass|expressway|drive|dr|lane|ln|boulevard|blvd)\.?\b/i;
const PREMISE_NOISE_PART_PATTERN = /^(?:plot|stand|erf|unit|house|flat|apartment)?\s*\d+[a-z]?(?:[-/]\d+[a-z]?)?(?:\s|$)/i;

function defaultNormalizeLocationKey(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function cleanLocationQueryPart(value = '') {
  return String(value || '')
    .replace(/^[\s,;|/]+|[\s,;|/]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRoadOrPremiseNoisePart(value = '') {
  const clean = cleanLocationQueryPart(value);
  return Boolean(clean && (ROAD_NOISE_PART_PATTERN.test(clean) || PREMISE_NOISE_PART_PATTERN.test(clean)));
}

function countryAliasKeys(countryCode = '', normalizeKey = defaultNormalizeLocationKey) {
  const code = String(countryCode || process.env.COUNTRY_CODE || 'UG').trim().toUpperCase();
  return new Set((COUNTRY_QUERY_ALIASES[code] || []).map(normalizeKey).filter(Boolean));
}

function countryAliasPattern(countryCode = '') {
  const code = String(countryCode || process.env.COUNTRY_CODE || 'UG').trim().toUpperCase();
  return (COUNTRY_QUERY_ALIASES[code] || [])
    .slice()
    .sort((left, right) => right.length - left.length)
    .map((alias) => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
}

function stripCountryQueryAffixes(value = '', options = {}) {
  const normalizeKey = options.normalizeKey || defaultNormalizeLocationKey;
  const countryKeys = countryAliasKeys(options.countryCode, normalizeKey);
  const aliasPattern = countryAliasPattern(options.countryCode);
  const clean = cleanLocationQueryPart(value);
  if (!clean || !countryKeys.size) return clean;
  let stripped = cleanLocationQueryPart(
    clean
      .split(',')
      .map(cleanLocationQueryPart)
      .filter((part) => part && !countryKeys.has(normalizeKey(part)))
      .join(', ')
  );
  if (!aliasPattern) return stripped;
  const prefix = new RegExp(`^(?:${aliasPattern})(?:\\b|$)[\\s,;:|/-]*`, 'i');
  const suffix = new RegExp(`(?:^|[\\s,;:|/-]+)(?:${aliasPattern})$`, 'i');
  let previous = null;
  while (stripped && stripped !== previous) {
    previous = stripped;
    stripped = cleanLocationQueryPart(stripped.replace(prefix, '').replace(suffix, ''));
  }
  return stripped;
}

function locationQueryAttempts(value = '', options = {}) {
  const normalizeKey = options.normalizeKey || defaultNormalizeLocationKey;
  const countryKeys = countryAliasKeys(options.countryCode, normalizeKey);
  const raw = cleanLocationQueryPart(value);
  if (!raw) return [];
  const countryStripped = stripCountryQueryAffixes(raw, options);
  const values = [{ value: raw, noiseStripped: false }];
  if (countryStripped && countryStripped !== raw) values.push({ value: countryStripped, noiseStripped: false });

  const parts = String(countryStripped || raw)
    .split(',')
    .map(cleanLocationQueryPart)
    .filter(Boolean);
  const locationParts = parts.filter((part) => !isRoadOrPremiseNoisePart(part));
  const removedNoise = locationParts.length !== parts.length;
  for (let length = locationParts.length; length >= 1; length -= 1) {
    values.push({ value: locationParts.slice(0, length).join(', '), noiseStripped: removedNoise });
  }
  locationParts.forEach((part) => values.push({ value: part, noiseStripped: removedNoise }));

  const attempts = [];
  const seen = new Set();
  const add = (candidate, noiseStripped = false) => {
    const clean = cleanLocationQueryPart(candidate);
    const normalized = normalizeKey(clean);
    if (!clean || !normalized || countryKeys.has(normalized) || seen.has(normalized)) return;
    seen.add(normalized);
    attempts.push({ value: clean, normalized, noise_stripped: noiseStripped });
  };
  values.forEach(({ value: candidate, noiseStripped }) => {
    if (isRoadOrPremiseNoisePart(candidate) && !candidate.includes(',')) return;
    add(candidate, noiseStripped);
  });
  return attempts;
}

function normalizeLocationQueryCandidates(value = '', options = {}) {
  return locationQueryAttempts(value, options).map((attempt) => attempt.value);
}

module.exports = {
  COUNTRY_QUERY_ALIASES,
  cleanLocationQueryPart,
  isRoadOrPremiseNoisePart,
  locationQueryAttempts,
  normalizeLocationQueryCandidates,
  stripCountryQueryAffixes
};
