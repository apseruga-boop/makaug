'use strict';
// Staff desk red badges, Interested follow-through, seeker branch, first texts, WhatsApp missed calls, King view (22 Nov 2026).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ft = require('../services/callingFollowThrough');
const scripts = require('../services/callingScripts');
const rules = require('../services/callingRules');
const contact = require('../services/callingContact');
const { ROUTES } = require('../services/callingRoutes');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('a Hi is recognised; long or unrelated messages are not', () => {
  for (const t of ['Hi', 'hii', 'Hello makaug', 'Gyebale ko', 'Good morning', 'hey']) assert.ok(ft.looksLikeHello(t), t);
  for (const t of ['', 'Where is the house?', 'This is a long message about my property in Kira that I would like to list with you soon please']) assert.ok(!ft.looksLikeHello(t), t);
  assert.strictEqual(ft.FREE_DAYS, 3);
  assert.strictEqual(ft.CHANNEL, 'calling_interested');
});

test('the shown name is cleaned to letters and kept as typed', () => {
  assert.strictEqual(ft.cleanShownName('  Grace   Nakato '), 'Grace Nakato');
  assert.strictEqual(ft.cleanShownName("O'Neil-Ssemanda 2"), "O'Neil-Ssemanda");
  assert.strictEqual(ft.cleanShownName('1'), '');
  assert.match(ft.welcomeText('Grace Nakato', 'Ronald'), /Grace Nakato/);
});

test('first texts: warm, lowercase makaug.com, English and Luganda, 1 to 2 SMS', () => {
  const keys = ['first_agent', 'first_owner', 'first_seeker', 'first_no_answer', 'first_call_back'];
  for (const k of keys) {
    const t = scripts.FIRST_TEXTS.find((x) => x.key === k);
    assert.ok(t && t.text && t.text_lg, k);
    for (const s0 of [t.text, t.text_lg]) {
      const s = s0.replace(/\{name\}/g, 'Grace Nakato').replace(/\{caller\}/g, 'Ronald').replace(/\{area\}/g, 'Kira').replace(/\{link\}/g, 'makaug.com/to-rent?area=Kira');
      assert.ok(s.length <= 306, `${k} fits 2 SMS (${s.length})`);
      assert.ok(!/MakaUg|MAKAUG|Makaug\.com/.test(s), `${k} uses the lowercase brand`);
      assert.match(s, /makaug\.com/);
    }
  }
  assert.strictEqual(scripts.FIRST_TEXT_FOR.interested, 'first_agent');
  assert.strictEqual(scripts.FIRST_TEXT_FOR.no_answer, 'first_no_answer');
  assert.strictEqual(scripts.FIRST_TEXT_FOR.seeker_texted, 'first_seeker');
});

test('seeker: outcome is final, link is the public area search, route ends on it', () => {
  assert.ok(rules.FINAL_NO.has('seeker_texted'));
  assert.strictEqual(rules.SEEKER_OUTCOME.label, 'Seeker, text sent');
  assert.strictEqual(contact.seekerLink('rent', 'Kira Town'), 'makaug.com/to-rent?area=Kira%20Town');
  assert.strictEqual(contact.seekerLink('buy', 'Ntinda'), 'makaug.com/for-sale?area=Ntinda');
  const all = JSON.stringify(ROUTES);
  const N = ROUTES.new_agents.nodes;
  assert.ok(N.open.replies.some((r) => r[1] === 'wrong_person' && /looking for a place/i.test(r[0])));
  assert.strictEqual(N.wrong_person.replies[0][1], 'seeker');
  assert.strictEqual(N.seeker.form, 'seeker');
  assert.strictEqual(N.seeker_link.end.outcome, 'seeker_texted');
  assert.match(all, /seeker_texted/);
});

test('wrap-up: Interested on new agents needs the name and the number read back', () => {
  const s = read('services/callingScreen.js');
  assert.match(s, /Interested: type their name as they want it shown\./);
  assert.match(s, /read the number back/);
  const ui = read('assets/calling-screen.js');
  assert.match(ui, /data-mkc-shownname/);
  assert.match(ui, /data-mkc-phoneok/);
  assert.match(ui, /contact_name/);
  assert.match(ui, /phone_confirmed/);
});

test('their Hi on WhatsApp or SMS approves the waiting profile', () => {
  assert.match(read('routes/whatsapp.js'), /followThrough\.onHello|onHello\(/);
  assert.match(read('routes/moneySms.js'), /onHello\(/);
});

test('staff desk: red badges, two review items, WhatsApp missed calls, King view', () => {
  const d = read('assets/staff-desk.js');
  assert.match(d, /Agent properties to review/);
  assert.match(d, /Found online to review/);
  assert.match(d, /#e11d48/);
  assert.match(d, /\/desk\/badges/);
  assert.match(d, /data-sd-wa-callback/);
  assert.match(d, /Viewing as King/);
  const r = read('routes/staffDesk.js');
  assert.match(r, /'\/desk\/badges'/);
  assert.match(r, /\/desk\/missed\/wa\/:id\/call-back/);
  assert.match(r, /king_view: ?true/);
  assert.match(read('routes/staff.js'), /\/properties\/review-counts/);
  assert.match(read('server.js'), /\/desk/);
  // Never insert a source the call_missed check does not allow.
  assert.doesNotMatch(read('services/staffPipeline.js'), /INSERT INTO call_missed[^;]*'whatsapp'\)/);
});

test('no full phone numbers in the new code', () => {
  for (const f of ['services/callingFollowThrough.js', 'services/callingContact.js', 'assets/staff-desk.js', 'routes/staffDesk.js']) {
    assert.doesNotMatch(read(f).replace(/700000\d{3}|7000001\d{2}|700900\d{3}/g, ''), /\+?256[ -]?7\d{2}[ -]?\d{3}[ -]?\d{3}/, f);
  }
});
