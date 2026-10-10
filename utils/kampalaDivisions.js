'use strict';

// Kampala's five divisions are the towns staff pick under Kampala district
// (P7, 10 Oct 2026). Before this, most Kampala areas sat under one "Kampala" or
// "Kampala Town" group, so Luzira could only be saved as "Kampala" and not as
// Nakawa division.
//
// The UBOS gazetteer already files its parishes under "Kampala Central",
// "Nakawa Division" and so on; those names are folded into the five below.
// Areas from the hand-kept lists (DETAILED_LOCATIONS and the overrides) are
// mapped by name. An area whose division isn't certain stays under "Kampala"
// rather than being guessed.

const KAMPALA_DIVISIONS = ['Central', 'Kawempe', 'Makindye', 'Nakawa', 'Rubaga'];

const DIVISION_TOWN_ALIASES = new Map([
  ['kampala central', 'Central'],
  ['kampala central division', 'Central'],
  ['central', 'Central'],
  ['central division', 'Central'],
  ['kawempe', 'Kawempe'],
  ['kawempe division', 'Kawempe'],
  ['makindye', 'Makindye'],
  ['makindye division', 'Makindye'],
  ['nakawa', 'Nakawa'],
  ['nakawa division', 'Nakawa'],
  ['rubaga', 'Rubaga'],
  ['rubaga division', 'Rubaga'],
  ['lubaga', 'Rubaga'],
  ['lubaga division', 'Rubaga']
]);

const AREAS_BY_DIVISION = {
  Central: [
    'Bukesa', 'Civic Centre', 'Industrial Area', 'Kagugube', 'Kamwokya', 'Kanjokya',
    'Kikuubo', 'Kisenyi', 'Kololo', 'Nakasero', 'Nakivubo', 'Old Kampala'
  ],
  Kawempe: [
    'Bwaise', 'Kalerwe', 'Kanyanya', 'Kawempe', 'Kazo-Angola', 'Kikaya', 'Kikoni',
    'Komamboga', 'Kyebando', 'Makerere', 'Mpererwe', 'Mulago', 'Tula', 'Wandegeya'
  ],
  Makindye: [
    'Bukasa', 'Bunga', 'Buziga', 'Ggaba', 'Kabalagala', 'Kansanga', 'Katwe', 'Kibuli',
    'Kibuye', 'Kisugu', 'Lukuli', 'Luwafu', 'Makindye', 'Munyonyo', 'Muyenga',
    'Namuwongo', 'Nsambya', 'Salaama', 'Wabigalo'
  ],
  Nakawa: [
    'Banda', 'Bugolobi', 'Bugoloobi', 'Bukoto', 'Butabika', 'Kalinabiri', 'Kinawataka',
    'Kisaasi', 'Kitintale', 'Kiwatule', 'Kulambiro', 'Kyambogo', 'Kyanja', 'Lugogo',
    'Luzira', 'Mbuya', 'Mutungo', 'Naguru', 'Nakawa', 'Ntinda'
  ],
  Rubaga: [
    'Busega', 'Kabowa', 'Kabusu', 'Kabuusu', 'Kasubi', 'Kitebi', 'Lubya', 'Lungujja',
    'Lusaze', 'Mengo', 'Mutundwe', 'Nabulagala', 'Najjanankumbi', 'Nakulabye',
    'Namirembe', 'Namungoona', 'Nateete', 'Ndeeba', 'Rubaga', 'Wankulukuku'
  ]
};

function key(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const DIVISION_BY_AREA = new Map();
Object.entries(AREAS_BY_DIVISION).forEach(([division, areas]) => {
  areas.forEach((area) => DIVISION_BY_AREA.set(key(area), division));
});

// "Kololo I", "Mbuya Ii", "Kamwokya Ii" (gazetteer parish numbering) map with
// their base name.
function baseAreaKey(name = '') {
  return key(name).replace(/\s+(?:i{1,3}|iv|v|\d+)$/i, '').trim();
}

function kampalaDivisionForArea(name = '') {
  return DIVISION_BY_AREA.get(key(name)) || DIVISION_BY_AREA.get(baseAreaKey(name)) || '';
}

// Kisaasi sits on the Kawempe/Nakawa boundary. The registry keeps one node
// (default town Nakawa, last in this list). Staff may save either division.
const BOUNDARY_AREAS = new Map([
  ['kisaasi', ['Kawempe', 'Nakawa']],
  ['kisasi', ['Kawempe', 'Nakawa']]
]);

function kampalaTownsForArea(name = '') {
  const boundary = BOUNDARY_AREAS.get(key(name)) || BOUNDARY_AREAS.get(baseAreaKey(name));
  if (boundary) return boundary.slice();
  const division = kampalaDivisionForArea(name);
  return division ? [division] : [];
}

// The town to file a Kampala location under: a division where known, else
// "Kampala". A boundary area keeps the division already stored in currentTown
// when that division is one of its parents; otherwise the default (Nakawa for
// Kisaasi) so an empty or "Kampala" town does not flip to Kawempe.
function kampalaTownFor(name = '', currentTown = '') {
  const aliased = DIVISION_TOWN_ALIASES.get(key(currentTown));
  const boundary = BOUNDARY_AREAS.get(key(name)) || BOUNDARY_AREAS.get(baseAreaKey(name));
  if (aliased && boundary && boundary.includes(aliased)) return aliased;
  if (aliased && !boundary) return aliased;
  if (boundary) return boundary[boundary.length - 1];
  return kampalaDivisionForArea(name) || 'Kampala';
}

module.exports = {
  KAMPALA_DIVISIONS,
  AREAS_BY_DIVISION,
  kampalaDivisionForArea,
  kampalaTownFor,
  kampalaTownsForArea
};
