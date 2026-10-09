'use strict';

/**
 * 9 Oct 2026. Staff edits made before #366 never wrote
 * extra_fields.staff_corrected_fields, so found-online listings kept showing the
 * generated "... is a third-party property result ..." text instead of the title
 * and description staff typed. The backfill is dry-run by default.
 */

const test = require('node:test');
const assert = require('node:assert');
const { run, findCandidates } = require('../scripts/backfill-staff-corrected-fields');
const { publicCopyReviewed, buildThirdPartyPublicTitle } = require('../services/publicListingCopy');

const STAFF_UUID = '5b1b966c-b44f-5afb-9bad-90d7fb31ce47';

// Rows as the two queries return them.
const edited = {
  id: '2934186b-36a6-4708-96c7-202efd898014',
  title: 'Three bedroom house in Muyenga',
  description: 'Staff wrote this description after speaking to the agent.',
  listing_type: 'sale',
  property_type: 'house',
  area: 'Muyenga',
  district: 'Kampala',
  extra_fields: { found_online: true }
};
const untouched = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  title: 'Edited only the price',
  description: 'Some text that staff did not write; changed fields lists only price.',
  extra_fields: { found_online: true }
};
const alreadyMarked = {
  id: 'bbbbbbbb-0000-4000-8000-000000000002',
  title: 'Already marked title',
  description: 'Already marked description',
  extra_fields: { found_online: true, staff_corrected_fields: ['title', 'description'] }
};
const stillTemplate = {
  id: 'cccccccc-0000-4000-8000-000000000003',
  title: 'x',
  description: 'Title is a third-party property result found from TikTok. More text.',
  extra_fields: { found_online: true }
};

function makeDb({ events, rows }) {
  const calls = { reads: [], writes: [] };
  return {
    calls,
    async query(text, values) {
      if (/^\s*SELECT/i.test(text) && /property_moderation_events/.test(text)) {
        calls.reads.push('events');
        return { rows: events };
      }
      if (/^\s*SELECT/i.test(text)) {
        calls.reads.push('properties');
        const ids = values[0];
        return { rows: rows.filter((row) => ids.includes(row.id)) };
      }
      calls.writes.push({ text, values });
      return { rowCount: 1, rows: [] };
    }
  };
}

const events = [
  { property_id: edited.id, action: 'staff_listing_preview_saved', actor_id: STAFF_UUID, changed_fields: ['title', 'description', 'price'] },
  { property_id: untouched.id, action: 'staff_listing_preview_saved', actor_id: STAFF_UUID, changed_fields: ['price'] },
  { property_id: alreadyMarked.id, action: 'listing_facts_updated_with_status', actor_id: STAFF_UUID, changed_fields: ['title', 'description'] },
  // Changed fields say description, but the stored text is still the template.
  { property_id: stillTemplate.id, action: 'staff_listing_preview_saved', actor_id: STAFF_UUID, changed_fields: ['description'] },
  // The admin API logs its type as actor, not a staff user id: not a staff edit.
  { property_id: 'dddddddd-0000-4000-8000-000000000004', action: 'listing_facts_updated_with_status', actor_id: 'moderation_api', changed_fields: ['title'] }
];
const rows = [edited, untouched, alreadyMarked, stillTemplate, { id: 'dddddddd-0000-4000-8000-000000000004', title: 'Admin edit', description: 'Admin text', extra_fields: { found_online: true } }];

test('the dry-run lists a staff-edited fixture and writes nothing', async () => {
  const db = makeDb({ events, rows });
  const lines = [];
  const result = await run(db, { apply: false, log: (line) => lines.push(line) });
  assert.deepStrictEqual(db.calls.writes, [], 'a dry run must not write');
  assert.strictEqual(result.applied, false);
  assert.deepStrictEqual(result.ids, [edited.id]);
  assert.ok(lines.some((line) => line.includes(edited.id) && line.includes('["title","description"]')));
  assert.ok(lines.some((line) => /Dry run: nothing was written/.test(line)));
});

test('rows that are not staff edits of copy are left out', async () => {
  const candidates = await findCandidates(makeDb({ events, rows }));
  const ids = candidates.map((item) => item.id);
  assert.ok(!ids.includes(untouched.id), 'only price changed');
  assert.ok(!ids.includes(alreadyMarked.id), 'already marked');
  assert.ok(!ids.includes(stillTemplate.id), 'stored text is still the template');
  assert.ok(!ids.includes('dddddddd-0000-4000-8000-000000000004'), 'not a staff actor');
});

test('--apply unions the fields into staff_corrected_fields and keeps an existing list', async () => {
  const withExisting = { ...edited, extra_fields: { found_online: true, staff_corrected_fields: ['area'] } };
  const db = makeDb({ events: [events[0]], rows: [withExisting] });
  const result = await run(db, { apply: true, log: () => {} });
  assert.strictEqual(result.updated, 1);
  assert.strictEqual(db.calls.writes.length, 1);
  const [{ text, values }] = db.calls.writes;
  assert.match(text, /jsonb_set\(COALESCE\(extra_fields, '\{\}'::jsonb\), '\{staff_corrected_fields\}'/);
  assert.strictEqual(values[0], edited.id);
  assert.deepStrictEqual(JSON.parse(values[1]), ['area', 'title', 'description']);
});

test('after the fields are set, the public copy treats the staff title and description as reviewed', () => {
  const before = publicCopyReviewed({ ...edited }, {});
  assert.deepStrictEqual(before, { title: false, description: false }, 'template text before the backfill');
  const after = publicCopyReviewed({ ...edited, extra_fields: { found_online: true, staff_corrected_fields: ['title', 'description'] } }, {});
  assert.deepStrictEqual(after, { title: true, description: true });
  const publicTitle = buildThirdPartyPublicTitle({ ...edited, extra_fields: { found_online: true, staff_corrected_fields: ['title'] } }, {});
  assert.match(publicTitle, /Three bedroom house in Muyenga/);
});
