#!/usr/bin/env node
'use strict';

/**
 * Found-online imports wrote moderation reminders ("Found online", "TikTok
 * source evidence", "Agent follow-up required", "HD photos to verify", "Road
 * access to verify", "Title to verify") into properties.amenities, and the
 * public page showed them as amenities. The API now filters them out; this
 * script moves them off the rows into extra_fields.internal_review_tags.
 *
 * DRY RUN BY DEFAULT: prints counts and 20 sample ids, writes nothing.
 *   node scripts/strip-internal-amenity-tags.js          # dry run
 *   node scripts/strip-internal-amenity-tags.js --apply  # Arthur decides
 *
 * Only the internal tags move; real amenities on the same row stay.
 */

const { Pool } = require('pg');
const { isInternalReviewTag } = require('../services/publicListingCopy');

const APPLY = process.argv.includes('--apply');

const CANDIDATES_SQL = `
  SELECT id, status, amenities, extra_fields->'internal_review_tags' AS existing_tags
    FROM properties
   WHERE jsonb_typeof(amenities) = 'array'
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements_text(amenities) AS tag(value)
        WHERE tag.value ~* '^found online$|source evidence$|follow[- ]?up required|to verify$|^hd photos'
     )
   ORDER BY created_at ASC, id ASC`;

function plan(rows = []) {
  return rows.map((row) => {
    const amenities = Array.isArray(row.amenities) ? row.amenities : [];
    const tags = amenities.filter((item) => isInternalReviewTag(item));
    const keep = amenities.filter((item) => !isInternalReviewTag(item));
    const existing = Array.isArray(row.existing_tags) ? row.existing_tags : [];
    return { id: row.id, status: row.status, tags, keep, internal_review_tags: [...new Set([...existing, ...tags])] };
  }).filter((item) => item.tags.length);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const changes = plan((await pool.query(CANDIDATES_SQL)).rows);
    const byStatus = changes.reduce((acc, item) => ({ ...acc, [item.status || 'unknown']: (acc[item.status || 'unknown'] || 0) + 1 }), {});
    const tagCounts = changes.flatMap((item) => item.tags).reduce((acc, tag) => ({ ...acc, [tag]: (acc[tag] || 0) + 1 }), {});
    console.log(JSON.stringify({
      mode: APPLY ? 'apply' : 'dry-run',
      listings: changes.length,
      by_status: byStatus,
      tags: tagCounts,
      rows_keeping_real_amenities: changes.filter((item) => item.keep.length).length,
      sample_ids: changes.slice(0, 20).map((item) => item.id)
    }, null, 2));
    if (!APPLY) {
      console.log('Dry run: nothing was changed. Re-run with --apply to move these tags.');
      return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const item of changes) {
        await client.query(
          `UPDATE properties
              SET amenities = $2::jsonb,
                  extra_fields = COALESCE(extra_fields, '{}'::jsonb)
                    || jsonb_build_object('internal_review_tags', $3::jsonb, 'internal_review_tags_moved_at', NOW())
            WHERE id = $1`,
          [item.id, JSON.stringify(item.keep), JSON.stringify(item.internal_review_tags)]
        );
      }
      await client.query('COMMIT');
      console.log(`Updated ${changes.length} listings.`);
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

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { plan, CANDIDATES_SQL };
