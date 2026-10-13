'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');

const source = fs.readFileSync(path.join(__dirname, '..', 'assets/makaug-app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
function declaration(name) {
  const node = ast.body.find((item) => item.type === 'FunctionDeclaration' && item.id.name === name);
  assert.ok(node, `${name} exists in the actual application`);
  return source.slice(node.start, node.end);
}
function escape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function images(html) { return [...html.matchAll(/<img\b[^>]*>/g)].map((match) => match[0]); }
function attribute(tag, name) { return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]; }

function fixture() {
  const grids = { 'home-brokers': { innerHTML: '' }, 'brokers-grid': { innerHTML: '', hidden: true } };
  const fetches = [];
  const mapCalls = [];
  const context = vm.createContext({
    document: { getElementById: (id) => grids[id] || null },
    adminAttr: escape,
    adminEscape: escape,
    adminListingIdArg: (id) => JSON.stringify(String(id)),
    brokerCompanyLineHtml: () => '',
    renderBrokerRegistrationBadge: () => '',
    brokerIconActionsHtml: (broker) => `<a href="/agents/${broker.id}">View profile</a>`,
    translateListingLabel: (label) => label,
    setBrokerMapMarkers: (rows) => mapCalls.push(rows.map((row) => row.id)),
    fetch(...args) { fetches.push(args); throw new Error('avatar rendering must not fetch'); },
    apiRequest(...args) { fetches.push(args); throw new Error('avatar rendering must not call an API'); }
  });
  vm.runInContext(`${declaration('brokerAvatarHtml')}\n${declaration('renderBrokers')}`, context);
  return { context, grids, fetches, mapCalls };
}

const broker = {
  id: 'kazi-1', name: 'Kazi & "Honest"', emoji: 'K&H',
  photo: 'https://media.example/portrait.jpg?a=1&b="two"',
  profile_photo_url: '/images/other-portrait.webp', area: 'Wakiso', listings: 6
};
const baseline = '<div class="w-14 h-14 rounded-full bg-green-50 border border-green-100 mx-auto overflow-hidden flex items-center justify-center text-2xl"><img src="https://media.example/portrait.jpg?a=1&amp;b=&quot;two&quot;" alt="Kazi &amp; &quot;Honest&quot;" class="w-full h-full object-cover" onerror="this.remove(); this.parentElement.textContent=\'K&amp;H\'"></div>';

test('default and eager avatar callers retain the exact existing escaped photo markup', () => {
  const f = fixture();
  for (const options of [undefined, {}, { imageLoading: 'eager' }, { imageLoading: 'auto' }]) {
    assert.equal(f.context.brokerAvatarHtml(broker, undefined, options), baseline);
  }
  assert.deepEqual(f.fetches, []);
});

test('only the explicit lazy option adds native lazy loading and asynchronous decoding', () => {
  const f = fixture();
  const html = f.context.brokerAvatarHtml(broker, undefined, { imageLoading: 'lazy' });
  const image = images(html)[0];
  assert.equal(attribute(image, 'loading'), 'lazy');
  assert.equal(attribute(image, 'decoding'), 'async');
  assert.equal(html.replace(/\s(?:loading="lazy"|decoding="async")/g, ''), baseline);
  assert.deepEqual(f.fetches, []);
});

test('profile-sized default callers retain geometry and profile-photo fallback without lazy hints', () => {
  const f = fixture();
  const html = f.context.brokerAvatarHtml({ name: 'Alice', profile_photo_url: '/images/alice.jpg', emoji: 'A' }, 'w-20 h-20 border-4');
  assert.equal(html, '<div class="w-20 h-20 border-4 rounded-full bg-green-50 border border-green-100 mx-auto overflow-hidden flex items-center justify-center text-2xl"><img src="/images/alice.jpg" alt="Alice" class="w-full h-full object-cover" onerror="this.remove(); this.parentElement.textContent=\'A\'"></div>');
  assert.equal(attribute(images(html)[0], 'loading'), undefined);
  assert.equal(attribute(images(html)[0], 'decoding'), undefined);
});

test('home and hidden directory lists defer every original portrait with existing labels, geometry and error fallback', () => {
  for (const id of ['home-brokers', 'brokers-grid']) {
    const f = fixture();
    f.context.renderBrokers(id, [broker, { id: 'alice-2', name: 'Alice', profile_photo_url: '/images/alice.jpg', area: 'Kampala', listings: 2 }]);
    const html = f.grids[id].innerHTML;
    const portraits = images(html);
    assert.equal(portraits.length, 2);
    assert.deepEqual(portraits.map((image) => attribute(image, 'loading')), ['lazy', 'lazy']);
    assert.deepEqual(portraits.map((image) => attribute(image, 'decoding')), ['async', 'async']);
    assert.deepEqual(portraits.map((image) => attribute(image, 'src')), ['https://media.example/portrait.jpg?a=1&amp;b=&quot;two&quot;', '/images/alice.jpg']);
    assert.deepEqual(portraits.map((image) => attribute(image, 'alt')), ['Kazi &amp; &quot;Honest&quot;', 'Alice']);
    assert.ok(portraits.every((image) => attribute(image, 'class') === 'w-full h-full object-cover'));
    assert.equal(attribute(portraits[0], 'onerror'), "this.remove(); this.parentElement.textContent='K&amp;H'");
    assert.equal(attribute(portraits[1], 'onerror'), "this.remove(); this.parentElement.textContent='👔'");
    assert.equal((html.match(/w-28 h-28 border-4 shadow-sm/g) || []).length, 2);
    assert.ok(html.includes('href="/agents/kazi-1"') && html.includes('href="/agents/alice-2"'));
    assert.deepEqual(f.fetches, []);
    assert.deepEqual(f.mapCalls, id === 'brokers-grid' ? [['kazi-1', 'alice-2']] : []);
  }
});

test('missing portraits retain the same emoji fallback in default, lazy and rendered-list modes', () => {
  const f = fixture();
  const withoutPhoto = { id: 'no-photo', name: 'No portrait', emoji: 'A', area: 'Wakiso', listings: 0 };
  const expected = '<div class="w-14 h-14 rounded-full bg-green-50 border border-green-100 mx-auto overflow-hidden flex items-center justify-center text-2xl">A</div>';
  assert.equal(f.context.brokerAvatarHtml(withoutPhoto), expected);
  assert.equal(f.context.brokerAvatarHtml(withoutPhoto, undefined, { imageLoading: 'lazy' }), expected);
  for (const id of ['home-brokers', 'brokers-grid']) {
    f.context.renderBrokers(id, [withoutPhoto]);
    assert.equal(images(f.grids[id].innerHTML).length, 0);
    assert.ok(f.grids[id].innerHTML.includes('text-2xl">A</div>'));
    assert.ok(f.grids[id].innerHTML.includes('href="/agents/no-photo"'));
  }
  assert.deepEqual(f.fetches, []);
});
