const assert = require('assert');
const fs = require('fs');
const path = require('path');

const whatsappRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');

const helperIndex = whatsappRoute.indexOf('function isActionableStepReply');
const promptIndex = whatsappRoute.indexOf('if (idlePrompt)');
const idleDueIndex = whatsappRoute.indexOf('isIdleResumeDue(session)');

assert(helperIndex > -1, 'WhatsApp route must detect menu replies that belong to the active step');
assert(promptIndex > -1, 'WhatsApp route must handle stored idle prompts');
assert(idleDueIndex > -1, 'WhatsApp route must keep idle resume protection');
assert(helperIndex < promptIndex, 'Active-step reply helper must be available before idle prompt handling');
assert(whatsappRoute.includes("if (currentStep === 'search_type') return Boolean(mapSearchTypeInput(clean)) || isAnyAreaReply(clean);"), 'Search-type replies 1-6 must count as active menu answers');
assert(whatsappRoute.includes('let actionableStepReply = isActionableStepReply(step, cleanBody);'), 'Process flow must classify active step replies before idle checks');
assert(whatsappRoute.includes('if (isActionableStepReply(idlePromptStep, cleanBody))'), 'Stored idle prompts must let active menu answers fall through to the normal step handler');
assert(whatsappRoute.includes("idle_resume_resolved_as: 'step_reply'"), 'Step replies to idle prompts must be traceable in session data');
assert(whatsappRoute.includes("idle_resume_resolved_as: 'greeting_step_reminder'"), 'Stale greetings during an active flow must be traceable as step reminders');
assert(whatsappRoute.includes('&& !actionableStepReply'), 'Idle resume must not interrupt a valid active-step reply');

const idlePromptBlock = whatsappRoute.slice(promptIndex, idleDueIndex);
assert(
  idlePromptBlock.indexOf('isActionableStepReply(idlePromptStep, cleanBody)') < idlePromptBlock.indexOf('isAffirmativeReply(cleanBody)'),
  'A numeric search answer must be handled before generic affirmative replies such as 1'
);

const staleGreetingIndex = whatsappRoute.indexOf("idle_resume_resolved_as: 'greeting_step_reminder'");
const genericIdlePromptIndex = whatsappRoute.indexOf('idle_resume_prompt: {\n        step,');
assert(genericIdlePromptIndex > staleGreetingIndex, 'Stale greeting rescue must run before generic idle resume prompt creation');

console.log('WhatsApp idle resume menu reply tests passed');
