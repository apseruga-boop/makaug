'use strict';

const {
  canonicalLocationSuggestions,
  resolveCanonicalUgandaLocation,
  resolveCanonicalUgandaLocationFromText
} = require('../utils/locationRegistry');
const { regionForDistrict } = require('../utils/ugandaLocationHierarchy');

const ACTIVE_COUNTRY_CODE = String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase();
const IS_SOUTH_AFRICA = ACTIVE_COUNTRY_CODE === 'ZA';

function cleanText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function nullableCoordinate(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function publicCandidate(candidate = {}) {
  return {
    canonical_location_id: candidate.key || candidate.canonical_location_id || null,
    area: candidate.name || candidate.area || null,
    district: candidate.district || null,
    region: IS_SOUTH_AFRICA
      ? (candidate.province || candidate.district || null)
      : (candidate.district ? regionForDistrict(candidate.district) : null),
    province: candidate.province || (IS_SOUTH_AFRICA ? candidate.district : null),
    city: candidate.city || candidate.town || null,
    suburb: candidate.suburb || (candidate.level === 'suburb' ? candidate.name : null),
    level: candidate.level || null,
    town: candidate.town || null,
    latitude: nullableCoordinate(candidate.lat ?? candidate.latitude),
    longitude: nullableCoordinate(candidate.lng ?? candidate.longitude)
  };
}

function resolveWhatsappLocation(value = '', { district = '', allowText = false } = {}) {
  const query = cleanText(value);
  const suppliedDistrict = cleanText(district);
  if (!query) {
    return {
      status: 'unmatched',
      query,
      match: null,
      candidates: [],
      suggestions: [],
      approval_blocked: true,
      match_type: 'unmatched',
      confidence: 0
    };
  }

  let resolution = resolveCanonicalUgandaLocation(query);
  if (resolution.status !== 'matched' && suppliedDistrict) {
    const contextualResolution = resolveCanonicalUgandaLocation(query, suppliedDistrict);
    if (contextualResolution.status === 'matched') resolution = contextualResolution;
  }
  if (allowText && resolution.status !== 'matched') {
    const textResolution = resolveCanonicalUgandaLocationFromText(query, suppliedDistrict);
    if (textResolution.status === 'matched' || resolution.status === 'unmatched') {
      resolution = textResolution;
    }
  }

  const candidates = (resolution.candidates || []).map(publicCandidate);
  const suggestions = resolution.status === 'unmatched'
    ? canonicalLocationSuggestions(query, new Map(), 3)
      .filter((item) => item.match !== 'exact_alias')
      .map(publicCandidate)
    : [];
  const match = resolution.status === 'matched' && resolution.match
    ? publicCandidate(resolution.match)
    : null;

  return {
    status: resolution.status,
    query,
    match,
    candidates,
    suggestions,
    approval_blocked: resolution.status !== 'matched',
    match_type: resolution.match_type,
    confidence: resolution.status === 'matched' ? Number(resolution.confidence) || 0 : 0
  };
}

function canonicalWhatsappLocationPatch(resolution = {}, { includeDistrictLevelArea = false } = {}) {
  if (resolution.status !== 'matched' || !resolution.match?.canonical_location_id) return {};
  const match = resolution.match;
  const area = ['district', 'region'].includes(match.level) && !includeDistrictLevelArea
    ? null
    : match.area;
  return {
    ...(area ? { area } : {}),
    district: match.district,
    region: match.region,
    canonical_location_id: match.canonical_location_id,
    canonical_location_level: match.level,
    canonical_location_match: 'exact_alias',
    canonical_location_confidence: 1,
    canonical_location_source: IS_SOUTH_AFRICA
      ? 'shared_south_africa_location_registry'
      : 'shared_uganda_location_registry',
    ...(IS_SOUTH_AFRICA ? {
      province: match.province || match.district,
      city: match.city || match.town || null,
      suburb: match.suburb || (match.level === 'suburb' ? match.area : null)
    } : {})
  };
}

function whatsappLocationPrompt(resolution = {}) {
  const query = cleanText(resolution.query) || 'that place';
  if (resolution.status === 'ambiguous') {
    const options = (resolution.candidates || [])
      .filter((candidate) => candidate.area && candidate.district)
      .slice(0, 6)
      .map((candidate) => `• ${candidate.area}, ${candidate.district}`);
    return [
      `📍 I found more than one ${IS_SOUTH_AFRICA ? 'South African' : 'Uganda'} place called *${query}* and will not guess.`,
      options.length ? options.join('\n') : '',
      `Reply with the place and ${IS_SOUTH_AFRICA ? 'province' : 'district'}, for example: *${resolution.candidates?.[0]?.area || query}, ${resolution.candidates?.[0]?.district || (IS_SOUTH_AFRICA ? 'province' : 'district')}*.`
    ].filter(Boolean).join('\n\n');
  }

  const suggestions = (resolution.suggestions || [])
    .filter((candidate) => candidate.area && candidate.district)
    .slice(0, 3)
    .map((candidate) => `${candidate.area}, ${candidate.district}`);
  return [
    `📍 I could not match *${query}* to an exact ${IS_SOUTH_AFRICA ? 'South African' : 'Uganda'} location, so I have not guessed or saved a ${IS_SOUTH_AFRICA ? 'province' : 'district'}.`,
    suggestions.length ? `Did you mean: ${suggestions.join(' · ')}?` : '',
    IS_SOUTH_AFRICA
      ? 'Please reply with the suburb and province, for example: *Sea Point, Western Cape*.'
      : 'Please reply with the area and district, for example: *Sentema, Wakiso*.'
  ].filter(Boolean).join('\n\n');
}

function canonicalizeWhatsappSearchFilters(filters = {}, originalText = '') {
  const next = { ...(filters || {}) };
  const area = cleanText(next.area || next.district);
  if (!area) return next;

  const resolution = resolveWhatsappLocation(area, {
    district: cleanText(next.district),
    allowText: false
  });
  next.location_resolution = resolution;
  next.location_status = resolution.status;
  next.location_blocked = resolution.approval_blocked;
  if (resolution.status !== 'matched') return next;

  const patch = canonicalWhatsappLocationPatch(resolution, { includeDistrictLevelArea: true });
  return {
    ...next,
    ...patch,
    area: patch.area || area,
    location_query_text: cleanText(originalText) || area,
    location_blocked: false
  };
}

module.exports = {
  canonicalizeWhatsappSearchFilters,
  canonicalWhatsappLocationPatch,
  publicCandidate,
  resolveWhatsappLocation,
  whatsappLocationPrompt
};
