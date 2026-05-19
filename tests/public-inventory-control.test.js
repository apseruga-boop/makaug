'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const appSource = fs.readFileSync('assets/makaug-app.js', 'utf8');
const browserProbeSource = fs.readFileSync('scripts/probe-public-routes-browser.js', 'utf8');
const htmlSource = fs.readFileSync('index.html', 'utf8');
const whatsappRouteSource = fs.readFileSync('routes/whatsapp.js', 'utf8');
const adminRouteSource = fs.readFileSync('routes/admin.js', 'utf8');

function functionSource(name) {
  const start = appSource.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `Expected ${name} to exist`);
  const next = appSource.indexOf('\nfunction ', start + 1);
  return appSource.slice(start, next === -1 ? appSource.length : next);
}

function asyncFunctionSource(name) {
  const start = appSource.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `Expected async ${name} to exist`);
  const nextFunction = appSource.indexOf('\nfunction ', start + 1);
  const nextAsync = appSource.indexOf('\nasync function ', start + 1);
  const next = [nextFunction, nextAsync].filter((idx) => idx !== -1).sort((a, b) => a - b)[0];
  return appSource.slice(start, next === undefined ? appSource.length : next);
}

test('public listings are backend-controlled, not frontend seed inventory', () => {
  assert.match(appSource, /function publicSampleListingsEnabled\(\)/);
  assert.match(appSource, /window\.MAKAUG_ALLOW_SAMPLE_LISTINGS === true/);
  assert.match(appSource, /function isBackendControlledListing\(property\)/);
  assert.match(appSource, /function isListingPublicVisible\(property\) \{\s*if \(adminRecordLooksLikeTest\(property\)\) return false;/);
  assert.match(appSource, /function getPublicListings\(\) \{\s*return PROPERTIES\.filter\(\(p\) => \(\s*isListingPublicVisible\(p\)[\s\S]*isBackendControlledListing\(p\)[\s\S]*publicSampleListingsEnabled\(\)/);
  assert.doesNotMatch(appSource, /function getPublicListings\(\) \{\s*return PROPERTIES\.filter\(\(p\) => isListingPublicVisible\(p\)\);\s*\}/);
});

test('admin live controls use paginated backend snapshots', () => {
  assert.match(appSource, /async function fetchAdminPaginatedRows\(path, headers, options = \{\}\)/);
  assert.match(appSource, /fetchAdminPaginatedRows\("\/api\/properties\?status=all", headers, \{ maxPages: 10 \}\)/);
  assert.match(appSource, /fetchAdminPaginatedRows\("\/api\/admin\/properties\/live", headers, \{ maxPages: 10 \}\)/);
  assert.match(appSource, /renderAdminFeaturedRows\(remoteSnap\?\.liveListings \|\| localSnap\.liveListings \|\| \[\]\)/);
  assert.doesNotMatch(appSource, /renderAdminFeaturedRows\(remoteSnap\?\.allListings \|\| localSnap\.allListings/);
});

test('remove and status actions can target listings loaded only through the live endpoint', () => {
  assert.match(appSource, /adminLiveListings\.find\(\s*\(p\) => String\(p\.id\) === String\(localId\)/);
  assert.match(appSource, /const liveIdx = adminLiveListings\.findIndex/);
  assert.match(appSource, /if \(liveIdx >= 0\) adminLiveListings\[liveIdx\]/);
});

test('admin live and featured surfaces clean-filter test-like backend listings', () => {
  assert.match(appSource, /function adminPublicControlVisibilityBadge\(row = \{\}\)/);
  assert.match(appSource, /Test-like public listing/);
  for (const name of ['renderAdminLiveListingsRows', 'renderAdminFeaturedRows']) {
    const source = functionSource(name);
    assert.match(source, /adminApplyLaunchCleanFilter/);
  }
  for (const name of ['renderAdminAllListingsRows']) {
    const source = functionSource(name);
    assert.match(source, /adminPublicControlVisibilityBadge/);
  }
});

test('browser release probe blocks uncontrolled seed listings from public pages', () => {
  assert.match(browserProbeSource, /FORBIDDEN_PUBLIC_LISTING_TEXT/);
  assert.match(browserProbeSource, /Luxury Villa in Kololo/);
  assert.match(browserProbeSource, /uncontrolled seed listing visible/);
});

test('anonymous public property APIs suppress launch seed QA listings', () => {
  const routeSource = fs.readFileSync('routes/properties.js', 'utf8');
  assert.match(routeSource, /LAUNCH_SEED_LISTING_MARKERS = \['SOFT LAUNCH TEST - DELETE', 'QA TEST - DELETE'\]/);
  assert.match(routeSource, /LAUNCH_DUMMY_LISTING_TITLES = new Set\(\['sdgsdgd', 'sgsgsgsgs'\]\)/);
  assert.match(routeSource, /function addPublicLaunchSeedFilter/);
  assert.match(routeSource, /COALESCE\(p\.title, ''\) NOT ILIKE/);
  assert.match(routeSource, /LOWER\(TRIM\(COALESCE\(p\.title,/);
  assert.match(routeSource, /COALESCE\(p\.extra_fields->>'soft_launch_test', ''\) !~\*/);
  assert.match(routeSource, /const publicOnly = parseBooleanLike\(req\.query\.public_only \|\| req\.query\.publicOnly, false\)/);
  assert.match(routeSource, /if \(publicOnly \|\| !adminAccess\) \{\s*addPublicLaunchSeedFilter\(filters, values\);/);
  assert.match(appSource, /apiRequest\("\/api\/properties\?status=approved&limit=1000&public_only=1", \{ skipAuth: true \}\)/);
  assert.match(routeSource, /isLaunchSeedListing\(property\) && !ownerCanPreview && !adminAccess/);
});

test('admin live endpoint mirrors public visibility and exposes cleanup action', () => {
  assert.match(adminRouteSource, /function adminLaunchTestListingCondition/);
  assert.match(adminRouteSource, /function adminPublicLiveListingCondition/);
  assert.match(adminRouteSource, /router\.get\('\/properties\/live'/);
  assert.match(adminRouteSource, /AND \$\{publicLiveCondition\}/);
  assert.match(adminRouteSource, /router\.post\('\/test-listings\/cleanup-live'/);
  assert.match(adminRouteSource, /live_test_listing_cleanup/);
  assert.match(appSource, /adminCleanupLiveTestListings/);
  assert.match(appSource, /\/api\/admin\/test-listings\/cleanup-live/);
  assert.match(htmlSource, /admin-clean-live-tests-btn/);
});

test('property detail enquiries are routed to the listing contact, not the signed-in admin viewer', () => {
  const routeSource = fs.readFileSync('routes/properties.js', 'utf8');
  assert.match(routeSource, /LEFT JOIN agents a ON a\.id = p\.agent_id/);
  assert.match(routeSource, /const targetPhone = listingContact\.agent_whatsapp \|\| listingContact\.agent_phone \|\| listingContact\.lister_phone/);
  assert.match(routeSource, /type: 'property_enquiry_for_lister'/);
  assert.doesNotMatch(routeSource, /type: 'enquiry_sent'[\s\S]{0,160}recipientPhone: contactPhone/);
  assert.match(appSource, /const canPrefillInquiryFromUser = !!authState\?\.user && !isAdminViewer/);
  assert.match(appSource, /Your enquiry will go to \{name\}\./);
});

test('approval WhatsApp notification opens before heavy admin dashboard refresh', () => {
  const source = asyncFunctionSource('adminSetListingStatus');
  const modalIndex = source.indexOf('openAdminWhatsAppMessageModal({');
  const refreshIndex = source.indexOf('void renderAdminDashboard().catch');
  assert(modalIndex > -1, 'status flow should still open the owner WhatsApp modal');
  assert(refreshIndex > -1, 'dashboard refresh should be non-blocking after status update');
  assert(modalIndex < refreshIndex, 'approval WhatsApp modal should open before dashboard refresh starts');
  assert.doesNotMatch(source, /await renderAdminDashboard\(\);/);
});

test('WhatsApp property search uses the same public inventory guardrails', () => {
  assert.match(whatsappRouteSource, /WHATSAPP_PUBLIC_SUPPRESSED_LISTING_MARKERS = \['SOFT LAUNCH TEST - DELETE', 'QA TEST - DELETE'\]/);
  assert.match(whatsappRouteSource, /WHATSAPP_PUBLIC_SUPPRESSED_LISTING_TITLES = new Set\(\['sdgsdgd', 'sgsgsgsgs'\]\)/);
  assert.match(whatsappRouteSource, /function addWhatsappPublicListingFilter/);
  assert.match(whatsappRouteSource, /COALESCE\(\$\{safeAlias\}\.title, ''\) NOT ILIKE/);
  assert.match(whatsappRouteSource, /COALESCE\(\$\{safeAlias\}\.source, ''\) !~\* '\(qa\|test\|seed\|demo\|soft_launch\|launch_proof\)'/);
  assert.match(whatsappRouteSource, /where \+= addWhatsappPublicListingFilter\(values, 'p'\)/);
  assert.match(whatsappRouteSource, /function findWebsitePublicListings\(filters = \{\}, limit = 5\) \{\s*void filters;\s*void limit;\s*return \[\];/);
});

test('public app cache version is bumped for controlled inventory rollout', () => {
  assert.match(htmlSource, /controlled-public-inventory-20260514/);
  assert.match(htmlSource, /admin-live-control-parity-20260515/);
  assert.match(htmlSource, /live-featured-cleanup-20260519/);
  assert.match(htmlSource, /agent-inquiry-nearby-20260519/);
  assert.match(htmlSource, /approval-profile-sync-20260519/);
});
