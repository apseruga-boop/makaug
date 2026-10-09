#!/usr/bin/env node
'use strict';

/**
 * Give an MK reference to every listing that has none.
 *
 * Dry-run by default: prints the count per source and 20 sample ids, writes
 * nothing. Pass --apply to assign. Only rows whose reference is NULL or empty
 * are touched, one row at a time, and never one that already has a reference.
 *
 *   node scripts/backfill-missing-inquiry-references.js            # dry run
 *   node scripts/backfill-missing-inquiry-references.js --apply    # writes
 */

require('dotenv').config();

const { buildListingReference } = require('../services/listingReferenceService');

const MISSING_SQL = `
  SELECT id::text AS id, source, status, created_at
    FROM properties
   WHERE COALESCE(TRIM(inquiry_reference), '') = ''
   ORDER BY created_at ASC`;

async function run(db, { apply = false, log = console.log } = {}) {
  const missing = (await db.query(MISSING_SQL)).rows;
  const bySource = {};
  for (const row of missing) bySource[row.source || '(none)'] = (bySource[row.source || '(none)'] || 0) + 1;
  log(`Listings with no reference: ${missing.length}`);
  Object.entries(bySource).forEach(([source, count]) => log(`  ${source}: ${count}`));
  log(`Sample ids: ${missing.slice(0, 20).map((row) => row.id).join(', ') || '(none)'}`);

  if (!apply) {
    log('Dry run: nothing was written. Re-run with --apply to assign references.');
    return { applied: false, missing: missing.length, assigned: 0 };
  }

  let assigned = 0;
  for (const row of missing) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const result = await db.query(
          `UPDATE properties
              SET inquiry_reference = $2
            WHERE id = $1 AND COALESCE(TRIM(inquiry_reference), '') = ''`,
          [row.id, buildListingReference()]
        );
        if (result.rowCount) assigned += 1;
        break;
      } catch (error) {
        // A collision on the unique reference: draw another.
        if (error.code !== '23505') throw error;
      }
    }
  }
  log(`Assigned ${assigned} references.`);
  return { applied: true, missing: missing.length, assigned };
}

module.exports = { run, MISSING_SQL };

if (require.main === module) {
  const db = require('../config/database');
  run(db, { apply: process.argv.includes('--apply') })
    .then(() => (db.pool ? db.pool.end() : undefined))
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
