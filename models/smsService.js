const twilio = require('twilio');
const logger = require('../config/logger');

let client = null;

function getClient() {
  if (client) return client;

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !token) return null;

  client = twilio(sid, token);
  return client;
}

function getAfricasTalkingConfig() {
  const apiKey = String(process.env.AFRICASTALKING_API_KEY || '').trim();
  const username = String(process.env.AFRICASTALKING_USERNAME || '').trim();
  const senderId = String(process.env.AFRICASTALKING_SENDER_ID || '').trim();
  const baseUrl = String(process.env.AFRICASTALKING_BASE_URL || '').trim()
    || 'https://api.africastalking.com/version1/messaging';

  if (!apiKey || !username) return null;

  return {
    apiKey,
    username,
    senderId,
    baseUrl
  };
}

function summarizeProviderError(error) {
  return String(error?.message || error || 'unknown_error').slice(0, 240);
}

function isRejectedStatus(status = '') {
  return /(fail|reject|invalid|error|undeliver)/i.test(String(status || ''));
}

function getTwilioSmsSender() {
  const explicitSmsSender = String(
    process.env.TWILIO_FROM_SMS
      || process.env.TWILIO_SMS_FROM
      || ''
  ).trim();
  if (explicitSmsSender) return explicitSmsSender;

  const genericSender = String(process.env.TWILIO_FROM || '').trim();
  if (genericSender.toLowerCase().startsWith('whatsapp:')) return '';
  return genericSender;
}

async function sendViaAfricasTalking(to, message, options = {}) {
  const config = getAfricasTalkingConfig();
  if (!config) return null;
  const senderId = Object.prototype.hasOwnProperty.call(options, 'senderId')
    ? String(options.senderId || '').trim()
    : config.senderId;

  const body = new URLSearchParams();
  body.set('username', config.username);
  body.set('to', to);
  body.set('message', message);
  if (senderId) body.set('from', senderId);

  const response = await fetch(config.baseUrl, {
    method: 'POST',
    headers: {
      apiKey: config.apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: body.toString()
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }

  if (!response.ok) {
    const reason = payload?.errorMessage
      || payload?.message
      || `HTTP ${response.status}`;
    const err = new Error(`Africa's Talking SMS failed: ${reason}`);
    err.payload = payload;
    throw err;
  }

  const recipient = payload?.SMSMessageData?.Recipients?.[0] || null;
  if (isRejectedStatus(recipient?.status)) {
    const err = new Error(`Africa's Talking SMS failed: ${recipient.status}`);
    err.payload = payload;
    throw err;
  }
  return {
    provider: "africastalking",
    status: recipient?.status || payload?.SMSMessageData?.Message || 'sent',
    messageId: recipient?.messageId || null,
    raw: payload
  };
}

async function sendSMS(to, message) {
  const failures = [];
  const from = getTwilioSmsSender();
  const twilioClient = getClient();

  if (twilioClient && from) {
    try {
      const result = await twilioClient.messages.create({
        from,
        to,
        body: message
      });

      return {
        provider: "twilio",
        sid: result.sid,
        status: result.status
      };
    } catch (error) {
      failures.push({ provider: 'twilio', error: summarizeProviderError(error) });
      logger.warn('Twilio SMS send failed; trying next SMS provider', {
        to,
        error: summarizeProviderError(error)
      });
    }
  } else if (twilioClient && !from) {
    failures.push({ provider: 'twilio', error: 'twilio_sms_sender_missing' });
  }

  try {
    const africaResult = await sendViaAfricasTalking(to, message);
    if (africaResult) return africaResult;
  } catch (error) {
    failures.push({ provider: 'africastalking', error: summarizeProviderError(error) });
    const config = getAfricasTalkingConfig();
    if (config?.senderId) {
      logger.warn("Africa's Talking SMS send failed with sender ID; retrying without sender ID", {
        to,
        error: summarizeProviderError(error)
      });
      try {
        const retryResult = await sendViaAfricasTalking(to, message, { senderId: '' });
        if (retryResult) {
          return {
            ...retryResult,
            retry: 'without_sender_id'
          };
        }
      } catch (retryError) {
        failures.push({ provider: 'africastalking', retry: 'without_sender_id', error: summarizeProviderError(retryError) });
      }
    }
  }

  if (failures.length) {
    const err = new Error(`SMS delivery failed: ${failures.map((failure) => `${failure.provider}:${failure.error}`).join('; ')}`);
    err.failures = failures;
    throw err;
  }

  logger.info('[SMS MOCK]', { to, messageLength: String(message || '').length });
  return { mocked: true };
}

module.exports = {
  getTwilioSmsSender,
  sendSMS
};
