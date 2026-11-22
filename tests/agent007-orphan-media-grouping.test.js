'use strict';

/**
 * 11 Oct 2026: Arthur forwarded a Kira Nakwero house (3 photos) and a
 * Nabusugwe video. The captionless photos arrived before the captions, were
 * parked, and the Kira listing was saved with one picture while COMPLETE refused
 * ("media but no caption"). Parked media were then placed by kind, and on the
 * closest match when the batch closed.
 *
 * 22 Nov 2026: in a forwarded batch neither the order nor the kind said whose a
 * photo was; closing the batch would have put seven house photos on a plot.
 * Arthur: never guessed. Photos with no description are placed only when the
 * batch described one advert; otherwise they are held and named.
 */
const assert = require('assert');
const test = require('node:test');

process.env.NODE_ENV = 'test';
const db = require('../config/database');
const router = require('../routes/whatsapp');
const { settleEmployeeOrphanMedia, employeeMediaFamily, noteEmployeePropertyCreated, noteEmployeeBatchDescription } = router.__test;

const photo = (n) => ({ url: `https://x/p${n}.jpg`, sha256: `sha${n}`, kind: 'image', mimeType: 'image/jpeg', name: `p${n}.jpg` });
const clip = { url: 'https://x/v.mp4', sha256: 'shav', kind: 'video', mimeType: 'video/mp4', name: 'v.mp4' };

function sessionWithTwoProperties() {
  const data = { property_ids: [], pending_property_media: [photo(1), photo(2)] };
  noteEmployeePropertyCreated(data, 'nabusugwe-id', [clip], 'FAST SALE Nabusugwe 3 bedroom');
  noteEmployeeBatchDescription(data, 'FAST SALE Nabusugwe 3 bedroom');
  noteEmployeePropertyCreated(data, 'kira-id', [photo(3)], 'Kira Nakwero 4 bedrooms');
  noteEmployeeBatchDescription(data, 'Kira Nakwero 4 bedrooms');
  data.property_ids = ['nabusugwe-id', 'kira-id'];
  return data;
}

async function withStubbedDb(fn) {
  const originalQuery = db.query;
  const attempted = [];
  db.query = async (sql, params) => {
    if (/FROM properties\s+WHERE id = \$1 AND status = 'pending'/.test(sql)) attempted.push(params[0]);
    return { rows: [] };
  };
  try { await fn(attempted); } finally { db.query = originalQuery; }
}

test('video stills count as video, real photos as photos', () => {
  assert.strictEqual(employeeMediaFamily(clip), 'video');
  assert.strictEqual(employeeMediaFamily({ kind: 'image', name: 'video-key-frame-1.jpg' }), 'video');
  assert.strictEqual(employeeMediaFamily(photo(1)), 'image');
});

test('two adverts in the batch: parked photos are held, not placed by kind, even when the batch closes', async () => {
  await withStubbedDb(async (attempted) => {
    const data = sessionWithTwoProperties();
    await settleEmployeeOrphanMedia({ phone: '', data });
    assert.deepStrictEqual(attempted, []);
    await settleEmployeeOrphanMedia({ phone: '', data, final: true });
    assert.deepStrictEqual(attempted, [], 'held and named at COMPLETE instead');
  });
});

test('one advert in the batch: closing it places the parked photos on its property', async () => {
  await withStubbedDb(async (attempted) => {
    const data = { property_ids: ['kira-id'], pending_property_media: [photo(1), photo(2)] };
    noteEmployeePropertyCreated(data, 'kira-id', [photo(3)], 'Kira Nakwero 4 bedrooms');
    noteEmployeeBatchDescription(data, 'Kira Nakwero 4 bedrooms');
    await settleEmployeeOrphanMedia({ phone: '', data });
    assert.deepStrictEqual(attempted, [], 'not while the batch is open');
    await settleEmployeeOrphanMedia({ phone: '', data, final: true });
    assert.deepStrictEqual(attempted, ['kira-id']);
  });
});

test('a pending caption means the parked media is its own, so it is left alone', async () => {
  await withStubbedDb(async (attempted) => {
    const data = { property_ids: ['kira-id'], pending_property_media: [photo(1)] };
    noteEmployeePropertyCreated(data, 'kira-id', [photo(3)], 'Kira Nakwero 4 bedrooms');
    data.pending_property_caption = 'Selling 3 bedroom house in Entebbe';
    await settleEmployeeOrphanMedia({ phone: '', data, final: true });
    assert.deepStrictEqual(attempted, []);
  });
});
