const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  AGENT_WELCOME_CARD_PATH,
  AGENT_WELCOME_CARD_PREVIEW_VERSION,
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

assert.strictEqual(AGENT_WELCOME_WHATSAPP_TEMPLATE_KEY, 'lead_outreach_agent_welcome_free_card');
assert.strictEqual(AGENT_WELCOME_CARD_PREVIEW_VERSION, 'agent4');
assert(message.startsWith(AGENT_WELCOME_CARD_URL), 'WhatsApp preview card link should be first for rich preview unfurling');
assert(AGENT_WELCOME_CARD_URL.includes('?v=agent4'), 'WhatsApp card link should include a preview cache-buster');
assert(message.includes('hope you are well'), 'Agent welcome message must use a warm opening');
assert(message.includes('team in Uganda'), 'Agent welcome message must sound Uganda-first');
assert(message.includes('respectfully'), 'Agent welcome message must sound respectful, not arrogant');
assert(message.includes('first 7 days are free'), 'Agent welcome message must state the private-listing trial');
assert(message.includes('UGX 25,000 per property/month'), 'Agent welcome message must state the private-listing monthly price');
assert(message.includes('Agent and broker plans are priced separately'), 'Agent welcome message must separate agent plans from private-listing pricing');
assert(!message.includes('Free to list property'), 'Agent welcome message must not promise unlimited free listing');
assert(!message.includes('No listing charge'), 'Agent welcome message must not promise that no listing charge exists');
assert(message.includes('English, Luganda, Kiswahili, Acholi, Runyankole, Rukiga, Lusoga, Amharic, or Arabic'), 'Agent welcome message must name the nine website languages');
assert(message.includes('reply LANG to change language'), 'Agent welcome message must explain language switching');
assert(message.includes('Guide: the link above'), 'Agent welcome message must explain the click-through guide');
assert(message.includes('WhatsApp'), 'Agent welcome message must mention WhatsApp listing help');
assert(message.includes('Broker registration:'), 'Agent welcome message must include broker registration path');
assert(message.includes('guide your first listing through WhatsApp'), 'Agent welcome message must offer onboarding help');
assert(message.includes('makaug.com'), 'Agent welcome message must include makaug.com');
assert(message.includes('Reply STOP'), 'Agent welcome message must include STOP opt-out wording');
assert(!message.includes('during launch'), 'Agent welcome message must not use temporary launch wording');
assert(!message.includes('free today'), 'Agent welcome message must not say free today');
assert(message.length <= 1200, 'Agent welcome WhatsApp message must fit outreach send limit');

assert(cardHtml.includes('og:image'), 'Welcome page must expose an Open Graph image for WhatsApp preview cards');
assert(cardHtml.includes('makaug-agent-welcome-card-agent-kind.png?v=agent4'), 'Welcome page must point WhatsApp previews to the cache-busted kind PNG card');
assert(cardHtml.includes('Welcome to makaug.com'), 'Welcome page must open with warm makaug.com wording');
assert(cardHtml.includes('A private property listing is free for its first 7 days, then costs UGX 25,000 per property/month.'), 'Welcome page must state the private-listing trial and price');
assert(cardHtml.includes('Agent and broker plans are priced separately.'), 'Welcome page must separate agent plans from private-listing pricing');
assert(cardHtml.includes('Start a property listing'), 'Welcome page must include a visible neutral listing CTA');
assert(!cardHtml.includes('No listing charge'), 'Welcome page must not promise that no listing charge exists');
assert(!cardHtml.includes('List free on makaug.com'), 'Welcome page must not promise unlimited free listing');
assert(!cardHtml.includes('at no cost'), 'Welcome page must not promise agent listings at no cost');
assert(cardHtml.includes('agent-welcome-language'), 'Welcome page must include a visible language selector');
assert(cardHtml.includes('AGENT_WELCOME_I18N'), 'Welcome page must include local language copy');
['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar'].forEach((lang) => {
  assert(cardHtml.includes(`${lang}: {`), `Welcome page must include ${lang} translation copy`);
  assert(cardHtml.includes(`value="${lang}"`), `Welcome page must include ${lang} language option`);
  const localeBlock = cardHtml.match(new RegExp(`\\n\\s+${lang}: \\{([\\s\\S]*?)\\n\\s+\\},?`));
  assert(localeBlock, `Welcome page must expose the ${lang} locale block for pricing checks`);
  assert(localeBlock[1].includes('7 days'), `${lang} welcome pricing must state the trial length`);
  assert(localeBlock[1].includes('UGX 25,000 per property/month'), `${lang} welcome pricing must state the private-listing price`);
  assert(localeBlock[1].includes('Agent and broker plans are priced separately'), `${lang} welcome pricing must separate agent and broker plans`);
});
[
  'No listing charge',
  'Post your properties for free',
  'Agents can add property listings at no cost',
  'List free on makaug.com',
  'Tewali ssente za listing',
  'Hakuna ada ya listing',
  'Pe tye charge me listing',
  'Tihariho sente za listing',
  'የዝርዝር ክፍያ የለም',
  'لا توجد رسوم إدراج'
].forEach((obsoleteClaim) => {
  assert(!cardHtml.includes(obsoleteClaim), `Welcome page must remove obsolete claim: ${obsoleteClaim}`);
});
assert(cardHtml.includes("document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'"), 'Welcome page must switch to RTL for Arabic');
assert(cardHtml.includes('Agent welcome guide'), 'Welcome page must include the agent welcome guide');
assert(cardHtml.includes('Use the website or WhatsApp'), 'Welcome page must explain website and WhatsApp listing capture');
assert(cardHtml.includes('reply LANG to change language'), 'Welcome page must explain language switching');
assert(cardHtml.includes('Register as a broker'), 'Welcome page must include broker registration CTA');
assert(cardHtml.includes('List with WhatsApp help'), 'Welcome page must include WhatsApp help CTA');
assert(cardHtml.includes('href="/broker-signup"'), 'Welcome page broker CTA must route to broker signup');
assert(cardHtml.includes('aria-label="makaug.com agent welcome guide"'), 'Welcome page deck must be accessible');
assert(!cardHtml.includes('makaug is live for Uganda agents'), 'Welcome page must not use the old announcement-style headline');
assert(!cardHtml.includes('during launch'), 'Welcome page must not use temporary launch wording');
assert(!cardHtml.includes('free today'), 'Welcome page must not say free today');

assert(cardSvg.includes('Uganda agents,'), 'Welcome card must use a Uganda agent headline');
assert(cardSvg.includes('bring genuine') && cardSvg.includes('property online'), 'Welcome card must invite agents to bring genuine property online');
assert(cardSvg.includes('Built in Uganda'), 'Welcome card must sound Uganda-first');
assert(cardSvg.includes('Clear pricing'), 'Welcome card must direct agents to clear pricing rather than promise free listings');
assert(!/free (?:listing|to list)|for free/i.test(cardSvg), 'Welcome card must not promise unlimited free listing');
assert(cardSvg.includes('7 days free, then UGX 25,000'), 'Welcome card must state the bounded private-listing trial and price');
assert(cardSvg.includes('Agent plans separate'), 'Welcome card must separate agent pricing from the private-listing price');
assert(cardSvg.includes('9 languages'), 'Welcome card must include nine-language callout');
assert(cardSvg.includes('WhatsApp help'), 'Welcome card must include WhatsApp help callout');
assert(cardSvg.includes('makaug.com'), 'Welcome card must keep the makaug.com brand lowercase');
assert(!cardSvg.includes('free today'), 'Welcome card must not say free today');

assert(senderScript.includes("reviewed: true"), 'Test sender must use the reviewed outreach send path');
assert(senderScript.includes("delivery_mode: 'web_bridge'"), 'Test sender must use the WhatsApp Web bridge for the CEO test');
assert(senderScript.includes('ADMIN_API_KEY'), 'Test sender must use admin-authenticated outreach API');

console.log('Agent welcome WhatsApp template tests passed');
