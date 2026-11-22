'use strict';

/**
 * A person on our team is talking to them (21 Nov 2026). Every name and
 * number here is made up.
 *
 * A message typed in the WhatsApp inbox went to an agent at 08:46 in Kampala:
 * something new on his project's page, and "When are you free next week?".
 * At 13:41 he wrote back:
 *
 *   13:41:52  him: Good afternoon Brother
 *   13:41:57  him: Hope you are doing well
 *   13:42:01  I did not save that, because it does not describe a property
 *             and I did not want to create an empty one. Send a property
 *             caption with the type, exact location and price ...
 *   13:42:17  him: I'm always available
 *   13:42:24  🔁 Here it is again: I did not save that, because ...
 *
 * His chat was still in the session he posts his properties in. Nothing told
 * the assistant a person was in the middle of a conversation with him, and
 * nobody on the team was told he had answered.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../config/database');
const route = require('../routes/whatsapp').__test;
const personThread = require('../services/whatsappPersonThreadService');
const desk = require('../services/leadDeskService');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const STAFF = '256700000111';
const AGENT_PHONE = '256700000556';
const AGENT = {
  id: '00000000-0000-4000-8000-000000000556',
  makaug_agent_number: 'MKA-AG-0000556',
  full_name: 'Replay Developer',
  company_name: 'Replay Estates',
  phone: `+${AGENT_PHONE}`,
  whatsapp: `+${AGENT_PHONE}`,
  email: null,
  status: 'approved'
};
const TYPED = { at: new Date(Date.now() - 5 * 3600000), text: 'We have built something new for your project. When are you free next week?' };

/**
 * The world: an approved agent, and (when `typed`) a message somebody on the
 * team typed to them five hours ago. `run` gets `at(step, body, runtime)` for
 * a message from the agent, the session writes, and the lines kept for the
 * team's note.
 */
function withWorld(run, { typed = false, phone = AGENT_PHONE } = {}) {
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  const before = {
    staff: process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS,
    quiet: process.env.WHATSAPP_PERSON_THREAD_NOTE_QUIET_SECONDS
  };
  process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS = STAFF;
  process.env.WHATSAPP_PERSON_THREAD_NOTE_QUIET_SECONDS = '600';
  const writes = [];
  const asked = [];
  db.query = async (sql, params = []) => {
    const text = String(sql);
    if (/FROM outbound_message_queue/i.test(text) && /reply_kind/.test(text)) {
      asked.push(params);
      return { rows: typed ? [{ at: TYPED.at, text: TYPED.text }] : [] };
    }
    if (/UPDATE whatsapp_sessions|INSERT INTO whatsapp_sessions/i.test(text)) {
      writes.push({ sql: text, params });
      return { rows: [] };
    }
    if (/FROM agents/i.test(text) && /status = 'approved'/i.test(text)) return { rows: [AGENT] };
    return { rows: [] };
  };
  db.getClient = async () => ({ query: db.query, release() {} });
  route.agentTalkNotes.clear();
  route.agentUnplacedThankedAt.clear();
  route.agentUnplacedNotedAt.clear();
  const posting = () => ({ ...route.agentSelfIntakeSessionData(AGENT), property_ids: ['p1', 'p2'] });
  const at = (step, body, runtime = {}) => route.handleEmployeeWhatsappIntake({
    phone,
    body,
    runtime,
    session: { current_step: step, session_data: step === 'employee_property_media' ? posting() : {} }
  });
  const kept = () => {
    const waiting = route.agentTalkNotes.get(phone);
    return waiting ? waiting.lines.slice() : [];
  };
  return Promise.resolve(run({ at, writes, asked, kept })).finally(() => {
    for (const waiting of route.agentTalkNotes.values()) if (waiting.timer) clearTimeout(waiting.timer);
    route.agentTalkNotes.clear();
    route.agentUnplacedThankedAt.clear();
    route.agentUnplacedNotedAt.clear();
    db.query = originalQuery;
    db.getClient = originalGetClient;
    for (const [key, name] of [['staff', 'WHATSAPP_EMPLOYEE_INTAKE_NUMBERS'], ['quiet', 'WHATSAPP_PERSON_THREAD_NOTE_QUIET_SECONDS']]) {
      if (before[key] === undefined) delete process.env[name];
      else process.env[name] = before[key];
    }
  });
}

const OLD_SENTENCE = /does not describe a property|empty one/;

// ---------------------------------------------------------------------------
// The three days after somebody on the team writes
// ---------------------------------------------------------------------------

test('what he actually wrote is left for the person, and kept for the team', async () => {
  await withWorld(async ({ at, writes, kept }) => {
    for (const line of ['Good afternoon Brother', 'Hope you are doing well', "I'm always available"]) {
      const reply = await at('employee_property_media', line);
      assert.strictEqual(reply.handled, true, line);
      assert.strictEqual(reply.message, '', `"${line}" must get no automatic answer`);
      assert.strictEqual(reply.leftUnanswered, true, line);
      assert.strictEqual(reply.nextStep, 'employee_property_media', 'and his posting session stays where it was');
    }
    assert.deepStrictEqual(kept(), ['Good afternoon Brother', 'Hope you are doing well', "I'm always available"], 'three lines, one note');
    assert.ok(writes.some((write) => /talk_left_unanswered_at/.test(write.sql)), 'the session is marked, so the batch summary lets it be');
  }, { typed: true });
});

test('everything a person says in a conversation is covered, not just those three lines', async () => {
  await withWorld(async ({ at }) => {
    for (const line of [
      'Okay', 'Yes', 'Thanks', '👍', 'Ok no problem', 'Tuesday is fine',
      'Tuesday 24 November at 2:00 pm is fine', 'That time works for me',
      'Can we do Wednesday instead?', 'I will share the details tomorrow', 'What do you mean'
    ]) {
      const reply = await at('employee_property_media', line);
      assert.strictEqual(reply.message, '', `"${line}" must get no automatic answer`);
    }
  }, { typed: true });
});

test('a voice note back to a person is theirs to listen to', async () => {
  await withWorld(async ({ at, kept }) => {
    const reply = await at('employee_property_media', '', { mediaType: 'audio/ogg; codecs=opus' });
    assert.strictEqual(reply.message, '');
    assert.match(kept()[0], /Voice note/);
  }, { typed: true });
  await withWorld(async ({ at }) => {
    const reply = await at('employee_property_media', '', { mediaType: 'audio/ogg; codecs=opus' });
    assert.match(reply.message, /cannot listen to voice notes/, 'unchanged when nobody is talking to them');
  });
});

test('properties and the words the assistant acts on carry on as before', async () => {
  await withWorld(async ({ at, kept }) => {
    const property = await at('employee_property_media', '3 bedroom house for rent in Kira, Wakiso - UGX 1.2m a month');
    assert.match(property.message, /Got the details/, 'a property is still a property');
    assert.match((await at('employee_property_media', 'menu')).message, /What would you like to do/);
    assert.match((await at('employee_property_media', 'help')).message, /help is on the way/);
    assert.match((await at('employee_property_media', 'share')).message, /Your makaug page/);
    assert.match((await at('employee_property_media', 'my link')).message, /Your makaug page/);
    assert.match((await at('employee_property_media', 'How do I post')).message, /just send me the property/);
    assert.ok((await at('employee_property_media', 'status')).message.length > 20);
    const closed = await at('employee_property_media', 'cancel');
    assert.strictEqual(closed.nextStep, 'main_menu');
    assert.deepStrictEqual(kept(), [], 'and none of it is passed to the team as talk');
  }, { typed: true });
});

test('with no posting session open, a hello or a question back is still left for the person', async () => {
  await withWorld(async ({ at, kept }) => {
    for (const line of ['Good afternoon Brother', 'Hello', 'Can we do Wednesday instead?']) {
      const reply = await at('main_menu', line);
      assert.strictEqual(reply.handled, true, line);
      assert.strictEqual(reply.message, '', `"${line}" must get no automatic answer`);
    }
    assert.strictEqual(kept().length, 3);
    assert.match((await at('main_menu', 'menu')).message, /What would you like to do/, 'MENU still brings the menu');
  }, { typed: true });
});

test('the rest of the assistant leaves an agent\'s talk for the person too, after the pause check and only when it found no request', () => {
  const source = read('routes/whatsapp.js');
  const runtime = source.slice(source.indexOf('async function processInboundRuntimeUnlocked'));
  const paused = runtime.indexOf('humanHandoffAck(activeLang)');
  const left = runtime.indexOf("['', 'unknown', 'greeting'].includes(String(intentResult?.intent || '')");
  assert.ok(paused > 0 && left > paused, 'after a chat the team has switched off is dealt with');
  const block = runtime.slice(left - 400, left + 700);
  assert.match(block, /AGENT_FILM_RESTING_STEPS\.has\(/, 'only when they are not in the middle of something');
  assert.match(block, /findApprovedAgentByPhone\(phone\)/, 'only an approved agent');
  assert.match(block, /agentTalkIsForAPerson\(\{ phone, agent: talkingAgent, said: effectiveBody \}\)/);
  assert.match(block, /return \{ message: '', nextStep: sessionStep \};/);
});

test('a "thanks" or an "ok" back to a person is not answered by the reply playbook either', () => {
  const source = read('routes/whatsapp.js');
  const handler = source.slice(source.indexOf('async function handleReplyPlaybook'), source.indexOf('async function handleReplyPlaybook') + 3200);
  const left = handler.indexOf("['thanks', 'praise', 'ack'].includes(kind)");
  assert.ok(left > 0, 'the three kinds that are an answer to whoever wrote');
  const rule = handler.slice(left - 120, left + 200);
  assert.match(rule, /role === 'agent' && String\(agent\.status \|\| ''\) === 'approved'/, 'an approved agent, who is then left for the person further on');
  assert.match(rule, /!isTeamNumber\(phone\) && await personThread\.lastTypedByTeam\(db, phone\)\.catch\(\(\) => null\)\) return null;/);
  assert.ok(left < handler.indexOf('switch (kind)'), 'before any of its answers');
});

test('a batch summary is not sent on top of talk that was left unanswered', () => {
  const source = read('routes/whatsapp.js');
  assert.match(source, /&& !employeeIntake\.batchComplete[\s\S]{0,260}&& !employeeIntake\.leftUnanswered/, 'no summary is scheduled for it');
  const sweep = source.slice(source.indexOf('async function sweepEmployeeBatchSummaries'), source.indexOf('async function sweepEmployeeBatchSummaries') + 2600);
  assert.match(sweep, /talk_left_unanswered_at/, 'and the sweeper that answers a silent session lets it be');
  assert.match(sweep, /CASE WHEN[\s\S]+THEN \(s\.session_data->>'talk_left_unanswered_at'\)::timestamptz >= li\.last_at/, 'only while the mark is newer than their last message');
  assert.match(source, /jsonb_build_object\('talk_left_unanswered_at', to_char\(NOW\(\) AT TIME ZONE 'UTC'/, 'marked with the database clock, the one their message was stored with');
});

test('a member of staff is never left unanswered', async () => {
  await withWorld(async () => {
    assert.strictEqual(await route.agentTalkIsForAPerson({ phone: STAFF, agent: AGENT, said: 'Tuesday is fine' }), false);
    assert.strictEqual(await route.agentTalkIsForAPerson({ phone: AGENT_PHONE, agent: AGENT, said: 'Tuesday is fine' }), true);
    assert.strictEqual(await route.agentTalkIsForAPerson({ phone: AGENT_PHONE, agent: AGENT, said: 'menu' }), false, 'nor is a word meant for the assistant');
  }, { typed: true });
});

// ---------------------------------------------------------------------------
// When nobody on the team has written
// ---------------------------------------------------------------------------

test('"Good afternoon Brother" is a hello', async () => {
  for (const hello of ['Good afternoon Brother', 'Good morning bro', 'Hello madam', 'Hi Phillip', 'Good evening sir 🙏', 'Hello my friend']) {
    assert.ok(route.AGENT_GREETING.test(hello), hello);
  }
  for (const not of ['Good afternoon, I have a plot in Kira for 40m', 'Hello is the house in Kira still there', 'Brother']) {
    assert.ok(!route.AGENT_GREETING.test(not), not);
  }
  await withWorld(async ({ at }) => {
    const reply = await at('employee_property_media', 'Good afternoon Brother');
    assert.match(reply.message, /Hello Replay/);
    assert.doesNotMatch(reply.message, OLD_SENTENCE);
  });
});

test('an agent is never again told their words "do not describe a property"', async () => {
  await withWorld(async ({ at, kept, writes }) => {
    const first = await at('employee_property_media', 'Hope you are doing well');
    assert.match(first.message, /Thanks Replay, I have passed that to our team/);
    assert.match(first.message, /If it was a property, send the photos or a short video with a caption/, 'in case it was meant as one');
    assert.doesNotMatch(first.message, OLD_SENTENCE);
    const second = await at('employee_property_media', "I'm always available");
    assert.strictEqual(second.message, '', 'thanked once in half an hour, not for every line');
    assert.strictEqual(second.leftUnanswered, true);
    assert.ok(writes.some((write) => /talk_left_unanswered_at/.test(write.sql)));
    assert.deepStrictEqual(kept(), ['Hope you are doing well', "I'm always available"], 'both lines go to the team');
    for (const noise of ['2', '5', '?', '...']) {
      const reply = await at('employee_property_media', noise);
      assert.match(reply.message, /^To post a property, send the photos or a short video with a caption/, noise);
      assert.doesNotMatch(reply.message, OLD_SENTENCE);
    }
    assert.strictEqual(kept().length, 2, 'what is not words is not passed on');
  });
});

test('a staff batch keeps the staff reply', async () => {
  await withWorld(async () => {
    const reply = await route.handleEmployeeWhatsappIntake({
      phone: STAFF,
      body: 'Hope you are doing well',
      session: {
        current_step: 'employee_property_media',
        session_data: { whatsapp_employee_intake: true, employee_role: 'agent', agent: AGENT, property_batch_mode: 'multiple', property_ids: [] }
      }
    });
    assert.match(reply.message, /I did not save that, because it does not describe a property/);
  });
});

// ---------------------------------------------------------------------------
// The pieces
// ---------------------------------------------------------------------------

test('what is talk, and what is for the assistant', () => {
  const kind = route.agentTalkKind;
  assert.strictEqual(kind('Good afternoon Brother'), 'greeting');
  assert.strictEqual(kind('Okay'), 'courtesy');
  assert.strictEqual(kind('👍'), 'courtesy');
  assert.strictEqual(kind("I'm always available"), 'other');
  assert.strictEqual(kind('I will share the details tomorrow'), 'other', 'a sentence with "share" in it is not a request for their link');
  for (const forTheAssistant of ['menu', 'MENU', 'start', 'help', 'HELP', 'share', 'Share my listings', 'my link', 'status', 'Is it live?', 'How do I post', 'I agree', 'stop']) {
    assert.strictEqual(kind(forTheAssistant), '', forTheAssistant);
  }
  for (const notWords of ['', '2', '?', '...', '5']) assert.strictEqual(kind(notWords), '', JSON.stringify(notWords));
});

test('only a message sent from the inbox, that reached them, in the last 72 hours counts', async () => {
  const calls = [];
  const fake = (rows) => ({ query: async (sql, params) => { calls.push({ sql: String(sql), params }); return { rows }; } });
  const now = new Date('2026-11-21T10:41:52Z');
  const found = await personThread.lastTypedByTeam(fake([{ at: '2026-11-21T05:46:01.651Z', text: 'When are you free next week?' }]), '+256 700 000556', { now });
  assert.strictEqual(found.at.toISOString(), '2026-11-21T05:46:01.651Z');
  assert.strictEqual(found.text, 'When are you free next week?');
  const { sql, params } = calls[0];
  assert.deepStrictEqual(params[0], ['256700000556', '+256700000556'], 'the number, with and without the plus');
  assert.strictEqual(params[1], now.toISOString());
  assert.strictEqual(params[2], 72);
  assert.deepStrictEqual(params[3], ['admin_human_reply', 'admin_ai_reply'], 'what the inbox reply route marks its messages');
  assert.match(sql, /status = 'sent'/, 'one that was only queued has not reached them');
  assert.match(sql, /metadata->>'reply_kind' = ANY\(\$4::text\[\]\)/);
  assert.match(sql, /duplicate_suppressed/, 'nor has one the bridge dropped as a repeat');
  assert.match(sql, /payload->>'source' = ANY\(\$4::text\[\]\)/, 'a message sent without the bridge is marked in the message log');
  assert.strictEqual(await personThread.lastTypedByTeam(fake([]), '256700000556'), null);
  assert.strictEqual(await personThread.lastTypedByTeam(fake([{ at: null, text: 'x' }]), '256700000556'), null);
  assert.strictEqual(await personThread.lastTypedByTeam(fake([{ at: 'x', text: 'x' }]), '12345'), null, 'not a phone number');
  assert.strictEqual(personThread.threadHours({}), 72);
  assert.strictEqual(personThread.threadHours({ WHATSAPP_PERSON_THREAD_HOURS: '24' }), 24);
  assert.strictEqual(personThread.threadHours({ WHATSAPP_PERSON_THREAD_HOURS: '0' }), 72);
  assert.strictEqual(personThread.threadHours({ WHATSAPP_PERSON_THREAD_HOURS: 'soon' }), 72);
  // And the inbox does mark them: without this nothing above can ever be true.
  const admin = read('routes/admin.js');
  assert.match(admin, /reply_kind: source === 'ai' \? 'admin_ai_reply' : 'admin_human_reply'/);
});

test('the note says who, what they wrote and what we wrote, and shows three digits of the number', () => {
  const note = personThread.teamNote({
    name: 'Replay Developer',
    company: 'Replay Estates',
    phone: '256700000556',
    lines: ['Good afternoon Brother', 'Hope you are doing well', "I'm always available"],
    typed: { at: new Date('2026-11-21T05:46:01Z'), text: 'When are you free next week?' },
    siteUrl: 'https://makaug.com/'
  });
  assert.match(note, /^💬 \*Replay Developer wrote back on WhatsApp\*/);
  assert.match(note, /Replay Developer \(Replay Estates\) · number ending 556/);
  assert.match(note, /They wrote \(3 messages\):\n"Good afternoon Brother"\n"Hope you are doing well"\n"I'm always available"/);
  assert.match(note, /Our team last wrote to them Sat,? 21 Nov,? 08:46, Kampala time: "When are you free next week\?"/);
  assert.match(note, /The assistant has not answered: a person on our team is talking to them, so this reply is yours\./);
  assert.match(note, /Answer from the WhatsApp inbox: https:\/\/makaug\.com\/admin$/);
  assert.doesNotMatch(note, /700000556|wa\.me/, 'the full number is not in it');

  const unplaced = personThread.teamNote({ name: 'Replay Developer', phone: '256700000556', lines: ['Hope you are doing well'] });
  assert.match(unplaced, /^💬 \*A message from Replay Developer the assistant could not place\*/);
  assert.match(unplaced, /They wrote:\n"Hope you are doing well"/);
  assert.match(unplaced, /The assistant thanked them and said it had passed this to the team/);
  assert.doesNotMatch(unplaced, /a person on our team is talking to them/);
});

test('a few lines sent together make one note, sent once the line is quiet', async () => {
  const sent = [];
  const original = desk.holdOrSendToTeam;
  const quiet = process.env.WHATSAPP_PERSON_THREAD_NOTE_QUIET_SECONDS;
  desk.holdOrSendToTeam = async (_db, note) => { sent.push(note); return { sent: true }; };
  process.env.WHATSAPP_PERSON_THREAD_NOTE_QUIET_SECONDS = '0';
  route.agentTalkNotes.clear();
  try {
    for (const line of ['Good afternoon Brother', 'Hope you are doing well', "I'm always available"]) {
      route.noteAgentTalkForTeam({ phone: AGENT_PHONE, agent: AGENT, said: line, typed: TYPED });
    }
    assert.strictEqual(sent.length, 0, 'nothing goes while they are still typing');
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.strictEqual(sent.length, 1, 'one note');
    assert.strictEqual(sent[0].conversationPhone, AGENT_PHONE);
    assert.strictEqual(sent[0].type, 'agent_wrote_back_to_person');
    assert.match(sent[0].body, /They wrote \(3 messages\)/);
    assert.ok(Array.isArray(sent[0].extraRecipients), 'to Arthur and Ronald by name, so staff added in King get it too');
    assert.strictEqual(route.agentTalkNotes.size, 0);
  } finally {
    desk.holdOrSendToTeam = original;
    if (quiet === undefined) delete process.env.WHATSAPP_PERSON_THREAD_NOTE_QUIET_SECONDS;
    else process.env.WHATSAPP_PERSON_THREAD_NOTE_QUIET_SECONDS = quiet;
  }
});

test('an answer to a person is passed on at once; what could not be placed, once in half an hour', () => {
  const now = Date.parse('2026-11-21T10:42:00Z');
  const delay = (options) => route.agentTalkNoteDelayMs({ now, quietMs: 45000, ...options });
  assert.strictEqual(delay({ answerToAPerson: true }), 45000);
  assert.strictEqual(delay({ answerToAPerson: true, lastNotedAt: now - 60000 }), 45000, 'whatever went before');
  assert.strictEqual(delay({ answerToAPerson: false }), 45000, 'the first one goes when the line is quiet');
  assert.strictEqual(delay({ answerToAPerson: false, lastNotedAt: now - 10 * 60000 }), 20 * 60000, 'the next waits out the half hour, gathering lines');
  assert.strictEqual(delay({ answerToAPerson: false, lastNotedAt: now - 40 * 60000 }), 45000);
});

test('it is written down where the inbox is explained', () => {
  const doc = read('docs/whatsapp/AI_INBOX_COPILOT.md');
  assert.match(doc, /When a person on the team writes to an agent/);
  assert.match(doc, /WHATSAPP_PERSON_THREAD_HOURS/);
  assert.match(doc, /Customers are not affected/);
});
