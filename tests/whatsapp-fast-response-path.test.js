const assert = require('assert');

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

  console.log('WhatsApp fast response path tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
