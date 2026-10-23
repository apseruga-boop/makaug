'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.AGENT_BOOKING_TOKEN_SECRET = 'booking-test-secret';
process.env.STAY_REQUEST_TOKEN_SECRET = 'stay-test-secret';
process.env.AGENT_BOOKING_TIMEZONE = 'Africa/Kampala';
process.env.AGENT_BOOKING_QUIET_HOURS = '20:00-07:00';
process.env.AGENT_BOOKING_ESCALATION_RESUME = '09:00';
process.env.AGENT_BOOKING_REPLY_WINDOW_HOURS = '1';
process.env.AGENT_BOOKING_ESCALATE_HOURS = '2';
process.env.PUBLIC_SITE_URL = 'https://makaug.com';
delete process.env.AVAILABILITY_HIDE_STALE;

const booking = require('../services/agentBookingService');
const stay = require('../services/shortTermBookingService');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('slots skip Sunday, notice, blackout and a full slot, and keep Any time', () => {
  const schedule = booking.mergeSchedule({
    available_days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
    available_time_windows: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '17:00' }],
    notice_period_hours: 24,
    blackout_dates: ['2026-10-28'],
    max_bookings_per_slot: 1
  }, null);
  const built = booking.buildDaysAndSlots({
    now: new Date('2026-10-27T07:00:00.000Z'),
    schedule,
    bookings: [{ preferred_date: '2026-10-29', preferred_time: '14:00', n: 1 }]
  });
  const sunday = built.days.find((day) => day.date === '2026-11-01');
  const blackout = built.days.find((day) => day.date === '2026-10-28');
  const open = built.days.find((day) => day.date === '2026-10-29');
  assert.equal(sunday.available, false);
  assert.equal(blackout.available, false);
  assert.equal(booking.slotIsOpen(built, '2026-10-29', '14:00'), false);
  assert.equal(booking.slotIsOpen(built, '2026-10-29', '15:00'), true);
  assert.equal(booking.slotIsOpen(built, '2026-10-29', 'any'), true);
  assert.equal(open.available, true);
  assert.equal(booking.slotIsOpen(built, '2026-10-27', '15:00'), false);
});

test('tokens reject tampering and expiry, and prefetch does not apply', () => {
  const token = booking.signToken({ v: 1, bid: 'abc', action: 'confirm', exp: Date.now() + 60000 });
  assert.equal(booking.readToken(token).action, 'confirm');
  assert.equal(booking.readToken(token.slice(0, -2) + 'xx'), null);
  assert.equal(booking.readToken(booking.signToken({ v: 1, action: 'confirm', exp: Date.now() - 1000 })), null);
  assert.equal(booking.shouldApplyOnOpen({ method: 'GET', purpose: '', action: 'confirm' }), true);
  assert.equal(booking.shouldApplyOnOpen({ method: 'GET', purpose: 'prefetch', action: 'confirm' }), false);
  assert.equal(booking.shouldApplyOnOpen({ method: 'POST', purpose: '', action: 'confirm' }), false);
  assert.equal(booking.shouldApplyOnOpen({ method: 'GET', purpose: '', action: 'reschedule' }), false);
});

test('status moves and an escalation records no_response then escalated', () => {
  const pending = { id: '1', status: 'pending', intent: 'viewing', listing_id: 'p1', events: [] };
  const confirmed = booking.applyReply(pending, 'confirm', {}, new Date('2026-10-27T08:00:00Z'));
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.request.status, 'confirmed');
  assert.equal(confirmed.listingPatch.touch, true);
  const closed = booking.applyReply(confirmed.request, 'confirm');
  assert.equal(closed.ok, false);
  const escalated = booking.applyReply(pending, 'escalate', {}, new Date('2026-10-27T10:00:00Z'));
  assert.equal(escalated.request.status, 'escalated');
  assert.deepEqual(escalated.request.events.map((event) => event.type), ['no_response', 'escalated']);
  const taken = booking.applyReply(confirmed.request, 'outcome_taken');
  assert.equal(taken.request.status, 'completed');
  assert.equal(taken.listingPatch.availability_status, 'sold');
});

test('quiet hours move the reminder to 07:00 and the escalation to 09:00 Kampala', () => {
  const evening = new Date('2026-10-27T18:00:00.000Z');
  const early = new Date('2026-10-27T03:00:00.000Z');
  const morning = new Date('2026-10-27T07:00:00.000Z');
  assert.equal(booking.isQuietHours(evening), true);
  assert.equal(booking.isQuietHours(new Date('2026-10-27T04:00:00.000Z')), false);
  assert.equal(booking.reminderDueAt(morning).toISOString(), '2026-10-27T08:00:00.000Z');
  assert.equal(booking.escalateDueAt(morning).toISOString(), '2026-10-27T09:00:00.000Z');
  assert.equal(booking.reminderDueAt(evening).toISOString(), '2026-10-28T04:00:00.000Z');
  assert.equal(booking.escalateDueAt(evening).toISOString(), '2026-10-28T06:00:00.000Z');
  assert.equal(booking.reminderDueAt(early).toISOString(), '2026-10-27T04:00:00.000Z');
  assert.equal(booking.escalateDueAt(early).toISOString(), '2026-10-27T06:00:00.000Z');
});

test('availability badges age in calendar days and search hiding stays off', () => {
  const now = new Date('2026-10-27T10:00:00.000Z');
  assert.equal(booking.availabilityView({ availability_status: 'available', last_confirmed_at: '2026-10-27T08:00:00Z' }, now).label, 'Available · checked today');
  assert.equal(booking.availabilityView({ availability_status: 'available', last_confirmed_at: '2026-10-26T08:00:00Z' }, now).label, 'Available · checked 1 day ago');
  assert.match(booking.availabilityView({ availability_status: 'available', last_confirmed_at: '2026-10-14T08:00:00Z' }, now).label, /13 days ago|not recently confirmed/);
  assert.equal(booking.availabilityView({ availability_status: 'available', last_confirmed_at: '2026-10-13T08:00:00Z' }, now).label, 'Available · not recently confirmed');
  assert.equal(booking.availabilityView({ availability_status: 'sold' }, now).label, 'Sold');
  assert.equal(booking.publicStaleAvailabilitySql('p'), '');
  process.env.AVAILABILITY_HIDE_STALE = 'true';
  assert.match(booking.publicStaleAvailabilitySql('p'), /last_confirmed_at/);
  delete process.env.AVAILABILITY_HIDE_STALE;
});

test('the agent message names the visitor, property, time, phone and the three links', () => {
  const links = {
    confirm: 'https://makaug.com/v/c',
    reschedule: 'https://makaug.com/v/r',
    decline: 'https://makaug.com/v/d'
  };
  const text = booking.buildAgentRequestMessage({
    intent: 'viewing',
    agent_name: 'Jonathan Wassajja',
    visitor_name: 'Sarah Namubiru',
    visitor_phone: '+256772123456',
    property_label: '3-bed house, Kira',
    when_label: 'Tue 27 Oct, 2:00 pm'
  }, links);
  assert.match(text, /Sarah Namubiru/);
  assert.match(text, /3-bed house, Kira/);
  assert.match(text, /Tue 27 Oct, 2:00 pm/);
  assert.match(text, /\+256772123456/);
  assert.match(text, /Reply 1 Confirm, 2 Suggest new time, 3 Can't do it/);
  assert.match(text, /https:\/\/makaug.com\/v\/c/);
  assert.match(text, /https:\/\/makaug.com\/v\/r/);
  assert.match(text, /https:\/\/makaug.com\/v\/d/);
  assert.equal(booking.formatWhen('2026-10-27', '14:00'), 'Tue 27 Oct, 2:00 pm');
});

test('creating a booking uses the injected sender and does not call the bridge itself', async () => {
  const sent = [];
  const db = {
    async query(sql, params) {
      if (sql.includes('agent-booking:agent')) return { rows: [{ id: params[0], full_name: 'Jonathan Wassajja', phone: '256700111222', whatsapp: '256700111222', status: 'approved' }] };
      if (sql.includes('agent-booking:listing')) return { rows: [{ id: params[0], title: '3-bed house', area: 'Kira', district: 'Wakiso', bedrooms: 3, property_type: 'house', inquiry_reference: 'MKA-1', status: 'approved' }] };
      if (sql.includes('agent-booking:config')) return { rows: [] };
      if (sql.includes('agent-booking:defaults')) return { rows: [] };
      if (sql.includes('agent-booking:slot-count')) return { rows: [] };
      if (sql.includes('agent-booking:insert-viewing')) return { rows: [{ id: 'view-1' }] };
      if (sql.includes('agent-booking:insert-request')) return { rows: [{ id: 'req-1', created_at: '2026-10-27T07:00:00Z' }] };
      if (sql.includes('agent-booking:attach')) return { rows: [] };
      throw new Error(sql.slice(0, 80));
    }
  };
  const result = await booking.createAgentBooking(db, {
    agentId: 'agent-1',
    listingId: 'listing-1',
    intent: 'viewing',
    name: 'Sarah Namubiru',
    phone: '+256772123456',
    preferredDate: '2026-10-29',
    preferredTime: '15:00',
    now: new Date('2026-10-27T07:00:00.000Z')
  }, {
    createLead: async () => ({ id: 'lead-1' }),
    loadListingContact: async () => ({ id: 'listing-1', title: '3-bed house' }),
    handOffListingLead: async (_db, input) => {
      sent.push(input.extra.agent_message);
      return { status: 'queued' };
    },
    deliverWhatsapp: async () => {
      throw new Error('direct send should not run when the handoff owns the first message');
    }
  });
  assert.equal(result.handoff, 'queued');
  assert.match(sent[0], /Sarah Namubiru/);
  assert.match(sent[0], /Reply 1 Confirm/);
  assert.equal(read('services/agentBookingService.js').includes('queueWhatsappWebBridgeMessage'), false);
});

test('a short-stay callback has no dates and still sends 1, 2 and 3', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      if (sql.includes('st-booking:load-listing')) {
        return { rows: [{ id: '11111111-1111-4111-8111-111111111111', title: 'Garden flat', status: 'approved', moderation_stage: 'approved', king_facts_confirmed: true, listing_fee_status: 'paid', host_phone: '0780863394', host_whatsapp: '0780863394', availability: [], max_guests: 4, min_nights: 1 }] };
      }
      if (sql.includes('st-booking:insert')) {
        assert.equal(params[6], null);
        assert.equal(params[7], null);
        assert.equal(params[10], 'callback');
        return { rows: [{ id: 'req-1', reference: params[0], status: 'requested', expires_at: params[9] }] };
      }
      throw new Error(sql.slice(0, 60));
    }
  };
  const result = await stay.createBookingRequest(db, '11111111-1111-4111-8111-111111111111', {
    intent: 'callback',
    guest_name: 'Sara',
    guest_phone: '0780111222',
    terms_accepted: true
  }, {
    now: new Date('2026-10-27T07:00:00.000Z'),
    bridgeEnabled: true,
    supportEmail: '',
    deliverStayNotice: async (notice) => {
      calls.push(notice);
      return { whatsapp_queued: true };
    }
  });
  assert.equal(result.status, 'requested');
  assert.match(calls[0].text, /Callback request/);
  assert.match(calls[0].text, /Reply 1 Confirm, 2 Suggest new time, 3 Can't do it/);
  assert.equal(calls[0].text.includes('queueWhatsappWebBridgeMessage'), false);
});

test('reply 2 on a stay proposes a new time and does not decline', () => {
  assert.equal(stay.choiceFromReply('2'), 'reschedule');
  assert.equal(stay.choiceFromReply('3'), 'decline');
});

test('Monday weekly copy asks whether the stay dates are still free', () => {
  assert.equal(booking.shouldSendWeekly(new Date('2026-10-26T07:00:00.000Z')), true);
  assert.equal(booking.shouldSendWeekly(new Date('2026-10-27T07:00:00.000Z')), false);
  const text = booking.buildWeeklyMessage(
    { full_name: 'Jonathan Wassajja' },
    [{ title: '3-bed house', area: 'Kira', bedrooms: 3, property_type: 'house' }],
    [{ still_available: 'https://makaug.com/v/a', under_offer: 'https://makaug.com/v/u', let_agreed: 'https://makaug.com/v/l', sold: 'https://makaug.com/v/s' }]
  );
  assert.match(text, /Still available/);
  assert.match(text, /https:\/\/makaug.com\/v\/a/);
});

test('the public pages and the scheduler are wired without a WhatsApp config edit', () => {
  const server = read('server.js');
  const whatsapp = read('routes/whatsapp.js');
  const properties = read('routes/properties.js');
  const stagger = read('utils/schedulerStagger.js');
  assert.match(server, /startAgentBookingScheduler\(db\)/);
  assert.match(server, /app\.get\('\/v\/:token'/);
  assert.match(server, /\/api\/agent-bookings/);
  assert.match(whatsapp, /handleAgentBookingReply\(db/);
  assert.match(properties, /publicStaleAvailabilitySql\('p'\)/);
  assert.match(stagger, /agent_booking: 320_000/);
  assert.equal(/WAHA_SESSION|WAHA_API/.test(read('services/agentBookingService.js')), false);
  const app = read('assets/makaug-app.js');
  assert.match(app, /Book a viewing/);
  assert.match(app, /Request a callback/);
  assert.match(app, /data-agent-booking-tab="offer"/);
  assert.match(read('assets/short-term.js'), /data-st-intent="callback"/);
  assert.match(read('assets/short-term.js'), /Still available for these dates\?|Blocked dates/);
  const packs = ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar'];
  for (const lang of packs) {
    const pack = JSON.parse(read(`assets/i18n/site-${lang}.json`));
    assert.ok(pack.phrases['Request a callback']);
    assert.ok(pack.phrases['Still available for these dates?']);
    assert.notEqual(pack.phrases['Request a callback'], 'Request a callback');
    if (lang === 'ar') assert.match(pack.phrases['Request a callback'], /[\u0600-\u06FF]/);
  }
});
