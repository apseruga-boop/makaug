'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  isVerifiedByMakaug,
  verifiedByMakaugSql
} = require('../services/publicAgentEligibilityService');
const { publicAgentPayload } = require('../utils/publicListingPayload');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const reviewed = {
  id: 'agent-1',
  status: 'approved',
  full_name: 'Kazi Honest',
  licence_number: 'DIRECT-ABC',
  verification_reason: '[DIRECT_AGENT_AUTHORISED] [STAFF_REVIEWED_PRIVATE_ID_PROFILE] Staff reviewed the private identity evidence.',
  identity_document_url: 's3://private/agents/agent-1/identity',
  contact_phone_verified_at: '2026-10-01T08:00:00.000Z'
};

test('the verified tick is staff ID review plus a checked phone on an approved agent', () => {
  assert.equal(isVerifiedByMakaug(reviewed), true);
  assert.equal(isVerifiedByMakaug({ ...reviewed, status: 'pending' }), false);
  assert.equal(isVerifiedByMakaug({ ...reviewed, status: 'rejected' }), false);
  assert.equal(isVerifiedByMakaug({ ...reviewed, status: 'suspended' }), false);
  assert.equal(isVerifiedByMakaug({ ...reviewed, removed_at: '2026-10-02T00:00:00.000Z' }), false);
  assert.equal(isVerifiedByMakaug({
    ...reviewed,
    verification_reason: '[DIRECT_AGENT_AUTHORISED] Profile identity verification and account claim are pending.'
  }), false, 'direct onboarding without the ID review is not verified');
  assert.equal(isVerifiedByMakaug({ ...reviewed, identity_document_url: '' }), false);
  assert.equal(isVerifiedByMakaug({ ...reviewed, contact_phone_verified_at: null }), false);
  assert.equal(isVerifiedByMakaug({ ...reviewed, licence_number: 'FOUND-ONLINE-1' }), false);
  assert.equal(isVerifiedByMakaug({ ...reviewed, licence_number: 'SOCIAL-REALTOR-1' }), false);
  assert.equal(isVerifiedByMakaug({ ...reviewed, licence_number: 'TIKTOK-1' }), false);
  assert.equal(isVerifiedByMakaug({ ...reviewed, licence_number: 'FACEBOOK-1' }), false);
  assert.equal(isVerifiedByMakaug({ ...reviewed, licence_number: 'X-1' }), false);
  assert.equal(isVerifiedByMakaug({
    ...reviewed,
    verification_reason: `${reviewed.verification_reason} public social source onboarding`
  }), false);
  assert.equal(isVerifiedByMakaug({
    ...reviewed,
    verification_reason: `${reviewed.verification_reason} source profile`
  }), false);
  assert.equal(isVerifiedByMakaug({
    id: 'agent-2',
    status: 'approved',
    registration_status: 'registered',
    verification_reason: ''
  }), false, 'registered alone is not the tick');
});

test('a directory row can carry the precomputed flag without the private ID or phone stamp', () => {
  const directoryRow = {
    id: 'agent-1',
    status: 'approved',
    licence_number: 'DIRECT-ABC',
    verification_reason: reviewed.verification_reason,
    verified_by_makaug: true
  };
  assert.equal(isVerifiedByMakaug(directoryRow), true);
  assert.equal(isVerifiedByMakaug({ ...directoryRow, verified_by_makaug: false }), false);
  assert.equal(isVerifiedByMakaug({ ...directoryRow, status: 'pending', verified_by_makaug: true }), false);
});

test('the public agent payload exposes only the boolean', () => {
  const out = publicAgentPayload(reviewed);
  assert.equal(out.verified_by_makaug, true);
  assert.equal(out.direct_agent_authorised, true);
  assert.equal('verification_reason' in out, false);
  assert.equal('identity_document_url' in out, false);
  assert.equal('identity_document_name' in out, false);
  assert.equal('contact_phone_verified_at' in out, false);
  assert.equal('user_id' in out, false);

  const pending = publicAgentPayload({
    ...reviewed,
    status: 'pending',
    verification_reason: '[DIRECT_AGENT_AUTHORISED] Profile identity verification and account claim are pending.',
    identity_document_url: '',
    contact_phone_verified_at: null
  });
  assert.equal(pending.verified_by_makaug, false);
  assert.equal(pending.direct_agent_authorised, true);
});

test('the public agent queries use the same predicate and do not select the ID document', () => {
  const sql = verifiedByMakaugSql('a');
  assert.match(sql, /STAFF_REVIEWED_PRIVATE_ID_PROFILE/);
  assert.match(sql, /contact_phone_verified_at IS NOT NULL/);
  assert.match(sql, /identity_document_url/);
  assert.match(sql, /removed_at IS NULL/);
  assert.match(sql, /FOUND-ONLINE/);
  const agents = read('routes/agents.js');
  assert.equal((agents.match(/verifiedByMakaugSql\('a'\)/g) || []).length, 2);
  const directory = agents.slice(agents.indexOf("router.get('/',"), agents.indexOf("router.get('/:id',"));
  const profile = agents.slice(agents.indexOf("router.get('/:id',"), agents.indexOf("router.post('/register',"));
  assert.doesNotMatch(directory, /a\.identity_document_url/);
  assert.doesNotMatch(directory, /a\.contact_phone_verified_at/);
  assert.doesNotMatch(profile, /a\.identity_document_url/);
  assert.doesNotMatch(profile, /a\.contact_phone_verified_at/);
});

test('the badge sits after the name, defaults to the rosette, and stays off unless the flag is set', () => {
  const app = read('assets/makaug-app.js');
  const html = read('index.html');
  assert.match(app, /const fallback = "a"/);
  assert.match(app, /verifiedBadge/);
  assert.match(app, /localhost/);
  assert.match(app, /if \(!agentShowsVerifiedBadge\(broker\)\) return ""/);
  assert.match(app, /aria-label="\$\{adminAttr\(label\)\}"/);
  assert.match(app, /Verified by makaug: ID and phone checked by our team/);
  assert.match(app, /VERIFIED_ROSETTE_PATH/);
  assert.match(app, /<circle cx="12" cy="12" r="10"/);
  assert.match(app, /linearGradient/);
  assert.match(app, /var\(--makaug-green, #15803d\)/);
  assert.match(html, /--makaug-green: #15803d/);
  assert.match(html, /--makaug-green-dark: #14532d/);
  const card = app.slice(app.indexOf('function brokerCardHtml'), app.indexOf('function renderBrokers'));
  const nameAt = card.indexOf('broker-card-name');
  const tickAt = card.indexOf('verifiedAgentBadgeHtml(b, 18)');
  assert.ok(nameAt > 0 && tickAt > nameAt, 'the card tick follows the name');
  const profileStart = app.indexOf('async function openBrokerProfile(');
  const profile = app.slice(profileStart, profileStart + 20000);
  assert.match(profile, /broker-profile-name[\s\S]*verifiedAgentBadgeHtml\(b, 22\)/);
  const detail = app.slice(app.indexOf('detail-broker-profile-link'), app.indexOf('detail-broker-profile-link') + 1200);
  assert.match(detail, /detail-broker-name[\s\S]*verifiedAgentBadgeHtml\(broker, 18\)/);
  assert.doesNotMatch(app, /label: translateListingLabel\("Identity verified"\)/);
});
