'use strict';

// No listing is approved without at least 1 real photo on our media host
// (S3_PUBLIC_BASE_URL → media.makaug.com). Stock photos, the "image pending"
// evidence card, generated data: images and TikTok CDN links don't count, and
// no override flag gets past it. About 570 live listings had no real photo.

process.env.COUNTRY_CODE = 'UG';
process.env.S3_PUBLIC_BASE_URL = 'https://media.makaug.com';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const {
  realPhotoRejection,
  summariseListingPhotos,
  loadRealPhotoSummaries,
  NO_REAL_PHOTO_CODE
} = require('../utils/realListingPhoto');
const db = require('../config/database');
const propertiesRouter = require('../routes/properties');
const staffRouter = require('../routes/staff');

const HOSTED = 'https://media.makaug.com/properties/2026/10/abc123-living-room.jpg';
const PENDING_CARD = { url: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', slot_key: 'source_evidence_card', room_label: 'Source evidence card - image pending' };

test('each kind of non-photo is rejected with its own reason', () => {
  const cases = [
    ['data: SVG', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'generated_data_image'],
    ['data: PNG', 'data:image/png;base64,iVBORw0KGgo=', 'generated_data_image'],
    ['"image pending" card (data: SVG)', PENDING_CARD, 'generated_data_image'],
    ['"image pending" card (hosted URL)', 'https://media.makaug.com/cards/image-pending.png', 'image_pending_card'],
    ['"image pending" label on a hosted file', { url: 'https://media.makaug.com/x/card.png', room_label: 'Source evidence card - image pending' }, 'image_pending_card'],
    ['Unsplash stock photo', 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=900&q=80', 'stock_photo'],
    ['stock photo id on any host', 'https://media.makaug.com/photo-1560518883-ce09059eeffa.jpg', 'stock_photo'],
    ['tiktokcdn', 'https://p16-sign-va.tiktokcdn.com/obj/tos-maliva-p-0068/abc.jpeg', 'tiktok_cdn'],
    ['byteimg', 'https://p77-sign.byteimg.com/tos-maliva/abc~tplv.jpeg', 'tiktok_cdn'],
    ['another host', 'https://example.com/house.jpg', 'not_hosted_on_media'],
    ['look-alike host', 'https://media.makaug.com.evil.example/house.jpg', 'not_hosted_on_media'],
    ['relative path', '/uploads/house.jpg', 'not_hosted_on_media'],
    ['host root only', 'https://media.makaug.com/', 'not_hosted_on_media'],
    ['empty', '', 'empty']
  ];
  for (const [label, image, reason] of cases) {
    assert.equal(realPhotoRejection(image), reason, label);
  }
});

test('one photo hosted on media.makaug.com is enough', () => {
  assert.equal(realPhotoRejection(HOSTED), null);
  assert.equal(realPhotoRejection({ url: HOSTED, room_label: 'Living room' }), null);
  const summary = summariseListingPhotos([PENDING_CARD, { url: HOSTED }, 'https://images.unsplash.com/photo-1560518883-ce09059eeffa']);
  assert.equal(summary.ok, true);
  assert.equal(summary.real_photos, 1);
  assert.deepEqual(summary.rejected, { generated_data_image: 1, stock_photo: 1 });
  assert.equal(summariseListingPhotos([]).ok, false);
});

// ---- database-backed checks -------------------------------------------------

const created = [];
async function listingWith(images) {
  const id = (await db.query(
    `INSERT INTO properties (listing_type, title, description, district, area, price, status, extra_fields, listed_via)
     VALUES ('sale', 'Photo gate test', 'test', 'Kampala', 'Ntinda', 100000000, 'pending', '{}'::jsonb, 'website') RETURNING id`
  )).rows[0].id;
  created.push(id);
  for (const [index, image] of images.entries()) {
    const row = typeof image === 'string' ? { url: image } : image;
    await db.query(
      `INSERT INTO property_images (property_id, url, slot_key, room_label, is_primary, sort_order) VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, row.url, row.slot_key || null, row.room_label || null, index === 0, index]
    );
  }
  return id;
}

const app = express();
app.use(express.json());
app.use('/api/properties', propertiesRouter);

const ALL_OVERRIDES = {
  status: 'approved',
  sourced_candidate_override: true,
  sourced_candidate_special_dispensation: true,
  high_monthly_price_confirmed: true,
  price_basis_confirmed: true,
  override: true,
  force: true,
  warning_overrides: { photos: 'checked by staff', images: 'ok' }
};

test('status route refuses approval without a real photo, even with every override', async () => {
  for (const images of [
    [],
    ['https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=900&q=80'],
    [PENDING_CARD],
    ['https://p16-sign-va.tiktokcdn.com/obj/abc.jpeg', 'https://p77-sign.byteimg.com/abc.jpeg']
  ]) {
    const id = await listingWith(images);
    const response = await request(app)
      .patch(`/api/properties/${id}/status`)
      .set('x-api-key', process.env.ADMIN_API_KEY)
      .send(ALL_OVERRIDES);
    assert.equal(response.status, 422, JSON.stringify(images));
    assert.equal(response.body.code, NO_REAL_PHOTO_CODE);
    assert.equal(response.body.override_available, false);
    const status = (await db.query('SELECT status FROM properties WHERE id = $1', [id])).rows[0].status;
    assert.equal(status, 'pending');
  }
});

test('status route lets a listing with one hosted photo past the photo gate', async () => {
  const id = await listingWith([PENDING_CARD, HOSTED]);
  const response = await request(app)
    .patch(`/api/properties/${id}/status`)
    .set('x-api-key', process.env.ADMIN_API_KEY)
    .send({ status: 'approved' });
  assert.notEqual(response.body.code, NO_REAL_PHOTO_CODE, JSON.stringify(response.body).slice(0, 300));
});

test('staff bulk review holds approve-decisions with no real photo', async () => {
  const withPhoto = await listingWith([HOSTED]);
  const stockOnly = await listingWith(['https://images.unsplash.com/photo-1560518883-ce09059eeffa']);
  const none = await listingWith([]);
  const gate = staffRouter._test.applyStaffBulkRealPhotoGate;
  const out = await gate([
    { id: withPhoto, decision: 'approve' },
    { id: stockOnly, decision: 'approve' },
    { id: none, decision: 'approve' },
    { id: 'not-a-uuid', decision: 'approve' },
    { id: none, decision: 'hold', reason: 'duplicate' }
  ]);
  assert.deepEqual(out.map((d) => d.decision), ['approve', 'hold', 'hold', 'hold', 'hold']);
  assert.equal(out[1].reason, NO_REAL_PHOTO_CODE);
  assert.equal(out[4].reason, 'duplicate', 'existing holds are left alone');
  const map = await loadRealPhotoSummaries(db, [withPhoto, stockOnly]);
  assert.equal(map.get(String(withPhoto)).real_photos, 1);
  assert.deepEqual(map.get(String(stockOnly)).rejected, { stock_photo: 1 });
});

test('every approval path calls the gate', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'routes', file), 'utf8');
  const staff = read('staff.js');
  assert.match(staff, /applyStaffBulkRealPhotoGate\(applyStaffBulkInternalDuplicateGate\(/, 'bulk review');
  assert.match(staff, /async function approveStaffBulkFoundOnlineListing[\s\S]{0,200}listingPhotoOrVideoCheck\(client, row\.id\)/, 'bulk approve (inside the transaction)');
  assert.match(staff, /\['approved', 'live', 'published'\][\s\S]{0,120}listingPhotoOrVideoCheck\(db, req\.params\.id\)/, 'staff review stage');
  const props = read('properties.js');
  assert.match(props, /listingPhotoOrVideoCheck\(db, current\.id \|\| req\.params\.id\)/, 'status route');
  const admin = read('admin.js');
  assert.match(admin, /listingPhotoOrVideoCheck\(client, property\.id\)/, 'direct publish');
});

test.after(async () => {
  if (created.length) await db.query('DELETE FROM properties WHERE id = ANY($1::uuid[])', [created]).catch(() => {});
  await db.pool?.end?.().catch?.(() => {});
});
