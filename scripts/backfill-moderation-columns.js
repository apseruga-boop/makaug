#!/usr/bin/env node
'use strict';

/**
 * Fill approved_at / rejected_at / reviewed_by / moderation_stage on listings
 * whose status was changed while the full status UPDATE was failing ($6 bug,
 * 22 Apr – 8 Oct 2026). Values come from the latest matching row in
 * property_moderation_events (status_to = the listing's current status).
 *
 * DRY RUN BY DEFAULT: prints counts and 20 sample ids and writes nothing.
 *   node scripts/backfill-moderation-columns.js          # dry run
 *   node scripts/backfill-moderation-columns.js --apply  # Arthur decides
 *
 * Only empty columns are filled; nothing that is already set is overwritten.
 * reviewed_by is filled only when the event's actor_id is a real user id.
 */

const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const UUID = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

const CANDIDATES_SQL = `
  WITH latest AS (
    SELECT DISTINCT ON (e.property_id) e.property_id, e.actor_id, e.status_to, e.created_at
      FROM property_moderation_events e
      JOIN properties p ON p.id = e.property_id AND e.status_to = p.status
     WHERE p.status IN ('approved', 'rejected')
     ORDER BY e.property_id, e.created_at DESC
  )
  SELECT p.id, p.status, l.created_at AS event_at,
         CASE WHEN l.actor_id ~* '${UUID}' AND EXISTS (SELECT 1 FROM users u WHERE u.id::text = l.actor_id) THEN l.actor_id::uuid END AS actor_user,
         (p.status = 'approved' AND p.approved_at IS NULL) AS fill_approved,
         (p.status = 'rejected' AND p.rejected_at IS NULL) AS fill_rejected,
         (p.reviewed_by IS NULL) AS fill_reviewer,
         (COALESCE(p.moderation_stage, '') <> p.status) AS fill_stage
    FROM properties p
    JOIN latest l ON l.property_id = p.id
   WHERE (p.status = 'approved' AND p.approved_at IS NULL)
      OR (p.status = 'rejected' AND p.rejected_at IS NULL)
      OR (COALESCE(p.moderation_stage, '') <> p.status)
      OR p.reviewed_by IS NULL`;

const APPLY_SQL = `
  UPDATE properties p
     SET approved_at = CASE WHEN p.status = 'approved' AND p.approved_at IS NULL THEN c.event_at ELSE p.approved_at END,
         rejected_at = CASE WHEN p.status = 'rejected' AND p.rejected_at IS NULL THEN c.event_at ELSE p.rejected_at END,
         reviewed_by = COALESCE(p.reviewed_by, c.actor_user),
         moderation_stage = p.status,
         extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object('moderation_columns_backfilled_at', NOW())
    FROM (${CANDIDATES_SQL}) c
   WHERE c.id = p.id
  RETURNING p.id`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const rows = (await pool.query(CANDIDATES_SQL)).rows;
    const count = (key) => rows.filter((r) => r[key]).length;
    console.log(JSON.stringify({
      mode: APPLY ? 'apply' : 'dry-run',
      listings: rows.length,
      approved_at_to_fill: count('fill_approved'),
      rejected_at_to_fill: count('fill_rejected'),
      reviewed_by_to_fill: rows.filter((r) => r.fill_reviewer && r.actor_user).length,
      moderation_stage_to_fix: count('fill_stage'),
      sample_ids: rows.slice(0, 20).map((r) => r.id)
    }, null, 2));
    if (!APPLY) {
      console.log('Dry run: nothing was changed. Re-run with --apply to write these values.');
      return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(APPLY_SQL);
      await client.query('COMMIT');
      console.log(`Updated ${updated.rowCount} listings.`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
