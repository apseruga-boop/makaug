'use strict';

/**
 * Walk through the homes, the construction diary, prices by floor, key facts
 * and documents on the off-plan project page (6 Nov 2026, Vanta House).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { publicOffPlanPayload } = require('../utils/publicOffPlanPayload');

const page = fs.readFileSync(path.join(__dirname, '..', 'assets', 'off-plan.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'off-plan.css'), 'utf8');
const vanta = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'off-plan', 'vanta-house.development.json'), 'utf8'));

test('the project page shows the new sections only when the project carries the data', () => {
  const detail = page.slice(page.indexOf('function detailMarkup(project)'), page.indexOf('const nearbyGroupDefinitions'));
  for (const call of ['projectAmenitiesMarkup(project)', 'floorPriceMarkup(project)', 'homesWalkthroughMarkup(project)', 'constructionDiaryMarkup(project)', 'keyFactsMarkup(project)', 'documentsMarkup(project)']) {
    assert.ok(detail.includes(call), call);
  }
  for (const fn of ['function homesWalkthroughMarkup', 'function constructionDiaryMarkup', 'function floorPriceMarkup', 'function keyFactsMarkup', 'function documentsMarkup', 'function renderOffPlanFloorPrices', 'async function openOffPlanWalkaround']) {
    assert.ok(page.includes(fn), fn);
  }
  assert.match(page, /if \(!walkthroughs\.length && !tours\.length\) return '';/, 'no walkthrough section without walkthroughs');
  assert.match(page, /if \(!updates\.length && !timeline\.length\) return '';/, 'no diary without updates');
  assert.match(page, /if \(!rule \|\| !units\.length \|\| !\(number\(rule\.step_percent\) > 0\)\) return '';/, 'no floor picker without a rule');
  assert.match(page, /hydrateOffPlanExperience\(project\);/, 'the floor picker is filled after render');
  assert.match(page, /\/assets\/vendor\/three\.min\.js/, 'three.js is served from makaug, not a CDN');
  assert.match(page, /\/assets\/off-plan-walkthrough\.js/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', 'vendor', 'three.min.js')));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', 'off-plan-walkthrough.js')));
  for (const cls of ['.off-plan-walk-grid', '.off-plan-floor-stack', '.off-plan-timeline', '.off-plan-floor-price-grid', '.off-plan-facts', '.off-plan-walkaround']) assert.ok(css.includes(cls), cls);
});

test('the description and area overview follow the site language for Uganda projects too', () => {
  const detail = page.slice(page.indexOf('function detailMarkup(project)'), page.indexOf('const nearbyGroupDefinitions'));
  assert.match(detail, /const translated = \(field\) => clean\(project\.extra_fields\?\.translations\?\.\[offPlanLanguage\(\)\]\?\.\[field\]\);/);
  assert.match(detail, /translated\('description'\) \|\| project\.description/);
  assert.match(detail, /translated\('area_overview'\)/);
  assert.ok(page.includes("overseas ? overseasHighlightsMarkup(project) : projectAmenitiesMarkup(project)"), 'amenities render for Uganda projects');
  for (const language of ['lg', 'sw']) {
    assert.ok(vanta.extra_fields.translations[language].description.length > 200, `${language} description`);
    assert.ok(vanta.extra_fields.translations[language].area_overview.length > 100, `${language} area overview`);
  }
  assert.ok(vanta.amenities.every((amenity) => amenity.labels.lg && amenity.labels.sw), 'every amenity is labelled in Luganda and Swahili');
});

test('the public payload carries the walkthrough material but never the developer\'s private contact', () => {
  const out = publicOffPlanPayload({ ...vanta, id: 'x', status: 'published', source_agent_status: 'approved', source_agent_name: 'John Yan', source_agent_whatsapp: '+256709973205', source_agent_email: 'private@example.com' });
  for (const key of ['walkthroughs', 'virtual_tours', 'construction_updates', 'construction_timeline', 'floor_price_rule', 'key_facts', 'management_fees', 'government_charges', 'documents', 'translations', 'investment_note', 'progress_basis']) {
    assert.ok(out.extra_fields[key], key);
  }
  const serialized = JSON.stringify(out);
  assert.ok(!serialized.includes('yandadrc'), 'developer email stays private');
  assert.ok(!serialized.includes('256709973205'), 'developer phone stays private');
  assert.ok(!out.extra_fields.developer_contact, 'the private contact block is not public');
  assert.strictEqual(out.extra_fields.walkthroughs.length, 3);
  assert.strictEqual(out.extra_fields.virtual_tours.length, 3);
  assert.strictEqual(out.floor_plans.length, 4);
  assert.ok(out.extra_fields.construction_updates[0].image_urls.length >= 6);
});

test('the Vanta House record satisfies the sourced-preview checks and points at files that exist', () => {
  const { sourcedPreviewBlockers, normalizeWritePayload, normalizeDevelopmentRow } = require('../services/offPlanService');
  const row = normalizeDevelopmentRow({ ...normalizeWritePayload(vanta), id: 'x', status: 'published', source_agent_status: 'approved' });
  assert.deepStrictEqual(sourcedPreviewBlockers(row), []);
  const urls = [
    ...vanta.images.map((item) => item.url), ...vanta.floor_plans.map((item) => item.url), ...vanta.videos.map((item) => item.url),
    ...vanta.extra_fields.documents.map((item) => item.url), ...vanta.extra_fields.walkthroughs.flatMap((item) => [item.video_url, item.poster_url, item.layout_url])
  ];
  const missing = urls.filter((url) => !fs.existsSync(path.join(__dirname, '..', url.replace(/^\//, ''))));
  assert.deepStrictEqual(missing, []);
});
