const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  AGENT_WELCOME_CARD_PATH,
  AGENT_WELCOME_CARD_URL,
  AGENT_WELCOME_WHATSAPP_TEMPLATE_KEY,
  buildAgentWelcomeWhatsappMessage
} = require('../services/outreachTemplateService');

const root = path.join(__dirname, '..');
const cardHtmlPath = path.join(root, AGENT_WELCOME_CARD_PATH);
const cardSvgPath = path.join(root, 'assets/marketing/makaug-agent-welcome-card.svg');
const cardHtml = fs.readFileSync(cardHtmlPath, 'utf8');
const cardSvg = fs.readFileSync(cardSvgPath, 'utf8');
const senderScript = fs.readFileSync(path.join(root, 'scripts/send-agent-welcome-whatsapp-test.js'), 'utf8');

const message = buildAgentWelcomeWhatsappMessage({
  name: 'Ecoland Property Services',
  source: 'RED Uganda'
});

assert.strictEqual(AGENT_WELCOME_WHATSAPP_TEMPLATE_KEY, 'lead_outreach_agent_welcome_launch_card');
assert(message.startsWith(AGENT_WELCOME_CARD_URL), 'WhatsApp preview card link should be first for rich preview unfurling');
assert(message.includes('hope you are well'), 'Agent welcome message must use a warm opening');
assert(message.includes('free to list property'), 'Agent welcome message must call out free listing');
assert(message.includes('No listing charge'), 'Agent welcome message must make the no-charge promise explicit');
assert(message.includes('seven language flows'), 'Agent welcome message must call out seven language support');
assert(message.includes('reply LANG to change language'), 'Agent welcome message must explain language switching');
assert(message.includes('short welcome guide for agents'), 'Agent welcome message must explain the click-through guide');
assert(message.includes('WhatsApp'), 'Agent welcome message must mention WhatsApp listing help');
assert(message.includes('Broker registration:'), 'Agent welcome message must include broker registration path');
assert(message.includes('guide your first listing on WhatsApp'), 'Agent welcome message must offer onboarding help');
assert(message.includes('makaug.com'), 'Agent welcome message must include makaug.com');
assert(message.includes('Reply STOP'), 'Agent welcome message must include STOP opt-out wording');
assert(message.length <= 1200, 'Agent welcome WhatsApp message must fit outreach send limit');

assert(cardHtml.includes('og:image'), 'Welcome page must expose an Open Graph image for WhatsApp preview cards');
assert(cardHtml.includes('makaug-agent-welcome-card.png'), 'Welcome page must point WhatsApp previews to the PNG card');
assert(cardHtml.includes('Welcome to makaug.com'), 'Welcome page must open with warm makaug.com wording');
assert(cardHtml.includes('No listing charge'), 'Welcome page must make free listing explicit');
assert(cardHtml.includes('List free on makaug.com'), 'Welcome page must include a visible website listing CTA');
assert(cardHtml.includes('Agent welcome guide'), 'Welcome page must include the agent welcome guide');
assert(cardHtml.includes('Use the website or WhatsApp'), 'Welcome page must explain website and WhatsApp listing capture');
assert(cardHtml.includes('reply LANG to change language'), 'Welcome page must explain language switching');
assert(cardHtml.includes('Register as a broker'), 'Welcome page must include broker registration CTA');
assert(cardHtml.includes('List with WhatsApp help'), 'Welcome page must include WhatsApp help CTA');
assert(cardHtml.includes('href="/broker-signup"'), 'Welcome page broker CTA must route to broker signup');
assert(cardHtml.includes('aria-label="makaug.com agent welcome guide"'), 'Welcome page deck must be accessible');
assert(!cardHtml.includes('MakaUg is live for Uganda agents'), 'Welcome page must not use the old announcement-style headline');

assert(cardSvg.includes('Hello Uganda agents'), 'Welcome card must use a warmer welcome headline');
assert(cardSvg.includes('list property free with us'), 'Welcome card must include the free-listing promise');
assert(cardSvg.includes('Free to list'), 'Welcome card must use free-list wording');
assert(cardSvg.includes('7 languages'), 'Welcome card must include seven-language callout');
assert(cardSvg.includes('WhatsApp help'), 'Welcome card must include WhatsApp help callout');
assert(cardSvg.includes('makaug.com'), 'Welcome card must keep the makaug.com brand lowercase');

assert(senderScript.includes("reviewed: true"), 'Test sender must use the reviewed outreach send path');
assert(senderScript.includes("delivery_mode: 'web_bridge'"), 'Test sender must use the WhatsApp Web bridge for the CEO test');
assert(senderScript.includes('ADMIN_API_KEY'), 'Test sender must use admin-authenticated outreach API');

console.log('Agent welcome WhatsApp template tests passed');
