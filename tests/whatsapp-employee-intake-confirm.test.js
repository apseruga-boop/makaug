'use strict';

/**
 * Two things an employee intake has to do before any property is sent:
 *
 *  1. Let the lister say the ID is coming later. At a platform this new, people
 *     will not hand over a national ID on demand, and refusing to continue
 *     loses the listings. The debt is recorded instead, shown to staff on every
 *     property in the batch, and chased before approval.
 *  2. Confirm the name, the number and the agent profile before asking how many
 *     properties are coming.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  EMPLOYEE_INTAKE_STEPS,
  employeeIntakeConfirmPrompt,
  parseIdentityLaterRequest,
  parseIntakeConfirmation
} = require('../services/whatsappEmployeeIntakeService');

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');

test('the confirmation step sits between the ID step and the batch question', () => {
  const steps = [...EMPLOYEE_INTAKE_STEPS];
  assert.strictEqual(
    steps.indexOf('employee_intake_confirm'),
    steps.indexOf('employee_identity_photo') + 1,
    'confirmation must follow the ID step'
  );
  assert.strictEqual(
    steps.indexOf('employee_property_count'),
    steps.indexOf('employee_intake_confirm') + 1,
    'the batch question must come after the confirmation'
  );
});

test('the ways people say the ID is coming later are understood', () => {
  for (const reply of ['later', 'Later', 'share later', 'send it later', 'skip for now', 'he will send later', 'no id']) {
    assert.ok(parseIdentityLaterRequest(reply), `"${reply}" should defer the ID`);
  }
});

test('a property caption is never mistaken for deferring the ID', () => {
  for (const reply of ['4 bedroom house in Ntinda', 'later today I will send the house photos', '1']) {
    assert.ok(!parseIdentityLaterRequest(reply), `"${reply}" must not defer the ID`);
  }
});

test('the confirmation answer is read from either the number or the word', () => {
  assert.strictEqual(parseIntakeConfirmation('1'), 'yes');
  assert.strictEqual(parseIntakeConfirmation('yes'), 'yes');
  assert.strictEqual(parseIntakeConfirmation('2'), 'no');
  assert.strictEqual(parseIntakeConfirmation('wrong'), 'no');
  assert.strictEqual(parseIntakeConfirmation('maybe'), '');
});

test('the confirmation shows the name, the number and the state of the ID and profile', () => {
  const prompt = employeeIntakeConfirmPrompt({
    role: 'agent',
    fullName: 'Quickway Auctioneer',
    phone: '+256 750 925 959',
    company: 'Quickway Auctioneers & Court Bailiffs',
    district: 'Kampala',
    identityReceived: false,
    profileLine: 'Agent profile: created and waiting for staff approval'
  });
  assert.match(prompt, /Quickway Auctioneer/);
  assert.match(prompt, /\+256 750 925 959/);
  assert.match(prompt, /Kampala/);
  assert.match(prompt, /not supplied yet/);
  assert.match(prompt, /Agent profile/);
  assert.match(prompt, /1 — Yes/);
  assert.match(prompt, /2 — No/);

  const withId = employeeIntakeConfirmPrompt({ fullName: 'A', phone: '+256700000000', identityReceived: true });
  assert.match(withId, /received and stored privately/);
});

test('the ID step offers the LATER route and the batch still reaches review', () => {
  assert.ok(routeSource.includes('reply *LATER*'), 'the ID prompt must offer LATER');
  assert.ok(
    routeSource.includes('identity_followup_required'),
    'a deferred ID must be recorded for staff on every property'
  );
  assert.ok(
    routeSource.includes('ID still outstanding'),
    'the batch completion must repeat that the ID is owed'
  );
});

test('a deferred ID is shown to staff on the review card', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');
  assert.ok(
    appSource.includes('identity_followup_required'),
    'the staff review card must surface an outstanding ID'
  );
  assert.ok(
    appSource.includes('Chase the ID and verify it before approving'),
    'staff must be told to chase the ID before approval'
  );
});
