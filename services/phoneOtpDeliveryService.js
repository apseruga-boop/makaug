'use strict';

const smsService = require('../models/smsService');
const { sendWhatsAppText } = require('./whatsappNotificationService');
const {
  isWhatsappWebBridgeEnabled,
  queueWhatsappWebBridgeMessage
} = require('./whatsappWebBridgeService');

function isSmsOtpDeliveryConfirmed(delivery) {
  if (!delivery || delivery.mocked) return false;
  if (delivery.sid || delivery.messageId || delivery.sent === true) return true;

  const status = String(delivery.status || '').trim().toLowerCase();
  if (!status) return false;
  if (/(fail|reject|invalid|error|undeliver)/i.test(status)) return false;
  return ['sent', 'success', 'submitted', 'queued', 'accepted', 'buffered'].includes(status);
}

function publicAttemptSummary(attempt = {}) {
  return {
    channel: attempt.channel || null,
    provider: attempt.provider || null,
    status: attempt.status || null,
    sent: attempt.sent === true,
    queued: attempt.queued === true,
    error: attempt.error || attempt.reason || null
  };
}

function deliveryProvider(delivery = {}) {
  return delivery.provider || (delivery.sid ? 'twilio' : null) || (delivery.messageId ? 'africastalking' : null) || null;
}

async function sendPhoneOtp({ to, message, purpose = 'otp', source = 'phone_otp' } = {}) {
  const recipient = String(to || '').trim();
  const body = String(message || '').trim();
  const attempts = [];

  if (!recipient || !body) {
    return {
      ok: false,
      channel: 'phone',
      failureReason: !recipient ? 'missing_recipient' : 'missing_message',
      attempts
    };
  }

  try {
    const smsDelivery = await smsService.sendSMS(recipient, body);
    attempts.push(publicAttemptSummary({
      channel: 'sms',
      provider: deliveryProvider(smsDelivery),
      status: smsDelivery?.status || (smsDelivery?.mocked ? 'mocked' : null),
      sent: isSmsOtpDeliveryConfirmed(smsDelivery),
      reason: smsDelivery?.reason || null
    }));
    if (isSmsOtpDeliveryConfirmed(smsDelivery)) {
      return {
        ok: true,
        channel: 'sms',
        delivery: smsDelivery,
        attempts
      };
    }
  } catch (error) {
    attempts.push(publicAttemptSummary({
      channel: 'sms',
      provider: 'sms',
      status: 'failed',
      error: error.message
    }));
  }

  try {
    const whatsappDelivery = await sendWhatsAppText({ to: recipient, body });
    attempts.push(publicAttemptSummary({
      channel: 'whatsapp',
      provider: whatsappDelivery?.provider || null,
      status: whatsappDelivery?.status || (whatsappDelivery?.mocked ? 'mocked' : null),
      sent: whatsappDelivery?.sent === true,
      reason: whatsappDelivery?.reason || whatsappDelivery?.error || null
    }));
    if (whatsappDelivery?.sent === true) {
      return {
        ok: true,
        channel: 'whatsapp',
        delivery: whatsappDelivery,
        attempts
      };
    }
  } catch (error) {
    attempts.push(publicAttemptSummary({
      channel: 'whatsapp',
      provider: 'whatsapp_provider',
      status: 'failed',
      error: error.message
    }));
  }

  if (isWhatsappWebBridgeEnabled()) {
    try {
      const queued = await queueWhatsappWebBridgeMessage({
        recipient,
        text: body,
        source,
        actorId: 'system',
        metadata: {
          purpose,
          fallback_from: 'sms_otp'
        }
      });
      const delivery = {
        queued: true,
        provider: 'whatsapp_web_bridge',
        id: queued?.id || null
      };
      attempts.push(publicAttemptSummary({
        channel: 'whatsapp',
        provider: 'whatsapp_web_bridge',
        status: 'queued',
        queued: true
      }));
      return {
        ok: true,
        channel: 'whatsapp',
        delivery,
        attempts
      };
    } catch (error) {
      attempts.push(publicAttemptSummary({
        channel: 'whatsapp',
        provider: 'whatsapp_web_bridge',
        status: 'failed',
        error: error.message
      }));
    }
  }

  return {
    ok: false,
    channel: 'phone',
    failureReason: 'phone_otp_delivery_failed',
    attempts
  };
}

module.exports = {
  isSmsOtpDeliveryConfirmed,
  sendPhoneOtp
};
