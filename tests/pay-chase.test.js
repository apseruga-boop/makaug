'use strict';
// King › Sales & Revenue › "Asked for money" (17 Nov 2026). Pure rules + wiring, no database.
// Run: node --test tests/pay-chase.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildPayChase } = require('../services/payChaseService');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const now = new Date('2026-11-17T12:30:00Z').getTime();
const ago = (d, h = 0) => new Date(now - d * 86400000 - h * 3600000).toISOString();
const agent = (id, name, o = {}) => ({ agent_id: id, agent_name: name, payer_name: name, agent_status: 'approved', fee_exempt: false, purpose: 'agent_subscription', amount_ugx: 50000, status: 'open', sent_to: '256700000' + id.slice(-3), ...o });
// The shapes found on production on 17 Nov 2026, with made-up people and numbers.
const links = [
  { code: 'MKTEST1', purpose: 'other', description: 'Test payment — makaug payment links', amount_ugx: 1000, status: 'open', payer_name: 'Arthur', sent_to: '447700900202', is_test: true, created_at: ago(45), sent_at: ago(45) },
  agent('a-001', 'Suspended Never Opened', { code: 'MK1', agent_status: 'suspended', created_at: ago(43), sent_at: ago(43) }),
  agent('a-002', 'Lists Free', { code: 'MK2', fee_exempt: true, fee_exempt_reason: 'Approved before the fee', created_at: ago(41), sent_at: ago(41) }),
  agent('a-003', 'Asked Twice', { code: 'MK3', created_at: ago(40), sent_at: ago(36), opened_at: ago(40) }),
  agent('a-003', 'Asked Twice', { code: 'MK4', created_at: ago(7), sent_at: ago(7), opened_at: ago(7) }),
  // A reminder carried the link; WhatsApp drew the preview a second later.
  agent('a-004', 'Preview Only', { code: 'MK5', fee_offer_mode: 'free_period', fee_offer_until: '2026-11-08', created_at: ago(12), sent_at: ago(8), opened_at: ago(12), billing_reminder_log: { 'pre_due:x': { at: ago(12) } } }),
  agent('a-005', 'Real Opener', { code: 'MK6', created_at: ago(9), sent_at: ago(9), opened_at: ago(7) }),
  agent('a-006', 'Free Until Tomorrow', { code: 'MK7', fee_offer_mode: 'free_period', fee_offer_until: new Date('2026-11-18T00:00:00'), created_at: ago(2), sent_at: ago(2) }),
  agent('a-007', 'Paid By Card', { code: 'MK8', status: 'paid', paid_method: 'card', created_at: ago(15), sent_at: ago(15), paid_at: ago(12) }),
  agent('a-008', 'Paid Another Way', { code: 'MK9', created_at: ago(20), sent_at: ago(20), paid_elsewhere_at: ago(4) }),
  agent('a-009', 'Made Not Sent', { code: 'MK10', created_at: ago(3) }),
  agent('a-010', 'Cancelled', { code: 'MK11', status: 'cancelled', created_at: ago(3), sent_at: ago(3) }),
  agent('a-011', 'Sent Today', { code: 'MK12', created_at: ago(0, 2), sent_at: ago(0, 2) })
];
const c = buildPayChase(links, { now });
const byName = Object.fromEntries(c.people.map((p) => [p.name, p]));

test('one row per person, the status chip says what really happened', () => {
  assert.equal(byName.Arthur.status, 'test');
  assert.equal(byName['Lists Free'].status, 'exempt');
  assert.equal(byName['Asked Twice'].asks, 2, 'two links, one person');
  assert.equal(byName['Asked Twice'].outstanding_ugx, 50000, 'owes one month, not two');
  assert.equal(byName['Asked Twice'].days_waiting, 36, 'waiting since the first link went');
  assert.equal(byName['Asked Twice'].status, 'never_opened', 'an "open" the moment a link is made is the preview');
  assert.equal(byName['Preview Only'].status, 'never_opened', 'an "open" as our reminder went is the preview');
  assert.equal(byName['Real Opener'].status, 'opened');
  assert.equal(byName['Free Until Tomorrow'].status, 'not_due');
  assert.match(byName['Free Until Tomorrow'].next_step, /until 18 Nov/);
  assert.equal(byName['Paid By Card'].status, 'paid');
  assert.equal(byName['Paid Another Way'].status, 'paid', 'money in the ledger after we asked: not waiting');
  assert.match(byName['Paid Another Way'].next_step, /still reads open/);
  assert.equal(byName['Made Not Sent'], undefined, 'never sent: nobody was asked');
  assert.equal(byName.Cancelled, undefined);
  assert.match(byName['Sent Today'].next_step, /Sent today/);
  assert.equal(byName['Sent Today'].next_action, 'copy');
  assert.equal(byName['Suspended Never Opened'].next_action, 'send_again');
});

test('the tiles are counted from the rows: they add up', () => {
  const t = c.tiles;
  const real = c.people.filter((p) => p.status !== 'test');
  const waiting = real.filter((p) => p.status === 'opened' || p.status === 'never_opened');
  assert.equal(t.requested, real.length);
  assert.equal(t.requested, t.waiting + t.paid + t.not_due + t.exempt, 'every person asked is in one bucket');
  assert.equal(t.waiting, waiting.length);
  assert.equal(t.waiting, t.never_opened + t.opened_not_paid);
  assert.equal(t.outstanding_ugx, waiting.reduce((s, p) => s + p.outstanding_ugx, 0));
  assert.equal(t.outstanding_ugx, 5 * 50000);
  assert.equal(t.tests, 1);
  assert.equal(t.conversion_pct, Math.round((2 / (real.length - t.exempt - t.not_due)) * 100));
  assert.equal(c.ageing.reduce((s, b) => s + b.people, 0), t.waiting, 'the ageing chart covers everyone waiting');
  assert.equal(c.ageing.reduce((s, b) => s + b.ugx, 0), t.outstanding_ugx);
  assert.deepEqual(c.ageing.map((b) => b.key), ['0-7', '8-14', '15-30', '30+']);
  assert.equal(c.ageing.find((b) => b.key === '30+').people, 2);
  // The list is waiting first, longest wait first.
  assert.deepEqual(c.people.slice(0, 2).map((p) => p.name), ['Suspended Never Opened', 'Asked Twice']);
});

test('requests vs paid over time, by day, week and month; tests left out', () => {
  assert.equal(c.series.day.length, 30);
  assert.equal(c.series.week.length, 12);
  assert.equal(c.series.month.length, 12);
  const asked = c.series.month.reduce((s, b) => s + b.asked, 0);
  assert.equal(asked, links.filter((l) => l.sent_at && l.status !== 'cancelled' && !l.is_test).length);
  assert.equal(c.series.month.reduce((s, b) => s + b.paid, 0), c.tiles.paid);
  assert.equal(c.series.week[c.series.week.length - 1].start, '2026-11-16', 'weeks start on Monday, Kampala time');
});

test('phones leave the server as the last three digits only', () => {
  for (const p of c.people) {
    assert.ok(!('sent_to' in p) && !('payer_phone' in p));
    assert.match(p.phone_last3, /^\d{3}$/);
    assert.ok(!/\d{9}/.test(p.key.replace(/^phone:[0-9a-f]{12}$/, '')), 'the group key is a hash, not the number');
  }
  assert.ok(!/\d{6,}/.test(JSON.stringify(c.people.map(({ url, key, ...p }) => p))), 'no long number anywhere in the rows');
});

test('is it connected: an empty ledger and no MoMo SMS are said plainly', () => {
  const empty = buildPayChase(links, { now, money: { entries_30d: 0, sms_last_at: null, card_paid: 0, claims_pending: 0, paid_links_without_entry: 0, paid_but_link_open: 0 } });
  const text = empty.money.items.map((i) => `${i.ok ? 'ok' : 'warn'} ${i.text}`).join('\n');
  assert.match(text, /warn No payment recorded in the ledger/);
  assert.match(text, /warn No MoMo merchant SMS has ever reached the site/);
  assert.match(text, /sent more than one link: shown once/);
});

test('wired into Sales & Revenue, the old worklist replaced, phones masked in the UI', () => {
  const admin = read('routes/admin.js');
  assert.match(admin, /require\('\.\.\/services\/payChaseService'\)\.payChaseOverview\(db\)/);
  assert.match(admin, /pay_chase: payChase,/);
  const app = read('assets/makaug-app.js');
  const start = app.indexOf('function adminPayChaseChip');
  const end = app.indexOf('function adminCreatePayLink');
  const block = app.slice(start, end);
  for (const label of ['Never opened', 'Opened, not paid', 'Paid', 'Test', 'Exempt', 'Not due yet']) assert.ok(block.includes(`"${label}"`), label);
  assert.match(block, /data-paychase-chart/);
  assert.match(block, /data-paychase-ageing/);
  assert.match(block, /onclick="adminSendPayLink\('\$\{code\}'\)"[^>]*>Send again</, 'Send again is the same call as before');
  assert.ok(!/sent_to|payer_phone/.test(block), 'the card never reads a full number');
  const linksTable = app.slice(app.indexOf('function adminPayLinksBlock'), app.indexOf('function adminPayChaseChip'));
  assert.ok(!/to \+\$\{adminEscape\(l\.sent_to\)\}/.test(linksTable), 'the links table masks the number too');
});

test('the data fix is a migration with a backup and a rollback', () => {
  const sql = read('db/migrations/240_pay_links_chase_tidy.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS pay_links_chase_240_backup/);
  assert.match(sql, /description ~\* '\^\\s\*test\\y'/, 'Postgres word boundary is \\y, not \\b');
  assert.match(sql, /INSERT INTO pay_links_chase_240_backup[\s\S]*UPDATE pay_links l SET is_test = TRUE/);
  assert.match(sql, /INSERT INTO pay_links_chase_240_backup[\s\S]*UPDATE pay_links l\s+SET sent_at/);
  assert.ok(!/DELETE/i.test(sql.replace(/--.*$/gm, '')), 'nothing is deleted');
  assert.ok(!/\d{9,}/.test(sql), 'no phone numbers in a public repo');
  const rb = read('scripts/rollback-240-pay-links-chase-tidy.sql');
  assert.match(rb, /FROM pay_links_chase_240_backup b WHERE b\.pay_link_id = l\.id AND b\.change = 'is_test'/);
  assert.match(rb, /SET sent_at = b\.before_sent_at, sent_status = b\.before_sent_status/);
});
