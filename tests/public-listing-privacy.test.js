'use strict';

/**
 * 9 Oct 2026. An anonymous GET /api/properties/:id returned the moderator's
 * notes and reasons, who reviewed the listing and when, the owner-edit token
 * expiry, the lister's billing log, whether an ID was on file, and for owner and
 * agent listings the lister's own phone and email. GET /api/agents/:id returned
 * each listing's raw extra_fields and the agent's user id and verification note.
 * The public row was SELECT p.* minus three columns: a deny-list, so every new
 * column went public the day it was added.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  PUBLIC_LISTING_KEYS,
  publicListingPayload,
  publicAgentPayload,
  publicAgentListingPayload
} = require('../utils/publicListingPayload');

const PRIVATE_LISTING_KEYS = [
  'moderation_notes', 'moderation_reason', 'moderation_checklist', 'moderation_stage',
  'reviewed_by', 'reviewed_at', 'approved_at', 'rejected_at', 'owner_edit_token_hash',
  'owner_edit_token_expires_at', 'owner_last_edited_at', 'lister_billing_log',
  'lister_billing_suspended_at', 'lister_paid_until', 'id_number', 'id_number_present',
  'id_document_present', 'id_document_url', 'last_moderation_notification_at',
  'lister_email', 'lister_phone', 'verification_terms_accepted', 'some_future_column'
];

function fixtureRow() {
  const row = {
    id: 'p1', title: 'House for Sale in Kira', description: 'Nice', price: 100, status: 'approved',
    listing_type: 'sale', district: 'Wakiso', area: 'Kira', public_contact_phone: '+256700000001',
    agent_id: 'a1', lister_name: 'Agent A', images: [{ id: 'i1', url: 'u' }],
    approved_at: '2026-10-01T00:00:00Z', extra_fields: { video_urls: ['v'] }
  };
  for (const key of PRIVATE_LISTING_KEYS) row[key] = row[key] ?? `secret-${key}`;
  return row;
}

test('an anonymous listing carries none of the private fields', () => {
  const out = publicListingPayload(fixtureRow());
  for (const key of PRIVATE_LISTING_KEYS) {
    assert.ok(!(key in out), `${key} must not be public`);
  }
  assert.strictEqual(out.title, 'House for Sale in Kira');
  assert.strictEqual(out.public_contact_phone, '+256700000001', 'the public contact stays');
});

test('a column added later is private until someone lists it on purpose', () => {
  const out = publicListingPayload({ ...fixtureRow(), brand_new_internal_flag: true });
  assert.ok(!('brand_new_internal_flag' in out));
});

test('the approval date is still available as the publication date', () => {
  const out = publicListingPayload(fixtureRow());
  assert.strictEqual(out.published_at, '2026-10-01T00:00:00Z');
  assert.ok(!('approved_at' in out));
});

test('staff and an owner with a valid token still get the whole row', () => {
  const row = fixtureRow();
  const out = publicListingPayload(row, { privileged: true });
  assert.strictEqual(out.moderation_notes, row.moderation_notes);
  assert.strictEqual(out.lister_phone, row.lister_phone);
});

test('no private key is on the allow-list', () => {
  for (const key of PRIVATE_LISTING_KEYS) {
    assert.ok(!PUBLIC_LISTING_KEYS.has(key), `${key} is on the public allow-list`);
  }
});

test('the property routes pass the privilege decision, not a constant', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'properties.js'), 'utf8');
  assert.match(src, /publicPropertyRow\(property, images, \{ privileged: adminAccess \|\| ownerCanPreview \}\)/);
  assert.match(src, /publicPropertyRow\(property, images, \{ privileged: true \}\)/, 'the token-checked preview only');
  assert.match(src, /return publicListingPayload\(row, \{ privileged \}\);/);
});

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

test('a public agent has no user id and no verification note, but the profile page still knows its state', () => {
  const out = publicAgentPayload({
    id: 'a1', full_name: 'A', user_id: 'u-123',
    verification_reason: 'x [DIRECT_AGENT_AUTHORISED] y [STAFF_REVIEWED_PRIVATE_ID_PROFILE]'
  });
  assert.ok(!('user_id' in out));
  assert.ok(!('verification_reason' in out));
  assert.strictEqual(out.direct_agent_authorised, true);
  // C3: the internal review flags are staff-only.
  assert.ok(!('private_id_profile_reviewed' in out));
  assert.ok(!('profile_claim_pending' in out));
  assert.ok(!('profile_claim_pending' in publicAgentPayload({ id: 'a', verification_reason: '[DIRECT_AGENT_AUTHORISED]', profile_claim_pending: true })));
});

test('an agent listing exposes only public extra_fields', () => {
  const out = publicAgentListingPayload({
    id: 'p1',
    extra_fields: {
      video_urls: ['v'], public_contact_phone: '+256',
      moderation_reason: 'no', last_reviewed_by_actor: 'staff', staff_removed_image_urls: ['x'],
      whatsapp_employee_sender_phone_suffix: '1234', whatsapp_employee_message_id_received: 'm',
      data_integrity_review_confirmed_by: 'staff'
    }
  });
  assert.deepStrictEqual(Object.keys(out.extra_fields).sort(), ['public_contact_phone', 'video_urls']);
});

test('the agent routes use the helpers', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'agents.js'), 'utf8');
  assert.match(src, /rows\.rows\.map\(publicAgentPayload\)/);
  assert.match(src, /\.\.\.publicAgentPayload\(agent\.rows\[0\]\)/);
  assert.match(src, /listings\.rows\.map\(publicAgentListingPayload\)/);
});

test('the profile page keeps working from the new booleans', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');
  assert.match(src, /agent\.direct_agent_authorised === true \|\|/);
  assert.match(src, /typeof agent\.profile_claim_pending === "boolean"/);
});
