'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  matchesMissedCallSystemText,
  hasMissedCallSemanticMarker,
  isWhatsappMissedCallCard
} = require('../services/whatsappCallCardDetectionService');

assert.equal(matchesMissedCallSystemText('Missed voice call'), true);
assert.equal(matchesMissedCallSystemText('Video call — no answer'), true);
assert.equal(matchesMissedCallSystemText('Voice call declined'), true);
assert.equal(matchesMissedCallSystemText('🟩🟨 makaug.com | Missed call Sorry we missed your call.'), false);
assert.equal(matchesMissedCallSystemText('I missed your call, please call back'), false);
assert.equal(matchesMissedCallSystemText('Voice call'), false);

assert.equal(hasMissedCallSemanticMarker('call-missed'), true);
assert.equal(hasMissedCallSemanticMarker('missed-video-call'), true);
assert.equal(hasMissedCallSemanticMarker('voice-call'), false);
assert.equal(hasMissedCallSemanticMarker('call-button'), false);

assert.equal(isWhatsappMissedCallCard({ text: 'Missed voice call', direction: 'in' }), true);
assert.equal(isWhatsappMissedCallCard({ text: 'Missed voice call', direction: 'out' }), false);
assert.equal(isWhatsappMissedCallCard({ text: 'Missed voice call', hasAuthoredMessage: true }), false);
assert.equal(isWhatsappMissedCallCard({
  text: '🟩🟨 makaug.com | Missed call Sorry we missed your call.',
  semanticMarkers: ['Voice call'],
  direction: 'in'
}), false, 'generic header labels must not combine with authored copy to create a call event');
assert.equal(isWhatsappMissedCallCard({ semanticMarkers: ['call-missed'], direction: 'in' }), true);

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
const workerSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'whatsapp-web-copilot.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const callHandlerStart = routeSource.indexOf('async function handleWhatsappCallEvent');
const callHandlerEnd = routeSource.indexOf('async function handleMissedCallNeedReply', callHandlerStart);
const callHandler = routeSource.slice(callHandlerStart, callHandlerEnd);

assert(callHandler.includes("message: ''"), 'genuine calls must not send an automatic customer reply');
assert(!callHandler.includes('missedCallIntroMessage('), 'new call events must not start the old missed-call chatbot flow');
assert(!callHandler.includes("current_step: 'missed_call_need'"), 'new calls must preserve the current chatbot session');
assert(callHandler.includes("status: 'needs_human'"), 'genuine calls must be marked for human callback');
assert(callHandler.includes('getWhatsappCallInquiryContext'), 'callback emails must contain recent inquiry context');
assert(routeSource.includes("'arthur@makaug.com'"), 'Arthur must receive genuine WhatsApp call notifications');
assert(routeSource.includes("'ronald@makaug.com'"), 'Ronald must receive genuine WhatsApp call notifications');
assert(routeSource.includes('WHATSAPP_CALL_NOTIFICATION_EMAILS'), 'call email recipients must be configurable');
assert(routeSource.includes("ignore_reason: 'untrusted_call_detection'"), 'the backend must reject stale or untrusted browser detections');
assert(workerSource.includes("const callLog = hasCallLogText(preview);"), 'chat-list calls must be detected from the preview alone');
assert(!workerSource.includes('hasCallLogText(`${preview} ${ariaLabel}`)'), 'row aria labels must not contaminate call preview detection');
assert(workerSource.includes("call_detector_release: WHATSAPP_EMPLOYEE_AGENT_007_WORKER_MARKER"), 'trusted worker calls must carry a release marker');
assert(serverSource.includes('whatsapp-call-card-trust-gate-20260831'), 'the production version endpoint must expose the call trust gate marker');

const routeTest = require('../routes/whatsapp').__test;
const recipients = routeTest.getWhatsappCallNotificationEmails();
assert(recipients.includes('arthur@makaug.com'));
assert(recipients.includes('ronald@makaug.com'));
assert.equal(new Set(recipients).size, recipients.length, 'call recipients must be deduplicated');
assert.equal(routeTest.inferWhatsappCallInquiry({ current_step: 'employee_property_media', session_data: {} }), 'Employee property or agent intake in progress');
assert.equal(routeTest.inferWhatsappCallInquiry({ current_step: 'search_location', current_intent: 'search' }), 'Property search or viewing enquiry');

console.log('WhatsApp call-event safety tests passed');
