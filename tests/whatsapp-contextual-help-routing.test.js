const assert = require('assert');

const { classifyWhatsappIntent } = require('../services/aiService');
const whatsappRouter = require('../routes/whatsapp');

const {
  contextualPageRouteFromMessage,
  menuRouteReply,
} = whatsappRouter.__test || {};

assert.strictEqual(typeof contextualPageRouteFromMessage, 'function', 'WhatsApp route must expose contextual page routing for tests');
assert.strictEqual(typeof menuRouteReply, 'function', 'WhatsApp route must expose menu route replies for tests');

async function run() {
  assert.strictEqual(
    contextualPageRouteFromMessage("Hi MakaUg, I'm on makaug.com and need property help.\nPage: makaug.com/broker-signup"),
    'agent_registration',
    'Broker signup page context must route to broker registration help'
  );

  assert.strictEqual(
    contextualPageRouteFromMessage('Can you help with the login process?'),
    'account_help',
    'Login help wording must route to account access help'
  );

  const loginIntent = await classifyWhatsappIntent({
    text: 'Can you help with the login process?',
    step: 'main_menu',
  });
  assert.strictEqual(loginIntent.intent, 'account_help', 'Login process should not be treated as generic support');
  assert(loginIntent.confidence >= 0.7, 'Login process should be confident enough to avoid a confirmation loop');

  const brokerReply = menuRouteReply('en', 'agent_registration').message;
  assert(brokerReply.includes('/broker-signup'), 'Broker reply must point to the broker signup route');
  assert(brokerReply.includes('/login'), 'Broker reply should include the login route for existing users');
  assert(!brokerReply.includes('Search for a property'), 'Broker page context must not fall back to the generic property menu');

  const loginReply = menuRouteReply('en', 'account_help').message;
  assert(loginReply.includes('/login'), 'Login help reply must point to the login route');
  assert(loginReply.includes('/broker-signup'), 'Login help should guide brokers who still need to register');
  assert(!loginReply.includes('Which area'), 'Login help must not become a property search prompt');

  console.log('WhatsApp contextual help routing tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
