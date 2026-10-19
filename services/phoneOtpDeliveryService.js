'use strict';

const emailService = require('./emailService');
const whatsappWebBridgeService = require('./whatsappWebBridgeService');

function isSmsOtpDeliveryConfirmed(delivery) {
  if (!delivery || delivery.mocked) return false;
  if (delivery.queued === true) return true;
  if (delivery.sid || delivery.messageId || delivery.sent === true) return true;

  const status = String(delivery.status || '').trim().toLowerCase();
  if (!status) return false;
  if (/(fail|reject|invalid|error|undeliver)/i.test(status)) return false;
  return ['sent', 'success', 'submitted', 'queued', 'accepted', 'buffered'].includes(status);
}

const isPhoneOtpDeliveryConfirmed = isSmsOtpDeliveryConfirmed;

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

function whatsappBridgeEnabled() {
  return String(process.env.WHATSAPP_WEB_BRIDGE_ENABLED || '').trim().toLowerCase() === 'true';
}

function otpDigitsFromMessage(message = '') {
  const match = String(message || '').match(/\b(\d{6})\b/);
  return match ? match[1] : '';
}

function emailDeliveryConfirmed(delivery) {
  return delivery?.sent === true && delivery?.mocked !== true;
}

async function sendPhoneOtp({ to, message, email, otp, expiresMinutes } = {}) {
  const recipient = String(to || '').trim();
  const body = String(message || '').trim();
  const fallbackEmail = String(email || '').trim();
  const code = String(otp || '').trim() || otpDigitsFromMessage(body);
  const minutes = Math.max(parseInt(expiresMinutes || process.env.OTP_EXPIRES_MINUTES || '10', 10) || 10, 1);
  const attempts = [];

  if (!recipient || !body) {
    return {
      ok: false,
      channel: 'phone',
      failureReason: !recipient ? 'missing_recipient' : 'missing_message',
      attempts
    };
  }

  if (whatsappBridgeEnabled()) {
    try {
      const queued = await whatsappWebBridgeService.queueWhatsappWebBridgeMessage({
        recipient,
        text: body,
        source: 'otp',
        actorId: 'system',
        metadata: { kind: 'otp' }
      });
      if (queued) {
        const delivery = {
          provider: 'whatsapp_web_bridge',
          status: 'queued',
          queued: true,
          id: queued.id || null
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
      }
      attempts.push(publicAttemptSummary({
        channel: 'whatsapp',
        provider: 'whatsapp_web_bridge',
        status: 'failed',
        reason: 'not_queued'
      }));
    } catch (error) {
      attempts.push(publicAttemptSummary({
        channel: 'whatsapp',
        provider: 'whatsapp_web_bridge',
        status: 'failed',
        error: error.message
      }));
    }
  }

  if (fallbackEmail && code) {
    try {
      const emailDelivery = await emailService.sendOtpEmail({
        to: fallbackEmail,
        subject: 'makaug.com verification code',
        otp: code,
        expiresMinutes: minutes,
        purpose: 'account',
        intro: 'Use this makaug.com code to continue securely.',
        footer: 'Enter the code on makaug.com. Do not share it with anyone.'
      });
      attempts.push(publicAttemptSummary({
        channel: 'email',
        provider: emailDelivery?.provider || 'email',
        status: emailDelivery?.status || (emailDeliveryConfirmed(emailDelivery) ? 'sent' : 'failed'),
        sent: emailDeliveryConfirmed(emailDelivery),
        reason: emailDelivery?.reason || emailDelivery?.error || null
      }));
      if (emailDeliveryConfirmed(emailDelivery)) {
        return {
          ok: true,
          channel: 'email',
          delivery: emailDelivery,
          attempts
        };
      }
    } catch (error) {
      attempts.push(publicAttemptSummary({
        channel: 'email',
        provider: 'email',
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
  isPhoneOtpDeliveryConfirmed,
  sendPhoneOtp
};
