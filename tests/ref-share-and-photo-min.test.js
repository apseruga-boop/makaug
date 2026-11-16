'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('photo minimum is 2 everywhere in the list form, app, i18n and the server', () => {
  const html = read('index.html');
  const app = read('assets/makaug-app.js');
  const properties = read('routes/properties.js');
  assert.match(html, /Upload Photos \(min 2, max 20\) \*/);
  assert.doesNotMatch(html, /Upload Photos \(min 5, max 20\)/);
  assert.match(app, /const LP_MIN_UPLOAD_PHOTOS = 2/);
  assert.match(app, /Upload Photos \(min 2, max 20\) \*/);
  assert.doesNotMatch(app, /Upload Photos \(min 5, max 20\)/);
  assert.doesNotMatch(app, /Upload Photos \(exactly 5 required\)/);
  assert.match(properties, /const websiteMinImages = 2/);
  assert.match(properties, /At least 2 photos for every listing/);

  const i18nDir = path.join(root, 'assets', 'i18n');
  for (const name of fs.readdirSync(i18nDir).filter((f) => f.startsWith('site-') && f.endsWith('.json'))) {
    const json = JSON.parse(fs.readFileSync(path.join(i18nDir, name), 'utf8'));
    const phrases = json.phrases || json;
    assert.ok(phrases['Upload Photos (min 2, max 20) *'], `${name} must translate the min-2 label`);
    assert.equal(phrases['Upload Photos (min 5, max 20) *'], undefined, `${name} must not keep the min-5 key`);
    const val = phrases['Upload Photos (min 2, max 20) *'];
    assert.doesNotMatch(val, /(?:^|[^\d])5(?:[^\d]|$)/, `${name} translation still mentions 5: ${val}`);
  }
});

test('approved listings get a Share on WhatsApp button with ref=owner-share', () => {
  const app = read('assets/makaug-app.js');
  const moderation = read('services/listingModerationService.js');
  assert.match(app, /function ownerWhatsAppShareHref/);
  assert.match(app, /ref=owner-share/);
  assert.match(app, /Share on WhatsApp/);
  assert.match(app, /shareOwnedListingOnWhatsApp/);
  assert.match(moderation, /function getOwnerShareListingUrl/);
  assert.match(moderation, /ref=owner-share/);
  assert.match(moderation, /My listing is live on makaug.com/);
  const { getOwnerShareListingUrl, getOwnerWhatsAppShareUrl } = require('../services/listingModerationService');
  const url = getOwnerShareListingUrl({ id: 'demo-listing' });
  assert.match(url, /\/property\/demo-listing\?ref=owner-share$/);
  const wa = getOwnerWhatsAppShareUrl({ id: 'demo-listing', title: '2-bed in Kololo' });
  assert.match(wa, /^https:\/\/wa\.me\/\?text=/);
  const text = decodeURIComponent(wa.split('text=')[1]);
  assert.match(text, /My listing is live on makaug.com: 2-bed in Kololo/);
  assert.match(text, /ref=owner-share/);
});

test('agents can copy their public listings link, and the profile has OG tags with name and listing count', () => {
  const app = read('assets/makaug-app.js');
  const server = read('server.js');
  const og = read('routes/ogShare.js');
  const card = read('services/shareCardService.js');
  assert.match(app, /Copy my link/);
  assert.match(app, /function copyBrokerProfileLink/);
  assert.match(app, /See my listings on makaug.com/);
  assert.match(server, /my listings on makaug.com/);
  assert.match(server, /has \$\{listingCount\} live listings on makaug.com/);
  assert.match(og, /approvedListingCount: Number\(row\.approved_listing_count/);
  assert.match(card, /live listings on makaug.com/);
  assert.match(card, /View profile on makaug.com/);
});

test('the client captures \?ref= before the app bundle, first touch, about 30 days', () => {
  const html = read('index.html');
  const client = read('assets/referral-tracking.js');
  assert.match(html, /assets\/referral-tracking\.js/);
  assert.ok(
    html.indexOf('assets/referral-tracking.js') < html.indexOf('makaug-app.js'),
    'referral capture must load before the main app, so a rewritten URL cannot lose ?ref='
  );
  assert.match(client, /makaug_ref/);
  assert.match(client, /makaug\.ref/);
  assert.match(client, /DAYS = 30/);
  assert.match(client, /first touch|First-touch|firstTouch|if \(fromUrl && !current\)/i);
});

test('migration 228 is additive, has a rollback, and seeds ronald, sharon, arthur', () => {
  const sql = read('db/migrations/228_referral_tracking.sql');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS referral_codes/);
  assert.match(sql, /ALTER TABLE properties ADD COLUMN IF NOT EXISTS referral_code TEXT/);
  assert.match(sql, /ALTER TABLE agents ADD COLUMN IF NOT EXISTS referral_code TEXT/);
  assert.match(sql, /ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT/);
  assert.match(sql, /'ronald'/);
  assert.match(sql, /'sharon'/);
  assert.match(sql, /'arthur'/);
  assert.match(sql, /'owner-share'/);
  assert.match(sql, /Rollback:/);
  assert.match(sql, /DROP TABLE IF EXISTS referral_codes/);
});

test('no full phone numbers in the new referral and share code', () => {
  const files = [
    'services/referralTracking.js',
    'assets/referral-tracking.js',
    'db/migrations/228_referral_tracking.sql'
  ];
  for (const rel of files) {
    const src = read(rel);
    assert.doesNotMatch(src, /\b0?7\d{8}\b|\b2567\d{8}\b/, rel);
  }
});
