'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { CODE_DEFAULTS, agentMonthlyUgx, agentTrialDays, publishedPricing } = require('../config/publishedPricing');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const VAT_RE = /incl\.?\s*VAT|VAT\s*incl|vat_inclusive|\bVAT\b/i;

function assertNoVat(label, text) {
  assert(!VAT_RE.test(text), `${label} must not mention VAT`);
}

assert.deepStrictEqual(
  {
    agentMonthlyUgx: CODE_DEFAULTS.agentMonthlyUgx,
    agentTrialDays: CODE_DEFAULTS.agentTrialDays,
    ownerListingMonthlyUgx: CODE_DEFAULTS.ownerListingMonthlyUgx,
    ownerFreeDays: CODE_DEFAULTS.ownerFreeDays,
    shortStayMonthlyUgx: CODE_DEFAULTS.shortStayMonthlyUgx
  },
  { agentMonthlyUgx: 50000, agentTrialDays: 14, ownerListingMonthlyUgx: 20000, ownerFreeDays: 7, shortStayMonthlyUgx: 20000 }
);

const defaults = publishedPricing({});
assert.strictEqual(defaults.currency, 'UGX');
assert.strictEqual(defaults.agent.monthly_ugx, 50000);
assert.strictEqual(defaults.agent.trial_days, 14);
assert.strictEqual(defaults.agent.per, 'month');
assert.strictEqual(defaults.agent.includes_short_stays, true);
assert.strictEqual(defaults.owner_listing.monthly_ugx, 20000);
assert.strictEqual(defaults.owner_listing.free_days, 7);
assert.strictEqual(defaults.owner_listing.per, 'listing');
assert.strictEqual(defaults.short_stay.monthly_ugx, 20000);
assert.strictEqual(defaults.short_stay.free_days, 0);
assert.strictEqual(defaults.short_stay.applies_to, 'non_agent');
assert.strictEqual(defaults.short_stay.included_in_agent_plan, true);
assert.match(defaults.agent.label, /UGX 50,000 a month after 14 days free/);
assert.match(defaults.owner_listing.label, /UGX 20,000 per listing, per month after 7 free days/);
assert.match(defaults.short_stay.label, /UGX 20,000 a month for non-agents/);
assert.match(defaults.short_stay.label, /Included in the agent plan/);
assert.strictEqual(JSON.stringify(defaults).includes('vat'), false);
assertNoVat('published pricing payload', JSON.stringify(defaults));

assert.strictEqual(agentMonthlyUgx({ AGENT_MONTHLY_FEE_UGX: '75000' }), 75000);
assert.strictEqual(agentMonthlyUgx({ AGENT_MONTHLY_FEE_UGX: '0' }), 50000);
assert.strictEqual(agentMonthlyUgx({ AGENT_MONTHLY_FEE_UGX: 'nope' }), 50000);
assert.strictEqual(agentTrialDays({ AGENT_TRIAL_DAYS: '21' }), 21);
assert.strictEqual(agentTrialDays({ AGENT_TRIAL_DAYS: '0' }), 14);
assert.strictEqual(agentTrialDays({ AGENT_TRIAL_DAYS: '400' }), 14);
assert.strictEqual(agentTrialDays({ AGENT_TRIAL_DAYS: 'nope' }), 14);
const overridden = publishedPricing({ AGENT_MONTHLY_FEE_UGX: '60000', AGENT_TRIAL_DAYS: '10' });
assert.strictEqual(overridden.agent.monthly_ugx, 60000);
assert.strictEqual(overridden.agent.trial_days, 10);
assert.strictEqual(overridden.owner_listing.monthly_ugx, 20000);
assert.strictEqual(overridden.short_stay.monthly_ugx, 20000);

const server = read('server.js');
assert(server.includes("app.get('/api/pricing'"), 'GET /api/pricing should publish the rates');
assert(server.includes('return res.status(200).json(publishedPricing())'));
assertNoVat('pricing route', server.slice(server.indexOf("app.get('/api/pricing'"), server.indexOf("app.get('/api/pricing'") + 400));

const surfaces = [
  'config/publishedPricing.js',
  'config/aboutCommercialProducts.js',
  'services/aboutCommercialProductsService.js',
  'services/aboutCommercialRateCardPdfService.js',
  'services/revenueService.js',
  'services/billingOpsService.js',
  'services/listingDocsService.js',
  'index.html',
  'assets/makaug-app.js',
  'assets/about-advertise-i18n.js',
  'assets/makaug-site-i18n.js',
  'assets/short-term.js',
  'assets/short-term-admin.js',
  'packages/shared-country-core/components/footer.html'
];
for (const file of surfaces) assertNoVat(file, read(file));
for (const lang of ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar']) {
  const pack = lang === 'en' ? null : read(`assets/i18n/site-${lang}.json`);
  if (pack) assertNoVat(`site-${lang}.json`, pack);
}

const catalog = require('../config/aboutCommercialProducts');
assert.strictEqual(catalog.version, 'about-commercial-products-20261023-v4');
assert.strictEqual(catalog.products.privateListing.amount, 20000);
assert.strictEqual(catalog.products.privateListing.period, 'listing / month');
assert.strictEqual(catalog.products.privateListing.trialDays, 7);
assert.strictEqual(catalog.products.shortStayListing.amount, 20000);
assert.strictEqual(catalog.products.shortStayListing.includedInAgentPlan, true);
assert.strictEqual(catalog.products.agentSubscription.amount, 50000);
assert.strictEqual(catalog.products.agentSubscription.trialDays, 14);
assert.strictEqual(catalog.products.agentSubscription.includesShortStays, true);

const pdf = read('services/aboutCommercialRateCardPdfService.js');
assert(pdf.includes('7 free days, then per listing'));
assert(pdf.includes('Non-agents; included in the agent plan'));
assert(pdf.includes('14 days free, then monthly. Short stays included'));

const aboutPack = read('assets/about-advertise-i18n.js');
for (const snippet of [
  '{price} oluvannyuma lw\'ennaku 7 eza bwereere',
  '{price} baada ya siku 14 za bure',
  'Yamo katika mpango wa wakala',
  'Malazi ya muda yamejumuishwa'
]) {
  assert(aboutPack.includes(snippet), `about pack missing ${snippet}`);
}

console.log('published pricing checks passed');
