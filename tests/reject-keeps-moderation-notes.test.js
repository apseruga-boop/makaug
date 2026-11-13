'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  isSystemRejectionPreviewNote,
  moderationNotesForRejection,
} = require('../utils/moderationNotes');

const EVIDENCE = 'Not a property advert. The YouTube post is a Luzira neighbourhood walk-through with no sale or rent ask, no bedrooms, and no plot details.';
const PREVIEW = 'Rejected from staff preview';
const REASON = 'Not a property listing';

test('the reject boilerplate is recognised and does not replace a staff evidence note', () => {
  assert.equal(isSystemRejectionPreviewNote(PREVIEW), true);
  assert.equal(isSystemRejectionPreviewNote(PREVIEW.toLowerCase()), true);
  assert.equal(isSystemRejectionPreviewNote(EVIDENCE), false);
  assert.equal(isSystemRejectionPreviewNote(REASON), false);

  const kept = moderationNotesForRejection(EVIDENCE, PREVIEW, { author: 'Moderator', at: new Date('2026-11-13T05:23:44Z') });
  assert.equal(kept, EVIDENCE);

  const emptyForm = moderationNotesForRejection(EVIDENCE, '', { author: 'Moderator', at: new Date('2026-11-13T05:23:44Z') });
  assert.equal(emptyForm, EVIDENCE);

  const emptyNull = moderationNotesForRejection(EVIDENCE, null, { author: 'Moderator', at: new Date('2026-11-13T05:23:44Z') });
  assert.equal(emptyNull, EVIDENCE);
});

test('a typed reject note is appended under the existing evidence note', () => {
  const next = moderationNotesForRejection(EVIDENCE, 'Confirmed with the source video: neighbourhood vlog only.', {
    author: 'Moderator',
    at: new Date('2026-11-13T05:23:44Z'),
  });
  assert.match(next, /Luzira neighbourhood walk-through/);
  assert.match(next, /Confirmed with the source video: neighbourhood vlog only/);
  assert.ok(next.startsWith(EVIDENCE));
  assert.doesNotMatch(next, /Rejected from staff preview/);
});

test('a real note under the reject boilerplate is kept and the boilerplate is stripped', () => {
  const incoming = `${PREVIEW}\nCall the lister if a real property advert is posted later.`;
  const next = moderationNotesForRejection(EVIDENCE, incoming, {
    author: 'Moderator',
    at: new Date('2026-11-13T05:23:44Z'),
  });
  assert.ok(next.startsWith(EVIDENCE));
  assert.match(next, /Call the lister if a real property advert is posted later/);
  assert.doesNotMatch(next, /Rejected from staff preview/);
});

test('the status reject path keeps the listing note and records the preview text on the event', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/properties.js'), 'utf8');
  const start = source.indexOf("router.patch('/:id/status'");
  const end = source.indexOf('const writeModerationAuditEvents');
  assert.ok(start >= 0 && end > start, 'status handler not found');
  const block = source.slice(start, end);
  assert.match(block, /moderationNotesForRejection\(/);
  assert.match(block, /listingModerationNotes/);
  assert.match(block, /eventNotes/);
  assert.match(block, /moderation_notes = COALESCE\(\$5::text, moderation_notes\)/);
  assert.match(block, /nextStatus === 'rejected'\s*\?[\s\S]*moderationNotesForRejection\(/);
  assert.match(block, /JSON\.stringify\(checklist\),\s*listingModerationNotes,/);
});

test('staff preview reject still sends the typed reason and may send the boilerplate as review_notes', () => {
  const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
  const start = app.indexOf('async function staffRejectPreviewListing');
  const end = app.indexOf('async function staffModerateListing');
  assert.ok(start >= 0 && end > start, 'staffRejectPreviewListing not found');
  const reject = app.slice(start, end);
  assert.match(reject, /status:\s*"rejected"/);
  assert.match(reject, /reason,/);
  assert.match(reject, /review_notes:\s*review\.notes \|\| "Rejected from staff preview"/);
  assert.match(reject, /reject_confirmed:\s*true/);
});

test('a staff-preview reject with an existing evidence note keeps that note and still applies the reason', async () => {
  const propertyId = '22222222-2222-4222-8222-222222222222';
  const row = {
    id: propertyId,
    title: 'Luzira neighbourhood walk-through',
    listing_type: 'sale',
    inquiry_reference: 'MK-20261113-FIX001',
    lister_name: 'Owner',
    lister_phone: '+256700000000',
    lister_email: 'owner@example.com',
    agent_id: null,
    source: 'youtube',
    listed_via: 'found_online',
    status: 'pending',
    price: 0,
    price_period: 'once',
    area: 'Luzira',
    district: 'Kampala',
    created_at: new Date().toISOString(),
    reviewed_at: null,
    approved_at: null,
    last_moderation_notification_at: null,
    moderation_stage: 'submitted',
    moderation_checklist: {},
    moderation_notes: EVIDENCE,
    moderation_reason: null,
    extra_fields: {},
    description: 'A neighbourhood vlog',
    property_type: 'house'
  };
  const updates = [];
  const dbPath = require.resolve('../config/database');
  const previousDb = require.cache[dbPath];
  const propertiesPath = require.resolve('../routes/properties');
  const previousProperties = require.cache[propertiesPath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      query: async (sql, params = []) => {
        const text = String(sql);
        if (/UPDATE\s+properties/i.test(text)) {
          updates.push({ sql: text, params });
          return {
            rows: [{
              ...row,
              status: 'rejected',
              moderation_reason: params[2] || REASON,
              moderation_notes: params[4],
              extra_fields: { ...(row.extra_fields || {}), moderation_reason: params[2] || REASON }
            }]
          };
        }
        if (/FROM\s+properties/i.test(text)) {
          return { rows: [{ ...row }] };
        }
        return { rows: [] };
      },
      pool: { end: async () => {} }
    }
  };
  delete require.cache[propertiesPath];
  process.env.ADMIN_API_KEY = 'reject-notes-replay-key';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'reject-notes-replay-secret';
  const express = require('express');
  const request = require('supertest');
  const propertiesRouter = require('../routes/properties');
  const app = express();
  app.use(express.json());
  app.use('/api/properties', propertiesRouter);

  try {
    const res = await request(app)
      .patch(`/api/properties/${propertyId}/status`)
      .set('x-api-key', 'reject-notes-replay-key')
      .send({
        status: 'rejected',
        reason: REASON,
        review_notes: PREVIEW,
        fast_admin_render: true,
        manual_notification_only: true,
        reject_confirmed: true,
        ui_control: 'staff_preview_reject_button'
      });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.data.status, 'rejected');
    assert.equal(res.body.data.moderation_reason, REASON);
    assert.equal(res.body.data.moderation_notes, EVIDENCE);
    assert.ok(updates.length >= 1, 'expected a properties UPDATE');
    const listingNotesParam = updates[0].params[4];
    assert.equal(listingNotesParam, EVIDENCE);
    assert.notEqual(listingNotesParam, PREVIEW);
  } finally {
    if (previousDb) require.cache[dbPath] = previousDb;
    else delete require.cache[dbPath];
    if (previousProperties) require.cache[propertiesPath] = previousProperties;
    else delete require.cache[propertiesPath];
  }
});
