'use strict';

/**
 * 24 Nov 2026, 22:49 to 23:04 in Kampala. Every name and number here is made up.
 *
 * An agent removed for not paying sent four properties, and got the kind note
 * with his payment link. Then he wrote: "I was suggesting to reduce ko for me
 * / Coz right now the Economy / … then next year u Bill that amount per month
 * / How do u see". The note had gone, so the chat stayed quiet, and the team
 * had only heard "They sent photos".
 *
 * - A question or a request after the note is answered by a person: they hear
 *   once in 12 hours that it was passed on ("in the morning" at night), and
 *   the team gets everything they wrote, once they stop typing.
 * - A reply typed in King can wait for its time (send_at): the answer to him
 *   goes at 07:00, after quiet hours.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../config/database');
const route = require('../routes/whatsapp').__test;
const desk = require('../services/leadDeskService');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const AGENT_ID = '0e0e0e0e-0000-4000-8000-000000000051';
const removed = {
  id: AGENT_ID, full_name: 'Moses Testname', greeting_name: 'Moses', phone: '+256700000151', whatsapp: '+256700000151', status: 'suspended',
  removed_at: '2026-11-23T14:08:01Z', removed_reason: 'Has not paid yet',
  // Welcomed back, chose to rejoin, and have the payment link (27 Nov 2026).
  removal_snapshot: { reason_code: 'not_paying', welcome_back_at: new Date(Date.now() - 20 * 60e3).toISOString(), former_agent_choice: 'rejoin', former_agent_choice_at: new Date(Date.now() - 15 * 60e3).toISOString(), rejoin_sent_at: new Date(Date.now() - 15 * 60e3).toISOString() }
};

async function withRemovedAgent(run) {
  const saved = { query: db.query, send: desk.sendToTeam };
  const toTeam = [];
  db.query = async (sql) => (/FROM agents\s+WHERE RIGHT\(REGEXP_REPLACE\(COALESCE\(whatsapp/i.test(String(sql)) ? { rows: [removed] } : { rows: [] });
  desk.sendToTeam = async (_db, body, kind) => { toTeam.push({ body, kind }); return []; };
  route.formerAgentAckedAt.clear();
  try {
    return await run(toTeam);
  } finally {
    db.query = saved.query;
    desk.sendToTeam = saved.send;
    for (const key of [...route.formerAgentWords.keys()]) {
      clearTimeout(route.formerAgentWords.get(key).timer);
      route.formerAgentWords.delete(key);
    }
  }
}

test('a question or a request is for a person; a hello, a thank-you or an exclamation is not', () => {
  for (const said of ['I was suggesting to reduce ko for me', 'Coz right now the Economy', 'How do u see', 'Can I pay half?']) {
    assert.strictEqual(route.formerAgentAsks(said), true, said);
  }
  for (const said of ['Hello', 'Ok thanks', '👍', 'Mukama wange', '']) {
    assert.strictEqual(route.formerAgentAsks(said), false, said);
  }
});

test('after the note: told once that it was passed on, and the team gets every word once they stop', async () => {
  await withRemovedAgent(async (toTeam) => {
    const first = await route.removedAgentReply({ phone: '256700000151', body: 'I was suggesting to reduce ko for me', hasMedia: false });
    assert.match(first.message, /^Thank you, Moses 🙏 I've passed your message to our team, and someone will get back to you here (?:in the morning|soon)\.$/);
    assert.ok(!first.silent);
    const second = await route.removedAgentReply({ phone: '256700000151', body: 'then next year u Bill that amount per month. How do u see', hasMedia: false });
    assert.deepStrictEqual(second, { message: '', silent: true }, 'one acknowledgement, not one per message');
    const hello = await route.removedAgentReply({ phone: '256700000151', body: 'Hello', hasMedia: false });
    assert.deepStrictEqual(hello, { message: '', silent: true });
    const asked = () => toTeam.filter((t) => t.kind === 'former_agent_asked');
    assert.strictEqual(asked().length, 0, 'nothing until they stop typing');
    assert.ok(!toTeam.some((t) => t.kind === 'former_agent_wrote' && /reduce ko/.test(t.body)), 'their question is not sent twice');
    await route.sendFormerAgentWords(AGENT_ID);
    assert.strictEqual(asked().length, 1);
    const [notice] = asked();
    assert.match(notice.body, /^💬 \*Moses Testname is waiting for a reply\* · number ending 151\nRemoved: Has not paid yet\. They have the kind note with their payment link\./);
    assert.match(notice.body, /"I was suggesting to reduce ko for me"\n"then next year u Bill that amount per month\. How do u see"/);
    assert.match(notice.body, /Please answer them from King's WhatsApp inbox\.$/);
    assert.doesNotMatch(notice.body, /700000151/, 'never the whole number');
  });
});

test('at night they are told "in the morning", by day "soon"', () => {
  assert.match(route.formerAgentHeldReply({ full_name: 'Moses Testname' }, new Date('2026-11-24T20:02:00Z')), /someone will get back to you here in the morning\.$/);
  assert.match(route.formerAgentHeldReply({ full_name: 'Moses Testname' }, new Date('2026-11-25T08:00:00Z')), /someone will get back to you here soon\.$/);
});

test('a reply typed in King can wait for its time', async () => {
  const admin = require('../routes/admin');
  const layer = admin.stack.find((l) => l.route && l.route.path === '/whatsapp/conversations/:phone/reply' && l.route.methods.post);
  const handle = layer.route.stack[layer.route.stack.length - 1].handle;
  const savedQuery = db.query;
  const savedEnv = process.env.WHATSAPP_WEB_BRIDGE_ENABLED;
  const inserts = [];
  process.env.WHATSAPP_WEB_BRIDGE_ENABLED = 'true';
  db.query = async (sql, params = []) => {
    if (/INSERT INTO outbound_message_queue/.test(String(sql))) {
      inserts.push(params);
      return { rows: [{ id: 'q-1' }] };
    }
    return { rows: [] };
  };
  const at = new Date(Date.now() + 8 * 3600e3).toISOString();
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  try {
    await handle({ params: { phone: '256700000151' }, body: { text: 'Hi Moses, thank you for being open with us.', source: 'human', send_at: at }, adminAuth: { userId: 'admin-1' } }, res, (error) => { throw error; });
  } finally {
    db.query = savedQuery;
    if (savedEnv === undefined) delete process.env.WHATSAPP_WEB_BRIDGE_ENABLED;
    else process.env.WHATSAPP_WEB_BRIDGE_ENABLED = savedEnv;
  }
  assert.strictEqual(res.body.ok, true);
  assert.strictEqual(res.body.data.queued_for_bridge, true);
  assert.strictEqual(res.body.data.scheduled_for, at);
  assert.strictEqual(res.body.data.delivery.scheduled_for, at);
  assert.strictEqual(inserts.length, 1);
  assert.strictEqual(inserts[0][4], at, 'it waits in the queue until then');
  // A time that has passed means now.
  const source = read('routes/admin.js');
  assert.match(source, /const sendAt = sendAtDate && !Number\.isNaN\(sendAtDate\.getTime\(\)\) && sendAtDate\.getTime\(\) > Date\.now\(\) && isWhatsappWebBridgeEnabled\(\)/);
});
