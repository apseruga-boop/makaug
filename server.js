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
const PRICING = require('./config/pricing');
const liveDistricts = require('./services/liveDistrictsService');
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
const shortTermRoutes = require('./routes/short-term');
const {
  adminRouter: offPlanAdminRoutes,
  publicRouter: offPlanRoutes,
  staffRouter: offPlanStaffRoutes
} = require('./routes/off-plan');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { runMigrations } = require('./scripts/migrate');
const {
  isKnownPublicRoute,
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
const { startLeadDeskScheduler } = require('./services/leadDeskService');
const { startVideoStillScheduler } = require('./services/videoStillScheduler');
const { startGreetingNameCache } = require('./services/agentNameService');
const { startBillingScheduler, logPricingDriftOnce } = require('./services/billingOpsService');
const { getPublicDevelopment, getPublicMarket, isPubliclyVisible, normalizeDevelopmentRow } = require('./services/offPlanService');
const {
  applyHarvestPublicSubmissionVisibility,
  harvestAutomationEnabled
} = require('./utils/harvestFeatureFlags');
const {
  applyShortTermVisibility,
  injectShortTermRuntimeConfig,
  shortTermEnabled
} = require('./utils/shortTermFeatureFlags');
const {
  getShortTermListing,
  listShortTermSitemapEntries,
  searchShortTermListings
} = require('./services/shortTermService');
const {
  renderShortTermSeoHtml,
  vacationRentalStructuredData
} = require('./services/shortTermSeoRenderService');
const { DISTRICTS: MARKETPLACE_DISTRICTS, MARKETPLACE_CATEGORIES } = require('./services/marketplaceService');
const { loadPublicOpportunitySummary } = require('./services/publicInventoryMetricsService');
const { injectAboutCommercialProducts } = require('./services/aboutCommercialProductsService');
const { buildAboutCommercialRateCardPdf } = require('./services/aboutCommercialRateCardPdfService');
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
  publicPageSeoFor,
  slugifySeoPart,
  canonicalLocationRouteSlug,
  sitemapEntries
} = require('./services/publicSeoService');
const { canonicalLocationOptions } = require('./utils/locationRegistry');
const { clientIpMiddleware, rateLimitClientKey } = require('./utils/clientIp');
const { buildLandingCopy } = require('./services/publicLandingCopy');
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
      // A rejected origin is a 403, not a 500 (a plain Error reached errorHandler as 500).
      const corsError = new Error('CORS origin not allowed');
      corsError.status = 403;
      corsError.code = 'cors_origin_not_allowed';
      return callback(corsError);
    },
    credentials: true
  })
);

app.use(express.urlencoded({ extended: true, limit: '15mb' }));
// JSON bodies: 1 MB by default. Only the routes that accept photos, ID
// documents or receipts as data URLs get the large limit, so a stray 40 MB
// body can't land on any other endpoint (the server has 512 MB in total).
const keepRawBody = (req, _res, buffer) => {
  if (req.originalUrl === '/api/whatsapp/webhook' || req.originalUrl === '/api/pay/webhooks/revolut') {
    req.rawBody = Buffer.from(buffer);
  }
};
const LARGE_JSON_BODY_PREFIXES = [
  '/api/properties', '/api/admin', '/api/staff', '/api/agents', '/api/auth', '/api/field-agent',
  '/api/whatsapp', '/api/short-term', '/api/off-plan', '/api/tiktok-display', '/api/harvest',
  '/api/marketplace', '/api/advertising'
];
const largeJsonParser = express.json({ limit: '40mb', verify: keepRawBody });
const smallJsonParser = express.json({ limit: process.env.DEFAULT_JSON_BODY_LIMIT || '1mb', verify: keepRawBody });
function needsLargeJsonBody(pathname = '') {
  return LARGE_JSON_BODY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
app.use((req, res, next) => (needsLargeJsonBody(req.path) ? largeJsonParser : smallJsonParser)(req, res, next));

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

// Real visitor IP (CF-Connecting-IP, trusted only from a Cloudflare hop).
app.use(clientIpMiddleware);

// Non-makaug hosts (makaug.onrender.com, old domains) 301 to the canonical
// host for GET/HEAD. Non-GET /api calls are only logged: webhooks don't follow
// redirects. /healthz above stays reachable on any host. render-start.js
// forwards the original Host as X-Forwarded-Host (it rewrites Host itself).
const CANONICAL_PUBLIC_HOST = (() => {
  try { return new URL(ACTIVE_TENANT.domain).hostname.toLowerCase(); } catch (_) { return 'makaug.com'; }
})();
const ALLOWED_REQUEST_HOSTS = new Set([
  CANONICAL_PUBLIC_HOST,
  `www.${CANONICAL_PUBLIC_HOST}`,
  'localhost',
  '127.0.0.1',
  '::1',
  ...String(process.env.ALLOWED_HOSTS || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean)
]);
function requestHostname(req) {
  const raw = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim().toLowerCase();
  if (raw.startsWith('[')) return raw.slice(1, raw.indexOf(']'));
  return raw.replace(/:\d+$/, '');
}
function isAllowedRequestHost(hostname = '') {
  return !hostname || ALLOWED_REQUEST_HOSTS.has(hostname) || hostname.endsWith('.localhost');
}
const HOST_REDIRECT_EXEMPT_PATHS = new Set(['/api/health', '/api/version']);
// Machine callers (the WAHA bridge polls with GET; Meta verifies its webhook
// with a GET challenge) must keep working on whatever host they were given,
// without a redirect that would route them through Cloudflare.
const HOST_REDIRECT_EXEMPT_PREFIXES = [
  '/api/whatsapp/webhook', '/api/whatsapp/web-bridge/', '/api/pay/webhooks/', '/api/money-sms/',
  '/api/advertising/payment-webhook', '/api/monetization/payments/webhook', '/api/ai-ceo/'
];
function isHostRedirectExempt(pathname = '') {
  return HOST_REDIRECT_EXEMPT_PATHS.has(pathname) || HOST_REDIRECT_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
app.use((req, res, next) => {
  const hostname = requestHostname(req);
  if (isAllowedRequestHost(hostname) || isHostRedirectExempt(req.path)) return next();
  if (['GET', 'HEAD'].includes(req.method)) {
    return res.redirect(301, `https://${CANONICAL_PUBLIC_HOST}${req.originalUrl || '/'}`);
  }
  if (req.path.startsWith('/api/')) {
    logger.warn('Non-GET API call on a non-canonical host (not redirected)', { host: hostname, method: req.method, path: req.path });
  }
  return next();
});

app.use((_req, res, next) => {
  if (runtimeReady) return next();
  res.set('Cache-Control', 'no-store');
  res.set('Retry-After', '2');
  return res.status(503).json({
    ok: false,
    error: 'service_starting',
    country_code: ACTIVE_COUNTRY_CODE
  });
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  keyGenerator: rateLimitClientKey,
  skip: (req) => req.path === '/analytics/config',
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api', apiLimiter);

// API responses are not cacheable by default. Routes that deliberately allow
// public caching (anonymous inventory, off-plan, short-term…) still can, but
// never for a request that carries auth: that becomes private, no-store.
function requestCarriesAuth(req) {
  if (req.get('authorization') || req.get('x-api-key') || req.get('x-admin-api-key')) return true;
  return /(?:^|;\s*)makaug_auth_token=/.test(String(req.get('cookie') || ''));
}
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (requestCarriesAuth(req)) {
    const writeHead = res.writeHead;
    res.writeHead = function writeHeadPrivate(...args) {
      if (!/^private, no-store$/.test(String(res.getHeader('Cache-Control') || ''))) {
        const current = String(res.getHeader('Cache-Control') || '');
        if (/public|max-age=[1-9]|s-maxage/.test(current) || !current) res.setHeader('Cache-Control', 'private, no-store');
      }
      res.removeHeader('CDN-Cache-Control');
      res.removeHeader('Cloudflare-CDN-Cache-Control');
      return writeHead.apply(this, args);
    };
  }
  next();
});

// The public rate card (config/pricing.js): sellable lines, VAT and display.
app.get('/api/pricing', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  return res.json({ ok: true, data: PRICING.publicPriceList() });
});

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
      'staff-photo-removal-human-media-override-20260913',
      'king-timestamp-iso-normalization-20260811',
      ...(!IS_SOUTH_AFRICA ? ['makaug-homepage-seo-stale-while-revalidate-20260824'] : []),
      ...(!IS_SOUTH_AFRICA ? ['makaug-always-on-whatsapp-runtime-20260814'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-natural-ownership-replies-20260824'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-public-agent-parity-fast-replies-20260824'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-employee-agent-007-review-intake-20260829'] : []),
      ...(!IS_SOUTH_AFRICA ? ['off-plan-projectfinder-layout-v3-20260904'] : []),
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
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-original-media-only-20260908'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-video-original-recovery-20260831'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-outgoing-preview-guard-20260831'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent007-replay-backoff-20260901'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent007-pending-media-idempotency-20260901'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent007-identity-media-firewall-20260909'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent007-album-original-capture-20260909'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent007-existing-row-media-repair-20260909'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent007-full-album-gallery-recovery-20260909'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent007-viewer-group-recovery-20260909'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent007-staff-media-proof-20260909'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent007-mixed-media-album-recovery-20260909'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent007-media-status-proof-20260909'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent007-identity-evidence-purge-20260909'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent007-forced-media-reconciliation-20260909'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent007-completion-ack-contract-20260909'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent007-property-boundary-guard-20260909'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent007-pending-property-queue-20260909'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent007-pending-agent-link-repair-20260909'] : []),
      ...(!IS_SOUTH_AFRICA ? ['whatsapp-agent007-history-latest-normalization-20260909'] : []),
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
app.use('/api/agents', agentsRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/advertising', advertisingRoutes);
app.use('/api/monetization', monetizationRoutes);
if (ACTIVE_TENANT.publicFeatures?.marketplace !== false) app.use('/api/marketplace', marketplaceRoutes);
if (ACTIVE_TENANT.publicFeatures?.valuation !== false) app.use('/api/valuation', valuationRoutes);
app.use('/api/tiktok-display', tiktokDisplayRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/saved-properties', savedPropertiesRoutes);
app.use('/api/money-sms', require('./routes/moneySms'));
app.use('/api/pay', require('./routes/pay').api);
app.use('/legal', require('./routes/legalDocs'));
app.use('/api/admin', adminRoutes);
app.use('/api/admin/off-plan', offPlanAdminRoutes);
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
app.use('/api/harvest', harvestRoutes);
app.use('/api/short-term', shortTermRoutes);

// 410 Gone: it listed ~2,900 "?category=&district=" URLs that all
// canonicalised to /marketplace (8 Oct 2026). One sitemap.xml remains.
app.get('/marketplace-sitemap.xml', (_req, res) => {
  res.set('X-Robots-Tag', 'noindex');
  return res.status(410).type('text/plain').set('Cache-Control', 'public, max-age=3600').send('Gone');
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
    try {
      const offPlan = await db.query("SELECT * FROM off_plan_developments WHERE country_code ~ '^[A-Z]{2}$' AND status = 'published' AND (verification_status = 'verified' OR (verification_status = 'partially_verified' AND extra_fields->>'public_preview_approved' = 'true')) ORDER BY updated_at DESC LIMIT 500");
      const marketPaths = new Set();
      offPlan.rows.map(normalizeDevelopmentRow).filter(isPubliclyVisible).forEach((project) => {
        const countrySlug = String(project.extra_fields?.country_slug || project.extra_fields?.country_name || project.country_code).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const projectPath = project.country_code === 'UG' ? `/off-plan/${encodeURIComponent(project.slug)}` : `/off-plan/overseas/${encodeURIComponent(countrySlug)}/${encodeURIComponent(project.slug)}`;
        if (project.country_code !== 'UG' && !marketPaths.has(countrySlug)) {
          marketPaths.add(countrySlug);
          urls.push({ loc: `${baseUrl}/off-plan/overseas/${encodeURIComponent(countrySlug)}`, changefreq: 'weekly', priority: '0.7' });
        }
        urls.push({ loc: `${baseUrl}${projectPath}`, lastmod: project.updated_at ? new Date(project.updated_at).toISOString() : null, changefreq: 'weekly', priority: '0.7' });
      });
    } catch (error) {
      logger.warn('Off-plan sitemap entries are unavailable until the feature migration is applied', { message: error.message });
    }

    // Short Term stays. Every listing page carries VacationRental structured
    // data, and Google distributes vacation rentals from that markup for
    // free - but only for pages it knows about. Without these entries the
    // structured data sits on pages no crawler has been told exist.
    if (shortTermEnabled()) {
      urls.push({ loc: `${baseUrl}/short-term`, changefreq: 'daily', priority: '0.8' });
      urls.push({ loc: `${baseUrl}/short-term/list-your-place`, changefreq: 'weekly', priority: '0.6' });
      try {
        const shortTermEntries = await listShortTermSitemapEntries(db);
        shortTermEntries.forEach((entry) => {
          urls.push({
            loc: `${baseUrl}${entry.path}`,
            lastmod: entry.lastmod,
            changefreq: 'daily',
            priority: '0.7'
          });
        });
      } catch (error) {
        logger.warn('Short term sitemap entries are unavailable; the rest of the sitemap is unaffected', {
          message: error.message
        });
      }
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
const mortgageSourceRefreshVersion = 'mortgage-source-refresh-20260908';
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
const brokerSignupNoContactOtpVersion = 'broker-signup-no-contact-otp-20260910';
const publicAppVersionSuffixes = [
  brokerSignupNoContactOtpVersion,
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
  mortgageSourceRefreshVersion,
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
// Cloudflare caches on these headers, so "immutable" is only promised when the
// URL changes with the content: a ?v= query or a content hash in the file name.
// Everything else may change in place and gets one hour.
const VERSIONED_STATIC_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const UNVERSIONED_STATIC_CACHE_CONTROL = 'public, max-age=3600';
const CONTENT_HASH_FILENAME_PATTERN = /[.-][a-f0-9]{8,}\.[a-z0-9]+$/i;
function isVersionedStaticUrl(url = '') {
  const raw = String(url || '');
  const [pathname, query = ''] = raw.split('?');
  if (/(?:^|&)v=[^&]+/.test(query)) return true;
  return CONTENT_HASH_FILENAME_PATTERN.test(pathname || '');
}
function staticCacheControlForUrl(url = '') {
  return isVersionedStaticUrl(url) ? VERSIONED_STATIC_CACHE_CONTROL : UNVERSIONED_STATIC_CACHE_CONTROL;
}

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

// Page tokens filled at send time (after the shared-core component check and
// the page cache): rate-card prices and the live district count.
function applyLivePageTokens(html) {
  const text = String(html || '');
  if (!text.includes('{{')) return text;
  const districts = liveDistricts.liveDistrictCount(db);
  return text
    .replace(/\{\{PRICE:([a-z_]+)\}\}/g, (match, key) => (PRICING.SELLABLE_KEYS.includes(key) ? PRICING.ugx(PRICING[key].amount_ugx) : match))
    .replaceAll('{{FOOTER_COVERAGE}}', liveDistricts.footerCoverageSentence(districts))
    .replaceAll('{{LIVE_DISTRICTS_COUNT}}', districts ? String(districts) : '—')
    .replaceAll('{{LIVE_DISTRICTS_JSON}}', JSON.stringify(districts || null));
}

function sendTextResponse(req, res, html, options = {}) {
  html = applyLivePageTokens(html);
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

// tailwind.css is served with a 1-year immutable cache, so its URL must change
// whenever its content does, or browsers keep an old copy that lacks new classes.
let tailwindCssVersion = '';
function tailwindCssCacheKey() {
  if (tailwindCssVersion) return tailwindCssVersion;
  try {
    const body = require('fs').readFileSync(require('path').join(__dirname, 'assets', 'tailwind.css'));
    tailwindCssVersion = require('crypto').createHash('sha1').update(body).digest('hex').slice(0, 12);
  } catch (_error) {
    tailwindCssVersion = String(runtimeBundleVersion()).slice(0, 12) || 'v1';
  }
  return tailwindCssVersion;
}

// Local scripts and stylesheets referenced from index.html are cached for a
// year once they carry ?v=, so the version is the file's own content hash:
// a hand-written ?v= label that nobody bumps can never pin a stale file.
// makaug-app.js keeps its runtime bundle version (set elsewhere).
const localAssetHashCache = new Map();
function localAssetContentHash(urlPath = '') {
  if (localAssetHashCache.has(urlPath)) return localAssetHashCache.get(urlPath);
  let hash = '';
  try {
    const relative = String(urlPath).replace(/^\/+/, '');
    if (!/^(assets|config)\//.test(relative) || relative.includes('..')) return '';
    const body = fs.readFileSync(path.join(staticRoot, relative));
    hash = require('crypto').createHash('sha1').update(body).digest('hex').slice(0, 12);
  } catch (_error) {
    hash = '';
  }
  localAssetHashCache.set(urlPath, hash);
  return hash;
}
function versionLocalAssetUrls(html) {
  return String(html || '').replace(
    /(")(\/(?:assets|config)\/[^"?#\s]+\.(?:js|css))(?:\?v=[^"#\s]*)?(")/g,
    (match, before, urlPath, after) => {
      if (/\/assets\/makaug-(app|admin)\.js$/.test(urlPath)) return match;
      const hash = localAssetContentHash(urlPath);
      return hash ? `${before}${urlPath}?v=${hash}${after}` : match;
    }
  );
}

function injectRuntimeBundleVersion(html) {
  if (!html) return html;
  const version = JSON.stringify(runtimeBundleVersion());
  html = html.replace('href="/assets/tailwind.css"', `href="/assets/tailwind.css?v=${tailwindCssCacheKey()}"`);
  html = versionLocalAssetUrls(html);
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


// The rate card is inlined into every page shell, so the SPA reads
// window.__MAKAUG_PRICING__ synchronously and never hard-codes a fee.
function inlinePricingScript(html) {
  const tag = '<script src="/config/pricing.js"></script>';
  if (!String(html || '').includes(tag)) return html;
  const source = fs.readFileSync(path.join(__dirname, 'config', 'pricing.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  return html.replace(tag, () => `<script data-makaug-pricing="${PRICING.version}">\n${source}\n</script>`);
}

function readIndexHtml() {
  if (isProduction && cachedIndexHtml) return cachedIndexHtml;
  const patchedHtml = inlinePricingScript(applyCaptureHelperUsabilityIndexPatch(fs.readFileSync(indexPath, 'utf8')));
  const html = injectAboutCommercialProducts(injectRuntimeMetaPixelId(injectRuntimeBundleVersion(patchedHtml)));
  if (isProduction) cachedIndexHtml = html;
  return html;
}

// The hero photo is only above the fold on the homepage; preloading it with
// fetchpriority=high on every other page competed with that page's own LCP.
function applyHomeHeroPreload(html, normalizedPath = '/') {
  if (normalizedPath === '/' || normalizedPath === '/index.html') return html;
  return String(html || '').replace(/\s*<link rel="preload" as="image"[^>]*data-home-hero-preload[^>]*>/, '');
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
  rendered = injectShortTermRuntimeConfig(applyShortTermVisibility(rendered));
  rendered = applyHomeHeroPreload(rendered, normalizedBasePath);
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

function uniqueLocationForBareSlug(slug = '') {
  const normalized = slugifySeoPart(slug);
  if (!normalized) return null;
  const matches = canonicalLocationOptions().filter((location) => (
    slugifySeoPart(location.location) === normalized
    || (location.level === 'district' && slugifySeoPart(location.district) === normalized)
  ));
  const district = matches.find((location) => location.level === 'district');
  if (district) return district;
  return matches.length === 1 ? matches[0] : null;
}

app.get(Object.values(CATEGORY_SEO).flatMap((config) => [config.route, `${config.route}/:locationSlug`]), async (req, res, next) => {
  try {
    res.set('X-makaug-Public-Sanitized', '1');
    let snapshot = null;
    try {
      snapshot = await loadPublicSeoInventorySnapshot(db);
    } catch (error) {
      logger.warn('Category SEO is continuing without an inventory count', { path: req.path, message: error.message });
    }
    let meta = categoryPageSeoMeta(req.path, snapshot, absolutePublicUrl('/'));
    if (req.params.locationSlug && !meta?.location) {
      // /to-rent/kampala → 301 /to-rent/kampala-kampala when the bare slug is a
      // district or exactly one place; otherwise a real 404.
      const redirectLocation = uniqueLocationForBareSlug(req.params.locationSlug);
      if (redirectLocation && meta?.config?.route) {
        const query = String(req.originalUrl || '').includes('?') ? String(req.originalUrl).slice(String(req.originalUrl).indexOf('?')) : '';
        return res.redirect(301, `${meta.config.route}/${canonicalLocationRouteSlug(redirectLocation)}${query}`);
      }
      res.set('X-Robots-Tag', 'noindex, noarchive');
      return res.status(404).send('Property area not found');
    }
    let html = renderPublicHtml(req.originalUrl || req.url || req.path);
    if (meta) {
      // Marketing's landing copy for /for-sale, /land and /to-rent/kampala-kampala.
      const landing = buildLandingCopy(meta.key, meta.location, snapshot, { page: req.query.page });
      if (landing) {
        meta = {
          ...meta,
          title: landing.title || meta.title,
          description: landing.description || meta.description,
          h1: landing.h1,
          landingIntroHtml: landing.introHtml,
          landingBodyHtml: landing.bodyHtml,
          landingFaq: landing.faqStructuredData
        };
      }
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

// makaug-app.js is served from the minified public bundle that
// `npm run build:js` commits under assets/build/, and the staff/admin code from
// makaug-admin.js (loaded only by the protected shell). If the bundles were
// built from an older makaug-app.js (someone edited the source without
// rebuilding), the full source is served and the admin URL is an empty
// script: slower, never broken. The ZA tenant always gets the adapted source.
const builtPublicAppPath = path.join(staticRoot, 'assets', 'build', 'makaug-app.min.js');
const builtAdminAppPath = path.join(staticRoot, 'assets', 'build', 'makaug-admin.min.js');
let appBundleState = null;
function builtBundleSourceHash(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(300);
    const bytes = fs.readSync(fd, head, 0, head.length, 0);
    return (head.slice(0, bytes).toString('utf8').match(/source-sha1:([a-f0-9]+)/) || [])[1] || '';
  } catch (_error) {
    return '';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
function appBundleBuildState() {
  try {
    const stat = fs.statSync(appJsPath);
    const key = `${stat.size}:${stat.mtimeMs}`;
    if (appBundleState && appBundleState.key === key) return appBundleState;
    const sourceSha = require('crypto').createHash('sha1').update(fs.readFileSync(appJsPath)).digest('hex').slice(0, 16);
    const fresh = builtBundleSourceHash(builtPublicAppPath) === sourceSha
      && builtBundleSourceHash(builtAdminAppPath) === sourceSha;
    if (!fresh) logger.warn('assets/build bundles are stale or missing; serving the full makaug-app.js source. Run npm run build:js.');
    appBundleState = { key, fresh };
  } catch (_error) {
    appBundleState = { key: '', fresh: false };
  }
  return appBundleState;
}
function useBuiltAppBundles() {
  return ACTIVE_COUNTRY_CODE === 'UG' && appBundleBuildState().fresh;
}

app.get('/assets/makaug-admin.js', (req, res, next) => {
  try {
    if (!useBuiltAppBundles()) {
      res.set('X-makaug-App-Bundle', 'source');
      return sendBufferResponse(req, res, Buffer.from('/* makaug-app.js already includes the admin code. */\n'), {
        contentType: 'application/javascript; charset=utf-8',
        cacheControl: 'no-store',
        dynamicCompression: false
      });
    }
    const asset = readCachedTextAsset(builtAdminAppPath);
    res.set('X-makaug-App-Bundle', 'built');
    return sendBufferResponse(req, res, asset.body, {
      contentType: 'application/javascript; charset=utf-8',
      cacheControl: staticCacheControlForUrl(req.originalUrl || req.url),
      etag: asset.etag,
      lastModified: asset.lastModified,
      compressed: asset.compressed
    });
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
        cacheControl: staticCacheControlForUrl(req.originalUrl || req.url),
        etag: adapted.etag,
        lastModified: adapted.lastModified,
        dynamicCompression: false
      });
    }
    const built = useBuiltAppBundles();
    const asset = readCachedTextAsset(built ? builtPublicAppPath : appJsPath);
    res.set('X-makaug-App-Bundle', built ? 'built' : 'source');
    return sendBufferResponse(req, res, asset.body, {
      contentType: 'application/javascript; charset=utf-8',
      cacheControl: staticCacheControlForUrl(req.originalUrl || req.url),
      etag: asset.etag,
      lastModified: asset.lastModified,
      compressed: asset.compressed
    });
  } catch (error) {
    return next(error);
  }
});

app.use('/pay', require('./routes/pay').pages);

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
    if (listing.thin) {
      // Thin found-online page: stays live, but noindex,follow and out of the sitemap.
      html = patchMetaTag(html, 'robots', 'noindex,follow');
      res.set('X-Robots-Tag', 'noindex, follow');
    }
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

// ---------------------------------------------------------------------------
// Short Term stays.
//
// Server-rendered so the section is crawlable and works without JavaScript.
// With SHORT_TERM_ENABLED off these handlers call next() and the request falls
// through to the ordinary single page app exactly as it does today.
// ---------------------------------------------------------------------------

const SHORT_TERM_PAGE_TITLE = 'Short Term Stays in Uganda | Nightly Rentals | makaug.com';
const SHORT_TERM_PAGE_DESCRIPTION = 'Find short stays across Uganda by the night. Apartments, cottages and guest houses in Kampala, Entebbe, Jinja and beyond, with the host’s own contact details on every listing.';

app.get('/short-term', async (req, res, next) => {
  if (!shortTermEnabled()) return next();
  try {
    res.set('X-makaug-Public-Sanitized', '1');
    let listings = [];
    let total = 0;
    try {
      const result = await searchShortTermListings(db, { ...(req.query || {}), limit: 24 });
      listings = result.listings;
      total = result.total;
    } catch (error) {
      logger.warn('Short term page is continuing without server-rendered cards', {
        path: req.path,
        message: error.message
      });
    }

    let html = renderPublicHtml(req.originalUrl || req.url || req.path);
    const rendered = renderShortTermSeoHtml(html, {
      listings,
      baseUrl: absolutePublicUrl('/')
    });
    html = patchPublicPageSeoMeta(rendered.html, {
      title: SHORT_TERM_PAGE_TITLE,
      description: SHORT_TERM_PAGE_DESCRIPTION,
      canonical: absolutePublicUrl('/short-term'),
      image: absolutePublicUrl('/assets/house-ads-v3/rent.webp'),
      count: total,
      structuredData: rendered.structuredData
    });

    res.set('X-makaug-Short-Term-SSR', String(listings.length));
    res.set('X-makaug-Short-Term-Total', String(total));
    return sendTextResponse(req, res, html, { cacheControl: PUBLIC_HTML_CACHE_CONTROL });
  } catch (error) {
    return next(error);
  }
});

app.get('/short-term/list-your-place', (req, res, next) => {
  if (!shortTermEnabled()) return next();
  try {
    res.set('X-makaug-Public-Sanitized', '1');
    let html = renderPublicHtml(req.originalUrl || req.url || req.path);
    html = patchPublicPageSeoMeta(html, {
      // From the rate card (config/pricing.js short_stay_host).
      title: `List Your Short Stay on makaug | ${PRICING.ugx(PRICING.short_stay_host.amount_ugx)} for ${PRICING.short_stay_host.months} Months`,
      description: `Put your Uganda short stay in front of guests for a flat ${PRICING.ugx(PRICING.short_stay_host.amount_ugx)} for ${PRICING.short_stay_host.months} months (${PRICING.vat.label.toLowerCase()}). No commission on any booking. Guests contact you directly.`,
      canonical: absolutePublicUrl('/short-term/list-your-place'),
      image: absolutePublicUrl('/assets/house-ads-v3/rent.webp')
    });
    res.set('X-makaug-Short-Term-Page', 'list-your-place');
    return sendTextResponse(req, res, html, { cacheControl: PUBLIC_HTML_CACHE_CONTROL });
  } catch (error) {
    return next(error);
  }
});

app.get('/short-term/:slug', async (req, res, next) => {
  if (!shortTermEnabled()) return next();
  try {
    res.set('X-makaug-Public-Sanitized', '1');
    let listing = null;
    try {
      listing = await getShortTermListing(db, req.params.slug);
    } catch (error) {
      logger.warn('Short term listing page is continuing without server-rendered detail', {
        slug: req.params.slug,
        message: error.message
      });
    }

    let html = renderPublicHtml(req.originalUrl || req.url || req.path);

    if (!listing) {
      html = patchPublicPageSeoMeta(html, {
        title: SHORT_TERM_PAGE_TITLE,
        description: SHORT_TERM_PAGE_DESCRIPTION,
        canonical: absolutePublicUrl('/short-term')
      });
      html = patchMetaTag(html, 'robots', 'noindex,follow');
        res.set('X-Robots-Tag', 'noindex, follow');
      res.set('X-makaug-Short-Term-Listing', 'missing');
      return sendTextResponse(req, res, html, { cacheControl: 'no-store' });
    }

    const rendered = renderShortTermSeoHtml(html, {
      listings: [listing],
      baseUrl: absolutePublicUrl('/')
    });
    html = patchPublicPageSeoMeta(rendered.html, {
      title: `${listing.title} | Short Stay in ${listing.area}, Uganda | makaug.com`,
      description: `${listing.place_type_label} in ${listing.area}, ${listing.district}. Sleeps ${listing.max_guests}. From ${listing.nightly_display} per night. Contact the host directly on makaug.`,
      canonical: absolutePublicUrl(`/short-term/${listing.slug}`),
      image: absolutePublicUrl(listing.primary_image || '/assets/house-ads-v3/rent.webp'),
      structuredData: vacationRentalStructuredData(listing, absolutePublicUrl('/'))
    });

    res.set('X-makaug-Short-Term-Listing', String(listing.reference || listing.id));
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
    if (!isSupportedPreview && !isApprovedFrancisProfile) {
      // Every public agent gets a self-canonical and their name in the title;
      // a profile that isn't public is a 404 (it used to be the homepage).
      let meta = null;
      try {
        meta = await loadPublicAgentOpenGraphMeta(req.params.id, {});
      } catch (error) {
        logger.warn('Agent profile SEO is continuing without its meta', { message: error.message });
        meta = { canonical: absolutePublicUrl(`/agents/${encodeURIComponent(req.params.id)}`) };
      }
      if (!meta) return sendPublicNotFound(req, res);
      html = patchPublicPageSeoMeta(html, meta);
    }
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
    const overseas = project.country_code !== 'UG';
    const countryName = project.extra_fields?.country_name || (overseas ? project.country_code : 'Uganda');
    const description = String(project.description || `Explore ${project.name}, an off-plan development in ${[project.area, project.district, countryName].filter(Boolean).join(', ')}.`).replace(/\s+/g, ' ').trim().slice(0, 240);
    const countrySlug = String(project.extra_fields?.country_slug || countryName || project.country_code).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const canonicalPath = overseas
      ? `/off-plan/overseas/${encodeURIComponent(countrySlug)}/${encodeURIComponent(project.slug)}`
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
    res.set('X-makaug-Off-Plan-SSR', overseas ? `overseas-${project.country_code.toLowerCase()}` : '1');
    res.set('X-makaug-Public-Sanitized', '1');
    return sendTextResponse(req, res, html, { cacheControl: PUBLIC_HTML_CACHE_CONTROL });
  }).catch((error) => {
    if (error.code === '42P01') return sendPublicIndex(req, res, next);
    return next(error);
  });
}

app.get('/off-plan/overseas/kenya/:slug', (req, res, next) => renderOffPlanProjectPage(req, res, next, 'KE'));

app.get('/off-plan/overseas/:countrySlug/:slug', async (req, res, next) => {
  try {
    const market = await getPublicMarket(db, req.params.countrySlug);
    if (!market) return res.status(404).type('text/plain').send('Off-plan market not found');
    return renderOffPlanProjectPage(req, res, next, market.country_code);
  } catch (error) { return next(error); }
});

app.get('/off-plan/overseas', sendPublicIndex);
app.get('/off-plan/overseas/:countrySlug', async (req, res, next) => {
  // Kenya has its own copy in sendPublicIndex; other countries need a market.
  if (String(req.params.countrySlug || '').toLowerCase() === 'kenya') return sendPublicIndex(req, res, next);
  let market = null;
  try {
    market = await getPublicMarket(db, req.params.countrySlug);
  } catch (error) {
    logger.warn('Overseas market lookup failed', { message: error.message });
    return sendPublicIndex(req, res, next);
  }
  if (!market) return sendPublicNotFound(req, res);
  req.offPlanMarket = market;
  return sendPublicIndex(req, res, next);
});

app.get('/off-plan/:slug', (req, res, next) => renderOffPlanProjectPage(req, res, next, 'UG'));

// Five obvious aliases people (and old links) use. Everything else unknown is a
// real 404: it used to be 200 + the homepage + canonical "/" (a soft 404).
const PUBLIC_ALIAS_REDIRECTS = Object.freeze({
  '/contact': '/help',
  '/faq': '/help',
  '/privacy': '/privacy-policy',
  '/legal/terms': '/terms',
  '/pricing': '/about'
});

function publicAliasRedirectTarget(pathname = '') {
  const clean = String(pathname || '').replace(/\/+$/, '').toLowerCase();
  return PUBLIC_ALIAS_REDIRECTS[clean] || '';
}

function renderPublicNotFoundPage() {
  const brand = escapeMetaContent(ACTIVE_TENANT.publicName || ACTIVE_TENANT.brandName || 'makaug.com');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Page not found | ${brand}</title>
  <link rel="icon" href="/favicon.ico">
  <style>
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f8faf9;color:#14251b}
    main{max-width:560px;margin:12vh auto;padding:0 20px}
    h1{font-size:28px;margin:0 0 8px} p{color:#4b5d52;line-height:1.5}
    nav{display:flex;flex-wrap:wrap;gap:10px;margin-top:20px}
    a{color:#fff;background:#166534;text-decoration:none;padding:10px 14px;border-radius:10px;font-weight:700}
    a.secondary{background:#fff;color:#166534;border:1px solid #bbf7d0}
  </style>
</head>
<body>
  <main>
    <h1>Page not found</h1>
    <p>We couldn't find that page. It may have moved, or the link may be wrong.</p>
    <nav>
      <a href="/">Home</a>
      <a class="secondary" href="/for-sale">For sale</a>
      <a class="secondary" href="/to-rent">To rent</a>
      <a class="secondary" href="/land">Land</a>
      <a class="secondary" href="/help">Help</a>
    </nav>
  </main>
</body>
</html>`;
}

function sendPublicNotFound(req, res) {
  res.set('X-Robots-Tag', 'noindex');
  res.set('Cache-Control', 'no-store');
  return res.status(404).type('html').send(req.method === 'HEAD' ? '' : renderPublicNotFoundPage());
}

function sendPublicIndex(req, res, next) {
  if (req.path.startsWith('/api/')) return next();
  const aliasTarget = publicAliasRedirectTarget(req.path);
  if (aliasTarget) {
    const query = String(req.originalUrl || '').includes('?') ? String(req.originalUrl).slice(String(req.originalUrl).indexOf('?')) : '';
    return res.redirect(301, `${aliasTarget}${query}`);
  }
  if (!isKnownPublicRoute(req.path)) return sendPublicNotFound(req, res);
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
      // The review desks live on the staff and admin dashboards, which are
      // protected routes and therefore skip renderPublicHtml. They still need
      // the runtime config, or short-term.js will not boot there.
      const html = applyHomeHeroPreload(injectShortTermRuntimeConfig(readIndexHtml()), req.path);
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
    if (/^\/about\/?$/i.test(req.path)) {
      html = patchPublicPageSeoMeta(html, {
        title: 'About makaug — Products, pricing & how it works | makaug.com',
        description: `Everything makaug offers: listings from ${PRICING.ugx(PRICING.private_listing.amount_ugx)}/month (first week free), agent plans, off-plan developments, featured and premium listings, market reports, agency websites and advertising. ${PRICING.vat.label}.`,
        canonical: absolutePublicUrl('/about'),
        image: absolutePublicUrl('/assets/og-cover.jpg'),
        structuredData: { '@context': 'https://schema.org', '@type': 'AboutPage', name: 'About makaug', url: absolutePublicUrl('/about') }
      });
    } else if (/^\/off-plan\/overseas\/kenya\/?$/i.test(req.path)) {
      html = patchPublicPageSeoMeta(html, {
        title: 'Off Plan Property in Kenya | makaug.com Overseas',
        description: 'Explore Kenya off-plan property with makaug.com-managed document review, legal coordination, payment guidance and currency information.',
        canonical: absolutePublicUrl('/off-plan/overseas/kenya'),
        image: absolutePublicUrl('/assets/off-plan/spectre-westlands/nairobi-skyline.jpg'),
        structuredData: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Off Plan Property in Kenya', url: absolutePublicUrl('/off-plan/overseas/kenya') }
      });
    } else if (/^\/off-plan\/overseas\/?$/i.test(req.path)) {
      html = patchPublicPageSeoMeta(html, {
        title: 'Overseas Off Plan Property | makaug.com',
        description: 'Browse overseas off-plan opportunities by region and country, beginning with verified-source projects in Africa.',
        canonical: absolutePublicUrl('/off-plan/overseas'),
        image: absolutePublicUrl('/assets/off-plan/spectre-westlands/nairobi-skyline.jpg'),
        structuredData: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Overseas Off Plan Property', url: absolutePublicUrl('/off-plan/overseas') }
      });
    } else if (req.offPlanMarket) {
      const marketPath = `/off-plan/overseas/${encodeURIComponent(req.offPlanMarket.country_slug)}`;
      html = patchPublicPageSeoMeta(html, {
        title: `Off Plan Property in ${req.offPlanMarket.country_name} | makaug.com Overseas`,
        description: `Overseas off-plan property in ${req.offPlanMarket.country_name}, with makaug.com document review, payment guidance and currency information.`.slice(0, 155),
        canonical: absolutePublicUrl(marketPath),
        image: absolutePublicUrl('/assets/off-plan/spectre-westlands/nairobi-skyline.jpg'),
        structuredData: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `Off Plan Property in ${req.offPlanMarket.country_name}`, url: absolutePublicUrl(marketPath) }
      });
    } else if (/^\/off-plan\/?$/i.test(req.path)) {
      html = patchPublicPageSeoMeta(html, {
        title: 'Off Plan Property and New Developments in Uganda | makaug.com',
        description: 'Explore off-plan projects and new developments in Uganda with attributed pricing, progress, payment plans, maps and downloadable brochures.',
        canonical: absolutePublicUrl('/off-plan'),
        image: absolutePublicUrl('/assets/off-plan/entebbe-victoria-palms/residents-lounge-render.jpg'),
        structuredData: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Off Plan Property in Uganda', url: absolutePublicUrl('/off-plan') }
      });
    }
    // App pages: own title, description and self-canonical (they used to ship
    // the generic shell with canonical "/"). Unlisted known routes still get a
    // self-canonical so that no page but "/" claims to be the homepage.
    if (!/^\/(?:about|off-plan)(?:\/|$)/i.test(req.path) && req.path !== '/' && !/^\/index\.html$/i.test(req.path)) {
      const pageSeo = ACTIVE_COUNTRY_CODE === 'UG' ? publicPageSeoFor(req.path, absolutePublicUrl('/')) : null;
      const selfPath = (String(req.path || '/').replace(/\/+$/, '') || '/').toLowerCase();
      if (pageSeo && pageSeo.title) {
        html = patchPublicPageSeoMeta(html, {
          title: pageSeo.title,
          description: pageSeo.description,
          canonical: pageSeo.canonical,
          image: absolutePublicUrl('/assets/og-cover.jpg')
        });
        html = patchMetaTag(html, 'robots', pageSeo.robots);
        if (pageSeo.robots.startsWith('noindex')) res.set('X-Robots-Tag', 'noindex, follow');
      } else {
        html = patchCanonicalLink(html, pageSeo?.canonical || absolutePublicUrl(selfPath));
        html = patchMetaTag(html, 'og:url', pageSeo?.canonical || absolutePublicUrl(selfPath));
      }
    }
    return sendTextResponse(req, res, html, {
      cacheControl: PUBLIC_HTML_CACHE_CONTROL
    });
  } catch (error) {
    return next(error);
  }
}

app.get('/about/rate-card.pdf', async (req, res, next) => {
  try {
    const pdf = await buildAboutCommercialRateCardPdf();
    res.type('application/pdf');
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('Content-Disposition', 'attachment; filename="makaug-commercial-rate-card.pdf"');
    res.set('X-makaug-Rate-Card-Version', PRICING.version);
    return res.send(pdf);
  } catch (error) {
    return next(error);
  }
});

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

// Static files come ONLY from this allowlist. Until 8 Oct 2026 the whole repo
// root was served, so /server.js, /routes/*, /package.json, /db/** etc. were
// public. Anything else with a file extension is a 404 (noindex).
const staticFileOptions = {
  index: false,
  dotfiles: 'ignore',
  cacheControl: false,
  setHeaders(res, filePath) {
    if (/\.(html?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store');
      return;
    }
    const req = res.req || {};
    res.setHeader('Cache-Control', staticCacheControlForUrl(req.originalUrl || req.url));
  }
};
const STATIC_ROOT_FILE_ALLOWLIST = new Set([
  '/favicon.ico',
  '/site.webmanifest',
  '/seshaikhaya.webmanifest',
  '/google033e19e2016a21c2.html', // Search Console verification: keep
  '/config/aboutCommercialProducts.js', // loaded by index.html
  '/config/pricing.js' // the rate card; also inlined into the page shell
]);
app.use('/assets', express.static(path.join(staticRoot, 'assets'), staticFileOptions));
app.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method) || !STATIC_ROOT_FILE_ALLOWLIST.has(req.path)) return next();
  res.set('Cache-Control', req.path.endsWith('.html') ? 'no-store' : staticCacheControlForUrl(req.originalUrl || req.url));
  return res.sendFile(path.join(staticRoot, req.path), (error) => {
    if (error) next(error.status === 404 || error.code === 'ENOENT' ? undefined : error);
  });
});
app.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method) || req.path.startsWith('/api/')) return next();
  if (!path.extname(req.path)) return next();
  res.set('X-Robots-Tag', 'noindex');
  res.set('Cache-Control', 'no-store');
  return res.status(404).type('text/plain').send('Not found');
});

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
  if (!IS_SOUTH_AFRICA) {
    startLeadDeskScheduler(db);
    startVideoStillScheduler(db);
    startGreetingNameCache(db);
    startBillingScheduler(db);
    if (process.env.DATABASE_URL) liveDistricts.refreshLiveDistricts(db).catch(() => {});
    if (process.env.DATABASE_URL) logPricingDriftOnce(db).catch(() => {});
    require('./services/payLinkService').startPayLinkScheduler(db);
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
  scheduleStartupDataRepairs();
  startMemoryLog();
}

// One "memory" line a minute, so the trend towards the 512 MB limit is in the logs.
function startMemoryLog() {
  if (process.env.NODE_ENV === 'test' || process.env.MEMORY_LOG === 'off') return;
  const mb = (n) => Math.round(n / 1048576);
  const timer = setInterval(() => {
    const m = process.memoryUsage();
    logger.info(`memory rss_mb=${mb(m.rss)} heap_used_mb=${mb(m.heapUsed)} heap_total_mb=${mb(m.heapTotal)} external_mb=${mb(m.external)} limit_mb=${Number(process.env.MEMORY_LIMIT_MB || 512)}`);
  }, 60_000);
  timer.unref?.();
}

// One-off tidy-ups that are safe to repeat on every start: move inline agent ID
// photos into private storage.
function scheduleStartupDataRepairs() {
  if (process.env.NODE_ENV === 'test' || process.env.STARTUP_DATA_REPAIRS === 'off') return;
  const timer = setTimeout(async () => {
    try {
      const { migrateInlineAgentIdentityDocuments } = require('./services/agentIdentityStorageService');
      let total = { agents_moved: 0, users_moved: 0, failed: 0 };
      for (let round = 0; round < 20; round += 1) {
        const r = await migrateInlineAgentIdentityDocuments(db, { limit: 50, logger });
        if (r.skipped_no_storage) break;
        total = { agents_moved: total.agents_moved + r.agents_moved, users_moved: total.users_moved + r.users_moved, failed: total.failed + r.failed };
        if (!r.agents_moved && !r.users_moved) break;
      }
      if (total.agents_moved || total.users_moved || total.failed) logger.info('Agent ID photos moved to private storage', total);
    } catch (error) {
      logger.warn('Agent ID photo move skipped:', error.message || String(error));
    }
    // Agents approved in the last two weeks who never got their welcome pack
    // (e.g. approved by a route that skipped it): one at a time, no video rendering.
    try {
      const { runAgentApprovalFollowUps } = require('./routes/admin');
      await require('./services/agentWelcomeCatchUpService').runWelcomeCatchUp({ db, runFollowUps: runAgentApprovalFollowUps, logger });
    } catch (error) {
      logger.warn('Agent welcome catch-up skipped:', error.message || String(error));
    }
  }, 45_000);
  timer.unref?.();
}

start().catch((error) => {
  logger.error('Startup failed', error);
  process.exit(1);
});
