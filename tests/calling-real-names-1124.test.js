'use strict';

/**
 * Real names for the people we call (Arthur, 24 Nov 2026). Every name and
 * number here is made up.
 *
 * The call list showed where a number was found as its name ("tiktok.com",
 * "WhatsApp enquirer", "Unnamed"), the Interested box was filled in with it,
 * and ten agent profiles opened that day under names like that. Their Hi
 * would have been answered "Hi tiktok.com!".
 *
 * - Such a name is never saved: the caller is reminded on the call, and a call
 *   that goes on cannot be saved without the name they gave.
 * - Profiles already saved like that are on Housekeeping, "Name to fix", and
 *   in a message from King on the caller's dashboard every morning.
 * - Their Hi gets a kind hello and waits; saving the name approves them.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../config/database');
const names = require('../services/callingNames');
const followThrough = require('../services/callingFollowThrough');
const hub = require('../services/teamHub');
const sandbox = require('../services/callingSandbox');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const AGENT_ID = '0e0e0e0e-0000-4000-8000-000000000031';
const PHONE = '+256700000131';
const RONALD_USER = '0e0e0e0e-0000-4000-8000-0000000000aa';

const NOT_NAMES = ['tiktok.com', 'Unnamed', 'WhatsApp enquirer', 'WhatsApp property seeker', 'Soil Vendor', 'Bolt', 'N/A', 'Mr', '@testcohomes', '0700000199', 'Property Dealer', '', 'A'];
const NAMES = ['Testa', 'Testina', 'Sarah Testname', 'T K property dealers', 'Testara property', 'Brightway', 'TESTQ maids', 'Bolt Real Estate (Testname)', 'Testco Homes Ltd'];

test('where we found them, a stand-in, or what they do is never a name', () => {
  for (const name of NOT_NAMES) assert.ok(names.nameProblem(name), JSON.stringify(name));
  for (const name of NAMES) assert.strictEqual(names.nameProblem(name), '', name);
  assert.strictEqual(names.nameProblem('tiktok.com'), '"tiktok.com" is where we found them, not their name.');
  assert.strictEqual(names.nameProblem('Unnamed'), '"Unnamed" is not a name.');
  assert.strictEqual(names.nameProblem('Soil Vendor'), '"Soil Vendor" says what they do, not who they are.');
  assert.match(names.ASK, /What name should we put on your makaug page/);
});

test('nobody is greeted by one, whatever the message: they get the fallback', () => {
  const greeting = require('../services/agentNameService');
  assert.strictEqual(greeting.agentGreetingName({ full_name: 'tiktok.com' }, ''), '');
  assert.strictEqual(greeting.agentGreetingName({ full_name: 'WhatsApp enquirer', greeting_name: 'WhatsApp enquirer' }, 'there'), 'there');
  assert.strictEqual(greeting.agentGreetingName({ full_name: 'Bolt' }, 'there'), 'there');
  assert.strictEqual(greeting.agentGreetingName({ full_name: 'Testa Testname', greeting_name: 'Unnamed' }, ''), 'Testa', 'their own name, when the greeting name is a stand-in');
  assert.strictEqual(greeting.agentGreetingName({ full_name: 'Testco Property Services Ltd', greeting_name: 'Testco Property Services Ltd' }, ''), 'Testco');
  const route = require('../routes/whatsapp').__test;
  assert.match(route.pendingAgentHelloReply({ full_name: 'tiktok.com' }), /^👋 Hello there, thanks for saying hi!/);
  // "the makaug team" starts a sentence with a capital.
  assert.match(followThrough.heldHelloText('the makaug team'), /^Hi! 👋 Welcome to makaug\.com\. The makaug team told us you would say Hi\.\n\nThe makaug team will be in touch shortly/);
});

test('the calling screen checks names the same way, with the server\'s word lists', () => {
  const client = read('assets/calling-screen.js');
  const start = client.indexOf('function nameProblem(n) {');
  const end = client.indexOf('function firstName(n)', start);
  assert.ok(start > 0 && end > start);
  const nameProblem = new Function('boot', `${client.slice(start, end)}; return nameProblem;`)({ name_words: names.WORDS });
  for (const name of [...NOT_NAMES, ...NAMES]) assert.strictEqual(nameProblem(name), names.nameProblem(name), JSON.stringify(name));
  // The script and texts never say "Hi tiktok.com".
  assert.match(client, /function firstName\(n\) \{ if \(nameProblem\(n\)\) return '';/);
  // On the call: reminded, and the box is never filled in with such a name.
  assert.match(client, /No name for this number yet\.<\/b> ' \+ esc\(nameProblem\(a\.name\) \|\| a\.name_problem\) \+ ' Ask who you are speaking with: you can\\'t save the call without their name\./);
  assert.match(client, /if \(w\.shownName == null\) w\.shownName = nameProblem\(a\.name\) \? '' : \(a\.name \|\| ''\);/);
  assert.match(client, /contact_name: \(needsName\(task, o\) \|\| nameRequired\(task, o\)\) \? String\(w\.shownName \|\| ''\)\.trim\(\) : undefined/);
  assert.match(client, /api\('\/housekeeping\/name', \{ method: 'POST', body: \{ person_key: S\.person, key: key, name: name \} \}\)/);
  // Browsers load the new screen, not yesterday's.
  assert.match(read('index.html'), /callingScript\.src = "\/assets\/calling-screen\.js\?v=20261124-realnames1";/);
});

test('a call that goes on is not saved without a real name; the name given replaces the list\'s', () => {
  const screen = read('services/callingScreen.js');
  assert.match(screen, /const shownProblem = newAgentInterested \? \(callingNames\.nameProblem\(contactName\) \|\| callingNames\.nameProblem\(shownName\)\) : '';\n\s+if \(shownProblem\) throw httpError\(400, `\$\{shownProblem\} \$\{callingNames\.ASK\}`\);/);
  assert.match(screen, /const nameNeeded = !newAgentInterested && Boolean\(listNameProblem\) && rules\.FOLLOW_UP_OUTCOMES\.has\(def\.key\);/);
  assert.match(screen, /UPDATE agent_prospects SET full_name = \$2, updated_at = NOW\(\) WHERE phone_key = \$1', \[out\.phone_key, givenName\]/);
  assert.match(screen, /name_words: callingNames\.WORDS,\n\s+name_needed_outcomes: \[\.\.\.rules\.FOLLOW_UP_OUTCOMES\],/);
  const screenModule = require('../services/callingScreen');
  assert.strictEqual(screenModule.maskedAttempt({ full_name: 'tiktok.com', phone: PHONE }).name_problem, '"tiktok.com" is where we found them, not their name.');
  assert.strictEqual(screenModule.maskedAttempt({ full_name: 'Testa', phone: PHONE }).name_problem, null);
});

/** A database for one pending calling profile, and what was asked of it. */
function fakeDb({ fullName = 'tiktok.com', heldAt = null, status = 'pending' } = {}) {
  const calls = [];
  const state = { status, fullName, heldAt };
  const query = async (sql, params = []) => {
    const text = String(sql);
    calls.push({ sql: text, params });
    if (/FROM agents WHERE removed_at IS NULL AND status = 'pending' AND agent_application_channel/.test(text)) {
      return { rows: state.status === 'pending' ? [{ id: AGENT_ID, full_name: state.fullName, whatsapp: PHONE, phone: PHONE, status: state.status, agent_application_channel: 'calling_interested' }] : [] };
    }
    if (/FROM call_attempts/.test(text) && /outcome = ANY/.test(text)) return { rows: [{ id: 'call-1', person_key: 'ronald', callback_at: null, checklist: {} }] };
    if (/SELECT first_name FROM users/.test(text)) return { rows: [{ first_name: 'Ronald' }] };
    if (/SELECT metadata FROM agent_prospects/.test(text)) return { rows: [{ metadata: state.heldAt ? { held_for_name_at: state.heldAt, said_hi_via: 'whatsapp' } : {} }] };
    if (/SELECT \* FROM agents WHERE id = \$1/.test(text)) return { rows: [{ id: AGENT_ID, full_name: state.fullName, whatsapp: PHONE, phone: PHONE, status: state.status, agent_application_channel: 'calling_interested' }] };
    if (/^UPDATE agents SET full_name = \$2/.test(text.trim())) {
      state.fullName = params[1];
      return { rows: [{ id: AGENT_ID, full_name: params[1], whatsapp: PHONE, phone: PHONE, status: state.status, agent_application_channel: 'calling_interested' }] };
    }
    if (/UPDATE agents SET status = 'approved'/.test(text)) {
      state.status = 'approved';
      return { rows: [{ id: AGENT_ID, full_name: state.fullName, greeting_name: state.fullName, whatsapp: PHONE, status: 'approved' }] };
    }
    return { rows: [] };
  };
  return { calls, state, query };
}

async function withFakes(fake, run) {
  const saved = { query: db.query, send: hub.send, people: hub.staffPeople };
  const sent = [];
  db.query = fake.query;
  hub.send = async (input, opts) => { sent.push({ input, opts }); return { id: sent.length }; };
  hub.staffPeople = async () => [{ user_id: RONALD_USER, name: 'Ronald', person_key: 'ronald' }];
  try {
    return await run(sent);
  } finally {
    db.query = saved.query;
    hub.send = saved.send;
    hub.staffPeople = saved.people;
  }
}

test('their Hi under a name that isn\'t theirs gets a kind hello, waits, and the caller is told on the dashboard', async () => {
  const fake = fakeDb({ fullName: 'tiktok.com' });
  await withFakes(fake, async (sent) => {
    const hello = await followThrough.onHello({ phone: PHONE, body: 'Hello', via: 'whatsapp', now: new Date('2026-11-24T17:05:00Z') });
    assert.strictEqual(hello.held, true);
    assert.strictEqual(hello.agent, null);
    assert.strictEqual(hello.message, 'Hi! 👋 Welcome to makaug.com. Ronald told us you would say Hi.\n\nRonald will be in touch shortly to finish setting up your agent account.');
    assert.doesNotMatch(hello.message, /tiktok/i);
    assert.ok(!fake.calls.some((c) => /UPDATE agents SET status = 'approved'/.test(c.sql)), 'not approved');
    assert.ok(fake.calls.some((c) => /held_for_name_at/.test(c.sql)), 'the hello is kept');
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].input.audience, 'person');
    assert.strictEqual(sent[0].input.to_user_id, RONALD_USER);
    assert.strictEqual(sent[0].input.title, 'Said Hi, needs a name: •••131');
    assert.match(sent[0].input.body, /under "tiktok\.com", which isn't their name/);
    assert.match(sent[0].input.body, /🧹 Housekeeping → Name to fix/);
    assert.strictEqual(sent[0].opts.actor, 'King');
  });
  // A second hello the same day: no second hello back, and no second message.
  const again = fakeDb({ fullName: 'tiktok.com', heldAt: '2026-11-24T17:05:00.000Z' });
  await withFakes(again, async (sent) => {
    const hello = await followThrough.onHello({ phone: PHONE, body: 'Hi', via: 'whatsapp', now: new Date('2026-11-24T18:00:00Z') });
    assert.strictEqual(hello.held, true);
    assert.strictEqual(hello.message, '');
    assert.strictEqual(sent.length, 0);
  });
});

test('a real name is approved on Hi, as before', async () => {
  const fake = fakeDb({ fullName: 'Testa' });
  await withFakes(fake, async (sent) => {
    const hello = await followThrough.onHello({ phone: PHONE, body: 'Hello', via: 'whatsapp', now: new Date('2026-11-24T17:05:00Z') });
    assert.ok(hello.agent);
    assert.match(hello.message, /^Hi Testa! 👋 Welcome to makaug\.com\. Ronald told us you would say Hi\./);
    assert.ok(fake.calls.some((c) => /UPDATE agents SET status = 'approved'/.test(c.sql)));
    assert.strictEqual(sent.length, 0);
  });
});

test('saving the real name: refused for another stand-in, approves a Hi that waited', async () => {
  const fake = fakeDb({ fullName: 'tiktok.com', heldAt: '2026-11-24T17:05:00.000Z' });
  await withFakes(fake, async () => {
    await assert.rejects(followThrough.fixProfileName({ agentId: AGENT_ID, name: 'tiktok' }), (error) => {
      assert.strictEqual(error.status, 400);
      assert.match(error.message, /is where we found them, not their name\. Ask them: "What name should we put on your makaug page/);
      return true;
    });
    const out = await followThrough.fixProfileName({ agentId: AGENT_ID, name: 'Testa Testname', by: 'ronald', now: new Date('2026-11-25T06:10:00Z') });
    assert.deepStrictEqual(out, { agent_id: AGENT_ID, name: 'Testa Testname', approved: true });
    assert.strictEqual(fake.state.fullName, 'Testa Testname');
    assert.ok(fake.calls.some((c) => /UPDATE agent_prospects SET full_name = \$2/.test(c.sql)), 'the call list takes the name');
    assert.ok(fake.calls.some((c) => /UPDATE call_attempts SET full_name = \$2 WHERE phone_key = \$1/.test(c.sql)));
    assert.ok(fake.calls.some((c) => /UPDATE team_messages SET withdrawn_at = NOW\(\) WHERE title = \$1/.test(c.sql) && c.params[0] === 'Said Hi, needs a name: •••131'), 'the note that their Hi was waiting goes');
  });
  // Not said Hi yet: the name is saved, and the Hi will approve them.
  const quiet = fakeDb({ fullName: 'Unnamed' });
  await withFakes(quiet, async () => {
    const out = await followThrough.fixProfileName({ agentId: AGENT_ID, name: 'Testina' });
    assert.strictEqual(out.approved, false);
    assert.ok(!quiet.calls.some((c) => /UPDATE agents SET status = 'approved'/.test(c.sql)));
  });
});

test('Housekeeping lists the names to fix first, and a practice login cannot change one', async () => {
  const planner = require('../services/callingPlanner');
  const savedQuery = db.query;
  const savedSandbox = sandbox.isSandbox;
  db.query = async (sql) => {
    if (/agent_application_channel = 'calling_interested'/.test(String(sql))) {
      return { rows: [{ id: AGENT_ID, full_name: 'tiktok.com', whatsapp: PHONE, phone: PHONE, said_hi_at: '2026-11-24T17:05:00Z', person_key: 'ronald', note: 'Wants to meet first', wrapped_at: '2026-11-24T08:44:00Z' }] };
    }
    return { rows: [] };
  };
  sandbox.isSandbox = async (key) => key === 'practice';
  try {
    const hk = await planner.housekeeping('ronald');
    assert.strictEqual(hk.items[0].key, `name:${AGENT_ID}`);
    assert.strictEqual(hk.items[0].kind, 'name');
    assert.strictEqual(hk.items[0].title, 'Name to fix: "tiktok.com"');
    assert.match(hk.items[0].detail, /^Said Hi and is waiting for you\. "tiktok\.com" is where we found them, not their name\./);
    assert.strictEqual(hk.items[0].said_hi, true);
    await assert.rejects(planner.fixName('practice', { key: `name:${AGENT_ID}`, name: 'Testa' }), /Practice logins cannot change a real profile/);
    await assert.rejects(planner.fixName('ronald', { key: 'id:123', name: 'Testa' }), /Pick a name to fix/);
  } finally {
    db.query = savedQuery;
    sandbox.isSandbox = savedSandbox;
  }
  const routes = read('routes/calling.js');
  assert.match(routes, /router\.post\('\/calling\/housekeeping\/name', wrap\(async \(req, res\) => \{/);
  assert.match(routes, /if \(out\.approved\) \{\n\s+setImmediate\(\(\) => \{\n\s+require\('\.\/admin'\)\.runAgentApprovalFollowUps\(\{ agentId: out\.agent_id, wasApproved: true, actor: 'calling_name_fixed' \}\)/);
});

test('every morning, each caller\'s names to fix arrive as a message from King on their dashboard', async () => {
  const body = names.digestBody([
    { full_name: 'tiktok.com', whatsapp: PHONE, said_hi_at: '2026-11-24T17:05:00Z', note: 'Wants to meet first', wrapped_at: '2026-11-24T08:44:00Z' },
    { full_name: 'Unnamed', phone: '+256700000132', note: 'Asked for details on WhatsApp first.', wrapped_at: '2026-11-24T09:35:00Z' }
  ]);
  assert.match(body, /^These 2 agents were saved from your calls under a name that isn't theirs/);
  assert.match(body, /• tiktok\.com · •••131 · said Hi, waiting for you · "Wants to meet first" \(24 Nov\)/);
  assert.match(body, /• Unnamed · •••132 · "Asked for details on WhatsApp first\." \(24 Nov\)/);
  assert.match(body, /🧹 Housekeeping → Name to fix/);
  assert.match(body, /On the calling list, a number with no real name \(tiktok\.com and the like\) is flagged on its call card: ask who you are speaking with\. A call that goes on \(interested, a call back…\) can't be saved without their name\.$/);
  assert.doesNotMatch(body, /\+?256700000131/, 'never the whole number');

  const calls = [];
  const fake = {
    query: async (sql, params = []) => {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (/agent_application_channel = 'calling_interested'/.test(text)) {
        return { rows: [{ id: AGENT_ID, full_name: 'tiktok.com', whatsapp: PHONE, person_key: 'ronald' }, { id: 'x2', full_name: 'Testa', whatsapp: '+256700000133', person_key: 'ronald' }] };
      }
      if (/SELECT id FROM team_messages/.test(text)) return { rows: [] };
      return { rows: [] };
    }
  };
  const sent = [];
  const fakeHub = {
    staffPeople: async () => [{ user_id: RONALD_USER, name: 'Ronald', person_key: 'ronald' }],
    send: async (input, opts) => { sent.push({ input, opts }); return { id: 7 }; }
  };
  const out = await names.sendDailyDigest({ dbc: fake, now: new Date('2026-11-25T04:31:00Z'), hub: fakeHub });
  assert.strictEqual(out.profiles, 1, 'Testa is a name');
  assert.strictEqual(sent.length, 1);
  assert.deepStrictEqual({ audience: sent[0].input.audience, to: sent[0].input.to_user_id, title: sent[0].input.title, actor: sent[0].opts.actor },
    { audience: 'person', to: RONALD_USER, title: 'Names to fix before they say Hi', actor: 'King' });
  assert.match(sent[0].input.body, /^This agent was saved from your calls/);
  assert.ok(calls.some((c) => /UPDATE team_messages SET withdrawn_at = NOW\(\)/.test(c.sql) && c.params[1] === '2026-11-25'), 'yesterday\'s list makes way for today\'s');
  // Already sent today: not again.
  const once = { query: async (sql, params) => (/SELECT id FROM team_messages/.test(String(sql)) ? { rows: [{ id: 7 }] } : fake.query(sql, params)) };
  sent.length = 0;
  await names.sendDailyDigest({ dbc: once, now: new Date('2026-11-25T06:00:00Z'), hub: fakeHub });
  assert.strictEqual(sent.length, 0);

  assert.match(read('server.js'), /require\('\.\/services\/callingNames'\)\.startNameDigest\(\);/);
  assert.match(read('services/callingNames.js'), /if \(local\.getUTCHours\(\) \* 60 \+ local\.getUTCMinutes\(\) < 7 \* 60 \+ 30\) return;/, 'from 07:30 Kampala');
});

test('on WhatsApp a Hi that waits is answered once and the chat is not made an agent\'s', () => {
  const runtime = read('routes/whatsapp.js');
  assert.match(runtime, /if \(calledHello\?\.held\) \{[\s\S]{0,600}return \{ message: calledHello\.message \|\| '', nextStep: sessionStep \};\n\s+\}\n\s+if \(calledHello\?\.message && calledHello\.agent\) \{/);
});
