'use strict';

/**
 * S1: finish the three money pages (/for-sale, /land, /to-rent/kampala-kampala).
 * No database needed: copy, links and SQL text are checked directly.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const { buildLandingCopy } = require('../services/publicLandingCopy');
const { canonicalLocationRouteSlug, locationForRouteSlug } = require('../services/publicSeoService');
const render = require('../services/publicSeoRenderService');
const { agentFirstOrderSql } = require('../utils/agentFirstRank');

const kampala = locationForRouteSlug('kampala-kampala');
const PAGES = [
  { key: 'sale', location: null, phrase: 'houses for sale in uganda', route: '/for-sale' },
  { key: 'land', location: null, phrase: 'land for sale in uganda', route: '/land' },
  { key: 'rent', location: kampala, phrase: 'houses for rent in kampala', route: '/to-rent/kampala-kampala' }
];
// A big count so the length check uses the longest realistic number.
const rentCounts = new Map([['kampala:kampala', 12345]]);
const snapshot = { categoryTotals: { sale: 12345, land: 12345, rent: 12345 }, counts: { rent: rentCounts }, directCounts: { rent: rentCounts } };

function landing(page) {
  const copy = buildLandingCopy(page.key, page.location, snapshot, {});
  assert.ok(copy, `${page.route} has landing copy`);
  return copy;
}

test('each description opens with its exact phrase and stays within 160 characters', () => {
  for (const page of PAGES) {
    const { description } = landing(page);
    assert.ok(description.toLowerCase().startsWith(page.phrase), `${page.route}: "${description}"`);
    assert.ok(description.length <= 160, `${page.route} description is ${description.length} chars`);
  }
});

test('each hub links Kampala, Wakiso, Kira, Entebbe and Mukono, all on canonical URLs', () => {
  const needed = { sale: 'for-sale', land: 'land', rent: 'to-rent' };
  for (const page of PAGES) {
    const html = landing(page).bodyHtml;
    const hrefs = [...html.matchAll(/href="(\/(?:for-sale|land|to-rent)\/[^"]+)"/g)].map((m) => m[1]);
    for (const href of hrefs) {
      const slug = href.split('/').pop();
      const location = locationForRouteSlug(slug);
      assert.ok(location, `${page.route}: ${href} is a known location`);
      assert.strictEqual(canonicalLocationRouteSlug(location), slug, `${href} is the canonical slug, not an alias that 301s`);
    }
    const base = `/${needed[page.key]}`;
    const wanted = [`${base}/kira-wakiso`, `${base}/entebbe-wakiso`, `${base}/wakiso-wakiso`, `${base}/mukono-mukono`];
    if (page.key !== 'rent') wanted.push(`${base}/kampala-kampala`);
    for (const href of wanted) assert.ok(hrefs.includes(href), `${page.route} links ${href}`);
  }
});

test('the rent hub is itself the Kampala page', () => {
  assert.strictEqual(canonicalLocationRouteSlug(kampala), 'kampala-kampala');
});

test('landing pages list agent-listed rows first, and the flag is part of the cache key', async () => {
  const queries = [];
  const db = { async query(sql) { queries.push(sql); return { rows: [] }; } };
  const location = locationForRouteSlug('namugongo-wakiso');
  await render.loadPublicSeoListings(db, { categoryKey: 'sale', location, limit: 24 });
  await render.loadPublicSeoListings(db, { categoryKey: 'sale', location, limit: 24, landingRank: true });
  assert.strictEqual(queries.length, 2, 'the ranked list does not reuse the unranked cache entry');
  assert.ok(!/agent_id IS NOT NULL/.test(queries[0]), 'other pages keep updated_at order');
  const ranked = queries[1];
  const agentAt = ranked.indexOf("agent_id IS NOT NULL OR LOWER(COALESCE(p.lister_type, '')) = 'agent'");
  const landAt = ranked.indexOf("'(^|[^a-z])(land|plot|plots)([^a-z]|$)'");
  const updatedAt = ranked.indexOf('p.updated_at DESC', ranked.indexOf('ORDER BY'));
  assert.ok(agentAt > 0 && landAt > agentAt && updatedAt > landAt, 'agent rank, then houses before land, then updated_at');
  await render.loadPublicSeoListings(db, { categoryKey: 'sale', location, limit: 24, landingRank: true });
  assert.strictEqual(queries.length, 2, 'a repeat is served from the cache');
});

test('land and rent landing pages rank agents first but do not demote land (that is /for-sale only)', async () => {
  const queries = [];
  const db = { async query(sql) { queries.push(sql); return { rows: [] }; } };
  await render.loadPublicSeoListings(db, { categoryKey: 'land', location: locationForRouteSlug('gayaza-wakiso'), limit: 24, landingRank: true });
  assert.ok(/agent_id IS NOT NULL/.test(queries[0]));
  assert.ok(!/plots/.test(queries[0]), 'no land-after-houses term');
});

test('server.js asks for 24 ranked cards on the landing pages only', () => {
  const server = read('server.js');
  assert.match(server, /limit: landing \? 24 : 12,\s*landingRank: Boolean\(landing\)/);
});

test('agent_first sorts exist on the API and use the shared SQL', () => {
  const props = read('routes/properties.js');
  assert.match(props, /agent_first: agentFirstOrderSql\('p'\)/);
  assert.match(props, /agent_first_homes: agentFirstOrderSql\('p', \{ homesBeforeLand: true \}\)/);
  assert.ok(agentFirstOrderSql('p').includes("= 'agent'"));
});

function loadClientRanking() {
  const app = read('assets/makaug-app.js');
  const start = app.indexOf('// The three money pages (/for-sale, /land, /to-rent/kampala-kampala) list');
  const end = app.indexOf('function getPropertyDetailPath');
  assert.ok(start > 0 && end > start);
  const originStart = app.indexOf('function publicListingOrigin(');
  const originFn = app.slice(originStart, app.indexOf('\n}\n', originStart) + 3);
  const context = {
    window: { location: { pathname: '/for-sale' } },
    isFoundOnlineListing: (p) => p.third_party_discovery_result === true,
    listingSourceMeta: () => ({ key: 'private' }),
    listingTimeValue: (p) => Date.parse(p.updated_at || 0)
  };
  vm.createContext(context);
  vm.runInContext(`${originFn}\n${app.slice(start, end)}\nthis.api = { publicDefaultListingComparator, publicMoneyPageSort };`, context);
  return { api: context.api, context };
}

test('the client keeps the server order: agent rows before found-online rows, houses before land on /for-sale', () => {
  const { api, context } = loadClientRanking();
  const rows = [
    { id: 'f1', third_party_discovery_result: true, updated_at: '2026-10-09', property_type: 'house' },
    { id: 'l1', listing_origin: 'agent', agent_id: 'a1', updated_at: '2026-10-01', property_type: 'land' },
    { id: 'o1', listing_origin: 'private', updated_at: '2026-10-05', property_type: 'house' },
    { id: 'a1', listing_origin: 'agent', agent_id: 'a2', updated_at: '2026-10-02', property_type: 'house' },
    { id: 'a2', listing_origin: 'agent', agent_id: 'a3', updated_at: '2026-10-08', property_type: 'apartment' }
  ];
  context.window.location.pathname = '/for-sale';
  assert.strictEqual(api.publicMoneyPageSort('sale'), 'agent_first_homes');
  assert.deepStrictEqual(rows.slice().sort(api.publicDefaultListingComparator('sale')).map((r) => r.id), ['a2', 'a1', 'l1', 'o1', 'f1']);
  context.window.location.pathname = '/land';
  assert.strictEqual(api.publicMoneyPageSort('land'), 'agent_first');
  context.window.location.pathname = '/to-rent/kampala-kampala';
  assert.strictEqual(api.publicMoneyPageSort('rent'), 'agent_first');
  context.window.location.pathname = '/to-rent';
  assert.strictEqual(api.publicMoneyPageSort('rent'), '', 'other pages keep newest-first');
});

test('the homepage HTML and the footer carry all three anchors', () => {
  const shell = '<main><section id="home-grid"><p>old</p></section></main><footer><p>f</p></footer>';
  const { html } = render.renderHomepageSeoHtml(shell, { listings: [], snapshot: null, baseUrl: 'https://makaug.com/' });
  for (const [href, label] of [
    ['/for-sale', 'Houses for Sale in Uganda'],
    ['/land', 'Land for Sale in Uganda'],
    ['/to-rent/kampala-kampala', 'Houses for Rent in Kampala']
  ]) {
    assert.ok(html.includes(`<a href="${href}"`) && html.includes(`>${label}</a>`), `homepage links ${href}`);
    const footer = read('index.html');
    assert.ok(footer.includes(`href="${href}"`) && footer.includes(`>${label}</a>`), `footer links ${href}`);
  }
  const homepageRentLinks = (html.match(/href="\/to-rent\/kampala-kampala"/g) || []).length
    + (read('index.html').match(/id="footer-link-rent-kampala" href="\/to-rent\/kampala-kampala"/g) || []).length;
  assert.ok(homepageRentLinks >= 2, 'the rent page is linked from the popular searches and the footer');
});

test('the footer i18n strings match the anchors, so the JS does not overwrite them', () => {
  const app = read('assets/makaug-app.js');
  assert.match(app, /sale: "Houses for Sale in Uganda"/);
  assert.match(app, /land: "Land for Sale in Uganda"/);
  assert.match(app, /rentKampala: "Houses for Rent in Kampala"/);
  assert.match(app, /setTextById\("footer-link-rent-kampala", footerTr\("rentKampala"\)\)/);
});

test('the built bundles carry the new client code', () => {
  assert.ok(read('assets/build/makaug-app.min.js').includes('agent_first_homes'));
  assert.ok(read('assets/build/makaug-app.min.js').includes('footer-link-rent-kampala'));
});
