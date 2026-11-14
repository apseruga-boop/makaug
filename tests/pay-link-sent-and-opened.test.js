'use strict';

/**
 * Whether a payment link was sent, and whether a person opened it (15 Nov 2026).
 *
 * Two things the team reads before chasing somebody were wrong.
 *
 * "Not sent": the payment message a new agent gets on approval, and every
 * reminder, carried a link in their own words and never marked the link as
 * sent. Four agents approved on 11 to 14 Nov read "made, not sent", were
 * missing from King's list of people asked and gone quiet, and would have been
 * shown the menu had they asked "how do I pay?".
 *
 * "Opened, not paid": WhatsApp fetches a link the moment a message carrying it
 * is sent, to draw the preview, and that fetch was recorded as the payer
 * opening their page. Ten links were "opened" in the minute they were sent,
 * by people who have never replied.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

process.env.WHATSAPP_DELIVERY_MODE = 'web_bridge';

const payLinks = require('../services/payLinkService');
const billing = require('../services/billingOpsService');
const controlRoom = require('../services/agent007ControlRoom');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('a link preview being drawn is not a person opening their payment page', () => {
  const previews = [
    'WhatsApp/2.23.20.0 A',
    'WhatsApp/2.2587.9 W',
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Go-http-client/1.1',
    'axios/1.6.2',
    'node',
    'curl/8.4.0',
    '',
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13) WhatsApp/2.23.20.0'
  ];
  for (const ua of previews) assert.strictEqual(payLinks.isLinkPreviewFetch(ua), true, ua || '(no user agent)');
  const people = [
    'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
    'Mozilla/5.0 (Linux; Android 10; TECNO KE5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.181 Mobile Safari/537.36 OPR/63.3.3216.58675'
  ];
  for (const ua of people) assert.strictEqual(payLinks.isLinkPreviewFetch(ua), false, ua);
  const page = read('routes/pay.js');
  assert.match(page, /const track = !payLinks\.isLinkPreviewFetch\(req\.get\('user-agent'\)\);\s+let d = await payLinks\.pageData\(db, req\.params\.code, \{ track \}\);/);
});

test('an "open" in the minutes we sent something was ours, not theirs', () => {
  const link = { opened_at: '2026-10-24T06:00:40Z', created_at: '2026-10-19T15:29:00Z', sent_at: null };
  assert.strictEqual(payLinks.openedByAPerson(link, ['2026-10-24T06:00:25Z']), false, 'the reminder went at 06:00:25');
  assert.strictEqual(payLinks.openedByAPerson(link), true, 'with nothing to compare it to, it stands');
  assert.strictEqual(payLinks.openedByAPerson({ opened_at: '2026-11-09T06:06:10Z', created_at: '2026-11-09T06:06:05Z' }), false, 'opened as it was made');
  assert.strictEqual(payLinks.openedByAPerson({ opened_at: '2026-11-12T12:13:00Z', sent_at: '2026-11-12T12:12:10Z', created_at: '2026-11-12T12:11:00Z' }), false, 'opened as it was sent');
  assert.strictEqual(payLinks.openedByAPerson({ opened_at: '2026-11-12T15:40:00Z', sent_at: '2026-11-12T12:12:10Z', created_at: '2026-11-12T12:11:00Z' }), true, 'three hours later is a person');
  assert.strictEqual(payLinks.openedByAPerson({ sent_at: '2026-11-12T12:12:10Z' }), false, 'never opened');
  assert.strictEqual(payLinks.openedByAPerson(null), false);
});

test('the chase card says what really happened to the link', () => {
  const reminder = '2026-10-24T06:00:25Z';
  // The private owner on the list: a link made with the day-3 message, "opened" as the reminder went.
  const owners = { status: 'open', created_at: '2026-10-19T15:29:51Z', sent_at: null, opened_at: '2026-10-24T06:00:40Z' };
  assert.strictEqual(controlRoom.payLinkStateWord(owners, { ourSendTimes: ['2026-10-19T15:29:51Z', reminder] }), 'sent with our message of 24 Oct, not opened yet');
  assert.strictEqual(controlRoom.payLinkStateWord(owners), 'opened 24 Oct, not paid', 'what it used to say');
  // A real open, the day after.
  assert.strictEqual(controlRoom.payLinkStateWord({ ...owners, opened_at: '2026-10-25T10:00:00Z' }, { ourSendTimes: [reminder] }), 'opened 25 Oct, not paid');
  // Sent and marked so.
  assert.strictEqual(controlRoom.payLinkStateWord({ status: 'open', sent_at: '2026-11-12T12:12:10Z', created_at: '2026-11-12T12:11:00Z' }), 'sent 12 Nov, not opened yet');
  assert.strictEqual(controlRoom.payLinkStateWord({ status: 'open', created_at: '2026-11-12T12:11:00Z' }), 'made, not sent');
  assert.strictEqual(controlRoom.payLinkStateWord(null), 'none sent yet');
  assert.match(controlRoom.payLinkStateWord({ status: 'paid', paid_at: '2026-11-13T09:00:00Z' }), /^paid 13 Nov$/);
  assert.match(controlRoom.payLinkStateWord({ status: 'open', claim_id: 'c1', opened_at: '2026-11-13T09:00:00Z' }), /they say they have paid/);
  // The owner's card passes the times of what we sent them.
  const card = controlRoom.owesPersonMessage({
    kind: 'owner', id: 'p1', name: 'Okello Peter', title: 'Plot for Sale in Gayaza', phone: '256700555043', state: 'due', days_overdue: 22,
    since: '2026-10-17', amount_ugx: 20000, views_message_at: '2026-10-19T15:29:51Z', last_reminder_at: reminder
  }, { payLink: owners });
  assert.match(card, /🔗 Payment link: sent with our message of 24 Oct, not opened yet/);
  const lookups = read('routes/whatsapp.js');
  assert.match(lookups, /opened_at, paid_at, claim_id, created_at\s+FROM pay_links WHERE \$\{where\}/, 'the card has when the link was made');
});

test('a link that left in a reminder or on approval is marked as sent', async () => {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql: String(sql), params }); return { rows: [{ code: 'MKAB12CD' }] }; } };
  await billing.markPayLinkSent(db, 'https://makaug.com/pay/MKAB12CD', '256701000137', 'queued');
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].sql, /UPDATE pay_links[\s\S]*sent_at = NOW\(\)/);
  assert.deepStrictEqual(calls[0].params, ['MKAB12CD', '256701000137', 'queued']);
  // Nothing went, so nothing is marked.
  await billing.markPayLinkSent(db, 'https://makaug.com/pay/MKAB12CD', '256701000137', 'skipped');
  await billing.markPayLinkSent(db, '', '256701000137', 'queued');
  await billing.markPayLinkSent(db, 'https://makaug.com/list-property', '256701000137', 'queued');
  assert.strictEqual(calls.length, 1);
  // And a database hiccup never stops the reminder being logged.
  await assert.doesNotReject(billing.markPayLinkSent({ query: async () => { throw new Error('down'); } }, 'https://makaug.com/pay/MKAB12CD', '2567', 'queued'));

  const source = read('services/billingOpsService.js');
  const agent = source.slice(source.indexOf('async function sendAgentBillingMessage'), source.indexOf('async function takeDownAgentForBilling'));
  const lister = source.slice(source.indexOf('async function sendListerBillingMessage'), source.indexOf('async function takeDownListingForBilling'));
  assert.match(agent, /const delivery = await deliver\([^\n]+\n\s+await markPayLinkSent\(db, payLink, to, delivery\.status\);/);
  assert.match(lister, /const delivery = await deliver\([^\n]+\n\s+await markPayLinkSent\(db, payLink, to, delivery\.status\);/);
  const approval = read('routes/admin.js');
  assert.match(approval, /await payLinks\.recordPayLinkSent\(db, \{ code: prepared\.code, to: agentPhone, status: 'queued' \}\)/);
});

test('King\'s lists of links read the same way', async () => {
  const sent = '2026-11-08T06:03:35Z';
  const rows = [
    { code: 'MKPREVIEW', amount_ugx: 50000, sent_at: sent, created_at: '2026-11-05T06:07:00Z', opened_at: '2026-11-08T06:03:50Z', days_waiting: 6 },
    { code: 'MKPERSON1', amount_ugx: 50000, sent_at: sent, created_at: '2026-11-05T06:07:00Z', opened_at: '2026-11-09T18:00:00Z', days_waiting: 6 },
    { code: 'MKNOTOPEN', amount_ugx: 50000, sent_at: sent, created_at: '2026-11-05T06:07:00Z', opened_at: null, days_waiting: 1 }
  ];
  const db = { query: async () => ({ rows }) };
  const waiting = await payLinks.payLinksAwaitingPayment(db, { afterDays: 3 });
  assert.deepStrictEqual(waiting.map((row) => row.opened_by_them), [false, true, false]);
  assert.match(waiting[0].next_step, /^Sent 6 days ago, never opened — check the number and send it again$/);
  assert.match(waiting[1].next_step, /^Opened the page and has not paid, 6 days after it was sent — ask what is stopping them$/);
  assert.match(waiting[2].next_step, /^Sent 1 day ago, never opened/);
  const all = await payLinks.listPayLinks(db, { limit: 10 });
  assert.deepStrictEqual(all.map((row) => row.opened_by_them), [false, true, false]);
  const app = read('assets/makaug-app.js');
  assert.match(app, /\(l\.opened_by_them \?\? Boolean\(l\.opened_at\)\) \? "Opened, not paid" : \(l\.sent_at \? "Sent, not opened" : "Not sent"\)/);
});
