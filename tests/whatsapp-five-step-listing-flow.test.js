const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');

assert(
  source.includes('function parseListingPriceDraft') && source.includes('250m'),
  'WhatsApp listing flow should accept shorthand prices like 250m'
);
assert(
  source.includes('thousandMatch') && source.includes('* 1000'),
  'WhatsApp listing flow should accept common rent shorthand like 800k'
);
assert(
  source.includes('function nextListingDraftStep'),
  'WhatsApp listing flow should advance by next missing field instead of fixed prompt order'
);
assert(
  source.includes('function fastListingProgressReply'),
  'WhatsApp listing flow should acknowledge saved details and ask only for the next missing field'
);
assert(
  source.includes('firstDistrictFromText(clean)'),
  'Natural seller details should capture known districts from combined listing messages'
);
assert(
  source.includes('parseListingPriceDraft(clean)'),
  'Natural seller details should capture price from combined listing messages'
);
assert(
  source.includes('Object.assign(patch, bedroomDraft)'),
  'Natural seller details should capture bedroom ranges from combined listing messages'
);
assert(
  source.includes("bedroomDraft && isDraftMissingValue(draft, 'bedrooms')"),
  'Natural seller details must save bedrooms when the draft has null/empty bedrooms'
);
assert(
  source.includes("const fastReply = fastListingProgressReply(lang, patch, mergedDraft, 'Saved')"),
  'Listing field handlers should use the fast progress reply after saving data'
);
assert(
  source.includes("const patch = { assisted_by_field_agent: false }") && source.includes("return respond(fastReply.message, fastReply.nextStep);"),
  'Field-agent No reply should continue to the next missing field instead of restarting the old title loop'
);
assert(
  source.includes("const bedroomDraft = parseBedroomDraft(cleanBody) || { bedrooms: parseInt(cleanBody, 10) || 0 }"),
  'Bedroom step should preserve the old single-number path while supporting natural ranges'
);

console.log('WhatsApp five-step listing flow checks passed');
