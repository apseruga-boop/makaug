'use strict';

// Batched restore that migration 211 could not finish at startup.
//
// 211 scanned every property, disabled a trigger (ACCESS EXCLUSIVE on
// `properties`), and updated every match in one transaction with a 120s
// cap. That timed out on 10 Nov 2026 and took makaug.com down from
// 08:49 to 09:11 UK. This runner does the same row repairs, in batches
// of 20, each in its own short transaction, after the process is already
// serving (see scheduleStartupDataRepairs). A lock wait or a slow
// statement fails that batch and leaves the rest for the next boot.
//
// Example that must move: MK-20261109-9F68D2, stored as student
// accommodation titled "Student accommodation in Uganda", is a plot sale
// whose source title is "50x100Fts Plots for sale in Bugema Gayaza for
// 40Million".
//
// Idempotent: a property already in plot_title_restore_216_backup is
// skipped, including rows that were later rolled back. Re-runs are safe.
// Nothing is deleted.

const BATCH_SIZE = 20;
const MAX_BATCHES = 40;
const LOCK_TIMEOUT = '3s';
const STATEMENT_TIMEOUT = '30s';

const MATCHING_SQL = `
SELECT
  s.id,
  s.inquiry_reference,
  s.before_row,
  s.restore_category,
  s.restore_title,
  s.source_title
FROM (
  SELECT
    p.id,
    p.inquiry_reference,
    to_jsonb(p) AS before_row,
    (
      p.listing_type IN ('student', 'students')
      AND evidence.own ~ '(plots?|acres?|decimals?)[[:space:]]+for[[:space:]]+sale|land[[:space:]]+(for|on)[[:space:]]+sale|for[[:space:]]+sale[^.]{0,20}plots?|[0-9]+[[:space:]]*[x×][[:space:]]*[0-9]+[[:space:]]*fts?'
      AND evidence.own !~ 'student[[:space:]]+(accommodation|hostel|room)|hostel[[:space:]]+(room|bed|space)|per[[:space:]]+semester'
      AND NOT (
        jsonb_typeof(COALESCE(p.extra_fields->'staff_corrected_fields', '[]'::jsonb)) = 'array'
        AND p.extra_fields->'staff_corrected_fields' ? 'listing_type'
      )
    ) AS restore_category,
    (
      evidence.generated_title
      AND char_length(evidence.source_title) >= 8
      AND lower(evidence.source_title) <> lower(btrim(p.title))
      AND NOT (
        jsonb_typeof(COALESCE(p.extra_fields->'staff_corrected_fields', '[]'::jsonb)) = 'array'
        AND p.extra_fields->'staff_corrected_fields' ? 'title'
      )
    ) AS restore_title,
    evidence.source_title
  FROM properties p
  CROSS JOIN LATERAL (
    SELECT
      lower(concat_ws(' ',
        CASE
          WHEN p.title ~* '^(student accommodation( in | - )|land( for (sale|rent))? in |plots? for (sale|rent) in |property for (sale|rent) in |commercial property( for (sale|rent))? in |[0-9]+-bed )'
            OR p.title ~* '\\((TikTok|YouTube|Instagram|Facebook) [0-9]{4}\\)$'
            THEN ''
          ELSE p.title
        END,
        COALESCE(p.extra_fields->>'youtube_source_title', ''),
        COALESCE(p.extra_fields->>'source_title', '')
      )) AS own,
      (
        p.title ~* '^(student accommodation( in | - )|land( for (sale|rent))? in |plots? for (sale|rent) in |property for (sale|rent) in |commercial property( for (sale|rent))? in |[0-9]+-bed )'
        OR p.title ~* '\\((TikTok|YouTube|Instagram|Facebook) [0-9]{4}\\)$'
      ) AS generated_title,
      btrim(regexp_replace(regexp_replace(regexp_replace(
        COALESCE(NULLIF(btrim(p.extra_fields->>'youtube_source_title'), ''), NULLIF(btrim(p.extra_fields->>'source_title'), '')),
        'https?://\\S+', ' ', 'gi'),
        '#[A-Za-z0-9_]+', ' ', 'g'),
        '\\s+', ' ', 'g')) AS source_title
  ) evidence
  WHERE COALESCE(p.status, '') <> 'deleted'
    AND NOT EXISTS (
      SELECT 1 FROM plot_title_restore_216_backup b WHERE b.property_id = p.id
    )
    AND (
      p.listing_type IN ('student', 'students')
      OR p.title ~* '^(student accommodation( in | - )|land( for (sale|rent))? in |plots? for (sale|rent) in |property for (sale|rent) in |commercial property( for (sale|rent))? in |[0-9]+-bed )'
      OR p.title ~* '\\((TikTok|YouTube|Instagram|Facebook) [0-9]{4}\\)$'
    )
) s
WHERE s.restore_category OR s.restore_title
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
    CREATE TABLE IF NOT EXISTS plot_title_restore_216_backup (
      property_id uuid PRIMARY KEY,
      inquiry_reference text,
      before_row jsonb NOT NULL,
      restored_category boolean NOT NULL,
      restored_title boolean NOT NULL,
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
      return { updated: 0, category: 0, titles: 0 };
    }

    const ids = found.rows.map((row) => row.id);
    await client.query(
      `INSERT INTO plot_title_restore_216_backup (
         property_id, inquiry_reference, before_row, restored_category, restored_title, applied_at
       )
       SELECT id, inquiry_reference, before_row, restore_category, restore_title, clock_timestamp()
       FROM jsonb_to_recordset($1::jsonb) AS t(
         id uuid,
         inquiry_reference text,
         before_row jsonb,
         restore_category boolean,
         restore_title boolean
       )
       ON CONFLICT (property_id) DO NOTHING`,
      [JSON.stringify(found.rows.map((row) => ({
        id: row.id,
        inquiry_reference: row.inquiry_reference,
        before_row: row.before_row,
        restore_category: row.restore_category,
        restore_title: row.restore_title
      })))]
    );

    await client.query(
      `UPDATE properties p
       SET listing_type = CASE WHEN t.restore_category THEN 'land' ELSE p.listing_type END,
           transaction_type = CASE
             WHEN t.restore_category AND COALESCE(NULLIF(btrim(p.transaction_type), ''), 'sale') <> 'rent' THEN 'sale'
             ELSE p.transaction_type
           END,
           price_period = CASE
             WHEN t.restore_category AND lower(COALESCE(p.price_period, '')) IN ('semester', 'sem', 'per_semester') THEN 'once'
             ELSE p.price_period
           END,
           property_type = CASE
             WHEN t.restore_category AND (p.property_type IS NULL OR p.property_type ~* 'hostel|student') THEN 'Land'
             ELSE p.property_type
           END,
           title = CASE
             WHEN t.restore_title THEN left(t.source_title, 180)
             ELSE p.title
           END,
           extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object('category_title_restore_216', true)
       FROM jsonb_to_recordset($1::jsonb) AS t(
         id uuid,
         restore_category boolean,
         restore_title boolean,
         source_title text
       )
       WHERE p.id = t.id`,
      [JSON.stringify(found.rows.map((row) => ({
        id: row.id,
        restore_category: row.restore_category,
        restore_title: row.restore_title,
        source_title: row.source_title
      })))]
    );

    // Sync applied_at to the timestamp the update trigger wrote, so rollback
    // can tell a later staff edit from this repair without disabling the
    // trigger (ALTER TABLE ... DISABLE TRIGGER needs ACCESS EXCLUSIVE).
    await client.query(
      `UPDATE plot_title_restore_216_backup b
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
      category: found.rows.filter((row) => row.restore_category).length,
      titles: found.rows.filter((row) => row.restore_title).length
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
  let category = 0;
  let titles = 0;
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
      category += result.category;
      titles += result.titles;
      if (!result.updated) break;
    } catch (error) {
      stoppedEarly = true;
      errorMessage = error.message || String(error);
      if (logger && typeof logger.warn === 'function') {
        logger.warn('Plot title restore 216 batch failed; leaving the rest for the next boot', {
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
    category,
    titles,
    batches,
    remaining: stoppedEarly ? 'unknown' : 0,
    stopped_early: stoppedEarly,
    error: errorMessage
  };
}

async function runPlotTitleRestore216(db, options = {}) {
  return runInner(db, options);
}

module.exports = {
  BATCH_SIZE,
  LOCK_TIMEOUT,
  MATCHING_SQL,
  MAX_BATCHES,
  STATEMENT_TIMEOUT,
  runPlotTitleRestore216
};
