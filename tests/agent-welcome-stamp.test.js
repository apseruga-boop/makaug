// An agent is marked "welcomed" only once the messages are really queued.
// On 5 Oct, 10 agents were stamped as welcomed and then the server died during
// the video render: nothing was ever sent, and the catch-up skipped them.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AGENT_CARD_SECRET = process.env.AGENT_CARD_SECRET || 'welcome-stamp-test-secret';
process.env.VIDEO_RENDER_JOB_TIMEOUT_MS = '200';

const bridge = require('../services/whatsappWebBridgeService');
let queueBehaviour = 'ok';
const queued = [];
bridge.queueWhatsappWebBridgeMessage = async (message) => {
  if (queueBehaviour === 'fail') throw new Error('queue down');
  queued.push(message);
  return { id: `q-${queued.length}` };
};

const db = require('../config/database');
const videos = require('../services/agentReportVideoService');
const admin = require('../routes/admin');

async function makeAgent(label) {
  const phone = `+2567${String(Date.now()).slice(-8)}`;
  const row = (await db.query(
    `INSERT INTO agents (full_name, phone, whatsapp, email, licence_number, status, approved_at)
     VALUES ($1, $2, $2, $3, $4, 'approved', NOW()) RETURNING id`,
    [`Stamp ${label}`, phone, `stamp-${Date.now()}-${label}@example.com`, `STAMP-${Date.now()}-${label}`]
  )).rows[0];
  return row.id;
}

async function welcomedAt(id) {
  return (await db.query('SELECT welcome_sent_at FROM agents WHERE id = $1', [id])).rows[0].welcome_sent_at;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('render still running (or the process dies mid-render): not stamped', async () => {
  queueBehaviour = 'ok';
  videos._test.setRemoteLookup(async () => false);
  videos._test.setEncoder(() => new Promise(() => {})); // never finishes
  const id = await makeAgent('hang');
  const result = await admin.queueAgentWelcomePack({ agentId: id, actorId: 'test' });
  assert.equal(result.status, 'rendering');
  assert.equal(await welcomedAt(id), null);
});

test('render fails and nothing can be queued: welcome_sent_at stays NULL, no pay link', async () => {
  videos._test.setRemoteLookup(async () => false);
  videos._test.setEncoder(async () => { throw new Error('render failed'); });
  queueBehaviour = 'fail';
  let followed = false;
  const id = await makeAgent('fail');
  await admin.queueAgentWelcomePack({ agentId: id, actorId: 'test', afterQueued: () => { followed = true; } });
  await wait(300);
  assert.equal(await welcomedAt(id), null);
  assert.equal(followed, false, 'the pay link must not follow a welcome that never went');
});

test('render fails but the text welcome queues: stamped, then the follow-up runs', async () => {
  videos._test.setRemoteLookup(async () => false);
  videos._test.setEncoder(async () => { throw new Error('render failed'); });
  queueBehaviour = 'ok';
  let followed = false;
  const id = await makeAgent('text');
  await admin.queueAgentWelcomePack({ agentId: id, actorId: 'test', afterQueued: () => { followed = true; } });
  await wait(300);
  assert.notEqual(await welcomedAt(id), null);
  assert.equal(followed, true);
});

test('allowVideoRender: false sends without rendering', async () => {
  let renders = 0;
  videos._test.setRemoteLookup(async () => false);
  videos._test.setEncoder(async () => { renders += 1; });
  queueBehaviour = 'ok';
  const id = await makeAgent('norender');
  const result = await admin.queueAgentWelcomePack({ agentId: id, actorId: 'test', allowVideoRender: false });
  assert.equal(result.format, 'text');
  assert.equal(renders, 0);
  assert.notEqual(await welcomedAt(id), null);
});

test.after(async () => {
  videos._test.setEncoder(null);
  await db.query(`DELETE FROM agents WHERE full_name LIKE 'Stamp %'`).catch(() => {});
  await db.pool?.end?.().catch?.(() => {});
});
