'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_MOMO_MERCHANT_CODE, momoMerchantCode, momoPayCopy } = require('../config/momoMerchant');
const { publishedPricing } = require('../config/publishedPricing');
const { openView } = require('../routes/pay');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('the merchant code is a public fallback that env can override', () => {
  assert.strictEqual(DEFAULT_MOMO_MERCHANT_CODE, '27248497');
  assert.strictEqual(momoMerchantCode({}), '27248497');
  assert.strictEqual(momoMerchantCode({ MOMO_MERCHANT_CODE: '  11122233  ' }), '11122233');
  assert.strictEqual(momoMerchantCode({ MOMO_MERCHANT_CODE: 'abc' }), '27248497');
});

test('published pricing exposes the merchant code and MTN USSD steps', () => {
  const pricing = publishedPricing({});
  assert.strictEqual(pricing.momo.merchant_code, '27248497');
  assert.match(pricing.momo.ussd, /\*165\*3#/);
  assert.match(pricing.momo.ussd, /Option 1/);
  assert.match(pricing.momo.sentence, /MoMo Merchant Code: 27248497/);
});

test('the pay page shows the merchant code even when no phone number is set', () => {
  const html = openView({
    code: 'MKTEST1',
    description: 'makaug agent subscription — 1 month',
    amount_ugx_text: 'UGX 50,000',
    card_available: false,
    card_text: '',
    pay_to: {},
    pay_to_ready: false,
    momo: momoPayCopy({})
  });
  assert.match(html, /27248497/);
  assert.match(html, /\*165\*3#/);
  assert.match(html, /Option 1: Merchant Code/);
  assert.match(html, /data-momo-copy="27248497"/);
  assert.match(html, /Copy merchant code/);
  assert.doesNotMatch(html, /Send <strong>UGX 50,000<\/strong> to/);
});

// Arthur, 10 Nov 2026: "merchant code only". The old number stays our WhatsApp
// (the page footer), but nobody is told to send money to it, and no reference
// is asked for: a merchant payment does not ask for one.
test('the pay page is merchant code only: no number to send money to, no reference', () => {
  const html = openView({
    code: 'MKTEST1',
    description: 'makaug listing — 1 month',
    amount_ugx_text: 'UGX 20,000',
    card_available: false,
    card_text: '',
    pay_to: { number: '256780863394', name: 'MAKAUG ONLINE REAL ESTATE LTD' },
    pay_to_ready: true,
    momo: momoPayCopy({}),
    person_payer: true,
    payer_phone_hint: '0772 000 001'
  });
  assert.match(html, /27248497/);
  assert.match(html, /MAKAUG ONLINE REAL ESTATE LTD/);
  assert.doesNotMatch(html, /You can also send/);
  assert.doesNotMatch(html, /reason or reference/);
  assert.doesNotMatch(html, /Reference MKTEST1/);
  assert.match(html, /name="business_name"/);
  assert.match(html, /Your name \(or business name\)/);
  assert.match(html, /value="0772 000 001"/);
  assert.match(html, /Transaction ID <span class="optional">\(optional\)<\/span>/);
});

test('public pages and the staff billing view mention the merchant code', () => {
  const index = read('index.html');
  assert.match(index, /data-momo-pay-box/);
  assert.match(index, /id="footer-momo-pay"/);
  assert.match(index, /27248497/);
  const app = read('assets/makaug-app.js');
  assert.match(app, /function momoMerchantCode/);
  assert.match(app, /Share MoMo Merchant Code/);
  const st = read('assets/short-term.js');
  assert.match(st, /listMomoPay/);
  const docs = read('services/listingDocsService.js');
  assert.match(docs, /momoPayCopy\(\)\.sentence/);
});

test('WhatsApp payment messages carry the merchant code and ask for the business name', () => {
  const billing = require('../services/billingOpsService');
  const { payLinkMessage } = require('../services/payLinkService');
  assert.strictEqual(billing.payToLine({}), 'MTN MoMo merchant code *27248497* (MAKAUG ONLINE REAL ESTATE LTD)');
  const reminder = billing.buildAgentBillingMessage('reminder', { agent: { full_name: 'Jane Nakato' }, settings: { agent_fee: { monthly_ugx: 50000 } }, payLink: 'https://makaug.com/pay/MKAB12CD' });
  assert.match(reminder, /```\*165\*3#```/, 'in monospace, so WhatsApp does not turn *165* bold and eat the stars');
  assert.match(reminder, /enter \*27248497\*, then \*UGX 50,000\*/);
  assert.match(reminder, /business name/);
  assert.doesNotMatch(reminder, /transaction ID|0780|reference/i);
  const link = payLinkMessage({ payer_name: 'Jane Nakato', description: 'makaug agent subscription — 1 month', amount_ugx: 50000, code: 'MKAB12CD', purpose: 'agent_subscription' });
  assert.match(link, /27248497/);
  assert.match(link, /MAKAUG ONLINE REAL ESTATE LTD/);
  assert.doesNotMatch(link, /card, Apple Pay/, 'card is only offered when the page can take it');
});
