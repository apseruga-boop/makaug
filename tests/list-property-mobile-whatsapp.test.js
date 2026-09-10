const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');

assert(appSource.includes('function isMobileListPropertyExperience()'), 'List-property flow must detect mobile/touch-first devices');
assert(appSource.includes('"(max-width: 767px)"'), 'Mobile list-property detection must include narrow mobile viewports');
assert(appSource.includes('"(pointer: coarse)"'), 'Mobile list-property detection must include touch-first devices');
assert(!appSource.includes('mode === "whatsapp" || isMobileListPropertyExperience()'), 'Mobile visitors must not be forced past the two listing choices');
assert(!appSource.includes('mobile_route_auto'), 'Mobile listing routes must not auto-open WhatsApp');
assert(!appSource.includes('mobile_list_property_cta'), 'Mobile List Property CTAs must open the shared choice flow');
assert(appSource.includes('if (mode === "whatsapp")'), 'An explicit WhatsApp route should still open WhatsApp directly');
assert(appSource.includes('openListPropertyOptions();'), 'The shared listing route should open the two-option choice modal');
assert(appSource.includes('const sameWindow = options.sameWindow === true || isMobileListPropertyExperience()'), 'Mobile WhatsApp routing must use same-tab navigation for app handoff');
assert(appSource.includes('"lp-whatsapp-option-inline-btn"'), 'Inline WhatsApp listing card href must stay synced with listing context');
assert(appSource.includes('mode === "online"'), 'Desktop and explicit online route must still support the online listing form');
assert(appSource.includes('I would like to list a property'), 'WhatsApp listing prefill should read like a human message');
assert(appSource.includes('for sale'), 'WhatsApp listing prefill should describe sale listings naturally');
assert(appSource.includes('Please guide me through the WhatsApp listing process.'), 'WhatsApp listing prefill should ask for guided capture');
assert(!appSource.includes('Type: ${type}'), 'WhatsApp listing prefill must not expose internal Type field labels');

console.log('List-property mobile WhatsApp routing tests passed');
