'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const portraitPath = path.join(root, 'assets', 'agents', 'kazi-honest.jpg');

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
assert(homepageCard.includes('w-32 h-32 border-4 shadow-sm'), 'Featured Agents should make the portrait the largest card identity element');
assert(profile.includes('w-64 h-64') && profile.includes('lg:grid-cols-[300px,1fr]'), 'broker profile should use a large portrait-led layout');

assert(!directoryCard.includes('${b.sales'), 'Find Brokers must not render an unverified sales count');
assert(!directoryCard.includes('translateListingLabel("Sales")'), 'Find Brokers must not render a Sales label');
assert(!homepageCard.includes('(b.specialties || [])[0]'), 'Featured Agents should keep secondary specialty data off the compact portrait card');
assert(!profile.includes('${b.sales'), 'public broker profiles must not render an unverified sales count');

assert(fs.existsSync(portraitPath), 'Kazi Honest portrait asset should exist');
assert(frontend.includes('["kazi honest", "/assets/agents/kazi-honest.jpg?v=20260901"]'), 'Kazi Honest should resolve to the supplied official portrait when her profile has no photo');
const portrait = fs.readFileSync(portraitPath);
assert(portrait.length > 20_000, 'Kazi Honest portrait should contain the supplied full image');
assert.strictEqual(portrait[0], 0xff, 'portrait should be a JPEG');
assert.strictEqual(portrait[1], 0xd8, 'portrait should be a JPEG');

console.log('ok - broker portraits are hero-sized and public sales counts are hidden');
