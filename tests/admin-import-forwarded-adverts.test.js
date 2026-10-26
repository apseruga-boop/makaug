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
