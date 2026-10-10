#!/usr/bin/env node
'use strict';

/**
 * C17 (and C7): approved or pending listings whose price is outside the
 * plausibility bounds in utils/pricePlausibility.js.
 *
 *   sale / commercial sale   UGX 5M to 50B
 *   land                     UGX 1M to 50B
 *   rent / student / land rent  UGX 50k to 100M a month (weekly, yearly and
 *                            semester prices turned into a monthly figure)
 *   commercial rent          UGX 50k to 2B a month
 *
 * Dry-run by default: lists every such listing with its MK ref, stored price,
 * source figures, the bound it breaks and a proposed reading of the source
 * text, and writes nothing. The public site already shows these as "Price on
 * application" (read-time guard), so the dry run is safe to review first.
 *
 * --apply (Arthur approves the run; never run it without that): sets price to
 * NULL, price_on_application = true and extra_fields.price_review =
 * 'implausible', keeps the old figures in extra_fields.implausible_price_raw,
 * and writes one property_moderation_events row per listing. Status is unchanged.
 *
 *   node scripts/fix-implausible-prices.js            # dry run
 *   node scripts/fix-implausible-prices.js --json     # dry run, JSON lines
 *   node scripts/fix-implausible-prices.js --apply    # writes (approval needed)
 */

require('dotenv').config();

const { PRICE_BOUNDS_UGX, applyPricePlausibility, pricePlausibility } = require('../utils/pricePlausibility');
const { propertyPriceMetadata } = require('../utils/propertyPriceCurrency');

// Only rows with a number; a coarse SQL pre-filter, then the exact JS bounds.
const CANDIDATES_SQL = `
  SELECT id::text AS id, inquiry_reference, status, listing_type, transaction_type,
         price, price_period, price_original, price_original_currency, price_fx_rate_ugx,
         price_on_application, title,
         LEFT(COALESCE(extra_fields->>'source_caption', extra_fields->>'source_text', description, ''), 600) AS source_text,
         extra_fields
    FROM properties
   WHERE status IN ('approved', 'pending')
     AND price IS NOT NULL
     AND price > 0
     AND (price > $1 OR price < $2)
   ORDER BY price DESC`;

function proposedFromSource(row = {}) {
  const metadata = propertyPriceMetadata(row.source_text || '');
  if (!metadata || !(Number(metadata.price) > 0)) return null;
  const check = pricePlausibility({ ...row, price: metadata.price });
  return check.plausible
    ? { price_ugx: metadata.price, original: metadata.price_original, currency: metadata.price_original_currency, note: 'read from the source text; confirm before using' }
    : null;
}

async function findImplausible(db) {
  const minAll = Math.min(...Object.values(PRICE_BOUNDS_UGX).map(([min]) => min));
  // Monthly bounds compare a monthly equivalent, so yearly rents up to 12x the
  // monthly max must be fetched too; 100M a month is the smallest max.
  const result = await db.query(CANDIDATES_SQL, [Math.floor(PRICE_BOUNDS_UGX.monthly[1] / 12), Math.ceil(minAll * 12)]);
  return result.rows
    .map((row) => ({ row, check: pricePlausibility(row) }))
    .filter(({ check }) => !check.plausible);
}

async function run(db, { apply = false, json = false, log = console.log, actor = 'scripts/fix-implausible-prices.js' } = {}) {
  const found = await findImplausible(db);
  const byStatus = found.reduce((acc, { row }) => ({ ...acc, [row.status]: (acc[row.status] || 0) + 1 }), {});
  log(`Listings outside the price bounds: ${found.length} (${Object.entries(byStatus).map(([status, count]) => `${status} ${count}`).join(', ') || 'none'})`);
  for (const { row, check } of found) {
    const line = {
      ref: row.inquiry_reference || row.id,
      id: row.id,
      status: row.status,
      listing_type: row.listing_type,
      transaction_type: row.transaction_type || null,
      price_ugx: Number(row.price),
      price_period: row.price_period,
      price_original: row.price_original == null ? null : Number(row.price_original),
      price_original_currency: row.price_original_currency || null,
      bound: `${check.kind} ${check.bounds[0]}..${check.bounds[1]}`,
      reason: check.reason,
      proposed: proposedFromSource(row)
    };
    log(json ? JSON.stringify(line) : `  ${line.ref} [${line.status}] ${line.listing_type}${line.transaction_type ? `/${line.transaction_type}` : ''} UGX ${line.price_ugx.toLocaleString('en-UG')}${line.price_period ? `/${line.price_period}` : ''}`
      + `${line.price_original_currency && line.price_original_currency !== 'UGX' ? ` (from ${line.price_original_currency} ${line.price_original})` : ''} — ${line.reason} (${line.bound})`
      + `${line.proposed ? ` — source text reads UGX ${line.proposed.price_ugx.toLocaleString('en-UG')} (confirm)` : ''}`);
  }
  if (!apply) {
    log('Dry run: nothing was written. The public site already shows these as "Price on application". Re-run with --apply only after approval.');
    return { applied: false, found: found.length, updated: 0, rows: found.map(({ row }) => row.id) };
  }

  let updated = 0;
  const now = new Date().toISOString();
  for (const { row } of found) {
    const { record, changed } = applyPricePlausibility(row, { now, source: actor });
    if (!changed) continue;
    const result = await db.query(
      `UPDATE properties
          SET price = NULL,
              price_original = NULL,
              price_fx_rate_ugx = NULL,
              price_fx_as_of = NULL,
              price_on_application = TRUE,
              extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $2::jsonb,
              updated_at = NOW()
        WHERE id = $1 AND price IS NOT DISTINCT FROM $3`,
      [row.id, JSON.stringify({
        price_on_application: true,
        price_review: record.extra_fields.price_review,
        price_review_reason: record.extra_fields.price_review_reason,
        price_review_at: now,
        price_review_source: actor,
        implausible_price_raw: record.extra_fields.implausible_price_raw
      }), row.price]
    );
    if (!result.rowCount) continue;
    updated += 1;
    await db.query(
      `INSERT INTO property_moderation_events (property_id, actor_id, action, reason, notes, checklist, delivery)
       VALUES ($1, NULL, 'price_set_to_poa', $2, NULL, '{}'::jsonb, $3::jsonb)`,
      [
        row.id,
        `C17: price UGX ${Number(row.price).toLocaleString('en-UG')}${row.price_period ? `/${row.price_period}` : ''} is outside the plausible range; set to Price on application.`,
        JSON.stringify({ script: actor, before: { price: row.price, price_original: row.price_original, price_original_currency: row.price_original_currency }, status_kept: row.status })
      ]
    );
  }
  log(`Set ${updated} listings to Price on application.`);
  return { applied: true, found: found.length, updated, rows: found.map(({ row }) => row.id) };
}

module.exports = { run, findImplausible, CANDIDATES_SQL };

if (require.main === module) {
  const db = require('../config/database');
  run(db, { apply: process.argv.includes('--apply'), json: process.argv.includes('--json') })
    .then(() => (db.pool ? db.pool.end() : undefined))
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
