'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const admin = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');

test('outbox health is read-only and masks phone numbers', () => {
  const start = admin.indexOf("router.get('/whatsapp/outbox-health'");
  assert.ok(start > 0, 'route exists');
  const end = admin.indexOf('\n});', start);
  const body = admin.slice(start, end);
  assert.doesNotMatch(body, /\b(UPDATE|INSERT|DELETE)\b/, 'a diagnostic must not change the queue');
  assert.match(body, /mask\(row\.digits\)/, 'numbers are masked in the response');
  assert.doesNotMatch(body, /user_phone,\s*$/m);
});

test('outbox cancel never touches a message that was already sent', () => {
  const start = admin.indexOf("router.post('/whatsapp/outbox-cancel'");
  assert.ok(start > 0);
  const end = admin.indexOf('\n});', start);
  const body = admin.slice(start, end);
  assert.match(body, /status IN \('pending', 'retry'\)/, 'only rows still waiting');
  assert.doesNotMatch(body, /DELETE/, 'cancelled rows stay on record');
  assert.match(body, /ids = \[/, 'explicit ids only, no sweep by filter');
});
