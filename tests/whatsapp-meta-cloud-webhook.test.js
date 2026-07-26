const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

process.env.WHATSAPP_APP_SECRET = 'test-whatsapp-app-secret';

const whatsappRoutes = require('../routes/whatsapp');
const { hasValidMetaWebhookSignature } = whatsappRoutes.__test;

const rawBody = Buffer.from(JSON.stringify({
  object: 'whatsapp_business_account',
  entry: []
}));
const validSignature = `sha256=${crypto
  .createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
  .update(rawBody)
  .digest('hex')}`;

function request(signature, body = rawBody) {
  return {
    rawBody: body,
    get(name) {
      return String(name).toLowerCase() === 'x-hub-signature-256' ? signature : null;
    }
  };
}

assert.equal(
  hasValidMetaWebhookSignature(request(validSignature)),
  true,
  'Meta webhook must accept a valid app-secret signature'
);
assert.equal(
  hasValidMetaWebhookSignature(request('sha256=invalid')),
  false,
  'Meta webhook must reject an invalid signature'
);
assert.equal(
  hasValidMetaWebhookSignature(request(null)),
  false,
  'Meta webhook must reject a missing signature'
);
assert.equal(
  hasValidMetaWebhookSignature({ rawBody: null, get: () => validSignature }),
  false,
  'Meta webhook must reject a request without its raw body'
);

const root = path.join(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const routeSource = fs.readFileSync(path.join(root, 'routes', 'whatsapp.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(root, 'routes', 'admin.js'), 'utf8');
const renderSource = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');

assert(
  serverSource.includes("req.originalUrl === '/api/whatsapp/webhook'")
    && serverSource.includes('req.rawBody = Buffer.from(buffer)'),
  'production server must preserve the raw Meta webhook body'
);
assert(
  routeSource.includes('hasValidMetaWebhookSignature(req)')
    && routeSource.includes("error: 'invalid_whatsapp_signature'"),
  'production webhook must enforce Meta signatures'
);
assert(
  routeSource.includes('setImmediate(() =>')
    && routeSource.includes('processMetaWebhookPayload(payload)')
    && routeSource.includes('accepted: true'),
  'verified Meta webhooks must be acknowledged before AI processing'
);
assert(
  renderSource.includes('WHATSAPP_APP_SECRET'),
  'Render configuration must declare the Meta app secret'
);
assert(
  adminSource.includes('META_WHATSAPP_REQUIRED_ENV.every((key) => envSet(key))')
    && adminSource.includes("if (provider === 'whatsapp') return whatsappProviderConfigured()")
    && adminSource.includes("if (provider === 'whatsapp') return missingWhatsappEnv()"),
  'admin setup status must require a complete WhatsApp provider configuration'
);

console.log('whatsapp Meta Cloud API webhook checks passed');
