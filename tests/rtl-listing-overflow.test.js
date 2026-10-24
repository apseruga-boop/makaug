'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');

test('honeypot fields stay in the form without a far offset', () => {
  assert.match(app, /id="detail-inquiry-website"[^>]*class="agent-profile-hp"/);
  assert.doesNotMatch(app, /left:\s*-9999px/);
  assert.doesNotMatch(app, /inset-inline-start:\s*-9999px/);
  assert.match(app, /id="agent-profile-website"[^>]*class="agent-profile-hp"/);
  assert.doesNotMatch(html, /inset-inline-start:\s*-9999px/);
  assert.doesNotMatch(html, /left:\s*-9999px/);
  assert.match(html, /input\.agent-profile-hp,\s*\.agent-profile-form input\.agent-profile-hp,\s*\.property-booking-panel input\.agent-profile-hp\s*\{[^}]*clip:\s*rect\(0,\s*0,\s*0,\s*0\)/);
  assert.match(html, /clip-path:\s*inset\(50%\)/);
});

test('booking day buttons scroll inside their own strip', () => {
  const rule = html.match(/\.agent-booking-date-strip\s*\{[^}]+\}/);
  assert.ok(rule, 'date strip rule exists');
  assert.match(rule[0], /overflow-x:\s*auto/);
  assert.match(rule[0], /overflow-y:\s*hidden/);
  assert.match(rule[0], /min-inline-size:\s*0/);
  assert.match(rule[0], /max-inline-size:\s*100%/);
  assert.doesNotMatch(html, /html\s*\{[^}]*overflow-x:\s*hidden/);
});
