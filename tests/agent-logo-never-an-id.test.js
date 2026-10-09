'use strict';

/**
 * A national ID card as somebody's public profile picture.
 *
 * 8 Oct 2026. Migadde Hakim's makaug agent profile — a public page — carried a
 * photograph of his Ugandan national ID card: his face, his NIN, his date of
 * birth, his ID number and his signature, legible to anyone who opened it.
 *
 * Agent 007 asks an employee for the agent's ID, stores it privately, and then
 * asks for a logo. The same photo was sent again, and the logo step published
 * it with no check at all.
 *
 * Two guards existed already and neither was wired to this one step — the step
 * that decides an agent's public face:
 *
 *   1. employeePropertyMediaCandidates has kept the ID out of PROPERTY photos
 *      for weeks, by sha256 and by source message id. It was never applied here.
 *   2. storeEmployeeMedia runs every public image past the photo classifier,
 *      which reports is_screenshot_or_document and sets publicEligible from it.
 *      A photographed ID is a document and the classifier says so — this step
 *      took the url and threw the verdict away.
 *
 * The asymmetry decides the strictness: refusing a real logo costs one more
 * message and staff can add one from the dashboard; publishing an ID cannot be
 * undone, and the person did not choose it.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const source = fs.readFileSync(require.resolve('../routes/whatsapp'), 'utf8');
const logoStep = source.slice(
  source.indexOf("if (currentStep === 'employee_agent_logo')"),
  source.indexOf("if (currentStep === 'employee_intake_confirm')")
);

test('the logo step exists and is what we think it is', () => {
  assert.ok(logoStep.length > 200, 'the agent logo step must still be here to be guarded');
  assert.match(logoStep, /agent_profile_photo_url/, 'this is the step that sets the public profile photo');
});

test('the ID photo cannot be reused as the public profile photo', () => {
  assert.match(logoStep, /employeePropertyMediaCandidates\(/,
    'the identity filter that protects property photos must protect this one too');
  assert.match(logoStep, /ID can never go on a public profile/i,
    'and the employee is told plainly why it was refused');
});

test('the classifier verdict is obeyed, not computed and discarded', () => {
  assert.match(logoStep, /logo\.publicEligible !== true/,
    'a picture the classifier will not pass for public use must not become a public profile photo');
  assert.match(logoStep, /screenshot_or_document/,
    'a document gets the message that names the real problem');
});

test('an unavailable verdict holds the photo back rather than letting it through', () => {
  // Fail closed. "We could not check" must never mean "publish it".
  const afterGuard = logoStep.slice(logoStep.indexOf('logo.publicEligible !== true'));
  const assignIndex = afterGuard.indexOf('data.agent_profile_photo_url = logo.url');
  const returnIndex = afterGuard.indexOf('return {');
  assert.ok(returnIndex > -1 && returnIndex < assignIndex,
    'the refusal returns before the photo is ever assigned');
});

test('refusing still leaves a way forward', () => {
  // A guard that strands the employee gets worked around.
  assert.match(logoStep, /\*SKIP\*/, 'SKIP remains, so a refusal never blocks registering the agent');
});
