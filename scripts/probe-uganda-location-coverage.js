#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');
const fixture = require('../tests/fixtures/uganda-location-coverage-worklist.json');
const {
  isExcludedLocationOnly,
  resolveCanonicalUgandaLocation,
  resolveCanonicalUgandaLocationFromText
} = require('../utils/ugandaLocationRegistry');

function probe(values = []) {
  const result = { total: values.length, matched: 0, ambiguous: 0, unmatched: 0, unmatched_values: [], ambiguous_values: [] };
  values.forEach((value) => {
    const resolution = resolveCanonicalUgandaLocation(value.query, value.district || '');
    result[resolution.status] += 1;
    if (resolution.status === 'unmatched') result.unmatched_values.push(value);
    if (resolution.status === 'ambiguous') {
      result.ambiguous_values.push({
        ...value,
        candidates: resolution.candidates.map((item) => ({ name: item.name, district: item.district }))
      });
    }
  });
  return result;
}

async function corpusProbe(connectionString) {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const rows = await client.query(`
      SELECT DISTINCT
        NULLIF(BTRIM(area), '') AS area,
        NULLIF(BTRIM(district), '') AS district,
        NULLIF(BTRIM(address), '') AS address
      FROM properties
      WHERE NULLIF(BTRIM(area), '') IS NOT NULL
         OR NULLIF(BTRIM(address), '') IS NOT NULL
      ORDER BY area NULLS LAST, district NULLS LAST, address NULLS LAST
    `);
    await client.query('ROLLBACK');
    const values = rows.rows.map((row) => ({
      query: row.area || String(row.address || '').split(',')[0].trim(),
      district: row.district || '',
      source_area: row.area,
      source_address: row.address
    })).filter((row) => row.query);
    const report = {
      total: values.length,
      matched: 0,
      ambiguous: 0,
      wrong_parent: 0,
      embedded_match: 0,
      non_location: 0,
      candidate_gap: 0,
      candidate_gap_values: []
    };
    const nonLocationPattern = /(?:#|•|\b(?:acres?|ago|bedrooms?|bills? of quantities|construction|district|episode|for rent|for sale|house tour|interior design|kitchen|luxury apartments?|only \d|owerri|ready title|review|soft launch|test zone|the estate|tiktok|uganda|ugx|views?)\b|\d{2,})/i;
    values.forEach((value) => {
      const strict = resolveCanonicalUgandaLocation(value.query, value.district);
      if (strict.status === 'matched') {
        report.matched += 1;
        return;
      }
      const unqualified = resolveCanonicalUgandaLocation(value.query);
      if (unqualified.status === 'matched') {
        report[unqualified.match.district === value.district ? 'matched' : 'wrong_parent'] += 1;
        return;
      }
      if (strict.status === 'ambiguous' || unqualified.status === 'ambiguous') {
        report.ambiguous += 1;
        return;
      }
      const embedded = resolveCanonicalUgandaLocationFromText(value.query);
      const addressSegments = String(value.source_address || '')
        .split(',')
        .map((segment) => segment.trim())
        .filter(Boolean);
      const addressResolution = addressSegments
        .map((segment) => resolveCanonicalUgandaLocation(segment))
        .find((resolution) => resolution.status === 'matched');
      if (embedded.status === 'matched' || addressResolution) {
        report.embedded_match += 1;
        return;
      }
      if (embedded.status === 'ambiguous') {
        report.ambiguous += 1;
        return;
      }
      if (isExcludedLocationOnly(value.query) || nonLocationPattern.test(value.query)) {
        report.non_location += 1;
        return;
      }
      report.candidate_gap += 1;
      report.candidate_gap_values.push(value);
    });
    return report;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const connectionString = process.argv.find((arg) => arg.startsWith('--database-url='))?.slice('--database-url='.length)
    || process.env.LOCATION_PROBE_DATABASE_URL
    || '';
  const summaryOnly = process.argv.includes('--summary');
  const report = {
    generated_at: new Date().toISOString(),
    supplied_worklist: probe(fixture.locations.map((query) => ({ query }))),
    corpus: connectionString ? await corpusProbe(connectionString) : { skipped: true, reason: 'Pass --database-url for a read-only corpus diff.' }
  };
  if (summaryOnly) {
    report.supplied_worklist = {
      total: report.supplied_worklist.total,
      matched: report.supplied_worklist.matched,
      ambiguous: report.supplied_worklist.ambiguous,
      unmatched: report.supplied_worklist.unmatched
    };
    if (!report.corpus.skipped) {
      report.corpus = {
        total: report.corpus.total,
        matched: report.corpus.matched,
        ambiguous: report.corpus.ambiguous,
        wrong_parent: report.corpus.wrong_parent,
        embedded_match: report.corpus.embedded_match,
        non_location: report.corpus.non_location,
        candidate_gap: report.corpus.candidate_gap,
        candidate_gap_values: report.corpus.candidate_gap_values
      };
    }
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.supplied_worklist.unmatched > 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});
