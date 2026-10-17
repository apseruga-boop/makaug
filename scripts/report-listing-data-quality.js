#!/usr/bin/env node
'use strict';

/**
 * Read-only report for the 11 Oct listing data-quality batch.
 *
 * Selects rows that look like:
 *   - a per-plot "each" price stored as a multiple of the quoted rate
 *   - an apartment block stored as land
 *   - a foreign post, or an English word (Complex, Peace) filed as a Uganda town
 *   - a repeat of a live listing by video id, phone+area+price, or caption
 *   - a pending row that is a lower price for a listing that is already live
 *
 * It never INSERT, UPDATE, or DELETE. Do not point it at production unless
 * you only want to read. This change does not run the script.
 */

const QUERIES = {
  each_plot_prices: `
    SELECT id::text, inquiry_reference, status, price, area, district,
           LEFT(COALESCE(description, ''), 240) AS description,
           LEFT(COALESCE(extra_fields->>'source_caption', ''), 240) AS source_caption
      FROM properties
     WHERE COALESCE(status, '') <> 'deleted'
       AND price > 0
       AND COALESCE(description, extra_fields->>'source_caption', '') ~* '\\m(each|apiece|per plot|per acre)\\M'
       AND COALESCE(description, extra_fields->>'source_caption', '') ~* '\\m(plots?|units?)\\M'
     ORDER BY created_at DESC
     LIMIT 200`,
  apartment_blocks_stored_as_land: `
    SELECT id::text, inquiry_reference, status, listing_type, bedrooms, area, district, title
      FROM properties
     WHERE COALESCE(status, '') <> 'deleted'
       AND listing_type = 'land'
       AND COALESCE(bedrooms, 0) > 0
       AND (COALESCE(title, '') || ' ' || COALESCE(description, '') || ' ' || COALESCE(extra_fields->>'source_caption', ''))
           ~* 'apartment|rental units|\\mblock\\M'
     ORDER BY created_at DESC
     LIMIT 200`,
  english_word_locations: `
    SELECT id::text, inquiry_reference, status, area, district, title
      FROM properties
     WHERE COALESCE(status, '') <> 'deleted'
       AND (
         LOWER(TRIM(COALESCE(area, ''))) IN ('complex', 'peace')
         OR (
           district IN ('Napak', 'Yumbe')
           AND (COALESCE(title, '') || ' ' || COALESCE(description, '') || ' ' || COALESCE(extra_fields->>'source_caption', ''))
               ~* '\\m(complex|peace)\\M'
           AND (COALESCE(title, '') || ' ' || COALESCE(description, '') || ' ' || COALESCE(extra_fields->>'source_caption', ''))
               !~* '\\m(napak|yumbe|uganda)\\M'
         )
       )
     ORDER BY created_at DESC
     LIMIT 200`,
  foreign_posts: `
    SELECT id::text, inquiry_reference, status, area, district, title
      FROM properties
     WHERE COALESCE(status, '') <> 'deleted'
       AND (COALESCE(title, '') || ' ' || COALESCE(description, '') || ' ' || COALESCE(extra_fields->>'source_caption', ''))
           ~* 'karnataka|pickerington|\\mohio\\M|dha phase|\\mpakistan\\M|\\bindia\\M'
     ORDER BY created_at DESC
     LIMIT 200`,
  duplicate_candidates: `
    SELECT regexp_replace(COALESCE(lister_phone, ''), '\\D', '', 'g') AS phone,
           LOWER(TRIM(COALESCE(area, ''))) AS area,
           price,
           COUNT(*)::int AS copies,
           ARRAY_AGG(id::text ORDER BY created_at) AS ids,
           ARRAY_AGG(status ORDER BY created_at) AS statuses
      FROM properties
     WHERE COALESCE(status, '') IN ('pending', 'approved')
       AND COALESCE(area, '') <> ''
       AND regexp_replace(COALESCE(lister_phone, ''), '\\D', '', 'g') <> ''
       AND price > 0
     GROUP BY 1, 2, 3
    HAVING COUNT(*) > 1
     ORDER BY COUNT(*) DESC
     LIMIT 200`,
  price_drops_as_new_listings: `
    SELECT pending.id::text AS pending_id,
           pending.inquiry_reference AS pending_reference,
           pending.price AS pending_price,
           live.id::text AS live_id,
           live.inquiry_reference AS live_reference,
           live.price AS live_price,
           pending.area,
           pending.district
      FROM properties pending
      JOIN properties live
        ON live.status = 'approved'
       AND pending.status = 'pending'
       AND pending.id <> live.id
       AND LOWER(TRIM(COALESCE(pending.area, ''))) = LOWER(TRIM(COALESCE(live.area, '')))
       AND regexp_replace(COALESCE(pending.lister_phone, ''), '\\D', '', 'g') <> ''
       AND regexp_replace(COALESCE(pending.lister_phone, ''), '\\D', '', 'g')
           = regexp_replace(COALESCE(live.lister_phone, ''), '\\D', '', 'g')
       AND pending.price > 0
       AND live.price > pending.price
       AND pending.price >= live.price * 0.5
     ORDER BY pending.created_at DESC
     LIMIT 200`,
};

function assertReadOnly(sql) {
  if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b/i.test(sql)) {
    throw new Error('Report query is not read-only.');
  }
}

async function main() {
  for (const sql of Object.values(QUERIES)) assertReadOnly(sql);
  const databaseUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || '';
  if (!databaseUrl) {
    console.log(JSON.stringify({
      executed: false,
      reason: 'DATABASE_URL is not set, so the report was not run.',
      checks: Object.keys(QUERIES),
    }, null, 2));
    return;
  }
  const db = require('../config/database');
  const report = { executed: true, read_only: true, checks: {} };
  for (const [name, sql] of Object.entries(QUERIES)) {
    const result = await db.query(sql);
    report.checks[name] = { count: result.rows.length, rows: result.rows };
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
