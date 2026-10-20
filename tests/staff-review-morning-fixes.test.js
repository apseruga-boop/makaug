'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { appendModerationNote } = require('../utils/moderationNotes');
const { resolveStaffPriceChoice } = require('../utils/staffPriceChoice');
const { getDistrictLocationTree } = require('../utils/ugandaLocationHierarchy');
const { canonicalizeUgandaLocation } = require('../utils/locationRegistry');
const {
  landTitleAvailabilityLabel,
  publicLandTitleAvailabilityLabel
} = require('../utils/landTitleAvailability');
const {
  normalizeStaffListingPatch,
  staffLocationWarnings
} = require('../routes/staff')._test;

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');
const staff = fs.readFileSync(path.join(root, 'routes/staff.js'), 'utf8');
const properties = fs.readFileSync(path.join(root, 'routes/properties.js'), 'utf8');

test('unticking Price on application keeps a stored canonical amount and clears the flag', () => {
  const resent = resolveStaffPriceChoice({
    price: '1000000000',
    price_on_application: false,
    price_period: 'once'
  }, { price: '1000000000', price_on_application: true });
  assert.equal(resent.mode, 'amount');
  assert.equal(resent.patch.price, 1000000000);
  assert.equal(resent.patch.price_on_application, false);

  const omittedPrice = resolveStaffPriceChoice({
    price_on_application: false,
    price_period: 'once'
  }, { price: '1000000000', price_on_application: true });
  assert.equal(omittedPrice.mode, 'amount');
  assert.equal(omittedPrice.patch.price, 1000000000);
  assert.equal(omittedPrice.patch.price_on_application, false);

  const poa = resolveStaffPriceChoice({
    price_on_application: true,
    price_period: 'once'
  }, { price: '1000000000' });
  assert.equal(poa.mode, 'poa');
  assert.equal(poa.patch.price, null);
  assert.equal(poa.patch.price_on_application, true);

  assert.match(app, /adminReviewHasTypedCanonicalPrice\(review\.price\)/);
  assert.match(staff, /resolveStaffPriceChoice\(normalized, existing\)/);
  assert.match(staff, /staffPriceExtraPatch\(/);
});

test('a new internal note is appended with the author and time', () => {
  const first = appendModerationNote('', 'Checked the house title', {
    author: 'Amina',
    at: new Date('2026-10-11T05:00:00Z')
  });
  assert.match(first, /\[.*EAT\] Amina: Checked the house title/);
  const second = appendModerationNote(first, 'Price is the stored billion', {
    author: 'Amina',
    at: new Date('2026-10-11T06:00:00Z')
  });
  assert.match(second, /Checked the house title/);
  assert.match(second, /Price is the stored billion/);
  assert.notEqual(second, 'Price is the stored billion');
  assert.equal(appendModerationNote(second, 'Price is the stored billion', { author: 'Amina' }), second);
  assert.equal(appendModerationNote(second, '', { author: 'Amina' }), second);
  assert.match(staff, /appendModerationNote\(existing\.moderation_notes/);
  assert.match(app, /data-staff-note-history/);
  assert.match(app, /Add a note\. It is kept with your name and the time\./);
});

test('Nkoowe stays in Wakiso and a chosen town survives a town-only save', () => {
  assert.equal(canonicalizeUgandaLocation('Nkoowe', 'Wakiso').district, 'Wakiso');
  assert.equal(canonicalizeUgandaLocation('Nkoowe', 'Wakiso').town, 'Nkoowe');
  const townOnly = normalizeStaffListingPatch({
    area: 'Nkoowe',
    district: 'Wakiso',
    listing_type: 'sale',
    extra_fields: { city: 'Nansana', neighborhood: 'Nkoowe', region: 'Central' }
  }, {
    city: 'Wakiso',
    area: 'Wakiso',
    neighborhood: '',
    district: 'Wakiso'
  });
  assert.deepEqual(townOnly.errors, [], townOnly.errors.join('; '));
  assert.equal(townOnly.hierarchy.city, 'Wakiso');
  assert.equal(townOnly.hierarchy.neighborhood, 'Nkoowe');
  assert.equal(townOnly.patch.area, 'Nkoowe');

  const chosen = normalizeStaffListingPatch({
    area: 'Gganda',
    district: 'Wakiso',
    listing_type: 'land',
    extra_fields: { city: 'Nansana', neighborhood: 'Gganda', region: 'Central' }
  }, {
    city: 'Wakiso',
    area: 'Gganda',
    neighborhood: 'Gganda',
    district: 'Wakiso'
  });
  assert.deepEqual(chosen.errors, [], chosen.errors.join('; '));
  assert.equal(chosen.hierarchy.city, 'Wakiso');
  assert.equal(chosen.hierarchy.neighborhood, 'Gganda');
});

test('Kasangati is selectable and Masooli sits under it', () => {
  assert.equal(canonicalizeUgandaLocation('Masooli', 'Wakiso').town, 'Kasangati');
  assert.equal(canonicalizeUgandaLocation('Kasangati', 'Wakiso').town, 'Kasangati');
  const town = getDistrictLocationTree('Wakiso').find((item) => item.city === 'Kasangati');
  assert.ok(town, 'Kasangati is a town in the Wakiso tree');
  const names = town.neighborhoods.map((item) => item.name);
  assert.ok(names.includes('Kasangati'), names.join(', '));
  assert.ok(names.includes('Masooli'), names.join(', '));
  for (const name of ['Bulamu', 'Katadde', 'Kiteezi', 'Nangabo', 'Wattuba']) {
    assert.ok(names.includes(name), `${name} should stay under Kasangati`);
  }
});

test('location evidence uses whole words and a staff confirmation overrides a weak token', () => {
  const kiteezi = staffLocationWarnings({
    title: 'Plot for sale in Kasangati Kiteezi Wakiso',
    district: 'Wakiso',
    area: 'Kiteezi',
    extra_fields: {}
  });
  assert.equal(kiteezi.some((warning) => /Kalungu/.test(warning)), false, kiteezi.join(' | '));

  const kiti = staffLocationWarnings({
    title: 'Plot at Kiti',
    district: 'Wakiso',
    area: 'Kasangati',
    extra_fields: {}
  });
  assert.equal(kiti.some((warning) => /Kalungu/.test(warning)), true, kiti.join(' | '));

  const confirmed = staffLocationWarnings({
    title: 'Plot at Kiti',
    district: 'Wakiso',
    area: 'Kasangati',
    extra_fields: { staff_location_confirmed: true }
  });
  assert.equal(confirmed.some((warning) => /Kalungu/.test(warning)), false, confirmed.join(' | '));

  const districtName = staffLocationWarnings({
    title: 'Land in Kalungu district',
    district: 'Wakiso',
    area: 'Kasangati',
    extra_fields: { staff_location_confirmed: true }
  });
  assert.equal(districtName.some((warning) => /Kalungu/.test(warning)), true, districtName.join(' | '));
  assert.match(staff, /staff_location_confirmed = true/);
  assert.match(staff, /place-name token, not as that district/);
});

test('the staff preview title draft is what a save sends while the modal is open', () => {
  assert.match(app, /let staffPreviewTitleDraft = null/);
  assert.match(app, /function staffPreviewRememberTitle/);
  assert.match(app, /staffPreviewTitleDraft/);
  const collectStart = app.indexOf('function collectAdminReviewListingPatch');
  const collectEnd = app.indexOf('function ', collectStart + 10);
  const collect = app.slice(collectStart, collectEnd);
  assert.match(collect, /staffPreviewTitleDraft/);
});

test('the alternate phone is stored for staff and stays off the public page without a primary phone', () => {
  assert.match(app, /id="admin-review-alt-phone-edit"/);
  assert.match(app, /contact_phone_alt: adminReviewNormalizeUgandaPhone/);
  assert.match(staff, /extraPatch\.contact_phone_alt = normalizePhoneLite/);
  assert.match(properties, /publicContactPhone && cleanText\(property\?\.extra_fields\?\.contact_phone_alt\)/);
  const contactStart = app.indexOf('const hasDirectContact = Boolean(');
  const contactEnd = app.indexOf('return {', contactStart);
  const contact = app.slice(contactStart, contactEnd);
  assert.doesNotMatch(contact, /contact_phone_alt/);
  const buttonsStart = app.indexOf('function detailContactActionButtonsHtml');
  const buttons = app.slice(buttonsStart, buttonsStart + 2500);
  assert.match(buttons, /contact_phone_alt/);
  assert.match(buttons, /if \(normalizedCallPhone\)/);
});

test('a public land-title badge is hidden unless the title is verified', () => {
  assert.equal(publicLandTitleAvailabilityLabel('unknown'), '');
  assert.equal(publicLandTitleAvailabilityLabel('pending'), '');
  assert.equal(publicLandTitleAvailabilityLabel('to confirm'), '');
  assert.equal(publicLandTitleAvailabilityLabel('yes'), 'Land title available');
  assert.equal(landTitleAvailabilityLabel('unknown'), 'Land title status pending');
  assert.match(properties, /publicLandTitleAvailabilityLabel\(landTitleAvailable\)/);
  assert.match(app, /function publicLandTitleBadgeLabel/);
  const badgeStart = app.indexOf('function landTitleAvailabilityBadgeHtml');
  const badge = app.slice(badgeStart, badgeStart + 700);
  assert.match(badge, /publicLandTitleBadgeLabel/);
  assert.doesNotMatch(badge, /\|\| "unknown"/);
});

test('an empty main review queue does not contradict the pending counter', () => {
  assert.match(app, /Pending listings in this count are in Broker listings review above\./);
  assert.match(app, /Listing moderation rows are still catching up\./);
  assert.match(app, /staffHeaderPendingReviewCount\(\)/);
  const paintStart = app.indexOf('function staffPaintReviewQueue');
  const paint = app.slice(paintStart, app.indexOf('function staffSetReviewQueue', paintStart));
  assert.match(paint, /staffHeaderPendingReviewCount\(\) > 0 && staffReviewQueueState\.broker\.rows\.length/);
  assert.match(staff, /platform = ANY\(\$1::text\[\]\)/);
  assert.match(staff, /pg_class_reltuples/);
  assert.doesNotMatch(staff, /platform ILIKE 'tiktok'/);
});

test('the review screen keeps a chosen in-tree town when the neighbourhood belongs elsewhere', () => {
  const start = app.indexOf('function adminReviewCityToSave');
  const end = app.indexOf('function adminReviewTownForNeighborhood', start);
  const context = { tree: [] };
  vm.createContext(context);
  vm.runInContext(`${app.slice(start, end)}; this.keep = adminReviewTownAfterCanonicalResolve;`, context);
  const tree = [
    { city: 'Wakiso', neighborhoods: [{ name: 'Nkoowe' }] },
    { city: 'Nansana', neighborhoods: [{ name: 'Gganda' }] },
    { city: 'Kasangati', neighborhoods: [{ name: 'Kasangati' }, { name: 'Kiteezi' }] }
  ];
  assert.equal(context.keep('Wakiso', 'Nansana', tree, 'Gganda'), 'Wakiso');
  assert.equal(context.keep('Kasangati', 'Wakiso', tree, 'Kiteezi'), 'Kasangati');
  assert.equal(context.keep('Kampala', 'Nakawa', [{ city: 'Nakawa', neighborhoods: [{ name: 'Luzira' }] }], 'Luzira'), 'Nakawa');
});
