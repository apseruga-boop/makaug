'use strict';
// Self-hosted how-to videos on the home and About pages: off by default,
// per-language video pick with English fallback, draft labelling, placement.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const acorn = require('acorn');
const walk = require('acorn-walk');
const guides = require('../config/howToGuides');

const html = fs.readFileSync(require.resolve('../index.html'), 'utf8');
const app = fs.readFileSync(require.resolve('../assets/makaug-app.js'), 'utf8');
const server = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const appTree = acorn.parse(app, { ecmaVersion: 'latest' });

function appFunction(name) {
  const node = appTree.body.find((n) => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert.ok(node, name);
  return app.slice(node.start, node.end);
}

function configScript(env) {
  let handler;
  walk.simple(acorn.parse(server, { ecmaVersion: 'latest' }), { CallExpression(node) {
    if (node.callee.type === 'MemberExpression' && node.callee.object.name === 'app'
      && node.callee.property.name === 'get' && node.arguments[0]?.value === '/config.js') handler = node.arguments[1];
  } });
  assert.ok(handler);
  const context = vm.createContext({ process: { env },
    PRICE_PERIOD_FORM_OPTIONS: {}, PRICE_BOUNDS_UGX: {}, publicDisplayFx: () => ({}),
    publicHowToVideosConfig: guides.publicHowToVideosConfig, howToLocalDir: '', HOWTO_LOCAL_PREFIX: '/__howto-local' });
  let body;
  vm.runInContext(`(${server.slice(handler.start, handler.end)})`, context)({}, { type() {}, set() {}, send(v) { body = v; } });
  const window = {};
  vm.runInContext(body, vm.createContext({ window }));
  return JSON.parse(JSON.stringify(window.MAKAUG_HOWTO));
}

// A tiny DOM for renderHowToGuides.
function fakeElement(attrs = {}) {
  const classes = new Set(String(attrs.class || '').split(/\s+/).filter(Boolean));
  return {
    attrs, dataset: {}, innerHTML: '',
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    removeAttribute(name) { delete this.attrs[name]; },
    querySelectorAll() { return []; }, querySelector() { return null; }
  };
}

function render({ config, lang }) {
  const home = fakeElement({ class: 'mk-howto hidden', 'data-howto-guides': 'home', 'aria-hidden': 'true' });
  const about = fakeElement({ class: 'mk-howto hidden', 'data-howto-guides': 'about', 'aria-hidden': 'true' });
  const context = vm.createContext({
    window: { MAKAUG_HOWTO: config }, currentLang: lang, currentPage: 'home',
    document: { querySelectorAll: (sel) => (sel === '[data-howto-guides]' ? [home, about] : []), documentElement: { dir: lang === 'ar' ? 'rtl' : 'ltr' } }
  });
  for (const name of ['howToGuideEscape', 'howToGuideVideoLang', 'howToGuideMediaUrl', 'howToGuidesFor',
    'hideHowToGuideSection', 'loadHowToGuideVideo', 'wireHowToGuideSection', 'renderHowToGuides']) {
    vm.runInContext(appFunction(name), context);
  }
  vm.runInContext('renderHowToGuides()', context);
  return { home, about };
}

const ON = guides.publicHowToVideosConfig({ HOWTO_VIDEOS_ENABLED: 'true' });

test('flag is off by default: /config.js sends only enabled:false and the sections stay hidden', () => {
  assert.deepEqual(configScript({}), { enabled: false });
  assert.deepEqual(configScript({ HOWTO_VIDEOS_ENABLED: 'false', HOWTO_VIDEOS_BASE_URL: 'https://x.example' }), { enabled: false });
  const { home, about } = render({ config: { enabled: false }, lang: 'en' });
  for (const el of [home, about]) {
    assert.equal(el.innerHTML, '');
    assert.ok(el.classList.contains('hidden'));
    assert.equal(el.getAttribute('aria-hidden'), 'true');
  }
  const missing = render({ config: undefined, lang: 'en' });
  assert.equal(missing.home.innerHTML, '');
});

test('flag on: default base URL, custom base URL, unsafe base URL falls back', () => {
  const on = configScript({ HOWTO_VIDEOS_ENABLED: 'true' });
  assert.equal(on.enabled, true);
  assert.equal(on.baseUrl, 'https://media.makaug.com/howto/v1');
  assert.equal(configScript({ HOWTO_VIDEOS_ENABLED: '1', HOWTO_VIDEOS_BASE_URL: 'https://cdn.example/howto/v2/' }).baseUrl, 'https://cdn.example/howto/v2');
  assert.equal(configScript({ HOWTO_VIDEOS_ENABLED: 'on', HOWTO_VIDEOS_BASE_URL: 'javascript:alert(1)' }).baseUrl, 'https://media.makaug.com/howto/v1');
  assert.equal(guides.publicHowToVideosConfig({ HOWTO_VIDEOS_ENABLED: 'true' }, { localBaseUrl: '/__howto-local' }).baseUrl, '/__howto-local');
});

test('11 guides, each titled in all 9 site languages; headings in all 9', () => {
  assert.equal(guides.HOW_TO_GUIDES.length, 11);
  assert.deepEqual(guides.HOWTO_LANGUAGES, ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar']);
  for (const guide of guides.HOW_TO_GUIDES) {
    for (const lang of guides.HOWTO_LANGUAGES) assert.ok(String(guide.titles[lang] || '').trim(), `${guide.slug} ${lang}`);
    assert.match(guide.slug, /^[a-z-]+$/);
    assert.ok(guide.durationSeconds >= 30 && guide.durationSeconds <= 60, guide.slug);
  }
  for (const lang of guides.HOWTO_LANGUAGES) {
    const copy = guides.HOWTO_SECTION_COPY[lang];
    for (const key of ['eyebrow', 'title', 'sub', 'draft', 'englishCaptions']) assert.ok(copy?.[key], `${lang}.${key}`);
  }
  assert.equal(guides.ABOUT_GUIDE_ORDER.length, 11);
  assert.deepEqual([...guides.ABOUT_GUIDE_ORDER].sort(), guides.HOW_TO_GUIDES.map((g) => g.slug).sort());
  // English is never marked draft; machine-translated languages always are.
  assert.ok(!guides.HOWTO_DRAFT_LANGUAGES.includes('en'));
  for (const lang of ['lg', 'sw', 'am', 'ar']) assert.ok(guides.HOWTO_DRAFT_LANGUAGES.includes(lang), lang);
});

test('English renders 11 English videos with posters, lazy and muted, no draft note', () => {
  const { home, about } = render({ config: ON, lang: 'en' });
  assert.ok(!home.classList.contains('hidden'));
  assert.equal(home.getAttribute('aria-hidden'), null);
  assert.equal((home.innerHTML.match(/data-howto-guide="/g) || []).length, 11);
  assert.match(home.innerHTML, /data-howto-src="https:\/\/media\.makaug\.com\/howto\/v1\/en\/find-a-home\.mp4"/);
  assert.match(home.innerHTML, /data-howto-poster="https:\/\/media\.makaug\.com\/howto\/v1\/en\/find-a-home\.jpg"/);
  assert.match(home.innerHTML, /preload="none"/);
  assert.match(home.innerHTML, /\bmuted\b/);
  assert.match(home.innerHTML, /playsinline/);
  assert.doesNotMatch(home.innerHTML, /autoplay/);
  assert.equal((home.innerHTML.match(/data-howto-play aria-label="/g) || []).length, 11, "each card has a labelled play button");
  assert.doesNotMatch(home.innerHTML, /data-howto-note/);
  assert.match(home.innerHTML, /id="home-howto-videos-title"/);
  assert.match(about.innerHTML, /id="about-howto-videos-title"/);
  // About leads with "What makaug.com does".
  assert.ok(about.innerHTML.indexOf('data-howto-guide="what-makaug-does"') < about.innerHTML.indexOf('data-howto-guide="find-a-home"'));
  assert.ok(home.innerHTML.indexOf('data-howto-guide="find-a-home"') < home.innerHTML.indexOf('data-howto-guide="what-makaug-does"'));
});

test('language pick: lg/sw/am/ar get their own files and a draft label', () => {
  for (const lang of ['lg', 'sw', 'am', 'ar']) {
    const { home } = render({ config: ON, lang });
    assert.match(home.innerHTML, new RegExp(`/howto/v1/${lang}/ask-ai\\.mp4`), lang);
    assert.doesNotMatch(home.innerHTML, /\/howto\/v1\/en\//, lang);
    assert.match(home.innerHTML, /data-howto-note="draft"/, lang);
    assert.ok(home.innerHTML.includes(guides.HOWTO_SECTION_COPY[lang].title.replace(/'/g, '&#39;')), lang);
    assert.ok(home.innerHTML.includes(guides.HOW_TO_GUIDES[0].titles[lang].replace(/'/g, '&#39;')), lang);
  }
});

test('language pick: ac/ny/rn/sm fall back to the English video, with translated titles and an English-captions note', () => {
  for (const lang of ['ac', 'ny', 'rn', 'sm']) {
    const { home } = render({ config: ON, lang });
    assert.match(home.innerHTML, /\/howto\/v1\/en\/ask-ai\.mp4/, lang);
    assert.match(home.innerHTML, /data-howto-video-lang="en"/, lang);
    assert.match(home.innerHTML, /data-howto-note="english"/, lang);
    assert.ok(home.innerHTML.includes(guides.HOWTO_SECTION_COPY[lang].englishCaptions.replace(/'/g, '&#39;')), lang);
  }
  const unknown = render({ config: ON, lang: 'zz' });
  assert.match(unknown.home.innerHTML, /\/howto\/v1\/en\/find-a-home\.mp4/);
});

test('sections are placed on the home page and high on the About page; renders hook into language changes', () => {
  const home = html.indexOf('id="page-home"');
  const homeSection = html.indexOf('id="home-howto-videos"');
  const brokers = html.indexOf('id="home-brokers-title"');
  assert.ok(home > 0 && homeSection > home && homeSection < brokers);
  const about = html.indexOf('id="page-about"');
  const aboutSection = html.indexOf('id="about-howto-videos"');
  const mission = html.indexOf('aria-labelledby="about-mission-title"');
  assert.ok(about > 0 && aboutSection > about && aboutSection < mission, 'About videos sit above the mission block');
  for (const id of ['home-howto-videos', 'about-howto-videos']) {
    assert.match(html, new RegExp(`<section id="${id}" class="mk-howto[^"]*hidden[^"]*"[^>]*aria-hidden="true"></section>`));
  }
  assert.match(appFunction('setLang'), /renderHowToGuides\(\)/);
  assert.match(appFunction('renderHowToVideoSections'), /renderHowToGuides\(\)/);
  assert.match(server, /window\.renderHowToGuides\(\)/);
  assert.match(server, /NODE_ENV !== 'production' && String\(process\.env\.HOWTO_VIDEOS_LOCAL_DIR/);
});
