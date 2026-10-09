'use strict';

/**
 * 9 Oct 2026. Francis sent his whole batch twice. The second copy of each video
 * matched the first, the "already on another listing" guard dropped it, and
 * Mbalwa and Kira Shimoni reached review with no photo and no video. A
 * duplicate file is worth flagging; it is never worth an empty listing.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const whatsapp = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
const admin = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');

test('creating a listing keeps its media when dropping would leave nothing', () => {
  const start = whatsapp.indexOf('async function createEmployeeReviewProperty');
  const body = whatsapp.slice(start, start + 4000);
  assert.match(body, /keepsSomething/, 'the drop must be conditional on something surviving');
  assert.match(body, /if \(keepsSomething\) \{\s*storedMedia = remaining;/);
});

test('attaching media applies the same rule', () => {
  const start = whatsapp.indexOf('async function attachEmployeeReviewMedia');
  const body = whatsapp.slice(start, start + 3500);
  assert.match(body, /hasOwnMedia/);
  assert.match(body, /uniqueMedia = notYetHeld/);
});

test('recovery endpoint only reads the listing\'s own source message and the bridge host', () => {
  const start = admin.indexOf("router.post('/properties/:id/reattach-whatsapp-video'");
  assert.ok(start > 0);
  const body = admin.slice(start, start + 6000);
  assert.match(body, /confirm_rights/);
  assert.match(body, /whatsapp_employee_message_id/);
  assert.match(body, /RECOVERY_BRIDGE_HOSTS\(\)\.has\(parsed\.hostname\)/);
  assert.doesNotMatch(body, /req\.body\??\.(url|media_url|mediaUrl)/, 'no caller-supplied URL may be fetched');
  assert.match(body, /'ftyp'/, 'only a real MP4 is accepted');
});
