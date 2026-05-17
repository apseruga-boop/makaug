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
    ? `I found your public property contact details via ${String(source).replace(/\s+/g, ' ').trim().slice(0, 90)}.`
    : 'I wanted to introduce MakaUg properly.';

  return [
    cardUrl,
    '',
    `Hi ${firstName}, this is MakaUg.`,
    `${sourceLine} We are launching Uganda's property marketplace and inviting agents, brokers, agencies, and owners to post listings free today.`,
    '',
    'Why it is worth joining now:',
    '- Free to post sale, rent, land, commercial, and student listings',
    '- makaug.com works in 7 languages for more local reach',
    '- Buyers and renters can enquire through the website and WhatsApp',
    '- Early agents get launch visibility while the platform grows',
    '',
    `Start here: ${listPropertyUrl}`,
    '',
    'Reply YES for onboarding help today. Reply STOP and we will not contact you again.'
  ].join('\n');
}

module.exports = {
  AGENT_WELCOME_CARD_PATH,
  AGENT_WELCOME_CARD_URL,
  AGENT_WELCOME_WHATSAPP_TEMPLATE_KEY,
  buildAgentWelcomeWhatsappMessage,
  firstNameFromLeadName
};
