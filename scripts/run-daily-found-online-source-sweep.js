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
  DAILY_FOUND_ONLINE_PROPERTY_TARGET,
  FOUND_ONLINE_LAUNCH_INTAKE_POLICY,
  LAUNCH_SOURCE_POST_WINDOW_START,
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
    daily_property_queue_minimum: DAILY_FOUND_ONLINE_PROPERTY_TARGET,
    property_queue_target: `scan all source pages/feeds, then queue every eligible specific property post from 1 January 2022 onward; do not auto-create ${PROPERTY_SOURCE_REGISTRY_TARGET_COUNT} properties from source pages alone`,
    source_window_days: 120,
    target_source_year: 2022,
    source_post_window_start: LAUNCH_SOURCE_POST_WINDOW_START,
    candidate_rule: FOUND_ONLINE_LAUNCH_INTAKE_POLICY.queue_rule,
    image_rule: FOUND_ONLINE_LAUNCH_INTAKE_POLICY.image_rule,
    facebook_image_rule: FOUND_ONLINE_LAUNCH_INTAKE_POLICY.facebook_image_rule,
    hard_queue_rule: 'If the intake count is below the 200/day minimum, report the gap and the missing evidence instead of padding with fabricated properties.',
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
    daily_target_status: candidateSummary.daily_target_status,
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
        daily_target_status: listingResult.daily_target_status,
        queued_listings: listingResult.queued_listings,
        already_live_or_approved_properties: listingResult.already_live_or_approved_properties,
        source_review_records: listingResult.source_review_records,
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
