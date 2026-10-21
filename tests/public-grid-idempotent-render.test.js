'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const acorn = require('acorn');

const source = fs.readFileSync(require.resolve('../assets/makaug-app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest' });
function declaration(name) {
  const node = ast.body.find((item) => item.type === 'FunctionDeclaration' && item.id.name === name);
  assert.ok(node, name);
  return source.slice(node.start, node.end);
}

function grid(initialHtml = '') {
  let html = initialHtml;
  function readCards() {
    return [...html.matchAll(/<article data-card="([^"]*)">([\s\S]*?)<\/article>/g)].map((match) => {
      const node = new EventTarget();
      node.id = match[1];
      const image = match[2].match(/<img src="([^"]*)" loading="([^"]*)">/);
      node.image = image ? { src: image[1], loading: image[2] } : null;
      return node;
    });
  }
  return { writes: 0, cards: readCards(),
    get innerHTML() { return html; },
    set innerHTML(next) {
      html = String(next).replace(/&#39;/g, "'");
      this.cards = readCards();
      this.writes += 1;
    },
    querySelector(selector) {
      assert.equal(selector, '[data-ssr-property-card]');
      return html.includes('data-ssr-property-card') ? {} : null;
    }
  };
}
function fixture(initialHtml = '', { loaded = true } = {}) {
  const node = grid(initialHtml);
  const cardCalls = [];
  const context = vm.createContext({
    String, publicListingsFromApiLoaded: loaded,
    document: { getElementById: (id) => id === 'home-grid' ? node : null },
    propCard(property, options) {
      cardCalls.push({ property, options });
      return `<article data-card="${property.id}"><img src="${property.image}" loading="${options.imageLoading}"><h3>${property.title}</h3><p>${property.price}</p></article>`;
    }
  });
  vm.runInContext(['setHtmlIfChanged', 'renderGrid', 'loadingPropertyGridHtml', 'noResultsCardForGrid'].map(declaration).join('\n'), context);
  return { node, cardCalls, context, render(rows, options) { context.renderGrid('home-grid', rows, options); } };
}
const rows = () => [
  { id: 'approved-1', title: 'Arthur&#39;s house', image: '/house.webp', price: 'USh 500k' },
  { id: 'approved-2', title: 'Apartment', image: '/apartment.webp', price: 'USh 750k' }
];

test('repeated catalogue or broker renders keep unchanged cards, images and attached click listeners', () => {
  const f = fixture();
  f.render(rows());
  const [card, secondCard] = f.node.cards;
  const image = card.image;
  let clicks = 0;
  card.addEventListener('click', () => { clicks += 1; });
  f.render(rows());
  assert.equal(f.node.writes, 1, 'unchanged output must not replace the grid DOM');
  assert.equal(f.node.cards[0], card);
  assert.equal(f.node.cards[1], secondCard);
  assert.equal(f.node.cards[0].image, image);
  f.node.cards[0].dispatchEvent(new Event('click'));
  assert.equal(clicks, 1);
  assert.equal(f.cardCalls.length, 4, 'the current property markup is still calculated on every render');
});

test('changed property content or ordering replaces the cards with the current output', () => {
  const f = fixture();
  f.render(rows());
  const oldCard = f.node.cards[0];
  const changed = rows();
  changed[0].title = 'Updated house';
  changed[0].price = 'USh 600k';
  f.render(changed);
  assert.equal(f.node.writes, 2);
  assert.notEqual(f.node.cards[0], oldCard);
  assert.match(f.node.innerHTML, /Updated house/);
  assert.match(f.node.innerHTML, /USh 600k/);
  f.render(changed.slice().reverse());
  assert.deepEqual(f.node.cards.map((card) => card.id), ['approved-2', 'approved-1']);
  assert.equal(f.node.cards[0].image.loading, 'eager');
  assert.equal(f.node.cards[1].image.loading, 'lazy');
});

test('card options and the first-image eager policy stay unchanged', () => {
  const f = fixture();
  f.render(rows(), { cardOptions: { student: true, categoryPage: 'students', imageLoading: 'lazy' } });
  assert.equal(f.cardCalls[0].options.student, true);
  assert.equal(f.cardCalls[1].options.categoryPage, 'students');
  assert.deepEqual(f.cardCalls.map((call) => call.options.imageLoading), ['eager', 'lazy']);
  assert.deepEqual(f.node.cards.map((card) => card.image.loading), ['eager', 'lazy']);
  assert.doesNotThrow(() => f.context.renderGrid('missing-grid', rows()));
});

test('pending catalogue data keeps SSR content and repeated loading placeholders stay untouched', () => {
  const ssr = '<article data-ssr-property-card="approved"><img src="/approved.webp"></article>';
  const existing = fixture(ssr, { loaded: false });
  existing.render([]);
  existing.render([]);
  assert.equal(existing.node.innerHTML, ssr);
  assert.equal(existing.node.writes, 0);
  const empty = fixture('', { loaded: false });
  empty.render([]);
  const loading = empty.node.innerHTML;
  assert.equal((loading.match(/animate-pulse/g) || []).length, 3);
  empty.render([]);
  assert.equal(empty.node.writes, 1);
  assert.equal(empty.node.innerHTML, loading);
  empty.context.publicListingsFromApiLoaded = true;
  empty.render([]);
  assert.equal(empty.node.writes, 2);
  assert.match(empty.node.innerHTML, /No exact matches yet/);
  empty.render([]);
  assert.equal(empty.node.writes, 2);
  empty.render(rows());
  assert.equal(empty.node.cards.length, 2);
});

test('externally changed grid content is restored from the current properties', () => {
  const f = fixture();
  f.render(rows());
  const expected = f.node.innerHTML;
  f.node.innerHTML = '<p>Stale content</p>';
  f.render(rows());
  assert.equal(f.node.innerHTML, expected);
  assert.equal(f.node.cards.length, 2);
});
