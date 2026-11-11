'use strict';
const test = require('node:test');
const assert = require('node:assert');
const svc = require('../services/agentBriefBroadcastService');

const CAPTION = [
  '☀️ *makaug Morning Brief* · Thu 12 Nov',
  '5 property stories that affect your business, in 30 seconds 👆',
  '',
  '1️⃣ *Loans dearer* → ask "cash or loan?" first',
  'https://example.com/story',
  '',
  'Reply STOP if you don\'t want the brief.',
  'Phillip, makaug.com'
].join('\n');
const VIDEO = 'https://makaug.com/assets/marketing/morning-brief/makaug-morning-brief-2026-11-12-abcd1234.mp4';

// A database with approved agents, one STOP, and whatever is already queued.
function fakeDb({ agents, optedOut = [], queuedAgentIds = [], heldRows = 0 } = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (/FROM agents/.test(sql)) return { rows: agents };
      if (/FROM whatsapp_user_profiles/.test(sql)) return { rows: optedOut.map((phone) => ({ phone })) };
      if (/SELECT DISTINCT metadata->>'agent_id'/.test(sql)) return { rows: queuedAgentIds.map((agent_id) => ({ agent_id })) };
      if (/UPDATE outbound_message_queue/.test(sql)) return { rowCount: heldRows, rows: Array.from({ length: heldRows }, (_, i) => ({ id: i + 1 })) };
      if (/GROUP BY 1/.test(sql)) return { rows: [{ state: 'pending', n: 18, first_at: '2026-11-12T04:00:00.000Z', last_at: '2026-11-12T04:04:15.000Z' }, { state: 'held', n: 2 }] };
      return { rows: [] };
    }
  };
}

const AGENTS = [
  { id: 'a1', full_name: 'Agaba Amos', number: '0772 111 001' },
  { id: 'a2', full_name: 'Promise  Ahimbisibwe', number: '0752 111 002' },
  { id: 'a3', full_name: 'Kazi Honest', number: '+256 791 111 003' },
  { id: 'a4', full_name: 'Sewa sewa', number: '0703111004' },
  { id: 'a5', full_name: 'makaug line', number: '0780863394' }
];

test('a morning brief is keyed by date and slot, and goes at 7:00am Kampala (04:00 UTC)', () => {
  assert.strictEqual(svc.briefKey({ date: '2026-11-12' }), 'agent_brief:2026-11-12:morning');
  assert.strictEqual(svc.briefKey({ date: '2026-11-11', slot: 'Afternoon' }), 'agent_brief:2026-11-11:afternoon');
  assert.strictEqual(svc.kampalaTime('2026-11-12').toISOString(), '2026-11-12T04:00:00.000Z');
  assert.throws(() => svc.briefKey({ date: '12/11/2026' }), /YYYY-MM-DD/);
  assert.throws(() => svc.briefKey({ date: '2026-11-12', slot: 'midnight' }), /slot/);
});

test('the video must be an mp4 on makaug.com; the caption must offer STOP, be signed by Phillip and fit WhatsApp', () => {
  assert.strictEqual(svc.checkVideoUrl(VIDEO), VIDEO);
  assert.throws(() => svc.checkVideoUrl('https://raw.githubusercontent.com/x/y/brief.mp4'), /makaug\.com/);
  assert.throws(() => svc.checkVideoUrl('http://makaug.com/a.mp4'), /https/);
  assert.throws(() => svc.checkVideoUrl('https://makaug.com/a.mov'), /mp4/);
  assert.strictEqual(svc.checkCaption(CAPTION), CAPTION);
  assert.throws(() => svc.checkCaption(CAPTION.replace('Reply STOP', 'Reply NO')), /STOP/);
  assert.throws(() => svc.checkCaption(CAPTION.replace('Phillip', 'Arthur')), /Phillip/);
  assert.throws(() => svc.checkCaption(`${CAPTION}\n${'x'.repeat(1024)}`), /at most 1024/);
});

test('recipients: approved agents, never Promise, not anyone who replied STOP, not makaug itself', async () => {
  const db = fakeDb({ agents: AGENTS, optedOut: ['+256703111004'] });
  const { recipients, skipped } = await svc.listRecipients(db, { excludeKeys: ['780863394'] });
  assert.deepStrictEqual(recipients.map((r) => r.id), ['a1', 'a3']);
  assert.deepStrictEqual(skipped.map((r) => [r.id, r.reason]).sort(), [['a2', 'never_send'], ['a4', 'replied_stop']]);
});

test('schedule: one message per agent at 7:00am, 15 seconds apart, never twice', async () => {
  const db = fakeDb({ agents: AGENTS, queuedAgentIds: ['a3'] });
  const sent = [];
  const queue = async (msg) => { sent.push(msg); return { id: `q${sent.length}` }; };
  const now = new Date('2026-11-11T15:00:00Z');
  const r = await svc.scheduleBrief({
    db, queue, date: '2026-11-12', slot: 'morning', videoUrl: VIDEO, caption: CAPTION,
    source: 'whatsapp_runtime', actorId: 'admin', excludeKeys: ['780863394'], now
  });
  assert.strictEqual(r.key, 'agent_brief:2026-11-12:morning');
  assert.strictEqual(r.send_at, '2026-11-12T04:00:00.000Z');
  assert.strictEqual(r.queued, 2); // a1 and a4; a3 already has it
  assert.strictEqual(r.already_queued, 1);
  assert.deepStrictEqual(r.skipped.map((s) => s.id), ['a2']);
  assert.deepStrictEqual(sent.map((m) => m.recipient), ['256772111001', '256703111004']);
  assert.deepStrictEqual(sent.map((m) => new Date(m.sendAt).toISOString()), ['2026-11-12T04:00:00.000Z', '2026-11-12T04:00:15.000Z']);
  for (const m of sent) {
    assert.strictEqual(m.mediaType, 'video');
    assert.strictEqual(m.mediaUrl, VIDEO);
    assert.strictEqual(m.text, CAPTION);
    assert.strictEqual(m.metadata.broadcast_key, 'agent_brief:2026-11-12:morning');
    assert.strictEqual(m.metadata.reply_dedupe_key, `agent_brief:2026-11-12:morning:${m.metadata.agent_id}`);
  }
});

test('schedule: an afternoon brief with no time goes now; a time in the past means now; more than 48 hours ahead is refused', async () => {
  const now = new Date('2026-11-11T10:45:00Z');
  const queue = async (msg) => ({ id: msg.recipient });
  const base = { db: fakeDb({ agents: AGENTS.slice(0, 1) }), queue, date: '2026-11-11', videoUrl: VIDEO, caption: CAPTION, now };
  const pm = await svc.scheduleBrief({ ...base, slot: 'afternoon' });
  assert.strictEqual(pm.send_at, now.toISOString());
  const past = await svc.scheduleBrief({ ...base, db: fakeDb({ agents: AGENTS.slice(0, 1) }), slot: 'morning' });
  assert.strictEqual(past.send_at, now.toISOString()); // 7:00am on the 11th has passed
  await assert.rejects(() => svc.scheduleBrief({ ...base, slot: 'morning', date: '2026-11-14' }), /48 hours/);
});

test('preview goes now to the numbers given and is marked as a preview, so it never counts as sent', async () => {
  const sent = [];
  const queue = async (msg) => { sent.push(msg); return { id: sent.length }; };
  const r = await svc.previewBrief({ queue, date: '2026-11-12', videoUrl: VIDEO, caption: CAPTION, to: ['+44 7757 773202', '256709402189', '256709402189'], nonce: 1 });
  assert.strictEqual(r.queued.length, 2);
  assert.ok(sent.every((m) => m.metadata.preview === true && !m.sendAt));
  await assert.rejects(() => svc.previewBrief({ queue, date: '2026-11-12', videoUrl: VIDEO, caption: CAPTION, to: [] }), /at least one number/);
});

test('hold withdraws what has not gone; status counts waiting and held', async () => {
  const db = fakeDb({ agents: AGENTS, heldRows: 3 });
  const held = await svc.holdBrief(db, { date: '2026-11-12' });
  assert.deepStrictEqual(held, { key: 'agent_brief:2026-11-12:morning', held: 3 });
  const update = db.calls.find((c) => /UPDATE outbound_message_queue/.test(c.sql));
  assert.match(update.sql, /status IN \('pending', 'retry'\)/);
  assert.deepStrictEqual(update.params, ['agent_brief:2026-11-12:morning', svc.HELD_ERROR]);
  const status = await svc.briefStatus(db, { date: '2026-11-12' });
  assert.strictEqual(status.waiting, 18);
  assert.strictEqual(status.held, 2);
  assert.strictEqual(status.first_at, '2026-11-12T04:00:00.000Z');
});

test('the WhatsApp queue holds a message until its send time, and a repeat never brings it forward', async () => {
  const dbPath = require.resolve('../config/database');
  const bridgePath = require.resolve('../services/whatsappWebBridgeService');
  const originalDb = require.cache[dbPath];
  const originalBridge = require.cache[bridgePath];
  const calls = [];
  let existing = null;
  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: {
      query: async (sql, params = []) => {
        calls.push({ sql, params });
        if (/INSERT INTO outbound_message_queue/.test(sql)) return { rows: [{ id: calls.length, next_attempt_at: params[4] }] };
        if (/SELECT \*\s+FROM outbound_message_queue/.test(sql)) return { rows: existing ? [existing] : [] };
        return { rows: [] };
      }
    }
  };
  delete require.cache[bridgePath];
  try {
    const { queueWhatsappWebBridgeMessage } = require('../services/whatsappWebBridgeService');
    const at = new Date(Date.now() + 60 * 60 * 1000);
    await queueWhatsappWebBridgeMessage({ recipient: '256772111001', text: 'Morning brief', sendAt: at, metadata: { reply_dedupe_key: 'brief:a1' } });
    const inserts = () => calls.filter((c) => /INSERT INTO outbound_message_queue/.test(c.sql));
    assert.match(inserts()[0].sql, /COALESCE\(\$5::timestamptz, NOW\(\)\)/);
    assert.strictEqual(inserts()[0].params[4], at.toISOString());
    assert.strictEqual(JSON.parse(inserts()[0].params[3]).scheduled_for, at.toISOString());

    await queueWhatsappWebBridgeMessage({ recipient: '256772111002', text: 'Now', metadata: { reply_dedupe_key: 'now:a2' } });
    assert.strictEqual(inserts()[1].params[4], null);
    await queueWhatsappWebBridgeMessage({ recipient: '256772111003', text: 'Past', sendAt: new Date(Date.now() - 1000), metadata: { reply_dedupe_key: 'past:a3' } });
    assert.strictEqual(inserts()[2].params[4], null);

    existing = { id: 99, status: 'pending', next_attempt_at: at.toISOString() };
    const again = await queueWhatsappWebBridgeMessage({ recipient: '256772111001', text: 'Morning brief', sendAt: at, metadata: { reply_dedupe_key: 'brief:a1' } });
    assert.strictEqual(again.duplicate_suppressed, true);
    assert.ok(!calls.some((c) => /next_attempt_at = NOW\(\)/.test(c.sql)), 'a waiting brief must not be pulled forward');
  } finally {
    if (originalDb) require.cache[dbPath] = originalDb; else delete require.cache[dbPath];
    if (originalBridge) require.cache[bridgePath] = originalBridge; else delete require.cache[bridgePath];
  }
});
