#!/usr/bin/env node
'use strict';

require('dotenv').config();

const db = require('../config/database');
const {
  SOCIAL_SEARCH_BATCH_ID,
  seedSocialSearchAuthorisedListings,
  summarizeSocialSearchListings,
} = require('../services/socialSearchSourcedListingsService');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const CONFIRM = args.has('--confirm');
const NO_REPLACE = args.has('--no-replace');

async function main() {
  if (DRY_RUN) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      action: 'seed_social_search_authorised_listings',
      approval_target: 'King dashboard pending review',
      batch_id: SOCIAL_SEARCH_BATCH_ID,
      ...summarizeSocialSearchListings(),
    }, null, 2));
    return;
  }

  if (!CONFIRM) {
    console.error('Refusing to write without --confirm. Use --dry-run first, then --confirm to seed social-search pending listings.');
    process.exit(2);
  }

  try {
    const result = await seedSocialSearchAuthorisedListings({
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
