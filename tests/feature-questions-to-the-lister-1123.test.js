'use strict';

/**
 * 23 Nov 2026. A guest asked, in a voice note, about the short stays sent to
 * her: "your rooms have AC. You tell me if they have AC." makaug does not know,
 * and does not answer for, what a place has. The rule: tell her to reach out
 * to the listers and find out about the AC, and take no responsibility for it.
 *
 * A question about what a place has is answered with who to ask, that makaug
 * is not responsible for it, and the terms. When somebody on the team is
 * talking to the customer, it goes to that person instead.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const route = require('../routes/whatsapp').__test;

test('a question about what a place has is spotted, and says which thing', () => {
  const asked = {
    'Another thing I forgot to ask you, your rooms have AC. You tell me if they have AC.': 'the AC',
    'Is it furnished?': 'the furniture',
    'does it have wifi?': 'the Wi-Fi',
    'Is there parking?': 'the parking',
    'do the rooms have hot water': 'the hot water',
    'Are pets allowed?': 'whether pets are allowed',
    'Is there AC in the Kyanja apartment?': 'the AC',
    'Does the house have security?': 'the security'
  };
  for (const [said, feature] of Object.entries(asked)) assert.strictEqual(route.askedAboutAFeature(said), feature, said);
});

test('a search that mentions a feature is still a search, and other talk is left alone', () => {
  for (const said of [
    'do you have rooms with AC in Kira under 300k',
    'I need a house with parking in Kira',
    '2 bedroom house in Kira with AC',
    'Do you have a furnished apartment in Kololo?',
    'furnished apartment in Kololo',
    'AC',
    'Hello',
    'is it available?',
    'how about 150'
  ]) {
    assert.strictEqual(route.askedAboutAFeature(said), '', said);
  }
});

test('the answer sends them to the lister, takes no responsibility, and carries the terms', () => {
  const reply = route.featureQuestionReply('en', 'the AC');
  assert.match(reply, /^I can't confirm things like the AC for any place on makaug\./);
  assert.match(reply, /please ask them directly: use the contact on the listing, or tap "See original post" for places found online\./);
  assert.match(reply, /we're not responsible for their features, availability or any agreement you make\./);
  assert.match(reply, /Our terms: https:\/\/makaug\.com\/terms$/);
});

test('somebody on the team talking to them answers it instead', () => {
  assert.strictEqual(route.isOpeningReply(route.featureQuestionReply('en', 'the AC')), true);
});

test('wired in before the other questions a customer can ask', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
  const hook = source.indexOf('const featureAsked = [');
  assert.ok(hook > 0);
  assert.ok(hook < source.indexOf('&& isRentingProcessQuestion(cleanBody)'), 'before the renting question');
  assert.match(source.slice(hook, hook + 400), /return respond\(featureQuestionReply\(lang, featureAsked\), step === 'search_area' \? 'search_area' : 'main_menu'\);/);
});
