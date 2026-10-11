'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const { sanitizePublicHtml, PUBLIC_FORBIDDEN_STRINGS } = require('../services/publicHtmlSanitizer');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');
const asts = new Map([server, app].map((source) => [source, acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' })]));
function declaration(source, name) {
  const node = asts.get(source).body.find((item) => item.type === 'FunctionDeclaration' && item.id.name === name);
  assert.ok(node, `${name} exists in the real source`);
  return source.slice(node.start, node.end);
}
function fontLoader() {
  const context = vm.createContext({});
  vm.runInContext(declaration(server, 'applyPublicFontDisplayOptional'), context);
  return context.applyPublicFontDisplayOptional;
}
const family = 'family=Plus+Jakarta+Sans:wght@400;500;600;700;800';
const fontUrl = `https://fonts.googleapis.com/css2?${family}&display=swap`;
const preload = `<link rel="preload" href="${fontUrl}" as="style" onload="this.onload=null;this.rel='stylesheet'" data-keep="yes">`;
const fallback = `<noscript><link href="${fontUrl}" rel="stylesheet"></noscript>`;

test('only the public Jakarta font display policy changes, including the no-JS fallback', () => {
  const content = '<h1 data-ssr-seo-h1="1">Student accommodation in Uganda</h1><article data-ssr-property-card="a">Current listing</article>';
  const fixture = `<head>${preload}${fallback}</head><main>${content}</main>`;
  const output = fontLoader()(fixture);
  assert.equal(output, fixture.replaceAll('display=swap', 'display=optional'));
  assert.ok(output.includes(family), 'all requested font weights remain available');
  assert.ok(output.includes(content), 'headings and SSR inventory are byte-identical');
  assert.ok(output.includes("onload=\"this.onload=null;this.rel='stylesheet'\""), 'the asynchronous stylesheet still applies');
});

test('single quotes and HTML-escaped queries retain their attributes; applying twice is harmless', () => {
  const fixture = `<link media='all' href='https://fonts.googleapis.com/css2?${family}&amp;display=swap' rel='stylesheet'>`;
  const apply = fontLoader();
  const output = apply(fixture);
  assert.equal(output, fixture.replace('display=swap', 'display=optional'));
  assert.equal(apply(output), output);
  const unrelated = '<link href="https://fonts.googleapis.com/css2?family=Roboto&display=swap" rel="stylesheet"><link href="/assets/fonts.css?display=swap" rel="stylesheet"><script>const note="display=swap";</script>';
  assert.equal(apply(unrelated), unrelated, 'other font families, local styles and script text are untouched');
});

function publicRenderer() {
  const context = vm.createContext({
    process: { env: { SHARED_CORE_PHASE1_ENABLED: 'false' } },
    isProduction: false,
    publicHtmlCache: new Map(),
    readIndexHtml: () => index,
    sanitizePublicHtml,
    applyHarvestPublicSubmissionVisibility: (html) => html,
    applyShortTermVisibility: (html) => html,
    injectShortTermRuntimeConfig: (html) => html,
    inlinePublicCoreStylesheets: require('../services/publicCoreStylesheets'),
    injectGa4HeadTag: (html) => html
  });
  for (const name of ['applyHomeHeroPreload', 'applyShortTermStylesheetLoading', 'applyPublicFontDisplayOptional', 'renderPublicHtml']) {
    vm.runInContext(declaration(server, name), context);
  }
  return context.renderPublicHtml;
}

test('the actual public renderer applies the policy per route without exposing protected page blocks', () => {
  const render = publicRenderer();
  for (const route of ['/', '/mortgage', '/student-accommodation', '/student-accommodation/university/makerere/?page=2', '/to-rent/kireka-wakiso', '/to-rent/kyanja-kampala/apartments']) {
    const output = render(route);
    const jakarta = [...output.matchAll(/<link\b[^>]*fonts\.googleapis\.com\/css2\?[^>]*>/g)].map((match) => match[0]);
    assert.equal(jakarta.length, 2, `${route}: preload plus no-JS fallback`);
    assert.ok(jakarta.every((link) => link.includes('display=optional')), route);
    assert.doesNotMatch(output, /id="page-(?:admin-dashboard|staff-dashboard|account|finder-dashboard)"/);
    for (const forbidden of PUBLIC_FORBIDDEN_STRINGS) assert.ok(!output.includes(forbidden), `${route}: ${forbidden}`);
  }
});

test('category Ask AI controls already ship with their layout and are not replaced during mounting', () => {
  const render = publicRenderer();
  const surfaces = [];
  for (const [route, scope] of [['/student-accommodation', 'student'], ['/student-accommodation/university/makerere', 'student'], ['/to-rent/kireka-wakiso', 'rent'], ['/to-rent/kyanja-kampala/apartments', 'rent']]) {
    const output = render(route);
    const section = output.match(new RegExp(`<section[^>]*data-ask-ai-inline-scope="${scope}"[^>]*>[\\s\\S]*?</section>`))?.[0];
    assert.ok(section, `${route}: Ask AI is present before JavaScript`);
    assert.match(section, /data-ask-ai-mounted="1"/);
    assert.match(section, /class="ask-ai-search-shell"/);
    assert.match(section, /data-ai-title/);
    assert.match(section, /data-ai-subtitle/);
    assert.match(section, /data-ai-message/);
    assert.match(section, /onsubmit="submitAskAiSearchPrompt\(event\)"/);
    surfaces.push({ dataset: { askAiMounted: '1', askAiInlineScope: scope }, innerHTML: section });
  }
  const originals = surfaces.map((surface) => surface.innerHTML);
  const unmounted = { dataset: { askAiInlineScope: 'student' }, innerHTML: '' };
  let built = 0;
  const context = vm.createContext({
    document: { querySelectorAll: () => [...surfaces, unmounted] },
    normalizeAiAssistantScope: (scope) => scope,
    aiAssistantShellHtml: () => { built += 1; return '<div data-fresh-shell="1"></div>'; }
  });
  vm.runInContext(declaration(app, 'renderAskAiSearchInlineSurfaces'), context);
  context.renderAskAiSearchInlineSurfaces();
  assert.deepEqual(surfaces.map((surface) => surface.innerHTML), originals, 'SSR controls and geometry remain in place');
  assert.equal(built, 1, 'only an actually empty mount point is built');
  assert.equal(unmounted.dataset.askAiMounted, '1');
  context.renderAskAiSearchInlineSurfaces();
  assert.equal(built, 1, 'mounting is idempotent');
});

test('all nine language options and existing fallback fonts remain available', () => {
  const output = publicRenderer()('/student-accommodation');
  const selector = output.match(/<select id="lang-sel-spotlight"[\s\S]*?<\/select>/)?.[0];
  for (const code of ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar']) assert.ok(selector.includes(`value="${code}"`), code);
  assert.ok(output.includes('system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'));
  assert.ok(index.includes('display=swap'), 'the source shell used by protected routes is unchanged');
});

test('authenticated admin and staff shells bypass the optional-font public transform', async () => {
  for (const route of ['/admin', '/staff-dashboard', '/king']) {
    let delivered;
    const context = vm.createContext({
      ACTIVE_TENANT: { publicFeatures: {} },
      publicAliasRedirectTarget: () => null,
      isKnownPublicRoute: () => true,
      isProtectedPath: () => true,
      authFromCookie: () => ({ role: 'admin' }),
      roleCanAccessProtectedPath: () => true,
      readIndexHtml: () => index,
      injectShortTermRuntimeConfig: (html) => html,
      applyHomeHeroPreload: (html) => html,
      renderPublicHtml: () => { throw new Error('protected shell entered public renderer'); },
      sendTextResponse: (_req, _res, html) => { delivered = html; return html; }
    });
    vm.runInContext(declaration(server, 'sendPublicIndex'), context);
    await context.sendPublicIndex({ path: route, originalUrl: route }, { set() {} }, (error) => { throw error || new Error('unexpected next'); });
    assert.equal(delivered, index, route);
    assert.ok(delivered.includes('display=swap'), 'review desks retain the original font policy');
  }
});
