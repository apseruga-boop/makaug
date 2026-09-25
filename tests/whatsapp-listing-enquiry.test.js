'use strict';

/**
 * A renter tapped the WhatsApp button on a property page. The site wrote the
 * message for them:
 *
 *   Hi makaug, I'm viewing this listing on makaug.com: Property for rent in
 *   Lweza in Lweza, Wakiso, Central. Please help me confirm availability and
 *   the next safe step. Ref: MK-20260809-A7EA38 https://makaug.com/property/…
 *
 * They were answered with "Got it - I will help you list this to rent. Are you
 * the owner of this property, or an agent listing on behalf of an owner?" — the
 * words "listing" and "for rent" had been read as someone wanting to post a
 * property. The listing they were asking about was one makaug found published
 * on TikTok, with no phone number anywhere on it.
 *
 * What they should get: what the listing is, that we found it online and
 * cannot confirm availability, who posted it and where to reach them, and the
 * steps that keep them safe.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  buildListingEnquiryReply,
  listingEnquiryNotFoundReply,
  listingEnquiryOpeningMessage,
  listingSourceFacts,
  parseListingEnquiry,
  whatsappChatLink
} = require('../services/whatsappListingEnquiryService');

const REAL_MESSAGE = "Hi makaug, I'm viewing this listing on makaug.com: Property for rent in Lweza in Lweza, Wakiso, Central. Please help me confirm availability and the next safe step. Ref: MK-20260809-A7EA38 https://makaug.com/property/f74f6d85-bcea-4311-8407-8b630eeda988 Page: makaug.com/property/f74f6d85-bcea-4311-8407-8b630eeda988";

const FOUND_ONLINE = {
  id: 'f74f6d85-bcea-4311-8407-8b630eeda988',
  title: 'Property for rent in Lweza',
  listing_type: 'rent',
  price: '400000',
  area: 'Lweza',
  district: 'Wakiso',
  source: 'found_online_property_source_v1',
  listed_via: 'found_online',
  inquiry_reference: 'MK-20260809-A7EA38',
  lister_name: 'SWH RENTALS',
  lister_phone: null,
  extra_fields: {
    found_online: true,
    source_badge: 'found_online',
    source_platform: 'TikTok',
    source_name: 'SWH RENTALS',
    source_contact_url: 'https://www.tiktok.com/@smartwayhomesrentals',
    source_url: 'https://www.tiktok.com/@smartwayhomesrentals/video/7670512279473032469'
  }
};

const LISTED_WITH_US = {
  id: '11111111-2222-4333-8444-555555555555',
  title: '4-bed property for sale in Kira',
  listing_type: 'sale',
  price: '450000000',
  area: 'Kira',
  district: 'Wakiso',
  source: 'whatsapp_employee_intake',
  listed_via: 'whatsapp',
  inquiry_reference: 'MK-20260901-BBBB11',
  lister_name: 'Kimuli Brian',
  lister_phone: '+256774505232',
  extra_fields: { public_contact_phone: '+256774505232' }
};

test('the message a property page writes is read as an enquiry about that listing', () => {
  const parsed = parseListingEnquiry(REAL_MESSAGE);
  assert.ok(parsed, 'the real message must be recognised');
  assert.strictEqual(parsed.propertyId, 'f74f6d85-bcea-4311-8407-8b630eeda988');
  assert.strictEqual(parsed.reference, 'MK-20260809-A7EA38');
  assert.strictEqual(parsed.asksAvailability, true);
});

test('a reference or a link on its own is still an enquiry', () => {
  assert.strictEqual(parseListingEnquiry('MK-20260809-A7EA38').reference, 'MK-20260809-A7EA38');
  assert.strictEqual(
    parseListingEnquiry('is this one still free? makaug.com/property/f74f6d85-bcea-4311-8407-8b630eeda988').propertyId,
    'f74f6d85-bcea-4311-8407-8b630eeda988'
  );
});

test('somebody wanting to post a property is not an enquiry', () => {
  for (const text of [
    'I want to list my house for rent in Ntinda',
    'Hello',
    'Please help me list this land for sale',
    'I have a 3 bedroom in Kira to rent out'
  ]) {
    assert.strictEqual(parseListingEnquiry(text), null, `"${text}" must still reach the listing flow`);
  }
});

test('a listing found online sends the person to whoever posted it', () => {
  const reply = buildListingEnquiryReply(FOUND_ONLINE, {
    title: 'Property for rent in Lweza',
    priceLabel: 'UGX 400K/month',
    propertyUrl: 'https://makaug.com/property/f74f6d85-bcea-4311-8407-8b630eeda988',
    reference: 'MK-20260809-A7EA38'
  });

  assert.match(reply, /found this one published online/i);
  assert.match(reply, /cannot confirm whether it is still available/i);
  assert.match(reply, /SWH RENTALS/);
  assert.match(reply, /TikTok/);
  assert.match(reply, /https:\/\/www\.tiktok\.com\/@smartwayhomesrentals/);
  assert.match(reply, /video\/7670512279473032469/, 'the original post is the evidence, so it goes in');
  assert.match(reply, /Before you pay anyone/i);

  assert.ok(!/are you the owner/i.test(reply), 'never ask a renter whether they own the property');
  assert.ok(!/I will help you list/i.test(reply), 'never offer to list a property to someone asking about one');
});

test('the safety steps are there, and they are the ones that matter', () => {
  const reply = buildListingEnquiryReply(FOUND_ONLINE, { title: 'x' });
  const steps = reply.split('\n').filter((line) => /^\d\./.test(line));
  assert.strictEqual(steps.length, 5, 'five steps, every time');
  assert.match(reply, /in person before you pay/i);
  assert.match(reply, /Never send a deposit/i);
  assert.match(reply, /title, tenancy agreement or ownership papers/i);
  assert.match(reply, /daylight/i);
});

/**
 * The last step used to say "stop and tell us — reply here and we will look
 * into it". We are not at the gate with them and cannot intervene; that put a
 * step between the person and walking away.
 */
test('the last step says walk away, not report it to us', () => {
  const reply = buildListingEnquiryReply(FOUND_ONLINE, { title: 'x' });
  assert.match(reply, /If anything feels wrong, stop\./);
  assert.match(reply, /only go ahead when you are completely comfortable/i);
  assert.ok(!/tell us/i.test(reply), 'never route a person in trouble back through us');
  assert.ok(!/we will look into it/i.test(reply));
});

/**
 * A number is only useful if it opens the conversation. The person should land
 * in a chat with the lister with the first message already written, rather than
 * read instructions about how to make contact.
 */
test('a number becomes a tap that opens the chat, already written', () => {
  const reply = buildListingEnquiryReply(LISTED_WITH_US, {
    title: '4-bed property for sale in Kira',
    priceLabel: 'UGX 450M',
    reference: 'MK-20260901-BBBB11'
  });
  assert.match(reply, /https:\/\/wa\.me\/256774505232\?text=/, 'the chat link is the point');
  assert.match(reply, /Message Kimuli Brian on WhatsApp/);
  assert.match(reply, /Or call \+256774505232/);
  assert.match(reply, /cannot confirm availability/i);
  assert.ok(!/found this one published online/i.test(reply));

  const link = whatsappChatLink('+256774505232', 'Hi there');
  assert.strictEqual(link, 'https://wa.me/256774505232?text=Hi%20there');
  assert.strictEqual(whatsappChatLink('0774505232', 'Hi there'), link,
    'a number written the local way must open the same chat');
  assert.strictEqual(whatsappChatLink('1234', 'Hi'), '', 'nothing usable, no link');
});

test('the message waiting in that chat says what it needs to', () => {
  const opening = listingEnquiryOpeningMessage({
    title: '4-bed house',
    location: 'Kira, Wakiso',
    reference: 'MK-20260901-BBBB11'
  });
  assert.match(opening, /I saw 4-bed house in Kira, Wakiso on makaug/);
  assert.match(opening, /Ref MK-20260901-BBBB11/);
  assert.match(opening, /still available/i);
  assert.match(opening, /viewing/i);

  assert.strictEqual(
    listingEnquiryOpeningMessage({ title: 'Property for rent in Lweza', location: 'Lweza, Wakiso' }),
    'Hi, I saw Property for rent in Lweza on makaug.com. Is it still available, and can I arrange a viewing?',
    'a title generated from the area must not read "in Lweza in Lweza, Wakiso"'
  );
});

test('a found-online listing with a number gets the chat link too', () => {
  const withPhone = {
    ...FOUND_ONLINE,
    extra_fields: { ...FOUND_ONLINE.extra_fields, public_contact_phone: '0700111222' }
  };
  const reply = buildListingEnquiryReply(withPhone, { title: 'Property for rent in Lweza' });
  assert.match(reply, /https:\/\/wa\.me\/256700111222\?text=/);
  assert.match(reply, /found this one published online/i, 'it is still a listing we did not take in');
});

test('a listing with nobody to contact says so instead of inventing a route', () => {
  const orphan = { ...LISTED_WITH_US, lister_phone: null, extra_fields: {} };
  const reply = buildListingEnquiryReply(orphan, { title: 'x' });
  assert.match(reply, /do not have a contact number on file/i);
  assert.match(reply, /\*FIND\*/);
});

test('a listing that has gone says so rather than going quiet', () => {
  const reply = listingEnquiryNotFoundReply('MK-20200101-ZZZZ99');
  assert.match(reply, /could not find that listing/i);
  assert.match(reply, /MK-20200101-ZZZZ99/);
});

test('where a listing came from is read from the listing, not guessed', () => {
  const facts = listingSourceFacts(FOUND_ONLINE);
  assert.strictEqual(facts.foundOnline, true);
  assert.strictEqual(facts.platform, 'TikTok');
  assert.strictEqual(facts.posterName, 'SWH RENTALS');
  assert.strictEqual(facts.phone, '');
  assert.strictEqual(listingSourceFacts(LISTED_WITH_US).foundOnline, false);
  assert.strictEqual(listingSourceFacts(LISTED_WITH_US).phone, '+256774505232');
});

/** The whole path, from the words that arrive to the words that go back. */
test('the real message is answered as an enquiry, and listing requests still list', async () => {
  const db = require('../config/database');
  const originalQuery = db.query;
  const originalGetClient = db.getClient;
  const session = {
    phone: '+256707845549', current_step: 'greeting', language: 'en',
    listing_draft: {}, session_data: {}
  };
  let propertyRow = FOUND_ONLINE;
  db.query = async (sql) => {
    if (/SELECT \* FROM whatsapp_sessions WHERE phone/i.test(sql)) return { rows: [session] };
    if (/FROM properties/i.test(sql) && /inquiry_reference/i.test(sql)) {
      return { rows: propertyRow ? [propertyRow] : [] };
    }
    return { rows: [] };
  };
  db.getClient = async () => ({ query: async () => ({ rows: [] }), release() {} });

  try {
    const { processMessage } = require('../routes/whatsapp').__test;
    const enquiry = await processMessage('+256707845549', REAL_MESSAGE, null, null, { session, language: 'en' });
    assert.match(enquiry.message, /found this one published online/i);
    assert.match(enquiry.message, /smartwayhomesrentals/);
    assert.ok(!/are you the owner/i.test(enquiry.message),
      'this is the exact answer the renter got, and it must never come back');

    const listing = await processMessage('+256707845549', 'I want to list my house for rent in Ntinda', null, null, { session, language: 'en' });
    assert.match(listing.message, /help you list this/i, 'a real listing request must still reach the listing flow');
  } finally {
    db.query = originalQuery;
    db.getClient = originalGetClient;
  }
});
