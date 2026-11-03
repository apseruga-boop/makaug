'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ugandanPhoneFromSourceText, normalizeUgandanSourcePhone } = require('../utils/sourceIntakeIntegrity');
const { resolveHarvestPhone, parseTikTokVideoPage } = require('../services/harvestCaptureService');
const { applyHarvestPhoneToItem } = require('../services/socialSearchSourcedListingsService');

test('Uganda phone forms in captions normalise to +256', () => {
  const cases = {
    'Call 0772 123 456 now': '+256772123456',
    'Call 0772123456': '+256772123456',
    'WhatsApp +256 772 123 456': '+256772123456',
    'tel 256-772-123-456': '+256772123456',
    'tel 256.772.123.456': '+256772123456',
    'call 0 772 12 34 56': '+256772123456',
    'call +256 (0) 772 123456': '+256772123456',
    'call 0772-123-456': '+256772123456',
    'call 772 123 456': '+256772123456',
    'Call/WhatsApp\n0772\n123 456 to view': '+256772123456',
  };
  for (const [text, want] of Object.entries(cases)) assert.equal(ugandanPhoneFromSourceText(text), want, text);
  assert.equal(normalizeUgandanSourcePhone('+256 (0) 704 699 563'), '+256704699563');
});

test('prices and foreign numbers are not phones', () => {
  assert.equal(ugandanPhoneFromSourceText('UGX 750.000.000 negotiable'), '');
  assert.equal(ugandanPhoneFromSourceText('Price 700,000,000'), '');
  assert.equal(ugandanPhoneFromSourceText('Call +254 712 345 678'), '');
});

test('caption number beats bio, bio beats account default', () => {
  assert.equal(resolveHarvestPhone({ captionText: 'call 0704699563', bioPhone: '+256770899832', fallback: '+256701541291' }), '+256704699563');
  assert.equal(resolveHarvestPhone({ captionText: 'no number', bioPhone: '+256770899832', fallback: '+256701541291' }), '+256770899832');
  assert.equal(resolveHarvestPhone({ captionText: '', bioPhone: '', fallback: '0701541291' }), '+256701541291');
});

test('TikTok bio is read from the author object, not the first signature', () => {
  const html = '{"music":{"signature":"call 0700000001"},"author":{"uniqueId":"x","signature":"Bookings 0772 123 456"}}';
  assert.equal(parseTikTokVideoPage(html).bio, 'Bookings 0772 123 456');
});

test('import path copies the caption phone onto the listing agent without mutating the shared agent', () => {
  const shared = { key: 'acct', phone: '+256701541291' };
  const item = { sourceAgent: shared, harvestCapture: { harvest_caption_full: 'Viewing: 0751 055 633', poster_bio_phone: '+256770899832' } };
  const agent = applyHarvestPhoneToItem(item, shared);
  assert.equal(agent.phone, '+256751055633');
  assert.equal(item.sourceAgent.phone, '+256751055633');
  assert.equal(shared.phone, '+256701541291');
  const bioOnly = { sourceAgent: {}, harvestCapture: { harvest_caption_full: 'nice house', poster_bio_phone: '+256770899832' } };
  assert.equal(applyHarvestPhoneToItem(bioOnly, {}).phone, '+256770899832');
});

test('migration 201 only touches pending found-online rows with no phone and ships a rollback', () => {
  const fs = require('fs');
  const path = require('path');
  const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/201_found_online_phone_backfill.sql'), 'utf8');
  assert.match(sql, /p\.status = 'pending'/);
  assert.match(sql, /AND status = 'pending'/);
  assert.match(sql, /found_online_phone_201_backup/);
  assert.match(sql, /COALESCE\(NULLIF\(btrim\(lister_phone\), ''\), NULLIF\(btrim\(extra_fields->>'contact_phone'\), ''\)\) IS NULL/);
  assert.doesNotMatch(sql, /\bDELETE\b|\bDROP\b/i);
  assert.ok(fs.existsSync(path.join(__dirname, '../scripts/rollback-201-found-online-phone-backfill.sql')));
});
