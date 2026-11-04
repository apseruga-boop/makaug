'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMarketplaceQuery } = require('../services/marketplaceService');

test('everyday phrases map to the trades that do the job', () => {
  assert.deepEqual(parseMarketplaceQuery('design my house').categories, ['architects', 'interior_design']);
  assert.equal(parseMarketplaceQuery('someone to fix my lights').category, 'electricians');
  assert.equal(parseMarketplaceQuery('fix leaking pipe').category, 'plumbers');
  assert.equal(parseMarketplaceQuery('build a house in Gulu').category, 'builders');
  assert.equal(parseMarketplaceQuery('land title help').category, 'property_lawyers');
  assert.equal(parseMarketplaceQuery('open boundaries for my plot').category, 'surveyors');
});

test('trade words match whole words only', () => {
  // "urgent" contains "agent" but is not a broker request.
  assert.equal(parseMarketplaceQuery('urgent plumber').category, 'plumbers');
});

test('place aliases resolve to their district wherever they appear', () => {
  assert.deepEqual(
    { district: parseMarketplaceQuery('Entebbe plumber').district, area: parseMarketplaceQuery('Entebbe plumber').area },
    { district: 'Wakiso', area: 'Entebbe' }
  );
  assert.equal(parseMarketplaceQuery('plumber in Entebbe').district, 'Wakiso');
  assert.equal(parseMarketplaceQuery('designer in ebbs').district, 'Wakiso');
  assert.equal(parseMarketplaceQuery('surveyor kla').district, 'Kampala');
  assert.equal(parseMarketplaceQuery('Kampala surveyor').district, 'Kampala');
});
