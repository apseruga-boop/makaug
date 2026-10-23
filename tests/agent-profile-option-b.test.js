'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const agentsRoute = fs.readFileSync(path.join(root, 'routes', 'agents.js'), 'utf8');
const profileStart = app.indexOf('async function openBrokerProfile(id)');
const profileEnd = app.indexOf('function applyBrokerFilters()', profileStart);
const surfaceStart = app.indexOf('let agentProfileListingCache');
const profile = app.slice(profileStart, profileEnd);
const surface = app.slice(surfaceStart, profileEnd);
const helperStart = app.indexOf('function agentProfileFirstName');
const helperEnd = app.indexOf('function agentProfileContactButtons');
const helpers = new Function(`
  function formatListingDate(value) { return value ? '12 Mar 2024' : ''; }
  function fmtP(value) { return 'UGX ' + value; }
  function normalizeType(value) {
    const key = String(value || '').toLowerCase();
    if (key === 'students') return 'student';
    if (key === 'short-term' || key === 'short stay') return 'short_term';
    return key;
  }
  ${app.slice(helperStart, helperEnd)}
  return {
    agentProfileFirstName,
    agentProfileExperienceLabel,
    agentProfileJoinedText,
    filterAgentProfileListings,
    sortAgentProfileListings,
    agentProfileAreaCounts,
    agentProfileTypeKey,
    agentProfilePriceLabel
  };
`)();

assert(profileStart > 0 && profileEnd > profileStart, 'the public agent profile renderer is present');
assert(profile.includes('agent-profile-identity'), 'the profile renders a compact identity card');
assert(profile.includes('broker-profile-name') && profile.includes('verifiedAgentBadgeHtml(b, 22)'), 'the name keeps the verified scalloped tick');
assert(profile.includes('Agent number'), 'the identity card shows the agent number');
assert(profile.includes('agentProfileJoinedText(b)'), 'the identity card shows the joined date when it is known');
assert(surface.includes('<span>WhatsApp</span>'), 'WhatsApp is a labelled action');
assert(surface.includes('<span>Call</span>') && surface.includes('<span>Share</span>'), 'Call and Share are labelled actions');
assert(!surface.includes('Experienced Broker'), 'the hard-coded experience line is gone');
assert(!profile.includes('h-28 md:h-36'), 'the tall green banner is gone');
assert(profile.includes('Live listings') && profile.includes('Price range') && profile.includes('Video tours') && profile.includes('Areas covered') && profile.includes('Verified status'), 'key figures sit under the identity card');
assert(profile.includes('brokerAboutParagraphs(b).map((text) => `<p class="text-gray-700 mt-2 leading-relaxed max-w-3xl">${adminEscape(text)}</p>`)'), 'About still uses the translated biography');
assert(profile.includes('Where ${adminEscape(firstName)} works'), 'the map section is titled with the agent first name');
assert(surface.includes('getListingMapPoint') && surface.includes('OSM_TILE_URL') && profile.includes('initAgentProfileMap(list)'), 'listing pins use OpenStreetMap through the existing area fallback');
assert(!/google\.maps|ensureGoogleMapsApi/.test(surface), 'the profile map does not call Google');
assert(profile.includes('Listing mix') && profile.includes('agent-profile-chip'), 'listing mix and area counts are on the page');
assert(profile.includes('All types') && profile.includes('Price: low to high') && profile.includes('Price: high to low') && profile.includes('Newest'), 'listings can be filtered and sorted');
assert(profile.includes('class="agent-profile-contact"') && profile.includes('Never pay before viewing'), 'the contact column has the safety line');
assert(profile.includes('name="website"') && profile.includes('submitAgentProfileRequest'), 'the request form posts through the honeypot field');
assert(surface.includes('source: "agent_profile"'), 'the browser tags the request as an agent profile enquiry');
assert(profile.includes('agent-profile-mobile-bar'), 'phones get a sticky WhatsApp, Call and Request bar');
assert(surface.includes('openAgentBookingSheet'), 'the phone Book button opens the booking sheet');
assert(profile.includes('agent-booking-who'), 'name and phone sit on one row');
assert(surface.includes('agent-booking-date-strip') && surface.includes('More dates') && surface.includes('.slice(0, 31)'), 'dates are a strip of the next month, moved on by More dates');
assert(surface.includes('propCard(listing)'), 'listings still use the original property card');
assert(!surface.includes('agent-booking-cal-grid') && !surface.includes('agent-listing-card'), 'the month grid and gradient listing cards stay out');
assert(profile.includes('openAgentProfileReport') && profile.includes('Share profile'), 'share and report sit with the contact card');

assert.strictEqual(helpers.agentProfileExperienceLabel({ experience: 'Experienced Broker' }), '', 'an empty experience record stays blank');
assert.strictEqual(helpers.agentProfileExperienceLabel({ experience_years: 7 }), '7 years', 'a stored year count is shown');
assert.strictEqual(helpers.agentProfileFirstName({ name: 'Jonathan Wassajja' }), 'Jonathan');
assert.strictEqual(helpers.agentProfileJoinedText({ created_at: '2024-03-12' }), 'Joined 12 Mar 2024');
assert.strictEqual(helpers.agentProfileJoinedText({}), '');
const sample = [
  { type: 'sale', price: 200, created_at: '2024-01-01', area: 'Kololo', district: 'Kampala' },
  { type: 'rent', price: 50, created_at: '2025-01-01', area: 'Kololo', district: 'Kampala' },
  { type: 'students', price: 10, created_at: '2023-01-01', area: '', district: 'Wakiso' }
];
assert.strictEqual(helpers.filterAgentProfileListings(sample, 'student').length, 1);
assert.strictEqual(helpers.sortAgentProfileListings(sample, 'price-asc')[0].price, 10);
assert.strictEqual(helpers.sortAgentProfileListings(sample, 'price-desc')[0].price, 200);
assert.strictEqual(helpers.sortAgentProfileListings(sample, 'newest')[0].created_at, '2025-01-01');
assert.deepStrictEqual(helpers.agentProfileAreaCounts(sample), [['Kololo', 2], ['Wakiso', 1]]);
assert.strictEqual(helpers.agentProfilePriceLabel([]), 'Price on request');

assert(agentsRoute.includes("router.post('/:id/enquiries', agentProfileEnquiryLimiter, leadHoneypot"), 'profile requests reuse the lead form limiter and honeypot');
assert(agentsRoute.includes('createLeadFormLimiter'), 'the limiter is the shared lead-form limiter');
assert(agentsRoute.includes("source: 'agent_profile'"), 'stored leads are tagged agent_profile');
assert(agentsRoute.includes('a.created_at'), 'joined date reads the existing agents.created_at column');
assert(!/ALTER TABLE|ADD COLUMN/i.test(agentsRoute.slice(agentsRoute.indexOf('buildAgentProfileEnquiry'), agentsRoute.indexOf("router.get('/:id'"))), 'the enquiry route adds no database columns');

const { buildAgentProfileEnquiry } = require('../routes/agents');
const agent = { id: 'agent-1', full_name: 'Jonathan Wassajja' };
const built = buildAgentProfileEnquiry(agent, {
  contact_name: 'Amina',
  contact_phone: '+256700000000',
  message: 'I want a viewing in Kololo.'
});
assert.deepStrictEqual(built.errors, []);
assert.strictEqual(built.input.source, 'agent_profile');
assert.strictEqual(built.input.agentId, 'agent-1');
assert.strictEqual(built.input.leadType, 'enquiry');
assert.strictEqual(built.input.contact.name, 'Amina');
assert.strictEqual(built.input.contact.phone, '+256700000000');
assert.strictEqual(built.input.message, 'I want a viewing in Kololo.');
const invalid = buildAgentProfileEnquiry(agent, { contact_name: '', contact_phone: '12' });
assert(invalid.errors.includes('contact_name is required'));
assert(invalid.errors.includes('contact_phone is invalid'));
assert.strictEqual(invalid.input, undefined);

const styleStart = html.indexOf('.agent-profile {');
const styleEnd = html.indexOf('.toast {', styleStart);
const style = html.slice(styleStart, styleEnd);
assert(style.includes('padding-inline') && style.includes('inset-inline') && style.includes('inset-block-start'), 'the new layout uses logical CSS properties');
assert(!/margin-left|margin-right|text-align:\s*left|float:\s*left/.test(style), 'the new layout does not pin itself to the physical left');
assert(style.includes('Plus Jakarta Sans') && style.includes('#15803d') && style.includes('#14532d'), 'the profile uses the brand greens and Plus Jakarta Sans');
assert(style.includes('.agent-profile-mobile-bar') && style.includes('max-width: 767px'), 'the bottom bar is the phone layout');
assert(html.includes('max-w-6xl mx-auto px-4 py-8" id="broker-profile-content"'), 'the profile shell is wide enough for two columns');

const LANGS = ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar'];
const packs = Object.fromEntries(LANGS.map((lang) => [
  lang,
  JSON.parse(fs.readFileSync(path.join(root, 'assets', 'i18n', `site-${lang}.json`), 'utf8'))
]));
const requiredPhrases = [
  'Share', 'Report', 'Listings', 'Areas covered', 'Newest', 'Request',
  'Agent number', 'Live listings', 'Price range', 'Video tours', 'Price on request',
  'Listing mix', 'Short stay', 'Other', 'All types', 'Price: low to high', 'Price: high to low',
  'Never pay before viewing', 'Phone number', 'Send request', 'More dates',
  'Request sent. The agent will follow up.',
  'Add your name and phone to send a request.',
  'Could not send the request.',
  'Unverified', 'Approximate area', 'Share profile', 'Report profile',
  'Map unavailable', 'Verified status',
  'Pins without a GPS point use the area or district centre.',
  'How can this agent help?'
];
const requiredPatterns = [
  'Where ([^\\s]+) works',
  "Contact (?!Agent$|Lister$|Broker$)([A-Z][A-Za-z'.-]+)",
  'Joined (.+)',
  '(\\d+) years',
  '(\\d+) year'
];
for (const lang of LANGS) {
  const pack = packs[lang];
  for (const key of requiredPhrases) {
    const value = pack.phrases[key];
    assert(value && value !== key, `${lang} must translate "${key}"`);
    if (lang === 'ar') assert(/[\u0600-\u06FF]/.test(value), `Arabic translation of "${key}" must be Arabic`);
  }
  requiredPatterns.forEach((regex, index) => {
    const entry = pack.patterns[pack.patterns.length - requiredPatterns.length + index];
    assert(entry && entry[0] === regex, `${lang} pattern ${index} must be ${regex}`);
    assert(entry[1].includes('{1}'), `${lang} pattern ${regex} must keep the captured name or number`);
    if (lang === 'ar') assert(/[\u0600-\u06FF]/.test(entry[1]), `Arabic pattern ${regex} must be Arabic`);
  });
}

console.log('ok - agent profile option B renders, stores agent_profile leads, and covers 8 languages');
