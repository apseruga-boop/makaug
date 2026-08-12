#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  canonicalLocationSuggestions,
  canonicalLocationOptions,
  normalizeDistrict,
  normalizeLocationKey,
  resolveCanonicalUgandaLocation,
} = require(path.join(root, 'utils/ugandaLocationRegistry'));
const curated = require(path.join(root, 'tests/fixtures/uganda-high-traffic-locations.json'));
const messyInputs = require(path.join(root, 'tests/fixtures/uganda-location-messy-inputs.json'));
const generatedGazetteer = require(path.join(root, 'utils/ugandaLocationGazetteer.generated.json'));

const csvPath = process.argv[2] || path.join(root, 'coverage-results.csv');
const all = canonicalLocationOptions();
const rows = [];

function add(scope, query, expectedKey, expectedDistrict) {
  const result = resolveCanonicalUgandaLocation(query, expectedDistrict || '');
  const resolvedKey = result.match?.key || '';
  const resolvedDistrict = result.match?.district || '';
  const canonicalExpectedDistrict = normalizeDistrict(expectedDistrict) || expectedDistrict;
  const exactIdRequired = !scope.startsWith('complete_');
  const pass = result.status === 'matched' && result.confidence === 1
    && (exactIdRequired ? resolvedKey === expectedKey : resolvedDistrict === canonicalExpectedDistrict);
  const outcome = !pass ? 'gap'
    : resolvedKey === expectedKey ? 'exact_canonical_id'
      : resolvedDistrict === expectedDistrict ? 'same_district_alias_shadow'
        : 'canonical_parent_alias';
  rows.push({ scope, query, expected_key: expectedKey, expected_district: expectedDistrict, result: result.status, confidence: result.confidence, resolved_key: resolvedKey, resolved_district: resolvedDistrict, outcome, pass, match_type: result.match_type || '' });
}

function addMessy(item) {
  const resolution = resolveCanonicalUgandaLocation(item.query);
  const suggestions = canonicalLocationSuggestions(item.query, new Map(), 8);
  const top = suggestions[0] || null;
  const pass = item.expected === 'unmatched'
    ? resolution.status === 'unmatched' && suggestions.length === 0
    : resolution.status === 'unmatched'
      && top?.canonical_key === item.expected_key
      && top?.auto_resolvable === false
      && top?.did_you_mean === true;
  rows.push({
    scope: 'messy_input_guard',
    query: item.query,
    expected_key: item.expected_key || '',
    expected_district: '',
    result: resolution.status,
    confidence: top?.confidence || 0,
    resolved_key: top?.canonical_key || '',
    resolved_district: top?.district || '',
    outcome: item.expected === 'unmatched' ? (pass ? 'blocked_unknown' : 'unsafe_unknown') : (pass ? 'ranked_suggestion' : 'wrong_suggestion'),
    pass,
    match_type: top?.match || resolution.match_type || ''
  });
}

// Sweep every row in the complete public UBOS input before also checking the
// de-duplicated runtime registry. Parent context makes duplicate Uganda names
// deterministic without accepting a cross-district shadow.
for (const item of generatedGazetteer.locations || []) {
  add(
    'complete_ubos_public_source',
    `${item.name}, ${item.district}`,
    `${normalizeLocationKey(item.district)}:${normalizeLocationKey(item.name)}`,
    item.district
  );
}
for (const item of all) add('complete_runtime_gazetteer', `${item.location}, ${item.district}`, item.canonical_key, item.district);
for (const item of curated) {
  add('curated_high_traffic', item.query, item.canonical_key, '');
  add('curated_high_traffic_country_suffix', `${item.query}, Uganda`, item.canonical_key, '');
}
messyInputs.forEach(addMessy);

const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
const headers = ['scope', 'query', 'expected_key', 'expected_district', 'result', 'confidence', 'resolved_key', 'resolved_district', 'outcome', 'pass', 'match_type'];
const csv = [headers.join(','), ...rows.map((row) => headers.map((key) => escapeCsv(row[key])).join(','))].join('\n') + '\n';
fs.writeFileSync(csvPath, csv);

const failed = rows.filter((row) => !row.pass);
const summary = {
  marker: 'uganda-location-free-text-20260812',
  public_source: generatedGazetteer.meta?.source_name || null,
  public_source_layers: generatedGazetteer.meta?.source_layers || [],
  public_source_rows: generatedGazetteer.locations?.length || 0,
  public_village_layer_available: (generatedGazetteer.meta?.source_layers || []).some((layer) => /village/i.test(layer)),
  canonical_runtime_rows: all.length,
  probes: rows.length,
  passed: rows.length - failed.length,
  failed: failed.length,
  same_district_alias_shadows: rows.filter((row) => row.outcome === 'same_district_alias_shadow').length,
  canonical_parent_aliases: rows.filter((row) => row.outcome === 'canonical_parent_alias').length,
  output: path.relative(root, csvPath),
  failures: failed.slice(0, 20),
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (failed.length) process.exitCode = 1;
