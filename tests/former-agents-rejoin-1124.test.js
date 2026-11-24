'use strict';

/**
 * Agents taken off makaug, and the way back (24 Nov 2026).
 *
 * An agent removed one evening for not paying still got the next morning's
 * Morning Brief, queued the afternoon before. He then sent a plot and its
 * photos: he was answered with a lecture on land safety and the menu, his
 * photos were kept without a word, and nobody on the team heard. He had never
 * been told he was removed.
 *
 * Arthur: be kind, say the properties were taken down and that we would be
 * happy to have them back, and that coming back brings back every property
 * they had. When they pay, restore them automatically.
 *
 * Every name and number here is made up.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../config/database');
const billing = require('../services/billingOpsService');
const goodbye = require('../services/agentGoodbyeService');
const route = require('../routes/whatsapp').__test;

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const AGENT_ID = '0e0e0e0e-0000-4000-8000-000000000001';

const removedFor = (code, extra = {}) => ({
  id: AGENT_ID,
  full_name: 'Test Agent',
  phone: '+256700000091',
  whatsapp: '+256700000091',
  status: 'suspended',
  removed_at: new Date(Date.now() - 16 * 3600e3).toISOString(),
  removed_reason: goodbye.removalReason(code).label,
  removal_snapshot: { reason_code: code, previous_status: 'approved', listings: [{ id: 'p1', previous_status: 'approved' }, { id: 'p2', previous_status: 'approved' }, { id: 'p3', previous_status: 'pending' }], login_closed: true },
  ...extra
});

test('who may come back by paying: removed for not paying, or after leaving', () => {
  assert.strictEqual(goodbye.removalCode(removedFor('not_paying')), 'not_paying');
  assert.strictEqual(goodbye.canRejoin(removedFor('not_paying')), true);
  assert.strictEqual(goodbye.canRejoin(removedFor('cancelled')), true);
  for (const code of ['rules', 'duplicate', 'other']) assert.strictEqual(goodbye.canRejoin(removedFor(code)), false, code);
  // Read from the reason text when the snapshot has no code.
  assert.strictEqual(goodbye.removalCode({ removed_at: 'x', removed_reason: 'Has not paid yet — chased twice', removal_snapshot: {} }), 'not_paying');
  assert.strictEqual(goodbye.canRejoin({ removed_at: null, removal_snapshot: { reason_code: 'not_paying' } }), false, 'not removed');
});

test('the note to a removed agent is kind, says what came down, and how everything comes back', () => {
  const howToPay = billing.momoHowToPay({ amountUgx: 50000 });
  const plot = billing.rejoinMessage({ agent: { full_name: 'Test Agent' }, fee: 50000, payLink: 'https://makaug.com/pay/MKTEST01', howToPay, sentThing: 'plot' });
  assert.match(plot, /^Hi Test, thank you for sending this plot, and for all the properties you've shared with makaug\. 🙏/);
  assert.match(plot, /Because the monthly agent plan \(UGX 50,000\) wasn't paid, we've had to take your listings down for now, and new ones can't go up yet\. We understand things come up, and we'd be really happy to have you back whenever you're ready\./);
  assert.match(plot, /To rejoin, pay UGX 50,000 here: https:\/\/makaug\.com\/pay\/MKTEST01/);
  assert.match(plot, /Merchant Code/);
  assert.match(plot, /As soon as it's in, your profile and all your previous properties go straight back up, and the plot you've just sent goes to our team for review\. You won't need to send anything again\./);
  assert.match(plot, /Phillip, MakaUG$/);
  // The notice at removal, or a hello: nothing about something they sent.
  const notice = billing.rejoinMessage({ agent: { full_name: 'Test Agent' }, fee: 50000, payLink: 'https://makaug.com/pay/MKTEST01', howToPay });
  assert.match(notice, /^Hi Test, thank you for all the properties you've shared with makaug\./);
  assert.doesNotMatch(notice, /just sent|can't go up yet/);
  assert.match(notice, /your profile and all your previous properties go straight back up\./);
  // Somebody who chose to leave is not told they did not pay.
  const left = billing.rejoinMessage({ agent: { full_name: 'Test Agent' }, fee: 50000, payLink: 'https://makaug.com/pay/MKTEST01', howToPay, left: true });
  assert.match(left, /When you left makaug we took your listings down/);
  assert.doesNotMatch(left, /wasn't paid/);
});

test('the welcome back is the one Arthur approved', () => {
  const text = billing.welcomeBackMessage({ agent: { full_name: 'Moses Testname', paid_until: '2026-12-24' }, amountUgx: 50000, restored: 3, imported: 1 });
  assert.strictEqual(text, [
    'Welcome back, Moses! 🎉 Your payment of UGX 50,000 is in, and your plan runs to 24 Dec 2026.',
    '',
    "Your profile and your 3 properties are back on makaug, and the 1 property you sent while you were away is with our team for review. We'll let you know as soon as it's live.",
    '',
    'Thank you for coming back.',
    '',
    'Phillip, MakaUG'
  ].join('\n'));
  assert.match(billing.welcomeBackMessage({ agent: { full_name: 'Test Agent' }, restored: 0, imported: 0 }), /Your profile is back on makaug\./);
});

test('the team hears that the removal note went', () => {
  const alert = goodbye.buildRemovalAlert({ agent: { full_name: 'Test Agent' }, reason: goodbye.removalReason('not_paying'), listingsHidden: 3, rejoinNote: true });
  assert.match(alert, /• They were sent a kind note with their payment link; when they pay, everything comes back by itself/);
  assert.doesNotMatch(alert, /Nothing was sent to them/);
});

function fakeDb(rows = {}) {
  const calls = [];
  const query = async (sql, params = []) => {
    const text = String(sql);
    calls.push({ sql: text, params });
    if (/FROM agents\s+WHERE RIGHT\(REGEXP_REPLACE\(COALESCE\(whatsapp/i.test(text)) return { rows: rows.agents || [] };
    return { rows: [] };
  };
  return { calls, query };
}

async function withDb(fake, run) {
  const original = db.query;
  db.query = fake.query;
  try { return await run(); } finally { db.query = original; }
}

test('a removed agent who sends a property gets the kind note, once a day; the team hears', async () => {
  const sent = [];
  const originalSend = billing.sendRejoinMessage;
  billing.sendRejoinMessage = async (_db, args) => { sent.push(args); return { status: 'queued' }; };
  try {
    const fresh = fakeDb({ agents: [removedFor('not_paying', { removal_snapshot: { reason_code: 'not_paying', listings: [] } })] });
    const reply = await withDb(fresh, () => route.removedAgentReply({ phone: '256700000091', body: 'Plot for sale in Kira 50x100 at 45m with a land title', hasMedia: true }));
    assert.deepStrictEqual(reply, { message: '', silent: true });
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].sentThing, 'plot');
    // Within a day of the last note: kept quietly.
    const recent = fakeDb({ agents: [removedFor('not_paying', { removal_snapshot: { reason_code: 'not_paying', rejoin_sent_at: new Date(Date.now() - 3600e3).toISOString() } })] });
    const quiet = await withDb(recent, () => route.removedAgentReply({ phone: '256700000091', body: 'Hello', hasMedia: false }));
    assert.deepStrictEqual(quiet, { message: '', silent: true });
    assert.strictEqual(sent.length, 1, 'no second note the same day');
  } finally {
    billing.sendRejoinMessage = originalSend;
  }
});

test('removed for breaking the rules: not invited back, the usual conversation goes on', async () => {
  const sent = [];
  const originalSend = billing.sendRejoinMessage;
  billing.sendRejoinMessage = async (_db, args) => { sent.push(args); return { status: 'queued' }; };
  try {
    const fake = fakeDb({ agents: [removedFor('rules', { id: '0e0e0e0e-0000-4000-8000-000000000002' })] });
    const reply = await withDb(fake, () => route.removedAgentReply({ phone: '256700000092', body: 'Hello', hasMedia: false }));
    assert.strictEqual(reply, null);
    assert.strictEqual(sent.length, 0);
    // A number that still belongs to a working agent is not a former agent's.
    const shared = fakeDb({ agents: [{ ...removedFor('not_paying'), removed_at: null, status: 'approved' }, removedFor('not_paying')] });
    assert.strictEqual(await withDb(shared, () => route.findRemovedAgentByPhone('256700000091')), null);
  } finally {
    billing.sendRejoinMessage = originalSend;
  }
});

test('restoring a removal puts the listings, the login and the agent back', async () => {
  const calls = [];
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (/FROM agents WHERE id = \$1 FOR UPDATE/.test(text)) return { rows: [{ ...removedFor('not_paying'), user_id: 'u1' }] };
      if (/UPDATE properties SET status = \$2/.test(text)) return { rows: [{ id: params[0] }] };
      if (/UPDATE users SET status = 'active'/.test(text)) return { rows: [{ id: 'u1' }] };
      return { rows: [] };
    }
  };
  const restored = await goodbye.restoreRemovedAgent(client, AGENT_ID);
  assert.strictEqual(restored.listingsRestored, 3);
  assert.strictEqual(restored.loginReopened, true);
  const agentUpdate = calls.find((c) => /UPDATE agents SET removed_at = NULL/.test(c.sql));
  assert.deepStrictEqual(agentUpdate.params, [AGENT_ID, 'approved']);
  assert.deepStrictEqual(calls.filter((c) => /UPDATE properties/.test(c.sql)).map((c) => c.params), [['p1', 'approved'], ['p2', 'approved'], ['p3', 'pending']]);
});

test('nothing still queued for a removed agent goes, by their number', async () => {
  const calls = [];
  const stopped = await goodbye.cancelQueuedForFormerAgent({ query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ id: 'q1' }, { id: 'q2' }] }; } }, { whatsapp: '+256700000091', phone: '0700000091' });
  assert.strictEqual(stopped, 2);
  assert.match(calls[0].sql, /SET status = 'failed',\s+last_error = 'agent_removed'/);
  assert.deepStrictEqual(calls[0].params, [['700000091']]);
});

test('a removed agent\'s payment receipt is read as one', async () => {
  const fake = fakeDb();
  fake.query = async (sql) => (/FROM agents/.test(String(sql)) ? { rows: [{ ...removedFor('not_paying'), paid_until: null, fee_exempt: false, billing_suspended_at: null }] } : { rows: [] });
  const ctx = await billing.expectingPaymentFrom(fake, '256700000091');
  assert.ok(ctx && ctx.agent, 'we are waiting on their payment');
});

test('payment brings back an agent removed for not paying, and not one removed for the rules', async () => {
  const restoreCalls = [];
  const originalRestore = goodbye.restoreRemovedAgent;
  goodbye.restoreRemovedAgent = async (_client, id) => { restoreCalls.push(id); return { listingsRestored: 3, agent: {}, snapshot: {} }; };
  const client = { query: async () => ({ rows: [] }), release() {} };
  const fake = {
    agent: removedFor('not_paying'),
    async query(sql) {
      if (/FROM agents WHERE id = \$1::uuid/.test(String(sql))) return { rows: [this.agent] };
      return { rows: [] };
    },
    async getClient() { return client; }
  };
  fake.query = fake.query.bind(fake);
  try {
    const back = await billing.reinstateAgentAfterPayment(fake, { agentId: AGENT_ID, actor: 'test', amountUgx: 50000 });
    assert.strictEqual(back.reinstated, true);
    assert.strictEqual(back.rejoined, true);
    assert.deepStrictEqual(restoreCalls, [AGENT_ID]);
    fake.agent = removedFor('rules');
    const notBack = await billing.reinstateAgentAfterPayment(fake, { agentId: AGENT_ID, actor: 'test' });
    assert.deepStrictEqual(notBack, { reinstated: false, reason: 'removed' });
    assert.strictEqual(restoreCalls.length, 1);
  } finally {
    goodbye.restoreRemovedAgent = originalRestore;
  }
});

test('wired in: removal stops the queue and sends the note; every payment path brings them back', () => {
  const admin = read('routes/admin.js');
  const remove = admin.slice(admin.indexOf("router.post('/agents/:id/remove'"), admin.indexOf("router.post('/agents/:id/removal-request'"));
  assert.match(remove, /result\.queued_messages_stopped = await agentGoodbye\.cancelQueuedForFormerAgent\(db, agent\);/);
  assert.match(remove, /if \(reason\.code === 'not_paying'\) \{[\s\S]{0,200}billingOps\.sendRejoinMessage\(db, \{ agentId: agent\.id, actor \}\)/);
  assert.match(admin, /const restored = await agentGoodbye\.restoreRemovedAgent\(client, req\.params\.id\);/);
  assert.match(read('services/payLinkService.js'), /if \(agent\?\.billing_suspended_at \|\| agent\?\.removed_at\) recorded\.reinstatement = await billingOps\.reinstateAgentAfterPayment/);
  assert.match(read('services/billingOpsService.js'), /if \(agent\.billing_suspended_at \|\| agent\.removed_at\) result\.reinstatement = await reinstateAgentAfterPayment/);
  assert.match(read('services/adminManagerPaymentService.js'), /agent\.removed_at && !require\('\.\/agentGoodbyeService'\)\.canRejoin\(agent\)/);
  const whatsapp = read('routes/whatsapp.js');
  const paused = whatsapp.indexOf('const pausedReply = await billingPausedAgentReply(');
  const former = whatsapp.indexOf('const formerAgent = await removedAgentReply({');
  const intake = whatsapp.indexOf('const employeeIntake = await handleEmployeeWhatsappIntake({');
  assert.ok(paused > 0 && former > paused && intake > former, 'answered before Agent 007 can take their photos');
  assert.match(read('assets/makaug-app.js'), /code: "not_paying", label: "Has not paid yet", does: "Listings and profile off, login closed\. They get a kind note with their payment link; when they pay, everything comes back by itself\." \}/);
});
