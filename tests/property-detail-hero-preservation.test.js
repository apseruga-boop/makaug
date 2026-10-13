'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets/makaug-app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
const declarations = new Map(ast.body.filter((node) => node.type === 'FunctionDeclaration').map((node) => [node.id.name, node]));
const ID = '56ec3ed3-3962-4aa1-aea1-4bf333279083';
const PHOTO = 'https://makaug.com/images/front.webp?quality=80&view=front';

function functionSource(name) {
  const node = declarations.get(name);
  assert.ok(node, `${name} must be present in the actual application`);
  return source.slice(node.start, node.end);
}

// This fixture implements only the DOM operations the hydration helper uses.
// Every mutation checks the original image's connection to the document. The
// browser trace separately verifies parsing, layout and resource loading.
function domFixture() {
  const mutations = [];
  let retained = [];
  let requireConnection = false;
  let allowSourceChange = false;
  let retainedImage;
  function audit(operation, node) {
    mutations.push({ operation, node });
    if (requireConnection) {
      for (const element of retained) assert.equal(element.isConnected, true, `${element.tagName} was disconnected during ${operation}`);
    }
  }
  function decode(value) {
    return value.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  class Element {
    constructor(tagName, attributes = {}) {
      this.tagName = tagName.toUpperCase();
      this.nodeType = 1;
      this.attrs = new Map(Object.entries(attributes));
      this.parentNode = null;
      this.childNodes = [];
      this.text = '';
      this.ownerDocument = document;
      this.classList = {
        toggle: (name, enabled) => {
          const classes = new Set((this.getAttribute('class') || '').split(/\s+/).filter(Boolean));
          if (enabled) classes.add(name); else classes.delete(name);
          this.setAttribute('class', [...classes].join(' '));
        },
        contains: (name) => (this.getAttribute('class') || '').split(/\s+/).includes(name)
      };
      this.dataset = new Proxy({}, {
        get: (_target, key) => this.getAttribute(`data-${String(key).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`) ?? undefined,
        set: (_target, key, value) => { this.setAttribute(`data-${String(key).replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, value); return true; }
      });
    }
    get children() { return this.childNodes; }
    get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
    get firstElementChild() { return this.children[0] || null; }
    get firstChild() { return this.childNodes[0] || null; }
    get nextSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null; }
    get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
    get isConnected() { return this === document.root || !!this.parentNode?.isConnected; }
    get id() { return this.getAttribute('id') || ''; }
    set id(value) { this.setAttribute('id', value); }
    get className() { return this.getAttribute('class') || ''; }
    set className(value) { this.setAttribute('class', value); }
    get src() { const src = this.getAttribute('src'); return src ? new URL(src, 'https://makaug.com').href : ''; }
    set src(value) { this.setAttribute('src', value); }
    get alt() { return this.getAttribute('alt') || ''; }
    set alt(value) { this.setAttribute('alt', value); }
    get textContent() { return this.text + this.childNodes.map((node) => node.textContent).join(''); }
    set textContent(value) { for (const child of [...this.childNodes]) this.removeChild(child); this.text = String(value); audit('textContent', this); }
    get innerHTML() { return this.text + this.childNodes.map((node) => node.outerHTML).join(''); }
    set innerHTML(html) {
      for (const child of [...this.childNodes]) this.removeChild(child);
      this.text = '';
      const parsed = parseHtml(html);
      for (const child of [...parsed.childNodes]) this.appendChild(child);
      audit('innerHTML', this);
    }
    get outerHTML() {
      return `<${this.tagName.toLowerCase()}${this.attributes.map(({ name, value }) => ` ${name}="${value}"`).join('')}>${this.innerHTML}</${this.tagName.toLowerCase()}>`;
    }
    getAttribute(name) { return this.attrs.get(name) ?? null; }
    hasAttribute(name) { return this.attrs.has(name); }
    setAttribute(name, value) {
      if (requireConnection && !allowSourceChange && this === retainedImage && name === 'src') assert.fail('matching initial hero src must not be rewritten');
      this.attrs.set(name, String(value));
      audit(`setAttribute:${name}`, this);
    }
    removeAttribute(name) { this.attrs.delete(name); audit(`removeAttribute:${name}`, this); }
    appendChild(node) {
      if (node.nodeType === 11) { for (const child of [...node.childNodes]) this.appendChild(child); return node; }
      if (node.parentNode) node.parentNode.removeChild(node);
      this.childNodes.push(node); node.parentNode = this; audit('appendChild', node); return node;
    }
    append(...nodes) { for (const node of nodes) this.appendChild(node); }
    insertBefore(node, before) {
      if (!before) return this.appendChild(node);
      if (node.parentNode) node.parentNode.removeChild(node);
      const index = this.childNodes.indexOf(before); assert.notEqual(index, -1);
      this.childNodes.splice(index, 0, node); node.parentNode = this; audit('insertBefore', node); return node;
    }
    removeChild(node) {
      const index = this.childNodes.indexOf(node); assert.notEqual(index, -1);
      this.childNodes.splice(index, 1); node.parentNode = null; audit('removeChild', node); return node;
    }
    remove() { this.parentNode?.removeChild(this); }
    replaceChild(next, old) { this.insertBefore(next, old); this.removeChild(old); return old; }
    replaceWith(next) { this.parentNode?.replaceChild(next, this); }
    replaceChildren(...nodes) { for (const child of [...this.childNodes]) this.removeChild(child); this.append(...nodes); }
    contains(node) { return this === node || this.childNodes.some((child) => child.contains(node)); }
    matches(selector) {
      const tag = selector.match(/^[a-z][a-z0-9-]*/i)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const id = selector.match(/#([a-z0-9_-]+)/i)?.[1];
      if (id && this.id !== id) return false;
      const attrs = [...selector.matchAll(/\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]/g)];
      return attrs.every(([, name, value]) => this.hasAttribute(name) && (value === undefined || this.getAttribute(name) === value));
    }
    querySelectorAll(selector) {
      const result = [];
      for (const child of this.childNodes) {
        if (child.matches(selector)) result.push(child);
        result.push(...child.querySelectorAll(selector));
      }
      return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const document = {
    root: null,
    createElement(tag) {
      if (tag !== 'template') return new Element(tag);
      const template = { content: null };
      Object.defineProperty(template, 'innerHTML', { set: (html) => { template.content = parseHtml(html); } });
      return template;
    },
    getElementById(id) { return this.root.id === id ? this.root : this.root.querySelector(`#${id}`); },
    querySelector(selector) { return this.root.querySelector(selector); },
    querySelectorAll(selector) { return this.root.querySelectorAll(selector); }
  };
  function parseHtml(html) {
    const fragment = new Element('fragment'); fragment.nodeType = 11;
    const stack = [fragment];
    for (const token of String(html).match(/<[^>]*>|[^<]+/g) || []) {
      if (/^<\//.test(token)) { stack.pop(); continue; }
      if (token.startsWith('<')) {
        const tag = token.match(/^<([a-z0-9-]+)/i)?.[1]; if (!tag) continue;
        const attributes = {};
        for (const [, name, double, single, bare] of token.matchAll(/\s([\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attributes[name] = decode(double ?? single ?? bare ?? '');
        const element = new Element(tag, attributes);
        stack.at(-1).appendChild(element);
        if (!['img', 'input', 'source', 'link', 'meta', 'br', 'hr'].includes(tag.toLowerCase()) && !token.endsWith('/>')) stack.push(element);
      } else stack.at(-1).text += decode(token);
    }
    return fragment;
  }
  return {
    document, parseHtml, mutations,
    retain(nodes, image) { retained = nodes; retainedImage = image; requireConnection = true; },
    allowImageSourceChange() { allowSourceChange = true; },
    stopAuditingConnection() { requireConnection = false; }
  };
}

function escapeAttr(value) { return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
function initialHtml({ ssrId = ID, heroId = ID, src = PHOTO } = {}) {
  return `<article data-detail-layout data-ssr-property-detail="${ssrId}" class="old-layout"><div data-detail-main class="old-main"><nav>Old breadcrumbs</nav><div data-detail-card class="old-card"><button data-detail-hero class="old-hero"><img data-ssr-detail-hero="${heroId}" src="${escapeAttr(src)}" alt="Server title" width="1200" height="675"><span>Old count</span></button><section id="old-description">Old description</section></div></div></article>`;
}
function clientHtml({ src = PHOTO, hero = true } = {}) {
  return `<div data-detail-layout class="new-layout"><div data-detail-main class="new-main"><div data-detail-card class="new-card">${hero ? `<button data-detail-hero type="button" onclick="openDetailGalleryLightbox(detailGalleryPhotoIndex)" class="new-hero"><img id="detail-gallery-hero-img" src="${escapeAttr(src)}" alt="Front exterior" class="new-image" loading="eager" decoding="async" fetchpriority="high"><span id="detail-gallery-count-label">1/2 Photos</span></button>` : '<video id="detail-gallery-hero-video"></video>'}<section id="new-thumbnails">Two gallery thumbnails</section><section id="new-description">Fresh public description</section></div><section id="new-map">Property map</section></div><aside id="new-contact">Public contact details</aside></div><nav id="new-mobile-contact">Call the lister</nav>`;
}

function fixture(options = {}) {
  const dom = domFixture();
  dom.document.root = dom.document.createElement('main');
  dom.document.root.id = 'detail-content';
  dom.document.root.innerHTML = options.initialMarkup || initialHtml(options);
  const old = Object.fromEntries(['layout', 'main', 'card', 'hero'].map((key) => [key, dom.document.root.querySelector(`[data-detail-${key}]`)]));
  old.image = old.hero.querySelector('img');
  const context = vm.createContext({
    URL,
    currentLang: options.language || 'en',
    window: { location: { origin: 'https://makaug.com', href: `https://makaug.com/property/${ID}`, pathname: options.pathname || `/property/${ID}` } },
    document: dom.document
  });
  // Helpers are discovered from the actual declaration's direct call graph.
  // Network, application initialization and unrelated UI functions never run.
  const loaded = new Set();
  function load(name) {
    if (loaded.has(name)) return;
    loaded.add(name);
    const node = declarations.get(name);
    assert.ok(node, `${name} exists`);
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (value.type === 'CallExpression' && value.callee.type === 'Identifier' && declarations.has(value.callee.name)) load(value.callee.name);
      for (const child of Object.values(value)) {
        if (Array.isArray(child)) child.forEach(visit); else if (child && typeof child === 'object') visit(child);
      }
    }
    visit(node.body);
    vm.runInContext(functionSource(name), context);
  }
  load('renderPropertyDetailContent');
  return { ...dom, context, old, content: dom.document.root, render(html = clientHtml(), overrides = {}) {
    return context.renderPropertyDetailContent(html, { propertyId: ID, selectedPhotoSrc: PHOTO, preserveInitialHero: true, ...overrides });
  } };
}

test('matching initial English detail retains the whole connected hero chain while updating the full page', () => {
  const f = fixture();
  f.retain(Object.values(f.old), f.old.image);
  assert.equal(f.render(), true);
  for (const key of ['layout', 'main', 'card', 'hero']) assert.strictEqual(f.content.querySelector(`[data-detail-${key}]`), f.old[key]);
  assert.strictEqual(f.content.querySelector('#detail-gallery-hero-img'), f.old.image);
  assert.equal(f.old.image.src, PHOTO);
  assert.equal(f.old.image.alt, 'Front exterior');
  assert.equal(f.old.hero.getAttribute('onclick'), 'openDetailGalleryLightbox(detailGalleryPhotoIndex)');
  assert.equal(f.old.image.getAttribute('fetchpriority'), 'high');
  assert.equal(f.content.querySelector('#detail-gallery-count-label').textContent, '1/2 Photos');
  assert.equal(f.content.querySelector('#new-description').textContent, 'Fresh public description');
  assert.equal(f.content.querySelector('#new-contact').textContent, 'Public contact details');
  assert.equal(f.content.querySelector('#new-mobile-contact').textContent, 'Call the lister');
  assert.equal(f.content.querySelectorAll('#detail-gallery-hero-img').length, 1);
  assert.equal(f.content.querySelector('#old-description'), null);
  assert.ok(f.mutations.length > 0);
});

test('absolute SSR and equivalent relative client image URLs reuse without rewriting the original src', () => {
  const f = fixture();
  f.retain(Object.values(f.old), f.old.image);
  assert.equal(f.render(clientHtml({ src: '/images/front.webp?quality=80&view=front' }), { selectedPhotoSrc: '/images/front.webp?quality=80&view=front' }), true);
  assert.strictEqual(f.content.querySelector('#detail-gallery-hero-img'), f.old.image);
  assert.equal(f.old.image.getAttribute('src'), PHOTO);
});

test('the actual SSR renderer produces a compatible connected hero with its original priority hints', () => {
  const { renderPropertySeoHtml } = require('../services/publicSeoRenderService');
  const result = renderPropertySeoHtml('<main id="detail-content"></main>', {
    id: ID, listing_type: 'rent', title: 'Two bedroom home', description: 'Quiet home close to local shops.',
    area: 'Kireka', district: 'Wakiso', price: 500000, price_period: 'month', primary_image_url: PHOTO
  }, { baseUrl: 'https://makaug.com' });
  const initialMarkup = result.html.slice(result.html.indexOf('>') + 1, result.html.lastIndexOf('</main>'));
  const f = fixture({ initialMarkup });
  assert.equal(f.old.image.getAttribute('loading'), 'eager');
  assert.equal(f.old.image.getAttribute('decoding'), 'async');
  assert.equal(f.old.image.getAttribute('fetchpriority'), 'high');
  assert.equal(f.old.image.getAttribute('data-ssr-detail-hero'), ID);
  f.retain(Object.values(f.old), f.old.image);
  assert.equal(f.render(), true);
  assert.strictEqual(f.content.querySelector('#detail-gallery-hero-img'), f.old.image);
  assert.equal(f.old.image.src, PHOTO);
  assert.equal(f.content.querySelector('#new-description').textContent, 'Fresh public description');
});

test('stale route, language, identity, image and caller opt-out each replace the page with current content', () => {
  const variants = [
    { fixture: { pathname: '/property/different-id' } },
    { fixture: { pathname: `/property/${ID}/different` } },
    { fixture: { pathname: '/to-rent' } },
    { fixture: { language: 'lg' } },
    { fixture: { ssrId: 'different-id' } },
    { fixture: { heroId: 'different-id' } },
    { fixture: { src: 'https://makaug.com/images/old.webp' } },
    { html: clientHtml({ src: 'https://makaug.com/images/new.webp' }) },
    { options: { selectedPhotoSrc: 'https://makaug.com/images/different.webp' } },
    { options: { preserveInitialHero: false } },
    { html: clientHtml({ hero: false }) }
  ];
  for (const variant of variants) {
    const f = fixture(variant.fixture);
    assert.equal(f.render(variant.html, variant.options), false, JSON.stringify(variant));
    assert.equal(f.old.image.isConnected, false);
    assert.equal(f.content.querySelector('#new-description').textContent, 'Fresh public description');
    assert.equal(f.content.querySelector('#new-mobile-contact').textContent, 'Call the lister');
    assert.equal(f.content.querySelector('#old-description'), null);
  }
});

test('missing markers or a broken direct ancestor chain prevent reuse', () => {
  const variants = [
    (f) => f.old.main.removeAttribute('data-detail-main'),
    (f) => f.old.layout.removeAttribute('data-detail-layout'),
    (f) => f.old.card.removeAttribute('data-detail-card'),
    (f) => f.old.hero.removeAttribute('data-detail-hero'),
    (f) => f.old.image.removeAttribute('data-ssr-detail-hero'),
    (f) => { const wrapper = f.document.createElement('div'); f.old.hero.replaceWith(wrapper); wrapper.appendChild(f.old.hero); }
  ];
  for (const change of variants) {
    const f = fixture();
    change(f);
    assert.equal(f.render(), false);
    assert.equal(f.old.image.isConnected, false);
    assert.equal(f.content.querySelector('#new-description').textContent, 'Fresh public description');
  }
});

test('initial preservation is consumed and a later hydration cannot reuse stale SSR identity', () => {
  const f = fixture();
  f.retain(Object.values(f.old), f.old.image);
  assert.equal(f.render(), true);
  f.stopAuditingConnection();
  assert.equal(f.render(clientHtml({ src: '/images/updated-front.webp' }), { selectedPhotoSrc: '/images/updated-front.webp' }), false);
  assert.equal(f.old.image.isConnected, false);
  assert.equal(f.content.querySelector('#detail-gallery-hero-img').src, 'https://makaug.com/images/updated-front.webp');
  assert.equal(f.content.querySelector('#new-description').textContent, 'Fresh public description');
});

test('the actual openDetail call excludes video/source-only, private-preview and admin replacement paths', () => {
  let call;
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'renderPropertyDetailContent') call = node;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(declarations.get('openDetail').body);
  assert.ok(call, 'openDetail must invoke the actual renderer');
  for (const [flags, expected] of [
    [{ hidePhotoGallery: false, isOwnerPreviewViewer: false, isAdminViewer: false }, true],
    [{ hidePhotoGallery: true, isOwnerPreviewViewer: false, isAdminViewer: false }, false],
    [{ hidePhotoGallery: false, isOwnerPreviewViewer: true, isAdminViewer: false }, false],
    [{ hidePhotoGallery: false, isOwnerPreviewViewer: false, isAdminViewer: true }, false]
  ]) {
    let received;
    const context = vm.createContext({
      ...flags, p: { id: 'ui-alias', backend_id: ID }, detailHtml: '<main>Current details</main>', selectedPhotoSrc: PHOTO,
      renderPropertyDetailContent(html, options) { received = { html, ...options }; }
    });
    vm.runInContext(source.slice(call.start, call.end), context);
    assert.deepEqual(received, { html: '<main>Current details</main>', propertyId: ID, selectedPhotoSrc: PHOTO, preserveInitialHero: expected });
  }
});

test('gallery selection updates the retained image, caption and active thumbnail without replacing the image', () => {
  const f = fixture();
  f.retain(Object.values(f.old), f.old.image);
  assert.equal(f.render(), true);
  f.allowImageSourceChange();
  const thumbnails = f.content.querySelector('#new-thumbnails');
  thumbnails.innerHTML = '<button data-detail-gallery-thumb="0" class="border-green-500" aria-current="true"></button><button data-detail-gallery-thumb="1" class="border-gray-200" aria-current="false"></button>';
  Object.assign(f.context, {
    activeDetailPropertyId: ID,
    detailGalleryPhotos: [{ url: PHOTO, room_label: 'Front exterior' }, { url: '/images/kitchen.webp', room_label: 'Kitchen' }],
    detailGalleryPhotoIndex: 0,
    findPropertyForUi: () => ({ id: ID, title: 'Two bedroom home' }),
    publicImageSrc: (url) => url,
    getDisplayPhotoLabel: (photo) => photo.room_label,
    translateListingLabel: (label) => label
  });
  vm.runInContext(functionSource('selectDetailGalleryPhoto'), f.context);
  f.context.selectDetailGalleryPhoto(1);
  assert.strictEqual(f.content.querySelector('#detail-gallery-hero-img'), f.old.image);
  assert.equal(f.old.image.src, 'https://makaug.com/images/kitchen.webp');
  assert.equal(f.old.image.alt, 'Kitchen');
  assert.equal(f.content.querySelector('#detail-gallery-count-label').textContent, '2/2 Photos');
  assert.deepEqual(f.content.querySelectorAll('[data-detail-gallery-thumb]').map((button) => button.getAttribute('aria-current')), ['false', 'true']);
  f.context.selectDetailGalleryPhoto(-1);
  assert.equal(f.old.image.src, PHOTO);
  assert.equal(f.content.querySelector('#detail-gallery-count-label').textContent, '1/2 Photos');
  f.context.selectDetailGalleryPhoto('invalid');
  assert.equal(f.old.image.src, PHOTO);
  f.context.selectDetailGalleryPhoto(99);
  assert.equal(f.old.image.src, 'https://makaug.com/images/kitchen.webp');
  assert.equal(f.content.querySelector('#detail-gallery-count-label').textContent, '2/2 Photos');
});

test('the actual client gallery template keeps its hero eager and defers original thumbnail URLs', () => {
  const templates = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'TemplateLiteral' && node.quasis.some((part) => part.value.raw.includes('id="detail-gallery-hero-img"'))) templates.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(declarations.get('openDetail').body);
  const template = templates.sort((a, b) => (a.end - a.start) - (b.end - b.start))[0];
  assert.ok(template, 'the actual photo gallery template must exist');
  const photos = [
    { url: PHOTO, name: 'Front exterior', room_label: 'Front exterior' },
    { url: '/images/kitchen.webp', name: 'Kitchen', room_label: 'Kitchen' },
    { url: '/images/bedroom.webp', name: 'Bedroom', room_label: 'Bedroom' }
  ];
  const context = vm.createContext({
    adminAttr: escapeAttr,
    selectedPhotoSrc: PHOTO,
    selectedPhoto: photos[0],
    detailGalleryPhotoIndex: 0,
    detailGalleryPhotos: photos,
    p: { id: ID, title: 'Two bedroom home' },
    displayTitle: 'Two bedroom home',
    photoCountLabel: 'Photos',
    getDisplayPhotoLabel: (photo) => photo.room_label,
    translatePropertyUi: (label) => label,
    publicImageSrc: (url) => url
  });
  const html = vm.runInContext(`(${source.slice(template.start, template.end)})`, context);
  const dom = domFixture();
  const gallery = dom.parseHtml(html);
  const hero = gallery.querySelector('#detail-gallery-hero-img');
  assert.equal(hero.getAttribute('src'), PHOTO);
  assert.equal(hero.getAttribute('loading'), 'eager');
  assert.equal(hero.getAttribute('decoding'), 'async');
  assert.equal(hero.getAttribute('fetchpriority'), 'high');
  const thumbnails = gallery.querySelectorAll('[data-detail-gallery-thumb]').map((button) => button.querySelector('img'));
  assert.deepEqual(thumbnails.map((image) => image.getAttribute('src')), [PHOTO, '/images/kitchen.webp', '/images/bedroom.webp']);
  assert.deepEqual(thumbnails.map((image) => image.getAttribute('loading')), ['lazy', 'lazy', 'lazy']);
  assert.deepEqual(thumbnails.map((image) => image.getAttribute('decoding')), ['async', 'async', 'async']);
});
