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
assert(message.includes('free to post'), 'Agent welcome message must call out free posting');
assert(message.includes('7 languages'), 'Agent welcome message must call out seven languages');
assert(message.includes('we can guide you through your first listings'), 'Agent welcome message must offer onboarding help');
assert(message.includes('makaug.com'), 'Agent welcome message must include makaug.com');
assert(message.includes('Reply STOP'), 'Agent welcome message must include STOP opt-out wording');
assert(message.length <= 1200, 'Agent welcome WhatsApp message must fit outreach send limit');

assert(cardHtml.includes('og:image'), 'Welcome page must expose an Open Graph image for WhatsApp preview cards');
assert(cardHtml.includes('makaug-agent-welcome-card.png'), 'Welcome page must point WhatsApp previews to the PNG card');
assert(cardHtml.includes('List a property free'), 'Welcome page must include a visible listing CTA');

assert(cardSvg.includes('Welcome, Uganda agents'), 'Welcome card must use a warmer welcome headline');
assert(cardSvg.includes('list property free today'), 'Welcome card must include the launch free-posting promise');
assert(cardSvg.includes('7 languages'), 'Welcome card must include seven-language callout');
assert(cardSvg.includes('WhatsApp leads'), 'Welcome card must include WhatsApp lead callout');

assert(senderScript.includes("reviewed: true"), 'Test sender must use the reviewed outreach send path');
assert(senderScript.includes("delivery_mode: 'web_bridge'"), 'Test sender must use the WhatsApp Web bridge for the CEO test');
assert(senderScript.includes('ADMIN_API_KEY'), 'Test sender must use admin-authenticated outreach API');

console.log('Agent welcome WhatsApp template tests passed');
