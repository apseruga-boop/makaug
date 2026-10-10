'use strict';

/**
 * C3 (10 Oct 2026, PRIVACY): /api/off-plan?country=AE returned 55 keys per
 * development, including staff user ids (created_by, updated_by, verified_by),
 * the developer brochure's private storage key (extra_fields.source_brochure),
 * internal extraction notes and facts_to_confirm, and, on a makaug-managed
 * project, the source agent's phone, email, WhatsApp and ids. Public off-plan
 * output now goes through an explicit allow-list.
 */

process.env.COUNTRY_CODE = 'UG';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');

const { publicOffPlanPayload } = require('../utils/publicOffPlanPayload');
const { publicAgentPayload } = require('../utils/publicListingPayload');

const FORBIDDEN_KEY_RE = /(_by$|storage|brochure_extraction|source_brochure|facts_to_confirm|source_agent_(phone|email|whatsapp|id|profile_id)|source_documents|confirmed_source_fields|public_preview_approved_|walkthrough_settings)/;
const hasDb = Boolean(process.env.DATABASE_URL);

function forbiddenKeys(value, trail = '') {
  if (Array.isArray(value)) return value.flatMap((item, index) => forbiddenKeys(item, `${trail}[${index}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, item]) => [
      ...(FORBIDDEN_KEY_RE.test(key) ? [`${trail}.${key}`] : []),
      ...forbiddenKeys(item, `${trail}.${key}`)
    ]);
  }
  return [];
}

const leakyRow = (overrides = {}) => ({
  id: '11111111-2222-4333-8444-555555555555',
  slug: 'beverly-park',
  name: 'Beverly Park',
  developer_name: 'Beverly Developments',
  country_code: 'AE',
  status: 'published',
  verification_status: 'partially_verified',
  description: 'Apartments near the beach.',
  area: 'Umm Al Quwain',
  district: 'Umm Al Quwain',
  latitude: 25.5,
  longitude: 55.6,
  unit_types: [{ name: '1 bed', bedrooms: 1, price_original: 900000, price_original_currency: 'AED', storage_ref: 'private/x' }],
  payment_plan: [{ label: 'Deposit', percent: 20 }],
  images: [{ url: 'https://media.makaug.com/off-plan/beverly/1.jpg', caption: 'Front', sha256: 'abc' }],
  videos: [],
  floor_plans: [],
  amenities: ['Pool'],
  created_by: 'staff-uuid-1',
  updated_by: 'staff-uuid-2',
  verified_by: 'staff-uuid-3',
  walkthrough_settings: { secret: true },
  brochure_settings: { theme: 'x' },
  source_agent_id: 'agent-1',
  source_agent_profile_id: 'agent-1',
  source_agent_status: 'approved',
  source_agent_name: 'Karim',
  source_agent_company: 'Karim Realty',
  source_agent_profile_photo_url: 'https://media.makaug.com/agents/karim.jpg',
  source_agent_bio: 'Bio',
  source_agent_phone: '+971500000000',
  source_agent_email: 'karim@example.com',
  source_agent_whatsapp: '+971500000000',
  extra_fields: {
    contact_mode: 'makaug_managed',
    country_name: 'United Arab Emirates',
    country_slug: 'uae',
    area_overview: 'Overview',
    map_precision: 'area_centroid',
    price_fx_rate_ugx: 1030,
    price_fx_as_of: '2026-10-01',
    public_path: '/off-plan/overseas/uae/beverly-park',
    source_brochure: { storage_ref: 'private/brochures/beverly.pdf', sha256: 'deadbeef', filename: 'b.pdf', bytes: 123 },
    brochure_extraction: { notes: 'internal', facts_to_confirm: ['price'], extracted_at: '2026-10-01' },
    facts_to_confirm: ['handover'],
    confirmed_source_fields: ['name'],
    source_documents: [{ storage_ref: 'x' }],
    public_preview_approved: true,
    public_preview_approved_by: 'staff-uuid-4',
    public_preview_approved_at: '2026-10-01'
  },
  ...overrides
});

test('a makaug-managed development: no staff ids, brochure storage, notes or agent contact', () => {
  const out = publicOffPlanPayload(leakyRow());
  assert.deepEqual(forbiddenKeys(out), []);
  assert.equal(out.source_agent_name, undefined, 'managed: makaug is the contact');
  assert.equal(out.name, 'Beverly Park');
  assert.equal(out.extra_fields.contact_mode, 'makaug_managed');
  assert.equal(out.extra_fields.price_fx_rate_ugx, 1030);
  assert.equal(out.extra_fields.public_path, '/off-plan/overseas/uae/beverly-park');
  assert.equal(out.images[0].url, 'https://media.makaug.com/off-plan/beverly/1.jpg');
  assert.equal(out.images[0].sha256, undefined);
  assert.equal(out.unit_types[0].price_original, 900000);
  assert.equal(out.unit_types[0].storage_ref, undefined);
  assert.ok(Object.keys(out).length < 45, `${Object.keys(out).length} keys`);
});

test('an agent-listed development shows only the agent\'s public name, company, photo and profile link', () => {
  const out = publicOffPlanPayload(leakyRow({ extra_fields: { contact_mode: 'agent', country_name: 'Kenya' } }));
  assert.deepEqual(forbiddenKeys(out), []);
  assert.equal(out.source_agent_name, 'Karim');
  assert.equal(out.source_agent_company, 'Karim Realty');
  assert.equal(out.source_agent_profile_photo_url, 'https://media.makaug.com/agents/karim.jpg');
  assert.equal(out.source_agent_public_path, '/agents/agent-1');
  assert.equal(out.source_agent_bio, undefined);
  const unapproved = publicOffPlanPayload(leakyRow({ source_agent_status: 'pending', extra_fields: { contact_mode: 'agent' } }));
  assert.equal(unapproved.source_agent_name, undefined);
});

test('the public routes and the assistant search use the allow-list; the page reads the profile path', () => {
  const route = fs.readFileSync(path.join(__dirname, '../routes/off-plan.js'), 'utf8');
  assert.match(route, /\(await listPublicDevelopments\(db, req\.query\)\)\.map\(publicOffPlanPayload\)/);
  assert.match(route, /development: publicOffPlanPayload\(development\)/);
  const ai = fs.readFileSync(path.join(__dirname, '../routes/ai.js'), 'utf8');
  assert.match(ai, /\.map\(publicOffPlanPayload\)/);
  const page = fs.readFileSync(path.join(__dirname, '../assets/off-plan.js'), 'utf8');
  assert.match(page, /project\.source_agent_public_path \|\| project\.source_agent_profile_id/);
});

test('public agent payloads drop the two internal review flags', () => {
  const out = publicAgentPayload({ id: 'a1', full_name: 'A', verification_reason: '[DIRECT_AGENT_AUTHORISED] [STAFF_REVIEWED_PRIVATE_ID_PROFILE]', private_id_profile_reviewed: true, profile_claim_pending: true });
  assert.ok(!('private_id_profile_reviewed' in out));
  assert.ok(!('profile_claim_pending' in out));
  assert.equal(out.direct_agent_authorised, true);
  const marketplace = fs.readFileSync(path.join(__dirname, '../routes/marketplace.js'), 'utf8');
  assert.doesNotMatch(marketplace, /private_id_profile_reviewed|profile_claim_pending/);
});

test('every public off-plan route against a database: no forbidden key', { skip: !hasDb }, async () => {
  const db = require('../config/database');
  const { publicRouter } = require('../routes/off-plan');
  const app = express();
  app.use(express.json());
  app.use('/api/off-plan', publicRouter);
  const id = crypto.randomUUID();
  const slug = `c3-leak-test-${Date.now().toString(36)}`;
  const row = leakyRow();
  try {
    const source = (await db.query(`SELECT * FROM off_plan_developments WHERE country_code = 'AE' AND status = 'published' LIMIT 1`)).rows[0];
    if (!source) return;
    await db.query(
      `INSERT INTO off_plan_developments
         SELECT (jsonb_populate_record(NULL::off_plan_developments,
           to_jsonb(d) || jsonb_build_object('id', $1::uuid, 'slug', $2::text, 'created_by', NULL, 'updated_by', NULL, 'verified_by', NULL,
             'extra_fields', d.extra_fields || $3::jsonb, 'walkthrough_settings', '{"secret":true}'::jsonb))).*
         FROM off_plan_developments d WHERE d.id = $4`,
      [id, slug, JSON.stringify(row.extra_fields), source.id]
    );
    for (const url of ['/api/off-plan?country=AE', `/api/off-plan/${slug}?country=AE`, '/api/off-plan?country=UG', '/api/off-plan?country=KE']) {
      const res = await request(app).get(url);
      assert.equal(res.status, 200, url);
      assert.deepEqual(forbiddenKeys(res.body), [], url);
      assert.doesNotMatch(JSON.stringify(res.body), /private\/brochures|deadbeef|storage_ref/, url);
    }
    const one = await request(app).get(`/api/off-plan/${slug}?country=AE`);
    assert.equal(one.body.development.slug, slug);
    assert.ok(one.body.development.name);
    assert.equal(one.body.development.extra_fields.country_slug, 'uae');
    const markets = await request(app).get('/api/off-plan/markets');
    assert.equal(markets.status, 200);
    assert.deepEqual(forbiddenKeys(markets.body), []);
  } finally {
    await db.query('DELETE FROM off_plan_developments WHERE id = $1', [id]).catch(() => {});
  }
});

test.after(async () => {
  try { await require('../config/database').pool.end(); } catch (_) {}
});
