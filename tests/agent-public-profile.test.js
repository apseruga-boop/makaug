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
  assert.equal(s.listings_counted, 7);
  assert.equal(s.about.length, 3);
  assert.match(s.about[0], /^Test Agent/);
  assert.match(s.about[1], /4 houses for sale, 2 rentals and 1 plot of land/);
  assert.match(s.about[1], /USh 1\.5M a month to rent/);
  assert.doesNotMatch(s.about.join(' '), /950M/, 'an impossible monthly rent is left out of the range');
  assert.match(s.about[1], /One listing comes with a video tour/);
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
  assert.equal(own.about[0], 'Kazi sells smart homes near Kigo.', 'makaug-created profiles lose the internal note');
  const thirdParty = buildAgentPublicSummary({ id: 'a2b', full_name: 'Kazi', bio }, [listing({})]);
  assert.equal(thirdParty.about[0], bio, "an agent's own words are never rewritten");
  for (const bio of ['', 'Professional makaug agent profile.', 'makaug broker covering Kampala properties.']) {
    assert.equal(isPlaceholderBio(bio), true, bio);
    assert.equal(buildAgentPublicSummary({ id: 'a3', full_name: 'X', bio }, [listing({})]).own_bio, false);
  }
});

test('one listing, no listings, and land-only agents read naturally', () => {
  const one = buildAgentPublicSummary({ id: 'a4', full_name: 'Promise', bio: '' }, [listing({ listing_type: 'land', price: 7.6e9, area: 'Makerere' })]);
  assert.match(one.about[1], /^Right now they have one live listing on makaug, a plot of land in Makerere\. The asking price is USh 7\.6bn\./);
  const none = buildAgentPublicSummary({ id: 'a5', full_name: 'Kasulu', bio: 'makaug broker covering Kampala properties.', districts_covered: ['Kampala', 'Makerere Kikoni'] }, []);
  assert.match(none.about[0], /^Kasulu is a property agent on makaug covering Kampala\./);
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
  assert.match(route, /AS listing_districts/);
  assert.match(server, /agentPublicProfile\.agentSummaryDescription\(publicSummary, name\)/);
  assert.match(server, /areaServed: publicSummary\?\.districts\?\.length/);
  assert.match(app, /brokerAboutParagraphs\(b\)\.map/);
  assert.match(app, /\$\{brokerAreasCoveredHtml\(b\)\}/);
  assert.match(app, /const publicLicence = isInternalAgentReference\(b\.licence\) \? "" :/);
  assert.match(app, /\^\(DIRECT\|EMPLOYEE-INTAKE\|STAFF-REASSIGN\|PENDING\|/);
});
