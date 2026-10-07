'use strict';

/**
 * Option 4: send somebody the payment link.
 *
 * Until now a payment link only ever left the building at one moment — when a
 * moderator approved a new agent. Anybody who said "yes, I will pay" at any
 * other moment (an agent who has been live for weeks, somebody met at a
 * viewing, one of the seventeen agents who list free and offered to pay
 * anyway) could not be sent one from WhatsApp at all. Ronald's only route was
 * to ask somebody with the admin dashboard open.
 *
 * Now: 4 → registered agent or new prospect → confirm who → the link goes, and
 * the reference code comes back to whoever asked for it, because that code is
 * the Mobile Money reference and without it a payment that arrives cannot be
 * matched to the person who made it.
 *
 * The loop closes on the reference: the link records that it was sent, so
 * payLinksAwaitingPayment can later list everybody who was asked for money and
 * has gone quiet.
 */

const test = require('node:test');
const assert = require('node:assert');

const db = require('../config/database');
const route = require('../routes/whatsapp').__test;
const intake = require('../services/whatsappEmployeeIntakeService');
const payLinks = require('../services/payLinkService');

const RONALD = '+256709402189';

// ---------------------------------------------------------------------------
// The menu and the parsers
// ---------------------------------------------------------------------------

test('the menu offers a fourth thing to do, with the price on it', () => {
  const prompt = intake.employeeRolePrompt('UGX 50,000');
  assert.match(prompt, /4 — /, 'there must be a fourth option');
  assert.match(prompt, /payment link/i);
  assert.match(prompt, /UGX 50,000/, 'the amount, so nobody has to remember it');
  // The three that were already there must still read the same.
  assert.match(prompt, /1 — An \*agent or broker\*/);
  assert.match(prompt, /2 — A \*private owner\*/);
  assert.match(prompt, /3 — No properties yet/);
});

test('"4" is the payment link, and the other answers are unchanged', () => {
  assert.strictEqual(intake.parseEmployeeRole('4'), 'pay_link');
  for (const spelling of ['payment link', 'pay link', 'send payment link', 'PAYMENT']) {
    assert.strictEqual(intake.parseEmployeeRole(spelling), 'pay_link', `"${spelling}"`);
  }
  assert.strictEqual(intake.parseEmployeeRole('1'), 'agent');
  assert.strictEqual(intake.parseEmployeeRole('2'), 'customer');
  assert.strictEqual(intake.parseEmployeeRole('3'), 'pitch');
});

test('registered or prospect is the first question, and it has only two answers', () => {
  assert.strictEqual(intake.parsePayLinkWho('1'), 'registered');
  assert.strictEqual(intake.parsePayLinkWho('2'), 'prospect');
  assert.strictEqual(intake.parsePayLinkWho('registered'), 'registered');
  assert.strictEqual(intake.parsePayLinkWho('new prospect'), 'prospect');
  assert.strictEqual(intake.parsePayLinkWho('maybe'), '', 'anything else must re-ask, not guess');
  const prompt = intake.employeePayLinkWhoPrompt('UGX 50,000');
  assert.match(prompt, /already registered/i);
  assert.match(prompt, /new prospect/i);
  assert.match(prompt, /joining video/i, 'a prospect must be told the film comes too');
});

test('the registered branch asks for the name the way the listing flow does', () => {
  assert.match(intake.employeePayLinkLookupPrompt(), /confirm the name of the agent/i);
});

test('all four new steps are steps the flow recognises', () => {
  for (const step of [
    'employee_pay_link_who',
    'employee_pay_link_lookup',
    'employee_pay_link_confirm',
    'employee_pay_link_prospect'
  ]) {
    assert.ok(intake.isEmployeeIntakeStep(step), `${step} is not registered, so the flow would ignore it`);
  }
});

// ---------------------------------------------------------------------------
// The whole exchange, against the real state machine
// ---------------------------------------------------------------------------

function withStubbedWorld(run, { agents = [], feeExempt = false } = {}) {
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  const sent = [];
  const payLinkRows = [];
  const agentUpdates = [];
  let session = null;
  let prospect = null;
  let sentStamp = null;

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
      prospect = { full_name: params[0], phone: params[1], phone_key: params[2], metadata: params[6] };
      return { rows: [{ ...prospect, status: 'pitched', newly_created: true }] };
    }
    if (/FROM billing_settings/i.test(sql)) return { rows: [] };
    if (/INSERT INTO pay_links/i.test(sql)) {
      const row = {
        id: `link-${payLinkRows.length + 1}`,
        code: 'MKTEST1234',
        purpose: params[1],
        agent_id: params[3],
        description: params[6],
        amount_ugx: params[7],
        card_currency: params[8],
        card_amount_minor: params[9],
        payer_name: params[11],
        payer_phone: params[12],
        created_by: params[13],
        status: 'open'
      };
      payLinkRows.push(row);
      return { rows: [row] };
    }
    if (/UPDATE pay_links/i.test(sql)) {
      sentStamp = { code: params[0], to: params[1], status: params[2] };
      return { rows: [payLinkRows[0] || {}] };
    }
    if (/FROM pay_links/i.test(sql)) {
      // loadLink (pageData) asks by code; the reuse check asks by status.
      if (/WHERE code = \$1/.test(sql)) return { rows: payLinkRows.slice(0, 1) };
      return { rows: [] };
    }
    if (/UPDATE agents/i.test(sql)) {
      agentUpdates.push({ sql, params });
      return { rows: [] };
    }
    if (/FROM agents/i.test(sql)) {
      return { rows: agents.map((agent) => ({ fee_exempt: feeExempt, ...agent })) };
    }
    if (/INSERT INTO audit_logs/i.test(sql)) return { rows: [] };
    return { rows: [] };
  };
  db.getClient = async () => ({ query: db.query, release() {} });

  const at = (step, body, data) => route.handleEmployeeWhatsappIntake({
    phone: RONALD,
    body,
    session: { current_step: step, session_data: data }
  });

  return Promise.resolve(run({
    at,
    sent,
    payLinkRows,
    agentUpdates,
    getSession: () => session,
    getProspect: () => prospect,
    getSentStamp: () => sentStamp
  })).finally(() => { db.query = originalQuery; db.getClient = originalGetClient; });
}

const AGENT = {
  id: '11111111-1111-1111-1111-111111111111',
  full_name: 'Nakato Grace',
  company_name: 'Grace Homes',
  phone: '0772123456',
  whatsapp: '256772123456',
  email: 'grace@example.com',
  paid_until: null,
  pay_link_sent_at: null
};

test('4 → 1 → a name → confirm, and the link goes with the reference back to Ronald', async () => {
  await withStubbedWorld(async ({ at, sent, payLinkRows, agentUpdates, getSentStamp }) => {
    const chose = await at('employee_intake_role', '4', { whatsapp_employee_intake: true });
    assert.strictEqual(chose.nextStep, 'employee_pay_link_who');
    assert.match(chose.message, /already registered/i);

    const who = await at('employee_pay_link_who', '1', {
      whatsapp_employee_intake: true, employee_role: 'pay_link'
    });
    assert.strictEqual(who.nextStep, 'employee_pay_link_lookup');
    assert.match(who.message, /confirm the name of the agent/i);

    const found = await at('employee_pay_link_lookup', 'Nakato Grace', {
      whatsapp_employee_intake: true, employee_role: 'pay_link', pay_link_target: 'registered'
    });
    assert.strictEqual(found.nextStep, 'employee_pay_link_confirm');
    assert.match(found.message, /1 — Nakato Grace/, 'the same numbered confirmation as the listing flow');

    const done = await at('employee_pay_link_confirm', '1', {
      whatsapp_employee_intake: true,
      employee_role: 'pay_link',
      pay_link_target: 'registered',
      pay_link_candidates: [{ ...AGENT, fee_exempt: false }]
    });

    assert.strictEqual(done.payLinkSent, 'MKTEST1234');
    assert.match(done.message, /Payment link sent/i, 'the exact words Ronald was promised');
    assert.match(done.message, /MKTEST1234/, 'the reference number, which is what makes a payment matchable');
    assert.match(done.message, /UGX 50,000/);
    assert.match(done.message, /\/pay\/MKTEST1234/, 'and the link itself');

    // One link, against the agent's own profile, so the payment settles their
    // subscription rather than floating free of it.
    assert.strictEqual(payLinkRows.length, 1);
    assert.strictEqual(payLinkRows[0].purpose, 'agent_subscription');
    assert.strictEqual(payLinkRows[0].agent_id, AGENT.id);

    // The agent gets the link; Ronald and the owners get the notice.
    const payload = sent.map((p) => JSON.stringify(p)).join(' ');
    assert.ok(sent.length >= 2, 'the agent and at least the requester must both be told');
    assert.match(payload, /MKTEST1234/);
    assert.match(payload, /256772123456/, 'it went to the agent');
    assert.match(payload, /Payment link sent/i, 'the staff notice');
    assert.ok(!/makaug-join-as-agent-v2\.mp4/.test(payload),
      'a registered agent does not need the joining film again');

    // Sent, and written down as sent — without that the loop cannot be closed.
    assert.deepStrictEqual(getSentStamp(), { code: 'MKTEST1234', to: '256772123456', status: 'queued' });
    assert.ok(agentUpdates.some((u) => /pay_link_sent_at = NOW\(\)/.test(u.sql)),
      'the agent row has to record that they have been asked');
  }, { agents: [AGENT] });
});

test('a name nobody matches re-asks and sends nothing', async () => {
  await withStubbedWorld(async ({ at, sent }) => {
    const miss = await at('employee_pay_link_lookup', 'Nobody At All', {
      whatsapp_employee_intake: true, employee_role: 'pay_link', pay_link_target: 'registered'
    });
    assert.strictEqual(miss.nextStep, 'employee_pay_link_lookup');
    assert.match(miss.message, /No approved agent/i);
    assert.match(miss.message, /\*4\* then \*2\*/, 'and the way out, for somebody not registered yet');
    assert.strictEqual(sent.length, 0, 'nothing may go out on a failed search');
  }, { agents: [] });
});

test('an agent with no phone number on file is refused by name, not silently skipped', async () => {
  await withStubbedWorld(async ({ at, sent }) => {
    const refused = await at('employee_pay_link_confirm', '1', {
      whatsapp_employee_intake: true,
      employee_role: 'pay_link',
      pay_link_target: 'registered',
      pay_link_candidates: [{ ...AGENT, phone: '', whatsapp: '', fee_exempt: false }]
    });
    assert.strictEqual(sent.length, 0);
    assert.match(refused.message, /no usable phone number/i);
    assert.match(refused.message, /Accounts tab/, 'and where to fix it');
  }, { agents: [AGENT] });
});

/**
 * Seventeen agents were approved before the monthly fee started and list free
 * for good. createPayLink refuses to bill them on purpose — but several have
 * said they would pay anyway, and refusing their money is its own kind of
 * silly. Staff picking them by name is staff saying they meant it. The
 * exemption is untouched: paying buys goodwill, not paying costs them nothing.
 */
test('an exempt agent can be sent a link, and is still exempt afterwards', async () => {
  await withStubbedWorld(async ({ at, sent, payLinkRows, agentUpdates }) => {
    const done = await at('employee_pay_link_confirm', '1', {
      whatsapp_employee_intake: true,
      employee_role: 'pay_link',
      pay_link_target: 'registered',
      pay_link_candidates: [{ ...AGENT, fee_exempt: true }]
    });

    assert.strictEqual(done.payLinkSent, 'MKTEST1234', 'the link must actually be created');
    assert.strictEqual(payLinkRows.length, 1);
    assert.match(done.message, /voluntary|exemption stays/i, 'and Ronald is told why');
    assert.ok(!agentUpdates.some((u) => /fee_exempt/.test(u.sql)),
      'sending a link must never be what revokes somebody’s exemption');
    assert.ok(sent.length >= 2);
  }, { agents: [{ ...AGENT, fee_exempt: true }], feeExempt: true });
});

/**
 * Who is told what.
 *
 * That an exempt agent is paying by choice is our business, not theirs to read
 * on their own invoice. It went out on the staff note, which was right, but
 * the link's description was also carrying it — and the description is printed
 * on the /pay page the agent opens. So the wording has to appear on exactly
 * one side of the line, and this is the test that holds it there.
 */
test('the agent never sees a word about being exempt — only the team does', async () => {
  await withStubbedWorld(async ({ at, sent, payLinkRows }) => {
    await at('employee_pay_link_confirm', '1', {
      whatsapp_employee_intake: true,
      employee_role: 'pay_link',
      pay_link_target: 'registered',
      pay_link_candidates: [{ ...AGENT, fee_exempt: true }]
    });

    // The description is public: it is on the pay page and in the message.
    assert.strictEqual(payLinkRows[0].description, 'makaug agent subscription — 1 month (Nakato Grace)',
      'the invoice says what they are paying for and nothing else');

    const forbidden = /exempt|voluntar|paying by choice|lists? free|for free/i;
    // Split by who it was addressed to, not by what it mentions — the staff
    // note quotes the agent's number in its body.
    const toAgent = sent.filter((p) => p[0] === '256772123456');
    const toStaff = sent.filter((p) => p[0] !== '256772123456');
    assert.ok(toAgent.length, 'the agent must actually have been sent something');
    for (const message of toAgent) {
      assert.ok(!forbidden.test(JSON.stringify(message)),
        `nothing about the exemption may reach the agent: ${JSON.stringify(message).slice(0, 400)}`);
    }
    assert.ok(toStaff.some((m) => forbidden.test(JSON.stringify(m))),
      'and the team note must still say it, or nobody knows why a free agent got a bill');
  }, { agents: [{ ...AGENT, fee_exempt: true }], feeExempt: true });
});

/**
 * The code is the Mobile Money reference, typed by hand on a phone keypad.
 * Ten characters was too many — every extra one is another chance to mistype
 * it and another payment nobody can match to a person.
 */
test('the reference is eight characters, and the old longer ones still work', () => {
  const code = payLinks.newCode();
  assert.strictEqual(code.length, 8, 'MK plus six');
  assert.match(code, /^MK[A-Z0-9]{6}$/);
  // I, O, 0 and 1 are the characters people actually get wrong.
  assert.ok(!/[IO01]/.test(code.slice(2)), `${code} contains a character that is misread`);

  // 32^6 is 1.07 billion. The /pay page is reachable by anyone holding the
  // code, so it has to stay too expensive to guess at.
  assert.ok(Math.pow(32, 6) > 1e9, 'any shorter and the links become enumerable');

  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) seen.add(payLinks.newCode());
  assert.strictEqual(seen.size, 2000, 'codes must not repeat');
});

test('the search list marks an exempt agent, so nobody bills one by accident', async () => {
  await withStubbedWorld(async ({ at }) => {
    const found = await at('employee_pay_link_lookup', 'Nakato Grace', {
      whatsapp_employee_intake: true, employee_role: 'pay_link', pay_link_target: 'registered'
    });
    assert.match(found.message, /lists free/i);
  }, { agents: [{ ...AGENT, fee_exempt: true }], feeExempt: true });
});

test('4 → 2 → name and number, and the film and the link go out together', async () => {
  await withStubbedWorld(async ({ at, sent, payLinkRows, getProspect }) => {
    const who = await at('employee_pay_link_who', '2', {
      whatsapp_employee_intake: true, employee_role: 'pay_link'
    });
    assert.strictEqual(who.nextStep, 'employee_pay_link_prospect');
    assert.match(who.message, /Name \| phone number/);

    const done = await at('employee_pay_link_prospect', 'Kato Brian | 0772123456', {
      whatsapp_employee_intake: true, employee_role: 'pay_link', pay_link_target: 'prospect'
    });

    assert.strictEqual(done.payLinkSent, 'MKTEST1234');
    assert.match(done.message, /Payment link sent/i);
    assert.match(done.message, /MKTEST1234/);
    assert.match(done.message, /option \*1\*/, 'and what to do when they pay');

    // Both, in that order: a bare payment link from an unknown number is
    // indistinguishable from a scam.
    const payload = sent.map((p) => JSON.stringify(p)).join(' ');
    assert.match(payload, /makaug-join-as-agent-v2\.mp4/, 'the joining film');
    assert.match(payload, /MKTEST1234/, 'and the link');
    const filmIndex = sent.findIndex((p) => JSON.stringify(p).includes('makaug-join-as-agent-v2'));
    const linkIndex = sent.findIndex((p) => /pay\/MKTEST1234/.test(JSON.stringify(p)));
    assert.ok(filmIndex > -1 && linkIndex > filmIndex, 'the film has to arrive before the bill');

    // No agent profile exists yet, so the link stands alone with the fee on it.
    assert.strictEqual(payLinkRows.length, 1);
    assert.strictEqual(payLinkRows[0].purpose, 'other');
    assert.strictEqual(Number(payLinkRows[0].amount_ugx), 50000);
    assert.strictEqual(payLinkRows[0].payer_name, 'Kato Brian');

    const recorded = getProspect();
    assert.ok(recorded, 'they go on the prospects list like any other pitch');
    assert.strictEqual(recorded.phone_key, '772123456');
    assert.match(String(recorded.metadata), /agent_007_option_4/);
    assert.match(String(recorded.metadata), /MKTEST1234/, 'with the reference, so the follow-up knows what was asked for');
  }, { agents: [] });
});

test('a half-written prospect line asks again instead of sending', async () => {
  await withStubbedWorld(async ({ at, sent }) => {
    const again = await at('employee_pay_link_prospect', 'Kato Brian', {
      whatsapp_employee_intake: true, employee_role: 'pay_link', pay_link_target: 'prospect'
    });
    assert.strictEqual(again.nextStep, 'employee_pay_link_prospect');
    assert.strictEqual(sent.length, 0, 'nobody may be billed off half a line');
  }, { agents: [] });
});

test('a short number is refused by name, not swallowed', async () => {
  await withStubbedWorld(async ({ at, sent }) => {
    const refused = await at('employee_pay_link_prospect', 'Kato Brian | 07721234', {
      whatsapp_employee_intake: true, employee_role: 'pay_link', pay_link_target: 'prospect'
    });
    assert.strictEqual(sent.length, 0);
    assert.match(refused.message, /does not look complete|nine digits/i);
  }, { agents: [] });
});

test('an interrupted option 4 comes back to the furthest question answered', () => {
  const recover = (data) => route.recoverInterruptedEmployeeIntakeStep({
    current_step: 'missed_call_need',
    session_data: { whatsapp_employee_intake: true, employee_role: 'pay_link', ...data }
  });
  assert.strictEqual(recover({}), 'employee_pay_link_who');
  assert.strictEqual(recover({ pay_link_target: 'prospect' }), 'employee_pay_link_prospect');
  assert.strictEqual(recover({ pay_link_target: 'registered' }), 'employee_pay_link_lookup');
  assert.strictEqual(
    recover({ pay_link_target: 'registered', pay_link_candidates: [AGENT] }),
    'employee_pay_link_confirm',
    'otherwise the name is retyped and the search runs again'
  );
});

// ---------------------------------------------------------------------------
// Closing the loop
// ---------------------------------------------------------------------------

/**
 * Sending is the easy half. The half that was missing is knowing, days later,
 * which links nobody paid — an open link makes no noise at all.
 */
test('the worklist finds links that went out and were never paid', async () => {
  const originalQuery = db.query;
  let captured = null;
  db.query = async (sql, params) => {
    captured = { sql, params };
    return {
      rows: [
        { code: 'MKAAA11111', sent_at: '2026-10-01T00:00:00Z', opened_at: null, days_waiting: 5, amount_ugx: 50000 },
        { code: 'MKBBB22222', sent_at: '2026-10-02T00:00:00Z', opened_at: '2026-10-02T01:00:00Z', days_waiting: 4, amount_ugx: 50000 }
      ]
    };
  };
  try {
    const waiting = await payLinks.payLinksAwaitingPayment(db, { afterDays: 3 });
    assert.match(captured.sql, /status = 'open'/, 'a paid link is not an open loop');
    assert.match(captured.sql, /sent_at IS NOT NULL/, 'a link nobody sent is not waiting on anybody');
    assert.match(captured.sql, /ORDER BY l\.sent_at ASC/, 'the longest wait is the most urgent');

    // Never-opened and opened-but-unpaid are different problems: one is a
    // delivery question, the other is a money question.
    assert.match(waiting[0].next_step, /never opened/i);
    assert.match(waiting[0].next_step, /send it again/i);
    assert.match(waiting[1].next_step, /has not paid/i);
    assert.match(waiting[0].url, /\/pay\/MKAAA11111$/);
  } finally {
    db.query = originalQuery;
  }
});

test('the counts answer "how many have we sent, and how many paid"', async () => {
  const originalQuery = db.query;
  db.query = async () => ({ rows: [{ created: 9, sent: 8, paid: 3, awaiting_payment: 5, never_opened: 2 }] });
  try {
    const stats = await payLinks.payLinkSendStats(db, { sinceDays: 30 });
    assert.deepStrictEqual(stats, {
      since_days: 30, created: 9, sent: 8, paid: 3, awaiting_payment: 5, never_opened: 2
    });
  } finally {
    db.query = originalQuery;
  }
});

test('a link sent on WhatsApp is stamped as sent, like one sent from the dashboard', async () => {
  const originalQuery = db.query;
  let captured = null;
  db.query = async (sql, params) => {
    captured = { sql, params };
    return { rows: [{ code: 'MKTEST1234' }] };
  };
  try {
    await payLinks.recordPayLinkSent(db, { code: 'mktest1234', to: '+256 772 123 456' });
    assert.match(captured.sql, /UPDATE pay_links/);
    assert.match(captured.sql, /sent_at = NOW\(\)/);
    assert.strictEqual(captured.params[0], 'MKTEST1234', 'codes are stored upper case');
    assert.strictEqual(captured.params[1], '256772123456', 'and the number as digits');
  } finally {
    db.query = originalQuery;
  }
});
