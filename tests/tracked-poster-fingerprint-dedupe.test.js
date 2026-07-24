#!/usr/bin/env node
'use strict';

const assert = require('assert');
const {
  contentFingerprintForSourceItem
} = require('../services/socialSearchSourcedListingsService');
const {
  districtForKnownArea,
  normalizeReviewLocationHierarchy
} = require('../utils/ugandaLocationHierarchy');

const base = {
  area: 'Kira Nsasa',
  district: 'Wakiso',
  listingType: 'rent',
  price: 1200000,
  sourceAgent: { phone: '+256 770 111 222' }
};

const first = contentFingerprintForSourceItem(base, base.sourceAgent);
const repost = contentFingerprintForSourceItem({
  ...base,
  key: 'different-video-id',
  sourceUrl: 'https://www.tiktok.com/@agent/video/2'
}, base.sourceAgent);

assert(first, 'complete listing evidence should produce a fingerprint');
assert.strictEqual(first, repost, 'different post URLs with same listing evidence should dedupe');
assert.strictEqual(
  contentFingerprintForSourceItem({ ...base, price: 0 }, base.sourceAgent),
  '',
  'price-on-application rows should not get a broad collision-prone fingerprint'
);
assert.strictEqual(districtForKnownArea('Banda'), 'Kampala');
assert.strictEqual(
  districtForKnownArea('Ibanda Rd'),
  '',
  'multi-token Mbarara road names must not be substring-mapped to Banda, Kampala'
);
assert.deepStrictEqual(
  normalizeReviewLocationHierarchy({ area: 'Ibanda Rd', district: 'Mbarara' }).errors,
  [],
  'an explicit Mbarara district must remain valid for Ibanda Rd'
);

console.log('tracked-poster fingerprint dedupe tests passed');
