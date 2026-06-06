const AGENT_WELCOME_CARD_PATH = '/assets/marketing/makaug-agent-welcome.html';
const AGENT_WELCOME_CARD_PREVIEW_VERSION = 'agent3';
const AGENT_WELCOME_CARD_URL = `https://makaug.com${AGENT_WELCOME_CARD_PATH}?v=${AGENT_WELCOME_CARD_PREVIEW_VERSION}`;
const AGENT_WELCOME_WHATSAPP_TEMPLATE_KEY = 'lead_outreach_agent_welcome_free_card';

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
    ? `I found your public property contact via ${String(source).replace(/\s+/g, ' ').trim().slice(0, 58)}.`
    : 'I wanted to introduce makaug.com.';

  return [
    cardUrl,
    '',
    `Hi ${firstName}, hope you are well. This is the makaug.com team in Uganda.`,
    `${sourceLine} We wanted to introduce ourselves respectfully and invite Uganda agents, brokers, agencies, caretakers, and owners to list genuine property for free on makaug.com.`,
    '',
    'Agents do the hard work every day. We want to help buyers, renters, students, and land seekers find your listings online and contact you clearly.',
    '',
    'On makaug.com:',
    '- Free to list property. No listing charge.',
    '- Add homes, rentals, land, commercial spaces, and student accommodation.',
    '- Receive enquiries by phone, WhatsApp, or website form.',
    '- Works in English, Luganda, Kiswahili, Acholi, Runyankole, Rukiga, Lusoga, Amharic, or Arabic. On WhatsApp, reply LANG to change language.',
    '- Reply YES and we can guide your first listing through WhatsApp.',
    '',
    'Guide: the link above.',
    `List property: ${listPropertyUrl}`,
    `Broker registration: ${brokerSignupUrl}`,
    '',
    'Thank you. Reply STOP if this is not useful, and we will not contact you again.'
  ].join('\n');
}

module.exports = {
  AGENT_WELCOME_CARD_PATH,
  AGENT_WELCOME_CARD_PREVIEW_VERSION,
  AGENT_WELCOME_CARD_URL,
  AGENT_WELCOME_WHATSAPP_TEMPLATE_KEY,
  buildAgentWelcomeWhatsappMessage,
  firstNameFromLeadName
};
