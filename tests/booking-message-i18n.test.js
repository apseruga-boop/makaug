'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const booking = require('../services/agentBookingService');
const stay = require('../services/shortTermBookingService');
const { PHRASES, SITE_LANGS, bookingSay, replyWindow, siteLang } = require('../services/bookingMessageText');

const LINKS = {
  confirm: 'https://makaug.com/v/c',
  reschedule: 'https://makaug.com/v/r',
  decline: 'https://makaug.com/v/d'
};

const CONFIRM = 'Please confirm within {window}. Reply 1 Confirm, 2 Suggest new time, 3 Can\'t do it';

function request(overrides = {}) {
  return {
    intent: 'viewing',
    agent_name: 'Jonathan Wassajja',
    visitor_name: 'Sarah Namubiru',
    visitor_phone: '+256772123456',
    property_label: '3-bed house, Kira',
    when_label: 'Tue 27 Oct, 2:00 pm',
    public_ref: 'AB12',
    language: 'en',
    agent_preferred_language: 'en',
    ...overrides
  };
}

function englishFingerprints() {
  return [
    'Please confirm within',
    'you\'ve got interest',
    'has been sent to',
    'Never pay before you have seen',
    'We will message you when they confirm',
    'We already have your request',
    'has reached today',
    'This listing is not live',
    'Messaging the agent is turned off',
    'not live on makaug',
    'original poster',
    'did not go out',
    'could not match it',
    'marked as a test',
    'has not been messaged yet',
    'will call you',
    'has your question',
    'has received your offer',
    'will meet you',
    'meeting point',
    'suggests ',
    'cannot do ',
    'has not confirmed this request',
    'is tomorrow',
    'in about 2 hours',
    'how did the viewing go',
    'We\'ve told',
    'New time saved',
    'Open this link',
    'you can\'t do it',
    'is still waiting',
    'Marked sold',
    'Marked let agreed',
    'Marked under offer',
    'Marked still available',
    'No dates yet',
    'Question about this stay',
    'Dates to be agreed',
    'stay request',
    'does not take or hold',
    'is with the host',
    'cannot take',
    'Host phone',
    'Check in from',
    'House rules',
    'has been told',
    'did not reply within',
    'How was your stay',
    'The guest suggests',
    'starts tomorrow',
    'View the place and confirm who you are paying'
  ];
}

test('every booking line exists in all nine languages, with the same placeholders and ASCII reply keys', () => {
  const keys = Object.keys(PHRASES.sw);
  assert.ok(keys.length >= 90);
  for (const lang of SITE_LANGS.filter((code) => code !== 'en')) {
    assert.deepEqual(Object.keys(PHRASES[lang]).sort(), keys.slice().sort(), lang);
    for (const key of keys) {
      const value = PHRASES[lang][key];
      assert.notEqual(value, key, `${lang} ${key}`);
      for (const name of [...key.matchAll(/\{(\w+)\}/g)].map((match) => match[1])) {
        assert.ok(value.includes(`{${name}}`), `${lang} lost {${name}} in ${key}`);
      }
      assert.equal(/[٠-٩۰-۹]/.test(value), false, `${lang} used non-ASCII digits`);
    }
    const line = bookingSay(lang, CONFIRM, { window: replyWindow(lang, 1) });
    assert.match(line, /1 /);
    assert.match(line, /2 /);
    assert.match(line, /3 /);
    assert.notEqual(line, bookingSay('en', CONFIRM, { window: '1 hour' }));
  }
  assert.equal(replyWindow('en', 1), '1 hour');
  assert.equal(replyWindow('en', 24), '24 hours');
  assert.equal(siteLang('fr'), 'en');
  assert.equal(siteLang(' SW '), 'sw');
  assert.match(bookingSay('ar', CONFIRM, { window: replyWindow('ar', 1) }), /[\u0600-\u06FF]/);
  assert.match(bookingSay('am', CONFIRM, { window: replyWindow('am', 1) }), /[\u1200-\u137F]/);
  const outcomeAr = bookingSay('ar', 'Hi {name}, how did the viewing go? Reply WENT, NO-SHOW, or TAKEN.', { name: 'Sara' });
  assert.match(outcomeAr, /WENT/);
  assert.match(outcomeAr, /NO-SHOW/);
  assert.match(outcomeAr, /TAKEN/);
  assert.match(bookingSay('lg', 'Confirmed. We\'ve told {visitor}. Call them on {phone} to agree where to meet. Reply SOLD or LET any time if this property is taken.', { visitor: 'Sarah', phone: '+256' }), /SOLD/);
  assert.match(bookingSay('lg', 'Confirmed. We\'ve told {visitor}. Call them on {phone} to agree where to meet. Reply SOLD or LET any time if this property is taken.', { visitor: 'Sarah', phone: '+256' }), /LET/);
});

test('visitor messages use the visitor language and agent messages use the agent language', () => {
  const agent = booking.buildAgentRequestMessage(request({
    language: 'sw',
    agent_preferred_language: 'lg'
  }), LINKS);
  assert.match(agent, /Kakasa mu ssaawa 1\. Ddamu 1 Kakasa, 2 Teesa obudde obupya, 3 Sisobola/);
  assert.match(agent, /1 Kakasa: https:\/\/makaug\.com\/v\/c/);
  assert.match(agent, /2 Teesa obudde obupya: https:\/\/makaug\.com\/v\/r/);
  assert.match(agent, /3 Sisobola: https:\/\/makaug\.com\/v\/d/);
  assert.match(agent, /Sarah Namubiru/);
  assert.match(agent, /3-bed house, Kira/);
  assert.doesNotMatch(agent, /Please confirm within|Thibitisha/);

  const visitor = booking.buildVisitorRequestMessage(request({
    language: 'sw',
    agent_preferred_language: 'lg'
  }));
  assert.match(visitor, /Ombi lako la kutazama 3-bed house, Kira limetumwa kwa Jonathan/);
  assert.match(visitor, /Usilipe kabla hujaona mali na hati zake/);
  assert.doesNotMatch(visitor, /has been sent to|Kakasa mu/);

  const english = booking.buildAgentRequestMessage(request(), LINKS);
  assert.match(english, /Please confirm within 1 hour\. Reply 1 Confirm, 2 Suggest new time, 3 Can't do it/);
  assert.match(english, /Hi Jonathan, you've got interest!/);
  assert.match(english, /1 Confirm: https:\/\/makaug\.com\/v\/c/);

  const fallback = booking.buildAgentRequestMessage(request({
    language: 'sw',
    agent_preferred_language: 'zz'
  }), LINKS);
  assert.match(fallback, /Please confirm within 1 hour/);

  const unknownVisitor = booking.buildVisitorRequestMessage(request({ language: 'fr' }));
  assert.match(unknownVisitor, /Your viewing request for 3-bed house, Kira has been sent to Jonathan/);

  const skipped = booking.buildVisitorSkippedMessage(request({ language: 'en' }), 'repeat');
  assert.match(skipped, /Hi Sarah,\n\nWe already have your request about 3-bed house, Kira/);
  const skippedSw = booking.buildVisitorSkippedMessage(request({ language: 'sw' }), 'repeat');
  assert.match(skippedSw, /Hujambo Sarah,\n\nTayari tuna ombi lako/);
  assert.doesNotMatch(skippedSw, /We already have/);

  const confirmed = booking.buildVisitorStatusMessage(request({ language: 'sw' }), 'confirm', {
    visitor_cancel: 'https://makaug.com/v/cancel',
    visitor_reschedule: 'https://makaug.com/v/move'
  });
  assert.match(confirmed, /Hujambo Sarah, imethibitishwa\. Jonathan Wassajja atakutana nawe Tue 27 Oct, 2:00 pm/);
  assert.match(confirmed, /Ghairi: https:\/\/makaug\.com\/v\/cancel/);
  assert.match(confirmed, /Badilisha muda: https:\/\/makaug\.com\/v\/move/);
  assert.doesNotMatch(confirmed, /will meet you/);

  const reminder = booking.buildAgentAck(request({ agent_preferred_language: 'sw', language: 'lg' }), 'remind', LINKS);
  assert.match(reminder, /Kumbusho: Sarah Namubiru bado anasubiri \(Tue 27 Oct, 2:00 pm\)\. Kumb\. AB12\. Jibu 1 Thibitisha, 2 Pendekeza muda mpya, 3 Siwezi\./);
  assert.doesNotMatch(reminder, /still waiting|Ddamu/);

  const outcome = booking.buildVisitorStatusMessage(request({ language: 'ar', visitor_name: 'Sara' }), 'ask_outcome');
  assert.match(outcome, /WENT/);
  assert.match(outcome, /NO-SHOW/);
  assert.match(outcome, /TAKEN/);
  assert.match(outcome, /[\u0600-\u06FF]/);
  assert.equal(booking.parseAgentReply('1').action, 'confirm');
  assert.equal(booking.parseAgentReply('2').action, 'reschedule');
  assert.equal(booking.parseAgentReply('3').action, 'decline');
});

test('short-stay host and guest WhatsApp bodies follow the same language split', () => {
  const host = stay.hostRequestMessage({
    reference: 'ST1',
    title: 'Kololo studio',
    checkIn: '2026-11-01',
    checkOut: '2026-11-03',
    guests: 2,
    guestName: 'Amina',
    guestPhone: '+256700000000',
    links: LINKS,
    lang: 'lg'
  });
  assert.match(host, /Kakasa mu ssaawa 24\. Ddamu 1 Kakasa, 2 Teesa obudde obupya, 3 Sisobola/);
  assert.match(host, /1 Kakasa: https:\/\/makaug\.com\/v\/c/);
  assert.match(host, /3 Sisobola: https:\/\/makaug\.com\/v\/d/);
  assert.doesNotMatch(host, /Please confirm within/);

  const guest = stay.guestRequestMessage({
    reference: 'ST1',
    statusUrl: 'https://makaug.com/v/stay',
    lang: 'sw'
  });
  assert.match(guest, /Ombi ST1 liko kwa mwenyeji\. Ana saa 24 kukubali au kukataa/);
  assert.match(guest, /https:\/\/makaug\.com\/v\/stay/);
  assert.doesNotMatch(guest, /is with the host/);

  const englishGuest = stay.guestRequestMessage({
    reference: 'ST1',
    statusUrl: 'https://makaug.com/v/stay'
  });
  assert.match(englishGuest, /Request ST1 is with the host\. They have 24 hours to accept or decline\./);
  assert.match(englishGuest, /https:\/\/makaug\.com\/v\/stay/);

  const reminder = bookingSay('am', 'Reminder: your stay {reference} starts tomorrow ({date}). Check in from {time}.', {
    reference: 'ST1',
    date: '2026-11-01',
    time: '14:00'
  });
  assert.match(reminder, /[\u1200-\u137F]/);
  assert.match(reminder, /ST1/);
  assert.match(reminder, /2026-11-01/);
  assert.doesNotMatch(reminder, /starts tomorrow/);
});

test('translated builders cover every visitor, agent and stay template', () => {
  const fingerprints = englishFingerprints();
  const bodies = [];
  for (const intent of ['viewing', 'callback', 'question', 'offer', 'other']) {
    bodies.push(booking.buildAgentRequestMessage(request({ intent, language: 'en', agent_preferred_language: 'sw', offer_amount: 50000000, visitor_message: 'Gate code' }), LINKS));
    bodies.push(booking.buildVisitorRequestMessage(request({ intent, language: 'sw' })));
  }
  for (const status of ['repeat', 'capped', 'listing_not_live', 'disabled', 'agent_not_approved', 'contact_shown', 'failed', 'no_lister_contact', 'no_listing', 'no_lead', 'test_skipped', 'skipped', 'unknown']) {
    bodies.push(booking.buildVisitorSkippedMessage(request({ language: 'sw' }), status));
  }
  for (const intent of ['viewing', 'callback', 'question', 'offer']) {
    bodies.push(booking.buildVisitorStatusMessage(request({ intent, language: 'sw', offer_amount: 80000000, callback_window: 'today' }), 'confirm', {
      visitor_cancel: 'https://makaug.com/v/cancel'
    }));
  }
  bodies.push(booking.buildVisitorStatusMessage(request({ language: 'sw', proposed_date: '2026-11-02', proposed_time: '10:00' }), 'reschedule', {
    confirm: 'https://makaug.com/v/accept',
    visitor_reschedule: 'https://makaug.com/v/move'
  }));
  bodies.push(booking.buildVisitorStatusMessage(request({ language: 'sw' }), 'reschedule', {
    visitor_reschedule: 'https://makaug.com/v/move'
  }));
  for (const action of ['decline', 'remind_visitor_24h', 'remind_visitor_2h', 'ask_outcome']) {
    bodies.push(booking.buildVisitorStatusMessage(request({ language: 'sw' }), action));
  }
  for (const action of ['confirm', 'decline', 'remind', 'sold', 'let_agreed', 'under_offer', 'still_available', 'saved']) {
    bodies.push(booking.buildAgentAck(request({ agent_preferred_language: 'sw' }), action, LINKS));
  }
  bodies.push(booking.buildAgentAck(request({ agent_preferred_language: 'sw', proposed_date: '2026-11-02' }), 'reschedule', LINKS));
  bodies.push(booking.buildAgentAck(request({ agent_preferred_language: 'sw', proposed_date: '' }), 'reschedule', LINKS));
  bodies.push(stay.hostRequestMessage({ reference: 'ST1', title: 'Kololo', intent: 'callback', links: LINKS, lang: 'sw' }));
  bodies.push(stay.hostRequestMessage({ reference: 'ST1', title: 'Kololo', intent: 'question', message: 'Wifi?', links: LINKS, lang: 'sw' }));
  bodies.push(stay.hostRequestMessage({ reference: 'ST1', title: 'Kololo', checkIn: '2026-11-01', checkOut: '2026-11-02', guests: 1, links: LINKS, lang: 'sw' }));
  bodies.push(stay.guestSuggestedDatesMessage({ reference: 'ST1', checkIn: '2026-11-01', checkOut: '2026-11-03', acceptUrl: 'https://makaug.com/v/accept', pickUrl: 'https://makaug.com/v/move', lang: 'sw' }));
  bodies.push(stay.guestDecisionMessage({ reference: 'ST1', accepted: false, statusUrl: 'https://makaug.com/v/stay', lang: 'sw' }));
  bodies.push(stay.guestDecisionMessage({
    reference: 'ST1',
    accepted: true,
    statusUrl: 'https://makaug.com/v/stay',
    hostPhone: '+256700',
    address: 'Kololo',
    checkInFrom: '14:00',
    houseRules: 'No parties',
    checkIn: '2026-11-01',
    lang: 'sw'
  }));
  bodies.push(stay.hostDecisionAck({ reference: 'ST1', accepted: true, dated: true, lang: 'sw' }));
  bodies.push(stay.hostDecisionAck({ reference: 'ST1', accepted: true, dated: false, lang: 'sw' }));
  bodies.push(stay.hostDecisionAck({ reference: 'ST1', accepted: false, lang: 'sw' }));
  bodies.push(stay.expiryMessage({ reference: 'ST1', statusUrl: 'https://makaug.com/v/stay', lang: 'sw' }));
  bodies.push(stay.reviewRequestMessage({ reference: 'ST1', statusUrl: 'https://makaug.com/v/stay', lang: 'sw' }));
  bodies.push(bookingSay('sw', 'The guest suggests {checkIn} to {checkOut} for {reference}.', { checkIn: '2026-11-01', checkOut: '2026-11-03', reference: 'ST1' }));
  bodies.push(bookingSay('sw', 'Reminder: your stay {reference} starts in about 2 hours. Check in from {time}.', { reference: 'ST1', time: '14:00' }));

  const joined = bodies.join('\n');
  for (const fingerprint of fingerprints) {
    assert.equal(joined.includes(fingerprint), false, fingerprint);
  }
  assert.match(joined, /https:\/\/makaug\.com\/v\/c/);
  assert.match(joined, /WENT, NO-SHOW/);
  assert.match(joined, /SOLD/);
  assert.match(joined, /LET/);

  const sources = ['services/agentBookingService.js', 'services/shortTermBookingService.js']
    .map((file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8'))
    .join('\n');
  const literals = [...sources.matchAll(/bookingSay\(\s*[^,\n]+,\s*'((?:\\'|[^'])*)'/g)]
    .map((match) => match[1].replace(/\\'/g, "'"));
  for (const literal of literals) assert.ok(PHRASES.sw[literal], literal);
  assert.match(sources, /deliverWhatsapp|queueWhatsappWebBridgeMessage/);
  assert.equal(sources.includes('process.env.WAHA'), false);
});
