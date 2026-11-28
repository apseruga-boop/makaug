'use strict';

/**
 * What the chats of 23 Nov 2026 taught, the afternoon round.
 *
 * - The lead desk passed a renter's request to an agent who had not written to
 *   the makaug number for a week, and told her he would contact her. The
 *   request only waited in the queue.
 * - "I need a house to rent" was answered with a 3M house sent three hours
 *   before, as if she had picked it.
 * - A renter's single room at 150k was forgotten four hours later.
 * - "how about 150" was searched as USh 150 a month, and "which places can i
 *   get at that amount" was asked about as a place called "Get At", twice.
 * - A forwarded photo still carrying "Hello Mkaug" replaced the description
 *   waiting for it, and the "Not saved yet" notice went out once per photo.
 * - A rent budget was shown without "a month"; "Hy" was not a hello.
 *
 * Every name and number here is made up.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');

// The desk's sends are watched, not made.
const handoff = require('../services/leadHandoffService');
const sent = [];
handoff.deliverWhatsapp = async (message) => {
  sent.push(message);
  return { status: 'failed', reason: 'test' };
};
const leadDesk = require('../services/leadDeskService');
const ai = require('../services/aiService');
const route = require('../routes/whatsapp').__test;

const AGENT_ID = '0b0b0b0b-0000-4000-8000-000000000001';
const LEAD_ID = '0c0c0c0c-0000-4000-8000-000000000001';
const REFERRAL_ID = '0d0d0d0d-0000-4000-8000-000000000001';
const AGENT = { id: AGENT_ID, full_name: 'Test Agent', company_name: '', makaug_agent_number: 'MA-0001', whatsapp: '+256700000071' };
const LEAD = {
  id: LEAD_ID, phone: '+256700000072', phone_key: '700000072', name: 'Test Renter', want: 'rent', area: 'Kireka',
  budget: 130000, message: 'single room in kireka', asked_at: new Date().toISOString(), status: 'new'
};

function fakeDb() {
  const calls = [];
  return {
    calls,
    async query(sql) {
      const text = String(sql);
      calls.push(text);
      if (/FROM agents a\s+WHERE a\.id = \$1::uuid/i.test(text)) return { rows: [AGENT] };
      if (/SELECT \* FROM demand_leads WHERE id = ANY/i.test(text)) return { rows: [LEAD] };
      if (/FROM demand_lead_referrals r LEFT JOIN agents a/i.test(text)) {
        return { rows: [{ id: REFERRAL_ID, demand_lead_id: LEAD_ID, agent_id: AGENT_ID, full_name: AGENT.full_name, whatsapp: AGENT.whatsapp, created_at: new Date().toISOString() }] };
      }
      if (/AS covers/i.test(text)) return { rows: [{ covers: false }] };
      return { rows: [], rowCount: 0 };
    }
  };
}

test('the desk sends nothing to an agent the makaug number cannot reach, and tells nobody it did', async () => {
  sent.length = 0;
  const db = fakeDb();
  const result = await leadDesk.referLeads(db, { ids: [LEAD_ID], agentId: AGENT_ID, waitsForThem: async () => true });
  assert.strictEqual(result.status, 409);
  assert.match(result.error, /^Test has not written to the makaug WhatsApp in the last \d+ days/);
  assert.match(result.error, /Nothing was sent and nobody was told\./);
  assert.match(result.error, /Pick another agent, or ask Test to tap this link and press send/);
  assert.strictEqual(sent.length, 0, 'neither the agent nor the renter is sent anything');
  assert.ok(!db.calls.some((sql) => /INSERT INTO demand_lead_referrals|UPDATE demand_leads/i.test(sql)), 'nothing is recorded as referred');
});

test('an agent who can be reached is still sent the request', async () => {
  sent.length = 0;
  await leadDesk.referLeads(fakeDb(), { ids: [LEAD_ID], agentId: AGENT_ID, waitsForThem: async () => false });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].to, AGENT.whatsapp);
  assert.strictEqual(sent[0].kind, 'desk_referral');
});

test('a preview to a member of staff is not held up by the agent', async () => {
  sent.length = 0;
  await leadDesk.referLeads(fakeDb(), { ids: [LEAD_ID], agentId: AGENT_ID, previewTo: '+256700000073', waitsForThem: async () => true });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].to, '+256700000073');
});

test('a follow-up to an agent who cannot be reached is not queued either', async () => {
  sent.length = 0;
  const result = await leadDesk.nudgeReferral(fakeDb(), REFERRAL_ID, { waitsForThem: async () => true });
  assert.strictEqual(result.status, 409);
  assert.strictEqual(sent.length, 0);
});

const SEGUKU = { id: '33333333-3333-4333-8333-333333333333', title: '5-bed property for rent in Seguku', property_type: 'house', area: 'Seguku', district: 'Wakiso', price: 3000000, bedrooms: 5 };
const NAMUGONGO = { id: '44444444-4444-4444-8444-444444444444', title: '4-bed house for rent in Namugongo', property_type: 'house', area: 'Namugongo', district: 'Wakiso', price: 1500000, bedrooms: 4 };

test('wanting "a" house is a new search; "the" house or a viewing of it is about one already sent', () => {
  for (const said of ['I need a house to rent', 'I need another house', 'need a 2 bedroom house', 'I want a house like the Seguku one']) {
    assert.strictEqual(route.pickShownListing(said, [SEGUKU, NAMUGONGO]), null, said);
  }
  for (const said of ['I want a viewing of the Seguku house', 'the seguku house', 'I want the first one']) {
    const picked = route.pickShownListing(said, [SEGUKU, NAMUGONGO]);
    assert.ok(picked, said);
    assert.strictEqual(picked.area || picked.row?.area, 'Seguku', said);
  }
});

test('a search goes on for six hours, not two', () => {
  const now = Date.now();
  const brief = (hoursAgo) => ({
    last_search_brief: {
      at: new Date(now - hoursAgo * 3600e3).toISOString(),
      search_type: 'rent', property_type: 'single room', max_budget_ugx: 150000, budget_period: 'month', area: 'Kisaasi'
    }
  });
  const later = route.continueFromLastSearch({ searchType: 'any', area: 'Kireka', maxBudgetUgx: 130000 }, brief(4), { now });
  assert.strictEqual(later.searchType, 'rent');
  assert.strictEqual(later.propertyType, 'single room');
  // Past the six hours only the market goes on, for a day (28 Nov 2026,
  // whatsapp-chats-1128): renting stays renting; the single room does not.
  const later7 = route.continueFromLastSearch({ searchType: 'any', area: 'Kireka', maxBudgetUgx: 130000 }, brief(7), { now });
  assert.strictEqual(later7.searchType, 'rent');
  assert.ok(!later7.propertyType);
  const nextDay = route.continueFromLastSearch({ searchType: 'any', area: 'Kireka', maxBudgetUgx: 130000 }, brief(25), { now });
  assert.strictEqual(nextDay.searchType, 'any');
  assert.ok(!nextDay.propertyType);
});

test('"how about 150" after a 150k budget is 150k a month, and 300 after 250M is 300M', () => {
  const now = Date.now();
  const rent = route.continueFromLastSearch({ searchType: 'any', maxBudgetUgx: 150 }, {
    last_search_brief: { at: new Date(now - 3600e3).toISOString(), search_type: 'rent', property_type: 'house', max_budget_ugx: 150000, budget_period: 'month' }
  }, { now });
  assert.strictEqual(rent.maxBudgetUgx, 150000);
  assert.strictEqual(rent.budgetPeriod, 'month');
  const sale = route.continueFromLastSearch({ searchType: 'any', maxBudgetUgx: 300 }, {
    last_search_brief: { at: new Date(now - 3600e3).toISOString(), search_type: 'sale', max_budget_ugx: 250000000 }
  }, { now });
  assert.strictEqual(sale.maxBudgetUgx, 300000000);
});

test('a bare figure is in thousands for rent and millions for a purchase, and left alone when nothing says which', () => {
  assert.strictEqual(route.budgetInFullShillings({ searchType: 'rent', maxBudgetUgx: 150 }).maxBudgetUgx, 150000);
  assert.strictEqual(route.budgetInFullShillings({ searchType: 'student', maxBudgetUgx: 400 }).maxBudgetUgx, 400000);
  assert.strictEqual(route.budgetInFullShillings({ searchType: 'sale', maxBudgetUgx: 300 }).maxBudgetUgx, 300000000);
  assert.strictEqual(route.budgetInFullShillings({ searchType: 'any', maxBudgetUgx: 150 }).maxBudgetUgx, 150);
  assert.strictEqual(route.budgetInFullShillings({ searchType: 'rent', maxBudgetUgx: 150000 }).maxBudgetUgx, 150000);
  assert.strictEqual(route.budgetInFullShillings({ searchType: 'rent', maxBudgetUgx: 500, convertedFromUsd: true }).maxBudgetUgx, 500);
});

test('"can i get" is English: no place called "Get At"', () => {
  assert.strictEqual(ai.normalizeMultilingualSearchText('which places can i get at that amount'), 'which places can i get at that amount');
  assert.strictEqual(ai.normalizeMultilingualSearchText('can i get a room'), 'can i get a room');
  assert.ok(!route.extractNaturalSearchFilters('which places can i get at that amount', {}, 'any', {}).area);
  assert.ok(!route.extractNaturalSearchFilters('where can i get one at that price', {}, 'any', {}).area);
  // A locative before a place we know is still "in".
  assert.strictEqual(ai.normalizeMultilingualSearchText('i ntinda'), 'in ntinda');
  assert.strictEqual(ai.normalizeMultilingualSearchText('nyumba i kira'), 'house in kira');
  assert.strictEqual(ai.normalizeMultilingualSearchText('e ntinda nyumba'), 'in ntinda house');
});

test('"which places can i get at that amount" asks for the cheapest areas at the budget already given', () => {
  for (const said of ['which places can i get at that amount', 'where can i get one at that price', 'which area has houses in my budget']) {
    assert.strictEqual(route.asksWhereAtThatBudget(said), true, said);
    assert.strictEqual(route.isAffordabilityAdviceQuestion(said), true, said);
  }
  assert.strictEqual(route.asksWhereAtThatBudget('what about bweyogerere'), false);
});

test('a question or a sentence with no place in it is talk, not the place', () => {
  for (const said of ['when will that be coz it is urgent', 'is it available?', 'can you help me with the deposit']) {
    assert.strictEqual(route.looksLikeTalkNotAPlace(said), true, said);
  }
  for (const said of ['Kireka', 'near the market', 'kisaasi please', 'ok', 'Ntinda, Kampala']) {
    assert.strictEqual(route.looksLikeTalkNotAPlace(said), false, said);
  }
  // Only while the place is what is missing; an answer to "rent or buy?" for
  // a place already given still searches that place.
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
  assert.match(source, /&& \(!naturalFilters\.area \|\| naturalFilters\.location_blocked\) && looksLikeTalkNotAPlace\(cleanBody\)\) \{\n\s+return respond\(await talkWhileWaitingForAPlace\(\{ phone, said: cleanBody, contactName: runtime\.contactName \}\), 'main_menu'\);/);
  // A bare figure said while the bot waits for the place is a budget of that kind.
  assert.match(source, /const told = extractNaturalSearchFilters\([^\n]+\) \|\| \{\};\n\s+Object\.assign\(told, budgetInFullShillings\(told\)\);/);
});

const DESCRIPTION = 'For sale 250m in kyengera town wakiso district';

test('"Hello Mkaug" on a forwarded photo does not replace the description waiting for it', () => {
  assert.strictEqual(route.employeeMediaMessageCaption({ cleanBody: 'Hello Mkaug', pendingCaption: DESCRIPTION }), DESCRIPTION);
  // With nothing waiting, the photo's own words are all there is.
  assert.strictEqual(route.employeeMediaMessageCaption({ cleanBody: 'Hello Mkaug', pendingCaption: '' }), 'Hello Mkaug');
  // A photo that describes a property keeps its own description.
  const own = '3 bedroom house for rent in Kira 1.2m';
  assert.strictEqual(route.employeeMediaMessageCaption({ cleanBody: own, pendingCaption: DESCRIPTION }), own);
});

test('a photo with words still opens its album; with several descriptions waiting, "Hello" is held like no words', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
  assert.match(source, /const ownMediaCaption = mediaHasWords && caption === normalizeInput\(cleanBody\);/);
  assert.match(source, /ownCaption: mediaHasWords && \(ownMediaCaption \|\| employeeWaitingCaptionCount\(data\) <= 1\),/);
  assert.match(source, /if \(mediaHasWords\) data\.last_album_sender_ms = mediaSenderMs;/);
  // Each new batch hears about its own missing details.
  assert.match(source, /data\.property_batch_mode_selected_at = new Date\(\)\.toISOString\(\);\n\s+\/\/ A new batch hears about its own missing details from the start\.\n\s+delete data\.employee_incomplete_notice;/);
});

test('one "Not saved yet" per property, not one per photo', () => {
  const data = {};
  const now = Date.now();
  const missing = ['price'];
  const first = route.employeeIncompleteNoticeOnce(data, 'Rentals in Kabaganda', missing, { now });
  assert.match(first, /Not saved yet/);
  assert.strictEqual(route.employeeIncompleteNoticeOnce(data, 'Rentals in Kabaganda', missing, { now: now + 20000 }), '');
  assert.match(route.employeeIncompleteNoticeOnce(data, 'Rentals in Kabaganda', ['price', 'exact area and district'], { now: now + 30000 }), /Not saved yet/);
  assert.match(route.employeeIncompleteNoticeOnce(data, 'Flat in Kiteezi', missing, { now: now + 40000 }), /Not saved yet/);
  assert.match(route.employeeIncompleteNoticeOnce(data, 'Flat in Kiteezi', missing, { now: now + 40000 + 6 * 60000 }), /Not saved yet/);
});

test('a rent budget is a month\'s rent in the line above the results', () => {
  assert.match(route.filtersLeadLine({ searchType: 'rent', maxBudgetUgx: 200000, propertyType: 'house' }, 'en'), /up to USh 200,000\/month:/);
  assert.doesNotMatch(route.filtersLeadLine({ searchType: 'sale', maxBudgetUgx: 200000000, propertyType: 'house' }, 'en'), /month/);
});

test('"Hy", "Hii" and "Helo" are hello', () => {
  for (const said of ['Hy', 'Hii', 'Helo', 'Hlo', 'Hallo', 'heyyy', 'Hie', 'hello']) assert.strictEqual(route.isGreetingText(said), true, said);
  for (const said of ['Hoima', 'Hy I need a house']) assert.strictEqual(route.isGreetingText(said), false, said);
});
