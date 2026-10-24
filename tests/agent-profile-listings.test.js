'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { basicAgentProfileVisible } = require('../services/agentBasicProfile');
const {
  approvedAgentListingsCountSql,
  countApprovedAgentListings,
  listApprovedAgentListingPage,
  parseAgentListingPage
} = require('../services/agentListingCount');
const { agentSlugBase, assignAgentSlugs } = require('../services/agentShortLink');
const { publicAgentProfileVisible, publicSitemapBasicAgentWhereSql } = require('../services/publicAgentEligibilityService');

const root = path.join(__dirname, '..');
const agentsRoute = fs.readFileSync(path.join(root, 'routes/agents.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');
const seo = fs.readFileSync(path.join(root, 'services/publicSeoService.js'), 'utf8');

const KELHAM_ID = '0702086e-60c3-42c2-8c04-8fc2fb926601';
const SEGAWA_ID = 'f1932d42-eddd-4bae-904d-b883600113ee';

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, endMarker);
  return source.slice(start, end);
}

test('directory and profile share one approved listing count', () => {
  const sql = approvedAgentListingsCountSql('a');
  assert.match(sql, /p\.agent_id = a\.id/);
  assert.match(sql, /p\.status = 'approved'/);
  assert.doesNotMatch(sql, /broker_agent_id/);
  const directory = sourceBetween(agentsRoute, "router.get('/',", 'const agentProfileEnquiryLimiter');
  const profile = sourceBetween(agentsRoute, 'async function loadPublicAgentProfileRow', "router.post('/register'");
  assert.match(directory, /approvedAgentListingsCountSql\('a'\)/);
  assert.match(profile, /approvedAgentListingsCountSql\('a'\)/);
  assert.match(profile, /listApprovedAgentListingPage/);
  assert.doesNotMatch(profile, /LIMIT 100/);
  assert.match(profile, /profile_kind/);
  assert.match(profile, /short_path/);
  assert.match(profile, /fallback: '\/brokers'/);
});

test('profile listing pages default to 24 and never exceed 48', () => {
  assert.deepEqual(parseAgentListingPage({}), { page: 1, limit: 24, offset: 0 });
  assert.deepEqual(parseAgentListingPage({ page: '2', limit: '100' }), { page: 2, limit: 48, offset: 48 });
  assert.equal(parseAgentListingPage({ page: '-4', limit: '0' }).limit, 24);
});

test('the profile count matches the directory count and paging returns every listing', async () => {
  const ids = Array.from({ length: 30 }, (_, index) => `listing-${String(index).padStart(2, '0')}`);
  const directoryCount = ids.length;
  const db = {
    async query(sql, params) {
      assert.match(sql, /p\.agent_id = a\.id|p\.agent_id = \$1/);
      assert.match(sql, /p\.status = 'approved'/);
      if (sql.includes('AS listings_count')) {
        assert.equal(sql.includes(approvedAgentListingsCountSql('a')), true);
        return { rows: [{ listings_count: directoryCount }] };
      }
      assert.match(sql, /LIMIT \$2 OFFSET \$3/);
      const limit = params[1];
      const offset = params[2];
      return { rows: ids.slice(offset, offset + limit).map((id) => ({ id, status: 'approved' })) };
    }
  };
  const counted = await countApprovedAgentListings(db, 'agent-1');
  const first = await listApprovedAgentListingPage(db, 'agent-1', { page: 1 });
  const second = await listApprovedAgentListingPage(db, 'agent-1', { page: 2 });
  assert.equal(counted, directoryCount);
  assert.equal(first.page.total, directoryCount);
  assert.equal(first.page.limit, 24);
  assert.equal(first.page.has_more, true);
  assert.equal(second.page.has_more, false);
  assert.equal(second.rows.length, 6);
  assert.deepEqual([...first.rows, ...second.rows].map((row) => row.id), ids);
});

test('a lister with live listings and no account gets a basic profile, not a full one', () => {
  const kelham = {
    id: KELHAM_ID,
    full_name: 'Kelham properties',
    status: 'approved',
    user_id: null,
    verification_reason: '[WHATSAPP_EMPLOYEE_AGENT_007] No identity document yet',
    licence_number: 'EMPLOYEE-INTAKE-35213A2DB1F54FEB',
    approved_listing_count: 2
  };
  assert.equal(publicAgentProfileVisible(kelham), false);
  assert.equal(basicAgentProfileVisible(kelham), true);
  assert.equal(basicAgentProfileVisible({ ...kelham, approved_listing_count: 0 }), false);
  assert.equal(basicAgentProfileVisible({ ...kelham, status: 'blocked' }), false);
  assert.equal(basicAgentProfileVisible({
    id: SEGAWA_ID,
    full_name: 'Imported profile',
    status: 'approved',
    user_id: null,
    verification_reason: 'public social source onboarding',
    licence_number: 'SOCIAL-9',
    approved_listing_count: 50
  }), false);
  assert.equal(basicAgentProfileVisible({
    ...kelham,
    full_name: 'QA TEST - DELETE agent',
    approved_listing_count: 4
  }), false);
});

test('short links are stable, unique, and redirect without entering the sitemap', () => {
  assert.equal(agentSlugBase('Francis Isabirye'), 'francis');
  assert.equal(agentSlugBase('Segawa Frederick Kevin SFK'), 'segawa');
  assert.equal(agentSlugBase('Sewa sewa'), 'sewa');
  assert.equal(agentSlugBase('Quick auctioneers'), 'quick-auctioneers');
  assert.equal(agentSlugBase('Quickway Auctioneers & Court Bailiffs'), 'quickway-auctioneers');
  assert.equal(agentSlugBase('George'), 'george');
  assert.equal(agentSlugBase('Kelham properties'), 'kelham-properties');
  assert.equal(agentSlugBase('Sharif Suda'), 'sharif');

  const francis = {
    id: '5674f6cb-37a0-4e1e-904f-06e03ec401ab',
    full_name: 'Francis Isabirye',
    status: 'approved',
    user_id: null,
    verification_reason: '[DIRECT_AGENT_AUTHORISED]',
    approved_listing_count: 361,
    created_at: '2024-01-01T00:00:00.000Z'
  };
  const laterFrancis = {
    ...francis,
    id: '11111111-1111-4111-8111-111111111111',
    full_name: 'Francis Other',
    created_at: '2025-01-01T00:00:00.000Z'
  };
  const segawa = {
    id: SEGAWA_ID,
    full_name: 'Segawa Frederick Kevin SFK',
    status: 'approved',
    user_id: null,
    verification_reason: '[WHATSAPP_EMPLOYEE_AGENT_007]',
    licence_number: 'EMPLOYEE-INTAKE-5CE249F743804761',
    approved_listing_count: 50,
    created_at: '2024-06-01T00:00:00.000Z'
  };
  const hidden = {
    id: '22222222-2222-4222-8222-222222222222',
    full_name: 'Social Source',
    status: 'approved',
    user_id: null,
    verification_reason: 'public social source onboarding',
    licence_number: 'SOCIAL-1',
    approved_listing_count: 9,
    created_at: '2020-01-01T00:00:00.000Z'
  };
  const assigned = assignAgentSlugs([laterFrancis, hidden, segawa, francis]);
  assert.equal(assigned.byId.get(francis.id), 'francis');
  assert.equal(assigned.byId.get(laterFrancis.id), 'francis-2');
  assert.equal(assigned.byId.get(segawa.id), 'segawa');
  assert.equal(assigned.byId.has(hidden.id), false);
  assert.equal(assigned.bySlug.get('francis').id, francis.id);

  assert.match(server, /app\.get\('\/a\/:slug'/);
  assert.match(server, /res\.redirect\(301, `\/agents\/\$\{encodeURIComponent\(agent\.id\)\}/);
  assert.match(app, /Load more/);
  assert.match(app, /id="agent-profile-live-count"/);
  assert.match(app, /Basic profile\. This page is built from this lister's live listings/);
  assert.match(app, /short_path/);
  assert.match(app, /Open the agents directory/);
  assert.doesNotMatch(sourceBetween(app, 'async function openBrokerProfile', 'function applyBrokerFilters'), /\$\{list\.length\}/);
  const basicSql = publicSitemapBasicAgentWhereSql('a');
  assert.match(basicSql, /p\.agent_id = a\.id/);
  assert.match(basicSql, /public social source onboarding/);
  assert.doesNotMatch(basicSql, /identity_document_url|removed_at|contact_phone_verified_at/);
  assert.match(seo, /publicSitemapBasicAgentWhereSql\('a'\)/);
  assert.doesNotMatch(sourceBetween(seo, 'function sitemapEntries', 'module.exports'), /\/a\//);
});
