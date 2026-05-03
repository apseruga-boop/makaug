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
const { buildListingReference, isListingReference } = require('../services/listingReferenceService');
const { buildListingWhatsappMessage, buildWhatsAppUrl } = require('../services/whatsappLinkService');
const { savedSearchMatchesListing } = require('../services/alertSchedulerService');
const { normalizePaymentStatus, paymentProviderConfigured } = require('../services/paymentProviderService');
const { buildMortgageEstimate, computeMonthlyRepayment: computeMortgagePayment } = require('../services/mortgageCalculatorService');

const PUBLIC_ROUTES = [
  '/',
  '/for-sale',
  '/to-rent',
  '/student-accommodation',
  '/students',
  '/land',
  '/commercial',
  '/brokers',
  '/mortgage',
  '/advertise',
  '/about',
  '/how-it-works',
  '/careers',
  '/help',
  '/safety',
  '/anti-fraud',
  '/privacy-policy',
  '/cookie-policy',
  '/terms',
  '/report-fraud',
  '/list-property',
  '/login'
];

const PUBLIC_ROUTE_MARKERS = {
  '/': ['Find your next home, land, rental, or student room'],
  '/for-sale': ['For Sale', 'No homes for sale', 'Save Search'],
  '/to-rent': ['To Rent', 'No rentals', 'Save Search'],
  '/student-accommodation': ['Student accommodation', 'Campus', 'No student rooms'],
  '/students': ['Student accommodation', 'Campus', 'No student rooms'],
  '/land': ['Land', 'No land listings', 'title'],
  '/commercial': ['Commercial', 'No commercial spaces', 'business'],
  '/brokers': ['Brokers', 'Find your perfect broker', 'Broker directory'],
  '/mortgage': ['Mortgage Finder', 'Repayment calculator', 'Gross Monthly Income Required'],
  '/advertise': ['Advertise', 'Campaign', 'Sponsored'],
  '/about': ['About', 'MakaUg', 'Our Mission'],
  '/how-it-works': ['How MakaUg Works', 'List property'],
  '/careers': ['Careers at MakaUg', 'Field agent signup'],
  '/help': ['Help Centre', 'WhatsApp support'],
  '/safety': ['Safety Tips', 'Verify before paying'],
  '/anti-fraud': ['Fraud', 'Report suspicious'],
  '/privacy-policy': ['Privacy Policy', 'Data protection'],
  '/cookie-policy': ['Cookie Policy', 'Cookies'],
  '/terms': ['Terms and Conditions', 'Legal review'],
  '/report-fraud': ['Fraud', 'Report suspicious'],
  '/list-property': ['List Your Property', 'Find address or place', 'Submit for review'],
  '/login': ['Sign in or create your MakaUg account', 'Email address or phone number']
};

const PUBLIC_ROUTE_ACTIVE_IDS = {
  '/': 'page-home',
  '/for-sale': 'page-sale',
  '/to-rent': 'page-rent',
  '/student-accommodation': 'page-students',
  '/students': 'page-students',
  '/land': 'page-land',
  '/commercial': 'page-commercial',
  '/brokers': 'page-brokers',
  '/mortgage': 'page-mortgage',
  '/advertise': 'page-advertise',
  '/about': 'page-about',
  '/how-it-works': 'page-how-it-works',
  '/careers': 'page-careers',
  '/help': 'page-help',
  '/safety': 'page-safety',
  '/anti-fraud': 'page-fraud',
  '/privacy-policy': 'page-privacy-policy',
  '/cookie-policy': 'page-cookie-policy',
  '/terms': 'page-terms',
  '/report-fraud': 'page-fraud',
  '/list-property': 'page-list-property',
  '/login': 'page-login'
};

const FORBIDDEN_PUBLIC_IDS = [
  'page-account',
  'page-finder-dashboard',
  'page-student-dashboard',
  'page-agent-dashboard',
  'page-field-dashboard',
  'page-advertiser-dashboard',
  'page-admin-dashboard',
  'admin-evidence-modal',
  'admin-whatsapp-modal',
  'list-choice-modal',
  'listing-submit-modal',
  'save-property-modal',
  'auth-modal',
  'looking-modal',
  'broker-reg-modal',
  'preview-photo-modal',
  'detail-photo-modal'
];

function assertNoProtectedStrings(label, html) {
  for (const forbidden of PUBLIC_FORBIDDEN_STRINGS) {
    assert(!html.includes(forbidden), `${label} leaked protected string: ${forbidden}`);
  }
  assert(!/moderation/i.test(html), `${label} leaked moderation text`);
  assert(!/Inquiry Number:\s*-/i.test(html.replace(/<[^>]*>/g, ' ')), `${label} leaked blank inquiry reference`);
}

function normalizeText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function assertNoProtectedIds(label, html) {
  for (const id of FORBIDDEN_PUBLIC_IDS) {
    assert(!html.includes(`id="${id}"`), `${label} leaked protected/modal id: ${id}`);
  }
}

function run() {
  const sourceHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const propertySeekerRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'property-seeker.js'), 'utf8');
  const studentRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'student.js'), 'utf8');
  const adminRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  const advertisingRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'advertising.js'), 'utf8');
  const healthRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'health.js'), 'utf8');
  const leadService = fs.readFileSync(path.join(__dirname, '..', 'services', 'leadService.js'), 'utf8');
  const task3Migration = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '033_task3_engagement_crm.sql'), 'utf8');
  const task4Migration = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '034_task4_super_admin_alerts_payments.sql'), 'utf8');
  const superAdminScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'create-super-admin.js'), 'utf8');
  for (const publicRoute of PUBLIC_ROUTES) {
    const publicHtml = sanitizePublicHtml(sourceHtml, { pathname: publicRoute });
    const publicText = normalizeText(publicHtml);
    assertNoProtectedStrings(publicRoute, publicHtml);
    assertNoProtectedIds(publicRoute, publicHtml);
    assert(!publicText.includes('This area only This area only'), `${publicRoute} has duplicate location-scope labels`);
    assert(/class="[^"]*\bactive\b[^"]*"/.test(publicHtml), `${publicRoute} should have an active public content section`);
    const activeId = PUBLIC_ROUTE_ACTIVE_IDS[publicRoute];
    assert(new RegExp(`id="${activeId}"[^>]*class="[^"]*\\bactive\\b[^"]*"`, 'i').test(publicHtml), `${publicRoute} should activate ${activeId}`);
    const markers = PUBLIC_ROUTE_MARKERS[publicRoute] || [];
    assert(markers.some((marker) => publicText.toLowerCase().includes(marker.toLowerCase())), `${publicRoute} missing route-specific content marker`);
    assert(!publicHtml.includes('id="page-admin-docs"'), `${publicRoute} leaked admin docs`);
  }

  const homeHtml = sanitizePublicHtml(sourceHtml, { pathname: '/' });
  const homeText = normalizeText(homeHtml);
  assert(homeHtml.includes('id="page-home"'), 'homepage should render the homepage section');
  assert(!homeHtml.includes('id="page-list-property"'), 'homepage should not render the full list-property route');
  assert(!homeHtml.includes('id="page-about"'), 'homepage should not render the full about route');
  assert(!homeHtml.includes('id="page-mortgage"'), 'homepage should not render the full mortgage route');
  assert(!homeHtml.includes('id="page-fraud"'), 'homepage should not render the full fraud route');
  assert(!homeText.includes('# List Your Property - Free'), 'homepage should not contain raw list-property heading');
  assert(!homeText.includes('Listing submitted successfully'), 'homepage should not contain listing success panel');
  assert(!homeText.includes('Inquiry Number'), 'homepage should not contain inquiry number text before submission');
  assert(!homeText.includes('Our Mission'), 'homepage should not contain full about page body');
  assert(homeText.includes('Saved'), 'anonymous homepage should keep the saved entry point');
  assert(homeText.includes('Sign In'), 'anonymous homepage should show Sign In');
  assert(!homeText.includes('Dashboard'), 'anonymous homepage should not show Dashboard before auth');
  assert(!homeText.includes('Sign Out'), 'anonymous homepage should not show Sign Out before auth');
  assert(homeText.includes('Find your next home, land, rental, or student room'), 'homepage hero copy should be the go-live wording');
  assert(!homeText.includes('Discover your perfect maka'), 'old incomplete homepage hero copy should be gone');
  assert(/id="top-signout-link"[^>]*><\/a>/.test(sourceHtml), 'public header sign-out link should start empty until auth is present');
  assert(/id="top-dashboard-link"[^>]*><\/a>/.test(sourceHtml), 'public header dashboard link should start empty until auth is present');
  assert(sourceHtml.includes('id="top-dashboard-link"'), 'logged-in header dashboard link target should exist');
  assert(sourceHtml.includes('openSignedInDashboard()'), 'dashboard header link should route to the role dashboard');
  assert(sourceHtml.includes('translateListingLabel("Sign Out")'), 'logged-in header should inject Sign Out through auth UI');
  assert(sourceHtml.includes('? "Admin"'), 'super admin/admin should see Admin in logged-in header');
  assert(homeText.includes('© 2026 MakaUg. All rights reserved.'), 'homepage footer should use MakaUg copyright');
  assert(!homeText.includes('© 2026 Uganda Property'), 'old Uganda Property footer should be gone');

  const listPropertyHtml = sanitizePublicHtml(sourceHtml, { pathname: '/list-property' });
  const listPropertyText = normalizeText(listPropertyHtml);
  assert(listPropertyHtml.includes('id="page-list-property"'), '/list-property should render the listing form route');
  assert(listPropertyText.includes('Find address or place'), '/list-property should show address-first location flow');
  for (const oldLocationCopy of [
    'Location setup (step-by-step)',
    'Choose the location step by step',
    'Select region, then district',
    'Select city/town, then neighbourhood/zone',
    'The map follows your selected location'
  ]) {
    assert(!listPropertyText.includes(oldLocationCopy), `/list-property still contains old location copy: ${oldLocationCopy}`);
  }
  for (const invalidReference of [
    'Inquiry Number: -',
    'Inquiry Number: Pending reference',
    'Reference: Pending reference',
    'Pending reference'
  ]) {
    assert(!listPropertyText.includes(invalidReference), `/list-property leaked invalid default reference: ${invalidReference}`);
  }

  const aboutHtml = sanitizePublicHtml(sourceHtml, { pathname: '/about' });
  const mortgageHtml = sanitizePublicHtml(sourceHtml, { pathname: '/mortgage' });
  const fraudHtml = sanitizePublicHtml(sourceHtml, { pathname: '/fraud' });
  const loginHtml = sanitizePublicHtml(sourceHtml, { pathname: '/login' });
  const loginText = normalizeText(loginHtml);
  assert(aboutHtml.includes('id="page-about"'), '/about should render the about route');
  assert(normalizeText(aboutHtml).includes('Our Mission'), '/about should contain the full about page');
  assert(mortgageHtml.includes('id="page-mortgage"'), '/mortgage should render the mortgage route');
  assert(!normalizeText(mortgageHtml).includes('Mortgage Playground'), '/mortgage should not use old playground wording');
  assert(!normalizeText(mortgageHtml).includes('Move sliders'), '/mortgage should not use slider playground copy');
  assert(normalizeText(mortgageHtml).includes('Gross Monthly Income Required'), '/mortgage should show professional result panel');
  assert(fraudHtml.includes('id="page-fraud"'), '/fraud should render the fraud route');
  assert(loginHtml.includes('id="page-login"'), '/login should render clean auth route');
  assert(loginText.includes('Sign in or create your MakaUg account'), '/login should show clean auth heading');
  for (const unrelated of ['Find your perfect rental property', 'Mortgage Finder Mortgage Finder', 'Fraud Prevention', 'Commercial Property Hub']) {
    assert(!loginText.includes(unrelated), `/login should not render marketplace route content: ${unrelated}`);
  }
  assert(sourceHtml.includes('data-testid="list-property-free-cta"'), 'header should expose List your property for free CTA');
  assert(!sourceHtml.includes('data-testid="advertise-property-cta"'), 'header should not keep old Advertise Property CTA test id');
  assert(sourceHtml.includes('handleListPropertyFreeCta(event)'), 'header List your property CTA should be wired');
  assert(sourceHtml.includes('id="student-login-cta"'), 'student login CTA should be globally addressable for tests');

  const mortgagePayment = computeMortgagePayment(200000000, 16, 20);
  assert(mortgagePayment > 2700000 && mortgagePayment < 2900000, 'mortgage amortization formula should produce a realistic repayment');
  const mortgageEstimate = buildMortgageEstimate({ purchasePrice: 250000000, depositPercent: 20, annualRate: 16, termYears: 20 });
  assert.strictEqual(Math.round(mortgageEstimate.loanAmount), 200000000, 'mortgage estimate should calculate loan amount after deposit');
  assert(mortgageEstimate.onceOffCosts > mortgageEstimate.depositAmount, 'mortgage estimate should include once-off costs beyond deposit');

  const requiredDashboardShellText = [
    'My Property Brief',
    'Recommended For You',
    'Saved Searches and Alerts',
    'Enquiries and WhatsApp Contacts',
    'Viewing Bookings',
    'Callback Requests',
    'Compare Properties',
    'Mortgage/Budget Centre',
    'Safety and Trust Centre',
    'Area Watch',
    'Saved Student Searches',
    'Enquiry History and WhatsApp Requests',
    'Language Preference',
    'Advertiser Dashboard',
    'Create Campaign',
    'Creatives',
    'Packages',
    'Payments / Invoices',
    'Performance Reports',
    'CRM Lead Centre',
    'Lead Pipeline',
    'Demand Intelligence',
    'Revenue Opportunities',
    'WhatsApp Lead Sources',
    'Lead, Email & Notification Control',
    'Notification Log',
    'Email Log',
    'WhatsApp Message Log'
  ];
  for (const expected of requiredDashboardShellText) {
    assert(sourceHtml.includes(expected), `missing dashboard shell section: ${expected}`);
  }
  assert(sourceHtml.includes('id="page-admin-docs"'), 'admin docs page should exist for protected admin route');
  assert(sourceHtml.includes('MakaUg Go-Live Documentation'), 'admin docs should show launch documentation');
  assert(healthRoutes.includes("router.get('/migrations'"), 'health migration status route should exist');

  for (const expected of [
    'GET /api/property-seeker/dashboard',
    'saved-searches',
    'viewings',
    'callbacks',
    'property-comparison',
    'hidden-listings',
    'listing-notes'
  ]) {
    const needle = expected === 'GET /api/property-seeker/dashboard' ? "router.get('/dashboard'" : expected;
    assert(propertySeekerRoutes.includes(needle), `property seeker API missing ${expected}`);
  }
  assert(studentRoutes.includes("router.post('/saved-searches'"), 'student saved-search API should exist');
  for (const expected of [
    "router.get('/crm/summary'",
    "router.get('/notifications'",
    "router.get('/emails'",
    "router.get('/whatsapp-message-logs'",
    "router.get('/leads'",
    "router.patch('/leads/:id'",
    "router.post('/leads/:id/activities'"
  ]) {
    assert(adminRoutes.includes(expected), `admin CRM/log route missing: ${expected}`);
  }
  for (const expected of [
    "router.get('/dashboard'",
    "router.post('/campaigns'",
    "router.post('/campaigns/:id/payment-link'",
    "router.get('/payment-links/:id/status'",
    "router.post('/payment-webhook/:provider?'",
    'providerMissing',
    'createLead'
  ]) {
    assert(advertisingRoutes.includes(expected), `advertising workflow missing: ${expected}`);
  }
  for (const expected of [
    "router.get('/alerts'",
    "router.post('/alerts/:id/retry'",
    "router.post('/payments/invoices/:id/manual-paid'",
    "router.post('/notifications/:id/retry'",
    "router.post('/emails/:id/retry'",
    "router.post('/whatsapp-message-logs/:id/retry'"
  ]) {
    assert(adminRoutes.includes(expected), `Task 4 admin route missing: ${expected}`);
  }
  for (const expected of ['createLead', 'addLeadActivity', 'lead_activities', 'contacts']) {
    assert(leadService.includes(expected), `lead service missing ${expected}`);
  }
  for (const tableName of [
    'contacts',
    'leads',
    'lead_activities',
    'lead_tasks',
    'viewing_configs',
    'viewing_bookings',
    'callback_requests',
    'invoices',
    'payment_links',
    'email_logs',
    'whatsapp_message_logs'
  ]) {
    assert(new RegExp(`CREATE TABLE IF NOT EXISTS\\s+${tableName}`, 'i').test(task3Migration), `Task 3 migration missing ${tableName}`);
  }
  assert(task4Migration.includes("'super_admin'"), 'Task 4 migration must allow super_admin role');
  assert(/CREATE TABLE IF NOT EXISTS\s+admin_security_settings/i.test(task4Migration), 'Task 4 migration should add admin security settings');
  assert(/CREATE TABLE IF NOT EXISTS\s+admin_audit_logs/i.test(task4Migration), 'Task 4 migration should add admin audit logs');
  assert(superAdminScript.includes('SUPER_ADMIN_EMAIL'), 'super admin bootstrap must use SUPER_ADMIN_EMAIL');
  assert(superAdminScript.includes('SUPER_ADMIN_INITIAL_PASSWORD'), 'super admin bootstrap must use one-time password env');
  assert(superAdminScript.includes('bcrypt.hash'), 'super admin bootstrap must hash the password');
  assert(!superAdminScript.includes('console.log(password'), 'super admin bootstrap must not print the password');

  for (const protectedPath of ['/dashboard', '/student-dashboard', '/broker-dashboard', '/field-agent-dashboard', '/advertiser-dashboard', '/account', '/admin', '/admin/docs', '/admin/moderation', '/admin/crm', '/admin/leads', '/admin/advertising', '/admin/revenue', '/admin/notifications']) {
    assert(isProtectedPath(protectedPath), `${protectedPath} should be protected`);
    const shell = renderProtectedLoginShell(protectedPath);
    assert(shell.includes('noindex,noarchive'), `${protectedPath} protected shell needs noindex/noarchive`);
    assertNoProtectedStrings(`${protectedPath} login shell`, shell);
  }
  for (const publicPath of ['/', '/for-sale', '/to-rent', '/students', '/student-accommodation', '/land', '/commercial', '/signup', '/login', '/list-property']) {
    assert(!isProtectedPath(publicPath), `${publicPath} should be public`);
  }
  assert(roleCanAccessProtectedPath({ role: 'admin' }, '/admin'), 'admin should access admin');
  assert(roleCanAccessProtectedPath({ role: 'admin' }, '/admin/crm'), 'admin should access CRM centre');
  assert(roleCanAccessProtectedPath({ role: 'admin' }, '/admin/leads'), 'admin should access lead centre');
  for (const adminPath of ['/admin', '/admin/crm', '/admin/leads', '/admin/advertising', '/admin/revenue', '/admin/notifications', '/admin/emails', '/admin/whatsapp-inbox', '/admin/alerts', '/dashboard', '/student-dashboard', '/broker-dashboard', '/field-agent-dashboard', '/advertiser-dashboard']) {
    assert(roleCanAccessProtectedPath({ role: 'super_admin', audience: 'super_admin' }, adminPath), `super_admin should access ${adminPath}`);
  }
  assert(!roleCanAccessProtectedPath({ role: 'buyer_renter', audience: 'finder' }, '/admin'), 'normal users must not access admin');
  assert(roleCanAccessProtectedPath({ role: 'agent_broker', audience: 'agent' }, '/broker-dashboard'), 'broker should access broker dashboard');
  assert(!roleCanAccessProtectedPath({ role: 'buyer_renter', audience: 'finder' }, '/broker-dashboard'), 'finder must not access broker dashboard');
  assert(roleCanAccessProtectedPath({ role: 'field_agent', audience: 'field_agent' }, '/field-agent-dashboard'), 'field agent should access field dashboard');
  assert(!roleCanAccessProtectedPath({ role: 'buyer_renter', audience: 'finder' }, '/field-agent-dashboard'), 'finder must not access field dashboard');
  assert(roleCanAccessProtectedPath({ role: 'buyer_renter', audience: 'student' }, '/student-dashboard'), 'student should access student dashboard');
  assert(!roleCanAccessProtectedPath({ role: 'buyer_renter', audience: 'finder' }, '/student-dashboard'), 'finder must not access student dashboard');
  assert(roleCanAccessProtectedPath({ role: 'buyer_renter', audience: 'advertiser' }, '/advertiser-dashboard'), 'advertiser should access advertiser dashboard');
  assert(!roleCanAccessProtectedPath({ role: 'buyer_renter', audience: 'finder' }, '/advertiser-dashboard'), 'finder must not access advertiser dashboard');

  assert.strictEqual(normalizeSignupAudience('student-signup'), 'student');
  assert.strictEqual(normalizeSignupAudience('super_admin'), 'super_admin');
  assert.strictEqual(normalizeSignupAudience('field-agent-signup'), 'field_agent');
  assert.strictEqual(roleForSignup({ audience: 'field_agent' }), 'field_agent');
  assert.strictEqual(roleForSignup({ audience: 'agent' }), 'agent_broker');
  assert.strictEqual(roleForSignup({ audience: 'student' }), 'buyer_renter');
  assert.strictEqual(roleForSignup({ audience: 'advertiser' }), 'buyer_renter');
  assert.strictEqual(dashboardForUser({ role: 'buyer_renter', profile_data: { audience: 'student' } }), '/student-dashboard');
  assert.strictEqual(dashboardForUser({ role: 'agent_broker', profile_data: { audience: 'agent' } }), '/broker-dashboard');
  assert.strictEqual(dashboardForUser({ role: 'field_agent', profile_data: { audience: 'field_agent' } }), '/field-agent-dashboard');
  assert.strictEqual(dashboardForUser({ role: 'buyer_renter', profile_data: { audience: 'advertiser' } }), '/advertiser-dashboard');
  assert.strictEqual(dashboardForUser({ role: 'super_admin', profile_data: { audience: 'super_admin' } }), '/admin');

  assert.strictEqual(normalizePaymentStatus('successful'), 'paid');
  assert.strictEqual(normalizePaymentStatus('declined'), 'failed');
  assert.strictEqual(typeof paymentProviderConfigured(), 'boolean');
  assert(savedSearchMatchesListing(
    { category: 'rent', location: 'Ntinda', max_price: 2000000, alert_channels: ['in_app'] },
    { id: 'listing-1', listing_type: 'rent', area: 'Ntinda', district: 'Kampala', price: 1400000 }
  ), 'saved-search matcher should match a relevant approved listing');
  assert(!savedSearchMatchesListing(
    { category: 'rent', location: 'Ntinda', max_price: 1000000 },
    { id: 'listing-2', listing_type: 'rent', area: 'Ntinda', price: 1400000 }
  ), 'saved-search matcher should reject over-budget listings');

  const listingReference = buildListingReference(new Date('2026-05-02T08:30:00.000Z'));
  assert(isListingReference(listingReference), `listing reference should match production format: ${listingReference}`);
  assert(/^MK-\d{8}-[A-Z0-9]{5,}$/.test(listingReference), `listing reference should be immediately usable: ${listingReference}`);

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
