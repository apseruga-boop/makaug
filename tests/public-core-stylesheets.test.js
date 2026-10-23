'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const crypto = require('node:crypto');
const { sanitizePublicHtml, PUBLIC_FORBIDDEN_STRINGS } = require('../services/publicHtmlSanitizer');
const { createPublicCoreStylesheetInliner } = require('../services/publicCoreStylesheets');
const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const tree = acorn.parse(source, { ecmaVersion: 'latest' });
const paths = ['/assets/tailwind.css', '/assets/off-plan.css'];
const built = new Map(paths.map((asset) => [asset, fs.readFileSync(path.join(root, asset), 'utf8')]));
function declaration(name) {
  const node = tree.body.find((node) => node.type === 'FunctionDeclaration' && node.id.name === name);
  assert.ok(node, name); return source.slice(node.start, node.end);
}
const tailwind = '<link rel="stylesheet" href="/assets/tailwind.css?v=7addc7092b97">';
const offPlan = '<link rel="stylesheet" href="/assets/off-plan.css?v=176fecf8278b">';
const middle = '<style>.existing-rule{color:green}</style>';
const content = '<link rel="canonical" href="https://makaug.com/to-rent/kireka-wakiso"><h1 data-ssr-seo-h1="1">Houses for rent in Kireka, Wakiso</h1><article data-ssr-property-card="property-1">Current listing</article>';
const fixture = `<head>${tailwind}${middle}${offPlan}</head><main>${content}</main>`;
function styles(html) {
  return [...html.matchAll(/<style\b[^>]*data-public-core-css="([^"]+)"[^>]*>([\s\S]*?)<\/style>/g)].map((match) => ({ path: match[1], css: match[2], full: match[0] }));
}

test('full built CSS is byte-identical, present during parsing, and keeps its original cascade position', () => {
  const out = createPublicCoreStylesheetInliner()(fixture); const inlined = styles(out);
  assert.deepEqual(inlined.map((style) => style.path), paths);
  for (const style of inlined) assert.equal(style.css, built.get(style.path), style.path);
  assert.ok(out.indexOf(inlined[0].full) < out.indexOf(middle)); assert.ok(out.indexOf(middle) < out.indexOf(inlined[1].full));
  assert.ok(out.includes('data-source-href="/assets/tailwind.css?v=7addc7092b97"'));
  assert.ok(out.includes('data-source-href="/assets/off-plan.css?v=176fecf8278b"'));
  assert.ok(out.includes(content)); assert.doesNotMatch(out, /<link[^>]*href="\/assets\/(?:tailwind|off-plan)\.css/);
  assert.doesNotMatch(out, /onload=|<script|<noscript/, 'native style elements work without JavaScript or an asynchronous style switch');
});

test('actual asset-versioning hashes remain traceable to the exact inline bytes', () => {
  const context = vm.createContext({ fs, path, staticRoot: root, require, localAssetHashCache: new Map() });
  vm.runInContext(declaration('localAssetContentHash') + declaration('versionLocalAssetUrls'), context);
  const versioned = context.versionLocalAssetUrls(index);
  const output = createPublicCoreStylesheetInliner()(versioned);
  for (const style of styles(output)) {
    const hash = crypto.createHash('sha1').update(style.css).digest('hex').slice(0, 12);
    assert.ok(style.full.includes(`data-source-href="${style.path}?v=${hash}"`));
    assert.equal(style.css, built.get(style.path));
  }
  assert.equal(styles(output).length, 2);
});

test('only the two exact local stylesheet paths can trigger reads', () => {
  const reads = []; const apply = createPublicCoreStylesheetInliner((filename) => { reads.push(filename); return '.safe{color:red}'; });
  const unrelated = ['<link rel="stylesheet" href="/assets/short-term.css?v=unchanged">', '<link rel="stylesheet" href="https://example.com/assets/tailwind.css">', '<link rel="stylesheet" href="//example.com/assets/off-plan.css">', '<link rel="stylesheet" href="/assets/tailwind.css-extra">', '<link rel="stylesheet" href="/assets/../secret.css">', '<link rel="stylesheet" href="/assets/%74ailwind.css">', '<link rel="preload" as="style" href="/assets/tailwind.css">', '<link rel="alternate stylesheet" href="/assets/off-plan.css">', '<link rel="stylesheet" data-href="/assets/tailwind.css">', '<link rel="stylesheet" href="/assets/off-plan.css" disabled>', '<link rel="stylesheet" href="/assets/tailwind.css" integrity="sha384-example">', '<link rel="stylesheet" href="/assets/tailwind.css" onload="ready()">', '<link rel="stylesheet" href="/assets/off-plan.css" onerror="retry()">', '<link rel="stylesheet" href="/assets/off-plan.css" type="application/example">'].join('');
  assert.equal(apply(unrelated), unrelated); assert.deepEqual(reads, []);
});

test('successful reads are bounded to two cached assets; one failed asset retains its link and can recover', () => {
  const counts = new Map(); let failTailwind = true;
  const apply = createPublicCoreStylesheetInliner((filename) => {
    const name = path.basename(filename); counts.set(name, (counts.get(name) || 0) + 1);
    if (name === 'tailwind.css' && failTailwind) throw new Error('temporary read failure');
    return built.get(`/assets/${name}`);
  });
  const first = apply(fixture); assert.ok(first.includes(tailwind)); assert.deepEqual(styles(first).map((style) => style.path), ['/assets/off-plan.css']);
  failTailwind = false; const second = apply(fixture); assert.equal(styles(second).length, 2);
  for (let i = 0; i < 4; i += 1) apply(fixture.replaceAll('?v=', `?v=route${i}`));
  assert.deepEqual(Object.fromEntries(counts), { 'tailwind.css': 2, 'off-plan.css': 1 });
});

test('unsafe or path-dependent CSS falls back byte-for-byte without caching invalid content', () => {
  for (const css of ['', '  ', '.x{background:url(../image.png)}', '@import "other.css";', '.x::after{content:"</StYlE><script>alert(1)</script>"}']) {
    let reads = 0; const apply = createPublicCoreStylesheetInliner(() => { reads += 1; return css; });
    assert.equal(apply(fixture), fixture); assert.equal(apply(fixture), fixture); assert.equal(reads, 4);
  }
});

test('media and escaped source metadata remain valid; reapplying cannot duplicate inline styles', () => {
  const apply = createPublicCoreStylesheetInliner();
  const input = "<link media='screen and (min-width: 1px)' href='/assets/off-plan.css?v=abc&flag=<value>' rel='stylesheet' type='text/css'>";
  const out = apply(input); assert.equal(styles(out)[0].css, built.get('/assets/off-plan.css'));
  assert.match(out, /media="screen and \(min-width: 1px\)"/); assert.match(out, /data-source-href="\/assets\/off-plan\.css\?v=abc&amp;flag=&lt;value&gt;"/);
  assert.equal(apply(out), out);
});

function publicRenderer({ inliner = createPublicCoreStylesheetInliner(), production = false } = {}) {
  const context = vm.createContext({ ACTIVE_COUNTRY_CODE: 'UG', process: { env: { SHARED_CORE_PHASE1_ENABLED: 'false' } },
    isProduction: production, publicHtmlCache: new Map(), PUBLIC_HTML_CACHE_MAX_ENTRIES: 32,
    readIndexHtml: () => index, sanitizePublicHtml,
    applyHarvestPublicSubmissionVisibility: (html) => html, applyShortTermVisibility: (html) => html,
    injectShortTermRuntimeConfig: (html) => html, injectGa4HeadTag: (html) => html,
    patchStructuredData: (html) => html,
    travelpayoutsAffiliate: { drivePublicHeadTag() { return ''; }, driveScriptSrc() { return ''; }, driveProjectId() { return '581854'; } },
    inlinePublicCoreStylesheets: inliner,
    inlinePublicFontFaces: require('../services/publicFontFaces')
  });
  vm.runInContext(['applyHomeHeroPreload', 'applyShortTermStylesheetLoading', 'applyPublicFontDisplayOptional', 'injectTravelpayoutsDriveHeadTag', 'renderPublicHtml'].map(declaration).join('\n'), context);
  return context;
}

test('real public renderer caches the full styles on each route without changing canonical/privacy/Short Term behavior', () => {
  const context = publicRenderer({ production: true });
  for (const route of ['/', '/student-accommodation', '/student-accommodation/university/makerere', '/to-rent/kireka-wakiso', '/to-rent/kyanja-kampala/apartments', '/short-term/example', '/about', '/advertise']) {
    const baseline = publicRenderer({ inliner: (html) => html }).renderPublicHtml(route);
    const output = context.renderPublicHtml(route); const inlined = styles(output);
    assert.equal(inlined.length, 2, route); for (const style of inlined) assert.equal(style.css, built.get(style.path));
    const restored = output.replace(/<style\b[^>]*data-public-core-css="([^"]+)"[^>]*>[\s\S]*?<\/style>/g, (_match, asset) => `<link rel="stylesheet" href="${asset}${asset === '/assets/tailwind.css' ? '' : '?v=20260910-off-plan-v4'}">`);
    assert.equal(restored, baseline, `${route}: only the two style nodes changed`);
    assert.equal(context.renderPublicHtml(`${route}?tracking=fixture`), output, 'existing normalized cache key behavior is unchanged');
    for (const forbidden of PUBLIC_FORBIDDEN_STRINGS) assert.ok(!output.includes(forbidden), `${route}: ${forbidden}`);
  }
});

test('real public renderer read failures retain both original functioning stylesheet links', () => {
  const failed = publicRenderer({ inliner: createPublicCoreStylesheetInliner(() => { throw new Error('file unavailable'); }) });
  const baseline = publicRenderer({ inliner: (html) => html });
  for (const route of ['/student-accommodation', '/to-rent/kireka-wakiso', '/short-term']) assert.equal(failed.renderPublicHtml(route), baseline.renderPublicHtml(route));
});

test('authenticated protected shells bypass public inlining and retain original hashed styles', async () => {
  for (const route of ['/admin', '/staff-dashboard', '/king']) {
    let delivered; let inlineCalls = 0;
    const context = vm.createContext({ ACTIVE_TENANT: { publicFeatures: {} }, publicAliasRedirectTarget: () => null,
      isKnownPublicRoute: () => true, isProtectedPath: () => true, authFromCookie: () => ({ role: 'admin' }),
      roleCanAccessProtectedPath: () => true, readIndexHtml: () => fixture,
      injectShortTermRuntimeConfig: (html) => html, applyHomeHeroPreload: (html) => html,
      inlinePublicCoreStylesheets() { inlineCalls += 1; throw new Error('protected CSS transformed'); },
      renderPublicHtml() { throw new Error('protected route entered public renderer'); },
      sendTextResponse: (_req, _res, html) => { delivered = html; return html; }
    });
    vm.runInContext(declaration('sendPublicIndex'), context);
    await context.sendPublicIndex({ path: route, originalUrl: route }, { set() {} }, (error) => { throw error || new Error('unexpected next'); });
    assert.equal(inlineCalls, 0); assert.equal(delivered, fixture); assert.ok(delivered.includes(tailwind) && delivered.includes(offPlan));
  }
});
