'use strict';

/**
 * Agent property alerts give the listing's own reference and a direct link,
 * and a property for sale is never priced per month (23 Nov 2026).
 *
 * At 04:59 UK the team got "New property from <agent> — waiting for review
 * ... UGX 410,000,000 a month ... Review: https://makaug.com/admin (Listings ›
 * pending) ... Ref 7A8DF970". Arthur could not find it: the Ref was the first
 * characters of the internal id, the link opened the general pending list,
 * and Moderator 1 had already approved it as MK-20261123-10C0EB, after
 * setting the "a month" sale back to a one-off price by hand.
 *
 * Every name and number here is made up.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const db = require('../config/database');
const route = require('../routes/whatsapp').__test;
const desk = require('../services/leadDeskService');

const AGENT = { id: '00000000-0000-4000-8000-0000000000a1', full_name: 'Agent One', phone: '+256700000111', whatsapp: '+256700000111' };
const PROPERTY = '7a8df970-0000-4000-8000-000000000001';
const KITENDE = 'COMMERCIAL BUILDING ON SALE AT A PRICE OF 410M NEGOTIABLE SEATED ON 8 DECIMALS LAND SIZE WITH A PRIVATE MAILO LAND TITLE LOCATED AT KITENDE ALONG ENTEBBE ROAD TARMAC MAKING 2.7M PER MONTH';

function withFakeDb(run, { reference = 'MK-20261123-10C0EB' } = {}) {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    if (/SELECT inquiry_reference FROM properties WHERE id = \$1/i.test(sql)) return { rows: reference ? [{ inquiry_reference: reference }] : [] };
    if (/INSERT INTO outbound_message_queue/i.test(sql)) return { rows: [{ id: 'q-1', status: 'pending' }] };
    if (/INSERT INTO notifications/i.test(sql)) return { rows: [{ id: 'n-1' }] };
    return { rows: [] };
  };
  return Promise.resolve(run(calls)).finally(() => { db.query = originalQuery; });
}

function withQuietHours(value, run) {
  const previous = process.env.LEAD_DESK_QUIET_HOURS;
  const previousTeam = process.env.LEAD_DESK_ALERT_WHATSAPP;
  process.env.LEAD_DESK_QUIET_HOURS = value;
  process.env.LEAD_DESK_ALERT_WHATSAPP = '+256700000999';
  return Promise.resolve(run()).finally(() => {
    if (previous === undefined) delete process.env.LEAD_DESK_QUIET_HOURS; else process.env.LEAD_DESK_QUIET_HOURS = previous;
    if (previousTeam === undefined) delete process.env.LEAD_DESK_ALERT_WHATSAPP; else process.env.LEAD_DESK_ALERT_WHATSAPP = previousTeam;
  });
}

test('the brief: a building for sale that earns rent each month is for sale, at a one-off price', () => {
  for (const caption of [KITENDE, 'Commercial building for sale Kitende 8 decimals 410M, earns 2.7M monthly']) {
    const facts = route.employeePropertyFacts(caption, {});
    // Commercial stays commercial, the category moderators pick for it
    // (whatsapp-agent-self-intake.test.js); it is now for sale, priced once.
    assert.strictEqual(facts.listingType, 'commercial', caption);
    assert.strictEqual(facts.pricePeriod, 'once', caption);
    assert.strictEqual(Number(facts.price), 410000000, caption);
    const lines = route.agentPropertyDetailLines(facts, caption).join('\n');
    assert.match(lines, /for sale/);
    assert.match(lines, /UGX 410,000,000/);
    assert.doesNotMatch(lines, /a month/, 'no "a month" on a sale');
  }
});

test('rent stays rent: per month, to let and rent still mean a monthly price', () => {
  const cases = [
    ['Shop for rent in Ntinda 1.5M per month', 'commercial', 'month'],
    ['Commercial space to let in Kololo, 6M a month', 'commercial', 'month'],
    ['Office space Nakasero 4M per month', 'commercial', 'month'],
    ['5 bedroom house for rent in Kololo 8M per month', 'rent', 'month']
  ];
  for (const [caption, type, period] of cases) {
    const facts = route.employeePropertyFacts(caption, {});
    assert.strictEqual(facts.listingType, type, caption);
    assert.strictEqual(facts.pricePeriod, period, caption);
    assert.match(route.agentPropertyDetailLines(facts, caption).join('\n'), /a month/, caption);
  }
});

test('sale signals: a title type, a price of 50M or more, a plot stays land, both words keep the sale price one-off', () => {
  const warehouse = route.employeePropertyFacts('Warehouse for sale Namanve 2.5bn freehold title', {});
  assert.deepStrictEqual([warehouse.listingType, warehouse.pricePeriod], ['commercial', 'once']);
  const noWords = route.employeePropertyFacts('Commercial building Kitende 410M', {});
  assert.deepStrictEqual([noWords.listingType, noWords.pricePeriod], ['commercial', 'once']);
  const rentals = route.employeePropertyFacts('Rentals for sale Location Nabweru lugoba 5 single rentals self-contained Income 1.3m Price 83m', {});
  assert.deepStrictEqual([rentals.listingType, rentals.pricePeriod], ['sale', 'once']);
  const plot = route.employeePropertyFacts('50 decimals plot Mbalwa namugongo road UGX 600 million', {});
  assert.deepStrictEqual([plot.listingType, plot.pricePeriod], ['land', 'once']);
  const both = route.employeePropertyFacts('Office block in Kololo for sale or rent, 2.5bn or 30M a month', {});
  assert.strictEqual(both.pricePeriod, 'once', 'the 2.5bn read is the sale price');
  assert.match(route.agentPropertyDetailLines(both, 'Office block in Kololo for sale or rent, 2.5bn or 30M a month').join('\n'), /for sale or rent/);
});

test('the alert gives the MK reference and a link straight to the listing in the review screen', async () => {
  // The body is the same by day and by night; at night it is written onto the
  // listing, where the test can read it.
  await withQuietHours('0-24', () => withFakeDb(async (calls) => {
    const facts = route.employeePropertyFacts(KITENDE, {});
    const result = await route.sendAgentPropertySubmittedAlert({ agent: AGENT, propertyId: PROPERTY, facts, caption: KITENDE });
    assert.deepStrictEqual(result, { deferred: true, propertyId: PROPERTY });
    const body = calls.find((c) => /team_alert_deferred/.test(c.sql) && /UPDATE properties/i.test(c.sql)).params[1];
    assert.match(body, /^Ref MK-20261123-10C0EB$/m);
    assert.match(body, new RegExp(`^Review: https?://\\S+/staff-dashboard/review/${PROPERTY}$`, 'm'));
    assert.doesNotMatch(body, /Listings › pending/);
    assert.doesNotMatch(body, /Ref 7A8DF970/);
    assert.doesNotMatch(body, /a month/);
    assert.match(body, /commercial property · for sale/);
    assert.match(body, /UGX 410,000,000/);
  }));
  await withQuietHours('off', () => withFakeDb(async () => {
    const facts = route.employeePropertyFacts(KITENDE, {});
    const result = await route.sendAgentPropertySubmittedAlert({ agent: AGENT, propertyId: PROPERTY, facts, caption: KITENDE });
    assert.strictEqual(result.sent, true, 'by day it goes at once');
  }));
});

test('with no reference on the listing yet, the short Ref stays and the link still opens it', async () => {
  await withQuietHours('0-24', () => withFakeDb(async (calls) => {
    const facts = route.employeePropertyFacts(KITENDE, {});
    await route.sendAgentPropertySubmittedAlert({ agent: AGENT, propertyId: PROPERTY, facts, caption: KITENDE });
    const hold = calls.find((c) => /team_alert_deferred/.test(c.sql) && /UPDATE properties/i.test(c.sql));
    assert.ok(hold, 'held at night');
    assert.match(hold.params[1], /Ref 7A8DF970/);
    assert.match(hold.params[1], new RegExp(`Review: .*/staff-dashboard/review/${PROPERTY}`));
  }, { reference: '' }));
});

test('the overnight round-up puts held alerts right: the MK reference and the direct link, old ones too', async () => {
  const oldBody = '🏠 *New property from Agent One — waiting for review*\n🏠 land · for sale\n📍 Nakawuka, Wakiso\n💰 USh 220,000,000\nAgent: +256700000111\nReview: https://makaug.com/admin (Listings › pending)\nRef 7A8DF970';
  const row = { id: PROPERTY, inquiry_reference: 'MK-20261123-10C0EB', source: 'property' };
  const fixed = desk.withListingLinks(oldBody, row);
  assert.match(fixed, /^Ref MK-20261123-10C0EB$/m);
  assert.match(fixed, new RegExp(`^Review: https?://\\S+/staff-dashboard/review/${PROPERTY}$`, 'm'));
  assert.doesNotMatch(fixed, /Listings › pending|Ref 7A8DF970/);
  assert.strictEqual(desk.withListingLinks(oldBody, { ...row, source: 'conversation' }), oldBody, 'a held chat is not a listing');

  const sent = [];
  const fakeDb = {
    async query(sql) {
      if (/FROM properties/i.test(sql) && /team_alert_deferred/i.test(sql) && /SELECT/i.test(sql)) {
        return { rows: [{ id: PROPERTY, inquiry_reference: 'MK-20261123-10C0EB', created_at: '2026-11-23T01:59:00Z', deferred: { body: oldBody, extra_recipients: [], deferred_at: '2026-11-23T01:59:01Z', kind: 'submitted' } }] };
      }
      return { rows: [] };
    }
  };
  await withQuietHours('off', () => desk.sendDeferredPropertyAlerts(fakeDb, { send: async (_db, body) => { sent.push(body); return [{ status: 'queued' }]; } }));
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0], /Ref MK-20261123-10C0EB/);
  assert.match(sent[0], new RegExp(`/staff-dashboard/review/${PROPERTY}`));
});
