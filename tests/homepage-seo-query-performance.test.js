'use strict';

process.env.COUNTRY_CODE = 'UG';
process.env.S3_PUBLIC_BASE_URL = 'https://media.makaug.com';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const seo = require('../services/publicSeoRenderService');

const fixtureSql = fs.readFileSync(path.join(__dirname, 'fixtures', 'homepage-seo-query-semantics.sql'), 'utf8');
const shell = '<html><head></head><body><div id="home-grid"></div><div id="detail-content"></div><footer></footer></body></html>';
const id = '00000000-0000-4000-8000-000000000001';
const rawRow = {
  id, listing_type: 'rent', title: '2-bedroom house for rent in Kyanja',
  description: 'A family home with a garden.', area: 'Kyanja', district: 'Kampala',
  price: 750000, price_period: 'mo', transaction_type: 'rent',
  bedrooms: 2, bathrooms: 1, property_type: 'house',
  copy_extra: {}, primary_image_url: 'https://media.makaug.com/front.jpg',
  created_at: '2026-10-08T00:00:00Z', updated_at: '2026-10-10T00:00:00Z', seo_total: 12
};

function fixtureQuery(kind) {
  const match = fixtureSql.match(new RegExp(`-- BEGIN ${kind} HOMEPAGE\\n([\\s\\S]+?)\\n-- END ${kind} HOMEPAGE`));
  assert.ok(match, `${kind} frozen SQL exists`);
  return match[1];
}

function normalized(sql) {
  return sql.replace(/\$1\b/g, '6').replace(/\s+/g, ' ').trim();
}

function captureDb(rows = [rawRow]) {
  const queries = [];
  return { queries, async query(sql, values) { queries.push({ sql, values }); return { rows }; } };
}

test.beforeEach(() => seo.clearSeoListingCache());

test('actual homepage query matches the read-only semantics fixture, and other pages count after the id page', async () => {
  const homeDb = captureDb();
  const home = await seo.loadPublicSeoListings(homeDb, { limit: 6, homepage: true });
  assert.equal(normalized(homeDb.queries[0].sql), normalized(fixtureQuery('NEW')));
  assert.deepEqual(homeDb.queries[0].values, [6]);
  assert.equal(home[0].id, id);
  assert.equal(home[0].title, '2-Bedroom house for rent in Kyanja');
  assert.equal(Object.hasOwn(home[0], 'seo_total'), false, 'no unused total is fabricated');

  const genericDb = captureDb();
  const generic = await seo.loadPublicSeoListings(genericDb, { limit: 6 });
  const genericSql = genericDb.queries[0].sql;
  assert.match(genericSql, /WITH page AS MATERIALIZED/);
  assert.match(genericSql, /COUNT\(\*\)::int AS seo_total/);
  assert.equal(genericSql.includes('COUNT(*) OVER()'), false);
  assert.equal(genericSql.includes('homepage_candidates'), false);
  assert.ok(genericSql.indexOf('WITH page AS MATERIALIZED') < genericSql.indexOf('LEFT JOIN LATERAL'));
  assert.deepEqual(genericDb.queries[0].values, [6]);
  assert.equal(generic[0].seo_total, 12);
});

test('homepage and generic callers have separate caches and preserve identical public card output', async () => {
  const db = captureDb();
  const home = await seo.loadPublicSeoListings(db, { limit: 6, homepage: true });
  const generic = await seo.loadPublicSeoListings(db, { limit: 6 });
  const { seo_total: total, ...genericCard } = generic[0];
  assert.equal(total, 12);
  assert.deepEqual(home[0], genericCard);
  assert.equal(home[0].primary_image_url, 'https://media.makaug.com/front.jpg');
  const homeHtml = seo.renderHomepageSeoHtml(shell, { listings: home, baseUrl: 'https://makaug.com' }).html;
  const genericHtml = seo.renderHomepageSeoHtml(shell, { listings: generic, baseUrl: 'https://makaug.com' }).html;
  assert.equal(homeHtml, genericHtml);
  assert.ok(homeHtml.includes(`href="/property/${id}"`));
  assert.ok(homeHtml.includes('src="https://media.makaug.com/front.jpg"'));
  assert.ok(homeHtml.includes('2-Bedroom house for rent in Kyanja'));
  assert.deepEqual(await seo.loadPublicSeoListings(db, { limit: 6, homepage: true }), home);
  assert.deepEqual(await seo.loadPublicSeoListings(db, { limit: 6 }), generic);
  assert.equal(db.queries.length, 2, 'both cache entries are served without another query');
});

test('category and facet callers keep exact totals even if a homepage flag is passed accidentally', async () => {
  const db = captureDb();
  const rows = await seo.loadPublicSeoListings(db, { categoryKey: 'rent', limit: 6, homepage: true });
  assert.equal(rows[0].seo_total, 12);
  assert.ok(db.queries[0].sql.includes('COUNT(*)::int AS seo_total'));
  assert.ok(db.queries[0].sql.includes("LOWER(COALESCE(p.listing_type, '')) = 'rent'"));
  assert.equal(db.queries[0].sql.includes('homepage_candidates'), false);
  const facetDb = captureDb();
  const facetRows = await seo.loadPublicSeoListings(facetDb, {
    limit: 6, homepage: true, facet: { kind: 'bedrooms', value: 2 }
  });
  assert.equal(facetRows[0].seo_total, 12);
  assert.ok(facetDb.queries[0].sql.includes('COUNT(*)::int AS seo_total'));
  assert.ok(facetDb.queries[0].sql.includes('AND p.bedrooms = $1'));
  assert.deepEqual(facetDb.queries[0].values, [2, 6]);
  assert.equal(facetDb.queries[0].sql.includes('homepage_candidates'), false);
});

test('an expired homepage cache still serves its cards immediately while coalescing one refresh', async () => {
  const homeKey = 'all:uganda:all:6:homepage';
  const cachedRows = [{ id, title: 'Last-known-good home' }];
  seo.__seoListingCache.set(homeKey, { rows: cachedRows }, Date.now() - seo.SEO_LISTING_CACHE_TTL_MS - 1);
  let resolveRefresh;
  const gate = new Promise(resolve => { resolveRefresh = resolve; });
  let queryCount = 0;
  const db = { async query() { queryCount += 1; await gate; return { rows: [rawRow] }; } };
  const loads = Promise.all([
    seo.loadPublicSeoListings(db, { limit: 6, homepage: true }),
    seo.loadPublicSeoListings(db, { limit: 6, homepage: true })
  ]);
  const result = await Promise.race([loads, new Promise(resolve => setTimeout(() => resolve('blocked'), 40))]);
  assert.deepEqual(result, [cachedRows, cachedRows]);
  assert.equal(queryCount, 1);
  const pending = seo.__seoListingCache.inFlight(homeKey);
  resolveRefresh();
  await pending;
  const updated = await seo.loadPublicSeoListings(db, { limit: 6, homepage: true });
  assert.equal(updated[0].title, '2-Bedroom house for rent in Kyanja');
  assert.equal(Object.hasOwn(updated[0], 'seo_total'), false);
  assert.equal(queryCount, 1);
});

test('SSR detail uses the shared gallery box and stable escaped image/ancestor markers, retaining metadata', () => {
  const listing = { ...seo.normalizeSeoListingRow(rawRow), title: 'Home & garden "Kyanja"', primary_image_url: 'https://media.makaug.com/front.jpg?v=1&size=900' };
  const out = seo.renderPropertySeoHtml(shell, listing, { baseUrl: 'https://makaug.com' });
  assert.ok(out.html.includes(`data-ssr-property-detail="${id}" data-detail-layout`));
  assert.ok(out.html.includes('class="lg:col-span-2" data-detail-main'));
  assert.ok(out.html.includes('data-detail-card'));
  assert.ok(out.html.includes('class="block w-full property-gallery-hero relative overflow-hidden group" data-detail-hero'));
  assert.ok(out.html.includes(`id="detail-gallery-hero-img" data-ssr-detail-hero="${id}"`));
  assert.ok(out.html.includes('src="https://media.makaug.com/front.jpg?v=1&amp;size=900"'));
  assert.ok(out.html.includes('alt="Home &amp; garden &quot;Kyanja&quot;"'));
  assert.ok(out.html.includes('width="1200" height="675" loading="eager" decoding="async" fetchpriority="high"'));
  assert.equal(out.meta.canonical, `https://makaug.com/property/${id}`);
  assert.equal(out.structuredData['@graph'][1].image, listing.primary_image_url);
});
