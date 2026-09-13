'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const { Pool } = require('pg');
const { changeStaffPropertyImage, withoutImageUrls } = require('../services/staffPropertyMediaService');

test('removed URLs cannot survive in nested gallery or thumbnail metadata', () => {
  assert.deepEqual(withoutImageUrls({ thumbnail_url: 'bad', photos: ['bad', 'good'], raw: { image: 'bad', caption: 'keep' } }, new Set(['bad'])), {
    thumbnail_url: null, photos: ['good'], raw: { image: null, caption: 'keep' }
  });
});

test('image approval gate defaults to blocked and records an explicit human override', async () => {
  const source = fs.readFileSync(require.resolve('../routes/properties'), 'utf8');
  const start = source.indexOf('    const approvalOverrideBlockers = []');
  const end = source.indexOf("    if (nextStatus === 'approved') {", start);
  const gate = source.slice(start, end);
  for (const scenario of [
    { allowed: false, human_session: true, count: 0, blocked: true },
    { allowed: true, human_session: true, count: 0, blocked: false },
    { allowed: false, human_session: false, count: 0, blocked: true },
    { allowed: false, human_session: true, count: 2, blocked: false },
    { allowed: false, human_session: true, count: 2, status: 'blocked_wrong_media', blocked: true },
    { allowed: true, human_session: true, count: 0, video: true, blocked: false }
  ]) {
    let response;
    const context = {
      nextStatus: 'approved', current: { source: 'whatsapp_employee_intake', extra_fields: { media_validation_status: scenario.status || '', video_recovery_required: scenario.video === true } },
      humanApprovalAccess: scenario, approvalWarnings: [], req: { params: { id: 'listing' } },
      cleanText: (value) => String(value || '').trim(), asArray: (value) => Array.isArray(value) ? value : [],
      propertyExtraFieldsObject: (property) => property.extra_fields,
      db: { query: async () => ({ rows: [{ total: scenario.count }] }) },
      res: { status: () => ({ json: (value) => { response = value; } }) }
    };
    const result = await vm.runInNewContext(`(async () => { ${gate}; return approvalOverrideBlockers; })()`, context);
    assert.equal(Boolean(response), scenario.blocked);
    if (scenario.blocked) {
      assert.equal(response.approval_blocker, 'employee_media_quality');
      assert.equal(response.human_approval_override_available, scenario.human_session);
    } else if (scenario.allowed) {
      assert.equal(result[0].code, 'employee_media_quality');
      assert(result[0].missing_fields.includes('validated_property_image'));
    }
  }
});

test('photo controls render every image and preserve a restore action', () => {
  const source = fs.readFileSync(require.resolve('../assets/makaug-app.js'), 'utf8');
  const start = source.indexOf('function staffPreviewImagesHtml(');
  const end = source.indexOf('let staffPhotoChangePending', start);
  const context = { adminAttr: String, adminEscape: String, propertyIdArg: JSON.stringify, staffEmpty: String };
  vm.runInNewContext(source.slice(start, end), context);
  const html = context.staffPreviewImagesHtml(Array.from({ length: 20 }, (_, index) => ({ id: String(index), url: `photo-${index}` })), 'property', [{ id: 'old', url: 'old' }]);
  assert.equal((html.match(/>Remove photo</g) || []).length, 20);
  assert.equal((html.match(/>Restore photo</g) || []).length, 1);
  assert.match(context.staffPreviewImagesHtml([], 'property'), /No property photos are attached/);
});

test('photo removal and restoration endpoints require an authenticated staff session', async () => {
  const express = require('express');
  const request = require('supertest');
  const app = express();
  app.use('/api/staff', require('../routes/staff'));
  const path = '/api/staff/properties/00000000-0000-4000-8000-000000000001/images/10000000-0000-4000-8000-000000000001';
  for (const response of [await request(app).delete(path), await request(app).post(`${path}/restore`)]) {
    assert([401, 403].includes(response.status));
    assert.equal(response.body.ok, false);
  }
});

test('PostgreSQL removal, restore, ownership, cover selection and rollback', { skip: !process.env.TEST_STAFF_MEDIA_DATABASE_URL }, async () => {
  const pool = new Pool({ connectionString: process.env.TEST_STAFF_MEDIA_DATABASE_URL });
  const client = await pool.connect();
  const database = { getClient: async () => ({ query: client.query.bind(client), release() {} }) };
  const propertyId = '00000000-0000-4000-8000-000000000001';
  const otherId = '00000000-0000-4000-8000-000000000002';
  const photo1 = '10000000-0000-4000-8000-000000000001';
  const photo2 = '10000000-0000-4000-8000-000000000002';
  const evidenceId = '10000000-0000-4000-8000-000000000003';
  const actorId = '20000000-0000-4000-8000-000000000001';
  const change = (imageId, restore = false) => changeStaffPropertyImage({ propertyId, imageId, actorId, restore }, database);
  try {
    await client.query(`CREATE TEMP TABLE properties (id uuid PRIMARY KEY, status text DEFAULT 'pending', extra_fields jsonb, updated_at timestamptz);
      CREATE TEMP TABLE property_moderation_events (property_id uuid, actor_id uuid, action text, reason text, delivery jsonb);`);
    const schema = fs.readFileSync(require.resolve('../db/migrations/001_init.sql'), 'utf8');
    const imageDdl = schema.match(/CREATE TABLE IF NOT EXISTS property_images \([\s\S]+?\n\);/)[0];
    await client.query(imageDdl.replace('CREATE TABLE IF NOT EXISTS', 'CREATE TEMP TABLE'));
    await client.query('INSERT INTO properties (id, extra_fields) VALUES ($1,$2::jsonb),($3,\'{}\')', [propertyId, JSON.stringify({ primary_image_url: 'one', thumbnail_url: 'one', photo_urls: ['one', 'two'] }), otherId]);
    await client.query(`INSERT INTO property_images (id, property_id, url, is_primary, sort_order, slot_key)
      VALUES ($1,$4,'one',true,0,'primary'),($2,$4,'two',false,1,'extra_2'),($3,$4,'evidence',false,2,'source_evidence_original')`, [photo1, photo2, evidenceId, propertyId]);
    await assert.rejects(changeStaffPropertyImage({ propertyId: otherId, imageId: photo1, actorId }, database), { status: 404 });
    const removed = await change(photo1);
    assert.equal(removed.extra_fields.primary_image_url, 'two');
    assert.equal(removed.extra_fields.thumbnail_url, null);
    assert.equal(removed.extra_fields.public_image_count, 1);
    assert.equal(removed.images.find((image) => image.id === photo2).is_primary, true);
    assert.equal(removed.extra_fields.staff_removed_images.length, 1);
    const empty = await change(photo2);
    assert.equal(empty.extra_fields.primary_image_url, null);
    assert.equal(empty.extra_fields.public_image_count, 0);
    assert(empty.images.every((image) => !image.is_primary));
    const restored = await change(photo1, true);
    assert.equal(restored.extra_fields.primary_image_url, 'one');
    assert.equal(restored.extra_fields.public_image_count, 1);
    assert.deepEqual(restored.extra_fields.staff_removed_image_urls, ['two']);
    await assert.rejects(change(photo1, true), { status: 404 });
    await client.query("ALTER TABLE property_moderation_events ADD CONSTRAINT simulate_audit_failure CHECK (action <> 'staff_listing_photo_removed') NOT VALID");
    await assert.rejects(change(photo1), /simulate_audit_failure/);
    assert.equal((await client.query('SELECT COUNT(*)::int AS total FROM property_images WHERE id=$1', [photo1])).rows[0].total, 1);
    assert.equal((await client.query('SELECT status FROM properties WHERE id=$1', [propertyId])).rows[0].status, 'pending');
    assert.equal((await client.query('SELECT COUNT(*)::int AS total FROM property_moderation_events')).rows[0].total, 3);
  } finally {
    client.release();
    await pool.end();
  }
});
