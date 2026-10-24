'use strict';

// Agent profile About text and areas covered, written from live listings.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const {
  buildAgentPublicSummary,
  agentSummaryDescription,
  isPlaceholderBio,
  compactUgx,
  composeAgentBio,
  AGENT_BIO_EN_TEMPLATES
} = require('../services/agentPublicProfileService');

const listing = (fields) => ({ listing_type: 'sale', property_type: '', district: 'Kampala', area: 'Kyanja', price: 400000000, price_period: 'once', bedrooms: null, extra_fields: {}, ...fields });

test('a mixed agent gets an About written from their listings, with areas and nearby places', () => {
  const listings = [
    ...Array.from({ length: 4 }, (_, i) => listing({ bedrooms: 3 + i, property_type: 'house', price: (300 + i * 100) * 1e6 })),
    listing({ listing_type: 'rent', price: 1500000, price_period: 'mo', bedrooms: 2, area: 'Kisaasi' }),
    listing({ listing_type: 'rent', price: 950000000, price_period: 'mo', bedrooms: 1, area: 'Kisaasi' }),
    listing({ listing_type: 'land', price: 80000000, area: 'Kira', district: 'Wakiso', extra_fields: { video_url: 'https://www.tiktok.com/@a/video/1' } })
  ];
  const s = buildAgentPublicSummary({ id: 'a1', full_name: 'Test Agent', bio: null, districts_covered: ['Kampala'] }, listings);
  assert.equal(s.own_bio, false);
  assert.equal(s.bio_source, 'generated');
  assert.equal(s.listings_counted, 7);
  assert.equal(s.about.length, 1);
  assert.equal(s.about_text, s.bio_display);
  assert.match(s.about[0], /mostly family homes, plus some plots around Kyanja, Kisaasi and Kira/);
  assert.match(s.about[0], /for sale, with some homes to rent/);
  assert.match(s.about[0], /USh 1\.5M a month/);
  assert.match(s.about[0], /2 to 5 bedrooms/);
  assert.match(s.about[0], /families/);
  assert.match(s.about[0], /book a viewing or request a callback/i);
  assert.doesNotMatch(s.about_text, /live listings?/i);
  assert.doesNotMatch(s.about_text, /\b7\b/);
  assert.doesNotMatch(s.about_text, /\b\d+\s+listings?\b/i);
  assert.doesNotMatch(s.about.join(' '), /950M/, 'an impossible monthly rent is left out of the range');
  assert.equal(s.video_tours, 1);
  assert.doesNotMatch(s.about_text, /Call or WhatsApp/i);
  const words = s.about_text.trim().split(/\s+/);
  assert.ok(words.length >= 80 && words.length <= 140, `${words.length} words: ${s.about_text}`);
  assert.ok(s.about_text.split(/(?<=\.)\s+/).length >= 4 && s.about_text.split(/(?<=\.)\s+/).length <= 6, s.about_text);
  assert.deepEqual(s.areas.map((a) => a.name), ['Kyanja', 'Kisaasi', 'Kira']);
  assert.ok(s.nearby_areas.length > 0, 'nearby areas come from the location registry');
  assert.ok(!s.nearby_areas.some((a) => ['Kyanja', 'Kisaasi', 'Kira'].includes(a.name)));
  assert.deepEqual(s.districts.slice(0, 2), ['Kampala', 'Wakiso']);
  // No invented claims.
  assert.doesNotMatch(s.about_text, /years|award|best|top-rated|guarantee/i);
});

test("an agent's own bio stays first and is not replaced; placeholders and internal notes are", () => {
  const bio = 'Kazi sells smart homes near Kigo. This profile was created from the agent’s direct submission; identity verification and account claim are pending.';
  const own = buildAgentPublicSummary({ id: 'a2', full_name: 'Kazi', bio, verification_reason: '[DIRECT_AGENT_AUTHORISED] staff' }, [listing({})]);
  assert.equal(own.own_bio, true);
  assert.equal(own.bio_source, 'agent');
  assert.equal(own.about[0], 'Kazi sells smart homes near Kigo.', 'makaug-created profiles lose the internal note');
  const thirdParty = buildAgentPublicSummary({ id: 'a2b', full_name: 'Kazi', bio }, [listing({})]);
  assert.equal(thirdParty.about[0], 'Kazi sells smart homes near Kigo.', 'the internal note is makaug boilerplate on any public bio');
  assert.equal(thirdParty.bio_source, 'agent');
  for (const bio of ['', 'Professional makaug agent profile.', 'makaug broker covering Kampala properties.']) {
    assert.equal(isPlaceholderBio(bio), true, bio);
    assert.equal(buildAgentPublicSummary({ id: 'a3', full_name: 'X', bio }, [listing({})]).own_bio, false);
  }
});

test('land-heavy, rental, mixed and empty portfolios each get a plain-English card bio', () => {
  const landRows = [
    ...Array.from({ length: 8 }, (_, i) => listing({ listing_type: 'land', property_type: 'land', area: i < 5 ? 'Kira' : 'Gayaza', district: 'Wakiso', price: (80 + i * 20) * 1e6 })),
    listing({ listing_type: 'sale', property_type: 'house', bedrooms: 3, area: 'Kira', district: 'Wakiso', price: 450e6 })
  ];
  const land = buildAgentPublicSummary({ id: 'land-1', full_name: 'Innocent', bio: '', company_name: 'Independent agent' }, landRows);
  assert.equal(land.bio_source, 'generated');
  assert.match(land.about[0], /mostly plots/);
  assert.match(land.about[0], /Kira/);
  assert.match(land.about[0], /for sale/);
  assert.doesNotMatch(land.about_text, /live listings?/i);
  assert.match(land.about[0], /USh /);
  assert.doesNotMatch(land.about_text, /years|award|Call or WhatsApp/i);
  assert.ok(land.about_text.split(/\s+/).length >= 40, land.about_text);

  const rentRows = Array.from({ length: 6 }, (_, i) => listing({
    listing_type: 'rent',
    property_type: i < 4 ? 'apartment' : 'house',
    price: (800 + i * 200) * 1e3,
    price_period: 'mo',
    bedrooms: 2,
    area: i < 4 ? 'Ntinda' : 'Bukoto',
    district: 'Kampala'
  }));
  const rent = buildAgentPublicSummary({ id: 'rent-1', full_name: 'Amina', company_name: 'Amina Lets Ltd' }, rentRows);
  assert.equal(rent.bio_source, 'generated');
  assert.match(rent.about[0], /Amina of Amina Lets Ltd/);
  assert.match(rent.about[0], /apartments/);
  assert.match(rent.about[0], /Ntinda/);
  assert.match(rent.about[0], /on makaug/);
  assert.doesNotMatch(rent.about_text, /live listings?/i);
  assert.match(rent.about[0], /a month/);
  assert.doesNotMatch(rent.about_text, /for sale/);

  const none = buildAgentPublicSummary({ id: 'empty-1', full_name: 'Kasulu Francis Atwau', bio: 'makaug broker covering Kampala properties.', company_name: 'Agency/company', districts_covered: ['Kampala'] }, []);
  assert.equal(none.bio_source, 'generated');
  assert.equal(none.about[0], 'Kasulu Francis Atwau is an agency on makaug covering Kampala. Their properties will appear here once listed.');

  const independent = buildAgentPublicSummary({ id: 'empty-2', full_name: 'Solo Agent', company_name: 'Independent agent', districts_covered: ['Kampala'] }, []);
  assert.equal(independent.about[0], 'Solo Agent is an independent agent on makaug covering Kampala. Their properties will appear here once listed.');

  const kept = buildAgentPublicSummary({ id: 'real-1', full_name: 'Real Agent', bio: 'I help families buy land in Gayaza and I answer the phone myself.', company_name: 'Real Homes Ltd' }, landRows);
  assert.equal(kept.bio_source, 'agent');
  assert.equal(kept.about[0], 'I help families buy land in Gayaza and I answer the phone myself.');
  assert.match(kept.about[1], /^On makaug,/);
  assert.doesNotMatch(kept.about[0], /On makaug/);
  assert.doesNotMatch(kept.about_text, /Real Homes Ltd/);
});

test('one listing, no listings, and land-only agents read naturally', () => {
  const one = buildAgentPublicSummary({ id: 'a4', full_name: 'Promise', bio: '' }, [listing({ listing_type: 'land', price: 7.6e9, area: 'Makerere' })]);
  assert.match(one.about[0], /a plot in Makerere/);
  assert.doesNotMatch(one.about_text, /live listing/i);
  assert.match(one.about[0], /USh 7\.6bn/);
  assert.match(one.about[0], /book a viewing or request a callback/i);
  assert.doesNotMatch(one.about_text, /Call or WhatsApp/i);
  assert.doesNotMatch(one.about_text, /bedroom|gated|lake view|mailo/i);
  const none = buildAgentPublicSummary({ id: 'a5', full_name: 'Kasulu', bio: 'makaug broker covering Kampala properties.', company_name: 'Agency/company', districts_covered: ['Kampala', 'Makerere Kikoni'] }, []);
  assert.equal(none.bio_source, 'generated');
  assert.match(none.about[0], /^Kasulu is an agency on makaug covering Kampala\. Their properties will appear here once listed\./);
  assert.deepEqual(none.districts, ['Kampala'], 'only real districts are listed');
  const land = buildAgentPublicSummary({ id: 'a6', full_name: 'Innocent' }, Array.from({ length: 5 }, () => listing({ listing_type: 'land', area: 'Kira', district: 'Wakiso' })));
  assert.match(land.about[0], /land|plot/i);
});

test('generated bios carry parts the client can compose, and a real bio has none', () => {
  const rows = [
    listing({ property_type: 'house', bedrooms: 3, area: 'Kyanja', price: 150e6 }),
    listing({ listing_type: 'land', area: 'Kira', district: 'Wakiso', price: 80e6 })
  ];
  const generated = buildAgentPublicSummary({ id: 'parts-1', full_name: 'Kimuli Brian', company_name: 'Independent agent' }, rows);
  assert.equal(generated.bio_source, 'generated');
  assert.ok(Array.isArray(generated.bio_parts) && generated.bio_parts.length >= 1);
  assert.equal(composeAgentBio(generated.bio_parts, AGENT_BIO_EN_TEMPLATES), generated.bio_display);
  const sw = JSON.parse(fs.readFileSync('assets/i18n/site-sw.json', 'utf8')).templates;
  const lg = JSON.parse(fs.readFileSync('assets/i18n/site-lg.json', 'utf8')).templates;
  const swText = composeAgentBio(generated.bio_parts, sw);
  const lgText = composeAgentBio(generated.bio_parts, lg);
  assert.match(swText, /Kyanja/);
  assert.match(swText, /Kira/);
  assert.doesNotMatch(swText, /Specialises in/);
  assert.match(lgText, /Kyanja/);
  assert.doesNotMatch(lgText, /Specialises in/);
  assert.doesNotMatch(swText, /live listing|tangazo|matangazo/i);
  assert.doesNotMatch(lgText, /live listing|ekirango|ebirango/i);
  for (const lang of ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar']) {
    const templates = JSON.parse(fs.readFileSync(`assets/i18n/site-${lang}.json`, 'utf8')).templates;
    const translated = composeAgentBio([generated.bio_parts[0]], templates);
    assert.ok(translated, `${lang} still composes a bio`);
    assert.doesNotMatch(translated, /\{count\}|live listing|[0-9]/i, lang);
    assert.doesNotMatch(templates.specialises, /\{count\}/, lang);
    assert.doesNotMatch(templates['specialises.company'], /\{count\}/, lang);
    assert.ok(templates['count.one'] && templates['count.many'], `${lang} keeps the unused count keys`);
  }
  const stale = composeAgentBio([{
    t: 'specialises',
    one: false,
    types: ['plots', 'houses_for_sale'],
    place: 'around',
    areas: ['Kira', 'Kyanja'],
    count: 9
  }], {
    ...AGENT_BIO_EN_TEMPLATES,
    specialises: 'Specialises in {types}{place}, with {count} on makaug.'
  });
  assert.equal(stale, 'Specialises in plots and houses for sale around Kira and Kyanja on makaug.');
  assert.doesNotMatch(stale, /live listing|[0-9]/i);
  const migration = fs.readFileSync('db/migrations/162_clear_generated_listing_count_bios.sql', 'utf8');
  assert.match(migration, /UPDATE agents/);
  assert.match(migration, /SET bio = NULL/);
  assert.match(migration, /specialises in \.\+ with \[0-9\]\+ live listings\? on makaug/);
  assert.doesNotMatch(migration, /UPDATE agents\s+SET bio = NULL\s+WHERE bio IS NOT NULL\s*;/);
  const own = buildAgentPublicSummary({ id: 'parts-2', full_name: 'Kazi', bio: 'Kazi helps buyers across Wakiso.' }, rows);
  assert.equal(own.bio_source, 'agent');
  assert.equal(own.about[0], 'Kazi helps buyers across Wakiso.');
  assert.match(own.about[1], /^On makaug,/);
  assert.equal(composeAgentBio(own.bio_parts, AGENT_BIO_EN_TEMPLATES), own.about[1]);
  const empty = buildAgentPublicSummary({ id: 'parts-3', full_name: 'Kasulu Francis Atwau', company_name: 'Agency/company', districts_covered: ['Kampala'], bio: 'makaug broker covering Kampala properties.' }, []);
  assert.match(composeAgentBio(empty.bio_parts, sw), /Kasulu Francis Atwau/);
  assert.match(composeAgentBio(empty.bio_parts, sw), /Kampala/);
  assert.doesNotMatch(composeAgentBio(empty.bio_parts, sw), /is an agency on makaug/);
});

test('standout features are mentioned only when the listings actually say them', () => {
  const rows = [
    listing({ description: 'Gated family house', bedrooms: 4, property_type: 'house', title_type: 'Private Mailo', area: 'Kira' }),
    listing({ description: 'Another gated house', bedrooms: 3, property_type: 'house', title_type: 'Private Mailo', area: 'Ntinda' }),
    listing({ description: 'A self-contained house', bedrooms: 5, property_type: 'house', area: 'Kyanja' })
  ];
  const bio = buildAgentPublicSummary({ id: 'feat-1', full_name: 'Feature Agent' }, rows).about_text;
  assert.match(bio, /gated compound/i);
  assert.match(bio, /private mailo title/i);
  assert.doesNotMatch(bio, /self-contained/i, 'one mention is not enough to call it a feature of the portfolio');
  assert.doesNotMatch(bio, /lake view/i);
  assert.doesNotMatch(bio, /live listings?/i);
});

test('the same agent always gets the same wording; meta description is short', () => {
  const rows = [listing({}), listing({ listing_type: 'rent', price: 2e6, price_period: 'mo' })];
  const a = buildAgentPublicSummary({ id: 'same', full_name: 'Same' }, rows);
  const b = buildAgentPublicSummary({ id: 'same', full_name: 'Same' }, rows);
  assert.equal(a.about_text, b.about_text);
  const desc = agentSummaryDescription(a, 'Same');
  assert.ok(desc.length <= 160, desc);
  assert.doesNotMatch(desc, /live listings?|\b\d+\s+listings?\b/i);
  assert.equal(compactUgx(1520000000), 'USh 1.5bn');
  assert.equal(compactUgx(24000000), 'USh 24M');
});

test('the API, page meta and profile page use the summary; internal reference numbers stay hidden', () => {
  const route = fs.readFileSync('routes/agents.js', 'utf8');
  const server = fs.readFileSync('server.js', 'utf8');
  const app = fs.readFileSync('assets/makaug-app.js', 'utf8');
  assert.match(route, /public_summary: publicSummary,/);
  assert.match(route, /loadAgentCardBios/);
  assert.match(route, /bio_display: card\.text/);
  assert.match(route, /bio_source: card\.source/);
  assert.match(route, /bio_parts: card\.parts/);
  assert.match(app, /function localizedAgentCardBio/);
  assert.match(app, /function composeAgentBio/);
  assert.match(route, /AS listing_districts/);
  assert.match(server, /agentPublicProfile\.agentSummaryDescription\(publicSummary, name\)/);
  assert.match(server, /areaServed: publicSummary\?\.districts\?\.length/);
  assert.match(app, /brokerAboutParagraphs\(b\)\.map/);
  const profileStart = app.indexOf('async function openBrokerProfile(id)');
  const profileEnd = app.indexOf('function applyBrokerFilters()', profileStart);
  const profile = app.slice(profileStart, profileEnd);
  assert.ok(profileStart > 0 && profileEnd > profileStart);
  assert.match(profile, /const areaCounts = agentProfileAreaCounts\(list, b\)/);
  assert.match(profile, /<span>Areas covered<\/span>/);
  assert.match(profile, /agent-profile-chip">\$\{adminEscape\(name\)\} <span>\(\$\{count\}\)<\/span>/);
  assert.match(profile, /const agentNumber = String\(b\.makaug_agent_number \|\| ""\)\.trim\(\)/);
  assert.match(profile, /<span>Agent number<\/span>/);
  assert.doesNotMatch(profile, /\$\{[^}]*\blicence\b/);
  assert.match(app, /\^\(DIRECT\|EMPLOYEE-INTAKE\|STAFF-REASSIGN\|PENDING\|/);
});

test('untyped sale prices fold into the typed sale phrase and still omit listing counts', () => {
  const houses = [
    listing({ property_type: 'house', bedrooms: 3, price: 200e6 }),
    listing({ property_type: 'house', bedrooms: 3, price: 250e6 }),
    listing({ property_type: 'house', bedrooms: 3, price: 300e6 }),
    listing({ property_type: 'house', bedrooms: 3, price: 350e6 })
  ];
  const untyped = [
    listing({ property_type: '', price: 80e6 }),
    listing({ property_type: '', price: 90e6 }),
    listing({ property_type: '', price: 100e6 })
  ];
  const mixed = buildAgentPublicSummary({ id: 'fold-houses', full_name: 'Fold Agent', bio: '' }, [...houses, ...untyped]);
  assert.match(mixed.about_text, /houses for sale/);
  assert.doesNotMatch(mixed.about_text, /properties for sale/);
  assert.equal((mixed.about_text.match(/for sale/g) || []).length >= 1, true);
  assert.doesNotMatch(mixed.about_text, /live listings?/i);
  assert.doesNotMatch(mixed.about_text, /\b\d+\s+listings?\b/i);

  const apartments = [
    ...Array.from({ length: 4 }, () => listing({ property_type: 'apartment', bedrooms: 2, price: 180e6 })),
    listing({ property_type: 'house', bedrooms: 3, price: 400e6 })
  ];
  const intoApartments = buildAgentPublicSummary({ id: 'fold-flats', full_name: 'Fold Agent', bio: '' }, [...apartments, ...untyped]);
  assert.match(intoApartments.about_text, /apartments for sale/);
  assert.doesNotMatch(intoApartments.about_text, /properties for sale/);
  assert.doesNotMatch(intoApartments.about_text, /\b\d+\s+listings?\b/i);

  const onlyUntyped = buildAgentPublicSummary({ id: 'fold-plain', full_name: 'Fold Agent', bio: '' }, untyped.slice(0, 2));
  assert.match(onlyUntyped.about_text, /properties for sale/);
  assert.doesNotMatch(onlyUntyped.about_text, /houses for sale/);
  assert.doesNotMatch(onlyUntyped.about_text, /\b\d+\s+listings?\b/i);
});
