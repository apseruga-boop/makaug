// An agent is marked "welcomed" only once the welcome is really in the queue.
// On 5 Oct, 10 agents were stamped as welcomed and then the server died during
// the video render: nothing was ever sent, and the catch-up skipped them.
// Since 15 Nov 2026 the welcome renders nothing (it is three messages, the
// film a file that already exists), so the queue is the one thing that can fail.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AGENT_CARD_SECRET = process.env.AGENT_CARD_SECRET || 'welcome-stamp-test-secret';

const bridge = require('../services/whatsappWebBridgeService');
let queueBehaviour = 'ok';
const queued = [];
bridge.queueWhatsappWebBridgeMessage = async (message) => {
  if (queueBehaviour === 'fail') throw new Error('queue down');
  if (queueBehaviour === 'empty') return null;
  queued.push(message);
  return { id: `q-${queued.length}` };
};

const db = require('../config/database');
const admin = require('../routes/admin');

const MIDDAY = new Date('2026-11-16T09:00:00Z'); // 12:00 in Kampala

async function makeAgent(label) {
  const phone = `+2567${String(Date.now()).slice(-8)}`;
  const row = (await db.query(
    `INSERT INTO agents (full_name, phone, whatsapp, email, licence_number, status, approved_at)
     VALUES ($1, $2, $2, $3, $4, 'approved', NOW()) RETURNING *`,
    [`Stamp ${label}`, phone, `stamp-${Date.now()}-${label}@example.com`, `STAMP-${Date.now()}-${label}`]
  )).rows[0];
  return row;
}

async function stamps(id) {
  return (await db.query('SELECT welcome_sent_at, pay_link_sent_at FROM agents WHERE id = $1', [id])).rows[0];
}

test('the queue is down: not stamped, and no payment message goes on its own', async () => {
  queueBehaviour = 'fail';
  queued.length = 0;
  let followed = false;
  const agent = await makeAgent('fail');
  await assert.rejects(admin.queueAgentWelcomePack({ agentId: agent.id, actorId: 'test', feeLink: { agent, force: true }, afterQueued: () => { followed = true; }, now: MIDDAY }), /queue down/);
  const after = await stamps(agent.id);
  assert.equal(after.welcome_sent_at, null);
  assert.equal(after.pay_link_sent_at, null, 'the pay link must not follow a welcome that never went');
  assert.equal(followed, false);
  assert.equal(queued.length, 0);
});

test('the queue takes nothing: not stamped, nothing else sent', async () => {
  queueBehaviour = 'empty';
  queued.length = 0;
  const agent = await makeAgent('empty');
  const result = await admin.queueAgentWelcomePack({ agentId: agent.id, actorId: 'test', feeLink: { agent, force: true }, now: MIDDAY });
  assert.equal(result.queued.text_id, null);
  assert.deepEqual(result.fee_link, { sent: false, reason: 'welcome_not_queued' });
  const after = await stamps(agent.id);
  assert.equal(after.welcome_sent_at, null, 'so the start-up catch-up tries them again');
  assert.equal(after.pay_link_sent_at, null);
});

test('the welcome queues: stamped, the payment message is the third, then the follow-up runs', async () => {
  queueBehaviour = 'ok';
  queued.length = 0;
  let followed = false;
  const agent = await makeAgent('ok');
  const result = await admin.queueAgentWelcomePack({ agentId: agent.id, actorId: 'test', feeLink: { agent, force: true }, afterQueued: () => { followed = true; }, now: MIDDAY });
  const mine = queued.filter((message) => String(message.recipient).replace(/\D/g, '') === agent.phone.replace(/\D/g, ''));
  assert.deepEqual(mine.map((message) => message.metadata.part), ['approved', 'welcome_how_to_film', 'welcome_plan']);
  assert.match(mine[2].text, /Your payment page: https?:\/\/\S+\/pay\/[A-Z0-9]+/, 'their own pay link, from the real table');
  const after = await stamps(agent.id);
  assert.notEqual(after.welcome_sent_at, null);
  assert.notEqual(after.pay_link_sent_at, null);
  assert.equal(followed, true);
  assert.equal(result.fee_link.sent, true);
});

test('approving the same agent again sends nothing more', async () => {
  queueBehaviour = 'ok';
  const agent = await makeAgent('twice');
  await admin.runAgentApprovalFollowUps({ agentId: agent.id, wasApproved: true, actor: 'test' });
  queued.length = 0;
  const again = await admin.runAgentApprovalFollowUps({ agentId: agent.id, wasApproved: true, actor: 'test' });
  assert.deepEqual(again.welcome, { skipped: 'already_sent' });
  assert.equal(again.fee_link.sent, false);
  assert.equal(queued.filter((message) => String(message.recipient).replace(/\D/g, '') === agent.phone.replace(/\D/g, '')).length, 0);
});

test('a preview stamps nothing and makes no pay link', async () => {
  queueBehaviour = 'ok';
  queued.length = 0;
  const agent = await makeAgent('preview');
  await admin.queueAgentWelcomePack({ agentId: agent.id, previewTo: '256700555002', actorId: 'test' });
  const after = await stamps(agent.id);
  assert.equal(after.welcome_sent_at, null);
  assert.equal(after.pay_link_sent_at, null);
  const links = (await db.query('SELECT COUNT(*)::int AS n FROM pay_links WHERE agent_id = $1', [agent.id])).rows[0].n;
  assert.equal(links, 0);
  assert.equal(queued.filter((message) => message.recipient === '256700555002').length, 3);
});

test.after(async () => {
  await db.query(`DELETE FROM pay_links WHERE agent_id IN (SELECT id FROM agents WHERE full_name LIKE 'Stamp %')`).catch(() => {});
  await db.query(`DELETE FROM agents WHERE full_name LIKE 'Stamp %'`).catch(() => {});
  await db.pool?.end?.().catch?.(() => {});
});
