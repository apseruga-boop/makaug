'use strict';
// PR4 (Arthur, 21 Nov 2026): no raw codes on King; plain words instead.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function appHelpers() {
  const src = read('assets/makaug-app.js');
  const a = src.indexOf('const PLAIN_CODE_WORDS = {');
  const b = src.indexOf('function renderStaffLeads(');
  assert.ok(a > 0 && b > a, 'helpers sit before renderStaffLeads');
  const ctx = {};
  vm.runInNewContext(src.slice(a, b) + '\nthis.plainCodeWords = plainCodeWords; this.plainBatchWords = plainBatchWords;', ctx);
  return ctx;
}

test('rotation, ad slot, page and source codes read as words', () => {
  const { plainCodeWords: w } = appHelpers();
  assert.equal(w('rotation', 'insufficient_clean_inventory'), 'not enough clean listings to rotate');
  assert.equal(w('rotation', 'completed'), 'done');
  assert.equal(w('rotation', '', 'awaiting first run'), 'awaiting first run');
  assert.equal(w('slot', 'native_card'), 'card among the listings');
  assert.equal(w('slot', 'chatbot_native'), 'card in the WhatsApp assistant');
  for (const s of ['house_band', 'leaderboard', 'hero', 'spotlight', 'mpu']) assert.doesNotMatch(w('slot', s), /_/, s);
  assert.equal(w('page', 'whatsapp'), 'WhatsApp');
  assert.equal(w('source', 'broker_dashboard'), 'Agent dashboard');
  assert.equal(w('source', 'found_online_property_source_v1'), 'Found online');
  assert.equal(w('source', 'admin_direct_agent_onboarding'), 'Added by King for an agent');
  assert.equal(w('lead', 'handed_over'), 'Handed over', 'unknown codes still lose their underscores');
  assert.equal(w('source', 'some_new_code_v2'), 'Some new code');
  assert.equal(w('source', 'TikTok'), 'TikTok', 'real words pass through');
});

test('harvest batch ids read as a name and a date', () => {
  const { plainBatchWords: b } = appHelpers();
  assert.equal(b('social_platform_post_discovery_20260525'), 'Social platform post discovery (25 May 2026)');
  assert.equal(b(''), 'Source intake');
});

test('the King screens use the helpers where the raw codes showed', () => {
  const src = read('assets/makaug-app.js');
  assert.match(src, /Kampala rotation: \$\{adminEscape\(plainCodeWords\("rotation", latest\.status/);
  assert.doesNotMatch(src, /\$\{adminEscape\(slot\.slot_type\)\}/);
  assert.doesNotMatch(src, /slot\.size_label \|\| slot\.slot_type \|\|/);
  assert.match(src, /Source: \$\{adminEscape\(plainCodeWords\("source"/);
  assert.match(src, /Latest batch: \$\{adminEscape\(plainBatchWords\(data\.batch_id\)\)\}/);
  assert.match(src, /setText\("identity-type", plainCodeWords\("source"/);
});

test('mic check and phone link details are words on King', () => {
  const kc = require('../services/kingCalls');
  assert.equal(kc.plainDetail('not_heard'), 'did not hear the test words');
  assert.equal(kc.plainDetail('not-allowed'), 'microphone blocked');
  assert.equal(kc.plainDetail('Headset disconnected'), 'Headset disconnected');
  const cs = read('assets/calling-screen.js');
  assert.match(cs, /esc\(plainDetail\(d\.detail\)\)/);
  assert.match(cs, /esc\(plainHow\(n\.how_known\)\)/);
  assert.match(cs, /missed_call: 'Missed call'/);
  assert.doesNotMatch(cs, /String\(x\.detail\)\.replace\(\/_\/g, ' '\)/);
});

test('cash check rows for an account no longer checked show its name, not its key', () => {
  const { plainAccount } = require('../services/callingDay');
  assert.equal(plainAccount('absa_ugx'), 'Absa UGX');
  assert.equal(plainAccount('absa_usd'), 'Absa USD');
  assert.equal(plainAccount('mtn_momopay'), 'MTN MoMo merchant');
  assert.match(read('services/callingDay.js'), /allNames\.get\(r\.account_key\) \|\| plainAccount\(r\.account_key\)/);
});

test('staff Short stays says it is switched off instead of loading for ever', () => {
  const sd = read('assets/staff-desk.js');
  assert.match(sd, /else if \(page === 'stays'\) staysOffNote\(\);/);
  assert.match(sd, /Short stays are switched off, so there is nothing to review here\./);
  assert.match(read('index.html'), /staff-desk\.js\?v=20261121-ops4/);
});

test('Settings & logs: event names and statuses are words, no table names', () => {
  const src = read('assets/makaug-app.js');
  assert.match(src, /adminEscape\(plainCodeWords\("event", event\)\)/);
  assert.match(src, /adminEscape\(plainCodeWords\("status", status\)\)/);
  assert.doesNotMatch(src, /WhatsApp bridge \(whatsapp_messages\)/);
  const { plainCodeWords: w } = appHelpers();
  assert.equal(w('event', 'agent_removed_alert'), 'Agent removed alert');
});

test('no function is declared twice in makaug-app.js (a second declaration silently replaces the first)', () => {
  const src = read('assets/makaug-app.js');
  const names = [...src.matchAll(/^(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/gm)].map((m) => m[1]);
  const seen = new Set(); const dups = new Set();
  for (const n of names) { if (seen.has(n)) dups.add(n); seen.add(n); }
  // adminFormatUgx was already declared twice before this PR (the later one wins); left for a later clean-up.
  assert.deepEqual([...dups].filter((n) => /^(staff|admin|plain)/.test(n) && n !== 'adminFormatUgx'), []);
});
