'use strict';

// PR G8: every consumer reads the rate card (config/pricing.js), and the
// database never overrides an amount.

process.env.COUNTRY_CODE = 'UG';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { PDFParse } = require('pdf-parse');

const PRICING = require('../config/pricing');
const db = require('../config/database');
const logger = require('../config/logger');
const docs = require('../services/listingDocsService');
const billingOps = require('../services/billingOpsService');
const catalog = require('../services/advertisingCatalogService');

const ROOT = path.join(__dirname, '..');
const DRIFTED = { lister_fee: { monthly_ugx: 25000, free_days: 7 }, agent_fee: { monthly_ugx: 50000 }, pay_to: { method: 'MTN Mobile Money', number: '0780 000000', name: 'TEST' } };
const LISTER = PRICING.ugx(PRICING.private_listing.amount_ugx);
const TAG = `prc${crypto.randomBytes(3).toString('hex')}`;
const createdProperties = [];

async function pdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    return (await parser.getText()).text.replace(/\s+/g, ' ');
  } finally {
    await parser.destroy?.();
  }
}

let child;
let base;
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

let savedListerFee = null;
test.before(async () => {
  savedListerFee = (await db.query(`SELECT value FROM billing_settings WHERE key = 'lister_fee'`)).rows[0]?.value || null;
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), NODE_ENV: process.env.NODE_ENV || 'test', MEMORY_LOG: 'off' },
    stdio: ['ignore', 'ignore', 'ignore']
  });
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch (_) {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not start');
});

test.after(async () => {
  if (child) child.kill('SIGTERM');
  await db.query('DELETE FROM pay_links WHERE property_id = ANY($1::uuid[])', [createdProperties]).catch(() => {});
  await db.query('DELETE FROM revenue_entries WHERE property_id = ANY($1::uuid[])', [createdProperties]).catch(() => {});
  await db.query('DELETE FROM properties WHERE id = ANY($1::uuid[])', [createdProperties]).catch(() => {});
  if (savedListerFee) {
    await db.query(`UPDATE billing_settings SET value = $1::jsonb WHERE key = 'lister_fee'`, [JSON.stringify(savedListerFee)]).catch(() => {});
  } else {
    await db.query(`DELETE FROM billing_settings WHERE key = 'lister_fee'`).catch(() => {});
  }
  await db.pool?.end?.().catch?.(() => {});
});

const get = (p) => fetch(base + p);

test('with lister_fee 25000 in the database, every lister surface says the rate-card fee', async () => {
  const terms = await pdfText((await docs.getDocument('lister_terms_pdf', DRIFTED)).body);
  assert.match(terms, new RegExp(`${LISTER} per property`));
  assert.doesNotMatch(terms, /UGX 25,000/);
  assert.match(terms, /Prices include VAT/);
  const guide = await pdfText((await docs.getDocument('agent_guide_pdf', DRIFTED)).body);
  assert.match(guide, /Prices include VAT/);
  assert.match(guide, new RegExp(PRICING.ugx(PRICING.agent_subscription.amount_ugx)));
  assert.equal(docs.LISTER_TERMS_VERSION, '2026-10-v2');
  assert.equal(docs.AGENT_GUIDE_VERSION, '2026-10-v2');

  assert.match(docs.listerTermsMessage(DRIFTED), new RegExp(LISTER));
  assert.doesNotMatch(docs.listerTermsMessage(DRIFTED), /25,000/);

  // Approval message to the owner.
  const moderation = require('../services/listingModerationService');
  const approval = moderation.buildOwnerStatusMessage({
    listing: { id: crypto.randomUUID(), title: 'Test', extra_fields: { lister_terms_accepted_at: new Date().toISOString(), lister_fee_terms: { free_days: 7, monthly_ugx: 25000 } } },
    status: 'approved'
  });
  assert.match(approval.whatsapp, new RegExp(LISTER));
  assert.doesNotMatch(approval.whatsapp, /25,000/);

  // Reminder messages.
  for (const kind of ['reminder', 'final_reminder', 'taken_down']) {
    const text = await billingOps.buildListerMessage(db, kind, { id: crypto.randomUUID(), title: 'Test', lister_name: 'Ann', created_at: new Date() }, DRIFTED, '');
    assert.match(text, new RegExp(LISTER), kind);
  }
});

test('pay link default and recordListingPayment use the rate card', async () => {
  const id = crypto.randomUUID();
  createdProperties.push(id);
  await db.query(
    `INSERT INTO properties (id, listing_type, title, description, district, area, price, status, moderation_stage, lister_name, lister_phone, lister_type, listed_via, source)
     VALUES ($1, 'rent', $2, 'x', 'Kampala', 'Ntinda', 1000000, 'approved', 'approved', 'Ann', '256700123987', 'owner', 'website', 'website')`,
    [id, `${TAG} pay link`]
  );
  await db.query(`INSERT INTO billing_settings (key, value, updated_by) VALUES ('lister_fee', $1::jsonb, 'test')
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(DRIFTED.lister_fee)]);
  const payLinks = require('../services/payLinkService');
  const link = await payLinks.createPayLink(db, { purpose: 'listing_fee', property_id: id }, 'test');
  assert.equal(Number(link.link?.amount_ugx ?? link.amount_ugx), PRICING.private_listing.amount_ugx);
  const result = await billingOps.recordListingPayment(db, {
    propertyId: id,
    payment: { amount: PRICING.private_listing.amount_ugx, method: 'mtn_momo', reference: `${TAG}REF1`, payer_name: 'Ann' },
    actor: 'test'
  });
  assert.equal(result.months, 1, 'a rate-card payment buys one month even with 25000 in the database');
});

test('a pricing_drift error is logged when billing_settings disagrees', async () => {
  const errors = [];
  const original = logger.error;
  logger.error = (message, meta) => { errors.push({ message, meta }); };
  try {
    const fakeDb = { query: async () => ({ rows: [{ key: 'lister_fee', value: { monthly_ugx: 25000 } }] }) };
    const drift = await billingOps.logPricingDriftOnce(fakeDb, { force: true });
    assert.deepEqual(drift, [{ key: 'lister_fee', field: 'monthly_ugx', stored: 25000, rate_card: PRICING.private_listing.amount_ugx }]);
  } finally {
    logger.error = original;
  }
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /pricing_drift/);
  // Saving a fee setting keeps only operational knobs.
  assert.deepEqual(billingOps.operationalSettingValue('lister_fee', { monthly_ugx: 25000, free_days: 3, views_message_day: 3 }), { views_message_day: 3 });
});

test('"Prices include VAT" on /about, /advertise, the rate-card PDF and the pay page', async () => {
  for (const page of ['/about', '/advertise']) {
    assert.match(await (await get(page)).text(), /Prices include VAT/, page);
  }
  const rateCard = await get('/about/rate-card.pdf');
  assert.equal(rateCard.headers.get('x-makaug-rate-card-version'), PRICING.version);
  const pdf = await pdfText(Buffer.from(await rateCard.arrayBuffer()));
  assert.match(pdf, new RegExp(`Rate card ${PRICING.version}\\. Prices include VAT\\.`));
  assert.match(pdf, /Price on request/);
  assert.doesNotMatch(pdf, /VAT treatment should be confirmed/);
  const pay = require('fs').readFileSync(path.join(ROOT, 'routes/pay.js'), 'utf8');
  assert.match(pay, /<div class="ref">\$\{esc\(PRICING\.vat\.label\)\}<\/div>/);
  const about = await (await get('/about')).text();
  assert.match(about, /USh 150,000 \/ project \/ 3 months|UGX 150,000 \/ project \/ 3 months/);
  assert.doesNotMatch(about, /\/ post\b|UGX 40,000/);
});

test('/api/advertising: featured 50,000 / 7 days, no blast, the weekly display rule, 10% off 28 days', async () => {
  const packages = (await (await get('/api/advertising/packages')).json()).data;
  const featured = packages.find((p) => p.key === 'featured_property_boost');
  assert.equal(featured.price_ugx, PRICING.featured.amount_ugx);
  assert.equal(featured.duration_days, 7);
  assert.ok(!packages.some((p) => p.key === 'email_whatsapp_blast'));
  for (const p of packages) {
    if (p.quote_on_request) { assert.equal(p.price_ugx, null, p.key); continue; }
    const weekly = p.price_ugx / (p.duration_days / 7);
    assert.ok(weekly >= PRICING.display.min_weekly_ugx && weekly <= PRICING.display.max_weekly_ugx, `${p.key} ${weekly}`);
  }
  const placements = (await (await get('/api/advertising/placements')).json()).data;
  assert.equal(placements.filter((p) => p.base_price_ugx != null && (p.base_price_ugx > 200000 || p.base_price_ugx < 50000)).length, 0);
  const quote = catalog.buildAdvertisingQuoteBreakdown({ placementKeys: ['sale-grid'], durationDays: 28 });
  assert.equal(quote.discount_ugx, Math.round(quote.subtotal_ugx * 0.1));
  assert.ok(quote.lines.some((line) => line.kind === 'discount'));
  assert.equal(catalog.buildAdvertisingQuoteBreakdown({ placementKeys: ['sale-grid'], durationDays: 21 }).discount_ugx, 0);
  // An old enquiry that picked the removed blast still renders.
  assert.deepEqual(catalog.summarizeAdvertisingPackageKeys(['email_whatsapp_blast']), []);
});

test('/api/pricing, /api/monetization/config and /api/marketplace/config', async () => {
  const pricingRes = await get('/api/pricing');
  assert.equal(pricingRes.headers.get('cache-control'), 'public, max-age=300');
  const pricing = (await pricingRes.json()).data;
  assert.equal(pricing.private_listing.amount_ugx, PRICING.private_listing.amount_ugx);
  assert.equal(pricing.featured.amount_ugx, PRICING.featured.amount_ugx);
  assert.equal(pricing.off_plan.period, 'project / 3 months');
  assert.equal(pricing.vat.label, 'Prices include VAT');
  assert.equal(pricing.off_sale, undefined);
  assert.ok(!JSON.stringify(pricing).includes('marketplace_verified'));
  const monetization = await (await get('/api/monetization/config')).text();
  assert.doesNotMatch(monetization, /free_default|Free by default|agent_pro_monthly|featured_lender_monthly/);
  const marketplace = (await (await get('/api/marketplace/config')).json()).data;
  assert.deepEqual(marketplace.verified_pricing, { active: false });
});

test('the AI prompt carries the rate card and nothing off sale', () => {
  const block = PRICING.aiPriceBlock();
  assert.match(block, /Prices include VAT/);
  assert.doesNotMatch(block, /Agent Pro|lender slot|blast|Marketplace Verified/i);
  const ai = require('fs').readFileSync(path.join(ROOT, 'services/aiService.js'), 'utf8');
  assert.match(ai, /\$\{PRICING\.aiPriceBlock\(\)\}/);
});
