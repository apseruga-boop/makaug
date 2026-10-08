'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const {
  DEFAULT_USD_TO_UGX_RATE,
  propertyPriceMetadata
} = require('../utils/propertyPriceCurrency');

test('USD guide prices preserve original value and produce canonical UGX', () => {
  const parsed = propertyPriceMetadata('USD 270k', {
    usdToUgxRate: DEFAULT_USD_TO_UGX_RATE,
    fxAsOf: '2026-07-25T00:00:00.000Z'
  });
  assert.equal(parsed.price_currency, 'UGX');
  assert.equal(parsed.price_original_currency, 'USD');
  assert.equal(parsed.price_original, 270000);
  assert.equal(parsed.price, 1026000000);
  assert.equal(parsed.price_fx_rate_ugx, 3800);
  assert.equal(parsed.price_fx_as_of, '2026-07-25T00:00:00.000Z');

  const ugx = propertyPriceMetadata('USh 1.5M');
  assert.equal(ugx.price_currency, 'UGX');
  assert.equal(ugx.price_original, 1500000);
  assert.equal(ugx.price, 1500000);
  assert.equal(ugx.price_fx_rate_ugx, null);
});

test('USD shorthand keeps the original source amount before canonical conversion', () => {
  const parsed = propertyPriceMetadata('$6k', {
    fxAsOf: '2026-07-25T00:00:00.000Z'
  });
  assert.equal(parsed.price_currency, 'UGX');
  assert.equal(parsed.price_original_currency, 'USD');
  assert.equal(parsed.price_original, 6000);
  assert.equal(parsed.price, 22800000);
});

test('staff sessions roll near expiry without invalidating same-user dashboard hydration', () => {
  const authRoute = read('routes/auth.js');
  const authMiddleware = read('middleware/auth.js');
  const app = read('assets/makaug-app.js');

  assert.match(authRoute, /STAFF_JWT_EXPIRES_IN \|\| '30d'/);
  assert.match(authRoute, /STAFF_SESSION_REFRESH_THRESHOLD_SECONDS/);
  assert.match(authRoute, /staffSessionNeedsRefresh\(auth\.decoded\)/);
  assert.match(authRoute, /rolling: true/);
  assert.match(authRoute, /rotated: Boolean\(rollingToken\)/);
  assert.match(authRoute, /setAuthCookie\(req, res, rollingToken\)/);
  assert.match(authMiddleware, /AUTH_BACKEND_UNAVAILABLE/);
  assert.match(authMiddleware, /wrapped\.status = 503/);
  assert.match(authMiddleware, /if \(!isAuthenticationError\(_error\)\) return next\(_error\)/);
  assert.match(app, /const rollingToken = me\?\.data\?\.session\?\.token \|\| authState\.token/);
  assert.match(app, /function staffAuthIdentityKey\(user = \{\}\)/);
  assert.match(app, /function staffDashboardRequestMatchesUser\(userIdentityAtStart = ""\)/);
  assert.match(app, /STAFF_DASHBOARD_FAST_TIMEOUT_MS/);
  assert.match(app, /"Staff dashboard"[\s\S]*STAFF_DASHBOARD_FAST_TIMEOUT_MS|STAFF_DASHBOARD_FAST_TIMEOUT_MS[\s\S]*"Staff dashboard"/);
  assert.match(app, /\{ renderDashboard: false \}/);
  assert.match(app, /window\.setTimeout\(\(\) => \{[\s\S]*refreshAuthSession\(\)/);
});

test('review queue uses indexed pending status predicates and never converts row timeout into an empty queue', () => {
  const admin = read('routes/admin.js');
  const reviewQueueRoute = admin.slice(
    admin.indexOf("router.get('/properties/review-queue'"),
    admin.indexOf("router.get('/properties/actioned'")
  );
  const migration = read('db/migrations/106_admin_review_queue_authoritative_status.sql');

  assert.match(admin, /admin-review-queue-v7-authoritative-status/);
  assert.match(admin, /ADMIN_REVIEW_QUEUE_QUERY_TIMEOUT_MS/);
  assert.match(
    admin,
    /function adminPendingReviewWhere\(alias = 'p'\)[\s\S]*rawStatusExpr[\s\S]*\$\{rawStatusExpr\} = ''[\s\S]*\$\{stageExpr\} IN \(\$\{pending\}\)/
  );
  assert.doesNotMatch(reviewQueueRoute, /rowFallbackReason = adminSafeQueryFallbackReason/);
  assert.match(migration, /idx_properties_admin_actionable_review_order_v3/);
  assert.match(migration, /idx_properties_admin_found_online_review_order_v3/);
  assert.match(migration, /COALESCE\(status, ''\) = ''[\s\S]*LOWER\(COALESCE\(moderation_stage, ''\)\) IN/);
  assert.match(reviewQueueRoute, /final_property_status_overrides_stale_moderation_stage/);
});

test('command-centre pending count uses the same authoritative actionable queue predicate', () => {
  const admin = read('routes/admin.js');
  const countHelper = admin.slice(
    admin.indexOf('async function adminActionableReviewQueueCount'),
    admin.indexOf('function adminSummaryFallbackReason')
  );
  const html = read('index.html');

  assert.match(countHelper, /admin-actionable-review-count-v2-authoritative-status/);
  assert.match(countHelper, /WHERE \$\{adminActionableReviewQueueWhere\('p'\)\}/);
  assert.match(countHelper, /adminTimedQuery/);
  assert.doesNotMatch(countHelper, /safeCount/);
  assert.doesNotMatch(countHelper, /moderation_stage, ''\) IN/);
  assert.match(countHelper, /final_property_status_overrides_stale_moderation_stage/);
  assert.match(html, /admin-review-queue-count-parity-20260725/);
});

test('command-centre isolates optional metric failures instead of returning 500', () => {
  const admin = read('routes/admin.js');
  const html = read('index.html');

  assert.match(admin, /const logger = require\('\.\.\/config\/logger'\);/);
  assert.match(admin, /async function adminCommandCentreMetric\(/);
  assert.match(admin, /ADMIN_COMMAND_CENTRE_METRIC_CONCURRENCY = 4/);
  assert.match(admin, /withAdminCommandCentreMetricSlot\(producer\)/);
  assert.match(admin, /admin-command-centre-v5-partial-safe/);
  assert.match(admin, /partial: metricFallbacks\.length > 0/);
  assert.match(admin, /metric_fallbacks: metricFallbacks/);
  assert.doesNotMatch(
    admin,
    /adminCachedPayload\('admin-command-centre-v4'/,
    'the command-centre route must roll off the all-or-nothing v4 producer'
  );
  assert.match(html, /admin-command-centre-partial-safe-20260726/);
});

test('admin exact social imports update the persisted harvest ledger', () => {
  const admin = read('routes/admin.js');
  const exactImportRoute = admin.slice(
    admin.indexOf("router.post('/exact-social-source-posts/import'"),
    admin.indexOf("router.post('/property-source-registry/seed'")
  );

  assert.match(admin, /recordHarvestImportResult/);
  assert.match(exactImportRoute, /recordHarvestImportResult\(db, result, \{ eventType: 'exact_social_import' \}\)/);
  assert.match(exactImportRoute, /if \(!dryRun\)/);
});

test('USD currency metadata is carried through import, API, moderation, and public UI', () => {
  const importer = read('services/socialSearchSourcedListingsService.js');
  const properties = read('routes/properties.js');
  const admin = read('routes/admin.js');
  const app = read('assets/makaug-app.js');
  const migration = read('db/migrations/102_property_price_currency.sql');
  const correction = read('db/migrations/103_property_usd_source_amount_correction.sql');
  const html = read('index.html');

  for (const field of ['price_currency', 'price_original', 'price_fx_rate_ugx', 'price_fx_as_of']) {
    assert.match(importer, new RegExp(field));
    assert.match(properties, new RegExp(field));
    assert.match(admin, new RegExp(field));
    assert.match(migration, new RegExp(field));
  }
  assert.match(app, /function propertyOriginalCurrencyGuide\(p = \{\}\)/);
  assert.match(app, /data-price-currency-guide="USD"/);
  assert.match(correction, /price_source_amount_corrected/);
  assert.match(correction, /THOUSAND\|THOUSANDS\|K/);
  assert.match(correction, /ROUND\(a\.original_amount \* 3800\)/);
  assert.match(html, /admin-session-review-queue-usd-20260725/);
});

// Admin review form, "Original source amount" (8 Oct 2026): it was pre-filled
// with review.price, so a UGX listing saved with currency USD became price × 3,800.
test('review form: a UGX row has an empty, disabled original amount; switching to USD never sends the UGX number', () => {
  const vm = require('node:vm');
  const app = read('assets/makaug-app.js');
  const extract = (name) => {
    const start = app.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    let depth = 0;
    for (let i = app.indexOf(') {', start) + 2; i < app.length; i += 1) {
      if (app[i] === '{') depth += 1;
      if (app[i] === '}') { depth -= 1; if (depth === 0) return app.slice(start, i + 1); }
    }
    throw new Error(name);
  };
  const elements = {
    'admin-review-price-currency-edit': { value: 'UGX' },
    'admin-review-price-original-edit': { value: '', disabled: true, placeholder: '' },
    'admin-review-price-fx-rate-edit': { value: '', disabled: true }
  };
  const sandbox = { document: { getElementById: (id) => elements[id] || null } };
  vm.createContext(sandbox);
  vm.runInContext(['adminReviewOriginalAmountState', 'adminReviewPricePatchFields', 'adminReviewOnPriceCurrencyChange'].map(extract).join('\n'), sandbox);

  const ugxRow = { price: 450000000, price_original_currency: 'UGX', price_original: null, extra_fields: {} };
  const state = sandbox.adminReviewOriginalAmountState(ugxRow);
  assert.equal(state.value, '');
  assert.equal(state.disabled, true);
  // Even a UGX row with a stale price_original never shows the canonical price.
  assert.equal(sandbox.adminReviewOriginalAmountState({ price: 450000000, extra_fields: {} }).value, '');

  // The moderator switches the currency to USD: the field is cleared, nothing is sent until they type a USD amount.
  elements['admin-review-price-original-edit'].value = '450000000';
  elements['admin-review-price-currency-edit'].value = 'USD';
  sandbox.adminReviewOnPriceCurrencyChange();
  assert.equal(elements['admin-review-price-original-edit'].value, '');
  assert.equal(elements['admin-review-price-original-edit'].disabled, false);
  const patch = sandbox.adminReviewPricePatchFields('USD', elements['admin-review-price-original-edit'].value, '3800');
  assert.equal(patch.price_original_currency, 'USD');
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'price_original'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(patch, 'price_fx_rate_ugx'), false);

  // UGX never sends an original amount or FX rate, even if something is typed.
  const ugxPatch = sandbox.adminReviewPricePatchFields('UGX', '450000000', '3800');
  assert.equal(JSON.stringify(ugxPatch), JSON.stringify({ price_original_currency: 'UGX' }));
  // A genuine USD amount is sent with its rate.
  const usd = sandbox.adminReviewPricePatchFields('USD', '120000', '3800');
  assert.equal(usd.price_original, '120000');
  assert.equal(usd.price_fx_rate_ugx, '3800');
  // USD row pre-fills its real USD original.
  assert.equal(sandbox.adminReviewOriginalAmountState({ price: 456000000, price_original: 120000, price_original_currency: 'USD', extra_fields: {} }).value, '120000');

  assert.doesNotMatch(app, /review\.price_original \?\? extra\.price_original \?\? review\.price \?\?/);
  assert.match(app, /\.\.\.adminReviewPricePatchFields\(/);
});
