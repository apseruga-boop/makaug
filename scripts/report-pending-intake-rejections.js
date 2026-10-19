#!/usr/bin/env node
'use strict';

/**
 * Read-only list of pending rows the current YouTube intake rules would reject:
 * a foreign city, country, channel, or currency, or a non-listing explainer.
 *
 * This script only SELECTs those rows and classifies them in process.
 * Do not point it at production unless you only want to read.
 */

const { foreignSourceMarketStatus } = require('../utils/sourceIntakeIntegrity');
const { notAListingClassification } = require('../utils/sourceContentQuality');

const PENDING_SQL = `
  SELECT id::text,
         inquiry_reference,
         status,
         title,
         LEFT(COALESCE(description, ''), 2000) AS description,
         source,
         listed_via,
         lister_name,
         lister_phone,
         price,
         area,
         district,
         COALESCE(extra_fields->>'source_name', '') AS source_name,
         COALESCE(extra_fields->>'youtube_channel_title', '') AS youtube_channel_title,
         LEFT(COALESCE(extra_fields->>'source_title', ''), 500) AS source_title,
         LEFT(COALESCE(extra_fields->>'source_text', ''), 2000) AS source_text
    FROM properties
   WHERE LOWER(COALESCE(status, '')) IN (
     'pending', 'pending_review', 'submitted', 'in_review', 'under_review',
     'needs_review', 'awaiting_review', 'queued', 'source_review',
     'source_review_required', 'pending_king_source_review', 'king_review',
     'draft', 'resubmitted'
   )
   ORDER BY created_at DESC
   LIMIT 1000`;

function assertReadOnly(sql) {
  if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b/i.test(sql)) {
    throw new Error('Report query is not read-only.');
  }
}

function rejectionForPendingRow(row = {}) {
  const record = {
    title: row.title,
    description: row.description,
    source_name: row.source_name || row.lister_name,
    lister_name: row.lister_name,
    lister_phone: row.lister_phone,
    price: row.price,
    area: row.area,
    district: row.district,
    extra_fields: {
      source_name: row.source_name,
      youtube_channel_title: row.youtube_channel_title,
      source_title: row.source_title,
      source_text: row.source_text,
    },
  };
  const notListing = notAListingClassification(record);
  if (notListing.not_a_listing) {
    return {
      reason: notListing.reason,
      matched: notListing.matched,
    };
  }
  const foreignText = [
    row.title,
    row.description,
    row.source_name,
    row.youtube_channel_title,
    row.lister_name,
    row.source_title,
    row.source_text,
    row.area,
    row.district,
  ].filter(Boolean).join(' ');
  const foreign = foreignSourceMarketStatus(foreignText);
  if (!foreign.allowed) {
    return {
      reason: foreign.reason || 'foreign_market',
      matched: foreign.matched || '',
    };
  }
  return null;
}

async function main() {
  assertReadOnly(PENDING_SQL);
  const databaseUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || '';
  if (!databaseUrl) {
    console.log(JSON.stringify({
      executed: false,
      read_only: true,
      reason: 'DATABASE_URL is not set, so the report was not run.',
      checks: ['pending_rows_now_rejected'],
    }, null, 2));
    return;
  }
  const db = require('../config/database');
  const result = await db.query(PENDING_SQL);
  const rows = result.rows.map((row) => {
    const rejection = rejectionForPendingRow(row);
    if (!rejection) return null;
    return {
      id: row.id,
      inquiry_reference: row.inquiry_reference,
      status: row.status,
      title: row.title,
      source_name: row.source_name,
      price: row.price,
      reason: rejection.reason,
      matched: rejection.matched,
    };
  }).filter(Boolean);
  console.log(JSON.stringify({
    executed: true,
    read_only: true,
    scanned: result.rows.length,
    checks: {
      pending_rows_now_rejected: { count: rows.length, rows },
    },
  }, null, 2));
  if (db.pool?.end) await db.pool.end();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = { PENDING_SQL, assertReadOnly, rejectionForPendingRow };
