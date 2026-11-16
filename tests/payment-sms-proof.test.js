'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../services/paymentSmsProof');

test('MTN MoMoPay "received" SMS, with OCR slips (O for 0)', () => {
  const r = p.parseSmsText("Y'ello. You have received UGX 5O,OOO from JOHN MUKASA (256772123456) on your MoMoPay account at 2026-11-16 14:32:05. Reason: makaug. Transaction ID: 18273645501. New balance: UGX 1,250,000.");
  assert.equal(r.network, 'mtn'); assert.equal(r.direction, 'in'); assert.equal(r.amount_ugx, 50000);
  assert.equal(r.sender_name, 'JOHN MUKASA'); assert.equal(r.sender_phone, '256772123456'); assert.equal(r.txn_id, '18273645501');
  assert.equal(r.paid_at, '2026-11-16T11:32:00.000Z'); // 14:32 Kampala
});

test('Airtel "RECEIVED. TID" SMS with a 12-hour time', () => {
  const r = p.parseSmsText('RECEIVED. TID 123456789O. UGX 50,000 from 0752123456, SARAH NAKATO. 16/11/2026 02:32 PM. Bal UGX 300,000.');
  assert.equal(r.network, 'airtel'); assert.equal(r.amount_ugx, 50000); assert.equal(r.txn_id, '1234567890');
  assert.equal(r.sender_name, 'SARAH NAKATO'); assert.equal(r.sender_phone, '0752123456'); assert.equal(r.paid_at, '2026-11-16T11:32:00.000Z');
});

test("the payer's own 'you have sent' SMS: the name in it is makaug, not the sender", () => {
  const r = p.parseSmsText('You have sent UGX 50,000 to MAKAUG LTD 27248497 on 16-Nov-2026 at 14:32. Financial Transaction Id: 9988776655. Fee UGX 0. New balance UGX 12,000.');
  assert.equal(r.direction, 'out'); assert.equal(r.network, 'mtn'); assert.equal(r.sender_name, null); assert.equal(r.recipient, 'MAKAUG LTD');
  assert.equal(r.to_makaug, true); assert.equal(r.amount_ugx, 50000); assert.equal(r.txn_id, '9988776655');
});

test('dates: several network formats, and junk gives null', () => {
  assert.equal(p.parseSmsDate('on 16 Nov 2026 at 9:05 AM'), '2026-11-16T06:05:00.000Z');
  assert.equal(p.parseSmsDate('2026/11/15 23:59'), '2026-11-15T20:59:00.000Z');
  assert.equal(p.parseSmsDate('16.11.26 08:00'), '2026-11-16T05:00:00.000Z');
  assert.equal(p.parseSmsDate('no date here'), null);
  assert.equal(p.parseSmsDate('45/13/2026'), null);
});

test('OCR clean-up only touches number-like words', () => {
  assert.equal(p.cleanOcr('UGX5O,OOO from OKELLO'), 'UGX 50,000 from OKELLO');
  assert.equal(p.cleanOcr('Hello Ronald'), 'Hello Ronald');
  assert.equal(p.cleanOcr('ID 12l45'), 'ID 12145');
});

test('staff can parse, upload and view an SMS proof; only King lists them', () => {
  const { isStaffSharedKingTool: ok } = require('../utils/staffSharedKingTools');
  assert.equal(ok('/calling/sms-proof/parse', 'POST'), true);
  assert.equal(ok('/calling/sms-proof', 'POST'), true);
  assert.equal(ok('/calling/sms-proofs/9b1c7f0e-1111-4222-8333-444455556666/image', 'GET'), true);
  assert.equal(ok('/calling/sms-proofs', 'GET'), false);
  assert.equal(ok('/revenue/claims/abc/confirm', 'POST'), false);
});

test('a blurry screenshot read after contrast clean-up: dots for commas, misread words, spaced time', () => {
  const r = p.parseSmsText("Yelo You have recerved UGX 50.000 from JOHN\nMUKASA (0701999888) on your MoMoP ay\naccount ot 2026-11-16 19 43 46 Reason\nmakaug Transaction ID 18848927000 New\nbalance UGX 1.300.000\n1708 SMS\n");
  assert.equal(r.amount_ugx, 50000); assert.equal(r.direction, 'in'); assert.equal(r.network, 'mtn');
  assert.equal(r.sender_phone, '0701999888'); assert.equal(r.txn_id, '18848927000');
  assert.equal(r.paid_at, '2026-11-16T16:43:00.000Z');
  assert.equal(p.parseSmsDate('16.11.26 08:00'), '2026-11-16T05:00:00.000Z');
});
