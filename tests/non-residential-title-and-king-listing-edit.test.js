'use strict';

// 13 Nov 2026 (Arthur, Benard Gaita's Transformer listing MK-20261111-9D6051):
// 1. A 6-acre warehouse typed commercial_land with bedrooms=6 showed
//    "6-bed commercial land for sale in Transformer". Land, plots, offices,
//    shops and warehouses never get a bed count in a title.
// 2. The agent page sent the stored title ("Commercial property in
//    Transformer") while the property page built its own, so the open listing
//    did not match any card on the agent's page. Both use the same title now.
// 3. King → Agents → Manage → Edit changes a listing through the staff
//    live-edit save, with an audit entry.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const copy = require('../services/publicListingCopy');

const TRANSFORMER = {
  title: 'Commercial property in Transformer',
  listing_type: 'commercial',
  property_type: 'commercial_land',
  bedrooms: 6,
  area: 'Transformer',
  district: 'Nakaseke',
  transaction_type: 'sale',
  extra_fields: {}
};

test('land, plots, offices, shops and warehouses never get N-bed in a title', () => {
  assert.equal(copy.cleanListingTitle(TRANSFORMER), 'Commercial land for sale in Transformer');
  for (const property_type of ['commercial_land', 'office', 'shop_retail', 'warehouse_industrial', 'Land', 'Residential Plot', 'warehouse']) {
    for (const listing_type of ['commercial', 'sale', 'rent']) {
      const title = copy.factualListingTitle({ ...TRANSFORMER, listing_type, property_type, bedrooms: 7 });
      assert.doesNotMatch(title, /\d+-bed/i, `${listing_type}/${property_type}: ${title}`);
    }
  }
  assert.doesNotMatch(copy.factualListingTitle({ ...TRANSFORMER, listing_type: 'land', property_type: null }), /-bed/);
  assert.equal(copy.listingCarriesBedrooms({ listing_type: 'commercial', property_type: 'commercial_land' }), false);
});

test('homes and hotels keep their bed count', () => {
  assert.equal(copy.factualListingTitle({ listing_type: 'sale', property_type: 'house', bedrooms: 4, area: 'Kira' }), '4-bed house for sale in Kira');
  assert.match(copy.factualListingTitle({ listing_type: 'rent', property_type: 'apartment', bedrooms: 2, area: 'Ntinda' }), /^2-bed apartment for rent/);
  assert.equal(copy.listingCarriesBedrooms({ listing_type: 'commercial', property_type: 'hospitality' }), true);
  assert.equal(copy.listingCarriesBedrooms({ listing_type: 'sale', property_type: 'house on a plot' }), true);
});

test('a title typed by staff or the King is the public title', () => {
  const typed = { ...TRANSFORMER, title: '6 acres with a warehouse for sale in Mukono', extra_fields: { staff_corrected_fields: ['title'] } };
  assert.equal(copy.cleanListingTitle(typed), '6 acres with a warehouse for sale in Mukono');
});

test('the SPA title builders use the same bedroom rule', () => {
  const app = read('assets', 'makaug-app.js');
  assert.match(app, /function listingShowsBedrooms\(property = \{\}\)/);
  const uses = app.match(/listingShowsBedrooms\((?:property|p)\)/g) || [];
  assert.ok(uses.length >= 5, `title builders and cards check it (found ${uses.length})`);
});

test('the agent page listing title is the property page title', () => {
  const agents = read('routes', 'agents.js');
  assert.match(agents, /title: agentProfileListingTitle\(row\)/);
  assert.match(agents, /cleanListingTitle\(row\)/);
  const select = read('services', 'agentListingCount.js');
  assert.match(select, /p\.transaction_type,/);
});

function mountManager({ row, audits, saves }) {
  const manager = require('../routes/adminAgentManager');
  const staff = require('../routes/staff');
  staff.updateStaffEditableListing = async (req, id, patch) => {
    saves.push({ id, patch, actor: req.userAuth?.id || null });
    return { changed_fields: Object.keys(patch) };
  };
  const router = express.Router();
  manager.registerAgentManagerRoutes(router, {
    db: { query: async (sql) => (/FROM properties WHERE id = \$1/.test(sql) ? { rows: row ? [row] : [] } : { rows: [] }) },
    writeAudit: async (action, details, actor) => { audits.push({ action, details, actor }); },
    adminActorId: () => '11111111-1111-4111-8111-111111111111',
    cleanText: (v) => String(v || '').trim(),
    isValidEmail: () => true,
    normalizePhone: (v) => v,
    actorLabel: () => 'King',
    onListingsChanged: () => {}
  });
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

async function patch(app, id, body) {
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/agent-manager/listings/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
  }
}

const LISTING_ID = '000f79c1-ca94-44e8-a25c-994d93c7b0a2';

test('King Manage → Edit saves through the staff live edit and is audited', async () => {
  const audits = [];
  const saves = [];
  const app = mountManager({ row: { id: LISTING_ID, agent_id: 'a', status: 'approved', listing_type: 'commercial', property_type: 'commercial_land', moderation_stage: 'approved' }, audits, saves });
  const res = await patch(app, LISTING_ID, { title: '6 acres with a warehouse for sale in Mukono', bedrooms: null, area: 'Mukono', not_allowed: 'x' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(Object.keys(saves[0].patch).sort(), ['area', 'bedrooms', 'title']);
  assert.equal(audits[0].action, 'admin_agent_listing_edited');
  assert.deepEqual(audits[0].details.changed_fields.sort(), ['area', 'bedrooms', 'title']);
  assert.equal(audits[0].details.status_kept, 'approved');
});

test('King edit refuses bedrooms on land or warehouses, empty titles and deleted rows', async () => {
  const base = { id: LISTING_ID, agent_id: 'a', status: 'approved', listing_type: 'commercial', property_type: 'commercial_land' };
  const saves = [];
  let res = await patch(mountManager({ row: base, audits: [], saves }), LISTING_ID, { bedrooms: 6 });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'bedrooms_on_non_residential');
  res = await patch(mountManager({ row: base, audits: [], saves }), LISTING_ID, { title: '  ' });
  assert.equal(res.status, 400);
  res = await patch(mountManager({ row: { ...base, status: 'deleted' }, audits: [], saves }), LISTING_ID, { title: 'x y z' });
  assert.equal(res.status, 409);
  res = await patch(mountManager({ row: null, audits: [], saves }), LISTING_ID, { title: 'x y z' });
  assert.equal(res.status, 404);
  res = await patch(mountManager({ row: { ...base, property_type: 'house', listing_type: 'sale' }, audits: [], saves }), LISTING_ID, { bedrooms: 4 });
  assert.equal(res.status, 200);
  assert.equal(saves.length, 1, 'only the valid edit reached the save');
});

test('Manage rows have an Edit form that sends only changed fields', () => {
  const app = read('assets', 'makaug-app.js');
  assert.match(app, /data-listing-action="edit"/);
  assert.match(app, /function adminAgentManagerListingEditForm\(l = \{\}\)/);
  assert.match(app, /\/api\/admin\/agent-manager\/listings\/\$\{encodeURIComponent\(propertyId\)\}`, \{ method: "PATCH"/);
  for (const name of ['title', 'description', 'price', 'listing_type', 'property_type', 'area', 'district', 'bedrooms']) {
    assert.match(app, new RegExp(`name="\\$\\{name\\}"|"${name}"`), name);
  }
});

test('the server-rendered page title has no bed count for land or warehouses either', () => {
  const seo = require('../services/publicSeoRenderService');
  const title = seo.propertySeoTitle({ ...TRANSFORMER, price: 2300000000 });
  assert.doesNotMatch(title, /\d+\s*(?:bdrm|-bed)/i, title);
  const house = seo.propertySeoTitle({ title: 'x', listing_type: 'sale', property_type: 'house', bedrooms: 4, area: 'Kira', district: 'Wakiso', transaction_type: 'sale', price: 400000000 });
  assert.match(house, /^4bdrm /, house);
});
