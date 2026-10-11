'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const { categoryPageSeoMeta } = require('../services/publicSeoService');
const { publicSeoLandingMeta, resolvePublicSeoLanding } = require('../services/publicSeoLandingService');
const { renderCategorySeoHtml, renderUniversityLinks, universityLinks, replaceElementInnerHtml } = require('../services/publicSeoRenderService');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
function declaration(name) {
  return ast.body.find((node) => node.type === 'FunctionDeclaration' && node.id.name === name);
}
function functionSource(name) {
  const node = declaration(name);
  assert.ok(node, name);
  return source.slice(node.start, node.end);
}

test('rendered university anchors bypass the actual SPA click interceptor', () => {
  const html = renderUniversityLinks(universityLinks({ universityCounts: new Map([['makerere', 10], ['kyambogo', 8]]) }));
  let clickHandler;
  let spaCalls = 0;
  const context = vm.createContext({
    URL,
    document: { addEventListener(type, handler) { if (type === 'click') clickHandler = handler; } },
    window: { location: { origin: 'https://makaug.com' }, addEventListener() {} },
    navigatePublicRoute(_url, event) { spaCalls += 1; event.preventDefault(); return false; },
    parseInitialDeepLink() {}
  });
  vm.runInContext(`let publicRouteInterceptorInstalled=false; ${functionSource('installPublicRouteInterceptor')} installPublicRouteInterceptor();`, context);
  const anchors = [...html.matchAll(/<a href="([^"]+)"([^>]*)>/g)];
  assert.equal(anchors.length, 2);
  for (const [, href, attributes] of anchors) {
    const anchor = { target: '', dataset: { noSpa: /data-no-spa="true"/.test(attributes) ? 'true' : '' }, hasAttribute() { return false; }, getAttribute() { return href; } };
    const event = { button: 0, defaultPrevented: false, target: { closest() { return anchor; } }, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    clickHandler(event);
    assert.equal(event.defaultPrevented, false, `${href} follows normal document navigation`);
  }
  assert.equal(spaCalls, 0);
  const ordinaryAnchor = { target: '', dataset: {}, hasAttribute() { return false; }, getAttribute() { return '/to-rent'; } };
  const ordinaryEvent = { button: 0, defaultPrevented: false, target: { closest() { return ordinaryAnchor; } }, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
  clickHandler(ordinaryEvent);
  assert.equal(spaCalls, 1, 'unrelated links retain their existing SPA handling');
  assert.equal(ordinaryEvent.defaultPrevented, true);
});

function languageFixture(route, language = 'en', sourcePath = route) {
  const heading = { textContent: 'Student accommodation in Uganda', dataset: { ssrSeoH1: '1', ssrSeoPath: sourcePath, ssrSeoHeading: 'Student accommodation in Uganda', ssrSeoTitle: 'Student accommodation in Uganda | makaug.com' } };
  const document = { title: 'Student accommodation in Uganda | makaug.com', querySelector() { return heading; } };
  const context = vm.createContext({ document, window: { location: { pathname: route } }, currentLang: language, tr() { return 'Translated site title'; } });
  vm.runInContext([functionSource('normalizeRoutePath'), functionSource('preserveServerRenderedSeoHeading'), functionSource('setPageHeading')].join('\n'), context);
  // Execute the real title branch of applyLanguageUI, before unrelated UI work.
  const languageUi = declaration('applyLanguageUI');
  const firstOtherUi = languageUi.body.body.findIndex((node) => node.type === 'ExpressionStatement' && node.expression.callee?.name === 'setTextById');
  const titleStatements = languageUi.body.body.slice(0, firstOtherUi);
  assert.equal(titleStatements.at(-1).type, 'IfStatement');
  const titleCode = source.slice(titleStatements[0].start, titleStatements.at(-1).end);
  return { heading, document, context, applyTitle() { vm.runInContext(`{ ${titleCode} }`, context); } };
}

test('English initial SSR headings and hub titles survive language UI and hydration', () => {
  const fixture = languageFixture('/student-accommodation');
  fixture.applyTitle();
  vm.runInContext(`setPageHeading('page-students', 'Find your perfect student accommodation');`, fixture.context);
  assert.equal(fixture.document.title, 'Student accommodation in Uganda | makaug.com');
  assert.equal(fixture.heading.textContent, 'Student accommodation in Uganda');
  const trailingSlash = languageFixture('/student-accommodation/', 'en', '/student-accommodation');
  assert.equal(vm.runInContext('preserveServerRenderedSeoHeading(document.querySelector())', trailingSlash.context), true);
});

test('unrelated SPA paths and non-English translations keep their existing heading behavior', () => {
  const otherRoute = languageFixture('/to-rent', 'en', '/student-accommodation');
  otherRoute.applyTitle();
  vm.runInContext(`setPageHeading('page-students', 'Generic heading');`, otherRoute.context);
  assert.equal(otherRoute.document.title, 'Translated site title');
  assert.equal(otherRoute.heading.textContent, 'Generic heading');
  const luganda = languageFixture('/student-accommodation', 'lg');
  luganda.applyTitle();
  vm.runInContext(`setPageHeading('page-students', 'Luganda heading');`, luganda.context);
  assert.equal(luganda.document.title, 'Translated site title');
  assert.equal(luganda.heading.textContent, 'Luganda heading');
  const unmarked = languageFixture('/student-accommodation');
  delete unmarked.heading.dataset.ssrSeoH1;
  assert.equal(vm.runInContext('preserveServerRenderedSeoHeading(document.querySelector())', unmarked.context), false);
});

test('English to Luganda to English restores SSR title and H1 only on their canonical path', () => {
  const fixture = languageFixture('/student-accommodation');
  fixture.context.currentLang = 'lg';
  fixture.applyTitle();
  vm.runInContext(`setPageHeading('page-students', 'Luganda heading');`, fixture.context);
  assert.equal(fixture.document.title, 'Translated site title');
  assert.equal(fixture.heading.textContent, 'Luganda heading');
  fixture.context.currentLang = 'en';
  fixture.applyTitle();
  vm.runInContext(`setPageHeading('page-students', 'Generic English heading');`, fixture.context);
  assert.equal(fixture.document.title, 'Student accommodation in Uganda | makaug.com');
  assert.equal(fixture.heading.textContent, 'Student accommodation in Uganda');
  fixture.context.window.location.pathname = '/to-rent';
  fixture.applyTitle();
  vm.runInContext(`setPageHeading('page-students', 'Other route heading');`, fixture.context);
  assert.equal(fixture.document.title, 'Translated site title');
  assert.equal(fixture.heading.textContent, 'Other route heading');
});

test('SSR path marker identifies the current landing and frozen prices stay absent when the grid changes', () => {
  const route = '/to-rent/kyanja-kampala/apartments';
  const meta = publicSeoLandingMeta(resolvePublicSeoLanding(route), null, 'https://makaug.com', { count: 21, listings: [500000, 1000000, 5000000].map((price) => ({ price, price_period: 'month' })) });
  const shell = '<section id="page-rent"><h1>Rent</h1><div id="rent-grid"></div></section><footer></footer>';
  const { html } = renderCategorySeoHtml(shell, { meta, listings: [], baseUrl: 'https://makaug.com' });
  assert.match(html, /data-ssr-seo-path="\/to-rent\/kyanja-kampala\/apartments"/);
  const hydrated = replaceElementInnerHtml(html, 'rent-grid', '<article>One different current apartment</article>');
  assert.match(hydrated, /Before arranging a viewing/);
  assert.doesNotMatch(hydrated, /cards shown here|asking rent range|500k|5M/);
  const hub = categoryPageSeoMeta('/student-accommodation', null, 'https://makaug.com');
  const studentHtml = renderCategorySeoHtml('<section id="page-students"><h1>Students</h1><div id="student-grid"></div></section>', { meta: hub, listings: [], baseUrl: 'https://makaug.com' }).html;
  assert.match(studentHtml, /data-ssr-seo-path="\/student-accommodation"/);
});
