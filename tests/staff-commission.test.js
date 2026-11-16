'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const c = require('../services/staffCommission');
const { isStaffSharedKingTool } = require('../utils/staffSharedKingTools');

// Fake phones only (last nine digits made up for the tests).
const PH = (n) => `0700${String(n).padStart(6, '0')}`;
const K = (n) => `700${String(n).padStart(6, '0')}`;

const STAFF = [
  { person_key: 'ronald', name: 'Ronald', role: 'closer', rate_pct: 20, active: true, phone_key: K(999001) },
  { person_key: 'sharon', name: 'Sharon', role: 'not_closing', rate_pct: 0, active: false },
  { person_key: 'joan', name: 'Joan', role: 'commission_only', rate_pct: 20, active: true, phone_key: K(999002) }
];
const NOW = new Date('2026-12-10T09:00:00Z');

function world(over = {}) {
  return {
    settings: {},
    staff: STAFF,
    staffPhones: c.staffPhoneMap(STAFF, {}),
    sends: [],
    agents: [],
    payments: [],
    listings: [],
    corpus: null,
    images: [],
    hashes: [],
    items: [],
    now: NOW,
    ...over
  };
}
let seq = 0;
const id = (p) => `${p}-${String(++seq).padStart(4, '0')}`;
function send(n, person, at) { return { id: id('s'), phone_key: K(n), person_key: person, sender_name: person[0].toUpperCase() + person.slice(1), pitched_at: at, full_name: `Lead ${n}` }; }
function agent(n, at, extra = {}) { return { id: id('a'), full_name: `Agent ${n} Test`, phone: PH(n), whatsapp: null, email: `a${n}@example.com`, nin: null, created_at: at, status: 'approved', ...extra }; }
function pay(a, at, extra = {}) { return { id: id('p'), direction: 'in', kind: 'agent_subscription', agent_id: a.id, amount_ugx: 50000, paid_at: at, payer_phone: a.phone, verified_status: 'verified', voided_at: null, ...extra }; }
function listing(a, at, extra = {}) { return { id: id('l'), agent_id: a.id, status: 'approved', title: `3 bed house ${a.id}`, district: 'Wakiso', area: `Area ${a.id}`, price: 1000000 + seq, inquiry_reference: `MK-${seq}`, created_at: at, approved_at: at, found_online: false, ...extra }; }
const row = (ev, a) => ev.rows.find((r) => r.agent_id === a.id);

// The happy path: pitched, signed up, paid, listed → 20% of 50,000 = 10,000.
function happy(n = 1, person = 'ronald') {
  const a = agent(n, '2026-11-17T10:00:00Z');
  return { s: send(n, person, '2026-11-17T08:00:00Z'), a, p: pay(a, '2026-11-18T10:00:00Z'), l: listing(a, '2026-11-18T12:00:00Z') };
}

test('rate: 20% of the confirmed payment amount (UGX 10,000 on 50,000)', () => {
  assert.equal(c.commissionFor(50000, 20), 10000);
  assert.equal(c.commissionFor(75000, 20), 15000);
  const h = happy();
  const ev = c.evaluateCommission(world({ sends: [h.s], agents: [h.a], payments: [h.p], listings: [h.l] }));
  const r = row(ev, h.a);
  assert.equal(r.status, 'eligible');
  assert.equal(r.commission_ugx, 10000);
  assert.equal(r.lines[0].due_payday, '2026-12-25');
});

test('paid but not listed, and listed but not paid, are pending with the reason', () => {
  const x = happy(2); const y = happy(3);
  const ev = c.evaluateCommission(world({ sends: [x.s, y.s], agents: [x.a, y.a], payments: [x.p], listings: [y.l] }));
  assert.equal(row(ev, x.a).status, 'pending');
  assert.match(row(ev, x.a).reasons.join(), /No property listed yet/);
  assert.equal(row(ev, y.a).status, 'pending');
  assert.match(row(ev, y.a).reasons.join(), /Not paid yet/);
  assert.equal(ev.totals.people.ronald.eligible, 0);
  assert.equal(ev.totals.people.ronald.paid, 1);
  assert.equal(ev.totals.people.ronald.listed, 1);
});

test('G1: an agent who existed before the pitch earns nothing', () => {
  const a = agent(4, '2026-11-01T10:00:00Z');
  const ev = c.evaluateCommission(world({ sends: [send(4, 'ronald', '2026-11-17T08:00:00Z')], agents: [a], payments: [pay(a, '2026-11-18T10:00:00Z')], listings: [listing(a, '2026-11-18T10:00:00Z')] }));
  assert.equal(row(ev, a).status, 'not_eligible');
  assert.match(row(ev, a).reasons[0], /already an agent before the first pitch/);
});

test('G2: same person under another phone format / email / NIN, and second accounts', () => {
  const old = agent(5, '2026-10-01T10:00:00Z', { email: 'same@example.com' });
  const fresh = agent(6, '2026-11-17T10:00:00Z', { email: 'SAME@example.com ' });
  const ev = c.evaluateCommission(world({ sends: [send(6, 'ronald', '2026-11-17T08:00:00Z')], agents: [old, fresh], payments: [pay(fresh, '2026-11-18T10:00:00Z')], listings: [listing(fresh, '2026-11-18T10:00:00Z')] }));
  assert.match(row(ev, fresh).reasons[0], /Already an agent under another account \(same email\)/);

  // Same phone written two ways: +256 700 000 007 vs 0700000007 → one person; second account not paid again.
  const a1 = agent(7, '2026-11-17T10:00:00Z');
  const a2 = agent(70, '2026-11-19T10:00:00Z', { phone: '+256 700-000-007', email: 'other@example.com' });
  const ev2 = c.evaluateCommission(world({ sends: [send(7, 'ronald', '2026-11-17T08:00:00Z')], agents: [a1, a2], payments: [pay(a1, '2026-11-18T10:00:00Z'), pay(a2, '2026-11-20T10:00:00Z')], listings: [listing(a1, '2026-11-18T10:00:00Z'), listing(a2, '2026-11-20T10:00:00Z')] }));
  assert.equal(row(ev2, a1).status, 'eligible');
  assert.equal(row(ev2, a2).status, 'not_eligible');
  assert.match(row(ev2, a2).reasons[0], /Second account/);
  assert.equal(ev2.totals.people.ronald.due_next_payday_ugx, 10000);

  // Same NIN.
  const n1 = agent(8, '2026-10-01T10:00:00Z', { nin: 'CM90012345ABCD' });
  const n2 = agent(9, '2026-11-17T10:00:00Z', { nin: 'cm 90012345 abcd' });
  const ev3 = c.evaluateCommission(world({ sends: [send(9, 'ronald', '2026-11-17T08:00:00Z')], agents: [n1, n2] }));
  assert.match(row(ev3, n2).reasons[0], /same NIN/);

  // Same name, different everything else → held for review, not paid automatically.
  const m1 = agent(10, '2026-10-01T10:00:00Z', { full_name: 'Grace Nakato' });
  const m2 = agent(11, '2026-11-17T10:00:00Z', { full_name: 'grace  NAKATO' });
  const ev4 = c.evaluateCommission(world({ sends: [send(11, 'ronald', '2026-11-17T08:00:00Z')], agents: [m1, m2], payments: [pay(m2, '2026-11-18T10:00:00Z')], listings: [listing(m2, '2026-11-18T10:00:00Z')] }));
  assert.equal(row(ev4, m2).status, 'needs_review');
});

test('G3: first valid pitch wins; a rival pitch is flagged as a dispute', () => {
  const a = agent(12, '2026-11-17T10:00:00Z');
  const ev = c.evaluateCommission(world({
    sends: [send(12, 'joan', '2026-11-17T09:00:00Z'), send(12, 'ronald', '2026-11-17T07:00:00Z')],
    agents: [a], payments: [pay(a, '2026-11-18T10:00:00Z')], listings: [listing(a, '2026-11-18T10:00:00Z')]
  }));
  assert.equal(row(ev, a).person_key, 'ronald');
  assert.match(row(ev, a).flags[0], /Also pitched by Joan/);
  assert.equal(row(ev, a).status, 'needs_review');
  // One prospect row per phone: a rival claim is the number on someone else's list, or their call.
  const b = agent(19, '2026-11-17T10:00:00Z');
  const ev2 = c.evaluateCommission(world({
    sends: [send(19, 'ronald', '2026-11-17T07:00:00Z')], claims: [{ phone_key: K(19), person_key: 'joan', at: '2026-11-17T09:00:00Z' }],
    agents: [b], payments: [pay(b, '2026-11-18T10:00:00Z')], listings: [listing(b, '2026-11-18T10:00:00Z')]
  }));
  assert.equal(row(ev2, b).person_key, 'ronald');
  assert.match(row(ev2, b).flags[0], /Also pitched by Joan/);
});

test('G4: no self-referral (staff phone as agent, or paid from the closer’s own phone)', () => {
  const self = agent(999001, '2026-11-17T10:00:00Z');
  const a = agent(13, '2026-11-17T10:00:00Z');
  const ev = c.evaluateCommission(world({
    sends: [send(999001, 'ronald', '2026-11-17T08:00:00Z'), send(13, 'ronald', '2026-11-17T08:00:00Z')],
    agents: [self, a], payments: [pay(self, '2026-11-18T10:00:00Z'), pay(a, '2026-11-18T10:00:00Z', { payer_phone: PH(999001) })],
    listings: [listing(self, '2026-11-18T10:00:00Z'), listing(a, '2026-11-18T10:00:00Z')]
  }));
  assert.match(row(ev, self).reasons[0], /Self-referral: the agent is a staff member/);
  assert.match(row(ev, a).reasons[0], /Self-referral: paid from Ronald/);
});

test('G5: only a real confirmed payment counts (not unverified, voided, zero or short)', () => {
  const s = c.DEFAULT_SETTINGS;
  const base = { direction: 'in', kind: 'agent_subscription', amount_ugx: 50000, paid_at: '2026-11-18', verified_status: 'verified' };
  assert.equal(c.paymentProblem(base, s), '');
  assert.match(c.paymentProblem({ ...base, verified_status: 'unverified' }, s), /not yet matched/);
  assert.match(c.paymentProblem({ ...base, verified_status: 'disputed' }, s), /not yet matched/);
  assert.match(c.paymentProblem({ ...base, voided_at: '2026-11-19' }, s), /voided/);
  assert.match(c.paymentProblem({ ...base, amount_ugx: 0 }, s), /below/);
  assert.match(c.paymentProblem({ ...base, amount_ugx: 20000 }, s), /below/);
  assert.match(c.paymentProblem(base, s, [{ paid_at: '2026-11-20' }]), /refunded/);
  // A first payment before the scheme start does not earn (first-payment mode).
  const a = agent(14, '2026-11-01T10:00:00Z');
  const ev = c.evaluateCommission(world({ sends: [send(14, 'ronald', '2026-10-30T08:00:00Z')], agents: [a], payments: [pay(a, '2026-11-02T10:00:00Z')], listings: [listing(a, '2026-11-02T10:00:00Z')] }));
  assert.match(row(ev, a).reasons.join(), /before the scheme started/);
});

test('G6: the listing must be new, approved, own (not found-online) and not a copy', () => {
  const h = happy(15);
  const other = { id: 'other-1', agent_id: 'someone-else', title: 'Lovely 3 bedroom house Kira', district: 'Wakiso', area: 'Kira', price: 2000000, inquiry_reference: 'MK-OLD-1', created_at: '2026-10-01', found_online: false };
  const foundOnline = { id: 'fo-1', agent_id: null, title: 'x', district: 'Wakiso', area: 'Najjera', price: 9, inquiry_reference: 'MK-FO-1', created_at: '2026-10-01', found_online: true };
  const cases = [
    [{ status: 'pending' }, /waiting for approval/],
    [{ status: 'rejected' }, /listing is rejected/],
    [{ found_online: true }, /found-online/],
    [{ created_at: '2026-11-16T10:00:00Z', approved_at: '2026-11-16T10:00:00Z' }, /before the pitch/],
    [{ inquiry_reference: 'MK-OLD-1' }, /same reference as MK-OLD-1/],
    [{ title: 'Lovely 3 bedroom house in Kira!!', area: 'Kira', price: 2050000 }, /same area, price and title/]
  ];
  for (const [extra, re] of cases) {
    const l = { ...h.l, id: id('l'), ...extra };
    const ev = c.evaluateCommission(world({ sends: [h.s], agents: [h.a], payments: [h.p], listings: [l], corpus: [l, other, foundOnline] }));
    assert.equal(row(ev, h.a).status, 'pending', JSON.stringify(extra));
    assert.match(row(ev, h.a).reasons.join(), re);
  }
  // Same photo file as a found-online listing → "copied from a found-online listing".
  const l = { ...h.l, id: id('l') };
  const ev = c.evaluateCommission(world({ sends: [h.s], agents: [h.a], payments: [h.p], listings: [l], corpus: [l, foundOnline],
    images: [{ property_id: l.id, url: 'https://media.makaug.com/p/abc.jpg?w=800' }, { property_id: 'fo-1', url: 'https://media.makaug.com/p/abc.jpg' }] }));
  assert.match(row(ev, h.a).reasons.join(), /copied from a found-online listing \(MK-FO-1\)/);
  // Near-identical photo hash (re-saved / re-cropped).
  const l2 = { ...h.l, id: id('l') };
  const ev2 = c.evaluateCommission(world({ sends: [h.s], agents: [h.a], payments: [h.p], listings: [l2], corpus: [l2, other],
    hashes: [{ property_id: l2.id, dhash: 'ffff0000ffff0000' }, { property_id: 'other-1', dhash: 'ffff0000ffff0003' }] }));
  assert.match(row(ev2, h.a).reasons.join(), /near-identical photo to MK-OLD-1/);
  assert.equal(c.hamming('ffff0000ffff0000', 'ffff0000ffff0003'), 2);
});

test('G7: 7-day hold; refund in the hold stops it; refund after payout is clawed back', () => {
  const h = happy(16);
  const early = c.evaluateCommission(world({ sends: [h.s], agents: [h.a], payments: [h.p], listings: [h.l], now: new Date('2026-11-25T09:00:00Z') }));
  assert.equal(row(early, h.a).status, 'on_hold');
  assert.equal(early.totals.people.ronald.due_next_payday_ugx, 0);
  assert.equal(early.totals.people.ronald.pending_ugx, 10000);
  // Qualified 18 Nov 12:00 UTC: the 7-day hold ends 25 Nov (after the 23 Nov cut-off) → paid 25 Dec.
  assert.equal(row(early, h.a).lines[0].hold_until, '2026-11-25T12:00:00.000Z');
  assert.equal(row(early, h.a).lines[0].due_payday, '2026-12-25');
  assert.equal(c.DEFAULT_SETTINGS.hold_days, 7);
  assert.equal(c.DEFAULT_SETTINGS.pays_on, 'first_payment');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '227_staff_commission.sql'), 'utf8');
  assert.match(sql, /hold_days INTEGER NOT NULL DEFAULT 7 /);
  assert.match(sql, /pays_on TEXT NOT NULL DEFAULT 'first_payment'/);

  const refund = { id: id('r'), direction: 'out', kind: 'refund', agent_id: h.a.id, amount_ugx: 50000, paid_at: '2026-11-20T10:00:00Z' };
  const refunded = c.evaluateCommission(world({ sends: [h.s], agents: [h.a], payments: [h.p, refund], listings: [h.l] }));
  assert.equal(row(refunded, h.a).status, 'pending');
  assert.match(row(refunded, h.a).reasons.join(), /refunded/);

  // Listing taken down → no longer qualifies.
  const down = c.evaluateCommission(world({ sends: [h.s], agents: [h.a], payments: [h.p], listings: [{ ...h.l, status: 'hidden' }] }));
  assert.equal(row(down, h.a).status, 'pending');

  // Paid out, then refunded → clawback line on the next payday.
  const items = [{ payout_id: 'po1', agent_id: h.a.id, phone_key: K(16), person_key: 'ronald', kind: 'commission', amount_ugx: 10000, is_first: true, payment_entry_id: h.p.id, batch_status: 'paid', payday: '2026-12-25' }];
  const claw = c.evaluateCommission(world({ sends: [h.s], agents: [h.a], payments: [h.p, { ...refund, paid_at: '2026-12-26T10:00:00Z' }], listings: [h.l], items, now: new Date('2027-01-02T09:00:00Z') }));
  const r = row(claw, h.a);
  assert.ok(r.lines.some((l) => l.status === 'clawback_due' && l.amount_ugx === -10000));
  assert.equal(claw.totals.people.ronald.clawback_ugx, -10000);
  assert.equal(r.status, 'clawback_due');
  assert.equal(claw.totals.people.ronald.paid_to_date_ugx, 10000); // what went out stays on the record
  assert.equal(claw.totals.people.ronald.due_next_payday_ugx, -10000);
  const lines = c.selectForPayout(claw, '2027-01-25');
  assert.deepEqual(lines.map((l) => [l.kind, l.amount_ugx]), [['clawback', -10000]]);
  // Once the clawback is in a paid batch it is settled: nothing more is due.
  const settled = c.evaluateCommission(world({ sends: [h.s], agents: [h.a], payments: [h.p, { ...refund, paid_at: '2026-12-26T10:00:00Z' }], listings: [h.l],
    items: [...items, { payout_id: 'po2', agent_id: h.a.id, phone_key: K(16), person_key: 'ronald', kind: 'clawback', amount_ugx: -10000, payment_entry_id: h.p.id, batch_status: 'paid', payday: '2027-01-25' }],
    now: new Date('2027-02-02T09:00:00Z') }));
  assert.equal(settled.totals.people.ronald.due_next_payday_ugx, 0);
  assert.equal(settled.totals.people.ronald.paid_to_date_ugx, 0);
  assert.equal(c.selectForPayout(settled, '2027-02-25').length, 0);
});

test('G8: suspicious patterns are held for admin review', () => {
  // One phone paying for two agents.
  const x = happy(17); const y = happy(18);
  const ev = c.evaluateCommission(world({ sends: [x.s, y.s], agents: [x.a, y.a], payments: [x.p, { ...y.p, payer_phone: x.a.phone }], listings: [x.l, y.l] }));
  assert.match(row(ev, x.a).flags.join(), /paid for 2 agents/);
  assert.equal(row(ev, y.a).status, 'needs_review');
  // Burst: 5 sign-ups in an hour for one person.
  const burst = [20, 21, 22, 23, 24].map((n, i) => {
    const a = agent(n, `2026-11-17T10:0${i}:00Z`);
    return { s: send(n, 'ronald', '2026-11-17T08:00:00Z'), a, p: pay(a, '2026-11-18T10:00:00Z'), l: listing(a, '2026-11-18T12:00:00Z') };
  });
  const evb = c.evaluateCommission(world({ sends: burst.map((b) => b.s), agents: burst.map((b) => b.a), payments: burst.map((b) => b.p), listings: burst.map((b) => b.l) }));
  assert.ok(evb.rows.every((r) => r.status === 'needs_review' && /5 sign-ups within 60 minutes/.test(r.flags.join())));
  // Three agents registered from one non-staff phone in a day.
  const reg = [30, 31, 32].map((n, i) => {
    const a = agent(n, `2026-11-17T1${i}:00:00Z`, { registered_by_phone: PH(555555) });
    return { s: send(n, 'ronald', '2026-11-17T08:00:00Z'), a, p: pay(a, '2026-11-18T10:00:00Z'), l: listing(a, '2026-11-18T12:00:00Z') };
  });
  const evr = c.evaluateCommission(world({ sends: reg.map((b) => b.s), agents: reg.map((b) => b.a), payments: reg.map((b) => b.p), listings: reg.map((b) => b.l) }));
  assert.ok(evr.rows.every((r) => /registered from one phone/.test(r.flags.join())));
  // Flagged agents stay out of a payout unless an admin accepts them with a note.
  assert.equal(c.selectForPayout(evb, '2026-12-25').length, 0);
  assert.equal(c.selectForPayout(evb, '2026-12-25', new Map([[burst[0].a.id, 'Office open day']])).length, 1);
});

test('G9: one agent, one phone, one payment is paid once', () => {
  const h = happy(40);
  const items = [{ payout_id: 'po1', agent_id: h.a.id, phone_key: K(40), person_key: 'ronald', kind: 'commission', amount_ugx: 10000, is_first: true, payment_entry_id: h.p.id, batch_status: 'paid', payday: '2026-12-25' }];
  const ev = c.evaluateCommission(world({ sends: [h.s], agents: [h.a], payments: [h.p], listings: [h.l], items, now: new Date('2027-01-10T09:00:00Z') }));
  assert.equal(row(ev, h.a).status, 'paid_out');
  assert.equal(c.selectForPayout(ev, '2027-01-25').length, 0);
  assert.equal(ev.totals.people.ronald.paid_to_date_ugx, 10000);
  assert.equal(ev.totals.people.ronald.due_next_payday_ugx, 0);
  // Every-payment mode pays each renewal once, never the first twice.
  const renew = pay(h.a, '2026-12-18T10:00:00Z');
  const ev2 = c.evaluateCommission(world({ settings: { pays_on: 'every_payment' }, sends: [h.s], agents: [h.a], payments: [h.p, renew], listings: [h.l], items, now: new Date('2027-01-10T09:00:00Z') }));
  const sel = c.selectForPayout(ev2, '2027-01-25');
  assert.deepEqual(sel.map((l) => [String(l.payment_entry_id), l.amount_ugx, l.is_first]), [[renew.id, 10000, false]]);
  // First-payment mode (default) ignores the renewal.
  const ev3 = c.evaluateCommission(world({ sends: [h.s], agents: [h.a], payments: [h.p, renew], listings: [h.l], items, now: new Date('2027-01-10T09:00:00Z') }));
  assert.equal(c.selectForPayout(ev3, '2027-01-25').length, 0);
  // The database enforces it too.
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '227_staff_commission.sql'), 'utf8');
  for (const ix of ['ux_commission_items_agent', 'ux_commission_items_phone', 'ux_commission_items_payment', 'ux_commission_items_clawback']) assert.match(sql, new RegExp(ix));
});

test('G10: payout actions are admin-only; settings and audit exist', () => {
  for (const p of ['/staff-performance/commission/payouts', '/staff-performance/commission/payouts/x/review', '/staff-performance/commission/payouts/x/paid', '/staff-performance/commission/payouts/x/cancel', '/staff-performance/commission/recruits']) {
    assert.equal(isStaffSharedKingTool(p, 'POST'), false, p);
  }
  assert.equal(isStaffSharedKingTool('/staff-performance/commission/settings', 'PUT'), false);
  assert.equal(isStaffSharedKingTool('/staff-performance', 'GET'), true);
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'staffCommission.js'), 'utf8');
  assert.match(src, /An admin has to review the payout before it is marked paid/);
  for (const a of ['payout_created', 'payout_reviewed', 'payout_paid', 'payout_cancelled', 'recruit_added', 'settings_saved']) assert.match(src, new RegExp(`'${a}'`));
});

test('recruits earn the same way; inactive people (Sharon) earn nothing but keep history', () => {
  const j = happy(50, 'joan'); const s = happy(51, 'sharon');
  const ev = c.evaluateCommission(world({ sends: [j.s, s.s], agents: [j.a, s.a], payments: [j.p, s.p], listings: [j.l, s.l] }));
  assert.equal(row(ev, j.a).status, 'eligible');
  assert.equal(row(ev, j.a).commission_ugx, 10000);
  assert.equal(row(ev, s.a).status, 'not_eligible');
  assert.match(row(ev, s.a).reasons.join(), /Sharon is not on commission/);
  assert.equal(ev.totals.people.sharon.signed_up, 1);
  // A recruit filed as "other" on the desk is credited by first name.
  const credited = c.attributeSends([{ person_key: 'other', sender_name: 'Joan Akello', phone_key: K(52) }], STAFF);
  assert.equal(credited[0].person_key, 'joan');
});

test('paydays: 25th, cut-off on the 20th, countdown in days and hours', () => {
  const s = c.DEFAULT_SETTINGS;
  assert.equal(c.nextPayday(new Date('2026-11-16T12:00:00Z'), s), '2026-11-25');
  assert.equal(c.nextPayday(new Date('2026-11-26T12:00:00Z'), s), '2026-12-25');
  assert.equal(c.nextPayday(new Date('2026-12-26T12:00:00Z'), s), '2027-01-25');
  // Cut-off on the 23rd (Arthur, 16 Nov 13:37): cleared by the 23rd → this 25th.
  assert.equal(s.cutoff_day, 23);
  assert.equal(c.paydayForDay('2026-11-23', s), '2026-11-25');
  assert.equal(c.paydayForDay('2026-11-24', s), '2026-12-25');
  assert.equal(c.cutoffFor('2026-11-25', s), '2026-11-23');
  // A first payment on 16 Nov with a live listing clears the 7-day hold on 23 Nov → paid 25 Nov.
  const a = agent(90, '2026-11-15T10:00:00Z');
  const ev = c.evaluateCommission(world({ sends: [send(90, 'ronald', '2026-11-15T08:00:00Z')], agents: [a],
    payments: [pay(a, '2026-11-16T06:00:00Z')], listings: [listing(a, '2026-11-16T06:00:00Z')], now: new Date('2026-11-23T20:00:00Z') }));
  assert.equal(row(ev, a).status, 'eligible');
  assert.equal(row(ev, a).lines[0].due_payday, '2026-11-25');
  const mig = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '228_commission_cutoff_23rd.sql'), 'utf8');
  assert.match(mig, /commission_settings_backup_228/);
  assert.match(mig, /SET cutoff_day = 23[\s\S]*WHERE key = 'default' AND cutoff_day = 20/);
  assert.match(mig, /Rollback:/);
  assert.deepEqual(c.countdown(new Date('2026-11-16T12:37:00Z'), '2026-11-25'), { days: 8, hours: 17, ms: c.countdown(new Date('2026-11-16T12:37:00Z'), '2026-11-25').ms });
});

test('numbers add up: team = sum of people, nothing counted twice', () => {
  const hs = [60, 61, 62].map((n) => happy(n)); const j = happy(63, 'joan');
  const all = [...hs, j];
  const ev = c.evaluateCommission(world({ sends: all.map((h) => h.s), agents: all.map((h) => h.a), payments: all.map((h) => h.p), listings: all.map((h) => h.l) }));
  const sum = (k) => Object.values(ev.totals.people).reduce((t, p) => t + p[k], 0);
  for (const k of ['contacted', 'signed_up', 'paid', 'listed', 'eligible', 'due_next_payday_ugx', 'earned_ugx']) assert.equal(ev.totals.team[k], sum(k), k);
  assert.equal(ev.totals.team.due_next_payday_ugx, 40000);
  const sel = c.selectForPayout(ev, '2026-12-25');
  assert.equal(sel.reduce((t, l) => t + l.amount_ugx, 0), 40000);
  assert.equal(new Set(sel.map((l) => l.agent_id)).size, sel.length);
});

test('the tab leads with commission; films and targets are secondary; no full phones in code', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');
  assert.match(app, /data-perf-commission/);
  assert.match(app, /data-perf-secondary/);
  assert.ok(app.indexOf('staffPerfCommissionHtml(data, scope, isKing)') < app.indexOf('data-perf-road>'));
  const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'staffCommission.js'), 'utf8');
  assert.doesNotMatch(src, /\b0?7\d{8}\b|\b2567\d{8}\b/);
});

test('a first-touch ?ref= is supporting evidence only and never makes someone eligible', () => {
  const onlyRef = agent(90, '2026-11-18T10:00:00Z');
  onlyRef.referral_code = 'ronald';
  const evNone = c.evaluateCommission(world({ agents: [onlyRef] }));
  assert.equal(evNone.rows.length, 0, 'a ref with no pitch must not create a commission row');

  const h = happy(91);
  h.a.referral_code = 'ronald';
  const ev = c.evaluateCommission(world({ sends: [h.s], agents: [h.a], payments: [h.p], listings: [h.l] }));
  const r = row(ev, h.a);
  assert.equal(r.status, 'eligible');
  assert.equal(r.person_key, 'ronald');
  assert.equal(r.first_touch_ref, 'ronald');
  assert.equal(r.first_touch_person, 'ronald');
  assert.equal(r.commission_ugx, 10000);
  assert.match((r.evidence || []).join(' '), /Supporting evidence only/);
  assert.ok(!(r.flags || []).length, 'first-touch evidence must not hold the payout for review');
});

test('a first-touch ref does not override the first pitch, and owner-share is not staff attribution', () => {
  const h = happy(92);
  h.a.referral_code = 'sharon';
  const ev = c.evaluateCommission(world({ sends: [h.s], agents: [h.a], payments: [h.p], listings: [h.l] }));
  const r = row(ev, h.a);
  assert.equal(r.person_key, 'ronald', 'first pitch still wins');
  assert.equal(r.first_touch_ref, 'sharon');
  assert.equal(r.first_touch_person, 'sharon');
  assert.equal(r.status, 'eligible');
  assert.match((r.evidence || []).join(' '), /first pitch still wins/);
  assert.ok(!(r.flags || []).some((f) => /first-touch|first pitch still wins/i.test(f)), 'evidence must not sit on review flags');

  const share = happy(93);
  share.a.referral_code = 'owner-share';
  const ev2 = c.evaluateCommission(world({ sends: [share.s], agents: [share.a], payments: [share.p], listings: [share.l] }));
  const r2 = row(ev2, share.a);
  assert.equal(r2.person_key, 'ronald');
  assert.equal(r2.first_touch_ref, 'owner-share');
  assert.equal(r2.first_touch_person, null);
  assert.equal(r2.status, 'eligible');
  assert.doesNotMatch((r2.evidence || []).join(' '), /first pitch still wins/);
  assert.ok(!(r2.flags || []).length, 'owner-share must not hold the payout for review');
});
