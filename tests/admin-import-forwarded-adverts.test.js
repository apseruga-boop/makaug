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
  const block = wa.slice(wa.indexOf('async function groupForwardedAdverts'), wa.indexOf('module.exports.groupForwardedAdverts'));
  assert(/media: orphans\.splice\(0\)/.test(block), 'photos before the first caption go with it');
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
