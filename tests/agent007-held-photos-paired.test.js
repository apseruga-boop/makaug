'use strict';
/**
 * 5 Nov 2026, Ronald for Brandpro: three descriptions in two seconds, then the
 * photos. The first six photos were handed to the waiting descriptions before
 * the burst was big enough to notice — the Sseguku house went up on the
 * Mutundwe listing — and when he then sent one property at a time, as told,
 * every photo was still held ("came on their own") because a forwarded photo
 * carries no caption. The batch closed with 120 photos never placed.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
process.env.NODE_ENV = 'test';
const router = require('../routes/whatsapp');
const t = router.__test;

const SSEGUKU = 'QUICK SALE SSEGUKU KATALE 4 BEDROOMS SELF-CONTAINED + BOYS QUARTER 15DEC 550M';
const BOMBO = '2 acres of private mail title on quick sale located at bombo kalule Price 60m';
const MUTUNDWE = 'Quick sale house 3bedrooms 2bathrooms seated on 11decimals private mile land title located at mutundwe kirinyabigo now selling 185m';
const photo = (n, ms) => ({ url: `https://media.makaug.com/p${n}.jpg`, sha256: `sha${n}`, mimeType: 'image/jpeg', kind: 'image', sender_ms: ms, inbound_message_id: `m${n}` });

function threeWaiting() {
  const data = { pending_property_caption: SSEGUKU, pending_caption_sender_ms: 1000, last_text_caption_sender_ms: 1000, current_sender_ms: 1000 };
  // A new description parks the pending one with its own send time.
  t.rememberEmployeeQueuedSubmission(data, { caption: BOMBO, storedMedia: [], inboundMessageId: 'c2', senderMs: 2000 });
  t.rememberEmployeeQueuedSubmission(data, { caption: MUTUNDWE, storedMedia: [], inboundMessageId: 'c3', senderMs: 3000 });
  return data;
}

test('with more than one description waiting, a captionless photo is held whatever the pace', () => {
  const data = threeWaiting();
  assert.strictEqual(t.employeeWaitingCaptionCount(data), 3);
  assert.strictEqual(t.employeeShouldHoldUnassignedMedia({ data, ownCaption: false, senderMs: 3500, burstSize: 1 }), true, 'the first photo of the burst is held too');
  assert.strictEqual(t.employeeShouldHoldUnassignedMedia({ data, ownCaption: true, senderMs: 3500, burstSize: 1 }), false, 'a photo with its own caption is never held');
  const one = { pending_property_caption: SSEGUKU, last_text_caption_sender_ms: 1000 };
  assert.strictEqual(t.employeeWaitingCaptionCount(one), 1);
  assert.strictEqual(t.employeeShouldHoldUnassignedMedia({ data: one, ownCaption: false, senderMs: 1400, burstSize: 2 }), false, 'one description waiting, outside a burst: as before');
});

test('at COMPLETE, held photos go to the description each run followed, by send time', async () => {
  // Sent one property at a time: description, its photos, next description…
  const data = { pending_property_caption: MUTUNDWE, pending_caption_sender_ms: 300000, last_text_caption_sender_ms: 300000 };
  t.rememberEmployeeQueuedSubmission(data, { caption: SSEGUKU, storedMedia: [], inboundMessageId: 'c1', senderMs: 100000 });
  t.rememberEmployeeQueuedSubmission(data, { caption: BOMBO, storedMedia: [], inboundMessageId: 'c2', senderMs: 200000 });
  data.employee_unassigned_media = [
    photo(1, 101000), photo(2, 103000), photo(3, 106000), // Sseguku's
    photo(4, 202000), photo(5, 204000), // Bombo's
    photo(6, 301000), photo(7, 302500), photo(8, 305000) // Mutundwe's
  ];
  data.employee_unassigned_notice_sent = true;
  const placed = await t.settleHeldMediaBySenderTime({ phone: '', data });
  assert.deepStrictEqual(placed.map((entry) => entry.count), [3, 3, 2], 'pending first, then the queue in order');
  assert.deepStrictEqual((data.pending_property_media || []).map((m) => m.sha256), ['sha6', 'sha7', 'sha8'], 'the pending description (Mutundwe) got the last run');
  const queue = t.employeePendingSubmissionQueue(data);
  assert.deepStrictEqual(queue.map((entry) => [entry.caption.slice(0, 10), entry.media.map((m) => m.sha256)]), [['QUICK SALE', ['sha1', 'sha2', 'sha3']], ['2 acres of', ['sha4', 'sha5']]]);
  assert.strictEqual(data.employee_unassigned_media, undefined, 'nothing left held');
  assert.strictEqual(data.employee_unassigned_notice_sent, undefined);
});

test('descriptions first and then all the photos stays ambiguous: nothing is placed', async () => {
  const data = threeWaiting();
  data.employee_unassigned_media = [photo(1, 3500), photo(2, 3700), photo(3, 3900), photo(4, 4100), photo(5, 4300), photo(6, 4500)];
  const before = JSON.stringify(data);
  assert.deepStrictEqual(await t.settleHeldMediaBySenderTime({ phone: '', data }), []);
  assert.strictEqual(JSON.stringify(data), before, 'held as before, and the batch is refused as before');
  // A run that belongs to nobody (forty minutes from any description) is not guessed either.
  const data2 = { pending_property_caption: SSEGUKU, pending_caption_sender_ms: 1000, last_text_caption_sender_ms: 1000, employee_unassigned_media: [photo(1, 2000), photo(2, 3000), photo(9, 1000 + 40 * 60 * 1000)] };
  assert.deepStrictEqual(await t.settleHeldMediaBySenderTime({ phone: '', data: data2 }), []);
  // Held photos with no send time cannot be paired.
  const data3 = { pending_property_caption: SSEGUKU, pending_caption_sender_ms: 1000, last_text_caption_sender_ms: 1000, employee_unassigned_media: [{ ...photo(1, 2000), sender_ms: 0 }] };
  assert.deepStrictEqual(await t.settleHeldMediaBySenderTime({ phone: '', data: data3 }), []);
});

test('a promoted description keeps its own send time; a re-sent description with photos tops up the listing already in review', () => {
  const data = { pending_property_caption: SSEGUKU, pending_caption_sender_ms: 1000, last_text_caption_sender_ms: 1000, pending_property_media: [photo(1, 1100)] };
  t.rememberEmployeeQueuedSubmission(data, { caption: BOMBO, storedMedia: [], inboundMessageId: 'c2', senderMs: 2000 });
  const next = t.promoteEmployeeQueuedSubmission(data);
  assert.strictEqual(next.caption, BOMBO);
  assert.strictEqual(data.pending_caption_sender_ms, 2000);
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
  const flush = source.slice(source.indexOf('async function flushReadyEmployeeSubmissions'), source.indexOf('function stripForwardMarkers'));
  assert.match(flush, /String\(duplicate\.status\) === 'pending' && storedMedia\.length/);
  assert.match(flush, /attachEmployeeReviewMedia\(\{ propertyId: duplicate\.id, storedMedia, phone, inboundMessageId \}\)/);
  const complete = source.slice(source.indexOf('const pairedHeld = await settleHeldMediaBySenderTime'), source.indexOf('if (unassignedMedia.length) {'));
  assert.match(complete, /flushReadyEmployeeSubmissions\(/, 'paired photos are saved before the batch is judged');
  const grouping = source.slice(source.indexOf('async function groupForwardedAdverts'), source.indexOf('async function importForwardedAdvert'));
  assert.match(grouping, /employeeSenderMs\(payload\.metadata\) \|\| new Date\(row\.created_at\)\.getTime\(\)/, 'the import pairs on the time the phone sent each message');
});
