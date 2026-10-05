// Distance searches ("10 miles from Mulago") and multilingual / misspelt searches.
const test = require('node:test');
const assert = require('node:assert/strict');

const landmarks = require('../services/landmarkService');
const ai = require('../services/aiService');
const wa = require('../routes/whatsapp').__test;

test('landmark distance queries parse into a centre and radius', () => {
  const ten = landmarks.parseProximityQuery('10 miles from Mulago');
  assert.equal(ten.radiusMiles, 10);
  assert.equal(landmarks.resolveProximityCenter(ten.target).name, 'Mulago Hospital');
  const km = landmarks.parseProximityQuery('houses within 5 km of Makerere');
  assert.ok(Math.abs(km.radiusMiles - 3.11) < 0.02);
  assert.equal(landmarks.resolveProximityCenter(km.target).name, 'Makerere University');
  const school = landmarks.parseProximityQuery('house near a school in Kira');
  assert.equal(school.kind, 'school');
  assert.equal(String(school.area).toLowerCase(), 'kira');
  assert.equal(landmarks.parseProximityQuery('house near me'), null);
  const sw = landmarks.parseProximityQuery(ai.normalizeMultilingualSearchText('Nyumba karibu na hospitali ya Mulago'));
  assert.equal(landmarks.resolveProximityCenter(sw.target).name, 'Mulago Hospital');
});

test('distances, plot sizes and "3bdrm" are not read as a budget', () => {
  assert.equal(wa.extractNaturalSearchFilters('10 miles from Mulago').maxBudgetUgx, 0);
  assert.equal(wa.extractNaturalSearchFilters('5 miles from Entebbe airport').maxBudgetUgx, 0);
  assert.equal(wa.extractNaturalSearchFilters('land for sale in Wakiso 50x100').maxBudgetUgx, 0);
  const typo = wa.extractNaturalSearchFilters('3bdrm hse 4 sale kira');
  assert.equal(typo.maxBudgetUgx, 0);
  assert.equal(typo.bedsMin, 3);
  assert.equal(typo.searchType, 'sale');
});

test('Luganda, Swahili, French and Arabic searches keep rent/sale, beds and area', () => {
  const lg = wa.extractNaturalSearchFilters("Njagala ennyumba ey'okupangisa e Ntinda");
  assert.equal(lg.searchType, 'rent');
  assert.equal(lg.area, 'Ntinda');
  assert.equal(wa.extractNaturalSearchFilters('Nyumba ya vyumba 3 Kira').bedsMin, 3);
  assert.equal(wa.extractNaturalSearchFilters('Njagala okugula ennyumba e Mukono').searchType, 'sale');
  assert.equal(wa.extractNaturalSearchFilters('maison à louer à Kampala').searchType, 'rent');
  assert.equal(wa.extractNaturalSearchFilters('أبحث عن شقة للإيجار في كولولو').searchType, 'rent');
});

test('a large budget with no rent words is a purchase', () => {
  assert.equal(wa.extractNaturalSearchFilters('house for 300 million').searchType, 'sale');
});

test('"Makerere" is not the Runyankole word "make" (cheap)', () => {
  assert.equal(wa.isAffordabilityAdviceQuestion('houses near Makerere'), false);
  assert.equal(wa.isAffordabilityAdviceQuestion('cheap rooms in Kansanga'), true);
});

test('"within 5 km of X" is a landmark search, "within 5 km" alone is near me', () => {
  assert.equal(wa.isNearMeQuery('houses within 5 km of Makerere'), false);
  assert.equal(wa.isNearMeQuery('houses within 5 km'), true);
  assert.equal(wa.isNearMeQuery('within 3 miles of me'), true);
});

test('prices keep their decimal and sale prices have no period', () => {
  assert.equal(wa.formatPrice(1_500_000, 'mo'), 'USh 1.5M/mo');
  assert.equal(wa.formatPrice(418_000, 'once'), 'USh 418,000');
  assert.equal(wa.formatPrice(135_000_000, null), 'USh 135M');
});

test('browsing phrases are searches, not listing requests', () => {
  assert.equal(ai.heuristicIntent('newest listings').intent, 'property_search');
  assert.equal(ai.heuristicIntent('most expensive house').intent, 'property_search');
  assert.equal(ai.heuristicIntent('list my property').intent, 'property_listing');
});
