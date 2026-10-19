'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('assets/makaug-app.js');
const html = read('index.html');
const properties = read('routes/properties.js');
const seo = require('../services/publicSeoRenderService');
const roads = require('../utils/ugandaLocationRegistry');
const { stripRoadNamePhrases } = require('../routes/staff')._test;
const { addCanonicalLocationSearchFilter, compactPublicCardRow } = require('../routes/properties')._test;

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start > 0, name);
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end > start ? end : undefined);
}

test('search cards use the property page lister order: agent, then agency, then lister type', () => {
  const card = compactPublicCardRow({
    id: '11111111-1111-4111-8111-111111111111',
    listing_type: 'land',
    title: 'Kitende plot',
    property_type: 'plot',
    area: 'Kitende',
    district: 'Wakiso',
    price: 35000000,
    status: 'approved',
    agent_id: '22222222-2222-4222-8222-222222222222',
    agent_name: 'Segawa Frederick Kevin SFK',
    agent_company: 'SFK Homes',
    lister_name: 'Segawa Frederick Kevin SFK',
    lister_type: 'agent',
    listed_by: 'agent'
  });
  assert.equal(card.agent_name, 'Segawa Frederick Kevin SFK');
  assert.equal(card.agent_company, 'SFK Homes');
  assert.equal(card.lister_type, 'agent');
  assert.equal(card.agent_id, '22222222-2222-4222-8222-222222222222');

  const attribution = extractFunction(app, 'publicListerAttribution');
  assert.match(attribution, /resolvedBroker\?\.name \|\| p\?\.agent_name/);
  assert.match(attribution, /p\?\.agent_company/);
  assert.match(attribution, /lister_type \|\| p\?\.listed_by/);
  assert.match(attribution, /translateListingLabel\("Agent"\)/);
  assert.match(extractFunction(app, 'propCard'), /publicListerAttribution\(p, broker\)/);
  assert.match(app, /const ownerDisplayName = publicListerAttribution\(p, broker\)/);
  assert.match(properties, /a\.full_name AS agent_name/);
  assert.match(properties, /a\.company_name AS agent_company/);
  assert.match(properties, /p\.lister_type/);
});

test('an agent card does not say Private Owner when only the agency or lister type is known', () => {
  const attribution = extractFunction(app, 'publicListerAttribution');
  const fn = new Function(`
    function findBrokerById() { return null; }
    function translateListingLabel(value) { return value; }
    ${attribution}
    return publicListerAttribution;
  `)();
  assert.equal(fn({
    agent_name: 'Segawa Frederick Kevin SFK',
    agent_company: 'SFK Homes',
    lister_type: 'agent',
    listed_by: 'agent'
  }), 'Segawa Frederick Kevin SFK');
  assert.equal(fn({
    agent_company: 'SFK Homes',
    lister_type: 'agent',
    listed_by: 'agent'
  }), 'SFK Homes');
  assert.equal(fn({
    lister_type: 'agent',
    listed_by: 'agent',
    lister_name: 'Segawa Frederick Kevin SFK'
  }), 'Segawa Frederick Kevin SFK');
  assert.equal(fn({ lister_type: 'agent', listed_by: 'agent' }), 'Agent');
  assert.equal(fn({ lister_type: 'owner', listed_by: 'private' }), 'Private Owner');
});

test('the to-rent page does not show an N properties found count', () => {
  const rentPage = html.slice(html.indexOf('id="page-rent"'), html.indexOf('id="page-students"'));
  assert.doesNotMatch(rentPage, /id="rent-count"/);
  assert.doesNotMatch(rentPage, /properties found/);
  const landPage = html.slice(html.indexOf('id="page-land"'), html.indexOf('id="page-brokers"'));
  assert.doesNotMatch(landPage, /properties found/);
  assert.match(extractFunction(app, 'ensurePublicResultsHeader'), /countId && key !== "rent"/);
});

test('a land or plot page title, H1 and og:title never say house', () => {
  const plot = {
    id: '33333333-3333-4333-8333-333333333333',
    listing_type: 'land',
    property_type: 'plot',
    title: 'house for Sale',
    title_reviewed: true,
    seo_title: 'house for Sale in Gayaza',
    extra_fields: { seo_title: 'house for Sale in Gayaza' },
    area: 'Gayaza',
    district: 'Wakiso',
    price: 40000000
  };
  assert.equal(seo.publicTitleContradictsListingType(plot), true);
  assert.equal(seo.publicTypeNoun(plot), 'Plot');
  const title = seo.propertySeoTitle(plot);
  assert.match(title, /Plot for Sale in Gayaza, Wakiso — UGX 40M \| makaug\.com/);
  assert.doesNotMatch(title, /\bhouse\b/i);
  const rendered = seo.renderPropertySeoHtml('<html><head><title>x</title></head><body><div id="detail-content"></div><footer></footer></body></html>', plot, { baseUrl: 'https://makaug.com' });
  assert.match(rendered.html, /<h1[^>]*>Plot for Sale in Gayaza, Wakiso<\/h1>/);
  assert.doesNotMatch(rendered.html, /<h1[^>]*>[^<]*house/i);
  assert.equal(rendered.meta.title, title);
  const house = seo.propertySeoTitle({
    listing_type: 'sale',
    property_type: 'house',
    bedrooms: 5,
    area: 'Naalya',
    district: 'Wakiso',
    price: 1100000000
  });
  assert.equal(house, '5bdrm house for Sale in Naalya, Wakiso — UGX 1.1B | makaug.com');
  assert.match(app, /function publicTitleContradictsType/);
  assert.match(app, /function generatedTypeHeadingForTitle/);
});

test('the stale house-title report is read-only and is not executed here', () => {
  const script = read('scripts/report-stale-house-titles.js');
  assert.match(script, /listing_type = 'land'/);
  assert.match(script, /extra_fields->>'seo_title'/);
  assert.match(script, /function assertReadOnly/);
  assert.doesNotMatch(script, /\b(UPDATE|DELETE|INSERT)\b/);
  assert.match(read('package.json'), /inventory:report-stale-house-titles/);
});

test('Entebbe Road and the other main roads search the areas along them', () => {
  const entebbe = roads.mainRoadCorridorByQuery('Entebbe Road');
  assert.ok(entebbe);
  assert.equal(roads.mainRoadCorridorByQuery('Entebbe Rd').key, entebbe.key);
  const names = entebbe.areas.map((area) => area.name);
  assert.ok(names.includes('Kitende'));
  assert.ok(names.includes('Nalumunye'));
  const scope = roads.mainRoadSearchScope(['Entebbe Road']);
  const scopeNames = scope.exact.map((area) => area.name);
  assert.ok(scopeNames.includes('Kitende'));
  assert.ok(scopeNames.includes('Nalumunye'));
  assert.equal(scope.exact.some((area) => area.level === 'district'), false);
  assert.equal(scope.exact.some((area) => area.key === 'wakiso:entebbe' || area.key === 'wakiso:kitende'), true);

  for (const query of ['Gayaza Road', 'Jinja Rd', 'Bombo Road', 'Hoima Rd', 'Masaka Road', 'Mityana Road', 'Kira Road', 'Ntinda Road']) {
    const road = roads.mainRoadCorridorByQuery(query);
    assert.ok(road, query);
    assert.ok(road.areas.length >= 3, query);
    const roadScope = roads.mainRoadSearchScope([road.key]);
    assert.equal(roadScope.exact.some((area) => area.level === 'district'), false, query);
  }

  const filters = [];
  const values = [];
  addCanonicalLocationSearchFilter(filters, values, scope);
  assert.match(filters[0], /canonical_location_id/);
  assert.match(filters[0], /SPLIT_PART/);
  assert.ok(values.flat().includes('wakiso:kitende'));
  assert.ok(values.flat().includes('wakiso:nalumunye'));
  assert.equal(values.flat().some((value) => value === 'wakiso:%'), false);
  assert.match(properties, /mainRoadCorridorByQuery\(query\)/);
  assert.match(properties, /mainRoadSearchScope/);
});

test('a road name is still not district evidence for the location guardrail', () => {
  assert.doesNotMatch(stripRoadNamePhrases('House on Entebbe Road in Kitende'), /\bEntebbe\b/);
  const entebbe = roads.canonicalLocationByKey('wakiso:entebbe');
  assert.equal(entebbe.aliases.some((alias) => /\broad\b/i.test(alias)), false);
  const stripped = stripRoadNamePhrases('House on Entebbe Road in Kitende');
  const districts = roads.canonicalUgandaDistrictsMentionedInText(stripped);
  assert.equal(districts.includes('Entebbe'), false);
});

test.after(async () => {
  try { await require('../config/database').pool.end(); } catch (_) { /* no database in this environment */ }
});
