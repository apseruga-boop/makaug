'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildOffPlanPaymentSchedule,
  deleteArchivedDevelopment,
  isPublicationReady,
  isPubliclyVisible,
  normalizeDevelopmentRow,
  normalizeWritePayload,
  publicationBlockers,
  publicPreviewBlockers,
  slugify
} = require('../services/offPlanService');

test('permanent deletion is restricted to archived projects and writes a detached audit event', async () => {
  const queries = [];
  const archived = { id: '11111111-1111-4111-8111-111111111111', name: 'Archived QA Project', slug: 'archived-qa-project', country_code: 'UG', status: 'archived' };
  const db = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (/SELECT[\s\S]+off_plan_developments/.test(sql)) return { rows: [archived] };
      if (/DELETE FROM off_plan_developments/.test(sql)) return { rows: [archived] };
      if (/INSERT INTO off_plan_development_events/.test(sql)) return { rows: [{ id: 'event-1' }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  const deleted = await deleteArchivedDevelopment(db, archived.id, { actorId: 'admin-1', actorRole: 'admin' });
  assert.equal(deleted.id, archived.id);
  assert.equal(queries.filter(({ sql }) => /DELETE FROM off_plan_developments/.test(sql)).length, 1);
  const audit = queries.find(({ sql }) => /INSERT INTO off_plan_development_events/.test(sql));
  assert.equal(audit.values[0], null);
  assert.equal(JSON.parse(audit.values[5]).deleted_development_id, archived.id);
});

test('permanent deletion rejects any project that has not first been archived', async () => {
  const db = { query: async () => ({ rows: [{ id: '22222222-2222-4222-8222-222222222222', status: 'published' }] }) };
  await assert.rejects(() => deleteArchivedDevelopment(db, '22222222-2222-4222-8222-222222222222'), (error) => error.status === 409 && /Archive the project/.test(error.message));
});

test('payment calculator creates an exact dated UGX schedule', () => {
  const result = buildOffPlanPaymentSchedule({
    price_ugx: 450000000,
    deposit_percent: 15,
    reservation_fee_ugx: 5000000,
    months: 15,
    start_date: '2026-09-03',
    currency: 'UGX'
  });
  assert.equal(result.upfront_amount, 67500000);
  assert.equal(result.balance, 382500000);
  assert.equal(result.instalments.length, 15);
  assert.equal(result.instalments[0].due_date, '2026-10-03');
  assert.equal(result.instalments.at(-1).due_date, '2027-12-03');
  assert.equal(result.total_payable, 450000000);
  assert.equal(result.instalments.reduce((total, item) => total + item.amount, 0), result.balance);
});

test('reservation fee becomes upfront amount when it exceeds the deposit', () => {
  const result = buildOffPlanPaymentSchedule({ price_ugx: 100000000, deposit_percent: 2, reservation_fee_ugx: 5000000, months: 4, start_date: '2026-01-01' });
  assert.equal(result.upfront_amount, 5000000);
  assert.equal(result.total_payable, 100000000);
});

test('publication gate blocks incomplete and unverified source records', () => {
  const blockers = publicationBlockers({
    name: 'Entebbe Victoria Palms',
    status: 'pending_review',
    verification_status: 'needs_verification',
    area: 'Entebbe',
    district: 'Wakiso',
    images: [{ url: '/one.jpg' }, { url: '/two.jpg' }, { url: '/three.jpg' }],
    unit_types: [{ label: '2 Bedroom townhouse', price_original: 108000, price_original_currency: 'USD', price_ugx: null }]
  });
  assert.ok(blockers.includes('Verified developer name is required.'));
  assert.ok(blockers.includes('A verified map pin is required.'));
  assert.ok(blockers.includes('Every unit type needs a verified UGX price.'));
  assert.ok(blockers.includes('Staff verification must be marked complete.'));
});

test('publication gate accepts a fully verified record', () => {
  const project = {
    country_code: 'UG', status: 'published',
    name: 'Verified Project', developer_name: 'Verified Developer Ltd',
    description: 'A verified description with enough detail about the project, its homes, facilities, setting and delivery expectations for buyers.',
    area: 'Entebbe', district: 'Wakiso', latitude: 0.05, longitude: 32.46,
    completion_date: '2028-12-01', construction_progress: 25, units_total: 40, units_sold: 10,
    launch_price_ugx: 450000000, payment_plan_months: 15,
    verification_status: 'verified',
    unit_types: [{ bedrooms: 2, price_ugx: 450000000 }],
    payment_plan: [{ label: 'Buyer contribution', percent: 15 }],
    images: [{ url: '/1.jpg', caption: 'One' }, { url: '/2.jpg', caption: 'Two' }, { url: '/3.jpg', caption: 'Three' }]
  };
  const blockers = publicationBlockers(project);
  assert.deepEqual(blockers, []);
  assert.equal(isPublicationReady(project), true);
  assert.equal(isPublicationReady({ ...project, launch_price_ugx: null }), false);
});

test('a source-attributed partial project is public only with explicit preview approval', () => {
  const project = {
    country_code: 'UG', status: 'published', verification_status: 'partially_verified',
    name: 'Entebbe Victoria Palms', source_agent_id: 'c0bc49f9-aaaa-4093-b5c5-37ac73da7106', source_display_name: 'Kazi Honest',
    description: 'A source-labelled townhouse project preview with supplied prices and images while delivery and progress facts remain clearly unconfirmed.',
    area: 'Entebbe', district: 'Wakiso', latitude: 0.0512, longitude: 32.4637,
    launch_price_ugx: 410400000, payment_plan_months: 15,
    unit_types: [{ bedrooms: 2, price_original: 108000, price_original_currency: 'USD', price_ugx: 410400000 }],
    payment_plan: [{ label: 'Across 15 months', months: 15 }],
    images: [{ url: '/1.jpg', caption: 'One' }, { url: '/2.jpg', caption: 'Two' }, { url: '/3.jpg', caption: 'Three' }],
    extra_fields: { public_preview_approved: true }
  };
  assert.deepEqual(publicPreviewBlockers(project), []);
  assert.equal(isPubliclyVisible(project), true);
  assert.equal(isPublicationReady(project), false);
  assert.equal(isPubliclyVisible({ ...project, extra_fields: {} }), false);
});

test('a MakaUG-managed Kenya preview accepts verified source documents and partial unit pricing', () => {
  const project = {
    country_code: 'KE', status: 'published', verification_status: 'partially_verified',
    name: 'Spectre Westlands', source_display_name: 'Karim - supplied agent documents',
    description: 'A source-labelled overseas project preview with supplied layouts, prices, payment terms and clear buyer verification safeguards.',
    area: 'Westlands', district: 'Nairobi', latitude: -1.2676, longitude: 36.8108,
    launch_price_ugx: 259600000, payment_plan_months: 36,
    unit_types: [
      { bedrooms: 1, price_original: 8800000, price_original_currency: 'KES', price_ugx: 259600000 },
      { bedrooms: 1, price_original: null, price_original_currency: 'KES', price_ugx: null },
      { bedrooms: 2, price_original: 16700000, price_original_currency: 'KES', price_ugx: 492650000 }
    ],
    payment_plan: [{ label: 'Balance across 36 months', months: 36 }],
    images: [{ url: '/1.jpg', caption: 'One' }, { url: '/2.jpg', caption: 'Two' }, { url: '/3.jpg', caption: 'Three' }],
    extra_fields: { public_preview_approved: true, source_documents_verified: true, contact_mode: 'makaug_managed' }
  };
  assert.deepEqual(publicPreviewBlockers(project), []);
  assert.equal(isPubliclyVisible(project), true);
  assert.equal(isPubliclyVisible({ ...project, country_code: 'TZ' }), false);
});

test('publication gate rejects impossible sales totals and unlabelled media', () => {
  const blockers = publicationBlockers({
    name: 'Verified Project', developer_name: 'Verified Developer Ltd',
    description: 'A verified description with enough detail about the project, its homes, facilities, setting and delivery expectations for buyers.',
    area: 'Entebbe', district: 'Wakiso', latitude: 0.05, longitude: 32.46,
    completion_date: '2028-12-01', construction_progress: 25, units_total: 40, units_sold: 41,
    launch_price_ugx: 450000000, payment_plan_months: 15,
    verification_status: 'verified',
    unit_types: [{ bedrooms: 2, price_ugx: 450000000 }],
    payment_plan: [{ label: 'Buyer contribution', percent: 15 }],
    images: [{ url: '/1.jpg' }, { url: '/2.jpg', caption: 'Two' }, { url: '/3.jpg', caption: 'Three' }]
  });
  assert.ok(blockers.includes('Units sold cannot exceed total units.'));
  assert.ok(blockers.includes('At least three labelled project images are required.'));
});

test('write normalization defaults a new project to review state', () => {
  const payload = normalizeWritePayload({ name: '  Entebbe Victoria Palms  ', source_display_name: 'Mackenzie' });
  assert.equal(payload.slug, 'entebbe-victoria-palms');
  assert.equal(payload.status, 'pending_review');
  assert.equal(payload.verification_status, 'needs_verification');
  assert.equal(slugify('Kampala Heights & Homes'), 'kampala-heights-homes');
});

test('write normalization rejects malformed database identifiers and dates', () => {
  assert.throws(() => normalizeWritePayload({ name: 'Invalid agent', source_agent_id: 'not-a-uuid' }), /valid UUID/);
  assert.throws(() => normalizeWritePayload({ name: 'Invalid date', completion_date: '2028-02-30' }), /invalid/);
});

test('database DATE values stay calendar dates across server time zones', () => {
  const row = normalizeDevelopmentRow({ completion_date: new Date(2028, 11, 1) });
  assert.equal(row.completion_date, '2028-12-01');
});
