'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalLocationByKey, canonicalLocationOptions } = require('../utils/ugandaLocationRegistry');
const { isOnUgandaLand } = require('../utils/ugandaLand');

test('every registry coordinate is on land inside Uganda', () => {
  const offLand = canonicalLocationOptions()
    .filter((option) => Number.isFinite(option.latitude) && Number.isFinite(option.longitude))
    .filter((option) => !isOnUgandaLand(option.latitude, option.longitude))
    .map((option) => `${option.canonical_key} ${option.latitude},${option.longitude}`);
  assert.deepEqual(offLand, []);
});

test('Kigo, Masese and Malaba use the verified town coordinates', () => {
  const kigo = canonicalLocationByKey('wakiso:kigo');
  const masese = canonicalLocationByKey('jinja:masese');
  const malaba = canonicalLocationByKey('tororo:malaba');
  assert.equal(kigo.lat, 0.2052);
  assert.equal(kigo.lng, 32.5967);
  assert.equal(masese.lat, 0.45);
  assert.equal(masese.lng, 33.2333);
  assert.equal(malaba.lat, 0.6407);
  assert.equal(malaba.lng, 34.263);
  assert.equal(isOnUgandaLand(kigo.lat, kigo.lng), true);
  assert.equal(isOnUgandaLand(masese.lat, masese.lng), true);
  assert.equal(isOnUgandaLand(malaba.lat, malaba.lng), true);
});

test('the old lake and border centroids are not on Uganda land', () => {
  assert.equal(isOnUgandaLand(0.196, 32.615), false);
  assert.equal(isOnUgandaLand(0.406, 33.209), false);
  assert.equal(isOnUgandaLand(0.635, 34.268), false);
  assert.equal(isOnUgandaLand(-0.376491, 33.258793), false);
  assert.equal(isOnUgandaLand(0.3476, 32.5825), true);
});
