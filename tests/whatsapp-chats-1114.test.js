'use strict';

/**
 * The chats of 13-14 Nov 2026, and what they taught.
 *
 * Gilbert had been a makaug agent for a day when, between 22:37 and 23:26, he
 * sent seven properties, each a video or photos with the caption on it. He
 * writes the asking price the way many agents here do: "sold at 140M". Five
 * captions said "sold at" and not "for sale", and each was taken for news that
 * one of his live listings had sold. He had one, the Wamala house. The question
 * "Which one has gone? 1. … *0* = None of these" carried that listing's link,
 * so it went out as the listing's card and the question itself was dropped: he
 * saw his Wamala house five times, and four properties were never saved.
 * The next caption, "This house is a three bedroom house … sold at 28M", went
 * live as a 28-bed house, with the photos of a different property.
 *
 * Abbaschools, who had Arthur's agent film that morning, wrote "Good evening
 * brother It is a weekend Any program" and got the property menu.
 *
 * And the 14 Nov Morning Brief was shipped but never previewed or queued; the
 * 9:47pm check could not see what had been made.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const db = require('../config/database');
const whatsapp = require('../routes/whatsapp');
const route = whatsapp.__test;
const film = require('../services/agentFilmReplyService');
const brief = require('../services/agentBriefBroadcastService');

const GILBERT = {
  katooke120: 'Five double rooms with stores and bathrooms plus three single shops located in katooke, Nansana, wakiso all collecting 1.8M and sold at 120M',
  kibwa140: 'Three bedrooms house house plus two boys quarters found in Kibwa,Nabweru ,Nansana wakiso sold at 140M',
  katooke60: 'Two bedrooms , sitting and dinning found in katooke, Nansana,wakiso ,sold at 60M',
  wamala28: "This house is a three bedroom house,it's plot size is 25x45 ft,it is for sale,it's found in Wamala, Nansana,wakiso District and it is sold at 28M",
  katooke50: 'Four single rooms for sale,plot size 30x70ft,found in Katooke, Nansana,wakiso, collecting 600k per month and sold at 50M',
  lugoba60: 'Three double rooms for sale,plot size 35x45ft, collecting 750k per month,found in lugoba,kawempe ,Nansana,wakiso,sold at 60M',
  kazo75: 'Five single rooms and one double room all with stores,plot size 45x50ft, collecting 1M per month,found in kazo, Nabweru,Nansana ,wakiso and sold at 75M',
  kibwa130: 'Six doubles,all with toilets plus stores,plot size 65X70ft, collecting 1.8M per month , located in Kibwa,Nabweru, Nansana,wakiso and sold at 130M'
};

test('"sold at <price>" in a description is the price, not news of a sale', () => {
  for (const [key, caption] of Object.entries(GILBERT)) {
    assert.strictEqual(route.isSoldAnnouncement(caption), false, key);
  }
  // The news itself is still the news.
  for (const said of [
    'SOLD SOLD!!!! Kira Kitukutwe 330 million',
    'SOLD at 330m',
    'Sold',
    'The 4 bedroom house in Kira has been sold at 330m',
    'Kira house was sold for 330m',
    'Already sold',
    'This one is gone'
  ]) {
    assert.strictEqual(route.isSoldAnnouncement(said), true, said);
  }
  // A bare place and a price, no description: still read as the news.
  assert.strictEqual(route.isSoldAnnouncement('Kitukutwe sold at 330m'), true);
});

test('every caption Gilbert sent reads as the property he meant', () => {
  const facts = Object.fromEntries(Object.entries(GILBERT).map(([key, caption]) => [key, route.employeePropertyFacts(caption, {})]));
  // "sold at" says it is for sale: no more "Still needs: sale/rent/land/commercial/student type".
  assert.strictEqual(facts.kibwa140.listingType, 'sale');
  assert.strictEqual(facts.katooke60.listingType, 'sale');
  assert.deepStrictEqual(route.employeePropertyMissing(facts.kibwa140), []);
  assert.deepStrictEqual(route.employeePropertyMissing(facts.katooke60), []);
  assert.strictEqual(route.employeePropertyFacts('Wamala,3roomed house,sold at 28m', {}).listingType, 'sale');
  // Rooms let one by one are a building being sold, not land, whatever the plot size.
  for (const key of ['katooke50', 'lugoba60', 'kazo75', 'kibwa130']) {
    assert.strictEqual(facts[key].listingType, 'sale', key);
  }
  assert.strictEqual(
    route.employeePropertyFacts('Rental on sale at a price of 75m negotiable with a private mailo land title located at budo kasenge just 500 metres from tarmac, seated on 8 decimals Plot size The unfinished rentals has 5 double units each is expected to make 250000( 250k) per month', {}).listingType,
    'sale',
    "SFK's rentals, the same day"
  );
  // What a plot is best used for is not what is on it.
  assert.strictEqual(route.employeePropertyFacts('50x100 plot for sale in Kira best for rentals at 45m', {}).listingType, 'land');
  // The price is never a bedroom count; a number written as a word is one.
  assert.strictEqual(facts.wamala28.bedroomDraft.bedrooms, 3, 'it went live as a 28-bed house');
  assert.strictEqual(facts.kibwa140.bedroomDraft.bedrooms, 3);
  assert.strictEqual(facts.katooke60.bedroomDraft.bedrooms, 2);
  assert.strictEqual(facts.katooke120.price, 120000000);
  // Kazo is also a village beside Nabweru; the caption says Wakiso.
  assert.strictEqual(facts.kazo75.locationPatch.district, 'Wakiso');
  assert.strictEqual(route.employeePropertyFacts('3 bedroom house for sale in Kazo district at 90m', {}).locationPatch.district, 'Kazo');
  assert.strictEqual(route.employeePropertyFacts('Commercial land for sale in Kikyusa, Luweero district at 80m', {}).locationPatch.district, 'Luwero');
});

test('a reply that asks something keeps its words, with the listing photo on it', async () => {
  const LISTING = 'd5228e82-2f97-4998-8b7a-34982e912a93';
  const question = `🏷️ *Which one has gone?* Reply the number:\n\n1. *3-bed house for sale in Wamala* — Wamala, Wakiso · USh 28M\n🔗 https://makaug.com/property/${LISTING}\n\n*0* = None of these`;
  assert.strictEqual(route.replyAsksSomething(question), true);
  assert.strictEqual(route.replyAsksSomething(`🏡 3-bed house for sale in Wamala\n🔗 View photos, map & enquire: https://makaug.com/property/${LISTING}?ref=wa`), false,
    'a question mark inside a link is not a question');

  const original = db.query;
  const inserted = [];
  db.query = async (sql, params = []) => {
    if (/INSERT INTO outbound_message_queue/i.test(sql)) {
      inserted.push(JSON.parse(params[1]));
      return { rows: [{ id: `q-${inserted.length}`, status: 'pending' }] };
    }
    if (/FROM properties p/i.test(sql) && /property_images/i.test(sql)) {
      return { rows: [{ id: LISTING, title: '3-bed house for sale in Wamala', listing_type: 'sale', transaction_type: null, district: 'Wakiso', area: 'Wamala', price: '28000000', price_period: 'once', extra_fields: {}, primary_image_url: 'https://media.makaug.com/wamala.jpg' }] };
    }
    return { rows: [] };
  };
  try {
    await route.queueWhatsappWebBridgeAutoReply({ phone: '+256777796137', message: question, inboundMessageId: 'in-1' });
    assert.strictEqual(inserted.length, 1);
    assert.match(inserted[0].text, /Which one has gone\?/);
    assert.match(inserted[0].text, /None of these/);
    assert.strictEqual(inserted[0].media_url, 'https://media.makaug.com/wamala.jpg', 'the photo goes with the question');

    // A reply that only presents the listing still becomes its card.
    await route.queueWhatsappWebBridgeAutoReply({ phone: '+256777796137', message: `Here it is: https://makaug.com/property/${LISTING}`, inboundMessageId: 'in-2' });
    assert.match(inserted[1].text, /^🏡 /);
    assert.ok(inserted[1].media_url);
  } finally {
    db.query = original;
  }
});

test('a photo or video with the advert on it is an advert of its own when staff import a chat', async () => {
  const bridge = (name, mime) => `https://makaug-waha-bridge.onrender.com/media?p=${name}&m=${Buffer.from(mime).toString('base64')}&s=1`;
  const at = (minute, second = 0) => new Date(Date.UTC(2026, 10, 13, 19, minute, second)).toISOString();
  const rows = [
    { id: 1, wa_message_id: 'v-120', created_at: at(37, 11), message_type: 'media', payload: { body: GILBERT.katooke120, mediaUrl: bridge('a', 'video/mp4'), mediaType: 'video' } },
    { id: 2, wa_message_id: 'v-140', created_at: at(44, 37), message_type: 'media', payload: { body: GILBERT.kibwa140, mediaUrl: bridge('b', 'video/mp4'), mediaType: 'video' } },
    { id: 3, wa_message_id: 'p-60', created_at: at(47, 14), message_type: 'media', payload: { body: GILBERT.katooke60, mediaUrl: bridge('c', 'image/jpeg'), mediaType: 'image' } },
    { id: 4, wa_message_id: 'p-60b', created_at: at(47, 15), message_type: 'media', payload: { body: '', mediaUrl: bridge('d', 'image/jpeg'), mediaType: 'image' } },
    { id: 5, wa_message_id: 'p-60c', created_at: at(47, 16), message_type: 'media', payload: { body: '', mediaUrl: bridge('e', 'image/jpeg'), mediaType: 'image' } }
  ];
  const original = db.query;
  db.query = async (sql) => (/FROM whatsapp_messages/i.test(sql) ? { rows } : { rows: [] });
  try {
    const { groups, orphans } = await whatsapp.groupForwardedAdverts('256777796137', {});
    assert.deepStrictEqual(groups.map((g) => g.caption_message_id), ['v-120', 'v-140', 'p-60']);
    assert.deepStrictEqual(groups[0].media.map((m) => m.message_id), ['v-120']);
    assert.strictEqual(groups[0].media[0].mimeType, 'video/mp4');
    assert.deepStrictEqual(groups[2].media.map((m) => m.message_id), ['p-60', 'p-60b', 'p-60c'], 'the rest of the album joins the photo with the caption');
    assert.deepStrictEqual(groups.map((g) => g.facts.listingType), ['commercial', 'sale', 'sale']);
    assert.deepStrictEqual(groups.map((g) => g.missing), [[], [], []]);
    assert.deepStrictEqual(orphans, []);
  } finally {
    db.query = original;
  }
});

test('a film prospect who says something else hears that it was passed on', () => {
  const said = film.prospectFollowUpKind('Good evening brother It is a weekend Any program');
  assert.strictEqual(said, 'note');
  assert.strictEqual(
    film.prospectFollowUpReply({ kind: said, interested: false, helpName: 'Ronald', passedOn: true, sentBy: 'Arthur' }),
    "Thanks for your message! 🙏 I've passed it to Arthur, who will get back to you.\n\nIf you'd like to list your properties with makaug as an agent, reply *AGENT*."
  );
  // Not passed on (past the alert window): the rest of the bot answers, as before.
  assert.strictEqual(film.prospectFollowUpReply({ kind: said, interested: false, helpName: 'Ronald', passedOn: false, sentBy: 'Arthur' }), '');
  // Whoever sent the film is who sent it.
  assert.match(film.prospectFollowUpReply({ kind: 'who', helpName: 'Ronald', sentBy: 'Arthur' }), /Arthur from our team sent you that short film/);
  assert.match(film.prospectFollowUpReply({ kind: 'greeting', helpName: 'Ronald' }), /Ronald from our team sent you our short film/);
});

test('the Morning Brief that shipped can be found for its date', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-'));
  const editions = path.join(root, 'scripts', 'agent-brief', 'editions');
  const videos = path.join(root, 'assets', 'marketing', 'morning-brief');
  fs.mkdirSync(editions, { recursive: true });
  fs.mkdirSync(videos, { recursive: true });
  const caption = '☀️ *makaug Morning Brief* · Sat 14 Nov\n5 property stories that affect your business\n\nReply STOP if you don\'t want the brief.\nPhillip, makaug.com';
  assert.strictEqual(brief.shippedEdition({ date: '2026-11-14', root }), null, 'nothing made yet');
  fs.writeFileSync(path.join(editions, '2026-11-14.json'), JSON.stringify({ date: '2026-11-14', slot: 'morning', caption }));
  assert.strictEqual(brief.shippedEdition({ date: '2026-11-14', root }), null, 'an edition with no video has not shipped');
  fs.writeFileSync(path.join(videos, 'makaug-morning-brief-2026-11-14-a7abe0e9.mp4'), 'x');
  fs.writeFileSync(path.join(videos, 'makaug-morning-brief-2026-11-13-0f2a91cc.mp4'), 'x');
  const found = brief.shippedEdition({ date: '2026-11-14', root });
  assert.strictEqual(found.video_url, 'https://makaug.com/assets/marketing/morning-brief/makaug-morning-brief-2026-11-14-a7abe0e9.mp4');
  assert.strictEqual(found.caption, caption);
  assert.strictEqual(brief.shippedEdition({ date: '2026-11-14', slot: 'afternoon', root }), null);
  // Two videos for one day: which one is meant is a person's call.
  fs.writeFileSync(path.join(videos, 'makaug-morning-brief-2026-11-14-b1c2d3e4.mp4'), 'x');
  assert.strictEqual(brief.shippedEdition({ date: '2026-11-14', root }), null);
  // A caption the schedule would refuse is not offered.
  fs.writeFileSync(path.join(editions, '2026-11-13.json'), JSON.stringify({ date: '2026-11-13', slot: 'morning', caption: 'too short' }));
  assert.strictEqual(brief.shippedEdition({ date: '2026-11-13', root }), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('the 9:47pm check is told what shipped', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'routes', 'admin.js'), 'utf8');
  const block = admin.slice(admin.indexOf("router.get('/agent-broadcast/brief'"), admin.indexOf("router.post('/agent-broadcast/brief/preview'"));
  assert.match(block, /agentBrief\.shippedEdition\(\{ date, slot \}\)/);
  assert.match(block, /status,\s*\n\s*edition\b/);
});
