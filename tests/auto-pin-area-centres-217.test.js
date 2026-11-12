
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isOnUgandaLand } = require('../utils/ugandaLand');
const { canonicalLocationByKey, canonicalLocationPinPoint } = require('../utils/ugandaLocationRegistry');
const { areaCentreForUnpinnedListing } = require('../services/listingCoordinateRepairService');
const {
  AUTO_PIN_217_ROWS,
  BATCH_ID,
  BATCH_SIZE,
  MATCHING_SQL,
  runAutoPinMissingAreaCentres217
} = require('../scripts/run-auto-pin-missing-area-centres-217');

const MIGRATION = path.join(__dirname, '../db/migrations/217_auto_pin_missing_area_centres.sql');
const RUNNER = path.join(__dirname, '../scripts/run-auto-pin-missing-area-centres-217.js');
const ROLLBACK = path.join(__dirname, '../scripts/rollback-217-auto-pin-missing-area-centres.sql');
const SERVER = path.join(__dirname, '../server.js');

const sql = fs.readFileSync(MIGRATION, 'utf8');
const runner = fs.readFileSync(RUNNER, 'utf8');
const rollback = fs.readFileSync(ROLLBACK, 'utf8');
const server = fs.readFileSync(SERVER, 'utf8');

const NEW_CENTRES = [
  { district: 'Wakiso', name: 'Akright City', lat: 0.179, lng: 32.541 },
  { district: 'Luwero', name: 'Bombo', lat: 0.577, lng: 32.537 },
  { district: 'Kampala', name: 'Bukasa', lat: 0.2891, lng: 32.6269 },
  { district: 'Luwero', name: 'Busiika', lat: 0.596, lng: 32.6565 },
  { district: 'Luwero', name: 'Busika', lat: 0.596, lng: 32.6565 },
  { district: 'Mukono', name: 'Ddundu', lat: 0.4836, lng: 32.7128 },
  { district: 'Luwero', name: 'Kamira', lat: 0.9554, lng: 32.6804 },
  { district: 'Mukono', name: 'Mayangayanga', lat: 0.4293, lng: 32.8926 },
  { district: 'Wakiso', name: 'Mutungo', lat: 0.2097, lng: 32.5778 },
  { district: 'Wakiso', name: 'Nampunge', lat: 0.4667, lng: 32.3167 },
  { district: 'Wakiso', name: 'Namulanda', lat: 0.1522, lng: 32.544 },
  { district: 'Wakiso', name: 'Namusera', lat: 0.4139, lng: 32.463 },
  { district: 'Wakiso', name: 'Nkumba', lat: 0.0948, lng: 32.507 },
  { district: 'Mpigi', name: 'Sekiwunga', lat: 0.2718, lng: 32.4117 },
  { district: 'Buikwe', name: 'Zitwe', lat: 0.1189, lng: 32.9588 }
];

test('the 10 Nov area centres sit in their catalogue place and on Uganda land', () => {
  for (const item of NEW_CENTRES) {
    assert.equal(isOnUgandaLand(item.lat, item.lng), true, item.name);
    const centre = areaCentreForUnpinnedListing({ area: item.name, district: item.district });
    assert.ok(centre, `${item.district}:${item.name}`);
    assert.equal(centre.point.lat, item.lat, item.name);
    assert.equal(centre.point.lng, item.lng, item.name);
  }
  // Wakiso Mutungo is not the Kampala parish of the same name.
  const kampala = areaCentreForUnpinnedListing({ area: 'Mutungo', district: 'Kampala' });
  assert.equal(kampala.point.lat, 0.3159);
  assert.equal(kampala.point.lng, 32.6426);
});

test('migration 217 pins 24 approved listings at verified area centres and stays off the boot path', () => {
  assert.equal(AUTO_PIN_217_ROWS.length, 24);
  assert.equal(new Set(AUTO_PIN_217_ROWS.map((row) => row.id)).size, 24);
  assert.equal(new Set(AUTO_PIN_217_ROWS.map((row) => row.ref)).size, 24);
  assert.equal(BATCH_SIZE, 20);
  assert.equal(BATCH_ID, 'auto_pin_20261110');

  // 12 Nov 2026: Akright City was remapped from the Kirinnya estate centroid
  // to Bwebajja. The 217 rows still record the pin that was applied then.
  const catalogueCorrectedAfter217 = new Set(['wakiso:akright city']);
  for (const row of AUTO_PIN_217_ROWS) {
    assert.equal(isOnUgandaLand(row.lat, row.lng), true, row.ref);
    const entry = canonicalLocationByKey(row.to_key);
    assert.ok(entry, row.to_key);
    if (catalogueCorrectedAfter217.has(row.to_key)) continue;
    const point = canonicalLocationPinPoint(entry);
    assert.equal(point.lat, row.lat, row.ref);
    assert.equal(point.lng, row.lng, row.ref);
  }
  const akrightCityPin = canonicalLocationPinPoint(canonicalLocationByKey('wakiso:akright city'));
  assert.equal(akrightCityPin.lat, 0.179);
  assert.equal(akrightCityPin.lng, 32.541);
  assert.equal(AUTO_PIN_217_ROWS.filter((row) => row.to_key === 'wakiso:akright city').every((row) => row.lat === 0.3303 && row.lng === 32.677), true);

  const titlePins = AUTO_PIN_217_ROWS.filter((row) => row.set_area);
  assert.deepEqual(titlePins.map((row) => row.ref).sort(), ['MK-20260922-6F5C3B', 'MK-20261004-4D2362']);
  assert.equal(titlePins.find((row) => row.ref === 'MK-20261004-4D2362').set_area, 'Kololo');
  assert.equal(titlePins.find((row) => row.ref === 'MK-20260922-6F5C3B').set_area, 'Busabala');
  assert.ok(AUTO_PIN_217_ROWS.some((row) => row.ref === 'MK-20261110-66D71E'));
  assert.ok(AUTO_PIN_217_ROWS.some((row) => row.ref === 'MK-20261109-3DB7E7'));
  assert.equal(AUTO_PIN_217_ROWS.some((row) => /amsterdam/i.test(row.to) || /amsterdam/i.test(row.ref)), false);

  assert.match(sql, /CREATE TABLE IF NOT EXISTS auto_pin_217_backup/);
  assert.match(sql, /lock_timeout = '3s'/);
  assert.match(sql, /statement_timeout = '15s'/);
  assert.match(sql, /MK-20261110-66D71E/);
  assert.doesNotMatch(sql, /UPDATE properties/);
  assert.doesNotMatch(sql, /DISABLE TRIGGER/);
  assert.doesNotMatch(sql, /DELETE FROM properties/);

  assert.match(runner, /SET LOCAL lock_timeout/);
  assert.match(runner, /SET LOCAL statement_timeout/);
  assert.match(runner, /runBackgroundWork/);
  assert.match(runner, /const BATCH_SIZE = 20/);
  assert.match(runner, /updated_at = p\.updated_at/);
  assert.match(runner, /'location_precision', 'area'/);
  assert.match(runner, /'batch', \$3::text/);
  assert.match(MATCHING_SQL, /COALESCE\(p\.extra_fields->'coords_fix'->>'batch', ''\) <> 'auto_pin_20261110'/);
  assert.doesNotMatch(runner, /AND p\.extra_fields->'coords_fix' \?/);
  assert.doesNotMatch(runner, /ALTER TABLE\s+properties\s+DISABLE TRIGGER/);
  assert.doesNotMatch(runner, /DELETE FROM properties/);
  assert.doesNotMatch(runner, /nominatim\.openstreetmap|fetch\(|https:\/\/nominatim/i);
  assert.match(runner, /There is no runtime\n\/\/ geocoding/);

  assert.match(rollback, /Not run by scripts\/migrate\.js/);
  assert.match(rollback, /auto_pin_217_backup/);
  assert.match(rollback, /round\(p\.latitude::numeric, 6\) = round\(b\.new_latitude::numeric, 6\)/);
  assert.match(rollback, /area = b\.old_area/);
  assert.doesNotMatch(rollback, /DELETE FROM properties/);
  assert.doesNotMatch(rollback, /ALTER TABLE\s+\w+\s+DISABLE TRIGGER/);
  assert.doesNotMatch(rollback, /DROP TABLE/i);
  assert.equal(fs.existsSync(path.join(__dirname, '../db/migrations/rollback-217-auto-pin-missing-area-centres.sql')), false);

  assert.match(server, /runAutoPinMissingAreaCentres217/);
  assert.match(server, /scheduleStartupDataRepairs/);
});

test('the 217 runner skips a non-Uganda country and pins in batches of 20', async () => {
  const prev = process.env.COUNTRY_CODE;
  process.env.COUNTRY_CODE = 'KE';
  try {
    const skipped = await runAutoPinMissingAreaCentres217({ getClient: async () => { throw new Error('should not run'); } });
    assert.equal(skipped.skipped, 'country_not_ug');
  } finally {
    if (prev === undefined) delete process.env.COUNTRY_CODE;
    else process.env.COUNTRY_CODE = prev;
  }

  const none = await runAutoPinMissingAreaCentres217(null);
  assert.equal(none.skipped, 'no_db');

  const listingRows = AUTO_PIN_217_ROWS.slice(0, 24).map((row) => ({
    id: row.id,
    inquiry_reference: row.ref,
    old_area: row.set_area ? null : row.to.split(', ')[0],
    old_district: row.set_area ? null : row.to.split(', ')[1],
    extra_fields: {},
    updated_at: '2026-10-01T00:00:00.000Z',
    new_lat: row.lat,
    new_lng: row.lng,
    to_label: row.to,
    to_key: row.to_key,
    set_area: row.set_area || null,
    set_district: row.set_district || null
  }));
  let remaining = listingRows.slice();
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push(sql);
      const text = String(sql);
      if (/^\s*(BEGIN|COMMIT|ROLLBACK|SET LOCAL|CREATE TABLE)/i.test(text)) return { rows: [], rowCount: 0 };
      if (text.includes('JOIN properties p ON p.id = t.id')) {
        const limit = Number(params[1]);
        const rows = remaining.slice(0, limit);
        remaining = remaining.slice(limit);
        return { rows, rowCount: rows.length };
      }
      if (text.includes('INSERT INTO auto_pin_217_backup') || text.includes('UPDATE properties p')) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unexpected sql: ${text.slice(0, 120)}`);
    },
    release() {}
  };
  const db = {
    getClient: async () => client,
    runBackgroundWork: async (fn) => fn()
  };
  process.env.COUNTRY_CODE = 'UG';
  try {
    const result = await runAutoPinMissingAreaCentres217(db, { batchSize: 20, maxBatches: 5 });
    assert.equal(result.updated, 24);
    assert.equal(result.batches, 3);
    assert.equal(result.stopped_early, false);
    assert.equal(queries.some((q) => /UPDATE properties p/.test(q)), true);
    assert.equal(queries.filter((q) => /JOIN properties p ON p.id = t.id/.test(q)).length, 3);
  } finally {
    if (prev === undefined) delete process.env.COUNTRY_CODE;
    else process.env.COUNTRY_CODE = prev;
  }
});
