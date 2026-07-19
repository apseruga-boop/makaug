'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildCandidate,
  buildPlacesRequest,
  buildQueries,
  parseArgs,
  resolveDistrict
} = require('../scripts/seed-marketplace-google-places');

test('Google Places request receives a scalar text query', () => {
  assert.deepEqual(buildPlacesRequest('land surveyor Kampala Uganda'), {
    textQuery: 'land surveyor Kampala Uganda',
    pageSize: 20,
    regionCode: 'UG'
  });
});

test('seed query plan covers every category and target district before local expansion', () => {
  const queries = buildQueries();
  assert.ok(queries.length > 100);
  const broad = queries.slice(0, 18);
  assert.equal(new Set(broad.map((query) => query.category.key)).size, 6);
  assert.deepEqual(new Set(broad.map((query) => query.district)), new Set(['Kampala', 'Wakiso', 'Mukono']));
});

test('district resolver only returns canonical seed districts from address evidence', () => {
  assert.equal(resolveDistrict({ formattedAddress: 'Ntinda, Kampala, Uganda' }, 'Kampala'), 'Kampala');
  assert.equal(resolveDistrict({ formattedAddress: 'Kira, Wakiso, Uganda' }, 'Wakiso'), 'Wakiso');
  assert.equal(resolveDistrict({ formattedAddress: 'Kira, Wakiso, Greater Kampala, Uganda' }, 'Wakiso'), 'Wakiso');
  assert.equal(resolveDistrict({ formattedAddress: 'Seeta, Mukono, Uganda' }, 'Mukono'), 'Mukono');
  assert.equal(resolveDistrict({ formattedAddress: 'Jinja, Uganda' }, 'Mukono'), '');
});

test('candidate requires a contact number, source URL and resolved location', () => {
  const query = buildQueries()[0];
  const candidate = buildCandidate({
    id: 'places/abc',
    displayName: { text: 'Niyo Land Surveys' },
    formattedAddress: 'Ntinda, Kampala, Uganda',
    internationalPhoneNumber: '+256 700 000000',
    googleMapsUri: 'https://maps.google.com/?cid=1',
    websiteUri: 'https://example.ug',
    location: { latitude: 0.35, longitude: 32.61 },
    types: ['land_surveyor']
  }, query);
  assert.equal(candidate.district, 'Kampala');
  assert.equal(candidate.phone, '+256700000000');
  assert.equal(candidate.category, 'surveyors');
  assert.equal(buildCandidate({ ...candidate, id: 'places/no-phone' }, query), null);
});

test('seed CLI bounds request and target volume', () => {
  assert.deepEqual(parseArgs(['--dry-run', '--max-requests=999', '--target=9000']), {
    dryRun: true,
    requestCap: 160,
    target: 2000,
    delayMs: 150
  });
});
