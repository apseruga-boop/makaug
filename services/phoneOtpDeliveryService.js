'use strict';

const smsService = require('../models/smsService');

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

async function sendPhoneOtp({ to, message } = {}) {
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

  return {
    ok: false,
    channel: 'sms',
    failureReason: 'sms_otp_delivery_failed',
    attempts
  };
}

module.exports = {
  isSmsOtpDeliveryConfirmed,
  sendPhoneOtp
};
