'use strict';
const test = require('node:test');
const assert = require('node:assert');
const r = require('../services/revenueService');

test('MTN and Airtel money SMS are read: amount, transaction ID, other party, balance', () => {
  const mtn = r.parseMoneySms('You have received 50,000 UGX from JOHN DOE (256772123456) on 2026-10-05 10:15:22. Reason: makaug. Your new balance: 1,234,567 UGX. Financial Transaction Id: 21234567890.', 'MobileMoney');
  assert.deepStrictEqual([mtn.account_key, mtn.direction, mtn.amount_ugx, mtn.reference, mtn.balance_ugx], ['mtn_momo', 'in', 50000, '21234567890', 1234567]);
  assert.match(mtn.counterparty, /JOHN DOE/);
  const airtel = r.parseMoneySms('RECEIVED.TID 123456789012. UGX 50,000 from 256752123456, JOHN DOE. Bal UGX 1,234,567. Date 05-October-2026 10:15.', 'AirtelMoney');
  assert.deepStrictEqual([airtel.account_key, airtel.direction, airtel.amount_ugx, airtel.reference, airtel.balance_ugx], ['airtel_money', 'in', 50000, '123456789012', 1234567]);
  assert.match(airtel.counterparty, /JOHN DOE/);
  const out = r.parseMoneySms("Y'ello. You have withdrawn UGX 100,000 from your MoMo account. Fee UGX 3,000. New balance: UGX 930,067. Transaction ID: 2123456800", 'MTN');
  assert.deepStrictEqual([out.direction, out.amount_ugx, out.balance_ugx, out.counterparty], ['out', 100000, 930067, null]);
});

test('a payment needs a method, an amount and a transaction ID (cash needs a note)', () => {
  assert.throws(() => r.normalizeEntry({ amount: 50000, method: 'mtn_momo' }), /transaction ID/);
  assert.throws(() => r.normalizeEntry({ amount: 0, method: 'mtn_momo', reference: 'ABC12345' }), /amount/);
  assert.throws(() => r.normalizeEntry({ amount: 50000, method: 'cheque', reference: 'ABC12345' }), /How was it paid/);
  assert.throws(() => r.normalizeEntry({ amount: 50000, method: 'cash' }), /cash/);
  const ok = r.normalizeEntry({ amount: '50,000', method: 'airtel_money', reference: ' MP 1234 ' });
  assert.deepStrictEqual([ok.amount_ugx, ok.account_key, ok.reference], [50000, 'airtel_money', 'MP1234']);
});

test('the fee applies to new agents from the start date, not to exempt or paid-up ones', () => {
  const before = new Date('2026-10-04T10:00:00Z');
  const after = new Date('2026-10-06T10:00:00Z');
  assert.strictEqual(r.agentFeeRequired({}, before), false);
  assert.strictEqual(r.agentFeeRequired({}, after), true);
  assert.strictEqual(r.agentFeeRequired({ fee_exempt: true }, after), false);
  assert.strictEqual(r.agentFeeRequired({ paid_until: '2026-11-05' }, after), false);
  assert.strictEqual(r.agentFeeRequired({ paid_until: '2026-10-01' }, after), true);
});

test('months roll correctly', () => {
  assert.strictEqual(r.addMonths('2026-10-05', 1), '2026-11-05');
  assert.strictEqual(r.addMonths('2027-01-31', 1), '2027-02-28');
});
