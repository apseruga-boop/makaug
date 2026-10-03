'use strict';

// Every language must translate every string the site shows. The site-wide
// layer (assets/makaug-site-i18n.js) swaps English text for the visitor's
// language using the packs in assets/i18n; this test keeps the packs complete
// and checks the layer itself translates page text, titles and attributes.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const LANGS = ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar'];
const packs = Object.fromEntries(LANGS.map((lang) => [
  lang,
  JSON.parse(fs.readFileSync(path.join(root, 'assets', 'i18n', `site-${lang}.json`), 'utf8'))
]));

// 1. Every pack covers the same English keys and patterns, in the same order.
const reference = packs.am;
for (const lang of LANGS) {
  const pack = packs[lang];
  const missing = Object.keys(reference.phrases).filter((key) => !(key in pack.phrases));
  assert.deepStrictEqual(missing, [], `${lang} pack is missing phrases: ${missing.slice(0, 10).join(' | ')}`);
  assert.deepStrictEqual(pack.patterns.map((p) => p[0]), reference.patterns.map((p) => p[0]), `${lang} patterns must match the reference order`);
  pack.patterns.forEach(([regex, template]) => {
    const groups = new RegExp(`${regex}|`).exec('').length - 1;
    for (let i = 1; i <= groups; i += 1) {
      assert(template.includes(`{${i}}`), `${lang} pattern ${regex} must use {${i}}`);
    }
  });
}

// 2. The strings reported untranslated on 3 Oct 2026 are translated everywhere.
const mustTranslate = [
  'Off Plan', 'About Us', 'Properties', 'Featured Properties', 'Updated every morning',
  'Two fresh, checked listings from each property category across Uganda.',
  'Approved agent', 'Land title status pending', 'Houses for Sale', 'Houses for Rent',
  'Privacy Policy', 'Terms & Conditions', 'Help Centre', 'Safety Tips', 'Download brochure'
];
for (const lang of LANGS) {
  for (const key of mustTranslate) {
    const value = packs[lang].phrases[key];
    assert(value && value !== key, `${lang} must translate "${key}"`);
  }
}

// 3. The layer translates text, attributes and listing titles in a page.
function makeDom(lang) {
  const listeners = {};
  class Text { constructor(value, parent) { this.nodeType = 3; this.nodeValue = value; this.parentElement = parent; } }
  class El {
    constructor(tag, attrs = {}) { this.nodeType = 1; this.tagName = tag; this.attrs = { ...attrs }; this.children = []; }
    append(child) { child.parentElement = this; this.children.push(child); return child; }
    hasAttribute(name) { return name in this.attrs; }
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    matches() { return this.tagName === 'SCRIPT'; }
    closest(sel) { let node = this; while (node) { if (node.tagName === 'SCRIPT' && /script/.test(sel)) return node; node = node.parentElement; } return null; }
  }
  const body = new El('BODY');
  const html = new El('HTML', { lang });
  const document = {
    readyState: 'complete', body, documentElement: html, title: 'makaug', cookie: '',
    createTreeWalker(rootNode, _what, filter) {
      const nodes = [];
      const visit = (node) => node.children.forEach((child) => {
        if (child.nodeType === 1 && filter && filter.acceptNode(child) === 2) return;
        nodes.push(child);
        if (child.children) visit(child);
      });
      visit(rootNode);
      let i = -1;
      return { nextNode() { i += 1; return nodes[i] || null; } };
    },
    addEventListener() {}
  };
  return { document, body, El, Text, listeners };
}

async function runLayer(lang) {
  const dom = makeDom(lang);
  const nav = dom.body.append(new dom.El('A', { 'aria-label': 'About Us' }));
  const navText = nav.append(new dom.Text(' Off Plan ', nav));
  nav.children = [navText];
  const card = dom.body.append(new dom.El('H3'));
  const title = card.append(new dom.Text('6-bed house for sale in Kira, Wakiso', card));
  const script = dom.body.append(new dom.El('SCRIPT'));
  const code = script.append(new dom.Text('Off Plan', script));
  const window = {
    localStorage: { getItem: () => lang, setItem() {} },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    dispatchEvent() {},
    addEventListener() {}
  };
  const context = {
    window, document: dom.document, localStorage: window.localStorage,
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    MutationObserver: class { observe() {} takeRecords() { return []; } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    fetch: async () => ({ ok: true, json: async () => packs[lang] }),
    setTimeout, Promise, WeakMap, Set, Object, Array, String, Number, RegExp, JSON, Math
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets', 'makaug-site-i18n.js'), 'utf8'), context);
  await window.__makaugSiteI18n.apply();
  return { navText, nav, title, code, layer: window.__makaugSiteI18n };
}

(async () => {
  for (const lang of LANGS) {
    const result = await runLayer(lang);
    assert.strictEqual(result.navText.nodeValue.trim(), packs[lang].phrases['Off Plan'], `${lang}: nav text should be translated`);
    assert.strictEqual(result.nav.getAttribute('aria-label'), packs[lang].phrases['About Us'], `${lang}: aria-label should be translated`);
    assert(!/for sale in/.test(result.title.nodeValue), `${lang}: listing title should be translated by pattern, got ${result.title.nodeValue}`);
    assert(result.title.nodeValue.includes('Kira'), `${lang}: place names stay as they are`);
    assert.strictEqual(result.code.nodeValue, 'Off Plan', `${lang}: script contents are never touched`);
  }

  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert(/<script src="\/assets\/makaug-site-i18n\.js\?v=[^"]+" defer><\/script>/.test(html), 'every page loads the site language layer');
  const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
  assert(app.includes('function getCanonicalEnglishPropertyTitle'), 'non-English visitors get a translatable listing title');
  assert(app.includes('const fromSitePack = siteTranslate(text, lang);'), 'listing labels fall back to the site pack before English');
  console.log('site i18n coverage: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
