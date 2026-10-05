'use strict';

/**
 * Does the payment link follow through?
 *
 * 5 Oct 2026, the day the fee started. Walking it end to end found two places
 * where it stopped.
 *
 * The page offers card, Apple Pay and Google Pay only when Revolut is
 * configured, and it is not — so the only live route is MTN Mobile Money, while
 * the approval message promised all of them. An agent was being sent to a page
 * that could not do what the message said.
 *
 * And the "I have paid" button raised a claim in silence. A claim is not money
 * until a human confirms it — matching it to the wallet SMS deliberately does
 * not auto-confirm — so a claim nobody is told about waits in the admin queue
 * until somebody happens to open it. The WhatsApp receipt path has always
 * alerted the team. This one, the button on the payment page, did not.
 */

const test = require('node:test');
const assert = require('node:assert');

const payLinks = require('../services/payLinkService');

// ---------------------------------------------------------------------------
// What the page can actually do
// ---------------------------------------------------------------------------

test('the card option depends on Revolut being configured, not on the setting alone', () => {
  const revolut = require('../services/revolutMerchantService');
  const saved = process.env.REVOLUT_MERCHANT_SECRET_KEY;
  try {
    delete process.env.REVOLUT_MERCHANT_SECRET_KEY;
    assert.strictEqual(revolut.isConfigured(), false,
      'with no key there is no card payment, however card_payments.enabled is set');
  } finally {
    if (saved !== undefined) process.env.REVOLUT_MERCHANT_SECRET_KEY = saved;
  }
});

// ---------------------------------------------------------------------------
// The claim that nobody heard
// ---------------------------------------------------------------------------

function stubbedDb({ link, smsMatch = false }) {
  const claims = [];
  return {
    claims,
    db: {
      query: async (sql, params = []) => {
        if (/FROM pay_links/i.test(sql) && /SELECT/i.test(sql)) return { rows: [link] };
        if (/SELECT id FROM payment_claims/i.test(sql)) return { rows: [] };
        if (/INSERT INTO payment_claims/i.test(sql)) {
          const claim = {
            id: 'claim-1',
            payer_phone: params[0],
            payer_name: params[1],
            agent_id: params[2],
            purpose: params[6],
            reference: params[7],
            amount_ugx: params[8],
            status: 'pending'
          };
          claims.push(claim);
          return { rows: [claim] };
        }
        if (/FROM money_sms_inbox/i.test(sql)) {
          return { rows: smsMatch ? [{ id: 'sms-1', amount_ugx: link.amount_ugx }] : [] };
        }
        if (/UPDATE payment_claims/i.test(sql)) {
          return { rows: [{ ...claims[0], sms_id: 'sms-1' }] };
        }
        return { rows: [] };
      }
    }
  };
}

function captureTeamAlerts(run) {
  const desk = require('../services/leadDeskService');
  const handoff = require('../services/leadHandoffService');
  const billingOps = require('../services/billingOpsService');
  const originals = { send: desk.sendToTeam, recips: desk.alertRecipients, deliver: handoff.deliverWhatsapp, settings: billingOps.getSettings };
  const alerts = [];
  const direct = [];
  desk.sendToTeam = async (_db, body, kind) => { alerts.push({ body, kind }); return true; };
  desk.alertRecipients = () => [];
  handoff.deliverWhatsapp = async ({ to, body }) => { direct.push({ to, body }); return true; };
  billingOps.getSettings = async () => ({ confirmers: [{ phone: '+256709402189' }, { phone: '+447757773202' }] });
  return Promise.resolve(run({ alerts, direct }))
    .finally(() => {
      desk.sendToTeam = originals.send;
      desk.alertRecipients = originals.recips;
      handoff.deliverWhatsapp = originals.deliver;
      billingOps.getSettings = originals.settings;
    });
}

const AGENT_LINK = {
  id: 'link-1',
  code: 'MKTESTAGNT',
  status: 'open',
  purpose: 'agent_subscription',
  agent_id: 'agent-1',
  agent_name: 'Kato Brian',
  amount_ugx: 50000,
  payer_phone: '256772123456',
  payer_name: 'Kato Brian',
  property_id: null,
  st_listing_id: null
};

test('tapping "I have paid" tells the team, and names what is still needed', async () => {
  const { db, claims } = stubbedDb({ link: AGENT_LINK });
  await captureTeamAlerts(async ({ alerts, direct }) => {
    const result = await payLinks.createMomoClaim(db, 'MKTESTAGNT', {
      reference: 'MP251005.1234.A56789',
      phone: '256772123456',
      name: 'Kato Brian'
    });
    assert.ok(result.claim_id, 'the claim is still raised');
    assert.strictEqual(claims.length, 1);

    assert.strictEqual(alerts.length, 1, 'the team has to hear about it');
    assert.strictEqual(alerts[0].kind, 'payment_claim_to_check');
    assert.match(alerts[0].body, /Payment claim to check/);
    assert.match(alerts[0].body, /Kato Brian/);
    assert.match(alerts[0].body, /50,000/, 'how much they say they paid');
    assert.match(alerts[0].body, /MP251005\.1234\.A56789/, 'the transaction ID to check against');
    assert.match(alerts[0].body, /NOT counted until someone confirms/i,
      'a claim is not money, and the message must not let anyone think it is');

    // Ronald and Arthur confirm payments, so they hear even if not on the alert list.
    assert.strictEqual(direct.length, 2, 'both confirmers');
  });
});

test('an unmatched claim says so, so nobody assumes the money arrived', async () => {
  const { db } = stubbedDb({ link: AGENT_LINK, smsMatch: false });
  await captureTeamAlerts(async ({ alerts }) => {
    await payLinks.createMomoClaim(db, 'MKTESTAGNT', { reference: 'MP251005.9999.Z11111' });
    assert.match(alerts[0].body, /No matching wallet SMS yet/);
  });
});

test('a claim matched to the wallet SMS says that too', async () => {
  const { db } = stubbedDb({ link: AGENT_LINK, smsMatch: true });
  await captureTeamAlerts(async ({ alerts }) => {
    await payLinks.createMomoClaim(db, 'MKTESTAGNT', { reference: 'MP251005.1234.A56789' });
    assert.match(alerts[0].body, /matches a wallet SMS/);
  });
});

test('a failed alert never loses the claim', async () => {
  const { db, claims } = stubbedDb({ link: AGENT_LINK });
  const desk = require('../services/leadDeskService');
  const original = desk.sendToTeam;
  desk.sendToTeam = async () => { throw new Error('bridge down'); };
  try {
    const result = await payLinks.createMomoClaim(db, 'MKTESTAGNT', { reference: 'MP251005.1234.A56789' });
    assert.ok(result.claim_id, 'the agent has paid; losing the alert must not lose their claim');
    assert.strictEqual(claims.length, 1);
  } finally {
    desk.sendToTeam = original;
  }
});

test('a transaction ID that is too short is refused before anything is recorded', async () => {
  const { db, claims } = stubbedDb({ link: AGENT_LINK });
  await assert.rejects(
    () => payLinks.createMomoClaim(db, 'MKTESTAGNT', { reference: '12' }),
    /transaction ID/i
  );
  assert.strictEqual(claims.length, 0);
});

test('a link that is already paid cannot be claimed again', async () => {
  const { db } = stubbedDb({ link: { ...AGENT_LINK, status: 'paid' } });
  await assert.rejects(
    () => payLinks.createMomoClaim(db, 'MKTESTAGNT', { reference: 'MP251005.1234.A56789' }),
    /already been paid/i
  );
});
