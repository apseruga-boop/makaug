'use strict';

/**
 * 13 Nov 2026. Arthur: "have a look at the chats that have come in this
 * morning, what we should respond, and that the AI learns and responds like
 * that going forward." Every case below is a real message from that morning.
 *
 *   Emirates property services, 10:04, to the Morning Brief: "That's good boss"
 *     -> was "I can help with that. Tell me what you need" (the menu)
 *   Ronald, 08:35: "I WANT TO POST HOUSES"
 *     -> was five customer listing questions, then the staff menu
 *   A broker, 04:33: "I'm not able to list my properties as a broker Is the free
 *     time up after 1 days listing" -> "Ronald will reach out", and nobody was told
 *   The same number, 09:55: Agent 007 (not a staff number), "Benard gaita" + "007"
 *     -> no agent found; then "Benard Gaita/+256…/…/Wakiso district" refused twice
 */
const test = require('node:test');
const assert = require('node:assert');

const db = require('../config/database');
const playbook = require('../services/whatsappReplyPlaybook');
const intake = require('../services/whatsappEmployeeIntakeService');
const route = require('../routes/whatsapp').__test;

const RONALD = '+256709402189';
const ARTHUR = '+447757773202';
const STRANGER = '+256700123616';
const BENARD = {
  id: '00bb9387-fca5-4ae6-b420-e9000cc61597',
  makaug_agent_number: 'MKA-AG-7173582',
  full_name: 'Benard Gaita',
  greeting_name: 'Benard',
  company_name: 'Independent broker',
  phone: '+256754312507',
  whatsapp: '+256754312507',
  email: null,
  status: 'approved'
};

// ---------------------------------------------------------------------------
// Praise
// ---------------------------------------------------------------------------

test('praise is its own kind of reply, and "ok" is still an ok', () => {
  for (const text of ["That's good boss", 'Very good', 'Nice one', 'Good stuff sir', 'This is helpful', 'Great info', 'Well done team', 'Educative']) {
    assert.strictEqual(playbook.replyKind(text), 'praise', text);
  }
  assert.strictEqual(playbook.replyKind("Okay. That's interesting"), 'ack', 'Benard on 12 Nov: unchanged');
  assert.strictEqual(playbook.replyKind('Ok'), 'ack');
  assert.strictEqual(playbook.replyKind('Noted boss'), 'ack');
  assert.strictEqual(playbook.replyKind('Thanks boss'), 'thanks');
  assert.strictEqual(playbook.replyKind('Good morning, I need a house in Kira'), '', 'a request is not praise');
});

test('praise of the Morning Brief gets a thank-you; praise of anything else gets nothing', () => {
  const brief = '☀️ *makaug Morning Brief* · Fri 13 Nov\n5 property stories that affect your business';
  assert.strictEqual(playbook.praiseReply({ first: 'Emirates', role: 'agent', lastSent: brief }),
    'Glad it helps, Emirates! 🙌 The Morning Brief comes every day at 7am.');
  assert.strictEqual(playbook.praiseReply({ first: 'Emirates', role: 'agent', lastSent: '🎉 *Your property is live on makaug.com*' }), '');
  assert.strictEqual(playbook.praiseReply({ first: 'Kato', role: 'other', lastSent: brief }), '', 'only agents get the brief');
});

// ---------------------------------------------------------------------------
// Agent 007: who may use it, and "I want to post"
// ---------------------------------------------------------------------------

function withWorld(run, { agents = [] } = {}) {
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  const sessions = [];
  db.query = async (sql, params = []) => {
    if (/UPDATE whatsapp_sessions|INSERT INTO whatsapp_sessions/i.test(sql)) {
      sessions.push({ step: params[1], data: params.find((p) => typeof p === 'string' && p.trim().startsWith('{')) });
      return { rows: [] };
    }
    if (/FROM agents/i.test(sql) && /status = 'approved'/i.test(sql)) {
      const hits = agents.filter((agent) => {
        const key = String(agent.whatsapp || agent.phone).replace(/\D/g, '').slice(-9);
        const text = JSON.stringify(params).toLowerCase();
        return text.includes(key) || (Array.isArray(params[3]) && params[3].length >= 2
          && params[3].every((like) => agent.full_name.toLowerCase().includes(like.replace(/%/g, ''))));
      });
      return { rows: hits };
    }
    return { rows: [] };
  };
  db.getClient = async () => ({ query: db.query, release() {} });
  const at = (phone, step, body, data = {}) => route.handleEmployeeWhatsappIntake({ phone, body, session: { current_step: step, session_data: data } });
  return Promise.resolve(run({ at, sessions })).finally(() => { db.query = originalQuery; db.getClient = originalGetClient; });
}

test('Agent 007 is Arthur\'s and Ronald\'s: anyone else is told where to go, and nothing stays open', async () => {
  const before = process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS;
  delete process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS;
  try {
    assert.strictEqual(intake.employeeIntakePhoneAllowed(RONALD), true);
    assert.strictEqual(intake.employeeIntakePhoneAllowed(ARTHUR), true);
    assert.strictEqual(intake.employeeIntakePhoneAllowed('256709402189'), true);
    assert.strictEqual(intake.employeeIntakePhoneAllowed(STRANGER), false, 'unset no longer means everybody');
    assert.strictEqual(intake.employeeIntakePhoneAllowed(STRANGER, { allowlist: '256700123616' }), true, 'the environment list still decides when set');
    await withWorld(async ({ at, sessions }) => {
      const menu = await at(RONALD, 'main_menu', 'Agent 007');
      assert.strictEqual(menu.nextStep, 'employee_intake_role');

      const refused = await at(STRANGER, 'main_menu', 'Agent 007');
      assert.strictEqual(refused.nextStep, 'main_menu');
      assert.match(refused.message, /Agent 007 is for the makaug team only/);
      assert.match(refused.message, /MENU\* and choose 1/);

      // The stranger stuck half way through adding Benard as a new agent.
      const stuck = await at(STRANGER, 'employee_new_agent_details', 'Benard Gaita/+256754312507/Kampala and Beyond property agency/Wakiso district', { employee_role: 'agent' });
      assert.strictEqual(stuck.nextStep, 'main_menu');
      assert.ok(sessions.some((s) => s.step === 'main_menu'), 'the half-finished intake is closed');
    });
    await withWorld(async ({ at }) => {
      const agentTries = await at(BENARD.phone, 'main_menu', 'Agent 007');
      assert.match(agentTries.message, /you don't need it/);
      assert.match(agentTries.message, /post it under your profile/);
    }, { agents: [BENARD] });
  } finally {
    if (before === undefined) delete process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS;
    else process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS = before;
  }
});

test('"I WANT TO POST HOUSES" from Ronald opens Agent 007 straight away', async () => {
  await withWorld(async ({ at }) => {
    const opened = await at(RONALD, 'main_menu', 'I WANT TO POST HOUSES', { employee_intake_last_completed_at: '2026-11-12T14:16:29Z', employee_intake_last_subject_name: 'Smartway homes' });
    assert.strictEqual(opened.handled, true);
    assert.strictEqual(opened.nextStep, 'employee_intake_role');
    assert.match(opened.message, /employee intake/);
    const customerMode = await at(RONALD, 'main_menu', 'I want to post houses', { employee_intake_last_completed_at: '2026-11-12T14:16:29Z', staff_customer_mode: true });
    assert.notStrictEqual(customerMode.nextStep, 'employee_intake_role', 'in customer mode it stays a customer message');
  });
});

test('an approved agent saying "I want to post houses" is told to send the property', async () => {
  await withWorld(async ({ at }) => {
    const told = await at(BENARD.phone, 'main_menu', 'I want to post houses');
    assert.strictEqual(told.handled, true);
    assert.match(told.message, /just send me the property/);
  }, { agents: [BENARD] });
});

// ---------------------------------------------------------------------------
// Agent 007: finding Benard, and not adding him twice
// ---------------------------------------------------------------------------

test('"Benard gaita" with "007" on the next line finds Benard Gaita', async () => {
  await withWorld(async ({ at }) => {
    const found = await at(RONALD, 'employee_agent_lookup', 'Benard gaita\n007', { employee_role: 'agent', agent_already_registered: true });
    assert.strictEqual(found.nextStep, 'employee_agent_confirm', found.message);
    assert.match(found.message, /1 — Benard Gaita/);
    const byPhone = await at(RONALD, 'employee_agent_lookup', '0754 312 507', { employee_role: 'agent', agent_already_registered: true });
    assert.match(byPhone.message, /1 — Benard Gaita/, 'his number finds him too');
    const reversed = await at(RONALD, 'employee_agent_lookup', 'gaita benard', { employee_role: 'agent', agent_already_registered: true });
    assert.match(reversed.message, /1 — Benard Gaita/, 'and the words in any order');
  }, { agents: [BENARD] });
});

test('details written with "/" are read, and an agent who is already approved is not added again', async () => {
  assert.deepStrictEqual(intake.parseNewAgentDetails('Benard Gaita/+256754312507/Kampala and Beyond property agency/Wakiso district'),
    { fullName: 'Benard Gaita', phone: '+256754312507', company: 'Kampala and Beyond property agency', district: 'Wakiso' });
  assert.deepStrictEqual(intake.parseNewAgentDetails('Benard Gaita +256754312507 / Wakiso'),
    { fullName: 'Benard Gaita', phone: '+256754312507', company: 'Independent agent', district: 'Wakiso' });
  assert.deepStrictEqual(intake.parseNewAgentDetails('Kato Brian | 0772123456 | Wakiso'),
    { fullName: 'Kato Brian', phone: '0772123456', company: 'Independent agent', district: 'Wakiso' }, 'the format we ask for is unchanged');
  assert.strictEqual(intake.parseNewAgentDetails('Kato Brian | 0772123456'), null, 'a district is still needed');

  await withWorld(async ({ at, sessions }) => {
    const reused = await at(RONALD, 'employee_new_agent_details', 'Benard Gaita/+256754312507/Kampala and Beyond property agency/Wakiso district', { employee_role: 'agent', agent_already_registered: false });
    assert.strictEqual(reused.nextStep, 'employee_intake_confirm');
    assert.match(reused.message, /Benard Gaita is already an approved agent on makaug \(MKA-AG-7173582\)/);
    assert.match(reused.message, /No new one is needed/);
    const saved = JSON.parse(sessions.find((s) => s.step === 'employee_intake_confirm').data);
    assert.strictEqual(saved.agent.id, BENARD.id);
    assert.strictEqual(saved.new_agent_details, undefined, 'no new agent will be created');
  }, { agents: [BENARD] });

  await withWorld(async ({ at }) => {
    const unclear = await at(RONALD, 'employee_new_agent_details', 'Benard Gaita', { employee_role: 'agent' });
    assert.match(unclear.message, /Kato Brian \| 0772123456 \| Wakiso/, 'the prompt shows an example to copy');
  });
});
