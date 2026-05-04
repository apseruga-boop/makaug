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

async function sendViaAfricasTalking(to, message) {
  const config = getAfricasTalkingConfig();
  if (!config) return null;

  const body = new URLSearchParams();
  body.set('username', config.username);
  body.set('to', to);
  body.set('message', message);
  if (config.senderId) body.set('from', config.senderId);

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
  return {
    provider: "africastalking",
    status: recipient?.status || payload?.SMSMessageData?.Message || 'sent',
    messageId: recipient?.messageId || null,
    raw: payload
  };
}

async function sendSMS(to, message) {
  const from = process.env.TWILIO_FROM_SMS || process.env.TWILIO_FROM;
  const twilioClient = getClient();

  if (twilioClient && from) {
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
  }

  const africaResult = await sendViaAfricasTalking(to, message);
  if (africaResult) return africaResult;

  logger.info('[SMS MOCK]', { to, messageLength: String(message || '').length });
  return { mocked: true };
}

module.exports = {
  sendSMS
};
