#!/usr/bin/env node
'use strict';

require('dotenv').config();

const db = require('../config/database');
const {
  CARNELIAN_BATCH_ID,
  seedCarnelianAuthorisedListings,
  summarizeCarnelianListings,
} = require('../services/carnelianSourcedListingsService');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const CONFIRM = args.has('--confirm');
const NO_REPLACE = args.has('--no-replace');

async function main() {
  if (DRY_RUN) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      action: 'seed_carnelian_authorised_youtube_listings',
      approval_target: 'King dashboard pending review',
      batch_id: CARNELIAN_BATCH_ID,
      ...summarizeCarnelianListings(),
    }, null, 2));
    return;
  }

  if (!CONFIRM) {
    console.error('Refusing to write without --confirm. Use --dry-run first, then --confirm to seed Carnelian pending listings.');
    process.exit(2);
  }

  try {
    const result = await seedCarnelianAuthorisedListings({
      db,
      replace: !NO_REPLACE,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await db.pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
