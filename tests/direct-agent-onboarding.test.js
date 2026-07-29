const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('direct-agent onboarding remains protected and records explicit authority checks', () => {
  const source = read('routes/admin.js');
  const middlewareIndex = source.indexOf('router.use(requireAdminApiKey)');
  const routeIndex = source.indexOf("router.post('/agents/direct-onboarding'");

  assert.ok(middlewareIndex >= 0 && routeIndex > middlewareIndex);
  assert.match(source, /direct_submission_confirmed/);
  assert.match(source, /contact_permission_confirmed/);
  assert.match(source, /media_rights_confirmed/);
  assert.match(source, /profile identity verification and account claim are pending/i);
  assert.match(source, /direct_agent_whatsapp/);
});

test('direct-agent onboarding reuses a matching pending listing from the same contact', () => {
  const source = read('routes/admin.js');
  const app = read('assets/makaug-app.js');

  assert.match(source, /regexp_replace\(COALESCE\(lister_phone/);
  assert.match(source, /LOWER\(COALESCE\(lister_email/);
  assert.match(source, /direct_agent_existing_listing_linked/);
  assert.match(source, /existing_image_count/);
  assert.match(source, /extra_fields = COALESCE\(extra_fields, '\{\}'::jsonb\) \|\| \$6::jsonb/);
  assert.match(app, /existingImageCount < 5/);
  assert.match(app, /existing photos preserved/);
});

test('direct-agent publish gate requires evidence, photos, videos, and moderation audit', () => {
  const source = read('routes/admin.js');
  assert.match(source, /router\.post\('\/properties\/:id\/direct-publish'/);
  assert.match(source, /source_reviewed/);
  assert.match(source, /location_confirmed/);
  assert.match(source, /listing_facts_confirmed/);
  assert.match(source, /SELECT COUNT\(\*\)::int AS count FROM property_images/);
  assert.match(source, /videoUrls\.length < 1/);
  assert.match(source, /direct_agent_listing_published/);
});

test('public direct profile is claim-pending, not presented as identity verified', () => {
  const agents = read('routes/agents.js');
  const app = read('assets/makaug-app.js');
  assert.match(agents, /PUBLIC_DIRECT_AGENT_MIN_LIVE_LISTINGS = 1/);
  assert.match(agents, /\[DIRECT_AGENT_AUTHORISED\]/);
  assert.match(app, /Direct profile · claim pending/);
  assert.match(app, /Direct agent submission · identity verification pending/);
});

test('authorised MP4 tours upload to cloud storage and render as a multi-video gallery', () => {
  const admin = read('routes/admin.js');
  const properties = read('routes/properties.js');
  const storage = read('services/cloudMediaStorageService.js');
  const app = read('assets/makaug-app.js');

  assert.match(admin, /router\.post\('\/properties\/:id\/videos'/);
  assert.match(admin, /allowedMimeTypes: \['video\/mp4'\]/);
  assert.match(storage, /'video\/mp4': 'mp4'/);
  assert.match(properties, /video_urls: safeVideoUrls/);
  assert.match(properties, /video_tours: safeVideoTours/);
  assert.match(app, /function propertyVideoUrls/);
  assert.match(app, /<video controls preload="metadata" playsinline/);
  assert.match(app, /Property video tours/);
});

test('King dashboard exposes the direct-agent workflow and release marker', () => {
  const html = read('index.html');
  const app = read('assets/makaug-app.js');
  assert.match(html, /data-release-marker="direct-agent-first-listing-20260729"/);
  assert.match(html, /id="admin-direct-agent-form"/);
  assert.match(app, /async function adminCreateDirectAgentListing/);
});
