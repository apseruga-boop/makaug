'use strict';

// Read-only count of found-online rental rows that look like short stays.
// Does not update, delete, or message anything.

require('dotenv').config();

const db = require('../config/database');

const SQL = `
SELECT COUNT(*)::int AS short_stay_like_rentals
FROM properties p
WHERE LOWER(COALESCE(p.listing_type, '')) = 'rent'
  AND COALESCE(p.status, '') <> 'deleted'
  AND (
    p.source = 'found_online_property_source_v1'
    OR p.listed_via = 'found_online'
    OR p.source = 'sourced_inventory_candidate'
    OR COALESCE(p.extra_fields->>'found_online_label', '') <> ''
  )
  AND (
    LOWER(COALESCE(p.price_period, '')) IN ('night', 'nightly', 'day', 'daily')
    OR (
      COALESCE(p.title, '') || ' ' || COALESCE(p.description, '') || ' ' ||
      COALESCE(p.extra_fields->>'source_text', '') || ' ' ||
      COALESCE(p.extra_fields->>'source_caption', '') || ' ' ||
      COALESCE(p.extra_fields->>'source_title', '')
    ) ~* '(per[[:space:]]+night|nightly|/[[:space:]]*night|per[[:space:]]+day|daily[[:space:]]+rate|air[[:space:]]*bnb|short[[:space:]-]*stay)'
  )
`;

async function main() {
  const result = await db.query(SQL);
  console.log(JSON.stringify({
    ok: true,
    read_only: true,
    short_stay_like_found_online_rentals: result.rows[0].short_stay_like_rentals,
  }));
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ ok: false, read_only: true, error: error.message }));
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await db.pool.end(); } catch (_error) { /* pool may already be closed */ }
  });
