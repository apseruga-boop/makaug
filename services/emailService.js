const logger = require('../config/logger');

function getSupportEmail() {
  return process.env.SUPPORT_EMAIL || 'info@makaug.com';
}

function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
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

  if (!safeText) {
    return { sent: false, reason: 'empty_body' };
  }

  const resendResult = await sendViaResend({
    to: recipient,
    subject: safeSubject,
    text: safeText,
    html,
    replyTo
  });
  if (resendResult.sent) return resendResult;
  if (resendResult.error) logger.warn('Resend email failed', resendResult);

  const webhookResult = await sendViaWebhook({
    to: recipient,
    subject: safeSubject,
    text: safeText,
    html,
    replyTo
  });
  if (webhookResult.sent) return webhookResult;
  if (webhookResult.error) logger.warn('Mail webhook failed', webhookResult);

  logger.info('[EMAIL MOCK]', { to: recipient, subject: safeSubject, text: safeText });
  return { sent: false, mocked: true, reason: 'no_email_provider_configured' };
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
