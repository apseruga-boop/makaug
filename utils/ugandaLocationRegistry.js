const { DISTRICTS } = require('./constants');

const DETAILED_LOCATIONS = [
  { name: 'Kampala', district: 'Kampala', level: 'district', lat: 0.3476, lng: 32.5825, aliases: ['Kampala', 'Kampala City', 'Central Kampala'] },
  { name: 'Nakasero', district: 'Kampala', lat: 0.318, lng: 32.582 },
  { name: 'Kololo', district: 'Kampala', lat: 0.356, lng: 32.612 },
  { name: 'Old Kampala', district: 'Kampala', lat: 0.313, lng: 32.569 },
  { name: 'Makerere', district: 'Kampala', lat: 0.335, lng: 32.568 },
  { name: 'Wandegeya', district: 'Kampala', lat: 0.336, lng: 32.57 },
  { name: 'Nakawa', district: 'Kampala', lat: 0.334, lng: 32.61 },
  { name: 'Ntinda', district: 'Kampala', lat: 0.357, lng: 32.612 },
  { name: 'Naguru', district: 'Kampala', lat: 0.338, lng: 32.611 },
  { name: 'Bukoto', district: 'Kampala', lat: 0.346, lng: 32.591, aliases: ['Bukoto', 'Bukotto'] },
  { name: 'Kisaasi', district: 'Kampala', lat: 0.364, lng: 32.589, aliases: ['Kisaasi', 'Kisasi'] },
  { name: 'Kyanja', district: 'Kampala', lat: 0.384, lng: 32.596, aliases: ['Kyanja', 'Komamboga Kyanja'] },
  { name: 'Komamboga', district: 'Kampala', lat: 0.394, lng: 32.598 },
  { name: 'Kiwatule', district: 'Kampala', lat: 0.372, lng: 32.625 },
  { name: 'Bugolobi', district: 'Kampala', lat: 0.317, lng: 32.612 },
  { name: 'Makindye', district: 'Kampala', lat: 0.301, lng: 32.586 },
  { name: 'Muyenga', district: 'Kampala', lat: 0.285, lng: 32.594 },
  { name: 'Ggaba', district: 'Kampala', lat: 0.274, lng: 32.619, aliases: ['Ggaba', 'Gaba'] },
  { name: 'Kansanga', district: 'Kampala', lat: 0.289, lng: 32.607 },
  { name: 'Buziga', district: 'Kampala', lat: 0.277, lng: 32.596 },
  { name: 'Bunga', district: 'Kampala', lat: 0.262, lng: 32.623 },
  { name: 'Kabalagala', district: 'Kampala', lat: 0.298, lng: 32.603 },
  { name: 'Munyonyo', district: 'Kampala', lat: 0.236, lng: 32.623, aliases: ['Munyonyo', 'Munyonjo'] },
  { name: 'Rubaga', district: 'Kampala', lat: 0.298, lng: 32.545, aliases: ['Rubaga', 'Lubaga'] },
  { name: 'Nateete', district: 'Kampala', lat: 0.318, lng: 32.536 },
  { name: 'Mengo', district: 'Kampala', lat: 0.306, lng: 32.557, aliases: ['Mengo', 'Mmengo'] },
  { name: 'Lungujja', district: 'Kampala', lat: 0.302, lng: 32.548 },
  { name: 'Kasubi', district: 'Kampala', lat: 0.333, lng: 32.555 },
  { name: 'Kikoni', district: 'Kampala', lat: 0.333, lng: 32.565 },
  { name: 'Ndeeba', district: 'Kampala', lat: 0.301, lng: 32.548 },
  { name: 'Kikuubo', district: 'Kampala', lat: 0.314, lng: 32.576 },

  { name: 'Wakiso', district: 'Wakiso', level: 'district', lat: 0.4044, lng: 32.4594, aliases: ['Wakiso', 'Wakiso District'] },
  { name: 'Entebbe', district: 'Wakiso', level: 'city', lat: 0.0512, lng: 32.4637, aliases: ['Entebbe', 'Entebbe Town', 'Entebbe Municipality'] },
  { name: 'Kitoro', district: 'Wakiso', lat: 0.055, lng: 32.464 },
  { name: 'Nakiwogo', district: 'Wakiso', lat: 0.061, lng: 32.458 },
  { name: 'Bugonga', district: 'Wakiso', lat: 0.045, lng: 32.453 },
  { name: 'Katabi', district: 'Wakiso', lat: 0.071, lng: 32.499 },
  { name: 'Abayita Ababiri', district: 'Wakiso', lat: 0.106, lng: 32.525, aliases: ['Abayita Ababiri', 'Abaita Ababiri'] },
  { name: 'Kitende', district: 'Wakiso', lat: 0.198, lng: 32.533 },
  { name: 'Kajjansi', district: 'Wakiso', lat: 0.208, lng: 32.552, aliases: ['Kajjansi', 'Kajansi'] },
  { name: 'Bwebajja', district: 'Wakiso', lat: 0.179, lng: 32.541 },
  { name: 'Kigo', district: 'Wakiso', lat: 0.196, lng: 32.615, aliases: ['Kigo', 'Kigo Road'] },
  { name: 'Lubowa', district: 'Wakiso', lat: 0.237, lng: 32.576, aliases: ['Lubowa', 'Lubowa Estate', 'Lubowa Entebbe Road'] },
  { name: 'Namasuba', district: 'Wakiso', lat: 0.258, lng: 32.558 },
  { name: 'Ndejje', district: 'Wakiso', lat: 0.244, lng: 32.553 },
  { name: 'Lubugumu', district: 'Wakiso', lat: 0.239, lng: 32.554 },
  { name: 'Seguku', district: 'Wakiso', lat: 0.247, lng: 32.555, aliases: ['Seguku', 'Sseguku'] },
  { name: 'Kira', district: 'Wakiso', level: 'city', lat: 0.3978, lng: 32.6414, aliases: ['Kira', 'Kiira', 'Kira Town', 'Kiira Town', 'Kira Municipality'] },
  { name: 'Namugongo', district: 'Wakiso', lat: 0.363, lng: 32.636 },
  { name: 'Bweyogerere', district: 'Wakiso', lat: 0.351, lng: 32.676 },
  { name: 'Kyaliwajjala', district: 'Wakiso', lat: 0.377, lng: 32.639 },
  { name: 'Naalya', district: 'Wakiso', lat: 0.366, lng: 32.636, aliases: ['Naalya', 'Naalya Estate'] },
  { name: 'Najjera', district: 'Wakiso', lat: 0.396, lng: 32.615, aliases: ['Najjera', 'Najjeera'] },
  { name: 'Bulindo', district: 'Wakiso', lat: 0.418, lng: 32.633 },
  { name: 'Sonde', district: 'Wakiso', lat: 0.378, lng: 32.698 },
  { name: 'Kira-Mulawa', district: 'Wakiso', lat: 0.412, lng: 32.65, aliases: ['Kira-Mulawa', 'Kira Mulawa', 'Mulawa'] },
  { name: 'Kira-Nsasa', district: 'Wakiso', lat: 0.428, lng: 32.665, aliases: ['Kira-Nsasa', 'Kira Nsasa', 'Nsasa'] },
  { name: 'Nansana', district: 'Wakiso', level: 'city', lat: 0.364, lng: 32.52, aliases: ['Nansana', 'Nansana Town', 'Nansana Municipality'] },
  { name: 'Nabweru', district: 'Wakiso', lat: 0.378, lng: 32.525 },
  { name: 'Wamala', district: 'Wakiso', lat: 0.373, lng: 32.506 },
  { name: 'Gganda', district: 'Wakiso', lat: 0.352, lng: 32.536 },
  { name: 'Kyebando', district: 'Wakiso', lat: 0.347, lng: 32.558 },
  { name: 'Wakiso Central', district: 'Wakiso', lat: 0.404, lng: 32.459 },
  { name: 'Kakiri', district: 'Wakiso', lat: 0.409, lng: 32.38 },
  { name: 'Bujjuko', district: 'Wakiso', lat: 0.374, lng: 32.389, aliases: ['Bujjuko', 'Bujuuko', 'Bujjuko Akright', 'Bujuuko Akright', 'Akright'] },
  { name: 'Masulita', district: 'Wakiso', lat: 0.51, lng: 32.46 },
  { name: 'Kasanje', district: 'Wakiso', lat: 0.217, lng: 32.383 },
  { name: 'Kasangati', district: 'Wakiso', lat: 0.434, lng: 32.61, aliases: ['Kasangati', 'Kasangati-Nangabo', 'Kasangati Nangabo', 'Nangabo'] },

  { name: 'Mukono', district: 'Mukono', level: 'district', lat: 0.353, lng: 32.753, aliases: ['Mukono', 'Mukono Town'] },
  { name: 'Seeta', district: 'Mukono', lat: 0.361, lng: 32.705 },
  { name: 'Goma', district: 'Mukono', lat: 0.383, lng: 32.742 },
  { name: 'Namanve', district: 'Mukono', lat: 0.348, lng: 32.697 },
  { name: 'Bajjo', district: 'Mukono', lat: 0.333, lng: 32.741 },
  { name: 'Katosi', district: 'Mukono', lat: 0.181, lng: 32.797, aliases: ['Katosi', 'Mpunge', 'Mpungwe', 'Katosi Mpunge'] },

  { name: 'Jinja', district: 'Jinja', level: 'district', lat: 0.424, lng: 33.204, aliases: ['Jinja', 'Jinja City', 'Jinja Town', 'Jinja Central'] },
  { name: 'Njeru', district: 'Jinja', lat: 0.449, lng: 33.177 },
  { name: 'Masese', district: 'Jinja', lat: 0.406, lng: 33.209 },
  { name: 'Nalufenya', district: 'Jinja', lat: 0.427, lng: 33.222 },
  { name: 'Bugembe', district: 'Jinja', lat: 0.457, lng: 33.231 },

  { name: 'Mbarara', district: 'Mbarara', level: 'district', lat: -0.607, lng: 30.654, aliases: ['Mbarara', 'Mbarara City', 'Mbarara Town'] },
  { name: 'Nyamitanga', district: 'Mbarara', lat: -0.62, lng: 30.646 },
  { name: 'Kakoba', district: 'Mbarara', lat: -0.605, lng: 30.664 },
  { name: 'Ruti', district: 'Mbarara', lat: -0.633, lng: 30.654 },
  { name: 'Biharwe', district: 'Mbarara', lat: -0.556, lng: 30.643 },

  { name: 'Gulu', district: 'Gulu', level: 'district', lat: 2.775, lng: 32.299, aliases: ['Gulu', 'Gulu City', 'Gulu Central'] },
  { name: 'Pece', district: 'Gulu', lat: 2.789, lng: 32.293 },
  { name: 'Layibi', district: 'Gulu', lat: 2.767, lng: 32.292 },
  { name: 'Bardege', district: 'Gulu', lat: 2.787, lng: 32.315 },
  { name: 'Kanyagoga', district: 'Gulu', lat: 2.755, lng: 32.301 },

  { name: 'Mbale', district: 'Mbale', level: 'district', lat: 1.062, lng: 34.175, aliases: ['Mbale', 'Mbale City', 'Mbale Town', 'Mbale Central'] },
  { name: 'Industrial Area', district: 'Mbale', lat: 1.061, lng: 34.186 },
  { name: 'Namatala', district: 'Mbale', lat: 1.08, lng: 34.19 },
  { name: 'Senior Quarters', district: 'Mbale', lat: 1.055, lng: 34.17 },

  { name: 'Lira', district: 'Lira', level: 'district', lat: 2.249, lng: 32.899, aliases: ['Lira', 'Lira City', 'Lira Central'] },
  { name: 'Adyel', district: 'Lira', lat: 2.268, lng: 32.895 },
  { name: 'Barapwo', district: 'Lira', lat: 2.234, lng: 32.887 },
  { name: 'Ireda', district: 'Lira', lat: 2.241, lng: 32.912 },

  { name: 'Arua', district: 'Arua', level: 'district', lat: 3.02, lng: 30.91, aliases: ['Arua', 'Arua City', 'Arua Central'] },
  { name: 'Olua', district: 'Arua', lat: 3.037, lng: 30.912 },
  { name: 'Awindiri', district: 'Arua', lat: 3.006, lng: 30.89 },
  { name: 'Pokea', district: 'Arua', lat: 3.028, lng: 30.932 },

  { name: 'Fort Portal', district: 'Kabarole', level: 'city', lat: 0.671, lng: 30.254, aliases: ['Fort Portal', 'Fort Portal City', 'Fort Portal Central'] },
  { name: 'Kijura', district: 'Kabarole', lat: 0.679, lng: 30.272 },
  { name: 'Boma', district: 'Kabarole', lat: 0.675, lng: 30.248 },
  { name: 'Rwengoma', district: 'Kabarole', lat: 0.665, lng: 30.243 },

  { name: 'Hoima', district: 'Hoima', level: 'district', lat: 1.434, lng: 31.352, aliases: ['Hoima', 'Hoima City', 'Hoima Central'] },
  { name: 'Kasingo', district: 'Hoima', lat: 1.446, lng: 31.361 },
  { name: 'Busiisi', district: 'Hoima', lat: 1.419, lng: 31.344 },
  { name: 'Kyentale', district: 'Hoima', lat: 1.441, lng: 31.337 },

  { name: 'Masindi', district: 'Masindi', level: 'district', lat: 1.683, lng: 31.715, aliases: ['Masindi', 'Masindi Town', 'Masindi Municipality', 'Masindi Central'] },
  { name: 'Kijura', district: 'Masindi', lat: 1.69, lng: 31.72 },
  { name: 'Kisanja', district: 'Masindi', lat: 1.676, lng: 31.711 },
  { name: 'Nyangahya', district: 'Masindi', lat: 1.704, lng: 31.725 },
  { name: 'Kigulya', district: 'Masindi', lat: 1.697, lng: 31.706 },

  { name: 'Masaka', district: 'Masaka', level: 'district', lat: -0.333, lng: 31.733, aliases: ['Masaka', 'Masaka City', 'Masaka Central'] },
  { name: 'Nyendo', district: 'Masaka', lat: -0.343, lng: 31.725 },
  { name: 'Ssenyange', district: 'Masaka', lat: -0.326, lng: 31.737 },
  { name: 'Kimaanya', district: 'Masaka', lat: -0.325, lng: 31.724 },

  { name: 'Kabale', district: 'Kabale', level: 'district', lat: -1.249, lng: 29.989, aliases: ['Kabale', 'Kabale Town', 'Kabale Municipality', 'Kabale Central'] },
  { name: 'Rutooma', district: 'Kabale', lat: -1.257, lng: 29.996 },
  { name: 'Kekubo', district: 'Kabale', lat: -1.241, lng: 29.981 },
  { name: 'Butobere', district: 'Kabale', lat: -1.253, lng: 30.001 }
];

const EXCLUDED_LOCATION_ONLY_PATTERNS = [
  /\b(?:lake victoria|victoria lake|lake albert|lake kyoga)\b/i,
  /^(?:kampala|entebbe|gayaza|bombo|hoima|masaka|jinja|mityana|fort portal)\s+road$/i,
  /^(?:northern|southern|eastern|western)\s+bypass$/i
];

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

const canonicalDistrictByKey = new Map();
DISTRICTS.forEach((district) => {
  const normalized = normalizeLocationKey(district).replace(/\s+city$/, '');
  if (!canonicalDistrictByKey.has(normalized)) {
    canonicalDistrictByKey.set(normalized, district.replace(/\s+City$/, ''));
  }
});
canonicalDistrictByKey.set('fort portal', 'Kabarole');

function normalizeDistrict(value = '') {
  const key = normalizeLocationKey(value)
    .replace(/\s+(?:district|city|municipality)$/, '')
    .trim();
  return canonicalDistrictByKey.get(key) || '';
}

const registry = DETAILED_LOCATIONS.map((entry) => ({
  ...entry,
  level: entry.level || 'area',
  aliases: Array.from(new Set([entry.name, ...(entry.aliases || [])])),
  key: `${normalizeLocationKey(entry.district)}:${normalizeLocationKey(entry.name)}`
}));

// Every valid Uganda district is a searchable canonical node, including
// districts whose neighborhood centroids have not been mapped yet.
Array.from(new Set(canonicalDistrictByKey.values())).forEach((district) => {
  const key = `${normalizeLocationKey(district)}:${normalizeLocationKey(district)}`;
  if (registry.some((entry) => entry.key === key)) return;
  const representative = registry.find((entry) => entry.district === district && entry.level === 'city')
    || registry.find((entry) => entry.district === district);
  registry.push({
    name: district,
    district,
    level: 'district',
    lat: Number.isFinite(representative?.lat) ? representative.lat : null,
    lng: Number.isFinite(representative?.lng) ? representative.lng : null,
    aliases: [district, `${district} District`],
    key
  });
});

const aliasRows = registry
  .flatMap((entry) => entry.aliases.map((alias) => ({
    alias,
    aliasKey: normalizeLocationKey(alias),
    entry
  })))
  .filter((row) => row.aliasKey)
  .sort((a, b) => b.aliasKey.length - a.aliasKey.length);

function isExcludedLocationOnly(value = '') {
  const clean = String(value || '').trim();
  return EXCLUDED_LOCATION_ONLY_PATTERNS.some((pattern) => pattern.test(clean));
}

function aliasAppearsInValue(aliasKey, valueKey) {
  if (aliasKey === valueKey) return true;
  return (` ${valueKey} `).includes(` ${aliasKey} `);
}

function canonicalizeUgandaLocation(area = '', district = '') {
  const rawArea = String(area || '').split(',')[0].trim();
  const areaKey = normalizeLocationKey(rawArea);
  const districtName = normalizeDistrict(district);
  if (!areaKey && !districtName) return null;
  if (rawArea && isExcludedLocationOnly(rawArea)) return null;

  const matched = aliasRows.find((row) => {
    if (!aliasAppearsInValue(row.aliasKey, areaKey)) return false;
    if (!districtName || row.entry.district === districtName) return true;
    return row.aliasKey === areaKey;
  });
  if (matched) return { ...matched.entry };

  const areaDistrict = normalizeDistrict(rawArea);
  if (rawArea && !areaDistrict) return null;
  const fallbackDistrict = areaDistrict || districtName;
  if (!fallbackDistrict) return null;
  const existing = registry.find((entry) => entry.level === 'district' && entry.district === fallbackDistrict);
  if (existing) return { ...existing };
  return {
    name: fallbackDistrict,
    district: fallbackDistrict,
    level: 'district',
    lat: null,
    lng: null,
    aliases: [fallbackDistrict],
    key: `${normalizeLocationKey(fallbackDistrict)}:${normalizeLocationKey(fallbackDistrict)}`
  };
}

function aliasesForCanonicalLocation(location = {}) {
  const key = location.key || `${normalizeLocationKey(location.district)}:${normalizeLocationKey(location.name)}`;
  const matched = registry.find((entry) => entry.key === key);
  return (matched?.aliases || [location.name]).map(normalizeLocationKey).filter(Boolean);
}

function aliasesForDistrict(district = '') {
  const canonicalDistrict = normalizeDistrict(district);
  return Array.from(new Set(
    registry
      .filter((entry) => entry.district === canonicalDistrict)
      .flatMap((entry) => entry.aliases)
      .map(normalizeLocationKey)
      .filter(Boolean)
  ));
}

function canonicalizeLocationRows(rows = []) {
  const aggregates = new Map();
  rows.forEach((row) => {
    const canonical = canonicalizeUgandaLocation(row.location || row.area, row.district);
    if (!canonical) return;
    const count = Math.max(0, Number(row.listing_count) || 0);
    const existing = aggregates.get(canonical.key) || {
      canonical_key: canonical.key,
      location: canonical.name,
      district: canonical.district,
      level: canonical.level,
      latitude: Number.isFinite(canonical.lat) ? canonical.lat : null,
      longitude: Number.isFinite(canonical.lng) ? canonical.lng : null,
      aliases: canonical.aliases || [canonical.name],
      listing_count: 0
    };
    existing.listing_count += count;
    aggregates.set(canonical.key, existing);
  });
  return Array.from(aggregates.values())
    .filter((row) => row.listing_count > 0)
    .sort((a, b) => b.listing_count - a.listing_count || a.location.localeCompare(b.location));
}

function canonicalLocationOptions() {
  return registry.map((entry) => ({
    canonical_key: entry.key,
    location: entry.name,
    district: entry.district,
    level: entry.level,
    latitude: Number.isFinite(entry.lat) ? entry.lat : null,
    longitude: Number.isFinite(entry.lng) ? entry.lng : null,
    aliases: entry.aliases,
    listing_count: 0
  }));
}

function canonicalLocationByKey(value = '') {
  const key = String(value || '').trim().toLowerCase();
  if (!key) return null;
  const matched = registry.find((entry) => entry.key === key);
  return matched ? { ...matched, aliases: [...matched.aliases] } : null;
}

function trigrams(value = '') {
  const normalized = `  ${normalizeLocationKey(value)} `;
  const grams = new Set();
  for (let index = 0; index <= normalized.length - 3; index += 1) {
    grams.add(normalized.slice(index, index + 3));
  }
  return grams;
}

function trigramSimilarity(left = '', right = '') {
  const a = trigrams(left);
  const b = trigrams(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  a.forEach((gram) => {
    if (b.has(gram)) overlap += 1;
  });
  return (2 * overlap) / (a.size + b.size);
}

function canonicalLocationSuggestions(query = '', counts = new Map(), limit = 8) {
  const needle = normalizeLocationKey(query);
  if (!needle) return [];
  const scoreEntry = (entry) => {
    const aliasKeys = entry.aliases.map(normalizeLocationKey).filter(Boolean);
    const exact = aliasKeys.includes(needle);
    const prefix = aliasKeys.some((alias) => alias.startsWith(needle));
    const contains = aliasKeys.some((alias) => alias.includes(needle));
    const fuzzy = Math.max(...aliasKeys.map((alias) => trigramSimilarity(needle, alias)), 0);
    const matchRank = exact ? 4 : prefix ? 3 : contains ? 2 : fuzzy >= 0.3 ? 1 : 0;
    if (!matchRank) return null;
    return {
      canonical_key: entry.key,
      location: entry.name,
      district: entry.district,
      level: entry.level,
      latitude: Number.isFinite(entry.lat) ? entry.lat : null,
      longitude: Number.isFinite(entry.lng) ? entry.lng : null,
      aliases: [...entry.aliases],
      listing_count: Number(counts.get(entry.key) || 0),
      match: exact ? 'exact_alias' : prefix ? 'prefix' : contains ? 'contains' : 'fuzzy',
      did_you_mean: !exact && !prefix && !contains,
      match_rank: matchRank,
      score: matchRank * 10 + fuzzy,
    };
  };
  return registry
    .map(scoreEntry)
    .filter(Boolean)
    .sort((a, b) => b.match_rank - a.match_rank || b.listing_count - a.listing_count || b.score - a.score || a.location.localeCompare(b.location))
    .slice(0, Math.max(1, Math.min(8, Number(limit) || 8)));
}

function canonicalLocationSearchScope(keys = [], nearbyKm = 0) {
  const selected = Array.from(new Set(keys))
    .map(canonicalLocationByKey)
    .filter(Boolean)
    .slice(0, 5);
  const exact = new Map();
  const nearby = new Map();
  selected.forEach((location) => {
    exact.set(location.key, location);
    if (location.level === 'district') {
      registry
        .filter((entry) => entry.district === location.district)
        .forEach((entry) => exact.set(entry.key, entry));
      return;
    }
    if (location.level === 'city') {
      registry
        .filter((entry) => entry.district === location.district)
        .filter((entry) => {
          const distance = haversineKm(location, entry);
          return distance != null && distance <= 7;
        })
        .forEach((entry) => exact.set(entry.key, entry));
      return;
    }
    const radius = Math.max(0, Math.min(7, Number(nearbyKm) || 0));
    if (!radius) return;
    registry
      .filter((entry) => entry.level !== 'district' && entry.key !== location.key)
      .forEach((entry) => {
        const distance = haversineKm(location, entry);
        if (distance != null && distance <= radius && !exact.has(entry.key)) {
          nearby.set(entry.key, { ...entry, distance_km: Number(distance.toFixed(2)) });
        }
      });
  });
  return {
    selected,
    exact: Array.from(exact.values()),
    nearby: Array.from(nearby.values()).sort((a, b) => a.distance_km - b.distance_km),
  };
}

function canonicalLocationRollupCounts(counts = new Map()) {
  const direct = counts instanceof Map ? counts : new Map(Object.entries(counts || {}));
  const rolled = new Map(direct);
  registry.forEach((location) => {
    if (!['city', 'district'].includes(location.level)) return;
    const scope = canonicalLocationSearchScope([location.key], 0);
    const total = scope.exact.reduce((sum, child) => sum + Math.max(0, Number(direct.get(child.key)) || 0), 0);
    rolled.set(location.key, total);
  });
  return rolled;
}

function haversineKm(a = {}, b = {}) {
  if (![a.lat, a.lng, b.lat, b.lng].every((value) => Number.isFinite(Number(value)))) return null;
  const toRadians = (degrees) => (Number(degrees) * Math.PI) / 180;
  const dLat = toRadians(Number(b.lat) - Number(a.lat));
  const dLng = toRadians(Number(b.lng) - Number(a.lng));
  const chord = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * (2 * Math.atan2(Math.sqrt(chord), Math.sqrt(1 - chord)));
}

module.exports = {
  CANONICAL_LOCATION_COUNT: registry.length,
  canonicalLocationByKey,
  canonicalizeUgandaLocation,
  canonicalizeLocationRows,
  canonicalLocationOptions,
  canonicalLocationRollupCounts,
  canonicalLocationSearchScope,
  canonicalLocationSuggestions,
  aliasesForCanonicalLocation,
  aliasesForDistrict,
  normalizeDistrict,
  normalizeLocationKey,
  haversineKm,
  isExcludedLocationOnly,
  trigramSimilarity
};
