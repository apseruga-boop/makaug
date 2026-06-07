const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  buildAdvertisingQuoteBreakdown,
  buildWhatsAppAdvertisingSummary,
  getAdvertisingRateCard
} = require('../services/advertisingCatalogService');
const { normalizePaymentStatus, paymentProviderConfigured } = require('../services/paymentProviderService');

const root = path.join(__dirname, '..');
const advertisingRoutes = fs.readFileSync(path.join(root, 'routes', 'advertising.js'), 'utf8');
const adminRoutes = fs.readFileSync(path.join(root, 'routes', 'admin.js'), 'utf8');
const whatsappRoutes = fs.readFileSync(path.join(root, 'routes', 'whatsapp.js'), 'utf8');
const aiService = fs.readFileSync(path.join(root, 'services', 'aiService.js'), 'utf8');
const frontend = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const paymentService = fs.readFileSync(path.join(root, 'services', 'paymentProviderService.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'db', 'migrations', '059_advertising_launch_rate_card.sql'), 'utf8');

const rateCard = getAdvertisingRateCard();
assert.strictEqual(rateCard.currency, 'UGX', 'rate card should price in Ugandan shillings');
assert.strictEqual(rateCard.payment.primary_provider, 'paypal', 'PayPal should be the launch ad payment provider');
assert(rateCard.creative_guidelines.prompt_template.includes('Required image size'), 'creative prompt should enforce image size');
assert(rateCard.placements.some((slot) => slot.key === 'homepage_hero_sponsor' && slot.price_labels.week.includes('350,000')), 'homepage weekly rate should be public');
assert(rateCard.placements.some((slot) => slot.key === 'whatsapp_bulk_audience' && slot.manual_quote_required), 'WhatsApp bulk audience slot should exist');
assert(rateCard.placements.every((slot) => slot.price_labels.day && slot.price_labels.week && slot.price_labels.cpm), 'every placement should expose day/week/CPM labels');

const quote = buildAdvertisingQuoteBreakdown({
  placementKeys: ['homepage_hero_sponsor'],
  durationDays: 7,
  impressions: 10000
});
assert(quote.total_ugx > 350000, 'quote should add CPM impression pricing when impressions are requested');
assert(quote.total_label.includes('UGX') && quote.total_label.includes('USD'), 'quote should show UGX and USD guide');

const whatsappSummary = buildWhatsAppAdvertisingSummary();
assert(whatsappSummary.includes('Rate card: https://makaug.com/advertise'), 'WhatsApp ad reply should link to the public rate card');
assert(whatsappSummary.includes('PayPal payment links'), 'WhatsApp ad reply should explain PayPal next step');
assert(whatsappSummary.includes('approved opt-in segments'), 'WhatsApp bulk campaigns should be presented as opt-in only');
assert(whatsappSummary.includes('info@makaug.com'), 'WhatsApp ad reply should include email fallback');

for (const expected of [
  "router.get('/rate-card'",
  "router.post('/quote'",
  "preferredPaymentProvider()",
  "PAYPAL_PAYMENT_LINK_BASE_URL"
]) {
  assert(advertisingRoutes.includes(expected), `advertising route missing ${expected}`);
}

for (const expected of [
  "router.get('/advertising/rate-card'",
  'mergePlacementWithCatalog',
  'buildAdvertisingQuoteBreakdown'
]) {
  assert(adminRoutes.includes(expected), `admin advertising route missing ${expected}`);
}

for (const expected of [
  'advertising_campaign',
  'whatsapp_advertising',
  'advertisingWhatsAppReply',
  'buildWhatsAppAdvertisingSummary',
  'PayPal payment link'
]) {
  assert(whatsappRoutes.includes(expected), `WhatsApp advertising flow missing ${expected}`);
}

assert(aiService.includes("'advertising_campaign'"), 'AI intent list should include advertising_campaign');
assert(aiService.includes('rate-card questions'), 'AI classifier prompt should distinguish paid rate-card ads from free listing');

assert(frontend.includes('/api/advertising/rate-card'), 'public advertise page should hydrate live rate-card API');
assert(frontend.includes('Creative prompt starter'), 'public advertise page should show creative prompt guidance');
assert(frontend.includes('adminCopyAdPrompt'), 'admin placement card should copy prompt starter');
assert(frontend.includes('Opt-in WhatsApp bulk audience campaign'), 'public WhatsApp bulk option should be labelled opt-in');
assert(frontend.includes('PayPal payment link'), 'frontend should explain PayPal payment flow');
assert(indexHtml.includes('about.adsTitle'), 'About page should include advertising pricing transparency section');

assert(paymentService.includes('PAYPAL_CLIENT_ID') && paymentService.includes('extractPaymentWebhookReference'), 'payment provider should parse PayPal-style webhook references');
assert.strictEqual(normalizePaymentStatus('PAYMENT.CAPTURE.COMPLETED'), 'paid', 'PayPal completed capture should normalize to paid');
assert.strictEqual(typeof paymentProviderConfigured(), 'boolean', 'payment provider configured helper should return a boolean');

assert(migration.includes('whatsapp_bulk_audience') && migration.includes('homepage_hero_sponsor'), 'launch rate-card migration should seed homepage and WhatsApp bulk slots');

console.log('Advertising rate-card and WhatsApp advertising tests passed');
process.exit(0);
