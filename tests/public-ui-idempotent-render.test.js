'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const acorn = require('acorn');

const source = fs.readFileSync(require.resolve('../assets/makaug-app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest' });
function declaration(name, optional = false) {
  const node = ast.body.find((item) => item.type === 'FunctionDeclaration' && item.id.name === name);
  if (!node && optional) return '';
  assert.ok(node, name);
  return source.slice(node.start, node.end);
}

const decode = (text) => text.replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
function element(initialHtml = '') {
  let html = initialHtml, text = initialHtml.replace(/<[^>]*>/g, ''), value = '';
  const node = { dataset: {}, writes: 0, textWrites: 0, hidden: false, child: {},
    get innerHTML() { return html; },
    set innerHTML(next) { html = String(next).replace(/&#39;/g, "'"); node.child = {}; node.writes += 1; value = node.options[0]?.value || ''; },
    get textContent() { return text; },
    set textContent(next) { text = next == null ? '' : String(next); node.textWrites += 1; },
    get options() { return [...html.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map((match) => ({ value: decode(match[1]), textContent: decode(match[2]) })); },
    get value() { return value; },
    set value(next) { value = node.options.some((option) => option.value === String(next)) ? String(next) : ''; }
  };
  return node;
}
function contextFor(elements = {}, extra = {}) {
  const context = vm.createContext({
    String,
    document: { getElementById: (id) => elements[id] || null, createElement: () => element() },
    adminEscape: (text) => String(text).replace(/&/g, '&amp;').replace(/'/g, '&#39;'),
    ...extra
  });
  vm.runInContext(declaration('setHtmlIfChanged', true) + '\n' + [
    'setTextById', 'ensureRevenuePlacements', 'setHeroSelectOptions', 'heroOptionLabel', 'setHeroLocationFilter'
  ].map((name) => declaration(name)).join('\n'), context);
  return context;
}

test('same text leaves the existing text node intact and changed values still render', () => {
  const label = element('Search');
  const app = contextFor({ label });
  app.setTextById('label', 'Search');
  assert.equal(label.textWrites, 0);
  app.setTextById('label', 'Noonya');
  assert.equal(label.textContent, 'Noonya');
  assert.equal(label.textWrites, 1);
  app.setTextById('label', 'Noonya');
  assert.equal(label.textWrites, 1);
  app.setTextById('label', 0);
  assert.equal(label.textContent, '0');
  app.setTextById('label', null);
  app.setTextById('label', undefined);
  assert.equal(label.textContent, '');
  assert.equal(label.textWrites, 3);
  assert.doesNotThrow(() => app.setTextById('missing', 'Search'));
});

test('unchanged sponsored markup keeps its image node, including browser entity serialization', () => {
  const placement = element();
  let markup = "<img src=\"/sponsor.webp\"><p>Arthur&#39;s home</p>";
  const app = contextFor({ anchor: {}, 'revenue-placement-home': placement }, {
    INLINE_REVENUE_PLACEMENTS: [{ anchorId: 'anchor', slotKey: 'home', context: 'Home' }],
    buildRevenuePlacementMarkup: () => markup
  });
  app.ensureRevenuePlacements();
  const image = placement.child;
  app.ensureRevenuePlacements();
  app.ensureRevenuePlacements();
  assert.equal(placement.writes, 1);
  assert.equal(placement.child, image);
  assert.equal(placement.hidden, false);
  markup = '<img src="/updated.webp"><p>Updated</p>';
  app.ensureRevenuePlacements();
  assert.equal(placement.writes, 2);
  assert.notEqual(placement.child, image);
  placement.innerHTML = '<p>Changed externally</p>';
  app.ensureRevenuePlacements();
  assert.equal(placement.innerHTML, markup);
  markup = '';
  app.ensureRevenuePlacements();
  assert.equal(placement.hidden, true);
  assert.equal(placement.innerHTML, '');
});

test('a newly needed sponsorship still creates its placement and renders current content', () => {
  const elements = { anchor: { insertAdjacentElement(position, node) { assert.equal(position, 'afterend'); elements[node.id] = node; } } };
  const app = contextFor(elements, {
    INLINE_REVENUE_PLACEMENTS: [{ anchorId: 'anchor', slotKey: 'home', context: 'Home' }],
    buildRevenuePlacementMarkup: () => '<p>Sponsored</p>'
  });
  app.ensureRevenuePlacements();
  assert.equal(elements['revenue-placement-home'].innerHTML, '<p>Sponsored</p>');
  assert.equal(elements['revenue-placement-home'].dataset.revenuePlacement, 'home');
});

test('unchanged hero filters preserve their selected option and option nodes', () => {
  const select = element();
  let prefix = 'Any type';
  const app = contextFor({ type: select }, { tr: () => prefix });
  const options = [{ value: '', label: 'Any' }, { value: 'house', label: "Owner's house" }];
  app.setHeroSelectOptions('type', options, 'any');
  select.value = 'house';
  const originalOptions = select.child;
  app.setHeroSelectOptions('type', options, 'any');
  assert.equal(select.writes, 1);
  assert.equal(select.child, originalOptions);
  assert.equal(select.value, 'house');
  prefix = 'Ekika';
  app.setHeroSelectOptions('type', options, 'any');
  assert.equal(select.writes, 2);
  assert.equal(select.value, 'house');
  assert.equal(select.options[0].textContent, 'Ekika');
  app.setHeroSelectOptions('type', [{ value: '', label: 'Any' }, { value: 'land', label: 'Land' }], 'any');
  assert.equal(select.value, '');
  select.innerHTML = '<option value="broken">Changed externally</option>';
  app.setHeroSelectOptions('type', options, 'any');
  assert.deepEqual(select.options.map((option) => option.value), ['', 'house']);
});

test('sale and rent keep the same district choices while student and language changes update them', () => {
  const select = element();
  let lang = 'en';
  const app = contextFor({ 'hero-district': select }, {
    DISTRICTS: ['Kampala', 'Wakiso'], UGANDA_UNIVERSITIES: ['Makerere'],
    tr: (key) => `${lang}:${key}`
  });
  app.setHeroLocationFilter('sale');
  select.value = 'Wakiso';
  const districtOptions = select.child;
  app.setHeroLocationFilter('rent');
  assert.equal(select.writes, 1);
  assert.equal(select.child, districtOptions);
  assert.equal(select.value, 'Wakiso');
  app.setHeroLocationFilter('students');
  assert.equal(select.value, '');
  assert.deepEqual(select.options.map((option) => option.value), ['', 'Makerere']);
  select.value = 'Makerere';
  lang = 'lg';
  app.setHeroLocationFilter('students');
  assert.equal(select.value, 'Makerere');
  assert.equal(select.options[0].textContent, 'lg:anyUniversity');
  app.setHeroLocationFilter('sale');
  assert.equal(select.value, '');
  assert.deepEqual(select.options.map((option) => option.value), ['', 'Kampala', 'Wakiso']);
});
