'use strict';

/**
 * What the WhatsApp chats of 17 and 18 Nov 2026 taught. Every name and
 * number here is made up.
 *
 * 1. Somebody whose phone carries no name said "Hello" and was greeted
 *    "Good morning, None".
 * 2. An agent's "Land for sale 1 acre. Good for country home ..." was saved
 *    as a house: "home" made it one.
 * 3. "A brand new house for sale in Nansana ... ( near Pastor ... home)" was
 *    filed in the town the pastor shares a name with, in another district.
 * 4. An agent's voice note, sent after his photos, was retried as media that
 *    had not loaded, and at 01:27 in Kampala he was asked to "send that photo
 *    or video once more": every photo was already on his listing.
 * 5. Staff loaded two properties for an agent approved the day before. Agent
 *    007 called his profile "created and waiting for staff approval" and ended
 *    "has not been notified yet. The agent profile card is waiting for founder
 *    approval." The batch before it ended "1 properties sent for staff review".
 * 6. "Acres for sale ... suitable for many projects, factory, school, hotel"
 *    went up as a commercial property: "factory" was what the land could be
 *    used for.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../config/database');
const route = require('../routes/whatsapp').__test;

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('no name is not a name: "None", "null", "undefined" greet nobody', () => {
  for (const blank of ['None', 'none', 'NULL', 'undefined', 'nil', 'N/A', 'Anonymous', 'No name']) {
    assert.strictEqual(route.cleanDisplayName(blank), '', blank);
  }
  assert.strictEqual(route.cleanDisplayName('Replay School'), 'Replay School');
  assert.strictEqual(route.cleanDisplayName('Nonesuch'), 'Nonesuch', 'a name that starts with None is still a name');
});

test('land that is "good for a country home" is land, not a house', () => {
  const caption = 'Quick sale!! Land for sale 1 acre. Good for country home, estate developers, farming, poultry projects etc. Located at Namungo, Mityana road. Price 38m shs negotiable. Land title on table.';
  const facts = route.employeePropertyFacts(caption, { whatsapp_agent_self_intake: true });
  assert.strictEqual(facts.listingType, 'land');
  const reply = route.agentSelfIntakeSavedReply({
    data: { whatsapp_agent_self_intake: true, agent: { full_name: 'Replay Agent' }, property_ids: ['p1'] },
    facts,
    storedMedia: [{ kind: 'image', url: 'https://media.makaug.com/x.jpg' }],
    caption
  });
  assert.match(reply, /🏠 land · for sale/);
  assert.doesNotMatch(reply, /house/);
  const source = read('routes/whatsapp.js');
  assert.match(source, /facts\.listingType === 'land' \? null : \(parsePropertyType\(withEnglishPropertyTerms\(caption\)\) \|\| null\)/, 'and the listing is saved with no house type');
});

test('a landmark, or a person with a title, is not where the property is', () => {
  const where = (caption) => {
    const facts = route.employeePropertyFacts(caption, { whatsapp_agent_self_intake: true });
    return `${facts.locationPatch?.area || ''}, ${facts.locationPatch?.district || ''}`;
  };
  // The person: a name after "Pastor" that is also a town elsewhere.
  assert.strictEqual(where('A brand new house for sale in Nansana Kabulengwa (near Pastor Kakira home) 3 bedrooms on 60*70ft. Price ugx 100m only'), 'Nansana, Wakiso');
  // The landmark: a real place, but only what the house is near.
  assert.strictEqual(where('House for sale in Nansana near Bugembe junction, 3 bedrooms, 100m'), 'Nansana, Wakiso');
  assert.strictEqual(where('House for sale in Kira near Naalya, 4 bedrooms, 300m'), 'Kira, Wakiso');
  // Unchanged: nothing named before "near" (it is where it is) ...
  assert.strictEqual(where('3 bedroom house for sale near Kira town, 250m'), 'Kira, Wakiso');
  // ... or only a district before it, with the place after.
  assert.strictEqual(where('Plot for sale in Wakiso near Kakiri, 50x100, 40m'), 'Kakiri, Wakiso');
});

test('a voice note in a batch is answered as a voice note, never retried as media that did not load', () => {
  assert.ok(!route.EMPLOYEE_MEDIA_FAILURE_RE.test(route.EMPLOYEE_VOICE_NOTE_REPLY), 'so it is never parked for retry');
  assert.match(route.EMPLOYEE_VOICE_NOTE_REPLY, /voice note cannot go on a listing/);
  const source = read('routes/whatsapp.js');
  const voice = source.indexOf('if (isAudioNote && employeeIntake.handled && EMPLOYEE_MEDIA_FAILURE_RE.test(');
  const park = source.indexOf('const parked = await parkEmployeeMediaForRetry({', voice);
  assert.ok(voice > 0 && park > voice, 'the voice note is answered before anything is parked');
  assert.match(source.slice(voice, park), /employeeIntake\.message = EMPLOYEE_VOICE_NOTE_REPLY;/);
});

test('at night a media retry waits for the morning, so no message reaches the agent at 01:27', async () => {
  const original = db.query;
  const calls = [];
  const due = { inboundMessageId: 'm-1', attempt: 4, nextAt: '2026-11-17T22:20:00.000Z', body: '', mediaUrl: 'https://example.invalid/m.jpg', runtime: {} };
  db.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    if (/SELECT phone, session_data->'media_retry_queue' AS queue/.test(sql)) return { rows: [{ phone: '256700000999', queue: [due] }] };
    return { rows: [] };
  };
  try {
    const handled = await route.sweepEmployeeMediaRetries({ now: new Date('2026-11-17T22:27:38Z') }); // 01:27 in Kampala
    assert.strictEqual(handled, 0);
    const update = calls.find((call) => /UPDATE whatsapp_sessions[\s\S]*media_retry_queue/.test(call.sql));
    assert.ok(update, 'the queue is updated');
    const kept = JSON.parse(update.params[1]);
    assert.strictEqual(kept.length, 1, 'still waiting');
    assert.strictEqual(kept[0].nextAt, '2026-11-18T04:30:00.000Z', '07:30 in Kampala');
    assert.ok(!calls.some((call) => /INSERT INTO outbound_message_queue/i.test(call.sql)), 'and nothing is sent');
  } finally {
    db.query = original;
  }
});

// ---------------------------------------------------------------------------
// Agent 007 for an agent who is already approved
// ---------------------------------------------------------------------------

const STAFF = '+256700000111';
const AGENT = {
  id: '00000000-0000-4000-8000-000000000555',
  makaug_agent_number: 'MKA-AG-0000555',
  full_name: 'Replay Tester',
  company_name: 'Independent agent',
  phone: '+256700000555',
  whatsapp: '+256700000555',
  email: null,
  status: 'approved'
};

function withWorld(run, { agents = [], wrote = false } = {}) {
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  const before = {
    staff: process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS,
    onlyWrote: process.env.WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE
  };
  process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS = STAFF.replace(/\D/g, '');
  process.env.WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE = 'on';
  const sessions = [];
  db.query = async (sql, params = []) => {
    if (/UPDATE whatsapp_sessions|INSERT INTO whatsapp_sessions/i.test(sql)) {
      sessions.push({ step: params[1], data: params.find((p) => typeof p === 'string' && p.trim().startsWith('{')) });
      return { rows: [] };
    }
    if (/FROM agents/i.test(sql) && /status = 'approved'/i.test(sql)) {
      return {
        rows: agents.filter((agent) => Array.isArray(params[3]) && params[3].length >= 2
          && params[3].every((like) => agent.full_name.toLowerCase().includes(like.replace(/%/g, ''))))
      };
    }
    if (/FROM whatsapp_messages/i.test(sql) && /direction = 'inbound'/i.test(sql)) return { rows: wrote ? [{ '?column?': 1 }] : [] };
    return { rows: [] };
  };
  db.getClient = async () => ({ query: db.query, release() {} });
  const at = (phone, step, body, data = {}) => route.handleEmployeeWhatsappIntake({ phone, body, session: { current_step: step, session_data: data } });
  return Promise.resolve(run({ at, sessions })).finally(() => {
    db.query = originalQuery;
    db.getClient = originalGetClient;
    for (const [key, name] of [['staff', 'WHATSAPP_EMPLOYEE_INTAKE_NUMBERS'], ['onlyWrote', 'WHATSAPP_ONLY_TO_PEOPLE_WHO_WROTE']]) {
      if (before[key] === undefined) delete process.env[name];
      else process.env[name] = before[key];
    }
  });
}

const batchFor = (agent, setUp) => ({
  employee_role: 'agent',
  property_batch_mode: setUp > 1 ? 'multiple' : 'one',
  agent,
  property_ids: Array.from({ length: setUp }, (_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`),
  total_media_count: setUp,
  properties_shared_count: setUp,
  properties_duplicate_count: 0,
  properties_failed_count: 0
});

test('an agent found by name is shown as approved, not "waiting for staff approval"', async () => {
  await withWorld(async ({ at, sessions }) => {
    const found = await at(STAFF, 'employee_agent_lookup', 'Replay Tester', { employee_role: 'agent', agent_already_registered: true });
    assert.strictEqual(found.nextStep, 'employee_agent_confirm', found.message);
    const saved = JSON.parse(sessions[sessions.length - 1].data);
    assert.strictEqual(saved.agent_candidates[0].status, 'approved', 'the status goes with the choice');
    const card = await at(STAFF, 'employee_agent_confirm', '1', saved);
    assert.strictEqual(card.nextStep, 'employee_intake_confirm', card.message);
    assert.match(card.message, /Agent profile: Replay Tester is already live on makaug\.com/);
    assert.doesNotMatch(card.message, /waiting for staff approval/);
  }, { agents: [AGENT] });
});

test('the end of a batch for an approved agent says what happens next, and how to reach one who never wrote', async () => {
  await withWorld(async ({ at }) => {
    const done = await at(STAFF, 'employee_property_media', 'COMPLETE', batchFor(AGENT, 2));
    assert.strictEqual(done.batchComplete, true, done.message);
    assert.match(done.message, /✅ \*2 properties sent for staff review\*/);
    assert.match(done.message, /Replay Tester is already an approved agent\. Each property goes live when a moderator approves it/);
    assert.match(done.message, /Replay Tester hasn't written to the makaug WhatsApp number in the last 7 days/);
    assert.match(done.message, /https:\/\/wa\.me\/\d+\?text=Hi%20makaug/);
    assert.doesNotMatch(done.message, /waiting for founder approval|has not been notified yet/);
  });
  await withWorld(async ({ at }) => {
    const done = await at(STAFF, 'employee_property_media', 'COMPLETE', batchFor(AGENT, 1));
    assert.match(done.message, /✅ \*1 property sent for staff review\*/, 'one property, not "1 properties"');
    assert.match(done.message, /Replay Tester is already an approved agent/);
    assert.doesNotMatch(done.message, /hasn't written|wa\.me/, 'an agent who has written needs no link');
  }, { wrote: true });
  await withWorld(async ({ at }) => {
    const { status, ...pending } = AGENT;
    const done = await at(STAFF, 'employee_property_media', 'COMPLETE', batchFor(pending, 1));
    assert.match(done.message, /Replay Tester has not been notified yet\. The agent profile card is waiting for founder approval\./, 'unchanged for an agent not yet approved');
  });
});

test('land "suitable for ... factory" is land; "a commercial plot" and a warehouse stay commercial', () => {
  const type = (caption) => route.employeePropertyFacts(caption, { whatsapp_agent_self_intake: true }).listingType;
  assert.strictEqual(type('Acres for sale in Gayaza town (along the main road)\n\n* 4 acres, on main road, suitable for many projects, factory, school, hotel, apartments, hospital, with a private mailo land title..\n\nPrice is ugx. 2.5bn all acres'), 'land');
  assert.strictEqual(type('Land for sale in Mukono, 2 acres, suitable for commercial use, 200m'), 'land');
  assert.strictEqual(type('Good deal! A commercial plot for sale in Kyanja town centre! 17 decimals (70*100ft) on main road. Price is ugx. 750m'), 'commercial');
  assert.strictEqual(type('Warehouse on 1 acre for sale in Namanve, suitable for a factory, 2bn'), 'commercial');
  assert.strictEqual(type('Factory for sale in Namanve on 3 acres, 5bn'), 'commercial');
});
