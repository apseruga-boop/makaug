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
const { HOW_TO_VIDEO_SLOTS } = require('../config/howToVideos');

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
  '/list-property': ['List Property', 'Find address or place', 'Submit for review'],
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
    if (label === '/list-property' && id === 'listing-submit-modal') continue;
    assert(!html.includes(`id="${id}"`), `${label} leaked protected/modal id: ${id}`);
  }
}

function run() {
  const sourceHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const propertySeekerRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'property-seeker.js'), 'utf8');
  const studentRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'student.js'), 'utf8');
  const adminRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  const authRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
  const advertisingRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'advertising.js'), 'utf8');
  const aiRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'ai.js'), 'utf8');
  const healthRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'health.js'), 'utf8');
  const leadService = fs.readFileSync(path.join(__dirname, '..', 'services', 'leadService.js'), 'utf8');
  const propertiesRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'properties.js'), 'utf8');
  const contactRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'contact.js'), 'utf8');
  const mortgageRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'mortgage.js'), 'utf8');
  const listingModerationService = fs.readFileSync(path.join(__dirname, '..', 'services', 'listingModerationService.js'), 'utf8');
  const emailLogService = fs.readFileSync(path.join(__dirname, '..', 'services', 'emailLogService.js'), 'utf8');
  const whatsappMessageLogService = fs.readFileSync(path.join(__dirname, '..', 'services', 'whatsappMessageLogService.js'), 'utf8');
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
  assert(homeText.includes('List Property'), 'homepage should show the short List Property CTA');
  assert(!homeText.includes('List your property for free'), 'homepage header should not use the long list-property CTA');
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
  for (const badBrandText of [
    'Use makaug in 7 Ugandan languages',
    'About makaug.com',
    'Welcome to makaug',
    'Create your free makaug account to:',
    'You authorize makaug',
    'makaug may contact',
    'keep makaug safer',
    'Hello+makaug',
    'Hello%20makaug'
  ]) {
    assert(!sourceHtml.includes(badBrandText), `public-facing brand text should use MakaUg casing: ${badBrandText}`);
  }
  assert(sourceHtml.includes('Use MakaUg in 7 Ugandan languages'), 'language spotlight should use MakaUg casing');
  assert(sourceHtml.includes('About MakaUg'), 'about labels should use MakaUg casing');

  const listPropertyHtml = sanitizePublicHtml(sourceHtml, { pathname: '/list-property' });
  const listPropertyText = normalizeText(listPropertyHtml);
  assert(listPropertyHtml.includes('id="page-list-property"'), '/list-property should render the listing form route');
  assert(listPropertyHtml.includes('id="listing-submit-modal"'), '/list-property should include the hidden post-submit success modal');
  assert(/id="listing-submit-modal"[^>]*class="modal-overlay"/.test(listPropertyHtml), 'listing submit modal should be hidden by default');
  assert(!/id="listing-submit-modal"[^>]*class="[^"]*\bopen\b/i.test(listPropertyHtml), 'listing submit modal should not be open before submission');
  assert(listPropertyText.includes('List Property'), '/list-property should use short page title');
  assert(listPropertyText.includes('List your property on MakaUg for free.'), '/list-property should explain free listing in supporting copy');
  assert(!listPropertyText.includes('List Your Property - Free'), '/list-property should not use old long free title');
  assert(listPropertyText.includes('Find address or place'), '/list-property should show address-first location flow');
  assert(/<details\s+id="lp-location-advanced"[^>]*>/i.test(listPropertyHtml), '/list-property should keep advanced location details collapsed');
  assert(!/<details\s+id="lp-location-advanced"[^>]*\sopen\b/i.test(listPropertyHtml), 'advanced location details should be collapsed by default');
  assert(listPropertyHtml.includes('data-listing-translation-preview="1"'), 'listing description translation preview should exist');
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
  assert(sourceHtml.includes('data-listing-submit-success-modal="1"'), 'listing submission success modal should exist in source');
  assert(sourceHtml.includes('Your property has been submitted'), 'success modal should use the go-live submission title');
  assert(sourceHtml.includes('listing-submit-email-status'), 'success modal should show email confirmation status');
  assert(sourceHtml.includes('listing-submit-whatsapp-status'), 'success modal should show WhatsApp confirmation status');
  assert(sourceHtml.includes('List another property'), 'success modal should offer list-another action');
  assert(sourceHtml.includes('Go to dashboard'), 'success modal should offer dashboard action');
  assert(sourceHtml.includes('Email confirmation has been logged and will send when email is configured.'), 'success modal should explain provider-missing email fallback');
  assert(sourceHtml.includes('WhatsApp confirmation logged for admin follow-up.'), 'success modal should explain WhatsApp fallback');
  assert(propertiesRoutes.includes('logEmailEvent'), 'property submission should create EmailLog entries');
  assert(propertiesRoutes.includes('logWhatsAppMessage'), 'property submission should create WhatsAppMessageLog entries');
  assert(propertiesRoutes.includes('listing_submitted'), 'property submission should log listing_submitted event');
  assert(propertiesRoutes.includes("source: 'listing_submission'"), 'property submission should create a CRM lead source');
  assert(propertiesRoutes.includes("leadType: 'listing_owner'"), 'property submission should create listing-owner CRM lead');
  assert(propertiesRoutes.includes("activityType: 'whatsapp_contact_initiated'"), 'WhatsApp listing click should create CRM lead activity');
  assert(propertiesRoutes.includes("activityType: 'property_enquiry_created'"), 'property enquiry should create CRM lead activity');
  assert(listingModerationService.includes('Your MakaUg property listing has been submitted'), 'property submitted email subject should be MakaUg branded');
  assert(listingModerationService.includes('Status: Pending Review'), 'property submitted email should include pending-review status');
  assert(listingModerationService.includes('WhatsApp support'), 'property submitted email should include WhatsApp support');
  assert(emailLogService.includes('INSERT INTO email_logs'), 'email log service should persist email logs when table exists');
  assert(whatsappMessageLogService.includes('INSERT INTO whatsapp_message_logs'), 'WhatsApp log service should persist WhatsApp logs when table exists');

  const aboutHtml = sanitizePublicHtml(sourceHtml, { pathname: '/about' });
  const mortgageHtml = sanitizePublicHtml(sourceHtml, { pathname: '/mortgage' });
  const fraudHtml = sanitizePublicHtml(sourceHtml, { pathname: '/fraud' });
  const loginHtml = sanitizePublicHtml(sourceHtml, { pathname: '/login' });
  const howItWorksHtml = sanitizePublicHtml(sourceHtml, { pathname: '/how-it-works' });
  const helpHtml = sanitizePublicHtml(sourceHtml, { pathname: '/help' });
  const safetyHtml = sanitizePublicHtml(sourceHtml, { pathname: '/safety' });
  const loginText = normalizeText(loginHtml);
  const aboutText = normalizeText(aboutHtml);
  const helpText = normalizeText(helpHtml);
  const howItWorksText = normalizeText(howItWorksHtml);
  assert(aboutHtml.includes('id="page-about"'), '/about should render the about route');
  assert(aboutText.includes('About MakaUg'), '/about should show About MakaUg');
  for (const expected of [
    'Property in Uganda should be easier to find, easier to list, and safer to trust.',
    'Who we are',
    'Our mission',
    'Why MakaUg exists',
    'Renters',
    'Buyers',
    'Students and parents',
    'Owners and sellers',
    'Brokers',
    'Commercial users',
    'How we support trust and safety'
  ]) {
    assert(aboutText.includes(expected), `/about missing redesigned section: ${expected}`);
  }
  const pageAboutBlock = sourceHtml.slice(sourceHtml.indexOf('<div id="page-about"'), sourceHtml.indexOf('<div id="page-saved"'));
  assert(!/<h[12][^>]*>[^<]*Mortgage/i.test(pageAboutBlock), '/about should not make mortgage a major section');
  assert(helpText.includes('MakaUg Help Centre'), '/help should show Help Centre heading');
  for (const expected of [
    'Finding property',
    'Listing property',
    'Student accommodation',
    'Saved searches and alerts',
    'Book viewings and callbacks',
    'Brokers and agents',
    'Land and title safety',
    'Fraud and suspicious listings',
    'Account and login',
    'Advertising with MakaUg',
    'Contact MakaUg support'
  ]) {
    assert(helpText.includes(expected), `/help missing category or support form content: ${expected}`);
  }
  assert(contactRoutes.includes("router.post('/help-request'"), 'help request API should exist');
  assert(contactRoutes.includes('help_request_submitted'), 'help request should log an email/notification event');
  assert(contactRoutes.includes('fraud_report_received'), 'fraud reports should create notification/email coverage');
  assert(contactRoutes.includes('property_need_request_created'), 'tell-MakaUg property need requests should create CRM/log events');
  assert(contactRoutes.includes('createLead'), 'help/fraud/property need contact routes should create CRM leads');
  assert(howItWorksText.includes('How MakaUg Works'), '/how-it-works should show route heading');
  for (const expected of ['Search property', 'Use filters', 'Save options', 'Create alerts', 'WhatsApp contact', 'Book viewing', 'List property', 'Review checks', 'Use dashboards', 'Report suspicious']) {
    assert(howItWorksText.includes(expected), `/how-it-works missing step: ${expected}`);
  }
  assert(sourceHtml.includes('data-howto-video-modal="1"'), 'how-to video modal should exist');
  const generalHowToKeys = ['what-is-makaug', 'search-property', 'use-filters', 'student-accommodation', 'list-property', 'location-and-photos', 'whatsapp-contact', 'save-searches-alerts', 'book-viewing-callback', 'stay-safe-report'];
  const aiHowToKeys = ['ai-can-help', 'ai-search-whatsapp', 'ai-list-property', 'ai-alerts-recommendations', 'ai-fraud-handoff'];
  assert.strictEqual(generalHowToKeys.filter((key) => HOW_TO_VIDEO_SLOTS.some((slot) => slot.key === key)).length, 10, 'there should be 10 general how-to video slots');
  assert.strictEqual(aiHowToKeys.filter((key) => HOW_TO_VIDEO_SLOTS.some((slot) => slot.key === key)).length, 5, 'there should be 5 AI chatbot how-to video slots');
  for (const requiredVideo of [...generalHowToKeys, ...aiHowToKeys]) {
    assert(HOW_TO_VIDEO_SLOTS.some((slot) => slot.key === requiredVideo), `missing how-to video slot: ${requiredVideo}`);
  }
  for (const context of ['about', 'how-it-works', 'help', 'list-property', 'students', 'safety', 'ai-chatbot']) {
    assert(sourceHtml.includes(`data-howto-video-grid="${context}"`) || [aboutHtml, howItWorksHtml, helpHtml, listPropertyHtml, safetyHtml].some((html) => html.includes(`data-howto-video-grid="${context}"`)), `missing how-to video grid for ${context}`);
  }
  assert(sourceHtml.includes('openHowToVideo'), 'how-to videos should open in a modal');
  assert(sourceHtml.includes('youtubeVideoId'), 'how-to videos should support YouTube IDs');
  assert(mortgageHtml.includes('id="page-mortgage"'), '/mortgage should render the mortgage route');
  assert(!normalizeText(mortgageHtml).includes('Mortgage Playground'), '/mortgage should not use old playground wording');
  assert(!normalizeText(mortgageHtml).includes('Move sliders'), '/mortgage should not use slider playground copy');
  assert(normalizeText(mortgageHtml).includes('Gross Monthly Income Required'), '/mortgage should show professional result panel');
  assert(mortgageHtml.includes('data-mortgage-visual="light-3d"'), '/mortgage should use the light 3D calculator shell');
  assert(mortgageHtml.includes('mortgage-result-pop'), '/mortgage should include subtle result animation styling');
  assert(fraudHtml.includes('id="page-fraud"'), '/fraud should render the fraud route');
  assert(loginHtml.includes('id="page-login"'), '/login should render clean auth route');
  assert(loginText.includes('Sign in or create your MakaUg account'), '/login should show clean auth heading');
  for (const unrelated of ['Find your perfect rental property', 'Mortgage Finder Mortgage Finder', 'Fraud Prevention', 'Commercial Property Hub']) {
    assert(!loginText.includes(unrelated), `/login should not render marketplace route content: ${unrelated}`);
  }
  assert(sourceHtml.includes('data-testid="list-property-free-cta"'), 'header should expose List Property CTA');
  assert(sourceHtml.includes('id="nav-about"') && sourceHtml.includes('>About Us</a>'), 'primary nav should show About Us');
  assert(!sourceHtml.includes('id="nav-fraud"'), 'primary nav should not show Fraud as the main nav item');
  assert(sourceHtml.includes('id="footer-link-anti-fraud"'), 'Anti-Fraud should remain available from footer/support');
  assert(!sourceHtml.includes('List your property for free'), 'source should not keep old header CTA wording');
  assert(!sourceHtml.includes('List a Property Free'), 'source should not keep old footer CTA wording');
  assert(!sourceHtml.includes('data-testid="advertise-property-cta"'), 'header should not keep old Advertise Property CTA test id');
  assert(sourceHtml.includes('handleListPropertyFreeCta(event)'), 'header List your property CTA should be wired');
  assert(sourceHtml.includes('data-list-property-choice="1"'), '/list-property should offer online and WhatsApp listing choices');
  assert(sourceHtml.includes('openListPropertyWhatsApp'), '/list-property WhatsApp listing action should be wired');
  assert(sourceHtml.includes('id="student-login-cta"'), 'student login CTA should be globally addressable for tests');
  assert(sourceHtml.includes('data-auth-role-card="1"'), 'auth drawer should use icon role cards');
  for (const iconClass of ['fa-house-chimney', 'fa-graduation-cap', 'fa-briefcase', 'fa-clipboard-list', 'fa-bullhorn']) {
    assert(sourceHtml.includes(iconClass), `auth drawer missing role icon: ${iconClass}`);
  }
  assert(sourceHtml.includes('ACCOUNT_ACCESS_SCREENING'), 'auth drawer should define quick screening questions');
  for (const role of ['finder', 'student', 'agent', 'field_agent', 'advertiser']) {
    const match = sourceHtml.match(new RegExp(`${role}: \\[([\\s\\S]*?)\\n\\s*\\]`, 'm'));
    assert(match, `missing auth screening questions for ${role}`);
    const count = (match[1].match(/key:/g) || []).length;
    assert(count > 0 && count <= 5, `${role} should have 1-5 screening questions, got ${count}`);
  }
  assert(sourceHtml.includes('id="account-access-email"'), 'create account journey should collect email');
  assert(sourceHtml.includes('id="account-access-phone"'), 'create account journey should collect phone/WhatsApp');
  assert(sourceHtml.includes('id="account-access-confirm-password"'), 'create account journey should collect password confirmation');
  assert(sourceHtml.includes('id="account-access-otp-code"'), 'create account journey should verify OTP inside the drawer');
  assert(sourceHtml.includes('accountAccessDrawerMode === "verify"'), 'auth drawer should handle verification as an inline step');
  assert(sourceHtml.includes('overflow-x-hidden'), 'mobile auth drawer should prevent horizontal overflow');
  assert(!sourceHtml.includes('data-auth-progress-step="account"'), 'auth drawer should not show old Account/Details/Preferences/Verify pills on the first screen');
  assert(sourceHtml.includes('id="account-access-progress-summary"'), 'auth drawer should show compact create-account progress only after create is selected');
  assert(sourceHtml.includes('openPolicyPreviewModal'), 'auth drawer should expose terms/privacy preview interactions');
  assert(sourceHtml.includes('account-access-otp-method-wrap'), 'auth drawer should let users choose email or phone/WhatsApp OTP');
  assert(sourceHtml.includes('openAccountAccessDrawer("signin"'), 'header sign-in should open the new drawer');
  assert(sourceHtml.includes('openAccountAccessDrawer("create"'), 'create account should open the new drawer');

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
    'Search preference summary',
    'Sponsored slot',
    'Dashboard order',
    'Account settings',
    'Saved Student Searches',
    'Enquiry History and WhatsApp Requests',
    'Language Preference',
    'Broker account settings',
    'Field Agent settings',
    'Advertiser settings',
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
  assert(sourceHtml.includes('Backend Traceability Matrix'), 'admin docs should link backend traceability matrix');
  assert(fs.existsSync(path.join(__dirname, '..', 'docs', 'backend-traceability-matrix.md')), 'backend traceability matrix doc should exist');
  assert(sourceHtml.includes('id="admin-launch-control"'), 'admin launch control should exist');
  for (const expected of [
    'Public Route Health',
    'CTA health',
    'Performance Health',
    'Email / Notification Health',
    'WhatsApp Health',
    'Listings Pending Review',
    'Saved-search Demand',
    'How-to Video Status',
    'Content / i18n Status',
    'Payment Status'
  ]) {
    assert(sourceHtml.includes(expected), `admin launch control missing owner health section: ${expected}`);
  }
  assert(sourceHtml.includes('data-admin-preview-links="1"'), 'super_admin dashboard preview links should exist');
  assert(sourceHtml.includes('Admin preview mode — read only'), 'dashboard preview should show read-only admin banner');
  for (const previewPath of ['/dashboard?admin_preview=1', '/student-dashboard?admin_preview=1', '/broker-dashboard?admin_preview=1', '/field-agent-dashboard?admin_preview=1', '/advertiser-dashboard?admin_preview=1']) {
    assert(sourceHtml.includes(previewPath), `missing dashboard preview link: ${previewPath}`);
  }
  assert(healthRoutes.includes("router.get('/migrations'"), 'health migration status route should exist');
  assert(sourceHtml.includes('data-ai-chatbot-live-panel="1"'), 'AI chatbot route should expose a connected live task panel');
  assert(sourceHtml.includes('submitAiChatbotPrompt'), 'AI chatbot prompt should be wired to a safe API/fallback flow');
  assert(aiRoutes.includes('captureLearningEvent'), 'AI assistant API should capture conversation events');
  assert(aiRoutes.includes('conversation_logged'), 'AI assistant API should report that backend logging happened');
  assert(aiRoutes.includes('human_handoff_required'), 'AI assistant API should log human handoff events');
  assert(aiRoutes.includes('createLead'), 'AI assistant API should create CRM leads for handoff/fraud/mortgage/advertiser intents');
  for (const intent of ['search_property', 'search_rent', 'search_sale', 'search_student', 'search_land', 'search_commercial', 'save_search', 'create_alert', 'book_viewing', 'request_callback', 'list_property', 'list_property_whatsapp', 'report_fraud', 'ask_mortgage', 'ask_help', 'advertiser_interest', 'language_change', 'human_handoff']) {
    assert(sourceHtml.includes(`value="${intent}"`) || sourceHtml.includes(`"${intent}"`), `AI chatbot missing intent: ${intent}`);
  }

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
  assert(authRoutes.includes("if (!email) errors.push('email is required')"), 'backend registration should require email for account creation');
  assert(authRoutes.includes("if (!phone) errors.push('phone is required')"), 'backend registration should require phone/WhatsApp for account creation');
  assert(authRoutes.includes('recordAdminLogin'), 'admin/super_admin login should be audited');
  assert(authRoutes.includes('recordAdminPasswordChange'), 'admin/super_admin password changes should be audited');
  assert(mortgageRoutes.includes('mortgage_lead_received'), 'mortgage enquiry should create/log mortgage lead events');
  assert(mortgageRoutes.includes('createLead'), 'mortgage enquiry should create CRM leads');
  assert(mortgageRoutes.includes('logEmailEvent'), 'mortgage enquiry should create EmailLog entries');

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
    'listing_approved',
    'listing_rejected',
    'saved_search_created',
    'viewing_requested',
    'callback_requested',
    'mortgage_lead_received',
    'help_request_submitted',
    'fraud_report_received',
    'advertiser_signup_received',
    'campaign_submitted',
    'payment_link_created',
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
