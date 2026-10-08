const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const contains = (file, needle, message = `${file} should contain ${needle}`) => {
  assert.ok(read(file).includes(needle), message);
};

const migration = read('db/migrations/074_monetization_spine_v1.sql');
[
  'CREATE TABLE IF NOT EXISTS payments',
  'CREATE TABLE IF NOT EXISTS products',
  'CREATE TABLE IF NOT EXISTS account_entitlements',
  'CREATE TABLE IF NOT EXISTS rental_applications',
  'CREATE TABLE IF NOT EXISTS listing_price_history',
  'agent_monthly_lead_counters',
  'featured_until',
  'boost_tier',
  'development_id',
  'verified_badge',
  'platform_margin',
  'buyer_ref',
  'billable',
  'charged'
].forEach((needle) => assert.ok(migration.includes(needle), `migration should include ${needle}`));

contains('services/paymentProviderService.js', 'MONETIZATION_SPINE_MARKER');
contains('services/paymentProviderService.js', 'createHostedPayment');
contains('services/paymentProviderService.js', 'handleGenericPaymentWebhook');
contains('services/paymentProviderService.js', 'payment.succeeded');
contains('services/paymentProviderService.js', 'payment.failed');
contains('services/paymentProviderService.js', 'grantEntitlementForPayment');

const {
  MONETIZATION_SPINE_MARKER,
  PAY_LINK_PROVIDER,
  paymentProviderConfigured
} = require('../services/paymentProviderService');

assert.strictEqual(MONETIZATION_SPINE_MARKER, 'monetization-spine-v1-20260715');
// Checkouts are makaug pay links (card via Revolut, or MTN MoMo); no third-party gateway.
assert.strictEqual(PAY_LINK_PROVIDER, 'makaug_pay_link');
assert.strictEqual(paymentProviderConfigured(), true);
contains('services/paymentProviderService.js', "purpose: 'hosted_payment'");
contains('services/paymentProviderService.js', 'completeHostedPayment');
assert.ok(!read('services/paymentProviderService.js').match(/flutterwave/i), 'no Flutterwave left in the payment service');

contains('routes/advertising.js', 'createHostedPayment');
contains('routes/advertising.js', "purpose: 'advertising_campaign'");
contains('routes/advertising.js', 'checkoutUrl');

contains('routes/monetization.js', "router.get('/config'");
contains('routes/monetization.js', "router.post('/listing-boost/checkout'");
contains('routes/monetization.js', "router.post('/payments/webhook/:provider?'");
contains('routes/monetization.js', 'MAKAUG_LISTING_BOOSTS_ENABLED');

contains('server.js', "app.use('/api/monetization', monetizationRoutes);");

contains('routes/admin.js', "router.get('/monetization/products'");
contains('routes/admin.js', "router.patch('/monetization/products/:key'");
contains('routes/admin.js', 'monetization_product_updated');

contains('services/leadService.js', 'agent_id');
contains('services/leadService.js', 'buyer_ref');
contains('services/leadService.js', 'billable');
contains('services/leadService.js', 'charged');
contains('services/leadService.js', 'metering');

contains('routes/properties.js', 'agentId: listing.agent_id');
// Found-online listings are never billable to an agent.
contains('routes/properties.js', 'billable: Boolean(listing.agent_id) && !listing.is_found_online');
contains('routes/properties.js', 'charged: false');

contains('index.html', 'monetization-spine-v1-20260715');
contains('index.html', 'admin-monetization-products-grid');
contains('assets/makaug-app.js', 'hydrateMonetizationConfig');
contains('assets/makaug-app.js', 'data-monetization-hook="listing-boost"');
contains('assets/makaug-app.js', 'data-monetization-hook="listing-boost-dashboard"');
// Agent Pro and the featured lender slot are retired (rate card 2026-10-08):
// the hooks render nothing and the admin route cannot switch them back on.
contains('assets/makaug-app.js', 'function renderAgentProHook(_options = {}) {\n  return "";\n}');
contains('assets/makaug-app.js', 'function renderFeaturedLenderHook() {\n  return "";\n}');
contains('routes/admin.js', "return res.status(410).json({ ok: false, error: 'This product is no longer offered.' });");
contains('routes/monetization.js', "code: 'product_off_sale'");
contains('assets/makaug-app.js', 'renderAdminMonetizationProducts');

console.log('monetization spine checks passed');
