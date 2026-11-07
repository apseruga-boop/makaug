'use strict';

const { sendSupportEmail } = require('./emailService');

const DEFAULT_OFF_PLAN_NOTIFICATION_EMAILS = [
  'arthur@makaug.com',
  'ronald@makaug.com',
  'info@makaug.com'
];

function cleanText(value, max = 2000) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').slice(0, max);
}

function notificationRecipients() {
  const configured = cleanText(process.env.OFF_PLAN_NOTIFICATION_EMAILS, 2000)
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
  return Array.from(new Set(configured.length ? configured : DEFAULT_OFF_PLAN_NOTIFICATION_EMAILS));
}

function formatCallback(value) {
  if (!value) return 'Not requested';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? cleanText(value, 120) : date.toISOString();
}

async function notifyOffPlanEnquiry(enquiry = {}, development = null) {
  const projectName = cleanText(development?.name || enquiry.development_name || 'New off-plan project');
  const subject = `New off-plan enquiry: ${projectName}`;
  const text = [
    'A new off-plan enquiry has been received on makaug.com.',
    '',
    `Project: ${projectName}`,
    `Enquiry type: ${cleanText(enquiry.enquiry_type || 'project_interest')}`,
    `Preferred contact: ${cleanText(enquiry.preferred_contact_channel)}`,
    `Name: ${cleanText(enquiry.name)}`,
    `Phone: ${cleanText(enquiry.phone) || 'Not provided'}`,
    `Email: ${cleanText(enquiry.email) || 'Not provided'}`,
    `Requested callback: ${formatCallback(enquiry.requested_callback_at)}`,
    `Source: ${cleanText(enquiry.source_path) || '/off-plan'}`,
    `Project contact: ${cleanText(enquiry.metadata?.project_contact_name) || 'Not supplied'}`,
    `Truth declaration: ${enquiry.metadata?.truth_confirmed === true ? 'Confirmed' : enquiry.enquiry_type === 'listing_request' ? 'Not confirmed' : 'Not applicable'}`,
    '',
    `Message: ${cleanText(enquiry.message) || 'No additional message.'}`,
    enquiry.metadata?.supplied_project_details ? `\nProject details supplied:\n${cleanText(enquiry.metadata.supplied_project_details, 5000)}` : '',
    '',
    'Please contact the customer and verify all project information before publication.'
  ].join('\n');

  const deliveries = await Promise.all(notificationRecipients().map(async (to) => {
    try {
      const result = await sendSupportEmail({
        to,
        subject,
        text,
        replyTo: enquiry.email || undefined
      });
      return { to, sent: result?.sent === true, provider: result?.provider || null, reason: result?.reason || result?.error || null };
    } catch (error) {
      return { to, sent: false, provider: null, reason: cleanText(error?.message || 'send_failed', 300) };
    }
  }));

  return {
    attempted_at: new Date().toISOString(),
    delivered: deliveries.every((item) => item.sent),
    deliveries
  };
}

function publicProjectUrl(development = {}) {
  const base = cleanText(process.env.PUBLIC_SITE_URL || process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://makaug.com', 300).replace(/\/+$/, '');
  const country = cleanText(development.country_code || 'UG', 2).toUpperCase();
  return `${base}/off-plan/${encodeURIComponent(cleanText(development.slug, 180))}${country === 'UG' ? '' : `?country=${country}`}`;
}

// The developer's own page on makaug, when the project is linked to an
// approved agent: "There's a page for John" (Arthur, 7 Nov 2026) — the live
// message carries it beside the project link.
function contactProfileUrl(development = {}) {
  const id = cleanText(development.source_agent_profile_id || development.source_agent_id, 80);
  const approved = !development.source_agent_status || String(development.source_agent_status).toLowerCase() === 'approved';
  if (!/^[0-9a-f-]{36}$/i.test(id) || !approved) return '';
  const base = cleanText(process.env.PUBLIC_SITE_URL || process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://makaug.com', 300).replace(/\/+$/, '');
  return `${base}/agents/${encodeURIComponent(id)}`;
}

function projectContact(development = {}) {
  const extra = development.extra_fields && typeof development.extra_fields === 'object' ? development.extra_fields : {};
  const contact = extra.developer_contact && typeof extra.developer_contact === 'object' ? extra.developer_contact : {};
  return {
    name: cleanText(development.source_agent_name || contact.name || development.source_display_name || development.developer_name, 160),
    phone: cleanText(development.source_agent_whatsapp || development.source_agent_phone || contact.whatsapp || contact.phone, 40),
    email: cleanText(development.source_agent_email || contact.email, 200).toLowerCase()
  };
}

/** The lister's "it is live" WhatsApp. Signed as the assistant, never as a person on the team. */
function publishedWhatsappBody(development = {}, contact = {}) {
  const url = publicProjectUrl(development);
  const walkthroughs = Array.isArray(development.extra_fields?.walkthroughs) ? development.extra_fields.walkthroughs.length : 0;
  const first = cleanText(contact.name, 80).split(' ')[0];
  return [
    `Hi ${first || 'there'}, ${cleanText(development.name, 120)} is now live on makaug.com. 🎉`,
    '',
    url,
    '',
    `The page has the home types and prices, the payment plan, the floor plans, ${walkthroughs ? `${walkthroughs} walkthrough videos, ` : ''}the construction progress and a brochure buyers can download. Enquiries from the page come to you${development.extra_fields?.contact_mode === 'makaug_managed' ? ' through the makaug team' : ''}.`,
    ...(contactProfileUrl(development) ? ['', `Your own page on makaug, with the project on it: ${contactProfileUrl(development)}`] : []),
    '',
    'When there is a new construction update, a price change or new photos, send them here and we will update the page.',
    '',
    'Phillip, makaug.com'
  ].join('\n');
}

function publishedEmail(development = {}, contact = {}) {
  const url = publicProjectUrl(development);
  const subject = `${cleanText(development.name, 120)} is live on makaug.com`;
  const text = [
    `Hello ${cleanText(contact.name, 120) || 'there'},`,
    '',
    `${cleanText(development.name, 120)} is now live on makaug.com:`,
    url,
    '',
    'On the page: the home types and starting prices, the payment plan and calculator, the floor plans, the walkthrough videos and 3D walk-around, the construction diary, the location and a downloadable brochure in nine languages.',
    ...(contactProfileUrl(development) ? ['', `Your own page on makaug, with the project on it: ${contactProfileUrl(development)}`] : []),
    '',
    'Send construction updates, price changes or new photos to the makaug WhatsApp and we will keep the page current.',
    '',
    'Kind regards,',
    'Phillip, makaug.com'
  ].join('\n');
  return { subject, text };
}

function teamPublishedBody(development = {}, contact = {}, listerDelivery = {}) {
  const url = publicProjectUrl(development);
  const told = [listerDelivery.whatsapp?.sent ? 'WhatsApp' : '', listerDelivery.email?.sent ? 'email' : ''].filter(Boolean);
  return [
    `🏗️ *Off-plan project live: ${cleanText(development.name, 120)}*`,
    `${[cleanText(development.area, 80), cleanText(development.district, 80)].filter(Boolean).join(', ')} · ${cleanText(development.developer_name || development.source_display_name, 120)}`,
    url,
    contact.name ? `Developer contact: ${contact.name}${contact.phone ? ` ${contact.phone}` : ''}${told.length ? ` — told by ${told.join(' and ')}.` : ' — not reached (no WhatsApp or email on file).'}` : '',
    'Enquiries land in the Lead Centre and the off-plan desk.'
  ].filter(Boolean).join('\n');
}

/**
 * When a project goes live: the developer's contact hears by WhatsApp and
 * email, and the team (Ronald and the alert numbers) hears by WhatsApp.
 * Nothing here blocks publication; every failure is returned, not thrown.
 */
async function notifyOffPlanPublished(development = {}, { db = null, teamExtraRecipients = [] } = {}) {
  const contact = projectContact(development);
  const result = { attempted_at: new Date().toISOString(), contact: { name: contact.name, phone: contact.phone ? `…${contact.phone.slice(-4)}` : null, email: contact.email || null }, whatsapp: { sent: false, reason: 'no_phone' }, email: { sent: false, reason: 'no_email' }, team: [] };
  if (contact.phone) {
    try {
      const { deliverListingWhatsapp } = require('./listingModerationService');
      result.whatsapp = await deliverListingWhatsapp({ to: contact.phone, body: publishedWhatsappBody(development, contact), kind: 'off_plan_published', listingId: development.id || null });
    } catch (error) {
      result.whatsapp = { sent: false, reason: 'whatsapp_send_failed', error: cleanText(error?.message, 300) };
    }
  }
  if (contact.email) {
    try {
      const message = publishedEmail(development, contact);
      const sent = await sendSupportEmail({ to: contact.email, subject: message.subject, text: message.text });
      result.email = { sent: sent?.sent === true, provider: sent?.provider || null, reason: sent?.reason || sent?.error || null };
    } catch (error) {
      result.email = { sent: false, reason: 'email_send_failed', error: cleanText(error?.message, 300) };
    }
  }
  try {
    const desk = require('./leadDeskService');
    const extra = [process.env.AGENT_HELP_CONTACT_PHONE || '256709402189', ...teamExtraRecipients];
    result.team = await desk.sendToTeam(db || require('../config/database'), teamPublishedBody(development, contact, result), 'off_plan_published', { extraRecipients: extra });
  } catch (error) {
    result.team = [{ to: 'team', status: 'failed', error: cleanText(error?.message, 300) }];
  }
  return result;
}

module.exports = {
  contactProfileUrl,
  DEFAULT_OFF_PLAN_NOTIFICATION_EMAILS,
  notificationRecipients,
  notifyOffPlanEnquiry,
  notifyOffPlanPublished,
  publicProjectUrl,
  publishedWhatsappBody,
  publishedEmail,
  teamPublishedBody
};
