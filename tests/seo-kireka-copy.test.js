'use strict';

process.env.COUNTRY_CODE = 'UG';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildLandingCopy, landingCopyForPage } = require('../services/publicLandingCopy');
const { categoryPageSeoMeta, locationForRouteSlug } = require('../services/publicSeoService');
const { renderCategorySeoHtml } = require('../services/publicSeoRenderService');

const root = path.resolve(__dirname, '..');
const kireka = locationForRouteSlug('kireka-wakiso');
const route = '/to-rent/kireka-wakiso';
const shell = '<section id="page-rent"><h1>To Rent</h1><div id="rent-grid"></div></section><footer></footer>';

function inventory(count = 24, prices = []) {
  return {
    categoryTotals: { rent: count + 900 },
    counts: { rent: new Map([['wakiso:kireka', count], ['wakiso:wakiso', count + 500]]) },
    directCounts: { rent: new Map([['wakiso:kireka', count]]) },
    locationValidPrices: { rent: new Map([['wakiso:kireka', prices]]) }
  };
}

function render(snapshot, options) {
  const originalMeta = categoryPageSeoMeta(route, snapshot, 'https://makaug.com');
  const copy = buildLandingCopy('rent', kireka, snapshot, options);
  const meta = {
    ...originalMeta,
    title: copy.title || originalMeta.title,
    description: copy.description || originalMeta.description,
    h1: copy.h1,
    landingIntroHtml: copy.introHtml,
    landingBodyHtml: copy.bodyHtml,
    landingFaq: copy.faqStructuredData
  };
  return { originalMeta, copy, meta, ...renderCategorySeoHtml(shell, { meta, snapshot, listings: [], baseUrl: 'https://makaug.com' }) };
}

test('the existing Kireka rental page keeps its title and canonical, with exact-area inventory', () => {
  assert.equal(kireka.canonical_key, 'wakiso:kireka');
  const { html, meta, originalMeta, copy, structuredData } = render(inventory());
  assert.equal(meta.title, originalMeta.title);
  assert.equal(copy.rankListings, false, 'new copy keeps ordinary area-page listing order');
  assert.equal(meta.canonical, 'https://makaug.com/to-rent/kireka-wakiso');
  assert.match(html, /<h1\b[^>]*>Houses for rent in Kireka, Wakiso<\/h1>/);
  assert.match(html, /currently has <strong>24<\/strong> public rental listings/);
  assert.doesNotMatch(copy.introHtml, /924|524/);
  assert.ok(copy.description.toLowerCase().startsWith('houses for rent in kireka'));
  assert.ok(copy.description.length <= 160);
  assert.ok(html.indexOf('data-landing-copy="1"') > html.indexOf('id="rent-grid"'), 'guidance survives grid replacement');
  assert.deepEqual(structuredData['@graph'].find((item) => item['@type'] === 'FAQPage'), copy.faqStructuredData);
  const collection = structuredData['@graph'].find((item) => item['@type'] === 'CollectionPage');
  assert.equal(collection.url, meta.canonical);
  assert.equal(collection.name, copy.h1);
});

test('missing prices never produce sample prices or a made-up monthly average', () => {
  for (const snapshot of [null, inventory(24), inventory(24, [800000, 900000, 1200000, 1800000, 9000000])]) {
    const copy = buildLandingCopy('rent', kireka, snapshot);
    const html = copy.introHtml + copy.bodyHtml;
    assert.doesNotMatch(html, /UGX|USh|median|average rent|\{\w+\}|guaranteed|verified ownership|checked before/i);
    assert.match(html, /quoted per month, week or year/);
    assert.match(html, /deposit, advance rent and agent fee/);
    assert.match(html, /confirm which utility or service charges are included/);
    if (snapshot === null) assert.doesNotMatch(html, /currently has|current Kireka inventory has/);
  }
});

test('sparse and empty inventories keep useful guidance without overstating available homes', () => {
  for (const count of [0, 1, 2]) {
    const { copy, html } = render(inventory(count));
    assert.match(html, /Arrange a viewing in Kireka/);
    assert.match(html, /check the authority of the person offering the rental/);
    assert.doesNotMatch(html, /\{\w+\}|UGX 0|hundreds|cheapest|most rentals/);
    if (count === 0) assert.doesNotMatch(copy.introHtml, /currently has/);
    else assert.match(copy.introHtml, new RegExp(`currently has <strong>${count}<\\/strong> public rental ${count === 1 ? 'listing\\.' : 'listings\\.'}`));
  }
});

test('the page links established rental hubs and safety checks without creating a second Kireka URL', () => {
  const { copy } = render(inventory());
  const hrefs = [...copy.bodyHtml.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(hrefs)].sort(), ['/safety', '/to-rent', '/to-rent/kampala-kampala', '/to-rent/wakiso-wakiso']);
  assert.doesNotMatch(copy.bodyHtml, /href="\/to-rent\/kireka(?:\/|"|\?)/);
  assert.ok(copy.faqStructuredData.mainEntity.every((item) => item.acceptedAnswer.text && !/[<>]/.test(item.acceptedAnswer.text)));
});

test('page two keeps the area intro but omits repeated guidance and FAQ schema', () => {
  const { html, copy, structuredData } = render(inventory(), { page: '2' });
  assert.match(html, /data-landing-intro="1"/);
  assert.doesNotMatch(html, /data-landing-copy="1"|Frequently asked questions/);
  assert.equal(copy.bodyHtml, '');
  assert.equal(copy.faqStructuredData, null);
  assert.ok(!structuredData['@graph'].some((item) => item['@type'] === 'FAQPage'));
});

test('Kireka guidance applies only to its Uganda rent page', () => {
  assert.equal(landingCopyForPage('sale', kireka), null);
  assert.equal(landingCopyForPage('students', kireka), null);
  assert.equal(landingCopyForPage('rent', locationForRouteSlug('kira-wakiso')), null);
  const script = `
    const { buildLandingCopy } = require('./services/publicLandingCopy');
    process.stdout.write(JSON.stringify(buildLandingCopy('rent', { canonical_key: 'wakiso:kireka' }, null)));
  `;
  for (const country of ['ZA', 'KE', 'RW', 'CD']) {
    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: root,
      env: { ...process.env, COUNTRY_CODE: country, DATABASE_URL: '' },
      encoding: 'utf8'
    });
    assert.equal(output.trim(), 'null', `${country} does not receive Uganda rental copy`);
  }
});
