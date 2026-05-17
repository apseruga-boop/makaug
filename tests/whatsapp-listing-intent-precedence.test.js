const assert = require('assert');
const fs = require('fs');
const path = require('path');

const whatsappRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
const aiService = fs.readFileSync(path.join(__dirname, '..', 'services', 'aiService.js'), 'utf8');
const { classifyWhatsappIntent } = require('../services/aiService');

const listingHelperIndex = whatsappRoute.indexOf('function isListingStartRequest');
const listingHandlerIndex = whatsappRoute.indexOf('const explicitListingStart');
const topNaturalSearchIndex = whatsappRoute.indexOf("['greeting', 'main_menu'].includes(step)\n    && cleanBody.length > 3");
const mainMenuIndex = whatsappRoute.indexOf('// MAIN MENU');
const mainMenuNaturalSearchIndex = whatsappRoute.indexOf('let naturalFilters = await resolveNaturalSearchFilters({', mainMenuIndex);

assert(listingHelperIndex > -1, 'WhatsApp route must include a dedicated listing-start detector');
assert(whatsappRoute.includes('function inferListingTypeFromStartRequest'), 'WhatsApp route must infer listing type from contextual WhatsApp messages');
assert(listingHandlerIndex > -1, 'WhatsApp route must handle explicit listing starts before search routing');
assert(listingHandlerIndex < topNaturalSearchIndex, 'Listing-start handling must run before top-level natural search');
assert(listingHandlerIndex < mainMenuNaturalSearchIndex, 'Listing-start handling must run before main-menu natural search');
assert(whatsappRoute.includes('await patchDraft(phone, { listing_type: inferredListingType })'), 'Contextual listing messages with Type: For Sale must store listing_type');
assert(whatsappRoute.includes("return respond(t(lang, 'askOwnership'), 'ownership')"), 'Contextual listing messages with a type should continue to ownership, not search area');
assert(whatsappRoute.includes('listing_start_text'), 'Listing starts must leave session traceability for support review');
assert(aiService.includes('Property listing must win'), 'AI prompt must tell the model listing intent beats sale/rent search wording');

(async () => {
  const screenshotMessage = 'Hi MakaUg, I want to list a property. Type: For Sale. Please help me create the listing.';
  const result = await classifyWhatsappIntent({
    text: screenshotMessage,
    language: 'en',
    step: 'main_menu'
  });
  assert.strictEqual(result.intent, 'property_listing', 'Screenshot message must classify as property_listing');
  assert(result.confidence >= 0.64, 'Screenshot message should use confident fast listing classification');
  console.log('WhatsApp listing intent precedence tests passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
