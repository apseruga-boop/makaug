'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const { sanitizePublicHtml } = require('../services/publicHtmlSanitizer');
const source = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const tree = acorn.parse(source, { ecmaVersion: 'latest' });
const names = ['ensureDetailGalleryLightbox', 'renderDetailGalleryLightbox', 'openDetailGalleryLightbox',
  'closeDetailGalleryLightbox', 'selectDetailGalleryPhoto', 'shiftDetailGalleryPhoto', 'openModal', 'closeModal', 'syncModalOpenState'];
const functions = tree.body.filter(node => node.type === 'FunctionDeclaration' && names.includes(node.id.name))
  .map(node => source.slice(node.start, node.end)).join('\n');
const photos = [{ url: 'https://media.example/front.jpg?size=original', name: 'Front', location_label: 'Kyanja' },
  { url: 'https://media.example/bedroom.jpg', name: 'Bedroom', location_label: 'Kyanja' }];

function fixture({ existing = false, rows = photos, route = '/property/fixture-id' } = {}) {
  const nodes = new Map(), appended = [], messages = [];
  const decode = text => text.replace(/&amp;/g, '&').replace(/&quot;/g, '"');
  let document;
  function register(node) { node.attached = true; if (node.id) nodes.set(node.id, node); node.children.forEach(register); }
  class Element {
    constructor(tag, attrs = {}) {
      this.tagName = tag.toUpperCase(); this.attrs = { ...attrs }; this.children = []; this.attached = false;
      this.classes = new Set(String(attrs.class || '').split(/\s+/).filter(Boolean));
      this.classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name),
        contains: name => this.classes.has(name), toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) };
      this.dataset = {}; this.textContent = ''; this._html = '';
    }
    get id() { return this.attrs.id || ''; } set id(value) { this.attrs.id = value; }
    get className() { return [...this.classes].join(' '); } set className(value) { this.classes = new Set(value.split(/\s+/)); }
    get src() { return this.attrs.src; } set src(value) { this.attrs.src = value; }
    get alt() { return this.attrs.alt; } set alt(value) { this.attrs.alt = value; }
    getAttribute(name) { return this.attrs[name] ?? null; }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    removeAttribute(name) { delete this.attrs[name]; }
    get innerHTML() { return this._html; }
    set innerHTML(value) {
      this._html = String(value); this.children = [];
      for (const [, tag, attributes] of this._html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
        const attrs = {};
        for (const [, key, double, single, bare] of attributes.matchAll(/([\w:-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[key] = decode(double ?? single ?? bare ?? '');
        const child = new Element(tag, attrs); this.children.push(child); if (this.attached) register(child);
      }
    }
    querySelector(selector) {
      if (selector === 'h3') return this.children.find(node => node.tagName === 'H3') || null;
      if (selector.startsWith('#')) return this.children.find(node => node.id === selector.slice(1)) || null;
      const attr = selector.match(/^\[([^\]]+)\]$/)?.[1];
      return attr ? this.children.find(node => Object.hasOwn(node.attrs, attr)) || null : null;
    }
  }
  const body = new Element('body');
  body.appendChild = node => { appended.push(node); register(node); return node; };
  document = { body, createElement: tag => new Element(tag), getElementById: id => nodes.get(id) || null,
    querySelector: selector => selector === '.modal-overlay.open' ? [...nodes.values()].find(node => node.classes.has('modal-overlay') && node.classes.has('open')) || null : null,
    querySelectorAll: selector => selector === '[data-detail-gallery-thumb]' ? [...nodes.values()].filter(node => Object.hasOwn(node.attrs, 'data-detail-gallery-thumb')) : [] };
  if (existing) {
    const modal = new Element('div', { id: 'detail-photo-modal', class: 'modal-overlay' });
    const start = html.indexOf('<div id="detail-photo-modal"');
    modal.innerHTML = html.slice(start, html.indexOf('\n  <script>', start));
    // The static outer div is the fixture's modal, not an additional child.
    modal.children = modal.children.filter(node => node.id !== 'detail-photo-modal');
    body.appendChild(modal);
  }
  register(new Element('img', { id: 'detail-gallery-hero-img', src: photos[0].url }));
  register(new Element('span', { id: 'detail-gallery-count-label' }));
  for (const index of [0, 1]) register(new Element('button', { id: `hero-thumb-${index}`, 'data-detail-gallery-thumb': String(index) }));
  const context = vm.createContext({ document, window: { location: { pathname: route } },
    detailGalleryPhotos: rows.map(row => ({ ...row })), detailGalleryPhotoIndex: 0, activeDetailPropertyId: 'fixture-id', currentLang: 'en',
    findPropertyForUi: () => ({ id: 'fixture-id', title: 'Kyanja home' }),
    getDisplayPhotoLabel: (photo) => photo.name,
    translateListingLabel: text => `${context.currentLang}:${text}`, translatePropertyUi: text => `${context.currentLang}:${text}`,
    publicImageSrc: url => url,
    adminAttr: value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;'),
    toast: text => messages.push(text)
  });
  vm.runInContext(functions, context);
  return { context, document, nodes, body, appended, messages };
}

test('sanitized direct and SPA property pages create the gallery only on the first real photo click', () => {
  for (const route of ['/property/fixture-id', '/property/another-fixture']) {
    assert.doesNotMatch(sanitizePublicHtml(html, { pathname: route }), /id="detail-photo-modal"/);
    const f = fixture({ route });
    assert.equal(f.appended.length, 0);
    f.context.openDetailGalleryLightbox(0);
    const modal = f.document.getElementById('detail-photo-modal');
    assert.ok(modal, 'the first click creates missing public gallery UI');
    assert.equal(modal.classList.contains('open'), true);
    assert.equal(f.body.classList.contains('modal-open'), true);
    assert.equal(f.document.getElementById('detail-photo-image').src, photos[0].url);
    assert.match(f.document.getElementById('detail-photo-caption').textContent, /1\/2 - Front • Kyanja/);
    assert.equal(f.appended.length, 1);
  }
});

test('next/previous, thumbnail reopening and close use the original photo array and existing modal behavior', () => {
  const f = fixture();
  f.context.openDetailGalleryLightbox();
  const modal = f.document.getElementById('detail-photo-modal');
  assert.ok(modal);
  f.context.shiftDetailGalleryPhoto(1);
  assert.equal(f.document.getElementById('detail-photo-image').src, photos[1].url);
  assert.match(f.document.getElementById('detail-photo-thumbs').innerHTML, /openDetailGalleryLightbox\(1\)/);
  f.context.shiftDetailGalleryPhoto(1);
  assert.equal(f.document.getElementById('detail-photo-image').src, photos[0].url);
  f.context.openDetailGalleryLightbox(1);
  assert.equal(f.document.getElementById('detail-photo-image').src, photos[1].url);
  f.context.closeDetailGalleryLightbox();
  assert.equal(modal.classList.contains('open'), false);
  assert.equal(f.body.classList.contains('modal-open'), false);
  assert.equal(f.appended.length, 1);
  f.context.selectDetailGalleryPhoto(0);
  assert.equal(f.document.getElementById('detail-gallery-hero-img').src, photos[0].url);
  assert.equal(f.nodes.get('hero-thumb-0').getAttribute('aria-current'), 'true');
  f.context.openDetailGalleryLightbox(0);
  assert.equal(f.appended.length, 1);
});

test('existing protected/static modal is reused without duplicate IDs or another append', () => {
  const f = fixture({ existing: true });
  const modal = f.document.getElementById('detail-photo-modal');
  f.context.openDetailGalleryLightbox(1);
  assert.strictEqual(f.document.getElementById('detail-photo-modal'), modal);
  assert.equal(f.appended.length, 1);
  assert.equal(f.document.getElementById('detail-photo-image').src, photos[1].url);
});

test('empty, video-only or source-only filtered galleries do not create or open a modal', () => {
  const f = fixture({ rows: [] });
  f.context.openDetailGalleryLightbox();
  assert.equal(f.appended.length, 0);
  assert.equal(f.document.getElementById('detail-photo-modal'), null);
  assert.equal(f.messages.length, 1);
});

test('reopening after a language change refreshes the existing gallery heading and photo label', () => {
  const f = fixture();
  f.context.openDetailGalleryLightbox();
  assert.ok(f.document.getElementById('detail-photo-modal'));
  assert.equal(f.document.getElementById('detail-photo-modal').querySelector('h3').textContent, 'en:Gallery');
  f.context.closeDetailGalleryLightbox();
  f.context.currentLang = 'lg';
  f.context.openDetailGalleryLightbox(1);
  assert.equal(f.document.getElementById('detail-photo-modal').querySelector('h3').textContent, 'lg:Gallery');
  assert.equal(f.document.getElementById('detail-photo-image').alt, 'lg:Photo');
  assert.equal(f.appended.length, 1);
});
