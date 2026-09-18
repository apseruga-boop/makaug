'use strict';

// Two intake bugs put bad listings on the live site in September 2026, and both would have
// kept doing it with every new batch of agent properties:
//
//   1. The price parser took the first number after a cue word, so "Selling 5 bedroom house
//      in Kololo @600m UGX" published at UGX 5 — the bedroom count. Four listings went live
//      this way (UGX 4, 5, 5 and 6).
//   2. WhatsApp stamps "Forwarded" on a forwarded message. That word landed inside the
//      caption hash, so a forwarded copy hashed differently from the direct send and walked
//      straight past the duplicate guard. Four properties were listed twice.
//
// Both are pinned here against the real captions that caused them.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const whatsappRoute = fs.readFileSync(path.join(root, 'routes/whatsapp.js'), 'utf8');
const staffRoute = fs.readFileSync(path.join(root, 'routes/staff.js'), 'utf8');

// --- the caption hash, lifted from the route and run for real -------------------------

function loadCaptionHash() {
  const start = whatsappRoute.indexOf('function stripForwardMarkers');
  assert.notStrictEqual(start, -1, 'stripForwardMarkers is missing from routes/whatsapp.js');
  const end = whatsappRoute.indexOf('function employeePropertyAttemptKey');
  assert.notStrictEqual(end, -1, 'could not find the end of the caption hash block');
  const sandbox = {
    crypto,
    normalizeInput: (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim()
  };
  vm.createContext(sandbox);
  vm.runInContext(whatsappRoute.slice(start, end), sandbox);
  return sandbox;
}

const GARUGA = '3 acres Garuga Pearl Marina touching lake private mailo each UGX 700 million';

test('a forwarded caption hashes the same as the direct send', () => {
  const { employeeCaptionHash } = loadCaptionHash();
  assert.strictEqual(
    employeeCaptionHash(`Forwarded\n${GARUGA}`),
    employeeCaptionHash(GARUGA),
    'a forwarded copy must not slip past the duplicate guard'
  );
});

test('the other WhatsApp forward markers collapse too', () => {
  const { employeeCaptionHash } = loadCaptionHash();
  const direct = employeeCaptionHash(GARUGA);
  for (const marker of ['Forwarded many times', 'Forwarded message', 'Forwarded:']) {
    assert.strictEqual(employeeCaptionHash(`${marker}\n${GARUGA}`), direct, `"${marker}" must be ignored`);
  }
});

test('two genuinely different properties still hash differently', () => {
  const { employeeCaptionHash } = loadCaptionHash();
  const a = employeeCaptionHash('50 by 100 plot Kira Kiwologoma built up neighborhood private mailo UGX 85 million');
  const b = employeeCaptionHash('Forwarded\nVery Good Deal 14 decimals plot Kira Kitukutwe on quick sale UGX 85 million');
  assert.notStrictEqual(a, b, 'same price must not make two different plots look like one listing');
});

test('an empty or marker-only caption yields no hash', () => {
  const { employeeCaptionHash } = loadCaptionHash();
  assert.strictEqual(employeeCaptionHash(''), '');
  assert.strictEqual(employeeCaptionHash('Forwarded'), '');
});

// --- the price guard ------------------------------------------------------------------

test('the bedroom count can no longer be published as the price', () => {
  const start = whatsappRoute.indexOf('const priceSource = listingPriceSourceFragment(priceScanCaption);');
  assert.notStrictEqual(start, -1, 'could not find the intake price extraction');
  const block = whatsappRoute.slice(start, start + 900);
  assert.match(block, /EMPLOYEE_INTAKE_MIN_PRICE/, 'the price fragment must be held to the sanity floor');
  assert.match(block, /priceSourceUsable/, 'the fragment must only win when it clears the floor');
  assert.ok(
    !/const priceMetadata = priceSource\s*\n?\s*\? propertyPriceMetadata\(priceSource\)/.test(block),
    'the raw fragment must not be trusted unconditionally again'
  );
});

test('the sanity floor is defined and above a plausible room count', () => {
  const match = whatsappRoute.match(/const EMPLOYEE_INTAKE_MIN_PRICE = (\d+);/);
  assert.ok(match, 'EMPLOYEE_INTAKE_MIN_PRICE must be defined');
  assert.ok(Number(match[1]) > 100, 'the floor has to sit well above a bedroom count');
});

// --- returning an approved listing to review ------------------------------------------

test('staff can send an approved listing back to the review queue', () => {
  assert.match(staffRoute, /router\.post\('\/properties\/:id\/return-to-review'/, 'the endpoint must exist');
  const start = staffRoute.indexOf("router.post('/properties/:id/return-to-review'");
  const block = staffRoute.slice(start, start + 2600);
  assert.match(block, /status = 'pending'/, 'it must move the listing back to pending');
  assert.match(block, /moderation_stage = 'in_review'/, 'it must land in the review stage');
  assert.match(block, /property_moderation_events/, 'the move must be recorded in the moderation log');
  assert.match(block, /invalidatePublicInventoryMetricsCache/, 'public inventory counts must be refreshed');
});

test('returning to review refuses listings that are already gone', () => {
  const start = staffRoute.indexOf("router.post('/properties/:id/return-to-review'");
  const block = staffRoute.slice(start, start + 2600);
  assert.match(block, /STAFF_REMOVED_STATUSES/, 'rejected or deleted listings must not be resurrected this way');
  assert.match(block, /already_in_review/, 'a listing already in review must be a no-op, not an error');
});
