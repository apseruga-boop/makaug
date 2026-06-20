'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const appSource = fs.readFileSync('assets/makaug-app.js', 'utf8');
const browserProbeSource = fs.readFileSync('scripts/probe-public-routes-browser.js', 'utf8');
const htmlSource = fs.readFileSync('index.html', 'utf8');
const whatsappRouteSource = fs.readFileSync('routes/whatsapp.js', 'utf8');
const adminRouteSource = fs.readFileSync('routes/admin.js', 'utf8');
const agentsRouteSource = fs.readFileSync('routes/agents.js', 'utf8');
const propertiesRouteSource = fs.readFileSync('routes/properties.js', 'utf8');
const serverSource = fs.readFileSync('server.js', 'utf8');

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
  assert.match(adminRouteSource, /router\.get\('\/properties\/review-queue'/);
  assert.match(adminRouteSource, /'source_review'/);
  assert.match(adminRouteSource, /'queued'/);
  assert.match(adminRouteSource, /function adminPendingReviewWhere\(alias = 'p'\)[\s\S]*\$\{statusExpr\} NOT IN \(\$\{final\}\)[\s\S]*\$\{stageExpr\} NOT IN \(\$\{final\}\)/);
  assert.doesNotMatch(adminRouteSource, /AND \(\$\{statusExpr\} IN \(\$\{pending\}\) OR \$\{stageExpr\} IN \(\$\{pending\}\)\)/);
  assert.match(appSource, /fetchAdminPaginatedRows\("\/api\/admin\/properties\/review-queue", headers, \{ maxPages: 500 \}\)/);
  assert.match(appSource, /function adminAuthHeaders\(\) \{\s*const headers = \{\};[\s\S]*headers\["x-api-key"\] = adminApiKey;[\s\S]*headers\.Authorization = `Bearer \$\{authState\.token\}`;[\s\S]*return headers;/);
  assert.match(appSource, /async function adminSafeSnapshotRequest\(label, requestFn, fallback\)/);
  assert.match(appSource, /adminSafeSnapshotRequest\("review queue", \(\) => fetchAdminPaginatedRows\("\/api\/admin\/properties\/review-queue", headers, \{ maxPages: 500 \}\), \[\]\)/);
  assert.match(appSource, /adminSafeSnapshotRequest\("whatsapp insights"/);
  assert.match(appSource, /ADMIN_PENDING_QUEUE_RENDER_STEP = 150/);
  assert.match(appSource, /function adminShowMorePendingQueueRows\(\)/);
  assert.match(appSource, /function hydrateAdminAllListingsInBackground\(headers\)/);
  assert.match(appSource, /fetchAdminPaginatedRows\("\/api\/properties\?status=all", headers, \{ maxPages: 500 \}\)/);
  assert.match(appSource, /fetchAdminPaginatedRows\("\/api\/admin\/properties\/live", headers, \{ maxPages: 10 \}\)/);
  assert.match(appSource, /Object\.defineProperties\(rows, \{/);
  assert.match(appSource, /adminSummary: \{ value: lastResponse\?\.summary \|\| firstResponse\?\.summary \|\| null \}/);
  assert.match(appSource, /const adminLiveRows = remoteSnap\?\.liveListings \|\| localSnap\.liveListings \|\| \[\]/);
  assert.match(appSource, /renderAdminFeaturedRows\(adminLiveRows\)/);
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
  const routeSource = propertiesRouteSource;
  assert.match(routeSource, /LAUNCH_SEED_LISTING_MARKERS = \['SOFT LAUNCH TEST - DELETE', 'QA TEST - DELETE'\]/);
  assert.match(routeSource, /LAUNCH_DUMMY_LISTING_TITLES = new Set\(\['sdgsdgd', 'sgsgsgsgs'\]\)/);
  assert.match(routeSource, /function addPublicLaunchSeedFilter/);
  assert.match(routeSource, /COALESCE\(p\.title, ''\) NOT ILIKE/);
  assert.match(routeSource, /LOWER\(TRIM\(COALESCE\(p\.title,/);
  assert.match(routeSource, /COALESCE\(p\.extra_fields->>'soft_launch_test', ''\) !~\*/);
  assert(routeSource.includes("COALESCE(p.lister_email, '') !~* '(makaug\\\\.invalid|test@|qa@|dummy|sample)'"));
  assert.match(routeSource, /const publicOnly = parseBooleanLike\(req\.query\.public_only \|\| req\.query\.publicOnly, false\)/);
  assert.match(routeSource, /if \(publicOnly \|\| !adminAccess\) \{\s*addPublicLaunchSeedFilter\(filters, values\);/);
  assert.match(appSource, /fetchPublicPaginatedRows\("\/api\/properties\?status=approved&public_only=1&include_summary=false", \{ limit: 24, maxPages: 1 \}\)/);
  assert.match(appSource, /publicListingsApiTotal = Number\.isFinite\(apiTotal\) \? apiTotal : rows\.length/);
  assert.match(appSource, /apiRequest\(`\$\{path\}\$\{separator\}limit=\$\{limit\}&page=\$\{page\}`, \{ skipAuth: true \}\)/);
  assert.match(routeSource, /isLaunchSeedListing\(property\) && !ownerCanPreview && !adminAccess/);
});

test('public featured property feed only returns featured backend listings', () => {
  assert.match(propertiesRouteSource, /const featuredRaw = req\.query\.featured \?\? req\.query\.is_featured \?\? req\.query\.isFeatured/);
  assert.match(propertiesRouteSource, /const featuredFilterRequested = featuredRaw !== undefined/);
  assert.match(propertiesRouteSource, /if \(featuredFilterRequested\) \{/);
  assert.match(propertiesRouteSource, /COALESCE\(p\.extra_fields->>'featured', 'false'\) IN \('true', '1', 'yes'\)/);
  assert.match(propertiesRouteSource, /const defaultSort = featuredFilterRequested && featuredOnly \? 'featured' : 'newest'/);
  assert.match(appSource, /let publicFeaturedListingsFromApi = \[\]/);
  assert.match(appSource, /\/api\/properties\?status=approved&featured=true&limit=12&public_only=1&sort=featured/);
  assert.match(appSource, /const featuredListings = publicFeaturedListingsFromApi\.length \? publicFeaturedListingsFromApi : publicListings/);
});

test('anonymous public agent APIs suppress QA broker records', () => {
  assert.match(agentsRouteSource, /PUBLIC_AGENT_SUPPRESSED_MARKERS = \['QA TEST - DELETE', 'SOFT LAUNCH TEST - DELETE'\]/);
  assert.match(agentsRouteSource, /function addPublicAgentLaunchTestFilter/);
  assert.match(agentsRouteSource, /function addPublicAgentSelfRegistrationFilter/);
  assert.match(agentsRouteSource, /PUBLIC_AGENT_MIN_LIVE_LISTINGS = 2/);
  assert.match(agentsRouteSource, /function addPublicAgentInventoryFilter/);
  assert.match(agentsRouteSource, /addPublicAgentLaunchTestFilter\(filters, values\)/);
  assert.match(agentsRouteSource, /addPublicAgentSelfRegistrationFilter\(filters\)/);
  assert.match(agentsRouteSource, /addPublicAgentInventoryFilter\(filters\)/);
  assert.match(agentsRouteSource, /COUNT\(\*\)::int[\s\S]*p\.agent_id = a\.id[\s\S]*p\.status = 'approved'[\s\S]*>= \$\{PUBLIC_AGENT_MIN_LIVE_LISTINGS\}/);
  assert(agentsRouteSource.includes('a.user_id IS NOT NULL'));
  assert(agentsRouteSource.includes("COALESCE(a.email, '') !~* '(qa-test|makaug\\\\.invalid|dummy|sample)'"));
  assert(agentsRouteSource.includes("COALESCE(a.licence_number, '') !~* '^(QA|TEST|DUMMY|SAMPLE)-'"));
  assert(agentsRouteSource.includes("COALESCE(a.licence_number, '') !~* '^(SOCIAL|FOUND-ONLINE|TIKTOK|FACEBOOK|X)-'"));
});

test('admin live endpoint mirrors public visibility and exposes cleanup action', () => {
  assert.match(adminRouteSource, /function adminLaunchTestListingCondition/);
  assert.match(adminRouteSource, /function adminPublicLiveListingCondition/);
  assert.match(adminRouteSource, /function adminPublicLiveListingWhere/);
  assert.match(adminRouteSource, /status'\)} = 'approved' OR \(\$\{adminColumn\(alias, 'status'\)\} = 'sold' AND \$\{adminColumn\(alias, 'sold_at'\)\} >= NOW\(\) - INTERVAL '7 days'\)/);
  assert.match(adminRouteSource, /function adminFeaturedListingCondition/);
  assert.match(adminRouteSource, /COUNT\(\*\) FILTER \(WHERE \$\{adminPublicLiveListingWhere\(''\)\}\)::int AS public_live/);
  assert.match(adminRouteSource, /COUNT\(\*\) FILTER \(WHERE \$\{adminPublicLiveListingWhere\(''\)\} AND \$\{adminFeaturedListingCondition\(''\)\}\)::int AS public_featured/);
  assert.match(adminRouteSource, /router\.get\('\/properties\/live'/);
  assert.match(adminRouteSource, /WHERE \$\{publicLiveCondition\}/);
  assert.match(adminRouteSource, /summary: \{\s*public_inventory:/);
  assert.match(adminRouteSource, /public_visible_total/);
  assert.match(adminRouteSource, /featured_total/);
  assert.match(adminRouteSource, /public_parity/);
  assert.match(adminRouteSource, /same_as_public_api/);
  assert.match(adminRouteSource, /CONCAT\('\/property\/', p\.id::text\) AS property_url/);
  assert.match(appSource, /function adminIsPublicLiveAdminListing/);
  assert.match(appSource, /let adminPublicInventoryParity = \{\}/);
  assert.match(appSource, /publicInventoryParity: adminPublicInventoryParity/);
  assert.match(appSource, /function renderAdminLiveParitySummary/);
  assert.match(appSource, /Online public listings/);
  assert.match(appSource, /Featured online/);
  assert.match(appSource, /summary\?\.properties\?\.public_live \?\? summary\?\.properties\?\.approved/);
  assert.match(htmlSource, /admin-live-parity-summary/);
  assert.match(htmlSource, /admin-featured-parity-summary/);
  assert.match(appSource, /Open Public Listing/);
  assert.match(adminRouteSource, /router\.post\('\/test-listings\/cleanup-live'/);
  assert.match(adminRouteSource, /live_test_listing_cleanup/);
  assert.match(appSource, /adminCleanupLiveTestListings/);
  assert.match(appSource, /\/api\/admin\/test-listings\/cleanup-live/);
  assert.match(htmlSource, /admin-clean-live-tests-btn/);
});

test('homepage opportunity counter uses the public API total as the visible source of truth', () => {
  assert.match(appSource, /const apiTotal = Number\(publicListingsApiTotal \?\? 0\) \|\| 0/);
  assert.match(appSource, /const unresolvedPublicListings = Math\.max\(0, authoritativeTotal - bucketTotal\)/);
  assert.match(appSource, /if \(unresolvedPublicListings\) stats\.sale \+= unresolvedPublicListings/);
  assert.match(appSource, /stats\.other = 0/);
  assert.match(htmlSource, /hero-public-total-parity-20260610/);
  assert.match(htmlSource, /hero-route-classification-20260610/);
  assert.match(appSource, /const publicListingType = normalizedListingType \|\| getHeroPropertyOpportunityBucket\(p\)/);
  assert.match(appSource, /return "sale";\s*\}\s*function heroOpportunityStatRow/);
});

test('public properties API is cacheable and uses the fast public summary path', () => {
  assert.match(propertiesRouteSource, /PUBLIC_PROPERTIES_CACHE_TTL_MS = 15 \* 1000/);
  assert.match(propertiesRouteSource, /function publicPropertiesCacheControl\(\)/);
  assert.match(propertiesRouteSource, /X-Makaug-Properties-Cache', 'HIT'/);
  assert.match(propertiesRouteSource, /X-Makaug-Properties-Cache', canUsePublicResponseCache \? 'MISS' : 'BYPASS'/);
  assert.match(propertiesRouteSource, /function fastPublicOpportunityBucketSql\(alias = 'p'\)/);
  assert.match(propertiesRouteSource, /const opportunityBucketSql = fastPublicOpportunityBucketSql\('p'\)/);
  assert.match(propertiesRouteSource, /SELECT COUNT\(\*\)::int AS total\s+FROM properties p/);
  assert.match(propertiesRouteSource, /WITH public_page_source AS/);
  assert.match(propertiesRouteSource, /COALESCE\(p\.extra_fields, '\{\}'::jsonb\)\s+- 'raw_source_post'/);
  assert.match(propertiesRouteSource, /WHERE i\.property_id = public_page\.id/);
  assert.match(serverSource, /PUBLIC_INVENTORY_WARMUP_PATHS = \[/);
  assert.match(serverSource, /\/api\/properties\?status=approved&public_only=1&include_summary=false&limit=24/);
  assert.match(serverSource, /\/api\/properties\?status=approved&featured=true&limit=12&public_only=1&sort=featured&include_summary=false/);
  assert.doesNotMatch(propertiesRouteSource, /const opportunityBucketSql = publicOpportunityBucketSql\('p'\)/);
  assert.match(propertiesRouteSource, /Cache-Control', canUsePublicResponseCache \? publicPropertiesCacheControl\(\) : 'no-store'/);
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

test('property share icons render real social links with javascript fallbacks', () => {
  assert.match(appSource, /function getPropertyShareHref\(property = \{\}, channel = "copy"\)/);
  assert.match(appSource, /function renderPropertyShareActions\(property, idArg, options = \{\}\)/);
  assert.match(appSource, /function sharePropertyListingFromEvent\(event, id, channel = "copy"\)/);
  assert.match(appSource, /data-property-share-channel="\$\{adminAttr\(item\.channel\)\}"/);
  assert.match(appSource, /https:\/\/wa\.me\/\?text=/);
  assert.match(appSource, /facebook\.com\/sharer\/sharer\.php/);
  assert.match(appSource, /linkedin\.com\/sharing\/share-offsite/);
  assert.match(appSource, /twitter\.com\/intent\/tweet/);
  assert.match(appSource, /www\.tiktok\.com\/upload/);
  assert.match(appSource, /renderPropertyShareActions\(p, idArg, \{ stopPropagation: true \}\)/);
  assert.match(appSource, /renderPropertyShareActions\(p, detailIdArg\)/);
});

test('broker profiles recover when public route fragments removed the profile page shell', () => {
  const source = asyncFunctionSource('openBrokerProfile');
  assert.match(appSource, /function openBrokerProfileLink\(event, id\)/);
  assert.match(appSource, /function ensureBrokerProfilePageShell\(\)/);
  assert.match(appSource, /function setCanonicalBrokerProfileUrl\(brokerOrId, source = "broker_profile"\)/);
  assert.match(appSource, /href="\$\{adminAttr\(getBrokerProfilePath\(b\)\)\}"/);
  assert.match(appSource, /onclick="return openBrokerProfileLink\(event, \$\{adminListingIdArg\(b\.id\)\}\)"/);
  assert.match(appSource, /page\.id = "page-broker-profile"/);
  assert.match(appSource, /id="broker-profile-content"/);
  assert.match(source, /const content = ensureBrokerProfilePageShell\(\)/);
  assert.match(source, /showPage\("broker-profile", \{ history: false, source: "broker_profile_open" \}\)/);
  assert.match(source, /setCanonicalBrokerProfileUrl\(b, "broker_profile_open"\)/);
  assert.match(source, /content\.innerHTML =/);
  assert.doesNotMatch(source, /document\.getElementById\("broker-profile-content"\)\.innerHTML/);
});

test('agent deep links open the broker profile route directly', () => {
  const source = asyncFunctionSource('parseInitialDeepLink');
  const start = source.indexOf('if (agentFromPath || brokerFromQuery)');
  const end = source.indexOf('const adminControl', start);
  assert(start > -1 && end > start, 'Expected agent deep-link branch to exist');
  const agentBranch = source.slice(start, end);
  assert.match(agentBranch, /await openBrokerProfile\(found\.id\)/);
  assert.match(agentBranch, /await openBrokerProfile\(loaded\.id\)/);
  assert.doesNotMatch(agentBranch, /showPage\("brokers", \{ history: false, source: "deep_link" \}\)/);
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
  assert.match(htmlSource, /broker-profile-share-links-20260519/);
  assert.match(htmlSource, /direct-agent-profile-20260519/);
  assert.match(htmlSource, /public-featured-feed-fix-20260525/);
  assert.match(htmlSource, /king-live-public-parity-20260609/);
});
