#!/usr/bin/env node
'use strict';

/**
 * Rollback for scripts/backfill-outreach-week-2026-11-10.js.
 * Deletes only rows tagged as that backfill, in batches of 20.
 *
 * Usage:
 *   node scripts/rollback-outreach-week-2026-11-10.js
 *   node scripts/rollback-outreach-week-2026-11-10.js --apply
 */

const db = require('../config/database');
const { maskPhoneLast3 } = require('../services/agentProspectService');

const apply = process.argv.includes('--apply');

async function main() {
  await db.query("SELECT set_config('lock_timeout', '3s', false), set_config('statement_timeout', '30s', false)");
  const rows = await db.query(
    `SELECT id, full_name, phone, phone_key
       FROM agent_prospects
      WHERE logged_manually IS TRUE
        AND metadata->>'source' = 'backfill_week_2026_11_10'
      ORDER BY pitched_at ASC`
  );
  console.log(`${rows.rows.length} backfilled outreach rows found.`);
  for (const row of rows.rows) {
    console.log(`  ${row.full_name} ${maskPhoneLast3(row.phone)}`);
  }
  if (!apply) {
    console.log('Dry run. Re-run with --apply to delete these rows only.');
    return;
  }
  for (let i = 0; i < rows.rows.length; i += 20) {
    const ids = rows.rows.slice(i, i + 20).map((row) => row.id);
    await db.query("SELECT set_config('lock_timeout', '3s', true), set_config('statement_timeout', '30s', true)");
    await db.query(
      `DELETE FROM agent_prospects
        WHERE id = ANY($1::uuid[])
          AND metadata->>'source' = 'backfill_week_2026_11_10'`,
      [ids]
    );
  }
  console.log('Rollback complete.');
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (typeof db.close === 'function') db.close();
    if (typeof db.end === 'function') db.end();
    setTimeout(() => process.exit(process.exitCode || 0), 300).unref?.();
  });
