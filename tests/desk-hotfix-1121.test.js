'use strict';
// Hotfix 21 Nov 2026 (Arthur): King/staff desk chrome + layout, King's name and week chart,
// predictive branching call scripts, no WhatsApp sending from calls, and a working Texts tab.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const db = require('../config/database');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
test.after(async () => { try { await db.pool.end(); } catch (_) {} });

const { ROUTES, PICKUP } = require('../services/callingRoutes');

test('every script step offers 3 to 6 replies and every branch ends in an outcome', () => {
  for (const [task, R] of Object.entries(ROUTES)) {
    for (const [id, n] of Object.entries(R.nodes)) {
      if (n.end) { assert.ok(n.end.outcome, `${task}.${id} has an outcome`); continue; }
      assert.ok(n.replies.length >= 3 && n.replies.length <= 6, `${task}.${id}: ${n.replies.length} replies`);
    }
  }
});

test('new agents script covers every likely route', () => {
  const N = ROUTES.new_agents.nodes;
  const reach = new Set(); const stack = [ROUTES.new_agents.start];
  while (stack.length) { const id = stack.pop(); if (reach.has(id)) continue; reach.add(id); const n = N[id]; if (n && n.replies) n.replies.forEach((r) => stack.push(r[1])); }
  for (const id of ['later', 'wrong_person', 'wrong', 'notint', 'elsewhere', 'price', 'how', 'meet', 'pitch_owner', 'pitch_agent', 'caretaker', 'list_now', 'seeker', 'luganda', 'angry', 'dnc', 'referral']) {
    assert.ok(reach.has(id), `reachable: ${id}`);
  }
  assert.equal(N.luganda.lang, 'lg');
  const labels = PICKUP.map((p) => p[0].toLowerCase()).join(' | ');
  assert.match(labels, /no answer/); assert.match(labels, /voicemail/);
  // A booked call back is always a real time, never "later".
  for (const k of ['call_back_cb_24h', 'call_back_cb_2d', 'call_back_cb_mon']) assert.ok(N[k].end.when);
});

test('scripts are inbound-first and never send WhatsApp messages or films', () => {
  const scripts = require('../services/callingScripts');
  const all = JSON.stringify(ROUTES) + JSON.stringify(scripts.VARIANTS || {}) + JSON.stringify(scripts.SMS_TEXTS) + JSON.stringify(scripts.COACH || {});
  assert.doesNotMatch(all, /film|vidiyo|video/i);
  assert.doesNotMatch(all, /I will (send|WhatsApp) you/i);
  assert.match(JSON.stringify(ROUTES.new_agents), /say \\"Hi\\" on WhatsApp to \{wa\}/);
  assert.equal(scripts.WHATSAPP_DISPLAY, '0780 863 394');
});

test('calling screen has no Share on WhatsApp and no wa.me send links', () => {
  const src = read('assets/calling-screen.js');
  assert.doesNotMatch(src, /data-mkc-washare>|openShare\(|Send the film/);
  // The only wa.me mention left is the guard that blocks such links in practice mode.
  const hits = src.split('\n').filter((l) => /wa\.me/.test(l));
  assert.equal(hits.length, 1); assert.match(hits[0], /closest\(/);
  assert.doesNotMatch(src, /data-vreq="/);
});

test('Texts tab: three ready SMS texts with sms: links that are logged', () => {
  const scripts = require('../services/callingScripts');
  // The first texts after a call (22 Nov 2026) come first, then the three ready texts.
  const first = scripts.FIRST_TEXTS.map((t) => t.key);
  assert.deepEqual(scripts.SMS_TEXTS.map((t) => t.key), [...first, 'say_hi', 'site_link', 'seeker_search']);
  const ready = scripts.SMS_TEXTS.slice(first.length);
  for (const t of ready) assert.ok(t.text.includes('0780 863 394'), t.key);
  assert.match(ready[1].text, /https:\/\/makaug\.com/);
  assert.match(ready[2].text, /\/to-rent/);
  const src = read('assets/calling-screen.js');
  assert.match(src, /function textsHtml\(a, ctx\)/);
  assert.match(src, /'sms:\+' \+ d \+ '\?body='/);
  assert.match(src, /op\('\/attempts\/' \+ a\.id \+ '\/sms', \{ person_key: S\.person, lang: [^,]+, template:/);
  assert.match(src, /if \(S\.tab === 'texts'\) bindTexts\(el, a, ctx\);/);
});

test('sms: links use the international number', () => {
  const src = read('assets/calling-screen.js');
  const fn = src.slice(src.indexOf('function smsDigits'), src.indexOf('function textsHtml'));
  const ctx = {}; vm.runInNewContext(fn + '; this.smsHref = smsHref;', ctx);
  assert.equal(ctx.smsHref('0700 900 010', 'Hi there'), 'sms:+256700900010?body=Hi%20there');
  assert.equal(ctx.smsHref('+256 700 900 010', 'x'), 'sms:+256700900010?body=x');
  assert.equal(ctx.smsHref('', 'x'), '');
});

test('logSms stores only known templates', async () => {
  const contact = require('../services/callingContact');
  const orig = db.query; const seen = [];
  db.query = async (sql, params) => { seen.push([sql, params]); if (/FROM call_attempts/.test(sql)) return { rows: [{ id: '11111111-2222-4333-8444-555555555555', phone_key: '700900010', person_key: 'ronald' }] }; if (/COUNT/.test(sql)) return { rows: [{ n: 1 }] }; return { rows: [] }; };
  try {
    await contact.logSms('11111111-2222-4333-8444-555555555555', { personKey: 'ronald', template: 'seeker_search' });
    await contact.logSms('11111111-2222-4333-8444-555555555555', { personKey: 'ronald', template: 'anything; drop table' });
    const ins = seen.filter((x) => /INSERT INTO call_sms_log/.test(x[0]));
    assert.equal(ins[0][1][4], 'seeker_search');
    assert.equal(ins[1][1][4], null);
  } finally { db.query = orig; }
});

test('migration 247 only adds a column and has a rollback', () => {
  const m = read('db/migrations/247_call_sms_template.sql');
  assert.match(m, /ADD COLUMN IF NOT EXISTS template TEXT/);
  assert.doesNotMatch(m.replace(/--.*$/gm, ''), /\b(DROP|DELETE|UPDATE|TRUNCATE)\b/i);
  assert.match(read('scripts/rollback-247-call-sms-template.sql'), /DROP COLUMN IF EXISTS template/);
});

test('desk shell: first name for the greeting, never "MakaUg"', () => {
  const src = read('assets/desk-shell.js');
  const body = { classList: { contains: () => false, toggle() {} }, insertBefore() {}, firstChild: null };
  const ctx = { window: {}, document: { querySelector: () => null, body, head: { appendChild() {} }, createElement: () => ({}) }, MutationObserver: class { observe() {} }, setInterval: () => 0, setTimeout: () => 0 };
  vm.runInNewContext(src, ctx);
  const f = ctx.window.makaugDeskShell.firstName;
  assert.equal(f('MakaUg', 'Super Admin', 'super_admin'), 'Arthur');
  assert.equal(f('MakaUg', 'Admin', 'admin'), 'King');
  assert.equal(f('', '', ''), 'King');
  assert.equal(f('Ronald', 'K', 'moderator'), 'Ronald');
  assert.equal(f('makaug', '', '', 'there'), 'there');
});

test('desk shell hides the public chrome and shows a slim header with Sign out', () => {
  const src = read('assets/desk-shell.js');
  for (const sel of ['body.mk-app > .mk-top-strip', 'body.mk-app > nav', 'body.mk-app > #language-spotlight', 'body.mk-app > footer', 'body.mk-app > #floating-whatsapp-link']) assert.ok(src.includes(sel), sel);
  assert.match(src, /data-mk-signout>Sign out</);
  const html = read('index.html');
  assert.match(html, /\/assets\/desk-shell\.js\?v=/);
});

test('King and staff sidebars stop where the dashboard ends', () => {
  assert.match(read('assets/king-desk.js'), /bottom:var\(--kd-bot,0px\)/);
  assert.match(read('assets/king-desk.js'), /setProperty\('--kd-bot', bottomGap\(\) \+ 'px'\)/);
  assert.match(read('assets/staff-desk.js'), /bottom:var\(--sd-bot,0px\)/);
});

test('King week chart has a legend and marks last week "not tracked"', () => {
  const src = read('assets/king-desk.js');
  const fn = src.slice(src.indexOf('function weekChart'), src.indexOf('function funnel'));
  const ctx = {}; vm.runInNewContext(fn + '; this.weekChart = weekChart;', ctx);
  const a = [5, 3, 0, 0, 0, 0, 0]; const b = [0, 0, 0, 0, 0, 0, 0];
  const un = ctx.weekChart(a, b, true);
  assert.match(un, /data-kd-legend/); assert.match(un, /This week/); assert.match(un, /Last week \(not tracked\)/); assert.match(un, /data-kd-lw-untracked/);
  const tr = ctx.weekChart(a, [1, 2, 3, 4, 5, 6, 7], false);
  assert.doesNotMatch(tr, /not tracked/); assert.match(tr, /Last week Sun: 7/);
});
