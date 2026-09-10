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
  'Our mission',
  'All Uganda properties in one place',
  'Everything you can do',
  'Standard products',
  'Get seen first',
  'Grow your property business',
  'Advertise with makaug',
  'How we find properties online',
  'Property made simple — whoever you are',
  'From search to sorted, in three steps',
  'How we work to prevent fraud',
  'Ready to start?'
].forEach((copy) => assert(normalized.includes(copy), `/about is missing approved copy: ${copy}`));

assert(!normalized.includes('Why people choose makaug'), 'obsolete Why people choose block should be removed');
assert(!normalized.includes('Find and list land'), 'the confusing standalone land proposition should be removed');
assert(!normalized.includes('no listing fees, ever'), 'obsolete free-listing claim should be removed');
assert(!html.includes("Uganda's first completely free property platform"), 'the shared footer must not contradict the paid-listing model');
assert(html.includes("Uganda's property search engine. List your first week free, then keep it live from UGX 25,000 a month."), 'the shared footer should state the current listing model');
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
assert.strictEqual(catalog.products.offPlanDevelopment.period, 'post', 'Off Plan should be charged per post, not per month');
assert(aboutBlock.includes('class="about-advertising-summary"'), 'advertising should use the compact summary treatment');
assert(!aboutBlock.includes('about-rate-table'), 'the 22-row advertising table should not take up space on About');
assert(aboutBlock.includes('href="/advertise" data-content-i18n="about.advertisingLearnMore">Learn more</a>'), 'compact advertising summary should link to the detailed advertiser page');
assert.strictEqual((aboutBlock.match(/class="about-source-card"/g) || []).length, 4, 'found-online explanation should cover four provider groups');
assert.strictEqual((aboutBlock.match(/about-discovery-process mt-6/g) || []).length, 1, 'found-online explanation should include the review process');
assert.strictEqual((aboutBlock.match(/about.discoveryStep(?:One|Two|Three|Four)Title/g) || []).length, 4, 'found-online explanation should include all four steps');
[
  'YouTube API',
  'X API — formerly Twitter',
  'TikTok API',
  'Google APIs',
  'We do not use Facebook for this process.',
  'Nothing found online is published automatically.',
  'must link back to the specific public post, video or page'
].forEach((copy) => assert(normalized.includes(copy), `/about found-online detail is missing: ${copy}`));
assert(!aboutBlock.includes('fa-facebook'), 'Facebook must not be presented as a connected discovery source');
['oEmbed', 'WebSub', 'provider or export feeds', '/@handle/video/id'].forEach((detail) => {
  assert(!normalized.includes(detail), `/about should not expose implementation detail: ${detail}`);
});

[
  'Property for sale',
  'Property to rent',
  'Student housing',
  'Commercial property',
  'Off Plan'
].forEach((copy) => assert(normalized.includes(copy), `/about should restore the original journey overview: ${copy}`));

[
  'Identity and contact checks',
  'Reviewed before it is public',
  'Duplicate listing and image checks',
  'Sources and changes stay traceable',
  'Fraud and pressure signals',
  'Claim, correct, report or remove',
  'Your independent checks still matter'
].forEach((copy) => assert(normalized.includes(copy), `/about trust explanation is missing: ${copy}`));

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
assert(rendered.includes('UGX 150,000 / post'), 'Off Plan price should be presented per post');
assert(frontend.includes('window.__MAKAUG_ABOUT_COMMERCIAL_PRODUCTS__'), 'client pricing should read from the shared catalog');
assert(frontend.includes("fmtP(entry.amount, '')"), 'About prices should use the existing currency conversion helper');

const hrefs = [...aboutBlock.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((match) => match[1]);
assert(hrefs.length > 0, 'About should include actions');
assert(hrefs.every((href) => href && href !== '#'), 'About must not contain dead hash actions');
assert(hrefs.some((href) => href === '/advertise'), 'advertiser Learn more action should exist');
assert(!hrefs.some((href) => href.startsWith('/dashboard?product=')), 'commercial upgrades should not send visitors into an unactionable dashboard route');
assert(aboutBlock.includes('id="developers"') && /id="developers"[\s\S]*?href="\/broker-signup"[\s\S]*?>Register as an agent<\/a>/.test(aboutBlock), 'Off Plan should send developers to agent registration');
[
  'I%20want%20to%20feature%20my%20listing',
  'I%20want%20to%20make%20my%20listing%20Premium',
  'I%20want%20to%20boost%20my%20listing',
  'I%20want%20a%20Market%20Intelligence%20Report',
  'I%20want%20an%20agency%20website',
  'I%20want%20to%20book%20a%20professional%20property%20shoot'
].forEach((message) => assert(hrefs.some((href) => href.includes(message)), `missing working sales contact for: ${message}`));
assert(hrefs.filter((href) => href.startsWith('https://wa.me/256760112587?text=')).length >= 8, 'commercial sales actions should use tailored WhatsApp links');

assert(server.includes("app.get('/about/rate-card.pdf'"), 'existing PDF route should remain available for compatibility');
assert(server.includes("canonical: absolutePublicUrl('/about')"), 'About should have a self-referencing canonical');
assert(server.includes('About makaug — Products, pricing & how it works | makaug.com'), 'About should have the approved unique title');
assert(server.includes('Everything makaug offers: listings from UGX 25,000/month'), 'About should have the approved meta description');
assert(pdfService.includes("require('../config/aboutCommercialProducts')"), 'PDF must use the same price catalog as the page');

console.log('about page commercial rebuild checks passed');
