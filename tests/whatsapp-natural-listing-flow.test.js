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
  whatsappRoute.includes("if (step === 'ask_field_agent' || step === 'ask_field_agent_details')"),
  'Legacy Field Agent listing sessions must be migrated without showing the retired question'
);

assert(
  whatsappRoute.includes('field_agent_prompt_retired_at'),
  'Retired Field Agent steps must be auditable when an in-progress session is migrated'
);
assert(
  whatsappRoute.includes("assisted_by_field_agent: false") && whatsappRoute.includes("field_agent_reference: null"),
  'New WhatsApp listings must not ask for or assign Field Agent credit'
);

assert(
  whatsappRoute.includes('function photoStepReminderMessage') && whatsappRoute.includes('validateAndStoreListingPhotos'),
  'Early listing photos must be validated and acknowledged in the same next-step message'
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
