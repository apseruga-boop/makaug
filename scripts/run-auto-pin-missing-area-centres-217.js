'use strict';

// Batched area-centre pins that must not run at startup.
//
// 211 updated many property rows in one boot transaction and took
// makaug.com down on 10 Nov 2026 from 08:49 to 09:11 UK. This runner
// pins 24 approved listings that have no map pin, in batches of 20,
// each in its own short transaction, after the process is already
// serving (see scheduleStartupDataRepairs). A lock wait or a slow
// statement fails that batch and leaves the rest for the next boot.
//
// Points come from utils/ugandaAreaCentroids.js (free OpenStreetMap
// Nominatim lookups cached on 10 Nov 2026). There is no runtime
// geocoding. District-only rows are not in this payload. Two title-only
// pins (MK-20261004-4D2362 Kololo and MK-20260922-6F5C3B Busabala) also
// receive the matching area and district, because those fields were blank.
//
// Idempotent: a property already in auto_pin_217_backup is skipped,
// including rows that were later rolled back. A pin set since is kept.
// Nothing is deleted. updated_at is not changed.

const BATCH_SIZE = 20;
const MAX_BATCHES = 5;
const LOCK_TIMEOUT = '3s';
const STATEMENT_TIMEOUT = '30s';
const BATCH_ID = 'auto_pin_20261110';
const AUTO_PIN_NOTE = 'Auto-pinned at the area centre: the lister gave no pin. Approximate, not the exact address.';

const AUTO_PIN_217_ROWS = [
  { id: 'fa717909-0509-4f25-8b92-a6c908eb4cbc', ref: 'MK-20261025-3CC1FA', lat: 0.3303, lng: 32.677, to: 'Akright City, Wakiso', to_key: 'wakiso:akright city' },
  { id: '6b3d90a1-f833-4ec9-81e6-2c3905eaa056', ref: 'MK-20261106-8B4EE2', lat: 0.3303, lng: 32.677, to: 'Akright City, Wakiso', to_key: 'wakiso:akright city' },
  { id: '4a235a25-43ab-4bc1-81a5-dcffd220dbd8', ref: 'MK-20261109-3DB7E7', lat: 0.3303, lng: 32.677, to: 'Akright City, Wakiso', to_key: 'wakiso:akright city' },
  { id: 'bcc3b899-2284-4ce6-a393-6fc0e07ed23a', ref: 'MK-20261105-86F6A1', lat: 0.577, lng: 32.537, to: 'Bombo, Luwero', to_key: 'luwero:bombo' },
  { id: 'ef946b05-03d1-4f84-b3d2-f3352d0c15d2', ref: 'MK-20261027-CF0AFE', lat: 0.2891, lng: 32.6269, to: 'Bukasa, Kampala', to_key: 'kampala:bukasa' },
  { id: '1991c8dd-6315-40a7-88bd-b7cdb5f32da9', ref: 'MK-20261028-91504D', lat: 0.596, lng: 32.6565, to: 'Busiika, Luwero', to_key: 'luwero:busiika' },
  { id: 'b06f9d86-3699-4173-a5ac-0cd2bacdcea0', ref: 'MK-20261107-7968B4', lat: 0.596, lng: 32.6565, to: 'Busiika, Luwero', to_key: 'luwero:busiika' },
  { id: 'b0ffe6df-d734-472a-abf2-538ee6e90407', ref: 'MK-20261109-81E589', lat: 0.596, lng: 32.6565, to: 'Busiika, Luwero', to_key: 'luwero:busiika' },
  { id: 'db4d4516-5008-4c25-a677-04c0459427c6', ref: 'MK-20260928-DB4D45', lat: 0.596, lng: 32.6565, to: 'Busika, Luwero', to_key: 'luwero:busika' },
  { id: 'cf55bec2-638d-40c7-847c-554134818e3f', ref: 'MK-20261106-A8BCAB', lat: 0.4836, lng: 32.7128, to: 'Ddundu, Mukono', to_key: 'mukono:ddundu' },
  { id: '6f7186ab-a57a-455f-83de-70ae756f24fb', ref: 'MK-20261001-6F7186', lat: 0.9554, lng: 32.6804, to: 'Kamira, Luwero', to_key: 'luwero:kamira' },
  { id: 'df969b6a-ff97-4ba8-ab3c-c70c8b184465', ref: 'MK-20261005-DF969B', lat: 0.9554, lng: 32.6804, to: 'Kamira, Luwero', to_key: 'luwero:kamira' },
  { id: '0aa23ac0-7fa9-40f4-8f02-b544225a544c', ref: 'MK-20261110-66D71E', lat: 0.4293, lng: 32.8926, to: 'Mayangayanga, Mukono', to_key: 'mukono:mayangayanga' },
  { id: 'c8c6a1ed-8b89-46b8-b56e-229b59b95f70', ref: 'MK-20261110-E0BC52', lat: 0.4293, lng: 32.8926, to: 'Mayangayanga, Mukono', to_key: 'mukono:mayangayanga' },
  { id: '300f5a94-eb2c-4157-8eee-731502447505', ref: 'MK-20261102-A1ED59', lat: 0.2097, lng: 32.5778, to: 'Mutungo, Wakiso', to_key: 'wakiso:mutungo' },
  { id: '01d726a9-9a1f-42c5-8a5a-f2f4bf77b8f6', ref: 'MK-20261024-7F6D7E', lat: 0.4667, lng: 32.3167, to: 'Nampunge, Wakiso', to_key: 'wakiso:nampunge' },
  { id: '70952e1f-a099-432b-99c5-0e379bb63bf4', ref: 'MK-20261106-27998E', lat: 0.1522, lng: 32.544, to: 'Namulanda, Wakiso', to_key: 'wakiso:namulanda' },
  { id: '80c94c42-24ff-4f7e-8ae4-5680acfd04ed', ref: 'MK-20261106-C15F35', lat: 0.1522, lng: 32.544, to: 'Namulanda, Wakiso', to_key: 'wakiso:namulanda' },
  { id: '41d6da16-0dd2-43fe-8270-c7fa83b8d9b9', ref: 'MK-20261024-BE531B', lat: 0.4139, lng: 32.463, to: 'Namusera, Wakiso', to_key: 'wakiso:namusera' },
  { id: '7f3b29f2-e42a-4d62-9fbe-85fc61de2be7', ref: 'MK-20261102-5120EE', lat: 0.0948, lng: 32.507, to: 'Nkumba, Wakiso', to_key: 'wakiso:nkumba' },
  { id: 'c6e33074-c626-4179-9c3e-8d538ba2c2d3', ref: 'MK-20261025-3C3596', lat: 0.2718, lng: 32.4117, to: 'Sekiwunga, Mpigi', to_key: 'mpigi:sekiwunga' },
  { id: '8081bc29-c374-418d-949d-58b289c2ad0a', ref: 'MK-20261106-73BD3A', lat: 0.1189, lng: 32.9588, to: 'Zitwe, Buikwe', to_key: 'buikwe:zitwe' },
  { id: '7d5c503a-24e3-4cfc-af94-bf6964da03bd', ref: 'MK-20261004-4D2362', lat: 0.356, lng: 32.612, to: 'Kololo, Kampala', to_key: 'kampala:kololo', set_area: 'Kololo', set_district: 'Kampala' },
  { id: 'fd0bb249-d628-4fd3-9686-a4494d204a20', ref: 'MK-20260922-6F5C3B', lat: 0.2097, lng: 32.6178, to: 'Busabala, Wakiso', to_key: 'wakiso:busabala', set_area: 'Busabala', set_district: 'Wakiso' }
];

const MATCHING_SQL = `
SELECT
  p.id,
  p.inquiry_reference,
  p.area AS old_area,
  p.district AS old_district,
  p.extra_fields,
  p.updated_at,
  t.lat AS new_lat,
  t.lng AS new_lng,
  t.to_label,
  t.to_key,
  t.set_area,
  t.set_district
FROM jsonb_to_recordset($1::jsonb) AS t(
  id uuid,
  lat numeric,
  lng numeric,
  to_label text,
  to_key text,
  set_area text,
  set_district text
)
JOIN properties p ON p.id = t.id
WHERE LOWER(COALESCE(p.status, '')) = 'approved'
  AND p.latitude IS NULL
  AND p.longitude IS NULL
  AND COALESCE(p.extra_fields->'coords_fix'->>'batch', '') <> 'auto_pin_20261110'
  AND NOT EXISTS (
    SELECT 1 FROM auto_pin_217_backup b WHERE b.property_id = p.id
  )
ORDER BY p.id
LIMIT $2
`;

function isUganda() {
  return String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase() === 'UG';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function payloadJson() {
  return JSON.stringify(AUTO_PIN_217_ROWS.map((row) => ({
    id: row.id,
    lat: row.lat,
    lng: row.lng,
    to_label: row.to,
    to_key: row.to_key,
    set_area: row.set_area || null,
    set_district: row.set_district || null
  })));
}

async function ensureBackupTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS auto_pin_217_backup (
      property_id uuid PRIMARY KEY,
      inquiry_reference text,
      old_latitude numeric,
      old_longitude numeric,
      new_latitude numeric NOT NULL,
      new_longitude numeric NOT NULL,
      old_area text,
      old_district text,
      extra_fields jsonb,
      updated_at timestamptz,
      backed_up_at timestamptz NOT NULL DEFAULT NOW(),
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

    const found = await client.query(MATCHING_SQL, [payloadJson(), batchSize]);
    if (!found.rows.length) {
      await client.query('COMMIT');
      return { updated: 0 };
    }

    await client.query(
      `INSERT INTO auto_pin_217_backup (
         property_id, inquiry_reference, old_latitude, old_longitude,
         new_latitude, new_longitude, old_area, old_district, extra_fields, updated_at
       )
       SELECT id, inquiry_reference, NULL, NULL, new_lat, new_lng, old_area, old_district, extra_fields, updated_at
       FROM jsonb_to_recordset($1::jsonb) AS t(
         id uuid,
         inquiry_reference text,
         new_lat numeric,
         new_lng numeric,
         old_area text,
         old_district text,
         extra_fields jsonb,
         updated_at timestamptz
       )
       ON CONFLICT (property_id) DO NOTHING`,
      [JSON.stringify(found.rows.map((row) => ({
        id: row.id,
        inquiry_reference: row.inquiry_reference,
        new_lat: row.new_lat,
        new_lng: row.new_lng,
        old_area: row.old_area,
        old_district: row.old_district,
        extra_fields: row.extra_fields,
        updated_at: row.updated_at
      })))]
    );

    await client.query(
      `UPDATE properties p
       SET latitude = t.new_lat,
           longitude = t.new_lng,
           area = CASE
             WHEN t.set_area IS NOT NULL AND btrim(COALESCE(p.area, '')) = '' THEN t.set_area
             ELSE p.area
           END,
           district = CASE
             WHEN t.set_district IS NOT NULL AND btrim(COALESCE(p.district, '')) = '' THEN t.set_district
             ELSE p.district
           END,
           extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
             'location_precision', 'area',
             'location_confidence', '0.4',
             'geocoding_provider', 'area_centre_auto_pin',
             'auto_pinned', true,
             'auto_pin_note', $2::text,
             'canonical_location_id', COALESCE(NULLIF(p.extra_fields->>'canonical_location_id', ''), t.to_key),
             'coords_fix', jsonb_build_object(
               'action', 'auto_pin',
               'reason', 'missing_pin',
               'at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
               'by', 'one_off_backfill',
               'batch', $3::text,
               'to', t.to_label,
               'to_key', t.to_key,
               'to_point', jsonb_build_object('lat', t.new_lat, 'lng', t.new_lng),
               'previous', jsonb_build_object(
                 'latitude', NULL,
                 'longitude', NULL,
                 'area', p.area,
                 'district', p.district,
                 'location_precision', COALESCE(p.extra_fields->'location_precision', 'null'::jsonb),
                 'location_confidence', COALESCE(p.extra_fields->'location_confidence', 'null'::jsonb),
                 'geocoding_provider', COALESCE(p.extra_fields->'geocoding_provider', 'null'::jsonb),
                 'coords_fix', COALESCE(p.extra_fields->'coords_fix', 'null'::jsonb)
               )
             )
           ),
           updated_at = p.updated_at
       FROM jsonb_to_recordset($1::jsonb) AS t(
         id uuid,
         new_lat numeric,
         new_lng numeric,
         to_label text,
         to_key text,
         set_area text,
         set_district text
       )
       WHERE p.id = t.id
         AND p.latitude IS NULL
         AND p.longitude IS NULL
         AND LOWER(COALESCE(p.status, '')) = 'approved'`,
      [JSON.stringify(found.rows.map((row) => ({
        id: row.id,
        new_lat: row.new_lat,
        new_lng: row.new_lng,
        to_label: row.to_label,
        to_key: row.to_key,
        set_area: row.set_area,
        set_district: row.set_district
      }))), AUTO_PIN_NOTE, BATCH_ID]
    );

    await client.query('COMMIT');
    return { updated: found.rows.length };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* keep the original error */ }
    throw error;
  } finally {
    client.release();
  }
}

async function runInner(db, options = {}) {
  const logger = options.logger;
  const batchSize = Number(options.batchSize || BATCH_SIZE) || BATCH_SIZE;
  const maxBatches = Number(options.maxBatches || MAX_BATCHES) || MAX_BATCHES;
  if (!isUganda()) {
    return { skipped: 'country_not_ug', updated: 0, remaining: 0 };
  }
  if (!db || typeof db.getClient !== 'function') {
    return { skipped: 'no_db', updated: 0, remaining: 0 };
  }

  let updated = 0;
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
      if (!result.updated) break;
    } catch (error) {
      stoppedEarly = true;
      errorMessage = error.message || String(error);
      if (logger && typeof logger.warn === 'function') {
        logger.warn('Auto-pin 217 batch failed; leaving the rest for the next boot', {
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
    batches,
    remaining: stoppedEarly ? 'unknown' : 0,
    stopped_early: stoppedEarly,
    error: errorMessage
  };
}

async function runAutoPinMissingAreaCentres217(db, options = {}) {
  return runInner(db, options);
}

module.exports = {
  AUTO_PIN_217_ROWS,
  BATCH_ID,
  BATCH_SIZE,
  LOCK_TIMEOUT,
  MATCHING_SQL,
  MAX_BATCHES,
  STATEMENT_TIMEOUT,
  runAutoPinMissingAreaCentres217
};
