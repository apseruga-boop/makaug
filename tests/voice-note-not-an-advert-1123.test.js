'use strict';

/**
 * 23 Nov 2026. A guest asked in a voice note at 07:06 about short stays for a
 * friend coming from Kenya. Her voice note was taken as the first photo of a
 * forwarded advert. At 18:07 she sent another voice note, asking whether the
 * rooms have air conditioning. It was taken quietly as one more "photo of the
 * adverts": nobody answered her, and the team was not told.
 *
 * A voice note is somebody talking, never an advert's photo. Photos are taken
 * quietly only while a burst of them, or the question about them, is recent.
 * And a voice note to somebody on the team is theirs, as typed words are.
 *
 * Every name and number here is made up.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../config/database');
const route = require('../routes/whatsapp').__test;

const PHONE = '256700000081';
const AC_QUESTION = 'Another thing I forgot to ask you, your rooms have AC. You tell me if they have AC.';

function fakeDb(run) {
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  const calls = [];
  const query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    return { rows: [] };
  };
  db.query = query;
  db.getClient = async () => ({ query, release() {} });
  return Promise.resolve(run(calls)).finally(() => { db.query = originalQuery; db.getClient = originalGetClient; });
}

const session = (data = {}) => ({ phone: PHONE, current_step: 'main_menu', language: 'en', session_data: data });
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();

test('a voice note is a voice note, whatever the bridge calls its media', () => {
  for (const type of ['audio/ogg; codecs=opus', 'audio', 'voice', 'ptt', 'audio/mpeg']) {
    assert.strictEqual(route.isVoiceMediaType(type), true, type);
  }
  for (const type of ['image/jpeg', 'image', 'video/mp4', 'application/pdf', '']) {
    assert.strictEqual(route.isVoiceMediaType(type), false, type);
  }
});

test('a voice note is not a forwarded property; a photo still is; a dictated advert still is', () => {
  assert.strictEqual(route.looksLikeForwardedProperty({ cleanBody: AC_QUESTION, mediaUrl: 'https://bridge/media/voice-1.ogg', runtime: { mediaType: 'audio/ogg; codecs=opus', mediaCount: 1 } }), false);
  assert.strictEqual(route.looksLikeForwardedProperty({ cleanBody: '', mediaUrl: 'https://bridge/media/photo-1.jpg', runtime: { mediaType: 'image/jpeg', mediaCount: 1 } }), true);
  assert.strictEqual(route.looksLikeForwardedProperty({
    cleanBody: 'Three bedroom house for sale in Kira on 12 decimals at 350 million with a land title',
    mediaUrl: 'https://bridge/media/voice-2.ogg',
    runtime: { mediaType: 'audio/ogg' }
  }), true, 'the words of a voice note can still describe a property');
});

test('a guest\'s voice note hours after her first one is answered, not taken as an advert photo', async () => {
  await fakeDb(async (calls) => {
    const state = { since: hoursAgo(11), captions: 0, media: 1, prompted_at: null, awaiting_name: false };
    const result = await route.handleUnknownForwardedAdvert({
      phone: PHONE,
      session: session({ forwarded_adverts: state }),
      cleanBody: AC_QUESTION,
      mediaUrl: 'https://bridge/media/voice-3.ogg',
      runtime: { mediaType: 'audio/ogg; codecs=opus', mediaCount: 1 },
      currentStep: 'main_menu'
    });
    assert.strictEqual(result, null, 'left to the conversation');
    assert.ok(!calls.some((c) => /UPDATE whatsapp_sessions/.test(c.sql)), 'nothing is counted as an advert photo');
  });
});

test('a photo long after an old burst starts a new one instead of being taken quietly', async () => {
  await fakeDb(async (calls) => {
    const state = { since: hoursAgo(11), captions: 0, media: 1, prompted_at: null, awaiting_name: false };
    const result = await route.handleUnknownForwardedAdvert({
      phone: PHONE,
      session: session({ forwarded_adverts: state }),
      cleanBody: '',
      mediaUrl: 'https://bridge/media/photo-2.jpg',
      runtime: { mediaType: 'image/jpeg', mediaCount: 1 },
      currentStep: 'main_menu'
    });
    assert.strictEqual(result, null, 'the ordinary reply, once, as for the first photo of a burst');
    const patched = JSON.parse(calls.find((c) => /UPDATE whatsapp_sessions/.test(c.sql)).params[0]);
    assert.strictEqual(patched.forwarded_adverts.media, 1);
    assert.ok(Date.now() - Date.parse(patched.forwarded_adverts.since) < 5 * 60 * 1000, 'a fresh burst');
  });
});

test('photos in a burst, or right after the question, are still taken quietly', async () => {
  await fakeDb(async () => {
    const burst = { since: hoursAgo(0.1), captions: 0, media: 1, prompted_at: null, awaiting_name: false };
    const inBurst = await route.handleUnknownForwardedAdvert({
      phone: PHONE, session: session({ forwarded_adverts: burst }), cleanBody: '', mediaUrl: 'https://bridge/media/photo-3.jpg',
      runtime: { mediaType: 'image/jpeg', mediaCount: 1 }, currentStep: 'main_menu'
    });
    assert.deepStrictEqual(inBurst, { handled: true, nextStep: 'main_menu', message: '' });
    const asked = { since: hoursAgo(3), captions: 1, media: 2, prompted_at: hoursAgo(0.2), awaiting_name: false };
    const afterQuestion = await route.handleUnknownForwardedAdvert({
      phone: PHONE, session: session({ forwarded_adverts: asked }), cleanBody: '', mediaUrl: 'https://bridge/media/photo-4.jpg',
      runtime: { mediaType: 'image/jpeg', mediaCount: 1 }, currentStep: 'main_menu'
    });
    assert.deepStrictEqual(afterQuestion, { handled: true, nextStep: 'main_menu', message: '' });
  });
});

test('a voice note to somebody on the team steps back like typed words do', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
  assert.match(source, /if \(message && \(!transcriptRecord\?\.text \|\| isAudioNote\) && \(!effectiveMediaUrl \|\| isAudioNote\) && !inboundPhotoCandidates\.length && !sharedLocation\n\s+&& await customerTalkIsForAPerson\(/);
  assert.match(source, /if \(\(!transcriptRecord\?\.text \|\| isAudioNote\)\n\s+&& await customerTalkIsForAPerson\(\{ phone, said: effectiveBody, reply: friendlyUnknownReply\(activeLang\)/);
});
