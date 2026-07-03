const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');

const helperStart = source.indexOf('function mapSearchTypeInput');
const helperEnd = source.indexOf('function parseBedCount');
assert(helperStart > -1, 'WhatsApp route must define search type mapping helpers');
assert(helperEnd > helperStart, 'Search type persistence helper must sit before bed parsing');

const sandbox = {
  HOME_URL: 'https://makaug.com',
  normalizeInput(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }
};
vm.createContext(sandbox);
vm.runInContext(`
${source.slice(helperStart, helperEnd)}
this.normalizeListingType = normalizeListingType;
this.preserveExplicitSearchType = preserveExplicitSearchType;
`, sandbox);

assert.strictEqual(sandbox.normalizeListingType('4'), 'student', 'Menu option 4 must map to student accommodation');
assert.strictEqual(
  sandbox.preserveExplicitSearchType({ searchType: 'any', area: 'Kampala' }, 'student').searchType,
  'student',
  'A typed area after choosing student accommodation must not reset the filter to Any'
);
assert.strictEqual(
  sandbox.preserveExplicitSearchType({ searchType: 'sale', area: 'Kampala' }, 'student').searchType,
  'student',
  'The explicit menu selection must remain authoritative inside search_area'
);
assert.strictEqual(
  sandbox.preserveExplicitSearchType({ searchType: 'rent', area: 'Kampala' }, 'any').searchType,
  'rent',
  'Natural-search filters should still be preserved when no explicit menu type was selected'
);

const searchAreaStart = source.indexOf("if (step === 'search_area')");
const agentAreaStart = source.indexOf("if (step === 'agent_area')");
assert(searchAreaStart > -1 && agentAreaStart > searchAreaStart, 'WhatsApp route must have a search_area block before agent_area');
const searchAreaBlock = source.slice(searchAreaStart, agentAreaStart);

assert(
  searchAreaBlock.includes("const searchType = normalizeListingType(sessionData.search_type || 'any');"),
  'search_area must normalize the stored menu search type'
);
assert(
  searchAreaBlock.includes('preserveExplicitSearchType(sessionData.pending_search_filters, searchType)'),
  'Pending natural filters must be forced to the explicit menu type'
);
assert(
  searchAreaBlock.includes('if (naturalFilters) naturalFilters = preserveExplicitSearchType(naturalFilters, searchType);'),
  'Parsed area replies must preserve the explicit menu type before querying'
);
assert(
  searchAreaBlock.includes("search_type: naturalFilters.searchType || searchType || 'any'"),
  'Session data must keep the corrected search type after a natural area search'
);

assert(
  source.includes('function whatsappStudentAccommodationSql') && source.includes("!~* '\\\\m(land|plot|acre|acres|decimal|decimals)\\\\M'"),
  'Student accommodation searches must exclude land/plot/acre rows even when imported metadata is noisy'
);

const nearSearchStart = source.indexOf('async function findPropertiesNearWhatsapp(searchType, sharedLocation');
const filteredNearSearchStart = source.indexOf('async function findPropertiesNearWhatsappWithFilters');
assert(nearSearchStart > -1 && filteredNearSearchStart > nearSearchStart, 'WhatsApp route must define nearby search helpers');
const nearSearchBlock = source.slice(nearSearchStart, filteredNearSearchStart);
assert(
  nearSearchBlock.includes("if (listingType === 'student')") && nearSearchBlock.includes("whatsappStudentAccommodationSql('')"),
  'Nearby student accommodation searches must include student-friendly listings, not only listing_type=student rows'
);

console.log('WhatsApp search type persistence tests passed');
