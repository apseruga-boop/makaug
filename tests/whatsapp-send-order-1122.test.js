'use strict';

/**
 * 22 Nov 2026, 09:47 in Kampala: twenty forwarded adverts, three seconds.
 * The messages reached makaug in the order they were sent, but each one joined
 * its phone's line only after the checks in front of it, and a caption has
 * more of those than a photo with no words. Two photos sent right after a
 * captioned video were handled before it, and went onto the property before
 * it. The line is now ordered by when WhatsApp delivered each message.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const sendOrder = require('../services/whatsappSendOrder');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function clock(start = 1795330042000) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms) => { t += ms; await tick(); },
    advance: (ms) => { t += ms; }
  };
}

test('a message that overtook one sent before it waits behind it', async () => {
  sendOrder.resetSendOrderForTests();
  const c = clock();
  const ran = [];
  let releaseFirst;
  const firstDone = new Promise((resolve) => { releaseFirst = resolve; });
  const job = (name, wait) => async () => { ran.push(name); if (wait) await wait; return name; };
  const opts = { now: c.now, sleep: c.sleep, settleMs: 0 };
  // The Nakwero photo is being handled (it takes seconds: media is downloaded).
  const p9 = sendOrder.runInSendOrder('256700000111', { senderMs: 1795330042601, media: true, seq: 9 }, job('#9 Nakwero', firstDone), opts);
  await tick();
  // Its two neighbours with no caption reach the line first, the captioned video after them.
  const p11 = sendOrder.runInSendOrder('256700000111', { senderMs: 1795330042603, media: true, seq: 11 }, job('#11 photo'), opts);
  const p12 = sendOrder.runInSendOrder('256700000111', { senderMs: 1795330042604, media: true, seq: 12 }, job('#12 photo'), opts);
  const p10 = sendOrder.runInSendOrder('256700000111', { senderMs: 1795330042602, media: true, seq: 10 }, job('#10 Najjera video'), opts);
  releaseFirst();
  assert.deepStrictEqual(await Promise.all([p9, p10, p11, p12]), ['#9 Nakwero', '#10 Najjera video', '#11 photo', '#12 photo']);
  assert.deepStrictEqual(ran, ['#9 Nakwero', '#10 Najjera video', '#11 photo', '#12 photo'], 'in the order they were sent');
});

test('with an empty line, a photo waits a moment for a message sent just before it', async () => {
  sendOrder.resetSendOrderForTests();
  const c = clock();
  const ran = [];
  const opts = { now: c.now, sleep: c.sleep, settleMs: 1200 };
  const photo = sendOrder.runInSendOrder('256700000222', { senderMs: 1795330042477, media: true }, async () => ran.push('photo'), opts);
  // The caption it follows was sent 5ms earlier and arrives 40ms later.
  c.advance(40);
  const caption = sendOrder.runInSendOrder('256700000222', { senderMs: 1795330042472, media: true }, async () => ran.push('captioned photo'), opts);
  await Promise.all([photo, caption]);
  assert.deepStrictEqual(ran, ['captioned photo', 'photo']);
});

test('a lone message with no media is not held up', async () => {
  sendOrder.resetSendOrderForTests();
  const c = clock();
  let slept = 0;
  const opts = { now: c.now, sleep: async (ms) => { slept += ms; await c.sleep(ms); }, settleMs: 1200 };
  const answer = await sendOrder.runInSendOrder('256700000333', { senderMs: 1795330042000 }, async () => 'answered', opts);
  assert.strictEqual(answer, 'answered');
  assert.strictEqual(slept, 0, 'a customer typing "Hello" waits for nothing');
});

test('messages without a send time keep the order they arrived in', async () => {
  sendOrder.resetSendOrderForTests();
  const ran = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const opts = { settleMs: 0 };
  const a = sendOrder.runInSendOrder('meta:1', { seq: 1 }, async () => { ran.push('a'); await gate; }, opts);
  await tick();
  const c = sendOrder.runInSendOrder('meta:1', { seq: 3 }, async () => ran.push('c'), opts);
  const b = sendOrder.runInSendOrder('meta:1', { seq: 2 }, async () => ran.push('b'), opts);
  release();
  await Promise.all([a, b, c]);
  assert.deepStrictEqual(ran, ['a', 'b', 'c']);
});

test('one message failing does not stop the ones behind it', async () => {
  sendOrder.resetSendOrderForTests();
  const opts = { settleMs: 0 };
  const bad = sendOrder.runInSendOrder('256700000444', { senderMs: 10 }, async () => { throw new Error('download failed'); }, opts);
  const good = sendOrder.runInSendOrder('256700000444', { senderMs: 20 }, async () => 'ok', opts);
  await assert.rejects(bad, /download failed/);
  assert.strictEqual(await good, 'ok');
});

test('different phones do not wait for each other', async () => {
  sendOrder.resetSendOrderForTests();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const opts = { settleMs: 0 };
  const slow = sendOrder.runInSendOrder('256700000555', { senderMs: 10 }, async () => { await gate; return 'slow'; }, opts);
  assert.strictEqual(await sendOrder.runInSendOrder('256700000666', { senderMs: 20 }, async () => 'other phone', opts), 'other phone');
  release();
  assert.strictEqual(await slow, 'slow');
});

test('while one message runs, the line can say how many descriptions are waiting behind it', async () => {
  sendOrder.resetSendOrderForTests();
  const opts = { settleMs: 0 };
  const seen = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  // The Kasangati plot is being handled; behind it a photo with no words, the
  // Kira caption and another photo.
  const first = sendOrder.runInSendOrder('256700000777', { senderMs: 42, media: true, describes: true }, async () => { await gate; }, opts);
  await tick();
  const photo = sendOrder.runInSendOrder('256700000777', { senderMs: 471, media: true }, async () => seen.push(['photo', sendOrder.describedWaiting('256700000777')]), opts);
  const kira = sendOrder.runInSendOrder('256700000777', { senderMs: 472, media: true, describes: true }, async () => seen.push(['kira', sendOrder.describedWaiting('256700000777')]), opts);
  const next = sendOrder.runInSendOrder('256700000777', { senderMs: 477, media: true }, async () => seen.push(['next', sendOrder.describedWaiting('256700000777')]), opts);
  assert.strictEqual(sendOrder.describedWaiting('256700000777'), 1, 'the Kira caption is waiting');
  assert.strictEqual(sendOrder.describedWaiting('256700000999'), 0, 'another phone has no line');
  release();
  await Promise.all([first, photo, kira, next]);
  assert.deepStrictEqual(seen, [['photo', 1], ['kira', 0], ['next', 0]], 'the photo before the Kira caption knows a description is still to come');
});

test('the settle time: 1.2 seconds by default, set by WHATSAPP_SEND_ORDER_SETTLE_MS, and none in tests', () => {
  assert.strictEqual(sendOrder.settleMs({}), 1200);
  assert.strictEqual(sendOrder.settleMs({ WHATSAPP_SEND_ORDER_SETTLE_MS: '800' }), 800);
  assert.strictEqual(sendOrder.settleMs({ WHATSAPP_SEND_ORDER_SETTLE_MS: '60000' }), 5000, 'never more than five seconds');
  assert.strictEqual(sendOrder.settleMs({ WHATSAPP_SEND_ORDER_SETTLE_MS: 'soon' }), 1200);
  assert.strictEqual(sendOrder.settleMs({ NODE_ENV: 'test' }), 0);
  assert.strictEqual(sendOrder.settleMs({ NODE_ENV: 'test', WHATSAPP_SEND_ORDER_SETTLE_MS: '300' }), 300);
});

test('the runtime runs every message through the send-order line, with the time WAHA gave it', () => {
  const source = read('routes/whatsapp.js');
  const runtime = source.slice(source.indexOf('async function processInboundRuntime(input = {})'), source.indexOf('function processWhatsappCallEvent('));
  assert.match(runtime, /sendOrder\.runInSendOrder\(/);
  assert.match(runtime, /senderMs: employeeSenderMs\(input\.metadata \|\| \{\}\)/);
  assert.match(runtime, /seq: Number\(input\.arrivalSeq \|\| 0\)/);
  assert.match(runtime, /describes: looksLikePropertyCaption\(normalizeInput\(input\.body \|\| ''\)\)/);
  assert.match(runtime, /queueWhatsappRuntimeForPhone\(input\.phone,/, 'and still one at a time per phone');
  // The arrival number is taken before anything in the bridge route is awaited.
  const route = source.slice(source.indexOf("router.post('/web-bridge/inbound'"));
  const seq = route.indexOf('const arrivalSeq = sendOrder.nextArrivalSeq();');
  assert.ok(seq > 0 && seq < route.indexOf('await '), 'taken first');
  assert.match(route.slice(route.indexOf('turn = await processInboundRuntime({'), route.indexOf('turn = await processInboundRuntime({') + 400), /arrivalSeq\n/);
});

test('WAHA event ids carry the delivery time to the millisecond', () => {
  const { employeeSenderMs } = require('../routes/whatsapp').__test;
  // evt_ + a ULID: its first ten characters are the time in milliseconds.
  const ulidTime = (ms) => {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    let out = '';
    let t = ms;
    for (let i = 0; i < 10; i += 1) { out = alphabet[t % 32] + out; t = Math.floor(t / 32); }
    return out;
  };
  const sent = 1795330042602;
  assert.strictEqual(employeeSenderMs({ waha_event_id: `evt_${ulidTime(sent)}ABCDEFGHJKMNPQRS` }), sent);
  assert.strictEqual(employeeSenderMs({}), 0, 'no time, no order: arrival order is kept');
});
