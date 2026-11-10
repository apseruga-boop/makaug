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

test('the pay page keeps a configured phone number as a secondary option', () => {
  const html = openView({
    code: 'MKTEST1',
    description: 'makaug listing — 1 month',
    amount_ugx_text: 'UGX 20,000',
    card_available: false,
    card_text: '',
    pay_to: { number: '256780863394', name: 'MAKAUG ONLINE REAL ESTATE LTD' },
    pay_to_ready: true,
    momo: momoPayCopy({})
  });
  assert.match(html, /27248497/);
  assert.match(html, /You can also send/);
  assert.match(html, /0780 863394/);
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

test('WhatsApp sending templates were left for Claude, not rewritten here', () => {
  const billing = read('services/billingOpsService.js');
  assert.match(billing, /Pay \$\{ugx\(fee\)\} to \$\{pay\}, then reply here with the \*transaction ID\*/);
  const payLinks = read('services/payLinkService.js');
  assert.match(payLinks, /Pay by card, Apple Pay or Google Pay, or by MTN Mobile Money — whichever is easier/);
  assert.doesNotMatch(payLinks, /function payLinkMessage[\s\S]*27248497/);
});
