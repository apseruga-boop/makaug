'use strict';

// A listing that reached review with no photos can be given its photos from
// the staff review screen, and is then approvable; a failed upload never
// leaves a "photo" the real-photo gate refuses.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');

const db = require('../config/database');
const { addStaffPropertyImages } = require('../services/staffPropertyMediaService');
const { listingRealPhotoCheck } = require('../utils/realListingPhoto');

const created = [];
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const mediaBase = () => String(process.env.S3_PUBLIC_BASE_URL || 'https://media.makaug.com').replace(/\/$/, '');

async function bareListing() {
  const id = crypto.randomUUID();
  created.push(id);
  await db.query(
    `INSERT INTO properties (id, listing_type, title, description, district, area, price, status, moderation_stage, lister_name, lister_phone, lister_type, listed_via, source)
     VALUES ($1, 'land', 'photoupload test plot', 'x', 'Wakiso', 'Kira', 35000000, 'pending', 'in_review', 'Ann', '256700123444', 'owner', 'website', 'website')`,
    [id]
  );
  return id;
}

test.after(async () => {
  await db.query('DELETE FROM property_moderation_events WHERE property_id = ANY($1::uuid[])', [created]).catch(() => {});
  await db.query('DELETE FROM property_images WHERE property_id = ANY($1::uuid[])', [created]).catch(() => {});
  await db.query('DELETE FROM properties WHERE id = ANY($1::uuid[])', [created]).catch(() => {});
  await db.pool?.end?.().catch?.(() => {});
});

test('a listing with no photos is blocked, then approvable once a reviewer uploads one', async () => {
  const id = await bareListing();
  const before = await listingRealPhotoCheck(db, id);
  assert.equal(before.ok, false);
  const stored = [];
  const result = await addStaffPropertyImages(
    { propertyId: id, actorId: null, confirmRights: true, images: [{ data_url: PNG }, { data_url: PNG }] },
    db,
    { store: async (_url, options) => { const url = `${mediaBase()}/${options.keyPrefix}/${options.filename}.png`; stored.push(url); return url; } }
  );
  assert.equal(result.added, 2);
  assert.equal(result.images.filter((image) => image.is_primary).length, 1, 'exactly one cover photo');
  assert.equal(result.extra_fields.image_count, 2);
  assert.ok(stored.every((url) => url.includes(`properties/${id}/staff-images/`)));
  const after = await listingRealPhotoCheck(db, id);
  assert.equal(after.ok, true, 'the real-photo gate now passes');
  const event = await db.query(`SELECT action FROM property_moderation_events WHERE property_id = $1`, [id]);
  assert.ok(event.rows.some((row) => row.action === 'staff_listing_photos_uploaded'), 'the upload is on the moderation trail');
});

test('a storage failure saves nothing and says so; rights confirmation and image type are required', async () => {
  const id = await bareListing();
  await assert.rejects(
    addStaffPropertyImages({ propertyId: id, confirmRights: true, images: [{ data_url: PNG }] }, db, { store: async (url) => url }),
    (error) => error.status === 502 && /could not be saved to makaug media storage/.test(error.message)
  );
  const rows = await db.query('SELECT COUNT(*)::int AS n FROM property_images WHERE property_id = $1', [id]);
  assert.equal(rows.rows[0].n, 0, 'no data: URL row is left behind');
  await assert.rejects(addStaffPropertyImages({ propertyId: id, confirmRights: false, images: [{ data_url: PNG }] }, db), /Confirm/);
  await assert.rejects(addStaffPropertyImages({ propertyId: id, confirmRights: true, images: [{ data_url: 'data:text/plain;base64,aGk=' }] }, db), /JPG, PNG or WebP/);
});

test('the review screen offers the upload, explains the block, and no longer promises an override', () => {
  const app = fs.readFileSync('assets/makaug-app.js', 'utf8');
  const staff = fs.readFileSync('routes/staff.js', 'utf8');
  const admin = fs.readFileSync('routes/admin.js', 'utf8');
  assert.match(staff, /router\.post\('\/properties\/:id\/images', async/);
  assert.match(app, /\$\{propertyId \? staffPreviewPhotoUploadHtml\(propertyId, list\.length\) : ""\}/);
  assert.match(app, /\/api\/staff\/properties\/\$\{encodeURIComponent\(propertyId\)\}\/images`, \{\n      method: "POST"/);
  assert.doesNotMatch(app, /No property photos are attached\. A signed-in reviewer can use the human approval override/);
  assert.match(app, /no_photos: "This listing has no photos at all\."/);
  assert.match(app, /photoBlocked \? `<button type="button" onclick="focusListingPhotoUpload\(\)"/);
  assert.match(admin, /storedUploads\.some\(\(image\) => \/\^data:\/i\.test/, 'the admin upload refuses an unstored data: URL too');
});
