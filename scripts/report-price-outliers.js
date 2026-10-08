#!/usr/bin/env node
'use strict';

/**
 * READ-ONLY report of approved listings whose price is outside the bounds set
 * in batch-1 PR 3 (utils/listingPriceQuality.js, utils/propertyPriceCurrency.js):
 *   - one-off (sale/land) price above UGX 20bn
 *   - monthly price above UGX 100M
 *   - USD original above 3,000,000 (a shilling figure tagged as USD)
 *   - any price above 1e12 (e.g. 8e25bf4a "USh 3,230,000,000,000,000,000")
 * Prints id, title, price, period, currency and source URL. There is no
 * --apply: staff correct the rows, Arthur decides.
 *
 *   node scripts/report-price-outliers.js            # table
 *   node scripts/report-price-outliers.js --json     # JSON
 */

const { Pool } = require('pg');
const { ONE_OFF_MAX_UGX, MONTHLY_MAX_UGX, IMPOSSIBLE_PRICE_UGX } = require('../utils/listingPriceQuality');
const { MAX_PLAUSIBLE_USD_ORIGINAL } = require('../utils/propertyPriceCurrency');

const MONTHLY_PERIODS = ['month', 'mo', 'monthly', 'per_month', 'per month', 'pm'];

const SQL = `
  SELECT id, title, listing_type, price, price_period,
         COALESCE(price_original_currency, extra_fields->>'price_original_currency', 'UGX') AS currency,
         COALESCE(price_original::text, extra_fields->>'price_original') AS price_original,
         COALESCE(extra_fields->>'source_url', extra_fields->>'source_post_url', extra_fields->>'tiktok_url', extra_fields->>'video_url') AS source_url,
         CASE
           WHEN price > $1 THEN 'price_above_1e12'
           WHEN UPPER(COALESCE(price_original_currency, extra_fields->>'price_original_currency', '')) = 'USD'
                AND COALESCE(price_original, NULLIF(extra_fields->>'price_original', '')::numeric, 0) > $2 THEN 'usd_original_above_3m'
           WHEN LOWER(COALESCE(price_period, '')) = ANY($3::text[]) AND price > $4 THEN 'monthly_above_100m'
           WHEN LOWER(COALESCE(price_period, '')) <> ALL($3::text[]) AND listing_type <> 'rent' AND price > $5 THEN 'one_off_above_20bn'
         END AS reason
    FROM properties
   WHERE status = 'approved'
     AND (
       price > $1
       OR (UPPER(COALESCE(price_original_currency, extra_fields->>'price_original_currency', '')) = 'USD'
           AND COALESCE(price_original, NULLIF(extra_fields->>'price_original', '')::numeric, 0) > $2)
       OR (LOWER(COALESCE(price_period, '')) = ANY($3::text[]) AND price > $4)
       OR (LOWER(COALESCE(price_period, '')) <> ALL($3::text[]) AND listing_type <> 'rent' AND price > $5)
     )
   ORDER BY price DESC NULLS LAST, id`;

async function reportPriceOutliers(queryable) {
  const result = await queryable.query(SQL, [IMPOSSIBLE_PRICE_UGX, MAX_PLAUSIBLE_USD_ORIGINAL, MONTHLY_PERIODS, MONTHLY_MAX_UGX, ONE_OFF_MAX_UGX]);
  return result.rows;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const rows = await reportPriceOutliers(pool);
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({ count: rows.length, rows }, null, 2));
      return;
    }
    const counts = rows.reduce((acc, row) => ({ ...acc, [row.reason]: (acc[row.reason] || 0) + 1 }), {});
    console.log(`Approved listings outside the price bounds: ${rows.length} ${JSON.stringify(counts)}`);
    console.log('id | reason | price | period | currency | original | title | source');
    rows.forEach((row) => console.log([
      row.id, row.reason, row.price, row.price_period || '', row.currency || '', row.price_original || '',
      String(row.title || '').slice(0, 60), row.source_url || ''
    ].join(' | ')));
    console.log('Read-only report: nothing was changed.');
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

module.exports = { reportPriceOutliers, SQL };
