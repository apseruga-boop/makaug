'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  DIRECT_AGENT_PROFILE_MARKER,
  REVIEWED_PRIVATE_ID_PROFILE_MARKER,
  publicAgentProfileVisible
} = require('../services/publicAgentEligibilityService');
const { resolvePublicPathAlias } = require('../services/publicPathAliases');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const KASULU_ID = '79e65895-a0c1-4b8e-ac95-c5a0cb2090d6';

function reviewedDirectAgent(overrides = {}) {
  return {
    id: KASULU_ID,
    full_name: 'Kasulu Francis Atwau',
    company_name: 'Agency/company',
    status: 'approved',
    user_id: null,
    email: 'agent@example.com',
    licence_number: 'REA-100',
    verification_reason: `${DIRECT_AGENT_PROFILE_MARKER} ${REVIEWED_PRIVATE_ID_PROFILE_MARKER}`,
    identity_document_stored: true,
    approved_listing_count: 0,
    ...overrides
  };
}

test('an approved reviewed direct agent with no live listings still has a public profile', () => {
  assert.equal(publicAgentProfileVisible(reviewedDirectAgent()), true);
  assert.equal(publicAgentProfileVisible(reviewedDirectAgent({
    full_name: 'Another Approved Agent',
    id: '11111111-1111-4111-8111-111111111111'
  })), true);
});

test('the same agent stays hidden until the private ID review is stored', () => {
  assert.equal(publicAgentProfileVisible(reviewedDirectAgent({
    identity_document_stored: false,
    identity_document_url: ''
  })), false);
  assert.equal(publicAgentProfileVisible(reviewedDirectAgent({
    verification_reason: DIRECT_AGENT_PROFILE_MARKER
  })), false);
  assert.equal(publicAgentProfileVisible(reviewedDirectAgent({
    status: 'pending'
  })), false);
});

test('approved agents outside the public directory stay hidden when they have no live listing', () => {
  assert.equal(publicAgentProfileVisible({
    id: '22222222-2222-4222-8222-222222222222',
    full_name: 'Self registered agent',
    status: 'approved',
    user_id: '33333333-3333-4333-8333-333333333333',
    verification_reason: '',
    approved_listing_count: 0
  }), false);
  assert.equal(publicAgentProfileVisible(reviewedDirectAgent({
    full_name: 'QA TEST - DELETE agent',
    approved_listing_count: 0
  })), false);
  assert.equal(publicAgentProfileVisible(reviewedDirectAgent({
    verification_reason: `${DIRECT_AGENT_PROFILE_MARKER} ${REVIEWED_PRIVATE_ID_PROFILE_MARKER} public social source onboarding`,
    licence_number: 'SOCIAL-1'
  })), false);
});

test('a blocked agent stays hidden, and one approved listing still opens the profile', () => {
  assert.equal(publicAgentProfileVisible(reviewedDirectAgent({
    status: 'rejected',
    approved_listing_count: 3
  })), false);
  assert.equal(publicAgentProfileVisible({
    id: '44444444-4444-4444-8444-444444444444',
    full_name: 'Listing agent',
    status: 'approved',
    user_id: '55555555-5555-4555-8555-555555555555',
    verification_reason: '',
    approved_listing_count: 1
  }), true);
});

test('agents the public API 404s stay hidden even when a listing names them', () => {
  assert.equal(publicAgentProfileVisible({
    id: '0702086e-60c3-42c2-8c04-8fc2fb926601',
    full_name: 'Listed without an account',
    status: 'approved',
    user_id: null,
    verification_reason: '',
    approved_listing_count: 4
  }), false);
  assert.equal(publicAgentProfileVisible(reviewedDirectAgent({
    full_name: 'QA TEST - DELETE agent',
    approved_listing_count: 2
  })), false);
  assert.equal(publicAgentProfileVisible({
    id: 'f1932d42-eddd-4bae-904d-b883600113ee',
    full_name: 'Imported profile',
    status: 'approved',
    user_id: null,
    verification_reason: 'public social source onboarding',
    licence_number: 'SOCIAL-9',
    approved_listing_count: 2
  }), false);
  assert.equal(resolvePublicPathAlias('/agents'), '/brokers');
  assert.equal(resolvePublicPathAlias('/agents/0702086e-60c3-42c2-8c04-8fc2fb926601'), '');
});

test('the sitemap only advertises approved agents a public profile can open', () => {
  const seo = fs.readFileSync(path.join(root, 'services/publicSeoService.js'), 'utf8');
  const eligibility = fs.readFileSync(path.join(root, 'services/publicAgentEligibilityService.js'), 'utf8');
  assert.match(seo, /agent_id,\s+EXISTS/);
  assert.match(seo, /publicSitemapAgentWhereSql\('a'\)/);
  assert.match(eligibility, /LOWER\(COALESCE\(\$\{a\}\.status, ''\)\) = 'approved'/);
  assert.match(eligibility, /user_id IS NOT NULL/);
  assert.match(eligibility, /DIRECT_AGENT_PROFILE_MARKER/);
});

test('the profile route uses that rule and does not 404 an agent only because they have no listing', () => {
  const start = server.indexOf('async function loadPublicAgentOpenGraphMeta');
  const end = server.indexOf('app.get([', start);
  const fn = server.slice(start, end);
  assert.match(fn, /publicAgentProfileVisible\(row\)/);
  assert.match(fn, /approved_listing_count/);
  assert.doesNotMatch(fn, /AND EXISTS \(/);
  assert.match(server, /if \(!meta\) return sendPublicNotFound\(req, res\)/);
  assert.equal(resolvePublicPathAlias(`/agents/${KASULU_ID}`), '');
});
