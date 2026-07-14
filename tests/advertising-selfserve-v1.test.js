const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const appJs = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');
const advertisingRoute = fs.readFileSync(path.join(root, 'routes/advertising.js'), 'utf8');
const adminRoute = fs.readFileSync(path.join(root, 'routes/admin.js'), 'utf8');
const publicHtmlSanitizer = fs.readFileSync(path.join(root, 'services/publicHtmlSanitizer.js'), 'utf8');
const paymentProviderService = fs.readFileSync(path.join(root, 'services/paymentProviderService.js'), 'utf8');
const lifecycleService = fs.readFileSync(path.join(root, 'services/advertisingLifecycleNotificationService.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'db/migrations/073_advertising_selfserve_v1.sql'), 'utf8');
const lifecycleMigration = fs.readFileSync(path.join(root, 'db/migrations/074_advertising_lifecycle_statuses.sql'), 'utf8');
const catalog = require('../services/advertisingCatalogService');
const { buildAdvertisingLifecycleTemplate } = require('../services/advertisingLifecycleNotificationService');

const marker = 'advertising-selfserve-v1-20260713';
const flutterwaveMarker = 'advertising-flutterwave-staging-20260714';

assert(appJs.includes(marker), 'public app must expose the advertising self-serve marker');
assert(appJs.includes('buildAdvertiseSelfServePage'), 'advertise route must render the new self-serve page builder');
assert(appJs.includes('Start advertising'), 'advertise page must have the Start advertising CTA');
assert(appJs.includes('1. Choose placement'), 'wizard must include placement step');
assert(appJs.includes('2. Duration'), 'wizard must include duration step');
assert(appJs.includes('3. Creative'), 'wizard must include creative step');
assert(appJs.includes('4. Confirm preview'), 'wizard must include preview step');
assert(appJs.includes('5. Pay'), 'wizard must include pay step');
assert(appJs.includes('/api/advertising/rate-card'), 'wizard must load the live rate card');
assert(appJs.includes('/api/advertising/quote'), 'wizard must recompute hybrid quotes');
assert(appJs.includes('/api/advertising/creative-draft'), 'wizard must call the creative draft endpoint');
assert(appJs.includes('/api/advertising/self-serve-campaigns'), 'wizard must create self-serve campaigns');
assert(appJs.includes('/api/ai/translate-text'), 'wizard must use translate-text for language preview');
assert(appJs.includes('Flutterwave hosted checkout'), 'wizard copy must name Flutterwave hosted checkout');
assert(appJs.includes('adminApproveSelfServeAdCampaign'), 'King dashboard must have approve/schedule action');
assert(appJs.includes('adminRequestSelfServeAdChange'), 'King dashboard must have request-change action');
assert(appJs.includes('adminRejectSelfServeAdCampaign'), 'King dashboard must have reject/refund action');
assert(!buildAdvertiseSelfServePageSource(appJs).includes('amber-'), 'rendered /advertise self-serve page must not use yellow/amber styling');

assert(publicHtmlSanitizer.includes('renderAdvertiseSelfServeRouteContent'), 'hard-refresh /advertise route must render self-serve content');
assert(publicHtmlSanitizer.includes(marker), 'hard-refresh /advertise route must include the self-serve marker');
assert(publicHtmlSanitizer.includes('advertising-selfserve-form'), 'hard-refresh /advertise route must include the wizard form');
assert(publicHtmlSanitizer.includes("if (pathName === '/advertise') return renderAdvertiseSelfServeRouteContent();"), 'synthetic /advertise route must use the self-serve route renderer');

assert(advertisingRoute.includes("router.get('/rate-card'"), 'public advertising route must expose a rate-card endpoint');
assert(advertisingRoute.includes("router.post('/quote'"), 'public advertising route must expose quote endpoint');
assert(advertisingRoute.includes("router.post('/creative-draft'"), 'public advertising route must expose creative draft endpoint');
assert(advertisingRoute.includes("router.post('/self-serve-campaigns'"), 'public advertising route must expose self-serve campaign endpoint');
assert(advertisingRoute.includes('createHostedPaymentLink'), 'self-serve route must create provider-hosted payment links');
assert(advertisingRoute.includes('generateCampaignCopy'), 'creative draft route must call the AI campaign copy service when configured');
assert(advertisingRoute.includes("trigger: 'submitted'"), 'self-serve submit must send/log the received notification');
assert(advertisingRoute.includes("status = 'awaiting_payment'") || advertisingRoute.includes("'awaiting_payment'"), 'self-serve campaign must create a hosted-payment handoff state');
assert(advertisingRoute.includes("'advertising_selfserve_v1'"), 'self-serve campaign must mark inquiry/lead source');
assert(advertisingRoute.includes('hosted_checkout_only'), 'self-serve campaign must enforce hosted checkout boundary');
assert(advertisingRoute.includes('advertiser_approval_status') && advertisingRoute.includes("'sent'"), 'self-serve campaign must land in approval-ready status');

assert(adminRoute.includes('traffic_multiplier'), 'King placement route must allow multiplier edits');
assert(adminRoute.includes('weekly_impressions'), 'King placement route must allow traffic edits');
assert(adminRoute.includes('FLUTTERWAVE_SECRET_KEY'), 'admin setup status must know Flutterwave keys');
assert(adminRoute.includes('paid_pending_approval'), 'admin advertising status machine must allow paid pending approval');
assert(adminRoute.includes('requestAdvertisingCampaignRefund'), 'King reject path must request payment-provider refund when paid');
assert(adminRoute.includes("trigger: 'approved_live'"), 'King live approval must trigger approved/live notification');

assert(paymentProviderService.includes('createFlutterwaveCheckout'), 'payment provider service must create Flutterwave checkout sessions');
assert(paymentProviderService.includes('mobilemoneyuganda'), 'Flutterwave checkout must request Uganda mobile money payment options');
assert(paymentProviderService.includes('verifyFlutterwaveWebhookSignature'), 'Flutterwave webhook signature must be verified');
assert(paymentProviderService.includes('flutterwave-signature') || advertisingRoute.includes('flutterwave-signature'), 'Flutterwave signature header must be accepted');
assert(paymentProviderService.includes('FLUTTERWAVE_SECRET_KEY'), 'Flutterwave secret key env must be used server-side');
assert(paymentProviderService.includes("'paid_pending_approval'"), 'payment webhook must move paid campaigns to paid pending approval');
assert(paymentProviderService.includes('requestFlutterwaveRefund'), 'payment provider service must have a Flutterwave refund path');

assert(lifecycleService.includes('advertising_campaign_received'), 'lifecycle service must define Email 1 received template');
assert(lifecycleService.includes('advertising_payment_confirmed'), 'lifecycle service must define Email 2 payment confirmed template');
assert(lifecycleService.includes('advertising_campaign_live'), 'lifecycle service must define Email 3 live template');
assert(lifecycleService.includes('logWhatsAppMessage'), 'lifecycle service must write WhatsApp message log entries');
assert(lifecycleService.includes('logNotification'), 'lifecycle service must write notification log entries');

assert(migration.includes('weekly_impressions'), 'migration must add weekly impression field');
assert(migration.includes('traffic_multiplier'), 'migration must add traffic multiplier field');
assert(migration.includes('self_serve_enabled'), 'migration must add self-serve flag');
assert(migration.includes('homepage_hero_banner'), 'migration must seed homepage hero self-serve placement');
assert(migration.includes('sponsored_search_result'), 'migration must seed sponsored search result placement');
assert(migration.includes('feature_my_listing'), 'migration must seed feature-my-listing placement');
assert(lifecycleMigration.includes('paid_pending_approval'), 'lifecycle migration must add paid pending approval status');
assert(lifecycleMigration.includes('refund_pending'), 'lifecycle migration must add refund pending payment status');

const rateCard = catalog.getAdvertisingRateCard();
assert.strictEqual(rateCard.marker, marker, 'rate card marker must match release marker');
assert.strictEqual(rateCard.payment_gateway_marker, flutterwaveMarker, 'rate card must expose the Flutterwave staging marker');
assert(rateCard.payment_methods.every((item) => String(item.provider || '').includes('flutterwave') || item.provider), 'rate card payment methods must expose a hosted provider');
assert(rateCard.self_serve_placements.length >= 3, 'rate card must expose at least three phase-1 self-serve placements');
['homepage_hero_banner', 'sponsored_search_result', 'feature_my_listing'].forEach((key) => {
  const placement = catalog.findAdvertisingPlacement(key);
  assert(placement, `${key} must be in the placement catalog`);
  assert.strictEqual(placement.self_serve_enabled, true, `${key} must be self-serve enabled`);
  assert(Number(placement.traffic_multiplier) > 0, `${key} must have a traffic multiplier`);
  assert(placement.price_labels?.week, `${key} must expose price labels`);
});

const quote = catalog.buildAdvertisingQuoteBreakdown({
  placementKeys: ['homepage_hero_banner'],
  durationDays: 14
});
assert.strictEqual(quote.pricing_model, 'hybrid', 'quote must use hybrid pricing');
assert(Number(quote.total_ugx) > 0, 'quote must produce a non-zero total');
assert(quote.line_items[0].plain_language.includes('views'), 'quote must include plain-language traffic line');

const submittedEmail = buildAdvertisingLifecycleTemplate('submitted', {
  id: '12345678-aaaa-bbbb-cccc-123456789000',
  advertiser_name: 'QA Advertiser',
  campaign_name: 'QA Campaign',
  package_label: 'Homepage hero banner',
  quoted_amount_ugx: 1008000,
  payment_url: 'https://pay.example/checkout',
  ai_copy: { languages: ['en', 'sw'] }
});
assert.strictEqual(submittedEmail.subject, "We've received your ad - one step left", 'submitted template subject must match the approved copy');
assert(submittedEmail.text.includes('Amount due'), 'submitted template must include amount due');
assert(submittedEmail.whatsapp.includes('Complete payment'), 'submitted WhatsApp fallback must include payment instruction');

const paidEmail = buildAdvertisingLifecycleTemplate('payment_confirmed', {
  id: '12345678-aaaa-bbbb-cccc-123456789000',
  advertiser_name: 'QA Advertiser',
  campaign_name: 'QA Campaign',
  package_label: 'Homepage hero banner',
  paid_amount_ugx: 1008000,
  payment_reference: 'FLW-REF'
}, { method: 'Flutterwave hosted checkout', reference: 'FLW-REF' });
assert.strictEqual(paidEmail.subject, 'Payment confirmed - your ad is now in review', 'payment-confirmed template subject must match the approved copy');
assert(paidEmail.text.includes('Next: we review and approve'), 'payment-confirmed template must explain review step');

function buildAdvertiseSelfServePageSource(source) {
  const start = source.indexOf('function buildAdvertiseSelfServePage()');
  const end = source.indexOf('function openPageMod', start);
  return source.slice(start, end);
}

console.log('advertising-selfserve-v1 test passed');
