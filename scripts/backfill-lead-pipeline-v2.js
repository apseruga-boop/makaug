#!/usr/bin/env node
'use strict';

/**
 * After migration 137: fill contacts.phone_key for existing contacts in small
 * batches, so returning enquirers match their existing contact record.
 * Safe to run more than once; each batch is its own short transaction.
 *
 *   DATABASE_URL=... node scripts/backfill-lead-pipeline-v2.js
 */

require('dotenv').config();
const db = require('../config/database');

const BATCH = Math.max(100, Number(process.env.BACKFILL_BATCH || 2000));

async function main() {
  let total = 0;
  for (;;) {
    const result = await db.query(
      `WITH batch AS (
         SELECT id FROM contacts
          WHERE phone_key IS NULL
            AND LENGTH(REGEXP_REPLACE(COALESCE(NULLIF(whatsapp, ''), phone, ''), '\\D', '', 'g')) >= 9
          LIMIT $1
       )
       UPDATE contacts c
          SET phone_key = RIGHT(REGEXP_REPLACE(COALESCE(NULLIF(c.whatsapp, ''), c.phone), '\\D', '', 'g'), 9)
         FROM batch
        WHERE c.id = batch.id
       RETURNING c.id`,
      [BATCH]
    );
    total += result.rowCount;
    console.log(`contacts.phone_key: +${result.rowCount} (total ${total})`);
    if (result.rowCount < BATCH) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log('Backfill complete.');
}

main()
  .catch((error) => {
    console.error('Backfill failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
