'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const rules = require('../services/callingRules');
const { stageOf, STAGES } = require('../services/staffPipeline');
const { ROUTES } = require('../services/callingRoutes');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('interested counts only with a follow-up text marked sent after the call', () => {
  const n = (extra) => ({ outcomes: ['interested'], said_hi: false, last: { outcome: 'interested' }, ...extra });
  assert.strictEqual(stageOf(n({})), 'contacted');
  assert.strictEqual(stageOf(n({ text_sent: true })), 'interested');
  assert.deepStrictEqual(STAGES, ['contacted', 'interested', 'said_hi', 'to_close', 'paid']);
  assert.match(rules.textSentSql('call_attempts'), /call_sms_log s WHERE s\.phone_key = call_attempts\.phone_key AND s\.at >= call_attempts\.shown_at/);
  for (const f of ['services/staffDesk.js', 'services/kingDesk.js']) assert.match(read(f), /textSentSql\('call_attempts'\)/, f);
});

test('a final no takes the number out of the pipeline; open ones stay with no 60-day cut-off', () => {
  assert.strictEqual(stageOf({ outcomes: ['interested', 'rejected'], last: { outcome: 'rejected' } }), null);
  assert.strictEqual(stageOf({ outcomes: ['interested', 'no_answer'], last: { outcome: 'no_answer' }, text_sent: true }), 'interested');
  assert.strictEqual(stageOf({ outcomes: ['rejected'], last: { outcome: 'rejected' }, paid: true }), 'paid');
  const src = read('services/staffPipeline.js');
  assert.match(src, /async function pipeline\(personKey, \{ days = null \} = \{\}\)/);
  assert.doesNotMatch(src, /days = 60/);
});

test('an open follow-up that does not answer comes back next day at 9am Kampala, then after 2 days', () => {
  const now = new Date('2026-11-23T10:00:00Z'); // 13:00 Kampala
  assert.strictEqual(rules.autoRetryAt([{ outcome: 'interested' }], now).toISOString(), '2026-11-24T06:00:00.000Z');
  assert.strictEqual(rules.autoRetryAt([{ outcome: 'no_answer' }, { outcome: 'interested' }], now).toISOString(), '2026-11-25T06:00:00.000Z');
  assert.strictEqual(rules.autoRetryAt([{ outcome: 'no_answer' }, { outcome: 'no_answer' }, { outcome: 'call_back' }], now).toISOString(), '2026-11-25T06:00:00.000Z');
  assert.strictEqual(rules.autoRetryAt([{ outcome: 'rejected' }], now), null);
  assert.strictEqual(rules.autoRetryAt([], now), null);
});

test('unpaid agents get a Remove? flag at 30 days (flag only)', () => {
  const now = new Date('2026-11-22T12:00:00Z');
  assert.deepStrictEqual(rules.removeFlag({ paid_until: '2026-10-20' }, now), { unpaid_days: 33, remove: true });
  assert.strictEqual(rules.removeFlag({ paid_until: '2026-11-10' }, now).remove, false);
  assert.strictEqual(rules.removeFlag({ since: '2026-10-01T00:00:00Z' }, now).remove, true);
  assert.doesNotMatch(read('services/kingDesk.js'), /removed_at = NOW\(\)[^\n]*remove_flag/);
});

test('anti-cheat: outcome needs the Call tap (wrong number excepted, flagged no_dial); interested needs a date', () => {
  const src = read('services/callingScreen.js');
  assert.match(src, /if \(!a\.tapped_at && !rules\.NO_DIAL_OK\.has\(def\.key\)\) throw httpError\(409/);
  assert.match(src, /if \(!a\.tapped_at\) flags\.push\('no_dial'\)/);
  assert.deepStrictEqual([...rules.NO_DIAL_OK], ['wrong_number']);
  assert.match(src, /INTERESTED_OUTCOMES\.includes\(o\.key\) \? \{ \.\.\.o, date: 'required' \}/);
  assert.match(src, /p\.away_s = /);
  assert.match(read('assets/king-desk.js'), /data-kd-away/);
});

test('queue feed: older never-called found-online posters, and a low-list warning under 100', () => {
  const src = read('services/callingScreen.js');
  assert.match(src, /created_at <= NOW\(\) - INTERVAL '30 days'[\s\S]{0,200}NOT EXISTS \(SELECT 1 FROM call_attempts/);
  assert.strictEqual(rules.LOW_LIST_AT, 100);
  assert.match(read('services/staffDesk.js'), /low_list: await calling\.freshLeft/);
  assert.match(read('assets/staff-desk.js'), /data-sd-low-list/);
  assert.match(read('services/kingDesk.js'), /kind: 'low_list'/);
});

test('the calling flow sends texts only: no WhatsApp sending for films or payments', () => {
  for (const f of ['services/callingContact.js', 'services/callingDay.js']) {
    assert.doesNotMatch(read(f), /deliverWhatsapp|sendPayLink\(|wa\.me/, f);
  }
  const ui = read('assets/calling-screen.js');
  assert.doesNotMatch(ui, /Open in WhatsApp|Sent on makaug WhatsApp|Approve & send|fallback\.wa_url/);
  assert.match(ui, /Text it \(SMS\)/);
});

test('incoming lookup says agent / poster / prospect / unknown', () => {
  const src = read('services/callingExtras.js');
  for (const k of ['agent', 'poster', 'prospect', 'unknown']) assert.match(src, new RegExp(`kind: '${k}'`));
  assert.match(read('assets/calling-screen.js'), /data-in-kind=/);
});

test('script branches: owner not agent, another site, send it on WhatsApp → we text', () => {
  const n = ROUTES.new_agents.nodes || ROUTES.new_agents;
  const labels = (k) => n[k].replies.map((r) => r[0]);
  assert.ok(labels('pitch_agent').includes("I'm the owner, not an agent"));
  assert.ok(labels('pitch_agent').includes('I already use another site (Jiji, Facebook…)'));
  for (const k of ['pitch_owner', 'how', 'elsewhere']) assert.ok(n[k].replies.some((r) => r[1] === 'send_wa'), k);
  assert.match(n.send_wa.say, /text you the makaug\.com link by SMS/);
  assert.strictEqual(n.send_wa_ok.end.outcome, 'interested');
  for (const [k, v] of Object.entries(n)) {
    for (const r of v.replies || []) assert.ok(n[r[1]], `${k} → ${r[1]}`);
    if (v.replies) assert.ok(v.replies.length >= 3 && v.replies.length <= 6, k);
  }
});
