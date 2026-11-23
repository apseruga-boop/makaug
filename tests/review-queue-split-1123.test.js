'use strict';
// Every pending listing is in exactly one review list (Arthur, 23 Nov 2026).
// MK-20261123-D9C773 (WhatsApp agent listing with our own hosted video) was
// counted as "found online" on the staff desk because it had a video_url.
// Run: node --test tests/review-queue-split-1123.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const split = require('../utils/reviewQueueSplit');

const whatsappAgent = {
  agent_id: '11619318-32b6-466c-9cec-4f69836d2234', listed_via: 'whatsapp', source: 'whatsapp_employee_intake', lister_type: 'agent',
  extra_fields: { video_url: 'https://media.makaug.com/whatsapp-employee-intake/video/1795418388126-b6fa5b74-2.mp4', source_platform: 'WhatsApp employee intake', whatsapp_employee_intake: true }
};
const tiktokImport = { agent_id: null, listed_via: 'found_online', source: 'found_online_property_source_v1', extra_fields: { found_online: true, tiktok_url: 'https://www.tiktok.com/@x/video/1' } };

test('a WhatsApp agent listing with our own hosted video is an agent listing', () => {
  assert.equal(split.rowIsFoundOnline(whatsappAgent), false);
  assert.equal(split.rowIsFoundOnline({ ...whatsappAgent, extra_fields: JSON.stringify(whatsappAgent.extra_fields) }), false);
});

test('found-online imports stay found online', () => {
  assert.equal(split.rowIsFoundOnline(tiktokImport), true);
  assert.equal(split.rowIsFoundOnline({ extra_fields: { source_url: 'https://ugandapropertycentre.com/x' } }), true, 'a public post URL with no agent or owner');
  assert.equal(split.rowIsFoundOnline({ extra_fields: { social_search_candidate: 'true' } }), true);
  assert.equal(split.rowIsFoundOnline({ extra_fields: { source_badge: 'Found online' } }), true);
});

test('an agent who shares their own TikTok or YouTube link is still an agent listing', () => {
  assert.equal(split.rowIsFoundOnline({ agent_id: 'a', listed_via: 'broker_dashboard', extra_fields: { youtube_url: 'https://youtu.be/x' } }), false);
  assert.equal(split.rowIsFoundOnline({ listed_via: 'whatsapp', extra_fields: { tiktok_url: 'https://tiktok.com/x' } }), false);
  assert.equal(split.rowIsFoundOnline({ agent_id: 'a', extra_fields: { found_online: true } }), true, 'an explicit found-online flag wins');
});

test('the SQL rule never treats video_url as a found-online source and blank URLs do not hide later ones', () => {
  const sql = split.foundOnlineSql('p');
  assert.doesNotMatch(sql, /video_url/);
  assert.doesNotMatch(sql, /COALESCE\(p\.extra_fields->>'source_url', p\.extra_fields->>'source_post_url'/, 'no COALESCE chain: one blank key used to hide the rest');
  assert.match(sql, /NOT \(\s*p\.agent_id IS NOT NULL/);
});

test('staff desk, its badges and King\'s queues all use the one rule', () => {
  const staff = fs.readFileSync(path.join(__dirname, '..', 'routes/staff.js'), 'utf8');
  const king = fs.readFileSync(path.join(__dirname, '..', 'services/kingReview.js'), 'utf8');
  assert.match(staff, /function foundOnlineReviewWhere\(alias = 'p'\) \{\n  return reviewQueueSplit\.foundOnlineSql\(alias\);/);
  assert.match(staff, /function rowIsFoundOnlineReview\(row = \{\}\) \{\n  return reviewQueueSplit\.rowIsFoundOnline\(row\);/);
  assert.match(staff, /COUNT\(\*\) FILTER \(WHERE \$\{foundOnlineReviewWhere\('p'\)\}\)::int AS found_online/);
  assert.match(king, /const FOUND_ONLINE_SQL = reviewQueueSplit\.foundOnlineSql\('p'\);/);
});
