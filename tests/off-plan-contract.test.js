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

test('supplied project starts guarded then receives one explicit source-attributed public preview', () => {
  const migration = read('db/migrations/118_off_plan_developments.sql');
  const previewMigration = read('db/migrations/119_publish_kazi_victoria_palms_preview.sql');
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
  assert.match(previewMigration, /'Kazi Honest'/);
  assert.match(previewMigration, /c0bc49f9-aaaa-4093-b5c5-37ac73da7106/);
  assert.match(previewMigration, /'partially_verified'/);
  assert.match(previewMigration, /"public_preview_approved":true/);
  assert.match(previewMigration, /"facts_to_confirm"/);
  assert.match(previewMigration, /"price_ugx":410400000/);
});

test('Off Plan directory uses the compact search, map, AI and image-led project layout', () => {
  const html = read('index.html');
  const client = read('assets/off-plan.js');
  const css = read('assets/off-plan.css');
  assert.match(html, /off-plan-projectfinder-layout-v3-20260904/);
  assert.match(html, /id="off-plan-location-suggestions"/);
  assert.match(html, /id="off-plan-map"/);
  assert.match(html, /id="off-plan-ai-panel"/);
  assert.match(html, /data-ai-intent type="hidden" value="off_plan_search"/);
  assert.match(html, /data-ai-scope="off_plan"/);
  assert.doesNotMatch(html, /data-off-plan-i18n="sectionEyebrow">Off plan Uganda/);
  assert.match(client, /\/api\/properties\/locations\/suggest/);
  assert.match(client, /source_agent_profile_id/);
  assert.match(client, /renderOffPlanMap/);
  assert.match(css, /off-plan-card-image[\s\S]*min-height: 485px/);
});

test('an Off Plan source broker profile remains usable when the general agent API is slow', () => {
  const app = read('assets/makaug-app.js');
  assert.match(app, /offPlanProjectsPromise = apiRequest\('\/api\/off-plan\?limit=60'/);
  assert.match(app, /window\.setTimeout\(\(\) => controller\.abort\(\), 4000\)/);
  assert.match(app, /broker\.remote_off_plan_projects = offPlanProjects/);
  assert.match(app, /function brokerOffPlanProjectsHtml\(projects = \[\]\)/);
  assert.match(app, /Projects represented by this broker/);
});

test('brochure, payment, gallery, map, sharing, video and mortgage handoff are visible', () => {
  const html = read('index.html');
  const client = read('assets/off-plan.js');
  const css = read('assets/off-plan.css');
  const route = read('routes/off-plan.js');
  assert.match(html, /id="page-off-plan"/);
  assert.match(client, /Download brochure/);
  assert.match(client, /calculateOffPlanPayments/);
  assert.match(client, /id="off-plan-gallery-dialog"/);
  assert.match(client, /closeOffPlanGallery/);
  assert.match(client, /value == null \|\| \(typeof value === 'string' && !value\.trim\(\)\)/);
  assert.match(html, /off-plan\.js\?v=20260904-offplan-v6/);
  assert.match(html, /off-plan\.css\?v=20260904-offplan-v6/);
  assert.match(client, /off-plan-detail-grid/);
  assert.match(css, /\.off-plan-detail-grid\s*\{/);
  assert.match(css, /width: min\(1120px,calc\(100vw - 28px\)\)/);
  assert.match(client, /ensureOffPlanGoogleMaps/);
  assert.match(client, /maps\.google\.com\/mapfiles\/ms\/icons\/red-dot\.png/);
  assert.match(client, /shareOffPlan\('whatsapp'\)/);
  assert.match(client, /projectVideo/);
  assert.match(client, /off-plan-mortgage-panel/);
  assert.match(route, /brochure\.pdf/);
});

test('contact workflow has all channels and exact operations recipients', () => {
  const html = read('index.html');
  const notifications = read('services/offPlanNotificationService.js');
  const route = read('routes/off-plan.js');
  assert.match(html, /data-off-plan-channel="whatsapp"/);
  assert.match(html, /data-off-plan-channel="email"/);
  assert.match(html, /data-off-plan-channel="call"/);
  assert.match(html, /Partner with makaug\.com/);
  assert.match(html, /id="off-plan-required-info-list"/);
  assert.match(html, /id="off-plan-contact-truth"/);
  assert.match(html, /id="off-plan-contact-details"/);
  for (const email of ['admin@makaug.com', 'arthur@makaug.com', 'ronald@makaug.com']) assert.match(notifications, new RegExp(email.replace('.', '\\.')));
  assert.match(route, /I would like to enquire about listing a new off-plan project/);
  assert.match(route, /requestedDevelopmentId/);
  assert.match(route, /status = 'published'[\s\S]*verification_status = 'verified'[\s\S]*public_preview_approved/);
  assert.match(route, /source_agent_whatsapp \|\| development\?\.source_agent_phone/);
});

test('staff and King dashboards can edit enriched Off Plan facts', () => {
  const client = read('assets/off-plan.js');
  for (const field of ['source_agent_id', 'source_display_name', 'original_currency', 'discount_percentage', 'nearby_places', 'amenities', 'brochure_settings', 'extra_fields']) {
    assert.match(client, new RegExp(`data-op-(?:edit|json)="${field}"`));
  }
  assert.match(client, /data-op-json-default="object"/);
  assert.match(client, /off-plan-create-source-id/);
  assert.match(client, /off-plan-create-latitude/);
});

test('website and WhatsApp AI recognize off-plan search and listing requests', () => {
  const ai = read('services/aiService.js');
  const aiRoute = read('routes/ai.js');
  const app = read('assets/makaug-app.js');
  const whatsapp = read('routes/whatsapp.js');
  assert.match(ai, /'off_plan_search'/);
  assert.match(ai, /'off_plan_listing'/);
  assert.match(aiRoute, /assistantIsOffPlan/);
  assert.match(aiRoute, /Your request is recorded only after you submit that contact form or send the WhatsApp message/);
  assert.match(aiRoute, /action: 'open_off_plan_contact'/);
  assert.match(aiRoute, /listPublicDevelopments/);
  assert.match(aiRoute, /off_plan_projects: projects/);
  assert.match(app, /off_plan: \{ intent: "off_plan_search"/);
  assert.match(app, /function aiAssistantOffPlanCardsHtml/);
  assert.match(app, /data\?\.off_plan_projects/);
  assert.match(whatsapp, /Off-plan project received/);
  for (const field of ['Project name', 'Location', 'Completion date', 'Brochure and project images', 'Current construction progress', 'Current sales and availability']) assert.match(whatsapp, new RegExp(field));
  assert.match(whatsapp, /createOffPlanEnquiry/);
  assert.match(whatsapp, /notifyOffPlanEnquiry/);
});

test('Off Plan follows all nine public language choices and refreshes on language change', () => {
  const html = read('index.html');
  const client = read('assets/off-plan.js');
  const app = read('assets/makaug-app.js');
  for (const language of ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar']) {
    assert.match(client, new RegExp(`\\n\\s{4}${language}: \\{`), `missing Off Plan language pack: ${language}`);
    assert.match(client, new RegExp(`\\n\\s{4}${language}: \\{[^\\n]*heroTitle`), `missing compact Off Plan copy: ${language}`);
  }
  assert.match(html, /data-off-plan-i18n="heroTitle"/);
  assert.match(html, /data-off-plan-i18n-placeholder="projectSearch"/);
  assert.match(client, /function applyOffPlanLanguageUI\(\)/);
  assert.match(client, /Object\.assign\(window, \{ applyOffPlanLanguageUI,/);
  assert.match(app, /typeof window\.applyOffPlanLanguageUI === "function"/);
});

test('public social previews never request expiring TikTok CDN image URLs', () => {
  const app = read('assets/makaug-app.js');
  assert.match(app, /function foundOnlineSourceThumbnailUrl/);
  assert.match(app, /tiktok_thumbnail_cache_url/);
  assert.ok(app.includes('return !/(?:tiktokcdn|byteimg|p16-|p19-|p77-|tos-)/i.test(url);'));
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
