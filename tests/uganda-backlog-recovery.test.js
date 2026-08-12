'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { deriveListingClassification, listingDataIntegrityReport } = require('../utils/listingDataIntegrity');
const { detectPropertyTypeEvidence } = require('../utils/propertyTypeVocabulary');
const {
  buildBacklogRecoveryProposal,
  extractLocationProposal,
  extractPriceProposal,
  recountBacklog,
} = require('../services/backlogRecoveryService');

test('Uganda room vocabulary is shared and recognizes local listing language', () => {
  for (const text of ['double rooms for rent', 'single room to let', 'muzigo for rent', 'self-contained unit for rent']) {
    const evidence = detectPropertyTypeEvidence(text);
    assert.equal(evidence.physical_type, 'residential', text);
    assert.equal(evidence.property_type, 'room', text);
    const classification = deriveListingClassification({ title: text, listing_type: 'rent' });
    assert.equal(classification.listing_type, 'rent', text);
    assert.equal(classification.category_ambiguous, false, text);
  }
  const sourced = deriveListingClassification({
    title: 'Beautiful place available',
    source_caption: 'Two double rooms for rent in Ssenge',
    listing_type: 'rent',
  });
  assert.equal(sourced.property_type, 'room');
  assert.equal(sourced.category_ambiguous, false);
});

test('missing physical type reports property type rather than a misleading proposed category', () => {
  const report = listingDataIntegrityReport({
    title: 'Beautiful place for rent',
    description: 'Call for viewing',
    property_type: 'Apartment',
    listing_type: 'rent',
    price: 800000,
    price_period: 'month',
  });
  const issue = report.issues.find((item) => item.code === 'category_ambiguous');
  assert.equal(issue.issue_subject, 'property_type');
  assert.equal(issue.form_property_type, 'Apartment');
  assert.equal(Object.hasOwn(issue, 'proposed_listing_type'), false);
  assert.match(issue.message, /physical property type/i);
});

test('a trusted human property-type edit is authoritative without weakening default intake', () => {
  const record = { title: 'Beautiful place for rent', property_type: 'Apartment', listing_type: 'rent', price: 800000, price_period: 'month' };
  assert.equal(deriveListingClassification(record).category_ambiguous, true);
  const trusted = deriveListingClassification(record, { trustFormPropertyType: true });
  assert.equal(trusted.category_ambiguous, false);
  assert.equal(trusted.listing_type, 'rent');
});

test('price proposals preserve currency provenance and never invent an FX rate', () => {
  const ugx = extractPriceProposal({ source_caption: 'Double room for rent in Ssenge at UGX 450,000 per month' });
  assert.equal(ugx.status, 'proposed');
  assert.equal(ugx.proposal.price_ugx, 450000);
  const usd = extractPriceProposal({ source_caption: 'Apartment for sale USD 72,500' });
  assert.equal(usd.status, 'manual_review');
  assert.equal(usd.proposal.original_currency, 'USD');
  assert.equal(usd.proposal.price_ugx, null);
  for (const [caption, expected] of [
    ['Room for rent UShs 200k pm', 200000],
    ['House selling at Sh 250 million', 250000000],
    ['Land price 1.2m/=', 1200000],
    ['Plot for sale at 2bn', 2000000000],
  ]) {
    const parsed = extractPriceProposal({ source_caption: caption, listing_type: /rent/i.test(caption) ? 'rent' : 'sale' });
    assert.equal(parsed.status, 'proposed', caption);
    assert.equal(parsed.proposal.price_ugx, expected, caption);
  }
});

test('location proposals use the shared exact resolver and never fuzzy guess', () => {
  const exact = extractLocationProposal({ source_caption: 'Double room for rent in Ssenge, Wakiso' });
  assert.equal(exact.status, 'proposed');
  assert.equal(exact.proposal.canonical_location_id, 'wakiso:ssenge');
  assert.equal(exact.proposal.region, 'Central');
  const unknown = extractLocationProposal({ source_caption: 'House for rent in Zzxq' });
  assert.equal(unknown.status, 'unmatched');
  assert.match(unknown.reason, /fuzzy guessing is disabled/i);
});

test('recovery stays proposal-only, protects statuses and excludes students', () => {
  const pendingStudent = { id: 'student-1', status: 'pending', listing_type: 'student', title: '#hostel #fyp', source_caption: 'Hostel near Makerere UGX 500k per semester' };
  const rejected = { id: 'rejected-1', status: 'rejected', listing_type: 'rent', title: 'House for rent', source_caption: 'House for rent in Ntinda UGX 2m' };
  const studentProposal = buildBacklogRecoveryProposal(pendingStudent);
  assert.equal(studentProposal.student_excluded, true);
  assert.equal(studentProposal.eligible_for_proposal_storage, false);
  assert.equal(studentProposal.never_auto_publish, true);
  assert.equal(buildBacklogRecoveryProposal(rejected).protected, true);
  const recount = recountBacklog([pendingStudent, rejected]);
  assert.equal(recount.counts.total_pending, 1);
  assert.equal(recount.counts.student_manual_only, 1);
});

test('district-only policy defaults to hold and requires an explicit release choice', () => {
  const record = { id: 'district-1', status: 'pending', listing_type: 'land', title: 'Land for sale', district: 'Wakiso', area: 'Wakiso', canonical_location_level: 'district' };
  assert.equal(buildBacklogRecoveryProposal(record).eligible_for_proposal_storage, false);
  assert.equal(buildBacklogRecoveryProposal(record, { districtOnlyPolicy: 'release' }).district_only_policy, 'release');
});

test('backlog endpoints and King controls are proposal-only with no bulk publish action', () => {
  const root = path.resolve(__dirname, '..');
  const adminRoute = fs.readFileSync(path.join(root, 'routes/admin.js'), 'utf8');
  const adminUi = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const browser = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(adminRoute, /router\.get\('\/backlog-recovery\/recount'/);
  assert.match(adminRoute, /router\.get\('\/backlog-recovery\/sample'/);
  assert.match(adminRoute, /router\.get\('\/backlog-recovery\/proposal\/:id'/);
  assert.doesNotMatch(adminRoute, /router\.(?:post|patch)\('\/backlog-recovery\/apply'/);
  assert.match(adminRoute, /rows_updated:\s*0/);
  assert.match(adminRoute, /rows_published:\s*0/);
  assert.match(adminUi, /Review backlog recovery lab/);
  assert.match(adminUi, /Student \(manual only\)/);
  assert.match(browser, /\/api\/admin\/backlog-recovery\/proposal\//);
  assert.match(server, /uganda-master-intake-recovery-20260811/);
});
