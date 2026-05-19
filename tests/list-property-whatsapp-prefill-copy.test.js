const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');

assert(appSource.includes('function buildListPropertyWhatsAppMessage()'), 'List-property WhatsApp prefill builder must exist');
assert(appSource.includes('Hi makaug, I would like to list a property'), 'Prefill should start with a natural listing request');
assert(appSource.includes('on makaug.com.'), 'Prefill should mention makaug.com naturally');
assert(appSource.includes('sale: "for sale"'), 'Sale prefill should say "list a property for sale"');
assert(appSource.includes('rent: "for rent"'), 'Rent prefill should say "list a property for rent"');
assert(appSource.includes('student: "as student accommodation"'), 'Student prefill should be natural');
assert(appSource.includes('land: "as land"'), 'Land prefill should be natural');
assert(appSource.includes('commercial: "as commercial property"'), 'Commercial prefill should be natural');
assert(appSource.includes('The property is called ${title}.'), 'Prefill should preserve title context naturally');
assert(appSource.includes('It is in ${location}.'), 'Prefill should preserve location context naturally');
assert(appSource.includes('Please guide me through the WhatsApp listing process.'), 'Prefill should ask for guided WhatsApp capture');
assert(!appSource.includes('Type: ${type}'), 'Prefill must not show internal Type labels');
assert(!appSource.includes('Please help me create the listing.'), 'Prefill should avoid stiff old copy');

console.log('List-property WhatsApp prefill copy tests passed');
