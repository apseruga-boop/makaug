const assert = require('assert');
const fs = require('fs');
const path = require('path');

const whatsappRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');

assert(
  whatsappRoute.includes('function stripMakaugBrandLocationNoise'),
  'WhatsApp listing parser must strip makaug.com before extracting area hints'
);
assert(
  whatsappRoute.includes("replace(/\\b(?:in|at|around|near|from|on)\\s+(?:https?:\\/\\/)?(?:www\\.)?makaug"),
  'WhatsApp listing parser must remove preposition + makaug brand/domain phrases'
);
assert(
  whatsappRoute.includes('function isNaturalListingDetailReply'),
  'WhatsApp listing flow must detect natural property detail replies'
);
assert(
  whatsappRoute.includes("if (currentStep === 'ask_field_agent') return isAffirmativeReply(clean) || isNegativeReply(clean) || isNaturalListingDetailReply(clean);"),
  'Idle resume must treat natural property details as an active field-agent-step reply'
);

const fieldAgentIndex = whatsappRoute.indexOf("if (step === 'ask_field_agent')");
const fieldAgentBlock = whatsappRoute.slice(fieldAgentIndex, whatsappRoute.indexOf("if (step === 'ask_field_agent_details')"));
assert(fieldAgentBlock.includes('buildNaturalListingDetailDraft(cleanBody, draft)'), 'Field-agent step must save natural listing detail instead of repeating invalid input');
assert(
  fieldAgentBlock.includes('listingDetailSavedReply(lang') || fieldAgentBlock.includes('fastListingProgressReply(lang'),
  'Field-agent natural detail path must acknowledge saved details before the next prompt'
);
assert(fieldAgentBlock.includes("assisted_by_field_agent: false"), 'Natural detail path must default field-agent credit to No');

assert(
  whatsappRoute.includes('function photoStepReminderMessage') && whatsappRoute.includes('photoStepReminderMessage(lang, step)'),
  'Photo recovery should use a short next-step reminder instead of full resume copy'
);
assert(
  whatsappRoute.includes('function parseBedroomDraft') && whatsappRoute.includes('bedroom_options_text'),
  'Bedroom step must preserve bedroom ranges/lists for moderator review'
);
assert(
  whatsappRoute.includes('If there is more than one, list them all') && whatsappRoute.includes('a list like 1,2,3,4'),
  'WhatsApp prompts must tell users multiple locations and bedroom options are accepted'
);

console.log('WhatsApp natural listing flow tests passed');
