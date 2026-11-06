'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const admin = fs.readFileSync(path.join(__dirname, '../routes/admin.js'), 'utf8');
const wa = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');
test('forwarded adverts in a customer chat can be grouped and imported for review, sending nothing', () => {
  assert(admin.includes("router.post('/whatsapp/conversations/:phone/import-forwarded-adverts'"));
  assert(wa.includes('module.exports.groupForwardedAdverts = groupForwardedAdverts;'));
  const block = wa.slice(wa.indexOf('function pairForwardedAlbums'), wa.indexOf('module.exports.groupForwardedAdverts'));
  // 6 Nov 2026: albums go to the nearest caption in time, on either side of
  // it — the same chat had "album, then text" and "text, then album".
  assert(/pairForwardedAlbums\(captions, media\)/.test(block), 'albums are paired by time, not by what came before');
  assert(/FORWARDED_ALBUM_GAP_MS/.test(block) && /FORWARDED_ALBUM_CLAIM_MS/.test(block));
  assert(/foldAdvertText\(/.test(block), 'fancy-lettered captions are read');
  assert(!/queueWhatsappWebBridgeAutoReply|deliverWhatsapp/.test(block));
});

test('a sender with no agent profile gets one opened as pending, never approved, when staff name them', () => {
  const route = admin.slice(admin.indexOf("router.post('/whatsapp/conversations/:phone/import-forwarded-adverts'"));
  const block = route.slice(0, route.indexOf("router.post('/agents/:id/restore'"));
  assert(/create_agent/.test(block));
  assert(/'pending', 'whatsapp_forwarded_adverts'/.test(block), 'opened profile starts pending');
  assert(!/'approved', 'whatsapp_forwarded_adverts'/.test(block));
  assert(/ORDER BY \(status = 'approved'\) DESC/.test(block), 'an existing profile on the number is reused first');
});

test('a logged media kind ("image") becomes a real MIME type before intake', () => {
  const { forwardedAdvertMimeType } = require('../routes/whatsapp');
  const url = 'https://makaug-waha-bridge.onrender.com/media?p=abc&m=aW1hZ2UvanBlZw&s=1';
  assert.strictEqual(forwardedAdvertMimeType({ mediaType: 'image' }, url), 'image/jpeg');
  assert.strictEqual(forwardedAdvertMimeType({ mediaType: 'video' }, 'https://x/y'), 'video/mp4');
  assert.strictEqual(forwardedAdvertMimeType({ mediaType: 'image/png' }, url), 'image/png');
  assert.strictEqual(forwardedAdvertMimeType({}, 'https://x/y.jpg'), 'image/jpeg');
});

test('staff can answer the question a caption leaves open, the way the agent would have', () => {
  // 6 Nov 2026: two of the fourteen 26 Oct adverts named Lutembe and Janyi
  // with no district, so the import skipped them as "which district Lutembe is
  // in". The groups override now carries staff's answer, appended under the
  // caption exactly as an agent's reply is, so the same reading applies.
  const route = admin.slice(admin.indexOf("router.post('/whatsapp/conversations/:phone/import-forwarded-adverts'"));
  const block = route.slice(0, route.indexOf("router.post('/agents/:id/restore'"));
  assert(/spec\.answer \|\| spec\.district/.test(block), 'the override takes an answer');
  const importer = wa.slice(wa.indexOf('async function importForwardedAdvert'), wa.indexOf('module.exports.groupForwardedAdverts'));
  assert(/group\.answer \? `\$\{group\.caption\}\\n\$\{group\.answer\}` : group\.caption/.test(importer));
  assert(/employeePropertyFacts\(caption, sessionData\)/.test(importer) && /createEmployeeReviewProperty\(\{ phone, inboundMessageId, caption, facts/.test(importer));
  const { employeePropertyFacts, employeePropertyMissing } = require('../routes/whatsapp').__test;
  const lutembe = 'Plots for sale located at lutembe next to ebony shores with clear lake view all plots are 23decimals at 220m';
  assert.deepStrictEqual(employeePropertyMissing(employeePropertyFacts(lutembe, {})), ['which district Lutembe is in']);
  const answered = employeePropertyFacts(`${lutembe}\nWakiso`, {});
  assert.deepStrictEqual(employeePropertyMissing(answered), []);
  assert.strictEqual(answered.locationPatch.area, 'Lutembe');
  assert.strictEqual(answered.locationPatch.district, 'Wakiso');
});
