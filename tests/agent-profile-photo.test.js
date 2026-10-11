'use strict';

/**
 * 11 Oct 2026: an agent wrote "My profile has no photo" and was sent his share
 * link, because "my profile" matched the share request. He should be asked for a
 * photo, and told when it is live.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

process.env.NODE_ENV = 'test';
const dbPath = require.resolve('../config/database');
const realDb = require(dbPath);
const writes = [];
realDb.query = async (sql, params) => { writes.push({ sql: String(sql), params }); return { rows: [] }; };
const router = require('../routes/whatsapp');
const t = router.__test;
const source = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');

test('photo complaints are recognised', () => {
  for (const text of [
    'My profile has no photo',
    'my profile has no picture',
    'Change my photo',
    'update my profile pic',
    'I want to add a profile photo',
    'my dp is missing',
    'my logo is wrong'
  ]) assert.strictEqual(t.isAgentProfilePhotoRequest(text), true, text);
});

test('property talk and share requests are not photo requests', () => {
  for (const text of [
    'send me my link',
    'share',
    'my listings',
    'how do I add a photo to my listing',
    '4 bedroom house with staff quarters UGX 500 million photo attached',
    'hello',
    ''
  ]) assert.strictEqual(t.isAgentProfilePhotoRequest(text), false, text);
});

test('the photo request is tested before the share request', () => {
  const photo = source.indexOf('if (isAgentProfilePhotoRequest(askedText)) {');
  const share = source.indexOf('if (AGENT_SHARE_REQUEST.test(askedText)) {\n          const share = agentShareReply({ agent: askingAgent });');
  assert(photo > 0 && share > 0 && photo < share);
});

test('the prompt asks for a photo or a logo, refuses IDs, and promises a message when live', () => {
  const text = t.agentProfilePhotoPrompt({ full_name: 'Kimuli Brian' });
  assert(text.includes(t.AGENT_PHOTO_ASK_PHRASE), 'the follow-up detector keys on this phrase');
  assert(/photo of \*you\*, or your company \*logo\*/.test(text));
  assert(/ID card/.test(text) && /live/.test(text) && /CANCEL/.test(text));
});

test('cancel and unrelated text leave the photo step cleanly', async () => {
  const data = { whatsapp_agent_self_intake: true, agent: { id: 'a1', full_name: 'Kimuli Brian' }, awaiting_profile_photo: true, awaiting_profile_photo_at: new Date().toISOString() };
  const cancelled = await t.handleAgentProfilePhotoReply({ phone: '256774505232', data, candidates: [], cleanBody: 'cancel', inboundMessageId: 'm1' });
  assert(/send \*my photo\* any time/.test(cancelled.message));
  assert.strictEqual(data.awaiting_profile_photo, undefined);

  const data2 = { agent: { id: 'a1' }, awaiting_profile_photo: true, awaiting_profile_photo_at: new Date().toISOString() };
  assert.strictEqual(await t.handleAgentProfilePhotoReply({ phone: '256774505232', data: data2, candidates: [], cleanBody: 'ok thanks', inboundMessageId: 'm2' }), null);
  assert.strictEqual(data2.awaiting_profile_photo, undefined);
});

test('a property advert sent while waiting is a property, not a face', async () => {
  const data = { agent: { id: 'a1' }, awaiting_profile_photo: true, awaiting_profile_photo_at: new Date().toISOString() };
  const reply = await t.handleAgentProfilePhotoReply({
    phone: '256774505232', data,
    candidates: [{ kind: 'image', dataUrl: 'data:image/jpeg;base64,AAAA' }],
    cleanBody: 'Kira 4 bedrooms house UGX 300 million', inboundMessageId: 'm3'
  });
  assert.strictEqual(reply, null);
  assert.strictEqual(data.awaiting_profile_photo, undefined);
});

test('an expired wait does not swallow a photo', async () => {
  const data = { agent: { id: 'a1' }, awaiting_profile_photo: true, awaiting_profile_photo_at: new Date(Date.now() - 3 * 3600000).toISOString() };
  assert.strictEqual(await t.handleAgentProfilePhotoReply({ phone: '256774505232', data, candidates: [{ kind: 'image' }], cleanBody: '', inboundMessageId: 'm4' }), null);
});

test('saving updates the agent row, tells the team and confirms to the agent', () => {
  assert(source.includes('UPDATE agents SET profile_photo_url = $2, updated_at = NOW()\n        WHERE id = $1\n        RETURNING'));
  assert(source.includes("'agent_profile_photo_updated'"));
  assert(source.includes('your new photo is live on your makaug profile'));
  assert(source.includes("=== 'screenshot_or_document'"), 'screenshots never become a profile photo');
});

test('"MY PHOTO" works, and an agent with no photo is nudged once per posting session', () => {
  assert.strictEqual(t.isAgentProfilePhotoRequest('MY PHOTO'), true);
  assert(source.includes('Reply *MY PHOTO* and send one'));
  assert(source.includes('openedAgentSelfIntake && data.agent && !data.agent.profile_photo_url'));
  assert(/SELECT id, makaug_agent_number[^`]*profile_photo_url\n\s+FROM agents/.test(source), 'the agent lookup must carry the photo');
});

test('the image is tidied: photos cropped square, logos kept whole, tiny images refused', async () => {
  const sharp = require('sharp');
  const { cleanProfileImage } = require('../services/agentProfileImageService');
  const photo = await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 120, g: 90, b: 70 } } }).jpeg().toBuffer();
  const logo = await sharp({ create: { width: 900, height: 200, channels: 4, background: { r: 0, g: 100, b: 0, alpha: 0.5 } } }).png().toBuffer();
  const tiny = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#999' } }).jpeg().toBuffer();
  const cleanedPhoto = await cleanProfileImage(photo);
  const photoMeta = await sharp(cleanedPhoto.bytes).metadata();
  assert.strictEqual(cleanedPhoto.mode, 'photo');
  assert.strictEqual(photoMeta.width, photoMeta.height);
  assert.strictEqual(photoMeta.format, 'jpeg');
  const cleanedLogo = await cleanProfileImage(logo);
  const logoMeta = await sharp(cleanedLogo.bytes).metadata();
  assert.strictEqual(cleanedLogo.mode, 'logo');
  assert.strictEqual(logoMeta.width, logoMeta.height);
  assert.strictEqual((await cleanProfileImage(tiny)).tooSmall, true);
});

test('a picture sent after our own request is accepted with no session open', () => {
  assert(source.includes('async function maybeAcceptRequestedProfilePhoto'));
  assert(source.includes("b.payload::text ILIKE '%your new photo is live%'"), 'a confirmed photo ends the request');
  const early = source.indexOf('await maybeAcceptRequestedProfilePhoto({ phone, cleanBody');
  const forwarded = source.indexOf('if (looksLikeForwardedProperty({ cleanBody, mediaUrl, runtime })) {\n      const selfAgent');
  assert(early > 0 && forwarded > early, 'it runs before a captionless image is read as a property');
});

test('the saved image is the tidied one, and a failed tidy falls back to the original', () => {
  assert(source.includes("require('../services/agentProfileImageService').cleanProfileImage"));
  assert(source.includes('Agent profile image clean-up skipped'));
});

test('the welcome message asks for a profile picture, but not from agents who have one', () => {
  const welcome = require('../services/agentWelcomeService');
  const without = welcome.buildWelcomeMessage({ agent: { id: 'a1', full_name: 'Kimuli Brian' }, stats: {} });
  assert(without.includes('*Add your profile picture*') && without.includes('MY PHOTO'));
  assert(without.length < 4000);
  const withPhoto = welcome.buildWelcomeMessage({ agent: { id: 'a1', full_name: 'Kimuli Brian', profile_photo_url: 'https://x/y.jpg' }, stats: {} });
  assert(!withPhoto.includes('*Add your profile picture*'));
});
