'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const referral = require('../services/referralTracking');

test('normaliseReferralCode: lowercase, trimmed, safe characters, max 40', () => {
  assert.equal(referral.normaliseReferralCode(' Ronald '), 'ronald');
  assert.equal(referral.normaliseReferralCode('Sharon-01'), 'sharon-01');
  assert.equal(referral.normaliseReferralCode('Harriet!!'), 'harriet');
  assert.equal(referral.normaliseReferralCode('owner-share'), 'owner-share');
  assert.equal(referral.normaliseReferralCode('a'.repeat(80)).length, 40);
  assert.equal(referral.normaliseReferralCode('???'), '');
});

test('first touch wins; a later ref does not replace it', () => {
  assert.equal(referral.firstTouch('ronald', 'sharon'), 'ronald');
  assert.equal(referral.firstTouch('', 'sharon'), 'sharon');
  assert.equal(referral.firstTouch(null, 'Arthur'), 'arthur');
  assert.equal(referral.firstTouch('  ', ''), null);
});

test('readReferralFromRequest prefers the body, then the query, then the cookie', () => {
  assert.equal(referral.readReferralFromRequest({ body: { referral_code: 'ronald' }, query: { ref: 'sharon' }, headers: { cookie: 'makaug_ref=arthur' } }), 'ronald');
  assert.equal(referral.readReferralFromRequest({ body: {}, query: { ref: 'Sharon' }, headers: { cookie: 'makaug_ref=arthur' } }), 'sharon');
  assert.equal(referral.readReferralFromRequest({ body: {}, query: {}, headers: { cookie: 'theme=light; makaug_ref=arthur; other=1' } }), 'arthur');
  assert.equal(referral.readReferralFromRequest({ body: {}, query: {}, headers: {} }), null);
});

test('staff attribution: known staff codes only; owner-share and unknown codes are recorded, not attributed', () => {
  const codes = [
    { code: 'ronald', person_key: 'ronald', label: 'Ronald', kind: 'staff', active: true },
    { code: 'sharon', person_key: 'sharon', label: 'Sharon', kind: 'staff', active: true },
    { code: 'owner-share', person_key: null, label: 'Owner WhatsApp share', kind: 'system', active: true }
  ];
  assert.equal(referral.isStaffAttributionCode('ronald', codes), true);
  assert.equal(referral.personKeyForCode('sharon', codes), 'sharon');
  assert.equal(referral.isStaffAttributionCode('owner-share', codes), false);
  assert.equal(referral.personKeyForCode('owner-share', codes), null);
  assert.equal(referral.isStaffAttributionCode('tiktok-ad', codes), false);
  const evidence = referral.firstTouchEvidence('landing-xyz', codes);
  assert.equal(evidence.first_touch_ref, 'landing-xyz');
  assert.equal(evidence.first_touch_is_staff, false);
  assert.match(evidence.first_touch_note, /does not decide commission/);
});

test('client first-touch script: URL ref is stored, and a later ref is ignored', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets', 'referral-tracking.js'), 'utf8');
  const cookies = {};
  const store = {};
  function run(search, existingCookie) {
    const context = {
      window: {},
      document: {
        cookie: existingCookie ? Object.entries(existingCookie).map(([k, v]) => `${k}=${v}`).join('; ') : ''
      },
      Date,
      URLSearchParams,
      encodeURIComponent,
      decodeURIComponent,
      JSON
    };
    context.window.location = { search, protocol: 'https:' };
    context.window.localStorage = {
      getItem: (k) => store[k] || null,
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; }
    };
    Object.defineProperty(context.document, 'cookie', {
      get() {
        return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
      },
      set(value) {
        const [pair] = String(value).split(';');
        const idx = pair.indexOf('=');
        cookies[pair.slice(0, idx)] = pair.slice(idx + 1);
      },
      configurable: true
    });
    vm.runInNewContext(source, context);
    return context.window.makaugReferral;
  }

  Object.keys(cookies).forEach((k) => { delete cookies[k]; });
  Object.keys(store).forEach((k) => { delete store[k]; });
  const first = run('?ref=ronald');
  assert.equal(first.code(), 'ronald');
  const later = run('?ref=sharon');
  assert.equal(later.code(), 'ronald', 'first touch must win');
});

test('listing and sign-up routes save referral_code from the request', () => {
  const properties = fs.readFileSync(path.join(__dirname, '..', 'routes', 'properties.js'), 'utf8');
  const agents = fs.readFileSync(path.join(__dirname, '..', 'routes', 'agents.js'), 'utf8');
  const auth = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');
  assert.match(properties, /readReferralFromRequest\(req, body\)/);
  assert.match(properties, /referral_code/);
  assert.match(agents, /readReferralFromRequest\(req, body\)/);
  assert.match(auth, /readReferralFromRequest\(req\)/);
  assert.match(app, /referral_code: capturedReferralCode\(\)/);
  assert.equal((app.match(/referral_code: capturedReferralCode\(\)/g) || []).length >= 3, true, 'listing + agent + account sign-up must send the code');
});
