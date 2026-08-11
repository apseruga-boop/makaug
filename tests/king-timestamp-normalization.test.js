'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  isListingTimestampField,
  normalizeListingTimestampFields,
  normalizeListingTimestampValue
} = require('../utils/listingTimestamp');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('King approval converts the live Date.toString failure value to ISO-8601', () => {
  const raw = 'Mon Aug 10 2026 03:23:05 GMT+0000 (Coordinated Universal Time)';
  assert.equal(normalizeListingTimestampValue(raw, 'price_fx_as_of'), '2026-08-10T03:23:05.000Z');
  assert.equal(
    normalizeListingTimestampValue(new Date(raw), 'price_fx_as_of'),
    '2026-08-10T03:23:05.000Z'
  );
});

test('all listing date fields are normalized once while empty dates become null', () => {
  const patch = normalizeListingTimestampFields({
    title: 'Nakwero listing',
    price_fx_as_of: new Date('2026-08-10T03:23:05.000Z'),
    posted_at: '2026-08-10 03:23:05+00',
    first_posted_online_at: '2026-08-10',
    available_from: '',
    source_date_label: '10 Aug 2026'
  });
  assert.equal(patch.price_fx_as_of, '2026-08-10T03:23:05.000Z');
  assert.equal(patch.posted_at, '2026-08-10T03:23:05.000Z');
  assert.equal(patch.first_posted_online_at, '2026-08-10T00:00:00.000Z');
  assert.equal(patch.available_from, null);
  assert.equal(patch.source_date_label, '10 Aug 2026');
  assert.equal(isListingTimestampField('source_first_seen_at'), true);
  assert.equal(isListingTimestampField('availability_date'), true);
});

test('garbage listing dates fail as a clean field-specific 400', () => {
  assert.throws(
    () => normalizeListingTimestampFields({ posted_at: 'definitely-not-a-date' }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.code, 'INVALID_LISTING_TIMESTAMP');
      assert.equal(error.field, 'posted_at');
      assert.equal(error.message, 'posted_at is not a valid date');
      assert.deepEqual(error.details, ['posted_at is not a valid date']);
      return true;
    }
  );
});

test('status and review boundaries share timestamp normalization', () => {
  const properties = read('routes/properties.js');
  const admin = read('routes/admin.js');
  const frontend = read('assets/makaug-app.js');
  const server = read('server.js');

  assert.match(properties, /normalizeListingTimestampFields\(statusListingPatchFromBody/);
  assert.match(properties, /patch\.price_fx_as_of \?\? existing\.price_fx_as_of \?\? new Date\(\)/);
  assert.match(properties, /invalid_field: error\.field/);
  assert.match(admin, /const normalizedPatch = normalizeListingTimestampFields\(patch\)/);
  assert.match(admin, /if \(nested\) return normalizeListingTimestampFields\(nested\)/);
  assert.match(frontend, /function adminNormalizeReviewListingTimestamps/);
  assert.match(frontend, /return adminNormalizeReviewListingTimestamps\(\{/);
  assert.match(frontend, /delete normalized\[field\]/);
  assert.match(server, /king-timestamp-iso-normalization-20260811/);
});
