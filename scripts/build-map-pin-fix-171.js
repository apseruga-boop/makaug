'use strict';

// Builds db/migrations/171_fix_flagged_map_pins.sql from the 24 Oct 2026 audit.
// Usage: node scripts/build-map-pin-fix-171.js path/to/flagged.csv

const fs = require('fs');
const path = require('path');
const { planMapPinFixes } = require('../services/mapPinAuditPlan');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift() || [];
  return rows
    .filter((cells) => cells.some((cell) => String(cell || '').trim()))
    .map((cells) => Object.fromEntries(header.map((key, index) => [key, cells[index] || ''])));
}

function sqlNumber(value) {
  return value == null ? 'null' : String(value);
}

function buildSql(plan) {
  const counts = {};
  for (const move of plan.moves) counts[move.confidence] = (counts[move.confidence] || 0) + 1;
  const skipCounts = {};
  for (const skip of plan.skipped) skipCounts[skip.reason] = (skipCounts[skip.reason] || 0) + 1;
  const payload = plan.moves.map((move) => ({
    id: move.id,
    old_lat: move.old_lat,
    old_lng: move.old_lng,
    new_lat: move.new_lat,
    new_lng: move.new_lng,
    confidence: move.confidence,
    source: move.source
  }));
  const header = [
    '-- Move flagged listing pins onto land inside Uganda.',
    '-- Source: 24 Oct 2026 map-pin audit. Every row below is a property id whose',
    '-- stored latitude/longitude (or a null pin) still matches the audited value.',
    '-- Labels, titles, prices and status are not changed.',
    '--',
    `-- Payload rows: ${plan.moves.length}`,
    `-- By confidence: high ${counts.high || 0}, medium ${counts.medium || 0}, low ${counts.low || 0}, none ${counts.none || 0}`,
    `-- Skipped: ${Object.entries(skipCounts).map(([key, count]) => `${key} ${count}`).join('; ') || 'none'}`,
    '-- Excluded: migration 169 rows (m169 column) and every property id in migration',
    '-- 170 (open PR #538, 170_correct_remaining_mislabelled_listings.sql).',
    '-- This file is 171 because 169 is on main and 170 is claimed by that PR.',
    '--',
    '-- Guard: round(latitude, 6) and round(longitude, 6) must still equal the audited',
    '-- value. Null stays null. Title, area and price are not compared. Migration 169',
    '-- skipped most of its rows because those other fields did not match storage.',
    '-- Idempotent: a second run matches nothing once the coordinates have changed,',
    '-- and a row already stamped map_pin_fix_171 is left alone.',
    '-- Backup: map_pin_fix_171_backup. Rollback: scripts/rollback-171-map-pin-fix.sql',
    '-- (that file is outside db/migrations, so it does not run on deploy).',
    ''
  ].join('\n');

  return `${header}
SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '180s';
SET LOCAL TIME ZONE 'UTC';

CREATE TABLE IF NOT EXISTS map_pin_fix_171_backup (
  property_id UUID PRIMARY KEY,
  old_latitude NUMERIC,
  old_longitude NUMERIC,
  new_latitude NUMERIC NOT NULL,
  new_longitude NUMERIC NOT NULL,
  confidence TEXT,
  source TEXT,
  extra_fields JSONB,
  updated_at TIMESTAMPTZ,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $map_pin_fix_171$
DECLARE
  expected integer := ${plan.moves.length};
  changed integer := 0;
  spec jsonb := $map_pin_fix_171_payload$${JSON.stringify(payload)}$map_pin_fix_171_payload$::jsonb;
BEGIN
  DROP TABLE IF EXISTS map_pin_fix_171_eligible;
  CREATE TEMP TABLE map_pin_fix_171_eligible ON COMMIT DROP AS
  SELECT
    p.id,
    (s.value->>'new_lat')::numeric AS new_lat,
    (s.value->>'new_lng')::numeric AS new_lng,
    CASE WHEN s.value->>'old_lat' IS NULL OR s.value->>'old_lat' = 'null' THEN NULL ELSE (s.value->>'old_lat')::numeric END AS old_lat,
    CASE WHEN s.value->>'old_lng' IS NULL OR s.value->>'old_lng' = 'null' THEN NULL ELSE (s.value->>'old_lng')::numeric END AS old_lng,
    s.value->>'confidence' AS confidence,
    s.value->>'source' AS source,
    p.extra_fields,
    p.updated_at
  FROM jsonb_array_elements(spec) AS s(value)
  JOIN properties p ON p.id = (s.value->>'id')::uuid
  WHERE current_setting('app.country_code', true) = 'UG'
    AND NOT (COALESCE(p.extra_fields, '{}'::jsonb) ? 'map_pin_fix_171')
    AND (
      (
        (s.value->>'old_lat' IS NULL OR s.value->>'old_lat' = 'null')
        AND (s.value->>'old_lng' IS NULL OR s.value->>'old_lng' = 'null')
        AND p.latitude IS NULL
        AND p.longitude IS NULL
      )
      OR (
        s.value->>'old_lat' IS NOT NULL
        AND s.value->>'old_lat' <> 'null'
        AND s.value->>'old_lng' IS NOT NULL
        AND s.value->>'old_lng' <> 'null'
        AND p.latitude IS NOT NULL
        AND p.longitude IS NOT NULL
        AND round(p.latitude::numeric, 6) = round((s.value->>'old_lat')::numeric, 6)
        AND round(p.longitude::numeric, 6) = round((s.value->>'old_lng')::numeric, 6)
      )
    );

  INSERT INTO map_pin_fix_171_backup (
    property_id, old_latitude, old_longitude, new_latitude, new_longitude,
    confidence, source, extra_fields, updated_at
  )
  SELECT id, old_lat, old_lng, new_lat, new_lng, confidence, source, extra_fields, updated_at
  FROM map_pin_fix_171_eligible
  ON CONFLICT (property_id) DO NOTHING;

  UPDATE properties p
  SET
    latitude = e.new_lat,
    longitude = e.new_lng,
    extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
      'map_pin_fix_171', jsonb_build_object(
        'applied_at', NOW(),
        'old_latitude', e.old_lat,
        'old_longitude', e.old_lng,
        'new_latitude', e.new_lat,
        'new_longitude', e.new_lng,
        'confidence', e.confidence,
        'source', e.source
      )
    ),
    updated_at = NOW()
  FROM map_pin_fix_171_eligible e
  WHERE p.id = e.id;

  GET DIAGNOSTICS changed = ROW_COUNT;
  RAISE NOTICE 'map_pin_fix_171 changed % rows, expected %', changed, expected;
END
$map_pin_fix_171$;
`;
}

function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node scripts/build-map-pin-fix-171.js path/to/flagged.csv');
    process.exit(1);
  }
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const plan = planMapPinFixes(rows);
  const sql = buildSql(plan);
  const out = path.join(__dirname, '..', 'db', 'migrations', '171_fix_flagged_map_pins.sql');
  fs.writeFileSync(out, sql);
  const counts = {};
  for (const move of plan.moves) counts[move.confidence] = (counts[move.confidence] || 0) + 1;
  const sources = {};
  for (const move of plan.moves) sources[move.source] = (sources[move.source] || 0) + 1;
  const skipCounts = {};
  for (const skip of plan.skipped) skipCounts[skip.reason] = (skipCounts[skip.reason] || 0) + 1;
  const summary = { moves: plan.moves.length, counts, sources, skipCounts, rows: rows.length };
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'map-pin-fix-171-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) main();

module.exports = { parseCsv, buildSql };
