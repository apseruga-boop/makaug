'use strict';

/**
 * S2: the homepage tells search engines who "makaug" is (it was being read as
 * "MAKAUT"): Organization + WebSite JSON-LD with alternate names, logo, sameAs
 * and a contact point, a title that starts with the brand, and a visible
 * eyebrow. Uganda only: other tenants keep their own values.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { renderHomepageSeoHtml } = require('../services/publicSeoRenderService');

const SAME_AS = [
  'https://www.instagram.com/makaugcom',
  'https://www.tiktok.com/@makaug.com',
  'https://www.linkedin.com/company/makaug-com',
  'https://www.youtube.com/@makaugproperty',
  'https://x.com/makauganda'
];

function homepageGraph() {
  const { structuredData } = renderHomepageSeoHtml('<section id="home-grid"></section><footer></footer>', { listings: [], snapshot: null, baseUrl: 'https://makaug.com/' });
  // Round-trip through JSON the way the page serialises it.
  const parsed = JSON.parse(JSON.stringify(structuredData));
  return parsed['@graph'];
}

test('Organization has the brand entity: name, alternate names, logo, sameAs, contact point', () => {
  const org = homepageGraph().find((node) => node['@type'] === 'Organization');
  assert.strictEqual(org['@id'], 'https://makaug.com/#organization');
  assert.strictEqual(org.name, 'makaug');
  assert.deepStrictEqual(org.alternateName, ['makaug.com', 'MakaUG']);
  assert.strictEqual(org.url, 'https://makaug.com/');
  assert.strictEqual(org.logo, 'https://makaug.com/assets/icons/makaug-icon-512.png');
  assert.ok(fs.existsSync(path.join(root, 'assets/icons/makaug-icon-512.png')), 'the logo file exists');
  assert.deepStrictEqual(org.sameAs, SAME_AS);
  assert.deepStrictEqual(org.contactPoint, {
    '@type': 'ContactPoint',
    telephone: '+256780863394',
    contactType: 'customer service',
    areaServed: 'UG',
    availableLanguage: ['en', 'lg', 'sw']
  });
});

test('WebSite points at the Organization and keeps the search action', () => {
  const site = homepageGraph().find((node) => node['@type'] === 'WebSite');
  assert.strictEqual(site['@id'], 'https://makaug.com/#website');
  assert.strictEqual(site.name, 'makaug');
  assert.deepStrictEqual(site.alternateName, ['makaug.com', 'MakaUG']);
  assert.deepStrictEqual(site.publisher, { '@id': 'https://makaug.com/#organization' });
  assert.match(site.potentialAction.target, /\/for-sale\?area=\{search_term_string\}/);
});

test('the homepage title starts with the brand', () => {
  const server = read('server.js');
  const match = server.match(/: 'makaug: ([^']+)',/);
  assert.ok(match, 'the Uganda homepage title is set in server.js');
  const title = `makaug: ${match[1]}`;
  assert.strictEqual(title, 'makaug: Houses for Sale & Rent and Land in Uganda | makaug.com');
  assert.ok(title.length <= 65, `title is ${title.length} chars`);
});

test('a South Africa render has no makaug values', () => {
  const script = `
    const r = require('./services/publicSeoRenderService');
    const out = r.renderHomepageSeoHtml('<section id="home-grid"></section><footer></footer>', { listings: [], snapshot: null, baseUrl: 'https://seshaikhaya.com/' });
    process.stdout.write(JSON.stringify(out.structuredData));
  `;
  const stdout = execFileSync(process.execPath, ['-e', script], {
    cwd: root,
    env: { ...process.env, COUNTRY_CODE: 'ZA', DATABASE_URL: '' },
    encoding: 'utf8'
  });
  const json = stdout.slice(stdout.indexOf('{"@context"'));
  assert.ok(json.length > 10, 'rendered JSON-LD');
  assert.ok(!/makaug|makauganda|\+256|MakaUG/i.test(json), `no Uganda brand values in: ${json.slice(0, 300)}`);
  const graph = JSON.parse(json)['@graph'];
  assert.ok(!graph.some((node) => node.sameAs || node.contactPoint || node.alternateName));
});

test('the visible brand eyebrow sits above the H1, and the footer links X', () => {
  for (const file of ['index.html', 'packages/shared-country-core/components/hero-search.html']) {
    const html = read(file);
    const eyebrow = html.indexOf('id="hero-brand-eyebrow"');
    const h1 = html.indexOf('<h1 id="hero-title"');
    assert.ok(eyebrow > 0 && eyebrow < h1, `${file}: eyebrow above the H1`);
    assert.match(html.slice(eyebrow, eyebrow + 260), />makaug\.com<\/p>/);
  }
  for (const file of ['index.html', 'packages/shared-country-core/components/footer.html']) {
    assert.match(read(file), /href="https:\/\/x\.com\/makauganda"[^>]*aria-label="X"/, `${file} links X`);
  }
});
