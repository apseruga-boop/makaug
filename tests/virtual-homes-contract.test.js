'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { sanitizePublicHtml } = require('../services/publicHtmlSanitizer');
const { adminRouter, publicRouter, staffRouter } = require('../routes/virtual-homes');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Virtual Homes routes, services, viewer pages and both manager dashboards are wired', () => {
  const server = read('server.js');
  const html = read('index.html');
  const app = read('assets/makaug-app.js');
  const routes = read('routes/virtual-homes.js');
  assert.match(server, /app\.use\('\/api\/virtual-homes', virtualHomesRoutes\)/);
  assert.match(server, /app\.use\('\/api\/staff\/virtual-homes', virtualHomesStaffRoutes\)/);
  assert.match(server, /app\.use\('\/api\/admin\/virtual-homes', virtualHomesAdminRoutes\)/);
  assert.match(server, /app\.get\('\/virtual-homes\/:slug'/);
  for (const id of ['page-services', 'page-virtual-homes', 'page-virtual-home', 'staff-virtual-homes-control', 'admin-virtual-homes-control']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(app, /hydratePropertyVirtualHome/);
  assert.match(app, /detail-virtual-home-slot/);
  assert.match(routes, /notifyVirtualHomeOrder\(order\)/);
  assert.match(routes, /commercial_enquiry_notification/);
});

test('public Virtual Homes HTML is route-specific and contains no production controls', () => {
  const output = sanitizePublicHtml(read('index.html'), { pathname: '/services/virtual-homes' });
  assert.match(output, /id="page-virtual-homes"[^>]*\bactive\b/);
  assert.doesNotMatch(output, /id="virtual-home-create-modal"/);
  assert.doesNotMatch(output, /Maka Virtual Homes production/);
  assert.doesNotMatch(output, /Virtual Homes control centre/);
  assert.doesNotMatch(output, /Admin API Key/);
});

test('database migration provides immutable sources, revisions, orders, listings, catalogue and event records', () => {
  const migration = read('db/migrations/124_virtual_homes.sql');
  for (const table of ['virtual_home_projects', 'virtual_home_assets', 'virtual_home_revisions', 'virtual_home_confidence_items', 'virtual_home_listing_links', 'virtual_home_commercial_products', 'virtual_home_orders', 'virtual_home_furniture_products', 'virtual_home_furniture_clicks', 'virtual_home_events']) assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(migration, /Original Virtual Home assets are immutable/);
  assert.match(migration, /MAKA_BRANDED_VIDEO[\s\S]*50000/);
  assert.match(migration, /WHITE_LABEL_VIDEO[\s\S]*80000/);
});

test('viewer has actual 3D modes, independent layers, managed video, exports and lite fallback', () => {
  const client = read('assets/virtual-homes.js');
  const route = read('routes/virtual-homes.js');
  assert.match(client, /import\('\/assets\/vendor\/three\.module\.min\.js'\)/);
  for (const value of ['walk', 'dollhouse', 'floor_plan', 'furnished', 'unfurnished', 'day', 'night']) assert.match(client, new RegExp(value));
  assert.match(client, /captureStream\(30\)/);
  assert.match(client, /video_exported/);
  assert.match(client, /litePlan/);
  assert.match(client, /\['json','svg','glb','zip'\]/);
  assert.match(route, /exportProject/);
});

test('all nine languages are wired and a language change refreshes the active Virtual Homes surface', () => {
  const client = read('assets/virtual-homes.js');
  const app = read('assets/makaug-app.js');
  for (const language of ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar']) assert.match(client, new RegExp(`(?:const EN|\\n    ${language}:)`));
  assert.match(app, /window\.applyVirtualHomeLanguageUI\(\)/);
});

test('staff is authenticated, while only King/admin receives final publish and catalogue controls', () => {
  assert.equal(staffRouter.stack[0]?.name, 'requireStaffAccess');
  assert.equal(adminRouter.stack[0]?.name, 'requireAdminApiKey');
  const paths = (router) => router.stack.map((layer) => layer.route?.path).filter(Boolean);
  assert.ok(paths(publicRouter).includes('/orders'));
  assert.ok(!paths(publicRouter).includes('/projects'));
  assert.ok(!paths(staffRouter).includes('/products/:key'));
  assert.ok(paths(adminRouter).includes('/products/:key'));
  assert.ok(paths(adminRouter).includes('/furniture/:key'));
});

test('off-plan and standard property detail surfaces can reuse only published Virtual Homes', () => {
  const offPlanService = read('services/offPlanService.js');
  const offPlanClient = read('assets/off-plan.js');
  const app = read('assets/makaug-app.js');
  assert.match(offPlanService, /p\.is_public = true/);
  assert.match(offPlanService, /p\.status = 'PUBLISHED'/);
  assert.match(offPlanClient, /Explore Virtual Home/);
  assert.match(app, /\/api\/virtual-homes\?property_id=/);
});
