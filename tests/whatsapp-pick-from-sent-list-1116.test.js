'use strict';

/**
 * A reply about one of the properties we just sent. 16 Nov 2026.
 *
 * A member of staff sent a renter two rooms, a self-contained double in Kira
 * and studio rooms in Zana, both 300K a month, as makaug.com/p/ links. He
 * answered "The studio of 300k seems okay", and the assistant read it as a new
 * search for studios and asked for the area. A reply that points at one of
 * the properties just sent is about that one: who holds it, how to reach them
 * (an approved agent's makaug profile among it), that makaug did not post a
 * listing found online, and the terms.
 *
 * Every name and number here is made up.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { pickShownListing, listingCodesInText, pickPriceFigures } = require('../routes/whatsapp').__test;
const { buildListingEnquiryReply } = require('../services/whatsappListingEnquiryService');

const KIRA = { id: '11111111-1111-4111-8111-111111111111', title: 'Self contained double room in Kira', property_type: 'room', area: 'Kira', district: 'Wakiso', price: 300000, bedrooms: 1 };
const ZANA = { id: '22222222-2222-4222-8222-222222222222', title: 'new studio rooms @300k with good access to main road KFC Zana', property_type: '', area: 'Zana', district: 'Wakiso', price: 300000 };
const SENT = [KIRA, ZANA];

test('a reply that points at one of the properties just sent picks it', () => {
  const picks = {
    'The studio of 300k seems okay': 'Zana',
    'The studio of 300k seems okay, how do I see it?': 'Zana',
    'the zana one': 'Zana',
    'I want the first one': 'Kira',
    'the second': 'Zana',
    'last one': 'Zana',
    'ok the kira room': 'Kira',
    'Is the double room still available?': 'Kira',
    'Can I see the self-contained one': 'Kira'
  };
  for (const [reply, area] of Object.entries(picks)) {
    assert.strictEqual(pickShownListing(reply, SENT)?.area, area, reply);
  }
});

test('a new search, or a reply that could be either, is not a pick', () => {
  for (const reply of [
    'studio in ntinda under 300k',
    '2 bedroom house in Kira under 500k',
    '2 bedroom house in Kira',
    'the house',
    'the 300k one',
    'okay',
    'Hello',
    'Thank you'
  ]) {
    assert.strictEqual(pickShownListing(reply, SENT), null, reply);
  }
});

test('one property sent, and a reply that wants it', () => {
  assert.strictEqual(pickShownListing('I like it', [ZANA])?.area, 'Zana');
  assert.strictEqual(pickShownListing('hello', [ZANA]), null);
  assert.strictEqual(pickShownListing('The studio of 300k seems okay', []), null);
});

test('the property links and prices in a message are read', () => {
  assert.deepStrictEqual(
    listingCodesInText('see makaug.com/p/f9b9e3d6 and https://makaug.com/property/fca4bfa1-9861-4a02-bf45-8afd81f4c008, again makaug.com/p/f9b9e3d6'),
    ['f9b9e3d6', 'fca4bfa1']
  );
  assert.deepStrictEqual(pickPriceFigures('the studio of 300k'), [300000]);
  assert.deepStrictEqual(pickPriceFigures('1.2m or 300,000 or 350'), [1200000, 300000, 350000]);
});

test('the answer says who holds it and how to reach them, that makaug did not post it, and the terms', () => {
  const found = buildListingEnquiryReply({
    ...ZANA,
    source: 'found_online_property_source_v1',
    public_contact_phone: '+256700000456',
    extra_fields: {
      found_online: true,
      source_name: 'REPLAY REALTOR',
      source_platform: 'TikTok',
      source_url: 'https://www.tiktok.com/@replay_realtor/video/7000000000000000001',
      source_contact_url: 'https://www.tiktok.com/@replay_realtor'
    }
  }, { title: ZANA.title, propertyUrl: 'https://makaug.com/property/x', termsUrl: 'https://makaug.com/terms' });
  assert.match(found, /We found this one published online\* — it was not posted by makaug/);
  assert.match(found, /It was posted by \*REPLAY REALTOR\* on TikTok\./);
  assert.match(found, /📞 Or call \+256700000456/);
  assert.match(found, /Our terms: https:\/\/makaug\.com\/terms/);
  assert.doesNotMatch(found, /agent profile/);

  const agent = buildListingEnquiryReply({ ...KIRA, lister_name: 'Replay Homes', lister_phone: '+256700000141' }, {
    title: KIRA.title,
    propertyUrl: 'https://makaug.com/property/y',
    listerNotified: true,
    agentProfileUrl: 'https://makaug.com/agents/33333333-3333-4333-8333-333333333333',
    termsUrl: 'https://makaug.com/terms'
  });
  assert.match(agent, /💬 Message Replay Homes on WhatsApp: https:\/\/wa\.me\/256700000141/);
  assert.match(agent, /👤 Their makaug agent profile: https:\/\/makaug\.com\/agents\/33333333/);
  assert.match(agent, /Our terms: https:\/\/makaug\.com\/terms/);

  const plain = buildListingEnquiryReply({ ...KIRA, lister_phone: '+256700000141' }, { title: KIRA.title });
  assert.doesNotMatch(plain, /Our terms|agent profile/, 'nothing new unless asked for');
});

test('wired in after a numbered pick, from the latest message we sent with property links', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');
  const runtime = src.slice(src.indexOf('const resultsReply = await handleResultsReply('));
  assert.ok(runtime.indexOf('handleShownListingPick(') > 0 && runtime.indexOf('handleShownListingPick(') < runtime.indexOf('wantsToTalkToAPerson(step, cleanBody)'));
  const sent = src.slice(src.indexOf('async function recentlySentListings'), src.indexOf('function pickPriceFigures'));
  assert.match(sent, /FROM outbound_message_queue/);
  assert.match(sent, /status IN \('sent', 'processing'\)/);
  assert.match(sent, /SHOWN_LISTINGS_HOURS/);
  assert.match(sent, /status = 'approved'/);
  const enquiry = src.slice(src.indexOf('async function buildWhatsappListingEnquiryResponse'), src.indexOf('function listingStartReply'));
  assert.match(enquiry, /agentProfileUrl: property\.agent_profile_url \|\| ''/);
  assert.match(enquiry, /termsUrl: `\$\{HOME_URL\}\/terms`/);
});

test('an agent answering a message about their own listing is not asking about it', () => {
  const src = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');
  const handler = src.slice(src.indexOf('async function handleShownListingPick'), src.indexOf('async function queueWhatsappWebBridgeAutoReply'));
  assert.ok(handler.indexOf('LEFT JOIN agents a ON a.id = p.agent_id') < handler.indexOf('buildWhatsappListingEnquiryResponse('));
  assert.match(handler, /COALESCE\(p\.lister_phone, ''\)/);
  assert.match(handler, /COALESCE\(a\.whatsapp, ''\)/);
  assert.match(handler, /if \(own\) return null;/);
});
