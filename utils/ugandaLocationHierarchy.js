const { DISTRICTS } = require('./constants');
const {
  canonicalLocationOptions,
  canonicalUgandaDistrictsMentionedInText,
  canonicalizeUgandaLocation,
  isExcludedLocationOnly,
  normalizeDistrict,
} = require('./ugandaLocationRegistry');

const UG_REGION_DISTRICTS = {
  Central: [
    'Buikwe', 'Bukomansimbi', 'Buvuma', 'Gomba', 'Kalangala', 'Kalungu',
    'Kampala', 'Kassanda', 'Kayunga', 'Kiboga', 'Kyankwanzi', 'Kyotera',
    'Luwero', 'Lwengo', 'Lyantonde', 'Masaka', 'Masaka City', 'Mityana', 'Mpigi',
    'Mubende', 'Mukono', 'Nakaseke', 'Nakasongola', 'Rakai',
    'Sembabule', 'Wakiso', 'Butambala'
  ],
  Eastern: [
    'Budaka', 'Bududa', 'Bugiri', 'Bugweri', 'Bukedea', 'Bukwo',
    'Bulambuli', 'Busia', 'Butaleja', 'Butebo', 'Buyende', 'Iganga',
    'Jinja', 'Jinja City', 'Kaberamaido', 'Kalaki', 'Kaliro', 'Kamuli', 'Kapchorwa',
    'Kapelebyong', 'Katakwi', 'Kibuku', 'Kumi', 'Kween', 'Luuka',
    'Manafwa', 'Mayuge', 'Mbale', 'Mbale City', 'Namisindwa', 'Namutumba',
    'Namayingo', 'Ngora', 'Pallisa', 'Serere', 'Sironko', 'Soroti', 'Soroti City',
    'Tororo', 'Amuria'
  ],
  Northern: [
    'Abim', 'Adjumani', 'Agago', 'Alebtong', 'Amolatar', 'Amudat',
    'Amuru', 'Apac', 'Arua', 'Arua City', 'Dokolo', 'Gulu', 'Gulu City', 'Kaabong', 'Karenga',
    'Kitgum', 'Koboko', 'Kole', 'Kotido', 'Kwania', 'Lamwo', 'Lira', 'Lira City',
    'Madi-Okollo', 'Maracha', 'Moroto', 'Moyo', 'Nabilatuk',
    'Nakapiripirit', 'Napak', 'Nebbi', 'Nwoya', 'Obongi', 'Omoro',
    'Otuke', 'Oyam', 'Pader', 'Pakwach', 'Terego', 'Yumbe', 'Zombo'
  ],
  Western: [
    'Buhweju', 'Buliisa', 'Bundibugyo', 'Bunyangabu', 'Bushenyi',
    'Fort Portal City', 'Hoima', 'Hoima City', 'Ibanda', 'Isingiro', 'Kabale', 'Kabarole', 'Kagadi',
    'Kakumiro', 'Kamwenge', 'Kanungu', 'Kasese', 'Kazo', 'Kibaale',
    'Kitagwenda', 'Kikuube', 'Kiruhura', 'Kiryandongo', 'Kisoro',
    'Kyegegwa', 'Kyenjojo', 'Masindi', 'Mbarara', 'Mbarara City', 'Mitooma',
    'Ntoroko', 'Ntungamo', 'Rubanda', 'Rubirizi', 'Rukiga',
    'Rukungiri', 'Rwampara', 'Sheema'
  ]
};

const UG_LOCATION_TREE = {};

const DISTRICT_TO_REGION = Object.entries(UG_REGION_DISTRICTS).reduce((map, [region, districts]) => {
  districts.forEach((district) => {
    if (DISTRICTS.includes(district)) map[district] = region;
  });
  return map;
}, {});

function clean(value) {
  return String(value || '').trim();
}

function regionForDistrict(district) {
  return DISTRICT_TO_REGION[normalizeDistrict(district) || clean(district)] || '';
}

function getDistrictLocationTree(district) {
  const cleanDistrict = normalizeDistrict(district) || clean(district);
  if (!cleanDistrict || !DISTRICTS.includes(cleanDistrict)) return [];
  const locations = canonicalLocationOptions()
    .filter((item) => item.district === cleanDistrict && !['district', 'region'].includes(item.level));
  if (!locations.length) return [];
  const groups = new Map();
  locations.forEach((item) => {
    const town = clean(item.town) || (['city', 'town'].includes(item.level) ? item.location : `${cleanDistrict} Town`);
    if (!groups.has(town)) groups.set(town, new Map());
    groups.get(town).set(item.location, {
      name: item.location,
      ...(Number.isFinite(item.latitude) ? { lat: item.latitude } : {}),
      ...(Number.isFinite(item.longitude) ? { lng: item.longitude } : {})
    });
  });
  return Array.from(groups.entries())
    .map(([city, neighborhoods]) => ({
      city,
      neighborhoods: Array.from(neighborhoods.values()).sort((a, b) => a.name.localeCompare(b.name))
    }))
    .sort((a, b) => a.city.localeCompare(b.city));
}

function districtForKnownArea(area) {
  const needle = clean(area).toLowerCase();
  if (!needle) return '';
  if (isExcludedLocationOnly(area)) return '';
  const canonical = canonicalizeUgandaLocation(area);
  if (canonical) return canonical.district;
  if (DISTRICTS.some((district) => district.toLowerCase() === needle)) {
    return DISTRICTS.find((district) => district.toLowerCase() === needle) || '';
  }
  return '';
}

function districtsForKnownLocationText(value = '') {
  return canonicalUgandaDistrictsMentionedInText(value);
}

function districtForKnownLocationText(value = '') {
  return districtsForKnownLocationText(value)[0] || '';
}

function normalizeReviewLocationHierarchy(fields = {}) {
  const errors = [];
  const area = clean(fields.area);
  const district = normalizeDistrict(fields.district) || clean(fields.district);
  const requestedRegion = clean(fields.region);
  let city = clean(fields.city);
  let neighborhood = clean(fields.neighborhood);

  if (!district) {
    if (city || neighborhood || requestedRegion) {
      errors.push('district is required before city or neighbourhood can be saved');
    }
    return { region: requestedRegion, district, city, neighborhood, canonical: null, errors };
  }

  if (!DISTRICTS.includes(district)) {
    return { region: requestedRegion, district, city, neighborhood, canonical: null, errors };
  }

  const region = regionForDistrict(district);
  if (!region) errors.push('district must have a known Uganda region mapping');
  if (requestedRegion && region && requestedRegion !== region) {
    errors.push('region must match the selected district');
  }

  const areaDistrict = districtForKnownArea(area);
  if (areaDistrict && areaDistrict !== district) {
    errors.push('area/neighbourhood must match the selected district');
  }
  const canonical = area ? canonicalizeUgandaLocation(area, district) : null;
  if (area && !canonical) {
    errors.push(isExcludedLocationOnly(area)
      ? 'area/neighbourhood must be a place, not a road, region, or water body'
      : 'area/neighbourhood must match a canonical Uganda location');
  } else if (canonical && ['district', 'region'].includes(canonical.level)) {
    errors.push('area/neighbourhood must be more specific than a district');
  }

  if (canonical && !['district', 'region'].includes(canonical.level)) {
    city = canonical.town || city;
    neighborhood = canonical.name;
  }

  const tree = getDistrictLocationTree(district);
  let cityNode = city ? tree.find((item) => item.city === city) : null;
  if (city && !cityNode) {
    errors.push('city/town must belong to the selected district');
  }

  if (neighborhood) {
    if (!cityNode && !city) {
      cityNode = tree.find((item) => (item.neighborhoods || []).some((n) => n.name === neighborhood)) || null;
      if (cityNode) city = cityNode.city;
    }
    const neighborhoodMatchesCity = cityNode
      ? (cityNode.neighborhoods || []).some((n) => n.name === neighborhood)
      : false;
    if (!neighborhoodMatchesCity) {
      errors.push('neighbourhood must belong to the selected district and town/city');
    }
  }

  return { region, district, city, neighborhood, canonical, errors };
}

module.exports = {
  UG_REGION_DISTRICTS,
  UG_LOCATION_TREE,
  DISTRICT_TO_REGION,
  regionForDistrict,
  getDistrictLocationTree,
  districtForKnownArea,
  districtForKnownLocationText,
  districtsForKnownLocationText,
  normalizeReviewLocationHierarchy
};
