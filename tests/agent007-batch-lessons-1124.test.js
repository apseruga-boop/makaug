'use strict';

/**
 * 24 Nov 2026, Ronald loading properties for agents. Every name and number
 * here is made up; the timings are as sent.
 *
 * 1. Two descriptions forwarded together, then their four photos: held, as
 *    they should be. Told to send them one property at a time, he sent each
 *    description again with its photos, twice over, and both times the batch
 *    would not close: the description sent again kept the time it was first
 *    sent, so its photos still came "on their own", and the same photos were
 *    counted again, 8, then 12.
 * 2. One property and its seven photos: "Saved … Media stored: 1", then
 *    "1 media item(s) attached" four times, three of them after COMPLETE.
 * 3. One property that was already on makaug: "Duplicate property found",
 *    then its other photos were each taken as a property of their own, and
 *    COMPLETE would not close the batch.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const t = require('../routes/whatsapp').__test;

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');

const HOUSE = 'Location estate on the bypass road sectors, 5 bedroom bungalow house, land size 25 decimals titled, asking price 700m negotiable';
const STORE = '5 bedroom storage house, location in the hill estate, land size 12 decimals titled asking price 600m negotiable';
const T0 = 1795600000000;
const file = (name, ms, kind = 'image') => ({
  url: `https://media.makaug.com/test/${name}.${kind === 'video' ? 'mp4' : 'jpg'}`,
  sha256: `sha-${name}`,
  mimeType: kind === 'video' ? 'video/mp4' : 'image/jpeg',
  kind,
  sender_ms: ms
});
const hold = (data, name, ms, kind) => t.holdEmployeeUnassignedMedia(data, [file(name, ms, kind)], { senderMs: ms, inboundMessageId: `m-${name}-${ms}` });

/** Both descriptions forwarded together, then the four photos (as sent at 05:33:52). */
function forwardedTogether() {
  const data = { property_batch_mode: 'multiple', pending_property_caption: STORE, pending_caption_sender_ms: T0 + 593, last_text_caption_sender_ms: T0 + 593 };
  t.rememberEmployeeQueuedSubmission(data, { caption: HOUSE, storedMedia: [], inboundMessageId: 'c-house', senderMs: T0 });
  hold(data, 'house-video', T0 + 1489, 'video');
  hold(data, 'store-video', T0 + 1762, 'video');
  hold(data, 'house-1', T0 + 1787);
  hold(data, 'house-2', T0 + 2187);
  return data;
}

test('two descriptions, then all their photos: still asked about', async () => {
  const data = forwardedTogether();
  assert.strictEqual(t.employeeWaitingCaptionCount(data), 2);
  assert.deepStrictEqual(await t.settleHeldMediaBySenderTime({ phone: '', data }), []);
});

test('each description sent again with its photos: the photos are its own, each counted once', async () => {
  const data = forwardedTogether();
  // The house again, then its three photos: the same files.
  assert.strictEqual(t.bringEmployeeCaptionForward(data, HOUSE, T0 + 50926), true);
  hold(data, 'house-video', T0 + 51269, 'video');
  hold(data, 'house-1', T0 + 51608);
  hold(data, 'house-2', T0 + 51859);
  assert.strictEqual(t.employeeUnassignedMedia(data).length, 4, 'the same four photos, not seven');
  // The storage house has not been sent again: what is left where both were
  // first sent could still be either's.
  assert.deepStrictEqual(await t.settleHeldMediaBySenderTime({ phone: '', data }), []);

  // The storage house again, then its video.
  assert.strictEqual(t.bringEmployeeCaptionForward(data, STORE, T0 + 78785), true);
  hold(data, 'store-video', T0 + 79382, 'video');
  assert.strictEqual(t.employeeUnassignedMedia(data).length, 4);
  const placed = await t.settleHeldMediaBySenderTime({ phone: '', data });
  assert.deepStrictEqual(placed.map((entry) => entry.count), [1, 3]);
  assert.deepStrictEqual((data.pending_property_media || []).map((item) => item.sha256), ['sha-store-video'], 'the storage house gets its video');
  assert.deepStrictEqual(
    t.employeePendingSubmissionQueue(data)[0].media.map((item) => item.sha256),
    ['sha-house-video', 'sha-house-1', 'sha-house-2'],
    'the house gets its three'
  );
  assert.strictEqual(data.employee_unassigned_media, undefined);
  assert.strictEqual(data.employee_resent_caption_ms, undefined);
});

test('a photo from the first time that was not sent again is still not guessed', async () => {
  const data = forwardedTogether();
  t.bringEmployeeCaptionForward(data, HOUSE, T0 + 50926);
  hold(data, 'house-video', T0 + 51269, 'video');
  hold(data, 'house-1', T0 + 51608);
  // house-2 was not sent again.
  t.bringEmployeeCaptionForward(data, STORE, T0 + 78785);
  hold(data, 'store-video', T0 + 79382, 'video');
  const before = JSON.stringify(data);
  assert.deepStrictEqual(await t.settleHeldMediaBySenderTime({ phone: '', data }), []);
  assert.strictEqual(JSON.stringify(data), before);
});

test('only a description still waiting for its photos is brought forward', () => {
  const data = { property_batch_mode: 'multiple', pending_property_caption: STORE, pending_caption_sender_ms: T0, pending_property_media: [file('store-1', T0 + 400)] };
  assert.strictEqual(t.bringEmployeeCaptionForward(data, STORE, T0 + 60000), false, 'it has its photos');
  assert.strictEqual(data.pending_caption_sender_ms, T0);
  assert.strictEqual(t.bringEmployeeCaptionForward(data, HOUSE, T0 + 60000), false, 'not one we have');
  assert.strictEqual(t.bringEmployeeCaptionForward({ pending_property_caption: HOUSE, pending_caption_sender_ms: T0 }, HOUSE, 0), false, 'no send time');
  const waiting = { pending_property_caption: HOUSE, pending_caption_sender_ms: T0 };
  assert.strictEqual(t.bringEmployeeCaptionForward(waiting, `Forwarded\n${HOUSE}`, T0 + 60000), true, 'forwarded again');
  assert.strictEqual(waiting.pending_caption_sender_ms, T0 + 60000);
  assert.deepStrictEqual(waiting.employee_resent_caption_ms, [T0]);
});

test('a description sent again is brought forward, quietly, and the refusal says to send them again', () => {
  const guard = source.indexOf('const theseWords = sameWords(cleanBody);');
  assert.match(source.slice(guard - 400, guard), /const resent = sameWords\(cleanBody\)\.length >= 24 && data\.whatsapp_agent_self_intake !== true\n\s+&& bringEmployeeCaptionForward\(data, cleanBody, data\.current_sender_ms\);\n\s+$/);
  assert.match(source.slice(guard, guard + 700), /if \(resent\) await replaceEmployeeSession\(phone, currentStep, data\);\n\s+return \{ handled: true, nextStep: currentStep, message: '' \};/);
  assert.match(source, /holdEmployeeUnassignedMedia\(data, held, \{ senderMs: mediaSenderMs, inboundMessageId \}\);/);
  assert.match(source, /'To fix it: forward each property again, one at a time — its description, then its photos straight after it — and type \*COMPLETE\*\./);
});

test('one property: one reply when its photos are all in, counting every one', () => {
  const data = { property_batch_mode: 'single', employee_media_reply: { property_id: 'p-1', saved: true, media: 1 } };
  assert.strictEqual(t.employeeOnePropertyMediaReply(data, { propertyId: 'p-1', attached: 1, mediaWaiting: 2 }), '');
  assert.strictEqual(t.employeeOnePropertyMediaReply(data, { propertyId: 'p-1', attached: 0, mediaWaiting: 1 }), '', 'a photo already attached');
  const saved = t.employeeOnePropertyMediaReply(data, { propertyId: 'p-1', attached: 2, mediaWaiting: 0 });
  assert.strictEqual(saved, t.employeeStaffSavedMessage('p-1', 4));
  assert.match(saved, /^✅ Saved the property to staff review — P-1\nMedia stored: 4\nStatus: pending, not live\./);
  assert.strictEqual(data.employee_media_reply, undefined);

  // More photos later, after the "Saved": one "more attached" for the lot.
  assert.strictEqual(t.employeeOnePropertyMediaReply(data, { propertyId: 'p-1', attached: 1, mediaWaiting: 1 }), '');
  assert.strictEqual(
    t.employeeOnePropertyMediaReply(data, { propertyId: 'p-1', attached: 1, mediaWaiting: 0 }),
    '✅ 2 more media items attached to the pending property. Send more media for this property, or type *COMPLETE* when it is finished.'
  );
  assert.strictEqual(t.employeeOnePropertyMediaReply(data, { propertyId: 'p-1', attached: 0, mediaWaiting: 0 }), 'That media is already attached. Nothing was duplicated.');

  // The photo it waited for could not be taken: the "Saved" still goes.
  const stuck = { property_batch_mode: 'single', employee_media_reply: { property_id: 'p-2', saved: true, media: 3 } };
  assert.strictEqual(t.releaseEmployeeOnePropertyReply(stuck), t.employeeStaffSavedMessage('p-2', 3));
  assert.strictEqual(t.releaseEmployeeOnePropertyReply(stuck), '');
});

test('one property: wired so the "Saved" waits for the photos in line, and "Caption saved" is not sent ahead of them', () => {
  assert.match(source, /const holdStaffSaved = employeeOnePropertyStaffBatch\(data\) && Number\(runtime\.mediaWaiting \|\| 0\) > 0;\n\s+if \(holdStaffSaved\) data\.employee_media_reply = \{ property_id: String\(propertyId\), saved: true, media: storedMedia\.length \};/);
  assert.match(source, /if \(holdStaffSaved\) return \{ handled: true, nextStep: currentStep, propertyId, message: '' \};/);
  assert.match(source, /: onePropertyReply !== null\n\s+\? onePropertyReply/);
  assert.match(source, /\/\/ Its photos already in line behind it: they answer for it \(24 Nov 2026\)\.\n\s+: photosOnTheirWay\n\s+\? ''\n\s+: `Caption saved for/);
});

test('one property already on makaug: its other photos are not added, without a word', () => {
  const data = { property_batch_mode: 'single' };
  t.noteEmployeeDuplicateFound(data, { id: 'dddddddd-0000-4000-8000-000000000001', status: 'approved' });
  assert.strictEqual(t.employeePhotoIsTheDuplicates(data, ''), true);
  assert.strictEqual(t.employeePhotoIsTheDuplicates(data, 'Hello Mkaug'), true, 'words that describe no property');
  assert.strictEqual(t.employeePhotoIsTheDuplicates(data, 'Plot for sale in Kira 50x100 at 45m with a land title'), false, 'a new property');
  assert.strictEqual(t.employeePhotoIsTheDuplicates({ ...data, pending_property_caption: STORE }, ''), false, 'a new description is waiting');
  assert.strictEqual(t.employeePhotoIsTheDuplicates({ ...data, property_batch_mode: 'multiple' }, ''), false, 'several properties: whose they are is not known');
  assert.strictEqual(t.employeePhotoIsTheDuplicates({ ...data, employee_after_duplicate: { ...data.employee_after_duplicate, at: Date.now() - 21 * 60 * 1000 } }, ''), false, 'long after');
  const agent = { whatsapp_agent_self_intake: true, property_batch_mode: 'single' };
  t.noteEmployeeDuplicateFound(agent, { id: 'dddddddd-0000-4000-8000-000000000001', status: 'approved' });
  assert.strictEqual(agent.employee_after_duplicate, undefined, 'an agent posting their own stock is answered as before');
  t.noteEmployeePropertyCreated(data, 'eeeeeeee-0000-4000-8000-000000000001', [], '');
  assert.strictEqual(data.employee_after_duplicate, undefined, 'a property made since: back to normal');

  assert.strictEqual(
    t.employeeOnePropertyDuplicateMessage({ id: 'dddddddd-0000-4000-8000-000000000001', status: 'approved' }),
    "Duplicate property found — DDDDDDDD is already approved. Nothing was added twice, and the rest of its photos won't be added either. Type *COMPLETE* to close this batch."
  );
  const skip = source.indexOf('if (employeePhotoIsTheDuplicates(data, caption)) {');
  assert.ok(skip > 0 && skip < source.indexOf('const holdReason = employeeHoldReason({'), 'before a photo can be held or kept as a property');
  assert.strictEqual((source.match(/noteEmployeeDuplicateFound\(data, /g) || []).length, 3, 'all three ways a duplicate is found');
});

test('one property: a quick run of photos is the property\'s, not "on their own"', () => {
  const data = { property_batch_mode: 'single', current_property_id: 'p-1', last_text_caption_sender_ms: T0, last_album_sender_ms: 0 };
  assert.strictEqual(t.employeeHoldReason({ data, ownCaption: false, senderMs: T0 + 3000, burstSize: 8, senderTimeKnown: true }), '');
  assert.strictEqual(t.employeeHoldReason({ data: { ...data, property_batch_mode: 'multiple' }, ownCaption: false, senderMs: T0 + 3000, burstSize: 8, senderTimeKnown: true }), 'burst', 'several properties: held as before');
  const two = { ...data, pending_property_caption: STORE };
  t.rememberEmployeeQueuedSubmission(two, { caption: HOUSE, storedMedia: [], inboundMessageId: 'c-house', senderMs: T0 });
  assert.strictEqual(t.employeeHoldReason({ data: two, ownCaption: false, senderMs: T0 + 3000, burstSize: 8, senderTimeKnown: true }), 'several_waiting', 'two descriptions waiting: still held');
});
