'use strict';

const { sendSupportEmail } = require('./emailService');

const DEFAULT_OFF_PLAN_NOTIFICATION_EMAILS = [
  'admin@makaug.com',
  'arthur@makaug.com',
  'ronald@makaug.com'
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

module.exports = {
  DEFAULT_OFF_PLAN_NOTIFICATION_EMAILS,
  notificationRecipients,
  notifyOffPlanEnquiry
};
