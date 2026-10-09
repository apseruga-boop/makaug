#!/usr/bin/env node
'use strict';

/**
 * Mark staff-edited title/description as staff-corrected on found-online rows.
 *
 * Before #366 a staff edit of a found-online listing saved the new title and
 * description but never wrote extra_fields.staff_corrected_fields, so the public
 * API and the server-rendered page kept showing the generated "... is a
 * third-party property result ..." text instead of what staff typed.
 *
 * A row is a candidate when
 *   - it is a found-online listing,
 *   - a property_moderation_events row of action staff_listing_preview_saved
 *     (or listing_facts_updated_with_status by a staff user id, which has a UUID
 *     actor_id; the admin API logs its type there instead) lists title and/or
 *     description in changed_fields,
 *   - the stored value differs from what the public template would generate, and
 *   - staff_corrected_fields does not already contain that field.
 *
 * Dry-run by default: prints the ids and the staff_corrected_fields each row would
 * get, and writes nothing. --apply unions title/description into
 * staff_corrected_fields (an existing list is kept), one row at a time.
 *
 *   node scripts/backfill-staff-corrected-fields.js            # dry run
 *   node scripts/backfill-staff-corrected-fields.js --apply    # writes
 *
 * This runs in its own process, so the web server's in-memory public caches are
 * not cleared by it: they expire on their own (about 3 minutes for the listing
 * page, see PUBLIC_PROPERTIES_CACHE_TTL_MS / PUBLIC_SEO_LISTING_CACHE_TTL_MS).
 */

require('dotenv').config();

const { foundOnlinePropertySql } = require('../utils/foundOnlineSql');
const { buildThirdPartyPublicTitle } = require('../services/publicListingCopy');

const COPY_FIELDS = ['title', 'description'];
const TEMPLATE_MARKER = 'is a third-party property result';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EVENTS_SQL = `
  SELECT e.property_id::text AS property_id,
         e.action,
         e.actor_id,
         e.created_at,
         e.delivery->'changed_fields' AS changed_fields
    FROM property_moderation_events e
    JOIN properties p ON p.id = e.property_id
   WHERE ${foundOnlinePropertySql('p')}
     AND e.action IN ('staff_listing_preview_saved', 'listing_facts_updated_with_status')
   ORDER BY e.created_at ASC`;

const PROPERTIES_SQL = `
  SELECT id::text AS id, title, description, listing_type, property_type, area, district,
         extra_fields
    FROM properties
   WHERE id = ANY($1::uuid[])`;

function asList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === 'string') {
    try { return asList(JSON.parse(value)); } catch (_) { return []; }
  }
  return [];
}

function eventIsStaff(event) {
  if (event.action === 'staff_listing_preview_saved') return true;
  return UUID_RE.test(String(event.actor_id || ''));
}

function storedDiffersFromTemplate(field, row) {
  const text = String(row[field] || '').trim();
  if (!text) return false;
  if (field === 'description') return !text.includes(TEMPLATE_MARKER);
  // The title the public page would build with no staff correction on file.
  const generated = buildThirdPartyPublicTitle({ ...row, extra_fields: {} }, {});
  return text !== String(generated || '').trim();
}

async function findCandidates(db) {
  const events = (await db.query(EVENTS_SQL)).rows.filter(eventIsStaff);
  const edited = new Map();
  for (const event of events) {
    const fields = asList(event.changed_fields).filter((field) => COPY_FIELDS.includes(field));
    if (!fields.length) continue;
    const set = edited.get(event.property_id) || new Set();
    fields.forEach((field) => set.add(field));
    edited.set(event.property_id, set);
  }
  if (!edited.size) return [];

  const rows = (await db.query(PROPERTIES_SQL, [[...edited.keys()]])).rows;
  const candidates = [];
  for (const row of rows) {
    const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
    const existing = asList(extra.staff_corrected_fields);
    const toAdd = [...edited.get(row.id)].filter((field) => storedDiffersFromTemplate(field, row) && !existing.includes(field));
    if (!toAdd.length) continue;
    candidates.push({
      id: row.id,
      title: row.title,
      existing,
      add: toAdd,
      staff_corrected_fields: [...new Set([...existing, ...toAdd])]
    });
  }
  return candidates.sort((a, b) => a.id.localeCompare(b.id));
}

async function run(db, { apply = false, log = console.log } = {}) {
  const candidates = await findCandidates(db);
  log(`Found-online rows with staff edits not marked as corrected: ${candidates.length}`);
  candidates.forEach((item) => {
    log(`  ${item.id}  would set staff_corrected_fields = ${JSON.stringify(item.staff_corrected_fields)}  (${String(item.title || '').slice(0, 60)})`);
  });

  if (!apply) {
    log('Dry run: nothing was written. Re-run with --apply to write.');
    return { applied: false, candidates: candidates.length, updated: 0, ids: candidates.map((item) => item.id) };
  }

  let updated = 0;
  for (const item of candidates) {
    const result = await db.query(
      `UPDATE properties
          SET extra_fields = jsonb_set(COALESCE(extra_fields, '{}'::jsonb), '{staff_corrected_fields}', $2::jsonb, true),
              updated_at = NOW()
        WHERE id = $1`,
      [item.id, JSON.stringify(item.staff_corrected_fields)]
    );
    if (result.rowCount) updated += 1;
  }
  log(`Updated ${updated} rows. Public caches expire by themselves within a few minutes.`);
  return { applied: true, candidates: candidates.length, updated, ids: candidates.map((item) => item.id) };
}

module.exports = { run, findCandidates, EVENTS_SQL, PROPERTIES_SQL };

if (require.main === module) {
  const db = require('../config/database');
  run(db, { apply: process.argv.includes('--apply') })
    .then(() => (db.pool ? db.pool.end() : undefined))
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
