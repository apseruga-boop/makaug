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
const { isSmsOtpDeliveryConfirmed } = require('../services/phoneOtpDeliveryService');
const { notificationStatusFromDelivery } = require('../services/notificationLogService');
const { buildMortgageEstimate, computeMonthlyRepayment: computeMortgagePayment } = require('../services/mortgageCalculatorService');
const { HOW_TO_VIDEO_SLOTS } = require('../config/howToVideos');
const {
  LANGUAGE_REGISTRY,
  normalizeLanguageCode,
  toCanonicalLanguageCode,
  shouldUseEnglishFallback
} = require('../config/languageRegistry');
const {
  DEFAULT_SEARCH_RADIUS_MILES,
  haversineKm,
  isPointInUganda,
  normalizeRadiusKm,
  normalizeRadiusMiles,
  roundLocationForAnalytics
} = require('../services/locationSearchService');

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
  '/login': ['Opening your makaug.com account panel', 'Open account panel']
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
  'page-admin-setup-status',
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
    if (label === '/list-property' && id === 'list-choice-modal') continue;
    assert(!html.includes(`id="${id}"`), `${label} leaked protected/modal id: ${id}`);
  }
}

function run() {
  const sourceHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const propertySeekerRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'property-seeker.js'), 'utf8');
  const studentRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'student.js'), 'utf8');
  const adminRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  const authRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
  const authFlowServiceSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'authFlowService.js'), 'utf8');
  const advertisingRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'advertising.js'), 'utf8');
  const aiRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'ai.js'), 'utf8');
  const healthRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'health.js'), 'utf8');
  const whatsappRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
  const aiServiceSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'aiService.js'), 'utf8');
  const languageRegistrySource = fs.readFileSync(path.join(__dirname, '..', 'config', 'languageRegistry.js'), 'utf8');
  const smsServiceSource = fs.readFileSync(path.join(__dirname, '..', 'models', 'smsService.js'), 'utf8');
  const leadService = fs.readFileSync(path.join(__dirname, '..', 'services', 'leadService.js'), 'utf8');
  const phoneOtpDeliveryServiceSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'phoneOtpDeliveryService.js'), 'utf8');
  const whatsappNotificationServiceSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'whatsappNotificationService.js'), 'utf8');
  const propertiesRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'properties.js'), 'utf8');
  const locationSearchServiceSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'locationSearchService.js'), 'utf8');
  const translationProviderServiceSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'translationProviderService.js'), 'utf8');
  const contactRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'contact.js'), 'utf8');
  const mortgageRoutes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'mortgage.js'), 'utf8');
  const listingModerationService = fs.readFileSync(path.join(__dirname, '..', 'services', 'listingModerationService.js'), 'utf8');
  const emailLogService = fs.readFileSync(path.join(__dirname, '..', 'services', 'emailLogService.js'), 'utf8');
  const whatsappMessageLogService = fs.readFileSync(path.join(__dirname, '..', 'services', 'whatsappMessageLogService.js'), 'utf8');
  const clickProbeScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'probe-click-actions.js'), 'utf8');
  const backendConnectionProbeScript = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'probe-backend-connections.js'), 'utf8');
  const backendReadinessReport = fs.readFileSync(path.join(__dirname, '..', 'docs', 'backend-readiness-report.md'), 'utf8');
  const backendTraceabilityMatrix = fs.readFileSync(path.join(__dirname, '..', 'docs', 'backend-traceability-matrix.md'), 'utf8');
  const goLiveManualQa = fs.readFileSync(path.join(__dirname, '..', 'docs', 'go-live-manual-qa.md'), 'utf8');
  const fieldAgentSetupDoc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'field-agent-live-setup.md'), 'utf8');
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
    assert(!publicHtml.includes('id="page-admin-setup-status"'), `${publicRoute} leaked owner setup status`);
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
  assert(homeText.includes('© 2026 makaug.com. All rights reserved.'), 'homepage footer should use lowercase public brand copyright');
  assert(!homeText.includes('© 2026 Uganda Property'), 'old Uganda Property footer should be gone');
  for (const badBrandText of [
    'Use makaug in 7 Ugandan languages',
    'Welcome to makaug',
    'Create your free makaug account to:',
    'You authorize makaug',
    'makaug may contact',
    'keep makaug safer',
    'Hello+makaug+',
    'Hello%20makaug%20',
    'MakarUG',
    'Makar'
  ]) {
    assert(!homeText.includes(badBrandText), `public-facing homepage text should use makaug.com display: ${badBrandText}`);
  }
  assert(sourceHtml.includes('BrandConfig') && sourceHtml.includes('productDisplayName: "makaug.com"'), 'public brand display should be controlled by BrandConfig');
  assert(sourceHtml.includes('function navigatePublicRoute'), 'frontend should have a SPA route navigator to prevent full-page public route reloads');
  assert(sourceHtml.includes('installPublicRouteInterceptor'), 'frontend should install the public route click interceptor');
  assert(sourceHtml.includes('window.history.pushState({ page, source: options.source || "spa_link" }'), 'public route navigation should push history without reloading');
  assert(!sourceHtml.includes('window.scrollTo({ top: 0, behavior: "smooth" })'), 'route switches should not use smooth scrolling that causes visible transition lag');
  assert(sourceHtml.includes('closeRouteTransientModals'), 'route switches should close route-specific modal overlays');
  assert(fs.existsSync(path.join(__dirname, '..', 'scripts', 'probe-route-transitions.js')), 'route transition probe should exist');
  assert(!sourceHtml.includes('Makar') && !sourceHtml.includes('Makai') && !sourceHtml.includes('Makaid') && !sourceHtml.includes('makaug.co.uk'), 'public source should not contain wrong brand variants');
  assert.strictEqual(toCanonicalLanguageCode('rukiga'), 'rkg', 'Rukiga should have a canonical language code');
  assert.strictEqual(toCanonicalLanguageCode('runyankole'), 'rnynk', 'Runyankole should have a canonical language code');
  assert.strictEqual(normalizeLanguageCode('rkg'), 'rn', 'Rukiga should preserve legacy rn code for current UI compatibility');
  assert.strictEqual(normalizeLanguageCode('rnynk'), 'ny', 'Runyankole should preserve legacy ny code for current UI compatibility');
  assert.strictEqual(shouldUseEnglishFallback('rukiga'), true, 'Rukiga must use English fallback until reviewed translations exist');
  assert(LANGUAGE_REGISTRY.rkg && LANGUAGE_REGISTRY.rkg.fallbackLanguage === 'en', 'language registry should define Rukiga fallback');
  assert(languageRegistrySource.includes('Do not use Kinyarwanda for Rukiga or Runyankole'), 'language registry should guard against Kinyarwanda substitution');
  assert(languageRegistrySource.includes('providerSupport'), 'language registry should document provider support per language');
  assert(languageRegistrySource.includes('humanReviewRequired'), 'language registry should document human review status per language');
  assert(translationProviderServiceSource.includes('human_table_then_provider_then_english'), 'translation provider should use safe fallback strategy');
  assert(sourceHtml.includes('data-content-i18n="about.heroStatement"'), 'About page body should use content i18n keys');
  assert(sourceHtml.includes('function applyAboutLanguageUI'), 'About page should apply body translations on language switch');
  assert(sourceHtml.includes('window.MAKAUG_MISSING_TRANSLATIONS'), 'missing content translations should be logged in the browser session');
  assert(aiServiceSource.includes('wrong_nearby_language_guard'), 'AI replies should guard against nearby-language substitution');
  assert(aiServiceSource.includes('Do not use Kinyarwanda'), 'AI prompts should explicitly block Kinyarwanda fallback for Rukiga/Runyankole');
  assert(whatsappRoutes.includes("shouldUseEnglishFallback(raw)"), 'WhatsApp language resolver should apply registry fallback rules');

  const listPropertyHtml = sanitizePublicHtml(sourceHtml, { pathname: '/list-property' });
  const listPropertyText = normalizeText(listPropertyHtml);
  assert(listPropertyHtml.includes('id="page-list-property"'), '/list-property should render the listing form route');
  assert(listPropertyHtml.includes('id="list-choice-modal"'), '/list-property should include the listing path choice modal');
  assert(listPropertyHtml.includes('Choose the listing type, then pick online form or WhatsApp AI chatbot.'), '/list-property choice modal should explain online vs WhatsApp AI paths');
  assert(listPropertyHtml.includes('id="list-choice-online-btn"'), '/list-property choice modal should include List Online action');
  assert(listPropertyHtml.includes('id="lp-whatsapp-option-btn"'), '/list-property choice modal should include WhatsApp AI action');
  assert(listPropertyHtml.includes('chooseListPropertyOnline'), '/list-property should open the form only after choosing online listing');
  assert(listPropertyHtml.includes('chooseListPropertyWhatsApp'), '/list-property should open WhatsApp AI from the listing choice');
  assert(listPropertyHtml.includes('lp-theme-student'), '/list-property should include the student accommodation theme');
  assert(listPropertyHtml.includes('Student accommodation uses a purple campus flow'), '/list-property should explain the student accommodation colour/theme flow');
  assert(listPropertyHtml.includes('id="lp-wizard-shell" class="hidden'), '/list-property form should be gated until the user chooses List online');
  assert(listPropertyHtml.includes('id="listing-submit-modal"'), '/list-property should include the hidden post-submit success modal');
  assert(/id="listing-submit-modal"[^>]*class="modal-overlay"/.test(listPropertyHtml), 'listing submit modal should be hidden by default');
  assert(!/id="listing-submit-modal"[^>]*class="[^"]*\bopen\b/i.test(listPropertyHtml), 'listing submit modal should not be open before submission');
  assert(listPropertyText.includes('List Property'), '/list-property should use short page title');
  assert(listPropertyText.includes('List your property on MakaUg for free.'), '/list-property should explain free listing in supporting copy');
  assert(!listPropertyText.includes('List Your Property - Free'), '/list-property should not use old long free title');
  assert(listPropertyText.includes('Find address or place'), '/list-property should show address-first location flow');
  assert(listPropertyHtml.includes('id="lp-current-location-btn"'), '/list-property should include share current location button');
  assert(sourceHtml.includes('function shareLpCurrentLocation'), '/list-property current-location button needs a JS handler');
  assert(sourceHtml.includes('Location captured. Please move the pin if needed'), 'current-location flow should tell users to adjust and confirm the pin');
  assert(sourceHtml.includes('Location permission was denied. Search for an address or place instead.'), 'current-location flow should handle denied permission');
  assert(sourceHtml.includes('The location appears outside Uganda. Search for a Ugandan address or place instead.'), 'current-location flow should block overseas listing pins');
  assert(sourceHtml.includes('&libraries=places'), 'Google Maps loader should include Places library for typed address autocomplete');
  assert(sourceHtml.includes('getGooglePlacePredictions'), 'typed address flow should request Google Places predictions when configured');
  assert(/<details\s+id="lp-location-advanced"[^>]*>/i.test(listPropertyHtml), '/list-property should keep advanced location details collapsed');
  assert(!/<details\s+id="lp-location-advanced"[^>]*\sopen\b/i.test(listPropertyHtml), 'advanced location details should be collapsed by default');
  assert(listPropertyHtml.includes('data-listing-translation-preview="1"'), 'listing description translation preview should exist');
  assert(listPropertyHtml.includes('id="lp-verify-id-file" type="file" accept="image/*"'), 'National ID upload should accept photos only');
  assert(listPropertyText.includes('PDFs are not accepted'), 'National ID upload should tell users PDFs are not accepted');
  assert(!listPropertyHtml.includes('id="lp-verify-id-file" type="file" accept="image/*,.pdf"'), 'National ID upload must not accept PDFs');
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
  assert(propertiesRoutes.includes('National ID must be uploaded as a photo image. PDFs are not accepted'), 'property submission backend should reject National ID PDFs');
  assert(propertiesRoutes.includes("router.post('/listing-intent'"), 'listing path choice should have a backend intent endpoint');
  assert(propertiesRoutes.includes('list_property_path_selected'), 'listing path choice should create a backend lead/activity/log event');
  assert(propertiesRoutes.includes('list_property_whatsapp_ai'), 'WhatsApp AI listing path should be logged distinctly');
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
  assert(whatsappRoutes.includes('Do not send a PDF'), 'WhatsApp identity prompt should say PDFs are not accepted');
  assert(whatsappRoutes.includes('isPhotoMediaForIdentity'), 'WhatsApp identity upload should validate photo-only media');

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
  assert(contactRoutes.includes("router.post('/career-interest'"), 'careers interest API should exist');
  assert(contactRoutes.includes('help_request_submitted'), 'help request should log an email/notification event');
  assert(contactRoutes.includes('career_interest_submitted'), 'career interest should log an email/notification event');
  assert(contactRoutes.includes('fraud_report_received'), 'fraud reports should create notification/email coverage');
  assert(contactRoutes.includes('property_need_request_created'), 'tell-MakaUg property need requests should create CRM/log events');
  assert(contactRoutes.includes('createLead'), 'help/fraud/careers/property need contact routes should create CRM leads');
  assert(sourceHtml.includes('id="career-interest-form"'), '/careers should include a real lead capture form');
  assert(sourceHtml.includes('submitCareerInterest'), '/careers form should submit to the backend');
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
  assert(loginText.includes('Opening your makaug.com account panel'), '/login should launch the shared auth panel instead of a duplicate login page');
  assert(!loginText.includes('Choose how you want to continue'), '/login should not render a separate role-selection login page');
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
  assert(sourceHtml.includes('id="account-access-create-details-step"'), 'create account should start with contact details before OTP');
  assert(sourceHtml.includes('id="account-access-create-preferences-step"'), 'create account should move to role preferences after OTP');
  assert(sourceHtml.includes('id="account-access-create-password-step"'), 'create account should collect password after preferences');
  assert(sourceHtml.includes('contact_verification_token'), 'create account should use a verified-contact token before final registration');
  assert(sourceHtml.includes('id="account-access-brand-kicker"'), 'auth drawer should expose a brand kicker that can be verified');
  assert(sourceHtml.includes('tracking-normal text-white/85 font-bold">makaug.com account'), 'auth drawer brand kicker should display lowercase makaug.com, not uppercase');
  assert(sourceHtml.includes('ACCOUNT_ACCESS_ROLE_THEME'), 'auth drawer should define role-specific accent themes');
  for (const roleTheme of ['name: "property finder"', 'name: "student"', 'name: "broker"', 'name: "field agent"', 'name: "advertiser"']) {
    assert(sourceHtml.includes(roleTheme), `auth drawer should expose role accent: ${roleTheme}`);
  }
  assert(sourceHtml.includes('data-auth-role-theme'), 'auth drawer should apply selected role theme to the panel');
  assert(sourceHtml.includes('accountAccessScreeningText'), 'auth drawer screening questions should be language-aware');
  for (const langKey of ['ac: {', 'ny: {', 'rn: {', 'sm: {']) {
    assert(sourceHtml.includes(langKey), `auth drawer should have safe language text for ${langKey}`);
  }
  assert(sourceHtml.includes('Password or 4-digit PIN'), 'field-agent sign-in should visibly support the admin-issued 4-digit PIN');
  assert(sourceHtml.includes('admin-issued PIN to track listings, approvals, rejections, ranking, balance, and payout updates'), 'field-agent drawer copy should explain the operational dashboard');
  assert(sourceHtml.includes('id="admin-field-agent-provision-form"'), 'admin should have a field-agent provisioning form');
  assert(sourceHtml.includes('id="admin-fa-code"'), 'admin field-agent setup should let owner assign FA-0001 style agent codes');
  assert(sourceHtml.includes('adminProvisionFieldAgent'), 'admin field-agent provisioning form should be wired');
  assert(sourceHtml.includes('Create Field Agent login'), 'admin UI should expose the field-agent login setup path');
  assert(adminRoutes.includes("router.post('/field-agents/provision'"), 'admin API should provision field-agent accounts');
  assert(adminRoutes.includes('bcrypt.hash(pin, 12)'), 'field-agent PIN should be hashed before storage');
  assert(adminRoutes.includes('field_agent_account_provisioned'), 'field-agent provisioning should create a safe notification log');
  assert(adminRoutes.includes('field_agent_provisioned'), 'field-agent provisioning should create an admin audit event');
  assert(!adminRoutes.includes('pin, password_hash'), 'admin field-agent provisioning must not store raw PIN values');
  assert(sourceHtml.includes('id="account-access-otp-code"'), 'create account journey should verify OTP inside the drawer');
  assert(sourceHtml.includes('accountAccessDrawerMode === "verify"'), 'auth drawer should handle verification as an inline step');
  assert(sourceHtml.includes('overflow-x-hidden'), 'mobile auth drawer should prevent horizontal overflow');
  assert(!sourceHtml.includes('data-auth-progress-step="account"'), 'auth drawer should not show old Account/Details/Preferences/Verify pills on the first screen');
  assert(sourceHtml.includes('id="account-access-progress-summary"'), 'auth drawer should show compact create-account progress only after create is selected');
  assert(sourceHtml.includes('openPolicyPreviewModal'), 'auth drawer should expose terms/privacy preview interactions');
  assert(sourceHtml.includes('account-access-otp-method-wrap'), 'auth drawer should let users choose email or SMS OTP');
  assert(sourceHtml.includes('SMS / Text'), 'auth drawer should label phone OTP as SMS/Text');
  assert(sourceHtml.includes('We sent a verification code by SMS to:'), 'auth drawer should show explicit SMS OTP delivery copy');
  assert(authRoutes.includes("router.post('/request-signup-otp'"), 'auth route should support pre-account signup OTP delivery');
  assert(authRoutes.includes("router.post('/verify-signup-otp'"), 'auth route should verify signup contact before account creation');
  assert(authRoutes.includes("const preferredAudience = normalizeSignupAudience(req.body.audience"), 'password login should accept selected account audience for dashboard redirect');
  assert(authRoutes.includes("message: 'Signed in. Opening your makaug.com dashboard.'"), 'password login should return a dashboard handoff message');
  assert(authRoutes.includes('data: successPayload'), 'password login should return redirectUrl/session handoff payload');
  assert(authRoutes.includes('Verification OTP sent by SMS'), 'auth register route should report SMS OTP delivery accurately');
  assert(authRoutes.includes('terms_accepted is required'), 'auth register route should enforce terms acceptance on the backend');
  assert(authRoutes.includes('privacy_accepted is required'), 'auth register route should enforce privacy acceptance on the backend');
  assert(authRoutes.includes('makaug.com account verification'), 'auth OTP copy should use lowercase public brand display');
  assert(propertiesRoutes.includes('OTP sent by SMS'), 'listing OTP route should report SMS OTP delivery accurately');
  assert(sourceHtml.includes('openAccountAccessDrawer("signin"'), 'header sign-in should open the new drawer');
  assert(sourceHtml.includes('openAccountAccessDrawer("create"'), 'create account should open the new drawer');
  assert(!sourceHtml.includes('data-auth-text="changeType"'), 'auth drawer should not show messy Change account type action in the main flow');
  assert(sourceHtml.includes('Back to account type'), 'create-account flow should expose only a subtle Back to account type link before OTP');
  assert(sourceHtml.includes('resetAccountAccessPasswordFromDrawer'), 'forgot password should run inside the shared auth drawer');
  assert(sourceHtml.includes('id="account-access-forgot-wrap"'), 'forgot password should use inline drawer fields instead of prompt-only reset');
  assert(sourceHtml.includes('portalModeForDashboardUrl'), 'auth success should understand backend dashboard redirect URLs');
  assert(sourceHtml.includes('dashboardPageForPortalMode'), 'auth success should map dashboard redirects to mounted dashboard pages');
  assert(sourceHtml.includes('window.location.href = targetRoute'), 'auth success should full-load protected dashboards when public HTML does not contain them');
  assert(sourceHtml.includes('openSignedInDashboard(dashboardRouteForPortalMode(resolvedUser.portal_mode)'), 'auth success should force the role-specific dashboard route after sign-in');
  assert(sourceHtml.includes('audience: accountAccessDrawerAudience'), 'drawer sign-in should send the selected role to the backend');
  const finderScreening = sourceHtml.match(/finder: \[([\s\S]*?)\n\s*\],\n\s*student:/m)?.[1] || '';
  assert(finderScreening.includes('["WhatsApp", "Email"]'), 'property finder preferred contact should be limited to WhatsApp and Email');

  const mortgagePayment = computeMortgagePayment(200000000, 16, 20);
  assert(mortgagePayment > 2700000 && mortgagePayment < 2900000, 'mortgage amortization formula should produce a realistic repayment');
  const mortgageEstimate = buildMortgageEstimate({ purchasePrice: 250000000, depositPercent: 20, annualRate: 16, termYears: 20 });
  assert.strictEqual(Math.round(mortgageEstimate.loanAmount), 200000000, 'mortgage estimate should calculate loan amount after deposit');
  assert(mortgageEstimate.onceOffCosts > mortgageEstimate.depositAmount, 'mortgage estimate should include once-off costs beyond deposit');

  const requiredDashboardShellText = [
    'My Property Brief',
    'Recommended For You',
    'Saved Searches and Alerts',
    'Property enquiries',
    'Viewing Bookings',
    'Callback Requests',
    'Mortgage/Budget Centre',
    'My Listed Properties',
    'Safety Tips',
    'Search preference summary',
    'Sponsored slot',
    'Dashboard order',
    'Account settings',
    'Saved Student Searches',
    'Enquiry History and WhatsApp Requests',
    'Language Preference',
    'Broker account settings',
    'Field Agent settings',
    'Field Agent notice board',
    'Balance & payout tracker',
    'Money collected tracker',
    'How to work as a MakaUg Field Agent',
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
  assert(sourceHtml.includes('id="finder-weather-context"'), 'property finder dashboard should show weather-ready context');
  assert(!sourceHtml.includes('id="finder-area-preference-context"'), 'property finder dashboard should remove the extra area preference tile');
  assert(!sourceHtml.includes('id="finder-area-watch-title"'), 'property finder dashboard should remove Area Watch');
  assert(sourceHtml.includes('id="finder-owned-listings"'), 'property finder dashboard should show listings linked to the signed-in account');
  assert(sourceHtml.includes('openOwnedListingEditor'), 'property finder dashboard should let owners edit linked listings');
  assert(sourceHtml.includes('deleteOwnedListing'), 'property finder dashboard should let owners remove linked listings from the site');
  assert(!sourceHtml.includes('id="finder-compare-title"'), 'property finder dashboard should not show the removed Compare Properties panel');
  assert(sourceHtml.includes('FINDER_DASHBOARD_I18N'), 'property finder dashboard should have language-aware labels');
  assert(sourceHtml.includes('data-safety-stakeholder-grid="1"'), 'safety page should include stakeholder safety guidance');
  assert(sourceHtml.includes('data-safety-illustration="renters"'), 'safety page should include illustrated renter safety guidance');
  assert(sourceHtml.includes('safe-viewings'), 'safety how-to videos should include safe viewing slot');
  assert(sourceHtml.includes('land-title-safety'), 'safety how-to videos should include land/title safety slot');
  assert(sourceHtml.includes('data-content-i18n="safety.title"'), 'safety page should be wired to content language switching');
  assert(sourceHtml.includes('getLocalFinderRecommendations'), 'property finder dashboard should derive fallback recommendations from signup preferences');
  assert(sourceHtml.includes('id="account-pref-goal"'), 'account settings should expose property finder goal preferences');
  assert(sourceHtml.includes('id="account-pref-area"'), 'account settings should expose property finder area preferences');
  assert(sourceHtml.includes('id="account-profile-status-msg"'), 'account profile updates should show inline confirmation');
  assert(sourceHtml.includes('id="account-password-status-msg"'), 'password updates should show inline confirmation');
  assert(!sourceHtml.includes('id="account-phone" disabled'), 'account phone number should be editable');
  assert(authRoutes.includes('phone = $4') && authRoutes.includes('account_phone_changed'), 'auth profile backend should update phone safely and log changed numbers');
  assert(propertySeekerRoutes.includes("router.get('/my-listings'"), 'property finder backend should expose linked owned listings');
  assert(propertySeekerRoutes.includes("router.patch('/my-listings/:id'"), 'property finder backend should update owned listings');
  assert(propertySeekerRoutes.includes("router.delete('/my-listings/:id'"), 'property finder backend should remove owned listings from the public site');
  assert(propertySeekerRoutes.includes('ownerMatchSql'), 'owned listings should be matched by owner email or phone');
  assert(propertySeekerRoutes.includes('listing_updated_by_owner'), 'owned listing updates should be logged');
  assert(propertySeekerRoutes.includes('listing_deleted_by_owner'), 'owned listing removals should be logged');
  assert(authFlowServiceSource.includes('property_seeker_preferences'), 'verified property finder signup should create backend preference records');
  assert(authFlowServiceSource.includes('parseBudgetUpper(profile.budget_range)'), 'signup preferences should convert budget labels into usable recommendation budgets');
  assert(sourceHtml.includes('id="page-admin-docs"'), 'admin docs page should exist for protected admin route');
  assert(sourceHtml.includes('id="page-admin-setup-status"'), 'owner setup status page should exist for protected admin route');
  assert(sourceHtml.includes('Owner Setup Status'), 'owner setup status page should be visible to signed-in admins');
  assert(sourceHtml.includes('Run safe property submission test'), 'setup status should include safe property submission proof action');
  assert(sourceHtml.includes('Run AI chatbot smoke test'), 'setup status should include AI smoke proof action');
  assert(sourceHtml.includes('Run alert matching now'), 'setup status should include alert matcher proof action');
  assert(sourceHtml.includes('Create payment fallback test'), 'setup status should include payment fallback proof action');
  assert(sourceHtml.includes('renderAdminSetupStatus'), 'setup status should be wired to live admin API rendering');
  assert(sourceHtml.includes('/api/admin/setup-status'), 'setup status should call protected admin setup status API');
  assert(sourceHtml.includes('MakaUg Go-Live Documentation'), 'admin docs should show launch documentation');
  assert(sourceHtml.includes('Backend Traceability Matrix'), 'admin docs should link backend traceability matrix');
  assert(sourceHtml.includes('docs/backend-readiness-report.md'), 'admin docs should link backend readiness report');
  assert(fs.existsSync(path.join(__dirname, '..', 'docs', 'backend-traceability-matrix.md')), 'backend traceability matrix doc should exist');
  assert(fs.existsSync(path.join(__dirname, '..', 'docs', 'backend-readiness-report.md')), 'backend readiness report doc should exist');
  assert(fieldAgentSetupDoc.includes('FA-0001') && fieldAgentSetupDoc.includes('4-digit PIN'), 'field-agent live setup doc should give starter codes and PIN instructions');
  assert(backendReadinessReport.includes('Task 15 Backend Gate Addendum'), 'backend readiness report should include the Task 15 live audit addendum');
  assert(backendReadinessReport.includes('super_admin support exists, but live super_admin was not created because required env vars were not provided.'), 'backend readiness report should state exact super_admin live-creation blocker');
  assert(backendReadinessReport.includes('GET https://makaug.com/api/health'), 'backend readiness report should include live health proof');
  assert(backendReadinessReport.includes('033_task3_engagement_crm.sql') && backendReadinessReport.includes('034_task4_super_admin_alerts_payments.sql'), 'backend readiness report should include migration proof');
  assert(backendTraceabilityMatrix.includes('Task 15 Traceability Addendum'), 'backend traceability matrix should include Task 15 addendum');
  assert(backendTraceabilityMatrix.includes('npm run probe:backend-connections'), 'backend traceability matrix should mention the backend connection probe');
  assert(goLiveManualQa.includes('npm run probe:backend-connections'), 'manual QA should include the backend connection probe command');
  assert(backendConnectionProbeScript.includes('/api/health/migrations'), 'backend probe should verify migration status');
  assert(backendConnectionProbeScript.includes('/api/admin/summary'), 'backend probe should verify admin API anonymous blocking');
  assert(backendConnectionProbeScript.includes('/api/admin/setup-status'), 'backend probe should verify setup status anonymous blocking');
  assert(backendConnectionProbeScript.includes('SUPER_ADMIN_EMAIL'), 'backend probe should check super admin env presence without printing secrets');
  assert(backendConnectionProbeScript.includes("require('dotenv').config()"), 'backend probe should load local env for provider readiness checks');
  assert(backendConnectionProbeScript.includes('AFRICASTALKING_API_KEY'), 'backend probe should include Africa’s Talking SMS provider keys');
  assert(backendConnectionProbeScript.includes('SMS_TEST_PHONE'), 'backend probe should include explicit SMS test phone key');
  assert(backendConnectionProbeScript.includes('sourceWiringChecks'), 'backend probe should inspect source wiring for launch-critical flows');
  assert(sourceHtml.includes('id="admin-launch-control"'), 'admin launch control should exist');
  assert(sourceHtml.includes('/admin/setup-status'), 'admin launch control should link owner setup status');
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
  assert(sourceHtml.includes('data-map-property-link="1"'), 'map listing popups should expose real property detail links');
  assert(sourceHtml.includes('href="${adminAttr(detailPath)}"'), 'map listing popup should have a real /property fallback URL');
  assert(sourceHtml.includes('openMapPropertyDetail(event'), 'map listing popup should use a delegated detail click handler');
  assert(sourceHtml.includes('data-map-broker-link="1"'), 'broker map popups should expose real broker profile links');
  assert(sourceHtml.includes('openMapBrokerProfile(event'), 'broker map popup should use a delegated broker click handler');
  assert(sourceHtml.includes('function clearStaleMapRegistry()'), 'public maps should clear stale registry entries after SPA route fragment swaps');
  assert(sourceHtml.includes('function mapInstanceMatchesDom(mapId)'), 'public maps should verify map instances still belong to the live DOM node');
  assert(sourceHtml.includes('function refreshActivePublicMapsAfterRoute()'), 'public maps should refresh/rebuild after route changes and browser back navigation');
  assert(sourceHtml.includes('scheduleMapsInit({ force: targetPage !== previousPage })'), 'public route changes should force map recovery when the active map page changes');
  assert(sourceHtml.includes('source: "popstate_missing_fragment"'), 'browser back/forward should reload a missing public route fragment before map recovery');
  assert(sourceHtml.includes('google.maps.event.trigger(map, "resize")'), 'Google map routes should trigger resize when returning to a map page');
  assert(sourceHtml.includes('if (!(await ensureLeafletApi())) return;'), 'property detail maps should load Leaflet fallback when Google Maps is unavailable');
  assert(sourceHtml.includes('recordRemoteRecentlyViewed'), 'property detail opens should record backend recently-viewed events when possible');
  assert(sourceHtml.includes('/api/property-seeker/recently-viewed'), 'property detail opens should connect to the backend recently-viewed API');
  assert(sourceHtml.includes('map_property_click'), 'map View Property click should emit analytics');
  assert(clickProbeScript.includes('map popup View Property did not open a listing detail route/view'), 'click probe should fail if map View Property does not open detail');
  assert(sourceHtml.includes('id="hero-location-control"'), 'homepage should include compact Location control');
  assert(sourceHtml.includes('aria-label="Use location search"'), 'homepage Location control should be accessible');
  assert(sourceHtml.includes('Location search uses a 10 mile radius by default.'), 'homepage Location helper should explain the default radius');
  assert(sourceHtml.includes('City, area, suburb or landmark'), 'homepage search input should support city, area, suburb, or landmark');
  assert(!sourceHtml.includes('id="hero-use-location-btn"'), 'homepage should not keep the old bulky Use my location button');
  assert(sourceHtml.includes('id="hero-filter-row"'), 'homepage should render the lower filter row');
  assert(sourceHtml.includes('id="hero-property-type-f"'), 'homepage lower filter row should include Property Type');
  assert(sourceHtml.includes('id="hero-min-price-f"'), 'homepage lower filter row should include Min Price');
  assert(sourceHtml.includes('id="hero-max-price-f"'), 'homepage lower filter row should include Max Price');
  assert(sourceHtml.includes('id="hero-bedrooms-f"'), 'homepage lower filter row should include Bedrooms');
  assert(sourceHtml.includes('id="hero-filters-btn"'), 'homepage lower filter row should include a Filters button');
  assert(sourceHtml.includes('id="hero-advanced-filters-panel"'), 'Filters button should open a real advanced filters panel');
  assert(sourceHtml.includes('HERO_FILTER_CONFIG_BY_TAB'), 'homepage filters should be category-aware');
  assert(sourceHtml.includes('commercial: { propertyLabelKey: "heroCommercialType", amenityOptionsKey: "commercial", showBedrooms: false'), 'Commercial homepage search should hide bedroom filters');
  assert(sourceHtml.includes('land: { propertyLabelKey: "heroLandType", amenityOptionsKey: "land", showBedrooms: false'), 'Land homepage search should hide bedroom filters');
  assert(sourceHtml.includes('HERO_PROPERTY_TYPE_OPTIONS_BY_TAB'), 'homepage Property Type options should change by category');
  assert(sourceHtml.includes('HERO_PRICE_OPTIONS_BY_TAB'), 'homepage Min/Max Price options should change by category');
  assert(sourceHtml.includes('HERO_AMENITY_OPTIONS_BY_TAB'), 'homepage Amenities options should change by category');
  assert(sourceHtml.includes('{ value: "road access", labelKey: "heroAmenityRoadAccess" }'), 'Land search should expose land-relevant amenity filters');
  assert(sourceHtml.includes('{ value: "loading bay", labelKey: "heroAmenityLoadingBay" }'), 'Commercial search should expose commercial-relevant amenity filters');
  assert(sourceHtml.includes('{ value: "study area", labelKey: "heroAmenityStudyArea" }'), 'Student search should expose student-relevant amenity filters');
  assert(sourceHtml.includes('{ value: "security", labelKey: "heroAmenityGuarded" }'), 'Amenity labels should avoid protected public sanitizer terms while still filtering security');
  assert(!sourceHtml.includes('heroAmenitySecurity'), 'Amenity labels should not use the sanitizer-sensitive Security key');
  assert(sourceHtml.includes('setHeroSelectOptions("hero-amenities-f", amenityOptions'), 'homepage should refresh the Amenities dropdown from category config');
  assert(sourceHtml.includes('setHeroFilterControlVisible("hero-bedrooms-f", Boolean(config.showBedrooms))'), 'homepage should toggle Bedrooms visibility from category config');
  assert(sourceHtml.includes('payload.commercialType = filters.commercialType'), 'homepage commercial searches should send commercialType to the backend');
  assert(sourceHtml.includes('payload.landTitleType = filters.landTitleType'), 'homepage land searches should send landTitleType to the backend');
  assert(!sourceHtml.includes('Manual area, radius, and property filters stay active.'), 'homepage advanced filters should not show the removed manual/radius helper copy');
  assert(sourceHtml.includes('No exact matches yet.'), 'search no-results state should use the required launch copy');
  assert(sourceHtml.includes('DEFAULT_NEAR_ME_RADIUS_MI = 10'), 'near-me search should default to 10 miles');
  assert(sourceHtml.includes('SEARCH_RADIUS_MI_OPTIONS = [0, 0.25, 0.5, 1, 3, 5, 10, 15, 20, 30, 40, 50]'), 'radius selector should preserve the detailed mile options');
  assert(sourceHtml.includes('routedRadiusValue'), 'homepage near-me search should preserve radius when routing to category pages');
  assert(sourceHtml.includes('HERO_SEARCH_HANDOFF_KEY'), 'homepage near-me search should persist search state across sanitized public route navigation');
  assert(sourceHtml.includes('applyHeroSearchHandoff(publicRoutePage)'), 'public route loader should restore hero search handoff state');
  assert(sourceHtml.includes('showPage(page, { history: false, source, scroll: options.scroll !== false });\n        applyHeroSearchHandoff(page);'), 'async public route fragments should apply hero search handoff after mounting');
  assert(sourceHtml.includes('You appear to be outside Uganda. Choose a Ugandan area to search, or search all Uganda.'), 'near-me search should handle overseas coordinates');
  assert(sourceHtml.includes('decorateAndSortNearMeResults'), 'near-me results should be decorated and sorted by distance');
  assert(propertiesRoutes.includes("router.get('/search', listPropertiesHandler)"), 'backend should expose /api/properties/search');
  assert(propertiesRoutes.includes('req.query.area || req.query.search || req.query.query'), 'search API should accept query payloads from the homepage search module');
  assert(propertiesRoutes.includes('req.query.property_type || req.query.propertyType'), 'search API should accept propertyType payloads from the homepage filter row');
  assert(propertiesRoutes.includes('req.query.min_price || req.query.minPrice'), 'search API should accept minPrice payloads from the homepage filter row');
  assert(propertiesRoutes.includes('req.query.max_price || req.query.maxPrice'), 'search API should accept maxPrice payloads from the homepage filter row');
  assert(propertiesRoutes.includes('req.query.min_beds || req.query.bedrooms'), 'search API should accept bedroom payloads from the homepage search module');
  assert(propertiesRoutes.includes('req.query.bathrooms'), 'search API should accept advanced bathroom filters');
  assert(propertiesRoutes.includes('studentCampus'), 'search API should accept student campus filters');
  assert(propertiesRoutes.includes('landTitleType'), 'search API should accept land title filters');
  assert(propertiesRoutes.includes('commercialType'), 'search API should accept commercial type filters');
  assert(propertiesRoutes.includes('listingId'), 'search API results should expose listingId for result rendering');
  assert(propertiesRoutes.includes('radiusUnit'), 'search API should record radius unit metadata');
  assert(propertiesRoutes.includes('web_radius_no_results'), 'search API should log no-results radius demand');
  assert(propertiesRoutes.includes('distance_miles'), 'radius search API should return distance_miles');
  assert(propertiesRoutes.includes('outside_uganda'), 'radius search API should return outside-Uganda fallback');
  assert(propertiesRoutes.includes('web_radius_search'), 'radius search API should log backend search visibility');
  assert(adminRoutes.includes('locationSystem'), 'admin setup status should expose location-system status');
  assert(adminRoutes.includes('languageSystem'), 'admin setup status should expose language-system status');
  assert(adminRoutes.includes('locationSearches'), 'admin setup status should show recent location search counts');
  assert.strictEqual(DEFAULT_SEARCH_RADIUS_MILES, 10, 'shared default radius should be 10 miles');
  assert.strictEqual(normalizeRadiusMiles(undefined), 10, 'missing radius should default to 10 miles');
  assert.strictEqual(normalizeRadiusMiles(0.25), 0.25, 'backend should honor restored quarter-mile radius searches');
  assert.strictEqual(normalizeRadiusMiles(0.5), 0.5, 'backend should honor restored half-mile radius searches');
  assert.strictEqual(Number(normalizeRadiusKm(0.25 * 1.609344).toFixed(6)), Number((0.25 * 1.609344).toFixed(6)), 'backend should not clamp quarter-mile radius to 1km');
  assert(normalizeRadiusKm(undefined) > 16 && normalizeRadiusKm(undefined) < 17, 'default radius should be about 16.1 km');
  assert(isPointInUganda(0.3476, 32.5825), 'Kampala should be inside Uganda bounds');
  assert(!isPointInUganda(51.5072, -0.1276), 'London should be outside Uganda bounds');
  const kampalaToNtindaKm = haversineKm(0.3476, 32.5825, 0.353, 32.616);
  assert(kampalaToNtindaKm > 0 && kampalaToNtindaKm < 10, 'haversine should produce plausible Kampala distance');
  assert.deepStrictEqual(roundLocationForAnalytics(0.3476123, 32.5825123), { latitude: 0.348, longitude: 32.583 });
  assert(locationSearchServiceSource.includes('buildHaversineSql'), 'location search service should expose SQL distance helper');
  assert(whatsappRoutes.includes('search_radius_miles'), 'WhatsApp shared-location search should store radius');
  assert(whatsappRoutes.includes('DEFAULT_SEARCH_RADIUS_MILES'), 'WhatsApp shared-location search should use shared 10-mile default');
  assert(whatsappRoutes.includes('roundLocationForAnalytics'), 'WhatsApp shared-location logs should round analytics coordinates');
  assert(whatsappRoutes.includes('isPointInUganda'), 'WhatsApp shared-location flow should block out-of-country coordinates');
  assert(whatsappRoutes.includes('outsideUgandaLocation'), 'WhatsApp should explain when a shared location is outside Uganda');
  assert(whatsappRoutes.includes('outside_uganda'), 'WhatsApp outside-Uganda shared locations should be logged');
  assert(whatsappRoutes.includes('nextPropertySearchActions'), 'WhatsApp search results should drive the next conversation step');
  assert(whatsappRoutes.includes('book a viewing'), 'WhatsApp next-step prompt should guide users after listing results');

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
  assert(adminRoutes.includes("router.get('/setup-status'"), 'admin setup status API should exist');
  assert(adminRoutes.includes("router.post('/setup-status/property-submission-test'"), 'admin setup status should run safe property submission proof');
  assert(adminRoutes.includes("router.post('/setup-status/provider-test'"), 'admin setup status should run provider proof');
  assert(adminRoutes.includes('sendPhoneOtp'), 'admin SMS provider proof should exercise real SMS delivery path');
  assert(adminRoutes.includes('SMS_TEST_PHONE'), 'admin SMS provider proof should support an explicit test phone');
  assert(adminRoutes.includes('AFRICASTALKING_USERNAME'), 'admin SMS setup status should require Africa\'s Talking username');
  assert(adminRoutes.includes('AFRICASTALKING_UESERNAME'), 'admin SMS setup status should warn about the misspelled Africa\'s Talking username key');
  assert(adminRoutes.includes("router.post('/setup-status/ai-smoke-test'"), 'admin setup status should run AI proof');
  assert(adminRoutes.includes("router.post('/setup-status/run-alert-matcher'"), 'admin setup status should run alert matching proof');
  assert(adminRoutes.includes("router.post('/setup-status/viewing-callback-test'"), 'admin setup status should run viewing/callback proof');
  assert(adminRoutes.includes("router.post('/setup-status/advertising-payment-test'"), 'admin setup status should run advertising/payment proof');
  assert(adminRoutes.includes("router.post('/setup-status/support-flow-test'"), 'admin setup status should run mortgage/help/careers/fraud proof');
  assert(adminRoutes.includes('buildListingReference'), 'admin safe submission proof should generate real MakaUg references');
  assert(adminRoutes.includes('logEmailEvent'), 'admin proof actions should create EmailLog records');
  assert(adminRoutes.includes('logWhatsAppMessage'), 'admin proof actions should create WhatsAppMessageLog records');
  assert(adminRoutes.includes('matchListingToSavedSearches'), 'admin proof actions should run real alert matcher service');

  for (const protectedPath of ['/dashboard', '/student-dashboard', '/broker-dashboard', '/field-agent-dashboard', '/advertiser-dashboard', '/account', '/admin', '/admin/docs', '/admin/setup-status', '/admin/moderation', '/admin/crm', '/admin/leads', '/admin/advertising', '/admin/revenue', '/admin/notifications']) {
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
  for (const adminPath of ['/admin', '/admin/setup-status', '/admin/crm', '/admin/leads', '/admin/advertising', '/admin/revenue', '/admin/notifications', '/admin/emails', '/admin/whatsapp-inbox', '/admin/alerts', '/dashboard', '/student-dashboard', '/broker-dashboard', '/field-agent-dashboard', '/advertiser-dashboard']) {
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
  assert.strictEqual(isSmsOtpDeliveryConfirmed({ mocked: true }), false, 'mock phone OTP delivery must not count as production send');
  assert.strictEqual(isSmsOtpDeliveryConfirmed({ status: 'Success' }), true, 'SMS success status should count as confirmed');
  assert.strictEqual(isSmsOtpDeliveryConfirmed({ status: 'queued' }), true, 'queued provider SMS should count as accepted');
  assert.strictEqual(isSmsOtpDeliveryConfirmed({ status: 'failed' }), false, 'failed SMS status should not count as delivered');
  assert.strictEqual(notificationStatusFromDelivery({ status: 'Success' }), 'sent', 'successful SMS OTP should log sent status');
  assert.strictEqual(notificationStatusFromDelivery({ status: 'queued' }), 'queued', 'queued SMS OTP should log queued status');
  assert(!phoneOtpDeliveryServiceSource.includes('sendWhatsAppText'), 'phone OTP must not use WhatsApp delivery');
  assert(!phoneOtpDeliveryServiceSource.includes('queueWhatsappWebBridgeMessage'), 'phone OTP must not queue WhatsApp bridge fallback');
  assert(smsServiceSource.includes('TWILIO_SMS_FROM'), 'SMS delivery should support explicit Twilio SMS sender env');
  assert(smsServiceSource.includes("startsWith('whatsapp:')"), 'SMS delivery must not use WhatsApp sender IDs for text OTP');
  assert(smsServiceSource.includes('retrying without sender ID'), 'Africa\'s Talking SMS should retry without unapproved sender ID');
  assert(smsServiceSource.includes('AFRICASTALKING_USERNAME'), 'Africa\'s Talking SMS must read the correctly spelled username env');
  assert(smsServiceSource.includes('AFRICASTALKING_UESERNAME'), 'Africa\'s Talking SMS should tolerate the previously misspelled username env during launch');
  assert(!smsServiceSource.includes('logger.info(\'[SMS MOCK]\', { to, message })'), 'SMS mock logging must not print OTP bodies');
  assert(!whatsappNotificationServiceSource.includes('logger.info(\'[WHATSAPP MOCK]\', { to: recipient, body: message })'), 'WhatsApp mock logging must not print OTP bodies');

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
    'career_interest_submitted',
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
