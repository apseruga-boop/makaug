'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.STAY_REQUEST_TOKEN_SECRET = process.env.STAY_REQUEST_TOKEN_SECRET || 'stay-test-secret';
process.env.AGENT_BOOKING_TOKEN_SECRET = process.env.AGENT_BOOKING_TOKEN_SECRET || 'agent-booking-test-secret';

const booking = require('../services/agentBookingService');
const stay = require('../services/shortTermBookingService');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const links = {
  confirm: 'https://makaug.com/v/c',
  reschedule: 'https://makaug.com/v/r',
  decline: 'https://makaug.com/v/d',
  visitor_cancel: 'https://makaug.com/v/cancel',
  visitor_reschedule: 'https://makaug.com/v/pick'
};

function agentDb(rows) {
  return {
    async query(sql) {
      if (sql.includes('agent-booking:agent')) {
        return { rows: [{ id: 'agent-1', full_name: 'Jonathan Wassajja', phone: '256700111222', whatsapp: '256700111222', status: 'approved' }] };
      }
      if (sql.includes('agent-booking:listing')) {
        return { rows: [{ id: 'listing-1', title: '3-bed house', area: 'Kira', district: 'Wakiso', bedrooms: 3, property_type: 'house', inquiry_reference: 'MKA-1', status: 'approved' }] };
      }
      if (sql.includes('agent-booking:pending-agent')) return { rows: rows || [] };
      throw new Error(sql.slice(0, 80));
    }
  };
}

test('1. the agent sees Offer: UGX and a non-number is refused', async () => {
  assert.equal(booking.parseOfferUgx('1,500,000'), 1500000);
  assert.equal(booking.parseOfferUgx('UGX 250000'), 250000);
  assert.equal(booking.parseOfferUgx('abc'), null);
  assert.equal(booking.parseOfferUgx('0'), null);
  const text = booking.buildAgentRequestMessage({
    intent: 'offer',
    agent_name: 'Jonathan Wassajja',
    visitor_name: 'Sarah Namubiru',
    visitor_phone: '+256772123456',
    property_label: '3-bed house, Kira',
    offer_amount: '1500000',
    public_ref: 'A7'
  }, links);
  assert.match(text, /Offer: UGX 1,500,000/);
  await assert.rejects(
    () => booking.createAgentBooking(agentDb(), {
      agentId: 'agent-1',
      listingId: 'listing-1',
      intent: 'offer',
      name: 'Sarah Namubiru',
      phone: '+256772123456',
      offerAmount: 'not-a-number'
    }),
    /Offer amount must be a number in UGX/
  );
});

test('2. confirm copy follows the intent and viewing wording stays on viewings', () => {
  const base = { visitor_name: 'Sarah Namubiru', agent_name: 'Jonathan Wassajja', visitor_phone: '+256772123456', callback_window: 'this afternoon' };
  assert.match(booking.buildVisitorStatusMessage({ ...base, intent: 'callback' }, 'confirm', links), /Jonathan Wassajja will call you this afternoon/);
  assert.match(booking.buildVisitorStatusMessage({ ...base, intent: 'question' }, 'confirm', links), /has your question and will reply/);
  assert.match(booking.buildVisitorStatusMessage({ ...base, intent: 'offer', offer_amount: '1500000' }, 'confirm', links), /received your offer of UGX 1,500,000 and will respond/);
  const viewing = booking.buildVisitorStatusMessage({
    ...base,
    intent: 'viewing',
    preferred_date: '2026-10-29',
    preferred_time: '15:00'
  }, 'confirm', links);
  assert.match(viewing, /will meet you/);
  assert.match(viewing, /agree the meeting point/);
  assert.match(viewing, /Never pay before you have seen the property/);
  assert.equal(/will meet you/.test(booking.buildVisitorStatusMessage({ ...base, intent: 'callback' }, 'confirm', links)), false);
});

test('3. a suggested time sends Accept and Pick another, and reschedule restarts the timers', () => {
  const message = booking.buildVisitorStatusMessage({
    intent: 'viewing',
    visitor_name: 'Sarah Namubiru',
    agent_name: 'Jonathan Wassajja',
    preferred_date: '2026-10-29',
    preferred_time: '15:00',
    proposed_date: '2026-10-30',
    proposed_time: '16:00'
  }, 'reschedule', links);
  assert.match(message, /Accept: https:\/\/makaug.com\/v\/c/);
  assert.match(message, /Pick another: https:\/\/makaug.com\/v\/pick/);
  const applied = booking.applyReply({
    status: 'pending',
    intent: 'viewing',
    preferred_date: '2026-10-29',
    preferred_time: '15:00'
  }, 'reschedule', { proposed_date: '2026-10-30', proposed_time: '16:00' }, new Date('2026-10-27T10:00:00Z'));
  assert.equal(applied.ok, true);
  assert.equal(applied.request.status, 'reschedule');
  assert.ok(applied.request.reminder_due_at);
  assert.ok(applied.request.escalate_due_at);
  assert.equal(applied.request.reminded_at, null);
  assert.equal(applied.request.escalated_at, null);
  assert.deepEqual(booking.dueActions({
    status: 'reschedule',
    intent: 'viewing',
    reminded_at: null,
    escalated_at: null,
    reminder_due_at: '2020-01-01T00:00:00Z',
    escalate_due_at: '2099-01-01T00:00:00Z'
  }, new Date('2026-10-27T10:00:00Z')), ['remind']);
  const stayText = stay.guestSuggestedDatesMessage({
    reference: 'MKS-AB12CD',
    checkIn: '2026-11-02',
    checkOut: '2026-11-05',
    acceptUrl: 'https://makaug.com/v/accept',
    pickUrl: 'https://makaug.com/v/pick'
  });
  assert.match(stayText, /Accept: https:\/\/makaug.com\/v\/accept/);
  assert.match(stayText, /Pick another: https:\/\/makaug.com\/v\/pick/);
});

test('4. each agent message has a reference, and a bare number does not guess', async () => {
  const text = booking.buildAgentRequestMessage({
    intent: 'viewing',
    agent_name: 'Jonathan Wassajja',
    visitor_name: 'Sarah Namubiru',
    visitor_phone: '+256772123456',
    property_label: '3-bed house',
    public_ref: 'A7',
    when_label: 'Tue 27 Oct, 2:00 pm'
  }, links);
  assert.match(text, /Ref A7/);
  assert.match(text, /Reply like 1 A7/);
  assert.deepEqual(booking.parseAgentReply('1 A7'), { action: 'confirm', ref: 'A7' });
  assert.deepEqual(booking.parseAgentReply('3 b4'), { action: 'decline', ref: 'B4' });
  assert.equal(booking.parseAgentReply('1.'), null);
  const rows = [
    { id: 'a', public_ref: 'A7', status: 'pending', intent: 'viewing', visitor_name: 'Sarah', visitor_phone: '+256700000001', agent_name: 'Jonathan' },
    { id: 'b', public_ref: 'B4', status: 'pending', intent: 'callback', visitor_name: 'Amina', visitor_phone: '+256700000002', agent_name: 'Jonathan' }
  ];
  const ambiguous = await booking.handleAgentBookingReply(agentDb(rows), { phone: '+256700111222', body: '1' });
  assert.equal(ambiguous.handled, true);
  assert.match(ambiguous.message, /Which request\? Reply with the number and the reference/);
  assert.match(ambiguous.message, /A7/);
  assert.match(ambiguous.message, /B4/);
  const picked = await booking.handleAgentBookingReply(agentDb(rows), { phone: '+256700111222', body: '1 A7', dryRun: true });
  assert.equal(picked.request.id, 'a');
  assert.equal(picked.request.action, 'confirm');
});

test('5. a skipped handoff tells the visitor the truth', () => {
  assert.equal(booking.handoffReached('queued'), true);
  assert.equal(booking.handoffReached('disabled'), false);
  for (const status of ['repeat', 'capped', 'listing_not_live', 'disabled', 'failed']) {
    const text = booking.buildVisitorSkippedMessage({
      visitor_name: 'Sarah Namubiru',
      agent_name: 'Jonathan Wassajja',
      property_label: '3-bed house'
    }, status);
    assert.match(text, /Sarah/);
    assert.equal(/has been sent/.test(text), false, status);
  }
  assert.match(booking.buildVisitorSkippedMessage({
    visitor_name: 'Sarah',
    agent_name: 'Jonathan',
    property_label: '3-bed house'
  }, 'repeat'), /have not sent it/);
  assert.match(read('services/agentBookingService.js'), /buildVisitorSkippedMessage/);
});

test('6. replies match the number the request was sent to and the agent numbers', () => {
  const agentSql = read('services/agentBookingService.js');
  const staySql = read('services/shortTermBookingService.js');
  assert.match(agentSql, /sent_to_phone/);
  assert.match(agentSql, /a\.whatsapp/);
  assert.match(agentSql, /a\.phone/);
  assert.match(staySql, /r\.sent_to_phone/);
  assert.match(staySql, /l\.host_phone/);
  assert.match(staySql, /l\.host_whatsapp/);
  assert.match(agentSql, /right\(regexp_replace/);
  assert.match(staySql, /right\(regexp_replace/);
});

test('7. property pages include a compact booking panel with the listing locked', () => {
  const app = read('assets/makaug-app.js');
  const css = read('index.html');
  assert.match(app, /property-booking-panel/);
  assert.match(app, /function propertyBookingPanelHtml/);
  assert.match(app, /mountPropertyBookingPanel\(bookingAgentId, propertyBookingListingId\(p\), renderSerial\)/);
  assert.match(app, /lockedPlace: listingId \? `property:\$\{listingId\}` : ""/);
  assert.match(app, /agentBookingLockedPlace/);
  assert.match(app, /type="hidden"/);
  assert.match(css, /\.property-booking-panel \{/);
  assert.match(css, /\.agent-profile-contact \{ position: sticky/);
});

test('8. the visitor confirm message includes cancel and reschedule links', () => {
  const text = booking.buildVisitorStatusMessage({
    intent: 'callback',
    visitor_name: 'Sarah Namubiru',
    agent_name: 'Jonathan Wassajja',
    callback_window: 'this afternoon'
  }, 'confirm', links);
  assert.match(text, /Cancel: https:\/\/makaug.com\/v\/cancel/);
  assert.match(text, /Reschedule: https:\/\/makaug.com\/v\/pick/);
});

test('9. escalation always flags staff and realerts after the configured hours', () => {
  const previous = process.env.AGENT_BOOKING_ESCALATION_REALERT_HOURS;
  delete process.env.AGENT_BOOKING_ESCALATION_REALERT_HOURS;
  try {
    assert.equal(booking.bookingConfig().realertHours, 12);
  } finally {
    if (previous == null) delete process.env.AGENT_BOOKING_ESCALATION_REALERT_HOURS;
    else process.env.AGENT_BOOKING_ESCALATION_REALERT_HOURS = previous;
  }
  const stamped = new Date('2026-10-27T00:00:00Z');
  assert.equal(booking.realertDue({ status: 'escalated', staff_alerted_at: stamped.toISOString() }, new Date('2026-10-27T11:00:00Z')), false);
  assert.equal(booking.realertDue({ status: 'escalated', staff_alerted_at: stamped.toISOString() }, new Date('2026-10-27T12:00:00Z')), true);
  assert.equal(booking.realertDue({ status: 'pending', escalated_at: stamped.toISOString() }, new Date('2026-10-28T00:00:00Z')), false);
  const source = read('services/agentBookingService.js');
  const escalateAt = source.indexOf("action === 'escalate'");
  const flagAt = source.indexOf('kind: \'escalation\'', escalateAt);
  const targetsAt = source.indexOf('for (const target of targets)', escalateAt);
  assert.ok(flagAt > escalateAt && flagAt < targetsAt);
  assert.match(read('services/shortTermBookingService.js'), /kind: 'stay_escalation'/);
  assert.match(read('services/shortTermBookingService.js'), /kind: 'stay_escalation_realert'/);
});

test('10. the in-process scheduler catches up without a new service', () => {
  assert.equal(booking.shouldSendWeekly(new Date('2026-10-26T07:00:00.000Z')), true);
  assert.equal(booking.shouldSendWeekly(new Date('2026-10-27T07:00:00.000Z')), false);
  assert.equal(booking.shouldCatchUpWeekly(new Date('2026-10-27T07:00:00.000Z')), true);
  assert.equal(booking.shouldCatchUpWeekly(new Date('2026-10-26T05:00:00.000Z')), false);
  const source = read('services/agentBookingService.js');
  assert.match(source, /setTimeout\(run, BOOT_DELAY_MS\.agent_booking\)/);
  assert.match(source, /catchUp: true/);
  assert.match(source, /shouldCatchUpWeekly\(now, config\)/);
  assert.match(read('utils/schedulerStagger.js'), /agent_booking: 320_000/);
  assert.match(read('services/shortTermBookingService.js'), /shouldCatchUpWeekly\(at\)/);
  assert.equal(/createWebService|render\.yaml/.test(source), false);
});

test('11. a down stay bridge flags staff and emails them, with no official API', async () => {
  const queries = [];
  const mails = [];
  await stay.alertIfBridgeDown({
    async query(sql) {
      queries.push(sql);
      return { rows: [] };
    }
  }, { whatsapp_queued: false, staff_wa_link: 'https://wa.me/256700111222?text=hi' }, {
    reference: 'MKS-AB12CD',
    role: 'host',
    text: 'Please confirm'
  }, {
    supportEmail: 'staff@makaug.com',
    sendSupportEmail: async (mail) => {
      mails.push(mail);
      return { sent: true };
    }
  });
  assert.match(queries.join('\n'), /agent-booking:flag/);
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /bridge unavailable/);
  assert.match(mails[0].text, /No official API was used/);
  const quiet = [];
  await stay.alertIfBridgeDown({
    async query() {
      quiet.push('query');
      return { rows: [] };
    }
  }, { whatsapp_queued: true, staff_wa_link: null }, { reference: 'MKS-AB12CD', role: 'guest', text: 'ok' }, { supportEmail: '' });
  assert.equal(quiet.length, 0);
  const service = read('services/shortTermBookingService.js');
  assert.equal(/graph\.facebook|africastalking|twilio/i.test(service), false);
});

test('12. the host and the guest are told the same stay deadline', () => {
  assert.equal(stay.stayDeadlinePhrase(), '24 hours');
  const host = stay.hostRequestMessage({
    reference: 'MKS-AB12CD',
    title: 'Garden flat',
    checkIn: '2026-11-01',
    checkOut: '2026-11-04',
    guests: 2
  });
  const guest = stay.guestRequestMessage({ reference: 'MKS-AB12CD', statusUrl: 'https://makaug.com/s' });
  assert.match(host, /within 24 hours/);
  assert.match(guest, /24 hours/);
  assert.equal(host.includes('within 1 hour'), false);
});

test('13. the stay panel shows guests, an optional email, an optional terms tick, blocked days and the status link', () => {
  const page = read('assets/short-term.js');
  assert.match(page, /id="st-d-guests"/);
  assert.match(page, /Email \(optional\)/);
  assert.match(page, /id="st-d-terms"/);
  assert.equal(/id="st-e-terms" required/.test(page), false);
  assert.match(page, /is-blocked/);
  assert.match(page, /Track this request/);
  assert.match(page, /Blocked dates/);
  assert.doesNotThrow(() => stay.assertRequestInput({
    max_guests: 4,
    min_nights: 1,
    availability: []
  }, {
    guest_name: 'Sara',
    guest_phone: '0780111222',
    check_in: '2026-12-01',
    check_out: '2026-12-04',
    guests: 2,
    terms_accepted: false
  }));
});

test('14. address and house rules go out only for an accepted dated stay', () => {
  const dated = stay.guestDecisionMessage({
    reference: 'MKS-AB12CD',
    accepted: true,
    statusUrl: 'https://makaug.com/s',
    hostPhone: '+256780863394',
    address: 'Plot 14 Acacia Avenue',
    checkInFrom: '14:00',
    houseRules: 'No parties.',
    intent: 'dates',
    checkIn: '2026-11-01'
  });
  assert.match(dated, /Address: Plot 14 Acacia Avenue/);
  assert.match(dated, /House rules: No parties/);
  const callback = stay.guestDecisionMessage({
    reference: 'MKS-AB12CD',
    accepted: true,
    statusUrl: 'https://makaug.com/s',
    hostPhone: '+256780863394',
    address: 'Plot 14 Acacia Avenue',
    checkInFrom: '14:00',
    houseRules: 'No parties.',
    intent: 'callback',
    checkIn: null
  });
  assert.equal(callback.includes('Plot 14'), false);
  assert.equal(callback.includes('House rules'), false);
  assert.match(callback, /Host phone/);
  assert.match(stay.hostDecisionAck({ reference: 'MKS-AB12CD', accepted: true, dated: false }), /has your phone\./);
  assert.equal(stay.hostDecisionAck({ reference: 'MKS-AB12CD', accepted: true, dated: false }).includes('address'), false);
  const hidden = stay.acceptedGuestShape({
    status: 'accepted',
    intent: 'question',
    address: 'Plot 14 Acacia Avenue',
    house_rules: 'No parties.',
    host_phone: '0780863394',
    reference: 'MKS-AB12CD'
  });
  assert.equal(hidden.address, null);
  assert.equal(hidden.house_rules, null);
});

test('15. escalated and reschedule stays expire, and staff can close them', async () => {
  const service = read('services/shortTermBookingService.js');
  assert.match(service, /status IN \('requested', 'reschedule', 'escalated', 'no_response'\)/);
  assert.match(read('routes/short-term.js'), /\/staff\/booking-requests\/:reference\/close/);
  const closed = await stay.staffCloseStayRequest({
    async query(sql) {
      if (sql.includes('st-booking:load-request')) {
        return {
          rows: [{
            id: '11111111-1111-4111-8111-111111111111',
            reference: 'MKS-AB12CD',
            listing_id: '11111111-1111-4111-8111-111111111111',
            status: 'escalated',
            guest_phone: '0780111222',
            guest_email: 'sara@example.com'
          }]
        };
      }
      if (sql.includes('st-booking:staff-close')) return { rows: [{ reference: 'MKS-AB12CD', status: 'cancelled' }] };
      throw new Error(sql.slice(0, 60));
    }
  }, 'MKS-AB12CD', {
    supportEmail: '',
    deliverStayNotice: async () => ({ whatsapp_queued: true, staff_wa_link: null })
  });
  assert.equal(closed.status, 'cancelled');
});

test('16. weekly replies take numbers, and stays say Open, Fully booked or Paused', () => {
  assert.deepEqual(booking.parseWeeklyReply('1'), { listingIndex: 0, action: 'still_available' });
  assert.deepEqual(booking.parseWeeklyReply('2 4'), { listingIndex: 2, action: 'sold' });
  assert.deepEqual(stay.parseStayWeeklyReply('1'), { listingIndex: 0, action: 'open' });
  assert.deepEqual(stay.parseStayWeeklyReply('2'), { listingIndex: 0, action: 'fully_booked' });
  assert.deepEqual(stay.parseStayWeeklyReply('3'), { listingIndex: 0, action: 'paused' });
  assert.deepEqual(stay.parseStayChoice('1 MKS-AB12CD'), { choice: 'accept', reference: 'MKS-AB12CD' });
  const property = booking.buildWeeklyMessage(
    { full_name: 'Jonathan Wassajja' },
    [{ title: '3-bed house', area: 'Kira' }],
    [{ still_available: 'https://makaug.com/v/a', under_offer: 'https://makaug.com/v/u', let_agreed: 'https://makaug.com/v/l', sold: 'https://makaug.com/v/s' }]
  );
  assert.match(property, /Still available/);
  assert.match(property, /Reply 1 Still available, 2 Under offer, 3 Let agreed, 4 Sold/);
  const staySource = read('services/shortTermBookingService.js');
  assert.match(staySource, /Reply 1 Open, 2 Fully booked, 3 Paused/);
  assert.match(staySource, /Fully booked: \$\{links\.fully_booked\}/);
  assert.equal(stay.choiceFromReply('1.'), null);
});

test('17. long questions are marked cut, the response label is real, desktop tabs have words, and stay reminders use check-in time', () => {
  const long = 'q'.repeat(950);
  assert.match(booking.clipNote(long), /\(cut\)$/);
  assert.equal(booking.clipNote('short question'), 'short question');
  assert.match(stay.stayWhenLine({ intent: 'question', message: long }), /\(cut\)/);
  const agents = read('routes/agents.js');
  assert.equal(agents.includes("response_time_label: ''"), false);
  assert.match(agents, /loadResponseTimeLabel\(db, agent\.id\)/);
  const app = read('assets/makaug-app.js');
  assert.match(app, /agent-booking-response/);
  assert.match(app, /node\.hidden = !label/);
  assert.match(app, /<span>Viewing<\/span>/);
  assert.match(app, /<span>Offer<\/span>/);
  const css = read('index.html');
  assert.match(css, /booking-tab-labels/);
  assert.match(css, /@media \(min-width: 768px\)/);
  assert.match(css, /#st-intent-tabs button/);
  const atThree = stay.stayCheckInInstant('2026-11-01', '15:00');
  assert.equal(atThree.toISOString(), '2026-11-01T12:00:00.000Z');
  const fallback = stay.stayCheckInInstant('2026-11-01', '');
  assert.equal(fallback.toISOString(), '2026-11-01T11:00:00.000Z');
  const stayReminders = read('services/shortTermBookingService.js');
  assert.match(stayReminders, /const fromLabel = stayCheckInLabel\(row\.check_in_from\)/);
  assert.match(stayReminders, /Check in from \{time\}/);
  assert.match(stayReminders, /time: fromLabel/);
});

test('a stay escalation flags staff even when a WhatsApp target exists', async () => {
  const seen = [];
  const db = {
    async query(sql) {
      seen.push(sql);
      if (sql.includes('st-booking:expire') || sql.includes('st-booking:complete') || sql.includes('st-booking:review-due')) return { rows: [] };
      if (sql.includes('st-booking:reply-due')) {
        return {
          rows: [{
            id: '11111111-1111-4111-8111-111111111111',
            status: 'reschedule',
            escalated_at: null,
            escalate_due_at: '2020-01-01T00:00:00Z',
            reminded_at: '2020-01-01T00:00:00Z',
            reference: 'MKS-AB12CD',
            guest_name: 'Sara',
            guest_phone: '0780111222',
            title: 'Garden flat',
            intent: 'dates',
            check_in: '2026-11-01',
            check_out: '2026-11-04',
            party_size: 2
          }]
        };
      }
      if (sql.includes('st-booking:mark-escalated') || sql.includes('agent-booking:flag')) return { rows: [] };
      if (sql.includes('st-booking:weekly')) return { rows: [] };
      return { rows: [] };
    }
  };
  const summary = await stay.sweepStayReplyLoop(db, new Date('2026-10-27T10:00:00Z'), {
    supportEmail: '',
    deliverStayNotice: async () => ({ whatsapp_queued: true, staff_wa_link: null })
  });
  assert.equal(summary.escalated, 1);
  assert.match(seen.join('\n'), /agent-booking:flag/);
  assert.match(seen.join('\n'), /status IN \('requested', 'reschedule'\)/);
});
