'use strict';

/**
 * C8 (10 Oct 2026, Marketing): after hydration the homepage badge read
 * "Uganda's #1 Free Property Platform" (tr("heroBadge")), while the SSR text
 * said "A property search engine for Uganda". The badge is now "Every property
 * in Uganda, in one place" in every language, and no locale claims "#1" or a
 * "Free Property Platform".
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const walk = require('acorn-walk');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const APP = read('assets/makaug-app.js');
const PACKS = fs.readdirSync(path.join(ROOT, 'assets', 'i18n')).filter((file) => /^site-[a-z]+\.json$/.test(file));
const NEW_KEY = 'Every property in Uganda, in one place';
const CLAIM = /#1(?![0-9a-f])|free property platform|Nambari 1|ቁጥር 1|رقم 1/i;

test('every locale in the app has the new heroBadge, and none claims #1 or a free property platform', () => {
  const badges = [...APP.matchAll(/^\s*heroBadge: "([^"]+)"/gm)].map((match) => match[1]);
  assert.equal(badges.length, 9, 'en, lg, sw, ac, ny, rn, sm, am, ar');
  assert.equal(badges[0], NEW_KEY);
  for (const badge of badges) assert.doesNotMatch(badge, CLAIM, badge);
  assert.ok(badges.includes('Buli property mu Uganda, mu kifo kimu'), 'Luganda');
  assert.ok(badges.includes('Kila mali nchini Uganda, mahali pamoja'), 'Swahili');
  assert.doesNotMatch(APP, /Uganda's #1 Free Property Platform/i);
});

test('actual language UI renders all nine badges and preserves unchanged icon/text markup', () => {
  const ast = acorn.parse(APP, { ecmaVersion: 'latest' });
  const declaration = (name) => {
    const node = ast.body.find((item) => item.type === 'FunctionDeclaration' && item.id.name === name);
    assert.ok(node, name); return APP.slice(node.start, node.end);
  };
  let markup = ''; let writes = 0;
  const badge = { get innerHTML() { return markup; }, set innerHTML(value) { markup = value; writes += 1; } };
  const context = vm.createContext({ document: { getElementById: (id) => id === 'hero-badge' ? badge : null, querySelector: () => null },
    window: { location: { pathname: '/' } }, currentLang: 'en', currentPage: 'home', currentTab: 'sale', authState: null });
  const apply = ast.body.find((item) => item.type === 'FunctionDeclaration' && item.id.name === 'applyLanguageUI');
  walk.simple(apply, { CallExpression(node) {
    if (node.callee.type === 'Identifier' && node.callee.name !== 'tr') context[node.callee.name] = (value) => value;
  } });
  context.preserveServerRenderedSeoHeading = () => false;
  vm.runInContext(APP.slice(APP.indexOf('const I18N_UI ='), APP.indexOf('const CONTENT_I18N =')) + '\n'
    + declaration('tr') + '\n' + declaration('applyLanguageUI'), context);
  for (const lang of ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar', 'en']) {
    context.currentLang = lang; context.applyLanguageUI();
    assert.equal(markup, `<i class="fas fa-check-circle text-green-300"></i> ${context.tr('heroBadge')}`);
    assert.doesNotMatch(markup, CLAIM, lang);
    const previousWrites = writes; context.applyLanguageUI(); assert.equal(writes, previousWrites, lang);
  }
});

test('every language pack has the new key, translated, and not the old one', () => {
  assert.equal(PACKS.length, 8);
  for (const file of PACKS) {
    const { phrases } = JSON.parse(read(`assets/i18n/${file}`));
    assert.ok(phrases[NEW_KEY] && phrases[NEW_KEY] !== NEW_KEY, `${file} translates the badge`);
    assert.ok(!Object.prototype.hasOwnProperty.call(phrases, "Uganda's #1 Free Property Platform"), `${file} drops the old key`);
    for (const [key, value] of Object.entries(phrases)) {
      assert.doesNotMatch(`${key} ${value}`, /Free Property Platform|#1 (?:free|property)/i, `${file}: ${key}`);
    }
  }
});

test('the server-rendered badge is the same text, so there is no flash; South Africa maps the new English', () => {
  assert.match(read('index.html'), /<i class="fas fa-check-circle text-green-300"><\/i> Every property in Uganda, in one place\n/);
  assert.match(read('packages/shared-country-core/south-africa.js'), /\.replace\(\/Every property in Uganda, in one place\/gi, "South Africa's home for property"\)/);
  for (const bundle of ['assets/build/makaug-app.min.js', 'assets/build/makaug-admin.min.js']) {
    assert.doesNotMatch(read(bundle), /Free Property Platform/, bundle);
  }
});
