const assert = require('assert');
const fs = require('fs');
const path = require('path');

const whatsappRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');

const freshRequestIndex = whatsappRoute.indexOf('function isFreshRequestDuringMissedCallFlow');
const interruptIndex = whatsappRoute.indexOf('async function abandonMissedCallFlowForNewRequest');
const missedNeedHandlerIndex = whatsappRoute.indexOf("if (step === 'missed_call_need')");
const missedResolvedHandlerIndex = whatsappRoute.indexOf("if (step === 'missed_call_resolved')");

assert(freshRequestIndex > -1, 'WhatsApp must detect fresh requests during missed-call follow-up loops');
assert(interruptIndex > freshRequestIndex, 'WhatsApp must have a dedicated missed-call interruption handler');
assert(whatsappRoute.includes('let step = session.current_step'), 'WhatsApp processMessage must allow the step to be reset after interruption');
assert(
  whatsappRoute.indexOf('isFreshRequestDuringMissedCallFlow(cleanBody, intentResult)') < missedNeedHandlerIndex,
  'Fresh request interruption must run before the missed-call need handler'
);
assert(
  whatsappRoute.indexOf('isFreshRequestDuringMissedCallFlow(cleanBody, intentResult)') < missedResolvedHandlerIndex,
  'Fresh request interruption must run before the missed-call resolved handler'
);

for (const freshTerm of [
  'student accommodation',
  'whatsapp ai',
  'broker',
  'mortgage',
  'commercial',
  'listing'
]) {
  assert(whatsappRoute.includes(freshTerm), `Fresh request detection must cover ${freshTerm}`);
}

assert(whatsappRoute.includes("status: 'interrupted_by_new_request'"), 'Missed-call flow should be marked interrupted, not silently overwritten');
assert(whatsappRoute.includes('missed_call_interrupted_by_new_request'), 'Missed-call interruption must be auditable in session and lead activity');
assert(whatsappRoute.includes("'whatsapp_new_request_interrupt'"), 'Missed-call interruption must update conversation control metadata');
assert(whatsappRoute.includes("current_step: 'main_menu'"), 'Missed-call interruption must release the user from the missed-call step');
assert(whatsappRoute.includes('next_route: intentMenuRoute'), 'Missed-call interruption must preserve the next routing hint');
assert(whatsappRoute.includes('Thanks, I added that detail.'), 'The original missed-call detail capture must remain for true follow-up replies');
assert(whatsappRoute.includes('person|human|team|someone|call|callback'), 'Human callback wording must still be treated as a missed-call handoff reply');

console.log('WhatsApp missed-call loop escape tests passed');
