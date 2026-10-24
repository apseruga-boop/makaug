'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REGISTRY_CACHE_TTL_MS,
  getPropertySourceRegistry,
  releasePropertySourceRegistryCache,
} = require('../services/propertySourceRegistryService');

test('the property source registry is reused for ten minutes and can be released', () => {
  assert.equal(REGISTRY_CACHE_TTL_MS, 10 * 60 * 1000);
  const first = getPropertySourceRegistry();
  assert.equal(getPropertySourceRegistry(), first);
  releasePropertySourceRegistryCache();
  const second = getPropertySourceRegistry();
  assert.notEqual(second, first);
  assert.equal(second.length, first.length);
  assert.equal(second.length, 60000);
});
