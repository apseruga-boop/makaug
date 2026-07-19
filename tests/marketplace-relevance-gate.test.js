'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  MARKETPLACE_RELEVANCE_MARKER,
  classifyMarketplaceRelevance,
  googleSearchOptionsForCategory
} = require('../utils/marketplaceRelevance');
const {
  auditMarketplaceRelevance,
  googleCandidate,
  importMarketplaceSourceCandidates,
  searchGooglePlaces
} = require('../services/marketplaceNationalDripService');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function sourceRow(overrides = {}) {
  return {
    id: 'source-1',
    source_key: 'google_maps:plumbers:kisoro',
    source: 'google_maps',
    category: 'plumbers',
    district: 'Kisoro',
    query_text: 'plumber Kisoro Uganda',
    source_url: 'https://www.google.com/maps',
    metadata: {},
    ...overrides
  };
}

function place(overrides = {}) {
  return {
    id: 'places/ChIJ-test',
    displayName: { text: 'Kisoro Plumbing Services' },
    formattedAddress: 'Kisoro, Uganda',
    addressComponents: [
      { longText: 'Kisoro', shortText: 'Kisoro', types: ['administrative_area_level_1'] },
      { longText: 'Uganda', shortText: 'UG', types: ['country'] }
    ],
    internationalPhoneNumber: '+256 700 000 001',
    websiteUri: 'https://example.com',
    googleMapsUri: 'https://maps.google.com/?cid=123',
    location: { latitude: -1.285, longitude: 29.684 },
    types: ['plumber', 'point_of_interest', 'establishment'],
    ...overrides
  };
}

test('hard exclusions reject the production junk examples regardless of requested category', () => {
  const cases = [
    ['Kisoro International Vocational Institute', 'plumbers', ['school']],
    ['Kisoro Municipal Council Headquarters', 'plumbers', ['local_government_office']],
    ['Kisoro District Local Government Office', 'plumbers', ['government_office']],
    ['Muramba General Stores Hardware', 'plumbers', ['hardware_store']],
    ['Kapchorwa Police Station', 'security', ['police']],
    ['TotalEnergies Kyotera Service Station', 'commercial_services', ['gas_station']],
    ['Tororo Family Clinic', 'valuers', ['medical_clinic']],
    ['Rukungiri Hilltop Lodge', 'interior_design', ['lodging']]
  ];
  for (const [name, category, types] of cases) {
    const decision = classifyMarketplaceRelevance({ name, category, google_types: types });
    assert.equal(decision.decision, 'reject', `${name} should be rejected`);
  }
});

test('government office Google types require confirming government wording', () => {
  assert.equal(classifyMarketplaceRelevance({
    name: 'Orbit Surveys and Mapping Ltd',
    category: 'surveyors',
    google_types: ['local_government_office']
  }).decision, 'qualified');
  assert.equal(classifyMarketplaceRelevance({
    name: 'Magezi, Ibale & Co. Advocates',
    category: 'property_lawyers',
    google_types: ['lawyer', 'government_office']
  }).decision, 'qualified');
  assert.equal(classifyMarketplaceRelevance({
    name: 'Kisoro Municipal Council Headquarters',
    category: 'plumbers',
    google_types: ['local_government_office']
  }).decision, 'reject');
});

test('category evidence qualifies genuine businesses and queues only borderline evidence', () => {
  assert.equal(classifyMarketplaceRelevance({ name: 'Kampala Plumbing Services', category: 'plumbers', google_types: ['plumber'] }).decision, 'qualified');
  assert.equal(classifyMarketplaceRelevance({ name: 'Geo Land Surveyors Uganda', category: 'surveyors' }).decision, 'qualified');
  assert.equal(classifyMarketplaceRelevance({ name: 'Pearl Property Development Ltd', category: 'developers' }).decision, 'qualified');
  assert.equal(classifyMarketplaceRelevance({ name: 'Securiko Private Security Company', category: 'security' }).decision, 'qualified');
  assert.equal(classifyMarketplaceRelevance({ name: 'Housing Finance Uganda', category: 'mortgage_providers' }).decision, 'qualified');
  assert.equal(classifyMarketplaceRelevance({ name: 'Boundary Solutions Uganda', category: 'surveyors' }).decision, 'pending_review');
  assert.equal(classifyMarketplaceRelevance({ name: 'Elegant Decor Uganda', category: 'interior_design' }).decision, 'pending_review');
  assert.equal(classifyMarketplaceRelevance({ name: 'Acme Uganda Ltd', category: 'plumbers' }).decision, 'reject');
});

test('Google candidate relevance decides live, review, or no qualified result before insert', () => {
  const qualified = googleCandidate(place(), sourceRow());
  assert.equal(qualified.accepted, true);
  assert.equal(qualified.publication_status, 'live');
  assert.equal(qualified.relevance.decision, 'qualified');

  const review = googleCandidate(place({ displayName: { text: 'Kisoro Drainage Experts' }, types: ['point_of_interest'] }), sourceRow());
  assert.equal(review.accepted, true);
  assert.equal(review.publication_status, 'pending_review');

  const junk = googleCandidate(place({ displayName: { text: 'Kisoro International Vocational Institute' }, types: ['school'] }), sourceRow());
  assert.equal(junk.accepted, false);
  assert.equal(junk.reason, 'irrelevant');
});

test('source imports reject clear junk and demote weak found-online duplicates to review', async () => {
  const untouchedDb = {
    query: async () => assert.fail('clear junk must be rejected before a database query')
  };
  const rejected = await importMarketplaceSourceCandidates(untouchedDb, [{
    source: 'yellow_pages',
    name: 'Kisoro Municipal Council Headquarters',
    category: 'plumbers',
    district: 'Kisoro',
    phone: '+256700000001',
    source_url: 'https://example.com/kisoro-council'
  }]);
  assert.equal(rejected.rejected, 1);
  assert.equal(rejected.reasons['irrelevant:excluded_name:government'], 1);

  const writes = [];
  const db = {
    query: async (sql, params = []) => {
      writes.push({ sql, params });
      if (/SELECT id, status, source_type FROM marketplace_businesses/.test(sql)) {
        return { rows: [{ id: 'existing-business', status: 'live', source_type: 'found_online' }] };
      }
      return { rows: [] };
    }
  };
  const result = await importMarketplaceSourceCandidates(db, [{
    source: 'yellow_pages',
    name: 'Boundary Solutions Uganda',
    category: 'surveyors',
    district: 'Kisoro',
    phone: '+256700000002',
    source_url: 'https://example.com/boundary-solutions'
  }]);
  assert.equal(result.existing, 1);
  const update = writes.find((entry) => /status = CASE WHEN \$3::boolean/.test(entry.sql));
  assert.equal(update.params[2], true);
  assert.equal(writes.some((entry) => /business_relevance_review_queued/.test(entry.sql)), true);
});

test('Google Text Search uses strict includedType only for supported typed categories', async () => {
  assert.deepEqual(googleSearchOptionsForCategory('plumbers'), {
    queryTerm: 'plumber',
    includedType: 'plumber',
    strictTypeFiltering: true
  });
  assert.equal(googleSearchOptionsForCategory('surveyors').includedType, '');
  assert.equal(googleSearchOptionsForCategory('surveyors').queryTerm, 'land surveyor');

  const originalKey = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  let requestBody;
  try {
    await searchGooglePlaces(sourceRow(), {
      fetchImpl: async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return { ok: true, json: async () => ({ places: [] }) };
      }
    });
  } finally {
    if (originalKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
    else process.env.GOOGLE_MAPS_API_KEY = originalKey;
  }
  assert.equal(requestBody.includedType, 'plumber');
  assert.equal(requestBody.strictTypeFiltering, true);
});

test('relevance audit dry-run reports hidden, review and clean without mutating rows', async () => {
  const statements = [];
  const db = {
    query: async (sql) => {
      statements.push(sql);
      assert.match(sql, /FROM marketplace_businesses/);
      return {
        rows: [
          { id: '1', name: 'Kisoro Plumbing Services', category: 'plumbers', district: 'Kisoro', source_metadata: { google_types: ['plumber'] } },
          { id: '2', name: 'Boundary Solutions Uganda', category: 'surveyors', district: 'Kisoro', source_metadata: {} },
          { id: '3', name: 'Kapchorwa Police Station', category: 'security', district: 'Kapchorwa', source_metadata: { google_types: ['police'] } },
          { id: '4', name: 'Acme Uganda Ltd', category: 'plumbers', district: 'Kampala', source_metadata: {} }
        ]
      };
    }
  };
  const result = await auditMarketplaceRelevance(db, { dryRun: true });
  assert.equal(result.marker, MARKETPLACE_RELEVANCE_MARKER);
  assert.equal(result.scanned, 4);
  assert.equal(result.clean, 1);
  assert.equal(result.queued_review, 2);
  assert.equal(result.hidden, 1);
  assert.equal(statements.length, 1);
});

test('live relevance audit batches writes, records events and schedules affected cells for re-crawl', async () => {
  const statements = [];
  const client = {
    query: async (sql, params = []) => {
      statements.push({ sql, params });
      if (/SELECT id, name, category/.test(sql)) {
        return {
          rows: [
            { id: '11111111-1111-1111-1111-111111111111', name: 'Kapchorwa Police Station', category: 'security', district: 'Kapchorwa', source_metadata: { google_types: ['police'] } },
            { id: '22222222-2222-2222-2222-222222222222', name: 'Unknown Services Uganda', category: 'plumbers', district: 'Kisoro', source_metadata: {} }
          ]
        };
      }
      return { rows: [] };
    },
    release: () => {}
  };
  const db = {
    connect: async () => client,
    query: async (sql) => {
      if (/GROUP BY category/.test(sql)) return { rows: [] };
      if (/WITH filtered AS/.test(sql)) return { rows: [] };
      return { rows: [] };
    }
  };
  const result = await auditMarketplaceRelevance(db, { dryRun: false, actorId: 'test-admin' });
  assert.equal(result.hidden, 1);
  assert.equal(result.queued_review, 1);
  assert.equal(result.recheck_cells.length, 2);
  assert.equal(statements.some((entry) => /jsonb_to_recordset/.test(entry.sql) && /UPDATE marketplace_businesses/.test(entry.sql)), true);
  assert.equal(statements.some((entry) => /INSERT INTO marketplace_events/.test(entry.sql)), true);
  assert.equal(statements.some((entry) => /UPDATE marketplace_source_registry/.test(entry.sql)), true);
  assert.equal(statements.some((entry) => /SET cursor_offset = 0/.test(entry.sql)), true);
});

test('migration, protected API, admin telemetry and public marker ship together', () => {
  const migration = read('db/migrations/088_marketplace_relevance_gate.sql');
  const service = read('services/marketplaceNationalDripService.js');
  const admin = read('routes/admin.js');
  const app = read('assets/makaug-app.js');
  const html = read('index.html');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS relevance_status/);
  assert.match(migration, /idx_marketplace_businesses_relevance_status/);
  assert.match(service, /no_qualified_results/);
  assert.match(service, /relevance_exclusions_live/);
  assert.match(service, /relevance_checked_7d/);
  assert.match(admin, /router\.post\('\/marketplace-drip\/relevance-audit'/);
  assert.match(app, /Relevance integrity/);
  assert.match(app, /Preview relevance purge/);
  assert.match(html, new RegExp(MARKETPLACE_RELEVANCE_MARKER));
});
