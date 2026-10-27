'use strict';

// 27 Oct 2026, MK-20261026-A64E8E: the video says "UGX 1.4 billion" but the
// video price reader said UGX 4 billion. The burned-in text was read as
// "UGX 14 / 4 billion" and "UGX 14 / billion" (point lost, line split), and
// the first fragment, 4 billion, won. Phone numbers in the fixture are fake.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseListingFacts,
  decideVideoCaptionApproval,
  publicOcrView
} = require('../services/videoCaptionOcrService');

const A64_TEXT = fs.readFileSync(path.join(__dirname, 'fixtures', 'video-ocr-a64e8e-27oct.txt'), 'utf8');

test('A64E8E video text no longer reads as UGX 4 billion', () => {
  const facts = parseListingFacts(A64_TEXT);
  assert.notEqual(facts.price, 4_000_000_000);
  assert.equal(facts.price, null, 'two different amounts read once each: price is unknown');
});

test('decimal commas, middle dots and spaced points are decimal points', () => {
  for (const text of ['UGX 1.4 billion', 'UGX 1,4 billion', 'UGX 1. 4 billion', 'UGX 1·4bn']) {
    assert.equal(parseListingFacts(text).price, 1_400_000_000, text);
  }
  assert.equal(parseListingFacts('UGX 1,400 million').price, 1_400_000_000);
  assert.equal(parseListingFacts('UGX 350,000,000').price, 350_000_000);
  assert.equal(parseListingFacts('USD 250,000').price, 250_000);
});

test('the amount read most often still wins', () => {
  assert.equal(parseListingFacts('UGX 1.4bn ... UGX 1.4bn ... 4bn').price, 1_400_000_000);
});

test('a stored record with the old 4 billion reading does not block the 1.4bn listing', () => {
  const record = {
    status: 'done',
    ocr_text: A64_TEXT,
    parsed_facts: { price: 4_000_000_000, currency: 'UGX' },
    conflicts: []
  };
  const decision = decideVideoCaptionApproval({
    record,
    property: { price: 1_400_000_000, title: 'Land for sale in Mutundwe', area: 'Mutundwe', district: 'Kampala' }
  });
  assert.equal(decision.blocked, false);
  assert.notEqual(publicOcrView(record).facts.price, 4_000_000_000);
});
