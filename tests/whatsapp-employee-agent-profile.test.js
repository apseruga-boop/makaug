'use strict';

/**
 * A batch of properties was loaded for Quickway Auctioneers as a private owner
 * because the very first question — agent or new customer — was answered "2".
 * No agent profile was created, so nothing reached the approval queue and
 * nothing could appear on the website. The confirmation step said so in
 * writing; the only thing missing was a way to change that answer.
 *
 * These tests hold the three things that follow from it:
 *
 *  1. "No" at the confirmation can change who the person is, not only their
 *     details, and correcting a detail never asks for the ID a second time.
 *  2. The agent profile is created when the employee confirms, so a wrong first
 *     answer leaves no half-made record behind.
 *  3. Staff can see why a profile is not on the website yet, and can put the
 *     agent's logo on it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  EMPLOYEE_INTAKE_STEPS,
  employeeAgentLogoPrompt,
  employeeIntakeConfirmPrompt,
  employeeIntakeFixPrompt,
  parseIntakeFixChoice,
  parseSkipRequest
} = require('../services/whatsappEmployeeIntakeService');

const repoFile = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
const routeSource = repoFile('routes', 'whatsapp.js');
const adminSource = repoFile('routes', 'admin.js');
const appSource = repoFile('assets', 'makaug-app.js');

test('saying no at the confirmation offers to change who the person is', () => {
  const asCustomer = employeeIntakeFixPrompt({ role: 'customer' });
  assert.match(asCustomer, /This is an \*agent\*, not a private owner/);
  assert.match(asCustomer, /1 — The details/);

  const asAgent = employeeIntakeFixPrompt({ role: 'agent', hasLogo: true });
  assert.match(asAgent, /This is a \*private owner\*, not an agent/);
  assert.match(asAgent, /3 — The logo/);
});

test('the fix answer is read from either the number or the word', () => {
  assert.strictEqual(parseIntakeFixChoice('1'), 'details');
  assert.strictEqual(parseIntakeFixChoice('2'), 'role');
  assert.strictEqual(parseIntakeFixChoice('agent'), 'role');
  assert.strictEqual(parseIntakeFixChoice('3'), 'logo');
  assert.strictEqual(parseIntakeFixChoice('something else'), '');
});

test('the fix step is part of the intake and sits after the confirmation', () => {
  const steps = [...EMPLOYEE_INTAKE_STEPS];
  assert.ok(steps.includes('employee_intake_fix'), 'the fix step must be a known intake step');
  assert.ok(
    steps.indexOf('employee_intake_fix') > steps.indexOf('employee_intake_confirm'),
    'the fix step follows the confirmation it comes from'
  );
});

test('switching to an agent keeps the ID and creates the profile the batch needs', () => {
  assert.ok(
    routeSource.includes('Switched to an agent — an agent profile will be created for staff approval.'),
    'the employee must be told the profile will now be created'
  );
  assert.ok(
    routeSource.includes('Switched to a private owner — no agent profile will be created.'),
    'switching the other way must say what it costs'
  );
});

/**
 * The Quickway batch, replayed: the wrong answer to the first question, caught
 * at the confirmation, corrected without starting again, and ending with a
 * pending agent record that staff can approve.
 */
test('the Quickway mistake can be corrected without restarting the batch', async () => {
  const db = require('../config/database');
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  const insertedAgents = [];
  let saved = null;

  db.query = async (sql, params = []) => {
    if (/UPDATE whatsapp_sessions/i.test(sql)) {
      saved = JSON.parse(params[2]);
      return { rows: [] };
    }
    if (/INSERT INTO agents/i.test(sql)) {
      insertedAgents.push({ fullName: params[0], company: params[1], phone: params[3] });
      return {
        rows: [{
          id: 'agent-created-by-confirmation',
          full_name: params[0],
          company_name: params[1],
          phone: params[3],
          whatsapp: params[3],
          email: null,
          status: 'pending'
        }]
      };
    }
    return { rows: [] };
  };
  db.getClient = async () => ({ query: async () => ({ rows: [] }), release() {} });

  try {
    const route = require('../routes/whatsapp').__test;
    const at = (currentStep, body, sessionData) => route.handleEmployeeWhatsappIntake({
      phone: '+447757773202',
      body,
      session: { current_step: currentStep, session_data: sessionData }
    });

    // "2" at the first question loaded the whole batch as a private owner.
    let data = {
      whatsapp_employee_intake: true,
      employee_role: 'customer',
      customer_details: { fullName: 'Quick auctioneers', phone: '+256750925959', location: 'Kampala' },
      identity_followup_required: true
    };

    const confirmation = await at('employee_intake_confirm', '', data);
    assert.match(confirmation.message, /private owner \(customer\), not an agent/,
      'the confirmation has to say plainly that no agent profile is being created');

    const fix = await at('employee_intake_confirm', '2', data);
    assert.strictEqual(fix.nextStep, 'employee_intake_fix');
    assert.match(fix.message, /This is an \*agent\*, not a private owner/);
    data = saved;

    const switched = await at('employee_intake_fix', '2', data);
    assert.strictEqual(switched.nextStep, 'employee_agent_existing');
    data = saved;
    assert.strictEqual(data.employee_role, 'agent');
    assert.ok(!data.customer_details, 'the private-owner details must not survive the switch');
    assert.strictEqual(data.identity_followup_required, true, 'the deferred ID belongs to the person, not the answer');

    data.agent_already_registered = false;
    const details = await at(
      'employee_new_agent_details',
      'Quickway Auctioneers | +256750925959 | Quickway Auctioneers & Court Bailiffs | Kampala',
      data
    );
    assert.strictEqual(details.nextStep, 'employee_agent_logo',
      'the ID was already deferred, so the logo is next — never the ID again');
    data = saved;

    const skipped = await at('employee_agent_logo', 'skip', data);
    assert.strictEqual(skipped.nextStep, 'employee_intake_confirm');
    assert.match(skipped.message, /Agent profile: will be created for staff approval/);
    data = saved;

    const ready = await at('employee_intake_confirm', '1', data);
    assert.strictEqual(ready.nextStep, 'employee_property_count');
    assert.deepStrictEqual(insertedAgents, [{
      fullName: 'Quickway Auctioneers',
      company: 'Quickway Auctioneers & Court Bailiffs',
      phone: '+256750925959'
    }], 'confirming must leave exactly one pending agent for staff to approve');
  } finally {
    db.query = originalQuery;
    db.getClient = originalGetClient;
  }
});

test('a corrected detail does not ask for the ID again', () => {
  assert.ok(
    routeSource.includes('function employeeIntakeStepAfterDetails'),
    'one place must decide what follows the details'
  );
  assert.ok(
    /identityHandled\s*=\s*Boolean\(data\.identity_document_url\)\s*\|\|\s*data\.identity_followup_required === true/.test(routeSource),
    'an ID already stored or already deferred counts as handled'
  );
});

test('the agent profile is created when the employee confirms, not before', () => {
  const confirmIndex = routeSource.indexOf("if (currentStep === 'employee_intake_confirm')");
  assert.ok(confirmIndex > 0, 'the confirmation step must exist');
  const confirmBlock = routeSource.slice(confirmIndex, confirmIndex + 3000);
  assert.ok(
    confirmBlock.includes('ensurePendingEmployeeAgent'),
    'confirming is what creates the pending agent record'
  );
  const identityIndex = routeSource.indexOf("if (currentStep === 'employee_identity_photo')");
  const identityBlock = routeSource.slice(identityIndex, routeSource.indexOf("if (currentStep === 'employee_agent_logo')"));
  assert.ok(
    !identityBlock.includes('ensurePendingEmployeeAgent'),
    'the ID step must not create a record before the employee has confirmed who this is'
  );
});

test('the logo is asked for, can be skipped, and is shown on the confirmation', () => {
  assert.match(employeeAgentLogoPrompt('Quickway Auctioneers'), /Quickway Auctioneers/);
  assert.match(employeeAgentLogoPrompt(), /SKIP/);
  for (const reply of ['skip', 'SKIP', 'no logo', 'none']) {
    assert.ok(parseSkipRequest(reply), `"${reply}" should skip the logo`);
  }
  assert.ok(!parseSkipRequest('4 bedroom house in Ntinda'), 'a caption must never skip the logo');

  const withLogo = employeeIntakeConfirmPrompt({ fullName: 'A', phone: '+256700000000', logoReceived: true });
  assert.match(withLogo, /Logo: received/);
  const withoutLogo = employeeIntakeConfirmPrompt({ fullName: 'A', phone: '+256700000000', logoReceived: false });
  assert.match(withoutLogo, /Logo: none yet/);
  const customer = employeeIntakeConfirmPrompt({ role: 'customer', fullName: 'A', phone: '+256700000000' });
  assert.ok(!/Logo:/.test(customer), 'a private owner has no profile, so no logo line');
});

test('staff can add an agent logo from the dashboard', () => {
  assert.ok(
    adminSource.includes("router.patch('/agents/:id/profile-photo'"),
    'an endpoint must exist for the logo'
  );
  assert.ok(
    adminSource.includes('Profile photo must be an image data URL or public HTTPS URL'),
    'the logo must be validated before it is stored'
  );
  assert.ok(
    appSource.includes('adminUploadAgentProfilePhoto'),
    'the dashboard must offer the upload'
  );
});

test('staff are told why an agent profile is not on the website yet', () => {
  assert.ok(
    appSource.includes('function agentPublicProfileState'),
    'the dashboard must work out what a profile is still missing'
  );
  assert.ok(
    appSource.includes('Not on the website yet — still needs'),
    'the missing pieces must be named on the broker row'
  );
  assert.ok(
    appSource.includes('Public profile is live on makaug.com'),
    'a live profile must say so plainly'
  );
});
