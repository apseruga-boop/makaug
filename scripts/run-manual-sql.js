#!/usr/bin/env node
'use strict';

// Runs one manual SQL file in a single transaction. DRY RUN BY DEFAULT.
//
//   node scripts/run-manual-sql.js db/manual/pricing/191_lister_fee_20000.sql
//   node scripts/run-manual-sql.js db/manual/pricing/191_lister_fee_20000.sql --apply
//
// Conventions for files under db/manual/:
//  - a header line "-- expect-rows: N" (also ">=N" or "A|B") says how many
//    real rows the file may change;
//  - every statement that changes a real row says so with
//    "RETURNING ... AS changed_id" (or a SELECT that returns changed_id, for
//    rows changed inside a DO block). Only changed_id rows are counted;
//  - any other SELECT result is printed, so a dry run can show what it found.
//
// Without --apply everything is rolled back. With --apply it commits only if
// the changed-row count matches the header; otherwise it rolls back.
// Nothing here runs at boot: db/manual/ is not db/migrations/.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function parseExpectation(sql) {
  const match = String(sql).match(/^--\s*expect-rows:\s*(.+)$/m);
  if (!match) throw new Error('The file needs a "-- expect-rows: N" header.');
  const spec = match[1].trim();
  if (/^>=\s*\d+$/.test(spec)) {
    const min = Number(spec.replace(/[^\d]/g, ''));
    return { spec, ok: (n) => n >= min };
  }
  if (/^\d+(\s*\|\s*\d+)+$/.test(spec)) {
    const allowed = spec.split('|').map((v) => Number(v.trim()));
    return { spec, ok: (n) => allowed.includes(n) };
  }
  if (/^\d+$/.test(spec)) return { spec, ok: (n) => n === Number(spec) };
  throw new Error(`Unreadable expect-rows header: ${spec}`);
}

function summarise(results) {
  const list = Array.isArray(results) ? results : [results];
  const changed = [];
  const printed = [];
  for (const result of list) {
    const fields = (result?.fields || []).map((field) => field.name);
    if (fields.includes('changed_id')) {
      for (const row of result.rows) changed.push(String(row.changed_id));
    } else if (result?.command === 'SELECT' && result.rows?.length) {
      printed.push(result.rows);
    }
  }
  return { changed, printed };
}

async function runManualSql(file, { apply = false, connectionString = process.env.DATABASE_URL, log = console.log } = {}) {
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  const sql = fs.readFileSync(file, 'utf8');
  const expectation = parseExpectation(sql);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    const { changed, printed } = summarise(await client.query(sql));
    for (const rows of printed) {
      log(`found ${rows.length} row(s):`);
      for (const row of rows.slice(0, 50)) log(`  ${JSON.stringify(row)}`);
    }
    const matches = expectation.ok(changed.length);
    log(`${path.basename(file)}: ${changed.length} row(s) changed (expected ${expectation.spec})`);
    for (const id of changed.slice(0, 20)) log(`  ${id}`);
    if (changed.length > 20) log(`  … and ${changed.length - 20} more`);
    if (apply && matches) {
      await client.query('COMMIT');
      log('APPLIED (committed).');
      return { applied: true, changed, matches };
    }
    await client.query('ROLLBACK');
    log(apply ? 'NOT APPLIED: the row count does not match the header. Rolled back.' : 'Dry run: rolled back. Add --apply to commit.');
    return { applied: false, changed, matches };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
}

module.exports = { runManualSql, parseExpectation, summarise };

if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args.find((arg) => !arg.startsWith('--'));
  if (!file) {
    console.error('Usage: node scripts/run-manual-sql.js <file.sql> [--apply]');
    process.exit(2);
  }
  runManualSql(path.resolve(file), { apply: args.includes('--apply') })
    .then((result) => process.exit(result.matches ? 0 : 1))
    .catch((error) => {
      console.error(error.message || error);
      process.exit(1);
    });
}
