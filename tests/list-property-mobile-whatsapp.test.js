const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');

assert(appSource.includes('function isMobileListPropertyExperience()'), 'List-property flow must detect mobile/touch-first devices');
assert(appSource.includes('"(max-width: 767px)"'), 'Mobile list-property detection must include narrow mobile viewports');
assert(appSource.includes('"(pointer: coarse)"'), 'Mobile list-property detection must include touch-first devices');
assert(appSource.includes('mode === "whatsapp" || isMobileListPropertyExperience()'), 'Direct /list-property mobile route must use WhatsApp path by default');
assert(appSource.includes('source: mode === "whatsapp" ? "route_query" : "mobile_route_auto"'), 'Mobile auto route should be tracked distinctly from explicit WhatsApp route');
assert(appSource.includes('chooseListPropertyWhatsApp({ source: "mobile_list_property_cta", sameWindow: true })'), 'Mobile List Property CTA must open WhatsApp directly');
assert(appSource.includes('options.forceChoice !== true'), 'Desktop/operator flows must be able to force the choice UI when required');
assert(appSource.includes('const sameWindow = options.sameWindow === true || isMobileListPropertyExperience()'), 'Mobile WhatsApp routing must use same-tab navigation for app handoff');
assert(appSource.includes('"lp-whatsapp-option-inline-btn"'), 'Inline WhatsApp listing card href must stay synced with listing context');
assert(appSource.includes('mode === "online"'), 'Desktop and explicit online route must still support the online listing form');
assert(appSource.includes('I would like to list a property'), 'WhatsApp listing prefill should read like a human message');
assert(appSource.includes('for sale'), 'WhatsApp listing prefill should describe sale listings naturally');
assert(appSource.includes('Please guide me through the WhatsApp listing process.'), 'WhatsApp listing prefill should ask for guided capture');
assert(!appSource.includes('Type: ${type}'), 'WhatsApp listing prefill must not expose internal Type field labels');

console.log('List-property mobile WhatsApp routing tests passed');
