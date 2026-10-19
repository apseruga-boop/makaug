#!/usr/bin/env node
'use strict';

/**
 * Read-only list of land and plot rows whose stored title, or an SEO title
 * kept in extra_fields, still says "house".
 *
 * The public <title>, H1 and og:title are generated from property_type and
 * listing_type. This script only SELECTs those rows. Do not point it at
 * production unless you only want to read.
 */

const QUERIES = {
  land_or_plot_titled_as_house: `
    SELECT id::text,
           inquiry_reference,
           status,
           listing_type,
           property_type,
           title,
           COALESCE(
             extra_fields->>'seo_title',
             extra_fields->'canonical'->>'seo_title',
             extra_fields->'listing_intelligence'->'canonical'->>'seo_title'
           ) AS seo_title,
           area,
           district,
           price
      FROM properties
     WHERE COALESCE(status, '') <> 'deleted'
       AND (
         listing_type = 'land'
         OR COALESCE(property_type, '') ~* '\\m(land|plots?)\\M'
       )
       AND (
         COALESCE(title, '') ~* '\\m(house|home|bungalow|villa|maisonette|duplex|townhouse)\\M'
         OR COALESCE(extra_fields->>'seo_title', '') ~* '\\m(house|home|bungalow|villa|maisonette|duplex|townhouse)\\M'
         OR COALESCE(extra_fields->'canonical'->>'seo_title', '') ~* '\\m(house|home|bungalow|villa|maisonette|duplex|townhouse)\\M'
         OR COALESCE(extra_fields->'listing_intelligence'->'canonical'->>'seo_title', '') ~* '\\m(house|home|bungalow|villa|maisonette|duplex|townhouse)\\M'
       )
     ORDER BY created_at DESC
     LIMIT 500`
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
      read_only: true,
      reason: 'DATABASE_URL is not set, so the report was not run.',
      checks: Object.keys(QUERIES)
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
  if (db.pool?.end) await db.pool.end();
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
