'use strict';

/**
 * Agent 007, the control room (14 Nov 2026).
 *
 * Arthur: "have a look at the Agent 007 menu and make it look better and more
 * useful, explain what each option does ... option to send the video to normal
 * people who want to list ... how-to-post videos to both agents and normal
 * people ... see who is still owing money ... if a normal person wants to list
 * after they have received the video, what is next for them ... how do they
 * remove the property ... sold, on for a week, then removed and notified."
 *
 * What is checked here: the menu and its eight options; that the old "4 then
 * 2" cannot send the wrong film; the owner film and what a reply to it does;
 * the how-to videos; who still owes and chasing from the list; looking someone
 * up; an owner's REMOVE, STATUS and HELP; and the sold-listing notice.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Team notices go the way they do in production: through the bridge's queue.
process.env.WHATSAPP_DELIVERY_MODE = 'web_bridge';

const db = require('../config/database');
const whatsappRoute = require('../routes/whatsapp');
const route = whatsappRoute.__test;
const intake = require('../services/whatsappEmployeeIntakeService');
const controlRoom = require('../services/agent007ControlRoom');
const ownerFilm = require('../services/ownerFilmReplyService');
const ownerListing = require('../services/ownerListingCommandService');

const ARTHUR = '+447757773202';
const RONALD = '+256709402189';
const OWNER = '256772123456';
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
const dayOffset = (d) => new Date(Date.now() + 3 * 3600 * 1000 + d * 86400000).toISOString().slice(0, 10);

/** db.query answered by the first matching pattern; everything else is empty. */
function withWorld(handlers, run) {
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  const queued = [];
  const calls = [];
  let session = null;
  db.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    if (/UPDATE whatsapp_sessions|INSERT INTO whatsapp_sessions/i.test(sql)) {
      const blob = params.find((p) => typeof p === 'string' && p.trim().startsWith('{'));
      if (blob) session = JSON.parse(blob);
      return { rows: [] };
    }
    if (/INSERT INTO outbound_message_queue/i.test(sql)) {
      queued.push(params);
      return { rows: [{ id: `queued-${queued.length}`, status: 'pending' }] };
    }
    for (const [pattern, answer] of handlers) {
      if (pattern.test(sql)) return { rows: (await answer(sql, params)) || [] };
    }
    return { rows: [] };
  };
  db.getClient = async () => ({ query: db.query, release() {} });
  // Whether a number is an approved agent is remembered for a while: not between tests.
  for (const number of [OWNER, '256701000111', '256701234567', ARTHUR, RONALD]) whatsappRoute.forgetAgentPhone(number);
  const text = () => queued.map((p) => JSON.stringify(p)).join('\n');
  return Promise.resolve(run({ queued, calls, text, getSession: () => session }))
    .finally(() => { db.query = originalQuery; db.getClient = originalGetClient; });
}

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
const staffStep = (phone, step, body, data = {}) => route.handleEmployeeWhatsappIntake({
  phone,
  body,
  session: { current_step: step, session_data: { whatsapp_employee_intake: true, ...data } }
});

// ---------------------------------------------------------------------------
// The menu
// ---------------------------------------------------------------------------

test('the menu has eight options in four groups, and says what each one does', () => {
  const menu = intake.employeeRolePrompt('UGX 50,000');
  assert.match(menu, /^🔐 \*Agent 007\* · makaug control room/);
  for (const heading of ['LIST A PROPERTY', 'SEND A VIDEO', 'MONEY', 'CHECK']) assert.match(menu, new RegExp(`\\*${heading}\\*`));
  const options = menu.split('\n').filter((line) => /^\*\d\* · /.test(line));
  assert.deepStrictEqual(options.map((line) => line.slice(1, 2)), ['1', '2', '3', '4', '5', '6', '7', '8']);
  // Every option is followed by a line, in italics, on what it does.
  const lines = menu.split('\n');
  for (const option of options) assert.match(lines[lines.indexOf(option) + 1], /^_.+\._$/, option);
  assert.match(menu, /UGX 50,000 a month/);
  assert.match(menu, /UGX 20,000 a property/);
  assert.match(menu, /\*CANCEL\* closes it/);
  // WhatsApp folds a long message behind "Read more".
  assert.ok(menu.length < 900, `menu is ${menu.length} characters`);
});

test('each number, and the words people type, reach the right option', () => {
  const expected = { 1: 'agent', 2: 'customer', 3: 'pitch', 4: 'owner_pitch', 5: 'how_to', 6: 'pay_link', 7: 'owes', 8: 'lookup' };
  for (const [number, role] of Object.entries(expected)) assert.strictEqual(intake.parseEmployeeRole(number), role, number);
  const words = {
    'agent video': 'pitch', invite: 'pitch', 'owner film': 'owner_pitch', 'owner video': 'owner_pitch', 'how to post': 'how_to',
    'pay link': 'pay_link', 'payment link': 'pay_link', 'who owes': 'owes', unpaid: 'owes', lookup: 'lookup', 'look up': 'lookup'
  };
  for (const [typed, role] of Object.entries(words)) assert.strictEqual(intake.parseEmployeeRole(typed), role, typed);
  assert.strictEqual(intake.parseEmployeeRole('9'), '');
  assert.strictEqual(intake.parseEmployeeRole('3 bedroom house in Kira'), '');
});

test('"Agent 007" opens the menu, and our own menu is not mistaken for an inbound message', async () => {
  await withWorld([], async () => {
    const opened = await route.handleEmployeeWhatsappIntake({ phone: ARTHUR, body: 'Agent 007', session: { current_step: 'main_menu', session_data: {} } });
    assert.strictEqual(opened.nextStep, 'employee_intake_role');
    assert.match(opened.message, /makaug control room/);
  });
  const { isLikelyMakaugOutboundPreview } = require('../services/whatsappWebDirectionService');
  assert.strictEqual(isLikelyMakaugOutboundPreview('🔐 *Agent 007* · makaug control room LIST A PROPERTY'), true);
  assert.strictEqual(isLikelyMakaugOutboundPreview('Agent 007'), false, 'the trigger itself is what staff type');
});

test('leaving the menu does not talk about a batch', async () => {
  await withWorld([], async () => {
    const closed = await staffStep(ARTHUR, 'employee_owes_list', 'cancel', { employee_role: 'owes', owes_rows: [] });
    assert.match(closed.message, /Agent 007 is closed/);
    assert.doesNotMatch(closed.message, /batch|staff review/i);
    const batch = await staffStep(ARTHUR, 'employee_property_media', 'cancel', { employee_role: 'agent', property_ids: ['p1'] });
    assert.match(batch.message, /Batch closed\. 1 property stays in staff review/);
  });
});

// ---------------------------------------------------------------------------
// 4: the owner intro film
// ---------------------------------------------------------------------------

test('4 explains the owner film before asking who it is for', async () => {
  await withWorld([], async () => {
    const asked = await staffStep(ARTHUR, 'employee_intake_role', '4');
    assert.strictEqual(asked.nextStep, 'employee_owner_pitch_contact');
    assert.match(asked.message, /Owner intro film/);
    assert.match(asked.message, /their own\* property/);
    assert.match(asked.message, /reply \*LIST\*/);
    assert.match(asked.message, /UGX 20,000 a month per property/);
    assert.match(asked.message, /Name \| phone number/);
  });
});

test('the owner film goes out with its caption, and the owner is on the Outreach list', async () => {
  await withWorld([
    [/INSERT INTO agent_prospects/i, (_sql, params) => [{ full_name: params[0], phone: params[1], video_kind: params[3], status: 'pitched', newly_created: true }]]
  ], async ({ queued, text, calls, getSession }) => {
    const done = await staffStep(ARTHUR, 'employee_owner_pitch_contact', 'Sarah Nakato | 0772123456', { employee_role: 'owner_pitch' });
    assert.strictEqual(done.ownerFilmSent, true, JSON.stringify(done).slice(0, 300));
    assert.match(done.message, /Owner film sent to Sarah Nakato/);
    assert.match(done.message, /256772123456/);
    assert.match(done.message, /reply \*LIST\*/);
    assert.match(done.message, /Next owner\?/);
    assert.strictEqual(queued.length, 1, 'one film, to one person');
    assert.match(text(), /makaug-owner-intro-v1\.mp4/);
    assert.match(text(), /Hello Sarah/);
    assert.match(text(), /Buyers and tenants call you direct/);
    assert.match(text(), /UGX 20,000 a month per property/);
    assert.match(text(), /Reply \*LIST\* here/);
    assert.doesNotMatch(text(), /free (?:trial|days|week)/i);
    const prospect = calls.find((c) => /INSERT INTO agent_prospects/i.test(c.sql));
    assert.ok(prospect, 'recorded for follow-up');
    assert.strictEqual(prospect.params[3], 'owner', 'as the owner film, not the agent one');
    assert.strictEqual(getSession()?.employee_intake_last_pitch_kind, 'owner');
  });
});

test('the next "Name | phone" after an owner film is the next owner', async () => {
  await withWorld([
    [/INSERT INTO agent_prospects/i, (_sql, params) => [{ full_name: params[0], status: 'pitched', newly_created: true }]]
  ], async ({ text, queued }) => {
    const next = await route.handleEmployeeWhatsappIntake({
      phone: ARTHUR,
      body: 'Peter Okello | 0701234567',
      session: { current_step: 'main_menu', session_data: { employee_intake_last_pitch_at: hoursAgo(0.05), employee_intake_last_pitch_kind: 'owner' } }
    });
    assert.strictEqual(next.ownerFilmSent, true);
    assert.strictEqual(queued.length, 1);
    assert.match(text(), /makaug-owner-intro-v1\.mp4/);
    assert.doesNotMatch(text(), /makaug-agent-intro/);
  });
});

test('the old "4 then 2" for a payment link sends nobody the wrong film', async () => {
  await withWorld([], async ({ queued }) => {
    for (const old of ['1', '2']) {
      const told = await staffStep(RONALD, 'employee_owner_pitch_contact', old, { employee_role: 'owner_pitch' });
      assert.strictEqual(told.nextStep, 'employee_owner_pitch_contact');
      assert.match(told.message, /payment link\* is now \*6\*/);
    }
    const moved = await staffStep(RONALD, 'employee_owner_pitch_contact', '6', { employee_role: 'owner_pitch' });
    assert.strictEqual(moved.nextStep, 'employee_pay_link_who');
    assert.match(moved.message, /Send a payment link/);
    assert.strictEqual(queued.length, 0, 'nothing went to anybody');
  });
});

test('the owner film is not sent to an agent or twice, and may go to a found-online lister (15 Nov 2026)', async () => {
  await withWorld([
    [/FROM agents/i, () => [{ id: 'a1', full_name: 'Kato Brian', status: 'approved' }]]
  ], async ({ queued }) => {
    const agent = await staffStep(ARTHUR, 'employee_owner_pitch_contact', 'Kato Brian | 0772123456', { employee_role: 'owner_pitch' });
    assert.match(agent.message, /already a makaug agent, so I did not send the owner film/);
    assert.strictEqual(queued.length, 0);
  });
  await withWorld([
    [/FROM properties p\s+WHERE[\s\S]+found_online/i, () => [{ '?column?': 1 }]]
  ], async ({ queued }) => {
    // Arthur, 15 Nov 2026 16:22: found-online listers may now be sent the film.
    const found = await staffStep(ARTHUR, 'employee_owner_pitch_contact', 'Some Lister | 0772123456', { employee_role: 'owner_pitch' });
    assert.match(found.message, /Owner film sent to Some Lister/);
    assert.strictEqual(queued.length, 1);
  });
  await withWorld([
    [/FROM agent_prospects/i, () => [{ full_name: 'Sarah Nakato', video_kind: 'owner', status: 'pitched', pitched_at: daysAgo(2), pitched_by_name: 'Ronald' }]]
  ], async ({ queued }) => {
    const again = await staffStep(ARTHUR, 'employee_owner_pitch_contact', 'Sarah Nakato | 0772123456', { employee_role: 'owner_pitch' });
    assert.match(again.message, /I did not send the film/);
    assert.match(again.message, /already been sent this video/);
    assert.strictEqual(queued.length, 0);
  });
});

test('on the Outreach list an owner reads as an owner, and a second film starts its own follow-up', () => {
  const prospects = require('../services/agentProspectService');
  const owner = (status) => prospects.publicProspect({ id: 'p1', full_name: 'Sarah Nakato', phone: '+256772123456', video_kind: 'owner', status, pitched_at: daysAgo(2), pitched_by_name: 'Arthur' });
  assert.strictEqual(owner('pitched').video_label, 'Owner film (Agent 007 option 4)');
  assert.strictEqual(owner('interested').follow_up, 'Yes — they said LIST');
  assert.strictEqual(owner('signed_up').follow_up, 'Yes — their property is in review');
  assert.strictEqual(owner('approved').follow_up, 'Yes — their property is live');
  assert.match(owner('pitched').next_step, /Call them\. Do not send the same film again/);
  assert.match(owner('interested').next_step, /list it for them with Agent 007 option 2/);
  assert.match(owner('approved').next_step, /Who still owes/);
  // An owner is never "registered" as an agent from this list.
  assert.strictEqual(owner('interested').can_mark_registered, false);
  assert.strictEqual(owner('interested').can_mark_called, false);
  // The agent film reads as it always did.
  const agent = prospects.publicProspect({ id: 'p2', full_name: 'Kato Brian', phone: '+256701000222', video_kind: 'agent', status: 'interested', pitched_at: daysAgo(1) });
  assert.strictEqual(agent.video_label, 'Joining film (Agent 007 option 3)');
  assert.strictEqual(agent.follow_up, 'Yes — they want to join');
  assert.strictEqual(agent.can_mark_called, true);
  // A different film to the same number replaces what the row is about, and keeps the old one.
  const source = fs.readFileSync(path.join(__dirname, '../services/agentProspectService.js'), 'utf8');
  assert.match(source, /video_kind = EXCLUDED\.video_kind/);
  assert.match(source, /'previous_film'/);
});

// ---------------------------------------------------------------------------
// Replies to the owner film
// ---------------------------------------------------------------------------

test('what a reply to the owner film means', () => {
  const cases = {
    List: 'list', LIST: 'list', yes: 'list', 'Yes please': 'list', 1: 'list', 'I want to sell my house': 'list', 'I have a plot in Mukono': 'list',
    Ok: 'ack', Kale: 'ack', Noted: 'ack',
    'How much is it': 'money', 'Is it free?': 'money',
    'Who is this?': 'who', 'Where did you get my number': 'who',
    'How long does it take': 'how_long',
    Hello: 'greeting', 'Thanks so much': 'thanks',
    'No thanks': 'no', 'Not interested': 'no', STOP: 'no',
    'I am an agent': 'agent', 'I sell for clients': 'agent',
    'Call me tomorrow please': 'other', 'Feel free to call me': 'other'
  };
  for (const [said, kind] of Object.entries(cases)) assert.strictEqual(ownerFilm.ownerFilmAnswer(said), kind, said);
  assert.strictEqual(ownerFilm.ownerFilmAnswer(''), '');
});

test('the answers say the fee, who we are, and always what to do next', () => {
  const money = ownerFilm.ownerFilmReply({ kind: 'money', first: 'Sarah' });
  assert.match(money, /UGX 20,000 a month per property/);
  assert.match(money, /Nothing is charged automatically/);
  assert.match(money, /no commission/);
  const who = ownerFilm.ownerFilmReply({ kind: 'who', first: 'Sarah', sentBy: 'Ronald' });
  assert.match(who, /makaug\.com/);
  assert.match(who, /Ronald from our team sent you/);
  for (const kind of ['money', 'who', 'how_long', 'greeting', 'thanks', 'ack', 'no', 'agent']) {
    const reply = ownerFilm.ownerFilmReply({ kind, first: 'Sarah', sentBy: 'Ronald', passedOn: true });
    assert.match(reply, /\*LIST\*/, kind);
    assert.doesNotMatch(reply, /free (?:trial|days|week)/i, kind);
  }
  assert.match(ownerFilm.ownerFilmReply({ kind: 'agent', first: 'Sarah' }), /Reply \*AGENT\*/);
  assert.match(ownerFilm.ownerFilmReply({ kind: 'other', first: 'Sarah', sentBy: 'Arthur', passedOn: true }), /passed it to Arthur/);
  assert.strictEqual(ownerFilm.ownerFilmReply({ kind: 'other', first: 'Sarah', passedOn: false }), '', 'nothing claimed that did not happen');
});

const ownerFilmWorld = (extra = []) => [
  [/details->>'kind' = 'owner' OR/i, () => [{ created_at: hoursAgo(2), details: { kind: 'owner', name: 'Sarah Nakato', sent_by: '447757773202', employee_pitch: true } }]],
  [/FROM agent_prospects/i, () => [{ full_name: 'Sarah Nakato', video_kind: 'owner', status: 'pitched', pitched_at: hoursAgo(2), pitched_by_name: 'Arthur' }]],
  ...extra
];

test('LIST starts their listing, sends the how-to once, and tells Arthur and Ronald', async () => {
  await withWorld(ownerFilmWorld(), async ({ calls, text }) => {
    const reply = await route.handleOwnerFilmReply({ phone: OWNER, body: 'List', step: 'main_menu', lang: 'en', contactName: 'Sarah N' });
    assert.strictEqual(reply.startListing, true);
    assert.strictEqual(reply.nextStep, 'listing_type', 'the listing questions start now');
    assert.match(reply.message, /Let's get it listed, Sarah/);
    assert.match(reply.message, /about 5 minutes/);
    assert.match(reply.message, /What are you listing\?/);
    assert.ok(calls.some((c) => /UPDATE agent_prospects/i.test(c.sql) && c.params[1] === 'interested'), 'the Outreach list shows they said yes');
    await settle(150);
    assert.match(text(), /Owner wants to list — started on WhatsApp/);
    // 22 Nov 2026: a note to the team shows the number by its last three
    // digits; the WhatsApp link to them stays as it is.
    assert.match(text(), /Sarah Nakato · …456/);
    assert.doesNotMatch(text(), /Sarah Nakato · \+256772123456/);
    assert.match(text(), /WhatsApp: https:\/\/wa\.me\/256772123456/);
    assert.match(text(), /from Arthur/);
    assert.match(text(), /makaug-owner-how-to-list-v5\.mp4/, 'the how-to video goes with it');
    for (const staff of ['447757773202', '256709402189']) assert.ok(text().includes(staff), `${staff} is told`);
  });
});

test('a question gets its answer, and the first reply reaches the team once', async () => {
  const before = process.env.AGENT_FILM_REPLY_ALERT_DELAY_MS;
  process.env.AGENT_FILM_REPLY_ALERT_DELAY_MS = '0';
  try {
    await withWorld(ownerFilmWorld(), async ({ text }) => {
      const reply = await route.handleOwnerFilmReply({ phone: OWNER, body: 'How much is it', step: 'main_menu', contactName: 'Sarah N' });
      assert.strictEqual(reply.nextStep, 'main_menu');
      assert.match(reply.message, /UGX 20,000 a month per property/);
      await settle(150);
      assert.match(text(), /Owner replied to the film/);
      assert.match(text(), /They said: .{0,8}How much is it/);
    });
    // Told already in the last 12 hours: not told again.
    await withWorld(ownerFilmWorld([[/action IN \('owner_film_reply_notified', 'owner_list_started'\)/i, () => [{ '?column?': 1 }]]]), async ({ text }) => {
      const reply = await route.handleOwnerFilmReply({ phone: OWNER, body: 'Who is this?', step: 'main_menu', contactName: 'Sarah N' });
      assert.match(reply.message, /Arthur from our team sent you/);
      await settle(150);
      assert.doesNotMatch(text(), /Owner replied to the film/);
    });
  } finally {
    if (before === undefined) delete process.env.AGENT_FILM_REPLY_ALERT_DELAY_MS; else process.env.AGENT_FILM_REPLY_ALERT_DELAY_MS = before;
  }
});

test('"no thanks" closes it; someone who never got the film is left to the rest of the bot', async () => {
  await withWorld(ownerFilmWorld(), async ({ calls, queued }) => {
    const no = await route.handleOwnerFilmReply({ phone: OWNER, body: 'No thanks', step: 'main_menu' });
    assert.match(no.message, /No problem Sarah/);
    assert.ok(calls.some((c) => /UPDATE agent_prospects/i.test(c.sql) && c.params[1] === 'declined'));
    await settle(80);
    assert.strictEqual(queued.length, 0, 'nobody is pinged for a no');
  });
  await withWorld([], async () => {
    assert.strictEqual(await route.handleOwnerFilmReply({ phone: OWNER, body: 'List', step: 'main_menu' }), null);
  });
  // In the middle of something else, the film is not the subject.
  await withWorld(ownerFilmWorld(), async () => {
    assert.strictEqual(await route.handleOwnerFilmReply({ phone: OWNER, body: 'yes', step: 'confirm_whatsapp_contact' }), null);
  });
});

// 14 Nov 2026. A prospect had a missed-call question from 29 Aug still open when
// a new member of staff sent him the agent film. His "Agent", a minute later,
// was read as the answer to that old question and he was sent a list of agents;
// and when his second try got through, she was not among the people told.
const agentFilmWorld = (pitchedAt, extra = []) => [
  [/FROM agent_prospects/i, () => [{ full_name: 'Kato Brian', video_kind: 'agent', status: 'pitched', pitched_at: pitchedAt, pitched_by_name: 'Jane' }]],
  ...extra
];

test('a step left open before a film was sent does not stand between the film and its reply', async () => {
  const aMinuteAgo = hoursAgo(1 / 60);
  assert.strictEqual(route.wentQuietBeforeFilm(daysAgo(77), aMinuteAgo), true);
  assert.strictEqual(route.wentQuietBeforeFilm(hoursAgo(0.5), aMinuteAgo), false, 'they were in the chat half an hour before it');
  assert.strictEqual(route.wentQuietBeforeFilm(null, aMinuteAgo), false, 'when we cannot tell, the step stands');
  assert.strictEqual(route.wentQuietBeforeFilm(aMinuteAgo, daysAgo(77)), false, 'they have written since the film');

  await withWorld(agentFilmWorld(aMinuteAgo), async ({ calls }) => {
    const reply = await route.handleAgentFilmReply({ phone: OWNER, body: 'Agent', step: 'missed_call_need', lang: 'sw', contactName: 'K', lastMessageAt: daysAgo(77) });
    assert.ok(reply && reply.message, 'read as a reply to the film');
    assert.strictEqual(reply.nextStep, 'main_menu', 'and the old step is closed');
    assert.match(reply.message, /Join makaug as an agent/);
    assert.match(reply.message, /Great to hear from you, Kato/);
    assert.ok(calls.some((c) => /UPDATE agent_prospects/i.test(c.sql) && c.params[1] === 'interested'), 'the Outreach list shows they said yes');
    await settle(150);
  });
  await withWorld(agentFilmWorld(aMinuteAgo), async () => {
    const no = await route.handleAgentFilmReply({ phone: OWNER, body: 'No thanks', step: 'missed_call_need', lastMessageAt: daysAgo(77) });
    assert.match(no.message, /No problem/);
    // Anything the film does not ask for is still that step's to answer.
    assert.strictEqual(await route.handleAgentFilmReply({ phone: OWNER, body: 'I need a house in Kira', step: 'missed_call_need', lastMessageAt: daysAgo(77) }), null);
    // In the chat minutes before the film, or no way of telling: the step stands.
    assert.strictEqual(await route.handleAgentFilmReply({ phone: OWNER, body: 'Agent', step: 'ownership', lastMessageAt: hoursAgo(0.2) }), null);
    assert.strictEqual(await route.handleAgentFilmReply({ phone: OWNER, body: 'Agent', step: 'ownership' }), null);
    // A member of staff half way through Agent 007 is never a prospect.
    assert.strictEqual(await route.handleAgentFilmReply({ phone: OWNER, body: 'Agent', step: 'employee_pitch_contact', lastMessageAt: daysAgo(77) }), null);
    await settle(60);
  });
  // No film went to them: the old step is still theirs.
  await withWorld([], async () => {
    assert.strictEqual(await route.handleAgentFilmReply({ phone: OWNER, body: 'Agent', step: 'missed_call_need', lastMessageAt: daysAgo(77) }), null);
  });
  // The owner film, the same way.
  await withWorld(ownerFilmWorld(), async () => {
    const reply = await route.handleOwnerFilmReply({ phone: OWNER, body: 'List', step: 'missed_call_need', lang: 'en', contactName: 'Sarah N', lastMessageAt: daysAgo(77) });
    assert.strictEqual(reply.startListing, true);
    assert.strictEqual(await route.handleOwnerFilmReply({ phone: OWNER, body: 'List', step: 'confirm_whatsapp_contact', lastMessageAt: hoursAgo(2.5) }), null, 'in the chat half an hour before it went');
    assert.strictEqual(await route.handleOwnerFilmReply({ phone: OWNER, body: 'How much is it', step: 'missed_call_need', lastMessageAt: daysAgo(77) }), null, 'a question is left to the step');
    await settle(150);
  });
});

test('the staff added in King hear what Arthur and Ronald hear', async () => {
  const billing = require('../services/billingOpsService');
  const agentFilm = require('../services/agentFilmReplyService');
  const desk = require('../services/leadDeskService');
  const JANE = '447700900123'; // the British range kept for television
  const saved = [/SELECT key, value FROM billing_settings/i, () => [{ key: 'agent007_staff', value: [{ name: 'Jane Example', phone: JANE }] }]];
  const env = { alert: process.env.LEAD_DESK_ALERT_WHATSAPP, report: process.env.LEAD_DESK_REPORT_WHATSAPP, ceo: process.env.AI_CEO_REPORT_WHATSAPP_RECIPIENTS };
  process.env.LEAD_DESK_ALERT_WHATSAPP = '+256700555830';
  try {
    await withWorld(agentFilmWorld(hoursAgo(1 / 60), [saved]), async ({ text }) => {
      await billing.getSettings(db, { fresh: true });
      intake.rememberAgent007Staff([]); // nothing in hand: the list is read when the notice is sent
      assert.deepStrictEqual(await desk.teamRecipientsNow(db, agentFilm.agentJoinAlertRecipients({})), ['+256700555830', ARTHUR, RONALD, `+${JANE}`]);
      // A notice for the alert numbers alone, or one that names somebody else, is left as it is.
      assert.deepStrictEqual(await desk.teamRecipientsNow(db, []), ['+256700555830']);
      assert.deepStrictEqual(await desk.teamRecipientsNow(db, ['+256700555111']), ['+256700555830', '+256700555111']);
      // Each person once, however the lists overlap.
      assert.deepStrictEqual(await desk.teamRecipientsNow(db, [ARTHUR, `+${JANE}`, RONALD, ARTHUR]), ['+256700555830', ARTHUR, `+${JANE}`, RONALD]);

      // The reply to the film she sent: the three of them, and the alert number.
      await route.handleAgentFilmReply({ phone: OWNER, body: 'AGENT', step: 'main_menu', contactName: 'K', lastMessageAt: daysAgo(3) });
      await settle(200);
      assert.match(text(), /Agent wants to join makaug — please call/);
      assert.match(text(), /from Jane/, 'and it says who sent the film');
      for (const told of ['447757773202', '256709402189', JANE, '256700555830']) assert.ok(text().includes(told), `${told} is told`);
      // In hand, the saved staff are part of "who hears" wherever it is asked for.
      assert.deepStrictEqual(agentFilm.agentJoinAlertRecipients({}), [ARTHUR, RONALD, `+${JANE}`]);
      assert.deepStrictEqual(agentFilm.agentJoinAlertRecipients({}, { staff: [] }), [ARTHUR, RONALD]);
      // Leave nothing behind for the tests after this one.
      await billing.setSetting(db, 'agent007_staff', [], 'test');
    });
  } finally {
    intake.rememberAgent007Staff([]);
    for (const [key, name] of [['alert', 'LEAD_DESK_ALERT_WHATSAPP'], ['report', 'LEAD_DESK_REPORT_WHATSAPP'], ['ceo', 'AI_CEO_REPORT_WHATSAPP_RECIPIENTS']]) {
      if (env[key] === undefined) delete process.env[name]; else process.env[name] = env[key];
    }
  }
});

test('the team\'s notices carry who, what and what happens next', () => {
  const submitted = ownerFilm.ownerSubmittedNotice({
    title: '3 Bedroom House In Kira', location: 'Kira, Wakiso', price: 'USh 1.2M', photos: 2, ownerName: 'Sarah Nakato',
    digits: OWNER, reference: 'MK-20261114-B969DC', film: { kind: 'owner', by: 'Arthur', at: hoursAgo(3) }
  });
  assert.match(submitted, /New property from a private owner — waiting for review/);
  assert.match(submitted, /Sarah Nakato · \+256772123456/);
  assert.match(submitted, /MK-20261114-B969DC/);
  assert.match(submitted, /owner film Arthur sent/);
  const live = ownerFilm.ownerLiveNotice({ title: '3 Bedroom House In Kira', ownerName: 'Sarah Nakato', digits: OWNER, url: 'https://makaug.com/property/x', fee: 20000, payLink: 'https://makaug.com/pay/MKQG667X' });
  assert.match(live, /Live — private owner/);
  assert.match(live, /payment link \(UGX 20,000 a month\)/);
  assert.match(live, /Who still owes\* \(Agent 007 → 7\)/);
  const failed = ownerFilm.ownerLiveNotice({ title: 'x', ownerName: 'Sarah', digits: OWNER, url: 'u', sent: false });
  assert.match(failed, /could not send them/);
});

// ---------------------------------------------------------------------------
// 5: how-to videos
// ---------------------------------------------------------------------------

test('5 asks who the how-to is for, and each gets their own film', async () => {
  await withWorld([], async () => {
    const asked = await staffStep(RONALD, 'employee_intake_role', '5');
    assert.strictEqual(asked.nextStep, 'employee_howto_who');
    assert.match(asked.message, /\*1\* · An \*agent\*/);
    assert.match(asked.message, /\*2\* · A \*private owner\*/);
    const owner = await staffStep(RONALD, 'employee_howto_who', '2', { employee_role: 'how_to' });
    assert.strictEqual(owner.nextStep, 'employee_howto_contact');
    assert.match(owner.message, /How-to-list video, for an owner/);
  });
  await withWorld([], async ({ text, queued }) => {
    const sent = await staffStep(RONALD, 'employee_howto_contact', 'Sarah Nakato | 0772123456', { employee_role: 'how_to', howto_kind: 'owner' });
    assert.strictEqual(sent.howToSent, 'owner');
    assert.strictEqual(queued.length, 1);
    assert.match(text(), /makaug-owner-how-to-list-v5\.mp4/);
    assert.match(text(), /Reply \*LIST\* here to start/);
  });
});

test('the agent how-to only goes to an approved agent, by their name', async () => {
  await withWorld([], async ({ queued }) => {
    const refused = await staffStep(RONALD, 'employee_howto_contact', 'Kato Brian | 0772123456', { employee_role: 'how_to', howto_kind: 'agent' });
    assert.match(refused.message, /not an approved agent on makaug yet/);
    assert.match(refused.message, /Agent 007\* → \*3\*/);
    assert.strictEqual(queued.length, 0);
  });
  await withWorld([
    [/FROM agents/i, () => [{ id: 'a1', full_name: 'Kato Brian', greeting_name: 'Brian', status: 'approved' }]]
  ], async ({ text, queued }) => {
    const sent = await staffStep(RONALD, 'employee_howto_contact', 'Kato Brian | 0772123456', { employee_role: 'how_to', howto_kind: 'agent' });
    assert.strictEqual(sent.howToSent, 'agent');
    assert.strictEqual(queued.length, 1);
    assert.match(text(), /makaug-agent-how-to-post-v3\.mp4/);
    assert.match(text(), /Hi Brian/);
    assert.match(text(), /\*SOLD\* marks one as gone/);
  });
  // The same video twice in a day is a slip, not a decision.
  await withWorld([
    [/FROM agents/i, () => [{ id: 'a1', full_name: 'Kato Brian', status: 'approved' }]],
    [/details->>'kind' = \$2 AND created_at > NOW\(\) - INTERVAL '24 hours'/i, () => [{ created_at: hoursAgo(1) }]]
  ], async ({ queued }) => {
    const twice = await staffStep(RONALD, 'employee_howto_contact', 'Kato Brian | 0772123456', { employee_role: 'how_to', howto_kind: 'agent' });
    assert.match(twice.message, /was sent this video in the last 24 hours/);
    assert.strictEqual(queued.length, 0);
  });
});

// ---------------------------------------------------------------------------
// 6: the payment link, now for a private owner too
// ---------------------------------------------------------------------------

test('6 offers a registered agent, a new prospect or a private owner', async () => {
  await withWorld([], async () => {
    const asked = await staffStep(RONALD, 'employee_intake_role', '6');
    assert.strictEqual(asked.nextStep, 'employee_pay_link_who');
    assert.match(asked.message, /\*3\* · A \*private owner\* with a listing/);
    assert.match(asked.message, /UGX 20,000 a month for that listing/);
    const owner = await staffStep(RONALD, 'employee_pay_link_who', '3', { employee_role: 'pay_link' });
    assert.strictEqual(owner.nextStep, 'employee_pay_link_owner');
    assert.match(owner.message, /phone number\*, or the listing reference/);
  });
});

test('a private owner\'s listing is shown before its link is sent, and a paid one is left alone', async () => {
  const listing = { id: '11111111-1111-4111-8111-111111111111', title: '3 Bedroom House In Kira', status: 'approved', lister_name: 'Sarah Nakato', lister_phone: '+256772123456', lister_paid_until: null };
  await withWorld([
    [/FROM properties\s+WHERE agent_id IS NULL AND NOT[\s\S]+inquiry_reference/i, () => [listing]]
  ], async ({ getSession }) => {
    const found = await staffStep(RONALD, 'employee_pay_link_owner', '0772123456', { employee_role: 'pay_link', pay_link_target: 'owner' });
    assert.strictEqual(found.nextStep, 'employee_pay_link_owner_pick');
    assert.match(found.message, /Sarah Nakato has 1 listing/);
    assert.match(found.message, /3 Bedroom House In Kira — live, not paid yet/);
    assert.strictEqual(getSession().pay_link_owner_listings.length, 1);
  });
  await withWorld([], async ({ queued }) => {
    const paid = await staffStep(RONALD, 'employee_pay_link_owner_pick', '1', {
      employee_role: 'pay_link', pay_link_owner_listings: [{ ...listing, lister_paid_until: dayOffset(20) }]
    });
    assert.match(paid.message, /is paid until/);
    assert.strictEqual(queued.length, 0);
  });
  await withWorld([], async () => {
    const none = await staffStep(RONALD, 'employee_pay_link_owner', '0700000000', { employee_role: 'pay_link', pay_link_target: 'owner' });
    assert.match(none.message, /could not find a private listing/);
  });
});

// ---------------------------------------------------------------------------
// 7: who still owes
// ---------------------------------------------------------------------------

const AGENT_ROWS = [
  { id: 'aaaaaaaa-0000-4000-8000-000000000001', full_name: 'Jane Nakato', company_name: 'JN Homes', whatsapp: '+256701000111', status: 'approved', approved_at: daysAgo(60), paid_until: dayOffset(-12), fee_exempt: false, billing_reminder_log: {} },
  { id: 'aaaaaaaa-0000-4000-8000-000000000002', full_name: 'Brian Kato', whatsapp: '+256701000222', status: 'approved', approved_at: daysAgo(3), paid_until: null, fee_exempt: false, billing_reminder_log: {} },
  { id: 'aaaaaaaa-0000-4000-8000-000000000003', full_name: 'Francis Old', whatsapp: '+256701000333', status: 'approved', approved_at: daysAgo(200), paid_until: null, fee_exempt: true },
  { id: 'aaaaaaaa-0000-4000-8000-000000000004', full_name: 'Paid Peter', whatsapp: '+256701000444', status: 'approved', approved_at: daysAgo(40), paid_until: dayOffset(18), fee_exempt: false }
];
const LISTER_ROWS = [
  { id: 'bbbbbbbb-0000-4000-8000-000000000001', title: '3 Bedroom House In Kira', lister_name: 'Sarah Nakato', lister_phone: '0772123456', status: 'approved', created_at: daysAgo(4), reviewed_at: daysAgo(4), lister_paid_until: null, lister_billing_log: {}, lister_billing_suspended_at: null },
  { id: 'bbbbbbbb-0000-4000-8000-000000000002', title: 'Plot in Mukono', lister_name: 'Paid Owner', lister_phone: '0772999888', status: 'approved', created_at: daysAgo(9), reviewed_at: daysAgo(9), lister_paid_until: dayOffset(21), lister_billing_log: {} }
];
const owesWorld = (extra = []) => [
  ...extra,
  [/FROM agents\s+WHERE \(status = 'approved' OR billing_suspended_at IS NOT NULL\)/i, () => AGENT_ROWS],
  [/FROM properties\s+WHERE agent_id IS NULL AND NOT[\s\S]+lister_billing_suspended_at IS NOT NULL\)/i, () => LISTER_ROWS],
  [/FROM revenue_entries/i, () => [{}]]
];

test('who still owes: agents first, the longest overdue on top, then private owners', async () => {
  await withWorld(owesWorld(), async ({ getSession }) => {
    const list = await staffStep(RONALD, 'employee_intake_role', '7');
    assert.strictEqual(list.nextStep, 'employee_owes_list');
    assert.strictEqual(list.owesCount, 3);
    const lines = list.message.split('\n');
    assert.match(lines[0], /Who still owes/);
    assert.match(list.message, /\*AGENTS\* · UGX 50,000 a month/);
    assert.match(list.message, /\*1\* · Jane Nakato — 12 days overdue/);
    assert.match(list.message, /\*2\* · Brian Kato — never paid · approved .+\(3 days ago\)/);
    assert.match(list.message, /\*PRIVATE OWNERS\* · UGX 20,000 a property/);
    assert.match(list.message, /\*3\* · Sarah Nakato · “3 Bedroom House In Kira” — not paid · live 4 days/);
    assert.match(list.message, /3 people · UGX 120,000 a month not coming in/);
    assert.doesNotMatch(list.message, /Francis Old|Paid Peter|Paid Owner/, 'exempt and paid people are not on it');
    assert.doesNotMatch(list.message, /0701000111|0772123456/, 'numbers stay off the list');
    assert.strictEqual(getSession().owes_rows.length, 3);
  });
});

test('nobody owing closes the menu with good news', async () => {
  await withWorld([[/FROM revenue_entries/i, () => [{}]]], async () => {
    const list = await staffStep(RONALD, 'employee_intake_role', '7');
    assert.strictEqual(list.nextStep, 'main_menu');
    assert.match(list.message, /Nobody owes anything right now/);
  });
});

test('opening one shows their number, the link\'s state and what can be sent', async () => {
  await withWorld(owesWorld([
    [/FROM pay_links WHERE agent_id = \$1::uuid/i, () => [{ code: 'MKAAAA11', status: 'open', sent_at: daysAgo(5), opened_at: daysAgo(4) }]]
  ]), async ({ getSession }) => {
    const list = await staffStep(RONALD, 'employee_intake_role', '7');
    assert.ok(list);
    const rows = getSession().owes_rows;
    const card = await staffStep(RONALD, 'employee_owes_list', '1', { employee_role: 'owes', owes_rows: rows });
    assert.strictEqual(card.nextStep, 'employee_owes_person');
    assert.match(card.message, /👤 \*Jane Nakato\* · agent · JN Homes/);
    assert.match(card.message, /\+256 701 000 111 · https:\/\/wa\.me\/256701000111/);
    assert.match(card.message, /12 days overdue/);
    assert.match(card.message, /Payment link: opened .+, not paid/);
    assert.match(card.message, /\*1\* · Send the payment link again/);
    assert.match(card.message, /\*2\* · Send a reminder/);
    assert.match(card.message, /\*3\* · Send the \*final\* reminder/, '7 days overdue unlocks it');
    assert.match(card.message, /\*0\* · Back to the list/);
    assert.match(card.message, /Taking listings down stays in King/);
    const never = await staffStep(RONALD, 'employee_owes_list', '2', { employee_role: 'owes', owes_rows: rows });
    assert.doesNotMatch(never.message, /final\* reminder/, 'not for somebody approved three days ago');
    const wrong = await staffStep(RONALD, 'employee_owes_list', '9', { employee_role: 'owes', owes_rows: rows });
    assert.match(wrong.message, /Reply the number of the person/);
  });
});

test('a reminder is not sent twice in a day, at night, or to someone who has since paid', async (t) => {
  const jane = { kind: 'agent', id: AGENT_ROWS[0].id, name: 'Jane Nakato', phone: '256701000111', state: 'overdue', days_overdue: 12, paid_until: dayOffset(-12), amount_ugx: 50000 };
  await withWorld(owesWorld(), async ({ queued }) => {
    const today = await staffStep(RONALD, 'employee_owes_person', '2', { employee_role: 'owes', owes_rows: [{ ...jane, last_reminder_at: new Date().toISOString() }], owes_selected: 0 });
    assert.match(today.message, /A reminder already went to Jane Nakato today/);
    assert.strictEqual(queued.length, 0);
  });
  assert.match(route.chaseQuietHoursMessage(new Date('2026-11-14T20:30:00Z')), /23:30 in Kampala/);
  assert.strictEqual(route.chaseQuietHoursMessage(new Date('2026-11-14T10:00:00Z')), '');
  assert.match(route.chaseQuietHoursMessage(new Date('2026-11-14T03:00:00Z')), /06:00 in Kampala/);
  // Paid since the list was shown: nothing goes, and the list is shown again.
  // The clock is set to midday in Kampala. Setting Date.now alone is not enough: the
  // night check reads `new Date()`, so this test used to fail between 10pm and 7am there.
  const nineAmUtc = new Date(`${dayOffset(0)}T09:00:00Z`).getTime();
  t.mock.timers.enable({ apis: ['Date'], now: nineAmUtc });
  try {
    await withWorld([
      [/FROM agents\s+WHERE \(status = 'approved' OR billing_suspended_at IS NOT NULL\)/i, () => AGENT_ROWS.map((a) => (a.id === jane.id ? { ...a, paid_until: dayOffset(25) } : a))],
      [/FROM properties\s+WHERE agent_id IS NULL AND NOT[\s\S]+lister_billing_suspended_at IS NOT NULL\)/i, () => LISTER_ROWS],
      [/FROM revenue_entries/i, () => [{}]]
    ], async ({ queued }) => {
      const paid = await staffStep(RONALD, 'employee_owes_person', '2', { employee_role: 'owes', owes_rows: [jane], owes_selected: 0 });
      assert.match(paid.message, /Jane Nakato no longer owes anything/);
      assert.match(paid.message, /Nothing was sent/);
      assert.strictEqual(paid.nextStep, 'employee_owes_list');
      assert.strictEqual(queued.length, 0);
    });
  } finally {
    t.mock.timers.reset();
  }
});

test('what can be sent depends on how late they are', () => {
  const now = new Date();
  const keys = (row) => controlRoom.owesActions(row, { now }).map((a) => `${a.key}${a.blocked ? '!' : ''}`);
  assert.deepStrictEqual(keys({ kind: 'agent', state: 'never_paid', days_overdue: 0 }), ['pay_link', 'reminder']);
  assert.deepStrictEqual(keys({ kind: 'agent', state: 'overdue', days_overdue: 6 }), ['pay_link', 'reminder']);
  assert.deepStrictEqual(keys({ kind: 'agent', state: 'overdue', days_overdue: 7 }), ['pay_link', 'reminder', 'final_reminder']);
  assert.deepStrictEqual(keys({ kind: 'owner', state: 'due', days_overdue: 9, final_reminder_at: daysAgo(1) }), ['pay_link', 'reminder'], 'the final reminder goes once');
  assert.deepStrictEqual(keys({ kind: 'agent', state: 'taken_down', days_overdue: 30 }), ['pay_link'], 'paused already: only the way back');
  assert.deepStrictEqual(keys({ kind: 'agent', state: 'overdue', days_overdue: 3, last_reminder_at: now.toISOString() }), ['pay_link', 'reminder!']);
});

// ---------------------------------------------------------------------------
// 8: look someone up
// ---------------------------------------------------------------------------

test('a number we do not know is said to be unknown, with what to do about it', async () => {
  await withWorld([], async () => {
    const asked = await staffStep(RONALD, 'employee_intake_role', '8');
    assert.strictEqual(asked.nextStep, 'employee_lookup');
    assert.match(asked.message, /phone number\* or a \*name\*/);
    const unknown = await staffStep(RONALD, 'employee_lookup', '0772123456', { employee_role: 'lookup' });
    assert.strictEqual(unknown.nextStep, 'employee_lookup');
    assert.match(unknown.message, /\+256 772 123 456\* is not on makaug/);
    assert.match(unknown.message, /Agent 007\* → \*3\* \(agent\) or \*4\* \(owner\)/);
    const nobody = await staffStep(RONALD, 'employee_lookup', 'Zebedayo', { employee_role: 'lookup' });
    assert.match(nobody.message, /Nobody on makaug matches “Zebedayo”/);
  });
});

test('an agent\'s card: status, money, listings, what we sent, and what can be done', async () => {
  const agent = { id: AGENT_ROWS[0].id, full_name: 'Jane Nakato', company_name: 'JN Homes', whatsapp: '+256701000111', status: 'approved', paid_until: dayOffset(-12), fee_exempt: false, makaug_agent_number: 'MK-A-0042' };
  await withWorld([
    [/FROM agents\s+WHERE RIGHT\(REGEXP_REPLACE\(COALESCE\(whatsapp/i, () => [agent]],
    [/FROM agents/i, () => [agent]],
    [/COUNT\(\*\)::int AS n FROM properties WHERE agent_id/i, () => [{ status: 'approved', n: 12 }, { status: 'pending', n: 2 }, { status: 'sold', n: 1 }]],
    [/FROM pay_links/i, () => [{ code: 'MKAAAA11', status: 'open', sent_at: daysAgo(5), opened_at: null }]],
    [/FROM whatsapp_messages/i, () => [{ direction: 'inbound', at: daysAgo(1) }, { direction: 'outbound', at: daysAgo(0) }]]
  ], async ({ getSession }) => {
    const card = await staffStep(RONALD, 'employee_lookup', '0701000111', { employee_role: 'lookup' });
    assert.strictEqual(card.nextStep, 'employee_lookup_action');
    assert.match(card.message, /🔎 \*Jane Nakato\*/);
    assert.match(card.message, /agent, approved\* · JN Homes · MK-A-0042/);
    assert.match(card.message, /❗ overdue since/);
    assert.match(card.message, /12 live · 2 in review · 1 sold/);
    assert.match(card.message, /makaug\.com\/agents\/aaaaaaaa/);
    assert.match(card.message, /Last payment link: sent .+, not opened yet/);
    assert.match(card.message, /\*1\* · Send their payment link/);
    assert.match(card.message, /\*2\* · Send the how-to-post video/);
    assert.strictEqual(getSession().lookup_phone, '256701000111');
  });
});

test('a found-online number is never offered anything to send', () => {
  const dossier = { known: true, phone: OWNER, found_online: true, agent: null, own_listings: [], films: [], prospect: { full_name: 'X', status: 'pitched' }, agent_listings: {} };
  assert.deepStrictEqual(controlRoom.lookupActions(dossier), []);
  assert.match(controlRoom.lookupCardMessage(dossier), /found-online\* listing\. We never message this number/);
  const dnc = { ...dossier, found_online: false, prospect: { full_name: 'X', status: 'pitched', do_not_contact: true } };
  assert.deepStrictEqual(controlRoom.lookupActions(dnc), []);
  assert.match(controlRoom.lookupCardMessage(dnc), /do not contact again/);
});

test('several people with one name are listed with their last three digits only', () => {
  const message = controlRoom.lookupPickMessage([
    { name: 'Sarah Nakato', company: 'Independent broker', note: 'agent, approved', phone: '256701000102' },
    { name: 'Sarah Nakato', company: '', note: 'private owner', phone: '256772123456' }
  ], 'Sarah');
  assert.match(message, /\*1\* · Sarah Nakato \(Independent broker\) — agent, approved · …102/);
  assert.match(message, /\*2\* · Sarah Nakato — private owner · …456/);
  assert.doesNotMatch(message, /256701000102|256772123456/);
});

// ---------------------------------------------------------------------------
// An owner looking after their own listing
// ---------------------------------------------------------------------------

test('what counts as REMOVE, STATUS and HELP from an owner', () => {
  for (const yes of ['REMOVE', 'remove my property', 'Please remove my listing from makaug', 'take it down', 'delete my house', 'unlist my plot please', 'cancel my listing']) {
    assert.strictEqual(ownerListing.isRemoveRequest(yes), true, yes);
  }
  for (const no of ['remove me', 'remove my number', 'REMOVE MK-20261114-EC7E2F', 'cancel', 'I want to remove the sitting room photo', 'how do I remove bad tenants']) {
    assert.strictEqual(ownerListing.isRemoveRequest(no), false, no);
  }
  for (const yes of ['STATUS', 'my listing', 'is it live yet', 'Is my property approved?', 'when will it go live']) assert.strictEqual(ownerListing.isStatusRequest(yes), true, yes);
  for (const no of ['my house is big', 'status of land in Mukono', 'hello']) assert.strictEqual(ownerListing.isStatusRequest(no), false, no);
  for (const yes of ['help', 'I need to talk to a person', 'call me']) assert.strictEqual(ownerListing.isHelpRequest(yes), true, yes);
  assert.strictEqual(ownerListing.isHelpRequest('help me find a house in Kira'), false);
});

const OWNER_LISTING = { id: 'cccccccc-0000-4000-8000-000000000001', title: '3 Bedroom House In Kira', status: 'approved', lister_name: 'Sarah Nakato', lister_phone: '+256772123456', inquiry_reference: 'MK-20261114-B969DC', created_at: daysAgo(2), reviewed_at: daysAgo(2), lister_paid_until: null };
const ownerWorld = (listings, extra = []) => [
  ...extra,
  [/FROM properties\s+WHERE agent_id IS NULL AND NOT[\s\S]+LOWER\(COALESCE\(status, ''\)\) = ANY/i, (_sql, params) => listings.filter((row) => params[1].includes(String(row.status).toLowerCase()))]
];

test('REMOVE asks first, removes on YES, and tells the team', async () => {
  await withWorld(ownerWorld([OWNER_LISTING]), async ({ calls }) => {
    const asked = await route.handleOwnerListingCommand({ phone: OWNER, body: 'Please remove my property', step: 'main_menu', session: { session_data: {} } });
    assert.strictEqual(asked.nextStep, 'owner_remove_confirm');
    assert.match(asked.message, /Take \*3 Bedroom House In Kira \(MK-20261114-B969DC\)\* off makaug\?/);
    assert.match(asked.message, /reply \*SOLD\* instead/);
    assert.ok(!calls.some((c) => /UPDATE properties/i.test(c.sql)), 'nothing is removed on the first message');
  });
  await withWorld(ownerWorld([OWNER_LISTING], [[/UPDATE properties\s+SET status = 'hidden'/i, () => [{ id: OWNER_LISTING.id }]]]), async ({ calls, text }) => {
    const session = { session_data: { owner_remove: { ids: [OWNER_LISTING.id] } } };
    const unclear = await route.handleOwnerListingCommand({ phone: OWNER, body: 'hmm', step: 'owner_remove_confirm', session });
    assert.match(unclear.message, /Reply \*YES\* to take it off makaug, or \*NO\* to keep it/);
    const done = await route.handleOwnerListingCommand({ phone: OWNER, body: 'Yes', step: 'owner_remove_confirm', session });
    assert.strictEqual(done.nextStep, 'main_menu');
    assert.match(done.message, /is off makaug\.com/);
    assert.match(done.message, /Nothing more is charged/);
    const update = calls.find((c) => /UPDATE properties\s+SET status = 'hidden'/i.test(c.sql));
    assert.strictEqual(update.params[1], '772123456', 'only their own listing, by their own number');
    await settle(150);
    assert.match(text(), /A private owner removed their listing/);
  });
  await withWorld(ownerWorld([OWNER_LISTING]), async ({ calls }) => {
    const kept = await route.handleOwnerListingCommand({ phone: OWNER, body: 'No', step: 'owner_remove_confirm', session: { session_data: { owner_remove: { ids: [OWNER_LISTING.id] } } } });
    assert.match(kept.message, /nothing changed/);
    assert.ok(!calls.some((c) => /UPDATE properties\s+SET status = 'hidden'/i.test(c.sql)));
  });
});

test('with several listings the owner picks one; with none, nothing is promised', async () => {
  const second = { ...OWNER_LISTING, id: 'cccccccc-0000-4000-8000-000000000002', title: 'Plot in Mukono', status: 'pending', inquiry_reference: 'MK-20261114-AAAAAA' };
  await withWorld(ownerWorld([OWNER_LISTING, second]), async () => {
    const asked = await route.handleOwnerListingCommand({ phone: OWNER, body: 'remove', step: 'main_menu', session: { session_data: {} } });
    assert.strictEqual(asked.nextStep, 'owner_remove_pick');
    assert.match(asked.message, /\*1\* · 3 Bedroom House In Kira/);
    assert.match(asked.message, /\*2\* · Plot in Mukono .+ — in review/);
    const picked = await route.handleOwnerListingCommand({ phone: OWNER, body: '2', step: 'owner_remove_pick', session: { session_data: { owner_remove: { ids: [OWNER_LISTING.id, second.id] } } } });
    assert.strictEqual(picked.nextStep, 'owner_remove_confirm');
    assert.match(picked.message, /Take \*Plot in Mukono/);
  });
  await withWorld(ownerWorld([]), async () => {
    assert.strictEqual(await route.handleOwnerListingCommand({ phone: OWNER, body: 'remove', step: 'main_menu', session: { session_data: {} } }), null);
    assert.strictEqual(await route.handleOwnerListingCommand({ phone: OWNER, body: 'status', step: 'main_menu', session: { session_data: {} } }), null);
  });
});

test('STATUS tells an owner where their property is, and "thanks" after sending one is answered', async () => {
  const pending = { ...OWNER_LISTING, status: 'pending', created_at: hoursAgo(0.2) };
  await withWorld(ownerWorld([pending]), async () => {
    const status = await route.handleOwnerListingCommand({ phone: OWNER, body: 'is it live yet', step: 'main_menu', session: { session_data: {} } });
    assert.match(status.message, /Your property on makaug, Sarah/);
    assert.match(status.message, /With our team for review/);
    const thanks = await route.handleOwnerListingCommand({ phone: OWNER, body: 'Thanks', step: 'submitted', session: { session_data: {} } });
    assert.match(thanks.message, /You're welcome, Sarah/);
    assert.match(thanks.message, /usually within 24 hours/);
  });
  await withWorld(ownerWorld([OWNER_LISTING]), async () => {
    const live = await route.handleOwnerListingCommand({ phone: OWNER, body: 'status', step: 'main_menu', session: { session_data: {} } });
    assert.match(live.message, /✅ Live\. The first month \(UGX 20,000\) is not paid yet/);
    assert.match(live.message, /Reply \*SOLD\*.+Reply \*REMOVE\*/);
    // Two days on, "thanks" is not about the submission any more.
    assert.strictEqual(await route.handleOwnerListingCommand({ phone: OWNER, body: 'Thanks', step: 'main_menu', session: { session_data: {} } }), null);
  });
});

test('HELP from an owner reaches a person, not the menu', async () => {
  await withWorld(ownerWorld([OWNER_LISTING]), async ({ text }) => {
    const help = await route.handleOwnerListingCommand({ phone: OWNER, body: 'HELP', step: 'main_menu', session: { session_data: {} } });
    assert.match(help.message, /help is on the way/);
    assert.match(help.message, /Ronald/);
    await settle(150);
    assert.match(text(), /A private owner asked for help on WhatsApp/);
    assert.match(text(), /wa\.me\/256772123456/);
  });
});

test('staff and approved agents keep their own STATUS and HELP', async () => {
  await withWorld(ownerWorld([OWNER_LISTING]), async () => {
    assert.strictEqual(await route.handleOwnerListingCommand({ phone: ARTHUR, body: 'status', step: 'main_menu', session: { session_data: {} } }), null);
  });
  await withWorld(ownerWorld([OWNER_LISTING], [[/FROM agents/i, () => [{ id: 'a1', full_name: 'Kato Brian', status: 'approved' }]]]), async () => {
    assert.strictEqual(await route.handleOwnerListingCommand({ phone: OWNER, body: 'help', step: 'main_menu', session: { session_data: {} } }), null);
  });
});

// ---------------------------------------------------------------------------
// Sold, seven days on
// ---------------------------------------------------------------------------

test('a sold listing\'s lister is told once when its week is up', async () => {
  const rows = [
    { id: 's1', title: 'House in Wamala', listing_type: 'sale', availability_status: 'sold', agent_id: 'a1', agent_name: 'Gilbert K', agent_greeting_name: 'Gilbert', agent_phone: '+256701000555', agent_status: 'approved', agent_removed_at: null },
    { id: 's2', title: '2 bed flat in Ntinda', listing_type: 'rent', availability_status: 'let_agreed', agent_id: null, lister_name: 'Sarah Nakato', lister_phone: '0772123456' },
    { id: 's3', title: 'Plot in Gayaza', listing_type: 'land', agent_id: 'a2', agent_name: 'Gone Agent', agent_phone: '+256701000666', agent_status: 'approved', agent_removed_at: daysAgo(1) }
  ];
  const updates = [];
  const fake = {
    query: async (sql, params = []) => {
      if (/FROM properties p\s+LEFT JOIN agents a/i.test(sql)) {
        assert.match(sql, /NOT \(COALESCE\(p\.extra_fields, '\{\}'::jsonb\) \? 'sold_off_notice_at'\)/, 'never the same listing twice');
        assert.deepStrictEqual(params, [7, 3], 'seven days sold, and no older than three days past that');
        return { rows };
      }
      if (/UPDATE properties/i.test(sql)) { updates.push(params); return { rows: [] }; }
      return { rows: [] };
    }
  };
  const sent = [];
  const team = [];
  const result = await ownerListing.runSoldOffNotices(fake, {
    deliver: async (to, body) => { sent.push({ to, body }); return { status: 'queued' }; },
    notifyTeam: async (body) => { team.push(body); }
  });
  assert.deepStrictEqual(result, { told: 2, checked: 3 });
  assert.deepStrictEqual(sent.map((m) => m.to), ['256701000555', '0772123456'], 'not the agent who has left');
  assert.match(sent[0].body, /\*House in Wamala\* has now come off makaug\.com, Gilbert\. It showed as SOLD for 7 days/);
  assert.match(sent[0].body, /Got the next one\? Send it here/);
  assert.match(sent[1].body, /It showed as LET for 7 days/);
  assert.match(sent[1].body, /Reply \*LIST\*/);
  assert.strictEqual(updates.length, 3, 'all three are written down, sent or not');
  assert.strictEqual(updates[2][1], 'skipped');
  assert.strictEqual(team.length, 1);
  assert.match(team[0], /2 sold listings came off the site today/);
});

test('the sold notice runs with the daily billing reminders', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/billingOpsService.js'), 'utf8');
  assert.match(source, /runSoldOffNotices\(db\)/);
});

// ---------------------------------------------------------------------------
// The films
// ---------------------------------------------------------------------------

test('the four films are in the repository, small enough for WhatsApp', () => {
  const films = route.EXPLAINER_VIDEOS;
  assert.deepStrictEqual(Object.keys(films).sort(), ['agent', 'agent_howto', 'lister', 'owner']);
  for (const [kind, film] of Object.entries(films)) {
    const file = path.join(__dirname, '..', film.path);
    assert.ok(fs.existsSync(file), `${kind}: ${film.path}`);
    const size = fs.statSync(file).size;
    assert.ok(size > 300 * 1024, `${kind} is a real film (${size} bytes)`);
    assert.ok(size < 16 * 1024 * 1024, `${kind} fits WhatsApp's 16 MB (${size} bytes)`);
    assert.doesNotMatch(film.caption, /free (?:trial|days|week)/i, kind);
  }
  assert.match(films.lister.caption, /UGX 20,000 a month per property/);
  assert.match(require('../services/agentHowToPostBroadcastService').videoUrl(), /makaug-agent-how-to-post-v3\.mp4$/);
});
