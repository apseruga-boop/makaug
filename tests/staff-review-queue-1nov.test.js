'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL ||= 'postgres://test@localhost/test';

const { strongestSourcePriceCandidate } = require('../services/socialSearchSourcedListingsService');
const { propertyPriceMetadata } = require('../utils/propertyPriceCurrency');
const { moderationReasonWithoutCategoryAmbiguous } = require('../utils/listingDataIntegrity');
const { keepPendingModerationFields } = require('../utils/keepPendingModeration');
const staff = require('../routes/staff')._test;

const CAPTION_3FD54E = '17 Decimals Plot for Sale in Kira Nakwero Uganda Already titled Prime neighborhood Price: Ugx 75 million ($17,682) VISIT OUR OFFICIAL WEBSITE TO FIND: homes from UGX 40 million and plots of land from UGX 10 million sale $17,682';

test('(a) a UGX figure in the caption wins over a USD price_text from the harvester', () => {
  const candidate = strongestSourcePriceCandidate({ price_text: '$17,682', price: '$17,682' }, CAPTION_3FD54E);
  const meta = propertyPriceMetadata(candidate.value);
  assert.equal(meta.price_original_currency, 'UGX');
  assert.equal(meta.price, 75000000);
});

test('(a) 0C0E8C: Ugx 65 million ($15,324) stores UGX 65,000,000', () => {
  const text = 'Price: Ugx 65 million ($15,324) VISIT OUR OFFICIAL WEBSITE land $15,324';
  const meta = propertyPriceMetadata(strongestSourcePriceCandidate({ price_label: '$15,324' }, text).value);
  assert.equal(meta.price_original_currency, 'UGX');
  assert.equal(meta.price, 65000000);
});

test('(a) a USD-only post still converts from USD', () => {
  const meta = propertyPriceMetadata(strongestSourcePriceCandidate({ price_text: '$120,000' }, 'House for sale $120,000').value);
  assert.equal(meta.price_original_currency, 'USD');
});

test('(b) POA tick persists on a USD-source listing', () => {
  const existing = { price: 67191600, price_original: 17682, price_original_currency: 'USD', price_fx_rate_ugx: 3800, price_on_application: false, extra_fields: {} };
  const out = staff.normalizeStaffListingPatch(existing, {
    price: '', price_on_application: true, price_original_currency: 'USD', price_original: '17682', price_fx_rate_ugx: '3800'
  });
  assert.equal(out.patch.price_on_application, true);
  assert.equal(out.patch.__priceChoice, 'poa');
  assert.ok(out.patch.price == null);
});

test('(b) a USD amount without POA still converts', () => {
  const existing = { price: 1, price_original_currency: 'USD', price_fx_rate_ugx: 3800, extra_fields: {} };
  const out = staff.normalizeStaffListingPatch(existing, { price_original_currency: 'USD', price_original: '1000', price_fx_rate_ugx: '3800' });
  assert.equal(out.patch.price, 3800000);
});

test('(c) keep pending keeps the stored hold reason and appends the note', () => {
  const current = { moderation_reason: 'Waiting for owner to confirm title', moderation_notes: 'old note' };
  const held = keepPendingModerationFields(current, { reason: 'Staff moderation update', notes: 'Called owner, no answer', author: 'Ann', at: new Date('2026-11-01T10:00:00Z') });
  assert.equal(held.reason, 'Waiting for owner to confirm title');
  assert.match(held.notes, /old note/);
  assert.match(held.notes, /Called owner, no answer/);
  const typed = keepPendingModerationFields(current, { reason: 'Price unclear', notes: '' });
  assert.equal(typed.reason, 'Price unclear');
  assert.equal(typed.notes, null);
});

test('(c) Keep pending in the review panel sends the note and confirms', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');
  const fn = app.slice(app.indexOf('async function staffModerateListing('), app.indexOf('async function staffRefreshOpenPreview('));
  assert.match(fn, /review_notes: pendingNote/);
  assert.match(fn, /Kept pending/);
  assert.match(fn, /staffRefreshOpenPreview\(propertyId\)/);
});

test('(d) B04113: District Wakiso + Town Nansana saves over a stale "Kampala" area', () => {
  const out = staff.normalizeStaffListingPatch({ area: 'Kampala', district: 'Kampala', extra_fields: {} }, { district: 'Wakiso', city: 'Nansana' });
  assert.deepEqual(out.errors || [], []);
  assert.equal(out.patch.area, 'Nansana');
  assert.equal(out.patch.district, 'Wakiso');
});

test('(d) a real mismatch is still blocked', () => {
  const out = staff.normalizeStaffListingPatch({ area: 'Nansana', district: 'Wakiso', extra_fields: {} }, { district: 'Kampala', area: 'Nansana' });
  assert.ok((out.errors || []).some((e) => /Nansana belongs to Wakiso/.test(e)));
});

test('(e) no blank "Data integrity review required: ." after editing', () => {
  assert.equal(moderationReasonWithoutCategoryAmbiguous('Data integrity review required: category_ambiguous.'), '');
  assert.equal(moderationReasonWithoutCategoryAmbiguous('Data integrity review required: .'), '');
  assert.equal(
    moderationReasonWithoutCategoryAmbiguous('Data integrity review required: category_ambiguous, missing_public_contact_path.'),
    'Data integrity review required: missing_public_contact_path.'
  );
});
