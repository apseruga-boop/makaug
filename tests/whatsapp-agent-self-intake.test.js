'use strict';

/**
 * An agent posting their own property.
 *
 * 29 Sep 2026, 15:50. Katamba Bonny of Kakx Real Estate had been a makaug agent
 * for ninety seconds when he asked "So how do I post". He got the buyer menu,
 * answered "All", was told to pick one of the options, gave up and simply sent
 * the property — a commercial building in Komamboga, 12 decimals, mailo title,
 * 1.2bn. makaug answered with a lecture about buying land safely. He sent a
 * second, a Kololo condominium at $380,000, and was offered cheaper flats.
 *
 * He had done exactly what the welcome message told him to do.
 *
 * Agent 007 already reads a forwarded caption, works out what is missing, pairs
 * the photos and files the result in staff review under the right agent. It was
 * wired to staff numbers only, because staff have to say whose properties they
 * are loading. An agent sending their own stock does not have to say: the
 * number tells us.
 *
 * The security property these tests exist to hold: an agent gets that flow with
 * themselves pinned as the subject and no way to change it, and *Agent 007*
 * itself stays shut to everyone but staff.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  agentPhoneKey,
  agentSelfIntakeSessionData,
  agentSelfIntakeSavedReply,
  isOwnAgentSelfIntake,
  looksLikeForwardedProperty,
  employeePropertyFacts,
  employeePropertyMissing
} = require('../routes/whatsapp').__test;

const KATAMBA = {
  id: '9d1f0a3e-1111-2222-3333-444455556666',
  makaug_agent_number: 'MKA-AG-0605699',
  full_name: 'Katamba Bonny',
  company_name: 'Kakx Real Estate and Property Agency',
  phone: '256701895892',
  whatsapp: '256701895892',
  email: null,
  status: 'approved'
};

// The message he actually sent at 15:51:10.
const KOMAMBOGA = '🔥🔥🔥On market now 🔥🔥 Commercial building for sale Komamboga. '
  + 'Seated on 12 decimals with a private mailo land title. With monthly income of 12 millions. Price 1.2 billion';

test('a number in any of its forms is the same agent', () => {
  // He is stored as 256701895892 and writes from 0701895892.
  assert.strictEqual(agentPhoneKey('0701895892'), agentPhoneKey('256701895892'));
  assert.strictEqual(agentPhoneKey('+256 701 895 892'), '701895892');
  assert.strictEqual(agentPhoneKey('256750925959'), agentPhoneKey('0750925959'),
    'the two Quickway records are one person, and must key the same');
  assert.strictEqual(agentPhoneKey('123'), '123', 'a short string is not padded into a false match');
  assert.strictEqual(agentPhoneKey(''), '');
});

test('the property he sent is recognised as a property, not a search', () => {
  assert.ok(looksLikeForwardedProperty({ cleanBody: KOMAMBOGA }),
    'this is the message that was answered with a land-safety lecture');
  assert.ok(looksLikeForwardedProperty({ cleanBody: '', mediaUrl: 'https://bridge/x.jpg' }),
    'photos with no caption are still a property being sent');
});

test('a buyer asking about property is still a buyer', () => {
  for (const text of [
    'rent in Muyenga under 2m',
    'Do you have land in Gayaza',
    'So how do I post',
    'I am looking for a 3 bedroom house in Kira'
  ]) {
    assert.ok(!looksLikeForwardedProperty({ cleanBody: text }),
      `"${text}" is someone asking, not someone listing`);
  }
});

test('the subject is the sender, and nothing in the session can move it', () => {
  const data = agentSelfIntakeSessionData(KATAMBA);
  assert.strictEqual(data.agent.id, KATAMBA.id, 'the listing will be attributed to him');
  assert.strictEqual(data.employee_role, 'agent');
  assert.strictEqual(data.intake_confirmed, true,
    'pre-confirmed, so the "whose properties are these?" questions are never reached');
  assert.strictEqual(data.property_batch_mode, 'multiple');
  assert.strictEqual(data.whatsapp_agent_self_intake, true);
  assert.strictEqual(data.identity_followup_required, false,
    'his ID was checked when his profile was approved; do not chase it again');
  assert.deepStrictEqual(data.property_ids, [], 'a fresh batch owns nothing yet');
});

test('the session only works from the number it belongs to', () => {
  const session = { session_data: agentSelfIntakeSessionData(KATAMBA) };
  assert.ok(isOwnAgentSelfIntake(session, '256701895892'), 'his own handset');
  assert.ok(isOwnAgentSelfIntake(session, '0701895892'), 'and the local form of it');

  assert.ok(!isOwnAgentSelfIntake(session, '256774505232'),
    'Kimuli Brian must not be able to drive Katamba’s session');
  assert.ok(!isOwnAgentSelfIntake(session, ''), 'nor an empty sender');
  assert.ok(!isOwnAgentSelfIntake({ session_data: {} }, '256701895892'),
    'an ordinary session is not a self-intake session');

  // The flag alone is not enough: the phone has to match too, so a session that
  // somehow carried the marker could still never be driven from elsewhere.
  const forged = { session_data: { whatsapp_agent_self_intake: true, agent: { id: 'x', phone: '256701895892' } } };
  assert.ok(!isOwnAgentSelfIntake(forged, '256999888777'),
    'a marker without a matching number opens nothing');
});

test('a staff batch is never mistaken for an agent’s own', () => {
  // Ronald loading Sewa sewa's stock: an employee session, not self-intake.
  const staffSession = {
    session_data: {
      whatsapp_employee_intake: true,
      employee_role: 'agent',
      agent: { id: 'sewa', full_name: 'Sewa sewa', phone: '256769761856' }
    }
  };
  assert.ok(!isOwnAgentSelfIntake(staffSession, '256709402189'),
    'Ronald is not Sewa sewa, and this must go through the staff allowlist as before');
});

test('an agent whose property is complete is told it is in, and what happens next', () => {
  const data = agentSelfIntakeSessionData(KATAMBA);
  const facts = employeePropertyFacts('3 bedroom house for rent in Kira, Wakiso at 1.2m per month', data);
  const reply = agentSelfIntakeSavedReply({
    data,
    facts,
    storedMedia: [{ kind: 'image' }, { kind: 'image' }, { kind: 'video' }],
    openedAgentSelfIntake: true
  });
  assert.match(reply, /Thanks Katamba/, 'greeted by name on the first one');
  assert.match(reply, /with our team for review/);
  assert.match(reply, /2 photos · 1 video saved/, 'told what we actually kept');
  assert.match(reply, /3 bedroom house · for rent/, 'shown what we understood');
  assert.match(reply, /Kira, Wakiso/);
  assert.match(reply, /UGX 1,200,000 a month/, 'the price as we read it, so a wrong one is caught now');
  assert.match(reply, /reply with the correction/);
  assert.match(reply, /I will send you the link to share/, 'and what to expect next');
  assert.doesNotMatch(reply, /COMPLETE/,
    'typing COMPLETE is staff choreography; an agent should never be asked for it');
  assert.doesNotMatch(reply, /moderation stage|pending, not live/i,
    'nor should they get our internal vocabulary');
});

test('an agent whose property is missing something is told exactly what', () => {
  const data = agentSelfIntakeSessionData(KATAMBA);
  // A caption with no price — the commonest gap by far.
  const facts = employeePropertyFacts('3 bedroom house for rent in Kira, Wakiso', data);
  const missing = employeePropertyMissing(facts);
  assert.ok(missing.length, 'this caption really is short of something');

  const reply = agentSelfIntakeSavedReply({ data, facts, storedMedia: [{ kind: 'image' }] });
  assert.match(reply, /cannot put it up yet/);
  assert.match(reply, /Still needed:/);
  assert.match(reply, /the \*price\*/, 'named in plain words, not our field names');
  assert.doesNotMatch(reply, /sale\/rent\/land\/commercial\/student type/);
  assert.match(reply, /no need to send the photos again/,
    'the commonest agent worry when asked for one more detail');
});

test('staff replies are left exactly as they were', () => {
  // The same helper is called on every save; it must decline to speak for a
  // staff batch so Ronald's flow is untouched.
  const staffData = { whatsapp_employee_intake: true, property_batch_mode: 'multiple', agent: { full_name: 'Sewa sewa' } };
  const facts = employeePropertyFacts('Land for sale in Kira, Wakiso at 45m', staffData);
  assert.strictEqual(
    agentSelfIntakeSavedReply({ data: staffData, facts, storedMedia: [{ kind: 'image' }] }),
    null,
    'null means "not mine" — the staff message is used unchanged'
  );
});

test('the agent’s property carries the details a moderator needs', () => {
  const data = agentSelfIntakeSessionData(KATAMBA);
  const facts = employeePropertyFacts(KOMAMBOGA, data);
  // What staff review will show: type, place, price, and who it belongs to.
  // "Commercial building for sale" reads as commercial, not a plain sale —
  // which is right, and is the category a moderator would pick by hand.
  assert.strictEqual(facts.listingType, 'commercial');
  assert.ok(Number(facts.price) > 0, 'the price is read off the caption');
  assert.strictEqual(facts.locationPatch.area, 'Komamboga');
  assert.strictEqual(data.agent.id, KATAMBA.id);
  assert.deepStrictEqual(employeePropertyMissing(facts), [],
    'his Komamboga message was complete — it should have gone straight to review');
});


const {
  agentPendingNotice,
  agentMissingPhrases
} = require('../routes/whatsapp').__test;
const { withEnglishPropertyTerms } = require('../services/whatsappEmployeeIntakeService');

test('photos with no words: thanked, and asked for exactly the four things', () => {
  const data = {
    ...agentSelfIntakeSessionData(KATAMBA),
    pending_property_media: [{ mimeType: 'image/jpeg', url: 'https://x/1.jpg' }, { mimeType: 'image/jpeg', url: 'https://x/2.jpg' }]
  };
  const notice = agentPendingNotice(data);
  assert.match(notice, /Got your 2 photos/);
  assert.match(notice, /rent\* or for \*sale/);
  assert.match(notice, /area and district/);
  assert.match(notice, /price/);
  assert.match(notice, /No need to send the photos again/);
  assert.doesNotMatch(notice, /COMPLETE|staff review|batch/i);
});

test('words with no photos: asked for the photos', () => {
  const data = { ...agentSelfIntakeSessionData(KATAMBA), pending_property_caption: 'Land for sale in Gayaza, Wakiso 45m' };
  assert.match(agentPendingNotice(data), /send the \*photos or a short video\*/);
});

test('missing items are said in plain words', () => {
  const plain = agentMissingPhrases(['sale/rent/land/commercial/student type', 'price', 'exact area and district']).join(' ');
  assert.match(plain, /rent\* or for \*sale/);
  assert.match(plain, /\*price\*/);
  assert.match(plain, /Kira, Wakiso/);
});

test('Luganda and Swahili captions are understood', () => {
  const cases = [
    ['Ennyumba ya kupangisa e Ntinda, ebisenge bisatu, 800k buli mwezi', 'rent', 800000, 'Ntinda'],
    ['Nyumba ya kupangisha Ntinda, vyumba 3, shilingi laki nane kwa mwezi', 'rent', 800000, 'Ntinda'],
    ["Ettaka ery'okutunda e Gayaza, Wakiso obukadde 45", 'land', 45000000, 'Gayaza']
  ];
  for (const [caption, type, price, area] of cases) {
    const facts = employeePropertyFacts(caption, {});
    assert.strictEqual(facts.listingType, type, caption);
    assert.strictEqual(Number(facts.price), price, caption);
    assert.strictEqual(facts.locationPatch.area, area, caption);
  }
  assert.strictEqual(withEnglishPropertyTerms('3 bedroom house in Kira 1.2m'), '3 bedroom house in Kira 1.2m',
    'English is left exactly as it was');
});

const { noteEmployeePropertyCreated, employeeInForwardedBurst } = require('../routes/whatsapp').__test;

test('a forwarded burst is recognised, a single album is not', () => {
  const data = {};
  noteEmployeePropertyCreated(data);
  assert.strictEqual(employeeInForwardedBurst(data), false, 'one property just created: its album photos follow it');
  noteEmployeePropertyCreated(data);
  assert.strictEqual(employeeInForwardedBurst(data), true, 'two created within seconds: a captionless photo cannot be placed');
  data.recent_property_created_ms = [Date.now() - 120000, Date.now() - 90000];
  assert.strictEqual(employeeInForwardedBurst(data), false, 'minutes apart is not a burst');
});

test('a photo held from a burst is asked about, not guessed', () => {
  const data = {
    ...agentSelfIntakeSessionData(KATAMBA),
    pending_media_from_burst: true,
    pending_property_media: [{ mimeType: 'image/jpeg', url: 'https://x/9.jpg' }]
  };
  const notice = agentPendingNotice(data);
  assert.match(notice, /cannot tell which property/);
  assert.match(notice, /together with that property's caption/);
});

test('a plot measured "100by50fts" has no bedrooms', () => {
  const facts = employeePropertyFacts('*Land For Sale Nakawuka- Koba Estate 100by50fts @ UGX 28,000,000-30,000,000 With Ready Landtitle*', {});
  assert.strictEqual(facts.listingType, 'land');
  assert.ok(!facts.bedroomDraft.bedrooms, 'a live land listing showed "50 bedrooms" from this caption');
  assert.strictEqual(employeePropertyFacts('Najeera 4 bedrooms 5 bathrooms staff quarters 650m', {}).bedroomDraft.bedrooms, 4);
});

/**
 * Asking an agent for the one thing he already wrote.
 *
 * 8 Oct 2026, 05:20. Tuyisengye Innocent sent two photos, a 28-second video and
 * "10 acres on sale at watuba electricity available 3 phase on the main marrum
 * road mairo land title price 17m each acre". Every part of that parsed: land,
 * UGX 170m (10 × 17m an acre), area Watuba. The only outstanding fact was which
 * district Watuba is in — and employeePropertyMissing said exactly that.
 *
 * Then the phrasing layer matched it on /area|district|location/ and replaced
 * it with "the area and district — e.g. Kira, Wakiso". So he was asked for the
 * area he had just given, the listing sat unsaved, and this is the same loop
 * that made Ronald answer three times and give up in September.
 *
 * The narrow question has to survive all the way to the agent's phone.
 */
test('a place we know by name is never asked for again — only its district', () => {
  const WATUBA = '10 acres on sale at watuba electricity available 3 phase on the main marrum road mairo land title price 17m each acre';
  const data = agentSelfIntakeSessionData(KATAMBA);
  const facts = employeePropertyFacts(WATUBA, data);

  // Everything except the district was understood, so nothing else may be asked.
  assert.strictEqual(facts.listingType, 'land');
  assert.strictEqual(facts.locationPatch.area, 'Watuba');
  assert.strictEqual(Number(facts.price), 170000000, '17m an acre across 10 acres');
  // Watuba is in the registry as Wattuba, in three districts. So the question
  // is closed: he picks one and cannot name a district the place is not in.
  assert.deepStrictEqual(employeePropertyMissing(facts),
    ['which district Watuba is in — Wakiso, Kyankwanzi or Mityana']);

  const asked = agentMissingPhrases(employeePropertyMissing(facts)).join(' ');
  assert.match(asked, /which district \*Watuba\* is in/, 'name the place back, so he can see we read it');
  assert.match(asked, /Wakiso, Kyankwanzi or Mityana/, 'the real shortlist, so he picks instead of guessing');
  assert.doesNotMatch(asked, /e\.g\. Kira, Wakiso/,
    'asking for "the area and district" here asks him for the word he already wrote');

  // And it is the whole message he receives, not just the phrase in isolation.
  const notice = agentPendingNotice({
    ...data,
    pending_property_caption: WATUBA,
    pending_property_media: [{ mimeType: 'image/jpeg', url: 'https://x/1.jpg' }]
  });
  assert.match(notice, /which district \*Watuba\* is in/);
  assert.doesNotMatch(notice, /area and district/);
});

test('answering with just the district finishes the property', () => {
  const data = agentSelfIntakeSessionData(KATAMBA);
  // What he would type back. Luwero and Luweero are both spelled in the wild.
  // The three the registry knows, plus a district it does not put Watuba in:
  // an agent who says Luwero must be believed, not asked a fourth time. That
  // was the Bulabakulu loop.
  for (const answer of ['Wakiso', 'Kyankwanzi', 'Mityana', 'Luwero', 'Watuba, Luwero', 'Luweero']) {
    const facts = employeePropertyFacts(
      `10 acres on sale at watuba electricity available 3 phase on the main marrum road mairo land title price 17m each acre\n${answer}`,
      data
    );
    assert.match(facts.locationPatch.area, /^Wat+uba$/, `area survives "${answer}"`);
    assert.ok(facts.locationPatch.district, `a district resolves from "${answer}"`);
    assert.deepStrictEqual(employeePropertyMissing(facts), [], `"${answer}" must complete it`);
  }
});

/**
 * The generic phrasings still have to work, and the match is now exact rather
 * than a keyword sweep — so a typo in one of them would silently leak a field
 * name to an agent instead of plain words.
 */
test('the three generic gaps are still said in plain words, exactly', () => {
  const plain = agentMissingPhrases(['sale/rent/land/commercial/student type', 'price', 'exact area and district']);
  assert.match(plain[0], /rent\* or for \*sale/);
  assert.strictEqual(plain[1], 'the *price*');
  assert.match(plain[2], /Kira, Wakiso/);
  for (const phrase of plain) {
    assert.doesNotMatch(phrase, /sale\/rent\/land\/commercial\/student/, 'no field names reach an agent');
  }
});

/**
 * "Can I tap the link" — answering the question he actually asked.
 *
 * 8 Oct 2026, 14:38. Migadde Hakim was approved and sent the UGX 50,000
 * payment link. At 14:39 he asked "What should I do now?" and "Can I tap the
 * link". The first matched the how-to-post pattern and he was told to send a
 * property. The second matched nothing and he got the menu.
 *
 * He had been handed a bill by a number he had known for two hours and asked
 * the only two questions anybody asks — is this real, and what do I do — and
 * we answered a different question twice.
 */
const { agentPayLinkAside, AGENT_PAY_LINK_QUESTION } = require('../routes/whatsapp').__test;
const db = require('../config/database');

function withPayLink(row, run) {
  const original = db.query;
  db.query = async (sql) => (/FROM pay_links/i.test(sql) ? { rows: row ? [row] : [] } : { rows: [] });
  return Promise.resolve(run()).finally(() => { db.query = original; });
}

test('the two questions Migadde asked are both heard as payment questions', () => {
  for (const asked of [
    'Can I tap the link', 'What should I do now?', 'can i click the link',
    'is this safe', 'how do i pay', 'where do i pay', 'what is this payment',
    'Is the link genuine?', 'what is this 50,000 for'
  ]) {
    assert.ok(AGENT_PAY_LINK_QUESTION.test(asked), `"${asked}" must be heard`);
  }
});

test('an agent with no bill is not told about one', async () => {
  // The guard that matters most: "what should i do now" from somebody who was
  // never billed still means "how do I post", and must not invent a payment.
  await withPayLink(null, async () => {
    assert.strictEqual(
      await agentPayLinkAside({ agent: { id: KATAMBA.id, full_name: 'Katamba Bonny' }, cleanBody: 'What should I do now?' }),
      null,
      'no outstanding link means no payment answer at all'
    );
  });
  // And a property caption is never mistaken for a question about money.
  await withPayLink({ code: 'MKABC123', amount_ugx: 50000 }, async () => {
    assert.strictEqual(
      await agentPayLinkAside({ agent: { id: KATAMBA.id }, cleanBody: '3 bedroom house for rent in Kira, Wakiso — 1.2m' }),
      null
    );
  });
});

test('he is told yes, what it is, what it costs, and that he can keep working', async () => {
  await withPayLink({ code: 'MKHJTQH5', amount_ugx: 50000, sent_at: new Date().toISOString() }, async () => {
    const reply = await agentPayLinkAside({
      agent: { id: KATAMBA.id, full_name: 'Migadde Hakim' },
      cleanBody: 'Can I tap the link'
    });
    assert.ok(reply, 'this is the whole point');
    assert.match(reply, /^Yes, Migadde — tap it, it is from us/, 'answer the question first, by name');
    assert.match(reply, /UGX 50,000 a month/, 'what it is and what it costs');
    assert.match(reply, /pay\/MKHJTQH5/, 'the link itself, not a description of it');
    assert.match(reply, /\*MKHJTQH5\* as the reference/, 'what makes a mobile money payment matchable');
    assert.match(reply, /keep sending me properties now/,
      'an agent who thinks he cannot work until he has paid simply stops working');
    assert.doesNotMatch(reply, /Easiest thing in the world/, 'not the how-to-post answer');
  });
});

/**
 * A real place beats a word we guessed.
 *
 * 8 Oct 2026. Migadde's advert headlined "50x100 FT PLOT FOR SALE IN
 * KASANJE–NAKAWUKA, WAKISO DISTRICT" and closed with "Affordable plots with
 * ready land titles in established estates are selling fast!". The caption
 * resolved to Wakiso at district level, the stated-area fallback went hunting
 * for a word after "in", and the listing went to review as *Land for sale in
 * Established*.
 *
 * Kasanje and Nakawuka are both in the registry, both in Wakiso. We had the
 * answer in the headline and guessed from the sales pitch instead.
 */
test('a marketing word never becomes the area when the caption names a real place', () => {
  const advert = [
    '🚨 HOT PROPERTY ALERT – AFFORDABLE PLOT FOR SALE! 🚨',
    '',
    '🏡 50x100 FT PLOT FOR SALE IN KASANJE–NAKAWUKA, WAKISO DISTRICT',
    '',
    'Own a prime plot in the well-planned Sema Properties Estate.',
    '✅ Ready Land Title',
    '💰 Price: ONLY UGX 24 MILLION',
    '',
    'Affordable plots with ready land titles in established estates are selling fast!'
  ].join('\n');
  const facts = employeePropertyFacts(advert, agentSelfIntakeSessionData(KATAMBA));

  assert.notStrictEqual(facts.locationPatch.area, 'Established',
    'this is the exact listing that went to review as "Land for sale in Established"');
  assert.match(facts.locationPatch.area, /^(Kasanje|Nakawuka)$/,
    'the place is in the headline and in our own registry');
  assert.strictEqual(facts.locationPatch.district, 'Wakiso');
  assert.ok(facts.locationPatch.canonical_location_id, 'a real registry entry, not a stated guess');
  assert.deepStrictEqual(employeePropertyMissing(facts), []);
});

test('a caption with no recognisable place still falls back rather than refusing', () => {
  // The fallback has to survive: Bulabakulu is not in the registry and the
  // agent must still be believed.
  const facts = employeePropertyFacts('WAKISO -BULABAKULU ROADSIDE ESTATE 100BY50FTS @ 45M', agentSelfIntakeSessionData(KATAMBA));
  assert.strictEqual(facts.locationPatch.district, 'Wakiso');
  assert.ok(facts.locationPatch.area, 'an area the registry does not know is still kept, not dropped');
});
