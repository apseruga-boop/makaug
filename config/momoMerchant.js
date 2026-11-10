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

function momoMerchantCode(env = process.env) {
  const raw = String(env.MOMO_MERCHANT_CODE || DEFAULT_MOMO_MERCHANT_CODE).replace(/\D+/g, '');
  return raw || DEFAULT_MOMO_MERCHANT_CODE;
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
  momoMerchantCode,
  momoPayCopy
};
