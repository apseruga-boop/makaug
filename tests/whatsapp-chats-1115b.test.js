'use strict';

/**
 * 15 Nov 2026, the afternoon: two people who searched, two who said yes, and
 * the hour the link to WhatsApp went down.
 *
 * A student opened WhatsApp from the student page. Under the message the site
 * had written for them they typed a line of their own: the room should be
 * near the head office where they are an intern. They were told "I could not
 * match Campus", a word from the site's sentence, and when they answered with
 * a district they were shown three properties for sale in it, one of them
 * land at USh 500M. Had they been shown student rooms, a room at 450K a month
 * would have been shown as "450K/semester".
 *
 * Somebody else asked for a two-bedroom house in two villages, "not exceeding
 * 500k". The b of "bedroom" made the budget two billion, and they were told
 * there was nothing for sale up to USh 2.0B.
 *
 * Two prospects had written AGENT twelve days before. The Outreach desk
 * showed the word they wrote, in quotes, beside "has not said AGENT yet".
 *
 * At 15:42 WhatsApp removed the link that carries every message. WAHA answers
 * 422 for a session that is down, a 422 read as "this recipient was refused",
 * and every message queued after it was dropped on its first try.
 *
 * Every name, number and place of work here is made up.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const db = require('../config/database');
const whatsapp = require('../routes/whatsapp');
const route = whatsapp.__test;
const bridge = require('../services/whatsappWebBridgeService');
const card = require('../services/whatsappPropertyCardService');
const prospects = require('../services/agentProspectService');

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');

const SITE_STUDENT = "Hi makaug, I'm looking for student accommodation. Please help me find safe rooms near campus, with price, distance, rules, and availability. Page: makaug.com/student-dashboard";
const OWN_WORDS = "Should be near Acme Head Office where I'm doing intern from";
const STUDENT = `${SITE_STUDENT}\n\n${OWN_WORDS}`;
const RENTER = "Hi makaug, I'm looking for a 2 bedroom house in areas of namasuba and ndejje not  exceeding 500k";

test('what a visitor types under the site\'s message is kept; the site\'s own sentence is not read as theirs', () => {
  assert.strictEqual(route.websitePrefillSearchText(SITE_STUDENT), 'student accommodation', 'the site\'s message alone is the plain search');
  assert.strictEqual(route.websitePrefillSearchText(STUDENT), `student accommodation. ${OWN_WORDS}`);
  assert.strictEqual(route.websitePrefillOwnWords(SITE_STUDENT, { re: /looking for student accommodation/i, please: 'Please help me find safe rooms near campus, with price, distance, rules, and availability' }), '');

  // A sentence of the site's that the visitor rewrote is theirs.
  const rewritten = "Hi makaug, I'm looking for student accommodation. Please help me find safe rooms near Kyambogo, with price, distance, rules, and availability. Page: makaug.com/student-dashboard";
  assert.match(route.websitePrefillSearchText(rewritten), /^student accommodation\. Please help me find safe rooms near Kyambogo/);
  // So is a place added to the site's first sentence.
  assert.strictEqual(
    route.websitePrefillSearchText("Hi makaug, I'm looking for a rental in Kira. Please help me with area, budget, bedrooms, availability, and viewing options. Page: makaug.com/to-rent"),
    'property to rent. in Kira'
  );

  // The page address still gives the place when the visitor names none.
  const land = "Hi makaug, I'm looking for land or a plot. Please help me find available land listings, compare details, and contact the seller or broker safely. Page: makaug.com/land/nansana-wakiso";
  assert.strictEqual(route.websitePrefillSearchText(land), 'land for sale in Nansana Wakiso');
  assert.strictEqual(route.websitePrefillSearchText(`${land} I need two acres`), 'land for sale in Nansana Wakiso. I need two acres');
  // A place they name themselves comes before the one in the address.
  assert.strictEqual(route.websitePrefillSearchText(`${land} It should be in Matugga`), 'land for sale. It should be in Matugga');
  assert.strictEqual(route.websitePrefillSearchText('Hello, where is your office?'), '', 'not the site\'s message at all');
});

test('the student is not asked about a place called Campus, and an office to be near is not an office to rent', () => {
  const plain = route.fastWhatsappRuntimeHints({ text: SITE_STUDENT, sessionLang: 'en' });
  assert.strictEqual(plain.intent.intent, 'property_search');
  assert.deepStrictEqual(plain.intent.entities, { listing_type: 'student' }, 'no area: "near campus" is the site\'s wording');

  const own = route.fastWhatsappRuntimeHints({ text: STUDENT, sessionLang: 'en' });
  assert.strictEqual(own.intent.entities.listing_type, 'student', 'not commercial');
  assert.strictEqual(own.intent.entities.property_type, undefined, 'not an office');
  assert.strictEqual(own.intent.entities.area, 'Acme Head Office', 'the place ends where they start explaining it');

  assert.strictEqual(route.withoutLandmarkPhrase('student room near Acme Head Office'), 'student room near');
  // Somebody asking for an office, or a shop, still gets one.
  assert.strictEqual(route.extractNaturalSearchFilters('office space to rent near Garden City', {}, 'any', {}).searchType, 'commercial');
  assert.strictEqual(route.extractNaturalSearchFilters('shop for rent in Ntinda', {}, 'any', {}).searchType, 'commercial');
  // And land beside a petrol station is still land.
  assert.strictEqual(route.extractNaturalSearchFilters('plot near Total petrol station in Kira', {}, 'any', {}).searchType, 'land');

  for (const kind of ['room near campus', 'house in town', 'apartment close to work', 'rental near the university']) {
    assert.strictEqual(route.parseAreaFromText(kind), null, `"${kind}" names a kind of place, not a place`);
  }
  assert.strictEqual(route.parseAreaFromText('room near Acme Depot because I work nights'), 'Acme Depot');
});

test('a place the list does not have is asked about in the words of a search, as the person wrote it', () => {
  const text = `student accommodation. ${OWN_WORDS}`;
  const filters = route.resolveWhatsappSearchLocation({ searchType: 'student', area: 'Acme Head Office', hasSignal: true }, text);
  assert.strictEqual(filters.location_blocked, true);
  const reply = route.whatsappSearchLocationBlockReply(filters, text);
  assert.match(reply, /^📍 I don't have \*Acme Head Office\* on my map yet, so I have not guessed where it is\./);
  assert.match(reply, /Which area or town is it in\? For example \*Ntinda, Kampala\*\. I will then show you student rooms there\./);
  assert.doesNotMatch(reply, /saved a district/, 'nothing is being saved in a search');
  assert.match(route.whatsappSearchLocationBlockReply({ ...filters, searchType: 'rent' }, text), /show you places to rent there/);
  assert.match(route.whatsappSearchLocationBlockReply({ ...filters, searchType: 'any' }, text), /show you what is available there/);
  assert.strictEqual(route.whatsappSearchLocationBlockReply({ searchType: 'student', area: 'Wakiso' }, 'Wakiso'), null, 'no question when the place is known');
});

test('the search is kept with the question at every way in, and the answer is searched as what they wanted', () => {
  assert.strictEqual((source.match(/await holdSearchForArea\(phone, /g) || []).length, 5, 'the five ways a search can be stopped by a place');
  assert.doesNotMatch(source, /if \(locationBlockReply\) return respond\(locationBlockReply, 'search_area'\);/, 'no way in drops the search any more');
  assert.match(source, /naturalFilters\.area = parseAreaFromText\(cleanBody, sessionData\) \|\| cleanBody;\s+if \(naturalFilters\.proximity\?\.unresolved\) naturalFilters\.proximity = null;/, 'the landmark nobody could place is let go with the answer');
});

test('"2 bedroom ... not exceeding 500k" is a budget of 500,000', () => {
  assert.strictEqual(route.parseBudget(RENTER).maxBudgetUgx, 500000);
  const filters = route.extractNaturalSearchFilters(RENTER, {}, 'any', {});
  assert.strictEqual(filters.maxBudgetUgx, 500000);
  assert.strictEqual(filters.bedsMin, 2);
  assert.notStrictEqual(filters.searchType, 'sale', 'nothing made it a purchase');
  assert.strictEqual(route.inferAffordabilitySearchType(RENTER, filters), 'rent');

  assert.strictEqual(route.parseBudget('1bedroom at 300k').maxBudgetUgx, 300000);
  assert.strictEqual(route.parseBudget('2 bathrooms 3 bedrooms max 1.5m').maxBudgetUgx, 1500000);
  assert.strictEqual(route.parseBudget('single room for 6 months at 250k').maxBudgetUgx, 250000);
  // A letter after a figure is still its size when the word ends there.
  assert.strictEqual(route.parseBudget('house for 2b').maxBudgetUgx, 2000000000);
  assert.strictEqual(route.parseBudget('land for 25m').maxBudgetUgx, 25000000);
  assert.strictEqual(route.parseBudget('plot at 5mn').maxBudgetUgx, 5000000);
  assert.strictEqual(route.parseBudget('budget 800k per month').maxBudgetUgx, 800000);
  for (const words of ['not exceeding', 'not more than', 'below', 'less than', 'at most', 'within']) {
    assert.strictEqual(route.parseBudget(`a 2 bedroom house ${words} 700k`).maxBudgetUgx, 700000, words);
  }
  // In a search to rent, "a house" is somewhere to live: the word is let go before the budget is.
  assert.match(source, /const anyHome = \{ \.\.\.normalizedFilters, propertyType: null \};[\s\S]{0,400}includeBudget: true/);
});

test('a student room is shown at the period it is listed at', () => {
  const room = { listing_type: 'student', price: 450000 };
  assert.strictEqual(card.formatWhatsappPropertyPrice({ ...room, price_period: 'mo' }), 'USh 450K/month');
  assert.strictEqual(card.formatWhatsappPropertyPrice({ ...room, price_period: 'month' }), 'USh 450K/month');
  assert.strictEqual(card.formatWhatsappPropertyPrice({ ...room, price_period: 'sem' }), 'USh 450K/semester');
  assert.strictEqual(card.formatWhatsappPropertyPrice({ ...room, price_period: '' }), 'USh 450K/semester', 'by the semester when the listing does not say');
  assert.strictEqual(card.formatWhatsappPropertyPrice({ listing_type: 'rent', price: 500000, price_period: 'mo' }), 'USh 500K/month');
});

test('a prospect who wrote the word is a yes on the desk, recorded or not', () => {
  const pitchedAt = new Date(Date.now() - 12 * 86400000).toISOString();
  const at = new Date(Date.now() - 12 * 86400000 + 3600000).toISOString();
  const row = { id: 'p-1', full_name: 'Example Homes', phone_key: '700555061', status: 'pitched', pitched_at: pitchedAt, video_kind: 'agent' };
  const said = { last_reply_at: at, last_reply: 'AGENT' };
  assert.ok(prospects.saidTheWordUnrecorded(row, said));
  assert.strictEqual(prospects.followUpLabel(row, said), 'Yes — they want to join');
  assert.strictEqual(prospects.loopState(row, said), 'yes');
  const shown = prospects.publicProspect(row, said);
  assert.strictEqual(shown.follow_up, 'Yes — they want to join');
  assert.match(shown.next_step, /^They wrote AGENT on .+ and nobody has called them\. Call them, then register them with Agent 007 option 1\./);
  assert.doesNotMatch(shown.next_step, /has not said|have not said/);
  assert.strictEqual(shown.can_mark_called, true);
  assert.strictEqual(shown.can_mark_registered, true);
  for (const word of ['agent', 'Agent.', 'YES AGENT', 'agent please']) {
    assert.ok(prospects.saidTheWordUnrecorded(row, { last_reply_at: at, last_reply: word }), word);
  }

  // Anything else they wrote is still "replied", and they are still called.
  for (const other of ['Hope no money is required', 'Agent 007', 'Who is that one', 'I am an agent in Kira']) {
    const wrote = { last_reply_at: at, last_reply: other };
    assert.strictEqual(prospects.saidTheWordUnrecorded(row, wrote), null, other);
    assert.strictEqual(prospects.followUpLabel(row, wrote), 'Replied — has not said AGENT yet');
    assert.strictEqual(prospects.loopState(row, wrote), 'replied');
  }
  // An owner's word is LIST.
  const owner = { ...row, video_kind: 'owner' };
  assert.strictEqual(prospects.followUpLabel(owner, { last_reply_at: at, last_reply: 'List' }), 'Yes — they said LIST');
  assert.strictEqual(prospects.followUpLabel(owner, said), 'Replied — has not said LIST yet');
  // Nothing changes for somebody already recorded, or marked do not contact.
  assert.strictEqual(prospects.loopState({ ...row, status: 'interested' }, said), 'yes');
  assert.strictEqual(prospects.followUpLabel({ ...row, do_not_contact: true }, said), 'Do not contact again');
});

function withFakeDb(reply, run) {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    return reply(String(sql), params) || { rows: [] };
  };
  return Promise.resolve(run(calls)).finally(() => { db.query = originalQuery; });
}

const SESSION_DOWN = 'WAHA POST /api/sendText -> 422: {"error":"Session status is not as expected. Try again later or restart the session","session":"default","status":"FAILED","expected":["WORKING"]}';

test('a session that is down is not a refused recipient: the message waits and loses nothing', async () => {
  assert.deepStrictEqual(bridge.classifyBridgeSendError(SESSION_DOWN), { permanent: false, reason: 'session_not_ready', retryDelaySeconds: 300 });
  // What WhatsApp really refuses is still final.
  assert.strictEqual(bridge.classifyBridgeSendError('WAHA POST /api/sendImage -> 400: {"message":"file url is required"}').permanent, true);
  assert.strictEqual(bridge.classifyBridgeSendError('WAHA POST /api/sendText -> 422: {"message":"chatId is not valid"}').permanent, true);
  assert.strictEqual(bridge.classifyBridgeSendError('WAHA POST /api/sendText -> 500: no LID found for 256700555061@s.whatsapp.net').permanent, true);

  await withFakeDb((sql, params) => (/UPDATE outbound_message_queue/i.test(sql) ? { rows: [{ id: params[0], status: 'retry' }] } : null), async (calls) => {
    await bridge.markWhatsappWebBridgeMessageFailed('q-9', SESSION_DOWN, { bridge_client_id: 'makaug-waha-gows' });
    const update = calls.find((c) => /UPDATE outbound_message_queue/i.test(c.sql));
    assert.strictEqual(update.params[4], false, 'not final');
    assert.strictEqual(update.params[5], true, 'marked as the session being down');
    assert.strictEqual(Number(update.params[2]), 300, 'tried again in five minutes');
    assert.match(update.params[3], /"failure_class":"session_not_ready"/);
    assert.doesNotMatch(update.params[3], /retry_suppressed/);
    assert.match(update.sql, /attempts = attempts \+ CASE WHEN \$6::boolean THEN 0 ELSE 1 END/, 'the try is not counted');
    assert.match(update.sql, /'claim_count', GREATEST\(COALESCE\(NULLIF\(metadata->>'claim_count', ''\)::int, 0\) - 1, 0\)/, 'nor the hand-over');
    assert.match(update.sql, /created_at < NOW\(\) - INTERVAL '36 hours' THEN 'failed'/, 'and it is let go after a day and a half');
  });
  // A bridge that says the send may have gone is still believed.
  await withFakeDb((sql, params) => (/UPDATE outbound_message_queue/i.test(sql) ? { rows: [{ id: params[0], status: 'failed' }] } : null), async (calls) => {
    await bridge.markWhatsappWebBridgeMessageFailed('q-10', SESSION_DOWN, {}, { suppressRetry: true });
    const update = calls.find((c) => /UPDATE outbound_message_queue/i.test(c.sql));
    assert.strictEqual(update.params[4], true);
    assert.strictEqual(update.params[5], false);
  });
});

test('nothing is handed to a bridge whose session is down, and it is handed over again when it is back', async () => {
  const heartbeat = (status) => (sql) => (/FROM whatsapp_web_bridge_clients/i.test(sql) ? { rows: status ? [{ waha_status: status }] : [] } : null);
  for (const down of ['FAILED', 'STOPPED', 'STARTING', 'SCAN_QR_CODE', 'ERROR:fetch failed']) {
    await withFakeDb(heartbeat(down), async (calls) => {
      const handed = await bridge.claimWhatsappWebBridgeMessages({ clientId: 'makaug-waha-gows', limit: 5 });
      assert.deepStrictEqual(handed, [], down);
      assert.ok(!calls.some((c) => /UPDATE outbound_message_queue q/i.test(c.sql)), `${down}: nothing was claimed, so no hand-over was spent`);
    });
  }
  // WORKING, or a bridge that has said nothing for three minutes: as before.
  for (const up of ['WORKING', '']) {
    await withFakeDb(heartbeat(up), async (calls) => {
      await bridge.claimWhatsappWebBridgeMessages({ clientId: 'makaug-waha-gows', limit: 5 });
      const claim = calls.find((c) => /UPDATE outbound_message_queue q/i.test(c.sql));
      assert.ok(claim, `"${up}": the claim ran`);
      assert.match(claim.sql, /AND NOT \(\$7::boolean AND q\.next_attempt_at < NOW\(\) - INTERVAL '30 minutes'\)/);
      assert.strictEqual(typeof claim.params[6], 'boolean');
    });
  }
  const check = calls => calls.find((c) => /FROM whatsapp_web_bridge_clients/i.test(c.sql));
  await withFakeDb(heartbeat('FAILED'), async (calls) => {
    await bridge.bridgeSessionCannotSend('makaug-waha-gows');
    assert.match(check(calls).sql, /last_seen_at >= NOW\(\) - INTERVAL '3 minutes'/, 'only a bridge heard from lately is believed');
    assert.deepStrictEqual(check(calls).params, ['makaug-waha-gows']);
  });
});

test('a one-time code that has run out is let go, and while the number is logged out a code is not queued for it', async () => {
  const savedMinutes = process.env.OTP_EXPIRES_MINUTES;
  delete process.env.OTP_EXPIRES_MINUTES;
  try {
    // A code is good for ten minutes. With the session down for hours, a code
    // kept in the queue would arrive when the session came back: hours late,
    // opening nothing, from a number its receiver was not expecting.
    await withFakeDb((sql) => (/SET status = 'failed'/.test(sql) ? { rows: [], rowCount: 2 } : null), async (calls) => {
      assert.strictEqual(await bridge.letGoOfExpiredCodes({ force: true }), 2);
      assert.strictEqual(calls.length, 1);
      assert.match(calls[0].sql, /UPDATE outbound_message_queue\s+SET status = 'failed'/);
      assert.match(calls[0].sql, /status IN \('pending', 'retry'\)/);
      assert.match(calls[0].sql, /\(LOWER\(COALESCE\(metadata->>'kind', ''\)\) = 'otp' OR LOWER\(COALESCE\(metadata->>'source', ''\)\) = 'otp'\)/, 'codes only');
      assert.match(calls[0].sql, /created_at < NOW\(\) - \(\$1 \|\| ' minutes'\)::interval/);
      assert.deepStrictEqual(calls[0].params, ['10']);
      // Looked at once a minute at most: it runs beside every hand-over.
      assert.strictEqual(await bridge.letGoOfExpiredCodes(), 0);
      assert.strictEqual(calls.length, 1);
    });
    // And between looks, the hand-over itself never gives one out.
    await withFakeDb(() => null, async (calls) => {
      await bridge.claimWhatsappWebBridgeMessages({ clientId: 'makaug-waha-gows', limit: 5 });
      const claim = calls.find((c) => /UPDATE outbound_message_queue q/i.test(c.sql));
      assert.match(claim.sql, /AND NOT \(\s+\(LOWER\(COALESCE\(q\.metadata->>'kind', ''\)\) = 'otp' OR LOWER\(COALESCE\(q\.metadata->>'source', ''\)\) = 'otp'\)\s+AND q\.created_at < NOW\(\) - \(\$8 \|\| ' minutes'\)::interval\s+\)/);
      assert.strictEqual(claim.params[7], '10');
    });

    // Whether the number has to be linked again before anything can be sent.
    const heard = (rows) => (sql) => (/FROM whatsapp_web_bridge_clients/i.test(sql) ? { rows } : null);
    for (const status of ['FAILED', 'STOPPED', 'SCAN_QR_CODE', 'NOT_FOUND']) {
      await withFakeDb(heard([{ status: 'degraded', waha_status: status }]), async (calls) => {
        assert.strictEqual(await bridge.whatsappSessionNeedsLinking(), true, status);
        assert.match(calls[0].sql, /last_seen_at >= NOW\(\) - INTERVAL '3 minutes'/, 'only a bridge heard from lately is believed');
      });
    }
    const not = [
      ['a session that is starting is back in a minute', [{ status: 'starting', waha_status: 'STARTING' }]],
      ['a session that is working', [{ status: 'online', waha_status: 'WORKING' }]],
      ['WAHA not answering is not the number logged out', [{ status: 'degraded', waha_status: 'ERROR:fetch failed' }]],
      ['no bridge heard from', []],
      ['one bridge down and another working', [{ status: 'degraded', waha_status: 'FAILED' }, { status: 'online', waha_status: 'WORKING' }]],
      ['one bridge down and a browser bridge online', [{ status: 'degraded', waha_status: 'FAILED' }, { status: 'online', waha_status: null }]]
    ];
    for (const [why, rows] of not) {
      await withFakeDb(heard(rows), async () => {
        assert.strictEqual(await bridge.whatsappSessionNeedsLinking(), false, why);
      });
    }
    // When it cannot be told, a code is queued as it always was.
    const originalQuery = db.query;
    db.query = async () => { throw new Error('no database'); };
    try {
      assert.strictEqual(await bridge.whatsappSessionNeedsLinking(), false);
    } finally {
      db.query = originalQuery;
    }

    const otpSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'phoneOtpDeliveryService.js'), 'utf8');
    assert.match(otpSource, /if \(whatsappBridgeEnabled\(\) && !needsLinking && !mayNotWriteToThem\) \{/, 'a code is not queued while the number waits to be linked');
    assert.match(otpSource, /reason: 'whatsapp_session_not_linked'/);
  } finally {
    if (savedMinutes === undefined) delete process.env.OTP_EXPIRES_MINUTES; else process.env.OTP_EXPIRES_MINUTES = savedMinutes;
  }
});

test('a message that is late does not arrive in the night', () => {
  const saved = { hours: process.env.WHATSAPP_QUIET_HOURS, tz: process.env.WHATSAPP_QUIET_TZ, country: process.env.COUNTRY_CODE };
  delete process.env.WHATSAPP_QUIET_HOURS; delete process.env.WHATSAPP_QUIET_TZ; delete process.env.COUNTRY_CODE;
  try {
    // Kampala is three hours ahead of UTC all year.
    assert.strictEqual(bridge.isOutboxQuietHours(new Date('2026-11-15T19:00:00Z')), true, '22:00 in Kampala');
    assert.strictEqual(bridge.isOutboxQuietHours(new Date('2026-11-15T22:30:00Z')), true, '01:30');
    assert.strictEqual(bridge.isOutboxQuietHours(new Date('2026-11-16T03:59:00Z')), true, '06:59');
    assert.strictEqual(bridge.isOutboxQuietHours(new Date('2026-11-16T04:00:00Z')), false, '07:00, when the morning messages go');
    assert.strictEqual(bridge.isOutboxQuietHours(new Date('2026-11-15T18:59:00Z')), false, '21:59');
    assert.strictEqual(bridge.isOutboxQuietHours(new Date('2026-11-15T12:00:00Z')), false, 'the afternoon');
    process.env.WHATSAPP_QUIET_HOURS = 'off';
    assert.strictEqual(bridge.isOutboxQuietHours(new Date('2026-11-15T22:30:00Z')), false);
  } finally {
    for (const [key, name] of [['hours', 'WHATSAPP_QUIET_HOURS'], ['tz', 'WHATSAPP_QUIET_TZ'], ['country', 'COUNTRY_CODE']]) {
      if (saved[key] === undefined) delete process.env[name]; else process.env[name] = saved[key];
    }
  }
});
