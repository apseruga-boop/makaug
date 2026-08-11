'use strict';

const assert = require('assert');

const originalCountry = process.env.COUNTRY_CODE;
const originalMode = process.env.WHATSAPP_DELIVERY_MODE;

process.env.COUNTRY_CODE = 'ZA';
process.env.WHATSAPP_DELIVERY_MODE = 'test';

const {
  normalizeUgPhoneForWhatsApp,
  sendWhatsAppText
} = require('../services/whatsappNotificationService');

async function run() {
  assert.equal(normalizeUgPhoneForWhatsApp('082 123 4567'), '27821234567');
  assert.equal(normalizeUgPhoneForWhatsApp('+27 82 123 4567'), '27821234567');

  const delivery = await sendWhatsAppText({
    to: '082 123 4567',
    body: 'Find a reviewed rental in Sea Point, Cape Town.'
  });
  assert.equal(delivery.sent, true);
  assert.equal(delivery.simulated, true);
  assert.equal(delivery.provider, 'whatsapp_test_transport');
  assert.match(delivery.id, /^wa-test-[a-f0-9]{20}$/);

  console.log('south-africa WhatsApp test transport tests passed');
}

run()
  .finally(() => {
    if (originalCountry === undefined) delete process.env.COUNTRY_CODE;
    else process.env.COUNTRY_CODE = originalCountry;
    if (originalMode === undefined) delete process.env.WHATSAPP_DELIVERY_MODE;
    else process.env.WHATSAPP_DELIVERY_MODE = originalMode;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
