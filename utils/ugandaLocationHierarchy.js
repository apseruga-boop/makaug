const { DISTRICTS } = require('./constants');

const UG_REGION_DISTRICTS = {
  Central: [
    'Buikwe', 'Bukomansimbi', 'Buvuma', 'Gomba', 'Kalangala', 'Kalungu',
    'Kampala', 'Kasanda', 'Kayunga', 'Kiboga', 'Kyankwanzi', 'Kyotera',
    'Luwero', 'Lwengo', 'Lyantonde', 'Masaka', 'Mityana', 'Mpigi',
    'Mubende', 'Mukono', 'Nakaseke', 'Nakasongola', 'Rakai',
    'Sembabule', 'Wakiso', 'Butambala'
  ],
  Eastern: [
    'Budaka', 'Bududa', 'Bugiri', 'Bugweri', 'Bukedea', 'Bukwo',
    'Bulambuli', 'Busia', 'Butaleja', 'Butebo', 'Buyende', 'Iganga',
    'Jinja', 'Kaberamaido', 'Kalaki', 'Kaliro', 'Kamuli', 'Kapchorwa',
    'Kapelebyong', 'Katakwi', 'Kibuku', 'Kumi', 'Kween', 'Luuka',
    'Manafwa', 'Mayuge', 'Mbale', 'Namisindwa', 'Namutumba',
    'Namayingo', 'Ngora', 'Pallisa', 'Serere', 'Sironko', 'Soroti',
    'Tororo', 'Amuria'
  ],
  Northern: [
    'Abim', 'Adjumani', 'Agago', 'Alebtong', 'Amolatar', 'Amudat',
    'Amuru', 'Apac', 'Arua', 'Dokolo', 'Gulu', 'Kaabong', 'Karenga',
    'Kitgum', 'Koboko', 'Kole', 'Kotido', 'Kwania', 'Lamwo', 'Lira',
    'Madi-Okollo', 'Maracha', 'Moroto', 'Moyo', 'Nabilatuk',
    'Nakapiripirit', 'Napak', 'Nebbi', 'Nwoya', 'Obongi', 'Omoro',
    'Otuke', 'Oyam', 'Pader', 'Pakwach', 'Yumbe', 'Zombo'
  ],
  Western: [
    'Buhweju', 'Buliisa', 'Bundibugyo', 'Bunyangabu', 'Bushenyi',
    'Hoima', 'Ibanda', 'Isingiro', 'Kabale', 'Kabarole', 'Kagadi',
    'Kakumiro', 'Kamwenge', 'Kanungu', 'Kasese', 'Kazo', 'Kibaale',
    'Kitagwenda', 'Kikuube', 'Kiruhura', 'Kiryandongo', 'Kisoro',
    'Kyegegwa', 'Kyenjojo', 'Masindi', 'Mbarara', 'Mitooma',
    'Ntoroko', 'Ntungamo', 'Rubanda', 'Rubirizi', 'Rukiga',
    'Rukungiri', 'Sheema'
  ]
};

const UG_LOCATION_TREE = {
  Kampala: [
    {
      city: 'Central Kampala',
      neighborhoods: [
        { name: 'Nakasero', lat: 0.318, lng: 32.582 },
        { name: 'Kololo', lat: 0.356, lng: 32.612 },
        { name: 'Kampala Road', lat: 0.314, lng: 32.577 },
        { name: 'Old Kampala', lat: 0.313, lng: 32.569 },
        { name: 'Makerere', lat: 0.335, lng: 32.568 },
        { name: 'Wandegeya', lat: 0.336, lng: 32.57 }
      ]
    },
    {
      city: 'Nakawa',
      neighborhoods: [
        { name: 'Ntinda', lat: 0.357, lng: 32.612 },
        { name: 'Naguru', lat: 0.338, lng: 32.611 },
        { name: 'Bukoto', lat: 0.346, lng: 32.591 },
        { name: 'Kisaasi', lat: 0.364, lng: 32.589 },
        { name: 'Kyanja', lat: 0.384, lng: 32.596 },
        { name: 'Kiwatule', lat: 0.372, lng: 32.625 },
        { name: 'Bugolobi', lat: 0.317, lng: 32.612 }
      ]
    },
    {
      city: 'Makindye',
      neighborhoods: [
        { name: 'Muyenga', lat: 0.285, lng: 32.594 },
        { name: 'Ggaba', lat: 0.274, lng: 32.619 },
        { name: 'Kansanga', lat: 0.289, lng: 32.607 },
        { name: 'Buziga', lat: 0.277, lng: 32.596 },
        { name: 'Bunga', lat: 0.262, lng: 32.623 },
        { name: 'Kabalagala', lat: 0.298, lng: 32.603 },
        { name: 'Makindye', lat: 0.301, lng: 32.586 }
      ]
    },
    {
      city: 'Rubaga',
      neighborhoods: [
        { name: 'Rubaga', lat: 0.298, lng: 32.545 },
        { name: 'Nateete', lat: 0.318, lng: 32.536 },
        { name: 'Mengo', lat: 0.306, lng: 32.557 },
        { name: 'Lungujja', lat: 0.302, lng: 32.548 },
        { name: 'Kasubi', lat: 0.333, lng: 32.555 }
      ]
    }
  ],
  Wakiso: [
    {
      city: 'Entebbe',
      neighborhoods: [
        { name: 'Kitoro', lat: 0.055, lng: 32.464 },
        { name: 'Nakiwogo', lat: 0.061, lng: 32.458 },
        { name: 'Bugonga', lat: 0.045, lng: 32.453 },
        { name: 'Katabi', lat: 0.071, lng: 32.499 },
        { name: 'Abayita Ababiri', lat: 0.106, lng: 32.525 },
        { name: 'Kitende', lat: 0.198, lng: 32.533 },
        { name: 'Kajjansi', lat: 0.208, lng: 32.552 },
        { name: 'Bwebajja', lat: 0.179, lng: 32.541 },
        { name: 'Ndejje', lat: 0.244, lng: 32.553 },
        { name: 'Lubugumu', lat: 0.239, lng: 32.554 }
      ]
    },
    {
      city: 'Makindye-Ssabagabo',
      neighborhoods: [
        { name: 'Namasuba', lat: 0.258, lng: 32.558 },
        { name: 'Seguku', lat: 0.247, lng: 32.555 },
        { name: 'Lubowa', lat: 0.235, lng: 32.566 }
      ]
    },
    {
      city: 'Kira',
      neighborhoods: [
        { name: 'Namugongo', lat: 0.363, lng: 32.636 },
        { name: 'Kira Town', lat: 0.392, lng: 32.647 },
        { name: 'Bweyogerere', lat: 0.351, lng: 32.676 },
        { name: 'Kyaliwajjala', lat: 0.377, lng: 32.639 },
        { name: 'Naalya', lat: 0.366, lng: 32.636 },
        { name: 'Najjera', lat: 0.396, lng: 32.615 },
        { name: 'Bulindo', lat: 0.418, lng: 32.633 },
        { name: 'Sonde', lat: 0.378, lng: 32.698 }
      ]
    },
    {
      city: 'Nansana',
      neighborhoods: [
        { name: 'Nansana', lat: 0.364, lng: 32.52 },
        { name: 'Nabweru', lat: 0.378, lng: 32.525 },
        { name: 'Wamala', lat: 0.373, lng: 32.506 },
        { name: 'Gganda', lat: 0.352, lng: 32.536 },
        { name: 'Kyebando', lat: 0.347, lng: 32.558 }
      ]
    },
    {
      city: 'Wakiso Town',
      neighborhoods: [
        { name: 'Wakiso Central', lat: 0.404, lng: 32.459 },
        { name: 'Kakiri', lat: 0.409, lng: 32.38 },
        { name: 'Bujjuko', lat: 0.374, lng: 32.389 },
        { name: 'Bujuuko', lat: 0.374, lng: 32.389 },
        { name: 'Masulita', lat: 0.51, lng: 32.46 },
        { name: 'Kasanje', lat: 0.217, lng: 32.383 },
        { name: 'Nabweru South', lat: 0.367, lng: 32.526 }
      ]
    }
  ],
  Masindi: [
    {
      city: 'Masindi Municipality',
      neighborhoods: [
        { name: 'Masindi', lat: 1.683, lng: 31.715 },
        { name: 'Masindi Central', lat: 1.683, lng: 31.715 },
        { name: 'Kijura', lat: 1.69, lng: 31.72 },
        { name: 'Kisanja', lat: 1.676, lng: 31.711 },
        { name: 'Nyangahya', lat: 1.704, lng: 31.725 }
      ]
    },
    {
      city: 'Masindi Town',
      neighborhoods: [
        { name: 'Masindi Town', lat: 1.683, lng: 31.715 },
        { name: 'Kigulya', lat: 1.697, lng: 31.706 }
      ]
    }
  ],
  Arua: [
    {
      city: 'Arua City',
      neighborhoods: [
        { name: 'Arua Central', lat: 3.02, lng: 30.91 },
        { name: 'Olua', lat: 3.037, lng: 30.912 },
        { name: 'Awindiri', lat: 3.006, lng: 30.89 },
        { name: 'Pokea', lat: 3.028, lng: 30.932 }
      ]
    }
  ]
};

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
  return DISTRICT_TO_REGION[clean(district)] || '';
}

function getDistrictLocationTree(district) {
  const cleanDistrict = clean(district);
  if (!cleanDistrict || !DISTRICTS.includes(cleanDistrict)) return [];
  if (UG_LOCATION_TREE[cleanDistrict]) return UG_LOCATION_TREE[cleanDistrict];
  return [
    {
      city: `${cleanDistrict} Town`,
      neighborhoods: [
        { name: `${cleanDistrict} Central` },
        { name: `${cleanDistrict} East` },
        { name: `${cleanDistrict} West` }
      ]
    }
  ];
}

function districtForKnownArea(area) {
  const needle = clean(area).toLowerCase();
  if (!needle) return '';
  if (DISTRICTS.some((district) => district.toLowerCase() === needle)) {
    return DISTRICTS.find((district) => district.toLowerCase() === needle) || '';
  }
  for (const [district, tree] of Object.entries(UG_LOCATION_TREE)) {
    for (const cityNode of tree || []) {
      if (clean(cityNode.city).toLowerCase() === needle) return district;
      if ((cityNode.neighborhoods || []).some((item) => clean(item.name).toLowerCase() === needle)) {
        return district;
      }
    }
  }
  return '';
}

function normalizeReviewLocationHierarchy(fields = {}) {
  const errors = [];
  const area = clean(fields.area);
  const district = clean(fields.district);
  const requestedRegion = clean(fields.region);
  let city = clean(fields.city);
  let neighborhood = clean(fields.neighborhood);

  if (!district) {
    if (city || neighborhood || requestedRegion) {
      errors.push('district is required before city or neighbourhood can be saved');
    }
    return { region: requestedRegion, district, city, neighborhood, errors };
  }

  if (!DISTRICTS.includes(district)) {
    return { region: requestedRegion, district, city, neighborhood, errors };
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

  return { region, district, city, neighborhood, errors };
}

module.exports = {
  UG_REGION_DISTRICTS,
  UG_LOCATION_TREE,
  DISTRICT_TO_REGION,
  regionForDistrict,
  getDistrictLocationTree,
  districtForKnownArea,
  normalizeReviewLocationHierarchy
};
