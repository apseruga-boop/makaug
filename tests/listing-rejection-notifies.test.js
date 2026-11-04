'use strict';

/**
 * A rejected listing is no longer a silent one.
 *
 * 2 Nov 2026: a moderator rejected Segawa Frederick Kevin's two plots of
 * 31 Oct (25 decimals at Ssisa–Buswa, 40 acres at Mpangalo) for "No clear
 * photos". The dashboard built a WhatsApp for the moderator to send by hand;
 * nobody sent it, nobody on the team heard, and from the agent's side the
 * properties simply vanished. Now the lister is messaged with the typed
 * reason, the same way an approval is, and the team is alerted — at once in
 * the day, in the morning round-up at night.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../config/database');
const desk = require('../services/leadDeskService');
const { buildOwnerStatusMessage } = require('../services/listingModerationService');

const SFK_PLOT = {
  id: '37ce09be-0000-4000-8000-000000000002',
  inquiry_reference: 'MK-20261031-C08F2A',
  title: 'Land for sale in Ssisa',
  area: 'Ssisa',
  district: 'Wakiso',
  price: 65000000,
  listing_type: 'sale',
  property_type: 'land',
  lister_name: 'Segawa Frederick Kevin SFK',
  lister_phone: '+256752509630',
  agent_id: 'f1932d42-eddd-4bae-904d-b883600113ee'
};

function withQuietHours(value, run) {
  const previous = process.env.LEAD_DESK_QUIET_HOURS;
  process.env.LEAD_DESK_QUIET_HOURS = value;
  return Promise.resolve(run()).finally(() => {
    if (previous === undefined) delete process.env.LEAD_DESK_QUIET_HOURS; else process.env.LEAD_DESK_QUIET_HOURS = previous;
  });
}

// The alert numbers, and the test transport so a send is simulated rather than
// refused for want of a WhatsApp provider.
function withAlertRecipients(value, run) {
  const previous = { LEAD_DESK_ALERT_WHATSAPP: process.env.LEAD_DESK_ALERT_WHATSAPP, WHATSAPP_DELIVERY_MODE: process.env.WHATSAPP_DELIVERY_MODE };
  process.env.LEAD_DESK_ALERT_WHATSAPP = value;
  process.env.WHATSAPP_DELIVERY_MODE = 'test';
  return Promise.resolve(run()).finally(() => {
    for (const [key, old] of Object.entries(previous)) {
      if (old === undefined) delete process.env[key]; else process.env[key] = old;
    }
  });
}

function withFakeDb(run) {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    if (/INSERT INTO outbound_message_queue/i.test(sql)) return { rows: [{ id: 'q-1', status: 'pending' }] };
    if (/INSERT INTO notifications/i.test(sql)) return { rows: [{ id: 'n-1' }] };
    return { rows: [] };
  };
  return Promise.resolve(run(calls)).finally(() => { db.query = originalQuery; });
}

test('the agent is told what was wrong and that sending it again is all it takes', () => {
  const message = buildOwnerStatusMessage({ listing: SFK_PLOT, status: 'rejected', reason: 'No clear photos' });
  assert.match(message.whatsapp, /^We couldn't put this one up yet\./);
  assert.match(message.whatsapp, /Land for sale in Ssisa/);
  assert.match(message.whatsapp, /Ref MK-20261031-C08F2A/);
  assert.match(message.whatsapp, /Why: No clear photos/);
  assert.match(message.whatsapp, /send the property here again — I will put it up/);
  assert.match(message.whatsapp, /reply here and a person will look at it/);
  assert.doesNotMatch(message.whatsapp, /rejected during review/, 'no more curt system wording');
  assert.match(message.subject, /We couldn't approve your listing yet/);
  assert.match(message.text, /Why: No clear photos/);
});

test('a private owner gets the same, in their own register, with a fallback reason', () => {
  const owner = { ...SFK_PLOT, agent_id: null, lister_name: 'Grace' };
  const message = buildOwnerStatusMessage({ listing: owner, status: 'rejected', reason: '' });
  assert.match(message.whatsapp, /^Hi Grace, we couldn't approve your makaug listing yet\./);
  assert.match(message.whatsapp, /Why: it did not pass our checks/);
  assert.match(message.whatsapp, /resend it from this number/);
});

test('the status route sends a rejection after the response, like an approval, and tells the team', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'properties.js'), 'utf8');
  assert.doesNotMatch(source, /leaveToAHuman/, 'nothing is left to a human to send');
  const followUp = source.slice(source.indexOf('const deliverDeferredDecisionWork'), source.indexOf('clearModerationDecisionCaches(`listing_status_'));
  assert.match(followUp, /sendOwnerListingStatusNotifications\(/, 'the lister message goes from the follow-up');
  assert.match(followUp, /nextStatus === 'rejected' && current\.status !== 'rejected'/, 'the team alert is for a fresh rejection');
  assert.match(followUp, /desk\.alertTeamListingRejected\(db, \{/);
  assert.match(followUp, /listerNotified: !!\(notification\.whatsapp\?\.sent \|\| notification\.email\?\.sent\)/);
  assert.match(followUp, /rejectedByAdmin = \['admin', 'super_admin'\]\.includes\(actorRole\)/, 'Arthur is not alerted about his own decisions');
});

test('the team alert names the moderator, the listing, the reason and whether the lister heard', () => {
  const body = desk.listingRejectedAlertBody({ listing: SFK_PLOT, reason: 'No clear photos', actorLabel: 'Fisher', listerNotified: true });
  assert.match(body, /^⛔ \*Listing rejected by Fisher\*\nLand for sale in Ssisa\n📍 Ssisa, Wakiso · UGX 65m\nLister: Segawa Frederick Kevin SFK \+256752509630 \(agent\)\nReason: No clear photos\nThe lister has been told by WhatsApp\.\nMK-20261031-C08F2A · https:\/\/makaug\.com\/admin \(Listings › actioned\)$/);
  const unsent = desk.listingRejectedAlertBody({ listing: { ...SFK_PLOT, lister_phone: '' }, reason: 'Duplicate', actorLabel: '', listerNotified: false });
  assert.match(unsent, /rejected by staff\*/);
  assert.match(unsent, /no WhatsApp number on file/);
});

test('in the day the rejection alert goes to the alert numbers at once; at night it is held for the round-up', async () => {
  await withAlertRecipients('256700000001', () => withQuietHours('off', () => withFakeDb(async (calls) => {
    const result = await desk.alertTeamListingRejected(db, { listing: SFK_PLOT, reason: 'No clear photos', actorLabel: 'Fisher', listerNotified: true });
    assert.strictEqual(result.sent, true);
    assert.deepStrictEqual(result.results.map((r) => r.to), ['256700000001'], 'to Arthur, once');
    assert.ok(['queued', 'sent', 'simulated'].includes(result.results[0].status), `delivered: ${result.results[0].status}`);
    assert.ok(!calls.some((c) => /team_alert_deferred/.test(c.sql)), 'nothing held');
  })));
  await withAlertRecipients('256700000001', () => withQuietHours('0-24', () => withFakeDb(async (calls) => {
    const result = await desk.alertTeamListingRejected(db, { listing: SFK_PLOT, reason: 'No clear photos', actorLabel: 'Fisher', listerNotified: false });
    assert.deepStrictEqual(result, { deferred: true, propertyId: SFK_PLOT.id });
    const hold = calls.find((c) => /team_alert_deferred/.test(c.sql) && /UPDATE properties/i.test(c.sql));
    assert.ok(hold, 'held on the listing');
    assert.strictEqual(hold.params[0], SFK_PLOT.id);
    assert.match(hold.params[1], /^⛔ \*Listing rejected by Fisher\*/);
    assert.strictEqual(hold.params[3], 'rejected');
    assert.ok(!calls.some((c) => /INSERT INTO outbound_message_queue/i.test(c.sql)), 'nothing sent at night');
  })));
  await withAlertRecipients('', () => withQuietHours('off', () => withFakeDb(async () => {
    assert.deepStrictEqual(await desk.alertTeamListingRejected(db, { listing: SFK_PLOT, reason: 'x' }), { skipped: 'no_recipients' });
  })));
});

test('the morning round-up keeps new properties and rejections apart in its header', async () => {
  const held = [
    { id: 'a051c867-b4a7-40c2-924f-e3d76af41a26', created_at: '2026-11-03T23:02:48Z', deferred: { kind: 'submitted', body: '🏠 *New property from Segawa Frederick Kevin SFK — waiting for review*\n🏠 land · for sale\n📍 Nakawuka, Wakiso', extra_recipients: [] } },
    { id: SFK_PLOT.id, created_at: '2026-10-31T20:28:09Z', deferred: { kind: 'rejected', body: '⛔ *Listing rejected by Fisher*\nLand for sale in Ssisa\nReason: No clear photos', extra_recipients: [] } }
  ];
  const originalQuery = db.query;
  db.query = async (sql) => (/team_alert_deferred'/.test(sql) && /SELECT/i.test(sql) ? { rows: held } : { rows: [] });
  try {
    await withAlertRecipients('256700000001', () => withQuietHours('off', async () => {
      const sent = [];
      const send = async (_db, body) => { sent.push(body); return [{ to: '256700000001', status: 'queued' }]; };
      const result = await desk.sendDeferredPropertyAlerts(db, { send });
      assert.strictEqual(result.sent, 2);
      assert.match(sent[0], /^🌙 \*Overnight while the desk was closed: 1 property from agents waiting for review, 1 listing was rejected\*/);
      assert.match(sent[0], /1\. \*Segawa Frederick Kevin SFK\*\n🏠 land · for sale/);
      assert.match(sent[0], /2\. \*Rejected by Fisher\*\nLand for sale in Ssisa\nReason: No clear photos/);
      const onlyRejected = [];
      db.query = async (sql) => (/team_alert_deferred'/.test(sql) && /SELECT/i.test(sql) ? { rows: [held[1]] } : { rows: [] });
      await desk.sendDeferredPropertyAlerts(db, { send: async (_db, body) => { onlyRejected.push(body); return [{ to: 'x', status: 'queued' }]; } });
      assert.match(onlyRejected[0], /^🌙 \*Overnight: 1 listing was rejected while the desk was closed\*\n\n\*Rejected by Fisher\*/);
    }));
  } finally {
    db.query = originalQuery;
  }
});
