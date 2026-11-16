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

  // The number is logged out of WhatsApp and waiting to be linked again
  // (15 Nov 2026: for six hours and more). A code queued now could only arrive
  // after it had run out, and the person would be told it was on its way. So
  // it is not queued: the email below carries it when there is one, and when
  // there is not, the site is told the code could not be sent.
  const needsLinking = whatsappBridgeEnabled() && typeof whatsappWebBridgeService.whatsappSessionNeedsLinking === 'function'
    ? await whatsappWebBridgeService.whatsappSessionNeedsLinking().catch(() => false)
    : false;
  if (needsLinking) {
    attempts.push(publicAttemptSummary({
      channel: 'whatsapp',
      provider: 'whatsapp_web_bridge',
      status: 'failed',
      reason: 'whatsapp_session_not_linked'
    }));
  }

  // The number only writes to people who have written to it (16 Nov 2026). A
  // code for somebody who never has would wait in the queue until it ran out,
  // and the site would have said it was on its way.
  const mayNotWriteToThem = whatsappBridgeEnabled() && !needsLinking
    && typeof whatsappWebBridgeService.onlyToPeopleWhoWrote === 'function'
    && whatsappWebBridgeService.onlyToPeopleWhoWrote()
    && !(await whatsappWebBridgeService.hasWrittenToUs(recipient).catch(() => false));
  if (mayNotWriteToThem) {
    attempts.push(publicAttemptSummary({
      channel: 'whatsapp',
      provider: 'whatsapp_web_bridge',
      status: 'failed',
      reason: 'they_have_not_written_to_the_number'
    }));
  }

  if (whatsappBridgeEnabled() && !needsLinking && !mayNotWriteToThem) {
    try {
      const queued = await whatsappWebBridgeService.queueWhatsappWebBridgeMessage({
        recipient,
        text: body,
        // Under the name the bridge asks for. Queued as 'otp' it was never
        // handed over: every code "sent to WhatsApp" stayed in the queue.
        source: typeof whatsappWebBridgeService.bridgeCarriedSource === 'function'
          ? whatsappWebBridgeService.bridgeCarriedSource()
          : 'whatsapp_runtime',
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
