'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

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

const migrationRunner = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'migrate.js'), 'utf8');
const currencyMigration = fs.readFileSync(
  path.join(__dirname, '..', 'db', 'migrations', '117_country_scoped_property_price_currency.sql'),
  'utf8'
);
assert.match(migrationRunner, /set_config\('app\.country_code', \$1, true\)/);
assert.match(currencyMigration, /active_country_code = 'ZA'/);
assert.match(currencyMigration, /ALTER COLUMN price_currency SET DEFAULT 'ZAR'/);
assert.match(currencyMigration, /price_currency IS NOT DISTINCT FROM 'ZAR'/);
assert.match(currencyMigration, /price_original_currency IN \('ZAR', 'USD', 'EUR', 'GBP'\)/);
assert.doesNotMatch(currencyMigration, /active_country_code = 'UG'/);

if (originalCountry === undefined) delete process.env.COUNTRY_CODE;
else process.env.COUNTRY_CODE = originalCountry;
if (originalReset === undefined) delete process.env.SOUTH_AFRICA_BOOTSTRAP_RESET_SEEDED_DATA;
else process.env.SOUTH_AFRICA_BOOTSTRAP_RESET_SEEDED_DATA = originalReset;

console.log('south-africa migration isolation guard tests passed');
