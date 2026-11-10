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
const options = read('assets/short-term-options.js');
const publicJs = read('assets/short-term.js');
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
  assert.match(html, /Add your ID now or send it later; your listing will show 'ID pending' until we've checked it/);
  assert.match(html, /id="lp-st-id-later-panel"/);
  assert.match(html, /id="lp-st-id-later-form"/);
  assert.match(app, /function handleListPropertyShortStayIdFile/);
  assert.match(app, /function submitListPropertyShortStayLaterId/);
  assert.match(app, /id_upload_url/);
  assert.match(app, /signedInShortStayAgentHasIdOnFile/);
  assert.match(app, /payload\.id_document_url/);
  assert.equal(route.includes('requireHostIdentity: true'), false);
  assert.match(route, /listings\/:id\/identity/);
  assert.match(route, /staff\/listings\/:id\/id-document/);
});

test('the desk shows the ID, the form name to match, and an ID seen step', () => {
  assert.match(admin, /function identityPanelHtml/);
  assert.match(admin, /View ID \/ Load document/);
  assert.match(admin, /ID seen/);
  assert.match(admin, /data-st-view-id/);
  assert.match(admin, /\/id-document/);
  assert.match(admin, /Name on the form/);
  assert.match(admin, /No ID yet/);
  assert.match(moderation.REVIEW_CHECKS.find((item) => item.key === 'identity_checked').label, /ID seen/);
});

test('a list-property short stay without an ID can still be submitted', () => {
  const result = service.validateListingSubmission({
    district: 'Kampala',
    area: 'Kololo',
    host_name: 'Amina N',
    host_phone: '0780863394',
    right_to_let_declared: true,
    terms_accepted: true,
    listed_from: 'list-property'
  });
  assert.equal(result.ok, true, result.errors && result.errors.join('; '));
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
  assert.equal(listing.id_pending, true);
  assert.equal(listing.id_checked, false);
});

test('accepted host ID photos match the owner listing rules', () => {
  assert.equal(identity.isAcceptedHostIdPhoto({ name: 'id.jpg', url: TEST_ID_PHOTO, mimeType: 'image/jpeg' }), true);
  assert.equal(identity.isAcceptedHostIdPhoto({ name: 'id.pdf', url: 'data:application/pdf;base64,AAAA', mimeType: 'application/pdf' }), false);
  assert.equal(identity.isValidUgNinNumber(TEST_NIN), true);
  assert.equal(identity.isValidUgNinNumber('12345'), false);
});

test('createShortTermListing records a pending identity when no ID was uploaded', async () => {
  const { queries, db } = fakeDb();
  await service.createShortTermListing(db, {
    district: 'Kampala',
    area: 'Kololo',
    host_name: 'Amina N',
    host_phone: '0780863394',
    right_to_let_declared: true,
    terms_accepted: true,
    listed_from: 'list-property'
  });
  const insert = queries.find((query) => /INSERT INTO st_listing \(/.test(query.sql));
  assert.ok(insert);
  const extra = insert.params[insert.params.length - 1];
  assert.equal(extra.identity.source, 'pending');
  assert.equal(extra.identity.id_document_url == null, true);
  assert.equal(extra.identity.host_name_submitted, 'Amina N');
});

test('a listing without an ID seen tick shows ID still pending, except found-online stays', () => {
  const pending = service.publicHostIdStatus({
    source: 'direct',
    extra_fields: { identity: { source: 'pending' } }
  });
  assert.deepEqual(pending, { id_pending: true, id_checked: false });

  const checked = service.publicHostIdStatus({
    source: 'direct',
    extra_fields: { identity: { source: 'upload', id_document_url: 's3://private/short-stays/id' } },
    moderation_checklist: { identity_checked: true }
  });
  assert.deepEqual(checked, { id_pending: false, id_checked: true });

  const agent = service.publicHostIdStatus({
    source: 'direct',
    extra_fields: { identity: { source: 'agent_on_file' } }
  });
  assert.deepEqual(agent, { id_pending: false, id_checked: false });

  const found = service.publicHostIdStatus({
    source: 'imported',
    extra_fields: { found_online_label: 'Found on TikTok', do_not_message: true }
  });
  assert.deepEqual(found, { id_pending: false, id_checked: false });
});

test('the desk marks listings with no document as No ID yet', () => {
  const summary = identity.staffIdentitySummary({
    host_name: 'Amina N',
    source: 'direct',
    extra_fields: { identity: { source: 'pending', host_name_submitted: 'Amina N' } }
  }, {});
  assert.equal(summary.no_id_yet, true);
  assert.equal(summary.pending, true);
  assert.equal(summary.available, false);
  assert.equal(summary.applicable, true);
  assert.equal(Object.hasOwn(summary, 'id_document_url'), false);
});

test('found-online listings do not use the host ID desk panel', () => {
  const summary = identity.staffIdentitySummary({
    host_name: 'Found Host',
    source: 'imported',
    extra_fields: { found_online_label: 'Found online', do_not_message: true }
  }, {});
  assert.equal(summary.applicable, false);
  assert.equal(summary.no_id_yet, false);
  assert.equal(summary.pending, false);
});

test('King approval is not blocked when ID seen is still outstanding', () => {
  const checklist = {};
  moderation.REVIEW_CHECK_KEYS.forEach((key) => { checklist[key] = true; });
  checklist.identity_checked = false;
  checklist[moderation.KING_CONFIRMATION_KEY] = true;
  const verdict = moderation.canApprove(checklist);
  assert.equal(verdict.ok, true, verdict.reason || 'should approve without ID seen');
  assert.ok(moderation.missingChecks(checklist).some((item) => item.key === 'identity_checked'));
});

test('a later ID upload token only works for that listing', () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-short-stay-id-pending';
  const listingId = '33333333-3333-3333-3333-333333333333';
  const otherId = '44444444-4444-4444-4444-444444444444';
  const token = identity.createIdentityUploadToken(listingId);
  assert.match(token, /^\d+\./);
  assert.doesNotThrow(() => identity.verifyIdentityUploadToken(listingId, token));
  assert.throws(() => identity.verifyIdentityUploadToken(otherId, token), /not valid|expired/i);
  assert.equal(identity.identityUploadPath(listingId, token).includes('/list-property?type=short_stay'), true);
  assert.match(identity.IDENTITY_TOKEN_MARKER, /short-term-host-id/);
});

test('the later ID upload page and public pending badge are wired up', () => {
  assert.match(app, /function listPropertyShortStayLaterIdParams/);
  assert.match(app, /listings\/\$\{encodeURIComponent\(params\.listingId\)}\/identity/);
  assert.match(html, /Send your government ID/);
  assert.match(options, /ID still pending/);
  assert.match(publicJs, /ID still pending/);
  assert.match(admin, /You can still approve this listing/);
});

test('attachHostIdentity stores a later upload without exposing the document URL', async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-short-stay-id-pending';
  const listingId = '33333333-3333-3333-3333-333333333333';
  const token = identity.createIdentityUploadToken(listingId);
  const queries = [];
  const db = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/SELECT id, reference, host_name, extra_fields/.test(sql)) {
        return { rows: [{
          id: listingId,
          reference: 'ST-000091',
          host_name: 'Amina N',
          extra_fields: { identity: { source: 'pending' } }
        }] };
      }
      return { rows: [] };
    }
  };
  const saved = await identity.attachHostIdentity(db, listingId, baseListing(), { token });
  assert.equal(saved.has_id_document, true);
  assert.equal(saved.reference, 'ST-000091');
  const update = queries.find((query) => /UPDATE st_listing/.test(query.sql));
  assert.ok(update);
  const stored = JSON.parse(update.params[1]);
  assert.equal(stored.identity.source, 'upload');
  assert.ok(stored.identity.id_document_url);
});
