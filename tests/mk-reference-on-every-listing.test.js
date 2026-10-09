'use strict';

/**
 * 9 Oct 2026. Every listing created by the WhatsApp employee (Agent 007) intake
 * since 29 Aug, 424 of them, and the 19 forwarded-for-review ones, had a NULL
 * inquiry_reference: the INSERT never set the column, so staff and agents had
 * no short MK reference to quote. The owner flow always set one.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
const { isListingReference, buildListingReference } = require('../services/listingReferenceService');

function insertBlocks() {
  const blocks = [];
  const re = /INSERT INTO properties \(/g;
  let m;
  while ((m = re.exec(source))) blocks.push(source.slice(m.index, source.indexOf('RETURNING', m.index) + 60));
  return blocks;
}

test('every property INSERT in the WhatsApp route sets inquiry_reference', () => {
  const blocks = insertBlocks();
  assert.ok(blocks.length >= 4, 'the route creates properties in several places');
  for (const block of blocks) {
    assert.match(block, /inquiry_reference/, `an INSERT omits the reference: ${block.slice(0, 120).replace(/\s+/g, ' ')}`);
  }
});

test('the employee intake generates it with the shared generator', () => {
  const start = source.indexOf("'whatsapp_employee_intake',$25)");
  assert.ok(start > 0, 'the employee INSERT returns the reference');
  assert.match(source.slice(start, start + 2500), /buildListingReference\(\)/);
});

test('the generator still produces the reference pattern', () => {
  assert.ok(isListingReference(buildListingReference()));
});

test('the employee batch summary shows the reference', () => {
  assert.match(source, /SELECT id::text AS id, title, inquiry_reference/);
  assert.match(source, /ref \*\$\{row\.inquiry_reference\}\*/);
});

test('the forwarded-review confirmation quotes the reference, not a fragment of the id', () => {
  assert.match(source, /Saved to review — \$\{forwardInquiryReference \|\|/);
});

test('the backfill dry-run writes nothing', async () => {
  const { run } = require('../scripts/backfill-missing-inquiry-references');
  const writes = [];
  const db = {
    async query(text, values) {
      if (/^\s*SELECT/i.test(text)) return { rows: [{ id: 'p1', source: 'whatsapp_employee_intake' }, { id: 'p2', source: 'whatsapp_employee_intake' }] };
      writes.push({ text, values });
      return { rowCount: 1, rows: [] };
    }
  };
  const result = await run(db, { apply: false, log: () => {} });
  assert.deepStrictEqual(writes, [], 'a dry run must not write');
  assert.strictEqual(result.missing, 2);
});

test('--apply assigns a well-formed reference to each, only where none exists', async () => {
  const { run } = require('../scripts/backfill-missing-inquiry-references');
  const writes = [];
  const db = {
    async query(text, values) {
      if (/^\s*SELECT/i.test(text)) return { rows: [{ id: 'p1', source: 'x' }, { id: 'p2', source: 'x' }] };
      writes.push({ text, values });
      return { rowCount: 1, rows: [] };
    }
  };
  const result = await run(db, { apply: true, log: () => {} });
  assert.strictEqual(result.assigned, 2);
  assert.strictEqual(writes.length, 2);
  for (const write of writes) {
    assert.ok(isListingReference(write.values[1]));
    assert.match(write.text, /COALESCE\(TRIM\(inquiry_reference\), ''\) = ''/, 'never overwrites an existing reference');
  }
});
