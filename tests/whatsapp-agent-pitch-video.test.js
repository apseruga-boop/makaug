'use strict';

/**
 * Option 3: send somebody the joining film.
 *
 * Ronald meets somebody who might become an agent. Before this, the only way
 * through Agent 007 was "these properties belong to…", and he had no properties
 * — so there was nothing he could choose, and the film that exists for exactly
 * this moment, makaug-join-as-agent-v3.mp4, could only be sent by the bot when
 * a stranger happened to type the right thing.
 *
 * Now: 3 → "Name | phone" → the film goes out with what we are, how listing
 * works and what it costs → he is told it has gone → the prospect is kept until
 * they sign up.
 */

const test = require('node:test');
const assert = require('node:assert');

const db = require('../config/database');
const route = require('../routes/whatsapp').__test;
const intake = require('../services/whatsappEmployeeIntakeService');

const RONALD = '+256709402189';

// ---------------------------------------------------------------------------
// The menu and the parser
// ---------------------------------------------------------------------------

test('the menu offers a third thing to do', () => {
  const prompt = intake.employeeRolePrompt();
  assert.match(prompt, /3 — /, 'there must be a third option');
  assert.match(prompt, /agent video/i);
  assert.match(prompt, /what it costs/i, 'price is the first thing a prospect asks');
  // The two that were already there must still read the same.
  assert.match(prompt, /1 — An \*agent or broker\*/);
  assert.match(prompt, /2 — A \*private owner\*/);
});

test('"3" is the video, and the other answers are unchanged', () => {
  assert.strictEqual(intake.parseEmployeeRole('3'), 'pitch');
  for (const spelling of ['video', 'agent video', 'send the video', 'invite', 'PITCH']) {
    assert.strictEqual(intake.parseEmployeeRole(spelling), 'pitch', `"${spelling}"`);
  }
  assert.strictEqual(intake.parseEmployeeRole('1'), 'agent');
  assert.strictEqual(intake.parseEmployeeRole('2'), 'customer');
  assert.strictEqual(intake.parseEmployeeRole('banana'), '');
});

test('the contact line is name and phone, and nothing else is demanded', () => {
  assert.deepStrictEqual(intake.parsePitchContact('Kato Brian | 0772123456'),
    { fullName: 'Kato Brian', phone: '0772123456' });
  assert.deepStrictEqual(intake.parsePitchContact('Kato Brian\n0772123456'),
    { fullName: 'Kato Brian', phone: '0772123456' });
  // A prospect has no district, company or ID yet, so a bare name is not enough
  // but nothing further is asked for.
  assert.strictEqual(intake.parsePitchContact('Kato Brian'), null);
  assert.strictEqual(intake.parsePitchContact('Kato Brian | 123'), null, 'too few digits to dial');
});

test('the new step is a step the flow recognises', () => {
  assert.ok(intake.isEmployeeIntakeStep('employee_pitch_contact'),
    'an unregistered step id is silently treated as not being in the flow at all');
});

// ---------------------------------------------------------------------------
// The whole exchange, against the real state machine
// ---------------------------------------------------------------------------

function withStubbedWorld(run) {
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  const sent = [];
  let session = null;
  let prospect = null;

  db.query = async (sql, params = []) => {
    if (/UPDATE whatsapp_sessions|INSERT INTO whatsapp_sessions/i.test(sql)) {
      const blob = params.find((p) => typeof p === 'string' && p.trim().startsWith('{'));
      if (blob) session = JSON.parse(blob);
      return { rows: [] };
    }
    if (/INSERT INTO outbound_message_queue/i.test(sql)) {
      sent.push(params);
      return { rows: [{ id: 'queued-1' }] };
    }
    if (/INSERT INTO agent_prospects/i.test(sql)) {
      prospect = { full_name: params[0], phone: params[1], phone_key: params[2], pitched_by: params[4] };
      return { rows: [{ ...prospect, status: 'pitched', newly_created: true }] };
    }
    if (/FROM agents/i.test(sql)) return { rows: [] };
    return { rows: [] };
  };
  db.getClient = async () => ({ query: db.query, release() {} });

  const at = (step, body, data) => route.handleEmployeeWhatsappIntake({
    phone: RONALD,
    body,
    session: { current_step: step, session_data: data }
  });

  return Promise.resolve(run({ at, sent, getSession: () => session, getProspect: () => prospect }))
    .finally(() => { db.query = originalQuery; db.getClient = originalGetClient; });
}

test('3, then a name and a number, and the film is gone', async () => {
  await withStubbedWorld(async ({ at, sent, getSession, getProspect }) => {
    const chose = await at('employee_intake_role', '3', { whatsapp_employee_intake: true });
    assert.strictEqual(chose.nextStep, 'employee_pitch_contact');
    assert.match(chose.message, /Who should it go to/i);
    assert.match(chose.message, /Name \| phone number/);

    const done = await at('employee_pitch_contact', 'Kato Brian | 0772123456', {
      whatsapp_employee_intake: true,
      employee_role: 'pitch'
    });

    assert.strictEqual(done.prospectPitched, true);
    assert.match(done.message, /Video sent to Kato Brian/);
    assert.match(done.message, /256772123456/, 'the number it actually went to, in full');
    assert.match(done.message, /14 days free/, 'Ronald is told what they were told');
    assert.match(done.message, /Agent 007.*\*1\*/s, 'and what to do when they say yes');

    assert.strictEqual(sent.length, 1, 'exactly one message queued');
    const payload = sent.map((p) => JSON.stringify(p)).join(' ');
    assert.match(payload, /makaug-join-as-agent-v3\.mp4/, 'the joining film, not the welcome pack');
    assert.match(payload, /media_type\\?":\\?"video/, 'queued as a video, which is what the bridge now attaches');
    assert.ok(!/UGX 50,000/.test(payload), 'the fee is in the terms they sign, not the pitch'); assert.match(payload, /9 languages/);
    assert.match(payload, /Hello Kato/, 'addressed to them by name');

    const recorded = getProspect();
    assert.ok(recorded, 'the prospect has to be remembered');
    assert.strictEqual(recorded.full_name, 'Kato Brian');
    assert.strictEqual(recorded.phone_key, '772123456');

    assert.strictEqual(getSession()?.employee_intake_last_pitch_name, 'Kato Brian');
  });
});

test('a half-written contact line asks again instead of sending', async () => {
  await withStubbedWorld(async ({ at, sent }) => {
    const again = await at('employee_pitch_contact', 'Kato Brian', {
      whatsapp_employee_intake: true, employee_role: 'pitch'
    });
    assert.strictEqual(again.nextStep, 'employee_pitch_contact');
    assert.strictEqual(sent.length, 0, 'nothing may go out on a half-written line');
  });
});

test('a short number is refused by name, not swallowed', async () => {
  await withStubbedWorld(async ({ at, sent }) => {
    const refused = await at('employee_pitch_contact', 'Kato Brian | 07721234', {
      whatsapp_employee_intake: true, employee_role: 'pitch'
    });
    assert.strictEqual(sent.length, 0);
    assert.match(refused.message, /does not look complete|nine digits/i);
  });
});

test('an interrupted pitch comes back to the same question', () => {
  assert.strictEqual(
    route.recoverInterruptedEmployeeIntakeStep({
      current_step: 'missed_call_need',
      session_data: { whatsapp_employee_intake: true, employee_role: 'pitch' }
    }),
    'employee_pitch_contact',
    'otherwise it restarts at the menu and the name is retyped'
  );
});
