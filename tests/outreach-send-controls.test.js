const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const adminRoutes = read('routes/admin.js');
const probe = read('scripts/probe-backend-connections.js');

for (const expected of [
  "router.post('/outreach/email/send'",
  "router.post('/outreach/whatsapp/send'"
]) {
  assert(adminRoutes.includes(expected), `Outreach route missing: ${expected}`);
}

assert(adminRoutes.includes('router.use(requireAdminApiKey)'), 'Outreach routes must inherit admin protection');
assert(adminRoutes.includes('reviewed=true is required before sending'), 'Outreach sends must require explicit human review');
assert(adminRoutes.includes('outboundEmailDisclosureOk'), 'Email outreach must enforce makaug.com and unsubscribe disclosure');
assert(adminRoutes.includes('outboundWhatsappDisclosureOk'), 'WhatsApp outreach must enforce makaug.com and STOP opt-out disclosure');
assert(adminRoutes.includes('queueWhatsappWebBridgeMessage'), 'WhatsApp outreach must support the WhatsApp Web bridge queue');
assert(adminRoutes.includes('outreach_whatsapp_send_attempt'), 'WhatsApp outreach attempts must be audited/logged');
assert(adminRoutes.includes('lead_outreach_opt_in'), 'WhatsApp outreach must use the opt-in template key');
assert(probe.includes("router.post('/outreach/email/send'"), 'Backend probe must check email outreach route');
assert(probe.includes("router.post('/outreach/whatsapp/send'"), 'Backend probe must check WhatsApp outreach route');

console.log('Outreach send control tests passed');
