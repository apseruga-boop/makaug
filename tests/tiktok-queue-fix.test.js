'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { importExactSocialSourcePosts } = require('../services/socialPlatformPostDiscoveryService');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function persistenceDb({ existingRows = [] } = {}) {
  let inserted = 0;
  const client = {
    async query(sql, params = []) {
      const statement = String(sql || '').trim();
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(statement)) return { rows: [], rowCount: 0 };
      if (statement.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [{}], rowCount: 1 };
      if (statement.includes('FROM properties') && statement.includes("extra_fields->>'source_listing_key'")) {
        return { rows: existingRows, rowCount: existingRows.length };
      }
      if (statement.startsWith('WITH normalized AS')) return { rows: [], rowCount: 0 };
      if (statement.startsWith('INSERT INTO properties (')) {
        inserted += 1;
        return { rows: [{ id: `00000000-0000-4000-8000-${String(inserted).padStart(12, '0')}` }], rowCount: 1 };
      }
      if (statement.startsWith('INSERT INTO property_images')) return { rows: [], rowCount: 1 };
      if (statement.startsWith('UPDATE properties')) return { rows: [], rowCount: 1 };
      if (statement.startsWith('INSERT INTO property_moderation_events')) return { rows: [], rowCount: 1 };
      if (statement.includes('WHERE id = ANY($1::uuid[])')) {
        return { rows: (params[0] || []).map((id) => ({ id })), rowCount: (params[0] || []).length };
      }
      throw new Error(`Unexpected persistence query: ${statement.slice(0, 120)}`);
    },
    release() {}
  };
  return {
    async query(sql) {
      const statement = String(sql || '').trim();
      if (statement.startsWith('CREATE TABLE') || statement.startsWith('CREATE UNIQUE INDEX') || statement.startsWith('CREATE INDEX')) {
        return { rows: [], rowCount: 0 };
      }
      if (statement.includes('FROM suppressed_sources')) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected database query: ${statement.slice(0, 120)}`);
    },
    pool: { async connect() { return client; } }
  };
}

async function run() {
  const sourceUrl = 'https://www.tiktok.com/@wamalapropertyservices/video/7487217163334454533';
  const rawText = [
    sourceUrl,
    'title: House for sale in Bujuko, Wakiso',
    'location: Bujuko, Wakiso',
    'price: USh 85M',
    'posted: 2025-03-29',
    'phone: +256774120320'
  ].join('\n');
  const result = await importExactSocialSourcePosts({
    db: persistenceDb(),
    rawText,
    dryRun: false,
    fetchOembed: false,
    fetchPublicMetadata: false
  });

  assert.strictEqual(result.created_properties, 1, 'eligible exact TikTok row must be inserted');
  assert.strictEqual(result.created_review_queue_properties, 1, 'new row must enter Found Online review');
  assert.strictEqual(result.review_queue_properties, 1, 'review response must expose the persisted row');
  assert.strictEqual(result.persistence_verified, true, 'queue success must require an in-transaction persistence check');
  assert.strictEqual(result.persisted_property_count, 1);
  assert.strictEqual(result.persisted_property_ids.length, 1);
  assert.strictEqual(result.queued_listings[0].status, 'pending');

  const duplicatePreview = await importExactSocialSourcePosts({
    db: persistenceDb({
      existingRows: [{
        id: '3440e24d-ac43-43d6-a60a-e7b1b361678d',
        title: 'House for sale in Bujuko at 85M',
        status: 'pending',
        moderation_stage: 'source_review',
        inquiry_reference: 'MK-TIKTOK-BUJUKO',
        lister_name: 'Wamala Property Services',
        source_listing_key: '',
        source_post_url: sourceUrl,
        source_url: sourceUrl,
      }]
    }),
    rawText,
    dryRun: true,
    fetchOembed: false,
    fetchPublicMetadata: false
  });
  assert.strictEqual(duplicatePreview.eligible_to_queue_count, 1, 'duplicate rows remain eligible source posts');
  assert.strictEqual(duplicatePreview.existing_properties, 1, 'dry-run must execute the production duplicate lookup');
  assert.strictEqual(duplicatePreview.duplicate_warning_count, 1, 'dry-run must expose exact-link duplicate warnings');
  assert.strictEqual(duplicatePreview.would_create_properties, 0, 'dry-run must not predict a duplicate as a new row');
  assert.strictEqual(duplicatePreview.queued_listings.length, 0, 'duplicate rows must not be described as newly queueable');

  const app = read('assets/makaug-app.js');
  const adminRoutes = read('routes/admin.js');
  const staffRoutes = read('routes/staff.js');
  const service = read('services/socialSearchSourcedListingsService.js');
  const migration = read('db/migrations/089_tiktok_found_online_queue.sql');
  assert(app.includes('tiktok-queue-fix-20260719'), 'live bundle needs a queue-fix marker');
  assert(app.includes('tiktok-queue-visibility-20260719'), 'live bundle needs a queue-visibility marker');
  assert(app.includes('eligible (will enter review when queued)'), 'preview must not claim rows are already in review');
  assert(app.includes('View in Review → Found Online'), 'queue success must provide a direct review action');
  assert(app.includes('adminLoadFoundOnlineReviewQueue'), 'Found Online review must load lazily');
  assert(app.includes('queue=found_online') && app.includes('ADMIN_REVIEW_QUEUE_PAGE_SIZE = 24'), 'Found Online review must request one small page');
  assert(app.includes('posts: dryRun ? [] : cachedPreviewRows'), 'queue must reuse preview rows instead of repeating metadata fetches');
  assert(app.includes('fetch_oembed: dryRun') && app.includes('fetch_public_metadata: dryRun'), 'queue must keep external enrichment off the persistence request');
  assert(adminRoutes.includes("queueType === 'found_online'"), 'admin review API must support the Found Online queue filter');
  assert(adminRoutes.includes('adminFoundOnlineReviewQueueWhere'), 'Found Online review needs a dedicated non-suppressing queue predicate');
  assert(adminRoutes.includes('adminActionableReviewQueueWhere'), 'dashboard counts must include dedicated Found Online rows');
  assert(adminRoutes.includes('adminActionableReviewQueueCount'), 'dashboard counts need an indexed Found Online count fallback');
  assert(adminRoutes.includes("admin-actionable-review-count-v2-authoritative-status"), 'the actionable count must be cached and use the authoritative queue predicate');
  assert(adminRoutes.includes("router.get('/properties/:id', sendAdminPropertyReview)"), 'King needs a direct review endpoint for imported property IDs');
  assert(adminRoutes.includes('clearAdminReviewQueueCache();'), 'a successful queue write must invalidate stale Found Online pages');
  assert(adminRoutes.includes('079_commercial_transaction_subtype.sql'), 'admin queue route must surface missing migration errors');
  assert(staffRoutes.includes('079_commercial_transaction_subtype.sql'), 'staff queue route must surface missing migration errors');
  assert(service.includes('FOUND_ONLINE_PERSISTENCE_CHECK_FAILED'), 'service must fail rather than report an unverified queue success');
  assert(migration.includes('idx_properties_found_online_review_queue'), 'Found Online review needs a targeted pagination index');

  console.log('ok - TikTok queue persists eligible rows, reports proof, and lazy-loads Found Online review');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
