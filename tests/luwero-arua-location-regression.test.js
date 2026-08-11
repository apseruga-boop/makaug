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

console.log('Luwero/Arua location regression tests passed');
