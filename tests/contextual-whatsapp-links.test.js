const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sanitizer = fs.readFileSync(path.join(root, 'services', 'publicHtmlSanitizer.js'), 'utf8');

for (const expected of [
  'const PUBLIC_WHATSAPP_CONTEXTS = Object.freeze',
  'function buildPublicWhatsappMessage',
  'function supportWhatsappUrl',
  'function syncPublicWhatsappLinks',
  'function openSupportWhatsApp',
  'function buildBrokerContactWhatsappMessage',
  'whatsapp_support_clicked'
]) {
  assert(appSource.includes(expected), `missing contextual WhatsApp implementation: ${expected}`);
}

for (const context of [
  'sale',
  'rent',
  'students',
  'commercial',
  'land',
  'brokers',
  'mortgage',
  'ai-chatbot',
  'advertise',
  'fraud',
  'list-property',
  'broker-profile',
  'detail'
]) {
  assert(appSource.includes(`${context}:`) || appSource.includes(`"${context}":`), `missing WhatsApp context copy for ${context}`);
}

assert(appSource.includes('Page: makaug.com'), 'support WhatsApp messages should include the originating page');
assert(appSource.includes('buildDetailSupportWhatsappMessage()'), 'property detail floating support must include listing context');
assert(appSource.includes('buildBrokerProfileSupportWhatsappMessage()'), 'broker profile floating support must include broker context');
assert(appSource.includes('buildWhatsAppUrl(whatsapp, buildBrokerContactWhatsappMessage(b))'), 'broker WhatsApp buttons must use the normalized number and open with a prefilled broker message');
assert(!appSource.includes('href="https://wa.me/${b.whatsapp}"'), 'broker WhatsApp links must not be bare wa.me links');
assert(appSource.includes('const LISTING_WHATSAPP_CONTACT_I18N = Object.freeze'), 'listing contact WhatsApp copy must be language-aware');
for (const lang of ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm']) {
  assert(appSource.includes(`${lang}: {`), `listing contact WhatsApp copy must include ${lang}`);
}
const listingMessageStart = appSource.indexOf('function buildListingWhatsappMessageForUi');
const listingMessageEnd = appSource.indexOf('async function recordListingWhatsappClick', listingMessageStart);
const listingMessageSource = appSource.slice(listingMessageStart, listingMessageEnd);
assert(appSource.includes('I am writing to enquire about this'), 'listing contact WhatsApp text should open with a human enquiry');
assert(listingMessageSource.includes('listingWhatsappContactText("link", { url })'), 'listing contact WhatsApp text must keep the property link');
assert(!listingMessageSource.includes('Ref: ${ref}'), 'listing contact WhatsApp text must not expose internal listing references');
assert(!listingMessageSource.includes('getListingWhatsappRef'), 'listing contact WhatsApp text must not use the raw listing reference');
assert(appSource.includes('"lp-wa-link", "lp-whatsapp-option-btn", "lp-whatsapp-option-inline-btn"'), 'listing WhatsApp links should keep their richer listing-specific builder');
assert(appSource.includes('syncPublicWhatsappLinks(body);'), 'modal-rendered public WhatsApp CTAs should be synced after injection');
assert(appSource.includes('syncPublicWhatsappLinks();'), 'route/render updates should resync public WhatsApp CTAs');

for (const expected of [
  'id="topbar-whatsapp-link"',
  'id="floating-whatsapp-link"',
  'data-public-whatsapp-link data-whatsapp-context="auto"',
  'id="ai-cta-btn"',
  'data-public-whatsapp-link data-whatsapp-context="ai-chatbot"',
  'id="fraud-wa-btn"',
  'data-public-whatsapp-link data-whatsapp-context="fraud"',
  'data-public-whatsapp-link data-whatsapp-context="about"',
  'id="listing-submit-whatsapp-link"',
  'data-public-whatsapp-link data-whatsapp-context="list-property"'
]) {
  assert(html.includes(expected), `missing contextual WhatsApp HTML marker: ${expected}`);
}

assert(html.includes("openSupportWhatsApp('students', { source: 'student_dashboard_whatsapp' })"), 'student help CTA should use the shared contextual WhatsApp opener');
assert(html.includes('contextual-whatsapp-20260517'), 'Frontend cache version must be bumped for contextual WhatsApp rollout');
assert(html.includes('whatsapp-prefill-copy-20260517'), 'Frontend cache version must be bumped for WhatsApp listing prefill copy changes');
assert(html.includes('listing-contact-whatsapp-i18n-20260519'), 'Frontend cache version must be bumped for listing contact WhatsApp language copy');
assert(sanitizer.includes('data-public-whatsapp-link data-whatsapp-context="${whatsappContext}"'), 'synthetic public routes should mark support WhatsApp links for runtime context sync');

console.log('Contextual WhatsApp link tests passed');
