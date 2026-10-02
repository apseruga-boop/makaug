'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const names = require('../services/agentNameService');

test('the greeting name wins over the first word of the full name', () => {
  assert.strictEqual(names.agentGreetingName({ full_name: 'Agaba Amos', greeting_name: 'Amos' }), 'Amos');
  assert.strictEqual(names.agentGreetingName({ full_name: 'Agaba Amos' }), 'Agaba', 'fallback is unchanged');
  assert.strictEqual(names.agentGreetingName({ full_name: 'Mr. John Okello' }), 'John', 'titles are skipped');
  assert.strictEqual(names.agentGreetingName({}, 'there'), 'there');
});

test('a name set by an admin reaches agent rows held in sessions', () => {
  names.setCachedGreetingName('11111111-2222-3333-4444-555555555555', 'Brian');
  assert.strictEqual(names.agentGreetingName({ id: '11111111-2222-3333-4444-555555555555', full_name: 'Kimuli Brian', greeting_name: null }), 'Brian');
  names.setCachedGreetingName('11111111-2222-3333-4444-555555555555', '');
});

test('no agent-facing message takes the first word of full_name directly any more', () => {
  const files = ['routes/whatsapp.js', 'services/agentWelcomeService.js', 'services/agentWeeklyReportService.js',
    'services/agentReportVideoService.js', 'services/leadReferralService.js', 'services/leadDeskService.js'];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(!/(?:agent|a)\??\.full_name[^\n]{0,40}split\(\/\\s\+\/\)\[0\]/.test(src), `${f} still greets agents by the first word`);
    assert.ok(!/agent_name\)\.split\(\/\\s\+\/\)\[0\]/.test(src), `${f} still greets agents by the first word`);
  }
});

test('the agents greeted in the 2 Oct broadcast keep those names', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db/migrations/139_agent_greeting_name.sql'), 'utf8');
  for (const name of ['Amos', 'Brian', 'Frederick', 'Innocent', 'Bonny']) assert.ok(sql.includes(`'${name}'`), name);
});
