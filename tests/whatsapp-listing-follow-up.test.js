'use strict';

/**
 * 13 Nov 2026, 11:15. A renter tapped WhatsApp on the "Apartment for rent in
 * Ntinda, UGX 900,000" page. That listing was found online: a TikTok post by
 * SALIPHINA PROPERTIES, with no phone number.
 *
 *   11:15 "Hi makaug, I'm on makaug.com and need property help. ... Page: makaug.com/property/9eca48c6-…"
 *         -> the property card, and nothing else
 *   11:17 "Is this available and how can we arrange for viewing ❔"
 *         -> "I can help with that. Tell me what you need in one sentence" (the menu)
 *
 * The first answer was right when it was written: found online, who posted it,
 * where to ask them, the safety steps. But a reply with one property link is
 * turned into that property's card, and the card replaced all of it. The second
 * message had no link, so nothing connected it to the listing.
 */
const test = require('node:test');
const assert = require('node:assert');

const db = require('../config/database');
const { buildListingEnquiryReply, isListingEnquiryReply } = require('../services/whatsappListingEnquiryService');
const route = require('../routes/whatsapp').__test;

const ID = '9eca48c6-ec72-42b8-a645-86aa7964d0c8';
const NTINDA = {
  id: ID,
  title: 'APARTMENT FOR RENT IN NTINDA UGX 900,000 simple elegant',
  listing_type: 'rent',
  price: '900000',
  price_period: 'mo',
  area: 'Ntinda',
  district: 'Kampala',
  status: 'approved',
  source: 'found_online_property_source_v1',
  listed_via: 'found_online',
  inquiry_reference: 'MK-20260915-C703AD',
  lister_name: 'SALIPHINA PROPERTIES',
  lister_phone: null,
  agent_id: null,
  extra_fields: {
    found_online: true,
    source_platform: 'TikTok',
    source_name: 'SALIPHINA PROPERTIES',
    source_url: 'https://www.tiktok.com/@saliphinaproperties/video/7681615926889942280',
    source_contact_url: 'https://www.tiktok.com/@saliphinaproperties'
  }
};
const RENTER = '+256701234884';

test('an enquiry answer is recognised, and a plain card is not', () => {
  const answer = buildListingEnquiryReply(NTINDA, { title: 'Apartment for rent in Ntinda', propertyUrl: `https://makaug.com/property/${ID}` });
  assert.strictEqual(isListingEnquiryReply(answer), true);
  assert.strictEqual(isListingEnquiryReply(`🏡 APARTMENT FOR RENT IN NTINDA\n🔗 https://makaug.com/property/${ID}`), false);
});

function withQueue(run) {
  const original = db.query;
  const inserted = [];
  db.query = async (sql, params = []) => {
    if (/INSERT INTO outbound_message_queue/i.test(sql)) {
      inserted.push(JSON.parse(params[1]));
      return { rows: [{ id: `q-${inserted.length}`, status: 'pending' }] };
    }
    if (/FROM properties p/i.test(sql) && /property_images/i.test(sql)) {
      return { rows: [{ ...NTINDA, transaction_type: null, primary_image_url: 'https://media.makaug.com/x.jpg' }] };
    }
    return { rows: [] };
  };
  return Promise.resolve(run(inserted)).finally(() => { db.query = original; });
}

test('the enquiry answer goes out whole, not as the bare card', async () => {
  const answer = buildListingEnquiryReply(NTINDA, { title: 'Apartment for rent in Ntinda', propertyUrl: `https://makaug.com/property/${ID}` });
  await withQueue(async (inserted) => {
    await route.queueWhatsappWebBridgeAutoReply({ phone: RENTER, message: answer, inboundMessageId: 'in-1' });
    assert.strictEqual(inserted.length, 1);
    assert.match(inserted[0].text, /We found this one published online/);
    assert.match(inserted[0].text, /SALIPHINA PROPERTIES/);
    assert.match(inserted[0].text, /View the property in person before you pay anything/);
    assert.strictEqual(inserted[0].media_url, undefined, 'no card in its place');
  });
  // A reply that is only the property still becomes its card, as before.
  await withQueue(async (inserted) => {
    await route.queueWhatsappWebBridgeAutoReply({ phone: RENTER, message: `Here it is: https://makaug.com/property/${ID}`, inboundMessageId: 'in-2' });
    assert.ok(inserted[0].media_url, 'the card, with its photo');
  });
});

test('"Is this available and how can we arrange for viewing" is about the listing just sent', async () => {
  const original = db.query;
  const originalGetClient = db.getClient;
  const session = {
    phone: RENTER, current_step: 'main_menu', language: 'en', listing_draft: {},
    session_data: { listing_enquiry_property_id: ID, listing_enquiry_reference: null, listing_enquiry_at: new Date(Date.now() - 2 * 60 * 1000).toISOString() }
  };
  db.query = async (sql) => {
    if (/SELECT \* FROM whatsapp_sessions WHERE phone/i.test(sql)) return { rows: [session] };
    if (/FROM properties/i.test(sql) && /inquiry_reference/i.test(sql)) return { rows: [NTINDA] };
    return { rows: [] };
  };
  db.getClient = async () => ({ query: async () => ({ rows: [] }), release() {} });
  try {
    const answer = await route.processMessage(RENTER, 'Is this available and how can we arrange for viewing ❔', null, null, { session, language: 'en' });
    assert.match(answer.message, /found this one published online/i);
    assert.match(answer.message, /saliphinaproperties/);
    assert.doesNotMatch(answer.message, /Tell me what you need in one sentence/);

    // A new search is still a new search.
    const search = await route.processMessage(RENTER, 'Any 2 bedroom available in Kira under 1m?', null, null, { session, language: 'en' });
    assert.doesNotMatch(search.message || '', /found this one published online/i);

    // Six hours on, "is it available" is no longer tied to that listing.
    session.session_data.listing_enquiry_at = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
    const later = await route.processMessage(RENTER, 'Is it still available?', null, null, { session, language: 'en' });
    assert.doesNotMatch(later.message || '', /found this one published online/i);
  } finally {
    db.query = original;
    db.getClient = originalGetClient;
  }
});
