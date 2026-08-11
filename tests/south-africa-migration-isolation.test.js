'use strict';

const assert = require('assert');

const originalCountry = process.env.COUNTRY_CODE;
const originalReset = process.env.SOUTH_AFRICA_BOOTSTRAP_RESET_SEEDED_DATA;
const {
  SOUTH_AFRICA_BOOTSTRAP_MARKER,
  SOUTH_AFRICA_SEEDED_TABLES,
  isSouthAfricaBootstrapResetEnabled
} = require('../scripts/migrate');

process.env.COUNTRY_CODE = 'UG';
process.env.SOUTH_AFRICA_BOOTSTRAP_RESET_SEEDED_DATA = 'true';
assert.equal(isSouthAfricaBootstrapResetEnabled(), false, 'Uganda must never enter the ZA bootstrap reset');

process.env.COUNTRY_CODE = 'ZA';
process.env.SOUTH_AFRICA_BOOTSTRAP_RESET_SEEDED_DATA = 'false';
assert.equal(isSouthAfricaBootstrapResetEnabled(), false, 'ZA reset requires an explicit one-time flag');

process.env.SOUTH_AFRICA_BOOTSTRAP_RESET_SEEDED_DATA = 'true';
assert.equal(isSouthAfricaBootstrapResetEnabled(), true);
assert.match(SOUTH_AFRICA_BOOTSTRAP_MARKER, /^za-separate-db-seed-isolation-v1-/);
for (const expected of ['properties', 'property_images', 'property_source_registry', 'mortgage_providers']) {
  assert(SOUTH_AFRICA_SEEDED_TABLES.includes(expected), `ZA isolation is missing ${expected}`);
}
assert(!SOUTH_AFRICA_SEEDED_TABLES.includes('users'), 'The safety reset must refuse an occupied DB, not truncate users');

if (originalCountry === undefined) delete process.env.COUNTRY_CODE;
else process.env.COUNTRY_CODE = originalCountry;
if (originalReset === undefined) delete process.env.SOUTH_AFRICA_BOOTSTRAP_RESET_SEEDED_DATA;
else process.env.SOUTH_AFRICA_BOOTSTRAP_RESET_SEEDED_DATA = originalReset;

console.log('south-africa migration isolation guard tests passed');
