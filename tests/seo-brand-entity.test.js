'use strict';

/**
 * The public Uganda pages identify the same MakaUG business while retaining
 * the homepage WebSite and each route's structured data.
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
  'https://x.com/makauganda',
  'https://www.instagram.com/makaugcom',
  'https://www.tiktok.com/@makaug.com',
  'https://www.linkedin.com/company/makaug-com',
  'https://www.youtube.com/@makaugproperty',
  'https://maps.app.goo.gl/UU4x3shUvyU4jnaV8'
];

function homepageGraph() {
  const { structuredData } = renderHomepageSeoHtml('<section id="home-grid"></section><footer></footer>', { listings: [], snapshot: null, baseUrl: 'https://makaug.com/' });
  // Round-trip through JSON the way the page serialises it.
  const parsed = JSON.parse(JSON.stringify(structuredData));
  return parsed['@graph'];
}

test('Organization has the brand entity: name, alternate names, logo, sameAs, contact point', () => {
  const org = homepageGraph().find((node) => [].concat(node['@type']).includes('Organization'));
  assert.deepStrictEqual(org['@type'], ['Organization', 'RealEstateAgent']);
  assert.strictEqual(org['@id'], 'https://makaug.com/#organization');
  assert.strictEqual(org.name, 'MakaUG');
  assert.deepStrictEqual(org.alternateName, ['makaug.com', 'MakaUG']);
  assert.strictEqual(org.url, 'https://makaug.com');
  assert.strictEqual(org.logo, 'https://makaug.com/assets/icons/makaug-mark.svg');
  assert.ok(fs.existsSync(path.join(root, 'assets/icons/makaug-mark.svg')), 'the logo file exists');
  assert.strictEqual(org.telephone, '+256780863394');
  assert.deepStrictEqual(org.areaServed, ['Kampala', 'Wakiso', 'Entebbe', 'Mukono', 'Uganda']);
  assert.deepStrictEqual(org.parentOrganization, { '@type': 'Organization', name: 'WHISPERS GLOBAL LTD' });
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
  assert.strictEqual(site.name, 'MakaUG');
  assert.deepStrictEqual(site.alternateName, ['makaug.com', 'MakaUG']);
  assert.deepStrictEqual(site.publisher, { '@id': 'https://makaug.com/#organization' });
  assert.match(site.potentialAction.target, /\/for-sale\?area=\{search_term_string\}/);
});

test('public route schemas retain their nodes and one canonical MakaUG organization', () => {
  const { mergePublicOrganizationSchema } = require('../services/publicOrganizationSchema');
  const staleOrganization = { '@type': 'Organization', '@id': 'https://makaug.com/#organization', name: 'Old name' };
  const website = { '@type': 'WebSite', publisher: { '@id': staleOrganization['@id'] } };
  const listing = { '@type': 'RealEstateListing', '@id': 'https://makaug.com/property/example', name: 'A property' };
  const routeData = { '@context': 'https://schema.org', '@graph': [staleOrganization, website, listing, staleOrganization] };
  const original = JSON.stringify(routeData);
  const merged = mergePublicOrganizationSchema(routeData);
  assert.strictEqual(merged['@context'], 'https://schema.org');
  assert.strictEqual(merged['@graph'].filter((node) => node['@id'] === staleOrganization['@id']).length, 1);
  assert.deepStrictEqual(merged['@graph'].slice(1), [website, listing]);
  assert.strictEqual(merged['@graph'][0].name, 'MakaUG');
  assert.deepStrictEqual(merged['@graph'][0]['@type'], ['Organization', 'RealEstateAgent']);
  assert.deepStrictEqual(merged['@graph'][0].sameAs, SAME_AS);
  assert.deepStrictEqual(mergePublicOrganizationSchema(merged), merged, 'repeated metadata patching does not duplicate the organization');
  assert.strictEqual(JSON.stringify(routeData), original, 'route data is not mutated');
});

test('public pages without a route graph still receive the same brand schema', () => {
  const { publicOrganizationNode, mergePublicOrganizationSchema } = require('../services/publicOrganizationSchema');
  assert.deepStrictEqual(mergePublicOrganizationSchema(null), {
    '@context': 'https://schema.org',
    '@graph': [publicOrganizationNode()]
  });
  const routeData = { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Search results' };
  const merged = mergePublicOrganizationSchema(routeData);
  assert.strictEqual(merged['@graph'].length, 2);
  assert.deepStrictEqual(merged['@graph'][1], routeData);
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
    const s = require('./services/publicOrganizationSchema');
    if (s.publicOrganizationNode() !== null) throw new Error('Unexpected Uganda organization');
    if (s.mergePublicOrganizationSchema(null) !== null) throw new Error('Unexpected Uganda default graph');
    if (s.mergePublicOrganizationSchema(out.structuredData) !== out.structuredData) throw new Error('Unexpected non-Uganda graph change');
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
