#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  districtForKnownArea,
  districtForKnownLocationText,
  districtsForKnownLocationText,
  normalizeReviewLocationHierarchy
} = require('../utils/ugandaLocationHierarchy');
const { canonicalizeUgandaLocation } = require('../utils/ugandaLocationRegistry');

const root = path.join(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const staffRoute = fs.readFileSync(path.join(root, 'routes', 'staff.js'), 'utf8');

assert.strictEqual(districtForKnownArea('Luweero'), 'Luwero');
assert.strictEqual(districtForKnownArea('Ndibulungi'), 'Luwero');
assert.strictEqual(districtForKnownLocationText('25 acres in Luweero Ndibulungi'), 'Luwero');
assert.deepStrictEqual(districtsForKnownLocationText('Luweero, not Arua'), ['Luwero', 'Arua']);
assert.deepStrictEqual(
  districtsForKnownLocationText(
    '3-bedroom rental in Sseguku. New customer Katamba is the agent.',
    { excludedTerms: ['Katamba Bonny'] }
  ),
  ['Wakiso'],
  'agent names that are also place names must not create false district warnings'
);
assert.deepStrictEqual(
  normalizeReviewLocationHierarchy({
    area: 'Ndibulungi',
    district: 'Luwero',
    region: 'Central',
    city: 'Luwero Town',
    neighborhood: 'Ndibulungi'
  }).errors,
  []
);
assert(
  normalizeReviewLocationHierarchy({ area: 'Ndibulungi', district: 'Arua' }).errors.includes('area/neighbourhood must match the selected district'),
  'Ndibulungi must never validate under Arua'
);
assert.strictEqual(canonicalizeUgandaLocation('Luweero')?.district, 'Luwero');
assert.strictEqual(canonicalizeUgandaLocation('Ndibulungi')?.district, 'Luwero');
assert(frontend.includes('async function resolveUgandaLocationFromSharedRegistry'));
assert(frontend.includes('/api/properties/locations/resolve?q='));
assert(frontend.includes('function clearAdminReviewCanonicalLocation()'));
assert(frontend.includes('Location not recognised — pin set but region/district/area could NOT be auto-filled.'));
assert(frontend.includes('function canonicalTownForLocation'));
assert(frontend.includes('data-approval-blocker-host'));
assert(staffRoute.includes('Source/title/address evidence points to ${evidenceDistrict}, not ${district}'));
assert(staffRoute.includes('warnings: staffLocationWarnings(property)'));

// PR D (8 Oct 2026): Busiika, Wakiso municipalities, guardrail false positives.
assert.strictEqual(canonicalizeUgandaLocation('Busiika')?.district, 'Luwero', 'Busiika resolves to Luwero');
assert.strictEqual(districtForKnownArea('Busiika Town Council'), 'Luwero');
assert.strictEqual(normalizeReviewLocationHierarchy({ area: 'Busiika', district: 'Luwero' }).errors.length, 0);
assert.deepStrictEqual(districtsForKnownLocationText('House in Lubowa, Makindye-Ssabagabo'), ['Wakiso'],
  '"Makindye-Ssabagabo" is the Wakiso municipality, not the Kampala division Makindye');
assert.deepStrictEqual(districtsForKnownLocationText('Makindye-Ssabagabo'), ['Wakiso']);
assert.deepStrictEqual(districtsForKnownLocationText('Makindye, Kampala'), ['Kampala'], 'the Kampala division still resolves');
assert.deepStrictEqual(districtsForKnownLocationText('Entebbe City'), ['Wakiso']);
assert.deepStrictEqual(districtsForKnownLocationText('Plot in Entebbe City near the police station, Umeme power and water'), ['Wakiso'],
  '"station" and "Umeme" are Tororo parish names but everyday listing words');
const lubowa = normalizeReviewLocationHierarchy({ area: 'Lubowa', district: 'Wakiso' });
assert.strictEqual(lubowa.city, 'Makindye-Ssabagabo', 'Lubowa saves under Makindye-Ssabagabo, not "Wakiso Town"');
assert.deepStrictEqual(lubowa.errors, []);

console.log('Luwero/Arua location regression tests passed');
