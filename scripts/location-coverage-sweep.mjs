#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  canonicalLocationOptions,
  normalizeLocationKey,
  resolveCanonicalUgandaLocation,
} = require(path.join(root, 'utils/ugandaLocationRegistry'));
const curated = require(path.join(root, 'tests/fixtures/uganda-high-traffic-locations.json'));

const csvPath = process.argv[2] || path.join(root, 'coverage-results.csv');
const all = canonicalLocationOptions();
const rows = [];

function add(scope, query, expectedKey, expectedDistrict) {
  const result = resolveCanonicalUgandaLocation(query, expectedDistrict || '');
  const resolvedKey = result.match?.key || '';
  const resolvedDistrict = result.match?.district || '';
  const exactIdRequired = scope !== 'complete_gazetteer';
  const pass = result.status === 'matched' && result.confidence === 1
    && (exactIdRequired ? resolvedKey === expectedKey : resolvedDistrict === expectedDistrict);
  const outcome = !pass ? 'gap'
    : resolvedKey === expectedKey ? 'exact_canonical_id'
      : 'same_district_alias_shadow';
  rows.push({ scope, query, expected_key: expectedKey, expected_district: expectedDistrict, result: result.status, confidence: result.confidence, resolved_key: resolvedKey, resolved_district: resolvedDistrict, outcome, pass, match_type: result.match_type || '' });
}

// Complete runtime gazetteer sweep with parent context: every canonical entry,
// not a sample, must resolve back to itself. This currently covers 12,000+ rows.
for (const item of all) add('complete_gazetteer', `${item.location}, ${item.district}`, item.canonical_key, item.district);
for (const item of curated) {
  add('curated_high_traffic', item.query, item.canonical_key, '');
  add('curated_high_traffic_country_suffix', `${item.query}, Uganda`, item.canonical_key, '');
}

const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const headers = ['scope', 'query', 'expected_key', 'expected_district', 'result', 'confidence', 'resolved_key', 'resolved_district', 'outcome', 'pass', 'match_type'];
const csv = [headers.join(','), ...rows.map((row) => headers.map((key) => escapeCsv(row[key])).join(','))].join('\n') + '\n';
fs.writeFileSync(csvPath, csv);

const failed = rows.filter((row) => !row.pass);
const summary = {
  marker: 'uganda-master-intake-recovery-20260811',
  canonical_runtime_rows: all.length,
  probes: rows.length,
  passed: rows.length - failed.length,
  failed: failed.length,
  same_district_alias_shadows: rows.filter((row) => row.outcome === 'same_district_alias_shadow').length,
  output: path.relative(root, csvPath),
  failures: failed.slice(0, 20),
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (failed.length) process.exitCode = 1;
