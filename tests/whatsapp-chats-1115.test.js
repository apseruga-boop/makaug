'use strict';

/**
 * The chats of 14-15 Nov 2026, and what they taught.
 *
 * A prospect who had the agent film answered it the next evening with a
 * greeting and a word about the weekend. He got the property menu, and the
 * Outreach desk went on saying "No reply yet" for two days.
 *
 * An agent sent five properties in one evening. One needed its district, and
 * before answering he sent the next: a description, then six photos. The
 * photos went onto the property that was waiting, a plot of land, which then
 * went live wearing a house. The house itself was never saved. Another of his
 * adverts opened "Money needed" and named a village the census lists in three
 * districts, none of them the right one: it went live titled "Money needed",
 * under one of the three.
 *
 * A member of staff registered an agent and sent his land, priced "25.m per
 * acre". The full stop made it no price at all, and the batch was left open.
 * The next day two acres in Luwero went live under Lyantonde, because the
 * census file the place list is built from has no Luwero rows.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const db = require('../config/database');
const whatsapp = require('../routes/whatsapp');
const route = whatsapp.__test;
const film = require('../services/agentFilmReplyService');
const prospects = require('../services/agentProspectService');
const registry = require('../utils/ugandaLocationRegistry');
const hierarchy = require('../utils/ugandaLocationHierarchy');
const copy = require('../services/publicListingCopy');

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');

const RENTALS = [
  'Money needed', '4 single rentals', 'For sale', 'Location📍', 'Kagoma', 'Along bombo road',
  'Seated', '30 by 50ft', 'Sales agreement👍', 'Kabaka land', 'Income 600k', 'Price 42m'
].join('\n');
const ACRES = 'Members, members Hot 🔥🎂 Hot 🔥🎂those are 2ACRES on sale with all 🥭 mango plantation very good and ready to eat, located at kikyusa town council village wabusana Gawumbeko, the owner wants money each at 18m per Acre sold once title available';
const LAND = [
  'Quick sale!!', 'Land for sale 3 acres.', 'Good for country 🏠,agricultural activities like; farming,poutly keeping etc.',
  'Located at mpiligwa kiteredde mityana road.', '13 kilometers from termac road (kikonge town).',
  'Price 25.m per acre negotiable.', 'Land tittle'
].join('\n');
const UNFINISHED = 'Rental on sale at a price of 75m negotiable with a private mailo land title located at budo kasenge just 500 metres from tarmac, seated on 8 decimals Plot size';

const daysAgo = (days) => new Date(Date.now() - days * 86400000).toISOString();

function prospect(overrides = {}) {
  return {
    id: '11111111-2222-4333-8444-555555555555',
    full_name: 'Peter Okello',
    phone: '+256700555061',
    phone_key: '700555061',
    video_kind: 'agent',
    status: 'pitched',
    pitched_at: daysAgo(2),
    days_since_pitch: 2,
    metadata: {},
    ...overrides
  };
}

test('a prospect who answers the film with a greeting and small talk is answered as a person', () => {
  const kinds = {
    'Good evening brother\nIt is a weekend\nAny program': 'smalltalk',
    'Hello how are you': 'smalltalk',
    'Good morning sir, happy Sunday': 'smalltalk',
    'Hi boss how is the day': 'smalltalk',
    // A bare greeting, a thank-you and a question keep the answers they had.
    Hello: 'greeting',
    Evening: 'greeting',
    Thanks: 'thanks',
    'Who is this': 'who',
    'Hope no money is required': 'money',
    // What they deal in is for the call, and a question after the hello is a question.
    'Hello I sell land in Mukono': 'note',
    'Hello, where is your office?': 'note',
    'Good evening, I will check and get back to you': 'note',
    'I mostly market :- land , houses and cars for sale': 'note'
  };
  for (const [said, kind] of Object.entries(kinds)) {
    assert.strictEqual(film.prospectFollowUpKind(said), kind, said);
  }

  const reply = film.prospectFollowUpReply({
    kind: 'smalltalk', first: 'Peter', helpName: 'Ronald', text: 'Good evening brother\nIt is a weekend\nAny program'
  });
  // Their own greeting back, the weekend they mentioned, what makaug does, and the one word.
  assert.match(reply, /^Good evening, Peter! 👋 Thank you for writing back\. I hope the weekend is going well\./);
  assert.match(reply, /they go on makaug\.com under your name/);
  assert.match(reply, /makaug takes no commission/);
  assert.match(reply, /Reply \*AGENT\* if you'd like to join and Ronald will call you to set you up/);
  assert.doesNotMatch(reply, /1️⃣|Choose what you need|Choose your language/);

  // No first name to use, no weekend mentioned.
  const plain = film.prospectFollowUpReply({ kind: 'smalltalk', helpName: 'Ronald', text: 'Hello how are you' });
  assert.match(plain, /^Hello! 👋 Thank you for writing back\.\n\nmakaug gets your properties seen/);
  // Somebody who already said AGENT is waiting for the call: no second pitch.
  const waiting = film.prospectFollowUpReply({ kind: 'smalltalk', interested: true, first: 'Peter', helpName: 'Ronald', text: 'Good morning' });
  assert.strictEqual(waiting, 'Good morning, Peter! 👋 Ronald will call you shortly to set you up as a makaug agent.');
  // Small talk is not something the team needs a second note about.
  assert.ok(!film.prospectNoteWorthy('smalltalk'));
});

test('the Outreach desk shows that a prospect wrote back, and what they wrote', () => {
  const wrote = prospects.publicProspect(prospect({
    metadata: { last_reply_at: daysAgo(1), last_reply: 'Good evening brother It is a weekend Any program' }
  }));
  assert.strictEqual(wrote.follow_up, 'Replied — has not said AGENT yet');
  assert.strictEqual(wrote.loop_state, 'replied');
  assert.match(wrote.next_step, /^They wrote back on \w{3},? \d{1,2} \w{3}: “Good evening brother It is a weekend Any program”\./);
  assert.match(wrote.next_step, /have not said AGENT yet, so call them/);
  assert.match(wrote.next_step, /Do not send the same joining film again/);
  assert.ok(wrote.activity.last_reply_at);
  assert.strictEqual(wrote.activity.last_reply, 'Good evening brother It is a weekend Any program');
  // Still theirs to chase: the buttons a "no reply" row has.
  assert.strictEqual(wrote.can_recontact, true);

  // The same, read from the messages table when the reply came before the bot recorded it.
  const fromMessages = prospects.publicProspect(prospect(), { last_reply_at: daysAgo(1), last_reply: 'Hello' });
  assert.strictEqual(fromMessages.follow_up, 'Replied — has not said AGENT yet');
  assert.match(fromMessages.next_step, /“Hello”/);

  // Something they wrote before the film is not a reply to it.
  const before = prospects.publicProspect(prospect(), { last_reply_at: daysAgo(40), last_reply: 'I need a house in Ntinda' });
  assert.strictEqual(before.follow_up, 'No reply yet');
  assert.strictEqual(before.loop_state, 'no_reply');
  assert.strictEqual(before.activity.last_reply_at, null);

  // Nothing written at all.
  const silent = prospects.publicProspect(prospect());
  assert.strictEqual(silent.follow_up, 'No reply yet');
  assert.match(silent.next_step, /No reply yet \(2 days ago\)/);

  // The owner film asks for LIST.
  const owner = prospects.publicProspect(prospect({ video_kind: 'owner', metadata: { last_reply_at: daysAgo(1), last_reply: 'Ok' } }));
  assert.strictEqual(owner.follow_up, 'Replied — has not said LIST yet');
  assert.match(owner.next_step, /have not said LIST yet/);

  // A yes, a no and a do-not-contact are what they were.
  const meta = { last_reply_at: daysAgo(1), last_reply: 'Agent' };
  assert.strictEqual(prospects.publicProspect(prospect({ status: 'interested', metadata: meta })).follow_up, 'Yes — they want to join');
  assert.strictEqual(prospects.publicProspect(prospect({ status: 'declined', metadata: meta })).follow_up, 'No — they said no');
  const closed = prospects.publicProspect(prospect({ do_not_contact: true, metadata: meta }));
  assert.strictEqual(closed.follow_up, 'Do not contact again');
  assert.strictEqual(closed.loop_state, 'closed_dnc');
});

test('the desk reads replies from the messages table by the columns it has', async () => {
  const original = db.query;
  const seen = [];
  db.query = async (sql, params) => {
    seen.push({ sql: String(sql), params });
    return { rows: [{ phone_key: '700555061', last_reply_at: daysAgo(1), last_reply: 'Good evening' }] };
  };
  try {
    const map = await prospects.activityForPhoneKeys(['700555061', '700555061', 'short']);
    assert.strictEqual(seen.length, 1);
    assert.match(seen[0].sql, /FROM whatsapp_messages/);
    assert.match(seen[0].sql, /user_phone/);
    assert.match(seen[0].sql, /direction = 'inbound'/);
    // The columns it used to ask for were never in the table, so it never answered.
    assert.doesNotMatch(seen[0].sql, /from_phone|received_at|\bsender\b/);
    assert.deepStrictEqual(seen[0].params, [['700555061']]);
    assert.strictEqual(map.get('700555061').last_reply, 'Good evening');
    assert.ok(map.get('700555061').last_reply_at);
  } finally {
    db.query = original;
  }
});

test('a full stop typed between a figure and its m is still a price', () => {
  const facts = route.employeePropertyFacts(LAND, {});
  assert.strictEqual(facts.listingType, 'land');
  assert.strictEqual(Number(facts.price), 25000000);
  assert.strictEqual(facts.pricePeriod, 'acre');
  assert.deepStrictEqual(route.employeePropertyMissing(facts), []);

  assert.match(route.normalizeCaptionPriceNotation('Price 25.m per acre'), /\b25m per acre/);
  assert.match(route.normalizeCaptionPriceNotation('Price 300.M negotiable'), /\b300M negotiable/);
  assert.match(route.normalizeCaptionPriceNotation('25. million shillings'), /25million/);
  // A decimal is a decimal, and a full stop at the end of a sentence is the end of it.
  assert.strictEqual(route.normalizeCaptionPriceNotation('rent at 1.5m a month'), 'rent at 1.5m a month');
  assert.strictEqual(route.normalizeCaptionPriceNotation('Plot 12. My number is below'), 'Plot 12. My number is below');
  assert.strictEqual(Number(route.employeePropertyFacts('3 bedroom house for sale in Kira, Wakiso. Plot 12. My office is in town. Price 250m', {}).price), 250000000);
});

test('photos sent after a description kept behind a waiting property are that description\'s photos', () => {
  const photo = (n) => ({ url: `https://media.makaug.com/test/photo-${n}.jpg`, sha256: `sha-${n}`, mimeType: 'image/jpeg' });
  const data = {
    whatsapp_agent_self_intake: true,
    pending_property_caption: 'Three and a half acres of land in a village the registry does not know, at 500M',
    pending_caption_sender_ms: 1000,
    pending_property_media: [photo('land-1'), photo('land-2')],
    current_sender_ms: 2000
  };
  const house = 'Three bedroom house with boys quarters for sale in Wamala, Nansana, Wakiso at 200M';
  // The next property is described while the first still needs its district: it is kept.
  route.rememberEmployeeQueuedSubmission(data, { caption: house, storedMedia: [], inboundMessageId: 'wa-house' });
  assert.strictEqual(route.employeeNewerKeptCaptionIndex(data, 2500), 0);
  // A photo the phone sent before that description is not its photo.
  assert.strictEqual(route.employeeNewerKeptCaptionIndex(data, 1500), -1);

  const added = route.addEmployeeQueuedMedia(data, 0, [photo('house-1'), photo('house-2'), photo('house-1')]);
  assert.strictEqual(added, 2, 'the same photo twice is one photo');
  route.addEmployeeQueuedMedia(data, 0, [photo('house-3')]);
  const queue = route.employeePendingSubmissionQueue(data);
  assert.strictEqual(queue[0].media.length, 3);
  // The property that is waiting keeps its own photos, and only those.
  assert.deepStrictEqual(data.pending_property_media.map((item) => item.sha256), ['sha-land-1', 'sha-land-2']);

  // When the first one is answered, the kept one comes forward with its photos.
  delete data.pending_property_caption;
  delete data.pending_property_media;
  const promoted = route.promoteEmployeeQueuedSubmission(data);
  assert.strictEqual(promoted.caption, house);
  assert.strictEqual(data.pending_property_media.length, 3);

  // A description parked because a NEWER one arrived is older than the one waiting: nothing is rerouted.
  const older = { pending_property_caption: 'Plot in Kira, Wakiso at 80m', pending_caption_sender_ms: 5000, current_sender_ms: 5000 };
  route.rememberEmployeeQueuedSubmission(older, { caption: 'House in Kira, Wakiso at 300m', storedMedia: [], inboundMessageId: 'wa-old', senderMs: 3000 });
  assert.strictEqual(route.employeeNewerKeptCaptionIndex(older, 6000), -1);
  // Nothing waiting, nothing to reroute.
  assert.strictEqual(route.employeeNewerKeptCaptionIndex({}, 6000), -1);

  // The second property saved by one message is confirmed in short.
  const facts = route.employeePropertyFacts(house, {});
  const also = route.agentAlsoSavedReply({ facts, caption: house, storedMedia: [1, 2, 3, 4, 5, 6].map((n) => ({ kind: 'image', url: `u${n}` })) });
  assert.match(also, /^✅ \*Also saved — your property in Nansana is with our team for review\.\*\n\n/);
  assert.match(also, /📍 Nansana, Wakiso/);
  assert.match(also, /UGX 200,000,000/);
  assert.match(also, /📸 6 photos saved$/);

  // Wired in: the photo path asks before it stores, the answer saves the kept
  // one as well, and the quiet-time summary saves one that is ready.
  assert.match(source, /const keptIndex = \(!ownMediaCaption && !shouldStartProperty\) \? employeeNewerKeptCaptionIndex\(data, mediaSenderMs\) : -1;/);
  assert.match(source, /await flushReadyEmployeeSubmissions\(\{ phone, currentStep, data, inboundMessageId, details: alsoSaved \}\);/);
  assert.match(source, /keptSaved = await saveReadyKeptSubmissions\(\{ phone, data \}\);/);
});

test('a village name the census has in several districts is asked about, not guessed', () => {
  const kagoma = registry.resolveCanonicalUgandaLocationFromText('Kagoma along bombo road');
  assert.strictEqual(kagoma.status, 'ambiguous');
  // The census has three. The one on the Bombo road, in Wakiso, is added by hand.
  assert.deepStrictEqual([...new Set(kagoma.candidates.map((entry) => entry.district))].sort(), ['Jinja', 'Kikuube', 'Mubende', 'Wakiso']);
  // A census ward is ranked as a census parish is, so none of them wins by its level.
  assert.strictEqual(registry.resolveCanonicalUgandaLocationFromText('Kiteredde').status, 'ambiguous');
  assert.strictEqual(registry.resolveCanonicalUgandaLocationFromText('Kagoma Jinja').match.district, 'Jinja');

  // The place named beside it settles which one.
  const kasenge = registry.resolveCanonicalUgandaLocationFromText('located at budo kasenge just 500 metres from tarmac');
  assert.strictEqual(kasenge.status, 'matched');
  assert.strictEqual(`${kasenge.match.name}, ${kasenge.match.district}`, 'Kasenge, Wakiso');
  // On its own it is still the one staff verified.
  assert.strictEqual(registry.resolveCanonicalUgandaLocationFromText('kasenge').match.district, 'Mukono');

  // Luwero is not in the census file; the two places this needed are added by hand.
  const acres = registry.resolveCanonicalUgandaLocationFromText('located at kikyusa town council village wabusana');
  assert.strictEqual(acres.status, 'matched');
  assert.strictEqual(acres.match.district, 'Luwero');
  assert.strictEqual(registry.resolveCanonicalUgandaLocation('Kikyusa').match.district, 'Luwero');
  assert.strictEqual(registry.resolveCanonicalUgandaLocation('Budo').match.name, 'Buddo');

  // Places everybody knows are where they were.
  const known = {
    'house in Ntinda': 'Kampala', Kira: 'Wakiso', Najjera: 'Wakiso', Kololo: 'Kampala', Muyenga: 'Kampala',
    'Namugongo near Seeta': 'Wakiso', 'plot in Seeta': 'Mukono', Nansana: 'Wakiso', Kitende: 'Wakiso',
    'Wamala Nansana wakiso': 'Wakiso', 'mpiligwa kiteredde mityana road': 'Mityana'
  };
  for (const [said, district] of Object.entries(known)) {
    const resolved = registry.resolveCanonicalUgandaLocationFromText(said);
    assert.strictEqual(resolved.status, 'matched', said);
    assert.strictEqual(resolved.match.district, district, said);
  }

  // What the agent is asked: about the village, not the advert's first word.
  // (Without the road: since 24 Nov "Along bombo road" settles it, below.)
  const RENTALS_NO_ROAD = RENTALS.replace('\nAlong bombo road', '');
  const asked = route.employeePropertyFacts(RENTALS_NO_ROAD, {});
  assert.strictEqual(asked.locationPatch.area, 'Kagoma');
  assert.deepStrictEqual(route.employeePropertyMissing(asked), ['which district Kagoma is in — Wakiso, Jinja, Kikuube or Mubende']);
  assert.match(route.agentMissingPhrases(route.employeePropertyMissing(asked))[0], /which district \*Kagoma\* is in — \*Wakiso, Jinja, Kikuube or Mubende\*\? Just the district name is enough, and say so if it is another one\./);

  // And the answer is taken, however it is put.
  for (const answer of ['Wakiso', 'Wakiso district', 'It is in Wakiso', 'Kagoma, Wakiso']) {
    const facts = route.employeePropertyFacts(`${RENTALS_NO_ROAD}\n${answer}`, {});
    assert.strictEqual(facts.locationPatch.area, 'Kagoma', answer);
    assert.strictEqual(facts.locationPatch.district, 'Wakiso', answer);
    assert.deepStrictEqual(route.employeePropertyMissing(facts), [], answer);
  }

  // The road it is on answers it (24 Nov 2026): Bombo Road runs through
  // Wakiso, and through none of the other three.
  const onTheRoad = route.employeePropertyFacts(RENTALS, {});
  assert.strictEqual(`${onTheRoad.locationPatch.area}, ${onTheRoad.locationPatch.district}`, 'Kagoma, Wakiso');
  assert.deepStrictEqual(route.employeePropertyMissing(onTheRoad), []);

  // A district the list does not offer is taken as well: the list is not complete.
  const elsewhere = route.employeePropertyFacts('Plot for sale in Kiteredde at 30m\nLuwero district', {});
  assert.strictEqual(`${elsewhere.locationPatch.area}, ${elsewhere.locationPatch.district}`, 'Kiteredde, Luwero');
  assert.deepStrictEqual(route.employeePropertyMissing(elsewhere), []);

  // The other two adverts now land where they are.
  const unfinished = route.employeePropertyFacts(UNFINISHED, {});
  assert.strictEqual(`${unfinished.locationPatch.area}, ${unfinished.locationPatch.district}`, 'Kasenge, Wakiso');
  const mango = route.employeePropertyFacts(ACRES, {});
  assert.strictEqual(mango.locationPatch.district, 'Luwero');
  assert.strictEqual(Number(mango.price), 18000000);
});

test('staff can move a listing to the district it is in when the name is in two', () => {
  const place = (fields) => hierarchy.normalizeReviewLocationHierarchy(fields, { allowDistrictNode: true, allowCanonicalHierarchy: true });
  // Kasenge is best known in Mukono, and is in Wakiso too: both can be chosen.
  const wakiso = place({ area: 'Kasenge', district: 'Wakiso' });
  assert.deepStrictEqual(wakiso.errors, []);
  assert.strictEqual(wakiso.canonical.key, 'wakiso:kasenge');
  assert.strictEqual(wakiso.city, 'Kyengera');
  assert.strictEqual(place({ area: 'Kasenge', district: 'Mukono' }).canonical.key, 'mukono:kasenge');
  assert.deepStrictEqual(place({ area: 'Kagoma', district: 'Wakiso' }).errors, []);
  assert.strictEqual(place({ area: 'Kikyusa', district: 'Luwero' }).canonical.key, 'luwero:kikyusa');
  // A place that is not in the district chosen is still refused.
  assert.ok(place({ area: 'Ntinda', district: 'Wakiso' }).errors.includes('area/neighbourhood must match the selected district'));
  assert.ok(place({ area: 'Kasenge', district: 'Jinja' }).errors.includes('area/neighbourhood must match the selected district'));
});

test('a title says what the property is, not how the advert opens', () => {
  const title = (caption, row) => copy.tidyCreatorListingTitle({ ...row, extra_fields: { source_caption: caption } }, { source_caption: caption });

  assert.strictEqual(title(RENTALS, { title: 'property for sale in Kagoma', listing_type: 'sale', area: 'Kagoma', district: 'Wakiso' }),
    '4 single rentals for sale in Kagoma');
  assert.strictEqual(title(ACRES, { title: 'Land for sale in Wabusana', listing_type: 'land', area: 'Wabusana', district: 'Luwero' }),
    '2 acres on sale with all mango plantation very good');
  assert.strictEqual(title(LAND, { title: 'Land for sale in Kiteredde', listing_type: 'land', area: 'Kiteredde', district: 'Mityana' }),
    'Land for sale 3 acres in Kiteredde');
  assert.strictEqual(title('Three double rooms for sale,plot size 35x45ft, collecting 750k per month,found in lugoba,Nansana,wakiso,sold at 60M',
    { title: 'property for sale in Nansana', listing_type: 'sale', area: 'Nansana', district: 'Wakiso' }), 'Three double rooms for sale in Nansana');
  assert.strictEqual(title('House for sale in Kira, Wakiso. 3 bedrooms, 1,200,000 negotiable',
    { title: 'property for sale in Kira', listing_type: 'sale', area: 'Kira', district: 'Wakiso' }), 'House for sale in Kira');
  // An opening that describes the property stays.
  assert.strictEqual(title('Newly built 3 bedroom house in Kira at 350m',
    { title: '3-bed property for sale in Kira', listing_type: 'sale', area: 'Kira', district: 'Wakiso' }), 'Newly built 3 bedroom house in Kira at 350m');
  // No line about a property at all: the title it had.
  assert.strictEqual(title('Hello team\nGood morning', { title: 'property for sale in Kira', listing_type: 'sale', area: 'Kira', district: 'Wakiso' }),
    'Property for sale in Kira');
});
