'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const portraitPath = path.join(root, 'assets', 'agents', 'kazi-honest-professional-v2.jpg');

const directoryStart = frontend.indexOf('if (id === "brokers-grid")');
const directoryEnd = frontend.indexOf('setBrokerMapMarkers(list);', directoryStart);
const directoryCard = frontend.slice(directoryStart, directoryEnd);
const homepageStart = frontend.indexOf('el.innerHTML = list.map((b) => `', directoryEnd);
const homepageEnd = frontend.indexOf('function renderSaved()', homepageStart);
const homepageCard = frontend.slice(homepageStart, homepageEnd);
const profileStart = frontend.indexOf('async function openBrokerProfile(id)');
const profileEnd = frontend.indexOf('function applyBrokerFilters()', profileStart);
const profile = frontend.slice(profileStart, profileEnd);

assert(directoryStart > 0 && directoryEnd > directoryStart, 'Find Brokers card renderer should exist');
assert(homepageStart > directoryEnd && homepageEnd > homepageStart, 'Featured Agents card renderer should exist');
assert(profileStart > 0 && profileEnd > profileStart, 'public broker profile renderer should exist');

assert(directoryCard.includes('w-28 h-28 border-4 shadow-sm'), 'Find Brokers should use a large portrait');
assert(homepageCard.includes('w-28 h-28 border-4 shadow-sm'), 'Featured Agents should keep the portrait as the largest card identity element');
assert(frontend.includes('function brokerIconActionsHtml'), 'broker cards should share one compact icon action rail');
assert(directoryCard.includes('${brokerIconActionsHtml(b)}') && homepageCard.includes('${brokerIconActionsHtml(b)}'), 'both public card surfaces should use compact icon actions');
assert(!directoryCard.includes('translateListingLabel("Call")') && !homepageCard.includes('translateListingLabel("WhatsApp")'), 'compact cards should not use large text contact buttons');
assert(profile.includes('h-28 md:h-36 bg-gradient-to-r') && profile.includes('w-36 h-36 md:w-44 md:h-44 rounded-full'), 'broker profile should use a LinkedIn-style cover and a contained portrait');
assert(!profile.includes('w-64 h-64') && !profile.includes('lg:grid-cols-[300px,1fr]'), 'broker profile must not stretch the portrait into the old oversized photo block');
assert(profile.includes('aria-labelledby="broker-about-heading"') && profile.includes('Profile overview'), 'broker profile should clearly explain who the agent is');

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
