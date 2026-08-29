'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  EMPLOYEE_INTAKE_STEPS,
  employeeIntakePhoneAllowed,
  isEmployeeIntakeComplete,
  isEmployeeIntakeTrigger,
  parseCustomerDetails,
  parseEmployeeRole,
  parseNewAgentDetails,
  parsePropertyBatchMode,
  parseYesNo
} = require('../services/whatsappEmployeeIntakeService');

assert.equal(isEmployeeIntakeTrigger('Agent 007'), true, 'exact Agent 007 trigger should start staff intake');
assert.equal(isEmployeeIntakeTrigger('  agent   007  '), true, 'spacing and case should be normalized');
assert.equal(isEmployeeIntakeTrigger('Agent 007 please'), false, 'trigger must not match surrounding prose');
assert.equal(parseEmployeeRole('1'), 'agent');
assert.equal(parseEmployeeRole('new customer'), 'customer');
assert.equal(parseYesNo('yes'), 'yes');
assert.equal(parseYesNo('2'), 'no');
assert.equal(parsePropertyBatchMode('one property'), 'single');
assert.equal(parsePropertyBatchMode('2'), 'multiple');
assert.equal(parsePropertyBatchMode('twenty'), '');
assert.deepEqual(parseNewAgentDetails('Francis Isabirye | +256 768 524008 | Francis Homes | Kampala'), {
  fullName: 'Francis Isabirye',
  phone: '+256 768 524008',
  company: 'Francis Homes',
  district: 'Kampala'
});
assert.deepEqual(parseCustomerDetails('Arthur Seruga | +44 7757 773202 | Kira, Wakiso'), {
  fullName: 'Arthur Seruga',
  phone: '+44 7757 773202',
  location: 'Kira, Wakiso'
});
assert.equal(parseCustomerDetails('Arthur only'), null, 'customer detail collection should fail closed');
assert.equal(isEmployeeIntakeComplete('COMPLETE'), true);
assert.equal(isEmployeeIntakeComplete('complete complete'), true);
assert.equal(isEmployeeIntakeComplete('complete this'), false);
assert.equal(employeeIntakePhoneAllowed('+44 7757 773202', { allowlist: '', ownerAuthorized: false }), true, 'empty allowlist preserves exact-trigger mode');
assert.equal(employeeIntakePhoneAllowed('+44 7757 773202', { allowlist: '+447757773202,+256700000000', ownerAuthorized: false }), true);
assert.equal(employeeIntakePhoneAllowed('+44 7757 773202', { allowlist: '+44 7757 773202; +256 700 000000', ownerAuthorized: false }), true, 'formatted allowlist numbers should remain whole');
assert.equal(employeeIntakePhoneAllowed('+44 7000 000000', { allowlist: '+447757773202', ownerAuthorized: false }), false);
assert.equal(employeeIntakePhoneAllowed('+44 7000 000000', { allowlist: '+447757773202', ownerAuthorized: true }), true, 'owner control phone remains authorized');
assert(EMPLOYEE_INTAKE_STEPS.includes('employee_identity_photo'));
assert(EMPLOYEE_INTAKE_STEPS.includes('employee_property_count'));
assert(EMPLOYEE_INTAKE_STEPS.includes('employee_property_media'));

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
const copilotSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'whatsapp-web-copilot.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const whatsappRoute = require('../routes/whatsapp').__test;
const parsedProperty = whatsappRoute.employeePropertyFacts(
  '2 bedroom apartment for rent in Ntinda, Kampala at UGX 1.5m per month',
  {}
);

assert.equal(parsedProperty.listingType, 'rent');
assert.equal(parsedProperty.price, 1_500_000);
assert.equal(parsedProperty.bedroomDraft.bedrooms, 2, 'decimal prices must not overwrite the explicit bedroom count');
assert.equal(parsedProperty.locationPatch.area, 'Ntinda');
assert.equal(parsedProperty.locationPatch.district, 'Kampala');
assert.deepEqual(whatsappRoute.employeePropertyMissing(parsedProperty), []);

assert(routeSource.includes("const WHATSAPP_EMPLOYEE_AGENT_007_MARKER = 'whatsapp-employee-agent-007-review-intake-20260829'"));
assert(routeSource.includes("$16,'pending','submitted','whatsapp','whatsapp_employee_intake'"), 'employee properties must enter staff review as pending');
assert(routeSource.includes('review_only: true') && routeSource.includes('auto_publish: false'), 'review-only and no-autopublish gates are required');
assert(routeSource.includes("'whatsapp-employee-agent-007','whatsapp_employee_intake_queued','pending','pending'"), 'moderation history must retain pending status');
assert(routeSource.includes('whatsapp_employee_property_review_queued'), 'each property should create a notification/audit record');
assert(routeSource.includes('whatsapp_employee_batch_complete'), 'completed batches should create a WhatsApp notification record');
assert(routeSource.includes("const WHATSAPP_AGENT_007_ORDERED_BATCH_MARKER = 'whatsapp-agent-007-ordered-batch-finalization-20260829'"), 'ordered batch release must be traceable');
assert(routeSource.includes('const whatsappInboundRuntimeQueues = new Map()'), 'same-phone messages must be serialized');
assert(routeSource.includes('processInboundRuntimeUnlocked'), 'the serialized runtime must wrap the original inbound processor');
assert(routeSource.includes('function processWhatsappCallEvent(input = {})'), 'call events must use the same per-phone runtime queue');
assert.equal((routeSource.match(/await processWhatsappCallEvent\(\{/g) || []).length, 3, 'all three provider call-event paths must be serialized');
assert(routeSource.includes('active_employee_intake_preserved: true'), 'call events must not take over an active employee intake');
assert(routeSource.includes('call_reply_suppressed: true'), 'suppressed call events must remain auditable');
assert(routeSource.includes('suppressedActiveEmployeeIntake: true'), 'call routing must report the employee-intake shield');
assert(routeSource.includes('recoverInterruptedEmployeeIntakeStep'), 'sessions already interrupted by the old missed-call handler must recover');
assert(copilotSource.includes("skipped: 'unresolved_phone_for_call'"), 'display names must never be accepted as call-event phone identities');
assert(copilotSource.includes('isResolvableWhatsappCallChatKey(normalizedChatKey)'), 'call-card ingestion must require a resolvable WhatsApp phone identity');
assert(copilotSource.includes("'call-card',\n    normalizedChatKey"), 'repeated DOM scans must share a semantic call-card cooldown key');
assert(copilotSource.includes("snapshot.timestampLabel || row.timestampLabel || ''"), 'call-card IDs must use stable timestamps');
assert(!copilotSource.includes("snapshot.messageId || snapshot.mediaFingerprint || ''\n  );"), 'call-card IDs must not depend on unstable DOM row fingerprints');
assert(routeSource.includes('Properties received: ${batchCounts.propertiesShared}'), 'completion must report the shared count');
assert(routeSource.includes('Sent to staff review: ${batchCounts.propertiesSetUp}'), 'completion must report the successful setup count');
assert(routeSource.includes('Duplicates skipped: ${batchCounts.duplicatesSkipped}'), 'completion must report duplicates');
assert(routeSource.includes('Could not be processed: ${batchCounts.propertiesFailed}'), 'completion must report failures');
assert(routeSource.includes("type: 'whatsapp_agent_batch_card_awaiting_approval'"), 'agent notification must wait at the founder approval gate');
assert(routeSource.includes("status: 'awaiting_founder_approval'"), 'pending agent-card state must be durable');
assert(routeSource.includes('whatsapp_employee_batch_mode') && routeSource.includes('whatsapp_employee_batch_property_number'), 'review records should retain multiple-property batch traceability');
assert(routeSource.includes("=== 'single' && existingBatchProperties >= 1"), 'single mode must reject a second property without affecting multiple mode');
assert(routeSource.includes("keyPrefix: privateMedia ? 'whatsapp-employee-intake/private-id'"), 'ID media must use private cloud storage');
assert(routeSource.includes('id_document_name, id_document_url, extra_fields'), 'customer ID must use protected property identity columns');
assert(!routeSource.includes('customer_identity_document_url'), 'private ID references must never be copied into public extra fields');
assert(routeSource.includes('agent_profile_linked: Boolean(agent?.id)'), 'approved agent link state must be visible to moderation');
assert(routeSource.includes('video_urls: videoMedia.map'), 'video references must be preserved for staff review');
assert(routeSource.includes('document_urls: documentMedia.map'), 'document references must be preserved for staff review');
assert(routeSource.includes('media_sha256'), 'media deduplication hashes must be persisted');
assert(routeSource.includes('source_caption_sha256') && routeSource.includes("status IN ('pending','approved')"), 'property-level duplicate checks must cover pending and approved inventory');
assert(!routeSource.includes("source = 'whatsapp_employee_intake' AND status = 'approved'"), 'employee intake must never auto-approve');
assert(copilotSource.includes('async function hydrateVideoSnapshot'), 'WhatsApp Web bridge should download video bytes');
assert(copilotSource.includes('media_previews:'), 'WhatsApp Web bridge should transmit non-image media bytes');
assert(copilotSource.includes('release_marker: WHATSAPP_EMPLOYEE_AGENT_007_WORKER_MARKER'), 'hosted worker heartbeat should prove the Agent 007 build');
assert(copilotSource.includes('const RECENT_INBOUND_BACKLOG_LIMIT = 60'), 'worker must inspect the recent inbound backlog instead of only the last message');
assert(copilotSource.includes("skipped: 'ordered_media_hydration_pending'"), 'worker must stop before COMPLETE when earlier media bytes are unavailable');
assert(copilotSource.includes('captureVideoSnapshotFromNetwork'), 'worker must recover WhatsApp video bytes before reaching COMPLETE');
assert(copilotSource.includes('captureVideoMessageScreenshot'), 'worker must preserve a reviewable property image when WhatsApp withholds video bytes and the poster canvas');
assert(copilotSource.includes('trying message screenshot fallback'), 'a failed WhatsApp blob fetch must still try the reviewable message screenshot fallback');
assert(copilotSource.includes("mediaPreviewError: 'video_bytes_unavailable_poster_stored'"), 'an unrecoverable video must preserve a property poster instead of blocking the batch forever');
assert(copilotSource.includes('locateEmployeeBatchHistory'), 'COMPLETE must scan backward to the Agent 007 trigger before closing a batch');
assert(copilotSource.includes('replayEmployeeBatchThroughCompletion'), 'the worker must replay every ordered batch message before COMPLETE');
assert(copilotSource.includes('scrollWhatsappHistoryNewer'), 'history reconciliation must walk forward from the trigger without keeping every video in memory');
assert(copilotSource.includes('WHATSAPP_WEB_COPILOT_EMPLOYEE_RECOVERY_PHONES'), 'hosted workers must support an explicit startup recovery target');
assert(copilotSource.includes('runConfiguredEmployeeBatchRecovery'), 'the configured Agent 007 chat must be checked before general chat sweeps can starve it');
assert(copilotSource.includes('const history = await locateEmployeeBatchHistory(page, { chatKey: phone })'), 'configured recovery must scan directly to the durable COMPLETE boundary');
assert(copilotSource.includes(':ordered-replay:${replayRunKey}'), 'history recovery must use a fresh server message id for media acknowledged before batch accounting');
assert(copilotSource.includes("!['image', 'media'].includes(String(snapshot.mediaType || '').toLowerCase())"), 'history recovery must not replay Agent 007 setup text and reset the restored batch');
assert(copilotSource.includes('EMPLOYEE_BATCH_RECOVERY_MAX_ATTEMPTS'), 'configured history recovery must retry a bounded number of times while WhatsApp hydrates older rows');
assert(copilotSource.includes('configuredEmployeeRecoverySettled'), 'configured history recovery must stop only after the batch is complete or already reconciled');
assert(copilotSource.includes("scroller.dispatchEvent(new WheelEvent('wheel'"), 'history recovery must explicitly request older virtualized WhatsApp rows');
assert(copilotSource.includes("'/api/whatsapp/web-bridge/employee-batch-recovery'"), 'the worker must request a safe partial-batch recovery before replay');
assert(routeSource.includes("router.post('/web-bridge/employee-batch-recovery'"), 'the bridge must expose an authenticated partial-batch recovery route');
assert(routeSource.includes('observed_batch_already_accounted_for'), 'completed batches must not be resent after a worker restart');
assert(routeSource.includes('employee_intake_recovery_skip_existing_matches'), 'recovery must preserve prior counts while replaying acknowledged property messages');
assert(routeSource.includes("type = 'whatsapp_employee_batch_complete'"), 'recovery must fall back to the durable completion notification when chat session state is replaced');
assert(routeSource.includes('employee_batch_ordered_replay'), 'authorized history replay must be marked and isolated from normal messages');
assert(routeSource.includes("? ''\n            : `Already saved to review"), 'multiple batches must not send per-property duplicate acknowledgements');
assert(/message: \(data\.property_batch_mode \|\| 'multiple'\) === 'single'[\s\S]{0,500}: ''/.test(routeSource), 'multiple batches must wait for one final completion summary');
const voiceDetectorBlocks = copilotSource.match(/const hasVoiceNote = \(root, text = ''\) => \{[\s\S]*?\n    \};\n    const hasCallLog/g) || [];
assert.equal(voiceDetectorBlocks.length, 2, 'both browser snapshot paths must define voice-specific detection');
assert(voiceDetectorBlocks.every((block) => !block.includes('[aria-label*="Play" i]')), 'generic Play buttons must not classify property videos as voice notes');
assert(voiceDetectorBlocks.every((block) => !block.includes('canvas, svg, button')), 'generic duration controls must not classify property videos as voice notes');
assert.equal((copilotSource.match(/const hasVideoMedia = \(root\)/g) || []).length, 2, 'both browser snapshot paths must explicitly detect video cards and thumbnails');
assert.equal((copilotSource.match(/const videoMedia = hasVideoMedia\(/g) || []).length, 2, 'both browser snapshot paths must use the shared local video detector');
assert.equal(
  (copilotSource.match(/: videoMedia\s*\n\s*\? 'media'\s*\n\s*: voiceNote\s*\n\s*\? 'voice'/g) || []).length,
  2,
  'video detection must take priority over the generic play-button voice-note heuristic'
);
assert(copilotSource.includes("Array.from(document.querySelectorAll('video')).find"), 'video hydration must recover media opened in the WhatsApp preview dialog');
assert(copilotSource.includes('clickable?.click?.()'), 'video hydration must activate thumbnail-only video cards before capturing permanent bytes');
assert(!copilotSource.includes('getRecentIncomingSnapshots(page, 1)'), 'rapid batches must not be reduced to one visible message');
assert(
  copilotSource.indexOf('.filter((item) => item.chatKey && item.text') < copilotSource.indexOf('.slice(-Math.max(1, maxItems))'),
  'worker must filter inbound messages before applying the backlog limit'
);
assert(serverSource.includes('whatsapp-employee-agent-007-review-intake-20260829'), 'release marker should be externally verifiable');
assert(serverSource.includes('whatsapp-agent-007-multiple-property-batches-20260829'), 'multiple-property mode should have an externally verifiable release marker');
assert(serverSource.includes('whatsapp-agent-007-ordered-batch-finalization-20260829'), 'ordered batch finalization should have an externally verifiable release marker');
assert(serverSource.includes('whatsapp-agent-007-complete-barrier-20260829'), 'COMPLETE barrier should have an externally verifiable release marker');
assert(serverSource.includes('whatsapp-agent-007-history-reconciliation-20260829'), 'history reconciliation should have an externally verifiable release marker');
assert(serverSource.includes('whatsapp-agent-007-video-fetch-fallback-20260829'), 'video fetch fallback should have an externally verifiable release marker');
assert(serverSource.includes('whatsapp-agent-007-acknowledged-media-reconciliation-20260829'), 'acknowledged media reconciliation should have an externally verifiable release marker');
assert(serverSource.includes('whatsapp-agent-007-notification-ledger-recovery-20260829'), 'notification-ledger recovery should have an externally verifiable release marker');
assert(serverSource.includes('whatsapp-agent-007-media-only-reconciliation-20260829'), 'media-only reconciliation should have an externally verifiable release marker');
assert(serverSource.includes('whatsapp-agent-007-retry-history-recovery-20260829'), 'retrying history recovery should have an externally verifiable release marker');
assert(serverSource.includes("limit: '40mb'"), 'authorized WhatsApp video previews must fit through the JSON intake limit after base64 encoding');
assert(serverSource.includes('whatsapp-active-intake-call-shield-20260829'), 'employee call shield should have an externally verifiable release marker');

const db = require('../config/database');
const originalQuery = db.query;

(async () => {
  const updates = [];
  let sessionRow = {
    phone: '+447757773202',
    current_step: 'employee_intake_role',
    language: 'en',
    listing_draft: {},
    session_data: { whatsapp_employee_intake: true }
  };
  db.query = async (sql, params = []) => {
    if (/SELECT \* FROM whatsapp_sessions WHERE phone/i.test(sql)) {
      return { rows: [{ ...sessionRow, phone: params[0] }] };
    }
    if (/INSERT INTO whatsapp_call_events/i.test(sql)) {
      return { rows: [{ id: 'call-event-test', inserted: true }] };
    }
    if (/UPDATE whatsapp_sessions/i.test(sql)) {
      updates.push({ sql, params });
      return { rows: [] };
    }
    if (/FROM agents/i.test(sql)) {
      return {
        rows: [{
          id: '11111111-1111-4111-8111-111111111111',
          full_name: 'Francis Isabirye',
          company_name: 'Francis Homes',
          phone: '+256768524008',
          whatsapp: '+256768524008',
          email: null
        }]
      };
    }
    if (/SELECT payload_summary, created_at/i.test(sql) && /whatsapp_employee_batch_complete/i.test(sql)) {
      return {
        rows: [{
          payload_summary: {
            batch_mode: 'multiple',
            properties_shared: 1,
            properties_set_up: 1,
            duplicates_skipped: 0,
            properties_failed: 0,
            media_count: 1
          },
          created_at: new Date().toISOString()
        }]
      };
    }
    if (/FROM properties/i.test(sql) && /source_caption_sha256/i.test(sql)) {
      return { rows: [{ id: '22222222-2222-4222-8222-222222222222', status: 'pending' }] };
    }
    if (/FROM properties/i.test(sql) && /whatsapp_employee_message_id/i.test(sql)) {
      return { rows: [] };
    }
    if (/FROM properties/i.test(sql) && /whatsapp_employee_sender_phone_suffix/i.test(sql)) {
      return {
        rows: [{
          id: '22222222-2222-4222-8222-222222222222',
          agent_id: '11111111-1111-4111-8111-111111111111'
        }]
      };
    }
    if (/INSERT INTO notifications/i.test(sql)) return { rows: [{ id: 'notification-test' }] };
    throw new Error(`Unexpected test query: ${String(sql).slice(0, 80)}`);
  };

  const shieldedCall = await whatsappRoute.handleWhatsappCallEvent({
    phone: '+447757773202',
    provider: 'web_bridge',
    callId: 'stale-call-card-during-agent-007',
    status: 'missed',
    callType: 'voice',
    metadata: { detected_from: 'recent_chat_call_preview' }
  });
  assert.equal(shieldedCall.nextStep, 'employee_intake_role');
  assert.equal(shieldedCall.message, '');
  assert.equal(shieldedCall.lead, null);
  assert.equal(shieldedCall.suppressedActiveEmployeeIntake, true);

  const recoveredRole = await whatsappRoute.handleEmployeeWhatsappIntake({
    phone: '+447757773202',
    body: '1',
    session: {
      current_step: 'missed_call_resolved',
      session_data: {
        whatsapp_employee_intake: true,
        missed_call_flow: { status: 'asked_resolution' }
      }
    }
  });
  assert.equal(recoveredRole.nextStep, 'employee_agent_existing');
  assert.match(recoveredRole.message, /already registered on makaug\.com/i);

  const triggered = await whatsappRoute.handleEmployeeWhatsappIntake({
    phone: '+447757773202',
    body: 'Agent 007',
    session: { current_step: 'main_menu', session_data: {} }
  });
  assert.equal(triggered.nextStep, 'employee_intake_role');
  assert.match(triggered.message, /Agent|employee intake/i);

  const role = await whatsappRoute.handleEmployeeWhatsappIntake({
    phone: '+447757773202',
    body: 'agent',
    session: { current_step: 'employee_intake_role', session_data: { property_ids: [] } }
  });
  assert.equal(role.nextStep, 'employee_agent_existing');

  const existing = await whatsappRoute.handleEmployeeWhatsappIntake({
    phone: '+447757773202',
    body: 'yes',
    session: { current_step: 'employee_agent_existing', session_data: { employee_role: 'agent' } }
  });
  assert.equal(existing.nextStep, 'employee_agent_lookup');

  const found = await whatsappRoute.handleEmployeeWhatsappIntake({
    phone: '+447757773202',
    body: 'Francis Isabirye',
    session: { current_step: 'employee_agent_lookup', session_data: { employee_role: 'agent' } }
  });
  assert.equal(found.nextStep, 'employee_agent_confirm');
  assert.match(found.message, /Francis Isabirye/);

  const confirmed = await whatsappRoute.handleEmployeeWhatsappIntake({
    phone: '+447757773202',
    body: '1',
    session: {
      current_step: 'employee_agent_confirm',
      session_data: {
        employee_role: 'agent',
        agent_candidates: [{
          id: '11111111-1111-4111-8111-111111111111',
          full_name: 'Francis Isabirye',
          company_name: 'Francis Homes',
          phone: '+256768524008',
          whatsapp: '+256768524008',
          email: null
        }]
      }
    }
  });
  assert.equal(confirmed.nextStep, 'employee_property_count');
  assert.match(confirmed.message, /One property/);
  assert.match(confirmed.message, /Multiple properties/);

  const multipleMode = await whatsappRoute.handleEmployeeWhatsappIntake({
    phone: '+447757773202',
    body: 'multiple',
    session: {
      current_step: 'employee_property_count',
      session_data: {
        employee_role: 'agent',
        agent: {
          id: '11111111-1111-4111-8111-111111111111',
          full_name: 'Francis Isabirye'
        },
        property_ids: []
      }
    }
  });
  assert.equal(multipleMode.nextStep, 'employee_property_media');
  assert.match(multipleMode.message, /multiple properties/i);
  assert.match(multipleMode.message, /property 1, 2, 3/);
  assert.match(multipleMode.message, /COMPLETE/);

  const singleMode = await whatsappRoute.handleEmployeeWhatsappIntake({
    phone: '+447757773202',
    body: '1',
    session: {
      current_step: 'employee_property_count',
      session_data: {
        employee_role: 'customer',
        customer_details: { fullName: 'Test Customer' },
        property_ids: []
      }
    }
  });
  assert.equal(singleMode.nextStep, 'employee_property_media');
  assert.match(singleMode.message, /one property/i);
  assert.match(singleMode.message, /COMPLETE/);

  const recoveryExisting = await whatsappRoute.handleEmployeeWhatsappIntake({
    phone: '+447757773202',
    body: '2 bedroom apartment for rent in Ntinda, Kampala at UGX 1.5m per month',
    mediaUrl: 'whatsapp-web://recovery-existing',
    runtime: {
      provider: 'web_bridge',
      mediaType: 'image',
      mediaCount: 1,
      photoCandidates: [{ data_url: 'data:image/jpeg;base64,AA==', mime_type: 'image/jpeg' }]
    },
    inboundMessageId: 'acknowledged-media-replay-test',
    session: {
      current_step: 'employee_property_media',
      session_data: {
        employee_role: 'agent',
        property_batch_mode: 'multiple',
        employee_intake_recovery_skip_existing_matches: true,
        agent: {
          id: '11111111-1111-4111-8111-111111111111',
          full_name: 'Francis Isabirye'
        },
        property_ids: ['22222222-2222-4222-8222-222222222222'],
        total_media_count: 1,
        properties_shared_count: 1,
        properties_duplicate_count: 0,
        properties_failed_count: 0
      }
    }
  });
  assert.equal(recoveryExisting.recoveryAlreadyAccountedFor, true);
  assert.equal(recoveryExisting.message, '');

  const completed = await whatsappRoute.handleEmployeeWhatsappIntake({
    phone: '+447757773202',
    body: 'COMPLETE',
    session: {
      current_step: 'employee_property_media',
      session_data: {
        employee_role: 'agent',
        property_batch_mode: 'multiple',
        agent: {
          id: '11111111-1111-4111-8111-111111111111',
          full_name: 'Francis Isabirye',
          whatsapp: '+256768524008'
        },
        property_ids: ['22222222-2222-4222-8222-222222222222'],
        total_media_count: 7,
        properties_shared_count: 3,
        properties_duplicate_count: 1,
        properties_failed_count: 1
      }
    }
  });
  assert.equal(completed.nextStep, 'main_menu');
  assert.equal(completed.batchComplete, true);
  assert.deepEqual(completed.batchCounts, {
    propertiesShared: 3,
    propertiesSetUp: 1,
    duplicatesSkipped: 1,
    propertiesFailed: 1
  });
  assert.equal(completed.pendingAgentNotification.status, 'awaiting_founder_approval');
  assert.match(completed.message, /1 properties sent for staff review/);
  assert.match(completed.message, /Batch complete for Francis Isabirye/);
  assert.match(completed.message, /Properties received: 3/);
  assert.match(completed.message, /Sent to staff review: 1/);
  assert.match(completed.message, /Duplicates skipped: 1/);
  assert.match(completed.message, /Could not be processed: 1/);
  assert.match(completed.message, /has not been notified yet/);
  assert.match(completed.message, /pending moderator approval, not live/);

  sessionRow = {
    phone: '+447757773202',
    current_step: 'main_menu',
    language: 'en',
    listing_draft: {},
    session_data: {
      employee_intake_last_completed_at: new Date().toISOString(),
      employee_intake_last_batch_mode: 'multiple',
      employee_intake_last_properties_shared: 1,
      employee_intake_last_properties_set_up: 1,
      employee_intake_last_duplicates_skipped: 0,
      employee_intake_last_properties_failed: 0,
      employee_intake_last_media_count: 1,
      employee_intake_pending_agent_notification: {
        agent_id: '11111111-1111-4111-8111-111111111111'
      }
    }
  };
  const restored = await whatsappRoute.prepareEmployeeOrderedBatchReplay({
    phone: '+447757773202',
    observedPropertyMessages: 23,
    triggerMessageId: 'agent-007-trigger',
    completionMessageId: 'premature-complete'
  });
  assert.equal(restored.ready, true);
  assert.equal(restored.restored, true);
  assert.deepEqual(restored.counts, {
    propertiesShared: 1,
    propertiesSetUp: 1,
    duplicatesSkipped: 0,
    propertiesFailed: 0
  });

  sessionRow = {
    phone: '+447757773202',
    current_step: 'missed_call_need',
    language: 'en',
    listing_draft: {},
    session_data: { missed_call_flow: { status: 'asked_need' } }
  };
  const durableRestored = await whatsappRoute.prepareEmployeeOrderedBatchReplay({
    phone: '+447757773202',
    observedPropertyMessages: 23,
    triggerMessageId: 'agent-007-trigger-after-missed-call',
    completionMessageId: 'premature-complete-after-missed-call'
  });
  assert.equal(durableRestored.ready, true);
  assert.equal(durableRestored.restored, true);
  assert.deepEqual(durableRestored.counts, {
    propertiesShared: 1,
    propertiesSetUp: 1,
    duplicatesSkipped: 0,
    propertiesFailed: 0
  });
  assert.equal(updates.length, 13, 'each state transition, interruption recovery, acknowledged-message reconciliation, and both session and durable-ledger history recovery should persist immediately');

  console.log('WhatsApp Agent 007 employee intake contract tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  db.query = originalQuery;
});
