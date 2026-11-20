'use strict';

// Placeholder found-online titles and pasted WhatsApp listing copy
// (Arthur, 20 Nov 2026). See db/migrations/241_placeholder_titles_and_pasted_copy.sql.
// Runs after the process is serving (scheduleStartupDataRepairs), in short
// transactions with lock and statement timeouts. A lock wait fails the pass
// and leaves it for the next boot.
//
// Rows are skipped once they are in the backup table, so a later staff
// edit is never overwritten and re-running is a no-op. MK-20261112-004179
// is never selected. Nothing is deleted and nothing is sent to anyone.

const {
  factualListingTitle,
  isPlaceholderOrGenericTitle,
  rewritePlaceholderDescription
} = require('../services/publicListingCopy');

const LOCK_TIMEOUT = '3s';
const STATEMENT_TIMEOUT = '30s';
const MARKER = 'placeholder_titles_and_pasted_copy_241';
const BATCH = 20;
const NEVER_TOUCH_REFS = Object.freeze(['MK-20261112-004179']);

const BACKUP_COLUMNS = [
  'title', 'description', 'area', 'district', 'address', 'property_type',
  'land_size_value', 'land_size_unit', 'moderation_notes', 'extra_fields'
];

const NOTE_STAMP_SQL = `'[' || to_char(clock_timestamp() AT TIME ZONE 'Africa/Kampala', 'FMDD Mon YYYY, HH24:MI') || ' EAT] makaug data fix: '`;
const APPEND_NOTE_SQL = `CASE WHEN NULLIF(btrim(COALESCE(moderation_notes, '')), '') IS NULL
  THEN ${NOTE_STAMP_SQL} || $note
  ELSE moderation_notes || E'\\n' || ${NOTE_STAMP_SQL} || $note END`;

const PLACEHOLDER_TITLE_SQL = `(
  title ~* 'found-online[[:space:]]+.+(property[[:space:]]+)?(post|source)'
  OR title ~* '(tiktok|facebook|instagram|youtube|twitter|linkedin)[[:space:]]+property[[:space:]]+post'
  OR title ~* '(^|[^[:alnum:]])x[[:space:]]+property[[:space:]]+post'
  OR title ~* '^found-online property source$'
)`;

const SPECIALS = Object.freeze([
  {
    ref: 'MK-20261120-P5T3F',
    action: 'clean_pasted_copy',
    guard: `status = 'pending' AND area = 'Wakiso Central' AND title ILIKE '%Entebbe Kawuku%' AND title ILIKE '%Bussi Island%'`,
    title: '20 acres for sale in Kawuku, Entebbe',
    description: '20 titled acres for sale in Kawuku, Entebbe, at UGX 260 million per acre. The land is squatter-free, sits directly on the lake, and can be viewed from Entebbe. It is suitable for real estate or recreation. The same advert also offers 9 acres on Bussi Island at UGX 160 million per acre. These are two separate properties and should be split into two listings.',
    area: 'Kawuku',
    district: 'Wakiso',
    address: 'Entebbe road, Kawuku, Wakiso',
    note: 'Cleaned pasted WhatsApp copy and moved the area from Wakiso Central to Kawuku (Entebbe road, Wakiso). This advert covers two properties (Kawuku 20 acres at UGX 260 million per acre, and Bussi Island 9 acres at UGX 160 million per acre) and should be split. Data fix 241.',
    extra: {
      city: 'Wakiso',
      neighborhood: 'Kawuku',
      region: 'Central',
      canonical_location_id: 'wakiso:kawuku',
      canonical_location_level: 'area',
      canonical_location_match: 'staff_correction',
      canonical_location_confidence: 1,
      location_resolution_status: 'canonical_staff_edit',
      resolved_location_label: 'Kawuku, Wakiso, Central',
      staff_location_confirmed: true,
      should_split: true,
      split_into: [
        'Kawuku, Entebbe: 20 acres at UGX 260 million per acre',
        'Bussi Island: 9 acres at UGX 160 million per acre'
      ]
    }
  },
  {
    ref: 'MK-20261120-Y2URD',
    action: 'clean_pasted_copy',
    guard: `status = 'pending' AND area = 'Namanve' AND title ILIKE '%Warehouses for sale in Namanve%'`,
    title: '3 warehouses for sale in Namanve',
    description: 'Three detached warehouse units plus office space for sale in Namanve, on a 4-acre plot, at USD 1,950,000. The stored price field was empty when this copy was cleaned; confirm and enter the price before approval.',
    property_type: 'Warehouse',
    land_size_value: 4,
    land_size_unit: 'acres',
    note: 'Cleaned pasted WhatsApp copy. Property type set to Warehouse (was House). Plot size 4 acres taken from the advert. The USD 1,950,000 asking price was not stored; confirm before approval. Data fix 241.',
    extra: {
      should_split: false
    }
  },
  {
    ref: 'MK-20261120-EZ353',
    action: 'clean_pasted_copy',
    guard: `status = 'approved' AND area = 'Matugga' AND title ILIKE '%37M%' AND title ILIKE '%Matugga%'`,
    title: '2-bed house for sale in Matugga',
    description: 'A 2-bedroom house for sale in Matugga Kiwebwa, near the Semuto Road tarmac, at UGX 35 million. It has a sitting room, three boys’ quarters and a store, is fenced, and has electricity. The plot is 60 by 60 feet, on agreement. The original heading showed UGX 37 million; the listed price is UGX 35 million.',
    note: 'Cleaned pasted WhatsApp copy on an already-live listing. The heading said UGX 37 million; the listed price is UGX 35 million, which was left unchanged. Data fix 241.',
    extra: {}
  },
  {
    ref: 'MK-20261120-8STA5',
    action: 'clean_pasted_copy',
    guard: `status = 'approved' AND area = 'Bwaise' AND title ILIKE '%Bwaise Town Plot%' AND title ILIKE '%Kawempe%'`,
    title: 'Commercial plots for sale in Bwaise and Kawempe',
    description: 'This advert covers several commercial plots and should be split into separate listings. In Bwaise town, a 50-by-100-foot Kabaka’s land plot one plot off the tarmac is offered at UGX 300 million, suitable for an apartment or garage. In Kawempe, an 8-decimal titled commercial plot is offered at UGX 300 million; a 12-decimal plot in Kawempe town, one plot off Ttula Road, at UGX 350 million; and a 12-decimal plot near Kawempe Hospital, two plots off Bombo Road, at UGX 360 million. The stored guide price on this row is UGX 250 million per plot, which does not match the figures in the advert and should be checked.',
    note: 'Cleaned pasted WhatsApp copy on an already-live listing. This post covers several plots in Bwaise and Kawempe and should be split. The stored price is UGX 250 million, which does not match the advert figures (UGX 300–360 million). Data fix 241.',
    extra: {
      should_split: true,
      split_into: [
        'Bwaise town: 50x100 ft Kabaka’s land at UGX 300 million',
        'Kawempe: 8 decimals titled at UGX 300 million',
        'Kawempe town: 12 decimals off Ttula Road at UGX 350 million',
        'Kawempe Hospital: 12 decimals off Bombo Road at UGX 360 million'
      ]
    }
  },
  {
    ref: 'MK-20261111-5720CD',
    action: 'clean_pasted_copy',
    guard: `status = 'approved' AND area = 'Matugga' AND title ILIKE '%Matugga 100M%'`,
    title: '4-bed house for sale in Matugga',
    description: 'A 4-bedroom house for sale in Matugga at UGX 100 million, with a sitting and dining area, on two 100-by-100-foot plots, less than 1 km off the Kavule–Semuto Road tarmac.',
    note: 'Cleaned pasted WhatsApp copy on an already-live listing. Data fix 241.',
    extra: {}
  },
  {
    ref: 'MK-20261111-Y425P',
    action: 'clean_pasted_copy',
    guard: `status = 'approved' AND area = 'Matugga' AND title ILIKE '%Matugga town plot at 35M%'`,
    title: 'Plot for sale in Matugga town',
    description: 'A 50-by-100-foot plot for sale in Matugga town at UGX 35 million, on agreement, in a developed neighbourhood.',
    note: 'Cleaned pasted WhatsApp copy on an already-live listing. Data fix 241.',
    extra: {}
  },
  {
    ref: 'MK-20261111-B3DH8',
    action: 'clean_pasted_copy',
    guard: `status = 'approved' AND area = 'Kireka' AND title ILIKE '%KIREKA, NAMUGONGO ROAD%'`,
    title: '17-decimal commercial plot for sale in Kireka',
    description: 'A 17-decimal commercial plot for sale in Kireka, on Namugongo Road, at UGX 480 million. A Mailo title is available. The land has road access and is near water and electricity.',
    note: 'Cleaned pasted WhatsApp copy on an already-live listing. Data fix 241.',
    extra: {}
  }
]);

function isUganda() {
  return String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase() === 'UG';
}

async function ensureBackupTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS placeholder_titles_and_pasted_copy_241_backup (
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

function snapshot(row) {
  return Object.fromEntries(BACKUP_COLUMNS.map((column) => [column, row[column] === undefined ? null : row[column]]));
}

async function insertBackup(client, row, action) {
  await client.query(
    `INSERT INTO placeholder_titles_and_pasted_copy_241_backup
       (property_id, inquiry_reference, action, before_row, before_updated_at, applied_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, clock_timestamp())
     ON CONFLICT (property_id) DO NOTHING`,
    [row.id, row.inquiry_reference, action, JSON.stringify(snapshot(row)), row.updated_at]
  );
}

async function stampAppliedAt(client, propertyId) {
  await client.query(
    `UPDATE placeholder_titles_and_pasted_copy_241_backup b SET applied_at = p.updated_at
       FROM properties p WHERE p.id = b.property_id AND b.property_id = $1`,
    [propertyId]
  );
}

function extraPatchSql(spec) {
  const staffFields = ['title', 'description'];
  if (spec.area) staffFields.push('area');
  if (spec.address) staffFields.push('address');
  if (spec.property_type) staffFields.push('property_type');
  const extra = {
    staff_corrected_fields: staffFields,
    staff_corrected_at: true,
    staff_corrected_by: 'data_fix_241',
    [MARKER]: true,
    ...(spec.extra || {})
  };
  // staff_corrected_at is set in SQL to the current timestamp.
  return extra;
}

async function applySpecial(client, spec) {
  const row = (await client.query(
    `SELECT id, inquiry_reference, status, updated_at, ${BACKUP_COLUMNS.join(', ')},
            (${spec.guard}) AS guard_ok,
            EXISTS (
              SELECT 1 FROM placeholder_titles_and_pasted_copy_241_backup b
              WHERE b.property_id = p.id
            ) AS already_done
       FROM properties p
      WHERE inquiry_reference = $1
        AND inquiry_reference <> ALL($2::text[])
      FOR UPDATE`,
    [spec.ref, NEVER_TOUCH_REFS]
  )).rows[0];
  if (!row) return 'not_found';
  if (row.already_done) return 'already_done';
  if (!row.guard_ok) return 'state_changed_skipped';

  await insertBackup(client, row, spec.action);

  const extra = extraPatchSql(spec);
  const sets = [
    'title = $2',
    'description = $3',
    `moderation_notes = ${APPEND_NOTE_SQL.replaceAll('$note', '$4')}`,
    `extra_fields = COALESCE(extra_fields, '{}'::jsonb)
       || jsonb_build_object(
            'staff_corrected_fields', (
              SELECT jsonb_agg(DISTINCT v ORDER BY v)
                FROM jsonb_array_elements_text(
                  CASE WHEN jsonb_typeof(extra_fields->'staff_corrected_fields') = 'array'
                    THEN extra_fields->'staff_corrected_fields' ELSE '[]'::jsonb END
                  || $6::jsonb) AS v),
            'staff_corrected_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
            'staff_corrected_by', 'data_fix_241',
            '${MARKER}', true
          )
       || $5::jsonb`,
    'updated_at = NOW()'
  ];
  const values = [
    row.id,
    spec.title,
    spec.description,
    spec.note,
    JSON.stringify(extra),
    JSON.stringify(extra.staff_corrected_fields)
  ];
  if (spec.area) {
    values.push(spec.area);
    sets.push(`area = $${values.length}`);
  }
  if (spec.district) {
    values.push(spec.district);
    sets.push(`district = $${values.length}`);
  }
  if (spec.address) {
    values.push(spec.address);
    sets.push(`address = $${values.length}`);
  }
  if (spec.property_type) {
    values.push(spec.property_type);
    sets.push(`property_type = $${values.length}`);
  }
  if (spec.land_size_value != null) {
    values.push(spec.land_size_value);
    sets.push(`land_size_value = $${values.length}`);
  }
  if (spec.land_size_unit) {
    values.push(spec.land_size_unit);
    sets.push(`land_size_unit = $${values.length}`);
  }

  await client.query(`UPDATE properties SET ${sets.join(', ')} WHERE id = $1`, values);
  await client.query(
    `INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, reason, notes)
     VALUES ($1, NULL, 'data_fix_241_copy_cleaned', $2, $2, $3, $4)`,
    [row.id, row.status, spec.title, 'By data fix 241 (per Arthur, 20 Nov 2026)']
  );
  await stampAppliedAt(client, row.id);
  return 'applied';
}

async function applyPlaceholderBatch(client) {
  const rows = (await client.query(
    `SELECT id, inquiry_reference, status, updated_at, listing_type, property_type,
            bedrooms, area, district, land_size_value, land_size_unit, price_period,
            ${BACKUP_COLUMNS.join(', ')}
       FROM properties p
      WHERE status IN ('pending', 'approved')
        AND inquiry_reference <> ALL($1::text[])
        AND ${PLACEHOLDER_TITLE_SQL}
        AND NOT EXISTS (
          SELECT 1 FROM placeholder_titles_and_pasted_copy_241_backup b
          WHERE b.property_id = p.id
        )
      ORDER BY created_at, id
      LIMIT $2
      FOR UPDATE SKIP LOCKED`,
    [NEVER_TOUCH_REFS, BATCH]
  )).rows;

  let applied = 0;
  for (const row of rows) {
    if (!isPlaceholderOrGenericTitle(row.title)) continue;
    const nextTitle = factualListingTitle(row);
    if (!nextTitle || nextTitle === row.title) continue;
    const nextDescription = rewritePlaceholderDescription(row.title, nextTitle, row.description);
    await insertBackup(client, row, 'rewrite_placeholder_title');
    await client.query(
      `UPDATE properties
          SET title = $2,
              description = $3,
              extra_fields = COALESCE(extra_fields, '{}'::jsonb)
                || jsonb_build_object(
                  'staff_corrected_fields', (
                    SELECT jsonb_agg(DISTINCT v ORDER BY v)
                      FROM jsonb_array_elements_text(
                        CASE WHEN jsonb_typeof(extra_fields->'staff_corrected_fields') = 'array'
                          THEN extra_fields->'staff_corrected_fields' ELSE '[]'::jsonb END
                        || '["title","description"]'::jsonb) AS v),
                  'staff_corrected_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                  'staff_corrected_by', 'data_fix_241',
                  '${MARKER}', true
                ),
              updated_at = NOW()
        WHERE id = $1`,
      [row.id, nextTitle, nextDescription]
    );
    await client.query(
      `INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, reason, notes)
       VALUES ($1, NULL, 'data_fix_241_placeholder_title', $2, $2, $3, $4)`,
      [row.id, row.status, nextTitle, 'By data fix 241 (per Arthur, 20 Nov 2026)']
    );
    await stampAppliedAt(client, row.id);
    applied += 1;
  }
  return { scanned: rows.length, applied, more: rows.length === BATCH };
}

async function applyOnce(db, { specialsOnly = false } = {}) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
    await ensureBackupTable(client);
    const results = {};
    for (const spec of SPECIALS) results[spec.ref] = await applySpecial(client, spec);
    const batch = specialsOnly
      ? { scanned: 0, applied: 0, more: false }
      : await applyPlaceholderBatch(client);
    await client.query('COMMIT');
    return { results, batch };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* throw below */ }
    throw error;
  } finally {
    client.release();
  }
}

async function runPlaceholderTitlesAndPastedCopy241(db, { logger = console } = {}) {
  if (!isUganda()) return { skipped: 'country_not_ug', updated: 0 };
  if (!db || typeof db.getClient !== 'function') return { skipped: 'no_db', updated: 0 };
  let updated = 0;
  const allResults = {};
  let stoppedEarly = false;
  let errorMessage = '';
  try {
    const run = (opts) => (typeof db.runBackgroundWork === 'function'
      ? db.runBackgroundWork(() => applyOnce(db, opts))
      : applyOnce(db, opts));

    // Specials first, then placeholder batches until a short pass is done.
    const first = await run();
    Object.assign(allResults, first.results);
    updated += Object.values(first.results).filter((value) => value === 'applied').length;
    updated += first.batch.applied || 0;
    let more = first.batch.more;
    let passes = 1;
    while (more && passes < 20) {
      const next = await run({ specialsOnly: false });
      updated += next.batch.applied || 0;
      more = next.batch.more && next.batch.applied > 0;
      passes += 1;
    }
    if (updated) {
      try { require('../routes/properties').clearPublicPropertiesCache('data_fix_241'); } catch (_) { /* best effort */ }
      try { require('../services/publicSeoRenderService').clearSeoListingCache(); } catch (_) { /* best effort */ }
    }
    return { updated, results: allResults, stopped_early: false, passes };
  } catch (error) {
    stoppedEarly = true;
    errorMessage = error.message || String(error);
    if (logger && typeof logger.warn === 'function') {
      logger.warn('Placeholder titles and pasted copy fix 241 failed; leaving it for the next boot', {
        code: error.code,
        message: errorMessage
      });
    }
    return { updated, results: allResults, stopped_early: stoppedEarly, error: errorMessage };
  }
}

module.exports = {
  BACKUP_COLUMNS,
  MARKER,
  NEVER_TOUCH_REFS,
  SPECIALS,
  runPlaceholderTitlesAndPastedCopy241
};
