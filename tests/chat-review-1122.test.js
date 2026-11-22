'use strict';

/**
 * The first batch from the review of every WhatsApp chat on 21–22 Nov 2026.
 *
 * - "Hai" got the menu with a numbered language list under it, and "1" was
 *   read as English, so the menu came back and the person was stuck.
 * - Every save in King's review put the title in front of the description
 *   again ("Land for sale in Kasana Land for sale in Kasana…").
 * - Team notes carried agents' numbers in full.
 * - The payment report said "payment link sent" for links still waiting.
 * - A waiting "your property is live" stayed waiting after the listing was
 *   hidden.
 * - Kasana was only known as the one in Kayunga.
 * - Requests waiting days on an agent's answer were only counted.
 *
 * Every name and number here is made up.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('hello gets the menu alone: one numbered list, and LANGUAGE still opens the language list', () => {
  const source = read('routes/whatsapp.js');
  const start = source.indexOf("  // GREETING\n  if (step === 'greeting') {");
  const end = source.indexOf('  // CHOOSE LANGUAGE', start);
  assert.ok(start > 0 && end > start, 'the greeting step is where it was');
  const greeting = source.slice(start, end);
  assert.match(greeting, /return respond\(friendlyGreetingReply\(lang, sessionData\), 'main_menu'\);/);
  assert.doesNotMatch(greeting, /chooseLanguage/, 'no language list under the menu');
  assert.doesNotMatch(greeting, /'choose_language'\)/, 'a number after hello means the menu');
  assert.match(source, /if \(bodyUpper === 'LANG' \|\| bodyUpper === 'LANGUAGE'\) \{/);
});

test("King's review save keeps one title at the front, however many times it is saved", () => {
  const { cleanPastedListingCopy, withoutRepeatedLead } = require('../utils/pastedListingCopy');

  const listing = {
    title: 'Land for sale in Kasana',
    area: 'Kasana',
    district: 'Luwero',
    listing_type: 'land',
    description: 'Land for sale in Kasana Land for sale in Kasana Land for sale in Kasana, Luwero, listed at UGX 39,000,000. Contact the agent on WhatsApp to view.',
    extra_fields: { source_caption: 'LAND FOR SALE via Kasana Luwero 39M' }
  };
  const wanted = 'Land for sale in Kasana, Luwero, listed at UGX 39,000,000. Contact the agent on WhatsApp to view.';
  let row = listing;
  for (let save = 1; save <= 3; save += 1) {
    const out = cleanPastedListingCopy(row);
    assert.equal(out.description, wanted, `save ${save}`);
    assert.equal(out.title, 'Land for sale in Kasana');
    row = { ...row, title: out.title, description: out.description };
  }

  // A clean description is left as it is, and a long one is not cut at 420.
  const clean = cleanPastedListingCopy({ ...listing, description: wanted });
  assert.equal(clean.description, wanted);
  const long = `House for sale in Muyenga. ${'Quiet road, '.repeat(60)}the end.`;
  const kept = cleanPastedListingCopy({ title: 'House for sale in Muyenga', area: 'Muyenga', district: 'Kampala', listing_type: 'sale', description: long });
  assert.ok(kept.description.length > 600, 'the description keeps its length');
  assert.match(kept.description, /the end\.$/);

  // A description that does not open with the title gets it in front, once.
  const plain = cleanPastedListingCopy({ ...listing, description: 'Titled, 50 by 100, near the tarmac.' });
  assert.equal(plain.description, 'Land for sale in Kasana. Titled, 50 by 100, near the tarmac.');

  // With no description, the pasted copy is used as before.
  const pasted = cleanPastedListingCopy({
    title: '*3 BEDROOM HOUSE* 🔥 Kira for rent 1.5M',
    area: 'Kira',
    district: 'Wakiso',
    listing_type: 'rent',
    property_type: 'house',
    bedrooms: 3,
    description: '',
    extra_fields: { source_caption: '*3 BEDROOM HOUSE* 🔥 Kira for rent 1.5M call now' }
  });
  assert.match(pasted.description, /^3-bed house for rent in Kira\. /);
  assert.doesNotMatch(pasted.description, /\*/);

  assert.equal(withoutRepeatedLead('Plot in Kira Plot in Kira Plot in Kira, Wakiso', ['Plot in Kira']), 'Plot in Kira, Wakiso');
  assert.equal(withoutRepeatedLead('PLOT IN KIRA plot in kira, near the road', ['Plot in Kira']), 'plot in kira, near the road');
  assert.equal(withoutRepeatedLead('Plot Plot near the road', ['Plot']), 'Plot Plot near the road', 'a title under 8 characters is left alone');
  assert.equal(withoutRepeatedLead('Plot in Kira, Wakiso', ['Plot in Kira']), 'Plot in Kira, Wakiso');
});

test('migration 251 repairs live and waiting descriptions, keeps the old text, and sends nothing', () => {
  // It was run against a scratch Postgres with one listing for each shape the
  // bug left (see the PR); this checks the parts that keep it safe.
  const sql = read('db/migrations/251_description_repeated_title.sql');
  assert.match(sql, /WHERE status IN \('approved', 'pending'\)/, 'hidden and removed listings are left alone');
  assert.match(sql, /length\(btrim\(COALESCE\(title, ''\)\)\) >= 8/);
  assert.match(sql, /IF lower\(left\(d, 2 \* length\(t\) \+ 1\)\) = tl \|\| ' ' \|\| tl THEN/, 'the title repeated in front');
  assert.match(sql, /\(\?:for sale\|for rent\|to let\|to rent\|for lease\) in/, 'only a lead sentence shaped like a listing title is taken off');
  assert.match(sql, /IF length\(core\) >= 8 AND strpos\(lower\(head\), lower\(core\)\) > 0 THEN/, 'a caption at the end goes only when it is already in the description');
  assert.match(sql, /' current availability, full specifications and viewing arrangements\.'/);
  assert.match(sql, /jsonb_build_object\('steps', to_jsonb\(steps\), 'description_before', before_text\)/, 'the old text is kept');
  const writes = sql.match(/\b(?:INSERT INTO|UPDATE)\s+\w+/gi) || [];
  assert.deepStrictEqual([...new Set(writes.map((w) => w.split(/\s+/).pop()))].sort(), ['properties', 'property_moderation_events']);
  assert.doesNotMatch(sql, /outbound_message_queue|notifications/i, 'nobody is sent anything');
});

test('a note to the team shows a phone number by its last three digits; amounts, ids and links stay', () => {
  const { maskNumbersForTeam } = require('../services/leadDeskService');
  const masked = [
    ['Agent: +256772123456 wants a call', 'Agent: …456 wants a call'],
    ['Agent: +0772123456', 'Agent: …456'],
    ['call 0772 123 456 today', 'call …456 today'],
    ['0772-123-456 called', '…456 called'],
    ['+44 7700 900123', '…123'],
    ['(+256 772 123456)', '(…456)'],
    ['Two: 0772123456, 0700000567', 'Two: …456, …567'],
    // What comes after a number is not part of it.
    ['Sarah · +256772123456\n2 listings', 'Sarah · …456\n2 listings'],
    ['+256772123456 3 bedrooms', '…456 3 bedrooms'],
    ['From SENDER (256772123456) on 2026-11-22 10:00:00', 'From SENDER (…456) on 2026-11-22 10:00:00']
  ];
  for (const [note, shown] of masked) assert.equal(maskNumbersForTeam(note), shown, note);
  const kept = [
    'Ref MK-20261122-30ABA7 is live',
    'Transaction ID: 61234567890',
    'Financial Transaction Id: 61234567890.',
    'Payment reference: 123456789012',
    'Lead ID: 1cb2e4d0-48f0-44a7-b09a-9e926136080c',
    'Budget UGX 280000000, ref 12345',
    '280000000 UGX asked',
    'Money in (last 24h): UGX 1,234,567',
    'Paid until 2026-12-22',
    'Send: https://wa.me/256700000001?text=Hi',
    ''
  ];
  for (const note of kept) assert.equal(maskNumbersForTeam(note), note, note);
  const source = read('services/leadDeskService.js');
  const send = source.slice(source.indexOf('async function sendToTeam('));
  assert.match(send.slice(0, 400), /body = maskNumbersForTeam\(body\);/, 'every note to the team goes through it');
});

test('the payment report says when a payment link is still waiting, and gives the hello link', () => {
  const billing = require('../services/billingOpsService');
  const rows = [
    { name: 'Agent Waiting', phone: '…111', state: 'unpaid', kind: 'no_free_days', days_left: -2, started: '2026-11-20', pay_link_waiting: true, terms_accepted_at: null },
    { name: 'Agent Sent', phone: '…222', state: 'unpaid', kind: 'no_free_days', days_left: -3, started: '2026-11-19', pay_link_waiting: false, terms_accepted_at: '2026-11-19' }
  ];
  const digest = billing.buildTrialDigest(rows);
  const waitingLine = digest.split('\n').find((line) => line.includes('Agent Waiting'));
  const sentLine = digest.split('\n').find((line) => line.includes('Agent Sent'));
  assert.match(waitingLine, /payment link NOT delivered: they have not written to the makaug number, so it is waiting/);
  assert.match(sentLine, /payment link sent/);
  assert.match(digest, /1 payment link is waiting for the agent to write to the makaug number first, and it is dropped after 7 days\. Send them this from your phone to tap and send: https:\/\/wa\.me\//);

  const source = read('services/billingOpsService.js');
  assert.match(source, /'agent_fee_link_on_approval', 'agent_pay_link_staff_sent'/);
  assert.match(source, /pay_link_waiting: linkWaiting\.has\(/);
});

test('a waiting "your property is live" is dropped once the listing is no longer live', async () => {
  const db = require('../config/database');
  const bridge = require('../services/whatsappWebBridgeService');
  const calls = [];
  const originalQuery = db.query;
  db.query = async (sql, params = []) => { calls.push({ sql, params }); return { rowCount: 1, rows: [] }; };
  try {
    assert.equal(await bridge.letGoOfLiveNoticesNoLongerTrue({ force: true }), 1);
  } finally {
    db.query = originalQuery;
  }
  assert.equal(calls.length, 1);
  const sql = calls[0].sql;
  assert.match(sql, /UPDATE outbound_message_queue\s+SET status = 'failed'/);
  assert.match(sql, /status IN \('pending', 'retry'\)/);
  assert.match(sql, /message_kind', ''\) = 'listing_status_approved'/);
  assert.match(sql, /NOT EXISTS \(\s*SELECT 1 FROM properties p\s*WHERE p\.id = \(outbound_message_queue\.metadata->>'listing_id'\)::uuid\s*AND p\.status = 'approved'/);
  assert.match(sql, /listing_no_longer_live/);

  // It runs when the bridge claims, after the check that the session can send.
  const source = read('services/whatsappWebBridgeService.js');
  const sessionCheck = source.indexOf('if (await bridgeSessionCannotSend(normalizedClientId)) return [];');
  const sweep = source.indexOf('await letGoOfLiveNoticesNoLongerTrue();', sessionCheck);
  const claim = source.indexOf('WITH claimable AS', sessionCheck);
  assert.ok(sessionCheck > 0 && sweep > sessionCheck && claim > sweep);
});

test('Kasana alone is the town in Luwero; Kasana with Kayunga stays in Kayunga', () => {
  const { canonicalizeUgandaLocation } = require('../utils/ugandaLocationRegistry');
  const { districtForKnownArea } = require('../utils/ugandaLocationHierarchy');
  assert.equal(canonicalizeUgandaLocation('Kasana').district, 'Luwero');
  assert.equal(canonicalizeUgandaLocation('Kasana', 'Luwero').district, 'Luwero');
  assert.equal(canonicalizeUgandaLocation('Kasana', 'Kayunga').district, 'Kayunga');
  assert.equal(districtForKnownArea('Kasana'), 'Luwero');
  assert.equal(canonicalizeUgandaLocation('Butalangu', 'Nakaseke').district, 'Nakaseke');
});

test('the morning lead-desk report names the requests an agent has not answered in two days', () => {
  const source = read('services/leadDeskService.js');
  assert.match(source, /x\.response = 'awaiting'\s+AND x\.sent_at < NOW\(\) - INTERVAL '2 days'/);
  assert.match(source, /No answer from the agent for more than 2 days — chase them or send the request to another agent:/);
});
