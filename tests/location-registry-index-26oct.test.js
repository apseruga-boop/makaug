'use strict';

// 26 Oct 2026: the public SEO snapshot (5 min TTL) looked up every one of the
// ~11.5k registry locations with a linear find over the registry, about 6-9 s
// of blocked event loop per refresh. Lookups now use a key index.

const test = require('node:test');
const assert = require('node:assert/strict');
const registry = require('../utils/ugandaLocationRegistry');

test('indexed lookups match a linear scan and return copies', () => {
  const options = registry.canonicalLocationOptions();
  assert.ok(options.length > 10000);
  const sample = options.filter((_, index) => index % 97 === 0);
  sample.forEach((option) => {
    const found = registry.canonicalLocationByKey(option.canonical_key);
    assert.ok(found, option.canonical_key);
    assert.equal(found.key, option.canonical_key);
    assert.equal(found.district, option.district);
  });
  const first = registry.canonicalLocationByKey(options[0].canonical_key);
  first.name = 'changed by a caller';
  assert.notEqual(registry.canonicalLocationByKey(options[0].canonical_key).name, 'changed by a caller');
  assert.equal(registry.canonicalLocationByKey('no-such-place-zz'), null);
});

test('district rollups add up every location in the district', () => {
  const options = registry.canonicalLocationOptions();
  const district = options.find((option) => option.level === 'district' || option.canonical_key === registry.canonicalLocationByKey(option.canonical_key)?.key && registry.canonicalLocationByKey(option.canonical_key)?.level === 'district');
  const children = options.filter((option) => option.district === district.district && option.canonical_key !== district.canonical_key);
  const counts = new Map(children.slice(0, 5).map((child) => [child.canonical_key, 2]));
  const rolled = registry.canonicalLocationRollupCounts(counts);
  assert.equal(rolled.get(district.canonical_key), Math.min(5, children.length) * 2);
});

test('looking up every location is fast', () => {
  const keys = registry.canonicalLocationOptions().map((option) => option.canonical_key);
  const started = process.hrtime.bigint();
  keys.forEach((key) => registry.canonicalLocationByKey(key));
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 250, `${keys.length} lookups took ${ms.toFixed(0)} ms`);
});
