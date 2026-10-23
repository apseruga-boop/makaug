'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.STAY_REQUEST_TOKEN_SECRET = 'stay-test-secret';

const booking = require('../services/shortTermBookingService');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function listing(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    reference: 'ST-000010',
    title: 'Garden flat',
    district: 'Kampala',
    area: 'Kololo',
    address: 'Plot 14 Acacia Avenue',
    latitude: 0.347891,
    longitude: 32.582341,
    max_guests: 4,
    min_nights: 1,
    host_name: 'Amina',
    host_phone: '0780863394',
    host_whatsapp: '0780863394',
    host_email: 'host@example.com',
    check_in_from: '14:00',
    house_rules: 'No parties.',
    status: 'approved',
    moderation_stage: 'approved',
    king_facts_confirmed: true,
    listing_fee_status: 'paid',
    availability: [],
    ...overrides
  };
}

test('a host reply is only the digits 1, 2 or 3', () => {
  assert.equal(booking.choiceFromReply('1'), 'accept');
  assert.equal(booking.choiceFromReply(' 2 '), 'reschedule');
  assert.equal(booking.choiceFromReply('3'), 'decline');
  assert.equal(booking.choiceFromReply('1.'), null);
  assert.equal(booking.choiceFromReply('yes'), null);
  assert.equal(booking.choiceFromReply('12'), null);
});

test('whatsapp is one queue send, email is a copy, and there is no send when the bridge is off', () => {
  const on = booking.channelsFor({ phone: '0780863394', email: 'a@b.co', bridgeEnabled: true });
  assert.equal(on.whatsapp, true);
  assert.equal(on.email, true);
  assert.equal(on.staff_wa_link, false);
  const off = booking.channelsFor({ phone: '0780863394', email: 'a@b.co', bridgeEnabled: false });
  assert.equal(off.whatsapp, false);
  assert.equal(off.email, true);
  assert.equal(off.staff_wa_link, true);
  assert.equal(booking.channelsFor({ phone: '', email: '', bridgeEnabled: true }).whatsapp, false);
});

test('the host message carries 1, 2 and 3 plus one-tap links', () => {
  const text = booking.hostRequestMessage({
    reference: 'MKS-AB12CD',
    title: 'Garden flat',
    checkIn: '2026-11-01',
    checkOut: '2026-11-04',
    guests: 2,
    guestName: 'Sara',
    guestPhone: '0780111222',
    hostLink: 'https://makaug.com/short-term/host?t=abc',
    links: {
      confirm: 'https://makaug.com/v/confirm',
      reschedule: 'https://makaug.com/v/reschedule',
      decline: 'https://makaug.com/v/decline'
    }
  });
  assert.match(text, /Reply 1 Confirm, 2 Suggest new time, 3 Can't do it/);
  assert.match(text, /https:\/\/makaug.com\/v\/confirm/);
  assert.match(text, /https:\/\/makaug.com\/v\/reschedule/);
  assert.match(text, /https:\/\/makaug.com\/v\/decline/);
  assert.match(text, /Sara/);
  assert.match(text, /0780111222/);
  assert.match(text, /does not take or hold payments/);
});

test('tokens round-trip and a guest link cannot open the host page', () => {
  const guest = booking.guestToken('MKS-AB12CD', '11111111-1111-4111-8111-111111111111', Date.now());
  const read = booking.readStayToken(guest);
  assert.equal(read.role, 'guest');
  assert.equal(read.ref, 'MKS-AB12CD');
  assert.equal(booking.readStayToken(guest.slice(0, -3) + 'xxx'), null);
  assert.equal(booking.readStayToken(booking.signStayToken({ v: 1, role: 'guest', ref: 'MKS-AB12CD', exp: Date.now() - 1000 })), null);
  const host = booking.hostToken('11111111-1111-4111-8111-111111111111');
  assert.equal(booking.readStayToken(host).role, 'host');
});

test('phone and street stay hidden until the host accepts', () => {
  const row = listing({ reference: 'MKS-AB12CD', status: 'requested', check_in: '2026-11-01', check_out: '2026-11-04', party_size: 2 });
  const hidden = booking.publicRequestShape(row);
  const blob = JSON.stringify(hidden);
  assert.equal(blob.includes('Plot 14'), false);
  assert.equal(blob.includes('0780863394'), false);
  assert.equal(blob.includes('host@example.com'), false);
  const shown = booking.acceptedGuestShape({ ...row, status: 'accepted' });
  assert.equal(shown.address, 'Plot 14 Acacia Avenue');
  assert.equal(shown.host_phone, '+256780863394');
  assert.match(shown.payment_line, /does not take or hold payments/);
});

test('blocked dates are refused and a missing terms tick is allowed', () => {
  const place = listing({
    availability: [{ starts_on: '2026-11-01', ends_on: '2026-11-10', is_available: false }]
  });
  assert.throws(() => booking.assertRequestInput(place, {
    guest_name: 'Sara',
    guest_phone: '0780111222',
    check_in: '2026-11-02',
    check_out: '2026-11-05',
    guests: 2,
    terms_accepted: true
  }), /not available/);
  assert.doesNotThrow(() => booking.assertRequestInput(listing(), {
    guest_name: 'Sara',
    guest_phone: '0780111222',
    check_in: '2026-11-02',
    check_out: '2026-11-05',
    guests: 2,
    terms_accepted: false
  }));
});

test('an ics export is blocked dates only and can be read back', () => {
  const ics = booking.buildIcs([{ starts_on: '2026-11-02', ends_on: '2026-11-04' }]);
  assert.match(ics, /SUMMARY:Blocked/);
  assert.equal(ics.includes('Sara'), false);
  const events = booking.parseIcsEvents(ics);
  assert.equal(events.length, 1);
  assert.equal(events[0].starts_on, '2026-11-02');
  assert.equal(events[0].ends_on, '2026-11-04');
});

test('a pasted calendar link has to be public https', () => {
  assert.equal(booking.assertPublicIcalUrl('https://calendar.airbnb.com/calendar/ical/abc.ics'), 'https://calendar.airbnb.com/calendar/ical/abc.ics');
  assert.throws(() => booking.assertPublicIcalUrl('http://calendar.airbnb.com/a.ics'));
  assert.throws(() => booking.assertPublicIcalUrl('https://127.0.0.1/a.ics'));
  assert.throws(() => booking.assertPublicIcalUrl('https://localhost/a.ics'));
});

test('creating a request notifies host and guest once each and hides the host number', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      if (sql.includes('st-booking:load-listing')) return { rows: [listing()] };
      if (sql.includes('st-booking:insert')) {
        return { rows: [{ id: 'req-1', reference: params[0], status: 'requested', expires_at: params[9], check_in: params[6], check_out: params[7], party_size: params[5] }] };
      }
      if (sql.includes('st-booking:staff-link')) return { rows: [] };
      throw new Error('unexpected sql ' + sql.slice(0, 40));
    }
  };
  const result = await booking.createBookingRequest(db, listing().id, {
    guest_name: 'Sara',
    guest_phone: '0780111222',
    guest_email: 'sara@example.com',
    check_in: '2026-12-01',
    check_out: '2026-12-04',
    guests: 2,
    terms_accepted: true
  }, {
    now: new Date('2026-10-19T12:00:00Z'),
    bridgeEnabled: true,
    supportEmail: '',
    deliverStayNotice: async (notice) => {
      calls.push(notice);
      return { whatsapp_queued: true, email_sent: true, staff_wa_link: null };
    }
  });
  assert.match(result.reference, /^MKS-[A-Z0-9]{6}$/);
  assert.equal(result.status, 'requested');
  assert.equal(JSON.stringify(result).includes('0780863394'), false);
  assert.equal(JSON.stringify(result).includes('Plot 14'), false);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.role), ['host', 'guest']);
  assert.match(calls[0].text, /Reply 1 Confirm, 2 Suggest new time, 3 Can't do it/);
  assert.match(calls[0].text, /\/v\//);
  assert.match(calls[1].text, new RegExp(result.reference));
});

test('reply 1 does nothing when this host has no open request', async () => {
  const db = {
    async query(sql) {
      if (sql.includes('st-booking:expire')) return { rows: [] };
      if (sql.includes('st-booking:host-phone')) return { rows: [] };
      if (sql.includes('st-booking:weekly-reply')) return { rows: [] };
      throw new Error(sql.slice(0, 60));
    }
  };
  const result = await booking.handleHostStayReply(db, { phone: '0780863394', body: '1' }, { supportEmail: '' });
  assert.equal(result.handled, false);
});

test('the bridge inbound path owns 1, 2 and 3, and sms is not part of the loop', () => {
  const service = read('services/shortTermBookingService.js');
  const route = read('routes/whatsapp.js');
  const stayRoute = read('routes/short-term.js');
  assert.match(service, /queueWhatsappWebBridgeMessage/);
  assert.match(service, /sendSupportEmail/);
  assert.equal(/sms|africastalking|twilio|graph\.facebook/i.test(service), false);
  assert.match(route, /handleHostStayReply\(db/);
  const hook = route.indexOf('handleHostStayReply(db');
  const runtime = route.indexOf('await processInboundRuntime({', hook);
  assert.ok(hook > 0 && runtime > hook, 'the stay reply must be decided before the general inbox');
  assert.match(stayRoute, /\/listings\/:id\/requests/);
  assert.match(stayRoute, /HOST_PHOTO_TTL_MS/);
  assert.match(stayRoute, /reference = 'ST-000001'/);
  const live = read('services/shortTermService.js');
  assert.match(live, /listing_fee_status IN \('paid', 'waived'\)/);
  assert.match(live, /blocked\.is_available = FALSE/);
});
