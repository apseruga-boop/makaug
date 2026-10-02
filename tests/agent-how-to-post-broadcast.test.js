'use strict';
const test = require('node:test');
const assert = require('node:assert');
const svc = require('../services/agentHowToPostBroadcastService');
const fs = require('fs');
const path = require('path');

test('message matches the bot: hello, caption example, review, link, words', () => {
  const m = svc.buildMessage({ name: 'Kazi Honest' });
  assert.match(m, /^Hi Kazi,/);
  assert.match(m, /Say \*hello\*/);
  assert.match(m, /3 bedroom house for rent in Kira, Wakiso — UGX 1\.2m a month/);
  assert.match(m, /reviews it/);
  assert.match(m, /send you the link/);
  for (const w of ['SHARE', 'STATUS', 'HELP']) assert.ok(m.includes(`*${w}*`));
  assert.ok(m.length < 1500);
  assert.ok(svc.buildCaption({ name: 'Kazi' }).length < 300);
});

test('first name skips titles and copes with blanks', () => {
  assert.strictEqual(svc.firstName('Mr. John Okello'), 'John');
  assert.strictEqual(svc.firstName('grace'), 'Grace');
  assert.match(svc.buildMessage({ name: '' }), /^Hi,/);
});

test('video is a public asset under the site', () => {
  assert.ok(fs.existsSync(path.join(__dirname, '..', svc.VIDEO_PATH)));
  assert.match(svc.videoUrl(), /^https:\/\/.+\/assets\/marketing\/makaug-agent-how-to-post-v2\.mp4$/);
});

test('queueFor sends the film first then the text, keyed per agent', async () => {
  const calls = [];
  const queue = async (msg) => { calls.push(msg); return { id: calls.length }; };
  const r = await svc.queueFor({ queue, to: '256700000001', name: 'Ann', agentId: 'a1', source: 'whatsapp_runtime', actorId: 'admin' });
  assert.deepStrictEqual(r, { video_id: 1, text_id: 2 });
  assert.strictEqual(calls[0].mediaType, 'video');
  assert.strictEqual(calls[0].source, 'whatsapp_runtime');
  assert.strictEqual(calls[1].mediaUrl, undefined);
  assert.strictEqual(calls[0].metadata.broadcast_key, svc.BROADCAST_KEY);
  assert.strictEqual(calls[0].metadata.reply_dedupe_key, `${svc.BROADCAST_KEY}:a1:live:video`);
});

test('recipients: approved only, deduped by number, own numbers excluded', async () => {
  const db = { query: async () => ({ rows: [
    { id: '1', full_name: 'A', number: '0772 111 222' },
    { id: '2', full_name: 'B', number: '+256772111222' },
    { id: '3', full_name: 'C', number: '0780863394' },
    { id: '4', full_name: 'D', number: '123' }
  ] }) };
  const r = await svc.listRecipients(db, { excludeKeys: ['780863394'] });
  assert.deepStrictEqual(r.map((x) => [x.id, x.number]), [['1', '256772111222']]);
});
