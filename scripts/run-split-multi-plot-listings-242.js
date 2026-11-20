'use strict';

// Split combined adverts and set the Namanve warehouse price (Arthur,
// 20 Nov 2026: "sort them out"). See
// db/migrations/242_split_multi_plot_listings.sql.
//
// Runs after the process is serving (scheduleStartupDataRepairs), in
// one short transaction with lock and statement timeouts. A lock wait
// fails the pass and leaves it for the next boot.
//
// Source rows are matched by inquiry_reference AND the state read on
// 20 Nov after data fix 241, so a later staff edit is never overwritten.
// New listings copy the lister from the source row (no phone numbers
// are written in this file). Re-running is a no-op. Nothing is sent.

const { buildListingReference } = require('../services/listingReferenceService');
const { propertyPriceMetadata, configuredUsdToUgxRate } = require('../utils/propertyPriceCurrency');
const { COPY, MARKER } = require('./split-multi-plot-listings-242-copy');

const LOCK_TIMEOUT = '3s';
const STATEMENT_TIMEOUT = '30s';

const NOTE_STAMP_SQL = `'[' || to_char(clock_timestamp() AT TIME ZONE 'Africa/Kampala', 'FMDD Mon YYYY, HH24:MI') || ' EAT] makaug data fix: '`;
const APPEND_NOTE_SQL = (param) => `CASE WHEN NULLIF(btrim(COALESCE(moderation_notes, '')), '') IS NULL
  THEN ${NOTE_STAMP_SQL} || ${param}
  ELSE moderation_notes || E'\\n' || ${NOTE_STAMP_SQL} || ${param} END`;

const BACKUP_COLUMNS = [
  'title', 'description', 'area', 'district', 'address', 'property_type', 'title_type',
  'land_size_value', 'land_size_unit', 'price', 'price_period', 'price_currency',
  'price_original', 'price_original_currency', 'price_fx_rate_ugx', 'price_fx_as_of',
  'price_on_application', 'latitude', 'longitude', 'moderation_notes', 'extra_fields',
  'status', 'moderation_stage'
];

function isUganda() {
  return String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase() === 'UG';
}

function snapshot(row) {
  return Object.fromEntries(BACKUP_COLUMNS.map((column) => {
    const value = row[column];
    return [column, value === undefined ? null : value];
  }));
}

async function ensureBackupTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS split_multi_plot_listings_242_backup (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      action text NOT NULL,
      source_inquiry_reference text NOT NULL,
      property_id uuid NOT NULL,
      inquiry_reference text NOT NULL,
      before_row jsonb,
      before_updated_at timestamptz,
      applied_at timestamptz NOT NULL,
      rolled_back_at timestamptz
    )
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS split_multi_plot_listings_242_backup_property_id
      ON split_multi_plot_listings_242_backup (property_id)
  `);
}

async function insertBackup(client, { action, sourceRef, row, before }) {
  await client.query(
    `INSERT INTO split_multi_plot_listings_242_backup
       (action, source_inquiry_reference, property_id, inquiry_reference, before_row, before_updated_at, applied_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, clock_timestamp())
     ON CONFLICT (property_id) DO NOTHING`,
    [action, sourceRef, row.id, row.inquiry_reference, before ? JSON.stringify(before) : null, row.updated_at || null]
  );
}

async function stampAppliedAt(client, propertyId) {
  await client.query(
    `UPDATE split_multi_plot_listings_242_backup b SET applied_at = p.updated_at
       FROM properties p WHERE p.id = b.property_id AND b.property_id = $1`,
    [propertyId]
  );
}

async function loadSource(client, ref, guardSql) {
  const row = (await client.query(
    `SELECT p.*,
            (${guardSql}) AS guard_ok,
            EXISTS (
              SELECT 1 FROM split_multi_plot_listings_242_backup b
              WHERE b.property_id = p.id
            ) AS already_done
       FROM properties p
      WHERE inquiry_reference = $1
      FOR UPDATE`,
    [ref]
  )).rows[0];
  return row || null;
}

function slimListerExtra(existing = {}) {
  const keep = [
    'broker_agent_id', 'broker_status', 'public_display_name', 'preferred_contact_method',
    'lister_registration_status', 'skip_owner_identity_recheck', 'verify'
  ];
  const out = {};
  for (const key of keep) {
    if (existing[key] !== undefined) out[key] = existing[key];
  }
  return out;
}

async function createSplitListing(client, source, child, sourceRef) {
  const already = (await client.query(
    `SELECT id, inquiry_reference FROM properties
      WHERE extra_fields->>'split_from' = $1
        AND extra_fields->>'split_child_key' = $2
        AND extra_fields ? $3
      LIMIT 1`,
    [sourceRef, child.key, MARKER]
  )).rows[0];
  if (already) return { status: 'already_done', ref: already.inquiry_reference, id: already.id };

  const ref = buildListingReference();
  const extra = {
    ...slimListerExtra(source.extra_fields || {}),
    ...(child.locationExtra || {}),
    staff_corrected_fields: ['title', 'description', 'area', 'price'],
    staff_corrected_at: new Date().toISOString(),
    staff_corrected_by: 'data_fix_242',
    split_from: sourceRef,
    split_child_key: child.key,
    [MARKER]: true
  };
  if (child.copyPhotos) {
    extra.photos_copied_from = sourceRef;
    extra.photos_need_staff_check = true;
  }

  const inserted = (await client.query(
    `INSERT INTO properties (
        listing_type, title, description, district, area, address,
        price, price_period, property_type, title_type,
        land_size_value, land_size_unit, amenities, extra_fields,
        lister_name, lister_phone, lister_email, lister_type, agent_id,
        status, source, listed_via, latitude, longitude,
        students_welcome, verification_terms_accepted, inquiry_reference,
        id_number, id_document_name, id_document_url,
        moderation_stage, moderation_notes,
        price_currency, price_original, price_original_currency,
        price_fx_rate_ugx, price_fx_as_of, price_on_application,
        availability_status
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12, $13::jsonb, $14::jsonb,
        $15, $16, $17, $18, $19,
        'pending', $20, $21, $22, $23,
        $24, $25, $26,
        $27, $28, $29,
        'submitted', $30,
        'UGX', $7, 'UGX',
        NULL, NULL, false,
        'available'
      )
      RETURNING id, inquiry_reference, updated_at`,
    [
      child.listingType,
      child.title,
      child.description,
      child.district,
      child.area,
      child.address,
      child.price,
      child.pricePeriod,
      child.propertyType,
      child.titleType,
      child.landSizeValue,
      child.landSizeUnit,
      JSON.stringify(source.amenities || []),
      JSON.stringify(extra),
      source.lister_name,
      source.lister_phone,
      source.lister_email,
      source.lister_type || 'owner',
      source.agent_id,
      source.source || 'broker_dashboard',
      source.listed_via || 'broker_dashboard',
      child.latitude ?? null,
      child.longitude ?? null,
      source.students_welcome === true,
      source.verification_terms_accepted === true,
      ref,
      source.id_number,
      source.id_document_name,
      source.id_document_url,
      child.note
    ]
  )).rows[0];

  await insertBackup(client, {
    action: 'create_split',
    sourceRef,
    row: inserted,
    before: null
  });

  if (child.copyPhotos) {
    await client.query(
      `INSERT INTO property_images (property_id, url, is_primary, sort_order, slot_key, room_label, created_at)
       SELECT $1, url, is_primary, sort_order, slot_key, room_label, clock_timestamp()
         FROM property_images
        WHERE property_id = $2
        ORDER BY is_primary DESC, sort_order ASC, created_at ASC`,
      [inserted.id, source.id]
    );
    const { syncListingImageSummary } = require('../services/staffPropertyMediaService');
    await syncListingImageSummary(client, inserted.id);
  }

  await client.query(
    `INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, reason, notes)
     VALUES ($1, NULL, 'data_fix_242_split_created', NULL, 'pending', $2, $3)`,
    [inserted.id, child.title, child.note]
  );
  await stampAppliedAt(client, inserted.id);
  return { status: 'applied', ref: inserted.inquiry_reference, id: inserted.id };
}

async function updateSourceAfterSplit(client, source, spec, childRefs, extraPatch, note) {
  await insertBackup(client, {
    action: 'update_source',
    sourceRef: spec.ref,
    row: source,
    before: snapshot(source)
  });
  const sets = [
    'title = $2',
    'description = $3',
    `moderation_notes = ${APPEND_NOTE_SQL('$4')}`,
    `extra_fields = COALESCE(extra_fields, '{}'::jsonb)
       || $5::jsonb
       || jsonb_build_object('${MARKER}', true, 'should_split', false, 'split_children', $6::jsonb)`,
    'updated_at = NOW()'
  ];
  const values = [
    source.id,
    spec.sourceTitle,
    spec.sourceDescription,
    note,
    JSON.stringify({
      staff_corrected_fields: ['title', 'description', ...(spec.sourcePrice ? ['price'] : []), ...(spec.clearLandSize ? ['land_size_value'] : [])],
      staff_corrected_at: new Date().toISOString(),
      staff_corrected_by: 'data_fix_242',
      land_dimensions_label: spec.clearLandSize ? '50x100 ft' : undefined,
      ...extraPatch
    }),
    JSON.stringify(childRefs)
  ];
  if (spec.sourcePrice != null) {
    values.push(spec.sourcePrice, spec.sourcePricePeriod || 'once', spec.sourcePrice, 'UGX');
    sets.push(`price = $${values.length - 3}`);
    sets.push(`price_period = $${values.length - 2}`);
    sets.push(`price_original = $${values.length - 1}`);
    sets.push(`price_original_currency = $${values.length}`);
    sets.push('price_fx_rate_ugx = NULL');
    sets.push('price_fx_as_of = NULL');
    sets.push('price_on_application = false');
    sets.push("price_currency = 'UGX'");
  }
  if (spec.clearLandSize) {
    sets.push('land_size_value = NULL');
    sets.push('land_size_unit = NULL');
  }
  await client.query(`UPDATE properties SET ${sets.join(', ')} WHERE id = $1`, values);
  await client.query(
    `INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, reason, notes)
     VALUES ($1, NULL, 'data_fix_242_source_split', $2, $2, $3, $4)`,
    [source.id, source.status, spec.sourceTitle, note]
  );
  await stampAppliedAt(client, source.id);
}

async function applyP5T3F(client) {
  const source = await loadSource(client, COPY.p5t3f.ref, COPY.p5t3f.guard);
  if (!source) return { status: 'not_found' };
  if (source.already_done) return { status: 'already_done' };
  if (!source.guard_ok) return { status: 'state_changed_skipped' };
  const created = await createSplitListing(client, source, COPY.p5t3f.child, COPY.p5t3f.ref);
  await updateSourceAfterSplit(client, source, COPY.p5t3f, [created.ref], {}, COPY.p5t3f.sourceNote);
  return { status: 'applied', children: [created] };
}

async function apply8STA5(client) {
  const source = await loadSource(client, COPY.sta5.ref, COPY.sta5.guard);
  if (!source) return { status: 'not_found' };
  if (source.already_done) return { status: 'already_done' };
  if (!source.guard_ok) return { status: 'state_changed_skipped' };
  const children = [];
  for (const child of COPY.sta5.children) {
    children.push(await createSplitListing(client, source, child, COPY.sta5.ref));
  }
  await updateSourceAfterSplit(
    client,
    source,
    COPY.sta5,
    children.map((row) => row.ref),
    { land_size_value: null, land_size_unit: null },
    COPY.sta5.sourceNote
  );
  return { status: 'applied', children };
}

async function applyY2URD(client) {
  const source = await loadSource(client, COPY.y2urd.ref, COPY.y2urd.guard);
  if (!source) return { status: 'not_found' };
  if (source.already_done) return { status: 'already_done' };
  if (!source.guard_ok) return { status: 'state_changed_skipped' };
  const fxAsOf = new Date().toISOString();
  const priced = propertyPriceMetadata(COPY.y2urd.usd, {
    currency: 'USD',
    usdToUgxRate: configuredUsdToUgxRate(),
    fxAsOf
  });
  if (!priced.supported || !priced.price) {
    return { status: 'price_conversion_failed', reason: priced.rejection_reason || 'no_price' };
  }
  await insertBackup(client, {
    action: 'update_price',
    sourceRef: COPY.y2urd.ref,
    row: source,
    before: snapshot(source)
  });
  await client.query(
    `UPDATE properties
        SET title = $2,
            description = $3,
            price = $4,
            price_currency = 'UGX',
            price_original = $5,
            price_original_currency = 'USD',
            price_fx_rate_ugx = $6,
            price_fx_as_of = $7::timestamptz,
            price_on_application = false,
            price_period = 'once',
            property_type = COALESCE(property_type, 'Warehouse'),
            land_size_value = COALESCE(land_size_value, 4),
            land_size_unit = COALESCE(land_size_unit, 'acres'),
            moderation_notes = ${APPEND_NOTE_SQL('$8')},
            extra_fields = COALESCE(extra_fields, '{}'::jsonb)
              || jsonb_build_object(
                'staff_corrected_fields', (
                  SELECT jsonb_agg(DISTINCT v ORDER BY v)
                    FROM jsonb_array_elements_text(
                      CASE WHEN jsonb_typeof(extra_fields->'staff_corrected_fields') = 'array'
                        THEN extra_fields->'staff_corrected_fields' ELSE '[]'::jsonb END
                      || '["price","description"]'::jsonb) AS v),
                'staff_corrected_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                'staff_corrected_by', 'data_fix_242',
                '${MARKER}', true
              ),
            updated_at = NOW()
      WHERE id = $1`,
    [
      source.id,
      COPY.y2urd.title,
      COPY.y2urd.description,
      priced.price,
      priced.price_original,
      priced.price_fx_rate_ugx,
      priced.price_fx_as_of || fxAsOf,
      COPY.y2urd.note
    ]
  );
  await client.query(
    `INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, reason, notes)
     VALUES ($1, NULL, 'data_fix_242_usd_price', $2, $2, $3, $4)`,
    [source.id, source.status, 'USD 1,950,000 at site rate', COPY.y2urd.note]
  );
  await stampAppliedAt(client, source.id);
  return {
    status: 'applied',
    price: priced.price,
    price_original: priced.price_original,
    rate: priced.price_fx_rate_ugx
  };
}

async function applyOnce(db) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
    await ensureBackupTable(client);
    const results = {
      p5t3f: await applyP5T3F(client),
      sta5: await apply8STA5(client),
      y2urd: await applyY2URD(client)
    };
    await client.query('COMMIT');
    return results;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* throw below */ }
    throw error;
  } finally {
    client.release();
  }
}

function countApplied(results = {}) {
  return ['p5t3f', 'sta5', 'y2urd'].filter((key) => results[key] && results[key].status === 'applied').length;
}

async function runSplitMultiPlotListings242(db, { logger = console } = {}) {
  if (!isUganda()) return { skipped: 'country_not_ug', updated: 0 };
  if (!db || typeof db.getClient !== 'function') return { skipped: 'no_db', updated: 0 };
  try {
    const results = typeof db.runBackgroundWork === 'function'
      ? await db.runBackgroundWork(() => applyOnce(db))
      : await applyOnce(db);
    const updated = countApplied(results);
    if (updated) {
      try { require('../routes/properties').clearPublicPropertiesCache('data_fix_242'); } catch (_) { /* best effort */ }
      try { require('../services/publicSeoRenderService').clearSeoListingCache(); } catch (_) { /* best effort */ }
    }
    return { updated, results, stopped_early: false };
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn('Split multi-plot listings fix 242 failed; leaving it for the next boot', {
        code: error.code,
        message: error.message
      });
    }
    return { updated: 0, stopped_early: true, error: error.message || String(error) };
  }
}

module.exports = {
  BACKUP_COLUMNS,
  COPY,
  MARKER,
  runSplitMultiPlotListings242
};
