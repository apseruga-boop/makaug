'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  foundOnlineRowHasStaffEdits,
  isImporterTemplateModerationNotes,
  normalizeFoundOnlineSourcePost,
  reprocessExistingFoundOnlineSourcePostListings,
} = require('../services/socialSearchSourcedListingsService');

const SOURCE_URL = 'https://www.youtube.com/watch?v=sYZoct4o-Qo';
const STAFF_NOTE = 'Held: source explicitly says Wakiso Kaliti, not merely Wakiso district/town.';
const TEMPLATE_NOTES = 'FOUND-ONLINE SOURCE POST IMPORT. Public source inventory from Kings property Consultants and construction. Source post: https://www.youtube.com/watch?v=sYZoct4o-Qo. Confirm source date, location, availability, category, contact route, and price or Price upon application before approval. Harvesting is review-only and cannot publish this listing. Original-poster comments are optional supporting evidence. Batch: found_online_source_post_import.';

function enrichmentPost() {
  return {
    source_url: SOURCE_URL,
    source_post_url: SOURCE_URL,
    youtube_url: SOURCE_URL,
    source_platform: 'youtube',
    youtubeId: 'sYZoct4o-Qo',
    key: 'sYZoct4o-Qo',
    title: '25m 2 bedroom house on sale in Wakiso Kaliti. 50ft by 100ft',
    caption: '2 bedroom house on sale in Wakiso Kaliti, Uganda. 50ft by 100ft for UGX 25,000,000. Contact the public YouTube channel.',
    description: '2 bedroom house on sale in Wakiso Kaliti, Uganda. 50ft by 100ft for UGX 25,000,000.',
    area: 'Wakiso',
    district: 'Wakiso',
    price: 25000000,
    listing_type: 'sale',
    source_published_at: '2026-11-10T16:42:09.000Z',
    first_posted_at: '2026-11-10T16:42:09.000Z',
  };
}

test('importer template notes are recognised, and staff hold notes are not', () => {
  assert.equal(isImporterTemplateModerationNotes(TEMPLATE_NOTES), true);
  assert.equal(isImporterTemplateModerationNotes(STAFF_NOTE), false);
  assert.equal(isImporterTemplateModerationNotes(`${TEMPLATE_NOTES} This hold note was saved and verified earlier today but disappeared after source re-import; restoring it.`), false);
  assert.equal(foundOnlineRowHasStaffEdits({
    status: 'pending',
    moderation_notes: TEMPLATE_NOTES,
    extra_fields: { staff_review_notes: ['Confirm the exact property pin and local amenities with the listing agent before approval.'] },
  }), false);
  assert.equal(foundOnlineRowHasStaffEdits({
    status: 'pending',
    moderation_notes: STAFF_NOTE,
    extra_fields: {},
  }), true);
  assert.equal(foundOnlineRowHasStaffEdits({
    status: 'pending',
    moderation_notes: TEMPLATE_NOTES,
    extra_fields: { staff_corrected_fields: ['title', 'description'] },
  }), true);
  assert.equal(foundOnlineRowHasStaffEdits({
    status: 'pending',
    moderation_notes: TEMPLATE_NOTES,
    has_staff_event: true,
    extra_fields: {},
  }), true);
});

function fakeDb(existingRow, { capture }) {
  const client = {
    query: async (sql, params) => {
      const text = String(sql);
      capture.push({ sql: text, params });
      if (/^BEGIN\b/i.test(text) || /^COMMIT\b/i.test(text) || /^ROLLBACK\b/i.test(text)) {
        return { rows: [] };
      }
      if (/FROM properties/i.test(text) && /source_listing_key/i.test(text)) {
        return { rows: existingRow ? [existingRow] : [] };
      }
      if (/^UPDATE properties/i.test(text)) {
        return {
          rows: [{
            id: existingRow.id,
            title: existingRow.title,
            status: existingRow.status,
            moderation_stage: existingRow.moderation_stage,
          }],
        };
      }
      if (/INSERT INTO property_moderation_events/i.test(text)) {
        return { rows: [] };
      }
      return { rows: [] };
    },
    release() {},
  };
  return {
    pool: {
      connect: async () => client,
    },
  };
}

test('the 05:30 re-enrichment keeps a staff hold note and does not rewrite title or notes', async () => {
  const post = enrichmentPost();
  const normalized = normalizeFoundOnlineSourcePost(post);
  assert.ok(normalized, 'the 05:30 source post should normalise');

  const existingRow = {
    id: '985aed28-45ff-45d4-acd3-06ec80f4cae3',
    title: '25m 2 bedroom house on sale in Wakiso Kaliti. 50ft by 100ft',
    status: 'pending',
    moderation_stage: 'in_review',
    inquiry_reference: 'MK-20261110-E2EF09',
    lister_name: 'Kings property Consultants and construction',
    agent_id: null,
    extra_fields: {
      source_listing_key: 'sYZoct4o-Qo',
      source_url: SOURCE_URL,
      source_post_url: SOURCE_URL,
      youtube_url: SOURCE_URL,
      youtube_video_id: 'sYZoct4o-Qo',
      staff_corrected_fields: ['title', 'description', 'listing_type'],
      staff_review_notes: [STAFF_NOTE],
      staff_corrected_at: '2026-11-11T05:25:24.000Z',
    },
    source_listing_key: 'sYZoct4o-Qo',
    source_post_url: SOURCE_URL,
    source_url: SOURCE_URL,
    moderation_notes: STAFF_NOTE,
    moderation_reason: 'Pending King review of public found-online source, exact pin, latest availability, price, and image/source evidence. Data integrity review required: missing_specific_canonical_location.',
    reviewed_by: 'c8fe5694-da7f-4ae6-bbd2-1017a9624abc',
    approved_by: null,
    has_staff_event: true,
  };

  const capture = [];
  const result = await reprocessExistingFoundOnlineSourcePostListings({
    db: fakeDb(existingRow, { capture }),
    posts: [post],
    dryRun: false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.updated_properties, 1);
  assert.equal(result.review_queue_listings[0].staff_edits_preserved, true);

  const updates = capture.filter((item) => /^UPDATE properties/i.test(item.sql));
  assert.equal(updates.length, 1, 'staff-edited rows should get one merge update, not a full rewrite');
  assert.match(updates[0].sql, /extra_fields = COALESCE/);
  assert.doesNotMatch(updates[0].sql, /moderation_notes = /);
  assert.doesNotMatch(updates[0].sql, /SET listing_type = /);
  assert.doesNotMatch(updates[0].sql, /\btitle = /);

  const extra = JSON.parse(updates[0].params[1]);
  assert.equal(extra.staff_edits_preserved, true);
  assert.deepEqual(extra.staff_corrected_fields, ['title', 'description', 'listing_type']);
  assert.deepEqual(extra.staff_review_notes, [STAFF_NOTE]);
  assert.ok(extra.import_batch_text, 'import batch text stays in extra_fields, not in notes');
  assert.ok(extra.import_batch_text.startsWith('FOUND-ONLINE SOURCE POST IMPORT') || extra.import_batch_id);
});

test('an untouched pending row can still be fully re-enriched', async () => {
  const post = enrichmentPost();
  const existingRow = {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    title: 'Old imported title',
    status: 'pending',
    moderation_stage: 'pending',
    inquiry_reference: 'MK-20261110-AAAAAA',
    lister_name: 'Source',
    agent_id: null,
    extra_fields: {
      source_listing_key: 'sYZoct4o-Qo',
      source_url: SOURCE_URL,
      source_post_url: SOURCE_URL,
      youtube_url: SOURCE_URL,
      youtube_video_id: 'sYZoct4o-Qo',
      staff_review_notes: ['Confirm the exact property pin and local amenities with the listing agent before approval.'],
    },
    source_listing_key: 'sYZoct4o-Qo',
    source_post_url: SOURCE_URL,
    source_url: SOURCE_URL,
    moderation_notes: TEMPLATE_NOTES,
    moderation_reason: 'Pending King review of public found-online source, exact pin, latest availability, price, and image/source evidence.',
    reviewed_by: null,
    approved_by: null,
    has_staff_event: false,
  };

  const capture = [];
  const result = await reprocessExistingFoundOnlineSourcePostListings({
    db: fakeDb(existingRow, { capture }),
    posts: [post],
    dryRun: false,
  });

  assert.equal(result.ok, true);
  const updates = capture.filter((item) => /^UPDATE properties/i.test(item.sql));
  assert.equal(updates.length, 1);
  // If the post is intake-eligible this is a full rewrite; if not, it is the
  // narrower merge. Either way an untouched row must not be flagged as
  // staff-preserved.
  assert.equal(result.review_queue_listings[0].staff_edits_preserved, undefined);
  if (/moderation_notes = /.test(updates[0].sql)) {
    const notes = updates[0].params.find((value) => typeof value === 'string' && value.includes('FOUND-ONLINE SOURCE POST IMPORT'));
    assert.ok(notes, 'untouched pending rows may still receive the import notes');
  }
});
