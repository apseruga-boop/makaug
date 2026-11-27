'use strict';

/**
 * The number writes only to people who have written to it lately (20 Nov 2026).
 *
 * Since 16 Nov it wrote only to people who had written to it at some time. On
 * 17 Nov it was restricted for six hours straight after the agents' Morning
 * Brief, and on 20 Nov at 07:18 straight after a payment link a member of
 * staff sent from Agent 007. Both times the last message went to the same
 * agent: he had written once, on 26 Oct, and had answered none of the 28
 * messages sent to him since.
 *
 * So "has written" now means in the last seven days, for every message the
 * number sends. A member of staff who sends somebody quieter than that is told
 * so, in their own chat, with a link to send the person, instead of "sent".
 *
 * Every name and number here is made up.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const db = require('../config/database');
const bridge = require('../services/whatsappWebBridgeService');
const payLinks = require('../services/payLinkService');
const welcome = require('../services/agentWelcomeService');
const route = require('../routes/whatsapp').__test;

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function withFakeDb(reply, run) {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    return reply(String(sql), params) || { rows: [] };
  };
  return Promise.resolve(run(calls)).finally(() => { db.query = originalQuery; });
}

function withEnv(values, run) {
  const saved = {};
  for (const key of Object.keys(values)) {
    saved[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key]; else process.env[key] = values[key];
  }
  return Promise.resolve(run()).finally(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  });
}

const STAFF = '256700555201';
const OWNER = '447700900202';
const AGENT = '256700555203';

test('lately is seven days, unless WHATSAPP_WROTE_WITHIN_DAYS says otherwise', () => {
  assert.strictEqual(bridge.wroteWithinDays({}), 7);
  assert.strictEqual(bridge.wroteWithinDays({ WHATSAPP_WROTE_WITHIN_DAYS: '3' }), 3);
  for (const bad of ['0', '-2', '91', 'a week', '', '2.5x']) {
    assert.strictEqual(bridge.wroteWithinDays({ WHATSAPP_WROTE_WITHIN_DAYS: bad }), bad === '2.5x' ? 2 : 7, bad);
  }
});

test('"has written" means a message of theirs in the last seven days; an answer to a message of theirs still goes', () => {
  const sql = bridge.hasWrittenSql('q');
  const first = sql.slice(0, sql.indexOf('OR EXISTS'));
  const answer = sql.slice(sql.indexOf('OR EXISTS'));
  assert.match(first, /AND m\.created_at >= NOW\(\) - INTERVAL '7 days'/);
  // A reply to a message of theirs is not timed. An answer to a call is: it
  // goes while the call is fresh (27 Nov 2026, whatsapp-missed-call-answered-1127).
  const callWindow = /AND \(m\.message_type <> 'call' OR m\.created_at >= NOW\(\) - INTERVAL '2 hours'\)/;
  assert.match(answer, callWindow, 'an answer to a call goes within two hours of it');
  assert.doesNotMatch(answer.replace(callWindow, ''), /created_at/, 'a reply to their message is not timed');
  assert.match(answer, /m\.wa_message_id = q\.metadata->>'inbound_message_id'/);
  assert.match(bridge.hasWrittenSql('q', { days: 3 }), /INTERVAL '3 days'/);
  assert.match(bridge.hasWrittenSql('q', { days: "1'; DROP TABLE x; --" }), /INTERVAL '7 days'/, 'only a whole number reaches the SQL');
  assert.doesNotMatch(sql, /::uuid|::int/);
});

test('the hand-over to the bridge and the sweep both count the seven days', async () => {
  await withEnv({ WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE: 'on' }, () => withFakeDb(() => null, async (calls) => {
    await bridge.letGoOfWhatNobodyCameFor({ force: true });
    await bridge.claimWhatsappWebBridgeMessages({ clientId: 'makaug-waha-gows', limit: 5 });
    const sweep = calls.find((c) => /last_error = 'Not sent: they had not written to the makaug number lately\.'/.test(c.sql));
    assert.ok(sweep, 'the sweep ran');
    assert.match(sweep.sql, /AND NOT \(\s+EXISTS[\s\S]+INTERVAL '7 days'/);
    // A notice to staff that waited twelve hours is let go, so a quiet week does not end in a pile of old notices.
    assert.match(sweep.sql, /'\^\(agent_brief\|lead_handoff_\)\|_notice\$'/);
    const claim = calls.find((c) => /WITH claimable AS/i.test(c.sql));
    assert.match(claim.sql, /-- Only to somebody who has written to us, or in answer to them\.\s+AND \(NOT \$9::boolean OR \(\s+EXISTS[\s\S]+?INTERVAL '7 days'/);
  }));
});

test('whether somebody has written lately is asked with the seven days, and when it cannot be told, it waits', async () => {
  await withFakeDb(() => ({ rows: [{ ok: 1 }] }), async (calls) => {
    assert.strictEqual(await bridge.hasWrittenToUs(AGENT), true);
    assert.match(calls[0].sql, /AND created_at >= NOW\(\) - make_interval\(days => \$2\)/);
    assert.strictEqual(calls[0].params[1], 7);
  });
  await withEnv({ WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE: 'on' }, async () => {
    await withFakeDb(() => ({ rows: [] }), async () => {
      assert.strictEqual(await bridge.waitsForThem(AGENT), true, 'quiet for a week: it waits');
    });
    await withFakeDb(() => ({ rows: [{ ok: 1 }] }), async () => {
      assert.strictEqual(await bridge.waitsForThem(AGENT), false, 'wrote this week: it goes');
    });
    const originalQuery = db.query;
    db.query = async () => { throw new Error('no database'); };
    try {
      assert.strictEqual(await bridge.waitsForThem(AGENT), true);
    } finally {
      db.query = originalQuery;
    }
  });
  await withEnv({ WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE: 'off' }, () => withFakeDb(() => ({ rows: [] }), async (calls) => {
    assert.strictEqual(await bridge.waitsForThem(AGENT), false, 'with the rule off nothing waits');
    assert.strictEqual(calls.length, 0);
  }));
});

test('what the member of staff is told, in the words Arthur chose', () => {
  assert.strictEqual(
    bridge.notSentUntilTheyWrite({ name: 'Kato Test', what: 'payment link' }),
    [
      "⏸️ *Not sent — Kato hasn't written to makaug in the last 7 days.*",
      '',
      "WhatsApp blocks our number when we message people who haven't written to us.",
      '',
      'Ask Kato to message us first. Send them this link to tap and press send:',
      'https://wa.me/256780863394?text=Hi%20makaug',
      '',
      "The payment link is waiting and goes to them the moment they write. I'll tell you when it has gone."
    ].join('\n')
  );
  const notQueued = bridge.notSentUntilTheyWrite({ name: '', what: 'reminder', waiting: false });
  assert.match(notQueued, /^⏸️ \*Not sent — This person hasn't written to makaug in the last 7 days\.\*/);
  assert.match(notQueued, /Ask them to message us first\./);
  assert.match(notQueued, /Once they have written, send the reminder again from here and it goes straight away\.$/);
});

async function staffPayLink({ rule }) {
  const inserts = [];
  const saved = { create: payLinks.createPayLink, record: payLinks.recordPayLinkSent, page: payLinks.pageData };
  payLinks.createPayLink = async () => ({ url: 'https://makaug.com/pay/TESTLINK', link: { code: 'TESTLINK', amount_ugx: 50000 }, reused: false });
  payLinks.recordPayLinkSent = async () => ({});
  payLinks.pageData = async () => ({ amount_ugx: 50000 });
  try {
    return await withEnv({ WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE: rule, AI_CEO_OWNER_PHONES: `+${OWNER}` }, () => withFakeDb((sql, params) => {
      if (/INSERT INTO outbound_message_queue/.test(sql)) {
        inserts.push({ to: params[0], payload: JSON.parse(params[1]), metadata: JSON.parse(params[3]) });
        return { rows: [{ id: `q-${inserts.length}` }] };
      }
      return null; // nobody has written lately; nothing is paused or already queued
    }, async () => {
      const sent = await route.sendStaffPayLink({ name: 'Kato Test', phone: AGENT, agentId: 'agent-test-1', requestedBy: STAFF });
      return { sent, inserts };
    }));
  } finally {
    payLinks.createPayLink = saved.create;
    payLinks.recordPayLinkSent = saved.record;
    payLinks.pageData = saved.page;
  }
}

test('a payment link from Agent 007 to an agent who has not written lately waits, and staff are told so, not "sent"', async () => {
  const { sent, inserts } = await staffPayLink({ rule: 'on' });
  assert.strictEqual(sent.waiting_for_first_message, true);
  assert.strictEqual(sent.held_message, bridge.notSentUntilTheyWrite({ name: 'Kato Test', what: 'payment link' }));

  const link = inserts.find((row) => row.metadata.message_kind === 'agent_pay_link_staff_sent');
  assert.ok(link, 'the link is in the queue');
  assert.strictEqual(link.to, AGENT);
  assert.strictEqual(link.metadata.held_for_first_message, true);
  assert.strictEqual(link.metadata.agent_name, 'Kato Test');
  assert.deepStrictEqual(link.metadata.tell_when_sent, [STAFF, OWNER]);

  // The requester is answered in their own chat; the owner hears it too; nobody hears "sent".
  const notices = inserts.filter((row) => row.metadata.message_kind === 'agent_pay_link_staff_notice');
  assert.deepStrictEqual(notices.map((row) => row.to), [OWNER]);
  assert.match(notices[0].payload.text, /^⏸️ \*Not sent — Kato hasn't written to makaug in the last 7 days\.\*/);
  assert.ok(!inserts.some((row) => /Payment link sent/.test(row.payload.text)));
});

test('to an agent who has written lately, the payment link goes as before', async () => {
  const { sent, inserts } = await staffPayLink({ rule: 'off' });
  assert.strictEqual(sent.waiting_for_first_message, undefined);
  assert.strictEqual(sent.held_message, undefined);
  const link = inserts.find((row) => row.metadata.message_kind === 'agent_pay_link_staff_sent');
  assert.strictEqual(link.metadata.held_for_first_message, undefined);
  // Whoever asked is answered in their own chat (25 Nov 2026: Ronald was told
  // twice, nine seconds apart); the rest of the team gets the notice.
  const notices = inserts.filter((row) => row.metadata.message_kind === 'agent_pay_link_staff_notice');
  assert.deepStrictEqual(notices.map((row) => row.to), [OWNER]);
  assert.match(notices[0].payload.text, /^💳 \*Payment link sent\* — Kato Test/);
});

test('when the waiting payment link goes, the staff who were told hear that it has, and the agent does not', async () => {
  const told = [];
  const queue = async (message) => { told.push(message); return { id: 'n' }; };
  const row = {
    id: 'q-link',
    user_phone: AGENT,
    metadata: { message_kind: 'agent_pay_link_staff_sent', held_for_first_message: true, agent_name: 'Kato Test', pay_link_code: 'TESTLINK', tell_when_sent: [STAFF, OWNER, AGENT] }
  };
  assert.strictEqual(await welcome.tellTeamHeldWelcomeWent(row, { queue }), 2);
  assert.deepStrictEqual(told.map((m) => m.recipient), [STAFF, OWNER]);
  assert.strictEqual(told[0].text, '✅ *Kato Test has the payment link now.* They wrote to the makaug number, so it went out.');
  assert.strictEqual(told[0].metadata.reply_dedupe_key, `held_went:TESTLINK:${STAFF}`);
  // A link that never waited is not announced again.
  assert.strictEqual(await welcome.tellTeamHeldWelcomeWent({ ...row, metadata: { ...row.metadata, held_for_first_message: false } }, { queue }), 0);
});

test('every other way staff send something checks first, and says so instead of "sent"', () => {
  const source = read('routes/whatsapp.js');
  const owner = source.slice(source.indexOf('async function sendOwnerListingPayLink'), source.indexOf('async function staffMayMessage'));
  assert.ok(owner.indexOf('waitsForThem(to)') < owner.indexOf('payLinks.sendPayLink('), 'an owner\'s link is checked before it is sent');
  assert.match(owner, /notSentUntilTheyWrite\(\{ name: listing\.lister_name \|\| listing\.owner_name \|\| '', what: 'payment link', waiting: false \}\)/);
  const howTo = source.slice(source.indexOf('async function sendHowToFromStaff'), source.indexOf('async function handleEmployeeWhatsappIntake'));
  assert.ok(howTo.indexOf('waitsForThem(dialable)') < howTo.indexOf('sendHowToVideo('), 'so is a how-to video');
  assert.match(source, /\} else if \(await whatsappWebBridgeService\.waitsForThem\(row\.phone\)\) \{\s+const label = action\.key === 'final_reminder' \? 'final reminder' : 'reminder';/, 'and a reminder from the who-owes list');
  // The four ways Agent 007 sends an agent's payment link, and the two for an owner's, answer with what waits.
  assert.strictEqual((source.match(/sent\.held_message/g) || []).length, 10);

  // King: a reply typed in the inbox to somebody quiet says it waits.
  const admin = read('routes/admin.js');
  const reply = admin.slice(admin.indexOf("router.post('/whatsapp/conversations/:phone/reply'"), admin.indexOf("router.get('/whatsapp/messages'"));
  assert.match(reply, /const waitingForThem = queuedForBridge \? await bridgeRules\.waitsForThem\(phone\)\.catch\(\(\) => false\) : false;/);
  assert.match(reply, /waiting_for_first_message: waitingForThem,\s+\.\.\.\(waitingForThem \? \{ wrote_within_days: bridgeRules\.wroteWithinDays\(\), hello_link:/);
  const app = read('assets/makaug-app.js');
  assert.match(app, /if \(response\?\.data\?\.queued_for_bridge && response\?\.data\?\.waiting_for_first_message\) \{\s+toast\(adminReplyWaitsNote\(response\.data\)\);/);
  assert.match(app, /Not sent — they haven't written to makaug in the last \$\{days\} days\. WhatsApp blocks our number when we message people who haven't written to us\./);
  assert.match(read('assets/build/makaug-admin.min.js'), /haven't written to makaug in the last/, 'and the built bundle carries it');
});
