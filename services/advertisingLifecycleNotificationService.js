'use strict';

const { getSupportWhatsappUrl, sendSupportEmail } = require('./emailService');
const { logEmailEvent } = require('./emailLogService');
const { logNotification, notificationStatusFromDelivery } = require('./notificationLogService');
const { logWhatsAppMessage } = require('./whatsappMessageLogService');
const { sendWhatsAppText } = require('./whatsappNotificationService');

function clean(value = '') {
  return String(value || '').trim();
}

function publicBaseUrl() {
  return clean(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://makaug.com').replace(/\/$/, '');
}

function money(value, currency = 'UGX') {
  return `${currency || 'UGX'} ${Number(value || 0).toLocaleString('en-UG')}`;
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (_error) {
    return fallback;
  }
}

function listText(value) {
  const parsed = Array.isArray(value) ? value : parseJson(value, []);
  return Array.isArray(parsed) && parsed.length ? parsed.join(', ') : '-';
}

function dateText(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('en-GB');
}

function dashboardUrl(campaign = {}) {
  return `${publicBaseUrl()}/advertiser-dashboard${campaign.id ? `?campaign=${encodeURIComponent(campaign.id)}` : ''}`;
}

function payUrl(campaign = {}, fallback = '') {
  return clean(campaign.payment_url || fallback || `${publicBaseUrl()}/advertise`);
}

function safeCampaignRef(campaign = {}) {
  return String(campaign.id || campaign.campaign_id || '-').slice(0, 8);
}

function selectedLanguages(campaign = {}) {
  const aiCopy = parseJson(campaign.ai_copy, {});
  return Array.isArray(aiCopy.languages) && aiCopy.languages.length ? aiCopy.languages.join(', ') : 'English';
}

function durationWeeks(campaign = {}) {
  const start = campaign.starts_at ? new Date(campaign.starts_at) : null;
  const end = campaign.ends_at ? new Date(campaign.ends_at) : null;
  if (start && end && !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
    const days = Math.max(1, Math.round((end - start) / 86400000));
    return `${Math.max(1, Math.ceil(days / 7))} week${days > 7 ? 's' : ''}`;
  }
  return 'selected duration';
}

function campaignMetrics(campaign = {}) {
  return {
    impressions: Number(campaign.impressions || 0),
    clicks: Number(campaign.clicks || 0),
    leads: Number(campaign.leads || 0)
  };
}

function buildAdvertisingLifecycleTemplate(trigger, campaign = {}, context = {}) {
  const name = clean(campaign.advertiser_name || context.advertiserName) || 'there';
  const ref = safeCampaignRef(campaign);
  const placement = clean(campaign.package_label || campaign.package_key || listText(campaign.placements)) || '-';
  const amount = money(context.amount || campaign.paid_amount_ugx || campaign.quoted_amount_ugx, context.currency || 'UGX');
  const method = clean(context.method || campaign.payment_method || 'Flutterwave');
  const txn = clean(context.reference || campaign.payment_reference) || '-';
  const paidAt = clean(context.paidAt) || new Date().toISOString();
  const dashUrl = dashboardUrl(campaign);
  const paymentUrl = payUrl(campaign, context.paymentUrl);
  const start = dateText(campaign.starts_at);
  const end = dateText(campaign.ends_at);
  const metrics = campaignMetrics(campaign);

  const templates = {
    submitted: {
      eventType: 'advertising_campaign_submitted',
      templateKey: 'advertising_campaign_received',
      subject: "We've received your ad - one step left",
      ctaLabel: 'Pay securely',
      ctaUrl: paymentUrl,
      text: [
        `Hi ${name}, thanks for booking with makaug.`,
        '',
        `Campaign #${ref}`,
        `Placement: ${placement}`,
        `Duration: ${durationWeeks(campaign)} (${start} - ${end})`,
        `Languages: ${selectedLanguages(campaign)}`,
        `Amount due: ${amount}`,
        '',
        'To go live, complete payment securely. Nothing goes live until payment and a quick review are complete.',
        '',
        `Pay securely: ${paymentUrl}`,
        `Questions? Reply or WhatsApp 0760112587.`
      ].join('\n'),
      whatsapp: `makaug: we've received your ad (Campaign #${ref}, ${placement}, ${durationWeeks(campaign)}). Complete payment to go live: ${paymentUrl}`
    },
    payment_confirmed: {
      eventType: 'advertising_payment_confirmed',
      templateKey: 'advertising_payment_confirmed',
      subject: 'Payment confirmed - your ad is now in review',
      ctaLabel: 'View my campaign',
      ctaUrl: dashUrl,
      text: [
        `Hi ${name},`,
        '',
        `Paid. Campaign #${ref}`,
        `Paid: ${amount}`,
        `Method: ${method}`,
        `Reference: ${txn}`,
        `Date/time: ${paidAt}`,
        '',
        "Next: we review and approve. You'll get one more email when it's live.",
        '',
        `View my campaign: ${dashUrl}`
      ].join('\n'),
      whatsapp: `Payment received - ${amount} via ${method}, ref ${txn}. Your ad is now in review; we'll message when it's live.`
    },
    approved_live: {
      eventType: 'advertising_campaign_live',
      templateKey: 'advertising_campaign_live',
      subject: "You're live - your ad is now running on makaug",
      ctaLabel: 'Open my dashboard',
      ctaUrl: dashUrl,
      text: [
        `Hi ${name}, your ad is approved and live.`,
        '',
        `Campaign #${ref}`,
        `Showing on: ${placement}`,
        `Running: ${start} to ${end}`,
        `Seen in: all 9 languages`,
        `Links to: ${clean(parseJson(campaign.ai_copy, {}).creative?.destination_url || parseJson(campaign.ai_copy, {}).cta_url || '-')}`,
        '',
        'We will email a performance summary every week and a final report at the end.',
        '',
        `Open my dashboard: ${dashUrl}`
      ].join('\n'),
      whatsapp: `You're live. Your ad is running on ${placement} until ${end}. Track views and leads: ${dashUrl}`
    },
    changes_requested: {
      eventType: 'advertising_changes_requested',
      templateKey: 'advertising_changes_requested',
      subject: 'Changes requested for your makaug ad',
      ctaLabel: 'View my campaign',
      ctaUrl: dashUrl,
      text: [
        `Hi ${name},`,
        '',
        `makaug reviewed Campaign #${ref} and needs one change before it can go live.`,
        clean(context.reason || context.message || 'Please review the request in your dashboard and resubmit.'),
        '',
        `View my campaign: ${dashUrl}`
      ].join('\n'),
      whatsapp: `makaug needs a change before Campaign #${ref} can go live. View: ${dashUrl}`
    },
    rejected: {
      eventType: 'advertising_campaign_rejected',
      templateKey: 'advertising_campaign_rejected',
      subject: 'Your makaug ad was not approved',
      ctaLabel: 'View my campaign',
      ctaUrl: dashUrl,
      text: [
        `Hi ${name},`,
        '',
        `Campaign #${ref} was not approved.`,
        clean(context.reason || context.message || 'The campaign did not meet makaug advertising requirements.'),
        context.refundReference ? `Refund reference: ${context.refundReference}` : 'If payment was captured, makaug will process the refund path through the payment provider.',
        '',
        `View my campaign: ${dashUrl}`
      ].join('\n'),
      whatsapp: `Campaign #${ref} was not approved. If payment was captured, refund handling will be tracked. Details: ${dashUrl}`
    },
    weekly_report: {
      eventType: 'advertising_weekly_report',
      templateKey: 'advertising_weekly_report',
      subject: `Weekly report - ${campaign.campaign_name || 'your makaug ad'}`,
      ctaLabel: 'Open report',
      ctaUrl: dashUrl,
      text: [
        `Hi ${name}, here is your weekly makaug advertising summary.`,
        '',
        `Campaign #${ref}`,
        `Views: ${metrics.impressions.toLocaleString('en-UG')}`,
        `Clicks: ${metrics.clicks.toLocaleString('en-UG')}`,
        `Leads: ${metrics.leads.toLocaleString('en-UG')}`,
        `Runs until: ${end}`,
        '',
        `Open report: ${dashUrl}`
      ].join('\n'),
      whatsapp: `Weekly makaug ad report #${ref}: ${metrics.impressions} views, ${metrics.clicks} clicks, ${metrics.leads} leads. ${dashUrl}`
    },
    final_report: {
      eventType: 'advertising_final_report',
      templateKey: 'advertising_final_report',
      subject: `Final report - ${campaign.campaign_name || 'your makaug ad'}`,
      ctaLabel: 'Run again',
      ctaUrl: `${publicBaseUrl()}/advertise`,
      text: [
        `Hi ${name}, your makaug campaign has ended.`,
        '',
        `Campaign #${ref}`,
        `Final views: ${metrics.impressions.toLocaleString('en-UG')}`,
        `Final clicks: ${metrics.clicks.toLocaleString('en-UG')}`,
        `Final leads: ${metrics.leads.toLocaleString('en-UG')}`,
        '',
        `Run again: ${publicBaseUrl()}/advertise`
      ].join('\n'),
      whatsapp: `Your makaug ad #${ref} has ended: ${metrics.impressions} views, ${metrics.clicks} clicks, ${metrics.leads} leads. Run again: ${publicBaseUrl()}/advertise`
    }
  };
  return templates[trigger] || null;
}

function buildHtmlEmail(template = {}) {
  const escaped = String(template.text || '')
    .split('\n')
    .map((line) => line
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;'))
    .join('<br>');
  const cta = template.ctaUrl
    ? `<p style="margin:24px 0 0"><a href="${template.ctaUrl}" style="display:inline-block;background:#15603f;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">${template.ctaLabel || 'Open makaug'}</a></p>`
    : '';
  return [
    '<div style="margin:0;background:#f6f9f7;padding:24px;font-family:Inter,Arial,sans-serif;color:#16241d">',
    '<div style="max-width:640px;margin:0 auto;background:#fff;border:1px solid #e4ece8;border-radius:16px;overflow:hidden">',
    '<div style="background:#0f3d2e;color:#fff;padding:20px 24px"><div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.8">makaug advertising</div><h1 style="font-size:22px;line-height:1.25;margin:6px 0 0">', template.subject || 'makaug advertising update', '</h1></div>',
    '<div style="padding:24px;font-size:15px;line-height:1.6">', escaped, cta, '</div>',
    '</div></div>'
  ].join('');
}

function whatsappClickUrl(phone = '', body = '') {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const normalized = digits.startsWith('256') ? digits : digits.startsWith('0') ? `256${digits.slice(1)}` : digits;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(body)}`;
}

async function logLifecycleNotification(db, {
  campaign,
  trigger,
  template,
  emailDelivery,
  whatsappDelivery,
  whatsappManualUrl,
  language = 'en'
}) {
  const email = clean(campaign.advertiser_email);
  const phone = clean(campaign.advertiser_phone);
  const emailStatus = email ? notificationStatusFromDelivery(emailDelivery || {}) : 'skipped';
  const whatsappStatus = phone ? notificationStatusFromDelivery(whatsappDelivery || {}) : 'skipped';
  const emailFailure = emailDelivery?.error || emailDelivery?.reason || null;
  const whatsappFailure = whatsappDelivery?.error || whatsappDelivery?.reason || null;
  await logEmailEvent(db, {
    eventType: template.eventType,
    recipientEmail: email || null,
    recipientRole: 'advertiser',
    templateKey: template.templateKey,
    subject: template.subject,
    language,
    status: emailStatus,
    provider: emailDelivery?.provider || null,
    providerMessageId: emailDelivery?.id || null,
    relatedCampaignId: campaign.id || null,
    failureReason: emailFailure,
    sentAt: emailDelivery?.sent ? new Date() : null
  });
  await logWhatsAppMessage(db, {
    recipientPhone: phone || null,
    templateKey: template.templateKey,
    messageType: trigger,
    language,
    status: whatsappStatus,
    relatedCampaignId: campaign.id || null,
    failureReason: whatsappFailure,
    sentAt: whatsappDelivery?.sent ? new Date() : null
  });
  await logNotification(db, {
    recipientPhone: phone || null,
    recipientEmail: email || null,
    channel: 'email',
    type: template.eventType,
    status: emailStatus,
    relatedLeadId: null,
    failureReason: emailFailure,
    sentAt: emailDelivery?.sent ? new Date() : null,
    payloadSummary: {
      campaign_id: campaign.id || null,
      template_key: template.templateKey,
      cta_url: template.ctaUrl || null
    }
  });
  await logNotification(db, {
    recipientPhone: phone || null,
    recipientEmail: email || null,
    channel: 'whatsapp',
    type: template.eventType,
    status: whatsappStatus,
    failureReason: whatsappFailure,
    sentAt: whatsappDelivery?.sent ? new Date() : null,
    payloadSummary: {
      campaign_id: campaign.id || null,
      template_key: template.templateKey,
      manual_url: whatsappManualUrl || null
    }
  });
}

async function sendAdvertisingLifecycleNotification(db, {
  trigger,
  campaign,
  context = {},
  sendEmail = true,
  sendWhatsapp = true
} = {}) {
  const template = buildAdvertisingLifecycleTemplate(trigger, campaign, context);
  if (!template || !campaign) return null;
  const email = clean(campaign.advertiser_email);
  const phone = clean(campaign.advertiser_phone);
  let emailDelivery = { sent: false, reason: email ? 'not_sent' : 'missing_email' };
  let whatsappDelivery = { sent: false, reason: phone ? 'not_sent' : 'missing_phone' };
  if (email && sendEmail) {
    emailDelivery = await sendSupportEmail({
      to: email,
      subject: template.subject,
      text: template.text,
      html: buildHtmlEmail(template)
    });
  }
  if (phone && sendWhatsapp) {
    whatsappDelivery = await sendWhatsAppText({ to: phone, body: template.whatsapp });
  }
  const manualUrl = phone ? whatsappClickUrl(phone, template.whatsapp) : null;
  await logLifecycleNotification(db, {
    campaign,
    trigger,
    template,
    emailDelivery,
    whatsappDelivery,
    whatsappManualUrl: manualUrl,
    language: clean(context.language || parseJson(campaign.ai_copy, {}).language || 'en') || 'en'
  });
  return {
    trigger,
    template_key: template.templateKey,
    email: emailDelivery,
    whatsapp: whatsappDelivery,
    whatsapp_manual_url: manualUrl
  };
}

module.exports = {
  buildAdvertisingLifecycleTemplate,
  sendAdvertisingLifecycleNotification
};
