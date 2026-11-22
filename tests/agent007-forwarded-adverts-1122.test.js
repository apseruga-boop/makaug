'use strict';

/**
 * 22 Nov 2026, 09:47 in Kampala. An agent's twenty adverts were forwarded to
 * Agent 007 in three seconds, each a captioned photo or video and then that
 * advert's other photos. Three things went wrong:
 *
 *  1. Two photos sent right after the captioned "One acre NAJEERA" video were
 *     handled before it and went onto the Kira Nakwero plot sent before it.
 *     (The order is fixed in services/whatsappSendOrder.js; this file covers
 *     what is done with photos once they arrive in order.)
 *  2. Three photos of a Kira house were parked, because several properties
 *     had just been created, and the next photo, given to the property being
 *     built, cleared them: the house went up with one picture. A video of a
 *     Namugongo plot went the same way.
 *  3. "50 decimals Commercial plot Mbalwa namugongo road UGX 600 million" was
 *     skipped as a repeat of the same agent's "5 bedrooms ... 14 decimals plot"
 *     house in Mbalwa at the same price.
 *
 * Captions are the real ones; the ids and numbers are made up.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../config/database');
const route = require('../routes/whatsapp').__test;
const { decideIntakeRepeat, captionsStateDifferentFacts, captionLandDecimals, captionBedrooms } = require('../utils/listingIntakeQuality');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const T0 = 1795330042000; // 06:47:22 UTC
const photo = (n, senderMs) => ({ url: `https://media.example.invalid/p${n}.jpg`, sha256: `sha-p${n}`, kind: 'image', mimeType: 'image/jpeg', name: `p${n}.jpg`, senderMs });
const clip = (n, senderMs) => ({ url: `https://media.example.invalid/v${n}.mp4`, sha256: `sha-v${n}`, kind: 'video', mimeType: 'video/mp4', name: `v${n}.mp4`, senderMs });

/** The batch as it stands once each captioned advert has made its property, in the order sent. */
function batch() {
  const data = { property_ids: [], current_sender_ms_known: true };
  const made = (id, ms, media, caption) => {
    data.current_sender_ms = T0 + ms;
    route.noteEmployeePropertyCreated(data, id, media, caption);
    data.property_ids.push(id);
    route.noteEmployeeCaptionMark(data, { owner: id, album: true });
  };
  made('kasangati', 42, [photo(1)], '24 decimals Kasangati Mawule nalusugga 3 km off kasangati matugga tarmac UGX 90 million');
  made('kira-house', 472, [photo(3)], 'Kira 4 bedrooms house with staff quarters on 13 decimals plot UGX 550 million');
  made('shimoni', 539, [clip(7)], '12.4 decimals Kira Shimoni with 4 bedrooms shell house UGX 175 million negotiable');
  made('nakwero', 601, [photo(9)], '12 decimals plot Kira Nakwero UGX 65 million');
  made('najjera', 602, [clip(10)], 'One acre NAJEERA UGX1 billion');
  // The Shimoni advert again: a repeat, so no property, but it ends the Najjera advert.
  data.current_sender_ms = T0 + 973;
  route.noteEmployeeCaptionMark(data, { album: true });
  made('kyanja', 1081, [clip(15)], '13 decimals Kyanja very good for apartments UGX 210 million');
  made('naalya', 1298, [clip(16)], 'Naalya 4 bedrooms house with staff quarters 30 decimals plot UGX 950 million');
  made('namugongo', 1668, [clip(17)], '25 decimals commercial plot NAMUGONGO UGX 300 million');
  made('bulindo', 3761, [clip(20)], 'KIRA BULINDO TOWN 12 DOUBLE RENTAL UNITS APARTMENT BLOCK 11M MONTHLY INCOME SELLING UGX 1.1BILLION');
  return data;
}

async function withAttachSpy(fn) {
  const original = db.query;
  const attempted = [];
  db.query = async (sql, params) => {
    if (/FROM properties\s+WHERE id = \$1 AND status = 'pending'/.test(sql)) attempted.push(params[0]);
    return { rows: [] };
  };
  try { await fn(attempted); } finally { db.query = original; }
}

test('a parked photo belongs to the captioned photo or video sent last before it', () => {
  const data = batch();
  const owner = (ms) => route.employeeOwnerBySendOrder(data, { senderMs: T0 + ms });
  assert.strictEqual(owner(471 + 6), 'kira-house', 'the three Kira photos sent after its captioned photo');
  assert.strictEqual(owner(482), 'kira-house');
  assert.strictEqual(owner(538), 'kira-house');
  assert.strictEqual(owner(601 + 0.5), 'nakwero');
  assert.strictEqual(owner(602.4), 'najjera', 'the two photos sent after the Najjera video are Najjera’s, not Nakwero’s');
  assert.strictEqual(owner(2297), 'namugongo', 'the Namugongo video with no caption');
  assert.strictEqual(owner(973 + 5), null, 'after a repeat of a property already on makaug: not guessed');
});

test('after a description in words alone, or half a minute later, nothing is guessed', () => {
  const data = batch();
  data.current_sender_ms = T0 + 5000;
  route.noteEmployeeCaptionMark(data, { album: false });
  assert.strictEqual(route.employeeOwnerBySendOrder(data, { senderMs: T0 + 5200 }), null);
  const quiet = batch();
  assert.strictEqual(route.employeeOwnerBySendOrder(quiet, { senderMs: T0 + 3761 + 31000 }), null);
  assert.strictEqual(route.employeeOwnerBySendOrder(quiet, { senderMs: 0 }), undefined, 'no send time: the old rules apply');
  assert.strictEqual(route.employeeOwnerBySendOrder({ property_ids: ['a'] }, { senderMs: T0 }), undefined, 'no marks: the old rules apply');
  const elsewhere = batch();
  elsewhere.property_ids = elsewhere.property_ids.filter((id) => id !== 'najjera');
  assert.strictEqual(route.employeeOwnerBySendOrder(elsewhere, { senderMs: T0 + 603 }), null, 'only a property in this batch');
});

test('no marks are kept when WhatsApp gave no time', () => {
  const data = { current_sender_ms: T0, current_sender_ms_known: false };
  route.noteEmployeeCaptionMark(data, { owner: 'x', album: true });
  assert.strictEqual(data.employee_caption_marks, undefined);
});

test('the Najjera photos go to Najjera, not to the more recent photo property', async () => {
  await withAttachSpy(async (attempted) => {
    const data = batch();
    data.pending_property_media = [photo(11, T0 + 602.5), photo(12, T0 + 603)];
    await route.settleEmployeeOrphanMedia({ phone: '', data });
    assert.deepStrictEqual(attempted, ['najjera'], 'placed at once, by what they were sent after');
  });
});

test('closing the batch places every parked photo by send order', async () => {
  await withAttachSpy(async (attempted) => {
    const data = batch();
    data.pending_property_media = [photo(4, T0 + 477), photo(5, T0 + 482), photo(6, T0 + 538), clip(18, T0 + 2297)];
    await route.settleEmployeeOrphanMedia({ phone: '', data, final: true });
    assert.deepStrictEqual(attempted.sort(), ['kira-house', 'namugongo']);
  });
});

test('a photo the send order cannot place stays parked, even when the batch is closed', async () => {
  await withAttachSpy(async (attempted) => {
    const data = batch();
    data.pending_property_media = [photo(14, T0 + 980)];
    await route.settleEmployeeOrphanMedia({ phone: '', data, final: true });
    assert.deepStrictEqual(attempted, [], 'it is named when COMPLETE is refused, not put on a guess');
    assert.strictEqual(route.employeePendingStoredMedia(data).length, 1);
  });
});

test('parked photos keep their send time in the session', () => {
  const data = {};
  route.rememberEmployeePendingMedia(data, [photo(4, T0 + 477)], 'msg-4');
  route.rememberEmployeePendingMedia(data, [photo(5, T0 + 482)], 'msg-5');
  assert.deepStrictEqual(route.employeePendingStoredMedia(data).map((item) => item.senderMs), [T0 + 477, T0 + 482]);
});

test('giving a photo to the property being built no longer throws away the photos parked for another', () => {
  const source = read('routes/whatsapp.js');
  const attach = source.indexOf('propertyId: data.current_property_id,\n        storedMedia,');
  assert.ok(attach > 0);
  const block = source.slice(attach, attach + 1600);
  assert.match(block, /const parked = normalizeInput\(data\.pending_property_caption \|\| ''\) \? \[\] : employeePendingStoredMedia\(data\);/);
  assert.ok(block.indexOf('clearEmployeePendingMedia(data);') < block.indexOf('if (parked.length) rememberEmployeePendingMedia(data, parked, parkedMessageId);'), 'cleared, then the parked ones put back');
});

test('a photo the send order gives to another property is parked and placed there, not given to the one being built', () => {
  const source = read('routes/whatsapp.js');
  const held = source.slice(source.indexOf('const ownerByOrder = !caption'), source.indexOf('if (heldFromBurst) data.pending_media_from_burst = true;'));
  assert.match(held, /employeeOwnerBySendOrder\(data, \{ senderMs: data\.current_sender_ms_known === true \? mediaSenderMs : 0 \}\)/);
  assert.match(held, /\(employeeInForwardedBurst\(data\) \|\| sendOrderDisagrees\)/);
  // Each description is marked with the time it was sent, and the property it made.
  assert.match(source, /noteEmployeeCaptionMark\(data, \{ owner: propertyId, album: ownMediaCaption \}\);/);
  assert.match(source, /if \(looksLikePropertyCaption\(cleanBody\)\) noteEmployeeCaptionMark\(data, \{ album: false \}\);/);
  assert.match(source, /data\.current_sender_ms_known = Number\(runtime\.senderMs \|\| 0\) > 0;/);
});

test('the old rules still apply when there is no send time', async () => {
  await withAttachSpy(async (attempted) => {
    const data = { property_ids: ['a', 'b'], pending_property_media: [photo(1)] };
    route.noteEmployeePropertyCreated(data, 'a', [photo(8)], 'House A');
    route.noteEmployeePropertyCreated(data, 'b', [photo(9)], 'House B');
    await route.settleEmployeeOrphanMedia({ phone: '', data });
    assert.deepStrictEqual(attempted, [], 'two photo properties: wait, do not guess');
    await route.settleEmployeeOrphanMedia({ phone: '', data, final: true });
    assert.deepStrictEqual(attempted, ['b'], 'COMPLETE uses the most recent photo property, as before');
  });
});

test('fifty decimals is not fourteen: a different plot at the same price is not a repeat', () => {
  const house = 'Mbalwa Kyaliwajjala road 5 bedrooms,,staff quarters 14 decimals plot UGX 600 million slightly negotiable';
  const plot = '50 decimals Commercial plot Mbalwa namugongo road UGX 600 million negotiable';
  assert.strictEqual(captionLandDecimals(plot), 50);
  assert.strictEqual(captionLandDecimals(house), 14);
  assert.strictEqual(captionBedrooms(house), 5);
  assert.strictEqual(captionsStateDifferentFacts(plot, house), true);
  const row = { id: 'existing-house', status: 'approved', price: '600000000', area: 'Mbalwa', caption_hash: 'house', source_caption: house, phone_digits: '256700000777' };
  assert.strictEqual(decideIntakeRepeat({ caption: plot, captionHash: 'plot', phoneDigits: '700000777', area: 'Mbalwa', price: 600000000 }, [row]), null);
});

test('the same advert sent twice is still a repeat, and sizes in other units still match', () => {
  const first = '12.4 decimals Kira Shimoni with 4 bedrooms shell house UGX 175 million negotiable';
  const again = '12.4 decimals plot Kira Shimoni with 4 bedrooms shell house UGX 175 million';
  const row = { id: 'shimoni', status: 'pending', price: '175000000', area: 'Kira', caption_hash: 'first', source_caption: first, phone_digits: '256700000777' };
  const decision = decideIntakeRepeat({ caption: again, captionHash: 'again', phoneDigits: '700000777', area: 'Kira', price: 175000000 }, [row]);
  assert.ok(decision && decision.match_type === 'duplicate');
  assert.strictEqual(captionsStateDifferentFacts('1 acre in Mukono at 100m', '100 decimals in Mukono at 100m'), false);
  assert.strictEqual(captionsStateDifferentFacts('4 bed house in Kira', '4bedroom house in Kira'), false);
  assert.strictEqual(captionsStateDifferentFacts('3br house in Kira', '4 bedrooms house in Kira'), true);
  assert.strictEqual(captionsStateDifferentFacts('Namugongo 400m', 'Namugongo 2 houses in same compound'), false, 'nothing stated, nothing contradicted');
});
