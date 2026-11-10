'use strict';

/**
 * 10 Nov 2026 (Arthur): the 14 free days for new agents and the 7 free days
 * for private owners are gone. Pricing and billing dates came first (#702);
 * this covers what people are told and sent on WhatsApp: the two explainer
 * films, the menu, the terms reply, the payment link in "your listing is live",
 * the day-3 nudge for a listing that has not been paid for, and the agent terms.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const billing = require('../services/billingOpsService');
const docs = require('../services/listingDocsService');
const moderation = require('../services/listingModerationService');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('the day-3 views message is the payment nudge for an unpaid listing with no free week', () => {
  assert.strictEqual(billing.wantsViewsMessage({ billing_state: 'free_week' }), true);
  assert.strictEqual(billing.wantsViewsMessage({ billing_state: 'due', free_days: 0, lister_paid_until: null }), true);
  assert.strictEqual(billing.wantsViewsMessage({ billing_state: 'due', free_days: 7, lister_paid_until: null }), false, 'an old free week that ended gets the reminder instead');
  assert.strictEqual(billing.wantsViewsMessage({ billing_state: 'due', free_days: 0, lister_paid_until: '2026-11-01' }), false, 'a lapsed paid month gets the reminder');
  assert.strictEqual(billing.wantsViewsMessage({ billing_state: 'due', free_days: 0, lister_billing_log: { views: { at: 'x' } } }), false, 'once');
  assert.strictEqual(billing.wantsViewsMessage({ billing_state: 'paid', free_days: 0 }), false);
});

test('the private-listing rows carry each listing\'s free days', async () => {
  const rows = [
    { id: 'p1', title: 'New listing', created_at: new Date().toISOString(), reviewed_at: new Date().toISOString(), lister_paid_until: null },
    { id: 'p2', title: 'Old free week', created_at: '2026-11-01T08:00:00Z', reviewed_at: '2026-11-01T09:00:00Z', lister_paid_until: null }
  ];
  const db = { async query(sql) {
    if (/FROM billing_settings/.test(sql)) return { rows: [{ key: 'lister_fee', value: { free_days: 0, start_date: '2026-10-05', monthly_ugx: 20000 } }] };
    if (/FROM properties/.test(sql)) return { rows };
    return { rows: [] };
  } };
  const out = await billing.listerBillingRows(db);
  const fresh = out.find((r) => r.id === 'p1');
  const old = out.find((r) => r.id === 'p2');
  assert.strictEqual(fresh.free_days, 0);
  assert.strictEqual(fresh.billing_state, 'due', 'owes from the day it went live');
  assert.strictEqual(billing.wantsViewsMessage(fresh), true);
  assert.strictEqual(old.free_days, 7, 'live before 10 Nov 2026: the free week it was offered');
  assert.strictEqual(billing.wantsViewsMessage(old), false);
});

test('the scheduler leaves a never-paid listing with no free week to the views message, not a next-day reminder', () => {
  const src = read('services/billingOpsService.js');
  assert.match(src, /if \(Number\(p\.free_days\) === 0 && !p\.lister_paid_until\) continue;/);
  assert.match(src, /if \(!wantsViewsMessage\(p\)\) continue;/);
});

test('"your listing is live" carries the fee and the payment link; an old free week is still told', () => {
  const listing = { id: 'p1', title: '2 bedroom house', lister_name: 'Mary', lister_phone: '256772000001', price: 1200000, area: 'Ntinda', district: 'Kampala', inquiry_reference: 'MK-20261113-ABC123', reviewed_at: new Date().toISOString(), extra_fields: {} };
  const live = moderation.buildOwnerStatusMessage({
    listing, status: 'approved',
    listerFee: { free_days: 0, monthly_ugx: 20000, pay_link: 'https://makaug.com/pay/MKABC', pay_to: 'MTN Mobile Money *0780863394* (MAKAUG ONLINE REAL ESTATE LTD)' }
  }).whatsapp;
  assert.match(live, /To keep it live it is \*UGX 20,000 a month\*/);
  assert.match(live, /Pay here: https:\/\/makaug\.com\/pay\/MKABC/);
  assert.match(live, /Or pay to MTN Mobile Money \*0780863394\*/);
  assert.match(live, /Nothing is charged automatically/);
  assert.ok(!/free/i.test(live));
  const legacy = moderation.buildOwnerStatusMessage({
    listing: { ...listing, reviewed_at: '2026-11-08T09:00:00Z', extra_fields: { lister_terms_accepted_at: '2026-11-08T08:00:00Z', lister_fee_terms: { free_days: 7, monthly_ugx: 20000 } } },
    status: 'approved'
  }).whatsapp;
  assert.match(legacy, /Free until \*.*\* \(7 days\)/);
  const agentListing = moderation.buildOwnerStatusMessage({ listing: { ...listing, agent_id: 'a1' }, status: 'approved', listerFee: { free_days: 0, monthly_ugx: 20000 } }).whatsapp;
  assert.ok(!/UGX 20,000 a month/.test(agentListing), 'an agent pays the plan, not per listing');
});

test('approving a private listing makes its payment link; old free weeks, paid listings, agents and South Africa are left alone', async (t) => {
  const db = require('../config/database');
  const original = db.query;
  let paidUntil = null;
  const created = [];
  db.query = async (sql) => {
    if (/FROM billing_settings/.test(sql)) {
      return { rows: [
        { key: 'lister_fee', value: { free_days: 0, monthly_ugx: 20000 } },
        { key: 'pay_to', value: { method: 'MTN Mobile Money', number: '0780863394', name: 'MAKAUG ONLINE REAL ESTATE LTD' } }
      ] };
    }
    if (/SELECT lister_paid_until FROM properties/.test(sql)) return { rows: [{ lister_paid_until: paidUntil }] };
    if (/FROM properties WHERE id/.test(sql)) return { rows: [{ id: 'p1', title: '2 bedroom house', lister_name: 'Mary', lister_phone: '256772000001', agent_id: null, found_online: false }] };
    if (/INSERT INTO pay_links/.test(sql)) { created.push(sql); return { rows: [{ code: 'MKTEST01', amount_ugx: 20000 }] }; }
    return { rows: [] };
  };
  const country = process.env.COUNTRY_CODE;
  t.after(() => { db.query = original; if (country === undefined) delete process.env.COUNTRY_CODE; else process.env.COUNTRY_CODE = country; });
  delete process.env.COUNTRY_CODE;

  const now = new Date().toISOString();
  const base = { id: '00000000-0000-4000-8000-000000000009', title: '2 bedroom house', lister_name: 'Mary', lister_phone: '256772000001', created_at: now, reviewed_at: now, extra_fields: {} };
  const fee = await moderation.approvalListerFee(base);
  assert.deepStrictEqual(fee, { free_days: 0, monthly_ugx: 20000, pay_link: 'https://makaug.com/pay/MKTEST01', pay_to: 'MTN Mobile Money *0780863394* (MAKAUG ONLINE REAL ESTATE LTD)' });
  assert.strictEqual(created.length, 1);
  const before = { ...base, created_at: '2026-11-08T08:00:00Z', reviewed_at: '2026-11-08T09:00:00Z' };
  assert.strictEqual(await moderation.approvalListerFee(before), null, 'live before 10 Nov without WhatsApp terms: told nothing, as before');
  assert.deepStrictEqual(await moderation.approvalListerFee({ ...before, extra_fields: { lister_terms_accepted_at: '2026-11-08', lister_fee_terms: { free_days: 7, monthly_ugx: 20000 } } }),
    { free_days: 7, monthly_ugx: 20000 }, 'agreed on WhatsApp to a free week: still told when it ends');
  assert.strictEqual(await moderation.approvalListerFee({ ...base, agent_id: 'a1' }), null);
  assert.strictEqual(await moderation.approvalListerFee({ ...base, source: 'found_online_property_source_v1' }), null);
  paidUntil = '2099-01-01';
  assert.strictEqual(await moderation.approvalListerFee(base), null, 'already paid: nothing to ask');
  paidUntil = null;
  process.env.COUNTRY_CODE = 'ZA';
  assert.strictEqual(await moderation.approvalListerFee(base), null);
});

test('the WhatsApp terms say no free days, and the reply after AGREE no longer promises 7 free days', () => {
  const text = docs.listerTermsMessage({ lister_fee: { free_days: 7, monthly_ugx: 20000 } }, { name: 'Mary' });
  assert.match(text, /UGX 20,000 per listing, per month\* from the day it goes live/);
  assert.ok(!/days are free|free week/i.test(text), 'a stale stored setting cannot bring the free week back');
  const route = read('routes/whatsapp.js');
  assert.match(route, /lister_fee_terms: \{ free_days: publishedPricing\(\)\.owner_listing\.free_days,/, 'what the owner agrees to is the published price, not the old stored 7');
  assert.doesNotMatch(route, /free_days: Number\(settings\.lister_fee\?\.free_days \?\? 7\)/);
  assert.match(route, /Once our team approves it, your property goes live and I send you the payment link/);
});

test('the agent terms PDF no longer says "Your first 0 days are free"', () => {
  const src = read('services/listingDocsService.js');
  assert.match(src, /The agent plan is \$\{ugx\(s\.agentMonthly\)\} per month, from the day your agent account is switched on\./);
  assert.match(src, /section\(doc, s\.agentFreeDays > 0 \? '2\. The free period and the agent plan' : '2\. The agent plan'\);/);
  assert.match(src, /We send you a payment link with your welcome pack and before each renewal/);
  assert.match(docs.AGENT_TERMS_VERSION, /^2026-11-10-v4$/);
});

test('the WhatsApp films are the new cuts, and their captions and the menu offer no free days', () => {
  const route = read('routes/whatsapp.js');
  assert.match(route, /makaug-list-your-property-v3\.mp4/);
  assert.match(route, /makaug-join-as-agent-v4\.mp4/);
  assert.ok(fs.existsSync(path.join(root, 'assets/marketing/makaug-list-your-property-v3.mp4')));
  assert.ok(fs.existsSync(path.join(root, 'assets/marketing/makaug-join-as-agent-v4.mp4')));
  const films = route.slice(route.indexOf('const EXPLAINER_VIDEOS = {'), route.indexOf('/** The fee, in the words an agent reads'))
    .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.ok(!/days free|free days|First 7/i.test(films));
  assert.match(films, /UGX 20,000 a month per property/);
  assert.doesNotMatch(films, /UGX 50,000/, 'the agent pitch caption still leaves the fee to the terms');
  assert.match(route, /1️⃣ List my property\\n2️⃣ Search for a property/, 'the menu no longer promises free days');
  assert.doesNotMatch(route, /how listing works and the 14 days free/);
  for (const source of ['scripts/listing-explainer-video/lister.html', 'scripts/listing-explainer-video/agent.html', 'scripts/listing-explainer-video/terms-preview.html']) {
    const visible = read(source).replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(!/\bfree\b|first week|14 days|7 days/i.test(visible), `${source} offers no free days`);
  }
  assert.match(read('scripts/listing-explainer-video/lister.html'), /UGX 20,000/);
  assert.match(read('scripts/listing-explainer-video/agent.html'), /UGX 50,000/);
});

test('migration 214 sets the stored free days to 0 and takes the free-week sentence out of the views message', () => {
  const sql = read('db/migrations/214_lister_settings_no_free_week.sql');
  assert.match(sql, /jsonb_set\(value, '\{free_days\}', '0'::jsonb, true\)/);
  assert.match(sql, /replace\(value->>'text', 'Your free week ends on \{free_until\}\. ', ''\)/);
  assert.doesNotMatch(sql, /DELETE|DROP|TRUNCATE/i);
});
