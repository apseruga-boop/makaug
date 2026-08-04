const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'routes', 'whatsapp.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'scripts', 'whatsapp-web-copilot.js'), 'utf8');
const ai = fs.readFileSync(path.join(root, 'services', 'aiService.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');

assert(route.includes("whatsapp-web-modern-media-20260804"), 'Runtime must expose the WhatsApp modern-media release marker');
assert(route.includes('WHATSAPP_MIN_LISTING_PHOTOS = 5'), 'WhatsApp listings must require five accepted photos');
assert(route.includes('Front/outside') && route.includes('Sitting room or main room') && route.includes('Bathroom'), 'Photo checklist must name all five required views');
assert(route.includes('Screenshots, documents and duplicate photos do not count'), 'Photo instructions must state the quality and duplicate rules in one message');
assert(route.includes('classifyWhatsappListingPhoto') && ai.includes('is_screenshot_or_document'), 'Images must be visually checked before they count');
assert(route.includes('perceptualHashDistance') && route.includes('<= 6'), 'Visually duplicate photos must be detected even when the file bytes differ');
assert(route.includes("keyPrefix: 'whatsapp-listings/photos'"), 'Accepted WhatsApp photos must be persisted to cloud media storage');
assert(route.includes("if (step === 'photos')"), 'Listing flow must retain a dedicated photo state');

const photosStart = route.indexOf("if (step === 'photos')");
const photosEnd = route.indexOf('// PUBLIC CONTACT NAME', photosStart);
const photosBlock = route.slice(photosStart, photosEnd);
assert(!photosBlock.includes('findPropertiesByNaturalFilters'), 'Photo collection must never switch into property search');
assert(!photosBlock.includes('listing_draft_saved'), 'Photo collection must not abandon the active listing as a draft');
assert(photosBlock.includes("'ask_public_name'"), 'The fifth accepted photo must advance to listing contact details');

assert(bridge.includes('async function hydrateImageSnapshot'), 'WhatsApp Web bridge must capture real image pixels');
assert(bridge.includes('image_previews:') && bridge.includes('perceptual_hash:'), 'Bridge payload must carry compressed previews and duplicate fingerprints');
assert(bridge.includes('hydrateMediaSnapshot(page'), 'All bridge ingestion paths must hydrate image media');
assert(bridge.includes('[data-testid^="conv-msg-"]'), 'Bridge must support the current WhatsApp Web message-root contract');
assert(bridge.includes("el.getAttribute('data-testid') === targetMessageId"), 'Grouped media hydration must locate current WhatsApp message IDs');
assert(bridge.includes("/^\\+\\d+$/"), 'Chat-list media counters such as +2 must never be ingested as text commands');
assert(bridge.includes('highResolutionImages.length') && bridge.includes('uniqueImageCandidates'), 'Grouped media must count and capture real high-resolution images without placeholder duplicates');
assert(!html.includes('id="lp-field-agent-assisted"'), 'Public listing form must not ask about Field Agents');
assert(!html.includes('id="agent-field-assisted"'), 'Broker registration must not ask about Field Agents');
assert(!html.includes('id="auth-signup-audience-field"'), 'Public signup must not recruit Field Agents');
assert(!html.includes('id="auth-audience-field"'), 'Public sign-in must not offer a Field Agent option');
assert(!route.includes('Did a makaug.com Field Agent help you'), 'WhatsApp must not ask sellers about Field Agents');
assert(app.includes('retired_field_agent_route'), 'The retired public Field Agent dashboard route must return to the homepage');

console.log('WhatsApp listing photo flow checks passed');
