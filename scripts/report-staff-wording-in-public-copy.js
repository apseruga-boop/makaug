#!/usr/bin/env node
'use strict';

/**
 * Read-only report (P4, 10 Oct 2026): live listings whose stored public copy
 * still contains a staff instruction, e.g. "Confirm the exact property pin and
 * local amenities with the listing agent before approval." in area_highlights,
 * or "Pending King review ..." in the description.
 *
 * The public API, server-rendered pages and the SPA already strip these
 * sentences on the way out (services/publicListingCopy.js
 * STAFF_INSTRUCTION_PATTERNS, assets/makaug-app.js
 * sanitizePublicListingCopyForUi). This lists the stored rows so a later,
 * separately approved clean-up can be planned. It never writes, and it has no
 * --apply mode.
 *
 *   node scripts/report-staff-wording-in-public-copy.js            # live rows
 *   node scripts/report-staff-wording-in-public-copy.js --all      # any status
 */

require('dotenv').config();

const { STAFF_INSTRUCTION_PATTERNS } = require('../services/publicListingCopy');

// Postgres twin of STAFF_INSTRUCTION_PATTERNS (case-insensitive ~*).
const SQL_PATTERN = String.raw`confirm[^.!?]*before\s+(public\s+)?approval|confirm latest availability, exact pin, and ownership authority before featuring|pending king review`;

function reportSql({ all = false } = {}) {
  return `
    SELECT id::text AS id, status, title,
           (COALESCE(extra_fields->>'area_highlights', '') ~* $1) AS in_area_highlights,
           (COALESCE(description, '') ~* $1) AS in_description
      FROM properties
     WHERE (COALESCE(extra_fields->>'area_highlights', '') ~* $1 OR COALESCE(description, '') ~* $1)
       ${all ? '' : "AND status = 'approved'"}
     ORDER BY updated_at DESC NULLS LAST, id`;
}

function matchesStaffInstruction(text = '') {
  return STAFF_INSTRUCTION_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    const hit = pattern.test(String(text || ''));
    pattern.lastIndex = 0;
    return hit;
  });
}

async function run(db, { all = false, log = console.log } = {}) {
  const sql = reportSql({ all });
  if (/\b(UPDATE|INSERT|DELETE|ALTER|DROP)\b/i.test(sql)) throw new Error('report query must be read-only');
  const { rows } = await db.query(sql, [SQL_PATTERN]);
  const fieldCounts = { area_highlights: 0, description: 0 };
  log(`${all ? 'Listings (any status)' : 'Live listings'} with staff wording in public copy: ${rows.length}`);
  for (const row of rows) {
    const fields = [row.in_area_highlights && 'area_highlights', row.in_description && 'description'].filter(Boolean);
    fields.forEach((field) => { fieldCounts[field] += 1; });
    log(`  ${row.id}  ${row.status}  ${fields.join(', ')}  ${String(row.title || '').slice(0, 60)}`);
  }
  log(`By field: area_highlights ${fieldCounts.area_highlights}, description ${fieldCounts.description}.`);
  log('Read-only report: nothing was written. Public output already strips these sentences.');
  return { count: rows.length, ids: rows.map((row) => row.id), fieldCounts };
}

module.exports = { run, reportSql, SQL_PATTERN, matchesStaffInstruction };

if (require.main === module) {
  if (process.argv.includes('--apply')) {
    console.error('This report is read-only and has no --apply mode.');
    process.exit(2);
  }
  const db = require('../config/database');
  run(db, { all: process.argv.includes('--all') })
    .then(() => (db.pool ? db.pool.end() : undefined))
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
