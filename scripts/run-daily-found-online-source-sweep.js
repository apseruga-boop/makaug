#!/usr/bin/env node
'use strict';

require('dotenv').config();

const db = require('../config/database');
const {
  PROPERTY_SOURCE_REGISTRY_BATCH_ID,
  PROPERTY_SOURCE_REGISTRY_TARGET_COUNT,
  seedPropertySourceRegistry,
  summarizePropertySourceRegistry,
} = require('../services/propertySourceRegistryService');
const {
  SOCIAL_SEARCH_BATCH_ID,
  seedSocialSearchAuthorisedListings,
  summarizeSocialSearchListings,
} = require('../services/socialSearchSourcedListingsService');

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const CONFIRM = args.has('--confirm');
const REPLACE_CANDIDATES = args.has('--replace-candidates');

function policy() {
  return {
    source_record_target: PROPERTY_SOURCE_REGISTRY_TARGET_COUNT,
    property_queue_target: 'evidence-based only; do not auto-create 15,000 property candidates from source feeds',
    source_window_days: 90,
    candidate_rule: 'Queue a King review property only when a specific public post/video/listing has source URL, location, price or guide price, contact path, and usable evidence-based images.',
    image_rule: 'Use labelled video stills or actual listing photos only. Do not duplicate the same still, invent room labels, or use random generic property imagery.',
    review_destination: 'King dashboard pending review',
  };
}

async function main() {
  const sourceSummary = summarizePropertySourceRegistry();
  const candidateSummary = summarizeSocialSearchListings();
  const baseReport = {
    ok: true,
    dry_run: DRY_RUN,
    action: 'daily_found_online_source_sweep',
    source_batch_id: PROPERTY_SOURCE_REGISTRY_BATCH_ID,
    listing_batch_id: SOCIAL_SEARCH_BATCH_ID,
    policy: policy(),
    source_registry: {
      count: sourceSummary.count,
      target_count: sourceSummary.target_count,
      by_platform: sourceSummary.by_platform,
      by_status: sourceSummary.by_status,
      direct_contact_sources: sourceSummary.direct_contact_sources,
    },
    listing_candidates: {
      planned_count: candidateSummary.count,
      seed_eligible_count: candidateSummary.seed_eligible_count,
      skipped_until_public_contact_count: candidateSummary.skipped_until_public_contact_count,
      by_type: candidateSummary.by_type,
      by_agent: candidateSummary.by_agent,
    },
  };

  if (DRY_RUN) {
    console.log(JSON.stringify(baseReport, null, 2));
    return;
  }

  if (!CONFIRM) {
    console.error('Refusing to write without --confirm. Run with --dry-run first, then --confirm for the morning King queue sweep.');
    process.exit(2);
  }

  try {
    const registryResult = await seedPropertySourceRegistry({ db });
    const listingResult = await seedSocialSearchAuthorisedListings({
      db,
      replace: REPLACE_CANDIDATES,
    });
    console.log(JSON.stringify({
      ...baseReport,
      dry_run: false,
      source_registry_seeded: {
        upserted_sources: registryResult.upserted_sources,
        by_platform: registryResult.by_platform,
        by_status: registryResult.by_status,
      },
      listing_queue_result: {
        replace: listingResult.replace,
        created_properties: listingResult.created_properties,
        existing_properties: listingResult.existing_properties,
        review_queue_properties: listingResult.review_queue_properties,
        queued_listings: listingResult.queued_listings,
        skipped_listings: listingResult.skipped_listings,
        agents: listingResult.agents,
      },
    }, null, 2));
  } finally {
    await db.pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
