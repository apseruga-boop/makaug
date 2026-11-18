'use strict';

/**
 * 18 Nov 2026. Every name and number here is made up.
 *
 * A student intern asked for a room near their office: "150000-250000 should
 * be near <the office>", then, asked where that is, "Nakawa". Two days
 * later the lead desk passed it to an agent as "someone is looking for a
 * property in Nakawa. Budget: up to UGX 150,000. What they said: "Nakawa"".
 * The agent asked "Is it a mistake or they really want something of 150k",
 * and was answered "Got the details ... Now send the photos".
 *
 * 1. "150000-250000" was a budget of 150,000: a range with no k or m was not a range.
 * 2. Said while the bot waited for the place, the budget was dropped, and only
 *    the last word ("Nakawa") was kept of what they had said.
 * 3. The lead to the agent gave no "a month" for a room's budget.
 * 4. An agent's question with no property in it was taken for a property.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const db = require('../config/database');
const route = require('../routes/whatsapp').__test;
const referral = require('../services/leadReferralService');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('a range of plain figures is a range: the top is the budget', () => {
  const budget = (text) => {
    const f = route.extractNaturalSearchFilters(text, {}, 'any', {});
    return [f.minBudgetUgx || 0, f.maxBudgetUgx || 0];
  };
  assert.deepStrictEqual(budget("150000-250000 should be near the head office because it's where I'm doing internship from"), [150000, 250000]);
  assert.deepStrictEqual(budget('student room between 150,000 and 250,000'), [150000, 250000]);
  assert.deepStrictEqual(budget('single room 100,000 - 150,000 in Nakawa'), [100000, 150000]);
  // Unchanged: ranges with k or m, and figures that are not money.
  assert.deepStrictEqual(budget('room in Ntinda 150k-250k'), [150000, 250000]);
  assert.deepStrictEqual(budget('2-3 bedroom house in Kira under 300m'), [0, 300000000]);
  assert.deepStrictEqual(budget('plot 50-100 ft in Gayaza 40m'), [0, 40000000]);
});

test('what is said while the bot waits for the place is kept: the budget, and the words', () => {
  assert.strictEqual(route.searchSaidSoFar('student accommodation near the office', 'Nakawa'), 'student accommodation near the office · Nakawa');
  assert.strictEqual(route.searchSaidSoFar('', 'Nakawa'), 'Nakawa');
  assert.strictEqual(route.searchSaidSoFar('Nakawa', 'Nakawa'), 'Nakawa');
  assert.ok(route.searchSaidSoFar('x'.repeat(700), 'Nakawa').length <= 600);
  const source = read('routes/whatsapp.js');
  const step = source.indexOf("if (step === 'search_area') {");
  const merge = source.indexOf("const told = extractNaturalSearchFilters(cleanBody, {}, naturalFilters.searchType || searchType || 'any', {}) || {};", step);
  assert.ok(step > 0 && merge > step, 'the budget in a reply is merged into the search that waits');
  assert.match(source.slice(merge, merge + 400), /for \(const key of \['maxBudgetUgx', 'minBudgetUgx', 'budgetPeriod', 'pricePeriod', 'bedsMin', 'propertyType'\]\)/);
  assert.match(source.slice(step, step + 12000), /natural_query_text: searchSaidSoFar\(pendingFilters \? sessionData\.natural_query_text : '', cleanBody\)/);
  assert.match(source.slice(step, step + 12000), /notes: `No approved listings found for natural query in search_area: \$\{searchSaidSoFar\(pendingFilters \? sessionData\.natural_query_text : '', cleanBody\)\}`/);
});

test('the lead to an agent gives a room\'s budget a month, and the student is sent to student rooms', () => {
  const need = {
    type: 'student',
    area: 'Nakawa',
    people: [{ phone: '256700000221', budget: 250000, said: 'No approved listings found for natural query in search_area: student accommodation near the office · 150000-250000 · Nakawa', askedAt: new Date(Date.now() - 2 * 86400000) }]
  };
  const text = referral.buildAgentReferralMessage({ agent: { full_name: 'Replay Agent' }, need });
  assert.match(text, /someone is looking for student accommodation in Nakawa\./);
  assert.match(text, /Budget: up to UGX 250,000 a month/);
  assert.match(text, /What they said: "student accommodation near the office · 150000-250000 · Nakawa"/);
  assert.match(referral.buildClientReferralMessage({ agent: { full_name: 'Replay Agent' }, need, person: need.people[0] }),
    /https:\/\/makaug\.com\/student-accommodation\?area=Nakawa&max_price=250000/);
  assert.match(referral.buildAgentReferralMessage({ agent: {}, need: { ...need, type: 'rent' } }), /Budget: up to UGX 250,000 a month/);
  assert.match(referral.buildAgentReferralMessage({ agent: {}, need: { ...need, type: 'sale', people: [{ ...need.people[0], budget: 300000000 }] } }), /Budget: up to UGX 300m\n/, 'a price to buy is not a month');
  const two = { ...need, people: [need.people[0], { ...need.people[0], phone: '256700000222' }] };
  assert.match(referral.buildAgentReferralMessage({ agent: {}, need: two }), /budget up to UGX 250,000 a month/);
});

test('an agent\'s question with no property in it is a question, and a person answers it', async () => {
  const question = 'Is it a mistake or they really want something of 150k';
  assert.strictEqual(route.isQuestionNotProperty(question), true);
  assert.strictEqual(route.looksLikeForwardedProperty({ cleanBody: question }), false, 'not taken for a property');
  for (const advert of [
    'Who wants a 3 bedroom house in Kira at 250m?',
    'House for sale in Naalya with 3bedrooms asking price 220m',
    'Plot for sale in Matugga 50x100 at 25m, is it a good deal?'
  ]) {
    assert.strictEqual(route.isQuestionNotProperty(advert), false, advert);
    assert.strictEqual(route.looksLikeForwardedProperty({ cleanBody: advert }), true, advert);
  }
  assert.match(route.agentQuestionReply({ full_name: 'Replay Agent', greeting_name: 'Replay' }), /^👍 Thanks Replay, I have passed your question to \*.+\* from our team, who will answer you here\.$/);

  const original = db.query;
  db.query = async () => ({ rows: [{ sent_at: new Date(Date.now() - 3600000), want: 'student', area: 'Nakawa', budget: 250000 }] });
  try {
    assert.strictEqual(await route.lastLeadSentToAgent({ id: '00000000-0000-4000-8000-000000000001' }),
      'The last lead we sent them (1 hour ago): student accommodation in Nakawa, up to UGX 250,000 a month.');
    assert.strictEqual(await route.lastLeadSentToAgent({}), '');
  } finally {
    db.query = original;
  }
  // Answered in the agent's own block, after the questions that have their own
  // answer (how to post, is it live, help), before the agent menu.
  const source = read('routes/whatsapp.js');
  assert.match(source, /AGENT_TERMS_AGREE\.isAgreeReply\(askedText\) \|\| isQuestionNotProperty\(askedText\)\)\) \{/);
  const branch = source.indexOf("alertTeamAgentNeedsHelp({ agent: askingAgent, phone, said: askedText, title: 'Agent question on WhatsApp', withLastLead: true });");
  const howTo = source.lastIndexOf('if (AGENT_HOW_TO_POST.test(askedText) || WANTS_TO_POST.test(askedText)) {', branch);
  const menu = source.indexOf('message: agentMenuReply({ agent: askingAgent, greet: true })', branch);
  assert.ok(howTo > 0 && branch > howTo && menu > branch && menu - branch < 400);
});
