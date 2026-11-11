'use strict';

// Restore moderation_notes wiped by "Staff preview completed before
// approval" when a listing was approved from staff preview (4-11 Nov
// 2026). #739 stops the overwrite on new approvals. This runner puts
// the previous real staff note back, in batches of 20, each in its
// own short transaction, after the process is already serving (see
// scheduleStartupDataRepairs). A lock wait or a slow statement fails
// that batch and leaves the rest for the next boot.
//
// For each approval event in the window whose notes are exactly the
// boilerplate: if the current listing note starts with that
// boilerplate and then real staff text, only the prefix is stripped.
// Otherwise the most recent recoverable note from
// property_moderation_events or listing_notes before the approval is
// copied on. Import templates, system lines, and the default importer
// pin-confirmation sentence are not recoverable. Listings with
// nothing else to restore are skipped.
//
// A production read-only dry-run on 11 Nov 2026 found 11 listings to
// restore (4 strip_prefix, 7 restore_prior), 1 already ok, and 88
// with no recoverable note.
//
// Idempotent: a property already in moderation_notes_restore_220_backup
// is skipped, including rows that were later rolled back. Re-runs are
// safe. Nothing is deleted.

const BATCH_SIZE = 20;
const MAX_BATCHES = 40;
const LOCK_TIMEOUT = '3s';
const STATEMENT_TIMEOUT = '30s';
const INCIDENT_START = '2026-11-04 00:00:00+00';
const BOILERPLATE = 'Staff preview completed before approval';
const MARKER = 'moderation_notes_restore_220';

// A note is recoverable when it is non-empty, not an exact system
// line, and not an import template. Leading system lines (for example
// "Rejected from staff preview" above a HOLD note) are stripped before
// the note is written back. jsonb `?` tests must be wrapped in
// COALESCE; this query uses NOT EXISTS on the backup table instead.
const RECOVERABLE_NOTE_SQL = `
  NULLIF(btrim($N), '') IS NOT NULL
  AND lower(btrim(regexp_replace($N, '\\s+', ' ', 'g'))) NOT IN (
    'staff preview completed before approval',
    'identity verified and listing facts checked before approval',
    'staff approved after previewing listing facts',
    'listing facts were updated as part of the moderation status action.',
    'staff/admin confirmed location and overrode non-location checks for this found-online approval.',
    'bulk staff review approved found-online source; owner notification left manual.',
    'rejected from staff preview',
    'human override — verified manually',
    'human override - verified manually',
    'staff-sourced: owner checklist waived',
    'confirm the exact property pin and local amenities with the listing agent before approval.'
  )
  AND $N !~* '^(FOUND-ONLINE SOURCE POST IMPORT|SOCIAL SEARCH LISTING|CARNELIAN AUTHORISED LISTING|BAKAIMA AUTHORISED LISTING)\\.'
`;

function recoverableNoteSql(expr) {
  return RECOVERABLE_NOTE_SQL.replace(/\$N/g, expr);
}

const STRIP_LEADING_SYSTEM_SQL = (expr) => `
btrim(regexp_replace(
  btrim(${expr}),
  '^((Staff preview completed before approval|Identity verified and listing facts checked before approval|Staff approved after previewing listing facts|Listing facts were updated as part of the moderation status action\\.|Rejected from staff preview|human override[^\\n]*|staff-sourced:[^\\n]*)[[:space:]]+)+',
  '',
  'i'
))
`;

const MATCHING_SQL = `
WITH approvals AS (
  SELECT DISTINCT ON (e.property_id)
    e.property_id,
    e.created_at AS approval_at
  FROM property_moderation_events e
  WHERE e.action = 'listing_status_changed'
    AND e.status_to = 'approved'
    AND btrim(COALESCE(e.notes, '')) = '${BOILERPLATE}'
    AND e.created_at >= TIMESTAMPTZ '${INCIDENT_START}'
  ORDER BY e.property_id, e.created_at DESC
),
priors AS (
  SELECT DISTINCT ON (a.property_id)
    a.property_id,
    h.note AS prior_note
  FROM approvals a
  JOIN (
    SELECT e.property_id, e.notes AS note, e.created_at
    FROM property_moderation_events e
    WHERE NULLIF(btrim(e.notes), '') IS NOT NULL
    UNION ALL
    SELECT ln.listing_id AS property_id, ln.note, ln.created_at
    FROM listing_notes ln
    WHERE NULLIF(btrim(ln.note), '') IS NOT NULL
  ) h ON h.property_id = a.property_id
     AND h.created_at < a.approval_at
  WHERE ${recoverableNoteSql('h.note')}
  ORDER BY a.property_id, h.created_at DESC
)
SELECT
  s.id,
  s.inquiry_reference,
  s.before_notes,
  s.before_updated_at,
  s.restored_notes,
  s.restore_mode,
  s.approval_at
FROM (
  SELECT
    p.id,
    p.inquiry_reference,
    p.moderation_notes AS before_notes,
    p.updated_at AS before_updated_at,
    a.approval_at,
    btrim(regexp_replace(
      btrim(COALESCE(p.moderation_notes, '')),
      '^Staff preview completed before approval[[:space:]]*',
      '',
      'i'
    )) AS remainder,
    ${STRIP_LEADING_SYSTEM_SQL('pri.prior_note')} AS cleaned_prior
  FROM approvals a
  JOIN properties p ON p.id = a.property_id
  LEFT JOIN priors pri ON pri.property_id = a.property_id
  WHERE COALESCE(p.status, '') <> 'deleted'
    AND NOT EXISTS (
      SELECT 1 FROM moderation_notes_restore_220_backup b WHERE b.property_id = p.id
    )
) raw
CROSS JOIN LATERAL (
  SELECT
    CASE
      WHEN ${recoverableNoteSql('raw.remainder')} THEN
        COALESCE(NULLIF(${STRIP_LEADING_SYSTEM_SQL('raw.remainder')}, ''), raw.remainder)
      WHEN NULLIF(raw.cleaned_prior, '') IS NOT NULL THEN raw.cleaned_prior
      ELSE NULL
    END AS restored_notes,
    CASE
      WHEN ${recoverableNoteSql('raw.remainder')} THEN 'strip_prefix'
      WHEN NULLIF(raw.cleaned_prior, '') IS NOT NULL THEN 'restore_prior'
      ELSE 'skip_no_recoverable_note'
    END AS restore_mode
) plan
CROSS JOIN LATERAL (
  SELECT
    raw.id,
    raw.inquiry_reference,
    raw.before_notes,
    raw.before_updated_at,
    raw.approval_at,
    plan.restored_notes,
    plan.restore_mode
) s
WHERE s.restore_mode IN ('strip_prefix', 'restore_prior')
  AND s.restored_notes IS DISTINCT FROM s.before_notes
ORDER BY s.id
LIMIT $1
`;

function isUganda() {
  return String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase() === 'UG';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureBackupTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS moderation_notes_restore_220_backup (
      property_id uuid PRIMARY KEY,
      inquiry_reference text,
      before_notes text,
      before_updated_at timestamptz,
      restored_notes text NOT NULL,
      restore_mode text NOT NULL,
      approval_at timestamptz,
      applied_at timestamptz NOT NULL,
      rolled_back_at timestamptz
    )
  `);
}

async function applyBatch(db, batchSize) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
    await ensureBackupTable(client);

    const found = await client.query(MATCHING_SQL, [batchSize]);
    if (!found.rows.length) {
      await client.query('COMMIT');
      return { updated: 0, strip_prefix: 0, restore_prior: 0 };
    }

    const ids = found.rows.map((row) => row.id);
    await client.query(
      `INSERT INTO moderation_notes_restore_220_backup (
         property_id, inquiry_reference, before_notes, before_updated_at,
         restored_notes, restore_mode, approval_at, applied_at
       )
       SELECT id, inquiry_reference, before_notes, before_updated_at,
              restored_notes, restore_mode, approval_at, clock_timestamp()
       FROM jsonb_to_recordset($1::jsonb) AS t(
         id uuid,
         inquiry_reference text,
         before_notes text,
         before_updated_at timestamptz,
         restored_notes text,
         restore_mode text,
         approval_at timestamptz
       )
       ON CONFLICT (property_id) DO NOTHING`,
      [JSON.stringify(found.rows.map((row) => ({
        id: row.id,
        inquiry_reference: row.inquiry_reference,
        before_notes: row.before_notes,
        before_updated_at: row.before_updated_at,
        restored_notes: row.restored_notes,
        restore_mode: row.restore_mode,
        approval_at: row.approval_at
      })))]
    );

    await client.query(
      `UPDATE properties p
       SET moderation_notes = t.restored_notes,
           extra_fields = COALESCE(p.extra_fields, '{}'::jsonb)
             || jsonb_build_object('${MARKER}', true)
       FROM jsonb_to_recordset($1::jsonb) AS t(
         id uuid,
         restored_notes text
       )
       WHERE p.id = t.id`,
      [JSON.stringify(found.rows.map((row) => ({
        id: row.id,
        restored_notes: row.restored_notes
      })))]
    );

    // Sync applied_at to the timestamp the update trigger wrote, so rollback
    // can tell a later staff edit from this repair without disabling the
    // trigger (ALTER TABLE ... DISABLE TRIGGER needs ACCESS EXCLUSIVE).
    await client.query(
      `UPDATE moderation_notes_restore_220_backup b
       SET applied_at = p.updated_at
       FROM properties p
       WHERE p.id = b.property_id
         AND b.property_id = ANY($1::uuid[])
         AND b.rolled_back_at IS NULL`,
      [ids]
    );

    await client.query('COMMIT');
    return {
      updated: found.rows.length,
      strip_prefix: found.rows.filter((row) => row.restore_mode === 'strip_prefix').length,
      restore_prior: found.rows.filter((row) => row.restore_mode === 'restore_prior').length
    };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* still throw below */ }
    throw error;
  } finally {
    client.release();
  }
}

async function runInner(db, { batchSize = BATCH_SIZE, maxBatches = MAX_BATCHES, logger = console } = {}) {
  if (!isUganda()) {
    return { skipped: 'country_not_ug', updated: 0, remaining: 0 };
  }
  if (!db || typeof db.getClient !== 'function') {
    return { skipped: 'no_db', updated: 0, remaining: 0 };
  }

  let updated = 0;
  let stripPrefix = 0;
  let restorePrior = 0;
  let batches = 0;
  let stoppedEarly = false;
  let errorMessage = null;

  for (let round = 0; round < maxBatches; round += 1) {
    try {
      const result = typeof db.runBackgroundWork === 'function'
        ? await db.runBackgroundWork(() => applyBatch(db, batchSize))
        : await applyBatch(db, batchSize);
      batches += 1;
      updated += result.updated;
      stripPrefix += result.strip_prefix;
      restorePrior += result.restore_prior;
      if (!result.updated) break;
    } catch (error) {
      stoppedEarly = true;
      errorMessage = error.message || String(error);
      if (logger && typeof logger.warn === 'function') {
        logger.warn('Moderation notes restore 220 batch failed; leaving the rest for the next boot', {
          code: error.code,
          message: errorMessage,
          updated_so_far: updated
        });
      }
      break;
    }
    if (round < maxBatches - 1) await sleep(50);
  }

  return {
    updated,
    strip_prefix: stripPrefix,
    restore_prior: restorePrior,
    batches,
    remaining: stoppedEarly ? 'unknown' : 0,
    stopped_early: stoppedEarly,
    error: errorMessage
  };
}

async function runModerationNotesRestore220(db, options = {}) {
  return runInner(db, options);
}

module.exports = {
  BATCH_SIZE,
  LOCK_TIMEOUT,
  MATCHING_SQL,
  MAX_BATCHES,
  STATEMENT_TIMEOUT,
  runModerationNotesRestore220
};
