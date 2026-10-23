'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const acorn = require('acorn');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest' });
const fn = (name) => ast.body.find((node) => node.type === 'FunctionDeclaration' && node.id && node.id.name === name);
const code = (name) => {
  const node = fn(name);
  assert.ok(node, name);
  return source.slice(node.start, node.end);
};

const PROPERTY_ID = '6927c520-ca3f-4f45-8004-d562d119cac0';
const AGENT_ID = '5674f6cb-37a0-4e1e-904f-06e03ec401ab';
const property = { id: PROPERTY_ID, agent: AGENT_ID };
const francis = { id: AGENT_ID, full_name: 'Francis Isabirye' };

function harness(apiRequest) {
  const paints = [];
  const context = {
    BROKERS: [],
    REMOTE_BROKERS: [],
    remoteBrokersLoaded: false,
    currentPage: 'detail',
    activeDetailPropertyId: PROPERTY_ID,
    detailPaintedBrokerId: '',
    detailRenderSerial: 0,
    detailAgentLookupId: '',
    paints,
    apiRequest,
    mapRemoteAgentForUi: (agent) => ({ id: agent.id, name: agent.full_name || agent.name }),
    populateBrokerFilterOptions() {},
    renderAll() {},
    setBrokerMapMarkers() {},
    toast() {},
    findPropertyForUi: () => property,
    shouldUseSourceOnlyContact: () => false,
    foundOnlineSourceMeta: () => null
  };
  context.openDetail = () => {
    const broker = context.resolvedDetailBroker(property);
    context.detailPaintedBrokerId = broker?.id ? String(broker.id) : '';
    paints.push(broker ? `Contact Broker ${broker.name}` : 'Contact Lister');
    return true;
  };
  vm.createContext(context);
  vm.runInContext([
    code('getBrokerDirectory'),
    code('findBrokerById'),
    code('findBrokerByIdIncludingLoadedProfile'),
    code('beginDetailRender'),
    code('detailRenderIsCurrent'),
    code('resolvedDetailBroker'),
    code('refreshOpenPropertyContact'),
    code('scheduleDetailAgentLookup'),
    code('refreshBrokersFromApi')
  ].join('\n'), context);
  return context;
}

test('a cold property open repaints the contact card when the broker directory arrives', async () => {
  const context = harness(async (url) => {
    assert.match(url, /\/api\/agents\?status=approved/);
    return { data: [francis] };
  });
  context.paints.push('Contact Lister');
  await vm.runInContext('refreshBrokersFromApi({ silent: true })', context);
  assert.deepEqual(context.paints, ['Contact Lister', 'Contact Broker Francis Isabirye']);
  assert.equal(context.detailPaintedBrokerId, AGENT_ID);
});

test('a warm property open does not paint the contact card again', async () => {
  const context = harness(async () => ({ data: [francis] }));
  context.REMOTE_BROKERS = [{ id: AGENT_ID, name: 'Francis Isabirye' }];
  context.remoteBrokersLoaded = true;
  context.detailPaintedBrokerId = AGENT_ID;
  context.paints.push('Contact Broker Francis Isabirye');
  await vm.runInContext('refreshBrokersFromApi({ silent: true })', context);
  assert.deepEqual(context.paints, ['Contact Broker Francis Isabirye']);
});

test('a single agent lookup repaints when the directory does not include the broker', async () => {
  const context = harness(async (url) => {
    assert.match(url, new RegExp(`/api/agents/${AGENT_ID}$`));
    return { data: francis };
  });
  context.paints.push('Contact Lister');
  vm.runInContext(`scheduleDetailAgentLookup(${JSON.stringify(AGENT_ID)})`, context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(context.paints, ['Contact Lister', 'Contact Broker Francis Isabirye']);
});

test('a newer detail render wins over a cold paint that finishes late', () => {
  const context = harness(async () => ({ data: [] }));
  vm.runInContext('beginDetailRender()', context);
  const second = vm.runInContext('beginDetailRender()', context);
  assert.equal(vm.runInContext('detailRenderIsCurrent(1)', context), false);
  assert.equal(vm.runInContext(`detailRenderIsCurrent(${second})`, context), true);
});

test('openDetail resolves the broker after hydration and ignores a stale paint', () => {
  const openDetail = code('openDetail');
  const guard = openDetail.indexOf('if (!detailRenderIsCurrent(renderSerial) || !p) return false;');
  const lookup = openDetail.indexOf('const broker = resolvedDetailBroker(p) || brokerFromPropertyAgent(p);');
  const paintGuard = openDetail.lastIndexOf('if (!detailRenderIsCurrent(renderSerial)) return false;');
  const paint = openDetail.indexOf('renderPropertyDetailContent(');
  assert.ok(openDetail.includes('const renderSerial = beginDetailRender();'));
  assert.ok(guard > 0 && lookup > guard && paintGuard > lookup && paint > paintGuard);
  assert.match(openDetail, /detailPaintedBrokerId = broker\?\.id \? String\(broker\.id\) : "";/);
  assert.match(openDetail, /brokerFromPropertyAgent\(p\)/);
  assert.match(openDetail, /mountPropertyBookingPanel\(/);
  assert.doesNotMatch(openDetail, /scheduleDetailAgentLookup\(p\.agent \|\| p\.agent_id\)/);
  assert.match(code('refreshBrokersFromApi'), /refreshOpenPropertyContact\(\)/);
});

test('the booking step has one label, a full-width select, and a price line', () => {
  const markup = code('agentBookingPlaceMarkup');
  const options = code('agentBookingPlaceOptions');
  const labels = code('agentBookingPlaceStepLabel');
  assert.match(labels, /Choose the property you want to view/);
  assert.match(labels, /Choose the property you're asking about/);
  assert.match(labels, /Choose the property your question is about/);
  assert.match(labels, /Choose the property you want to make an offer on/);
  assert.match(markup, /agent-booking-step-label/);
  assert.match(markup, /class="agent-booking-place"/);
  assert.match(markup, /agent-booking-place-line/);
  assert.doesNotMatch(markup, />Choose a property</);
  assert.doesNotMatch(options, /Choose a property/);
  assert.match(code('agentBookingPlaceChoice'), /image_url|price/);
  const css = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(css, /select\.agent-booking-place/);
  assert.match(css, /inline-size:\s*100%/);
  const route = fs.readFileSync(path.join(root, 'routes/agents.js'), 'utf8');
  assert.match(route, /img\.url AS image_url/);
  assert.match(route, /price: row\.price/);
});

test('every site language translates the booking step labels', () => {
  const keys = [
    'Choose the property you want to view',
    "Choose the property you're asking about",
    'Choose the property your question is about',
    'Choose the property you want to make an offer on',
    'No properties yet'
  ];
  for (const lang of ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar']) {
    const pack = JSON.parse(fs.readFileSync(path.join(root, 'assets/i18n', `site-${lang}.json`), 'utf8'));
    for (const key of keys) {
      assert.ok(pack.phrases[key] && pack.phrases[key] !== key, `${lang} translates ${key}`);
    }
  }
});
