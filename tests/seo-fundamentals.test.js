'use strict';

// PR A: SEO fundamentals (A1–A7), 8 Oct 2026.

process.env.COUNTRY_CODE = 'UG';
process.env.S3_PUBLIC_BASE_URL = 'https://media.makaug.com';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const db = require('../config/database');
const { isKnownPublicRoute } = require('../services/publicHtmlSanitizer');
const seo = require('../services/publicSeoService');
const { resolvePublicSeoLanding } = require('../services/publicSeoLandingService');
const { loadPublicSeoListings, __seoListingCache } = require('../services/publicSeoRenderService');
const { cleanListingTitle } = require('../services/publicListingCopy');
const { humanPropertyTypeLabel } = require('../utils/commercialClassification');
const { compactUgx } = require('../utils/compactUgx');
const { isThinFoundOnlineListing, meaningfulWordCount } = require('../utils/publicIndexability');
const { buildLandingCopy } = require('../services/publicLandingCopy');
const { SEO_FACET_MIN_LISTINGS } = require('../utils/publicSeoFacets');

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'assets', 'makaug-app.js'), 'utf8');

// ---- fixtures -----------------------------------------------------------------
const TAG = `seoA${crypto.randomBytes(3).toString('hex')}`;
const created = [];
const fixture = {};
async function add(f) {
  const id = crypto.randomUUID();
  created.push(id);
  await db.query(
    `INSERT INTO properties (id, listing_type, title, description, district, area, price, price_period, bedrooms, property_type,
                             status, moderation_stage, extra_fields, listed_via, source, lister_type, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'approved','approved',$11::jsonb,$12,$12,'owner',NOW() - ($13::int * INTERVAL '1 day'), NOW())`,
    [id, f.type, f.title, f.desc || `${TAG} fixture`, f.district, f.area, f.price, f.period || 'once', f.beds || null, f.ptype || null,
      JSON.stringify(f.extra || {}), f.via || 'website', f.age || 1]
  );
  if (f.photo) await db.query(`INSERT INTO property_images (property_id, url, is_primary, sort_order) VALUES ($1, $2, true, 0)`, [id, f.photo]);
  return id;
}

async function seed() {
  // A sale with a 2-shilling price must never become "Prices start from USh 2".
  fixture.twoShilling = await add({ type: 'sale', title: `${TAG} two shilling`, district: 'Wakiso', area: 'Kira', price: 2, beds: 3, ptype: 'House', extra: { canonical_location_id: 'wakiso:kira' } });
  for (const [i, p] of [140e6, 300e6, 620e6, 800e6, 1e9, 2.47e9, 355e6].entries()) {
    await add({ type: 'sale', title: `${TAG} house ${i} for sale in Kira`, district: 'Wakiso', area: 'Kira', price: p, beds: 3, ptype: 'Bungalow', extra: { canonical_location_id: 'wakiso:kira' } });
  }
  for (const [i, p] of [800e3, 1.2e6, 1.4e6, 1.5e6, 2e6, 2.6e6].entries()) {
    await add({ type: 'rent', title: `${TAG} house ${i} to rent in Ntinda`, district: 'Kampala', area: 'Ntinda', price: p, period: 'mo', beds: 2, ptype: 'House', extra: { canonical_location_id: 'kampala:ntinda' } });
  }
  // Rows without a canonical id count under their district (A4 parity).
  for (let i = 0; i < 3; i += 1) {
    await add({ type: 'sale', title: `${TAG} bungalow ${i}`, district: 'Kampala', area: '', price: 400e6, beds: 4, ptype: 'Bungalow' });
  }
  for (let i = 0; i < 3; i += 1) {
    await add({ type: 'commercial', title: 'shop_retail in Kampala', district: 'Kampala', area: 'Ntinda', price: 3e6, period: 'mo', ptype: 'shop_retail', extra: { canonical_location_id: 'kampala:ntinda', transaction_type: 'rent' } });
  }
  fixture.thin = await add({ type: 'sale', title: 'Land in Entebbe', desc: 'Land in Entebbe is a third-party property result found from X on TikTok. Makaug provides a search and discovery preview.', district: 'Wakiso', area: 'Entebbe', price: 110e6, via: 'found_online', extra: { found_online: true, source_platform: 'TikTok', source_url: 'https://www.tiktok.com/@x/video/1', canonical_location_id: 'wakiso:entebbe' } });
  fixture.rich = await add({ type: 'sale', title: 'Family home in Entebbe', desc: `${Array.from({ length: 45 }, (_, i) => `word${i}`).join(' ')}.`, district: 'Wakiso', area: 'Entebbe', price: 450e6, via: 'found_online', photo: 'https://media.makaug.com/properties/entebbe.jpg', extra: { found_online: true, source_platform: 'TikTok', source_url: 'https://www.tiktok.com/@x/video/2', canonical_location_id: 'wakiso:entebbe', staff_corrected_fields: ['description'] } });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    srv.on('error', reject);
  });
}

let child;
let base;
test.before(async () => {
  await seed();
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), NODE_ENV: process.env.NODE_ENV || 'test', MEMORY_LOG: 'off', S3_PUBLIC_BASE_URL: 'https://media.makaug.com' },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  for (let i = 0; i < 180; i += 1) {
    try { if ((await fetch(`${base}/healthz`)).ok) return; } catch (_) {}
    if (child.exitCode !== null) throw new Error(`server exited: ${stderr}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not start: ${stderr}`);
});

test.after(async () => {
  if (child && child.exitCode === null) child.kill('SIGTERM');
  await db.query('DELETE FROM properties WHERE id = ANY($1::uuid[])', [created]).catch(() => {});
  await db.pool?.end?.().catch?.(() => {});
});

const get = (p, opts = {}) => fetch(base + p, { redirect: 'manual', ...opts });
const canonicalOf = (html) => (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
const titleOf = (html) => (html.match(/<title>([^<]*)<\/title>/) || [])[1];
const descriptionOf = (html) => (html.match(/<meta name="description" content="([^"]*)"/) || [])[1];

// ---- A1 -------------------------------------------------------------------------

test('A1: every SPA route is known to the server (the two lists agree)', () => {
  const block = app.slice(app.indexOf('const PUBLIC_ROUTE_PAGE_MAP = Object.freeze({'), app.indexOf('});', app.indexOf('const PUBLIC_ROUTE_PAGE_MAP = Object.freeze({')));
  const spaRoutes = [...block.matchAll(/"(\/[^"]*)":/g)].map((m) => m[1]);
  assert.ok(spaRoutes.length > 30);
  const missing = spaRoutes.filter((route) => !isKnownPublicRoute(route));
  assert.deepEqual(missing, [], 'SPA routes the server would 404');
});

test('A1: SPA routes are 200, aliases 301, unknown paths 404 with noindex, /api/unknown stays JSON', async () => {
  for (const p of ['/', '/how-it-works', '/help', '/for-sale', '/to-rent', '/land', '/about', '/terms', '/privacy-policy', '/safety', '/sale', '/brokers', '/how-it-works/', '/Help']) {
    assert.equal((await get(p)).status, 200, p);
  }
  for (const [from, to] of [['/contact', '/help'], ['/faq', '/help'], ['/privacy', '/privacy-policy'], ['/legal/terms', '/terms'], ['/pricing', '/about']]) {
    const res = await get(from);
    assert.equal(res.status, 301, from);
    assert.equal(res.headers.get('location'), to, from);
  }
  for (const p of ['/blog', '/.env', '/random-xyz', '/this-does-not-exist-xyz']) {
    const res = await get(p);
    assert.equal(res.status, 404, p);
    assert.match(res.headers.get('x-robots-tag') || '', /noindex/, p);
    const html = await res.text();
    assert.match(html, /<meta name="robots" content="noindex">/);
    for (const link of ['href="/"', 'href="/for-sale"', 'href="/to-rent"', 'href="/land"', 'href="/help"']) assert.ok(html.includes(link), `${p} links ${link}`);
  }
  const api = await get('/api/unknown-route-xyz');
  assert.equal(api.status, 404);
  assert.match(api.headers.get('content-type') || '', /json/);
});

// ---- A2 -------------------------------------------------------------------------

test('A2: every app page in the table has its own title, description and self-canonical; titles are unique', async () => {
  const titles = new Map();
  for (const [p, entry] of Object.entries(seo.PUBLIC_PAGE_SEO)) {
    const html = await (await get(p)).text();
    const decode = (value = '') => value.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    assert.equal(decode(titleOf(html)), entry.title, `${p} title`);
    assert.ok(descriptionOf(html), `${p} description`);
    assert.ok(entry.description.length <= 155, `${p} description ≤ 155`);
    assert.equal(canonicalOf(html), `https://makaug.com${p}`, `${p} canonical`);
    if (entry.robots) assert.match(html, /<meta name="robots" content="noindex,follow">/, `${p} noindex`);
    if (!entry.robots) {
      assert.ok(!titles.has(entry.title), `duplicate title ${entry.title}`);
      titles.set(entry.title, p);
    }
  }
});

test('A2: no public page except / canonicalises to the homepage; aliases canonicalise to their primary path', async () => {
  const pages = ['/featured', '/for-sale', '/to-rent', '/land', '/commercial', '/student-accommodation', '/short-term', '/off-plan', '/how-it-works', '/careers', '/help', '/safety', '/terms', '/privacy-policy', '/cookie-policy', '/marketplace', '/advertise', '/brokers', '/mortgage', '/valuation', '/discover-ai-chatbot', '/anti-fraud', '/list-property', '/about', '/saved', '/tiktok-connect', '/login', '/signup'];
  for (const p of pages) {
    const html = await (await get(p)).text();
    assert.notEqual(canonicalOf(html), 'https://makaug.com/', `${p} must not canonicalise to /`);
  }
  for (const [alias, primary] of Object.entries(seo.PUBLIC_PAGE_ALIASES)) {
    const res = await get(alias);
    assert.equal(res.status, 200, alias);
    assert.equal(canonicalOf(await res.text()), `https://makaug.com${primary}`, alias);
  }
  assert.equal(canonicalOf(await (await get('/')).text()), 'https://makaug.com/');
});

test('A2: unknown overseas market and non-public agent are 404; sitemap lists the new hub pages', async () => {
  assert.equal((await get('/off-plan/overseas/atlantis-xyz')).status, 404);
  assert.equal((await get(`/agents/${crypto.randomUUID()}`)).status, 404);
  const entries = seo.sitemapEntries({}, 'https://makaug.com').map((entry) => entry.loc);
  for (const p of ['/about', '/how-it-works', '/help', '/safety', '/anti-fraud', '/advertise']) assert.ok(entries.includes(`https://makaug.com${p}`), p);
});

// ---- A3 -------------------------------------------------------------------------

test('A3: cleanListingTitle table', () => {
  const rows = [
    [{ title: 'Land on sale!! Location: Gayaza Road kyabakadde Sale price: 120m per acre…', listing_type: 'land', area: 'Gayaza' }, (t) => /^Land on sale! Location: Gayaza Road/.test(t) && !/!!/.test(t)],
    [{ title: 'NEW APARTMENT ALERT – KIWATULE! Looking for a modern 2 bedroom apartment', listing_type: 'rent', area: 'Kiwatule' }, (t) => t === 'New apartment alert – Kiwatule!'],
    [{ title: 'Plotforsale 50x100ft@15m team', listing_type: 'land', area: 'Gayaza' }, (t) => !t.includes('@')],
    [{ title: '🏡🔥✨🇺🇬', listing_type: 'sale', bedrooms: 3, property_type: 'House', area: 'Kira' }, (t) => t === '3-bed house for sale in Kira'],
    [{ title: '#house #kira #forsale', listing_type: 'land', area: 'Kira' }, (t) => t === 'Land for sale in Kira'],
    [{ title: 'Call 0772123456 now!!!', listing_type: 'rent', bedrooms: 2, property_type: 'Apartment', area: 'Ntinda' }, (t) => t === '2-bed apartment for rent in Ntinda'],
    [{ title: 'Spacious 4 bedroom house in Muyenga with pool and staff quarters (fully furnished)', listing_type: 'sale' }, (t) => t.length <= 60 && !/[(]$/.test(t) && !/\b(with|in|and)$/.test(t)],
    [{ title: 'shop_retail in Kampala', listing_type: 'commercial', area: 'Kampala' }, (t) => t === 'Shop / retail space in Kampala']
  ];
  for (const [row, ok] of rows) {
    const title = cleanListingTitle(row);
    assert.ok(ok(title), `${JSON.stringify(row.title)} → ${JSON.stringify(title)}`);
    assert.ok(title.length <= 60);
  }
});

test('A3: enum labels', () => {
  assert.equal(humanPropertyTypeLabel('office'), 'Office');
  assert.equal(humanPropertyTypeLabel('shop_retail'), 'Shop / retail space');
  assert.equal(humanPropertyTypeLabel('warehouse_industrial'), 'Warehouse / industrial');
  assert.equal(humanPropertyTypeLabel('commercial_land'), 'Commercial land');
  assert.equal(humanPropertyTypeLabel('hospitality'), 'Hospitality property');
  assert.equal(humanPropertyTypeLabel('other'), 'Commercial property');
  assert.equal(humanPropertyTypeLabel('boys_quarters'), 'Boys quarters');
});

test('A3: the price floor is the 10th percentile of valid prices (a 2-shilling sale gives no "USh 2"); no doubled district label', () => {
  const rows = [{ id: 'a', listing_type: 'sale', price: 2, district: 'Kampala', canonical_location_id: 'kampala:kampala' }]
    .concat(Array.from({ length: 9 }, (_, i) => ({ id: `b${i}`, listing_type: 'sale', price: (i + 1) * 100e6, district: 'Kampala', canonical_location_id: 'kampala:kampala' })));
  const snapshot = seo.buildPublicSeoSnapshot(rows);
  assert.equal(snapshot.categoryPriceFloors.sale, 100e6);
  const meta = seo.categoryPageSeoMeta('/for-sale/kampala-kampala', snapshot);
  assert.doesNotMatch(meta.description, /USh 2\b/);
  assert.doesNotMatch(meta.title, /Kampala, Kampala/);
  const few = seo.buildPublicSeoSnapshot(rows.slice(0, 4));
  assert.equal(few.categoryPriceFloors.sale, 0, 'fewer than 5 valid prices: no floor');
});

test('A3: live pages: no "USh 2", no raw enums, no price in an out-of-bounds property title', async () => {
  const forSale = await (await get('/for-sale')).text();
  assert.doesNotMatch(forSale, /Prices start from USh 2\b/);
  const api = await (await get('/api/properties?listing_type=commercial&public_only=1&status=approved&limit=50')).text();
  assert.doesNotMatch(api, /_land|_retail|_industrial/);
  const detail = await (await get(`/property/${fixture.twoShilling}`)).text();
  assert.doesNotMatch(titleOf(detail) || '', /USh 2\b/);
});

// ---- A4 -------------------------------------------------------------------------

test('A4: robots has one Sitemap line; marketplace sitemap is 410', async () => {
  const robots = await (await get('/robots.txt')).text();
  assert.equal((robots.match(/^Sitemap:/gm) || []).length, 1);
  assert.doesNotMatch(robots, /marketplace-sitemap/);
  assert.equal((await get('/marketplace-sitemap.xml')).status, 410);
});

test('A4: every facet and commercial URL in the sitemap renders ≥ 3 listings through the page loader', async () => {
  const snapshot = await seo.loadPublicSeoInventorySnapshot(db, { force: true });
  __seoListingCache.clear();
  const urls = seo.sitemapEntries(snapshot, 'https://makaug.com')
    .map((entry) => entry.loc.replace('https://makaug.com', ''))
    .filter((p) => /^\/(?:for-sale|to-rent|land|commercial)\/[^/]+\/[^/]+$/.test(p));
  assert.ok(urls.length > 0, 'the fixture inventory produces facet URLs');
  for (const p of urls) {
    const landing = resolvePublicSeoLanding(p);
    assert.ok(landing, p);
    const listings = await loadPublicSeoListings(db, {
      categoryKey: landing.categoryKey, location: landing.location || null, facet: landing.facet || null, facetSlug: landing.facetSlug || '', limit: 24, force: true
    });
    const count = listings.length ? Number(listings[0].seo_total || listings.length) : 0;
    assert.ok(count >= SEO_FACET_MIN_LISTINGS, `${p} renders ${count}`);
  }
  for (const entry of seo.sitemapEntries(snapshot, 'https://makaug.com')) {
    if (!entry.loc.includes('/property/')) assert.equal(entry.lastmod, undefined, `${entry.loc} has no generation-time lastmod`);
  }
});

// ---- A5 -------------------------------------------------------------------------

test('A5: bare district slugs 301 to the canonical slug, keeping the query; unknown or ambiguous stays 404', async () => {
  for (const [from, to] of [
    ['/to-rent/kampala', '/to-rent/kampala-kampala'],
    ['/for-sale/wakiso?bedrooms=3', '/for-sale/wakiso-wakiso?bedrooms=3'],
    ['/for-sale/kira', '/for-sale/kira-wakiso'],
    ['/land/wakiso', '/land/wakiso-wakiso']
  ]) {
    const res = await get(from);
    assert.equal(res.status, 301, from);
    assert.equal(res.headers.get('location'), to, from);
  }
  assert.equal((await get('/for-sale/zzz-not-a-place')).status, 404);
  assert.equal((await get('/for-sale/muyenga')).status, 404, 'ambiguous (3 Muyenga nodes) stays 404');
});

// ---- A6 -------------------------------------------------------------------------

test('A6: landing copy on /for-sale, /land and /to-rent/kampala-kampala', async () => {
  const pages = {
    '/for-sale': { h1: 'Houses for sale in Uganda', body: 'Every listing, one search', faq: ['How many houses are for sale in Uganda on makaug?', 'Is makaug an estate agent?'] },
    '/land': { h1: 'Land for sale in Uganda', body: 'Compare plot prices by area', faq: ['How much does a plot cost in Uganda?', 'Does makaug sell the land?'] },
    '/to-rent/kampala-kampala': { h1: 'Houses for rent in Kampala', body: 'Rentals by area', faq: ['How many houses are for rent in Kampala?', 'Can I find a rental on WhatsApp?'] }
  };
  for (const [p, expected] of Object.entries(pages)) {
    const html = await (await get(p)).text();
    assert.match(html, new RegExp(`<h1[^>]*>${expected.h1}</h1>`), `${p} H1`);
    assert.ok(html.includes('data-landing-intro="1"'), `${p} intro`);
    assert.equal(html.split(expected.body).length - 1, 1, `${p} first body heading once`);
    for (const q of expected.faq) assert.ok(html.includes(q), `${p} FAQ ${q}`);
    const gridEnd = html.indexOf('data-landing-copy="1"');
    assert.ok(gridEnd > 0);
    assert.ok(html.indexOf('data-ssr-card') < gridEnd || !html.includes('data-ssr-card'), `${p}: body after the grid`);
    const intro = (html.match(/<p[^>]*data-landing-intro="1"[^>]*>[\s\S]*?<\/p>/) || [''])[0];
    const body = html.slice(gridEnd, html.indexOf('</section>', gridEnd));
    for (const part of [intro, body]) {
      assert.doesNotMatch(part.replace(/<[^>]+>/g, ' '), /[{}[\]]|UGX 0(?![.\d])|undefined|NaN/, `${p}: no raw tokens`);
    }
    assert.match(html, /"@type":"FAQPage"/, `${p} FAQPage JSON-LD`);
    const page2 = await (await get(`${p}?page=2`)).text();
    assert.ok(!page2.includes('data-landing-copy="1"'), `${p}?page=2 has no body`);
    assert.ok(page2.includes('data-landing-intro="1"'), `${p}?page=2 keeps the intro`);
  }
  const rent = await (await get('/to-rent/kampala-kampala')).text();
  assert.doesNotMatch(rent, /Landlord and Tenant Act|advance rent/i, 'advance-rent wording held back for the advocate');
  assert.ok(rent.includes('href="/to-rent/muyenga-kampala"'));
  const sale = await (await get('/for-sale')).text();
  assert.ok(sale.includes('href="/for-sale/kampala-kampala"'), 'All of Kampala uses the final URL');
});

test('A6: a sentence with a missing token is dropped, never printed with a gap', () => {
  const empty = seo.buildPublicSeoSnapshot([]);
  const copy = buildLandingCopy('sale', null, empty);
  assert.equal(copy.title, null, 'no count: fall back to the category title');
  assert.doesNotMatch(copy.introHtml + copy.bodyHtml, /UGX\s*(?:<\/strong>)?\s*(?:\.|,|in)|\(\s*\)|\{|\}/);
  assert.ok(copy.bodyHtml.includes('Every listing, one search'), 'token-free sentences remain');
  assert.equal(compactUgx(620e6), '620M');
  assert.equal(compactUgx(2.47e9), '2.47B');
  assert.equal(compactUgx(1.8e6), '1.8M');
  assert.equal(compactUgx(800e3), '800k');
});

// ---- A7 -------------------------------------------------------------------------

test('A7: thin table (photo × description)', () => {
  const long = Array.from({ length: 45 }, (_, i) => `word${i}`).join(' ');
  const short = 'Nice plot near the road.';
  const disclaimer = 'Land in Entebbe is a third-party property result found from X. Makaug provides a search and discovery preview using limited factual information only. Makaug has not verified ownership, availability, price.';
  const cases = [
    [{ foundOnline: true, hasRealPhoto: true, description: long, extra: { staff_corrected_fields: ['description'] } }, false],
    [{ foundOnline: true, hasRealPhoto: true, description: long, extra: { king_review_facts_confirmed: true } }, false],
    [{ foundOnline: true, hasRealPhoto: true, description: long, extra: { king_review_corrected_fields: ['description'] } }, false],
    [{ foundOnline: true, hasRealPhoto: true, description: long, extra: {} }, true],
    [{ foundOnline: true, hasRealPhoto: true, description: short, extra: { staff_corrected_fields: ['description'] } }, true],
    [{ foundOnline: true, hasRealPhoto: true, description: `${disclaimer} #land 0772123456 🏡`, extra: { staff_corrected_fields: ['description'] } }, true],
    [{ foundOnline: true, hasRealPhoto: false, description: long, extra: { staff_corrected_fields: ['description'] } }, true],
    [{ foundOnline: false, hasRealPhoto: false, description: '', extra: {} }, false]
  ];
  for (const [row, thin] of cases) assert.equal(isThinFoundOnlineListing(row), thin, JSON.stringify(row).slice(0, 120));
  assert.ok(meaningfulWordCount(disclaimer) < 10);
});

test('A7: a thin page is noindex,follow (header + meta) and out of the sitemap; an enriched one is indexable', async () => {
  const thin = await get(`/property/${fixture.thin}`);
  assert.equal(thin.status, 200);
  assert.match(thin.headers.get('x-robots-tag') || '', /noindex, follow/);
  assert.match(await thin.text(), /<meta name="robots" content="noindex,follow">/);
  const rich = await get(`/property/${fixture.rich}`);
  assert.equal(rich.status, 200);
  assert.doesNotMatch(rich.headers.get('x-robots-tag') || '', /noindex/);
  const snapshot = await seo.loadPublicSeoInventorySnapshot(db, { force: true });
  const locs = seo.sitemapEntries(snapshot, 'https://makaug.com').map((entry) => entry.loc);
  assert.ok(!locs.includes(`https://makaug.com/property/${fixture.thin}`), 'thin is not in the sitemap');
  assert.ok(locs.includes(`https://makaug.com/property/${fixture.rich}`), 'enriched is in the sitemap');
  assert.ok(snapshot.thinPropertyCount >= 1);
});
