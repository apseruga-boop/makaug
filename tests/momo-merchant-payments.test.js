'use strict';

/**
 * MoMo merchant code payments (Arthur, 10 Nov 2026).
 *
 * "please make sure you add this especially to the payment link and the
 * whatsapp message ... an image similar to the ones above for momo merchant
 * codes ... remove the payment reference number, all they need to do is fill
 * in their business name and we can always match it back by business name and
 * the phone number ... look at the role the payment link is playing in
 * closing the loop and how can we make it tighter."
 *
 * The end-to-end run on a real Postgres (link → merchant SMS → one-tap
 * confirm → ledger, receipt and closed link) is described in the PR; these
 * pin the parts that are easy to break by accident.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const momo = require('../config/momoMerchant');
const card = require('../services/momoMerchantCardService');
const billing = require('../services/billingOpsService');
const match = require('../services/paymentMatchService');
const revenue = require('../services/revenueService');
const team = require('../services/teamBillingCommandService');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// --- The card ---------------------------------------------------------------

test('the card shows the merchant code in boxes, the registered name, MTN\'s steps and the amount', () => {
  const svg = card.cardSvg({ amountUgx: 50000, description: 'makaug agent subscription — 1 month (Jane Nakato)' });
  for (const digit of '27248497') assert.match(svg, new RegExp(`>${digit}</text>`));
  assert.match(svg, /MAKAUG ONLINE REAL ESTATE LTD/);
  assert.match(svg, /\*165\*3#/);
  assert.match(svg, /1: Merchant Code/);
  assert.match(svg, /UGX 50,000/);
  assert.match(svg, /Agent subscription — 1 month \(Jane Nakato\)/, '"makaug" is on the card already');
  assert.match(svg, /reply on WhatsApp with your business name/);
  assert.doesNotMatch(svg, /<image\b/, 'drawn from shapes and text: no MTN logo, no fetched pictures');
  const general = card.cardContent({});
  assert.deepEqual(general.steps[3], ['Enter', 'the amount']);
  assert.match(card.cardContent({ audience: 'person' }).after, /with your name\./);
});

test('the card renders as a PNG with the bundled fonts, and is cached', () => {
  const png = card.renderMomoCard({ amountUgx: 20000, description: 'makaug listing — 1 month: 2 bedroom house in Kira' });
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1080);
  assert.equal(png.readUInt32BE(20), 1350);
  assert.equal(card.renderMomoCard({ amountUgx: 20000, description: 'makaug listing — 1 month: 2 bedroom house in Kira' }), png);
  assert.match(card.momoCardUrl({ code: 'mkab12cd', base: 'https://makaug.com' }), /^https:\/\/makaug\.com\/pay\/MKAB12CD\/momo-card\.png\?v=\d+$/);
  assert.match(card.momoCardUrl({ base: 'https://makaug.com' }), /^https:\/\/makaug\.com\/pay\/momo-card\.png\?v=\d+$/);
});

test('a long description wraps to two lines at most', () => {
  const lines = card.twoLines('makaug listing — 1 month: 4 bedroom house for rent in Kira, Wakiso with a big garden and parking for six cars', 50);
  assert.ok(lines.length <= 2);
  assert.ok(lines.every((l) => l.length <= 50));
  assert.match(lines[1], /…$/);
});

// --- The WhatsApp words -----------------------------------------------------

test('*165*3# goes out in monospace, so WhatsApp shows the stars', () => {
  const line = momo.momoWhatsappSteps({ amountUgx: 50000 });
  assert.match(line, /dial ```\*165\*3#```/);
  assert.match(line, /enter \*27248497\*, then \*UGX 50,000\* and your MoMo PIN/);
  assert.doesNotMatch(line.replace(/```[^`]*```/g, ''), /\*165\*/, 'never a bare *165* outside the monospace');
  assert.match(momo.momoAfterPayingLine(), /\*business name\*/);
  assert.match(momo.momoAfterPayingLine({ lister: true }), /your name \(or business name\)/);
  assert.equal(momo.momoMerchantName({}), 'MAKAUG ONLINE REAL ESTATE LTD');
  assert.equal(momo.momoMerchantName({ pay_to: { name: 'OTHER LTD' } }), 'OTHER LTD');
});

test('every agent message that asks for money has the merchant code and asks for the business name; receipts do not', () => {
  const settings = { agent_fee: { monthly_ugx: 50000 } };
  const agent = { full_name: 'Jane Nakato', paid_until: '2026-11-20' };
  for (const kind of ['pre_due', 'due_today', 'reminder', 'final_reminder', 'taken_down']) {
    const text = billing.buildAgentBillingMessage(kind, { agent, settings, payLink: 'https://makaug.com/pay/MKAB12CD' });
    assert.match(text, /27248497/, kind);
    assert.match(text, /business name/, kind);
    assert.match(text, /Your payment page: https:\/\/makaug\.com\/pay\/MKAB12CD/, kind);
    assert.doesNotMatch(text, /transaction ID|0780|quote|reference/i, kind);
  }
  const paid = billing.buildAgentBillingMessage('paid', { agent, settings });
  assert.match(paid, /Payment received — thank you, Jane!/);
  assert.match(paid, /paid until \*Fri 20 Nov\*/);
  assert.doesNotMatch(paid, /27248497/);
  assert.ok(billing.AGENT_MESSAGE_KINDS.includes('paid'));
});

test('the lister reminder asks for their name (or business name), with the fee and the card link', async () => {
  const text = await billing.buildListerMessage({}, 'final_reminder', { id: 'p1', title: '2 bedroom house', lister_name: 'Mary Achieng' }, { lister_fee: { monthly_ugx: 20000 } }, 'https://makaug.com/pay/MKXY34ZQ');
  assert.match(text, /enter \*27248497\*, then \*UGX 20,000\*/);
  assert.match(text, /your name \(or business name\)/);
  assert.equal(billing.payLinkCardUrl('https://makaug.com/pay/MKXY34ZQ').replace(/^https?:\/\/[^/]+/, ''), '/pay/MKXY34ZQ/momo-card.png?v=' + card.CARD_VERSION);
});

test('"I have paid — Kato Homes" is a payment; "I haven\'t paid yet" and questions are not', () => {
  assert.deepEqual(billing.readPaidStatement('Paid. Wanyama Estates Ltd'), { business_name: 'Wanyama Estates Ltd' });
  assert.deepEqual(billing.readPaidStatement('Mwebale, I have paid. Business name: Kato Homes'), { business_name: 'Kato Homes' });
  assert.deepEqual(billing.readPaidStatement('I have paid via momo 50,000'), { business_name: null });
  assert.deepEqual(billing.readPaidStatement('payment done'), { business_name: null });
  assert.equal(billing.readPaidStatement("I haven't paid yet"), null);
  assert.equal(billing.readPaidStatement('when should I pay?'), null);
  assert.equal(billing.readPaidStatement('I will pay tomorrow'), null);
  assert.equal(billing.readPaidStatement('paid?'), null);
});

// --- Matching ---------------------------------------------------------------

test('names match on the person, not on "real estate ltd"', () => {
  assert.ok(match.namesMatch('GEORGE WANYAMA', 'George Wanyama'));
  assert.ok(match.namesMatch('Wanyama Estates Ltd', 'GEORGE WANYAMA'), 'one distinctive word is enough when one side has only one');
  assert.ok(!match.namesMatch('Kato Real Estate Ltd', 'Mukasa Real Estate Ltd'));
  assert.ok(!match.namesMatch('John', 'JOHN DOE'), 'a short first name alone is not enough');
  assert.ok(!match.namesMatch('', 'JOHN DOE'));
});

test('from their own number any amount that covers it; on a name only the exact amount or whole months', () => {
  assert.ok(match.amountFits(100000, 50000, 'phone'));
  assert.ok(!match.amountFits(40000, 50000, 'phone'));
  assert.ok(match.amountFits(50000, 50000, 'name'));
  assert.ok(match.amountFits(150000, 50000, 'name'));
  assert.ok(!match.amountFits(55000, 50000, 'name'));
  assert.ok(!match.amountFits(50000, 0, 'name'), 'a name with no amount to check is never enough');
});

test('two equally good answers are no answer: a person decides', () => {
  assert.equal(match.pickOne([{ how: 'phone', id: 1 }, { how: 'phone', id: 2 }]), null);
  assert.equal(match.pickOne([{ how: 'phone', id: 1 }, { how: 'name', id: 2 }]).id, 1);
  assert.equal(match.pickOne([{ how: 'name', id: 1 }, { how: 'name', id: 2 }]), null);
  assert.equal(match.pickOne([]), null);
});

test('who an SMS came from: the number and the name on the MoMo account', () => {
  assert.deepEqual(match.smsPayer({ counterparty: 'GEORGE WANYAMA 256772000001' }), { phoneKey: '772000001', name: 'GEORGE WANYAMA' });
  assert.deepEqual(match.smsPayer({ counterparty: null, body: 'from 0701234567' }), { phoneKey: '701234567', name: '' });
  assert.equal(match.methodForAccount('mtn_momopay'), 'mtn_momopay');
  assert.equal(match.methodForAccount('airtel_money'), 'airtel_money');
  assert.equal(match.methodForAccount(null), 'mtn_momo');
});

test('merchant SMS are read: a business name typed as the reference is never taken for the transaction ID', () => {
  const a = revenue.parseMoneySms("Y'ello. You have received a payment of UGX 50,000 from 256772123456 - GEORGE WANYAMA. Reference: Wanyama Estates. Transaction ID: 9876543210. New balance: UGX 150,000.", 'MTN');
  assert.deepEqual([a.direction, a.amount_ugx, a.reference, a.counterparty, a.balance_ugx], ['in', 50000, '9876543210', 'GEORGE WANYAMA 256772123456', 150000]);
  const b = revenue.parseMoneySms('You have received UGX 20,000 from SARAH NAKATO, 256701234567 for MAKAUG ONLINE REAL ESTATE LTD. ID: 55512345678. Your balance is UGX 70,000.', 'MoMoPay');
  assert.deepEqual([b.amount_ugx, b.reference, b.counterparty], [20000, '55512345678', 'SARAH NAKATO 256701234567']);
  const c = revenue.parseMoneySms('Payment received. UGX 50,000 from KATO BRIAN 0772123456 at MAKAUG ONLINE REAL ESTATE LTD. Ref: 4433221100. Bal: UGX 200,000', 'MTN MoMo');
  assert.equal(c.reference, '4433221100');
  const d = revenue.parseMoneySms('You have received UGX 50,000 from JOHN DOE (256772123456). Reference: ACME HOMES. New balance: UGX 1,000.', 'MTN');
  assert.equal(d.reference, null, 'no digits: a name, not a transaction ID');
  assert.equal(revenue.METHODS.mtn_momopay.account, 'mtn_momopay');
});

// --- One tap to confirm -----------------------------------------------------

test('a confirm link works for one confirmer, one claim, for a week — and nothing else', () => {
  const saved = process.env.PAYMENT_CONFIRM_SECRET;
  process.env.PAYMENT_CONFIRM_SECRET = 'test-secret-for-links';
  try {
    const claimId = '0f0e0d0c-0b0a-4908-8706-050403020100';
    const now = Date.parse('2026-11-11T08:00:00Z');
    const token = match.confirmToken(claimId, '709402189', { now });
    assert.deepEqual(match.readConfirmToken(token, { now }), { claimId, confirmerKey: '709402189', expired: false });
    assert.equal(match.readConfirmToken(token, { now: now + 8 * 86400000 }).expired, true);
    const [id, , exp, sig] = token.split('.');
    assert.equal(match.readConfirmToken([id, '757773202', exp, sig].join('.'), { now }), null, 'another person\'s number');
    assert.equal(match.readConfirmToken(token.replace(/.$/, (c) => (c === '0' ? '1' : '0')), { now }), null, 'tampered');
    assert.equal(match.readConfirmToken('nonsense', { now }), null);
    assert.equal(match.confirmToken('not-a-uuid', '709402189'), '');
  } finally {
    if (saved === undefined) delete process.env.PAYMENT_CONFIRM_SECRET; else process.env.PAYMENT_CONFIRM_SECRET = saved;
  }
});

test('Ronald and Arthur get the alert with their own confirm link; anyone else gets it without one', async () => {
  const saved = process.env.PAYMENT_CONFIRM_SECRET;
  process.env.PAYMENT_CONFIRM_SECRET = 'test-secret-for-links';
  const desk = require('../services/leadDeskService');
  const handoff = require('../services/leadHandoffService');
  const original = { recips: desk.alertRecipients, deliver: handoff.deliverWhatsapp, settings: billing.getSettings };
  const sent = [];
  desk.alertRecipients = () => ['+256709402189', '+256700002830'];
  handoff.deliverWhatsapp = async ({ to, body, kind }) => { sent.push({ to, body, kind }); return { status: 'queued' }; };
  billing.getSettings = async () => ({ confirmers: [{ name: 'Ronald', phone: '256709402189' }, { name: 'Arthur', phone: '447757773202' }] });
  try {
    const claim = {
      id: '0f0e0d0c-0b0a-4908-8706-050403020100', purpose: 'agent_subscription', agent_name: 'George Wanyama', link_code: 'MKAB12CD',
      sms_counterparty: 'GEORGE WANYAMA 256772000001', sms_amount_ugx: 50000, sms_reference: '7700112233', payer_phone: '256772000001'
    };
    await match.alertMoneyTeam({}, { kind: 'momo_payment_matched', nonce: 'n1', build: (c) => match.smsMatchedAlert(claim, 'phone', c) });
    assert.deepEqual(sent.map((s) => s.to), ['256709402189', '447757773202', '256700002830'], 'Ronald once, not twice');
    assert.match(sent[0].body, /MoMo payment in: UGX 50,000/);
    assert.match(sent[0].body, /Transaction ID: 7700112233/);
    assert.match(sent[0].body, /For: George Wanyama — agent subscription \(link MKAB12CD\)/);
    assert.match(sent[0].body, /Tap to confirm: https:\/\/makaug\.com\/pay\/confirm\/0f0e0d0c-0b0a-4908-8706-050403020100\.709402189\./);
    assert.match(sent[0].body, /reply \*CONFIRM 0772000001\*/);
    assert.match(sent[1].body, /\/pay\/confirm\/0f0e0d0c-0b0a-4908-8706-050403020100\.757773202\./, 'Arthur\'s own link');
    assert.doesNotMatch(sent[2].body, /pay\/confirm|CONFIRM/);
    assert.match(sent[2].body, /Ronald or Arthur will confirm it/);
  } finally {
    desk.alertRecipients = original.recips;
    handoff.deliverWhatsapp = original.deliver;
    billing.getSettings = original.settings;
    if (saved === undefined) delete process.env.PAYMENT_CONFIRM_SECRET; else process.env.PAYMENT_CONFIRM_SECRET = saved;
  }
});

test('CONFIRM needs a number or a transaction ID, and only a confirmer can use it', async () => {
  const original = billing.getSettings;
  billing.getSettings = async () => ({ confirmers: [{ name: 'Ronald', phone: '256709402189' }] });
  const db = { async query() { return { rows: [] }; } };
  try {
    assert.equal(await team.handleTeamBillingCommand(db, { phone: '256709402189', body: 'confirm the viewing for tomorrow' }), null, '"confirm" is also an ordinary word');
    assert.equal(await team.handleTeamBillingCommand(db, { phone: '256772000001', body: 'CONFIRM 0701000002' }), null, 'not a team number');
    assert.match(await team.handleTeamBillingCommand(db, { phone: '256709402189', body: 'CONFIRM 0701 000 002' }), /Nothing is waiting to be confirmed for 0701 000002/);
    assert.match(team.help(), /\*CONFIRM\* 0772123456/);
    assert.equal(team.transactionIdIn('CONFIRM 0772123456'), '', 'a phone number is not a transaction ID');
    assert.equal(team.transactionIdIn('CONFIRM 7700112233'), '7700112233');
  } finally {
    billing.getSettings = original;
  }
});

// --- Wiring -------------------------------------------------------------------

test('a payment message goes as the card with the message as its caption, and a long one as card then text', async () => {
  // leadHandoffService takes the bridge's queue function when it loads, so a
  // fresh copy is loaded here with the queue captured.
  const bridgePath = require.resolve('../services/whatsappWebBridgeService');
  const handoffPath = require.resolve('../services/leadHandoffService');
  const bridge = require(bridgePath);
  const savedQueue = bridge.queueWhatsappWebBridgeMessage;
  const savedMode = process.env.WHATSAPP_DELIVERY_MODE;
  const savedHandoff = require.cache[handoffPath];
  const queued = [];
  bridge.queueWhatsappWebBridgeMessage = async (args) => { queued.push(args); return { id: `q${queued.length}` }; };
  delete require.cache[handoffPath];
  try {
    const fresh = require(handoffPath);
    process.env.WHATSAPP_DELIVERY_MODE = 'web_bridge';
    const imageUrl = 'https://makaug.com/pay/MKAB12CD/momo-card.png?v=1';
    const short = await fresh.deliverWhatsappWithImage({ to: '256772000001', body: 'Pay with MoMo', imageUrl, kind: 'pay_link', nonce: 1 });
    assert.equal(short.image, true);
    assert.equal(queued.length, 1, 'one message: the card, captioned');
    assert.equal(queued[0].mediaType, 'image');
    assert.equal(queued[0].mediaUrl, imageUrl);
    assert.equal(queued[0].text, 'Pay with MoMo');
    queued.length = 0;
    await fresh.deliverWhatsappWithImage({ to: '256772000001', body: 'x'.repeat(1200), imageUrl, kind: 'pay_link', nonce: 2 });
    assert.equal(queued.length, 2, 'too long for a caption: the card, then the text');
    assert.equal(queued[0].mediaType, 'image');
    assert.equal(queued[1].text.length, 1200);
    queued.length = 0;
    await fresh.deliverWhatsappWithImage({ to: '256780863394', body: 'to ourselves', imageUrl, kind: 'pay_link', nonce: 3 });
    assert.equal(queued.length, 0, 'never to makaug\'s own number');
  } finally {
    bridge.queueWhatsappWebBridgeMessage = savedQueue;
    if (savedHandoff) require.cache[handoffPath] = savedHandoff; else delete require.cache[handoffPath];
    if (savedMode === undefined) delete process.env.WHATSAPP_DELIVERY_MODE; else process.env.WHATSAPP_DELIVERY_MODE = savedMode;
  }
});

test('the pieces are wired in: card and confirm routes, SMS alerts, King, migration', () => {
  const pay = read('routes/pay.js');
  assert.match(pay, /pages\.get\('\/momo-card\.png'/);
  assert.match(pay, /pages\.get\('\/:code\/momo-card\.png'/);
  assert.match(pay, /pages\.get\('\/confirm\/:token'/);
  assert.match(pay, /pages\.post\('\/confirm\/:token'/);
  assert.ok(pay.indexOf("pages.get('/confirm/:token'") < pay.indexOf("pages.get('/:code',"), 'before the catch-all');
  assert.match(read('routes/moneySms.js'), /afterMoneySms/);
  assert.match(read('services/revenueService.js'), /claimFromSms\(db, inserted\)/);
  assert.match(read('services/teamBillingCommandService.js'), /\|confirm\|/);
  const admin = read('routes/admin.js');
  assert.match(admin, /billingOps\.afterClaimConfirmed\(db, \{ claimId: req\.params\.id, result, actor: adminActorId\(req\), audit: false \}\)/);
  assert.match(admin, /momoCardUrl\(\{ code: link\.link\?\.code \|\| link\.code \}\)/);
  const app = read('assets/makaug-app.js');
  assert.match(app, /const ADMIN_METHOD_KEYS = \["mtn_momopay", /);
  const migration = read('db/migrations/219_momo_merchant_code_payments.sql');
  assert.match(migration, /VALUES \('mtn_momopay', 'MTN MoMo merchant code', 'mobile_money', 'UGX', '27248497'\)/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS business_name TEXT/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS paid_from_phone TEXT/);
  assert.match(migration, /\{how_to_pay\}/);
  assert.match(migration, /SET LOCAL lock_timeout/);
});
