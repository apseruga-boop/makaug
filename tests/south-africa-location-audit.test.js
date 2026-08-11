'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const registry = require('../utils/southAfricaLocationRegistry');

const auditPlacesByProvince = {
  Gauteng: [
    'Johannesburg', 'Sandton', 'Pretoria', 'Centurion', 'Soweto', 'Midrand',
    'Randburg', 'Roodepoort', 'Benoni', 'Boksburg', 'Germiston', 'Kempton Park',
    'Alberton'
  ],
  'Western Cape': [
    'Cape Town', 'Stellenbosch', 'Paarl', 'George', 'Knysna', 'Hermanus',
    'Somerset West', 'Bellville', 'Sea Point', 'Franschhoek', 'Worcester'
  ],
  'KwaZulu-Natal': [
    'Durban', 'Umhlanga', 'Ballito', 'Pietermaritzburg', 'Richards Bay',
    'Newcastle', 'Pinetown', 'Amanzimtoti'
  ],
  'Eastern Cape': ['Gqeberha', 'East London', 'Mthatha', 'Grahamstown', 'Jeffreys Bay'],
  'Free State': ['Bloemfontein', 'Welkom', 'Bethlehem'],
  Limpopo: ['Polokwane', 'Tzaneen', 'Thohoyandou'],
  Mpumalanga: ['Mbombela', 'Nelspruit', 'Emalahleni', 'Secunda'],
  'North West': ['Mahikeng', 'Mafikeng', 'Rustenburg', 'Potchefstroom'],
  'Northern Cape': ['Kimberley', 'Upington']
};

const auditPlaces = Object.entries(auditPlacesByProvince)
  .flatMap(([province, places]) => places.map((place) => ({ place, province })));
assert.equal(auditPlaces.length, 53, 'Dave audit battery must retain 53 major-place cases');

const auditResults = auditPlaces.map(({ place, province }) => ({
  place,
  province,
  resolution: registry.resolveCanonicalSouthAfricaLocation(place)
}));
const matched = auditResults.filter(({ resolution }) => resolution.status === 'matched');
assert(matched.length >= 45, `Expected at least 45 exact matches; received ${matched.length}`);
assert.equal(matched.length, 53, 'The corrected major-place battery should resolve all 53 cases');

for (const { place, province, resolution } of auditResults) {
  assert.equal(resolution.match.province, province, `${place} resolved to the wrong province`);
  assert(resolution.match.municipality, `${place} is missing its municipality tier`);
  assert.notEqual(
    registry.normalizeLocationKey(resolution.match.municipality),
    registry.normalizeLocationKey(resolution.match.province),
    `${place} still mirrors province into municipality`
  );
}

const aliasFamilies = [
  ['Gqeberha', 'Port Elizabeth', 'PE'],
  ['Mbombela', 'Nelspruit'],
  ['Mahikeng', 'Mafikeng'],
  ['Pretoria', 'Tshwane'],
  ['Durban', 'eThekwini'],
  ['Makhanda', 'Grahamstown'],
  ['Polokwane', 'Pietersburg'],
  ['Kariega', 'Uitenhage'],
  ['Komani', 'Queenstown'],
  ['Qonce', "King William's Town"],
  ['eMalahleni', 'Witbank'],
  ['Mthatha', 'Umtata'],
  ['Modimolle', 'Nylstroom'],
  ['Bela-Bela', 'Warmbaths'],
  ['Lephalale', 'Ellisras'],
  ['Musina', 'Messina'],
  ['Mokopane', 'Potgietersrus'],
  ['Jeffreys Bay', "Jeffrey's Bay", 'J-Bay']
];

for (const aliases of aliasFamilies) {
  const resolutions = aliases.map((alias) => registry.resolveCanonicalSouthAfricaLocation(alias));
  assert(resolutions.every((resolution) => resolution.status === 'matched'), `${aliases.join(' / ')} must all resolve`);
  assert.equal(new Set(resolutions.map((resolution) => resolution.match.key)).size, 1, `${aliases.join(' / ')} must share one canonical node`);
}

const johannesburgSuggestions = registry.canonicalLocationSuggestions('Johannesburg');
assert.equal(johannesburgSuggestions.filter((item) => item.match === 'exact_alias').length, 1);
assert.equal(johannesburgSuggestions.filter((item) => item.match === 'secondary_alias').length, 0);

const sandtonSuggestions = registry.canonicalLocationSuggestions('Sandton');
const primarySandton = sandtonSuggestions.find((item) => item.match === 'exact_alias' && item.auto_resolvable);
const secondarySandton = sandtonSuggestions.find((item) => item.match === 'secondary_alias');
assert.equal(primarySandton?.province, 'Gauteng', 'Prominent Sandton must default to Gauteng');
assert.equal(secondarySandton?.province, 'Limpopo', 'The secondary Sandton must remain discoverable');

const fourways = registry.resolveCanonicalSouthAfricaLocation('Fourways');
assert.equal(fourways.status, 'ambiguous', 'Fourways must remain ambiguous across distinct municipalities');
assert.equal(new Set(fourways.candidates.map((entry) => entry.municipality)).size, 2);

const propertiesSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'properties.js'), 'utf8');
assert(propertiesSource.includes('district: IS_SOUTH_AFRICA ? municipality : item.district'));
assert(propertiesSource.includes('municipality,'));

console.log('south-africa 53-place location audit tests passed');
