'use strict';

const { sendWhatsAppText } = require('../services/whatsappNotificationService');

const countryCode = String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase();
const heartbeatMs = Math.max(15_000, Number(process.env.WHATSAPP_TEST_WORKER_HEARTBEAT_MS || 60_000));

async function start() {
  if (String(process.env.WHATSAPP_DELIVERY_MODE || '').trim().toLowerCase() !== 'test') {
    throw new Error('The WhatsApp test worker requires WHATSAPP_DELIVERY_MODE=test');
  }

  const probeRecipient = countryCode === 'ZA' ? '0820000000' : '0700000000';
  const probe = await sendWhatsAppText({
    to: probeRecipient,
    body: `Test transport startup probe for ${countryCode}`
  });
  if (!probe.sent || !probe.simulated) {
    throw new Error('WhatsApp test transport startup probe did not stay simulated');
  }

  console.log(JSON.stringify({
    event: 'whatsapp_test_worker_ready',
    country_code: countryCode,
    provider: probe.provider,
    simulated: true
  }));

  const timer = setInterval(() => {
    console.log(JSON.stringify({
      event: 'whatsapp_test_worker_heartbeat',
      country_code: countryCode,
      delivery_mode: 'test',
      simulated: true,
      at: new Date().toISOString()
    }));
  }, heartbeatMs);

  const stop = (signal) => {
    clearInterval(timer);
    console.log(JSON.stringify({ event: 'whatsapp_test_worker_stopped', signal }));
    process.exit(0);
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
}

start().catch((error) => {
  console.error(JSON.stringify({ event: 'whatsapp_test_worker_failed', error: error.message }));
  process.exit(1);
});
