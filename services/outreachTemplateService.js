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
  listPropertyUrl = 'https://makaug.com/list-property'
} = {}) {
  const firstName = firstNameFromLeadName(name);
  const sourceLine = source
    ? `I came across your public property contact details via ${String(source).replace(/\s+/g, ' ').trim().slice(0, 90)} and wanted to introduce ourselves respectfully.`
    : 'I wanted to introduce MakaUg properly and warmly.';

  return [
    cardUrl,
    '',
    `Hi ${firstName}, hope you are well. This is the MakaUg team.`,
    `${sourceLine} We are launching makaug.com, a Uganda-first property marketplace built to help genuine agents, brokers, agencies, and property owners get more visibility without adding another complicated platform.`,
    '',
    'A few helpful things for agents:',
    '- It is free to post property listings during launch',
    '- makaug.com supports 7 languages, so more local clients can understand and enquire',
    '- You can list homes for sale, rentals, land, commercial spaces, and student accommodation',
    '- Enquiries can come through the website and WhatsApp-friendly follow-up',
    '- If you need help, we can guide you through your first listings',
    '',
    `You can have a look or start here: ${listPropertyUrl}`,
    '',
    'If this sounds useful, reply YES and we will help with onboarding today. Reply STOP and we will not contact you again.'
  ].join('\n');
}

module.exports = {
  AGENT_WELCOME_CARD_PATH,
  AGENT_WELCOME_CARD_URL,
  AGENT_WELCOME_WHATSAPP_TEMPLATE_KEY,
  buildAgentWelcomeWhatsappMessage,
  firstNameFromLeadName
};
