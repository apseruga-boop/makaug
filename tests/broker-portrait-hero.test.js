'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const portraitPath = path.join(root, 'assets', 'agents', 'kazi-honest-professional-v2.jpg');

const cardStart = frontend.indexOf('function brokerCardHtml');
const cardEnd = frontend.indexOf('function renderBrokers', cardStart);
const card = frontend.slice(cardStart, cardEnd);
const renderStart = frontend.indexOf('function renderBrokers');
const renderEnd = frontend.indexOf('function renderSaved()', renderStart);
const renderBrokers = frontend.slice(renderStart, renderEnd);
const directoryCard = card;
const homepageCard = card;
const pageHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const profileStart = frontend.indexOf('async function openBrokerProfile(id)');
const profileEnd = frontend.indexOf('function applyBrokerFilters()', profileStart);
const profile = frontend.slice(profileStart, profileEnd);

assert(cardStart > 0 && cardEnd > cardStart, 'shared agent card renderer should exist');
assert(renderStart > 0 && renderEnd > renderStart, 'Find Brokers and Featured Agents should share renderBrokers');
assert(renderBrokers.includes('brokers-grid') && renderBrokers.includes('brokerCardHtml'), 'both public directories should use the same card');
assert(profileStart > 0 && profileEnd > profileStart, 'public broker profile renderer should exist');

assert(frontend.includes('function brokerCardMediaHtml') && card.includes('brokerCardMediaHtml'), 'cards should use the shared photo treatment');
assert(frontend.includes('broker-card-media') && card.includes('broker-card-bio'), 'cards should show the photo and the bio');
assert(frontend.includes('profile_photo_kind === "logo"') && frontend.includes('object-contain'), 'logos are shown whole, not circle-cropped');
assert(frontend.includes('function brokerIconActionsHtml'), 'broker cards should share one contact action rail');
assert(card.includes('brokerIconActionsHtml(b, { labels: true })'), 'desktop cards label Call and WhatsApp');
assert(pageHtml.includes('@media (max-width: 640px)'), 'mobile switches layout at 640px');
assert(pageHtml.includes('grid-template-columns: 56px minmax(0, 1fr) auto'), 'mobile cards keep the count and call buttons on the right');
assert(pageHtml.includes('broker-card-fallback'), 'a failed photo leaves initials instead of a blank circle');
assert(frontend.includes('featuredBrokerLimit'), 'the homepage featured row stays a full row of 3 or 6');
assert(pageHtml.includes('-webkit-line-clamp: 3'), 'desktop bios stay at two to three lines');
assert(profile.includes('h-28 md:h-36 bg-gradient-to-r') && profile.includes('w-36 h-36 md:w-44 md:h-44 rounded-full'), 'broker profile should use a LinkedIn-style cover and a contained portrait');
assert(profile.includes('flex flex-col items-center text-center'), 'broker profile identity should be centred symmetrically below the cover');
assert(profile.includes('aspect-square') && profile.includes('rounded-full object-cover object-center'), 'every broker portrait should use a consistent square-to-circle crop');
assert(profile.includes('items-center justify-center gap-x-4') && profile.includes('brokerIconActionsHtml(b, { large: true, profile: true })'), 'broker metadata and actions should remain centred below the portrait');
assert(!profile.includes('w-64 h-64') && !profile.includes('lg:grid-cols-[300px,1fr]'), 'broker profile must not stretch the portrait into the old oversized photo block');
assert(profile.includes('aria-labelledby="broker-about-heading"') && profile.includes('Profile overview'), 'broker profile should clearly explain who the agent is');
assert(frontend.includes('function publicBrokerBio(broker = {})'), 'public broker biographies should use a shared cleanup policy');
// The About section now renders brokerAboutParagraphs(b): the agent's own
// bio (cleaned by publicBrokerBio as before) plus the listing write-up.
assert(profile.includes('brokerAboutParagraphs(b).map((text) => `<p class="text-gray-700 mt-2 leading-relaxed max-w-3xl">${adminEscape(text)}</p>`)'), 'public profiles should render the cleaned biography');
assert(/function brokerAboutParagraphs[\s\S]*?\[publicBrokerBio\(broker\)\]/.test(frontend), 'without a listing write-up the cleaned biography still shows');

const publicBioStart = frontend.indexOf('function publicBrokerBio(broker = {})');
const publicBioEnd = frontend.indexOf('function brokerIconActionsHtml', publicBioStart);
const publicBrokerBio = new Function(`${frontend.slice(publicBioStart, publicBioEnd)}; return publicBrokerBio;`)();
const directBio = "Kazi helps buyers across Wakiso. This profile was created from the agent’s direct submission; identity verification and account claim are pending.";
assert.strictEqual(publicBrokerBio({ direct_agent_authorised: true, bio: directBio }), 'Kazi helps buyers across Wakiso.', 'MakaUG-created public profiles should remove direct-submission and claim boilerplate');
assert.strictEqual(publicBrokerBio({ direct_agent_authorised: false, bio: directBio }), 'Kazi helps buyers across Wakiso.', 'the internal note is removed from every public bio');
assert.strictEqual(publicBrokerBio({ bio: 'Professional makaug agent profile.' }), '', 'the stock profile sentence is not a bio');
assert.strictEqual(publicBrokerBio({ bio_display: 'Generated from listings.' }), 'Generated from listings.', 'the card uses the display bio');

const registrationStart = frontend.indexOf('function brokerRegistrationMeta(broker)');
const registrationEnd = frontend.indexOf('function renderBrokerRegistrationBadge', registrationStart);
const registrationMeta = frontend.slice(registrationStart, registrationEnd);
assert(registrationMeta.includes('makaug agent profile'), 'makaug-created profiles should have a neutral public profile badge');
assert(!registrationMeta.includes('Direct profile · claim pending'), 'MakaUG-created profiles must not expose claim-pending language');

assert(!directoryCard.includes('${b.sales'), 'Find Brokers must not render an unverified sales count');
assert(!directoryCard.includes('translateListingLabel("Sales")'), 'Find Brokers must not render a Sales label');
assert(!homepageCard.includes('(b.specialties || [])[0]'), 'Featured Agents should keep secondary specialty data off the compact portrait card');
assert(!profile.includes('${b.sales'), 'public broker profiles must not render an unverified sales count');

assert(fs.existsSync(portraitPath), 'Kazi Honest portrait asset should exist');
assert(frontend.includes('["kazi honest", "/assets/agents/kazi-honest-professional-v2.jpg?v=20260901b"]'), 'Kazi Honest should resolve to the professional identity-preserving portrait when her profile has no photo');
const portrait = fs.readFileSync(portraitPath);
assert(portrait.length > 200_000, 'Kazi Honest portrait should retain enough detail for a clear profile image');
assert(portrait.length < 500_000, 'Kazi Honest portrait should be web-optimised');
assert.strictEqual(portrait[0], 0xff, 'portrait should be a JPEG');
assert.strictEqual(portrait[1], 0xd8, 'portrait should be a JPEG');

console.log('ok - broker portraits are professional, card actions are compact, and public sales counts are hidden');
