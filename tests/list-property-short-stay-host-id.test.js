'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const service = require('../services/shortTermService');
const identity = require('../services/shortTermIdentityService');
const moderation = require('../services/shortTermModerationService');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
const html = read('index.html');
const app = read('assets/makaug-app.js');
const admin = read('assets/short-term-admin.js');
const route = read('routes/short-term.js');

const TEST_ID_PHOTO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const TEST_NIN = 'CMTESTID000001';

function baseListing(overrides = {}) {
  return {
    district: 'Kampala',
    area: 'Kololo',
    bedrooms: 1,
    max_guests: 2,
    base_nightly_ugx: 150000,
    host_name: 'Amina N',
    host_phone: '0780863394',
    right_to_let_declared: true,
    terms_accepted: true,
    listed_from: 'list-property',
    id_kind: 'national_id',
    id_number: TEST_NIN,
    id_document_name: 'id-front.png',
    id_document_url: TEST_ID_PHOTO,
    id_document_mime_type: 'image/png',
    ...overrides
  };
}

function fakeDb({ agent } = {}) {
  const queries = [];
  const handle = async (sql, params) => {
    queries.push({ sql, params });
    if (/nextval/.test(sql)) return { rows: [{ n: 91 }] };
    if (/FROM agents/.test(sql) && /identity_document_url/.test(sql)) {
      return { rows: agent ? [agent] : [] };
    }
    if (/FROM agents/.test(sql)) return { rows: [] };
    if (/INSERT INTO st_listing \(/.test(sql)) {
      return { rows: [{
        id: '33333333-3333-3333-3333-333333333333',
        reference: 'ST-000091',
        slug: 'stay',
        status: 'pending',
        moderation_stage: 'submitted',
        listed_via: 'website'
      }] };
    }
    return { rows: [] };
  };
  const client = { query: handle, release() {} };
  return { queries, db: { getClient: async () => client, query: handle } };
}

test('the short-stay form asks for a government ID photo and number', () => {
  assert.match(html, /id="lp-st-id-file"/);
  assert.match(html, /id="lp-st-id-type"/);
  assert.match(html, /id="lp-st-id-number"/);
  assert.match(html, /id="lp-st-id-on-file"/);
  assert.match(html, /never shown publicly/);
  assert.match(app, /function handleListPropertyShortStayIdFile/);
  assert.match(app, /A photo of the front of your government ID is required/);
  assert.match(app, /signedInShortStayAgentHasIdOnFile/);
  assert.match(app, /payload\.id_document_url/);
  assert.match(route, /requireHostIdentity: true/);
  assert.match(route, /staff\/listings\/:id\/id-document/);
});

test('the desk shows the ID, the form name to match, and an ID seen step', () => {
  assert.match(admin, /function identityPanelHtml/);
  assert.match(admin, /View ID \/ Load document/);
  assert.match(admin, /ID seen/);
  assert.match(admin, /data-st-view-id/);
  assert.match(admin, /\/id-document/);
  assert.match(admin, /Name on the form/);
  assert.match(moderation.REVIEW_CHECKS.find((item) => item.key === 'identity_checked').label, /ID seen/);
});

test('a list-property short stay without an ID is rejected', () => {
  const result = service.validateListingSubmission({
    district: 'Kampala',
    area: 'Kololo',
    host_name: 'Amina N',
    host_phone: '0780863394',
    right_to_let_declared: true,
    terms_accepted: true,
    listed_from: 'list-property'
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((line) => /photo of the front of your government ID/i.test(line)));
  assert.ok(result.errors.some((line) => /ID number/i.test(line)));
});

test('a PDF is not accepted as the host ID', () => {
  const result = service.validateListingSubmission(baseListing({
    id_document_name: 'id.pdf',
    id_document_url: 'data:application/pdf;base64,AAAA',
    id_document_mime_type: 'application/pdf'
  }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((line) => /PDFs are not accepted/i.test(line)));
});

test('a National ID number that is not the printed format is rejected', () => {
  const result = service.validateListingSubmission(baseListing({ id_number: '12345' }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((line) => /National ID number/i.test(line)));
});

test('a complete National ID photo and number is accepted', () => {
  const result = service.validateListingSubmission(baseListing());
  assert.equal(result.ok, true, result.errors && result.errors.join('; '));
  assert.equal(result.value.host_identity.kind, 'national_id');
  assert.equal(result.value.host_identity.hasDocument, true);
});

test('a passport photo and number is accepted', () => {
  const result = service.validateListingSubmission(baseListing({
    id_kind: 'passport',
    id_number: 'PA1234567'
  }));
  assert.equal(result.ok, true, result.errors && result.errors.join('; '));
  assert.equal(result.value.host_identity.kind, 'passport');
});

test('a verified agent with an ID on file does not need to upload again', () => {
  const result = service.validateListingSubmission({
    district: 'Wakiso',
    area: 'Entebbe',
    host_name: 'Agent Host',
    host_phone: '0780863394',
    right_to_let_declared: true,
    terms_accepted: true,
    listed_from: 'list-property'
  }, { requireHostIdentity: true, identityOnFile: true });
  assert.equal(result.ok, true, result.errors && result.errors.join('; '));
  assert.equal(result.value.host_identity.source, 'agent_on_file');
});

test('createShortTermListing stores the ID privately on extra_fields.identity', async () => {
  const { queries, db } = fakeDb();
  const created = await service.createShortTermListing(db, baseListing(), { hostUserId: 'user-7' });
  assert.equal(created.status, 'pending');
  const insert = queries.find((query) => /INSERT INTO st_listing \(/.test(query.sql));
  assert.ok(insert);
  const extra = insert.params[insert.params.length - 1];
  assert.equal(extra.identity.source, 'upload');
  assert.equal(extra.identity.id_document_kind, 'national_id');
  assert.ok(extra.identity.id_document_url);
  assert.equal(extra.identity.host_name_submitted, 'Amina N');
  assert.match(String(extra.identity.id_document_url), /^data:image\/|^s3:\/\//i);
});

test('createShortTermListing reuses an approved agent ID on file', async () => {
  const { queries, db } = fakeDb({
    agent: {
      id: '44444444-4444-4444-4444-444444444444',
      full_name: 'Approved Agent',
      identity_document_url: 's3://private/agents/id',
      identity_document_name: 'agent-id.jpg',
      identity_document_type: 'image/jpeg'
    }
  });
  await service.createShortTermListing(db, {
    district: 'Kampala',
    area: 'Ntinda',
    host_name: 'Approved Agent',
    host_phone: '0780863394',
    right_to_let_declared: true,
    terms_accepted: true,
    listed_from: 'list-property'
  }, { hostUserId: 'user-agent' });
  const insert = queries.find((query) => /INSERT INTO st_listing \(/.test(query.sql));
  const extra = insert.params[insert.params.length - 1];
  assert.equal(extra.identity.source, 'agent_on_file');
  assert.equal(extra.identity.id_document_url, 's3://private/agents/id');
  assert.equal(extra.identity.id_number, null);
});

test('staff identity summary never includes the raw document URL', () => {
  const summary = identity.staffIdentitySummary({
    host_name: 'Amina N',
    extra_fields: {
      identity: {
        required: true,
        source: 'upload',
        id_document_url: 's3://private/short-stays/id',
        id_document_name: 'id-front.png',
        id_document_kind: 'national_id',
        id_number: TEST_NIN
      }
    }
  }, {});
  assert.equal(summary.available, true);
  assert.equal(summary.host_name, 'Amina N');
  assert.match(summary.name_match_instruction, /Amina N/);
  assert.equal(summary.id_document_kind_label, 'National ID');
  assert.equal(Object.hasOwn(summary, 'id_document_url'), false);
  assert.equal(JSON.stringify(summary).includes('s3://'), false);
});

test('the public short-stay payload does not leak the host ID', () => {
  const listing = service.normalizeShortTermListing({
    id: '11111111-1111-4111-8111-111111111111',
    reference: 'ST-000099',
    slug: 'kololo-garden-flat',
    title: 'Garden flat in Kololo',
    description: 'A quiet flat near the shops.',
    district: 'Kampala',
    area: 'Kololo',
    host_name: 'Amina',
    base_nightly_ugx: 120000,
    source: 'direct',
    extra_fields: {
      identity: {
        required: true,
        source: 'upload',
        id_document_url: 's3://private/short-stays/secret-id',
        id_document_name: 'id-front.png',
        id_number: TEST_NIN
      }
    }
  });
  const blob = JSON.stringify(listing);
  assert.equal(blob.includes('secret-id'), false);
  assert.equal(blob.includes('id_document_url'), false);
  assert.equal(blob.includes(TEST_NIN), false);
  assert.equal(blob.includes('identity'), false);
});

test('accepted host ID photos match the owner listing rules', () => {
  assert.equal(identity.isAcceptedHostIdPhoto({ name: 'id.jpg', url: TEST_ID_PHOTO, mimeType: 'image/jpeg' }), true);
  assert.equal(identity.isAcceptedHostIdPhoto({ name: 'id.pdf', url: 'data:application/pdf;base64,AAAA', mimeType: 'application/pdf' }), false);
  assert.equal(identity.isValidUgNinNumber(TEST_NIN), true);
  assert.equal(identity.isValidUgNinNumber('12345'), false);
});
