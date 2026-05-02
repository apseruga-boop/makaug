'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  PUBLIC_FORBIDDEN_STRINGS,
  isProtectedPath,
  roleCanAccessProtectedPath,
  renderProtectedLoginShell,
  sanitizePublicHtml
} = require('../services/publicHtmlSanitizer');
const {
  buildOtpSuccessPayload,
  dashboardForUser,
  normalizeSignupAudience,
  roleForSignup
} = require('../services/authFlowService');
const { EMAIL_NOTIFICATION_EVENT_MATRIX } = require('../services/emailNotificationEventMatrix');
const { buildListingWhatsappMessage, buildWhatsAppUrl } = require('../services/whatsappLinkService');

function assertNoProtectedStrings(label, html) {
  for (const forbidden of PUBLIC_FORBIDDEN_STRINGS) {
    assert(!html.includes(forbidden), `${label} leaked protected string: ${forbidden}`);
  }
  assert(!/moderation/i.test(html), `${label} leaked moderation text`);
}

function run() {
  const sourceHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const publicHtml = sanitizePublicHtml(sourceHtml);
  assertNoProtectedStrings('public homepage', publicHtml);
  assert(!publicHtml.includes('id="page-admin-dashboard"'), 'public homepage leaked admin dashboard block');
  assert(!publicHtml.includes('id="page-finder-dashboard"'), 'public homepage leaked finder dashboard block');
  assert(!publicHtml.includes('id="page-student-dashboard"'), 'public homepage leaked student dashboard block');
  assert(!publicHtml.includes('id="page-agent-dashboard"'), 'public homepage leaked broker dashboard block');
  assert(!publicHtml.includes('id="page-field-dashboard"'), 'public homepage leaked field dashboard block');

  for (const protectedPath of ['/dashboard', '/student-dashboard', '/broker-dashboard', '/field-agent-dashboard', '/advertiser-dashboard', '/account', '/admin', '/admin/moderation']) {
    assert(isProtectedPath(protectedPath), `${protectedPath} should be protected`);
    const shell = renderProtectedLoginShell(protectedPath);
    assert(shell.includes('noindex,noarchive'), `${protectedPath} protected shell needs noindex/noarchive`);
    assertNoProtectedStrings(`${protectedPath} login shell`, shell);
  }
  for (const publicPath of ['/', '/for-sale', '/to-rent', '/students', '/student-accommodation', '/land', '/commercial', '/signup', '/login', '/list-property']) {
    assert(!isProtectedPath(publicPath), `${publicPath} should be public`);
  }
  assert(roleCanAccessProtectedPath({ role: 'admin' }, '/admin'), 'admin should access admin');
  assert(!roleCanAccessProtectedPath({ role: 'buyer_renter', audience: 'finder' }, '/admin'), 'normal users must not access admin');
  assert(roleCanAccessProtectedPath({ role: 'agent_broker', audience: 'agent' }, '/broker-dashboard'), 'broker should access broker dashboard');
  assert(!roleCanAccessProtectedPath({ role: 'buyer_renter', audience: 'finder' }, '/broker-dashboard'), 'finder must not access broker dashboard');
  assert(roleCanAccessProtectedPath({ role: 'field_agent', audience: 'field_agent' }, '/field-agent-dashboard'), 'field agent should access field dashboard');
  assert(!roleCanAccessProtectedPath({ role: 'buyer_renter', audience: 'finder' }, '/field-agent-dashboard'), 'finder must not access field dashboard');
  assert(roleCanAccessProtectedPath({ role: 'buyer_renter', audience: 'student' }, '/student-dashboard'), 'student should access student dashboard');
  assert(!roleCanAccessProtectedPath({ role: 'buyer_renter', audience: 'finder' }, '/student-dashboard'), 'finder must not access student dashboard');

  assert.strictEqual(normalizeSignupAudience('student-signup'), 'student');
  assert.strictEqual(normalizeSignupAudience('field-agent-signup'), 'field_agent');
  assert.strictEqual(roleForSignup({ audience: 'field_agent' }), 'field_agent');
  assert.strictEqual(roleForSignup({ audience: 'agent' }), 'agent_broker');
  assert.strictEqual(roleForSignup({ audience: 'student' }), 'buyer_renter');
  assert.strictEqual(dashboardForUser({ role: 'buyer_renter', profile_data: { audience: 'student' } }), '/student-dashboard');
  assert.strictEqual(dashboardForUser({ role: 'agent_broker', profile_data: { audience: 'agent' } }), '/broker-dashboard');
  assert.strictEqual(dashboardForUser({ role: 'field_agent', profile_data: { audience: 'field_agent' } }), '/field-agent-dashboard');

  const otpPayload = buildOtpSuccessPayload({
    token: 'token',
    user: { id: 'u1', role: 'buyer_renter', profile_data: { audience: 'student' } },
    preferredAudience: 'student'
  });
  assert.strictEqual(otpPayload.success, true);
  assert.strictEqual(otpPayload.sessionCreated, true);
  assert.strictEqual(otpPayload.contactVerified, true);
  assert.strictEqual(otpPayload.redirectUrl, '/student-dashboard');
  assert(otpPayload.message);

  const base = 'https://makaug.com';
  const cases = [
    {
      label: 'rent',
      listing: { id: '1', title: '2 Bedroom Apartment', type: 'rent', area: 'Ntinda', district: 'Kampala', inquiry_reference: 'MK-RENT', price: 1400000, period: 'mo' },
      required: ['rental property', '2 Bedroom Apartment', 'Ntinda', 'MK-RENT', base]
    },
    {
      label: 'sale',
      listing: { id: '2', title: 'Family House', type: 'sale', area: 'Muyenga', district: 'Kampala', inquiry_reference: 'MK-SALE' },
      required: ['property for sale', 'Family House', 'Muyenga', 'MK-SALE', base]
    },
    {
      label: 'land',
      listing: { id: '3', title: 'Land in Wakiso', type: 'land', area: 'Wakiso', inquiry_reference: 'MK-LAND' },
      required: ['land listing', 'title/tenure status', 'Land in Wakiso', 'Wakiso', 'MK-LAND', base]
    },
    {
      label: 'student',
      listing: { id: '4', title: 'Hostel Room', type: 'student', campus: 'Makerere', area: 'Wandegeya', inquiry_reference: 'MK-STUDENT' },
      required: ['student accommodation', 'Hostel Room', 'Makerere', 'MK-STUDENT', base]
    }
  ];
  for (const item of cases) {
    const message = buildListingWhatsappMessage(item.listing, { baseUrl: base });
    for (const required of item.required) {
      assert(message.includes(required), `${item.label} WhatsApp message missing ${required}: ${message}`);
    }
    assert(!/undefined|null/i.test(message), `${item.label} WhatsApp message leaked undefined/null`);
    const url = buildWhatsAppUrl('+256760112587', message);
    assert(url.startsWith('https://wa.me/256760112587?text='), `${item.label} WhatsApp URL is invalid`);
  }

  for (const eventKey of [
    'otp_sent',
    'otp_verified',
    'account_created_property_finder',
    'account_created_student',
    'account_created_broker',
    'field_agent_application_received',
    'listing_submitted',
    'new_listing_pending_review',
    'whatsapp_contact_initiated',
    'email_failed',
    'whatsapp_failed'
  ]) {
    assert(EMAIL_NOTIFICATION_EVENT_MATRIX[eventKey], `Missing notification event ${eventKey}`);
  }
}

run();
console.log('go-live P0 tests passed');
