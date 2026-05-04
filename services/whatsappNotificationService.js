const twilio = require('twilio');

const logger = require('../config/logger');

let twilioClient = null;

function normalizeUgPhoneForWhatsApp(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('256') && digits.length === 12) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `256${digits.slice(1)}`;
  return digits;
}

function getTwilioClient() {
  if (twilioClient) return twilioClient;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  twilioClient = twilio(sid, token);
  return twilioClient;
}

async function sendViaMetaWhatsApp({ to, body }) {
  const accessToken = String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim();
  const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const apiVersion = String(process.env.WHATSAPP_API_VERSION || 'v20.0').trim();

  if (!accessToken || !phoneNumberId) {
    return { sent: false, reason: 'meta_whatsapp_not_configured' };
  }

  const recipient = normalizeUgPhoneForWhatsApp(to);
  if (!recipient) return { sent: false, reason: 'invalid_recipient' };

  const resp = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'text',
      text: {
        preview_url: true,
        body
      }
    })
  });

  let payload = null;
  try {
    payload = await resp.json();
  } catch (_error) {
    payload = null;
  }

  if (!resp.ok) {
    return {
      sent: false,
      provider: 'meta_whatsapp',
      status: resp.status,
      error: payload?.error?.message || JSON.stringify(payload || {})
    };
  }

  return {
    sent: true,
    provider: 'meta_whatsapp',
    id: payload?.messages?.[0]?.id || null
  };
}

async function sendViaTwilioWhatsApp({ to, body }) {
  const client = getTwilioClient();
  const from = String(
    process.env.TWILIO_WHATSAPP_FROM
      || process.env.TWILIO_FROM_WHATSAPP
      || process.env.WHATSAPP_FROM
      || ''
  ).trim();

  if (!client || !from) return { sent: false, reason: 'twilio_whatsapp_not_configured' };

  const recipient = String(to || '').startsWith('whatsapp:')
    ? String(to)
    : `whatsapp:+${normalizeUgPhoneForWhatsApp(to)}`;
  const sender = from.startsWith('whatsapp:') ? from : `whatsapp:${from}`;

  const result = await client.messages.create({
    from: sender,
    to: recipient,
    body
  });

  return {
    sent: true,
    provider: 'twilio_whatsapp',
    id: result.sid || null,
    status: result.status || 'queued'
  };
}

async function sendWhatsAppText({ to, body }) {
  const recipient = normalizeUgPhoneForWhatsApp(to);
  const message = String(body || '').trim();
  if (!recipient) return { sent: false, reason: 'invalid_recipient' };
  if (!message) return { sent: false, reason: 'empty_body' };

  const metaResult = await sendViaMetaWhatsApp({ to: recipient, body: message });
  if (metaResult.sent) return metaResult;
  if (metaResult.error) logger.warn('Meta WhatsApp send failed', metaResult);

  const twilioResult = await sendViaTwilioWhatsApp({ to: recipient, body: message });
  if (twilioResult.sent) return twilioResult;
  if (twilioResult.error) logger.warn('Twilio WhatsApp send failed', twilioResult);

  logger.info('[WHATSAPP MOCK]', { to: recipient, messageLength: message.length });
  return {
    sent: false,
    mocked: true,
    reason: 'no_whatsapp_provider_configured',
    provider_results: {
      meta: metaResult,
      twilio: twilioResult
    }
  };
}

module.exports = {
  normalizeUgPhoneForWhatsApp,
  sendWhatsAppText
};
