'use strict';

/**
 * 13 Nov 2026, 05:16 to 05:19 UK time, Arthur's chat with the makaug number:
 *
 *   05:16:44  Agent 007            -> the Agent 007 menu
 *   05:16:56  3                    -> "Send their details like this: Name | phone"
 *   05:17:29  Sulait | 07…         -> "✅ Video sent to Sulait"
 *   05:17:56  Agent 007            -> the same menu, dropped by the bridge
 *   05:18:38  Complete             -> the same menu, dropped by the bridge
 *   05:18:49  Agent 007            -> folded into the one before by the queue
 *
 * The bot answered every message. The WAHA bridge sends nobody the same words
 * twice within two minutes, dropped the repeats and reported them sent, and
 * Arthur heard nothing after "Video sent".
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const db = require('../config/database');
const bridge = require('../services/whatsappWebBridgeService');
const { employeeRolePrompt } = require('../services/whatsappEmployeeIntakeService');

const ARTHUR = '447757773202';
const MENU = employeeRolePrompt('UGX 50,000');
const NOW = new Date('2026-11-13T05:17:56Z');
const ago = (seconds) => new Date(NOW.getTime() - seconds * 1000).toISOString();
const row = (text, seconds, inbound = 'in-old', media = '') => ({ text, media_url: media, inbound_message_id: inbound, created_at: ago(seconds) });

function withRecent(rows, run, { language = 'en' } = {}) {
  const original = db.query;
  const calls = [];
  db.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    if (/FROM outbound_message_queue/i.test(sql) && /duplicate_suppressed/i.test(sql)) return { rows };
    if (/SELECT language FROM whatsapp_sessions/i.test(sql)) return { rows: [{ language }] };
    return { rows: [] };
  };
  return Promise.resolve(run(calls)).finally(() => { db.query = original; });
}

const ask = (text, extra = {}) => bridge.repeatSafeReplyText({ recipient: ARTHUR, text, inboundMessageId: 'in-new', now: NOW, ...extra });

test('the menu again, a minute after the last one, says it is a repeat', async () => {
  await withRecent([row(MENU, 71, 'in-1')], async () => {
    const text = await ask(MENU);
    assert.strictEqual(text, `🔁 Here it is again:\n\n${MENU}`);
  });
});

test('the next repeat opens with a line he has not had yet', async () => {
  await withRecent([row(`🔁 Here it is again:\n\n${MENU}`, 42, 'in-2'), row(MENU, 113, 'in-1')], async () => {
    assert.strictEqual(await ask(MENU), `🔁 Once more:\n\n${MENU}`);
  });
});

test('both lines used inside the window: the reply goes as it is', async () => {
  const rows = [row(`🔁 Once more:\n\n${MENU}`, 30, 'in-3'), row(`🔁 Here it is again:\n\n${MENU}`, 80, 'in-2'), row(MENU, 150, 'in-1')];
  await withRecent(rows, async () => {
    assert.strictEqual(await ask(MENU), MENU);
  });
});

test('the same message handled twice is left for the duplicate guards', async () => {
  await withRecent([row(MENU, 71, 'in-new')], async () => {
    assert.strictEqual(await ask(MENU), MENU);
  });
});

test('a burst gets one answer: the same words seconds ago are not repeated', async () => {
  await withRecent([row(MENU, 8, 'in-1')], async () => {
    assert.strictEqual(await ask(MENU), MENU);
  });
});

test('new words go as they are, and the session is not read', async () => {
  let asked = false;
  await withRecent([row('✅ *Video sent to Sulait*', 19, 'in-1')], async () => {
    const text = await ask(MENU, { language: () => { asked = true; return 'en'; } });
    assert.strictEqual(text, MENU);
  });
  assert.strictEqual(asked, false, 'the language is only looked up when a repeat is found');
});

test('the same caption on another photo is another message', async () => {
  await withRecent([row('🏠 2-bed in Kira', 60, 'in-1', 'https://makaug.com/a.jpg')], async () => {
    assert.strictEqual(await ask('🏠 2-bed in Kira', { mediaUrl: 'https://makaug.com/b.jpg' }), '🏠 2-bed in Kira');
    assert.strictEqual(await ask('🏠 2-bed in Kira', { mediaUrl: 'https://makaug.com/a.jpg' }), '🔁 Here it is again:\n\n🏠 2-bed in Kira');
  });
});

test('copies the bridge dropped do not count, and only replies still going or gone are read', async () => {
  await withRecent([], async (calls) => {
    await ask(MENU);
    const lookup = calls.find((c) => /FROM outbound_message_queue/i.test(c.sql));
    assert.ok(lookup, 'the queue was read');
    assert.match(lookup.sql, /duplicate_suppressed', 'false'\) <> 'true'/);
    assert.match(lookup.sql, /status IN \('pending', 'retry', 'sent'\)/);
    assert.strictEqual(lookup.params[0], ARTHUR);
  });
});

test('the repeat line is in the language of the chat', async () => {
  await withRecent([row(MENU, 71, 'in-1')], async () => {
    assert.match(await ask(MENU, { language: 'sw' }), /^🔁 Hii hapa tena:\n\n/);
    assert.match(await ask(MENU, { language: () => Promise.resolve('lg') }), /^🔁 Nate:\n\n/);
    assert.match(await ask(MENU, { language: 'xx' }), /^🔁 Here it is again:\n\n/);
  });
});

/**
 * The bridge's rule, as it is written in services/waha-bridge/server.js on the
 * waha-bridge branch: the words, spacing squeezed, and the media, hashed per
 * chat; anything sent in the last two minutes is dropped.
 */
function wahaBridge() {
  const recent = new Map();
  const key = (msg) => `${msg.recipient}|${crypto.createHash('sha1').update([
    String(msg.text || '').replace(/\s+/g, ' ').trim(),
    String(msg.media_url || '').trim()
  ].join('|')).digest('hex')}`;
  return (msg, at) => {
    const last = recent.get(key(msg));
    if (last !== undefined && at - last < 120) return 'dropped';
    recent.set(key(msg), at);
    return 'delivered';
  };
}

test('Arthur\'s morning, replayed: every message he sent gets an answer he can see', async () => {
  const send = wahaBridge();
  const queue = []; // what has gone out, newest first, as the queue holds it
  const turns = [
    { at: 0, inbound: 'in-1', reply: MENU }, // Agent 007
    { at: 12, inbound: 'in-2', reply: '🎬 *Send the makaug agent video*' }, // 3
    { at: 45, inbound: 'in-3', reply: '✅ *Video sent to Sulait*' }, // Sulait | 07…
    { at: 72, inbound: 'in-4', reply: MENU }, // Agent 007
    { at: 114, inbound: 'in-5', reply: 'Nothing was loaded, so there is nothing to complete. Agent 007 is closed.' }, // Complete
    { at: 125, inbound: 'in-6', reply: MENU } // Agent 007
  ];
  const outcomes = [];
  const firstLines = [];
  for (const turn of turns) {
    const now = new Date(NOW.getTime() + turn.at * 1000);
    const rows = queue.map((q) => ({ text: q.text, media_url: '', inbound_message_id: q.inbound, created_at: new Date(NOW.getTime() + q.at * 1000).toISOString() }));
    const text = await withRecent(rows, () => bridge.repeatSafeReplyText({ recipient: ARTHUR, text: turn.reply, inboundMessageId: turn.inbound, now }));
    const outcome = send({ recipient: ARTHUR, text }, turn.at);
    outcomes.push(outcome);
    firstLines.push(text.split('\n')[0]);
    if (outcome === 'delivered') queue.unshift({ text, inbound: turn.inbound, at: turn.at });
  }
  assert.deepStrictEqual(outcomes, ['delivered', 'delivered', 'delivered', 'delivered', 'delivered', 'delivered'], firstLines.join('\n'));
  assert.strictEqual(firstLines[3], '🔁 Here it is again:');
  assert.strictEqual(firstLines[5], '🔁 Once more:');

  // Before: the same words each time. The bridge drops both menus.
  const before = wahaBridge();
  const old = turns.map((turn) => before({ recipient: ARTHUR, text: turn.reply }, turn.at));
  assert.deepStrictEqual(old, ['delivered', 'delivered', 'delivered', 'dropped', 'delivered', 'delivered'],
    'with only the menu fixed for COMPLETE, the menu 72 seconds later is still dropped');
});

test('the reply queued for a new message carries the repeat line', async () => {
  const route = require('../routes/whatsapp');
  const original = db.query;
  const inserted = [];
  db.query = async (sql, params = []) => {
    if (/FROM outbound_message_queue/i.test(sql) && /duplicate_suppressed/i.test(sql)) {
      return { rows: [{ text: MENU, media_url: '', inbound_message_id: 'in-1', created_at: new Date(Date.now() - 71000).toISOString() }] };
    }
    if (/SELECT language FROM whatsapp_sessions/i.test(sql)) return { rows: [{ language: 'en' }] };
    if (/INSERT INTO outbound_message_queue/i.test(sql)) {
      inserted.push(JSON.parse(params[1]));
      return { rows: [{ id: 'q-new', status: 'pending' }] };
    }
    return { rows: [] };
  };
  try {
    const queued = await route.__test.queueWhatsappWebBridgeAutoReply({ phone: ARTHUR, message: MENU, nextStep: 'employee_intake_role', inboundMessageId: 'in-4' });
    assert.strictEqual(queued.id, 'q-new');
    assert.strictEqual(inserted.length, 1);
    assert.ok(inserted[0].text.startsWith('🔁 Here it is again:\n\n🔐 *makaug employee intake*'), inserted[0].text.slice(0, 80));
  } finally {
    db.query = original;
  }
});

test('COMPLETE at the first Agent 007 question closes it instead of asking again', async () => {
  const route = require('../routes/whatsapp');
  const original = db.query;
  const updates = [];
  db.query = async (sql, params = []) => {
    if (/UPDATE whatsapp_sessions/i.test(sql)) updates.push(params);
    return { rows: [] };
  };
  try {
    const reply = await route.__test.handleEmployeeWhatsappIntake({
      phone: `+${ARTHUR}`,
      body: 'Complete',
      session: { current_step: 'employee_intake_role', session_data: { whatsapp_employee_intake: true, property_ids: [] } }
    });
    assert.strictEqual(reply.handled, true);
    assert.strictEqual(reply.nextStep, 'main_menu');
    assert.match(reply.message, /nothing to complete/i);
    assert.match(reply.message, /Agent 007/);
    assert.ok(updates.some((p) => p[1] === 'main_menu'), 'the session is back at the menu');

    const role = await route.__test.handleEmployeeWhatsappIntake({
      phone: `+${ARTHUR}`,
      body: '3',
      session: { current_step: 'employee_intake_role', session_data: { whatsapp_employee_intake: true, property_ids: [] } }
    });
    assert.strictEqual(role.nextStep, 'employee_pitch_contact', 'the menu answers are unchanged');
  } finally {
    db.query = original;
  }
});
