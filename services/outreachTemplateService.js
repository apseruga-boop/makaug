const AGENT_WELCOME_CARD_PATH = '/assets/marketing/makaug-agent-welcome.html';
const AGENT_WELCOME_CARD_URL = `https://makaug.com${AGENT_WELCOME_CARD_PATH}`;
const AGENT_WELCOME_WHATSAPP_TEMPLATE_KEY = 'lead_outreach_agent_welcome_launch_card';

function cleanName(value) {
  return String(value || '')
    .replace(/[^\p{L}\p{N}\s.'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function firstNameFromLeadName(value) {
  const cleaned = cleanName(value);
  if (!cleaned) return 'there';
  const first = cleaned.split(/\s+/)[0] || '';
  return first.length > 1 ? first : cleaned;
}

function buildAgentWelcomeWhatsappMessage({
  name = '',
  source = '',
  cardUrl = AGENT_WELCOME_CARD_URL,
  listPropertyUrl = 'https://makaug.com/list-property',
  brokerSignupUrl = 'https://makaug.com/broker-signup'
} = {}) {
  const firstName = firstNameFromLeadName(name);
  const sourceLine = source
    ? `I came across your public property contact via ${String(source).replace(/\s+/g, ' ').trim().slice(0, 90)} and hope it is okay to introduce ourselves.`
    : 'I hope it is okay to introduce makaug.com properly.';

  return [
    cardUrl,
    '',
    `Hi ${firstName}, hope you are well. This is the makaug.com team.`,
    `${sourceLine} We built makaug.com to help agents, brokers, agencies, and property owners make genuine Uganda property easier to find online.`,
    '',
    'The link above opens a short welcome guide for agents.',
    '',
    'A few helpful things:',
    '- It is free to list property on makaug.com during launch. No listing charge.',
    '- You can add homes, rentals, land, commercial spaces, and student accommodation.',
    '- Clients can search on the website and contact through phone, WhatsApp, or enquiry forms.',
    '- makaug.com supports seven language flows. On WhatsApp, reply LANG to change language.',
    '- If you prefer, reply YES and we can guide your first listing on WhatsApp.',
    '',
    `Website listing page: ${listPropertyUrl}`,
    `Broker registration: ${brokerSignupUrl}`,
    '',
    'Thank you. Reply STOP and we will not contact you again.'
  ].join('\n');
}

module.exports = {
  AGENT_WELCOME_CARD_PATH,
  AGENT_WELCOME_CARD_URL,
  AGENT_WELCOME_WHATSAPP_TEMPLATE_KEY,
  buildAgentWelcomeWhatsappMessage,
  firstNameFromLeadName
};
