'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const calling = fs.readFileSync(path.join(root, 'assets/calling-screen.js'), 'utf8');

test('desk URLs hide the public chrome from the first paint, before any app script', () => {
  const head = html.slice(0, html.indexOf('</head>'));
  assert.match(head, /id="mk-desk-boot-css"/);
  assert.match(head, /admin\|king\|staff-dashboard/);
  // Released when the desk shell is on, when the URL leaves the desk, or after 10 s.
  assert.match(head, /classList\.contains\("mk-app"\)/);
  assert.match(head, /Date\.now\(\) - t0 > 10000/);
  // Only the pages are hidden, so the sign-in box can still show.
  assert.doesNotMatch(head, /body:not\(\.kd-on\):not\(\.sd-on\) > \*/);
  assert.ok(head.indexOf('mk-desk-boot') < head.indexOf('<script src='), 'boot guard runs before external scripts');
});

test('phone app guides link the free apps and never send people to the Play Store for them', () => {
  assert.match(calling, /https:\/\/github\.com\/capcom6\/android-sms-gateway\/releases\/latest/);
  assert.match(calling, /https:\/\/f-droid\.org\/packages\/tech\.bogomolov\.incomingsmsgateway\//);
  assert.doesNotMatch(calling, /install “SMS Gateway for Android”|“SMS to URL Forwarder” from the Play Store/);
  assert.match(calling, /not a keypad phone/);
});
