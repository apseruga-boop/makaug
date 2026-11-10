"use strict";
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');

// The free-trial digest must reach the payment confirmers (Sales & Revenue ›
// Settings) as well as the lead-desk alert numbers, each number once.

function loadBillingWithFakeDesk(sent) {
  const deskPath = require.resolve('../services/leadDeskService');
  const billingPath = require.resolve('../services/billingOpsService');
  delete require.cache[deskPath];
  delete require.cache[billingPath];
  const realDesk = require('../services/leadDeskService');
  require.cache[deskPath].exports = {
    ...realDesk,
    sendToTeam: async (db, body, type, opts = {}) => {
      const recipients = realDesk.teamRecipients(opts.extraRecipients || []);
      sent.push({ body, type, recipients });
      return recipients.map((to) => ({ to, status: 'queued' }));
    }
  };
  return require('../services/billingOpsService');
}

function fakeDb({ confirmers, trials }) {
  return {
    async query(sql) {
      if (/FROM billing_settings/.test(sql)) return { rows: [{ key: 'confirmers', value: confirmers }] };
      if (/FROM notifications/.test(sql)) return { rowCount: 0, rows: [] };
      if (/INSERT INTO billing_settings/.test(sql)) return { rowCount: 1, rows: [{ key: 'x' }] };
      if (/FROM agents/.test(sql)) return { rows: trials };
      return { rows: [] };
    }
  };
}

test('the digest goes to the lead-desk alert numbers and the payment confirmers, each once', async (t) => {
  const prev = process.env.LEAD_DESK_ALERT_WHATSAPP;
  process.env.LEAD_DESK_ALERT_WHATSAPP = '+447757773202';
  t.after(() => { if (prev === undefined) delete process.env.LEAD_DESK_ALERT_WHATSAPP; else process.env.LEAD_DESK_ALERT_WHATSAPP = prev; });
  const sent = [];
  const billing = loadBillingWithFakeDesk(sent);
  const db = fakeDb({
    confirmers: [{ name: 'Ronald', phone: '0709402189' }, { name: 'Arthur', phone: '+44 7757 773202' }, { name: 'bad', phone: '12' }],
    trials: [{ id: 'a1', full_name: 'Kelham properties', phone: '0706945653', whatsapp: '0706945653', status: 'approved', paid_until: null, fee_exempt: false, fee_offer_mode: 'free_period',
      fee_offer_until: new Date(Date.now() + 86400000).toISOString(), fee_offer_at: new Date(Date.now() - 13 * 86400000).toISOString(), fee_offer_by: 'Ronald', billing_suspended_at: null, billing_reminder_log: [] }]
  });
  const phones = await billing.trialDigestTeamPhones(db);
  assert.deepStrictEqual(phones, ['0709402189', '+44 7757 773202'], 'confirmers with a usable number');
  const result = await billing.runTrialDigest(db, { force: true });
  assert.equal(result.sent, true, JSON.stringify(result));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'agent_trial_follow_up');
  assert.match(sent[0].body, /New agents — payment follow-ups/);
  assert.match(sent[0].body, /Trial ending in the next few days/, 'an agent still on a trial from before 10 Nov 2026 is still followed up');
  assert.deepStrictEqual(sent[0].recipients, ['+447757773202', '0709402189'], 'Arthur once (same number in both lists), Ronald added');
  assert.deepStrictEqual(result.recipients, ['+447757773202', '0709402189']);
  const desk = require('../services/leadDeskService');
  assert.deepStrictEqual(desk.teamRecipients(['0709402189', '+256 709 402189', '12']), ['+447757773202', '0709402189']);
});
