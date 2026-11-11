'use strict';

// Public MTN MoMoPay merchant code for makaug. This is meant to be shown to
// anyone paying by Mobile Money; it is not a secret.
//
// How to pay, from MTN Uganda:
// https://www.mtn.co.ug/momo/pay-with-momo/
//   1. Dial *165*3# on your phone
//   2. Select Option 1: Merchant Code
//   3. Enter the merchant code
//   4. Enter the amount
//   5. Confirm the details
//   6. Enter your MoMo PIN

const DEFAULT_MOMO_MERCHANT_CODE = '27248497';
// The registered name on the merchant line (Arthur, 10 Nov 2026: the same name
// as our MoMo line). Billing settings › pay_to.name, or MOMO_MERCHANT_NAME,
// can change it.
const DEFAULT_MOMO_MERCHANT_NAME = 'MAKAUG ONLINE REAL ESTATE LTD';

function momoMerchantCode(env = process.env) {
  const raw = String(env.MOMO_MERCHANT_CODE || DEFAULT_MOMO_MERCHANT_CODE).replace(/\D+/g, '');
  return raw || DEFAULT_MOMO_MERCHANT_CODE;
}

function momoMerchantName(settings = {}, env = process.env) {
  const raw = String(env.MOMO_MERCHANT_NAME || settings?.pay_to?.name || DEFAULT_MOMO_MERCHANT_NAME).replace(/\s+/g, ' ').trim();
  return raw || DEFAULT_MOMO_MERCHANT_NAME;
}

function ugxText(amountUgx) {
  return `UGX ${Math.round(Number(amountUgx || 0)).toLocaleString('en-US')}`;
}

/**
 * How to pay, in one WhatsApp line.
 *
 * WhatsApp turns *text* into bold, so a bare *165*3# arrives as a bold 165
 * followed by 3# — the very code people have to dial, broken. Inside ``` it is
 * shown exactly as typed, stars and all.
 */
function momoWhatsappSteps({ amountUgx = null, env = process.env } = {}) {
  const code = momoMerchantCode(env);
  const amount = Number(amountUgx) > 0 ? `*${ugxText(amountUgx)}*` : 'the amount';
  return `📱 *Pay with MTN MoMo:* dial \`\`\`*165*3#\`\`\`, choose *1* (Merchant Code), enter *${code}*, then ${amount} and your MoMo PIN.`;
}

/**
 * What a payer does after paying. No reference to type (merchant payments do
 * not ask for one): their business name and the number they paid from are how
 * the payment is matched (Arthur, 10 Nov 2026).
 */
function momoAfterPayingLine({ lister = false } = {}) {
  return lister
    ? 'Then reply here with your name (or business name) and we will confirm it.'
    : 'Then reply here with your *business name* and we will confirm it.';
}

function momoPayCopy(env = process.env) {
  const code = momoMerchantCode(env);
  return {
    code,
    heading: 'Pay by Mobile Money',
    label: `MoMo Merchant Code: ${code}`,
    short: `Pay by Mobile Money — MoMo Merchant Code: ${code}`,
    ussd: `MTN MoMo: dial *165*3#, select Option 1 (Merchant Code), enter ${code}, enter the amount, confirm, then your PIN.`,
    sentence: `Pay by Mobile Money — MoMo Merchant Code: ${code} (MTN MoMo: dial *165*3#, select Option 1 (Merchant Code), enter ${code}, enter the amount, confirm, then your PIN).`,
    steps: [
      'Dial *165*3# on your MTN phone.',
      'Select Option 1: Merchant Code.',
      `Enter merchant code ${code}.`,
      'Enter the amount you wish to pay.',
      'Confirm the details.',
      'Enter your MoMo PIN to complete the payment.'
    ],
    source: 'https://www.mtn.co.ug/momo/pay-with-momo/'
  };
}

module.exports = {
  DEFAULT_MOMO_MERCHANT_CODE,
  DEFAULT_MOMO_MERCHANT_NAME,
  momoMerchantCode,
  momoMerchantName,
  momoWhatsappSteps,
  momoAfterPayingLine,
  momoPayCopy
};
