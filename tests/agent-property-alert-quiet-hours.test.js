'use strict';

/**
 * A property that arrives at night is still announced in the morning.
 *
 * 4 Nov 2026, 02:02 Kampala: Segawa Frederick Kevin (SFK) sent an acre at
 * Ssisa–Buswa with a lake view. The assistant saved it ("your property in
 * Nakawuka is with our team for review") and the team alert was skipped for
 * quiet hours — and never sent afterwards. His two listings of 31 Oct, at
 * 23:12 and 23:28 Kampala, went the same way. Nobody on the team knew any of
 * the three existed until Arthur read the chat on the phone.
 *
 * Quiet hours now hold the alert on the listing; the lead desk's tick sends
 * the overnight ones in a single message once the desk opens, and marks them
 * so each is announced once.
 */

const test = require('node:test');
const assert = require('node:assert');
const db = require('../config/database');
const route = require('../routes/whatsapp').__test;
const desk = require('../services/leadDeskService');

const SFK = { id: 'f1932d42-eddd-4bae-904d-b883600113ee', full_name: 'Segawa Frederick Kevin SFK', phone: '+256752509630', whatsapp: '+256752509630' };
const PROPERTY = 'a051c867-b4a7-40c2-924f-e3d76af41a26';
const CAPTION = 'AN ACRE OF LAND WITH A CLEAR LAKE VIEW ON SALE AT A PRICE OF 220M NEGOTIABLE LOCATED AT SSISA BUSWA';

function withFakeDb(run, { held = [] } = {}) {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    if (/SELECT id, inquiry_reference, created_at, extra_fields->'team_alert_deferred'/i.test(sql)) return { rows: held };
    if (/INSERT INTO outbound_message_queue/i.test(sql)) return { rows: [{ id: 'q-1', status: 'pending' }] };
    if (/INSERT INTO notifications/i.test(sql)) return { rows: [{ id: 'n-1' }] };
    return { rows: [] };
  };
  return Promise.resolve(run(calls)).finally(() => { db.query = originalQuery; });
}

function withQuietHours(value, run) {
  const previous = process.env.LEAD_DESK_QUIET_HOURS;
  process.env.LEAD_DESK_QUIET_HOURS = value;
  return Promise.resolve(run()).finally(() => {
    if (previous === undefined) delete process.env.LEAD_DESK_QUIET_HOURS; else process.env.LEAD_DESK_QUIET_HOURS = previous;
  });
}

test('at night the alert is held on the listing, with its wording and who else should get it', async () => {
  await withQuietHours('0-24', () => withFakeDb(async (calls) => {
    const facts = route.employeePropertyFacts(CAPTION, {});
    const result = await route.sendAgentPropertySubmittedAlert({ agent: SFK, propertyId: PROPERTY, facts, caption: CAPTION });
    assert.deepStrictEqual(result, { deferred: true, propertyId: PROPERTY });
    const hold = calls.find((c) => /team_alert_deferred/.test(c.sql) && /UPDATE properties/i.test(c.sql));
    assert.ok(hold, 'the alert is written onto the listing');
    assert.strictEqual(hold.params[0], PROPERTY);
    assert.match(hold.params[1], /New property from Segawa Frederick Kevin SFK — waiting for review/);
    assert.match(hold.params[1], /Agent: \+256752509630/);
    assert.match(hold.params[1], /Ref A051C867/);
    const extra = JSON.parse(hold.params[2]);
    assert.ok(Array.isArray(extra), 'the on-the-ground contact travels with the held alert');
    assert.ok(!calls.some((c) => /INSERT INTO outbound_message_queue/i.test(c.sql)), 'nothing is sent at night');
  }));
});

test('in the day the alert goes out at once and nothing is held', async () => {
  await withQuietHours('off', () => withFakeDb(async (calls) => {
    const facts = route.employeePropertyFacts(CAPTION, {});
    const result = await route.sendAgentPropertySubmittedAlert({ agent: SFK, propertyId: PROPERTY, facts, caption: CAPTION });
    assert.strictEqual(result.sent, true);
    assert.ok(!calls.some((c) => /team_alert_deferred/.test(c.sql)), 'no hold during the day');
  }));
});

test('once the desk opens, the held listings go out in one message and are marked sent', async () => {
  const held = [
    { id: PROPERTY, inquiry_reference: 'MK-20261103-703C26', created_at: '2026-11-03T23:02:48Z', deferred: { body: '🏠 *New property from Segawa Frederick Kevin SFK — waiting for review*\n🏠 land · for sale\n📍 Nakawuka, Wakiso\n💰 USh 220,000,000\nAgent: +256752509630\nReview: https://makaug.com/admin (Listings › pending)\nRef A051C867', extra_recipients: ['256709402189'], deferred_at: '2026-11-03T23:02:49Z' } },
    { id: '37ce09be-0000-4000-8000-000000000002', inquiry_reference: 'MK-20261031-AAAAAA', created_at: '2026-10-31T20:28:09Z', deferred: { body: '🏠 *New property from Segawa Frederick Kevin SFK — waiting for review*\n🏠 land · for sale\n📍 Ssisa, Wakiso\n💰 USh 65,000,000\nRef 37CE09BE', extra_recipients: [], deferred_at: '2026-10-31T20:28:10Z' } }
  ];
  await withQuietHours('off', () => withFakeDb(async (calls) => {
    const sent = [];
    const send = async (_db, body, type, options) => { sent.push({ body, type, options }); return [{ to: '447757773202', status: 'queued' }]; };
    const result = await desk.sendDeferredPropertyAlerts(db, { send });
    assert.strictEqual(result.sent, 2);
    assert.strictEqual(sent.length, 1, 'one message for the whole night');
    assert.strictEqual(sent[0].type, 'agent_property_submitted_overnight');
    assert.match(sent[0].body, /^🌙 \*Overnight: 2 properties from agents came in while the desk was closed — waiting for review\*/);
    assert.match(sent[0].body, /1\. \*Segawa Frederick Kevin SFK\*\n🏠 land · for sale\n📍 Nakawuka, Wakiso/);
    assert.match(sent[0].body, /2\. \*Segawa Frederick Kevin SFK\*\n🏠 land · for sale\n📍 Ssisa, Wakiso/);
    assert.deepStrictEqual(sent[0].options.extraRecipients, ['256709402189'], 'Ronald is on it, once');
    const mark = calls.find((c) => /team_alert_deferred,sent_at/.test(c.sql));
    assert.ok(mark, 'the listings are marked so they are not announced twice');
    assert.deepStrictEqual(mark.params[0], held.map((row) => row.id));
  }, { held }));
});

test('the round-up waits for the desk to open and does nothing when nothing is held', async () => {
  await withQuietHours('0-24', () => withFakeDb(async () => {
    assert.deepStrictEqual(await desk.sendDeferredPropertyAlerts(db), { skipped: 'quiet_hours' });
  }));
  await withQuietHours('off', () => withFakeDb(async (calls) => {
    assert.deepStrictEqual(await desk.sendDeferredPropertyAlerts(db), { sent: 0 });
    assert.ok(!calls.some((c) => /INSERT INTO outbound_message_queue/i.test(c.sql)));
  }));
});
