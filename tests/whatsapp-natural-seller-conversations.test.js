const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { classifyWhatsappIntent } = require('../services/aiService');

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
const aiSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'aiService.js'), 'utf8');
const moderationSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'listingModerationService.js'), 'utf8');
const helperStart = routeSource.indexOf('function normalizeInput');
const helperEnd = routeSource.indexOf('function formatPrice');
const genericLaunchStart = routeSource.indexOf('function isGenericWebsiteHelpLaunch');
const genericLaunchEnd = routeSource.indexOf('function fastWhatsappRuntimeHints');

assert(helperStart > -1 && helperEnd > helperStart, 'WhatsApp listing helper block must remain testable');
assert(genericLaunchStart > -1 && genericLaunchEnd > genericLaunchStart, 'Website launch detector must remain testable');

const sandbox = {
  DISTRICTS: ['Kampala', 'Wakiso', 'Mukono', 'Jinja', 'Gulu'],
  normalizeListingType(value) {
    const clean = String(value || '').toLowerCase();
    return ['sale', 'rent', 'land', 'student', 'commercial', 'any'].includes(clean) ? clean : '';
  },
  normalizeLandTitleAvailability() {
    return '';
  },
  landTitleAvailabilityLabel(value) {
    return String(value || '');
  },
  isResumeControlReply() {
    return false;
  },
  isAffirmativeReply(value) {
    return /^(yes|y|1|ok|okay)$/i.test(String(value || '').trim());
  },
  isNegativeReply(value) {
    return /^(no|n|2)$/i.test(String(value || '').trim());
  },
  normalizeFieldAgentCode() {
    return '';
  },
  t(_lang, key) {
    return key;
  }
};

vm.createContext(sandbox);
vm.runInContext(`
${routeSource.slice(helperStart, helperEnd)}
${routeSource.slice(genericLaunchStart, genericLaunchEnd)}
this.isNaturalSellerListingStatement = isNaturalSellerListingStatement;
this.inferListingTypeFromStartRequest = inferListingTypeFromStartRequest;
this.buildNaturalListingDetailDraft = buildNaturalListingDetailDraft;
this.extractSellerListingDraftHints = extractSellerListingDraftHints;
this.nextListingDraftStep = nextListingDraftStep;
this.isGenericWebsiteHelpLaunch = isGenericWebsiteHelpLaunch;
`, sandbox);

const {
  isNaturalSellerListingStatement,
  inferListingTypeFromStartRequest,
  buildNaturalListingDetailDraft,
  extractSellerListingDraftHints,
  nextListingDraftStep,
  isGenericWebsiteHelpLaunch
} = sandbox;

const screenshotLaunch = "Hi makaug, I'm on makaug.com and need property help. Please guide me with the best next step. Page: makaug.com/.";
assert.strictEqual(isGenericWebsiteHelpLaunch(screenshotLaunch), true, 'Homepage WhatsApp launch must open the assistant greeting');
assert.strictEqual(
  isGenericWebsiteHelpLaunch("Hi makaug, I'm on makaug.com and need property help. Page: makaug.com/property/example"),
  false,
  'Page-specific WhatsApp links must retain their contextual route'
);

const screenshotDraft = buildNaturalListingDetailDraft('I want to sale my house in Rubaga', {}, {
  allowTitle: true,
  allowDescription: true
});
assert.strictEqual(isNaturalSellerListingStatement('I want to sale my house in Rubaga'), true);
assert.strictEqual(screenshotDraft.listing_type, 'sale');
assert.strictEqual(screenshotDraft.area, 'Rubaga');
assert.strictEqual(nextListingDraftStep(screenshotDraft), 'ownership');

const conversations = [
  ['I want to sale my house in Rubaga', 'sale', 'Rubaga'],
  ['I want to sell my apartment in Ntinda', 'sale', 'Ntinda'],
  ['I want to rent out my house in Bukoto', 'rent', 'Bukoto'],
  ['I want to list my land in Gayaza for sale', 'land', 'Gayaza'],
  ['I want to list my hostel near Makerere', 'student', 'Makerere'],
  ['I want to list my shop in Nakasero for rent', 'commercial', 'Nakasero'],
  ['Njagala okutunda ennyumba yange e Rubaga', 'sale', null],
  ['Nataka kuuza nyumba yangu kwenye Ntinda', 'sale', 'Ntinda'],
  ['Amito cato ot mega i Gulu', 'sale', 'Gulu'],
  ['Ninyenda kugurisha enju yangye mu Mbarara', 'sale', 'Mbarara'],
  ['Nshaka kugurisha inzu yanje kuri Kabale', 'sale', 'Kabale'],
  ['Nhenda okutunda ennyumba yange e Jinja', 'sale', null],
  ['ቤቴን መሸጥ ፈልጋለሁ Addis', 'sale', null],
  ['أريد بيع منزلي في Kampala', 'sale', null],
  ['We would like to list our office in Kololo', 'commercial', 'Kololo']
];

for (const [message, expectedType, expectedArea] of conversations) {
  assert.strictEqual(isNaturalSellerListingStatement(message), true, `Seller intent should win for: ${message}`);
  assert.strictEqual(inferListingTypeFromStartRequest(message, {}), expectedType, `Listing type should be ${expectedType}: ${message}`);
  if (expectedArea) {
    const draft = extractSellerListingDraftHints(message, {});
    assert.strictEqual(draft.area, expectedArea, `Area should be preserved for: ${message}`);
  }
}

const locations = ['Rubaga', 'Ntinda', 'Bukoto', 'Kira', 'Mukono', 'Wakiso', 'Jinja', 'Gulu', 'Mbarara', 'Entebbe', 'Gayaza', 'Kololo'];
const localizedSellerTemplates = {
  en: (area) => `I want to sale my house in ${area}`,
  lg: (area) => `Njagala okutunda ennyumba yange e ${area}`,
  sw: (area) => `Nataka kuuza nyumba yangu kwenye ${area}`,
  ac: (area) => `Amito cato ot mega i ${area}`,
  ny: (area) => `Ninyenda kugurisha enju yangye mu ${area}`,
  rn: (area) => `Nshaka kugurisha inzu yanje kuri ${area}`,
  sm: (area) => `Nhenda okutunda ennyumba yange e ${area}`,
  am: (area) => `ቤቴን መሸጥ ፈልጋለሁ ${area}`,
  ar: (area) => `أريد بيع منزلي في ${area}`
};

let multilingualAssertions = 0;
for (const [language, template] of Object.entries(localizedSellerTemplates)) {
  for (const area of locations) {
    const message = template(area);
    assert.strictEqual(isNaturalSellerListingStatement(message), true, `${language} seller message should start listing: ${message}`);
    assert.strictEqual(inferListingTypeFromStartRequest(message, {}), 'sale', `${language} seller message should infer sale`);
    multilingualAssertions += 1;
  }
}
assert(multilingualAssertions >= 100, 'At least 100 multilingual seller utterances must be exercised');

const buyerMessages = [
  'I want to buy a house in Rubaga',
  'I am looking for a house for sale in Ntinda',
  'Find me land in Gayaza',
  'I want to rent a flat in Bukoto'
];
buyerMessages.forEach((message) => {
  assert.strictEqual(isNaturalSellerListingStatement(message), false, `Buyer request must not become seller flow: ${message}`);
});

assert(routeSource.includes('function isGenericWebsiteHelpLaunch'), 'Generic website WhatsApp launch must have a dedicated greeting detector');
assert(routeSource.includes('isGreetingText(clean) || isGenericWebsiteHelpLaunch(clean)'), 'Generic website launch must route to greeting before property search');
assert(
  routeSource.includes("isGenericWebsiteHelpLaunch(cleanBody) && ['greeting', 'main_menu', 'submitted'].includes(step)"),
  'Generic website launch must return the natural greeting before main-menu search parsing'
);
assert(routeSource.includes("I'm your makaug property assistant in your pocket."), 'Greeting must introduce the natural property assistant');
assert(routeSource.includes('Speak English, Luganda, Kiswahili'), 'Greeting must explain multilingual natural-language support');
assert(routeSource.includes("'confirm_whatsapp_contact'"), 'Natural listing flow must confirm the authenticated WhatsApp contact');
assert(routeSource.includes("verification_channel: 'whatsapp_sender'"), 'WhatsApp sender confirmation must be stored as provenance');
assert(routeSource.includes('submitWhatsappListingDraft'), 'Completed WhatsApp listing must enter the moderation submission path');
assert(routeSource.includes("status, moderation_stage, listed_via, source"), 'WhatsApp listing persistence must store pending moderation provenance');
assert(routeSource.includes("source: 'whatsapp_listing_submission'"), 'WhatsApp listing submission must create a listing-owner lead');
assert(routeSource.includes('whatsapp_property_listing_submitted'), 'WhatsApp listing submission must create a learning event');
assert(routeSource.includes('handleWhatsappListingRemovalCommand'), 'Owners must have a WhatsApp removal command');
assert(routeSource.includes('owner_removed_via_whatsapp'), 'WhatsApp removals must be audited');
assert(routeSource.includes('whatsapp-natural-seller-flow-20260804'), 'Runtime status must expose the natural seller flow release marker');
assert(aiSource.includes('I want to sale my house in Rubaga'), 'AI classifier prompt must include the exact screenshot regression phrase');
assert(moderationSource.includes('To remove it, reply REMOVE'), 'Live approval WhatsApp must explain how to remove the listing');

(async () => {
  for (const [message] of conversations) {
    const classified = await classifyWhatsappIntent({
      text: message,
      language: 'en',
      step: 'main_menu'
    });
    assert.strictEqual(classified.intent, 'property_listing', `Intent classifier must keep seller flow for: ${message}`);
  }
  console.log(`WhatsApp natural seller conversation tests passed (${conversations.length} conversations, ${multilingualAssertions} multilingual utterances)`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
