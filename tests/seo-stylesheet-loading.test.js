'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');

// Exercise the actual server functions without starting Express, timers or a
// database pool. Parsing declarations also avoids copying the implementation.
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
function functionSource(name) {
  const node = ast.body.find((item) => item.type === 'FunctionDeclaration' && item.id.name === name);
  assert.ok(node, `${name} is declared in server.js`);
  return source.slice(node.start, node.end);
}

function loader() {
  const context = vm.createContext({});
  vm.runInContext(functionSource('applyShortTermStylesheetLoading'), context);
  return context.applyShortTermStylesheetLoading;
}

function links(html) {
  return [...html.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2];
}

function hasAttribute(tag, name) {
  return new RegExp(`\\s${name}(?:\\s|=|>)`, 'i').test(tag);
}

const original = '<link rel="stylesheet" href="/assets/short-term.css?v=ab12cd34#styles" media="all" data-keep="yes">';
const offPlan = '<link rel="stylesheet" href="/assets/off-plan.css?v=unchanged">';
const canonical = '<link rel="canonical" href="https://makaug.com/to-rent/kireka-wakiso">';
const content = '<main><h1 data-ssr-seo-h1="1">Houses for rent in Kireka, Wakiso</h1><article data-ssr-property-card="property-1">Current rental details</article><section data-landing-copy="1">Arrange a viewing</section></main>';
const fixture = `<html><head>${original}${offPlan}${canonical}</head><body>${content}</body></html>`;

test('homepage and property routes defer only the Short Term stylesheet', () => {
  const apply = loader();
  for (const pathname of ['/', '/index.html', '/to-rent/kireka-wakiso', '/to-rent/kyanja-kampala/apartments?page=2', '/student-accommodation/', '/short-termish', '/short-termish/room']) {
    const out = apply(fixture, pathname);
    const stylesheet = links(out).find((tag) => hasAttribute(tag, 'data-short-term-style-deferred'));
    assert.ok(stylesheet, `${pathname} receives a deferred link`);
    assert.equal(attribute(stylesheet, 'rel'), 'preload');
    assert.equal(attribute(stylesheet, 'as'), 'style');
    assert.ok(attribute(stylesheet, 'onload'), 'the preload will become a stylesheet');
    assert.ok(out.includes(offPlan), 'shared navigation styles remain blocking and byte-identical');
    assert.ok(out.includes(canonical), 'self-canonical is unchanged');
    assert.ok(out.includes(content), 'server-rendered heading, cards and guidance are unchanged');
  }
});

test('Short Term routes and descendants keep the original blocking stylesheet', () => {
  const apply = loader();
  for (const pathname of ['/short-term', '/short-term/', '/short-term?area=Kampala', '/short-term/?page=2#rooms', '/short-term/property-123', '/short-term/property-123/?view=photos']) {
    assert.equal(apply(fixture, pathname), fixture, pathname);
  }
});

test('deferred link preserves the asset hash and other attributes, with an exact no-JS fallback', () => {
  const apply = loader();
  for (const link of [original, "<link data-keep='single-quotes' href='/assets/short-term.css?v=012345abcdef' rel='stylesheet' media='all'>"]) {
    const out = apply(`<head>${link}</head>`, '/');
    const deferred = links(out)[0];
    assert.equal(attribute(deferred, 'href'), attribute(link, 'href'));
    assert.equal(attribute(deferred, 'media'), attribute(link, 'media'));
    assert.equal(attribute(deferred, 'data-keep'), attribute(link, 'data-keep'));
    assert.ok(out.includes(`<noscript>${link}</noscript>`), 'JavaScript-disabled browsers retain the original stylesheet');
    assert.equal(links(out).length, 2, 'one preload plus one no-JS stylesheet');
    assert.equal((out.match(/data-short-term-style-deferred/g) || []).length, 1);
  }
});

test('the emitted load handler eventually enables CSS and clears itself', async () => {
  const out = loader()(fixture, '/');
  const deferred = links(out).find((tag) => hasAttribute(tag, 'data-short-term-style-deferred'));
  const handler = vm.runInNewContext(`(function () { ${attribute(deferred, 'onload')} })`);
  const link = { rel: attribute(deferred, 'rel'), as: attribute(deferred, 'as'), onload: handler };
  assert.equal(link.rel, 'preload', 'CSS is not a render-blocking stylesheet before its load event');
  assert.equal(link.as, 'style');
  // Simulate completion after initial rendering, rather than evaluating the
  // handler while parsing the link. This checks the eventual-style contract.
  await Promise.resolve();
  link.onload.call(link);
  assert.equal(link.rel, 'stylesheet', 'the same downloaded resource is applied after load');
  assert.equal(link.onload, null, 'changing rel cannot invoke this handler repeatedly');
});

test('reapplying the transform is idempotent and unrelated CSS is never selected', () => {
  const apply = loader();
  const once = apply(fixture, '/');
  assert.equal(apply(once, '/'), once, 'does not transform the noscript fallback on a second pass');
  const unrelated = [
    offPlan,
    '<link rel="stylesheet" href="/assets/short-term.css.map">',
    '<link rel="stylesheet" href="/assets/short-term.css-extra">',
    '<link rel="stylesheet" href="https://example.com/assets/short-term.css">',
    '<link rel="preload" as="style" href="/assets/short-term.css">'
  ].join('');
  assert.equal(apply(`<head>${unrelated}</head>`, '/'), `<head>${unrelated}</head>`);
});

test('public HTML invokes route-aware CSS loading after the homepage-image decision', () => {
  const calls = [];
  const context = vm.createContext({
    process: { env: { SHARED_CORE_PHASE1_ENABLED: 'false' } },
    isProduction: false,
    publicHtmlCache: new Map(),
    readIndexHtml() { return fixture; },
    sanitizePublicHtml(html) { return html; },
    applyHarvestPublicSubmissionVisibility(html) { return html; },
    applyShortTermVisibility(html) { return html; },
    injectShortTermRuntimeConfig(html) { return html; },
    inlinePublicCoreStylesheets(html) { return html; },
    inlinePublicFontFaces(html) { return html; },
    applyHomeHeroPreload(html, pathname) { calls.push(['hero', pathname]); return html; },
    injectGa4HeadTag(html, pathname) { calls.push(['analytics', pathname]); return html; }
  });
  vm.runInContext(functionSource('applyShortTermStylesheetLoading'), context);
  vm.runInContext(functionSource('applyPublicFontDisplayOptional'), context);
  const realApply = context.applyShortTermStylesheetLoading;
  context.applyShortTermStylesheetLoading = (html, pathname) => { calls.push(['style', pathname]); return realApply(html, pathname); };
  vm.runInContext(functionSource('renderPublicHtml'), context);
  const out = context.renderPublicHtml('/to-rent/kireka-wakiso/?page=2#photos');
  assert.deepEqual(calls, [['hero', '/to-rent/kireka-wakiso'], ['style', '/to-rent/kireka-wakiso'], ['analytics', '/to-rent/kireka-wakiso']]);
  assert.match(out, /data-short-term-style-deferred/);
  assert.ok(out.includes(content));
  calls.length = 0;
  assert.equal(context.renderPublicHtml('/short-term/?page=2'), fixture);
});

test('authenticated admin and staff shells continue bypassing the public transform', async () => {
  for (const pathname of ['/admin', '/staff-dashboard']) {
    let delivered;
    let publicCalls = 0;
    const context = vm.createContext({
      ACTIVE_TENANT: { publicFeatures: {} },
      publicAliasRedirectTarget() { return null; },
      isKnownPublicRoute() { return true; },
      isProtectedPath() { return true; },
      authFromCookie() { return { role: 'admin' }; },
      roleCanAccessProtectedPath() { return true; },
      readIndexHtml() { return fixture; },
      injectShortTermRuntimeConfig(html) { return html; },
      applyHomeHeroPreload(html) { return html; },
      renderPublicHtml() { publicCalls += 1; throw new Error('protected shell entered the public renderer'); },
      sendTextResponse(_req, _res, html) { delivered = html; return html; }
    });
    vm.runInContext(functionSource('sendPublicIndex'), context);
    const req = { path: pathname, originalUrl: pathname };
    const res = { set() {} };
    await context.sendPublicIndex(req, res, (error) => { throw error || new Error('unexpected next()'); });
    assert.equal(publicCalls, 0, pathname);
    assert.equal(delivered, fixture, `${pathname} retains its original stylesheet for review desks`);
  }
});
