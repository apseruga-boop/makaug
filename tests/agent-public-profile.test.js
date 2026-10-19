'use strict';

// Agent profile About text and areas covered, written from live listings.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const {
  buildAgentPublicSummary,
  agentSummaryDescription,
  isPlaceholderBio,
  compactUgx
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
  assert.match(s.about[0], /^Specialises in houses for sale, rentals and plots around Kyanja, Kisaasi and Kira, with 7 live listings on makaug/);
  assert.match(s.about[0], /USh 1\.5M a month/);
  assert.doesNotMatch(s.about.join(' '), /950M/, 'an impossible monthly rent is left out of the range');
  assert.equal(s.video_tours, 1);
  assert.doesNotMatch(s.about_text, /Call or WhatsApp/i);
  assert.ok(s.about_text.length <= 280, s.about_text);
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
  assert.match(land.about[0], /^Specialises in plots and houses for sale around Kira/);
  assert.match(land.about[0], /with 9 live listings on makaug/);
  assert.match(land.about[0], /USh /);
  assert.doesNotMatch(land.about_text, /years|award|Call or WhatsApp/i);
  assert.ok(land.about_text.length >= 120 && land.about_text.length <= 280, land.about_text);

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
  assert.match(rent.about[0], /^Amina of Amina Lets Ltd specialises in rentals around Ntinda/);
  assert.match(rent.about[0], /with 6 live listings on makaug/);
  assert.match(rent.about[0], /a month/);
  assert.doesNotMatch(rent.about_text, /for sale/);
  assert.ok(rent.about_text.length <= 280, rent.about_text);

  const none = buildAgentPublicSummary({ id: 'empty-1', full_name: 'Kasulu Francis Atwau', bio: 'makaug broker covering Kampala properties.', company_name: 'Agency/company', districts_covered: ['Kampala'] }, []);
  assert.equal(none.bio_source, 'generated');
  assert.equal(none.about[0], 'Kasulu Francis Atwau is an agency on makaug covering Kampala. Their properties will appear here once listed.');

  const independent = buildAgentPublicSummary({ id: 'empty-2', full_name: 'Solo Agent', company_name: 'Independent agent', districts_covered: ['Kampala'] }, []);
  assert.equal(independent.about[0], 'Solo Agent is an independent agent on makaug covering Kampala. Their properties will appear here once listed.');

  const kept = buildAgentPublicSummary({ id: 'real-1', full_name: 'Real Agent', bio: 'I help families buy land in Gayaza and I answer the phone myself.', company_name: 'Real Homes Ltd' }, landRows);
  assert.equal(kept.bio_source, 'agent');
  assert.equal(kept.about[0], 'I help families buy land in Gayaza and I answer the phone myself.');
  assert.doesNotMatch(kept.about_text, /Real Homes Ltd/);
});

test('one listing, no listings, and land-only agents read naturally', () => {
  const one = buildAgentPublicSummary({ id: 'a4', full_name: 'Promise', bio: '' }, [listing({ listing_type: 'land', price: 7.6e9, area: 'Makerere' })]);
  assert.match(one.about[0], /^Specialises in a plot of land in Makerere, with 1 live listing on makaug/);
  assert.match(one.about[0], /USh 7\.6bn/);
  assert.doesNotMatch(one.about_text, /Call or WhatsApp/i);
  const none = buildAgentPublicSummary({ id: 'a5', full_name: 'Kasulu', bio: 'makaug broker covering Kampala properties.', company_name: 'Agency/company', districts_covered: ['Kampala', 'Makerere Kikoni'] }, []);
  assert.equal(none.bio_source, 'generated');
  assert.match(none.about[0], /^Kasulu is an agency on makaug covering Kampala\. Their properties will appear here once listed\./);
  assert.deepEqual(none.districts, ['Kampala'], 'only real districts are listed');
  const land = buildAgentPublicSummary({ id: 'a6', full_name: 'Innocent' }, Array.from({ length: 5 }, () => listing({ listing_type: 'land', area: 'Kira', district: 'Wakiso' })));
  assert.match(land.about[0], /land|plot/i);
});

test('the same agent always gets the same wording; meta description is short', () => {
  const rows = [listing({}), listing({ listing_type: 'rent', price: 2e6, price_period: 'mo' })];
  const a = buildAgentPublicSummary({ id: 'same', full_name: 'Same' }, rows);
  const b = buildAgentPublicSummary({ id: 'same', full_name: 'Same' }, rows);
  assert.equal(a.about_text, b.about_text);
  const desc = agentSummaryDescription(a, 'Same');
  assert.ok(desc.length <= 160, desc);
  assert.match(desc, /^Same: /);
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
  assert.match(route, /AS listing_districts/);
  assert.match(server, /agentPublicProfile\.agentSummaryDescription\(publicSummary, name\)/);
  assert.match(server, /areaServed: publicSummary\?\.districts\?\.length/);
  assert.match(app, /brokerAboutParagraphs\(b\)\.map/);
  assert.match(app, /\$\{brokerAreasCoveredHtml\(b\)\}/);
  assert.match(app, /const publicLicence = isInternalAgentReference\(b\.licence\) \? "" :/);
  assert.match(app, /\^\(DIRECT\|EMPLOYEE-INTAKE\|STAFF-REASSIGN\|PENDING\|/);
});
