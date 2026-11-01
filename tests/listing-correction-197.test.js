'use strict';

// Migration 197 rejects only the 34 later copies from the overlapping TikTok
// import of 1 Nov 2026. Originals stay pending for human review.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'db/migrations/197_reject_tiktok_concurrent_import_repeats.sql'), 'utf8');
const rollback = fs.readFileSync(path.join(root, 'scripts/rollback-197-tiktok-repeat-duplicates.sql'), 'utf8');

const pairs = [...migration.matchAll(/\('(MK-20261101-[0-9A-F]{6})', '(MK-20261101-[0-9A-F]{6})', '(https:\/\/www\.tiktok\.com\/@[^/]+\/video\/\d+)'\)/g)]
  .map(([, repeat, original, url]) => ({ repeat, original, url }));
assert.strictEqual(pairs.length, 34, 'exactly 34 repeat/original pairs');
const repeats = new Set(pairs.map((p) => p.repeat));
const originals = new Set(pairs.map((p) => p.original));
assert.strictEqual(repeats.size, 34);
assert.strictEqual(originals.size, 34);
assert.strictEqual(new Set(pairs.map((p) => p.url)).size, 34, 'one pair per TikTok video');
for (const ref of repeats) assert(!originals.has(ref), `${ref} cannot be both repeat and original`);

// Only the repeat is locked and updated; the original is read for guards.
assert(migration.includes('WHERE inquiry_reference = pair.repeat_ref FOR UPDATE'));
assert(/UPDATE properties SET status = 'rejected'[\s\S]*WHERE id = r\.id;/.test(migration));
assert(!/WHERE id = o\.id/.test(migration), 'the original must never be updated');
for (const guard of [
  "r.status IS DISTINCT FROM 'pending'",
  "o.status IS DISTINCT FROM 'pending'",
  'r.created_at <= o.created_at',
  "COALESCE(r.extra_fields->>'canonical_source_url', '') <> pair.canonical_url",
  "COALESCE(o.extra_fields->>'canonical_source_url', '') <> pair.canonical_url",
]) assert(migration.includes(guard), `missing guard: ${guard}`);
assert(migration.includes('CREATE TABLE IF NOT EXISTS listing_correction_197_backup'));
assert(migration.includes("'duplicate_of', o.id::text"));
assert(migration.includes("IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG'"));
assert(migration.includes('skipped already_recorded'), 're-running must be a no-op');

assert(rollback.includes('jsonb_populate_record(NULL::properties, backup.before_row)'));
assert(rollback.includes("p.extra_fields ? 'listing_correction_197' AND p.status = 'rejected'"));
console.log('listing correction 197: ok');
