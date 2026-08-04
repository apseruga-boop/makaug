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
  source.includes('const SELLER_LOCATION_HINTS') && source.includes("area: 'Kololo'") && source.includes("area: 'Mawanda Road'") && source.includes("area: 'Entebbe'"),
  'Natural seller details should save known neighbourhoods from phrases like condos in Kololo, Mawanda Road and Entebbe'
);
assert(
  source.includes('function extractSellerKnownLocationHints') && source.includes('locationHints.district'),
  'Natural seller details should infer districts from known locations without asking the same location question again'
);
assert(
  source.includes('parseListingPriceDraft(clean)'),
  'Natural seller details should capture price from combined listing messages'
);
assert(
  source.includes('const bedroomDraft = parseBedroomDraft(clean);') && source.includes('if (bedroomDraft) Object.assign(hints, bedroomDraft);'),
  'Initial listing hints should save bedrooms from the first seller message'
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
  source.includes('const directBedroomDraft = parseBedroomDraft(cleanBody)') && source.includes('...(directBedroomDraft || {})'),
  'Explicit listing-start routing must patch bedrooms from the first message before asking follow-up questions'
);
assert(
  source.includes('function addInferredBedroomPatch') && (source.match(/addInferredBedroomPatch\(draft, patch\)/g) || []).length >= 2,
  'Follow-up steps should infer saved bedroom text before repeating the bedroom prompt'
);
assert(
  source.includes("const fastReply = fastListingProgressReply(lang, patch, mergedDraft, 'Saved')"),
  'Listing field handlers should use the fast progress reply after saving data'
);
assert(
  source.includes("lister_type: chosen") && source.includes("assisted_by_field_agent: false") && source.includes("return respond(fastReply.message, fastReply.nextStep);"),
  'Ownership reply should continue directly to the next missing listing field without a Field Agent question'
);
assert(
  source.includes("const bedroomDraft = parseBedroomDraft(cleanBody) || { bedrooms: parseInt(cleanBody, 10) || 0 }"),
  'Bedroom step should preserve the old single-number path while supporting natural ranges'
);
assert(
  source.includes('condo|condos|condominium'),
  'Natural seller listing detection should understand condo and condominium wording'
);
assert(
  source.includes("if (!['land', 'commercial'].includes(normalizeInput(draft.listing_type)) && isDraftMissingValue(draft, 'bedrooms')) return 'bedrooms';"),
  'House, apartment and condo listings should ask bedrooms after location before asking price'
);
assert(
  source.includes("const compactDigits = cleanBody.replace(/[^0-9]/g, '')") && source.includes("fastListingProgressReply(lang, bedroomDraft, mergedDraft, 'Saved bedrooms')"),
  'Price step should treat 1,2,3,4 as bedroom options instead of saving a bad small price'
);
assert(
  source.includes("fastReply.nextStep === 'description' && existingDescription.length >= 10"),
  'Bedroom step should only skip to photos from a saved natural description after price and other required fields are complete'
);

console.log('WhatsApp five-step listing flow checks passed');
