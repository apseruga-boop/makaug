'use strict';

/**
 * 11 Oct 2026: Arthur forwarded a Kira Nakwero house (3 photos) and a
 * Nabusugwe video. The captionless photos arrived before the captions, were
 * parked, and the Kira listing was saved with one picture while COMPLETE refused
 * ("media but no caption"). Parked media must land on the matching property.
 */
const assert = require('assert');
const test = require('node:test');

process.env.NODE_ENV = 'test';
const db = require('../config/database');
const router = require('../routes/whatsapp');
const { settleEmployeeOrphanMedia, employeeMediaFamily, noteEmployeePropertyCreated } = router.__test;

const photo = (n) => ({ url: `https://x/p${n}.jpg`, sha256: `sha${n}`, kind: 'image', mimeType: 'image/jpeg', name: `p${n}.jpg` });
const clip = { url: 'https://x/v.mp4', sha256: 'shav', kind: 'video', mimeType: 'video/mp4', name: 'v.mp4' };

function sessionWithTwoProperties() {
  const data = { property_ids: [], pending_property_media: [photo(1), photo(2)] };
  noteEmployeePropertyCreated(data, 'nabusugwe-id', [clip], 'FAST SALE Nabusugwe 3 bedroom');
  noteEmployeePropertyCreated(data, 'kira-id', [photo(3)], 'Kira Nakwero 4 bedrooms');
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

test('parked photos go to the photo property, not the video one that was created first', async () => {
  await withStubbedDb(async (attempted) => {
    await settleEmployeeOrphanMedia({ phone: '', data: sessionWithTwoProperties() });
    assert.deepStrictEqual(attempted, ['kira-id']);
  });
});

test('while the match is ambiguous nothing is guessed, and closing the batch places the media on the closest match', async () => {
  await withStubbedDb(async (attempted) => {
    const data = { property_ids: ['a', 'b'], pending_property_media: [photo(1)] };
    noteEmployeePropertyCreated(data, 'a', [photo(8)], 'House A');
    noteEmployeePropertyCreated(data, 'b', [photo(9)], 'House B');
    await settleEmployeeOrphanMedia({ phone: '', data });
    assert.deepStrictEqual(attempted, [], 'two photo properties: wait, do not guess');
    await settleEmployeeOrphanMedia({ phone: '', data, final: true });
    assert.deepStrictEqual(attempted, ['b'], 'COMPLETE uses the most recent photo property');
  });
});

test('a pending caption means the parked media is its own, so it is left alone', async () => {
  await withStubbedDb(async (attempted) => {
    const data = sessionWithTwoProperties();
    data.pending_property_caption = 'Selling 3 bedroom house in Entebbe';
    await settleEmployeeOrphanMedia({ phone: '', data, final: true });
    assert.deepStrictEqual(attempted, []);
  });
});
