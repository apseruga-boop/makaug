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
  assert.equal(parsed.price_currency, 'USD');
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
  assert.equal(parsed.price_currency, 'USD');
  assert.equal(parsed.price_original, 6000);
  assert.equal(parsed.price, 22800000);
});

test('staff sessions roll for 30 days and transient auth backend failures do not become 401', () => {
  const authRoute = read('routes/auth.js');
  const authMiddleware = read('middleware/auth.js');
  const app = read('assets/makaug-app.js');

  assert.match(authRoute, /STAFF_JWT_EXPIRES_IN \|\| '30d'/);
  assert.match(authRoute, /rolling: true/);
  assert.match(authRoute, /setAuthCookie\(req, res, rollingToken\)/);
  assert.match(authMiddleware, /AUTH_BACKEND_UNAVAILABLE/);
  assert.match(authMiddleware, /wrapped\.status = 503/);
  assert.match(authMiddleware, /if \(!isAuthenticationError\(_error\)\) return next\(_error\)/);
  assert.match(app, /const rollingToken = me\?\.data\?\.session\?\.token \|\| authState\.token/);
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

  assert.match(admin, /async function adminCommandCentreMetric\(/);
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
