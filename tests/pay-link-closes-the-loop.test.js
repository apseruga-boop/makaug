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
 *
 * 10 Nov 2026: payments go to the MoMo merchant code, which asks for no
 * reference. The button now asks for their business name and the number they
 * paid from; the transaction ID is optional. The people who confirm (Ronald
 * and Arthur) hear each claim directly, with a one-tap confirm once the
 * merchant line's SMS shows the money.
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
          // Read the columns and VALUES so the stub follows the statement.
          const cols = sql.match(/INSERT INTO payment_claims \(([^)]+)\)/i)[1].split(',').map((c) => c.trim());
          const values = sql.match(/VALUES \(([\s\S]+)\) RETURNING/i)[1].split(',').map((v) => v.trim());
          const claim = { id: 'claim-1', status: 'pending' };
          cols.forEach((col, i) => {
            const v = values[i] || '';
            const n = v.match(/^\$(\d+)/);
            claim[col] = n ? params[Number(n[1]) - 1] : v.replace(/^'|'$/g, '');
          });
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
  handoff.deliverWhatsapp = async ({ to, body, kind }) => { direct.push({ to, body, kind }); return { status: 'queued' }; };
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

test('tapping "I have paid" tells Ronald and Arthur, and names what is still needed', async () => {
  const { db, claims } = stubbedDb({ link: AGENT_LINK });
  await captureTeamAlerts(async ({ direct }) => {
    const result = await payLinks.createMomoClaim(db, 'MKTESTAGNT', {
      reference: 'MP251005.1234.A56789',
      phone: '256772123456',
      name: 'Kato Brian'
    });
    assert.ok(result.claim_id, 'the claim is still raised');
    assert.strictEqual(claims.length, 1);

    // Ronald and Arthur confirm payments, so they hear it, each on their own.
    assert.strictEqual(direct.length, 2, 'both confirmers');
    assert.deepStrictEqual(direct.map((d) => d.to).sort(), ['256709402189', '447757773202']);
    for (const alert of direct) {
      assert.strictEqual(alert.kind, 'payment_claim_to_check');
      assert.match(alert.body, /Payment claim to check/);
      assert.match(alert.body, /Kato Brian/);
      assert.match(alert.body, /50,000/, 'how much they say they paid');
      assert.match(alert.body, /MP251005\.1234\.A56789/, 'the transaction ID to check against');
      assert.match(alert.body, /NOT counted until someone confirms/i,
        'a claim is not money, and the message must not let anyone think it is');
    }
  });
});

test('an unmatched claim says so, so nobody assumes the money arrived', async () => {
  const { db } = stubbedDb({ link: AGENT_LINK, smsMatch: false });
  await captureTeamAlerts(async ({ direct }) => {
    await payLinks.createMomoClaim(db, 'MKTESTAGNT', { reference: 'MP251005.9999.Z11111' });
    assert.match(direct[0].body, /No matching wallet SMS yet/);
  });
});

test('a claim matched to the wallet SMS says that too', async () => {
  const { db } = stubbedDb({ link: AGENT_LINK, smsMatch: true });
  await captureTeamAlerts(async ({ direct }) => {
    await payLinks.createMomoClaim(db, 'MKTESTAGNT', { reference: 'MP251005.1234.A56789' });
    assert.match(direct[0].body, /matches a wallet SMS/);
  });
});

test('a failed alert never loses the claim', async () => {
  const { db, claims } = stubbedDb({ link: AGENT_LINK });
  const handoff = require('../services/leadHandoffService');
  const billingOps = require('../services/billingOpsService');
  const original = { deliver: handoff.deliverWhatsapp, settings: billingOps.getSettings };
  handoff.deliverWhatsapp = async () => { throw new Error('bridge down'); };
  billingOps.getSettings = async () => ({ confirmers: [{ phone: '+256709402189' }] });
  try {
    const result = await payLinks.createMomoClaim(db, 'MKTESTAGNT', { reference: 'MP251005.1234.A56789' });
    assert.ok(result.claim_id, 'the agent has paid; losing the alert must not lose their claim');
    assert.strictEqual(claims.length, 1);
  } finally {
    handoff.deliverWhatsapp = original.deliver;
    billingOps.getSettings = original.settings;
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

test('no reference needed: their business name and the number they paid from are enough', async () => {
  const { db, claims } = stubbedDb({ link: AGENT_LINK });
  await captureTeamAlerts(async ({ direct }) => {
    const result = await payLinks.createMomoClaim(db, 'MKTESTAGNT', { businessName: 'Kato Homes', phone: '0772 123 456' });
    assert.ok(result.claim_id);
    assert.strictEqual(claims[0].business_name, 'Kato Homes');
    assert.strictEqual(claims[0].paid_from_phone, '0772123456');
    assert.strictEqual(claims[0].reference, null, 'no transaction ID was given, and none is invented');
    assert.strictEqual(claims[0].method, 'mtn_momopay');
    assert.match(direct[0].body, /Kato Brian \(Kato Homes\)/);
    assert.match(direct[0].body, /Transaction ID: not given — we match it by their number and name/);
  });
});

test('with neither a business name nor a transaction ID, nothing is recorded', async () => {
  const { db, claims } = stubbedDb({ link: AGENT_LINK });
  await assert.rejects(() => payLinks.createMomoClaim(db, 'MKTESTAGNT', { phone: '0772123456' }), /business name/i);
  assert.strictEqual(claims.length, 0);
});

test('a link that is already paid cannot be claimed again', async () => {
  const { db } = stubbedDb({ link: { ...AGENT_LINK, status: 'paid' } });
  await assert.rejects(
    () => payLinks.createMomoClaim(db, 'MKTESTAGNT', { reference: 'MP251005.1234.A56789' }),
    /already been paid/i
  );
});
