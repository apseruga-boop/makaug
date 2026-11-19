'use strict';

/**
 * 19 Nov 2026. Every name and number here is made up; the adverts are as sent.
 *
 * Ronald forwarded a new agent's properties: "…akright City … 6 bedroom", a
 * photo, "25decimals … bwebajja -dundu …", a video, a survey map, then six more
 * descriptions and 39 photos, all in twenty-two seconds. The video was a tour
 * of the Akright house. Because it came after the Bwebajja description it went
 * up on the Bwebajja plot, and the photo of cleared land that followed the
 * Akright description went up on the house. Messages forwarded together arrive
 * a second or less apart, in the order of the chat they came from, and that
 * order does not say which photo is whose.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../config/database');
const t = require('../routes/whatsapp').__test;

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const AKRIGHT = '1.5 billions negotiable \nLocation akright City estates entebbe road sectors,6 bedroom, land size 25 decimals title on table';
const BWEBAJJA = '25decimals for sale with clear lake view located at bwebajja -dundu  3mtrs from New lutembe tarmac asking price is 220m';
const SEKIWUNGA = '2plots remaining for sale at sekiwunga next to express highway in a good neighborhood all plots are 20decimals each at 130m';
const photo = (n, ms, kind = 'image') => ({ url: `https://media.makaug.com/replay/p${n}.jpg`, sha256: `sha${n}`, mimeType: kind === 'video' ? 'video/mp4' : 'image/jpeg', kind, sender_ms: ms, inbound_message_id: `wamid-${n}` });

test('a photo a moment behind its description is held for the burst to end, quietly', () => {
  const T0 = 1795000000000;
  const waitingOne = () => ({ property_batch_mode: 'multiple', pending_property_caption: AKRIGHT, pending_caption_sender_ms: T0, last_text_caption_sender_ms: T0, recent_sender_ms: [T0] });
  const at = (ms) => {
    const data = waitingOne();
    data.recent_sender_ms.push(ms);
    return t.employeeHoldReason({ data, ownCaption: false, senderMs: ms, burstSize: data.recent_sender_ms.length, senderTimeKnown: true });
  };
  assert.strictEqual(at(T0 + 1630), 'forward_run', 'the Akright photo, 1.6 seconds behind its description');
  assert.strictEqual(at(T0 + 10000), '', 'picked and sent ten seconds later: placed at once, as before');
  const data = waitingOne();
  assert.strictEqual(t.employeeHoldReason({ data, ownCaption: true, senderMs: T0 + 500, burstSize: 2, senderTimeKnown: true }), '', 'a photo with its own caption');
  assert.strictEqual(t.employeeHoldReason({ data: { ...data, whatsapp_agent_self_intake: true }, ownCaption: false, senderMs: T0 + 500, burstSize: 2, senderTimeKnown: true }), '', 'an agent posting their own stock');
  assert.strictEqual(t.employeeHoldReason({ data: { ...data, property_batch_mode: 'single' }, ownCaption: false, senderMs: T0 + 500, burstSize: 2, senderTimeKnown: true }), '', 'a one-property batch');
  assert.strictEqual(t.employeeHoldReason({ data, ownCaption: false, senderMs: T0 + 500, burstSize: 2, senderTimeKnown: false }), '', 'no send time from the phone: as before');
  assert.strictEqual(t.employeeShouldHoldUnassignedMedia({ data: { ...data, recent_sender_ms: [T0, T0 + 500] }, ownCaption: false, senderMs: T0 + 500, burstSize: 2, senderTimeKnown: true }), true);

  // Held without the "arriving on their own" notice: a forwarded property is not a problem.
  const source = read('routes/whatsapp.js');
  assert.match(source, /const firstNotice = holdReason !== 'forward_run' && data\.employee_unassigned_notice_sent !== true;/);
  assert.match(source, /senderTimeKnown: Number\(runtime\.senderMs \|\| 0\) > 0/);
});

test('when the burst is over, a run with one description gets its photos; a run with two gets none', async () => {
  const T0 = 1795000000000;
  // One property forwarded: its words, then its photos and video.
  const one = { property_batch_mode: 'multiple', pending_property_caption: SEKIWUNGA, pending_caption_sender_ms: T0, last_text_caption_sender_ms: T0 };
  one.employee_unassigned_media = [photo(1, T0 + 400), photo(2, T0 + 700), photo(3, T0 + 1100, 'video')];
  const placed = await t.settleHeldMediaBySenderTime({ phone: '', data: one });
  assert.deepStrictEqual(placed.map((entry) => entry.count), [3]);
  assert.deepStrictEqual((one.pending_property_media || []).map((item) => item.sha256), ['sha1', 'sha2', 'sha3']);
  assert.strictEqual(one.employee_unassigned_media, undefined);

  // The Akright description, a photo, the Bwebajja description, the house video:
  // one run, two descriptions. Nothing is placed.
  const two = { property_batch_mode: 'multiple', pending_property_caption: BWEBAJJA, pending_caption_sender_ms: T0 + 2665, last_text_caption_sender_ms: T0 + 2665 };
  t.rememberEmployeeQueuedSubmission(two, { caption: AKRIGHT, storedMedia: [], inboundMessageId: 'c1', senderMs: T0 });
  two.employee_unassigned_media = [photo(1, T0 + 1629), photo(2, T0 + 3067, 'video')];
  const before = JSON.stringify(two);
  assert.deepStrictEqual(await t.settleHeldMediaBySenderTime({ phone: '', data: two }), []);
  assert.strictEqual(JSON.stringify(two), before, 'held, and asked about');

  // The same two sent one at a time, a quarter of a minute apart: each is its own run.
  const apart = { property_batch_mode: 'multiple', pending_property_caption: BWEBAJJA, pending_caption_sender_ms: T0 + 15000, last_text_caption_sender_ms: T0 + 15000 };
  t.rememberEmployeeQueuedSubmission(apart, { caption: AKRIGHT, storedMedia: [], inboundMessageId: 'c1', senderMs: T0 });
  apart.employee_unassigned_media = [photo(1, T0 + 500, 'video'), photo(2, T0 + 900), photo(3, T0 + 15400), photo(4, T0 + 15800)];
  const pairedApart = await t.settleHeldMediaBySenderTime({ phone: '', data: apart });
  assert.strictEqual(pairedApart.length, 2);
  assert.deepStrictEqual(t.employeePendingSubmissionQueue(apart)[0].media.map((item) => item.sha256), ['sha1', 'sha2'], 'the Akright house keeps its own video');
  assert.deepStrictEqual((apart.pending_property_media || []).map((item) => item.sha256), ['sha3', 'sha4']);
});

test('the quiet summary places them, then saves what is ready', () => {
  const source = read('routes/whatsapp.js');
  const start = source.indexOf('async function buildEmployeeBatchSummary');
  const body = source.slice(start, start + 4000);
  const settle = body.indexOf('const pairedHeld = await settleHeldMediaBySenderTime({ phone, data });');
  const flush = body.indexOf("if (pairedHeld.length) await flushReadyEmployeeSubmissions({ phone, currentStep: 'employee_property_media', data, inboundMessageId: '' });");
  const kept = body.indexOf('keptSaved = await saveReadyKeptSubmissions({ phone, data });');
  assert.ok(settle > 0 && flush > settle && kept > flush);
});

test('"Hlo" is hello: an approved agent whose welcome is waiting is not sent the customer menu', () => {
  for (const hello of ['Hlo', 'Hlo makaug', 'Hy', 'Hie', 'Hlw', 'Gud morning', 'Gd evening', 'Good morning sir', 'Hi team', 'Hello', 'Hi']) {
    assert.ok(t.AGENT_GREETING.test(hello), hello);
  }
  for (const not of ['Hi I want a house in Kira', 'Hello there friend', 'Hiring?', 'Hlo, how much is the plot?']) {
    assert.ok(!t.AGENT_GREETING.test(not), not);
  }
  // The greeting is what sends the waiting welcome with a word, not the menu.
  const source = read('routes/whatsapp.js');
  assert.match(source, /if \(AGENT_GREETING\.test\(askedText\) && await agentWelcomeIsWaiting\(phone\)\) \{\n\s+return \{ handled: true, nextStep: currentStep, message: agentWelcomeArrivingReply\(askingAgent\) \};/);
});

test('the summary counts properties, not the line of held photos, and says how to send them', async () => {
  const session = {
    current_step: 'employee_property_media',
    session_data: {
      property_batch_mode: 'multiple',
      property_ids: [],
      pending_property_caption: BWEBAJJA,
      pending_property_queue: [{ caption: AKRIGHT, media: [] }],
      employee_unassigned_media: [photo(1, 0), photo(2, 0)]
    }
  };
  const original = db.query;
  db.query = async (sql) => (/FROM whatsapp_sessions/.test(String(sql)) ? { rows: [session] } : { rows: [] });
  try {
    const summary = await t.buildEmployeeBatchSummary('256700000301', new Date(Date.now() - 60000));
    assert.match(summary, /^📋 \*Nothing saved yet\* — all 2 properties below still need a detail\./);
    assert.match(summary, /2 photos\/videos sent without a description \(held, not guessed\)"\n {3}needs: each property sent again on its own: its description, then its photos/);
    assert.match(summary, /Send them one property at a time: the description, then that property's photos straight after it, and leave a few seconds before the next property\./);
    assert.doesNotMatch(summary, /newest caption first/);
  } finally {
    db.query = original;
  }
});
