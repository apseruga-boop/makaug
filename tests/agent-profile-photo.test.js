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

test('the prompt asks for a face, refuses IDs, and promises a message when live', () => {
  const text = t.agentProfilePhotoPrompt({ full_name: 'Kimuli Brian' });
  assert(/photo of \*yourself\*/.test(text));
  assert(/ID/.test(text) && /live/.test(text) && /CANCEL/.test(text));
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
