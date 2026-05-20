#!/usr/bin/env node
'use strict';

require('dotenv').config();

const db = require('../config/database');
const {
  PROPERTY_SOURCE_REGISTRY_BATCH_ID,
  seedPropertySourceRegistry,
  summarizePropertySourceRegistry,
} = require('../services/propertySourceRegistryService');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const CONFIRM = args.has('--confirm');

async function main() {
  if (DRY_RUN) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      action: 'seed_property_source_registry',
      approval_target: 'King dashboard source database',
      batch_id: PROPERTY_SOURCE_REGISTRY_BATCH_ID,
      ...summarizePropertySourceRegistry(),
    }, null, 2));
    return;
  }

  if (!CONFIRM) {
    console.error('Refusing to write without --confirm. Use --dry-run first, then --confirm to seed the property source registry.');
    process.exit(2);
  }

  try {
    const result = await seedPropertySourceRegistry({ db });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await db.pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

