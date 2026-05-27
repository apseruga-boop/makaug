const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { classifyWhatsappIntent } = require('../services/aiService');

const whatsappRouteSource = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'whatsapp.js'),
  'utf8'
);
const whatsappWebCopilotSource = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'whatsapp-web-copilot.js'),
  'utf8'
);
const whatsappWebBridgeServiceSource = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'whatsappWebBridgeService.js'),
  'utf8'
);
const llmProviderSource = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'llmProvider.js'),
  'utf8'
);

async function run() {
  const listingMessage = 'Hi makaug, I want to list a property. Type: For Sale. Please help me create the listing.';
  assert(
    whatsappRouteSource.includes('function fastWhatsappRuntimeHints(')
      && whatsappRouteSource.includes('fastWhatsappRuntimeHints,'),
    'WhatsApp route must expose fast runtime hints without the test importing the full production router'
  );
  assert(
    whatsappRouteSource.includes('function shouldRunWhatsappLanguageAi(')
      && whatsappRouteSource.includes('shouldRunWhatsappLanguageAi,'),
    'WhatsApp route must expose the language AI gate'
  );
  assert(
    whatsappRouteSource.includes('function shouldUseAiNaturalSearchExtraction(')
      && whatsappRouteSource.includes('shouldUseAiNaturalSearchExtraction'),
    'WhatsApp route must expose the natural search AI gate'
  );
  assert(
    whatsappRouteSource.includes('fastHints?.intent || await classifyWhatsappIntent'),
    'WhatsApp runtime must use fast hints before falling back to slower intent classification'
  );

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

  assert(
    whatsappRouteSource.includes("if (WHATSAPP_LANGUAGE_AI_MODE !== 'auto') return false")
      && whatsappRouteSource.includes('confidence >= 0.84'),
    'Default language detection must not wait on AI when heuristic language is clear'
  );

  assert(
    whatsappRouteSource.includes("if (WHATSAPP_NATURAL_SEARCH_AI_MODE !== 'auto') return false")
      && whatsappRouteSource.includes('deterministic.hasSignal'),
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
    whatsappWebCopilotSource.includes('WHATSAPP_WEB_COPILOT_FAST_LANE_LIMIT || 3')
      && whatsappWebCopilotSource.includes('ingestRecentChatsSweep(page, RECENT_CHAT_FAST_LANE_LIMIT)'),
    'WhatsApp Web sender must check the newest chat rows every loop before the wider sweep'
  );
  assert(
    whatsappWebCopilotSource.includes('WHATSAPP_WEB_COPILOT_RECENT_SWEEP_OPEN_LIMIT || 5')
      && whatsappWebCopilotSource.includes('openedRows >= RECENT_CHAT_SWEEP_OPEN_LIMIT'),
    'WhatsApp Web sender must cap old-chat openings so stale sweeps cannot hold the loop for a minute'
  );
  assert(
    whatsappWebCopilotSource.includes('WHATSAPP_WEB_COPILOT_RECENT_ROW_CACHE_MS || 1200')
      && whatsappWebCopilotSource.includes('function shouldSkipRecentChatRow(')
      && whatsappWebCopilotSource.includes('function rememberRecentChatRow('),
    'WhatsApp Web sender must cache unchanged recent rows so old chats cannot block fresh replies'
  );
  assert(
    whatsappWebCopilotSource.includes('const sentAtLoopStart = await processOutbox(page, { maxSends: 4 })')
      && whatsappWebCopilotSource.includes('sentAtLoopStart + sentAfterCall'),
    'WhatsApp Web sender must flush already queued replies before doing expensive chat sweeps'
  );
  assert(
    whatsappWebCopilotSource.includes('return finish(true);'),
    'WhatsApp Web sender must stop the recent-chat sweep as soon as it handles a new inbound message'
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
    whatsappWebCopilotSource.includes('WHATSAPP_WEB_COPILOT_SEND_CONFIRM_AFTER_CLEAR_MS || 700'),
    'WhatsApp Web sender must wait briefly for a real outgoing bubble after the composer clears'
  );
  assert(
    whatsappWebCopilotSource.includes("WHATSAPP_WEB_COPILOT_TRUST_SEND_ON_COMPOSER_CLEAR || 'false'"),
    'WhatsApp Web sender must not mark a reply sent from composer-clear alone by default'
  );
  assert(
    whatsappWebCopilotSource.includes('matchedNewText')
      && !whatsappWebCopilotSource.includes('if (matchedText) return true;'),
    'WhatsApp Web sender must not treat an older identical outgoing message as a fresh send confirmation'
  );
  assert(
    whatsappWebBridgeServiceSource.includes('WHATSAPP_WEB_BRIDGE_RETRY_SECONDS || 1'),
    'WhatsApp Web bridge retry delay should default to one second after a send failure'
  );
  assert(
    whatsappWebBridgeServiceSource.includes('WHATSAPP_WEB_BRIDGE_REPLY_DEDUPE_SECONDS || 15'),
    'WhatsApp Web bridge reply dedupe must not hold repeat replies for minutes'
  );
  assert(
    whatsappWebBridgeServiceSource.includes('Math.min(\n    30,\n    Math.max(5, Number(process.env.WHATSAPP_WEB_BRIDGE_REPLY_DEDUPE_SECONDS || 15))'),
    'WhatsApp Web bridge reply dedupe must be capped to seconds even if the environment is misconfigured'
  );
  assert(
    whatsappWebBridgeServiceSource.includes('WHATSAPP_WEB_BRIDGE_CLAIM_SECONDS || 8'),
    'WhatsApp Web bridge claim lease must recover quickly if the browser send path stalls'
  );
  assert(
    whatsappWebBridgeServiceSource.includes('Math.min(\n    20,\n    Math.max(5, Number(process.env.WHATSAPP_WEB_BRIDGE_CLAIM_SECONDS || 8))'),
    'WhatsApp Web bridge claim lease must be capped below one minute'
  );
  assert(
    whatsappWebBridgeServiceSource.includes('duplicate_refreshed_at')
      && whatsappWebBridgeServiceSource.includes('same_reply_new_inbound'),
    'WhatsApp Web bridge must wake an existing pending duplicate reply instead of leaving it delayed'
  );
  assert(
    whatsappWebCopilotSource.includes('WHATSAPP_WEB_COPILOT_RECENTLY_SENT_REPLY_TTL_MS || 15000'),
    'WhatsApp Web copilot duplicate suppression should be seconds, not minutes'
  );
  assert(
    whatsappWebCopilotSource.includes('const RECENTLY_SENT_REPLY_TTL_MS = Math.min(\n  30000,'),
    'WhatsApp Web copilot duplicate suppression must be capped below one minute'
  );
  assert(
    llmProviderSource.includes('function loadOpenAI()')
      && !llmProviderSource.startsWith("const OpenAI = require('openai');"),
    'WhatsApp fast paths must not synchronously load the OpenAI SDK during route startup'
  );

  console.log('WhatsApp fast response path tests passed');
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
