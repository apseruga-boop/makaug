'use strict';

// Two moderation reversals Arthur asked for on 14 Nov 2026 (see
// db/migrations/225_reopen_003434_reject_49c4ba.sql). Runs after the
// process is serving (scheduleStartupDataRepairs), in one short
// transaction with lock and statement timeouts; a lock wait fails the pass
// and leaves it for the next boot.
//
// Rows are matched by id AND inquiry_reference AND the state read on
// 14 Nov, so a later staff decision is never overwritten. The original
// columns go to moderation_reversal_225_backup first. Idempotent: a row
// already in the backup table is skipped (also after rollback).
//
// Nothing is sent. Both listings are found-online, which the normal
// moderation flow never messages either
// (services/listingModerationService.js sendOwnerListingStatusNotifications
// returns found_online_listing_never_messaged); this runner does not call
// any notification code at all.

const { syncListingImageSummary } = require('../services/staffPropertyMediaService');

const LOCK_TIMEOUT = '3s';
const STATEMENT_TIMEOUT = '30s';
const MARKER = 'moderation_reversal_225';

const REOPEN = Object.freeze({
  id: 'a6662954-76ba-4d54-818c-3275aa80baff',
  ref: 'MK-20261112-003434',
  action: 'reopen_to_pending',
  rejectedAt: '2026-11-13T11:57:51.011755Z',
  // Removed 13 Nov 11:56:20, 11:56:27, 11:56:29 UK (staff_listing_photo_removed events).
  imageIds: Object.freeze([
    '9c5186c2-c677-44bb-bed3-7650898baeb7',
    'e6e0c6fb-553d-46c7-a139-c42e4d60993c',
    '04cd3547-5f1b-4c53-9363-fd9e89e4d5fe'
  ])
});
const REJECT = Object.freeze({
  id: 'b9cbe819-de60-48cc-be58-30ba6e3b5cd3',
  ref: 'MK-20261111-49C4BA',
  action: 'reject_no_specific_area',
  approvedAt: '2026-11-13T08:48:03.20965Z'
});
const SPECS = Object.freeze([REOPEN, REJECT]);

const REOPEN_NOTE = "Held: exact pin unconfirmed. Reopened per Arthur 14 Nov; the 13 Nov 'No contacts' reject was reversed.";
const REJECT_REASON = 'No specific area';
const REJECT_NOTE = 'Rejected per Arthur 14 Nov: no specific area beyond Uganda / Lake Victoria views.';
const NOT_SENT = Object.freeze({ sent: false, reason: 'found_online_listing_never_messaged' });

const NOTE_STAMP_SQL = `'[' || to_char(clock_timestamp() AT TIME ZONE 'Africa/Kampala', 'FMDD Mon YYYY, HH24:MI') || ' EAT] makaug data fix: '`;
const APPEND_NOTE_SQL = (param) => `CASE WHEN NULLIF(btrim(COALESCE(moderation_notes, '')), '') IS NULL
  THEN ${NOTE_STAMP_SQL} || ${param}
  ELSE moderation_notes || E'\\n' || ${NOTE_STAMP_SQL} || ${param} END`;

const BACKUP_COLUMNS = ['status', 'moderation_stage', 'moderation_reason', 'moderation_notes', 'rejected_at',
  'reviewed_at', 'approved_at', 'extra_fields'];

const GUARD_SQL = {
  [REOPEN.action]: `status = 'rejected' AND moderation_reason = 'No contacts' AND rejected_at = TIMESTAMPTZ '${REOPEN.rejectedAt}'`,
  [REJECT.action]: `status = 'approved' AND approved_at = TIMESTAMPTZ '${REJECT.approvedAt}' AND rejected_at IS NULL`
};

const UPDATE_SQL = {
  [REOPEN.action]: `
    UPDATE properties
       SET status = 'pending',
           moderation_stage = 'in_review',
           moderation_reason = NULL,
           rejected_at = NULL,
           moderation_notes = ${APPEND_NOTE_SQL('$2')},
           extra_fields = (CASE WHEN extra_fields->>'moderation_reason' = 'No contacts'
                             THEN extra_fields - 'moderation_reason' ELSE COALESCE(extra_fields, '{}'::jsonb) END)
             || jsonb_build_object('${MARKER}', true)
     WHERE id = $1`,
  [REJECT.action]: `
    UPDATE properties
       SET status = 'rejected',
           moderation_stage = 'rejected',
           moderation_reason = $2,
           rejected_at = NOW(),
           reviewed_at = NOW(),
           moderation_notes = ${APPEND_NOTE_SQL('$3')},
           extra_fields = COALESCE(extra_fields, '{}'::jsonb)
             || jsonb_build_object('moderation_reason', $2::text, '${MARKER}', true)
     WHERE id = $1`
};

function isUganda() {
  return String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase() === 'UG';
}

async function ensureBackupTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS moderation_reversal_225_backup (
      property_id uuid PRIMARY KEY,
      inquiry_reference text NOT NULL,
      action text NOT NULL,
      before_row jsonb NOT NULL,
      restored_image_ids uuid[] NOT NULL DEFAULT '{}',
      before_updated_at timestamptz,
      applied_at timestamptz NOT NULL,
      rolled_back_at timestamptz
    )
  `);
}

// Same as services/staffPropertyMediaService.js changeStaffPropertyImage
// with restore=true, for the three removed photos only: the kept
// property_images records go back, their entries leave staff_removed_images,
// and the listing's image summary is rewritten.
async function restoreRemovedPhotos(client, propertyId, imageIds, extra = {}) {
  const removed = Array.isArray(extra.staff_removed_images) ? extra.staff_removed_images : [];
  const wanted = new Set(imageIds);
  const entries = removed.filter((item) => wanted.has(item?.id));
  const restored = [];
  for (const entry of entries) {
    for (const image of Array.isArray(entry.images) ? entry.images : []) {
      if (!image?.id || !image?.url) continue;
      const inserted = await client.query(
        `INSERT INTO property_images (id, property_id, url, is_primary, sort_order, slot_key, room_label, created_at)
         VALUES ($1, $2, $3, false, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [image.id, propertyId, image.url, image.sort_order ?? null, image.slot_key || null, image.room_label || null, image.created_at || new Date().toISOString()]
      );
      if (inserted.rows.length) restored.push(image.id);
    }
  }
  if (!entries.length) return restored;
  const keep = removed.filter((item) => !wanted.has(item?.id));
  await client.query(
    `UPDATE properties
        SET extra_fields = COALESCE(extra_fields, '{}'::jsonb)
          || jsonb_build_object('staff_removed_images', $2::jsonb,
                                'staff_removed_image_urls', $3::jsonb,
                                'staff_media_edited_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
      WHERE id = $1`,
    [propertyId, JSON.stringify(keep), JSON.stringify([...new Set(keep.map((item) => item.url).filter(Boolean))])]
  );
  // Keep the current primary photo first; restored photos are never primary.
  const primary = (await client.query(
    `SELECT id FROM property_images WHERE property_id = $1 AND COALESCE(slot_key, '') NOT IN ('source_evidence_original', 'quarantined_source_evidence')
      ORDER BY is_primary DESC, sort_order ASC, created_at ASC, id ASC LIMIT 1`, [propertyId]
  )).rows[0];
  await client.query('UPDATE property_images SET is_primary = (id = $2::uuid) IS TRUE WHERE property_id = $1', [propertyId, primary?.id || null]);
  const summary = await syncListingImageSummary(client, propertyId);
  if (restored.length) {
    await client.query(
      `INSERT INTO property_moderation_events (property_id, actor_id, action, reason, notes, delivery)
       VALUES ($1, NULL, 'staff_listing_photo_restored', 'Staff restored listing photo', $2, $3::jsonb)`,
      [propertyId, 'By data fix 225 (per Arthur, 14 Nov 2026)', JSON.stringify({ image_ids: restored, public_image_count: summary.public_image_count })]
    );
  }
  return restored;
}

async function applySpec(client, spec) {
  const row = (await client.query(
    `SELECT id, updated_at, ${BACKUP_COLUMNS.join(', ')},
            (${GUARD_SQL[spec.action]}) AS guard_ok,
            EXISTS (SELECT 1 FROM moderation_reversal_225_backup b WHERE b.property_id = p.id) AS already_done
       FROM properties p
      WHERE id = $1 AND inquiry_reference = $2
      FOR UPDATE`,
    [spec.id, spec.ref]
  )).rows[0];
  if (!row) return { result: 'not_found' };
  if (row.already_done) return { result: 'already_done' };
  if (!row.guard_ok) return { result: 'state_changed_skipped' };
  const before = Object.fromEntries(BACKUP_COLUMNS.map((column) => [column, row[column] === undefined ? null : row[column]]));
  await client.query(
    `INSERT INTO moderation_reversal_225_backup (property_id, inquiry_reference, action, before_row, before_updated_at, applied_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, clock_timestamp())
     ON CONFLICT (property_id) DO NOTHING`,
    [spec.id, spec.ref, spec.action, JSON.stringify(before), row.updated_at]
  );
  const delivery = { email: { ...NOT_SENT }, whatsapp: { ...NOT_SENT }, data_fix: 225 };
  let restored = [];
  if (spec.action === REOPEN.action) {
    await client.query(UPDATE_SQL[spec.action], [spec.id, REOPEN_NOTE]);
    restored = await restoreRemovedPhotos(client, spec.id, REOPEN.imageIds, row.extra_fields || {});
    await client.query(
      `INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, checklist, reason, notes, delivery)
       VALUES ($1, NULL, 'listing_status_changed', $2, 'pending', '{}'::jsonb, $3, $4, $5::jsonb)`,
      [spec.id, row.status, "Reopened per Arthur 14 Nov; 13 Nov 'No contacts' reject reversed", REOPEN_NOTE, JSON.stringify(delivery)]
    );
  } else {
    await client.query(UPDATE_SQL[spec.action], [spec.id, REJECT_REASON, REJECT_NOTE]);
    // Same event as the normal reject (routes/properties.js status route).
    await client.query(
      `INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, checklist, reason, notes, delivery)
       VALUES ($1, NULL, 'listing_status_changed', $2, 'rejected', '{}'::jsonb, $3, $4, $5::jsonb)`,
      [spec.id, row.status, REJECT_REASON, REJECT_NOTE, JSON.stringify({ ...delivery, rejection_confirmed: true, rejection_ui_control: 'data_fix_225' })]
    );
  }
  await client.query(
    `UPDATE moderation_reversal_225_backup b
        SET applied_at = p.updated_at, restored_image_ids = $2::uuid[]
       FROM properties p WHERE p.id = b.property_id AND b.property_id = $1`,
    [spec.id, restored]
  );
  return { result: 'applied', restored_images: restored.length };
}

async function applyOnce(db) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
    await ensureBackupTable(client);
    const results = {};
    for (const spec of SPECS) results[spec.ref] = await applySpec(client, spec);
    await client.query('COMMIT');
    return results;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* throw below */ }
    throw error;
  } finally {
    client.release();
  }
}

async function runModerationReversal225(db, { logger = console } = {}) {
  if (!isUganda()) return { skipped: 'country_not_ug', updated: 0 };
  if (!db || typeof db.getClient !== 'function') return { skipped: 'no_db', updated: 0 };
  try {
    const results = typeof db.runBackgroundWork === 'function'
      ? await db.runBackgroundWork(() => applyOnce(db))
      : await applyOnce(db);
    const updated = Object.values(results).filter((value) => value.result === 'applied').length;
    if (updated) {
      try { require('../routes/properties').clearPublicPropertiesCache('data_fix_225'); } catch (_) { /* best effort */ }
      try { require('../services/publicSeoRenderService').clearSeoListingCache(); } catch (_) { /* best effort */ }
    }
    return { updated, results, stopped_early: false };
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn('Moderation reversal 225 failed; leaving it for the next boot', { code: error.code, message: error.message });
    }
    return { updated: 0, stopped_early: true, error: error.message || String(error) };
  }
}

module.exports = {
  BACKUP_COLUMNS,
  REJECT,
  REJECT_NOTE,
  REJECT_REASON,
  REOPEN,
  REOPEN_NOTE,
  SPECS,
  UPDATE_SQL,
  restoreRemovedPhotos,
  runModerationReversal225
};
