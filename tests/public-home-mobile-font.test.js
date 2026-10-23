'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const acorn = require('acorn');
const { createPublicFontFaceInliner } = require('../services/publicFontFaces');
const { sanitizePublicHtml, PUBLIC_FORBIDDEN_STRINGS } = require('../services/publicHtmlSanitizer');

const index = fs.readFileSync(require.resolve('../index.html'), 'utf8');
const server = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const css = fs.readFileSync(require.resolve('../assets/fonts/plus-jakarta-sans-optional.css'), 'utf8');
const ast = acorn.parse(server, { ecmaVersion: 'latest' });
const media = '(min-width: 768px)';
const fontLink = (html) => html.match(/<link\b[^>]*data-public-font-preload="jakarta-latin"[^>]*>/)?.[0];
const faces = (html) => html.match(/<style data-public-font-faces="jakarta"[^>]*>([\s\S]*?)<\/style>/)?.[1];

function declaration(name) {
  const node = ast.body.find((item) => item.type === 'FunctionDeclaration' && item.id.name === name);
  assert.ok(node, `the production ${name} function exists`);
  return server.slice(node.start, node.end);
}

function renderer(country, production = false) {
  const context = vm.createContext({
    ACTIVE_COUNTRY_CODE: country,
    process: { env: { SHARED_CORE_PHASE1_ENABLED: 'false' } },
    isProduction: production,
    PUBLIC_HTML_CACHE_MAX_ENTRIES: 20,
    publicHtmlCache: new Map(),
    readIndexHtml: () => index,
    sanitizePublicHtml,
    applyHarvestPublicSubmissionVisibility: (html) => html,
    applyShortTermVisibility: (html) => html,
    injectShortTermRuntimeConfig: (html) => html,
    injectGa4HeadTag: (html) => html,
    patchStructuredData: (html) => html,
    inlinePublicFontFaces: createPublicFontFaceInliner(),
    inlinePublicCoreStylesheets: require('../services/publicCoreStylesheets'),
    travelpayoutsAffiliate: { drivePublicHeadTag() { return ''; }, driveScriptSrc() { return ''; }, driveProjectId() { return '581854'; } }
  });
  vm.runInContext(['applyHomeHeroPreload', 'applyShortTermStylesheetLoading', 'applyPublicFontDisplayOptional', 'injectTravelpayoutsDriveHeadTag', 'renderPublicHtml'].map(declaration).join('\n'), context);
  return context.renderPublicHtml;
}

test('actual Uganda public homepage renderer limits only the Latin preload hint to desktop and retains every early optional face', () => {
  const render = renderer('UG');
  for (const route of ['/', '/?q=homes', '/#to-rent', '/index.html', '/index.html/?q=homes']) {
    const output = render(route);
    const link = fontLink(output);
    assert.ok(link, route);
    assert.ok(link.includes(`media="${media}"`), `${route}: the mobile homepage must not force the desktop font preload`);
    assert.equal(faces(output), css, `${route}: pinned fonts, subsets, weights and optional policy remain intact`);
    assert.equal((output.match(/data-public-font-preload="jakarta-latin"/g) || []).length, 1);
    assert.ok(output.indexOf('<meta charset="UTF-8">') < output.indexOf(link));
    assert.ok(output.indexOf('data-public-font-faces') < output.indexOf(link));
    assert.ok(output.indexOf('data-public-font-faces') < output.indexOf('<body'));
    assert.ok(output.includes('Find your next home, land, rental, or student room'));
    for (const forbidden of PUBLIC_FORBIDDEN_STRINGS) assert.ok(!output.includes(forbidden), `${route}: ${forbidden}`);
  }
});

test('other actual public routes and countries retain their unrestricted original Latin preload', () => {
  const render = renderer('UG');
  for (const route of ['/brokers', '/to-rent/kyanja-kampala', '/property/7918f050-f8f3-407b-aabe-718de3deb2c8', '/off-plan', '/short-term', '/student-accommodation/university/makerere', '/about']) {
    const output = render(route);
    assert.ok(fontLink(output), route);
    assert.doesNotMatch(fontLink(output), /\bmedia=/, `${route}: retain preload on all viewport widths`);
    assert.equal(faces(output), css);
  }
  for (const country of ['RW', 'CD', 'KE', 'TZ', 'ZZ']) {
    for (const route of ['/', '/index.html']) {
      const output = renderer(country)(route);
      assert.ok(fontLink(output), `${country} ${route}`);
      assert.doesNotMatch(fontLink(output), /\bmedia=/, `${country} ${route}: the Uganda-only change must not spread`);
      assert.equal(faces(output), css);
    }
  }
});

test('shared inliner and production page caching do not transfer homepage media restrictions into other route outputs', () => {
  const apply = createPublicFontFaceInliner();
  const mobileScoped = apply(index, { preloadMedia: media });
  const unscoped = apply(index);
  assert.ok(fontLink(mobileScoped).includes(`media="${media}"`));
  assert.doesNotMatch(fontLink(unscoped), /\bmedia=/);
  assert.equal(faces(mobileScoped), css);
  assert.equal(faces(unscoped), css);
  assert.equal(apply(mobileScoped, { preloadMedia: media }), mobileScoped);
  const render = renderer('UG', true);
  const home = render('/');
  const deep = render('/to-rent/kyanja-kampala');
  assert.equal(render('/?q=house'), home, 'cached homepage policy remains scoped');
  assert.equal(render('/to-rent/kyanja-kampala?q=house'), deep, 'cached category policy remains unrestricted');
  assert.ok(fontLink(home).includes(`media="${media}"`));
  assert.doesNotMatch(fontLink(deep), /\bmedia=/);
});

test('actual homepage defines faces directly after charset and waits for viewport metadata before exposing the conditional preload', () => {
  for (const route of ['/', '/index.html']) {
    const output = renderer('UG')(route);
    const viewport = output.match(/<meta\b[^>]*name="viewport"[^>]*>/)?.[0];
    assert.ok(viewport);
    assert.ok(/<meta charset="UTF-8">\s*<style data-public-font-faces="jakarta"/.test(output),
      'all optional faces remain immediate after charset');
    assert.ok(output.indexOf(viewport) < output.indexOf(fontLink(output)),
      `${route}: mobile viewport must be known before the desktop media preload can be discovered`);
    assert.ok(output.indexOf('data-public-font-faces') < output.indexOf(viewport));
    assert.equal(faces(output), css);
  }
});

test('a missing viewport keeps the original unrestricted font-loading output instead of evaluating uncertain mobile media', () => {
  const apply = createPublicFontFaceInliner();
  const missingViewport = index.replace(/<meta\b[^>]*name="viewport"[^>]*>/, '');
  const originalPolicy = apply(missingViewport);
  const requestedMobilePolicy = apply(missingViewport, { preloadMedia: media });
  assert.ok(requestedMobilePolicy === originalPolicy, 'a missing viewport must preserve the original font-loading output');
  assert.doesNotMatch(fontLink(requestedMobilePolicy), /\bmedia=/);
  assert.equal(faces(requestedMobilePolicy), css);
});
