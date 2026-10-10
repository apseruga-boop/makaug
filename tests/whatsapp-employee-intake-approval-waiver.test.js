'use strict';

// Arthur, 10 Oct 2026: listings staff bring in by WhatsApp
// (source whatsapp_employee_intake) skip the owner checklist
// (verified phone, ID, 3–5 photos, OTP, terms). A real hosted photo, a
// possible price, and a specific location are still required.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildAutomatedListingReview,
  STAFF_SOURCED_OWNER_CHECKLIST_NOTE,
  STAFF_SOURCED_OWNER_CHECK_KEYS
} = require('../services/listingModerationService');
const { listingRequiresIdentityVerification } = require('../services/listingIdentityDocumentService');

function reviewOf(listing) {
  return buildAutomatedListingReview({ listing, images: [] });
}

function check(review, key) {
  return review.checks.find((item) => item.key === key);
}

const employee = {
  title: '3 bedroom house for sale in Ntinda',
  description: 'A 3 bedroom house for sale in Ntinda, Kampala.',
  district: 'Kampala',
  area: 'Ntinda',
  listing_type: 'sale',
  price: 150000000,
  latitude: 0.357,
  longitude: 32.612,
  lister_phone: '+256700000111',
  listed_via: 'whatsapp',
  source: 'whatsapp_employee_intake',
  extra_fields: {}
};

const owner = {
  ...employee,
  listed_via: 'website',
  source: 'website',
  lister_type: 'owner',
  lister_email: ''
};

test('employee WhatsApp intake can pass without ID, email, OTP, or the 5-photo count', () => {
  const review = reviewOf(employee);
  assert.equal(review.staff_sourced_owner_checklist_waived, true);
  assert.equal(review.can_approve, true, review.blocking_failures.map((item) => item.key).join(','));
  for (const key of STAFF_SOURCED_OWNER_CHECK_KEYS) {
    const item = check(review, key);
    assert.equal(item.status, 'pass', key);
    assert.equal(item.blocking, false, key);
    assert.match(item.message, new RegExp(STAFF_SOURCED_OWNER_CHECKLIST_NOTE));
  }
  assert.equal(check(review, 'location_verified').status, 'pass');
  assert.equal(check(review, 'pricing_checked').status, 'pass');
  assert.equal(check(review, 'required_listing_fields').status, 'pass');
  assert.equal(listingRequiresIdentityVerification(employee), false);
  assert.equal(listingRequiresIdentityVerification({
    ...employee,
    id_number: 'CM123456789012',
    extra_fields: { identity_verification: { required: true } }
  }), false);
});

test('employee intake still fails a missing location, a missing price, or missing listing fields', () => {
  const noPin = reviewOf({ ...employee, latitude: null, longitude: null });
  assert.equal(noPin.can_approve, false);
  assert.equal(check(noPin, 'location_verified').status, 'fail');
  assert.equal(check(noPin, 'location_verified').blocking, true);

  const noPrice = reviewOf({ ...employee, price: 0 });
  assert.equal(noPrice.can_approve, false);
  assert.equal(check(noPrice, 'pricing_checked').status, 'fail');

  const noTitle = reviewOf({ ...employee, title: '' });
  assert.equal(noTitle.can_approve, false);
  assert.equal(check(noTitle, 'required_listing_fields').status, 'fail');
});

test('an owner website submission without ID or email still cannot be approved', () => {
  const review = reviewOf(owner);
  assert.equal(review.staff_sourced_owner_checklist_waived, false);
  assert.equal(review.can_approve, false);
  assert.equal(check(review, 'identity_number_supplied').status, 'fail');
  assert.equal(check(review, 'contact_details_verified').status, 'fail');
  assert.equal(check(review, 'terms_accepted').status, 'fail');
  assert.equal(listingRequiresIdentityVerification(owner), true);
});

test('a forwarded WhatsApp review is not the employee-intake exemption', () => {
  const review = reviewOf({ ...employee, source: 'whatsapp_forward_review' });
  assert.equal(review.staff_sourced_owner_checklist_waived, false);
  assert.equal(review.can_approve, false);
  assert.equal(check(review, 'identity_number_supplied').status, 'fail');
});

test('the status route records the waiver and still runs the real-photo and location gates', () => {
  const properties = fs.readFileSync(path.join(__dirname, '../routes/properties.js'), 'utf8');
  assert.match(properties, /isWhatsappEmployeeIntakeListing\(current\)/);
  assert.match(properties, /STAFF_SOURCED_OWNER_CHECKLIST_NOTE/);
  assert.match(properties, /staff_sourced_owner_checklist_note: STAFF_SOURCED_OWNER_CHECKLIST_NOTE/);
  assert.match(properties, /listingPhotoOrVideoCheck\(db, current\.id \|\| req\.params\.id\)/);
  assert.match(properties, /canonicalApprovalLocationForRecord\(current/);
  assert.match(properties, /listingPriceQuality\(current/);
  assert.match(properties, /listingRequiresIdentityVerification\(current\)/);
  const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
  assert.match(app, /whatsapp_employee_intake/);
  const identity = fs.readFileSync(path.join(__dirname, '../services/listingIdentityDocumentService.js'), 'utf8');
  assert.match(identity, /function listingRequiresIdentityVerification/);
  assert.match(identity, /whatsapp_employee_intake/);
});
