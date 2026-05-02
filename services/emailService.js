const logger = require('../config/logger');

function getSupportEmail() {
  return process.env.SUPPORT_EMAIL || 'info@makaug.com';
}

function getSupportPhone() {
  return process.env.SUPPORT_PHONE || '+256760112587';
}

function getSupportWhatsappUrl() {
  const digits = String(getSupportPhone()).replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : 'https://wa.me/256760112587';
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getPublicSiteUrl() {
  return String(
    process.env.PUBLIC_SITE_URL
      || process.env.PUBLIC_BASE_URL
      || process.env.APP_BASE_URL
      || 'https://makaug.com'
  ).replace(/\/+$/, '');
}

function getFirstUrlFromText(text) {
  const match = String(text || '').match(/https?:\/\/[^\s<>"')]+/i);
  return match ? match[0] : '';
}

function renderActionLink(url, label) {
  return `<a href="${escapeHtml(url)}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;border-radius:12px;padding:11px 15px;font-size:13px;font-weight:800;margin:4px 6px 4px 0;">${escapeHtml(label)}</a>`;
}

function renderLineWithLinks(line) {
  const text = String(line || '').trim();
  const urlOnly = text.match(/^(https?:\/\/[^\s<>"')]+)$/i);
  if (urlOnly) return renderActionLink(urlOnly[1], 'Open link');

  const labelUrl = text.match(/^([^:]{2,60}):\s*(https?:\/\/[^\s<>"')]+)$/i);
  if (labelUrl) return renderActionLink(labelUrl[2], labelUrl[1].trim());

  return escapeHtml(text).replace(/(https?:\/\/[^\s<>"')]+)/gi, (url) => (
    `<a href="${escapeHtml(url)}" style="color:#166534;font-weight:800;text-decoration:none;">Open link</a>`
  ));
}

function renderPlainTextAsEmailHtml(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block
        .split(/\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (!lines.length) return '';
      if (lines.length > 1 && lines.every((line) => /^[A-Za-z0-9 /()[\]-]+:/.test(line))) {
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:12px 0;">${lines.map((line) => {
          const idx = line.indexOf(':');
          const label = line.slice(0, idx + 1);
          const value = line.slice(idx + 1).trim();
          return `<tr><td style="padding:7px 0;color:#6b7280;font-size:13px;width:150px;">${escapeHtml(label)}</td><td style="padding:7px 0;color:#111827;font-size:14px;font-weight:600;">${value ? renderLineWithLinks(value) : '-'}</td></tr>`;
        }).join('')}</table>`;
      }
      return `<p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.65;">${lines.map(renderLineWithLinks).join('<br>')}</p>`;
    })
    .filter(Boolean)
    .join('');
}

function buildBrandedEmailHtml({ subject, text }) {
  const siteUrl = getPublicSiteUrl();
  const supportEmail = getSupportEmail();
  const supportPhone = getSupportPhone();
  const whatsappUrl = getSupportWhatsappUrl();
  const ctaUrl = getFirstUrlFromText(text) || siteUrl;
  const ctaLabel = ctaUrl === siteUrl ? 'Visit MakaUg' : 'Open link';
  const safeSubject = escapeHtml(subject || 'MakaUg update');
  const bodyHtml = renderPlainTextAsEmailHtml(text);

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${safeSubject}</title>
  </head>
  <body style="margin:0;background:#f4f7f2;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <div style="display:none;max-height:0;overflow:hidden;color:#f4f7f2;">${safeSubject}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f2;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #dbe7d7;box-shadow:0 12px 30px rgba(15,23,42,0.08);">
            <tr>
              <td style="background:#0b3d1f;padding:24px 28px;">
                <div style="font-size:28px;font-weight:900;letter-spacing:.2px;line-height:1;">
                  <span style="color:#ffffff;">makaug</span><span style="color:#d6a62a;">.com</span>
                </div>
                <div style="margin-top:7px;color:#cde7d0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">MakaUg</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <div style="display:inline-block;background:#ecfdf3;color:#166534;border:1px solid #bbf7d0;border-radius:999px;padding:7px 12px;font-size:12px;font-weight:800;margin-bottom:16px;">MakaUg update</div>
                <h1 style="margin:0 0 16px;color:#111827;font-size:24px;line-height:1.25;font-weight:900;">${safeSubject}</h1>
                ${bodyHtml}
                <div style="margin-top:24px;">
                  <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;border-radius:12px;padding:13px 18px;font-size:14px;font-weight:800;">${ctaLabel}</a>
                </div>
                <div style="margin-top:18px;border-top:1px solid #e5efe2;padding-top:18px;">
                  <div style="color:#6b7280;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;">Contact MakaUg</div>
                  <a href="${escapeHtml(whatsappUrl)}" style="display:inline-block;text-decoration:none;color:#166534;border:1px solid #bbf7d0;background:#ecfdf3;border-radius:999px;padding:9px 12px;font-size:13px;font-weight:800;margin:4px 6px 4px 0;"><span style="display:inline-block;background:#16a34a;color:#ffffff;border-radius:999px;width:24px;height:24px;line-height:24px;text-align:center;margin-right:7px;">WA</span>WhatsApp</a>
                  <a href="mailto:${escapeHtml(supportEmail)}" style="display:inline-block;text-decoration:none;color:#166534;border:1px solid #bbf7d0;background:#ecfdf3;border-radius:999px;padding:9px 12px;font-size:13px;font-weight:800;margin:4px 6px 4px 0;"><span style="display:inline-block;background:#166534;color:#ffffff;border-radius:999px;width:24px;height:24px;line-height:24px;text-align:center;margin-right:7px;">@</span>Email</a>
                  <a href="${escapeHtml(siteUrl)}" style="display:inline-block;text-decoration:none;color:#166534;border:1px solid #bbf7d0;background:#ecfdf3;border-radius:999px;padding:9px 12px;font-size:13px;font-weight:800;margin:4px 6px 4px 0;"><span style="display:inline-block;background:#d6a62a;color:#111827;border-radius:999px;width:24px;height:24px;line-height:24px;text-align:center;margin-right:7px;">M</span>Website</a>
                </div>
              </td>
            </tr>
            <tr>
              <td style="background:#f8faf7;border-top:1px solid #e5efe2;padding:18px 28px;color:#6b7280;font-size:12px;line-height:1.6;">
                Need help? WhatsApp <a href="${escapeHtml(whatsappUrl)}" style="color:#166534;font-weight:700;text-decoration:none;">${escapeHtml(supportPhone)}</a> or email <a href="mailto:${escapeHtml(supportEmail)}" style="color:#166534;font-weight:700;text-decoration:none;">${escapeHtml(supportEmail)}</a>.<br>
                MakaUg helps property seekers, owners, students, brokers, and land buyers find trusted opportunities in Uganda.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function getLanguageDisplayName(code = 'en') {
  const normalized = String(code || 'en').trim().toLowerCase();
  return {
    en: 'English',
    lg: 'Luganda',
    sw: 'Kiswahili',
    ac: 'Acholi',
    ny: 'Runyankole',
    rn: 'Rukiga',
    sm: 'Lusoga'
  }[normalized] || 'English';
}

function getContactChannelLabel(channel = 'whatsapp') {
  const normalized = String(channel || 'whatsapp').trim().toLowerCase();
  return {
    whatsapp: 'WhatsApp',
    phone: 'Phone',
    email: 'Email'
  }[normalized] || 'WhatsApp';
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
  const safeHtml = html || buildBrandedEmailHtml({ subject: safeSubject, text: safeText });
  let lastProviderError = '';

  if (!safeText) {
    return { sent: false, reason: 'empty_body' };
  }

  const msGraphResult = await sendViaMicrosoftGraph({
    to: recipient,
    subject: safeSubject,
    text: safeText,
    html: safeHtml,
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
    html: safeHtml,
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
    html: safeHtml,
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
    html: safeHtml,
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

async function sendWelcomeEmail({ to, user = {} }) {
  const recipient = String(to || user?.email || '').trim();
  if (!recipient) return { sent: false, reason: 'no_recipient' };

  const firstName = cleanText(user?.first_name || user?.firstName || 'there');
  const siteUrl = getPublicSiteUrl();
  const whatsappUrl = getSupportWhatsappUrl();
  const preferredLanguage = getLanguageDisplayName(user?.preferred_language);
  const preferredChannel = getContactChannelLabel(user?.preferred_contact_channel);
  const weeklyTipsEnabled = user?.weekly_tips_opt_in !== false;

  const subject = `Welcome to MakaUg, ${firstName}`;
  const text = [
    `Hello ${firstName},`,
    '',
    'Welcome to MakaUg. Your free account is now active and ready to use.',
    `Preferred language: ${preferredLanguage}`,
    `Preferred contact channel: ${preferredChannel}`,
    '',
    'Here is what you can do next:',
    '- Save properties and build your shortlist.',
    '- Track recent views, enquiries, and route opens from your account dashboard.',
    '- Update your language, alerts, and contact preferences any time.',
    '- Contact brokers, owners, and the MakaUg team from one place.',
    weeklyTipsEnabled ? '- Receive weekly property tips and market updates from the MakaUg team.' : '',
    '',
    `Open MakaUg: ${siteUrl}`,
    `WhatsApp MakaUg: ${whatsappUrl}`,
    '',
    'We are happy to be part of your property journey.'
  ].filter(Boolean).join('\n');

  return sendSupportEmail({
    to: recipient,
    subject,
    text
  });
}

module.exports = {
  getSupportEmail,
  getSupportPhone,
  getSupportWhatsappUrl,
  sendSupportEmail,
  sendPropertySubmissionNotification,
  sendListingModerationNotification,
  sendWelcomeEmail
};
