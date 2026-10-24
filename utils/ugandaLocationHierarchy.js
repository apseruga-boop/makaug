const { DISTRICTS } = require('./constants');
const { kampalaTownsForArea } = require('./kampalaDivisions');
const {
  canonicalLocationByKey,
  canonicalLocationOptions,
  canonicalUgandaDistrictsMentionedInText,
  canonicalizeUgandaLocation,
  isExcludedLocationOnly,
  normalizeDistrict,
  canonicalTownName,
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
  const addToTown = (town, item) => {
    if (!town) return;
    if (!groups.has(town)) groups.set(town, new Map());
    if (groups.get(town).has(item.location)) return;
    groups.get(town).set(item.location, {
      name: item.location,
      ...(Number.isFinite(item.latitude) ? { lat: item.latitude } : {}),
      ...(Number.isFinite(item.longitude) ? { lng: item.longitude } : {})
    });
  };
  locations.forEach((item) => {
    const town = clean(item.town) || (['city', 'town'].includes(item.level) ? item.location : `${cleanDistrict} Town`);
    addToTown(town, item);
    const subcounty = clean(item.subcounty);
    if (subcounty && subcounty !== town) addToTown(subcounty, item);
    if (cleanDistrict === 'Kampala') {
      kampalaTownsForArea(item.location)
        .filter((extraTown) => extraTown && extraTown !== town)
        .forEach((extraTown) => addToTown(extraTown, item));
    }
  });
  return Array.from(groups.entries())
    .map(([city, neighborhoods]) => ({
      city,
      neighborhoods: Array.from(neighborhoods.values()).sort((a, b) => a.name.localeCompare(b.name))
    }))
    .sort((a, b) => a.city.localeCompare(b.city));
}

function neighborhoodIsChildOfTown(district, town, neighborhood, parentCanonical = null) {
  const name = clean(neighborhood);
  const city = clean(town);
  if (!name || !city || name.toLowerCase() === city.toLowerCase()) return false;
  const child = canonicalizeUgandaLocation(name, district);
  // "Kira Municipality" is an alias of the Kira town, not a child place.
  if (!child || ['district', 'region', 'city'].includes(child.level)) return false;
  if (parentCanonical && child.key === parentCanonical.key) return false;
  const node = getDistrictLocationTree(district).find((item) => item.city === city);
  return Boolean(node && (node.neighborhoods || []).some((item) => item.name === child.name));
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

function districtsForKnownLocationText(value = '', options = {}) {
  return canonicalUgandaDistrictsMentionedInText(value, options);
}

function districtForKnownLocationText(value = '') {
  return districtsForKnownLocationText(value)[0] || '';
}

function normalizeReviewLocationHierarchy(fields = {}, options = {}) {
  const allowDistrictNode = options.allowDistrictNode === true;
  const allowCanonicalHierarchy = options.allowCanonicalHierarchy === true;
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
  const explicitCanonical = canonicalLocationByKey(fields.canonical_location_id);
  const canonical = explicitCanonical || (area ? canonicalizeUgandaLocation(area, district) : null);
  if (area && !canonical) {
    errors.push(isExcludedLocationOnly(area)
      ? 'area/neighbourhood must be a place, not a road, region, or water body'
      : 'area/neighbourhood must match a canonical Uganda location');
  } else if (canonical && (canonical.level === 'region' || (canonical.level === 'district' && !allowDistrictNode))) {
    errors.push('area/neighbourhood must be more specific than a district');
  }

  // C11 (Fisher, 10 Oct): staff picked "Kira" for MK-20261009-71C398 and it
  // reverted to "Wakiso Town" on reload, because the area's catalogue town
  // always replaced the town staff chose. Old town spellings are mapped to the
  // current names first ("Wakiso Town" -> "Wakiso", "Nakawa Division" ->
  // "Nakawa"); a town chosen in this save that exists in the district wins
  // over the area's default town. A stored town still follows the catalogue.
  // Kisaasi is the exception that does not need the flag: Kawempe and Nakawa
  // are both real parents, so either staff choice is kept.
  const tree = getDistrictLocationTree(district);
  if (city) city = canonicalTownName(district, city, area || neighborhood) || city;
  const boundaryTowns = canonical && canonical.district === 'Kampala' ? kampalaTownsForArea(canonical.name) : [];
  const staffCityOnBoundary = Boolean(city) && boundaryTowns.includes(city);
  const chosenCityIsKnown = options.preferChosenCity === true && Boolean(city) && tree.some((item) => item.city === city);
  // A town staff already saved (Nkoowe, or a spelling the dropdown does not
  // list yet) is kept. Only the district name itself ("Kampala" over Luzira)
  // is still relocated to the neighbourhood's town.
  const explicitUnknownTown = options.preferChosenCity === true
    && Boolean(city)
    && city.toLowerCase() !== district.toLowerCase()
    && !tree.some((item) => item.city === city);
  if (canonical && canonical.level !== 'region' && (canonical.level !== 'district' || allowDistrictNode)) {
    // Area "Kira" is the town. An explicit child such as Najjera must stay
    // the neighbourhood; the town's own name used to replace it.
    const parentTown = clean(canonical.town) || (['city', 'town'].includes(canonical.level) ? canonical.name : '');
    const keepExplicitChild = neighborhoodIsChildOfTown(district, city || parentTown, neighborhood, canonical)
      || neighborhoodIsChildOfTown(district, parentTown, neighborhood, canonical);
    if (!keepExplicitChild) neighborhood = canonical.name;
    if (!(chosenCityIsKnown || staffCityOnBoundary || explicitUnknownTown)) {
      city = clean(canonical.town) || city || (canonical.level === 'district' ? `${canonical.name} Town` : '');
    }
  }

  let cityNode = city ? tree.find((item) => item.city === city) : null;
  const staffTownForCanonical = chosenCityIsKnown && canonical && canonical.district === district && neighborhood === canonical.name;
  const explicitCanonicalHierarchy = allowCanonicalHierarchy && explicitCanonical && explicitCanonical.district === district;
  if (city && !cityNode && !explicitCanonicalHierarchy && !explicitUnknownTown) {
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
    if (!neighborhoodMatchesCity && !(explicitCanonicalHierarchy && neighborhood === explicitCanonical.name) && !staffTownForCanonical && !staffCityOnBoundary && !explicitUnknownTown) {
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
