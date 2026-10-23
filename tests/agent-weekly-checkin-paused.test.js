'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AGENT_BOOKING_TOKEN_SECRET = process.env.AGENT_BOOKING_TOKEN_SECRET || 'agent-weekly-checkin-test-secret';
process.env.AGENT_BOOKING_TIMEZONE = 'Africa/Kampala';

const booking = require('../services/agentBookingService');

// Monday 10:00 Africa/Kampala. The live tick would send the availability
// check-in in this window when the flag is on.
const MONDAY_KAMPALA_MORNING = new Date('2026-10-26T07:00:00.000Z');

function tickDb({ due = [] } = {}) {
  const sqlSeen = [];
  return {
    sqlSeen,
    async query(sql) {
      sqlSeen.push(String(sql));
      if (sql.includes('agent-booking:due')) return { rows: due };
      if (sql.includes('agent-booking:weekly-agents')) {
        return {
          rows: [{
            id: 'agent-1',
            full_name: 'Amina Kato',
            phone: '256700111222',
            whatsapp: '256700111222'
          }]
        };
      }
      if (sql.includes('agent-booking:weekly-listings')) {
        return {
          rows: [{
            id: 'listing-1',
            title: '3-bed house',
            area: 'Kira',
            district: 'Wakiso',
            bedrooms: 3,
            property_type: 'house'
          }]
        };
      }
      return { rows: [] };
    }
  };
}

function waitingRequest() {
  return {
    id: 'req-1',
    status: 'pending',
    intent: 'callback',
    visitor_name: 'Sarah Namubiru',
    visitor_phone: '256700333444',
    agent_name: 'Amina Kato',
    agent_phone: '256700111222',
    agent_whatsapp: '256700111222',
    callback_window: 'this afternoon',
    reminded_at: null,
    escalated_at: null,
    reminder_due_at: '2026-10-26T06:00:00.000Z',
    escalate_due_at: '2026-10-26T12:00:00.000Z',
    events: []
  };
}

async function runTick(db) {
  const sent = [];
  const stayNotices = [];
  const summary = await booking.tickAgentBookings(db, MONDAY_KAMPALA_MORNING, {
    deliverWhatsapp: async (message) => {
      sent.push(message);
      return { status: 'queued' };
    },
    deliverStayNotice: async (notice) => {
      stayNotices.push(notice);
      return { whatsapp_queued: true };
    }
  });
  return { sent, stayNotices, summary };
}

test('Monday agent availability check-ins stay off unless AGENT_WEEKLY_CHECKIN_ENABLED is true', async () => {
  const previous = process.env.AGENT_WEEKLY_CHECKIN_ENABLED;
  try {
    delete process.env.AGENT_WEEKLY_CHECKIN_ENABLED;
    assert.equal(booking.bookingConfig().weeklyCheckinEnabled, false);
    assert.equal(booking.shouldCatchUpWeekly(MONDAY_KAMPALA_MORNING), true);

    const paused = tickDb({ due: [waitingRequest()] });
    const off = await runTick(paused);
    assert.equal(off.summary.weekly, 0);
    assert.equal(off.summary.reminded, 1);
    assert.deepEqual(off.sent.map((message) => message.kind), ['agent_booking_reminder']);
    assert.equal(off.sent.some((message) => /Monday check-in/.test(message.body)), false);
    assert.equal(paused.sqlSeen.some((sql) => sql.includes('agent-booking:weekly-agents')), false);
    assert.equal(paused.sqlSeen.some((sql) => sql.includes('listing_availability_checkins')), false);
    assert.equal(paused.sqlSeen.some((sql) => sql.includes('st-booking:weekly-listings')), true);
    assert.equal(off.stayNotices.length, 0);

    for (const value of ['true', '1', 'yes', 'on']) {
      process.env.AGENT_WEEKLY_CHECKIN_ENABLED = value;
      assert.equal(booking.bookingConfig().weeklyCheckinEnabled, true, value);
    }
    for (const value of ['false', '0', 'no', 'off', '']) {
      process.env.AGENT_WEEKLY_CHECKIN_ENABLED = value;
      assert.equal(booking.bookingConfig().weeklyCheckinEnabled, false, value);
    }

    process.env.AGENT_WEEKLY_CHECKIN_ENABLED = 'true';
    const live = tickDb();
    const on = await runTick(live);
    assert.equal(on.summary.weekly, 1);
    assert.equal(on.sent.length, 1);
    assert.equal(on.sent[0].kind, 'agent_booking_weekly');
    assert.match(on.sent[0].body, /Monday check-in for Amina Kato/);
    assert.equal(on.sent[0].to, '256700111222');
    assert.equal(live.sqlSeen.some((sql) => sql.includes('INSERT INTO listing_availability_checkins')), true);
    assert.equal(on.stayNotices.length, 0);
  } finally {
    if (previous == null) delete process.env.AGENT_WEEKLY_CHECKIN_ENABLED;
    else process.env.AGENT_WEEKLY_CHECKIN_ENABLED = previous;
  }
});
