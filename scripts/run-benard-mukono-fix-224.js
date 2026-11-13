'use strict';

// Two listing fixes Arthur approved on 13 Nov 2026 (see
// db/migrations/224_benard_mukono_listing_fix.sql). Runs after the
// process is serving (scheduleStartupDataRepairs), in one short
// transaction with lock and statement timeouts. A lock wait fails the
// pass and leaves it for the next boot.
//
// Each row is matched by id AND inquiry_reference AND the state read on
// 13 Nov, so a later staff edit is never overwritten. The original
// columns are copied to benard_mukono_fix_224_backup first. Idempotent:
// a row already in the backup table is skipped (also after rollback).
// Nothing is deleted and nothing is sent to anyone.

const LOCK_TIMEOUT = '3s';
const STATEMENT_TIMEOUT = '30s';
const MARKER = 'benard_mukono_fix_224';
const NEW_TITLE = '6 acres with warehouse for sale in Mukono';
const AUTO_LEAD_RE = '^Commercial property in Transformer, Nakaseke, listed at UGX [0-9,]+\\.[[:space:]]*';

const MUKONO = Object.freeze({
  id: '000f79c1-ca94-44e8-a25c-994d93c7b0a2',
  ref: 'MK-20261111-9D6051',
  action: 'correct_to_mukono'
});
const DUPLICATE = Object.freeze({
  id: 'ce81a13b-4132-4243-8399-48e0a7a8f686',
  ref: 'MK-20261112-004179',
  action: 'take_down_duplicate'
});
const SPECS = Object.freeze([MUKONO, DUPLICATE]);

const MUKONO_NOTE = "Corrected per Arthur 13 Nov 2026 from Benard Gaita's WhatsApp correction of 12 Nov (\"Area is Mukono not nkaaseke\"): location Mukono (was Transformer, Nakaseke, read from \"Transformer Installed\"), bedrooms cleared (the 6 came from \"6 Acres\"), title and description fixed. Data fix 224.";
const DUPLICATE_NOTE = "Duplicate of MK-20261111-9D6051 (Benard Gaita's WhatsApp correction saved as a new listing). Taken down per Arthur 13 Nov 2026. Data fix 224.";
const DUPLICATE_REASON = 'Duplicate of MK-20261111-9D6051, taken down per Arthur';

const NOTE_STAMP_SQL = `'[' || to_char(clock_timestamp() AT TIME ZONE 'Africa/Kampala', 'FMDD Mon YYYY, HH24:MI') || ' EAT] makaug data fix: '`;
const APPEND_NOTE_SQL = (param) => `CASE WHEN NULLIF(btrim(COALESCE(moderation_notes, '')), '') IS NULL
  THEN ${NOTE_STAMP_SQL} || ${param}
  ELSE moderation_notes || E'\\n' || ${NOTE_STAMP_SQL} || ${param} END`;

const BACKUP_COLUMNS = ['title', 'description', 'area', 'district', 'address', 'latitude', 'longitude', 'bedrooms',
  'bathrooms', 'status', 'availability_status', 'moderation_stage', 'moderation_notes', 'extra_fields'];

// Expected state on 13 Nov 2026 (read-only production check).
const GUARD_SQL = {
  [MUKONO.action]: `status = 'approved' AND area = 'Transformer' AND district = 'Nakaseke'`,
  [DUPLICATE.action]: `status = 'approved' AND area = 'Transformer' AND district = 'Nakaseke'`
};

const UPDATE_SQL = {
  [MUKONO.action]: `
    UPDATE properties
       SET title = $2,
           description = regexp_replace(description, '${AUTO_LEAD_RE}', ''),
           area = 'Mukono',
           district = 'Mukono',
           bedrooms = NULL,
           moderation_notes = ${APPEND_NOTE_SQL('$3')},
           extra_fields = COALESCE(extra_fields, '{}'::jsonb)
             || jsonb_build_object(
               'city', 'Mukono',
               'neighborhood', 'Mukono',
               'region', 'Central',
               'canonical_location_id', 'mukono:mukono',
               'canonical_location_level', 'district',
               'canonical_location_match', 'staff_correction',
               'canonical_location_confidence', 1,
               'location_resolution_status', 'canonical_staff_edit',
               'resolved_location_label', 'Mukono, Central',
               'staff_location_confirmed', true,
               'staff_corrected_fields', (
                 SELECT jsonb_agg(DISTINCT v ORDER BY v)
                   FROM jsonb_array_elements_text(
                     CASE WHEN jsonb_typeof(extra_fields->'staff_corrected_fields') = 'array'
                       THEN extra_fields->'staff_corrected_fields' ELSE '[]'::jsonb END
                     || '["title","description"]'::jsonb) AS v),
               'staff_corrected_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
               'staff_corrected_by', 'data_fix_224',
               '${MARKER}', true)
     WHERE id = $1`,
  [DUPLICATE.action]: `
    UPDATE properties
       SET status = 'hidden',
           moderation_notes = ${APPEND_NOTE_SQL('$2')},
           extra_fields = (COALESCE(extra_fields, '{}'::jsonb) - 'agent_manager_previous_status')
             || jsonb_build_object(
               'agent_manager_previous_status', status,
               'agent_manager_last_action', 'take_down',
               'agent_manager_last_action_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
               'duplicate_of_reference', 'MK-20261111-9D6051',
               '${MARKER}', true)
     WHERE id = $1`
};

function isUganda() {
  return String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase() === 'UG';
}

async function ensureBackupTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS benard_mukono_fix_224_backup (
      property_id uuid PRIMARY KEY,
      inquiry_reference text NOT NULL,
      action text NOT NULL,
      before_row jsonb NOT NULL,
      before_updated_at timestamptz,
      applied_at timestamptz NOT NULL,
      rolled_back_at timestamptz
    )
  `);
}

async function applySpec(client, spec) {
  const row = (await client.query(
    `SELECT id, status, updated_at, ${BACKUP_COLUMNS.join(', ')},
            (${GUARD_SQL[spec.action]}) AS guard_ok,
            EXISTS (SELECT 1 FROM benard_mukono_fix_224_backup b WHERE b.property_id = p.id) AS already_done
       FROM properties p
      WHERE id = $1 AND inquiry_reference = $2
      FOR UPDATE`,
    [spec.id, spec.ref]
  )).rows[0];
  if (!row) return 'not_found';
  if (row.already_done) return 'already_done';
  if (!row.guard_ok) return 'state_changed_skipped';
  const before = Object.fromEntries(BACKUP_COLUMNS.map((column) => [column, row[column] === undefined ? null : row[column]]));
  await client.query(
    `INSERT INTO benard_mukono_fix_224_backup (property_id, inquiry_reference, action, before_row, before_updated_at, applied_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, clock_timestamp())
     ON CONFLICT (property_id) DO NOTHING`,
    [spec.id, spec.ref, spec.action, JSON.stringify(before), row.updated_at]
  );
  if (spec.action === MUKONO.action) {
    await client.query(UPDATE_SQL[spec.action], [spec.id, NEW_TITLE, MUKONO_NOTE]);
    await client.query(
      `INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, reason, notes)
       VALUES ($1, NULL, 'data_fix_224_corrected', $2, $2, $3, $4)`,
      [spec.id, row.status, 'Location Mukono, bedrooms cleared, title and description fixed', 'By data fix 224 (per Arthur, 13 Nov 2026)']
    );
  } else {
    await client.query(UPDATE_SQL[spec.action], [spec.id, DUPLICATE_NOTE]);
    // Same event shape as King → Agents → Manage → Take down, so the
    // Manage row shows the reason.
    await client.query(
      `INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, reason, notes)
       VALUES ($1, NULL, 'agent_manager_take_down', $2, 'hidden', $3, $4)`,
      [spec.id, row.status, DUPLICATE_REASON, 'By data fix 224 (per Arthur, 13 Nov 2026)']
    );
  }
  // applied_at = the updated_at the trigger wrote, so rollback can tell a
  // later staff edit from this fix.
  await client.query(
    `UPDATE benard_mukono_fix_224_backup b SET applied_at = p.updated_at
       FROM properties p WHERE p.id = b.property_id AND b.property_id = $1`,
    [spec.id]
  );
  return 'applied';
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

async function runBenardMukonoFix224(db, { logger = console } = {}) {
  if (!isUganda()) return { skipped: 'country_not_ug', updated: 0 };
  if (!db || typeof db.getClient !== 'function') return { skipped: 'no_db', updated: 0 };
  try {
    const results = typeof db.runBackgroundWork === 'function'
      ? await db.runBackgroundWork(() => applyOnce(db))
      : await applyOnce(db);
    const updated = Object.values(results).filter((value) => value === 'applied').length;
    if (updated) {
      try { require('../routes/properties').clearPublicPropertiesCache('data_fix_224'); } catch (_) { /* best effort */ }
      try { require('../services/publicSeoRenderService').clearSeoListingCache(); } catch (_) { /* best effort */ }
    }
    return { updated, results, stopped_early: false };
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn('Benard Mukono fix 224 failed; leaving it for the next boot', { code: error.code, message: error.message });
    }
    return { updated: 0, stopped_early: true, error: error.message || String(error) };
  }
}

module.exports = {
  AUTO_LEAD_RE,
  BACKUP_COLUMNS,
  DUPLICATE,
  MUKONO,
  NEW_TITLE,
  SPECS,
  UPDATE_SQL,
  runBenardMukonoFix224
};
