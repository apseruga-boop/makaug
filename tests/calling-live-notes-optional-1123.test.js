'use strict';
// Live notes are optional (Arthur, 23 Nov 2026): Ronald's laptop gets the Web
// Speech "network" error, so the mic check never passed and Call now stayed
// locked. Calling must never wait on live notes or the phone link; with no
// transcript the caller types a few words instead, so nothing is lost.
// Run: node --test tests/calling-live-notes-optional-1123.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

function withDb(handler, fn) {
  const dbPath = require.resolve('../config/database');
  const svcPath = require.resolve('../services/callingScreen');
  const old = require.cache[dbPath];
  delete require.cache[svcPath];
  const fake = new Module(dbPath); fake.filename = dbPath; fake.loaded = true;
  fake.exports = { query: async (sql, params) => ({ rows: await handler(String(sql), params || []) }) };
  require.cache[dbPath] = fake;
  try { return fn(require('../services/callingScreen')); } finally {
    if (old) require.cache[dbPath] = old; else delete require.cache[dbPath];
    delete require.cache[svcPath];
  }
}

test('tap: a failed or missing mic check, or a dropped phone link, never blocks the call', async () => {
  const attempt = { id: 'a1', session_id: 's1', status: 'shown', shown_at: new Date(Date.now() - 60000).toISOString(), phone: '0700000123', phone_key: '700000123' };
  for (const check of [null, {}, { notes: 'failed', at: new Date().toISOString() }, { notes: 'ok', at: new Date().toISOString(), link: 'down' }]) {
    let updated = false;
    await withDb(async (sql) => {
      if (/client_ops\)/.test(sql) && /ANY\(client_ops\)/.test(sql)) return [];
      if (/^UPDATE call_attempts SET tapped_at/m.test(sql.trim())) { updated = true; return [{ ...attempt, status: 'calling', tapped_at: new Date().toISOString() }]; }
      if (/FROM call_sessions/.test(sql)) return [{ id: 's1', ended_at: null }];
      if (/FROM call_attempts/.test(sql)) return [attempt];
      return [];
    }, async (c) => {
      const out = await c.tap('a1', { sessionId: 's1', check });
      assert.equal(out.status, 'calling');
    });
    assert.ok(updated, `tap saved with check ${JSON.stringify(check)}`);
  }
});

test('a typed note with no transcript needs a few real words, not just the outcome name', () => {
  const c = require('../services/callingScreen');
  const def = { key: 'interested', label: 'Interested', spoke: true };
  assert.equal(c.noteTooThin('Interested', def), true);
  assert.equal(c.noteTooThin('ok', def), true);
  assert.equal(c.noteTooThin('yes!!', def), true);
  assert.equal(c.noteTooThin('Has 3 rentals in Ntinda, will say Hi tonight', def), false);
  assert.equal(c.noteTooThin('Busy driving', { key: 'call_back', label: 'Call back' }), false);
});

test('wrap-up: the server asks for a few words only when there is no transcript', () => {
  const src = read('services/callingScreen.js');
  assert.match(src, /if \(def\.spoke && !cleanTranscript\(transcript\) && noteTooThin\(text, def\)\)/);
  assert.match(src, /Live notes are off, so type a few words about what they said\./);
  assert.doesNotMatch(src, /notes_check_required/);
  assert.doesNotMatch(src, /httpError\(428/);
  // The other rules stay: Call tap first, Interested name + number.
  assert.match(src, /Tap Call first\. An outcome can only be saved after you rang the number\./);
  assert.match(src, /Interested: type their name as they want it shown\./);
});

test('calling screen: Call now is always shown; live notes failing is a calm amber note with a retry', () => {
  const js = read('assets/calling-screen.js');
  assert.match(js, /if \(S\.phase === 'shown'\) \{[\s\S]{0,200}body = gateHtml\(\) \+ '<a class="mkc-btn go mkc-call"/);
  assert.match(js, /Live notes are off on this laptop, so type a short note after each call instead\./);
  assert.match(js, /🔁 Try live notes again/);
  assert.match(js, /You can still call\./, 'a dropped phone link is a warning only');
  assert.doesNotMatch(js, /Calls stay locked until live notes can hear you/);
  assert.doesNotMatch(js, /Calls are paused/);
  assert.match(js, /noteMustBeTyped\(o\) && \(!w\.typed \|\| noteIsShort\(w\.note\)\)/);
  assert.match(js, /data-mkc-notebox/);
  // A network error during a call switches live notes off for the next calls.
  assert.match(js, /code === 'network' \|\| code === 'not-allowed' \|\| code === 'service-not-allowed'\) \{ CHK\.notes = 'failed'/);
});

test('old "send the film" next steps are shown in today\'s words', () => {
  const c = require('../services/callingScreen');
  assert.equal(c.currentWording('Callback set by you (interested): Wait for their Hello, then send the film and link'),
    'Callback set by you (interested): Wait for their Hi, then they’re approved and can load properties');
  assert.equal(c.currentWording('Send the film and link on WhatsApp, then call back'), 'Text them the makaug.com link, then call back');
  assert.equal(c.currentWording('Call back'), 'Call back');
  const p = c.present({ id: 'x', phone: '0700000123', source_label: 'Callback set by you (interested): Wait for their Hello, then send the film and link', reason: '' }, {}, [{ at: '2026-11-21T08:00:00Z', next_text: 'Wait for their Hello, then send the film and link' }]);
  assert.doesNotMatch(JSON.stringify(p), /film/);
});
