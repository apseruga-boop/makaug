const logger = require('../config/logger');

function getSupportEmail() {
  return process.env.SUPPORT_EMAIL || 'info@makaug.com';
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

let smtpTransporter = null;
let msGraphTokenCache = {
  token: null,
  expiresAt: 0
};

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = String(value || '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

function getSmtpConfig() {
  const host = String(process.env.SMTP_HOST || '').trim();
  if (!host) return null;

  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();
  const secure = parseBoolean(process.env.SMTP_SECURE, port === 465);
  const requireAuth = parseBoolean(process.env.SMTP_REQUIRE_AUTH, true);
  const rejectUnauthorized = parseBoolean(process.env.SMTP_TLS_REJECT_UNAUTHORIZED, true);

  return {
    host,
    port: Number.isFinite(port) ? port : 587,
    secure,
    user,
    pass,
    requireAuth,
    rejectUnauthorized
  };
}

function extractEmailAddress(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/<([^>]+)>/);
  return (match?.[1] || raw).trim().toLowerCase();
}

function getMicrosoftGraphConfig() {
  const tenantId = String(process.env.MS_GRAPH_TENANT_ID || process.env.M365_TENANT_ID || '').trim();
  const clientId = String(process.env.MS_GRAPH_CLIENT_ID || process.env.AZURE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.MS_GRAPH_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET || '').trim();
  const sender = String(
    process.env.MS_GRAPH_SENDER_EMAIL
      || process.env.M365_SENDER_EMAIL
      || process.env.SMTP_USER
      || extractEmailAddress(process.env.EMAIL_FROM)
      || ''
  ).trim().toLowerCase();

  if (!tenantId || !clientId || !clientSecret || !sender) return null;

  return {
    tenantId,
    clientId,
    clientSecret,
    sender
  };
}

async function getMicrosoftGraphToken(config) {
  const now = Date.now();
  if (msGraphTokenCache.token && msGraphTokenCache.expiresAt > (now + 30_000)) {
    return msGraphTokenCache.token;
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ms_graph_token_error_${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  const token = String(data?.access_token || '');
  const expiresInSec = Number.parseInt(String(data?.expires_in || '3000'), 10) || 3000;
  if (!token) {
    throw new Error('ms_graph_token_missing');
  }

  msGraphTokenCache = {
    token,
    expiresAt: now + Math.max(60, expiresInSec - 60) * 1000
  };

  return token;
}

async function sendViaMicrosoftGraph({ to, subject, text, html, replyTo }) {
  const config = getMicrosoftGraphConfig();
  if (!config) return { sent: false, reason: 'ms_graph_not_configured' };

  try {
    const accessToken = await getMicrosoftGraphToken(config);
    const bodyHtml = html || `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap;">${text}</pre>`;
    const endpoint = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.sender)}/sendMail`;

    const payload = {
      message: {
        subject,
        body: {
          contentType: 'HTML',
          content: bodyHtml
        },
        toRecipients: [
          {
            emailAddress: { address: to }
          }
        ]
      },
      saveToSentItems: false
    };

    if (replyTo) {
      payload.message.replyTo = [{ emailAddress: { address: replyTo } }];
    }

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      return {
        sent: false,
        provider: 'ms_graph',
        status: resp.status,
        error: errorText
      };
    }

    return { sent: true, provider: 'ms_graph' };
  } catch (error) {
    return {
      sent: false,
      provider: 'ms_graph',
      error: error.message || 'ms_graph_send_failed'
    };
  }
}

function getSmtpTransporter() {
  if (smtpTransporter) return smtpTransporter;
  const config = getSmtpConfig();
  if (!config) return null;

  let nodemailer = null;
  try {
    // Lazy-load so local dev doesn't crash when SMTP isn't used.
    // eslint-disable-next-line global-require
    nodemailer = require('nodemailer');
  } catch (error) {
    logger.warn('nodemailer is not installed; SMTP email disabled');
    return null;
  }

  const transportOptions = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    tls: {
      rejectUnauthorized: config.rejectUnauthorized
    }
  };

  if (config.requireAuth) {
    if (!config.user || !config.pass) return null;
    transportOptions.auth = {
      user: config.user,
      pass: config.pass
    };
  }

  smtpTransporter = nodemailer.createTransport(transportOptions);
  return smtpTransporter;
}

async function sendViaSmtp({ to, subject, text, html, replyTo }) {
  const transporter = getSmtpTransporter();
  if (!transporter) return { sent: false, reason: 'smtp_not_configured' };

  const from = process.env.EMAIL_FROM || 'MakaUg <noreply@makaug.com>';
  const message = {
    from,
    to,
    subject,
    text,
    html: html || `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap;">${text}</pre>`
  };
  if (replyTo) message.replyTo = replyTo;

  try {
    const info = await transporter.sendMail(message);
    return {
      sent: true,
      provider: 'smtp',
      id: info?.messageId || null,
      accepted: info?.accepted || []
    };
  } catch (error) {
    return {
      sent: false,
      provider: 'smtp',
      error: error.message || 'smtp_send_failed'
    };
  }
}

async function sendViaResend({ to, subject, text, html, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { sent: false, reason: 'resend_not_configured' };

  const from = process.env.EMAIL_FROM || 'MakaUg <noreply@makaug.com>';

  const payload = {
    from,
    to: [to],
    subject,
    text,
    html: html || `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap;">${text}</pre>`
  };

  if (replyTo) payload.reply_to = replyTo;

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const body = await resp.text();
    return { sent: false, provider: 'resend', status: resp.status, error: body };
  }

  const data = await resp.json();
  return { sent: true, provider: 'resend', id: data?.id || null };
}

async function sendViaWebhook({ to, subject, text, html, replyTo }) {
  const webhook = process.env.MAIL_WEBHOOK_URL;
  if (!webhook) return { sent: false, reason: 'mail_webhook_not_configured' };

  const payload = {
    to,
    subject,
    text,
    html,
    reply_to: replyTo || null,
    from: process.env.EMAIL_FROM || 'MakaUg <noreply@makaug.com>'
  };

  const resp = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const body = await resp.text();
    return { sent: false, provider: 'webhook', status: resp.status, error: body };
  }

  return { sent: true, provider: 'webhook' };
}

async function sendSupportEmail({ to, subject, text, html, replyTo }) {
  const recipient = to || getSupportEmail();
  const safeSubject = stripHtml(subject || 'MakaUg Notification');
  const safeText = String(text || '').trim();
  let lastProviderError = '';

  if (!safeText) {
    return { sent: false, reason: 'empty_body' };
  }

  const msGraphResult = await sendViaMicrosoftGraph({
    to: recipient,
    subject: safeSubject,
    text: safeText,
    html,
    replyTo
  });
  if (msGraphResult.sent) return msGraphResult;
  if (msGraphResult.error) {
    lastProviderError = String(msGraphResult.error || '');
    logger.warn('Microsoft Graph email failed', msGraphResult);
  }

  const smtpResult = await sendViaSmtp({
    to: recipient,
    subject: safeSubject,
    text: safeText,
    html,
    replyTo
  });
  if (smtpResult.sent) return smtpResult;
  if (smtpResult.error) {
    lastProviderError = String(smtpResult.error || lastProviderError || '');
    logger.warn('SMTP email failed', smtpResult);
  }

  const resendResult = await sendViaResend({
    to: recipient,
    subject: safeSubject,
    text: safeText,
    html,
    replyTo
  });
  if (resendResult.sent) return resendResult;
  if (resendResult.error) {
    lastProviderError = String(resendResult.error || lastProviderError || '');
    logger.warn('Resend email failed', resendResult);
  }

  const webhookResult = await sendViaWebhook({
    to: recipient,
    subject: safeSubject,
    text: safeText,
    html,
    replyTo
  });
  if (webhookResult.sent) return webhookResult;
  if (webhookResult.error) {
    lastProviderError = String(webhookResult.error || lastProviderError || '');
    logger.warn('Mail webhook failed', webhookResult);
  }

  logger.info('[EMAIL MOCK]', { to: recipient, subject: safeSubject, text: safeText });
  return {
    sent: false,
    mocked: true,
    reason: 'no_email_provider_configured',
    error: lastProviderError || null
  };
}

async function sendPropertySubmissionNotification({ propertyId, payload = {}, imageCount = 0 }) {
  const supportEmail = getSupportEmail();
  const listingType = String(payload.listing_type || '').toLowerCase();
  const title = payload.title || 'Untitled listing';
  const reference = payload.inquiry_reference || '-';
  const price = payload.price || '-';
  const period = payload.price_period ? ` (${payload.price_period})` : '';

  const subject = `[MakaUg] New ${listingType || 'property'} submission • ${title}`;
  const text = [
    'New property listing submission received via website.',
    '',
    `Property ID: ${propertyId}`,
    `Reference: ${reference}`,
    `Listing Type: ${listingType}`,
    `Title: ${title}`,
    `District: ${payload.district || '-'}`,
    `Area: ${payload.area || '-'}`,
    `Address: ${payload.address || '-'}`,
    `Price: ${price}${period}`,
    `Beds/Baths: ${payload.bedrooms || '-'} / ${payload.bathrooms || '-'}`,
    `Students Welcome: ${payload.students_welcome ? 'Yes' : 'No'}`,
    `Latitude/Longitude: ${payload.latitude || '-'} / ${payload.longitude || '-'}`,
    '',
    `Lister Name: ${payload.lister_name || '-'}`,
    `Lister Phone: ${payload.lister_phone || '-'}`,
    `Lister Email: ${payload.lister_email || '-'}`,
    `Lister Type: ${payload.lister_type || '-'}`,
    '',
    `Photo Count: ${imageCount}`,
    `ID Number Provided: ${payload.id_number ? 'Yes' : 'No'}`,
    `ID File Name: ${payload.id_document_name || '-'}`,
    '',
    `Extra Fields: ${JSON.stringify(payload.extra_fields || {}, null, 2)}`
  ].join('\n');

  return sendSupportEmail({
    to: supportEmail,
    subject,
    text,
    replyTo: payload.lister_email || undefined
  });
}

async function sendListingModerationNotification({ to, listing = {}, status, reason }) {
  const recipient = String(to || '').trim();
  if (!recipient) return { sent: false, reason: 'no_recipient' };

  const listingTitle = listing.title || 'Your property listing';
  const listingType = listing.listing_type || 'property';
  const reference = listing.inquiry_reference || listing.id || '-';
  const safeStatus = String(status || '').toLowerCase();
  const statusLabel = safeStatus === 'approved'
    ? 'Approved'
    : safeStatus === 'rejected'
      ? 'Rejected'
      : safeStatus === 'hidden'
        ? 'Hidden'
        : safeStatus === 'deleted'
          ? 'Removed'
          : safeStatus === 'pending'
            ? 'Pending Review'
            : 'Updated';

  const supportEmail = getSupportEmail();
  const subject = `[MakaUg] Listing ${statusLabel} • ${listingTitle}`;
  const text = [
    `Hello${listing?.lister_name ? ` ${listing.lister_name}` : ''},`,
    '',
    `Your MakaUg listing has been updated.`,
    `Status: ${statusLabel}`,
    `Title: ${listingTitle}`,
    `Type: ${listingType}`,
    `Reference: ${reference}`,
    reason ? `Reason: ${reason}` : '',
    '',
    `If you need help, contact ${supportEmail}.`,
    'Thank you for using MakaUg.'
  ].filter(Boolean).join('\n');

  return sendSupportEmail({
    to: recipient,
    subject,
    text
  });
}

module.exports = {
  getSupportEmail,
  sendSupportEmail,
  sendPropertySubmissionNotification,
  sendListingModerationNotification
};
