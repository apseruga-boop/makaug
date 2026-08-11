'use strict';

const gazetteer = require('./southAfricaLocationGazetteer.generated.json');

const PROVINCES = Object.freeze([
  'Western Cape', 'Gauteng', 'KwaZulu-Natal', 'Eastern Cape', 'Free State',
  'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape'
]);

function normalizeLocationKey(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function slug(value = '') {
  return normalizeLocationKey(value).replace(/\s+/g, '-');
}

const provinceByKey = new Map(PROVINCES.map((province) => [normalizeLocationKey(province), province]));
provinceByKey.set('kzn', 'KwaZulu-Natal');
provinceByKey.set('kwazulu natal', 'KwaZulu-Natal');
provinceByKey.set('western cape province', 'Western Cape');
provinceByKey.set('eastern cape province', 'Eastern Cape');
provinceByKey.set('northern cape province', 'Northern Cape');
provinceByKey.set('north west province', 'North West');

function normalizeDistrict(value = '') {
  return provinceByKey.get(normalizeLocationKey(value).replace(/\s+province$/, '')) || '';
}

function entryKey(province, city, suburb = '') {
  return [slug(province), slug(city), slug(suburb)].filter(Boolean).join(':');
}

const registryByKey = new Map();
for (const province of PROVINCES) {
  registryByKey.set(entryKey(province, province), {
    key: entryKey(province, province),
    code: '',
    name: province,
    province,
    district: province,
    city: '',
    town: '',
    suburb: '',
    level: 'province',
    lat: null,
    lng: null,
    aliases: [province, `${province} Province`]
  });
}

for (const row of gazetteer.locations || []) {
  const province = normalizeDistrict(row.province);
  const city = String(row.city || '').trim();
  const suburb = String(row.suburb || '').trim();
  if (!province || !city || !suburb) continue;
  const cityKey = entryKey(province, city);
  if (!registryByKey.has(cityKey)) {
    registryByKey.set(cityKey, {
      key: cityKey,
      code: row.city_code || '',
      name: city,
      province,
      district: province,
      city,
      town: city,
      suburb: '',
      level: 'city',
      lat: null,
      lng: null,
      aliases: [city, `${city}, ${province}`]
    });
  }
  const key = entryKey(province, city, suburb);
  if (registryByKey.has(key)) continue;
  const aliases = new Set([suburb, `${suburb}, ${city}`, `${suburb}, ${city}, ${province}`]);
  if (row.source_name && row.source_name !== suburb) aliases.add(row.source_name);
  registryByKey.set(key, {
    key,
    code: row.code || '',
    name: suburb,
    province,
    district: province,
    city,
    town: city,
    suburb,
    municipality: row.municipality || '',
    district_municipality: row.district_municipality || '',
    level: 'suburb',
    lat: null,
    lng: null,
    aliases: Array.from(aliases)
  });
}

const registry = Array.from(registryByKey.values());
const aliasRows = registry.flatMap((entry) => entry.aliases.map((alias) => ({
  alias,
  aliasKey: normalizeLocationKey(alias),
  entry
}))).filter((row) => row.aliasKey).sort((a, b) => b.aliasKey.length - a.aliasKey.length);

function clone(entry) {
  return entry ? { ...entry, aliases: [...entry.aliases] } : null;
}

function canonicalLocationByKey(value = '') {
  return clone(registryByKey.get(String(value || '').trim().toLowerCase()));
}

function exactCandidates(value = '', suppliedProvince = '') {
  const raw = String(value || '').trim();
  const fullKey = normalizeLocationKey(raw);
  const firstKey = normalizeLocationKey(raw.split(',')[0]);
  const provinceHint = normalizeDistrict(suppliedProvince)
    || raw.split(',').slice(1).map(normalizeDistrict).find(Boolean)
    || '';
  const matches = aliasRows
    .filter((row) => row.aliasKey === fullKey || row.aliasKey === firstKey)
    .filter((row) => !provinceHint || row.entry.province === provinceHint)
    .map((row) => row.entry);
  return Array.from(new Map(matches.map((entry) => [entry.key, entry])).values())
    .sort((a, b) => ({ suburb: 3, city: 2, province: 1 }[b.level] - { suburb: 3, city: 2, province: 1 }[a.level]) || a.key.localeCompare(b.key));
}

function resolveCanonicalSouthAfricaLocation(value = '', suppliedProvince = '') {
  const candidates = exactCandidates(value, suppliedProvince);
  if (!candidates.length) return { status: 'unmatched', match: null, candidates: [], confidence: 0, match_type: 'unmatched' };
  const keys = new Set(candidates.map((entry) => entry.key));
  if (keys.size !== 1) {
    return { status: 'ambiguous', match: null, candidates: candidates.map(clone), confidence: 0, match_type: 'ambiguous_exact_alias' };
  }
  return { status: 'matched', match: clone(candidates[0]), candidates: candidates.map(clone), confidence: 1, match_type: 'exact_alias' };
}

function aliasAppears(aliasKey, valueKey) {
  return (` ${valueKey} `).includes(` ${aliasKey} `);
}

function resolveCanonicalSouthAfricaLocationFromText(value = '', suppliedProvince = '') {
  const valueKey = normalizeLocationKey(value);
  const provinceHint = normalizeDistrict(suppliedProvince);
  if (!valueKey) return { status: 'unmatched', match: null, candidates: [], confidence: 0, match_type: 'unmatched' };
  const stop = new Set(['south africa', 'province', 'city', 'town', 'suburb', 'property', 'home', 'house', 'land']);
  const found = aliasRows
    .filter((row) => row.aliasKey.length >= 4 && !stop.has(row.aliasKey))
    .filter((row) => aliasAppears(row.aliasKey, valueKey))
    .filter((row) => !provinceHint || row.entry.province === provinceHint)
    .map((row) => ({ ...row, depth: { suburb: 3, city: 2, province: 1 }[row.entry.level], words: row.aliasKey.split(' ').length }));
  if (!found.length) return { status: 'unmatched', match: null, candidates: [], confidence: 0, match_type: 'unmatched' };
  const bestDepth = Math.max(...found.map((row) => row.depth));
  const depthMatches = found.filter((row) => row.depth === bestDepth);
  const bestWords = Math.max(...depthMatches.map((row) => row.words));
  const wordMatches = depthMatches.filter((row) => row.words === bestWords);
  const bestLength = Math.max(...wordMatches.map((row) => row.aliasKey.length));
  let candidates = Array.from(new Map(wordMatches.filter((row) => row.aliasKey.length === bestLength).map((row) => [row.entry.key, row.entry])).values());

  if (candidates.length > 1) {
    const mentionedProvince = PROVINCES.filter((province) => aliasAppears(normalizeLocationKey(province), valueKey));
    if (mentionedProvince.length === 1) candidates = candidates.filter((entry) => entry.province === mentionedProvince[0]);
  }
  if (candidates.length !== 1) {
    return { status: 'ambiguous', match: null, candidates: candidates.map(clone), confidence: 0, match_type: 'ambiguous_exact_alias_in_text' };
  }
  return { status: 'matched', match: clone(candidates[0]), candidates: candidates.map(clone), confidence: 1, match_type: 'exact_alias_in_text' };
}

function canonicalizeSouthAfricaLocation(area = '', province = '') {
  const resolution = resolveCanonicalSouthAfricaLocation(area || province, province);
  return resolution.status === 'matched' ? resolution.match : null;
}

function canonicalLocationForRow(row = {}) {
  const extra = row.extra_fields || row.admin_extra_fields || {};
  const byId = canonicalLocationByKey(row.canonical_location_id || extra.canonical_location_id);
  if (byId) return byId;
  return canonicalizeSouthAfricaLocation(row.area || row.suburb || row.city, row.district || row.province);
}

function canonicalDisplayLocationForRow(row = {}) {
  const location = canonicalLocationForRow(row);
  if (!location) return null;
  return {
    canonical_location_id: location.key,
    area: location.level === 'suburb' ? location.suburb : null,
    district: location.province,
    province: location.province,
    city: location.city || null,
    suburb: location.suburb || null,
    level: location.level
  };
}

function canonicalizeLocationRows(rows = []) {
  return rows.map((row) => {
    const location = canonicalLocationForRow(row);
    if (!location) return row;
    return {
      ...row,
      area: location.level === 'suburb' ? location.suburb : (location.city || location.name),
      district: location.province,
      canonical_location_id: location.key,
      canonical_location_level: location.level,
      extra_fields: {
        ...(row.extra_fields || {}),
        canonical_location_id: location.key,
        canonical_location_level: location.level,
        province: location.province,
        city: location.city || null,
        suburb: location.suburb || null
      }
    };
  });
}

function canonicalLocationOptions() {
  return registry.map(clone);
}

function canonicalLocationSuggestions(query = '', counts = new Map(), limit = 8) {
  const needle = normalizeLocationKey(query);
  if (!needle) return [];
  const exact = resolveCanonicalSouthAfricaLocation(query);
  return registry.map((entry) => {
    const aliases = entry.aliases.map(normalizeLocationKey);
    const isExact = aliases.includes(needle);
    const isPrefix = aliases.some((alias) => alias.startsWith(needle));
    const isContains = needle.length >= 3 && aliases.some((alias) => alias.includes(needle));
    if (!isExact && !isPrefix && !isContains) return null;
    return {
      canonical_key: entry.key,
      location: entry.name,
      district: entry.province,
      province: entry.province,
      city: entry.city || null,
      suburb: entry.suburb || null,
      town: entry.city || null,
      level: entry.level,
      latitude: null,
      longitude: null,
      aliases: [...entry.aliases],
      listing_count: Number(counts.get(entry.key) || 0),
      match: isExact ? 'exact_alias' : isPrefix ? 'prefix' : 'contains',
      did_you_mean: false,
      confidence: isExact ? 1 : isPrefix ? 0.9 : 0.8,
      auto_resolvable: isExact && exact.status === 'matched' && exact.match?.key === entry.key,
      rank: isExact ? 3 : isPrefix ? 2 : 1
    };
  }).filter(Boolean).sort((a, b) => b.rank - a.rank || b.listing_count - a.listing_count || a.location.localeCompare(b.location)).slice(0, Math.max(1, Math.min(8, Number(limit) || 8)));
}

function canonicalLocationSearchScope(keys = [], nearbyKm = 0) {
  const exact = Array.from(new Set(keys)).map(canonicalLocationByKey).filter(Boolean).slice(0, 5);
  return { selected: exact, exact, nearby: Number(nearbyKm) > 0 ? [] : [] };
}

function canonicalLocationRollupCounts(counts = new Map()) {
  const direct = counts instanceof Map ? counts : new Map(Object.entries(counts || {}));
  const rolled = new Map(direct);
  registry.filter((entry) => entry.level !== 'suburb').forEach((parent) => {
    const descendants = registry.filter((entry) => parent.level === 'province'
      ? entry.province === parent.province
      : entry.province === parent.province && entry.city === parent.city);
    rolled.set(parent.key, descendants.reduce((sum, child) => sum + Math.max(0, Number(direct.get(child.key)) || 0), 0));
  });
  return rolled;
}

function aliasesForCanonicalLocation(location = {}) {
  return (canonicalLocationByKey(location.key)?.aliases || location.aliases || [location.name]).map(normalizeLocationKey).filter(Boolean);
}

function aliasesForDistrict(province = '') {
  const canonical = normalizeDistrict(province);
  return Array.from(new Set(registry.filter((entry) => entry.province === canonical).flatMap((entry) => entry.aliases).map(normalizeLocationKey)));
}

function canonicalSouthAfricaProvincesMentionedInText(value = '') {
  const key = normalizeLocationKey(value);
  return PROVINCES.filter((province) => aliasAppears(normalizeLocationKey(province), key));
}

function haversineKm(a = {}, b = {}) {
  if (![a.lat, a.lng, b.lat, b.lng].every((value) => Number.isFinite(Number(value)))) return null;
  const rad = (degrees) => (Number(degrees) * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const chord = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(chord), Math.sqrt(1 - chord));
}

function isExcludedLocationOnly() { return false; }
function trigramSimilarity() { return 0; }

module.exports = {
  CANONICAL_LOCATION_COUNT: registry.length,
  PROVINCES,
  aliasesForCanonicalLocation,
  aliasesForDistrict,
  canonicalDisplayLocationForRow,
  canonicalLocationByKey,
  canonicalLocationForRow,
  canonicalLocationOptions,
  canonicalLocationRollupCounts,
  canonicalLocationSearchScope,
  canonicalLocationSuggestions,
  canonicalSouthAfricaProvincesMentionedInText,
  canonicalUgandaDistrictsMentionedInText: canonicalSouthAfricaProvincesMentionedInText,
  canonicalizeLocationRows,
  canonicalizeSouthAfricaLocation,
  canonicalizeUgandaLocation: canonicalizeSouthAfricaLocation,
  haversineKm,
  isExcludedLocationOnly,
  normalizeDistrict,
  normalizeLocationKey,
  resolveCanonicalSouthAfricaLocation,
  resolveCanonicalSouthAfricaLocationFromText,
  resolveCanonicalUgandaLocation: resolveCanonicalSouthAfricaLocation,
  resolveCanonicalUgandaLocationFromText: resolveCanonicalSouthAfricaLocationFromText,
  trigramSimilarity
};
