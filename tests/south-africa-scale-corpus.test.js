'use strict';

const assert = require('assert');

process.env.COUNTRY_CODE = 'ZA';

const {
  AGENCY_BRANDS,
  FACEBOOK_GROUP_PATTERNS,
  PRIVATE_SELLER_HASHTAGS,
  PRIVATE_SELLER_PHRASES,
  buildSouthAfricaSearchCorpus,
  iterateSouthAfricaRegistryRows,
  summarizeSouthAfricaScaleCorpus,
} = require('../services/southAfricaScaleCorpusService');
const { harvestAutomationEnabled } = require('../utils/harvestFeatureFlags');

const { selected, corpus } = buildSouthAfricaSearchCorpus();
const summary = summarizeSouthAfricaScaleCorpus();
const registryFoundation = Array.from(iterateSouthAfricaRegistryRows({ includeCorpus: false }));

assert.equal(selected.provinces.length, 9);
assert.equal(selected.cities.length, 60);
assert.equal(selected.suburbs.length, 500);
assert.equal(corpus.length, (9 + 60 + 500) * ((4 * 5 * 2 * 2) + PRIVATE_SELLER_HASHTAGS.length));
assert.equal(summary.corpus_queries, corpus.length);
assert.equal(summary.platform_query_jobs, corpus.length * 5);
assert.deepEqual(summary.tracks, ['agent', 'fsbo']);
assert.deepEqual(summary.languages, ['en', 'af', 'zu', 'xh']);
assert.equal(summary.lookback_days, 183);
assert.equal(summary.auto_publish, false);
assert.equal(AGENCY_BRANDS.length, 18);
for (const [language, phrases] of Object.entries(PRIVATE_SELLER_PHRASES)) {
  for (const phrase of phrases) {
    assert(corpus.some((row) => row.language === language && row.track === 'fsbo' && row.query.includes(phrase)));
  }
}
for (const hashtag of PRIVATE_SELLER_HASHTAGS) {
  assert(corpus.some((row) => row.track === 'fsbo' && row.query.startsWith(`${hashtag} `)));
}
assert(FACEBOOK_GROUP_PATTERNS.includes('Plot and plan {location}'));
assert(FACEBOOK_GROUP_PATTERNS.includes('{location} township community property'));
assert(registryFoundation.some((row) => row.source_type === 'agency_branch_discovery'));
assert(registryFoundation.some((row) => row.source_type === 'facebook_group_discovery'));
assert(registryFoundation.some((row) => row.source_type === 'facebook_marketplace_discovery'));
assert(registryFoundation.every((row) => row.metadata.country_code === 'ZA'));
assert(registryFoundation.every((row) => row.metadata.auto_publish === false));
assert.equal(new Set(registryFoundation.map((row) => row.source_key)).size, registryFoundation.length);

assert.equal(harvestAutomationEnabled({
  COUNTRY_CODE: 'ZA', HARVEST_AUTOMATION_ENABLED: 'true', ZA_SCALE_HARVEST_ENABLED: 'false'
}), false);
assert.equal(harvestAutomationEnabled({
  COUNTRY_CODE: 'ZA', HARVEST_AUTOMATION_ENABLED: 'true', ZA_SCALE_HARVEST_ENABLED: 'true'
}), true);
assert.equal(harvestAutomationEnabled({ COUNTRY_CODE: 'UG', HARVEST_AUTOMATION_ENABLED: 'true' }), true);

console.log('south-africa scale corpus tests passed');
