const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { classifyWhatsappIntent } = require('../services/aiService');
const db = require('../config/database');
const { markWhatsappWebBridgeMessageFailed } = require('../services/whatsappWebBridgeService');

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
const whatsappBridgeReadinessSource = fs.readFileSync(
  path.join(__dirname, '..', 'services', 'whatsappBridgeReadiness.js'),
  'utf8'
);
const adminRouteSource = fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'admin.js'),
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
  assert(
    whatsappRouteSource.includes("deferWhatsappWork('WhatsApp property search analytics'")
      && whatsappRouteSource.includes('function logPropertySearchRequest({'),
    'property-search analytics writes must not block the customer reply'
  );
  assert(
    whatsappRouteSource.includes("deferWhatsappWork('WhatsApp no-match lead capture'")
      && whatsappRouteSource.includes("deferWhatsappWork('WhatsApp inbound bridge heartbeat'"),
    'lead capture and per-message bridge telemetry must not block the customer reply'
  );
  assert(
    whatsappRouteSource.includes("source: normalizeInput(inboundMetadata.source || 'web_bridge_inbound')")
      && !whatsappRouteSource.includes("metadata: {\n        ...inboundMetadata,\n        ...(contactName ? { contact_name: contactName } : {}),\n        last_inbound_message_id: inboundMessageId"),
    'bridge heartbeat metadata must not persist heavyweight inline media payloads'
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
    whatsappWebCopilotSource.includes('POLL_MS = Math.min(5000, Math.max(400')
      && whatsappWebCopilotSource.includes('WHATSAPP_WEB_COPILOT_POLL_MS || 500'),
    'WhatsApp Web sender must stay responsive without a memory-exhausting 50ms busy loop'
  );

  assert(
    whatsappBridgeReadinessSource.includes('evaluateHostedWhatsappBridgeReadiness')
      && whatsappBridgeReadinessSource.includes('hosted_agent_online')
      && whatsappBridgeReadinessSource.includes('only_local_laptop_bridge_is_online')
      && adminRouteSource.includes('evaluateHostedWhatsappBridgeReadiness')
      && adminRouteSource.includes('webBridge: {'),
    'Admin WhatsApp health must expose hosted/live bridge readiness, not only raw bridge clients'
  );
  assert(
    whatsappWebCopilotSource.includes('RECENT_CHAT_SWEEP_MS = Math.min(30000, Math.max(1500')
      && whatsappWebCopilotSource.includes('FAST_LANE_SWEEP_MS = Math.min(5000, Math.max(500')
      && whatsappWebCopilotSource.includes('WHATSAPP_WEB_COPILOT_FAST_LANE_SWEEP_MS || 650'),
    'WhatsApp Web sender must rate-limit wide scans while retaining a bounded fast lane'
  );
  assert(
    whatsappWebCopilotSource.includes('WHATSAPP_WEB_COPILOT_OUTBOX_POLL_MS || 750')
      && whatsappWebCopilotSource.includes('OUTBOX_POLL_MS = Math.min(10000, Math.max(500'),
    'queued replies must be claimed on a sub-second cadence without a busy loop'
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
    whatsappWebCopilotSource.includes('WHATSAPP_WEB_COPILOT_RECENT_ROW_CACHE_MS || 300000')
      && whatsappWebCopilotSource.includes('function shouldSkipRecentChatRow(')
      && whatsappWebCopilotSource.includes('function rememberRecentChatRow(')
      && whatsappWebCopilotSource.includes('RECENT_CHAT_ROW_CACHE_FILE')
      && whatsappWebCopilotSource.includes('loadRecentChatRowCache()'),
    'WhatsApp Web sender must persist unchanged row fingerprints so old media-heavy chats cannot block fresh replies after restart'
  );
  assert(
    whatsappWebCopilotSource.includes('WHATSAPP_WEB_COPILOT_MEMORY_RECYCLE_MB || 1800')
      && whatsappWebCopilotSource.includes('function readContainerMemoryBytes()')
      && whatsappWebCopilotSource.includes("phase: 'memory_pressure_recycle'")
      && whatsappWebCopilotSource.includes('planned browser recycle at'),
    'WhatsApp Web sender must recycle Chromium gracefully before the 2 GB worker is killed'
  );
  assert(
    whatsappWebCopilotSource.includes('if (now - lastOutboxPoll >= OUTBOX_POLL_MS)')
      && whatsappWebCopilotSource.includes('sentAtLoopStart = await processOutbox(page, { maxSends: 4 })')
      && whatsappWebCopilotSource.includes('sentAtLoopStart + sentAfterCall'),
    'WhatsApp Web sender must flush queued replies on a bounded interval before expensive chat sweeps'
  );
  assert(
    whatsappWebCopilotSource.includes('return finish(true);'),
    'WhatsApp Web sender must stop the recent-chat sweep as soon as it handles a new inbound message'
  );
  assert(
    whatsappWebCopilotSource.includes('MEDIA_HYDRATION_BACKOFF_MS')
      && whatsappWebCopilotSource.includes('mediaHydrationBackoffs')
      && whatsappWebCopilotSource.includes('deferredMediaHydration(pendingSnapshot, row)'),
    'an unavailable historical media preview must back off before hydration so it cannot hot-loop ahead of new chats'
  );
  assert(
    whatsappWebCopilotSource.includes("WHATSAPP_RESPONSE_RELIABILITY_MARKER = 'whatsapp-rendered-text-confirmation-20260909'")
      && whatsappWebCopilotSource.includes('response_reliability_marker: WHATSAPP_RESPONSE_RELIABILITY_MARKER'),
    'bridge heartbeats must identify the response-latency reliability release'
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
    whatsappWebCopilotSource.includes('WHATSAPP_WEB_COPILOT_SEND_CONFIRM_AFTER_CLEAR_MS || 3000')
      && whatsappWebCopilotSource.includes('Math.min(\n  5000,'),
    'interactive workers must retain the strict outgoing-bubble confirmation window'
  );
  assert(
    whatsappWebCopilotSource.includes('WHATSAPP_WEB_COPILOT_TRUSTED_CLEAR_GRACE_MS || 125')
      && whatsappWebCopilotSource.includes('? TRUSTED_COMPOSER_CLEAR_GRACE_MS')
      && whatsappWebCopilotSource.includes(': SEND_CONFIRM_AFTER_CLEAR_MS'),
    'the trusted hosted worker must release the scan loop without waiting three seconds for a UI animation'
  );
  assert(
    whatsappWebCopilotSource.includes('browser_send_ms=${browserSendMs}')
      && whatsappWebCopilotSource.includes("queue_age_ms=${queueAgeMs ?? 'unknown'}"),
    'production logs must expose browser-send and queue-age timing for response SLO verification'
  );
  const priorityScanIndex = whatsappWebCopilotSource.indexOf('const activeProcessed = await ingestActiveChat(page)');
  const configuredRecoveryIndex = whatsappWebCopilotSource.indexOf(
    'const recovery = await runConfiguredEmployeeBatchRecovery(page)',
    priorityScanIndex
  );
  assert(
    priorityScanIndex >= 0
      && configuredRecoveryIndex > priorityScanIndex
      && whatsappWebCopilotSource.includes('now - sessionStartedAt >= EMPLOYEE_BATCH_RECOVERY_IDLE_MS'),
    'legacy Agent 007 recovery must run only after live customer scans and an idle startup grace period'
  );
  assert(
    whatsappWebCopilotSource.includes("WHATSAPP_WEB_COPILOT_TRUST_SEND_ON_COMPOSER_CLEAR || 'false'"),
    'WhatsApp Web sender must not mark a reply sent from composer-clear alone by default'
  );
  assert(
    whatsappWebCopilotSource.includes('const TRUST_SEND_ON_COMPOSER_CLEAR = HOSTED_RUNTIME &&'),
    'local WhatsApp workers must require a visible outgoing bubble even when headless mode is enabled'
  );
  assert(
    whatsappWebCopilotSource.includes('send bubble was not observed after composer cleared; trusting composer-clear send confirmation by override')
      && whatsappWebCopilotSource.includes('send bubble was not observed after Enter; trusting composer-clear send confirmation by override'),
    'WhatsApp Web sender must honor the explicit composer-clear trust override in its send fallback branches'
  );
  assert(
    whatsappWebCopilotSource.includes('matchedNewText')
      && !whatsappWebCopilotSource.includes('if (matchedText) return true;'),
    'WhatsApp Web sender must not treat an older identical outgoing message as a fresh send confirmation'
  );
  assert(
    whatsappWebCopilotSource.includes('function normalizeOutgoingConfirmationText')
      && whatsappWebCopilotSource.includes("replace(/[*_~`]/g, '')")
      && whatsappWebCopilotSource.includes('Extended_Pictographic')
      && whatsappWebCopilotSource.includes('normalizeOutgoingConfirmationText(expectedText)'),
    'outgoing confirmation must compare the text WhatsApp actually renders after removing formatting and emoji image markers'
  );
  assert(
    whatsappWebCopilotSource.includes('hasOutgoingDeliveryState')
      && whatsappWebCopilotSource.includes('/^(?:sent|delivered|read|pending)$/')
      && whatsappWebCopilotSource.includes("root.querySelectorAll?.('[aria-label], [data-icon], [data-testid]')"),
    'WhatsApp Web sender must recognize current Sent, Delivered, Read, and pending delivery ticks as outgoing-bubble proof'
  );
  assert(
    whatsappWebCopilotSource.includes('function isAmbiguousWhatsappSendError(error)')
      && whatsappWebCopilotSource.includes('do_not_retry: ambiguousBrowserSend')
      && whatsappWebCopilotSource.includes('suppressed automatic retry to prevent a duplicate reply'),
    'a cleared composer without observable bubble proof must be treated as ambiguous and never automatically resent'
  );
  assert(
    whatsappRouteSource.includes('const suppressRetry = ambiguousBrowserSend &&')
      && whatsappRouteSource.includes('{ suppressRetry }')
      && whatsappWebBridgeServiceSource.includes("status = CASE WHEN $5::boolean OR attempts + 1 >= 8 THEN 'failed' ELSE 'retry' END")
      && whatsappRouteSource.includes('retry_suppressed: suppressRetry'),
    'the bridge API must terminally fail ambiguous browser sends while retaining audit metadata'
  );
  assert(
    whatsappRouteSource.includes('WHATSAPP_WEB_BRIDGE_TEXT_INBOUND_DEDUPE_SECONDS || 180')
      && whatsappRouteSource.includes('? Math.min(600, Math.max(60,')
      && whatsappRouteSource.includes(': process.env.WHATSAPP_WEB_BRIDGE_INBOUND_DEDUPE_SECONDS || 25')
      && whatsappRouteSource.includes('getBridgeInboundDedupeSeconds({ messageType, mediaType })'),
    'text-only browser re-observation must be deduped for minutes without suppressing consecutive Agent 007 media'
  );
  const originalQuery = db.query;
  let capturedFailureUpdate = null;
  try {
    db.query = async (sql, params) => {
      capturedFailureUpdate = { sql, params };
      return { rows: [{ id: 'queue-1', status: 'failed' }] };
    };
    const terminalFailure = await markWhatsappWebBridgeMessageFailed(
      'queue-1',
      'WhatsApp send was not confirmed after composer cleared',
      { ambiguous_browser_send: true, retry_suppressed: true },
      { suppressRetry: true }
    );
    assert.strictEqual(terminalFailure.status, 'failed');
    assert(capturedFailureUpdate.sql.includes("status = CASE WHEN $5::boolean OR attempts + 1 >= 8 THEN 'failed' ELSE 'retry' END"));
    assert.strictEqual(capturedFailureUpdate.params[4], true, 'ambiguous sends must bind the terminal-failure flag');
    assert.strictEqual(JSON.parse(capturedFailureUpdate.params[3]).retry_suppressed, true);
  } finally {
    db.query = originalQuery;
  }
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
    whatsappWebBridgeServiceSource.includes('WHATSAPP_WEB_BRIDGE_CLAIM_SECONDS || 90'),
    'WhatsApp Web bridge claim lease must remain longer than the browser send confirmation path'
  );
  assert(
    whatsappWebBridgeServiceSource.includes("'browser_database_error'")
      && whatsappRouteSource.includes("router.post('/web-bridge/heartbeat', asyncRoute(async (req, res) => {"),
    'WhatsApp Web bridge heartbeat must accept browser database error status without crashing the process'
  );
  assert(
    [
      "router.get('/web-bridge/status', asyncRoute(async (req, res) => {",
      "router.get('/web-bridge/outbox', asyncRoute(async (req, res) => {",
      "router.post('/web-bridge/outbox/:id/sent', asyncRoute(async (req, res) => {",
      "router.post('/web-bridge/outbox/:id/failed', asyncRoute(async (req, res) => {"
    ].every((route) => whatsappRouteSource.includes(route)),
    'Every async WhatsApp Web bridge delivery route must forward database failures instead of crashing production'
  );
  assert(
    whatsappWebBridgeServiceSource.includes('Math.min(\n    180,\n    Math.max(60, Number(process.env.WHATSAPP_WEB_BRIDGE_CLAIM_SECONDS || 90))'),
    'WhatsApp Web bridge claim lease must prevent an in-flight browser send from being reclaimed and duplicated'
  );
  assert(
    whatsappWebCopilotSource.includes('skipped overlapping outbox drain; the active browser send retains its queue lease'),
    'one worker process must never type two queued replies into the composer concurrently'
  );
  assert(
    whatsappWebCopilotSource.includes('async function dismissReplyBlockingDialog(page)')
      && whatsappWebCopilotSource.includes("await page.keyboard.press('Escape').catch(() => null)")
      && whatsappWebCopilotSource.includes('await dismissReplyBlockingDialog(page);')
      && whatsappWebCopilotSource.includes("/^starting chat\\b/i.test(blockingDialog.label || '')")
      && whatsappWebCopilotSource.includes("/^starting chat\\b/i.test(before.label || '')"),
    'WhatsApp Web sender must dismiss stale modal blockers while allowing a new-chat overlay to finish normally'
  );
  assert(
    whatsappWebCopilotSource.includes("await page.keyboard.insertText(String(text || ''))")
      && whatsappWebCopilotSource.includes('reply composer exact-text verification failed; expected_len='),
    'WhatsApp Web sender must insert generated Unicode text exactly and log privacy-safe mismatch evidence'
  );
  assert(
    whatsappWebCopilotSource.includes('async function prepareExactReplyText(page, text, attempts = 3)')
      && whatsappWebCopilotSource.includes('reply composer was not ready; reacquiring it')
      && whatsappWebCopilotSource.includes('if (!await prepareExactReplyText(page, text))'),
    'a transient WhatsApp composer remount must be recovered in the same send attempt'
  );
  const openChatIndex = whatsappWebCopilotSource.indexOf('async function openChatForReply(page, recipient)');
  const openChatBody = whatsappWebCopilotSource.slice(openChatIndex, whatsappWebCopilotSource.indexOf('async function typeAndSendReply', openChatIndex));
  assert(
    !openChatBody.includes('activeInboundRecipientHint && activeInboundRecipientHint === normalizedRecipient'),
    'outbox delivery must verify the active chat instead of trusting a stale inbound-recipient hint'
  );
  assert(
    openChatBody.indexOf('await page.keyboard.type(phoneDigits || chatKey')
      < openChatBody.indexOf('page.goto(`https://web.whatsapp.com/send?phone='),
    'chat opening must use the already-loaded WhatsApp search before disruptive direct-phone navigation'
  );
  assert(
    openChatBody.includes('returning to the loaded chat list'),
    'a direct-phone timeout must recover to the chat list instead of crashing the live bridge loop'
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
