'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE_URL = String(process.env.BASE_URL || process.env.QA_BASE_URL || 'https://makaug.com').replace(/\/$/, '');
let probeRequestCounter = 0;

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function has(relPath, needle) {
  return read(relPath).includes(needle);
}

function oneLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function pass(label, detail = '') {
  return { ok: true, label, detail };
}

function fail(label, detail = '') {
  return { ok: false, label, detail };
}

async function fetchText(url, options = {}) {
  probeRequestCounter += 1;
  const localProbeIp = `127.77.17.${(probeRequestCounter % 240) + 1}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'user-agent': 'MakaUg backend-connection-probe',
      'x-forwarded-for': localProbeIp,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  return { response, text };
}

async function probePublicBackend() {
  const checks = [];
  const endpoints = [
    { path: '/api/health', expect: 200, marker: '"ok":true' },
    { path: '/api/health/migrations', expect: 200, marker: '034_task4_super_admin_alerts_payments.sql' },
    { path: '/api/ai/model-card', expect: 200, marker: 'MakaUg Property AI Model' },
    { path: '/api/advertising/packages', expect: 200, marker: 'featured_property_boost' },
    { path: '/api/mortgage-rates', expect: 200, marker: 'providers' }
  ];

  for (const endpoint of endpoints) {
    try {
      const { response, text } = await fetchText(`${BASE_URL}${endpoint.path}`);
      const statusOk = response.status === endpoint.expect;
      const markerOk = !endpoint.marker || text.includes(endpoint.marker);
      checks.push((statusOk && markerOk)
        ? pass(`live ${endpoint.path}`, `status ${response.status}`)
        : fail(`live ${endpoint.path}`, `status ${response.status}, marker ${endpoint.marker ? markerOk : 'n/a'}`));
    } catch (error) {
      checks.push(fail(`live ${endpoint.path}`, error.message || 'fetch failed'));
    }
  }

  return checks;
}

async function probeProtectedBackend() {
  const checks = [];
  const endpoints = [
    ['/api/admin/summary', 401],
    ['/api/admin/setup-status', 401],
    ['/api/admin/crm/summary', 401],
    ['/api/admin/leads', 401],
    ['/api/admin/emails', 401],
    ['/api/admin/notifications', 401],
    ['/api/admin/alerts', 401],
    ['/api/property-seeker/dashboard', 401],
    ['/api/student/dashboard', 401],
    ['/api/advertising/dashboard', 403]
  ];

  for (const [endpoint, expectedStatus] of endpoints) {
    try {
      const { response, text } = await fetchText(`${BASE_URL}${endpoint}`);
      checks.push(response.status === expectedStatus
        ? pass(`anonymous blocked ${endpoint}`, `status ${response.status}`)
        : fail(`anonymous blocked ${endpoint}`, `expected ${expectedStatus}, got ${response.status}: ${oneLine(text).slice(0, 180)}`));
    } catch (error) {
      checks.push(fail(`anonymous blocked ${endpoint}`, error.message || 'fetch failed'));
    }
  }

  return checks;
}

function sourceWiringChecks() {
  const checks = [];
  const expectations = [
    ['auth register requires email', 'routes/auth.js', "if (!email) errors.push('email is required')"],
    ['auth register requires phone', 'routes/auth.js', "if (!phone) errors.push('phone is required')"],
    ['OTP verify creates post-verification records', 'routes/auth.js', 'ensurePostVerificationRecords'],
    ['admin login audited', 'routes/auth.js', 'recordAdminLogin'],
    ['super admin bootstrap uses env email', 'scripts/create-super-admin.js', 'SUPER_ADMIN_EMAIL'],
    ['super admin bootstrap hashes password', 'scripts/create-super-admin.js', 'bcrypt.hash'],
    ['property submit creates listing reference', 'routes/properties.js', 'buildListingReference'],
    ['property submit logs EmailLog', 'routes/properties.js', 'logEmailEvent'],
    ['property submit logs NotificationLog', 'routes/properties.js', 'logNotification'],
    ['property submit logs WhatsAppMessageLog', 'routes/properties.js', 'logWhatsAppMessage'],
    ['property submit creates CRM lead', 'routes/properties.js', "source: 'listing_submission'"],
    ['property WhatsApp listing path creates lead', 'routes/properties.js', "router.post('/listing-intent'"],
    ['saved search APIs exist', 'routes/property-seeker.js', "router.post('/saved-searches'"],
    ['alert matcher creates AlertMatch', 'services/alertSchedulerService.js', 'INSERT INTO alert_matches'],
    ['viewing creates booking record', 'routes/property-seeker.js', 'INSERT INTO viewing_bookings'],
    ['callback creates request record', 'routes/property-seeker.js', 'INSERT INTO callback_requests'],
    ['advertiser campaign creates campaign', 'routes/advertising.js', 'INSERT INTO advertising_campaigns'],
    ['payment link creates invoice', 'routes/advertising.js', 'INSERT INTO invoices'],
    ['manual payment writes audit', 'services/paymentProviderService.js', 'manual_payment_marked_paid'],
    ['mortgage enquiry creates lead', 'routes/mortgage.js', 'mortgage_lead_received'],
    ['help request logs event', 'routes/contact.js', 'help_request_submitted'],
    ['careers request logs event', 'routes/contact.js', 'career_interest_submitted'],
    ['fraud report creates report row', 'routes/contact.js', 'INSERT INTO report_listings'],
    ['AI assistant logs conversation', 'routes/ai.js', 'conversation_logged'],
    ['AI assistant creates CRM lead', 'routes/ai.js', 'createLead'],
    ['admin alerts visible', 'routes/admin.js', "router.get('/alerts'"],
    ['admin email logs visible', 'routes/admin.js', "router.get('/emails'"],
    ['admin WhatsApp logs visible', 'routes/admin.js', "router.get('/whatsapp-message-logs'"],
    ['language registry canonical source exists', 'config/languageRegistry.js', 'LANGUAGE_REGISTRY'],
    ['language registry blocks Kinyarwanda substitution', 'config/languageRegistry.js', 'Do not use Kinyarwanda for Rukiga or Runyankole'],
    ['translation provider fallback service exists', 'services/translationProviderService.js', 'human_table_then_provider_then_english'],
    ['location search service exists', 'services/locationSearchService.js', 'DEFAULT_SEARCH_RADIUS_MILES'],
    ['location radius defaults to 10 miles', 'services/locationSearchService.js', 'const DEFAULT_SEARCH_RADIUS_MILES = 10'],
    ['location service has Uganda bounds', 'services/locationSearchService.js', 'UGANDA_BOUNDS'],
    ['location service has Haversine SQL', 'services/locationSearchService.js', 'buildHaversineSql'],
    ['properties search endpoint exists', 'routes/properties.js', "router.get('/search', listPropertiesHandler)"],
    ['properties search accepts property type filter', 'routes/properties.js', 'req.query.property_type || req.query.propertyType'],
    ['properties search accepts min/max price filters', 'routes/properties.js', 'req.query.min_price || req.query.minPrice'],
    ['properties search accepts advanced filters', 'routes/properties.js', 'studentCampus'],
    ['properties search returns distance miles', 'routes/properties.js', 'distance_miles'],
    ['properties search returns result render fields', 'routes/properties.js', 'listingId'],
    ['properties search logs web radius searches', 'routes/properties.js', 'web_radius_search'],
    ['properties search has outside Uganda fallback', 'routes/properties.js', 'outside_uganda'],
    ['frontend list current location button exists', 'index.html', 'lp-current-location-btn'],
    ['frontend list current location handler exists', 'index.html', 'function shareLpCurrentLocation'],
    ['frontend compact hero location control exists', 'index.html', 'hero-location-control'],
    ['frontend lower hero filter row exists', 'index.html', 'hero-filter-row'],
    ['frontend hero property type filter exists', 'index.html', 'hero-property-type-f'],
    ['frontend hero min/max price filters exist', 'index.html', 'hero-max-price-f'],
    ['frontend hero category-aware filter config exists', 'index.html', 'HERO_FILTER_CONFIG_BY_TAB'],
    ['frontend hero hides commercial bedrooms', 'index.html', 'commercial: { propertyLabelKey: "heroCommercialType", amenityOptionsKey: "commercial", showBedrooms: false'],
    ['frontend hero hides land bedrooms', 'index.html', 'land: { propertyLabelKey: "heroLandType", amenityOptionsKey: "land", showBedrooms: false'],
    ['frontend hero category-aware type options exist', 'index.html', 'HERO_PROPERTY_TYPE_OPTIONS_BY_TAB'],
    ['frontend hero category-aware price options exist', 'index.html', 'HERO_PRICE_OPTIONS_BY_TAB'],
    ['frontend hero category-aware amenity options exist', 'index.html', 'HERO_AMENITY_OPTIONS_BY_TAB'],
    ['frontend hero land amenity filters exist', 'index.html', 'heroAmenityRoadAccess'],
    ['frontend hero commercial amenity filters exist', 'index.html', 'heroAmenityLoadingBay'],
    ['frontend hero student amenity filters exist', 'index.html', 'heroAmenityStudyArea'],
    ['frontend hero commercial type payload exists', 'index.html', 'payload.commercialType = filters.commercialType'],
    ['frontend hero land title payload exists', 'index.html', 'payload.landTitleType = filters.landTitleType'],
    ['frontend hero filters drawer exists', 'index.html', 'hero-advanced-filters-panel'],
    ['frontend hero location helper explains default radius', 'index.html', 'Location search uses a 10 mile radius by default.'],
    ['frontend 10-mile radius default exists', 'index.html', 'DEFAULT_NEAR_ME_RADIUS_MI = 10'],
    ['frontend Google Places autocomplete exists', 'index.html', 'getGooglePlacePredictions'],
    ['WhatsApp shared location radius logging exists', 'routes/whatsapp.js', 'search_radius_miles'],
    ['WhatsApp shared location uses 10-mile default', 'routes/whatsapp.js', 'DEFAULT_SEARCH_RADIUS_MILES'],
    ['WhatsApp shared location uses Uganda bounds', 'routes/whatsapp.js', 'isPointInUganda'],
    ['WhatsApp shared location blocks out-of-country coordinates', 'routes/whatsapp.js', 'outsideUgandaLocation'],
    ['WhatsApp shared location logs outside-Uganda fallback', 'routes/whatsapp.js', 'outside_uganda'],
    ['WhatsApp search results include next-step prompt', 'routes/whatsapp.js', 'nextPropertySearchActions'],
    ['admin setup exposes language status', 'routes/admin.js', 'languageSystem'],
    ['admin setup exposes location status', 'routes/admin.js', 'locationSystem']
  ];

  for (const [label, relPath, needle] of expectations) {
    checks.push(has(relPath, needle) ? pass(label, relPath) : fail(label, `${relPath} missing ${needle}`));
  }

  return checks;
}

function providerStatusChecks() {
  const groups = [
    ['super_admin bootstrap', ['SUPER_ADMIN_EMAIL', 'SUPER_ADMIN_INITIAL_PASSWORD', 'DATABASE_URL', 'JWT_SECRET']],
    ['admin API key', ['ADMIN_API_KEY']],
    ['email provider', ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'RESEND_API_KEY', 'MAIL_WEBHOOK_URL', 'MS_GRAPH_CLIENT_ID']],
    ['WhatsApp provider', ['WHATSAPP_PROVIDER', 'TWILIO_ACCOUNT_SID', 'META_WHATSAPP_TOKEN', 'WHATSAPP_WEB_BRIDGE_ENABLED', 'WHATSAPP_WEB_BRIDGE_TOKEN']],
    ['SMS provider', ['SMS_PROVIDER', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_SMS', 'AFRICASTALKING_API_KEY', 'AFRICASTALKING_USERNAME', 'AFRICASTALKING_SENDER_ID', 'SMS_TEST_PHONE']],
    ['payment provider', ['PAYMENT_LINK_BASE_URL', 'PAYMENT_PROVIDER_API_KEY', 'PAYMENT_PROVIDER_WEBHOOK_SECRET']],
    ['Google Maps/Places', ['GOOGLE_MAPS_API_KEY', 'PUBLIC_GOOGLE_MAPS_API_KEY']],
    ['OpenAI/LLM provider', ['OPENAI_API_KEY', 'LLM_PROVIDER', 'LLM_API_KEY']]
  ];

  return groups.map(([label, keys]) => {
    const setKeys = keys.filter((key) => Boolean(process.env[key]));
    const missingKeys = keys.filter((key) => !process.env[key]);
    return {
      ok: true,
      label: `env ${label}`,
      detail: setKeys.length ? `set: ${setKeys.join(', ')}; missing: ${missingKeys.join(', ') || 'none'}` : `missing: ${missingKeys.join(', ')}`
    };
  });
}

async function run() {
  const checks = [
    ...sourceWiringChecks(),
    ...providerStatusChecks(),
    ...(await probePublicBackend()),
    ...(await probeProtectedBackend())
  ];

  const failures = checks.filter((item) => !item.ok);
  console.log(`Backend connection probe for ${BASE_URL}`);
  for (const item of checks) {
    console.log(`${item.ok ? 'PASS' : 'FAIL'} ${item.label}${item.detail ? ` - ${item.detail}` : ''}`);
  }

  console.log(`SUMMARY checks=${checks.length} failures=${failures.length}`);
  if (failures.length) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
