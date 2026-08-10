#!/usr/bin/env node
'use strict';

const { Pool } = require('pg');
const fixture = require('../tests/fixtures/uganda-location-coverage-worklist.json');
const {
  resolveCanonicalUgandaLocation
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
    return probe(values);
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const connectionString = process.argv.find((arg) => arg.startsWith('--database-url='))?.slice('--database-url='.length) || '';
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
        unmatched: report.corpus.unmatched,
        unmatched_values: report.corpus.unmatched_values
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
