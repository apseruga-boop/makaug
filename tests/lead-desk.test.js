'use strict';

// Lead desk — message wording. The full journey is scripts/test-lead-desk-e2e.js.

const test = require('node:test');
const assert = require('node:assert');
const { buildClientMatchMessage, buildNudgeMessage } = require('../services/leadDeskService');
const { buildAgentReferralMessage } = require('../services/leadReferralService');

test('client is told a property has come up, with the link and the safety line', () => {
  const text = buildClientMatchMessage({
    lead: { name: 'Grace Namata', want: 'rent', area: 'Bunga', asked_at: '2026-09-28T09:00:00Z' },
    listing: { id: 'abc', title: '2 bedroom house in Bunga', price: 850000 }
  });
  assert.match(text, /^Hi Grace, this is makaug\.com\./);
  assert.match(text, /On 28 September you asked us about a place to rent in Bunga\. A property has come up/);
  assert.match(text, /2 bedroom house in Bunga — UGX 850,000/);
  assert.match(text, /\/property\/abc/);
  assert.match(text, /Never pay before/);
});

test('agent follow-up asks for a one-word answer', () => {
  const text = buildNudgeMessage({
    referral: { agent_name: 'Francis Isabirye', sent_at: '2026-10-01T09:00:00Z' },
    lead: { want: 'land', area: 'Mbale', phone: '256772111222' }
  });
  assert.match(text, /^Hi Francis, a quick follow-up/);
  assert.match(text, /land to buy in Mbale \(256772111222\)/);
  assert.match(text, /YES, NO or DONE/);
});

test('a referral for several people lists each with what they said', () => {
  const text = buildAgentReferralMessage({
    agent: { full_name: 'Francis Isabirye' },
    need: { type: 'rent', area: 'Bunga', people: [
      { name: 'Grace', phone: '0772000111', budget: 900000, said: '3 bed with parking', askedAt: new Date() },
      { phone: '256770661200', said: 'No approved listings found for natural query: Bunga at 500k', askedAt: new Date() }
    ] }
  });
  assert.match(text, /We have 2 leads for you: people looking for a place to rent in Bunga/);
  assert.match(text, /"3 bed with parking"/);
  assert.match(text, /"Bunga at 500k"/);
  assert.doesNotMatch(text, /natural query/);
});
