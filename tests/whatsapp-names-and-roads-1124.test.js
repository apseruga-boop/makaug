'use strict';

/**
 * 24 Nov 2026, late. Every name and number here is made up.
 *
 * 1. Profiles opened on a call under "tiktok.com" or "Unnamed" waited for the
 *    caller to get a real name. Their WhatsApp profile usually has one, so
 *    their Hi is answered by it and they are approved there and then (Arthur:
 *    "we don't want to prolong the process"); the ones who wrote to us before
 *    take the name they wrote under. The caller is only asked when WhatsApp
 *    has no real name for them either.
 * 2. An agent typed a property, then sent its three photos and a video 14
 *    seconds later. The reply asked for photos 16 seconds after they arrived.
 * 3. "Kagoma Along bombo road" was asked which district Kagoma is in, of
 *    four. Bombo Road runs through one of them.
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
const greeting = require('../services/agentNameService');
const hub = require('../services/teamHub');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const AGENT_ID = '0e0e0e0e-0000-4000-8000-000000000041';
const PHONE = '+256700000141';

test('the name on a WhatsApp profile, when it is a name', () => {
  const cases = [
    ['Testa Faith Love  💕 🌹', 'Testa Faith Love'],
    ['MUMMY TESTINA', 'Mummy Testina'],
    ['Testembo', 'Testembo'],
    ['moses.testname', 'Moses Testname'],
    ['Sarah | Testco Homes', 'Sarah'],
    ['Sarah - Realtor', 'Sarah'],
    ['✨Testa✨', 'Testa'],
    ['Nakato❤️❤️', 'Nakato'],
    ['JB PROPERTIES', 'JB Properties'],
    ['Aunty Testina', 'Aunty Testina'],
    // A handle run together, a motto, a stand-in, what they do: not a name.
    ['testamosmukasa', ''],
    ['God is able', ''],
    ['Your trusted property partner', ''],
    ['Real Estate Agent Kira', ''],
    ['Boss Man', ''],
    ['Uncle', ''],
    ['tiktok.com', ''],
    ['WhatsApp enquirer', ''],
    ['Unknown', ''],
    ['🔥🔥', ''],
    ['+256 700 000 141', ''],
    ['', '']
  ];
  for (const [raw, want] of cases) assert.strictEqual(names.nameFromWhatsApp(raw), want, JSON.stringify(raw));
});

/** One pending calling profile under "tiktok.com", and what was asked of the database. */
function fakeDb({ stored = '', heldAt = null } = {}) {
  const calls = [];
  const state = { status: 'pending', fullName: 'tiktok.com' };
  const row = () => ({ id: AGENT_ID, full_name: state.fullName, greeting_name: state.fullName, whatsapp: PHONE, phone: PHONE, status: state.status, agent_application_channel: 'calling_interested' });
  const query = async (sql, params = []) => {
    const text = String(sql);
    calls.push({ sql: text, params });
    if (/FROM agents WHERE removed_at IS NULL AND status = 'pending' AND agent_application_channel/.test(text)) return { rows: state.status === 'pending' ? [row()] : [] };
    if (/FROM whatsapp_messages/.test(text)) return { rows: stored ? [{ push_name: stored }] : [] };
    if (/FROM call_attempts/.test(text) && /outcome = ANY/.test(text)) return { rows: [{ id: 'call-1', person_key: 'ronald', callback_at: null, checklist: {} }] };
    if (/SELECT first_name FROM users/.test(text)) return { rows: [{ first_name: 'Ronald' }] };
    if (/SELECT metadata FROM agent_prospects/.test(text)) return { rows: [{ metadata: heldAt ? { held_for_name_at: heldAt, said_hi_via: 'whatsapp' } : {} }] };
    if (/SELECT \* FROM agents WHERE id = \$1/.test(text)) return { rows: [row()] };
    if (/^UPDATE agents SET full_name = \$2/.test(text.trim())) {
      state.fullName = params[1];
      return { rows: [row()] };
    }
    if (/UPDATE agents SET status = 'approved'/.test(text)) {
      state.status = 'approved';
      return { rows: [row()] };
    }
    if (/agent_application_channel = 'calling_interested'/.test(text)) return { rows: [{ id: AGENT_ID, full_name: state.fullName, whatsapp: PHONE, person_key: 'ronald' }] };
    return { rows: [] };
  };
  return { calls, state, query };
}

async function withFakes(fake, run) {
  const saved = { query: db.query, send: hub.send, people: hub.staffPeople };
  const sent = [];
  db.query = fake.query;
  hub.send = async (input, opts) => { sent.push({ input, opts }); return { id: sent.length }; };
  hub.staffPeople = async () => [{ user_id: 'u-ronald', name: 'Ronald', person_key: 'ronald' }];
  try {
    return await run(sent);
  } finally {
    db.query = saved.query;
    hub.send = saved.send;
    hub.staffPeople = saved.people;
    greeting.setCachedGreetingName(AGENT_ID, '');
  }
}

test('their Hi under "tiktok.com" from a WhatsApp profile with a real name: greeted by it and approved there and then', async () => {
  const fake = fakeDb();
  await withFakes(fake, async (sent) => {
    const hello = await followThrough.onHello({ phone: PHONE, body: 'Hello', via: 'whatsapp', whatsappName: 'Testa Faith Love  💕 🌹', now: new Date('2026-11-24T18:30:00Z') });
    assert.ok(hello.agent, 'approved');
    assert.ok(!hello.held);
    assert.match(hello.message, /^Hi Testa Faith Love! 👋 Welcome to makaug\.com\. Ronald told us you would say Hi\./);
    assert.strictEqual(fake.state.fullName, 'Testa Faith Love');
    assert.ok(fake.calls.some((c) => /UPDATE agent_prospects SET full_name = \$2/.test(c.sql) && c.params[1] === 'Testa Faith Love'), 'the call list takes it too');
    assert.ok(fake.calls.some((c) => /INSERT INTO audit_logs/.test(c.sql) && /"from_whatsapp":true/.test(String(c.params[1]))));
    assert.strictEqual(sent.length, 0, 'nothing for the caller to do');
  });
});

test('no real name on the WhatsApp profile: the one they wrote to us under before', async () => {
  const fake = fakeDb({ stored: 'MUMMY TESTINA' });
  await withFakes(fake, async () => {
    const hello = await followThrough.onHello({ phone: PHONE, body: 'Hi', via: 'whatsapp', whatsappName: 'testamosmukasa', now: new Date('2026-11-24T18:30:00Z') });
    assert.ok(hello.agent);
    assert.match(hello.message, /^Hi Mummy Testina! 👋/);
    const lookup = fake.calls.find((c) => /FROM whatsapp_messages/.test(c.sql));
    assert.deepStrictEqual(lookup.params[0], ['+256700000141', '256700000141', '0700000141']);
  });
  // A Hi by SMS has no WhatsApp profile: the one on record is used the same way.
  const sms = fakeDb({ stored: 'Testembo' });
  await withFakes(sms, async () => {
    const hello = await followThrough.onHello({ phone: PHONE, body: 'Hi', via: 'sms', now: new Date('2026-11-24T18:30:00Z') });
    assert.ok(hello.agent);
    assert.strictEqual(sms.state.fullName, 'Testembo');
  });
});

test('no real name anywhere: they wait for the caller, as before', async () => {
  const fake = fakeDb();
  await withFakes(fake, async (sent) => {
    const hello = await followThrough.onHello({ phone: PHONE, body: 'Hello', via: 'whatsapp', whatsappName: 'God is able', now: new Date('2026-11-24T18:30:00Z') });
    assert.strictEqual(hello.held, true);
    assert.strictEqual(hello.agent, null);
    assert.match(hello.message, /^Hi! 👋 Welcome to makaug\.com\. Ronald told us you would say Hi\./);
    assert.strictEqual(fake.state.fullName, 'tiktok.com');
    assert.strictEqual(sent.length, 1, 'the caller is told');
  });
});

test('the ones who wrote to us before take that name, and come off the callers\' lists', async () => {
  const admin = require('../routes/admin');
  const realFollowUps = admin.runAgentApprovalFollowUps;
  const welcomed = [];
  admin.runAgentApprovalFollowUps = async (args) => { welcomed.push(args); return {}; };
  try {
    const fake = fakeDb({ stored: 'Kisa Testname 🌹', heldAt: '2026-11-24T17:00:00.000Z' });
    await withFakes(fake, async () => {
      const filled = await names.fillFromWhatsapp({ dbc: db });
      assert.deepStrictEqual(filled, [{ agent_id: AGENT_ID, name: 'Kisa Testname', approved: true }]);
      assert.strictEqual(fake.state.fullName, 'Kisa Testname');
      await new Promise((resolve) => setImmediate(resolve));
    });
    assert.deepStrictEqual(welcomed, [{ agentId: AGENT_ID, wasApproved: true, actor: 'calling_name_from_whatsapp' }], 'a Hi that waited is welcomed');
    const quiet = fakeDb({ stored: 'God is able' });
    await withFakes(quiet, async () => {
      assert.deepStrictEqual(await names.fillFromWhatsapp({ dbc: db }), []);
      assert.strictEqual(quiet.state.fullName, 'tiktok.com');
    });
  } finally {
    admin.runAgentApprovalFollowUps = realFollowUps;
  }
  // Today's list on the dashboard is replaced when names were filled in.
  const calls = [];
  const dbc = { query: async (sql, params = []) => { calls.push({ sql: String(sql), params }); return { rows: [] }; } };
  await names.sendDailyDigest({ dbc, now: new Date('2026-11-24T18:40:00Z'), hub: { staffPeople: async () => [], send: async () => ({ id: 1 }) }, refresh: true });
  assert.ok(calls.some((c) => /UPDATE team_messages SET withdrawn_at = NOW\(\)/.test(c.sql) && /::date <= \$2::date/.test(c.sql)));
  const source = read('services/callingNames.js');
  assert.match(source, /const filled = await fillFromWhatsapp\(\{ dbc \}\);[\s\S]{0,200}const out = await sendDailyDigest\(\{ dbc, now, refresh: filled\.length > 0 \}\);/);
});

test('the WhatsApp hook passes the name on the profile the Hi came from', () => {
  const runtime = read('routes/whatsapp.js');
  assert.match(runtime, /onHello\(\{ phone, body: effectiveBody, via: 'whatsapp', conversationControl, whatsappName: normalizeInput\(inboundMetadata\.push_name \|\| ''\) \|\| contactName \}\)/);
});

test('a property typed before its photos is not told to send them: the burst answers it', () => {
  const route = require('../routes/whatsapp').__test;
  const notice = route.agentPendingNotice({ whatsapp_agent_self_intake: true, pending_property_caption: '2 double shops for sale in Kagoma along Bombo road, price 60m' });
  assert.match(notice, route.AGENT_DETAILS_THEN_PHOTOS);
  const runtime = read('routes/whatsapp.js');
  assert.match(runtime, /const detailsBeforePhotos = agentTypedReply && AGENT_DETAILS_THEN_PHOTOS\.test\(String\(employeeIntake\.message \|\| ''\)\);\n\s+if \(detailsBeforePhotos\) \{\n\s+scheduleEmployeeBatchSummary\(phone\);\n\s+employeeIntake\.message = '';/);
});

test('a main road in the caption picks the district when the place is in several', () => {
  const route = require('../routes/whatsapp').__test;
  const along = route.employeePropertyFacts('2 double shops For sale Location📍 Kagoma Along bombo road Few metres from tarmac Price 60m ugx', { whatsapp_agent_self_intake: true });
  assert.strictEqual(along.locationPatch.area, 'Kagoma');
  assert.strictEqual(along.locationPatch.district, 'Wakiso');
  assert.deepStrictEqual(route.employeePropertyMissing(along), []);
  const off = route.employeePropertyFacts('Plot for sale in Kagoma off Gayaza rd, 40m', { whatsapp_agent_self_intake: true });
  assert.strictEqual(off.locationPatch.district, 'Wakiso');
  // No road: the shortlist question, as before.
  const bare = route.employeePropertyFacts('2 double shops for sale in Kagoma, price 60m', { whatsapp_agent_self_intake: true });
  assert.match(route.employeePropertyMissing(bare).join(' '), /which district Kagoma is in/);
  assert.deepStrictEqual(route.mainRoadsInText('between Gayaza road and Bombo Rd').map((road) => road.name), ['Gayaza Road', 'Bombo Road']);
});
