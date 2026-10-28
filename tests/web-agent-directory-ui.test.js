'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const source = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
const parsed = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
function fn(name) {
  const node = parsed.body.find((item) => item.type === 'FunctionDeclaration' && item.id?.name === name);
  assert.ok(node, name); return source.slice(node.start, node.end);
}

function browserDirectory(initial, response) {
  return new Function('initial', 'response', `
    let REMOTE_BROKERS = initial, REMOTE_BROKER_DIRECTORY_IDS = new Set(initial.map(row => row.id));
    let remoteBrokersLoaded = true, brokerDirectoryDeferTimer = 0;
    const BROKERS = [], window = { location: { pathname: '/brokers' } };
    const apiRequest = async () => response;
    const mapRemoteAgentForUi = row => ({ ...row, public_summary: null, listings_page: null,
      short_path: '', listing_price_min: null, listing_price_max: null, experience_years: 0,
      makaug_agent_number: '', created_at: '', email: row.email || '' });
    const populateBrokerFilterOptions = () => {}, renderAll = () => {}, setBrokerMapMarkers = () => {}, refreshOpenPropertyContact = () => {};
    ${fn('getBrokerDirectory')}
    ${fn('findBrokerById')}
    ${fn('findBrokerByIdIncludingLoadedProfile')}
    ${fn('refreshBrokersFromApi')}
    ${fn('rememberPropertyBookingAgent')}
    return { refresh: () => refreshBrokersFromApi(), directory: getBrokerDirectory,
      remember: rememberPropertyBookingAgent, profile: findBrokerByIdIncludingLoadedProfile,
      visit: row => REMOTE_BROKERS.push(row) };
  `)(initial, response);
}

test('fresh directory removes cached empty profiles and replaces stale contact, badge and count fields', async () => {
  const summary = { about: ['Full profile biography'], video_tours: 2 };
  const remoteListings = [{ id: 'property-1' }];
  const browser = browserDirectory([
    { id: 'live', name: 'Old name', status: 'approved', email: 'private@agency.com', verified_by_makaug: true,
      listings: 20, remote_profile_loaded: true, remote_listings: remoteListings, public_summary: summary,
      listings_page: { page: 1, total: 20 }, short_path: '/a/agent', listing_price_min: 100,
      listing_price_max: 900, experience_years: 7, makaug_agent_number: 'MK-A-1', created_at: '2024-01-01' },
    { id: 'reviewed-empty', listings: 0, remote_profile_loaded: true }
  ], { data: [{ id: 'live', name: 'Current name', status: 'approved', profile_kind: 'unclaimed', listings: 1, verified_by_makaug: false }] });
  assert.equal(await browser.refresh(), true);
  assert.deepEqual(browser.directory().map((row) => row.id), ['live']);
  const current = browser.directory()[0];
  assert.equal(current.name, 'Current name'); assert.equal(current.email, '');
  assert.equal(current.verified_by_makaug, false); assert.equal(current.listings, 1);
  assert.equal(current.profile_kind, 'unclaimed'); assert.equal(current.remote_profile_loaded, true);
  assert.equal(current.public_summary, summary); assert.equal(current.remote_listings, remoteListings);
  assert.equal(current.listings_page.total, 20); assert.equal(current.short_path, '/a/agent');
  assert.equal(current.listing_price_min, 100); assert.equal(current.listing_price_max, 900);
  assert.equal(current.experience_years, 7); assert.equal(current.makaug_agent_number, 'MK-A-1');
});

test('visiting a reviewed empty profile or property booking after refresh never adds a directory card', async () => {
  const browser = browserDirectory([], { data: [{ id: 'live', listings: 1 }] });
  await browser.refresh();
  browser.visit({ id: 'reviewed-empty', listings: 0, remote_profile_loaded: true });
  browser.remember({ id: 'property-contact-only', listings: 3 });
  assert.ok(browser.profile('reviewed-empty'), 'a fetchable profile stays usable by direct URL');
  assert.ok(browser.profile('property-contact-only'), 'property contact cache remains available');
  assert.deepEqual(browser.directory().map((row) => row.id), ['live']);
});

test('King separates agent approval from public visibility and shows the server count and reason', () => {
  const helpers = new Function(`const adminEscape = value => String(value); ${fn('adminAgentManagerChip')}
    ${fn('adminAgentManagerStatusChip')} ${fn('adminAgentManagerPublicVisibility')}
    return { status: adminAgentManagerStatusChip, visibility: adminAgentManagerPublicVisibility };`)();
  assert.match(helpers.status({ status: 'approved' }), />Approved</);
  assert.doesNotMatch(helpers.status({ status: 'approved' }), />Live</);
  const hidden = helpers.visibility({ status: 'approved', live_listings: 10, public_live_listings: 0,
    web_directory_visible: false, web_directory_reason: 'No live public properties' });
  assert.match(hidden, /Not on public site/); assert.match(hidden, /No live public properties/);
  assert.match(hidden, /0 public listings/);
  const live = helpers.visibility({ public_live_listings: 1, web_directory_visible: true,
    web_directory_reason: 'Approved agent with live public properties' });
  assert.match(live, />On public site</); assert.match(live, /1 public listing</);
});
