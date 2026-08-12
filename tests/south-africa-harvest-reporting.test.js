'use strict';

const assert = require('assert');

process.env.COUNTRY_CODE = 'ZA';

const {
  loadHarvestSummary,
  recordHarvestImportResult,
} = require('../services/propertyHarvestMonitoringService');

async function run() {
  const calls = [];
  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      return { rows: [], rowCount: 1 };
    },
  };

  const report = await loadHarvestSummary(db, { days: 365 });
  assert.equal(report.window_days, 183);
  assert.equal(calls.length, 7);
  assert(calls.some(({ sql }) => sql.includes("metadata->>'source_track'") && sql.includes('parsed_complete_pct')));
  assert(calls.some(({ sql }) => sql.includes("metadata->>'classification'") && sql.includes("outcome IN ('skipped','failed')")));
  for (const { sql, params } of calls) {
    if (sql.includes('$1::int')) assert.equal(params[0], 183);
    if (sql.includes('$2')) assert.equal(params[1], 'ZA');
  }

  calls.length = 0;
  const result = await recordHarvestImportResult(db, {
    country_code: 'ZA',
    source_query: 'private sale house for sale Sandton, Gauteng',
    per_url_results: [{
      platform: 'facebook',
      source_url: 'https://www.facebook.com/example/posts/123',
      source_track: 'fsbo',
      outcome: 'skipped',
      reason: 'missing_price_or_explicit_poa',
      complete_price: false,
      complete_location: true,
      complete_classification: true,
    }],
  });
  assert.equal(result.recorded, 1);
  const metadata = JSON.parse(calls[0].params[8]);
  assert.equal(metadata.country_code, 'ZA');
  assert.equal(metadata.source_track, 'fsbo');
  assert.equal(metadata.source_query, 'private sale house for sale Sandton, Gauteng');
  assert.equal(metadata.complete_price, false);
  assert.equal(metadata.complete_location, true);
  assert.equal(metadata.complete_classification, true);

  console.log('south-africa harvest reporting tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
