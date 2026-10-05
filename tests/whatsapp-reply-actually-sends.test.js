'use strict';

/**
 * A reply that says "queued" and never leaves.
 *
 * The WhatsApp bridge claims messages from the outbox by source. Its allow-list
 * is OUTBOX_ALLOWED_SOURCES, defaulting to whatsapp_runtime,whatsapp_missed_call
 * in both the browser copilot and the live WAHA/GOWS bridge.
 *
 * Admin › WhatsApp Inbox queued its replies under admin_human_reply, and the AI
 * suggestions under admin_ai_reply. Neither was ever on that list. So every
 * reply staff typed was written to the queue, answered with "queued: true", and
 * never sent to anybody.
 *
 * Found on 5 Oct 2026 with two sitting in the queue: one to Ronald from the day
 * before, and one to a customer who had asked for restaurant premises in
 * Kawempe and been sent a single room by mistake. Both looked sent from the
 * dashboard. Neither had left.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const adminSource = fs.readFileSync(require.resolve('../routes/admin'), 'utf8');
const copilotSource = fs.readFileSync(require.resolve('../scripts/whatsapp-web-copilot.js'), 'utf8');

/** What the bridges claim when nothing overrides it. */
function bridgeDefaultAllowedSources() {
  const block = copilotSource.slice(copilotSource.indexOf('OUTBOX_ALLOWED_SOURCES'));
  const match = block.match(/HOSTED_RUNTIME \? '([a-z_,]+)'/);
  assert.ok(match, 'the copilot must still declare its default allow-list');
  return match[1].split(',');
}

test('the bridge allow-list is what decides whether anything is delivered', () => {
  const allowed = bridgeDefaultAllowedSources();
  assert.deepStrictEqual(allowed, ['whatsapp_runtime', 'whatsapp_missed_call'],
    'if this changes, the reply source below has to change with it');
});

test('a staff reply is queued under a source the bridge will claim', () => {
  const helper = adminSource.match(/function whatsappReplyBridgeSource\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(helper, 'one place must decide the source replies are queued under');
  const fallback = helper[0].match(/'([a-z_]+)'\s*;?\s*\n\}/);
  assert.ok(bridgeDefaultAllowedSources().includes('whatsapp_runtime'),
    'the fallback has to be a claimed source');
  assert.match(helper[0], /whatsapp_runtime/);
  assert.ok(fallback, 'and it must not be able to end up empty, which claims nothing');
});

test('the reply route uses that helper, not a source of its own', () => {
  // Both queue paths — the direct one and the provider fallback.
  const uses = (adminSource.match(/source: whatsappReplyBridgeSource\(\),/g) || []).length;
  assert.strictEqual(uses, 2,
    'the reply route queues in two places and a path left on the old source still never delivers');

  // The old source may remain as the LOGGED source — a record of who wrote it,
  // which is not what the bridge reads — but never as a queued source.
  const queuedOnDeadSource = /source: source === 'ai' \? 'admin_ai_reply' : 'admin_human_reply',\s*\n\s*actorId/.test(adminSource);
  assert.strictEqual(queuedOnDeadSource, false, 'no queue call may decide delivery by a source nothing claims');
});

test('who wrote the reply is still recorded, in the metadata', () => {
  assert.match(adminSource, /reply_kind: source === 'ai' \? 'admin_ai_reply' : 'admin_human_reply'/,
    'the human/AI distinction survives the move, it just no longer decides delivery');
  assert.match(adminSource, /replied_by: actor \|\| null/);
});

test('the sources that never left the queue are not claimed anywhere', () => {
  const allowed = bridgeDefaultAllowedSources();
  for (const dead of ['admin_human_reply', 'admin_ai_reply', 'human', 'admin']) {
    assert.ok(!allowed.includes(dead), `"${dead}" is not claimed, so nothing queued under it is delivered`);
  }
});
