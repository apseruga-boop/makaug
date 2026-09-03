'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { sanitizePublicHtml } = require('../services/publicHtmlSanitizer');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('navigation places Off Plan after Land and before Find Brokers', () => {
  const html = read('index.html');
  for (const prefix of ['nav-', 'mnav-']) {
    const land = html.indexOf(`id="${prefix}land"`);
    const offPlan = html.indexOf(`id="${prefix}off-plan"`);
    const brokers = html.indexOf(`id="${prefix}brokers"`);
    assert.ok(land >= 0 && offPlan > land && brokers > offPlan);
  }
  assert.ok(html.indexOf('id="hero-tab-off-plan"') > html.indexOf('id="hero-tab-land"'));
  assert.match(html, /id="desktop-primary-nav" class="hidden xl:flex/);
});

test('public route, project detail route, API and protected dashboards are wired', () => {
  const app = read('assets/makaug-app.js');
  const server = read('server.js');
  const route = read('routes/off-plan.js');
  const html = read('index.html');
  assert.match(app, /"off-plan": "\/off-plan"/);
  assert.ok(app.includes('if (/^\\/off-plan\\/[a-z0-9-]+$/i.test(normalized)) return "off-plan";'));
  assert.match(server, /app\.use\('\/api\/off-plan', offPlanRoutes\)/);
  assert.match(server, /app\.use\('\/api\/staff\/off-plan', offPlanStaffRoutes\)/);
  assert.match(server, /app\.use\('\/api\/admin\/off-plan', offPlanAdminRoutes\)/);
  assert.match(route, /mountManagementRoutes\(staffRouter, requireStaffAccess\)/);
  assert.match(route, /mountManagementRoutes\(adminRouter, requireAdminApiKey\)/);
  assert.match(html, /id="staff-off-plan-control"/);
  assert.match(html, /id="admin-off-plan-control"/);
});

test('public Off Plan HTML keeps customer contact but strips staff creation controls', () => {
  const publicHtml = sanitizePublicHtml(read('index.html'), { pathname: '/off-plan' });
  assert.match(publicHtml, /id="page-off-plan"[^>]*\bactive\b/);
  assert.match(publicHtml, /id="off-plan-contact-modal"/);
  assert.doesNotMatch(publicHtml, /id="off-plan-create-modal"/);
  assert.doesNotMatch(publicHtml, /Staff review only/);
});

test('supplied project is seeded for review and cannot leak into public queries', () => {
  const migration = read('db/migrations/118_off_plan_developments.sql');
  const service = read('services/offPlanService.js');
  assert.match(migration, /'entebbe-victoria-palms'/);
  assert.match(migration, /'Mackenzie'/);
  assert.match(migration, /'pending_review'[\s\S]*'needs_verification'/);
  assert.match(migration, /"price_original":108000/);
  assert.match(migration, /"price_original":144000/);
  assert.match(migration, /"price_original":177000/);
  assert.match(migration, /"price_ugx":null/g);
  assert.match(service, /d\.status = 'published'/);
  assert.match(service, /d\.verification_status = 'verified'/);
  assert.match(service, /Use the review status action to publish a verified project/);
});

test('brochure, payment, gallery, map, sharing, video and mortgage handoff are visible', () => {
  const html = read('index.html');
  const client = read('assets/off-plan.js');
  const route = read('routes/off-plan.js');
  assert.match(html, /id="page-off-plan"/);
  assert.match(client, /Download brochure/);
  assert.match(client, /calculateOffPlanPayments/);
  assert.match(client, /openstreetmap\.org/);
  assert.match(client, /shareOffPlan\('whatsapp'\)/);
  assert.match(client, /Project video/);
  assert.match(client, /mortgage calculator/);
  assert.match(route, /brochure\.pdf/);
});

test('contact workflow has all channels and exact operations recipients', () => {
  const html = read('index.html');
  const notifications = read('services/offPlanNotificationService.js');
  const route = read('routes/off-plan.js');
  assert.match(html, /data-off-plan-channel="whatsapp"/);
  assert.match(html, /data-off-plan-channel="email"/);
  assert.match(html, /data-off-plan-channel="call"/);
  for (const email of ['admin@makaug.com', 'arthur@makaug.com', 'ronald@makaug.com']) assert.match(notifications, new RegExp(email.replace('.', '\\.')));
  assert.match(route, /I would like to enquire about listing a new off-plan project/);
  assert.match(route, /requestedDevelopmentId/);
  assert.match(route, /status = 'published' AND verification_status = 'verified'/);
});

test('website and WhatsApp AI recognize off-plan search and listing requests', () => {
  const ai = read('services/aiService.js');
  const aiRoute = read('routes/ai.js');
  const whatsapp = read('routes/whatsapp.js');
  assert.match(ai, /'off_plan_search'/);
  assert.match(ai, /'off_plan_listing'/);
  assert.match(aiRoute, /assistantIsOffPlan/);
  assert.match(whatsapp, /Off-plan project received/);
  for (const field of ['Project name', 'Location', 'Completion date', 'Brochure and project images', 'Current construction progress', 'Current sales and availability']) assert.match(whatsapp, new RegExp(field));
  assert.match(whatsapp, /createOffPlanEnquiry/);
  assert.match(whatsapp, /notifyOffPlanEnquiry/);
});

test('walkthrough workflow is approval-gated and does not claim generated output', () => {
  const service = read('services/offPlanService.js');
  const migration = read('db/migrations/118_off_plan_developments.sql');
  const client = read('assets/off-plan.js');
  assert.match(service, /Concept walkthrough - final construction and finishes may differ/);
  assert.match(service, /\['brief_ready', 'render_requested', 'draft_ready', 'approved'/);
  assert.match(migration, /"output_requires_staff_approval":true/);
  assert.match(client, /No public video has been generated/);
});
