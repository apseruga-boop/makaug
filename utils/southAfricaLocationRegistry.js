'use strict';

const gazetteer = require('./southAfricaLocationGazetteer.generated.json');
const {
  locationQueryAttempts,
  normalizeLocationQueryCandidates
} = require('./locationQueryNormalization');

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

function southAfricaLocationQueryAttempts(value = '') {
  return locationQueryAttempts(value, {
    countryCode: 'ZA',
    countryCodes: ['ZA', 'UG'],
    normalizeKey: normalizeLocationKey
  });
}

function entryKey(province, city, suburb = '') {
  return [slug(province), slug(city), slug(suburb)].filter(Boolean).join(':');
}

const CITY_IDENTITIES = Object.freeze([
  { province: 'Eastern Cape', source: 'Port Elizaberth', canonical: 'Gqeberha', aliases: ['Port Elizabeth', 'PE', 'iBhayi'] },
  { province: 'Eastern Cape', source: 'Grahamstown', canonical: 'Makhanda', aliases: ['Grahamstown'] },
  { province: 'Eastern Cape', source: 'Uitenhage', canonical: 'Kariega', aliases: ['Uitenhage'] },
  { province: 'Eastern Cape', source: 'Queenstown', canonical: 'Komani', aliases: ['Queenstown'] },
  { province: 'Eastern Cape', source: "King William's Town", canonical: 'Qonce', aliases: ["King William's Town", 'King Williams Town'] },
  { province: 'Eastern Cape', source: "Jeffrey's Bay", canonical: 'Jeffreys Bay', aliases: ["Jeffrey's Bay", 'J-Bay', 'JBay'] },
  { province: 'North West', source: 'Mafikeng', canonical: 'Mahikeng', aliases: ['Mafikeng'] },
  { province: 'Mpumalanga', source: 'Mbombela', canonical: 'Mbombela', aliases: ['Nelspruit'] },
  { province: 'Mpumalanga', source: 'eMalahleni', canonical: 'eMalahleni', aliases: ['Witbank'] },
  { province: 'Limpopo', source: 'Polokwane', canonical: 'Polokwane', aliases: ['Pietersburg'] },
  { province: 'Limpopo', source: 'Mokopane', canonical: 'Mokopane', aliases: ['Potgietersrus'] },
  { province: 'Limpopo', source: 'Modimolle', canonical: 'Modimolle', aliases: ['Nylstroom'] },
  { province: 'Limpopo', source: 'Bela-Bela', canonical: 'Bela-Bela', aliases: ['Warmbaths'] },
  { province: 'Limpopo', source: 'Lephalale', canonical: 'Lephalale', aliases: ['Ellisras'] },
  { province: 'Limpopo', source: 'Musina', canonical: 'Musina', aliases: ['Messina'] },
  { province: 'Eastern Cape', source: 'Mthatha', canonical: 'Mthatha', aliases: ['Umtata'] },
  { province: 'Gauteng', source: 'Pretoria', canonical: 'Pretoria', aliases: ['Tshwane'] },
  { province: 'KwaZulu-Natal', source: 'Durban', canonical: 'Durban', aliases: ['eThekwini'] }
]);

const cityIdentityBySource = new Map(CITY_IDENTITIES.map((identity) => [
  `${identity.province}\u0000${normalizeLocationKey(identity.source)}`,
  identity
]));

function canonicalCityIdentity(province, value = '') {
  const source = String(value || '').trim();
  const identity = cityIdentityBySource.get(`${province}\u0000${normalizeLocationKey(source)}`);
  if (!identity) return { name: source, aliases: [source] };
  return {
    name: identity.canonical,
    aliases: Array.from(new Set([identity.canonical, source, ...(identity.aliases || [])]))
  };
}

function canonicalMunicipality(value = '') {
  const clean = String(value || '').trim();
  if (normalizeLocationKey(clean) === 'mafikeng') return 'Mahikeng';
  return clean;
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
  const sourceCity = String(row.city || '').trim();
  const cityIdentity = canonicalCityIdentity(province, sourceCity);
  const city = cityIdentity.name;
  const sourceSuburb = String(row.suburb || '').trim();
  const suburb = normalizeLocationKey(sourceSuburb) === normalizeLocationKey(sourceCity)
    ? city
    : sourceSuburb;
  if (!province || !city || !suburb) continue;
  const municipality = canonicalMunicipality(row.municipality);
  const districtMunicipality = String(row.district_municipality || '').trim();
  const cityKey = entryKey(province, city);
  if (!registryByKey.has(cityKey)) {
    const cityAliases = new Set(cityIdentity.aliases.flatMap((alias) => [alias, `${alias}, ${province}`]));
    registryByKey.set(cityKey, {
      key: cityKey,
      code: row.city_code || '',
      name: city,
      province,
      district: province,
      city,
      town: city,
      suburb: '',
      municipality,
      district_municipality: districtMunicipality,
      level: 'city',
      lat: null,
      lng: null,
      aliases: Array.from(cityAliases)
    });
  }
  const key = entryKey(province, city, suburb);
  if (registryByKey.has(key)) continue;
  const aliases = new Set([suburb, `${suburb}, ${city}`, `${suburb}, ${city}, ${province}`]);
  if (sourceSuburb !== suburb) aliases.add(sourceSuburb);
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
    municipality,
    district_municipality: districtMunicipality,
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

const prominentExactDefaults = new Map([
  ['gqeberha', entryKey('Eastern Cape', 'Gqeberha')],
  ['port elizabeth', entryKey('Eastern Cape', 'Gqeberha')],
  ['pe', entryKey('Eastern Cape', 'Gqeberha')],
  ['sandton', entryKey('Gauteng', 'Sandton')],
  ['soweto', entryKey('Gauteng', 'Soweto')],
  ['germiston', entryKey('Gauteng', 'Germiston')],
  ['welkom', entryKey('Free State', 'Welkom')],
  ['bethlehem', entryKey('Free State', 'Bethlehem')],
  ['worcester', entryKey('Western Cape', 'Worcester')],
  ['emalahleni', entryKey('Mpumalanga', 'eMalahleni')],
  ['witbank', entryKey('Mpumalanga', 'eMalahleni')],
  ['mbombela', entryKey('Mpumalanga', 'Mbombela')],
  ['nelspruit', entryKey('Mpumalanga', 'Mbombela')],
  ['mahikeng', entryKey('North West', 'Mahikeng')],
  ['mafikeng', entryKey('North West', 'Mahikeng')],
  ['kimberley', entryKey('Northern Cape', 'Kimberley')],
  ['pretoria', entryKey('Gauteng', 'Pretoria')],
  ['tshwane', entryKey('Gauteng', 'Pretoria')],
  ['durban', entryKey('KwaZulu-Natal', 'Durban')],
  ['ethekwini', entryKey('KwaZulu-Natal', 'Durban')],
  ['makhanda', entryKey('Eastern Cape', 'Makhanda')],
  ['grahamstown', entryKey('Eastern Cape', 'Makhanda')],
  ['polokwane', entryKey('Limpopo', 'Polokwane')],
  ['pietersburg', entryKey('Limpopo', 'Polokwane')],
  ['kariega', entryKey('Eastern Cape', 'Kariega')],
  ['uitenhage', entryKey('Eastern Cape', 'Kariega')],
  ['komani', entryKey('Eastern Cape', 'Komani')],
  ['queenstown', entryKey('Eastern Cape', 'Komani')],
  ['qonce', entryKey('Eastern Cape', 'Qonce')],
  ['king william s town', entryKey('Eastern Cape', 'Qonce')],
  ['mthatha', entryKey('Eastern Cape', 'Mthatha')],
  ['umtata', entryKey('Eastern Cape', 'Mthatha')],
  ['modimolle', entryKey('Limpopo', 'Modimolle')],
  ['nylstroom', entryKey('Limpopo', 'Modimolle')],
  ['bela bela', entryKey('Limpopo', 'Bela-Bela')],
  ['warmbaths', entryKey('Limpopo', 'Bela-Bela')],
  ['lephalale', entryKey('Limpopo', 'Lephalale')],
  ['ellisras', entryKey('Limpopo', 'Lephalale')],
  ['musina', entryKey('Limpopo', 'Musina')],
  ['messina', entryKey('Limpopo', 'Musina')],
  ['mokopane', entryKey('Limpopo', 'Mokopane')],
  ['potgietersrus', entryKey('Limpopo', 'Mokopane')],
  ['jeffreys bay', entryKey('Eastern Cape', 'Jeffreys Bay')],
  ['jeffrey s bay', entryKey('Eastern Cape', 'Jeffreys Bay')],
  ['j bay', entryKey('Eastern Cape', 'Jeffreys Bay')],
  ['jbay', entryKey('Eastern Cape', 'Jeffreys Bay')]
]);

function provinceHintFromQuery(value = '', suppliedProvince = '') {
  const supplied = normalizeDistrict(suppliedProvince);
  if (supplied) return supplied;
  return String(value || '')
    .split(',')
    .map(normalizeDistrict)
    .find(Boolean) || '';
}

function exactCandidates(value = '', suppliedProvince = '', options = {}) {
  const raw = String(value || '').trim();
  const needle = normalizeLocationKey(raw);
  const provinceHint = normalizeDistrict(suppliedProvince);
  if (!needle || (options.noiseStripped && normalizeDistrict(raw))) return [];
  const matches = aliasRows
    .filter((row) => row.aliasKey === needle)
    .filter((row) => !provinceHint || row.entry.province === provinceHint)
    .filter((row) => !(options.noiseStripped && row.entry.level === 'province'))
    .map((row) => row.entry);
  const candidates = Array.from(new Map(matches.map((entry) => [entry.key, entry])).values());
  const grouped = new Map();
  for (const entry of candidates) {
    const municipality = entry.municipality || entry.district_municipality || entry.province;
    const groupKey = `${normalizeLocationKey(entry.province)}\u0000${normalizeLocationKey(municipality)}`;
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey).push(entry);
  }
  const preferredKey = prominentExactDefaults.get(needle);
  const collapsed = Array.from(grouped.values()).map((entries) => {
    const preferred = preferredKey ? entries.find((entry) => entry.key === preferredKey) : null;
    if (preferred) return preferred;
    return entries.sort((a, b) => {
      const score = (entry) => (
        (entry.level === 'city' ? 100 : entry.level === 'suburb' ? 50 : 10)
        + (normalizeLocationKey(entry.city) === needle ? 20 : 0)
        + (normalizeLocationKey(entry.name) === needle ? 10 : 0)
        + (/\bnu$/i.test(entry.city || '') ? -5 : 0)
      );
      return score(b) - score(a) || a.key.localeCompare(b.key);
    })[0];
  });
  return collapsed.sort((a, b) => (
    ({ suburb: 3, city: 2, province: 1 }[b.level] - { suburb: 3, city: 2, province: 1 }[a.level])
    || a.key.localeCompare(b.key)
  ));
}

function sameAdministrativePlace(left = {}, right = {}) {
  if (!left?.key || !right?.key) return false;
  const leftMunicipality = left.municipality || left.district_municipality || left.province;
  const rightMunicipality = right.municipality || right.district_municipality || right.province;
  return left.province === right.province
    && normalizeLocationKey(leftMunicipality) === normalizeLocationKey(rightMunicipality);
}

function resolveCanonicalSouthAfricaLocation(value = '', suppliedProvince = '') {
  const provinceHint = provinceHintFromQuery(value, suppliedProvince);
  const attempts = southAfricaLocationQueryAttempts(value);
  let candidates = [];
  let matchedAttempt = null;
  for (const attempt of attempts) {
    candidates = exactCandidates(attempt.value, provinceHint, { noiseStripped: attempt.noise_stripped });
    if (candidates.length) {
      matchedAttempt = attempt;
      break;
    }
  }
  if (!candidates.length) return { status: 'unmatched', match: null, candidates: [], confidence: 0, match_type: 'unmatched', matched_query: null };
  const inputKey = matchedAttempt?.normalized || '';
  const preferredKey = prominentExactDefaults.get(inputKey);
  const preferred = preferredKey ? candidates.find((entry) => entry.key === preferredKey) : null;
  if (preferred) {
    return { status: 'matched', match: clone(preferred), candidates: candidates.map(clone), confidence: 1, match_type: 'exact_alias', matched_query: matchedAttempt.value };
  }
  const keys = new Set(candidates.map((entry) => entry.key));
  if (keys.size !== 1) {
    return { status: 'ambiguous', match: null, candidates: candidates.map(clone), confidence: 0, match_type: 'ambiguous_exact_alias', matched_query: matchedAttempt.value };
  }
  return { status: 'matched', match: clone(candidates[0]), candidates: candidates.map(clone), confidence: 1, match_type: 'exact_alias', matched_query: matchedAttempt.value };
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
  const attempts = southAfricaLocationQueryAttempts(query);
  if (!attempts.length) return [];
  const exact = resolveCanonicalSouthAfricaLocation(query);
  const exactQueryKey = normalizeLocationKey(exact.matched_query || '');
  const matchedEntries = new Map();
  for (const row of aliasRows) {
    const isExact = Boolean(exactQueryKey && row.aliasKey === exactQueryKey);
    const searchable = exactQueryKey ? [] : attempts.map((attempt) => attempt.normalized);
    const isPrefix = !isExact && searchable.some((needle) => row.aliasKey.startsWith(needle));
    const isContains = !isExact && !isPrefix && searchable.some((needle) => needle.length >= 3 && row.aliasKey.includes(needle));
    if (!isExact && !isPrefix && !isContains) continue;
    const rank = isExact ? 3 : isPrefix ? 2 : 1;
    const existing = matchedEntries.get(row.entry.key);
    if (!existing || rank > existing.rank) matchedEntries.set(row.entry.key, { entry: row.entry, isExact, rank });
  }
  return Array.from(matchedEntries.values()).map(({ entry, isExact, rank: searchRank }) => {
    const exactTarget = isExact && exact.status === 'matched' ? exact.match : null;
    if (exactTarget && entry.key !== exactTarget.key && sameAdministrativePlace(entry, exactTarget)) return null;
    const isSecondaryExact = Boolean(isExact && exactTarget && entry.key !== exactTarget.key);
    const match = isExact && !isSecondaryExact
      ? 'exact_alias'
      : isSecondaryExact
        ? 'secondary_alias'
        : searchRank === 2 ? 'prefix' : 'contains';
    return {
      canonical_key: entry.key,
      location: entry.name,
      district: entry.province,
      province: entry.province,
      city: entry.city || null,
      suburb: entry.suburb || null,
      town: entry.city || null,
      municipality: entry.municipality || null,
      district_municipality: entry.district_municipality || null,
      level: entry.level,
      latitude: null,
      longitude: null,
      aliases: [...entry.aliases],
      listing_count: Number(counts.get(entry.key) || 0),
      match,
      did_you_mean: isSecondaryExact,
      confidence: isExact ? (isSecondaryExact ? 0.95 : 1) : searchRank === 2 ? 0.9 : 0.8,
      auto_resolvable: isExact && exact.status === 'matched' && exact.match?.key === entry.key,
      rank: isExact && !isSecondaryExact ? 4 : isSecondaryExact ? 3 : searchRank
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
  const provinceTotals = new Map();
  const cityTotals = new Map();

  for (const entry of registry) {
    const count = Math.max(0, Number(direct.get(entry.key)) || 0);
    provinceTotals.set(entry.province, (provinceTotals.get(entry.province) || 0) + count);
    if (entry.city) {
      const cityKey = `${entry.province}\u0000${entry.city}`;
      cityTotals.set(cityKey, (cityTotals.get(cityKey) || 0) + count);
    }
  }

  for (const parent of registry) {
    if (parent.level === 'province') {
      rolled.set(parent.key, provinceTotals.get(parent.province) || 0);
    } else if (parent.level === 'city') {
      rolled.set(parent.key, cityTotals.get(`${parent.province}\u0000${parent.city}`) || 0);
    }
  }
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
  normalizeLocationQueryCandidates: (value = '') => normalizeLocationQueryCandidates(value, {
    countryCode: 'ZA',
    countryCodes: ['ZA', 'UG'],
    normalizeKey: normalizeLocationKey
  }),
  resolveCanonicalSouthAfricaLocation,
  resolveCanonicalSouthAfricaLocationFromText,
  resolveCanonicalUgandaLocation: resolveCanonicalSouthAfricaLocation,
  resolveCanonicalUgandaLocationFromText: resolveCanonicalSouthAfricaLocationFromText,
  trigramSimilarity
};
