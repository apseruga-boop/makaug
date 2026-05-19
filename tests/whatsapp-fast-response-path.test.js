const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { classifyWhatsappIntent } = require('../services/aiService');
const whatsappRouter = require('../routes/whatsapp');

const {
  fastWhatsappRuntimeHints,
  shouldRunWhatsappLanguageAi,
  shouldUseAiNaturalSearchExtraction,
} = whatsappRouter.__test || {};

assert.strictEqual(typeof fastWhatsappRuntimeHints, 'function', 'WhatsApp route must expose fast runtime hints');
assert.strictEqual(typeof shouldRunWhatsappLanguageAi, 'function', 'WhatsApp route must expose language AI gate');
assert.strictEqual(typeof shouldUseAiNaturalSearchExtraction, 'function', 'WhatsApp route must expose natural search AI gate');

const whatsappWebCopilotSource = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'whatsapp-web-copilot.js'),
  'utf8'
);
const whatsappWebBridgeServiceSource = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'whatsappWebBridgeService.js'),
  'utf8'
);

async function run() {
  const listingMessage = 'Hi MakaUg, I want to list a property. Type: For Sale. Please help me create the listing.';
  const hints = fastWhatsappRuntimeHints({ text: listingMessage, sessionLang: 'en' });
  assert(hints, 'Contextual listing messages should use the fast WhatsApp runtime path');
  assert.strictEqual(hints.intent.intent, 'property_listing', 'Fast path must route listing messages to listing flow');
  assert.strictEqual(hints.intent.entities.listing_type, 'sale', 'Fast path must keep the prefilled For Sale type');
  assert.strictEqual(hints.language.code, 'en', 'Fast path should keep obvious English messages in English');

  const intent = await classifyWhatsappIntent({
    text: listingMessage,
    language: 'en',
    step: 'main_menu',
  });
  assert.strictEqual(intent.intent, 'property_listing', 'Intent classifier must keep listing intent on the fast path');
  assert.strictEqual(intent.model, 'heuristic_fast', 'Default WhatsApp intent mode must avoid a model call');

  const unknownIntent = await classifyWhatsappIntent({
    text: 'Please explain the platform in a bit more detail',
    language: 'en',
    step: 'main_menu',
  });
  assert.strictEqual(unknownIntent.model, 'heuristic_fast', 'Unknown support-style text should still return without waiting on AI');

  assert.strictEqual(
    shouldRunWhatsappLanguageAi({
      text: listingMessage,
      sessionStep: 'main_menu',
      preliminaryLanguage: { code: 'en', confidence: 0.9, source: 'heuristic' },
    }),
    false,
    'Default language detection must not wait on AI when heuristic language is clear'
  );

  assert.strictEqual(
    shouldUseAiNaturalSearchExtraction({ hasSignal: true, area: 'Kampala', searchType: 'rent' }, '2 bedroom in Kampala'),
    false,
    'Default natural search extraction must use deterministic filters immediately'
  );

  assert(
    whatsappWebCopilotSource.includes('WHATSAPP_WEB_COPILOT_SEND_CONFIRM_MS'),
    'WhatsApp Web sender must keep send-confirmation timing configurable for fast replies'
  );
  assert(
    whatsappWebCopilotSource.includes('POLL_MS = Math.min(150, Math.max(40'),
    'WhatsApp Web sender must poll the active chat on a sub-100ms default path'
  );
  assert(
    whatsappWebCopilotSource.includes('RECENT_CHAT_SWEEP_MS = Math.min(300, Math.max(60'),
    'WhatsApp Web sender must sweep recent chats several times per second'
  );
  assert(
    whatsappWebCopilotSource.includes('WHATSAPP_WEB_COPILOT_SEND_COMPOSER_CLEAR_MS'),
    'WhatsApp Web sender must expose a fast composer-clear confirmation timeout'
  );
  assert(
    whatsappWebCopilotSource.includes('waitForReplyComposerCleared(page, SEND_COMPOSER_CLEAR_MS)'),
    'WhatsApp Web sender must use the fast composer-clear timeout after sending'
  );
  assert(
    whatsappWebCopilotSource.includes('SEND_CONFIRM_AFTER_CLEAR_MS'),
    'WhatsApp Web sender must avoid long post-clear waits after the composer clears'
  );
  assert(
    whatsappWebCopilotSource.includes('WHATSAPP_WEB_COPILOT_TRUST_SEND_ON_COMPOSER_CLEAR'),
    'WhatsApp Web sender must allow fast confirmation once WhatsApp clears the composer'
  );
  assert(
    whatsappWebBridgeServiceSource.includes('WHATSAPP_WEB_BRIDGE_RETRY_SECONDS || 1'),
    'WhatsApp Web bridge retry delay should default to one second after a send failure'
  );

  console.log('WhatsApp fast response path tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
