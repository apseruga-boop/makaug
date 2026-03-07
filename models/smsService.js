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

async function sendSMS(to, message) {
  const from = process.env.TWILIO_FROM_SMS;
  const twilioClient = getClient();

  if (!twilioClient || !from) {
    logger.info('[SMS MOCK]', { to, message });
    return { mocked: true };
  }

  const result = await twilioClient.messages.create({
    from,
    to,
    body: message
  });

  return {
    sid: result.sid,
    status: result.status
  };
}

module.exports = {
  sendSMS
};
