'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const catalog = require('../config/aboutCommercialProducts');
const { injectAboutCommercialProducts } = require('../services/aboutCommercialProductsService');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const frontend = read('assets/makaug-app.js');
const server = read('server.js');
const pdfService = read('services/aboutCommercialRateCardPdfService.js');

const aboutStart = html.indexOf('<div id="page-about"');
const aboutEnd = html.indexOf('<div id="page-admin-docs"', aboutStart);
assert(aboutStart >= 0 && aboutEnd > aboutStart, 'About page block should exist before admin docs');
const aboutBlock = html.slice(aboutStart, aboutEnd);
const normalized = aboutBlock.replace(/\s+/g, ' ');

[
  'Every property in Uganda, in one place',
  "makaug is Uganda's property search engine.",
  'Standard products',
  'Get seen first',
  'Grow your property business',
  'Advertise with makaug',
  'How we find properties online',
  'Property made simple — whoever you are',
  'Trust comes first',
  'Find and list land — without pretending to clear titles',
  'Ready to start?'
].forEach((copy) => assert(normalized.includes(copy), `/about is missing approved copy: ${copy}`));

assert(!normalized.includes('Why people choose makaug'), 'obsolete Why people choose block should be removed');
assert(!normalized.includes('no listing fees, ever'), 'obsolete free-listing claim should be removed');
assert(!normalized.includes('1,889'), 'About must not contain a hardcoded live-listing total');
assert(aboutBlock.includes('id="about-live-listings-stat" class="about-stat-card hidden"'), 'live count should fail closed and stay hidden until the API succeeds');
assert(frontend.includes('return plausibleTotal || 0'), 'live-count helper should not use a hardcoded fallback');
assert(frontend.includes("liveStat?.classList.add('hidden')"), 'client should hide the live statistic on failure');

['listings', 'agents', 'developers', 'featured', 'premium', 'boosted', 'advertising', 'reports', 'websites', 'professional'].forEach((anchor) => {
  assert(aboutBlock.includes(`id="${anchor}"`), `missing deep-link anchor #${anchor}`);
});
assert.strictEqual((aboutBlock.match(/class="about-product-card"/g) || []).length, 10, 'About should render ten commercial product cards');
assert.strictEqual(catalog.advertisingPlacements.length, 22, 'single-source catalog should contain all 22 advertising placements');
assert.strictEqual(catalog.products.privateListing.amount, 25000);
assert.strictEqual(catalog.products.featuredListing.amount, 50000);
assert.strictEqual(catalog.products.offPlanDevelopment.amount, 150000);
assert(aboutBlock.includes('class="about-advertising-summary"'), 'advertising should use the compact summary treatment');
assert(!aboutBlock.includes('about-rate-table'), 'the 22-row advertising table should not take up space on About');
assert(aboutBlock.includes('href="/advertise" data-content-i18n="about.advertisingLearnMore">Learn more</a>'), 'compact advertising summary should link to the detailed advertiser page');
assert.strictEqual((aboutBlock.match(/class="about-source-card"/g) || []).length, 4, 'found-online explanation should cover four provider groups');
assert.strictEqual((aboutBlock.match(/about-discovery-process mt-6/g) || []).length, 1, 'found-online explanation should include the review process');
assert.strictEqual((aboutBlock.match(/about.discoveryStep(?:One|Two|Three|Four)Title/g) || []).length, 4, 'found-online explanation should include all four steps');
[
  'YouTube Data API, oEmbed and WebSub',
  'X API — formerly Twitter',
  'TikTok data sources and oEmbed',
  'Google Search, Maps and Places',
  'Facebook is not part of this discovery pipeline.',
  'Harvested candidates do not publish automatically.',
  'exact post or video URL—not a generic profile, hashtag or results page'
].forEach((copy) => assert(normalized.includes(copy), `/about found-online detail is missing: ${copy}`));
assert(!aboutBlock.includes('fa-facebook'), 'Facebook must not be presented as a connected discovery source');

[
  'Search rentals by district, area, map, budget, bedrooms and property type.',
  'Explore homes, land, commercial property and off-plan developments across Uganda',
  'Find student rooms and hostels near a university or campus',
  'Create a sale or rental listing on the website or begin through WhatsApp.',
  'Register your agency or broker account',
  'Search for offices, shops, warehouses, industrial space, land and development opportunities'
].forEach((copy) => assert(frontend.includes(copy), `expanded persona guidance is missing: ${copy}`));

const rendered = injectAboutCommercialProducts(aboutBlock);
assert(!rendered.includes('{{ABOUT_PRICE:'), 'server rendering should replace every price placeholder');
assert(!rendered.includes('{{ABOUT_PRICE_ONLY:'), 'server rendering should replace every price-only placeholder');
assert(rendered.includes('UGX 25,000 / property / month'), 'private listing price should come from the catalog');
assert(frontend.includes('window.__MAKAUG_ABOUT_COMMERCIAL_PRODUCTS__'), 'client pricing should read from the shared catalog');
assert(frontend.includes("fmtP(entry.amount, '')"), 'About prices should use the existing currency conversion helper');

const hrefs = [...aboutBlock.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((match) => match[1]);
assert(hrefs.length > 0, 'About should include actions');
assert(hrefs.every((href) => href && href !== '#'), 'About must not contain dead hash actions');
assert(hrefs.some((href) => href === '/advertise'), 'advertiser Learn more action should exist');
assert(hrefs.some((href) => href === '/dashboard?product=featured'), 'Featured CTA should deep-link to the owner dashboard');
assert(hrefs.filter((href) => href.startsWith('https://wa.me/256760112587?text=')).length >= 5, 'sales actions should use pre-filled WhatsApp links');

assert(server.includes("app.get('/about/rate-card.pdf'"), 'existing PDF route should remain available for compatibility');
assert(server.includes("canonical: absolutePublicUrl('/about')"), 'About should have a self-referencing canonical');
assert(server.includes('About makaug — Products, pricing & how it works | makaug.com'), 'About should have the approved unique title');
assert(server.includes('Everything makaug offers: listings from UGX 25,000/month'), 'About should have the approved meta description');
assert(pdfService.includes("require('../config/aboutCommercialProducts')"), 'PDF must use the same price catalog as the page');

console.log('about page commercial rebuild checks passed');
