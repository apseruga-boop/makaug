'use strict';

const { sendSupportEmail } = require('./emailService');

const DEFAULT_VIRTUAL_HOME_NOTIFICATION_EMAILS = [
  'admin@makaug.com',
  'arthur@makaug.com',
  'ronald@makaug.com'
];

function cleanText(value, max = 3000) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').slice(0, max);
}

function notificationRecipients() {
  const configured = cleanText(process.env.VIRTUAL_HOME_NOTIFICATION_EMAILS, 2000)
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
  return Array.from(new Set(configured.length ? configured : DEFAULT_VIRTUAL_HOME_NOTIFICATION_EMAILS));
}

function orderEmail(order = {}) {
  const metadata = order.metadata && typeof order.metadata === 'object' ? order.metadata : {};
  return {
    subject: `New Maka Virtual Homes request: ${cleanText(order.customer_name, 180) || 'New customer'}`,
    text: [
      'A new Maka Virtual Homes request has been saved in the production queue.',
      '',
      `Order ID: ${cleanText(order.id, 100)}`,
      `Name: ${cleanText(order.customer_name, 220)}`,
      `Company or developer: ${cleanText(metadata.company, 220) || 'Not provided'}`,
      `Phone / WhatsApp: ${cleanText(order.customer_phone, 80) || 'Not provided'}`,
      `Email: ${cleanText(order.customer_email, 260) || 'Not provided'}`,
      `Property location: ${cleanText(metadata.location, 500) || 'Not provided'}`,
      `Requested product: ${cleanText(order.product_key, 100) || 'Interactive Virtual Home'}`,
      `Requested outputs: ${Array.isArray(order.requested_outputs) ? order.requested_outputs.map((item) => cleanText(item, 100)).filter(Boolean).join(', ') : 'Not provided'}`,
      `Indicative amount: ${order.amount_ugx == null ? 'Quote required' : `UGX ${Number(order.amount_ugx).toLocaleString('en-UG')}`}`,
      `Language: ${cleanText(metadata.language, 20) || 'en'}`,
      `Source: ${cleanText(metadata.source_path, 1000) || '/services/virtual-homes'}`,
      '',
      `Source material notes: ${cleanText(metadata.notes, 5000) || 'Not provided'}`,
      '',
      'Review the request in the King Dashboard before quoting, charging, or starting a paid service.'
    ].join('\n'),
    replyTo: order.customer_email || undefined
  };
}

async function notifyVirtualHomeOrder(order = {}) {
  const email = orderEmail(order);
  const deliveries = await Promise.all(notificationRecipients().map(async (to) => {
    try {
      const result = await sendSupportEmail({ to, ...email });
      return { to, sent: result?.sent === true, provider: result?.provider || null, reason: result?.reason || result?.error || null };
    } catch (error) {
      return { to, sent: false, provider: null, reason: cleanText(error?.message || 'send_failed', 300) };
    }
  }));
  return { attempted_at: new Date().toISOString(), delivered: deliveries.every((item) => item.sent), deliveries };
}

module.exports = {
  DEFAULT_VIRTUAL_HOME_NOTIFICATION_EMAILS,
  notificationRecipients,
  notifyVirtualHomeOrder,
  orderEmail
};
