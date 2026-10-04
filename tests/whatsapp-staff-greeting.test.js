'use strict';

/**
 * "Hello" from somebody who works here.
 *
 * 4 Oct 2026, 09:02. Arthur had spent the morning on this number running staff
 * intake — a batch for Francis Isabirye closed at 08:53 — typed "Hello", and
 * got the marketplace's customer greeting:
 *
 *   "I want to sell my house in Rubaga"
 *   "I need a 2-bedroom rental in Ntinda"
 *   "Find me an agent in Wakiso"
 *   You can also reply LIST, SEARCH or AGENT.
 *
 * The agent menu built on 30 Sep answers this properly, but only for rows in
 * the agents table, and the people who run intake are not agents. There was no
 * branch for them at all, so they fell through to the consumer script.
 *
 * The signal has to come from the session's own history. The staff allowlist
 * cannot be used: employeeIntakePhoneAllowed returns true for EVERY number when
 * WHATSAPP_EMPLOYEE_INTAKE_NUMBERS is unset, so keying off it would hand the
 * staff menu to every customer who said hello.
 */

const test = require('node:test');
const assert = require('node:assert');

const route = require('../routes/whatsapp').__test;
const { employeeIntakePhoneAllowed } = require('../services/whatsappEmployeeIntakeService');

const { staffIntakeGreetingReply } = route;

const ARTHUR = '+447757773202';
const STRANGER = '+256700111222';

// His session as it stood at 09:02, after the Francis Isabirye batch closed.
const afterABatch = {
  session_data: {
    employee_intake_last_completed_at: '2026-10-04T07:53:56.000Z',
    employee_intake_last_subject_name: 'Francis Isabirye',
    employee_intake_last_properties_set_up: 1
  }
};

test('staff are not handed the customer menu', () => {
  const reply = staffIntakeGreetingReply({ phone: ARTHUR, session: afterABatch, cleanBody: 'Hello' });
  assert.ok(reply, 'saying hello after running a batch must be answered as staff');
  assert.match(reply, /Agent 007/, 'the way they post is the thing to tell them');
  assert.match(reply, /COMPLETE/);
  assert.doesNotMatch(reply, /sell my house|2-bedroom rental|Find me an agent|reply LIST, SEARCH or AGENT/i,
    'this is the customer script, and it is for customers');
});

test('their last batch is recalled, so hello has a thread to pick up', () => {
  const reply = staffIntakeGreetingReply({ phone: ARTHUR, session: afterABatch, cleanBody: 'Hello' });
  assert.match(reply, /Francis Isabirye/);
  assert.match(reply, /1 property/, 'one property, not "1 properties"');
  assert.match(reply, /staff review/);
});

test('a staff member asking how to post is told how, not given a menu', () => {
  const reply = staffIntakeGreetingReply({ phone: ARTHUR, session: afterABatch, cleanBody: 'how do I post' });
  assert.match(reply, /Agent 007/);
  assert.match(reply, /exact location and price/, 'what a caption needs is the answer to that question');
});

// ---------------------------------------------------------------------------
// The leak this must not become
// ---------------------------------------------------------------------------

test('a customer saying hello is still a customer', () => {
  for (const session of [{}, { session_data: {} }, { session_data: { lang: 'lg' } }]) {
    assert.strictEqual(staffIntakeGreetingReply({ phone: STRANGER, session, cleanBody: 'Hello' }), '',
      'nothing here may divert an ordinary greeting away from the marketplace');
  }
});

test('the staff allowlist is exactly the wrong signal to use', () => {
  // Unset, it waves everybody through — which is why the check above reads the
  // session instead.
  assert.strictEqual(
    employeeIntakePhoneAllowed(STRANGER, { allowlist: '' }),
    true,
    'if this ever gated the greeting, every customer would get the staff menu'
  );
  assert.strictEqual(
    staffIntakeGreetingReply({ phone: STRANGER, session: { session_data: {} }, cleanBody: 'Hello' }),
    '',
    'and it does not gate the greeting'
  );
});

test('an owner phone is only an owner phone when one is configured', () => {
  const saved = {
    a: process.env.AI_CEO_OWNER_PHONES,
    b: process.env.AI_CEO_OWNER_PHONE,
    c: process.env.FOUNDER_PHONE,
    d: process.env.FOUNDER_WHATSAPP,
    e: process.env.SUPER_ADMIN_PHONE
  };
  for (const key of ['AI_CEO_OWNER_PHONES', 'AI_CEO_OWNER_PHONE', 'FOUNDER_PHONE', 'FOUNDER_WHATSAPP', 'SUPER_ADMIN_PHONE']) {
    delete process.env[key];
  }
  try {
    assert.strictEqual(
      staffIntakeGreetingReply({ phone: STRANGER, session: { session_data: {} }, cleanBody: 'Hello' }),
      '',
      'with nothing configured, nobody is the owner'
    );
  } finally {
    for (const [key, value] of [
      ['AI_CEO_OWNER_PHONES', saved.a], ['AI_CEO_OWNER_PHONE', saved.b], ['FOUNDER_PHONE', saved.c],
      ['FOUNDER_WHATSAPP', saved.d], ['SUPER_ADMIN_PHONE', saved.e]
    ]) {
      if (value !== undefined) process.env[key] = value;
    }
  }
});

test('an open session alone is not enough — they must have used the flow', () => {
  // A session exists the moment somebody types "Agent 007". Having answered who
  // the batch is for is what marks them out.
  assert.strictEqual(
    staffIntakeGreetingReply({ phone: STRANGER, session: { session_data: { whatsapp_employee_intake: true } }, cleanBody: 'Hello' }),
    ''
  );
  assert.ok(
    staffIntakeGreetingReply({ phone: STRANGER, session: { session_data: { employee_role: 'agent' } }, cleanBody: 'Hello' })
  );
});

// ---------------------------------------------------------------------------
// The agent menu still comes first
// ---------------------------------------------------------------------------

test('a registered agent still gets the agent menu, by name', () => {
  const menu = route.agentMenuReply({
    agent: { id: 'a-1', full_name: 'Katamba Bonny', phone: '256701895892', whatsapp: '256701895892' },
    greet: true
  });
  assert.match(menu, /Hello Katamba/);
  assert.match(menu, /Post a property/);
  assert.doesNotMatch(menu, /Staff intake/, 'an agent is not staff, and gets their own menu');
});
