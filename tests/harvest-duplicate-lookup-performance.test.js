'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const serviceModulePath = require.resolve('../services/suppressedSourceService');

async function run() {
  const sourceService = read('services/socialSearchSourcedListingsService.js');
  const migration = read('db/migrations/114_harvest_duplicate_lookup_indexes.sql');

  assert(sourceService.includes('king-harvester-duplicate-lookup-20260809'), 'duplicate lookup must expose its production marker');
  assert(sourceService.includes('WITH matching_property_ids AS'), 'duplicate fingerprints must be split into indexable branches');
  assert(sourceService.includes('UNION\n       SELECT id FROM properties'), 'duplicate lookup must avoid one broad JSON OR scan');
  assert(!sourceService.includes("OR COALESCE(extra_fields->>'source_platform_id', '') = ANY"), 'the former cross-fingerprint OR scan must be absent');

  for (const index of [
    'idx_properties_harvest_source_url_exact',
    'idx_properties_harvest_source_listing_key',
    'idx_properties_harvest_content_fingerprint_all',
  ]) {
    assert(migration.includes(`CREATE INDEX IF NOT EXISTS ${index}`), `migration 114 must create ${index}`);
  }
  assert(migration.includes('ANALYZE properties'), 'migration 114 must refresh the planner after adding indexes');

  delete require.cache[serviceModulePath];
  const existingTableService = require('../services/suppressedSourceService');
  const existingTableQueries = [];
  const existingTableExecutor = {
    async query(sql) {
      existingTableQueries.push(String(sql));
      return { rows: [], rowCount: 0 };
    },
  };
  await existingTableService.suppressedSourceRowsForUrls(existingTableExecutor, ['https://www.tiktok.com/@fixture/video/1']);
  assert.strictEqual(existingTableQueries.length, 1, 'an existing suppression table must be read without request-time DDL');
  assert(existingTableQueries[0].includes('FROM suppressed_sources'));

  delete require.cache[serviceModulePath];
  const missingTableService = require('../services/suppressedSourceService');
  const missingTableQueries = [];
  let firstSelect = true;
  const missingTableExecutor = {
    async query(sql) {
      const statement = String(sql);
      missingTableQueries.push(statement);
      if (statement.includes('FROM suppressed_sources') && firstSelect) {
        firstSelect = false;
        const error = new Error('relation "suppressed_sources" does not exist');
        error.code = '42P01';
        throw error;
      }
      return { rows: [], rowCount: 0 };
    },
  };
  await missingTableService.suppressedSourceRowsForUrls(missingTableExecutor, ['https://www.tiktok.com/@fixture/video/2']);
  assert.strictEqual(missingTableQueries.filter((sql) => sql.includes('CREATE TABLE IF NOT EXISTS suppressed_sources')).length, 1, 'legacy databases must retain a missing-table fallback');
  assert.strictEqual(missingTableQueries.filter((sql) => sql.includes('FROM suppressed_sources')).length, 2, 'missing-table fallback must retry the original read');

  console.log('harvest-duplicate-lookup-performance: ok');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
