'use strict';

// Exercise the real staff router, authorization middleware and OCR service.
// The database is in memory; page links must never reach a downloader or OCR.
const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'video-caption-ocr-route-test-secret';

const MODERATOR_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const PUBLIC_USER_ID = 'aaaaaaaa-0000-4000-8000-000000000002';
const PROPERTY_ID = 'bbbbbbbb-0000-4000-8000-000000000001';
const users = new Map([
  [MODERATOR_ID, { id: MODERATOR_ID, role: 'moderator', status: 'active' }],
  [PUBLIC_USER_ID, { id: PUBLIC_USER_ID, role: 'buyer_renter', status: 'active' }]
]);
const properties = new Map();
const ocrRows = new Map();
const queries = [];

const fakeDb = {
  async query(sql, params = []) {
    const query = String(sql).replace(/\s+/g, ' ').trim();
    queries.push(query);
    if (/FROM users WHERE id = \$1/.test(query)) {
      const user = users.get(params[0]);
      return { rows: user ? [user] : [] };
    }
    if (/^INSERT INTO property_video_ocr/.test(query)) {
      const [propertyId, status, text, facts, conflicts, override, resolution, frameCount, videoCount, error] = params;
      ocrRows.set(propertyId, {
        property_id: propertyId,
        status,
        ocr_text: text,
        parsed_facts: JSON.parse(facts),
        conflicts: JSON.parse(conflicts),
        override: override ? JSON.parse(override) : null,
        resolution: resolution ? JSON.parse(resolution) : null,
        frame_count: frameCount,
        video_count: videoCount,
        error,
        updated_at: new Date().toISOString()
      });
      return { rows: [], rowCount: 1 };
    }
    if (/FROM property_video_ocr WHERE property_id = \$1/.test(query)) {
      const row = ocrRows.get(params[0]);
      return { rows: row ? [row] : [] };
    }
    if (/^UPDATE properties SET extra_fields/.test(query)) {
      const property = properties.get(params[0]);
      if (!property) return { rows: [], rowCount: 0 };
      property.extra_fields = { ...property.extra_fields, ...JSON.parse(params[1]) };
      return { rows: [], rowCount: 1 };
    }
    if (/FROM properties WHERE id = \$1/.test(query)) {
      const property = properties.get(params[0]);
      return { rows: property ? [property] : [] };
    }
    throw new Error(`Unexpected SQL in OCR route test: ${query.slice(0, 150)}`);
  }
};
require.cache[require.resolve('../config/database')] = {
  id: 'ocr-route-fake-db', filename: 'ocr-route-fake-db', loaded: true, exports: fakeDb
};

const fetchMock = test.mock.method(globalThis, 'fetch', async () => {
  throw new Error('Page links must not be downloaded');
});
const spawnMock = test.mock.method(childProcess, 'spawn', () => {
  throw new Error('Page links must not start ffmpeg or OCR');
});

const app = express();
app.use(express.json());
app.use('/api/staff', require('../routes/staff'));
app.use((error, req, res, next) => res.status(error.status || 500).json({ ok: false, error: error.message }));

const route = (id = PROPERTY_ID) => `/api/staff/properties/${id}/video-caption-ocr`;
const token = (id) => jwt.sign({ sub: id }, process.env.JWT_SECRET, { expiresIn: '5m' });

test.beforeEach(() => {
  queries.length = 0;
  ocrRows.clear();
  properties.clear();
  properties.set(PROPERTY_ID, {
    id: PROPERTY_ID,
    title: 'Page-link listing',
    description: '',
    area: 'Kira',
    district: 'Wakiso',
    price: 1000000,
    extra_fields: { video_url: 'https://www.youtube.com/watch?v=NQeagorxOiU' }
  });
  fetchMock.mock.resetCalls();
  spawnMock.mock.resetCalls();
});

test('anonymous requests cannot run OCR', async () => {
  const response = await request(app).post(route()).send({});
  assert.equal(response.status, 403);
  assert.deepEqual(response.body, { ok: false, error: 'Staff access required' });
  assert.equal(queries.length, 0);
  assert.equal(ocrRows.size, 0);
});

test('an authenticated public user cannot run OCR', async () => {
  const response = await request(app).post(route()).set('Authorization', `Bearer ${token(PUBLIC_USER_ID)}`).send({});
  assert.equal(response.status, 403);
  assert.equal(response.body.error, 'Staff access required');
  assert.equal(queries.length, 1, 'only the real authorization lookup ran');
  assert.match(queries[0], /FROM users WHERE id = \$1/);
  assert.equal(ocrRows.size, 0);
});

test('a staff request with an invalid listing UUID is rejected before OCR', async () => {
  const response = await request(app).post(route('invalid')).set('Authorization', `Bearer ${token(MODERATOR_ID)}`).send({});
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { ok: false, error: 'Invalid listing id' });
  assert.equal(queries.length, 1, 'only the authorization lookup ran');
  assert.equal(ocrRows.size, 0);
});

test('a staff YouTube check returns the saved final state and its display note', async () => {
  const response = await request(app).post(route()).set('Authorization', `Bearer ${token(MODERATOR_ID)}`).send({});
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.body.ok, true);
  assert.equal(response.body.data.id, PROPERTY_ID);
  const view = response.body.data.video_caption_ocr;
  assert.equal(view.status, 'not_checkable');
  assert.equal(view.error, 'external_video_page');
  assert.match(view.text, /Can't read text from a YouTube or TikTok link/);
  assert.match(view.text, /Watch the video to check it/);
  assert.deepEqual(view.facts, {});
  assert.deepEqual(view.conflicts, []);
  assert.equal(ocrRows.get(PROPERTY_ID).status, 'not_checkable');
  assert.deepEqual(properties.get(PROPERTY_ID).extra_fields.video_caption_ocr, view);
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(spawnMock.mock.callCount(), 0);
});

test.after(() => test.mock.restoreAll());
