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

function resolutionFingerprint(resolution = {}) {
  return {
    status: resolution.status,
    match: resolution.match?.key || null,
    candidates: (resolution.candidates || []).map((entry) => entry.key).sort()
  };
}

function suggestionFingerprint(suggestions = []) {
  return suggestions.map((item) => ({
    canonical_key: item.canonical_key,
    match: item.match,
    auto_resolvable: item.auto_resolvable,
    did_you_mean: item.did_you_mean
  }));
}

// Audit #2: every country-qualified form must preserve the exact result of the
// bare 53-place battery, including the selected canonical key and province.
for (const { place, province } of auditPlaces) {
  const bare = registry.resolveCanonicalSouthAfricaLocation(place);
  const bareSuggestions = registry.canonicalLocationSuggestions(place);
  for (const qualified of [`${place}, South Africa`, `${place}, ZA`, `${place}, RSA`]) {
    const resolution = registry.resolveCanonicalSouthAfricaLocation(qualified);
    assert.deepEqual(resolutionFingerprint(resolution), resolutionFingerprint(bare), `${qualified} diverged from bare resolution`);
    assert.equal(resolution.match?.province, province, `${qualified} resolved to the wrong province`);
    assert.deepEqual(
      suggestionFingerprint(registry.canonicalLocationSuggestions(qualified)),
      suggestionFingerprint(bareSuggestions),
      `${qualified} diverged from bare suggestions`
    );
  }
}

const daveSuffixBattery = [
  'Sea Point', 'Sandton', 'Umhlanga', 'Camps Bay', 'Centurion', 'Ballito',
  'Stellenbosch', 'Gqeberha', 'Nelspruit', 'Durban', 'Cape Town',
  'Johannesburg', 'Pretoria', 'Soweto', 'Randburg', 'Midrand',
  'Bloemfontein', 'Polokwane', 'Kimberley', 'Rustenburg', 'Claremont',
  'Constantia', 'Milnerton', 'Westville', 'Menlyn', 'George', 'Paarl',
  'Mthatha', 'Welkom', 'Tzaneen'
];
assert.equal(daveSuffixBattery.length, 30);
for (const place of daveSuffixBattery) {
  const bare = registry.resolveCanonicalSouthAfricaLocation(place);
  const suffixed = registry.resolveCanonicalSouthAfricaLocation(`${place}, South Africa`);
  assert.deepEqual(resolutionFingerprint(suffixed), resolutionFingerprint(bare), `${place} suffix parity failed`);
}
assert.equal(daveSuffixBattery.filter((place) => registry.resolveCanonicalSouthAfricaLocation(place).status === 'matched').length, 28);
assert.equal(daveSuffixBattery.filter((place) => registry.resolveCanonicalSouthAfricaLocation(place).status === 'ambiguous').length, 2);

const seaPointFormatted = registry.resolveCanonicalSouthAfricaLocation('12 Main Road, Sea Point, Cape Town, Western Cape, South Africa');
assert.equal(seaPointFormatted.status, 'matched');
assert.equal(seaPointFormatted.match.key, registry.resolveCanonicalSouthAfricaLocation('Sea Point').match.key);
assert(!/main road|south africa/i.test(seaPointFormatted.matched_query), 'The matched canonical query must discard road/country noise');
assert.deepEqual(
  suggestionFingerprint(registry.canonicalLocationSuggestions('12 Main Road, Sea Point, Cape Town, Western Cape, South Africa')),
  suggestionFingerprint(registry.canonicalLocationSuggestions('Sea Point')),
  'The suggestion endpoint must consume the locality after discarding road/country noise'
);
for (const query of ['South Africa, Sandton', 'South Africa Sandton', 'Sandton South Africa', 'ZA Sandton', 'Sandton RSA']) {
  assert.equal(registry.resolveCanonicalSouthAfricaLocation(query).match?.key, registry.resolveCanonicalSouthAfricaLocation('Sandton').match.key, `${query} affix stripping failed`);
}
for (const query of ['South Africa', 'ZA', 'RSA', 'Zzxq, South Africa']) {
  assert.equal(registry.resolveCanonicalSouthAfricaLocation(query).status, 'unmatched', `${query} must remain blocked`);
}

const suggestionBatteryStartedAt = Date.now();
for (const { place } of auditPlaces) registry.canonicalLocationSuggestions(place);
const suggestionBatteryMs = Date.now() - suggestionBatteryStartedAt;
assert(
  suggestionBatteryMs < 2000,
  `The 53-place suggestion battery took ${suggestionBatteryMs}ms; keep lookup indexed for free-tier responsiveness`
);

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
assert.deepEqual(
  resolutionFingerprint(registry.resolveCanonicalSouthAfricaLocation('Fourways, South Africa')),
  resolutionFingerprint(fourways),
  'Country stripping must not bypass Fourways disambiguation'
);

const propertiesSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'properties.js'), 'utf8');
assert(propertiesSource.includes('district: IS_SOUTH_AFRICA ? municipality : item.district'));
assert(propertiesSource.includes('municipality,'));
assert(propertiesSource.includes('matched_query: resolution.matched_query || null'));

const sharedNormalizerSource = fs.readFileSync(path.join(__dirname, '..', 'utils', 'locationQueryNormalization.js'), 'utf8');
const southAfricaRegistrySource = fs.readFileSync(path.join(__dirname, '..', 'utils', 'southAfricaLocationRegistry.js'), 'utf8');
const ugandaRegistrySource = fs.readFileSync(path.join(__dirname, '..', 'utils', 'ugandaLocationRegistry.js'), 'utf8');
assert(southAfricaRegistrySource.includes("require('./locationQueryNormalization')"));
assert(ugandaRegistrySource.includes("require('./locationQueryNormalization')"));
assert(sharedNormalizerSource.includes("ZA: Object.freeze(['south africa', 'za', 'rsa', 'republic of south africa'])"));
assert(sharedNormalizerSource.includes("UG: Object.freeze(['uganda', 'ug', 'republic of uganda', 'east africa'])"));

const ugandaRegistry = require('../utils/ugandaLocationRegistry');
const bareKira = ugandaRegistry.resolveCanonicalUgandaLocation('Kira');
for (const query of ['Kira, Uganda', 'Uganda, Kira', 'Kira UG', '12 Main Road, Kira, Wakiso, Uganda']) {
  assert.deepEqual(resolutionFingerprint(ugandaRegistry.resolveCanonicalUgandaLocation(query)), resolutionFingerprint(bareKira), `${query} regressed Uganda suffix handling`);
}
assert.equal(ugandaRegistry.resolveCanonicalUgandaLocation('Zzxq, Uganda').status, 'unmatched');

console.log('south-africa 53-place location audit tests passed');
