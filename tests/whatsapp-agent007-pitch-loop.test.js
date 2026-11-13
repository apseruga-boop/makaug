'use strict';

/**
 * 13 Nov 2026, 06:49 to 06:54 UK time. Arthur sent the joining film to five
 * prospects in a row: "Agent 007", "3", "Name | phone", five times over,
 * fifteen messages. Now, once a video has gone, the next "Name | phone" sends
 * the next one straight away, for fifteen minutes.
 */
const test = require('node:test');
const assert = require('node:assert');

const db = require('../config/database');
const route = require('../routes/whatsapp').__test;

const ARTHUR = '+447757773202';
const minutesAgo = (m) => new Date(Date.now() - m * 60 * 1000).toISOString();

function withStubbedWorld(run) {
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  const sent = [];
  let session = null;
  db.query = async (sql, params = []) => {
    if (/UPDATE whatsapp_sessions|INSERT INTO whatsapp_sessions/i.test(sql)) {
      const blob = params.find((p) => typeof p === 'string' && p.trim().startsWith('{'));
      if (blob) session = JSON.parse(blob);
      return { rows: [] };
    }
    if (/INSERT INTO outbound_message_queue/i.test(sql)) {
      sent.push(params);
      return { rows: [{ id: `queued-${sent.length}` }] };
    }
    if (/INSERT INTO agent_prospects/i.test(sql)) {
      return { rows: [{ full_name: params[0], phone: params[1], status: 'pitched', newly_created: true }] };
    }
    return { rows: [] };
  };
  db.getClient = async () => ({ query: db.query, release() {} });
  const at = (step, body, data) => route.handleEmployeeWhatsappIntake({
    phone: ARTHUR,
    body,
    session: { current_step: step, session_data: data }
  });
  return Promise.resolve(run({ at, sent, getSession: () => session }))
    .finally(() => { db.query = originalQuery; db.getClient = originalGetClient; });
}

const justPitched = (extra = {}) => ({ employee_intake_last_pitch_at: minutesAgo(1), employee_intake_last_pitch_name: 'Geoff properties', ...extra });

test('right after a video, the next "Name | phone" sends the next one', async () => {
  await withStubbedWorld(async ({ at, sent, getSession }) => {
    const done = await at('main_menu', 'Bob Shan | 0758561835', justPitched());
    assert.strictEqual(done.prospectPitched, true, JSON.stringify(done).slice(0, 200));
    assert.match(done.message, /Video sent to Bob Shan/);
    assert.match(done.message, /256758561835/);
    assert.strictEqual(sent.length, 1, 'one film queued');
    assert.match(JSON.stringify(sent[0]), /makaug-join-as-agent/);
    assert.strictEqual(getSession()?.employee_intake_last_pitch_name, 'Bob Shan', 'and the next one can follow it');
  });
});

test('the confirmation says the next one can follow straight on', async () => {
  await withStubbedWorld(async ({ at }) => {
    const done = await at('employee_pitch_contact', 'Kato Brian | 0772123456', { whatsapp_employee_intake: true, employee_role: 'pitch' });
    assert.match(done.message, /Next one\?/);
    assert.match(done.message, /Name \| phone number\* in the next 15 minutes/);
    assert.match(done.message, /No need for Agent 007 and 3/);
  });
});

test('fifteen minutes after the last video, a name and number is not a pitch', async () => {
  await withStubbedWorld(async ({ at, sent }) => {
    const later = await at('main_menu', 'Bob Shan | 0758561835', justPitched({ employee_intake_last_pitch_at: minutesAgo(16) }));
    assert.notStrictEqual(later.prospectPitched, true);
    assert.strictEqual(sent.length, 0, 'nothing goes to anybody');
  });
});

test('only the bare "Name | phone" line counts', async () => {
  await withStubbedWorld(async ({ at, sent }) => {
    for (const body of [
      'Bob Shan 0758561835',
      'Bob Shan | 0758561835 | Kira',
      'Bob Shan |',
      '| 0758561835',
      '3 bedroom house for sale in Kira\nCall 0758561835',
      'Bob Shan | call him tomorrow'
    ]) {
      const reply = await at('main_menu', body, justPitched());
      assert.notStrictEqual(reply.prospectPitched, true, body);
    }
    assert.strictEqual(sent.length, 0);
  });
});

test('in customer mode the line belongs to the customer script', async () => {
  await withStubbedWorld(async ({ at, sent }) => {
    const reply = await at('main_menu', 'Bob Shan | 0758561835', justPitched({ staff_customer_mode: true }));
    assert.notStrictEqual(reply.prospectPitched, true);
    assert.strictEqual(sent.length, 0);
  });
});

test('a number not allowed to use Agent 007 sends nothing', async () => {
  const before = process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS;
  process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS = '256709402189';
  try {
    await withStubbedWorld(async ({ sent }) => {
      const reply = await route.handleEmployeeWhatsappIntake({
        phone: '+256700111222',
        body: 'Bob Shan | 0758561835',
        session: { current_step: 'main_menu', session_data: justPitched() }
      });
      assert.notStrictEqual(reply.prospectPitched, true);
      assert.strictEqual(sent.length, 0);
    });
  } finally {
    if (before === undefined) delete process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS;
    else process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS = before;
  }
});

test('Agent 007 still opens the menu straight after a video', async () => {
  await withStubbedWorld(async ({ at, sent }) => {
    const menu = await at('main_menu', 'Agent 007', justPitched());
    assert.strictEqual(menu.nextStep, 'employee_intake_role');
    assert.match(menu.message, /employee intake/);
    assert.strictEqual(sent.length, 0);
  });
});
