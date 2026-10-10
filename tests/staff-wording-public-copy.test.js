'use strict';

/**
 * P4 (10 Oct 2026): the public "Area highlights" on found-online listings read
 * "… Confirm the exact property pin and local amenities with the listing agent
 * before approval." The sanitisers only knew "Confirm the exact property pin
 * with the listing agent before approval", so the "and local amenities"
 * variant got through. Any "Confirm … before (public) approval" sentence and
 * "Pending King review …" are now stripped server-side and client-side, and
 * harvest no longer writes the instruction into a public field.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { cleanPublicListingCopy } = require('../services/publicListingCopy');
const { publicPropertyRow } = require('../routes/properties')._test;
const report = require('../scripts/report-staff-wording-in-public-copy');

const NEW_PHRASING = 'Akright City is a Uganda property search area. Confirm the exact property pin and local amenities with the listing agent before approval.';
const OLD_PHRASING = 'Ntinda is a Uganda property search area. Confirm the exact property pin with the listing agent before approval.';
const CASES = [
  [NEW_PHRASING, 'Akright City is a Uganda property search area.'],
  [OLD_PHRASING, 'Ntinda is a Uganda property search area.'],
  ['Quiet road. Confirm exact gate or plot pin with the agent before public approval. Water on site.', 'Quiet road. Water on site.'],
  ['Four bedrooms. Confirm final pin, bathrooms, title details, and availability before approval.', 'Four bedrooms.'],
  ['Big garden. Pending King review of exact pin and title. Parking.', 'Big garden. Parking.'],
  ['Pending King review', '']
];
const KEEP = [
  'Confirm with the agent that water is connected.',
  'Approval of the building plan was granted in 2024.',
  'Three bedrooms, two bathrooms and a garden.'
];

function clientSanitizer() {
  const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
  const start = app.indexOf('function sanitizePublicListingCopyForUi');
  const end = app.indexOf('function getLocalizedPropertyHighlights', start);
  assert.ok(start > 0 && end > start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${app.slice(start, end)}; this.fn = sanitizePublicListingCopyForUi;`, context);
  return context.fn;
}

test('server-side: both phrasings and the other staff instructions are stripped', () => {
  for (const [input, expected] of CASES) assert.equal(cleanPublicListingCopy(input), expected, input);
  for (const text of KEEP) assert.equal(cleanPublicListingCopy(text), text, 'ordinary copy is untouched');
});

test('client-side: the SPA sanitiser strips the same sentences', () => {
  const sanitize = clientSanitizer();
  for (const [input, expected] of CASES) assert.equal(sanitize(input), expected, input);
  for (const text of KEEP) assert.equal(sanitize(text), text);
});

test('the public API row has clean area highlights', () => {
  const row = publicPropertyRow({
    id: '56ec3ed3-3962-4aa1-aea1-4bf333279083',
    title: 'House for sale in Akright City',
    description: 'Six bedrooms.',
    listing_type: 'sale',
    area: 'Akright City',
    district: 'Wakiso',
    status: 'approved',
    source: 'social_search',
    listed_via: 'found_online',
    extra_fields: { found_online: true, source_platform: 'TikTok', area_highlights: NEW_PHRASING, staff_review_notes: ['Confirm the pin'] }
  }, []);
  assert.equal(row.extra_fields.area_highlights, 'Akright City is a Uganda property search area.');
  assert.equal(row.extra_fields.staff_review_notes, undefined, 'the staff-only note is not public');
  assert.doesNotMatch(JSON.stringify(row), /before approval|Pending King review/i);
});

test('harvest writes the instruction to a staff-only field, not area_highlights', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/socialSearchSourcedListingsService.js'), 'utf8');
  assert.match(source, /area_highlights: `\$\{item\.area\} is a \$\{TARGET_COUNTRY_NAME\} property search area\.`,/);
  assert.match(source, /staff_review_notes: \['Confirm the exact property pin and local amenities with the listing agent before approval\.'\]/);
  assert.doesNotMatch(source, /area_highlights: `[^`]*before approval/);
  const payload = fs.readFileSync(path.join(__dirname, '../utils/publicListingPayload.js'), 'utf8');
  assert.doesNotMatch(payload, /staff_review_notes/);
});

test('the report is read-only and lists the affected rows', async () => {
  const queries = [];
  const db = {
    async query(sql, values) {
      queries.push({ sql, values });
      return { rows: [
        { id: '56ec3ed3-3962-4aa1-aea1-4bf333279083', status: 'approved', title: 'House for sale in Akright City', in_area_highlights: true, in_description: false },
        { id: 'aa89974b-1a27-4a9a-9739-c87e8d8e4ba7', status: 'approved', title: 'House in Luzira', in_area_highlights: true, in_description: true }
      ] };
    }
  };
  const lines = [];
  const result = await report.run(db, { log: (line) => lines.push(line) });
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /^\s*SELECT/);
  assert.doesNotMatch(queries[0].sql, /\b(UPDATE|INSERT|DELETE)\b/i);
  assert.match(queries[0].sql, /status = 'approved'/);
  assert.equal(result.count, 2);
  assert.deepEqual(result.fieldCounts, { area_highlights: 2, description: 1 });
  assert.ok(lines.some((line) => line.includes('56ec3ed3-3962-4aa1-aea1-4bf333279083') && line.includes('area_highlights')));
  assert.ok(lines.some((line) => /Read-only report: nothing was written/.test(line)));
  for (const [input, expected] of CASES) {
    if (expected !== input) assert.equal(report.matchesStaffInstruction(input), true, input);
  }
  for (const text of KEEP) assert.equal(report.matchesStaffInstruction(text), false, text);
});

test('the report SQL runs against a real database', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    const result = await report.run(client, { all: true, log: () => {} });
    assert.ok(Number.isInteger(result.count));
    const { rows } = await client.query(`SELECT $1::text ~* $2 AS a, $3::text ~* $2 AS b, $4::text ~* $2 AS c`, [NEW_PHRASING, report.SQL_PATTERN, OLD_PHRASING, KEEP[0]]);
    assert.deepEqual(rows[0], { a: true, b: true, c: false });
  } finally {
    await client.end();
  }
});

test.after(async () => {
  try { await require('../config/database').pool.end(); } catch (_) {}
});
