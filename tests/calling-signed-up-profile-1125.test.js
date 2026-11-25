'use strict';

/**
 * Ronald's morning of 25 Nov 2026 (Arthur): a call logged "Signed up, will pay
 * tomorrow" to a number listed as "Un named" opened no agent profile, put
 * nothing in King and left nothing to greet their Hi. And the staff desk said
 * "Agents to approve: 0" while King listed 30 pending agents opened on calls.
 * Every name and number here is made up.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const names = require('../services/callingNames');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('"Un named", "un-named" and "Unamed" are stand-ins, not names; real names still pass', () => {
  for (const n of ['Un named', 'un named', 'Un-named', 'Unamed', 'Unnamed']) assert.ok(names.nameProblem(n), n);
  for (const n of ['Testa Kato', 'Un Testara Homes', 'Brightway', 'Named Testco Ltd']) assert.strictEqual(names.nameProblem(n), '', n);
});

test('Signed up on a new-agents call needs their name and number, and opens the pending profile like Interested', () => {
  const screen = read('services/callingScreen.js');
  assert.match(screen, /const newAgentInterested = \['interested', 'signed_up'\]\.includes\(def\.key\) && task\.key === 'new_agents';/);
  assert.match(screen, /outcomeLabel: def\.key === 'signed_up' \? 'Signed up' : 'Interested'/);
  assert.match(read('services/callingFollowThrough.js'), /logged \$\{outcomeLabel\} on a call/);
  assert.match(read('assets/calling-screen.js'), /o\.key === 'interested' \|\| o\.key === 'signed_up'\) && task && task\.key === 'new_agents'/);
});

test('the staff desk lists agents waiting for their Hi, as King does, without counting them in the badge', () => {
  const pipe = read('services/staffPipeline.js');
  assert.match(pipe, /async function toApprove\(personKey, \{ caller = false, awaitingHi = false \} = \{\}\)/);
  assert.match(pipe, /= 'calling_interested'\) = \$1/);
  assert.match(read('routes/staffDesk.js'), /'\/desk\/approve\/awaiting-hi'.*awaitingHi: true/);
  assert.match(read('routes/staffDesk.js'), /pipe\.toApprove\(pk, \{ caller \}\)/, 'the badge still counts only agents waiting on staff');
  assert.match(read('assets/staff-desk.js'), /Waiting for their Hi/);
  assert.match(read('assets/makaug-app.js'), /Opened on a call · approved by itself when they say Hi/);
});
