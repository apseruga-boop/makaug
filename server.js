require('dotenv').config();

const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const logger = require('./config/logger');
const db = require('./config/database');
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const propertiesRoutes = require('./routes/properties');
const agentsRoutes = require('./routes/agents');
const contactRoutes = require('./routes/contact');
const advertisingRoutes = require('./routes/advertising');
const monetizationRoutes = require('./routes/monetization');
const marketplaceRoutes = require('./routes/marketplace');
const valuationRoutes = require('./routes/valuation');
const tiktokDisplayRoutes = require('./routes/tiktok-display');
const analyticsRoutes = require('./routes/analytics');
const savedPropertiesRoutes = require('./routes/saved-properties');
const adminRoutes = require('./routes/admin');
const whatsappRoutes = require('./routes/whatsapp');
const mortgageRoutes = require('./routes/mortgage');
const aiRoutes = require('./routes/ai');
const aiCoreRoutes = require('./routes/ai-core');
const aiCeoRoutes = require('./routes/ai-ceo');
const adminAiAgentsRoutes = require('./routes/admin-agents');
const propertySeekerRoutes = require('./routes/property-seeker');
const studentRoutes = require('./routes/student');
const fieldAgentRoutes = require('./routes/field-agent');
const staffRoutes = require('./routes/staff');
const harvestRoutes = require('./routes/harvest');
const {
  adminRouter: offPlanAdminRoutes,
  publicRouter: offPlanRoutes,
  staffRouter: offPlanStaffRoutes
} = require('./routes/off-plan');
const {
  DEMO_PROJECT: virtualHomeDemoProject,
  adminRouter: virtualHomesAdminRoutes,
  handleFurnitureRedirect,
  publicRouter: virtualHomesRoutes,
  staffRouter: virtualHomesStaffRoutes,
  virtualHomeDemoEnabled
} = require('./routes/virtual-homes');
const { getPublicProject: getPublicVirtualHome } = require('./services/virtualHomeService');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { runMigrations } = require('./scripts/migrate');
const {
  isProtectedPath,
  roleCanAccessProtectedPath,
  renderProtectedLoginShell,
  sanitizePublicHtml
} = require('./services/publicHtmlSanitizer');
const { startXSourceDripScheduler } = require('./services/xSourceDripService');
const { startYouTubeSourceDripScheduler } = require('./services/youtubeSourceDripService');
const { startMarketplaceLifecycleScheduler } = require('./services/marketplaceLifecycleService');
const { startMarketplaceDripScheduler } = require('./services/marketplaceNationalDripService');
const { startFeaturedRotationScheduler } = require('./services/featuredRotationService');
const { getPublicDevelopment, isPubliclyVisible, normalizeDevelopmentRow } = require('./services/offPlanService');
const {
  applyHarvestPublicSubmissionVisibility,
  harvestAutomationEnabled
} = require('./utils/harvestFeatureFlags');
const { DISTRICTS: MARKETPLACE_DISTRICTS, MARKETPLACE_CATEGORIES } = require('./services/marketplaceService');
const { loadPublicOpportunitySummary } = require('./services/publicInventoryMetricsService');
const {
  SESHAIKHAYA_LAUNCH_MARKER,
  applyCountryHtml,
  applyCountryJavaScript,
  tenantFor
} = require('./packages/shared-country-core');
const {
  CATEGORY_SEO,
  loadPublicSeoInventorySnapshot,
  categoryPageSeoMeta,
  sitemapEntries
} = require('./services/publicSeoService');
const {
  loadPublicSeoListings,
  loadPublicSeoListing,
  renderCategorySeoHtml,
  renderPropertySeoHtml,
  renderHomepageSeoHtml
} = require('./services/publicSeoRenderService');
const {
  SEO_FACET_MIN_LISTINGS,
  resolvePublicSeoLanding,
  publicSeoLandingMeta,
  siblingFacetLinks
} = require('./services/publicSeoLandingService');

const app = express();
// Required on Render so rate limiting uses the forwarded client IP correctly.
app.set('trust proxy', 1);

const ACTIVE_COUNTRY_CODE = String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase();
const ACTIVE_TENANT = tenantFor(ACTIVE_COUNTRY_CODE);
const IS_SOUTH_AFRICA = ACTIVE_COUNTRY_CODE === 'ZA';

const RUNTIME_BUILD_ID = 'bundle-version-commit-key-20260719';
const RUNTIME_STARTED_AT = new Date().toISOString();
let runtimeReady = false;

function escapeXml(value = '') {
  return String(value).replace(/[<>&'\"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '\"': '&quot;' }[character]));
}

function runtimeBundleVersion() {
  return String(
    process.env.RENDER_GIT_COMMIT
      || process.env.SOURCE_VERSION
      || process.env.GIT_COMMIT
      || RUNTIME_BUILD_ID
  ).trim();
}

const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

app.use(
  cors({
    origin(origin, callback) {
      const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(String(origin || ''));
      const tenantHost = new URL(ACTIVE_TENANT.domain).hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const isTenantOrigin = new RegExp(`^https?:\\/\\/(?:[^/]+\\.)?${tenantHost}$`, 'i').test(String(origin || ''));
      if (!origin || !corsOrigins.length || corsOrigins.includes(origin) || isLocalOrigin || isTenantOrigin) {
        return callback(null, true);
      }
      return callback(new Error('CORS origin not allowed'));
    },
    credentials: true
  })
);

app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.json({
  limit: '40mb',
  verify: (req, _res, buffer) => {
    if (req.originalUrl === '/api/whatsapp/webhook') {
      req.rawBody = Buffer.from(buffer);
    }
  }
}));

// Render's process-level health probe must not wait on database work. The
// existing /api/health route remains the deeper database readiness check.
app.get('/healthz', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true,
    service: process.env.RENDER_SERVICE_NAME || ACTIVE_TENANT.brandName,
    country_code: ACTIVE_COUNTRY_CODE,
    ready: runtimeReady,
    started_at: RUNTIME_STARTED_AT
  });
});

app.use((_req, res, next) => {
  if (runtimeReady) return next();
  res.set('Cache-Control', 'no-store');
  return res.status(503).json({
    ok: false,
    error: 'service_starting',
    country_code: ACTIVE_COUNTRY_CODE
  });
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  skip: (req) => req.path === '/analytics/config',
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api', apiLimiter);

app.get('/api/version', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true,
    service: process.env.RENDER_SERVICE_NAME || ACTIVE_TENANT.brandName,
    country_code: ACTIVE_COUNTRY_CODE,
    tenant: ACTIVE_TENANT.brandName,
    build_id: RUNTIME_BUILD_ID,
    git_commit: process.env.RENDER_GIT_COMMIT || process.env.SOURCE_VERSION || process.env.GIT_COMMIT || null,
    instance_id: process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || null,
    started_at: RUNTIME_STARTED_AT,
    markers: [
      'canonical-location-source-review-115',
      'master-data-integrity-116',
      'shared-uganda-location-resolver-coverage',
      'location-query-normalization-prominence-20260811',
      'shared-country-location-query-normalization-20260811',
      'whatsapp-shared-location-resolver',
      'prelaunch-backlog-gates',
      'whatsapp-property-card-v2',
      'human-integrity-override-20260811',
      'human-approval-overlord-20260811',
      'king-timestamp-iso-normalization-20260811',
      ...(!IS_SOUTH_AFRICA ? ['makaug-homepage-seo-stale-while-revalidate-20260824'] : []),
      ...(!IS_SOUTH_AFRICA ? ['makaug-always-on-whatsapp-runtime-20260814'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-natural-ownership-replies-20260824'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-public-agent-parity-fast-replies-20260824'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-employee-agent-007-review-intake-20260829'] : []),
      ...(!IS_SOUTH_AFRICA ? ['off-plan-projectfinder-layout-v3-20260904'] : []),
      ...(!IS_SOUTH_AFRICA ? ['maka-virtual-homes-v1-20260905'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent-007-multiple-property-batches-20260829'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent-007-ordered-batch-finalization-20260829'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent-007-complete-barrier-20260829'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent-007-history-reconciliation-20260829'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent-007-video-fetch-fallback-20260829'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent-007-acknowledged-media-reconciliation-20260829'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent-007-notification-ledger-recovery-20260829'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent-007-media-only-reconciliation-20260829'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent-007-retry-history-recovery-20260829'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent-007-retry-api-errors-20260829'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent-007-resume-replay-progress-20260829'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent-007-caption-reconciliation-20260829'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent-007-residential-caption-20260829'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent-007-post-complete-chat-resume-20260830'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-subsecond-response-pipeline-20260830'] : []),
      ...(!IS_SOUTH_AFRICA ? ['francis-agent-premium-share-preview-v3-20260829'] : []),
      ...(!IS_SOUTH_AFRICA ? ['francis-agent-authentic-brand-preview-v4-20260829'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-active-intake-call-shield-20260829'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-call-card-trust-gate-20260831'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-distinct-rapid-replies-20260831'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-video-still-dual-media-20260831'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-video-still-backfill-20260831'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-video-five-key-frames-20260831'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-video-distinct-clear-frames-20260903'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-employee-media-quality-guard-20260906'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-video-original-recovery-20260831'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-outgoing-preview-guard-20260831'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent007-replay-backoff-20260901'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent007-pending-media-idempotency-20260901'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-multi-result-fast-search-20260824'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-owner-forward-review-media-20260820'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-owner-history-backfill-20260820'] : []),
      ...(!IS_SOUTH_AFRICA ? ['uganda-master-intake-recovery-20260811'] : []),
      ...(!IS_SOUTH_AFRICA ? ['uganda-location-free-text-20260812'] : []),
      ...(IS_SOUTH_AFRICA ? [SESHAIKHAYA_LAUNCH_MARKER, 'seshaikhaya-national-gazetteer-20260811'] : [])
    ]
  });
});

app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/properties', propertiesRoutes);
app.use('/api/off-plan', offPlanRoutes);
app.use('/api/virtual-homes', virtualHomesRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/advertising', advertisingRoutes);
app.use('/api/monetization', monetizationRoutes);
if (ACTIVE_TENANT.publicFeatures?.marketplace !== false) app.use('/api/marketplace', marketplaceRoutes);
if (ACTIVE_TENANT.publicFeatures?.valuation !== false) app.use('/api/valuation', valuationRoutes);
app.use('/api/tiktok-display', tiktokDisplayRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/saved-properties', savedPropertiesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/off-plan', offPlanAdminRoutes);
app.use('/api/admin/virtual-homes', virtualHomesAdminRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/mortgage-rates', mortgageRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/ai-core', aiCoreRoutes);
app.use('/api/ai-ceo', aiCeoRoutes);
app.use('/api/admin/ai-agents', adminAiAgentsRoutes);
app.use('/api/property-seeker', propertySeekerRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/field-agent', fieldAgentRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/staff/off-plan', offPlanStaffRoutes);
app.use('/api/staff/virtual-homes', virtualHomesStaffRoutes);
app.use('/api/harvest', harvestRoutes);

app.get('/go/furniture/:productKey', handleFurnitureRedirect);

app.get('/marketplace-sitemap.xml', (_req, res) => {
  if (ACTIVE_TENANT.publicFeatures?.marketplace === false) return res.status(404).type('text/plain').send('Not found');
  const baseUrl = String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || ACTIVE_TENANT.domain).replace(/\/+$/, '');
  const urls = [`${baseUrl}/marketplace`];
  for (const category of MARKETPLACE_CATEGORIES) {
    for (const district of MARKETPLACE_DISTRICTS) {
      urls.push(`${baseUrl}/marketplace?category=${encodeURIComponent(category.key)}&district=${encodeURIComponent(district)}`);
    }
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${escapeXml(url)}</loc><changefreq>weekly</changefreq></url>`).join('\n')}\n</urlset>`;
  res.type('application/xml').set('Cache-Control', 'public, max-age=3600').send(xml);
});

app.get('/robots.txt', (_req, res) => {
  const baseUrl = String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || ACTIVE_TENANT.domain).replace(/\/+$/, '');
  const lines = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /king',
    'Disallow: /staff',
    'Disallow: /dashboard',
    'Disallow: /api/',
    `Sitemap: ${baseUrl}/sitemap.xml`
  ];
  if (ACTIVE_TENANT.publicFeatures?.marketplace !== false) lines.push(`Sitemap: ${baseUrl}/marketplace-sitemap.xml`);
  lines.push('');
  res.type('text/plain').set('Cache-Control', 'public, max-age=3600').send(lines.join('\n'));
});

app.get('/sitemap.xml', async (_req, res, next) => {
  try {
    const baseUrl = String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || ACTIVE_TENANT.domain).replace(/\/+$/, '');
    let snapshot = { counts: {}, properties: [] };
    try {
      snapshot = await loadPublicSeoInventorySnapshot(db);
    } catch (error) {
      logger.warn('Property sitemap is serving stable routes while inventory is unavailable', { message: error.message });
    }
    const urls = sitemapEntries(snapshot, baseUrl);
    urls.push({ loc: `${baseUrl}/off-plan`, changefreq: 'daily', priority: '0.8' });
    urls.push({ loc: `${baseUrl}/off-plan/overseas`, changefreq: 'weekly', priority: '0.7' });
    urls.push({ loc: `${baseUrl}/off-plan/overseas/kenya`, changefreq: 'weekly', priority: '0.7' });
    urls.push({ loc: `${baseUrl}/services`, changefreq: 'monthly', priority: '0.7' });
    urls.push({ loc: `${baseUrl}/services/virtual-homes`, changefreq: 'weekly', priority: '0.8' });
    try {
      const offPlan = await db.query("SELECT * FROM off_plan_developments WHERE country_code = ANY(ARRAY['UG','KE']) AND status = 'published' AND (verification_status = 'verified' OR (verification_status = 'partially_verified' AND extra_fields->>'public_preview_approved' = 'true')) ORDER BY updated_at DESC LIMIT 500");
      offPlan.rows.map(normalizeDevelopmentRow).filter(isPubliclyVisible).forEach((project) => urls.push({ loc: project.country_code === 'KE' ? `${baseUrl}/off-plan/overseas/kenya/${encodeURIComponent(project.slug)}` : `${baseUrl}/off-plan/${encodeURIComponent(project.slug)}`, lastmod: project.updated_at ? new Date(project.updated_at).toISOString() : null, changefreq: 'weekly', priority: '0.7' }));
    } catch (error) {
      logger.warn('Off-plan sitemap entries are unavailable until the feature migration is applied', { message: error.message });
    }
    try {
      const virtualHomes = await db.query("SELECT public_slug, updated_at FROM virtual_home_projects WHERE status IN ('PUBLISHED','DELIVERED') AND is_public = true AND public_slug IS NOT NULL ORDER BY updated_at DESC LIMIT 500");
      virtualHomes.rows.forEach((project) => urls.push({ loc: `${baseUrl}/virtual-homes/${encodeURIComponent(project.public_slug)}`, lastmod: project.updated_at ? new Date(project.updated_at).toISOString() : null, changefreq: 'weekly', priority: '0.7' }));
    } catch (error) {
      logger.warn('Virtual Home sitemap entries are unavailable until the feature migration is applied', { message: error.message });
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((entry) => [
      '  <url>',
      `    <loc>${escapeXml(entry.loc)}</loc>`,
      entry.lastmod ? `    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : '',
      entry.changefreq ? `    <changefreq>${escapeXml(entry.changefreq)}</changefreq>` : '',
      entry.priority ? `    <priority>${escapeXml(entry.priority)}</priority>` : '',
      '  </url>'
    ].filter(Boolean).join('\n')).join('\n')}\n</urlset>`;
    return res.type('application/xml').set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600').send(xml);
  } catch (error) {
    return next(error);
  }
});

// Never expose local/private operator tools on public host.
app.use('/private-local', (_req, res) => {
  return res.status(404).send('Not found');
});

app.get('/config.js', (_req, res) => {
  const publicConfig = {
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    apiBase: process.env.PUBLIC_API_BASE || '',
    adsenseClient: process.env.GOOGLE_ADSENSE_CLIENT || '',
    adsenseSlots: {
      default: process.env.GOOGLE_ADSENSE_SLOT_DEFAULT || ''
    }
  };

  res.type('application/javascript');
  res.set('Cache-Control', 'no-store');
  return res.send([
    `window.MAKAUG_CONFIG = ${JSON.stringify(publicConfig)};`,
    `window.MAKAUG_GOOGLE_MAPS_API_KEY = ${JSON.stringify(publicConfig.googleMapsApiKey)};`,
    `window.MAKAUG_API_BASE = window.MAKAUG_API_BASE || ${JSON.stringify(publicConfig.apiBase)};`,
    `window.MAKAUG_ADSENSE_CLIENT = window.MAKAUG_ADSENSE_CLIENT || ${JSON.stringify(publicConfig.adsenseClient)};`,
    `window.MAKAUG_ADSENSE_SLOTS = window.MAKAUG_ADSENSE_SLOTS || ${JSON.stringify(publicConfig.adsenseSlots)};`
  ].join('\n'));
});

const staticRoot = __dirname;
const indexPath = path.join(staticRoot, 'index.html');
const appJsPath = path.join(staticRoot, 'assets', 'makaug-app.js');
const isProduction = process.env.NODE_ENV === 'production';
const captureHelperUsabilityVersion = 'capture-helper-usability-20260607';
const studentNearestUniversityVersion = 'student-nearest-university-20260616';
const staffOperationsDashboardVersion = 'staff-operations-dashboard-20260620a';
const mortgageUiTabsBankLogosVersion = 'mortgage-provider-badges-20260630';
const publicInventoryPerformanceVersion = 'public-inventory-performance-20260629';
const publicInventoryProgressiveRenderVersion = 'public-inventory-progressive-render-20260630';
const publicInventoryFirstPageVersion = 'public-inventory-first-page-24-20260630';
const publicInventoryCacheKeyVersion = 'public-inventory-cache-key-20260630';
const publicHomepageFeaturedFastVersion = 'public-home-featured-fast-20260630';
const publicHomepageSummaryFastVersion = 'public-home-summary-fast-20260630';
const publicCategoryFirstPaintVersion = 'public-category-first-paint-8-20260630';
const publicAppImmediateLoadVersion = 'public-app-immediate-load-20260630';
const publicAppInitImmediateVersion = 'public-app-init-immediate-20260630';
const publicSummaryPrefetchVersion = 'public-summary-prefetch-20260630';
const publicCategoryFocusedHydrationVersion = 'public-category-focused-hydration-20260630';
const publicCategoryDeferredHydrationVersion = 'public-category-deferred-hydration-20260630';
const kingDashboardAuthStateVersion = 'king-dashboard-auth-state-20260630';
const kingLiveTabTrustedRowsVersion = 'king-live-tab-trusted-rows-20260630';
const staffSourceMonitorGuideVersion = 'staff-source-monitor-guide-20260630';
const staffDashboardAuthRaceVersion = 'staff-dashboard-auth-race-20260701-staff-dashboard-hydration-20260701-staff-dashboard-retry-20260701';
const brokerDashboardOwnershipShareVersion = 'broker-dashboard-ownership-share-20260703d';
const whatsappMatchboardRouteLinksVersion = 'whatsapp-matchboard-route-links-20260703';
const whatsappMatchboardLegacyHashVersion = 'whatsapp-matchboard-legacy-hash-route-20260703';
const whatsappMatchboardQueryHandoffVersion = 'whatsapp-matchboard-query-handoff-20260703';
const whatsappMatchboardQueryHandoffRetryVersion = 'whatsapp-matchboard-query-handoff-retry-20260703';
const whatsappMatchboardInventorySyncVersion = 'whatsapp-matchboard-inventory-sync-20260703';
const whatsappMatchboardVisibleQuerySyncVersion = 'whatsapp-matchboard-visible-query-sync-20260703';
const whatsappMatchboardVisibleQueryGuardVersion = 'whatsapp-matchboard-visible-query-guard-20260703';
const publicI18nDetailPersistenceVersion = 'public-i18n-detail-persistence-20260707';
const publicI18nStartupRaceFixVersion = 'public-i18n-startup-race-fix-20260707';
const publicI18nCookiePersistenceVersion = 'public-i18n-cookie-persistence-20260707';
const publicI18nAuthLanguageGuardVersion = 'public-i18n-auth-language-guard-20260707';
const publicSearchAreaHandoffVersion = 'public-search-area-handoff-20260707';
const publicSearchNormalizeHelperVersion = 'public-search-normalize-helper-20260707';
const publicSearchRouteBackendResultsVersion = 'public-search-route-backend-results-20260707';
const publicHomeSearchBackendResultsVersion = 'public-home-search-backend-results-20260707';
const publicQaCleanupVersion = 'public-qa-cleanup-20260708';
const publicLocationLabelFixVersion = 'public-location-label-fix-20260708';
const publicResultsDeliveryFixVersion = 'public-results-delivery-fix-20260708';
const inpageVideoFacadeVersion = 'inpage-video-facade-20260709';
const numberedPaginationVersion = 'numbered-pagination-20260709';
const tilesContactConsistencyVersion = 'tiles-contact-consistency-20260709';
const deadTikTokSourceContactFixVersion = 'dead-tiktok-source-contact-fix-20260709';
const contactOptionMatrixVersion = 'contact-option-matrix-20260709';
const property24ContactBarVersion = 'property24-contact-bar-20260709';
const publicContactPhoneRoutingVersion = 'public-contact-phone-routing-20260709';
const contactBarCopyFitVersion = 'contact-bar-copy-fit-20260709';
const contactBarAllPropertiesI18nVersion = 'contact-bar-all-properties-i18n-20260709';
const detailP1P2P4FixVersion = 'detail-p1-p2-p4-fix-20260709';
const tiktokOembedFieldsVersion = 'tiktok-oembed-fields-20260709';
const badgeStandardisationVersion = 'badge-standardisation-20260709';
const foundOnlinePlayChipCleanupVersion = 'found-online-play-chip-cleanup-20260709';
const staffSourceSweepAsyncUnblockVersion = 'staff-source-sweep-async-unblock-20260709';
const tiktokThumbnailSourceVolumeUnlockVersion = 'tiktok-thumbnail-source-volume-unlock-20260709';
const tiktokThumbnailCacheProxyVersion = 'tiktok-thumbnail-cache-proxy-20260709';
const adminDashboardStabilityVersion = 'admin-dashboard-stability-20260709';
const adminDashboardStabilityV2Version = 'admin-dashboard-stability-v2-20260709';
const adminDashboardStabilityV3Version = 'admin-dashboard-stability-v3-20260709';
const kingDashboardCorrelationFixVersion = 'king-dashboard-correlation-fix-20260710';
const kingDashboardLiveAiFixVersion = 'king-dashboard-live-ai-fix-20260710';
const kingDashboardAiVisibleSummaryFixVersion = 'king-dashboard-ai-visible-summary-fix-20260710';
const listPropertyEmailOnlyVersion = 'list-property-email-only-20260710';
const listPropertyEmailOnlyCopyFixVersion = 'list-property-email-only-copy-fix-20260710';
const listPropertyContactIdRequiredVersion = 'list-property-contact-id-required-20260710';
const listPropertyCreateFixVersion = 'list-property-create-fix-20260711';
const publicFilterStandardisationVersion = 'public-filter-standardisation-20260710';
const mortgageLeadRoutingFixVersion = 'mortgage-lead-routing-fix-20260710';
const mortgageFinderRedesignVersion = 'mortgage-finder-redesign-20260710';
const mortgageI18nCompletionVersion = 'mortgage-i18n-completion-20260710';
const mortgageI18nPolishVersion = 'mortgage-i18n-polish-20260710';
const mortgageRealBankLogosVersion = 'mortgage-real-bank-logos-20260710';
const mortgageRealBankLogosEagerVersion = 'mortgage-real-bank-logos-eager-20260710';
const mortgageLogoCellPolishVersion = 'mortgage-logo-cell-polish-20260710';
const publicStickyMapRailVersion = 'public-sticky-map-rail-20260710';
const publicStickyMapAssistRailVersion = 'public-sticky-map-assist-rail-20260710';
const tailwindStaticCssVersion = 'tailwind-static-css-20260710';
const sourceRegistryRotationVersion = 'source-registry-rotation-20260710';
const sourceSweepPerformanceVersion = 'source-sweep-performance-20260710';
const sourceSweepHardBudgetVersion = 'source-sweep-hard-budget-20260710';
const staffTikTokPasteOembedVersion = 'staff-tiktok-paste-oembed-20260711';
const reviewQueueParityVersion = 'review-queue-list-count-parity-20260711';
const staffPanelsReviewQueueVersion = 'staff-panels-review-queue-20260711';
const staffPanelsReviewQueueRowsVersion = 'staff-panels-review-queue-rows-20260711';
const staffReviewQueuePerformanceVersion = 'staff-review-queue-performance-20260711';
const staffBulkModerationVersion = 'staff-bulk-moderation-20260711';
const staffBulkGateTightenVersion = 'staff-bulk-gate-tighten-20260711';
const staffBulkGateTightenV2Version = 'staff-bulk-gate-tighten-v2-20260711';
const staffBulkGatePositiveVersion = 'staff-bulk-gate-positive-20260711';
const staffBulkGateRound4Version = 'staff-bulk-gate-round4-20260711';
const staffSuppressedSourcesRegistryVersion = 'staff-suppressed-sources-registry-20260711';
const studentSupplyGateVersion = 'student-supply-gate-20260711';
const staffReviewQueuePanelRetryVersion = 'staff-review-queue-panel-retry-20260713';
const listingConfirmationsRedesignVersion = 'listing-confirmations-redesign-20260713';
const listPropertyDescLiveTranslateVersion = 'list-property-desc-live-translate-20260713';
const aboutPageFullCopyVersion = 'about-page-full-copy-20260713';
const aboutPageVisualRefineVersion = 'about-page-visual-refine-20260713';
const aboutCtaPrimaryVersion = 'about-cta-primary-20260713';
const aboutHeroContrastFixVersion = 'about-hero-contrast-fix-20260713';
const aboutLandStepsVersion = 'about-land-steps-20260713';
const socialImportTilesVersion = 'social-import-tiles-20260713';
const kingHarvesterRouteContractVersion = 'king-harvester-route-contract-20260809';
const kingTikTokHarvesterE2eVersion = 'king-tiktok-harvester-e2e-20260809';
const publicAppVersionSuffixes = [
  kingTikTokHarvesterE2eVersion,
  kingHarvesterRouteContractVersion,
  captureHelperUsabilityVersion,
  studentNearestUniversityVersion,
  staffOperationsDashboardVersion,
  mortgageUiTabsBankLogosVersion,
  publicInventoryPerformanceVersion,
  publicInventoryProgressiveRenderVersion,
  publicInventoryFirstPageVersion,
  publicInventoryCacheKeyVersion,
  publicHomepageFeaturedFastVersion,
  publicHomepageSummaryFastVersion,
  publicCategoryFirstPaintVersion,
  publicAppImmediateLoadVersion,
  publicAppInitImmediateVersion,
  publicSummaryPrefetchVersion,
  publicCategoryFocusedHydrationVersion,
  publicCategoryDeferredHydrationVersion,
  kingDashboardAuthStateVersion,
  kingLiveTabTrustedRowsVersion,
  staffSourceMonitorGuideVersion,
  staffDashboardAuthRaceVersion,
  brokerDashboardOwnershipShareVersion,
  whatsappMatchboardRouteLinksVersion,
  whatsappMatchboardLegacyHashVersion,
  whatsappMatchboardQueryHandoffVersion,
  whatsappMatchboardQueryHandoffRetryVersion,
  whatsappMatchboardInventorySyncVersion,
  whatsappMatchboardVisibleQuerySyncVersion,
  whatsappMatchboardVisibleQueryGuardVersion,
  publicI18nDetailPersistenceVersion,
  publicI18nStartupRaceFixVersion,
  publicI18nCookiePersistenceVersion,
  publicI18nAuthLanguageGuardVersion,
  publicSearchAreaHandoffVersion,
  publicSearchNormalizeHelperVersion,
  publicSearchRouteBackendResultsVersion,
  publicHomeSearchBackendResultsVersion,
  publicQaCleanupVersion,
  publicLocationLabelFixVersion,
  publicResultsDeliveryFixVersion,
  inpageVideoFacadeVersion,
  numberedPaginationVersion,
  tilesContactConsistencyVersion,
  deadTikTokSourceContactFixVersion,
  contactOptionMatrixVersion,
  property24ContactBarVersion,
  publicContactPhoneRoutingVersion,
  contactBarCopyFitVersion,
  contactBarAllPropertiesI18nVersion,
  detailP1P2P4FixVersion,
  tiktokOembedFieldsVersion,
  badgeStandardisationVersion,
  foundOnlinePlayChipCleanupVersion,
  staffSourceSweepAsyncUnblockVersion,
  tiktokThumbnailSourceVolumeUnlockVersion,
  tiktokThumbnailCacheProxyVersion,
  adminDashboardStabilityVersion,
  adminDashboardStabilityV2Version,
  adminDashboardStabilityV3Version,
  kingDashboardCorrelationFixVersion,
  kingDashboardLiveAiFixVersion,
  kingDashboardAiVisibleSummaryFixVersion,
  listPropertyEmailOnlyVersion,
  listPropertyEmailOnlyCopyFixVersion,
  listPropertyContactIdRequiredVersion,
  listPropertyCreateFixVersion,
  publicFilterStandardisationVersion,
  mortgageLeadRoutingFixVersion,
  mortgageFinderRedesignVersion,
  mortgageI18nCompletionVersion,
  mortgageI18nPolishVersion,
  mortgageRealBankLogosVersion,
  mortgageRealBankLogosEagerVersion,
  mortgageLogoCellPolishVersion,
  publicStickyMapRailVersion,
  publicStickyMapAssistRailVersion,
  tailwindStaticCssVersion,
  sourceRegistryRotationVersion,
  sourceSweepPerformanceVersion,
  sourceSweepHardBudgetVersion,
  staffTikTokPasteOembedVersion,
  reviewQueueParityVersion,
  staffPanelsReviewQueueVersion,
  staffPanelsReviewQueueRowsVersion,
  staffReviewQueuePerformanceVersion,
  staffBulkModerationVersion,
  staffBulkGateTightenVersion,
  staffBulkGateTightenV2Version,
  staffBulkGatePositiveVersion,
  staffBulkGateRound4Version,
  staffSuppressedSourcesRegistryVersion,
  studentSupplyGateVersion,
  staffReviewQueuePanelRetryVersion,
  listingConfirmationsRedesignVersion,
  listPropertyDescLiveTranslateVersion,
  aboutPageFullCopyVersion,
  aboutPageVisualRefineVersion,
  aboutCtaPrimaryVersion,
  aboutHeroContrastFixVersion,
  aboutLandStepsVersion,
  socialImportTilesVersion
];
let cachedIndexHtml = null;
let countryAppAssetCache = null;
const publicHtmlCache = new Map();
const textAssetCache = new Map();
const PUBLIC_HTML_CACHE_MAX_ENTRIES = Math.max(
  4,
  Math.min(64, Number(process.env.PUBLIC_HTML_CACHE_MAX_ENTRIES || 16) || 16)
);
const PUBLIC_HTML_WARMUP_PATHS = [
  '/',
  '/sitemap.xml',
  '/for-sale',
  '/to-rent',
  '/land',
  '/commercial',
  '/student-accommodation'
];
const PUBLIC_INVENTORY_WARMUP_PATHS = [
  '/api/properties?status=approved&public_only=1&limit=1&page=1&include_summary=1',
  '/api/properties/search?search=Kira',
  '/api/properties?status=approved&public_only=1&limit=8&page=1&include_summary=0',
  '/api/properties?status=approved&public_only=1&listing_type=sale&limit=8&page=1&include_summary=0',
  '/api/properties?status=approved&public_only=1&listing_type=rent&limit=8&page=1&include_summary=0',
  '/api/properties/search?status=approved&public_only=1&listing_type=sale&limit=24&page=1&sort=price_desc',
  '/api/properties/search?status=approved&public_only=1&listing_type=rent&limit=24&page=1&sort=price_asc',
  '/api/properties/search?status=approved&public_only=1&listing_type=land&limit=24&page=1&sort=price_desc',
  '/api/properties/search?status=approved&public_only=1&listing_type=commercial&limit=24&page=1&sort=price_desc',
  '/api/properties?status=approved&featured=true&limit=12&page=1&public_only=1&sort=featured&include_summary=0'
];
// The warmup traverses several database-backed routes. Running it every 45
// seconds kept the single production instance permanently busy and delayed
// real category searches behind its own refresh traffic.
const PUBLIC_CACHE_WARMUP_INTERVAL_MS = 4 * 60 * 1000;
const PUBLIC_CACHE_WARMUP_REQUEST_TIMEOUT_MS = 5000;
const PUBLIC_CACHE_WARMUP_LOAD_SHED_MARKER = 'k32-launch-traffic-load-shed-20260805';
const PUBLIC_CACHE_WARMUP_OPT_IN_MARKER = 'k32-launch-warmup-opt-in-20260805';
const PUBLIC_CACHE_WARMUP_USER_AGENT = 'makaug-public-inventory-cache-warmup';
const PUBLIC_CACHE_WARMUP_ENABLED = String(process.env.PUBLIC_INVENTORY_CACHE_WARMUP || 'false').toLowerCase() === 'true';
let publicCacheWarmupInFlight = false;

function addPublicCacheRefreshParam(pathName) {
  if (!String(pathName || '').startsWith('/api/properties')) return pathName;
  return `${pathName}${pathName.includes('?') ? '&' : '?'}cache_refresh=1`;
}

async function warmPublicCache(baseUrl) {
  if (!PUBLIC_CACHE_WARMUP_ENABLED || typeof fetch !== 'function') return;
  for (const pathName of [...PUBLIC_HTML_WARMUP_PATHS, ...PUBLIC_INVENTORY_WARMUP_PATHS]) {
    const requestPath = addPublicCacheRefreshParam(pathName);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PUBLIC_CACHE_WARMUP_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}${requestPath}`, {
        headers: { 'User-Agent': PUBLIC_CACHE_WARMUP_USER_AGENT },
        signal: controller.signal
      });
      logger.info('Public cache warmup completed', {
        path: pathName,
        status: response.status,
        cache: response.headers.get('x-makaug-properties-cache') || null,
        marker: PUBLIC_CACHE_WARMUP_LOAD_SHED_MARKER
      });
      await response.arrayBuffer();
    } catch (error) {
      logger.warn('Public cache warmup failed', {
        path: pathName,
        error: error.message
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function schedulePublicCacheWarmup(baseUrl) {
  if (!PUBLIC_CACHE_WARMUP_ENABLED) {
    logger.info('Public cache warmup disabled; real requests have priority', {
      marker: PUBLIC_CACHE_WARMUP_OPT_IN_MARKER
    });
    return;
  }
  const run = () => {
    if (publicCacheWarmupInFlight) return;
    publicCacheWarmupInFlight = true;
    warmPublicCache(baseUrl)
      .catch((error) => {
        logger.warn('Public cache warmup crashed', { error: error.message });
      })
      .finally(() => {
        publicCacheWarmupInFlight = false;
      });
  };
  setTimeout(run, 1000);
  const interval = setInterval(run, PUBLIC_CACHE_WARMUP_INTERVAL_MS);
  if (typeof interval.unref === 'function') interval.unref();
}
const PUBLIC_HTML_CACHE_CONTROL = isProduction
  ? 'no-cache, max-age=0, must-revalidate'
  : 'no-store';
const LONG_LIVED_STATIC_CACHE_CONTROL = 'public, max-age=604800, immutable';

function appendVaryHeader(res, value) {
  const next = String(value || '').trim();
  if (!next) return;
  const existing = res.getHeader('Vary');
  if (!existing) {
    res.setHeader('Vary', next);
    return;
  }
  const values = String(existing)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (values.includes('*')) return;
  if (!values.some((item) => item.toLowerCase() === next.toLowerCase())) {
    values.push(next);
  }
  res.setHeader('Vary', values.join(', '));
}

function acceptsContentEncoding(req, encoding) {
  const header = String(req.headers['accept-encoding'] || '');
  return header.split(',').some((part) => {
    const [name, ...params] = part.trim().toLowerCase().split(';').map((item) => item.trim());
    if (name !== encoding && name !== '*') return false;
    const q = params.find((item) => item.startsWith('q='));
    return !q || Number(q.slice(2)) !== 0;
  });
}

function preferredContentEncoding(req) {
  if (acceptsContentEncoding(req, 'br')) return 'br';
  if (acceptsContentEncoding(req, 'gzip')) return 'gzip';
  return '';
}

function compressBody(body, encoding) {
  if (encoding === 'br') {
    return zlib.brotliCompressSync(body, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 5
      }
    });
  }
  if (encoding === 'gzip') {
    return zlib.gzipSync(body, { level: 6 });
  }
  return body;
}

function readCachedTextAsset(filePath, { compress = true } = {}) {
  const stat = fs.statSync(filePath);
  const cached = textAssetCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    if (compress && !cached.compressed) {
      cached.compressed = {
        br: compressBody(cached.body, 'br'),
        gzip: compressBody(cached.body, 'gzip')
      };
    }
    return cached;
  }
  const body = fs.readFileSync(filePath);
  const entry = {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    body,
    etag: `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
    lastModified: stat.mtime.toUTCString(),
    compressed: compress ? {
      br: compressBody(body, 'br'),
      gzip: compressBody(body, 'gzip')
    } : null
  };
  textAssetCache.set(filePath, entry);
  return entry;
}

function readCountryAppAsset() {
  const source = readCachedTextAsset(appJsPath, { compress: false });
  if (
    countryAppAssetCache
    && countryAppAssetCache.sourceEtag === source.etag
    && countryAppAssetCache.countryCode === ACTIVE_COUNTRY_CODE
  ) return countryAppAssetCache;

  const body = Buffer.from(applyCountryJavaScript(source.body.toString('utf8'), ACTIVE_COUNTRY_CODE), 'utf8');
  countryAppAssetCache = {
    sourceEtag: source.etag,
    countryCode: ACTIVE_COUNTRY_CODE,
    body,
    etag: `W/"${ACTIVE_COUNTRY_CODE.toLowerCase()}-${runtimeBundleVersion()}"`,
    lastModified: source.lastModified
  };
  return countryAppAssetCache;
}

function sendBufferResponse(req, res, body, options = {}) {
  const source = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ''), 'utf8');
  const {
    contentType = 'text/plain; charset=utf-8',
    cacheControl = 'no-store',
    etag = '',
    lastModified = '',
    compressed = null,
    dynamicCompression = true
  } = options;

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', cacheControl);
  if (etag) res.setHeader('ETag', etag);
  if (lastModified) res.setHeader('Last-Modified', lastModified);
  appendVaryHeader(res, 'Accept-Encoding');

  if (req.fresh) {
    return res.status(304).end();
  }

  const encoding = preferredContentEncoding(req);
  let output = source;
  if (encoding && source.length >= 1024) {
    const candidate = compressed?.[encoding] || (dynamicCompression ? compressBody(source, encoding) : null);
    if (candidate && candidate.length < source.length) {
      output = candidate;
      res.setHeader('Content-Encoding', encoding);
    }
  }

  res.setHeader('Content-Length', String(output.length));
  if (req.method === 'HEAD') {
    return res.end();
  }
  return res.end(output);
}

function sendTextResponse(req, res, html, options = {}) {
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  return sendBufferResponse(req, res, Buffer.from(String(html || ''), 'utf8'), {
    contentType: 'text/html; charset=utf-8',
    dynamicCompression: false,
    ...options
  });
}

function applyCaptureHelperUsabilityIndexPatch(html) {
  if (!html) return html;
  const missingSuffixes = publicAppVersionSuffixes.filter((version) => !html.includes(version));
  if (!missingSuffixes.length) return html;
  const suffix = missingSuffixes.map((version) => `-${version}`).join('');
  return html.replace(
    /(window\.__makaugReleaseMarkers\s*=\s*")([^"]+)(")/,
    `$1$2${suffix}$3`
  );
}

function injectRuntimeBundleVersion(html) {
  if (!html) return html;
  const version = JSON.stringify(runtimeBundleVersion());
  return html.replace(
    'window.__makaugAppVersion = "__MAKAUG_BUNDLE_VERSION__";',
    `window.__makaugAppVersion = ${version};\n    document.documentElement.dataset.makaugAppVersion = window.__makaugAppVersion;`
  );
}

function injectRuntimeMetaPixelId(html) {
  if (!html) return html;
  const configuredId = String(process.env.META_PIXEL_ID || '').trim();
  const pixelId = /^\d{6,24}$/.test(configuredId) ? configuredId : '';
  return html.replace(
    'window.__makaugMetaPixelId = "__MAKAUG_META_PIXEL_ID__";',
    `window.__makaugMetaPixelId = ${JSON.stringify(pixelId)};`
  );
}

const captureHelperUsabilityScriptPatch = `
;(() => {
  const version = "${captureHelperUsabilityVersion}";
  const escapeHtml = (value = "") => String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  const attr = escapeHtml;

  window.adminSocialCaptureHelperScript = function adminSocialCaptureHelperScript() {
    return \`(async function(){
  var clean=function(value){return String(value||"").replace(/\\\\s+/g," ").trim();};
  var normalize=function(href){
    try {
      var u=new URL(href,location.href);
      var host=u.hostname.replace(/^www\\\\./,"").toLowerCase();
      var path=u.pathname || "";
      if (host==="youtu.be") {
        var shortId=path.replace(/^\\\\/+/, "").split("/")[0];
        return shortId ? "https://www.youtube.com/watch?v="+shortId : "";
      }
      if (host.endsWith("youtube.com")) {
        if (path==="/watch" && u.searchParams.get("v")) return "https://www.youtube.com/watch?v="+u.searchParams.get("v");
        if (path.indexOf("/shorts/")===0) return "https://www.youtube.com/shorts/"+path.split("/")[2];
      }
      if (host.endsWith("tiktok.com")) {
        var tik=path.match(/^\\\\/@[^/]+\\\\/video\\\\/\\\\d+/);
        if (tik) return "https://www.tiktok.com"+tik[0];
      }
      if (host.endsWith("instagram.com")) {
        var insta=path.match(/^\\\\/(p|reel|tv)\\\\/[^/]+/);
        if (insta) return "https://www.instagram.com"+insta[0]+"/";
      }
      if (host==="x.com" || host==="twitter.com" || host.endsWith(".x.com") || host.endsWith(".twitter.com")) {
        var x=path.match(/^\\\\/[^/]+\\\\/status\\\\/\\\\d+/);
        if (x) return "https://x.com"+x[0];
      }
      if (host.endsWith("facebook.com") || host.endsWith("fb.watch")) {
        if (host.endsWith("fb.watch")) return u.origin+path;
        if (path.indexOf("/watch/")===0 && u.searchParams.get("v")) return "https://www.facebook.com/watch/?v="+u.searchParams.get("v");
        if (path.indexOf("/reel/")===0) return "https://www.facebook.com"+path.split("/").slice(0,3).join("/");
        if (path.indexOf("/groups/")===0 && path.indexOf("/posts/")>0) return "https://www.facebook.com"+path.split("/").slice(0,5).join("/");
        if (/\\\\/posts\\\\//.test(path)) return "https://www.facebook.com"+path.split("/").slice(0,4).join("/");
        if (/\\\\/videos\\\\//.test(path)) return "https://www.facebook.com"+path.split("/").slice(0,4).join("/");
        if (path==="/story.php" && u.searchParams.get("story_fbid")) return u.href;
        if (path==="/permalink.php" && u.searchParams.get("story_fbid")) return u.href;
      }
      return "";
    } catch (error) {
      return "";
    }
  };
  var seen={};
  var rows=[];
  Array.prototype.slice.call(document.querySelectorAll("a[href]")).forEach(function(anchor){
    var url=normalize(anchor.href);
    if (!url || seen[url]) return;
    seen[url]=true;
    var card=anchor.closest("article,[data-e2e*=video],[data-testid*=tweet],li,div") || anchor;
    var text=clean(card.innerText || anchor.innerText || anchor.getAttribute("aria-label") || document.title || "").slice(0,220);
    rows.push(url+(text ? " | "+text : ""));
  });
  if (!rows.length) {
    alert("No exact social post links found on this visible page. Open a video/post/grid source page first, then run the helper again.");
    return;
  }
  var output=rows.join("\\\\n");
  try {
    await navigator.clipboard.writeText(output);
  } catch (error) {
    var box=document.createElement("textarea");
    box.value=output;
    box.style.position="fixed";
    box.style.left="8px";
    box.style.top="8px";
    box.style.width="80vw";
    box.style.height="40vh";
    box.style.zIndex="2147483647";
    document.body.appendChild(box);
    box.focus();
    box.select();
  }
  alert("makaug copied "+rows.length+" exact social post link(s). Go back to King, click Paste Captured Links, and paste.");
})();\`;
  };

  window.adminSocialCaptureBookmarkletUrl = function adminSocialCaptureBookmarkletUrl() {
    return \`javascript:\${encodeURIComponent(window.adminSocialCaptureHelperScript())}\`;
  };

  window.adminPasteSocialCapturedLinks = function adminPasteSocialCapturedLinks(seedText = "") {
    if (typeof window.adminOpenSocialQuickPastePanel === "function") {
      return window.adminOpenSocialQuickPastePanel(seedText);
    }
    const statusEl = document.getElementById("admin-found-online-status")
      || document.getElementById("admin-social-source-status");
    if (statusEl && typeof window.adminSocialQuickPastePanelHtml === "function") {
      statusEl.classList.remove("hidden");
      statusEl.innerHTML = window.adminSocialQuickPastePanelHtml({ seedText });
      if (typeof window.adminScrollTo === "function") {
        window.adminScrollTo(\`#\${statusEl.id || "admin-found-online-status"}\`);
      }
      return;
    }
    if (typeof toast === "function") {
      toast("Paste box is still loading. Use Paste Captured Links at the top of the dashboard.");
    }
  };

  window.adminSocialCaptureHelperPanelHtml = function adminSocialCaptureHelperPanelHtml({ copiedLabel = "" } = {}) {
    const bookmarklet = window.adminSocialCaptureBookmarkletUrl();
    return \`
    <div class="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 space-y-3 text-sm text-indigo-950">
      <div><div class="font-black">Capture helper setup</div><div>Use this once to create a browser bookmark. After that, open TikTok, YouTube, Facebook, Instagram, or X source pages and click the bookmark. It copies visible exact post/video links so you can paste them into makaug.</div>
        \${copiedLabel ? \`<div class="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-950"><div class="font-black">\${escapeHtml(copiedLabel)}</div><div class="mt-1 text-[11px]">Copied means the long bookmark code is in your computer clipboard. Nothing opens by itself. The next step is to paste it into a new browser bookmark URL field.</div></div>\` : ""}
      </div>
      <button type="button" onclick="adminPasteSocialCapturedLinks()" class="bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 px-3 py-2 rounded-lg text-xs font-bold">Open Paste Box</button>
      <div class="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-emerald-950">
        <div class="font-black text-violet-950">Simplest no-bookmark option</div>
        <div class="mt-1 text-xs">If bookmark setup feels annoying, open one exact YouTube, TikTok, Facebook, Instagram, or X post, copy the address bar link, then click Open Paste Box here and paste it. This works one link at a time.</div>
      </div>
      <div class="grid md:grid-cols-4 gap-2">
        <div class="bg-white border border-indigo-100 rounded-xl p-3"><b>1. Show bookmarks bar</b><br><span class="text-xs">Press Cmd+Shift+B in Chrome if you cannot see the bookmarks bar.</span></div>
        <div class="bg-white border border-indigo-100 rounded-xl p-3"><b>2. Save helper</b><br><span class="text-xs">Drag the purple makaug Capture Posts button to the bookmarks bar. If dragging is blocked, copy the Bookmark URL below into a new bookmark URL field.</span></div>
        <div class="bg-white border border-indigo-100 rounded-xl p-3"><b>3. Capture links</b><br><span class="text-xs">Open a source page, scroll until useful posts are visible, then click the bookmark. The helper copies exact links.</span></div>
        <div class="bg-white border border-indigo-100 rounded-xl p-3"><b>4. Paste into King</b><br><span class="text-xs">Return to makaug, click Open Paste Box, preview, then Queue Found Online for King review.</span></div>
      </div>
      <div class="rounded-xl border border-indigo-100 bg-white p-3">
        <div class="flex flex-wrap gap-2">
          <a href="\${attr(bookmarklet)}" onclick="return false" title="Drag this link to your browser bookmarks bar" class="inline-flex border border-indigo-300 bg-indigo-700 text-white hover:bg-indigo-800 px-3 py-2 rounded-lg text-xs font-bold">Drag to bookmarks: makaug Capture Posts</a>
          <button type="button" onclick="adminCopySocialCaptureBookmarklet()" class="border border-indigo-200 text-indigo-700 hover:bg-indigo-50 px-3 py-2 rounded-lg text-xs font-bold">Copy Bookmarklet URL</button>
          <button type="button" onclick="adminSelectSocialCaptureBookmarkletCode()" class="border border-indigo-200 text-indigo-700 hover:bg-indigo-50 px-3 py-2 rounded-lg text-xs font-bold">Select Bookmarklet URL</button>
          <button type="button" onclick="adminShowSocialCaptureConsoleCode()" class="border border-gray-200 text-gray-700 hover:bg-gray-50 px-3 py-2 rounded-lg text-xs font-bold">Copy Console Code</button>
          <button type="button" onclick="adminLoadSocialCaptureExample()" class="border border-gray-200 text-gray-700 hover:bg-gray-50 px-3 py-2 rounded-lg text-xs font-bold">Load Example</button>
        </div>
        <label class="mt-2 block text-[11px] font-black text-indigo-950" for="admin-social-capture-bookmarklet-url">Bookmark URL to paste</label>
        <textarea id="admin-social-capture-bookmarklet-url" class="mt-1 w-full rounded-lg border border-indigo-100 bg-indigo-50 p-2 text-[11px] font-mono text-indigo-950" rows="3" readonly>\${escapeHtml(bookmarklet)}</textarea>
        <div class="mt-2 text-xs">Fastest setup: drag the purple makaug Capture Posts button to your browser bookmarks bar. If dragging is blocked, copy the bookmark URL, create a new browser bookmark named makaug Capture Posts, then paste this text into the bookmark URL field.</div>
      </div>
      <details class="bg-white rounded-xl border border-indigo-100 p-3"><summary class="font-bold cursor-pointer">Manual console fallback</summary><pre class="mt-2 whitespace-pre-wrap text-xs text-gray-700">\${escapeHtml(window.adminSocialCaptureHelperScript())}</pre></details>
    </div>\`;
  };

  window.adminSelectSocialCaptureBookmarkletCode = function adminSelectSocialCaptureBookmarkletCode() {
    const textarea = document.getElementById("admin-social-capture-bookmarklet-url");
    if (!textarea) return;
    textarea.focus();
    textarea.select();
    try {
      document.execCommand("copy");
      if (typeof toast === "function") toast("Bookmark URL selected and copied");
    } catch (error) {
      if (typeof toast === "function") toast("Bookmark URL selected");
    }
  };

  window.__makaugCaptureHelperUsabilityPatch = version;
})();`;

function readIndexHtml() {
  if (isProduction && cachedIndexHtml) return cachedIndexHtml;
  const patchedHtml = applyCaptureHelperUsabilityIndexPatch(fs.readFileSync(indexPath, 'utf8'));
  const html = injectRuntimeMetaPixelId(injectRuntimeBundleVersion(patchedHtml));
  if (isProduction) cachedIndexHtml = html;
  return html;
}

function renderPublicHtml(pathname) {
  const rawPath = pathname || '/';
  const basePath = String(rawPath).split('?')[0].split('#')[0] || '/';
  const normalizedBasePath = basePath.length > 1 ? basePath.replace(/\/+$/, '') : basePath;
  const key = normalizedBasePath === '/login' ? rawPath : normalizedBasePath;
  if (isProduction && publicHtmlCache.has(key)) {
    const cached = publicHtmlCache.get(key);
    // Refresh insertion order so the first entry is always the least recently used.
    publicHtmlCache.delete(key);
    publicHtmlCache.set(key, cached);
    return cached;
  }
  let rendered = sanitizePublicHtml(readIndexHtml(), { pathname: rawPath });
  if (process.env.SHARED_CORE_PHASE1_ENABLED !== 'false') {
    rendered = applyCountryHtml(rendered, ACTIVE_COUNTRY_CODE, { homepage: normalizedBasePath === '/' });
  }
  rendered = applyHarvestPublicSubmissionVisibility(rendered);
  if (isProduction) {
    publicHtmlCache.set(key, rendered);
    while (publicHtmlCache.size > PUBLIC_HTML_CACHE_MAX_ENTRIES) {
      const oldestKey = publicHtmlCache.keys().next().value;
      if (oldestKey === undefined) break;
      publicHtmlCache.delete(oldestKey);
    }
  }
  return rendered;
}

function escapeMetaContent(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function absolutePublicUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = String(process.env.PUBLIC_SITE_URL || process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || ACTIVE_TENANT.domain).replace(/\/+$/, '');
  return `${base}${raw.startsWith('/') ? '' : '/'}${raw}`;
}

function patchMetaTag(html, propertyName, content) {
  const safeContent = escapeMetaContent(content);
  const safeName = escapeMetaContent(propertyName);
  const escapedName = propertyName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const attribute = propertyName.startsWith('og:') ? 'property' : 'name';
  const replacement = `<meta ${attribute}="${safeName}" content="${safeContent}">`;
  const tagPattern = new RegExp(`<meta\\b(?=[^>]*(?:property|name)=["']${escapedName}["'])[^>]*>`, 'i');
  if (tagPattern.test(html)) return html.replace(tagPattern, replacement);
  return html.replace('</head>', `  ${replacement}\n</head>`);
}

function patchDocumentTitle(html, title) {
  const replacement = `<title>${escapeMetaContent(title)}</title>`;
  return /<title>[^<]*<\/title>/i.test(html)
    ? html.replace(/<title>[^<]*<\/title>/i, replacement)
    : html.replace('</head>', `  ${replacement}\n</head>`);
}

function patchCanonicalLink(html, canonical) {
  const replacement = `<link rel="canonical" href="${escapeMetaContent(canonical)}">`;
  return /<link\b(?=[^>]*rel=["']canonical["'])[^>]*>/i.test(html)
    ? html.replace(/<link\b(?=[^>]*rel=["']canonical["'])[^>]*>/i, replacement)
    : html.replace('</head>', `  ${replacement}\n</head>`);
}

function patchStructuredData(html, structuredData) {
  if (!structuredData) return html;
  const payload = JSON.stringify(structuredData).replace(/</g, '\\u003c');
  const replacement = `<script type="application/ld+json" id="makaug-route-structured-data">${payload}</script>`;
  const pattern = /<script\b(?=[^>]*id=["']makaug-route-structured-data["'])[^>]*>[\s\S]*?<\/script>/i;
  return pattern.test(html)
    ? html.replace(pattern, replacement)
    : html.replace('</head>', `  ${replacement}\n</head>`);
}

function patchPublicPageSeoMeta(html, meta = {}) {
  let patched = patchDocumentTitle(html, meta.title);
  patched = patchMetaTag(patched, 'description', meta.description);
  if (Number.isFinite(Number(meta.count))) {
    patched = patchMetaTag(patched, 'makaug:listing-count', String(meta.count));
  }
  patched = patchCanonicalLink(patched, meta.canonical);
  patched = patchMetaTag(patched, 'og:type', meta.ogType || 'website');
  patched = patchMetaTag(patched, 'og:title', meta.title);
  patched = patchMetaTag(patched, 'og:description', meta.description);
  patched = patchMetaTag(patched, 'og:url', meta.canonical);
  patched = patchMetaTag(patched, 'og:image', meta.image);
  patched = patchMetaTag(patched, 'twitter:title', meta.title);
  patched = patchMetaTag(patched, 'twitter:description', meta.description);
  patched = patchMetaTag(patched, 'twitter:image', meta.image);
  patched = patchMetaTag(patched, 'twitter:card', 'summary_large_image');
  return patchStructuredData(patched, meta.structuredData);
}

function patchListingOpenGraphMeta(html, meta = {}) {
  return patchPublicPageSeoMeta(html, meta);
}

const FRANCIS_ISABIRYE_AGENT_ID = '5674f6cb-37a0-4e1e-904f-06e03ec401ab';
const AGENT_SHARE_PREVIEW_VERSION = 'preview-v2';
const AGENT_SHARE_PREMIUM_PREVIEW_VERSION = 'preview-v3';
const AGENT_SHARE_BRAND_PREVIEW_VERSION = 'preview-v4';

async function loadPublicAgentOpenGraphMeta(agentId, options = {}) {
  const safeId = String(agentId || '').trim();
  if (!safeId) return null;
  const result = await db.query(
    `SELECT
       a.id,
       a.full_name,
       a.company_name,
       a.bio,
       a.profile_photo_url,
       a.specializations
     FROM agents a
     WHERE a.id::text = $1
       AND LOWER(COALESCE(a.status, 'pending')) NOT IN ('rejected', 'declined', 'suspended', 'deleted', 'removed', 'blocked')
       AND EXISTS (
         SELECT 1
         FROM properties p
         WHERE p.agent_id = a.id
           AND p.status = 'approved'
       )
     LIMIT 1`,
    [safeId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const name = String(row.full_name || row.company_name || 'MakaUG property agent').trim();
  const profilePath = `/agents/${encodeURIComponent(row.id)}`;
  const specializations = Array.isArray(row.specializations)
    ? row.specializations.map((value) => String(value || '').trim()).filter(Boolean).slice(0, 3)
    : [];
  const description = specializations.length
    ? `${specializations.join(' - ')}. Review my property profile on makaug.com.`
    : 'Review my property profile on makaug.com.';
  const isFrancis = String(row.id) === FRANCIS_ISABIRYE_AGENT_ID;
  const isBrandFrancisPreview = isFrancis
    && options.previewVersion === AGENT_SHARE_BRAND_PREVIEW_VERSION;
  const isPremiumFrancisPreview = isFrancis
    && options.previewVersion === AGENT_SHARE_PREMIUM_PREVIEW_VERSION;
  const isApprovedFrancisShare = isFrancis
    && (options.approvedShare === true || options.previewVersion === AGENT_SHARE_PREVIEW_VERSION);
  const image = isBrandFrancisPreview
    ? absolutePublicUrl('/assets/marketing/francis-isabirye-agent-share-v4.png')
    : isPremiumFrancisPreview
      ? absolutePublicUrl('/assets/marketing/francis-isabirye-agent-share-v3.png')
      : isApprovedFrancisShare
        ? absolutePublicUrl('/assets/marketing/francis-isabirye-agent-share-v2.png')
        : absolutePublicUrl(row.profile_photo_url || '/assets/house-ads-v3/agents.webp');
  const title = isBrandFrancisPreview
    ? `${name} | Uganda property agent on MakaUG`
    : isPremiumFrancisPreview
      ? `${name} | Approved property agent on MakaUG`
      : `${name} | Property agent on MakaUG`;
  const shareDescription = isBrandFrancisPreview
    ? `Explore ${name}'s property profile and listings on makaug.com.`
    : isPremiumFrancisPreview
      ? `View ${name}'s live property profile and current listings on makaug.com.`
      : description;
  return {
    title,
    description: shareDescription,
    image,
    canonical: absolutePublicUrl(profilePath),
    ogType: 'profile',
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'RealEstateAgent',
      name,
      description: String(row.bio || shareDescription).trim(),
      url: absolutePublicUrl(profilePath),
      image,
      areaServed: 'Uganda'
    }
  };
}

app.get([
  '/student-accommodation/university/:universitySlug',
  '/hostels/:universitySlug',
  '/commercial/:transactionSlug/:locationSlug',
  '/for-sale/:locationSlug/:facetSlug',
  '/to-rent/:locationSlug/:facetSlug',
  '/land/:locationSlug/:facetSlug',
  '/commercial/:locationSlug/:facetSlug'
], async (req, res, next) => {
  try {
    res.set('X-makaug-Public-Sanitized', '1');
    const landing = resolvePublicSeoLanding(req.path);
    if (!landing) {
      res.set('X-Robots-Tag', 'noindex, noarchive');
      return res.status(404).send('Property landing page not found');
    }
    if (landing.kind === 'university-alias' || req.path !== landing.canonicalPath) {
      return res.redirect(301, landing.canonicalPath);
    }
    let snapshot = null;
    try {
      snapshot = await loadPublicSeoInventorySnapshot(db);
    } catch (error) {
      logger.warn('Facet SEO is continuing without its cached inventory snapshot', { path: req.path, message: error.message });
    }
    let listings = [];
    try {
      listings = await loadPublicSeoListings(db, {
        categoryKey: landing.categoryKey,
        location: landing.location || null,
        facet: landing.facet || null,
        facetSlug: landing.facetSlug || '',
        university: landing.university || null,
        limit: 24
      });
    } catch (error) {
      logger.warn('Facet SEO is continuing without server-rendered cards', { path: req.path, message: error.message });
    }
    const count = listings.length ? Number(listings[0].seo_total || listings.length) : 0;
    const meta = publicSeoLandingMeta(landing, snapshot, absolutePublicUrl('/'), { count });
    let html = renderPublicHtml(req.originalUrl || req.url || req.path);
    const renderedSeo = renderCategorySeoHtml(html, {
      meta,
      snapshot,
      listings,
      siblingLinks: siblingFacetLinks(snapshot, landing),
      baseUrl: absolutePublicUrl('/')
    });
    html = patchPublicPageSeoMeta(renderedSeo.html, {
      ...meta,
      structuredData: renderedSeo.structuredData
    });
    if (count < SEO_FACET_MIN_LISTINGS) {
      html = patchMetaTag(html, 'robots', 'noindex,follow');
      res.set('X-Robots-Tag', 'noindex, follow');
    }
    res.set('X-makaug-SEO-Facet', landing.kind);
    res.set('X-makaug-SEO-Listings', String(count));
    return sendTextResponse(req, res, html, { cacheControl: PUBLIC_HTML_CACHE_CONTROL });
  } catch (error) {
    return next(error);
  }
});

app.get(Object.values(CATEGORY_SEO).flatMap((config) => [config.route, `${config.route}/:locationSlug`]), async (req, res, next) => {
  try {
    res.set('X-makaug-Public-Sanitized', '1');
    let snapshot = null;
    try {
      snapshot = await loadPublicSeoInventorySnapshot(db);
    } catch (error) {
      logger.warn('Category SEO is continuing without an inventory count', { path: req.path, message: error.message });
    }
    const meta = categoryPageSeoMeta(req.path, snapshot, absolutePublicUrl('/'));
    if (req.params.locationSlug && !meta?.location) {
      res.set('X-Robots-Tag', 'noindex, noarchive');
      return res.status(404).send('Property area not found');
    }
    let html = renderPublicHtml(req.originalUrl || req.url || req.path);
    if (meta) {
      let listings = [];
      try {
        listings = await loadPublicSeoListings(db, {
          categoryKey: meta.key,
          location: meta.location,
          limit: 12
        });
      } catch (error) {
        logger.warn('Category SEO is continuing without server-rendered cards', { path: req.path, message: error.message });
      }
      const renderedSeo = renderCategorySeoHtml(html, {
        meta,
        snapshot,
        listings,
        baseUrl: absolutePublicUrl('/')
      });
      html = renderedSeo.html;
      html = patchPublicPageSeoMeta(html, {
        ...meta,
        structuredData: renderedSeo.structuredData
      });
      if (meta.location && snapshot && Number(meta.count || 0) < SEO_FACET_MIN_LISTINGS) {
        html = patchMetaTag(html, 'robots', 'noindex,follow');
        res.set('X-Robots-Tag', 'noindex, follow');
      }
      res.set('X-makaug-Category-SEO', meta.location ? 'area' : 'category');
      res.set('X-makaug-SEO-Listings', String(listings.length));
    }
    return sendTextResponse(req, res, html, { cacheControl: PUBLIC_HTML_CACHE_CONTROL });
  } catch (error) {
    return next(error);
  }
});

app.get('/assets/makaug-app.js', (req, res, next) => {
  try {
    if (ACTIVE_COUNTRY_CODE !== 'UG') {
      const adapted = readCountryAppAsset();
      return sendBufferResponse(req, res, adapted.body, {
        contentType: 'application/javascript; charset=utf-8',
        cacheControl: LONG_LIVED_STATIC_CACHE_CONTROL,
        etag: adapted.etag,
        lastModified: adapted.lastModified,
        dynamicCompression: false
      });
    }
    const asset = readCachedTextAsset(appJsPath);
    return sendBufferResponse(req, res, asset.body, {
      contentType: 'application/javascript; charset=utf-8',
      cacheControl: LONG_LIVED_STATIC_CACHE_CONTROL,
      etag: asset.etag,
      lastModified: asset.lastModified,
      compressed: asset.compressed
    });
  } catch (error) {
    return next(error);
  }
});

app.get('/property/:id', async (req, res, next) => {
  try {
    res.set('X-makaug-Public-Sanitized', '1');
    let html = renderPublicHtml(req.originalUrl || req.url || req.path);
    const [listing, detailSnapshot] = await Promise.all([
      loadPublicSeoListing(db, req.params.id),
      loadPublicSeoInventorySnapshot(db).catch((error) => {
        logger.warn('Detail SEO is continuing without popular-area footer links', { propertyId: req.params.id, message: error.message });
        return null;
      })
    ]);
    if (!listing) {
      res.set('X-Robots-Tag', 'noindex, noarchive');
      return res.status(404).send('Property not found');
    }
    const renderedSeo = renderPropertySeoHtml(html, listing, { snapshot: detailSnapshot, baseUrl: absolutePublicUrl('/') });
    html = patchListingOpenGraphMeta(renderedSeo.html, {
      ...renderedSeo.meta,
      structuredData: renderedSeo.structuredData
    });
    res.set('X-makaug-Listing-OG', '1');
    res.set('X-makaug-Listing-SSR', '1');
    return sendTextResponse(req, res, html, {
      cacheControl: PUBLIC_HTML_CACHE_CONTROL
    });
  } catch (error) {
    return next(error);
  }
});

app.get(['/', '/index.html'], async (req, res, next) => {
  try {
    res.set('X-makaug-Public-Sanitized', '1');
    let snapshot = null;
    let listings = [];
    try {
      [snapshot, listings] = await Promise.all([
        loadPublicSeoInventorySnapshot(db),
        loadPublicSeoListings(db, { limit: 6 })
      ]);
    } catch (error) {
      logger.warn('Homepage SEO is continuing with the available server-rendered data', { message: error.message });
    }
    const renderedSeo = renderHomepageSeoHtml(renderPublicHtml(req.originalUrl || req.url || req.path), {
      snapshot,
      listings,
      baseUrl: absolutePublicUrl('/')
    });
    const html = patchPublicPageSeoMeta(renderedSeo.html, {
      title: IS_SOUTH_AFRICA
        ? 'seshaikhaya.com | Property for Sale and Rent in South Africa'
        : 'makaug.com | Houses for Rent and Sale in Uganda',
      description: IS_SOUTH_AFRICA
        ? "Find reviewed homes for sale, rentals, land, commercial property and student accommodation across South Africa on seshaikhaya.com."
        : "Find houses for rent, homes for sale, land, commercial property and student accommodation across Uganda on makaug.com.",
      canonical: absolutePublicUrl('/'),
      image: absolutePublicUrl('/assets/house-ads-v3/home-hero.webp'),
      structuredData: renderedSeo.structuredData
    });
    res.set('X-makaug-Homepage-SSR', String(listings.length));
    return sendTextResponse(req, res, html, { cacheControl: PUBLIC_HTML_CACHE_CONTROL });
  } catch (error) {
    return next(error);
  }
});

app.get('/agents/:id', async (req, res, next) => {
  try {
    res.set('X-makaug-Public-Sanitized', '1');
    let html = renderPublicHtml(req.originalUrl || req.url || req.path);
    const previewVersion = String(req.query.share || '').trim();
    const isApprovedFrancisProfile = String(req.params.id || '') === FRANCIS_ISABIRYE_AGENT_ID;
    const isSupportedPreview = previewVersion === AGENT_SHARE_PREVIEW_VERSION
      || previewVersion === AGENT_SHARE_PREMIUM_PREVIEW_VERSION
      || previewVersion === AGENT_SHARE_BRAND_PREVIEW_VERSION;
    if (isSupportedPreview || isApprovedFrancisProfile) {
      const meta = await loadPublicAgentOpenGraphMeta(req.params.id, {
        previewVersion,
        approvedShare: isApprovedFrancisProfile && !isSupportedPreview
      });
      if (meta) {
        html = patchPublicPageSeoMeta(html, meta);
        res.set(
          isSupportedPreview ? 'X-makaug-Agent-OG-Preview' : 'X-makaug-Agent-OG',
          isSupportedPreview ? previewVersion : 'francis-v2'
        );
      }
    }
    return sendTextResponse(req, res, html, {
      cacheControl: previewVersion || isApprovedFrancisProfile
        ? 'public, max-age=60, s-maxage=60'
        : PUBLIC_HTML_CACHE_CONTROL
    });
  } catch (error) {
    return next(error);
  }
});

function parseCookies(header = '') {
  return String(header || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const idx = part.indexOf('=');
      if (idx === -1) return acc;
      acc[decodeURIComponent(part.slice(0, idx).trim())] = decodeURIComponent(part.slice(idx + 1).trim());
      return acc;
    }, {});
}

function authFromCookie(req) {
  const token = parseCookies(req.headers.cookie || '').makaug_auth_token;
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (_) {
    return null;
  }
}

function shouldServeAdminShellForApiKeyFallback(auth, pathname = '') {
  const path = String(pathname || '').toLowerCase();
  return Boolean(auth && (path === '/admin' || path.startsWith('/admin/') || path === '/king' || path.startsWith('/king/')));
}

function renderOffPlanProjectPage(req, res, next, countryCode = 'UG') {
  return Promise.resolve().then(async () => {
    const project = await getPublicDevelopment(db, req.params.slug, countryCode);
    if (!project) {
      res.set('X-Robots-Tag', 'noindex, noarchive');
      return res.status(404).type('text/plain').send('Off-plan project not found');
    }
    const overseas = project.country_code === 'KE';
    const countryName = overseas ? 'Kenya' : 'Uganda';
    const description = String(project.description || `Explore ${project.name}, an off-plan development in ${[project.area, project.district, countryName].filter(Boolean).join(', ')}.`).replace(/\s+/g, ' ').trim().slice(0, 240);
    const canonicalPath = overseas
      ? `/off-plan/overseas/kenya/${encodeURIComponent(project.slug)}`
      : `/off-plan/${encodeURIComponent(project.slug)}`;
    const canonical = absolutePublicUrl(canonicalPath);
    const image = absolutePublicUrl(project.images?.[0]?.url || '/assets/icons/makaug-icon-512.png');
    const html = patchPublicPageSeoMeta(renderPublicHtml(req.originalUrl || req.url || req.path), {
      title: `${project.name} | Off Plan ${countryName} | makaug.com`,
      description,
      canonical,
      image,
      ogType: 'website',
      structuredData: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: project.name,
        description,
        image: (project.images || []).map((item) => absolutePublicUrl(item.url)).filter(Boolean),
        url: canonical,
        category: 'Off-plan property development',
        areaServed: [project.area, project.district, countryName].filter(Boolean).join(', ')
      }
    });
    res.set('X-makaug-Off-Plan-SSR', overseas ? 'overseas-ke' : '1');
    res.set('X-makaug-Public-Sanitized', '1');
    return sendTextResponse(req, res, html, { cacheControl: PUBLIC_HTML_CACHE_CONTROL });
  }).catch((error) => {
    if (error.code === '42P01') return sendPublicIndex(req, res, next);
    return next(error);
  });
}

function renderVirtualHomeProjectPage(req, res, next) {
  return Promise.resolve().then(async () => {
    const project = virtualHomeDemoEnabled() && req.params.slug === virtualHomeDemoProject.public_slug
      ? virtualHomeDemoProject
      : await getPublicVirtualHome(db, req.params.slug);
    if (!project) {
      res.set('X-Robots-Tag', 'noindex, noarchive');
      return res.status(404).type('text/plain').send('Virtual Home not found');
    }
    const description = String(project.accuracy_disclosure || `Explore the interactive 3D Virtual Home for ${project.name}.`).replace(/\s+/g, ' ').trim().slice(0, 240);
    const canonical = absolutePublicUrl(`/virtual-homes/${encodeURIComponent(project.public_slug)}`);
    const html = patchPublicPageSeoMeta(renderPublicHtml(req.originalUrl || req.url || req.path), {
      title: `${project.name} Virtual Home | makaug.com`,
      description,
      canonical,
      image: absolutePublicUrl('/assets/icons/makaug-icon-512.png'),
      structuredData: {
        '@context': 'https://schema.org',
        '@type': '3DModel',
        name: project.name,
        description,
        encodingFormat: 'model/gltf-binary',
        url: canonical
      }
    });
    res.set('X-makaug-Virtual-Home-SSR', '1');
    res.set('X-makaug-Public-Sanitized', '1');
    return sendTextResponse(req, res, html, { cacheControl: PUBLIC_HTML_CACHE_CONTROL });
  }).catch((error) => {
    if (error.code === '42P01') return sendPublicIndex(req, res, next);
    return next(error);
  });
}

app.get('/off-plan/overseas/kenya/:slug', (req, res, next) => renderOffPlanProjectPage(req, res, next, 'KE'));

app.get('/off-plan/overseas', sendPublicIndex);

app.get('/off-plan/:slug', (req, res, next) => renderOffPlanProjectPage(req, res, next, 'UG'));
app.get('/virtual-homes/:slug', renderVirtualHomeProjectPage);

function sendPublicIndex(req, res, next) {
  if (req.path.startsWith('/api/')) return next();
  if (ACTIVE_TENANT.publicFeatures?.marketplace === false && /^\/marketplace(?:\/|$)/i.test(req.path)) {
    return res.status(404).type('text/plain').send('Not found');
  }
  if (ACTIVE_TENANT.publicFeatures?.valuation === false && /^\/valuation(?:\/|$)/i.test(req.path)) {
    return res.status(404).type('text/plain').send('Not found');
  }
  if (isProtectedPath(req.path)) {
    const auth = authFromCookie(req);
    res.set('X-Robots-Tag', 'noindex, noarchive');
    res.set('X-makaug-Protected-Route', '1');
    if (!auth) {
      return res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl || req.path)}`);
    }
    if (!roleCanAccessProtectedPath(auth, req.path)) {
      if (shouldServeAdminShellForApiKeyFallback(auth, req.path)) {
        try {
          const html = readIndexHtml();
          res.set('Cache-Control', 'no-store');
          res.set('X-makaug-Admin-Api-Key-Fallback', '1');
          return sendTextResponse(req, res, html, {
            cacheControl: 'no-store'
          });
        } catch (error) {
          return next(error);
        }
      }
      return res.status(403).send(renderProtectedLoginShell('/login?access=denied', {
        title: 'Access denied',
        message: 'This makaug area belongs to a different account type. Sign in with the right account to continue.'
      }));
    }
    try {
      const html = readIndexHtml();
      res.set('Cache-Control', 'no-store');
      return sendTextResponse(req, res, html, {
        cacheControl: 'no-store'
      });
    } catch (error) {
      return next(error);
    }
  }
  try {
    res.set('X-makaug-Public-Sanitized', '1');
    let html = renderPublicHtml(req.originalUrl || req.url || req.path);
    if (/^\/off-plan\/overseas\/kenya\/?$/i.test(req.path)) {
      html = patchPublicPageSeoMeta(html, {
        title: 'Off Plan Property in Kenya | MakaUG Overseas',
        description: 'Explore Kenya off-plan property with MakaUG-managed document review, legal coordination, payment guidance and currency information.',
        canonical: absolutePublicUrl('/off-plan/overseas/kenya'),
        image: absolutePublicUrl('/assets/off-plan/spectre-westlands/nairobi-skyline.jpg'),
        structuredData: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Off Plan Property in Kenya', url: absolutePublicUrl('/off-plan/overseas/kenya') }
      });
    } else if (/^\/off-plan\/overseas\/?$/i.test(req.path)) {
      html = patchPublicPageSeoMeta(html, {
        title: 'Overseas Off Plan Property | MakaUG',
        description: 'Browse overseas off-plan opportunities by region and country, beginning with verified-source projects in Africa.',
        canonical: absolutePublicUrl('/off-plan/overseas'),
        image: absolutePublicUrl('/assets/off-plan/spectre-westlands/nairobi-skyline.jpg'),
        structuredData: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Overseas Off Plan Property', url: absolutePublicUrl('/off-plan/overseas') }
      });
    } else if (/^\/off-plan\/?$/i.test(req.path)) {
      html = patchPublicPageSeoMeta(html, {
        title: 'Off Plan Property and New Developments in Uganda | makaug.com',
        description: 'Explore off-plan projects and new developments in Uganda with attributed pricing, progress, payment plans, maps and downloadable brochures.',
        canonical: absolutePublicUrl('/off-plan'),
        image: absolutePublicUrl('/assets/off-plan/entebbe-victoria-palms/residents-lounge-render.jpg'),
        structuredData: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Off Plan Property in Uganda', url: absolutePublicUrl('/off-plan') }
      });
    } else if (/^\/services\/virtual-homes\/?$/i.test(req.path)) {
      html = patchPublicPageSeoMeta(html, {
        title: 'AI Virtual Viewing and 3D Walkthroughs | Maka Virtual Homes',
        description: 'Turn a floor plan into a staff-reviewed, interactive 3D Virtual Home with furnished, unfurnished, day and night viewing modes.',
        canonical: absolutePublicUrl('/services/virtual-homes'),
        image: absolutePublicUrl('/assets/icons/makaug-icon-512.png'),
        structuredData: { '@context': 'https://schema.org', '@type': 'Service', name: 'Maka Virtual Homes', provider: { '@type': 'Organization', name: 'makaug.com' }, areaServed: 'Uganda' }
      });
    } else if (/^\/services\/?$/i.test(req.path)) {
      html = patchPublicPageSeoMeta(html, {
        title: 'Property Services | makaug.com',
        description: 'Explore MakaUG property services, including AI Virtual Viewing and 3D property walkthrough production.',
        canonical: absolutePublicUrl('/services'),
        image: absolutePublicUrl('/assets/icons/makaug-icon-512.png'),
        structuredData: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'MakaUG Property Services', url: absolutePublicUrl('/services') }
      });
    }
    return sendTextResponse(req, res, html, {
      cacheControl: PUBLIC_HTML_CACHE_CONTROL
    });
  } catch (error) {
    return next(error);
  }
}

function shouldServeIndex(req) {
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  if (req.path.startsWith('/api/') || req.path === '/config.js' || req.path.startsWith('/private-local')) return false;
  if (req.path === '/' || req.path === '/index.html') return true;
  return !path.extname(req.path);
}

app.use((req, res, next) => {
  if (!shouldServeIndex(req)) return next();
  return sendPublicIndex(req, res, next);
});

app.get('/assets/makaug-app.js', (req, res, next) => {
  const appAssetPath = path.join(staticRoot, 'assets', 'makaug-app.js');
  fs.readFile(appAssetPath, 'utf8', (error, source) => {
    if (error) return next(error);
    const alreadyPatched = source.includes('admin-social-capture-bookmarklet-url')
      && source.includes('Simplest no-bookmark option');
    res.type('application/javascript');
    res.set('Cache-Control', 'no-store');
    return res.send(alreadyPatched ? source : `${source}\n${captureHelperUsabilityScriptPatch}`);
  });
});

// Three.js is MIT licensed. Serve only the required browser build rather than
// exposing node_modules as a public directory.
app.get('/assets/vendor/three.module.min.js', (_req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'public, max-age=604800, immutable');
  res.set('X-Vendor-License', 'MIT');
  return res.sendFile(path.join(staticRoot, 'node_modules', 'three', 'build', 'three.module.min.js'));
});

app.use(express.static(staticRoot, {
  index: false,
  maxAge: '7d',
  setHeaders(res, filePath) {
    if (/\.(html?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store');
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  }
}));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return sendPublicIndex(req, res, next);
});

app.use(notFound);
app.use(errorHandler);

const port = parseInt(process.env.PORT || '8080', 10);
const listenHost = process.env.RENDER_INTERNAL_APP === 'true' ? '127.0.0.1' : '0.0.0.0';

async function start() {
  const httpServer = http.createServer(app);
  httpServer.keepAliveTimeout = 120_000;
  httpServer.headersTimeout = 121_000;
  httpServer.on('error', (error) => {
    logger.error('HTTP server failed', {
      code: error?.code,
      message: error?.message,
      port
    });
  });
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, listenHost, () => {
      httpServer.removeListener('error', reject);
      resolve();
    });
  });
  const address = httpServer.address();
  logger.info(`${ACTIVE_TENANT.brandName} liveness endpoint accepting traffic`, {
    host: typeof address === 'object' && address ? address.address : listenHost,
    port: typeof address === 'object' && address ? address.port : port,
    family: typeof address === 'object' && address ? address.family : null
  });

  if (process.env.DATABASE_URL && process.env.RUN_MIGRATIONS_ON_START !== 'false') {
    await runMigrations();
  } else if (!process.env.DATABASE_URL) {
    logger.warn('Skipping startup migrations because DATABASE_URL is not set');
  }
  if (process.env.DATABASE_URL && typeof db.warmPool === 'function') {
    try {
      const warmResult = await db.warmPool();
      logger.info('Database pool warmed before accepting traffic', warmResult);
    } catch (error) {
      logger.warn('Database pool warmup failed; continuing startup', {
        code: error?.code,
        message: error?.message
      });
    }
  }
  if (process.env.DATABASE_URL) {
    try {
      const publicInventory = await loadPublicOpportunitySummary({ timeoutMs: 5000 });
      logger.info('Public inventory summary warmed before accepting traffic', {
        total: publicInventory?.summary?.total ?? null,
        cache: publicInventory?.meta?.cache || null
      });
    } catch (error) {
      logger.warn('Public inventory summary warmup failed; list routes will use bounded fallback', {
        code: error?.code,
        message: error?.message
      });
    }
  }
  if (process.env.DATABASE_URL) {
    try {
      const [seoSnapshot, homepageListings] = await Promise.all([
        loadPublicSeoInventorySnapshot(db),
        loadPublicSeoListings(db, { limit: 6 })
      ]);
      logger.info('Public homepage SEO cache warmed before accepting traffic', {
        listings: homepageListings.length,
        generated_at: seoSnapshot?.generatedAt || null,
        html_cache_max_entries: PUBLIC_HTML_CACHE_MAX_ENTRIES,
        marker: 'makaug-always-on-whatsapp-runtime-20260814'
      });
    } catch (error) {
      logger.warn('Public homepage SEO warmup failed; the first live request will use the bounded fallback', {
        code: error?.code,
        message: error?.message
      });
    }
  }
  try {
    const adaptedApp = readCountryAppAsset();
    renderPublicHtml('/');
    logger.info('Country public assets verified before accepting traffic', {
      country_code: ACTIVE_COUNTRY_CODE,
      app_bytes: adaptedApp.body.length
    });
  } catch (error) {
    logger.error('Country public asset verification failed; refusing unready deployment', {
      country_code: ACTIVE_COUNTRY_CODE,
      message: error.message
    });
    throw error;
  }
  if (harvestAutomationEnabled()) {
    startXSourceDripScheduler(db);
    startYouTubeSourceDripScheduler(db);
  } else {
    logger.info('Harvest automation schedulers disabled by rollout flag');
  }
  if (ACTIVE_TENANT.publicFeatures?.marketplace !== false) {
    startMarketplaceLifecycleScheduler(db);
    startMarketplaceDripScheduler(db);
  }
  if (!IS_SOUTH_AFRICA || process.env.FEATURED_ROTATION_SCHEDULER_ENABLED === 'true') {
    startFeaturedRotationScheduler(db);
  } else {
    logger.info('Featured rotation scheduler disabled for South Africa staging');
  }
  runtimeReady = true;
  logger.info(`${ACTIVE_TENANT.brandName} backend ready for traffic`);
  if (typeof process.send === 'function' && process.connected) {
    const sendRenderHeartbeat = () => {
      if (process.connected) process.send({ type: 'runtime_heartbeat' });
    };
    process.send({ type: 'runtime_ready' });
    const renderHeartbeatTimer = setInterval(sendRenderHeartbeat, 1000);
    renderHeartbeatTimer.unref?.();
  }
  schedulePublicCacheWarmup(`http://127.0.0.1:${port}`);
}

start().catch((error) => {
  logger.error('Startup failed', error);
  process.exit(1);
});
