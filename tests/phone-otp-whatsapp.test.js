'use strict';

const assert = require('assert');
const db = require('../config/database');
const emailService = require('../services/emailService');
const { isPhoneOtpDeliveryConfirmed, sendPhoneOtp } = require('../services/phoneOtpDeliveryService');
const bridge = require('../services/whatsappWebBridgeService');
const whatsapp = require('../routes/whatsapp');

async function main() {
  const originalQueue = bridge.queueWhatsappWebBridgeMessage;
  const originalEmail = emailService.sendOtpEmail;
  const originalQuery = db.query;
  const previousBridge = process.env.WHATSAPP_WEB_BRIDGE_ENABLED;

  try {
    process.env.WHATSAPP_WEB_BRIDGE_ENABLED = 'true';
    const queued = [];
    bridge.queueWhatsappWebBridgeMessage = async (args) => {
      queued.push(args);
      return { id: 'bridge-row-1', status: 'pending' };
    };

    const result = await sendPhoneOtp({
      to: '+256780863394',
      message: 'makaug.com sign-in verification: your code is 123456. It expires in 10 minutes.',
      email: 'person@example.com',
      otp: '123456',
      expiresMinutes: 10
    });
    assert.strictEqual(result.ok, true, 'bridge-enabled phone OTP should succeed');
    assert.strictEqual(result.channel, 'whatsapp');
    assert.strictEqual(queued.length, 1);
    assert.strictEqual(queued[0].source, 'otp');
    assert.strictEqual(queued[0].actorId, 'system');
    assert.deepStrictEqual(queued[0].metadata, { kind: 'otp' });
    assert.ok(!JSON.stringify(queued[0].metadata).includes('123456'), 'bridge metadata must not store the code');
    assert.ok(String(queued[0].text).includes('123456'), 'the WhatsApp message carries the code');
    assert.strictEqual(isPhoneOtpDeliveryConfirmed(result.delivery), true);

    bridge.queueWhatsappWebBridgeMessage = async () => {
      throw new Error('bridge down');
    };
    let emailed = null;
    emailService.sendOtpEmail = async (args) => {
      emailed = args;
      return { sent: true, provider: 'resend', status: 'sent' };
    };
    const fallback = await sendPhoneOtp({
      to: '+256780863394',
      message: 'your code is 654321',
      email: 'person@example.com',
      otp: '654321',
      expiresMinutes: 10
    });
    assert.strictEqual(fallback.ok, true, 'email fallback should succeed when the bridge fails');
    assert.strictEqual(fallback.channel, 'email');
    assert.strictEqual(emailed.to, 'person@example.com');
    assert.strictEqual(emailed.otp, '654321');

    emailService.sendOtpEmail = originalEmail;
    const noEmail = await sendPhoneOtp({
      to: '+256780863394',
      message: 'your code is 111111',
      otp: '111111'
    });
    assert.strictEqual(noEmail.ok, false);
    assert.strictEqual(noEmail.failureReason, 'phone_otp_delivery_failed');

    assert.strictEqual(whatsapp.__test.whatsappListerPhoneMatchesChat('+256780863394', '0780863394'), true);
    assert.strictEqual(whatsapp.__test.whatsappListerPhoneMatchesChat('256780863394', '+256780863394'), true);
    assert.strictEqual(whatsapp.__test.whatsappListerPhoneMatchesChat('+256780863394', '+256700000000'), false);

    const sqlLog = [];
    db.query = async (sql) => {
      sqlLog.push(String(sql));
      return { rows: [] };
    };
    const skipped = await whatsapp.__test.processMessage('+256780863394', '0780863394', null, null, {
      session: {
        phone: '+256780863394',
        current_step: 'ask_phone',
        language: 'en',
        listing_draft: { title: 'House in Ntinda', listing_type: 'sale' },
        session_data: {}
      }
    });
    assert.ok(!/via SMS|nga SMS|kwa SMS/i.test(skipped.message), skipped.message);
    assert.match(skipped.message, /verified/i);
    assert.notStrictEqual(skipped.nextStep, 'verify_otp');
    assert.ok(!sqlLog.some((sql) => /INSERT INTO otps/i.test(sql)), 'a matching WhatsApp number must not create a code');

    sqlLog.length = 0;
    queued.length = 0;
    bridge.queueWhatsappWebBridgeMessage = async (args) => {
      queued.push(args);
      return { id: 'bridge-row-2' };
    };
    const sent = await whatsapp.__test.processMessage('+256780863394', '+256700111222', null, null, {
      session: {
        phone: '+256780863394',
        current_step: 'ask_phone',
        language: 'en',
        listing_draft: {},
        session_data: {}
      }
    });
    assert.ok(!/via SMS|nga SMS|kwa SMS/i.test(sent.message), sent.message);
    assert.match(sent.message, /WhatsApp/);
    assert.strictEqual(sent.nextStep, 'verify_otp');
    assert.ok(sqlLog.some((sql) => /INSERT INTO otps/i.test(sql)), 'a different phone should still get a code');
    assert.strictEqual(queued.length, 1);
    assert.strictEqual(queued[0].recipient, '+256780863394', 'the code goes back into the same WhatsApp chat');
    assert.deepStrictEqual(queued[0].metadata, { kind: 'otp' });
    assert.ok(String(queued[0].text).includes('makaug listing verification'));
  } finally {
    bridge.queueWhatsappWebBridgeMessage = originalQueue;
    emailService.sendOtpEmail = originalEmail;
    db.query = originalQuery;
    if (previousBridge == null) delete process.env.WHATSAPP_WEB_BRIDGE_ENABLED;
    else process.env.WHATSAPP_WEB_BRIDGE_ENABLED = previousBridge;
  }

  console.log('phone OTP WhatsApp delivery tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
