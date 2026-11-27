'use strict';

/**
 * 27 Nov 2026, 08:43 in Kampala. A buyer we had just sent a listing asked "Can
 * you send me same photos of those houses", and the assistant had no answer
 * but the menu. Arthur: send the links and ask them to open them, and to keep
 * our liability as low as we can, never send on the pictures of a listing found
 * online; an agent's own listing may carry its picture. Every name and number
 * here is made up.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.WHATSAPP_DELIVERY_MODE = 'web_bridge';

const test = require('node:test');
const assert = require('node:assert');

const db = require('../config/database');
const route = require('../routes/whatsapp').__test;
const cards = require('../services/whatsappPropertyCardService');

const FOUND = { id: '0b0b0b0b-0000-4000-8000-000000000001', title: 'Rentals on sale in Kyebando', listing_type: 'sale', price: 75000000, area: 'Kyebando', district: 'Kampala', listed_via: 'found_online', source: 'found_online_property_source_v1', extra_fields: { found_online: true, source_platform: 'TikTok' }, status: 'approved' };
const OURS = { id: '0c0c0c0c-0000-4000-8000-000000000002', title: '3-bed house for sale in Kira', listing_type: 'sale', price: 350000000, area: 'Kira', district: 'Wakiso', bedrooms: 3, property_type: 'house', listed_via: 'whatsapp', source: 'whatsapp_employee_intake', extra_fields: {}, status: 'approved' };

async function withListingsSent(rows, run) {
  const saved = db.query;
  const inserted = [];
  const lastText = cards.buildWhatsappResultsList(rows, { header: '🔎 *Homes for sale*' });
  db.query = async (sql, params = []) => {
    const s = String(sql);
    if (/INSERT INTO outbound_message_queue/i.test(s)) { inserted.push(JSON.parse(params[1])); return { rows: [{ id: `q-${inserted.length}`, status: 'pending' }] }; }
    if (/FROM outbound_message_queue/i.test(s) && !/reply_dedupe_key|duplicate/i.test(s)) return { rows: [{ text: lastText }] };
    if (/substr\(id::text, 1, 8\) = ANY/i.test(s)) return { rows: rows.map((row) => ({ id: row.id })) };
    if (/WHERE id = ANY\(\$1::uuid\[\]\)/i.test(s)) return { rows };
    if (/WHERE id::text LIKE \$1/i.test(s)) return { rows: rows.filter((row) => row.id.startsWith(String(params[0]).replace('%', ''))) };
    if (/FROM properties p/i.test(s) && /property_images/i.test(s)) return { rows: rows.filter((row) => row.id === params[0]).map((row) => ({ ...row, primary_image_url: 'https://media.makaug.com/x.jpg' })) };
    return { rows: [] };
  };
  try {
    return await run(inserted);
  } finally {
    db.query = saved;
  }
}

test('a photo request is a photo request; posting photos of your own house is not', () => {
  for (const said of ['Can you send me same photos of those houses', 'send more pictures', 'Any pics?', 'Can I see the video of it', 'more photos please']) {
    assert.ok(route.asksForListingPhotos(said), said);
  }
  for (const said of ['How do I post photos of my house', 'I want to upload pictures', 'Hello', 'Is it still available?', 'I am selling my land, here are the photos']) {
    assert.ok(!route.asksForListingPhotos(said), said);
  }
});

test('the photos of a listing found online are its link, and an ask to open it', async () => {
  await withListingsSent([FOUND], async () => {
    const reply = await route.handleListingPhotosRequest({ phone: '256700000270', step: 'main_menu', text: 'Can you send me same photos of those houses' });
    assert.strictEqual(reply.message, [
      '📸 Its photos are on its page. Please tap the link to see them:',
      'makaug.com/p/0b0b0b0b',
      '',
      'It was posted online, not listed with us, so for more photos or a viewing, ask whoever posted it. Reply *CONTACT* to see who posted it.'
    ].join('\n'));
  });
});

test('several listings: each one\'s link', async () => {
  await withListingsSent([FOUND, OURS], async () => {
    const reply = await route.handleListingPhotosRequest({ phone: '256700000270', step: 'main_menu', text: 'send pictures of those houses' });
    assert.match(reply.message, /^📸 The photos of each one are on its page\. Please tap a link to see them:\n\n\*1\* · .+ · makaug\.com\/p\/0b0b0b0b\n\*2\* · .+ · makaug\.com\/p\/0c0c0c0c\n\nReply \*1\* or \*2\* to see one, then \*CONTACT\* to get in touch\.$/);
  });
  await withListingsSent([], async () => {
    assert.strictEqual(await route.handleListingPhotosRequest({ phone: '256700000270', step: 'main_menu', text: 'send pictures' }), null, 'nothing sent lately: not this');
  });
});

test('a listing found online is sent as words and its link, never with its picture; ours keeps its card', async () => {
  await withListingsSent([FOUND], async (inserted) => {
    await route.queueWhatsappWebBridgeAutoReply({ phone: '+256700000270', message: cards.buildWhatsappPropertyPickCard(FOUND), nextStep: 'main_menu', inboundMessageId: 'in-found-1' });
    await route.queueWhatsappWebBridgeAutoReply({ phone: '+256700000270', message: `Here it is: https://makaug.com/property/${FOUND.id}`, nextStep: 'main_menu', inboundMessageId: 'in-found-2' });
    assert.strictEqual(inserted.length, 2);
    for (const sent of inserted) assert.ok(!sent.media_url, 'no picture of someone else\'s post');
    assert.match(inserted[1].text, /^Here it is: https:\/\/makaug\.com\/property\//, 'the words stay as written');
  });
  await withListingsSent([OURS], async (inserted) => {
    await route.queueWhatsappWebBridgeAutoReply({ phone: '+256700000271', message: cards.buildWhatsappPropertyPickCard(OURS), nextStep: 'main_menu', inboundMessageId: 'in-ours-1' });
    assert.ok(inserted[0].media_url, 'an agent\'s own listing carries its card');
  });
  assert.strictEqual(route.isFoundOnlineListing(FOUND), true);
  assert.strictEqual(route.isFoundOnlineListing(OURS), false);
});
