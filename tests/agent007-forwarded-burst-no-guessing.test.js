'use strict';
/**
 * 26 Oct 2026, Ronald for Charles: six text descriptions then seventy captionless
 * photos, forwarded in eighteen seconds. Photos were handed out to the waiting
 * descriptions in turn; one listing collected 48 photos of seven houses.
 */
const assert = require('assert');
const test = require('node:test');
process.env.NODE_ENV = 'test';
const router = require('../routes/whatsapp');
const t = router.__test;

test('the sender time is read from the WAHA event ULID', () => {
  const ms = t.employeeSenderMs({ waha_event_id: 'evt_01m5w39pyzt2j4hf0fd11tg39h' });
  assert(ms > Date.parse('2026-10-26T12:30:00Z') && ms < Date.parse('2026-10-26T12:40:00Z'), String(ms));
  assert.strictEqual(t.employeeSenderMs({ timestamp: 1793018092 }), 1793018092000);
  assert.strictEqual(t.employeeSenderMs({}), 0);
});

test('a captionless photo after a text description, in a burst, is held', () => {
  const data = { last_text_caption_sender_ms: 1000, last_album_sender_ms: 0 };
  assert.strictEqual(t.employeeShouldHoldUnassignedMedia({ data, ownCaption: false, senderMs: 1400, burstSize: 40 }), true);
});

test('album photos right after a captioned photo are kept with it', () => {
  const data = { last_text_caption_sender_ms: 500, last_album_sender_ms: 1000 };
  assert.strictEqual(t.employeeShouldHoldUnassignedMedia({ data, ownCaption: false, senderMs: 1300, burstSize: 40 }), false);
});

test('outside a burst, and for agents posting their own stock, nothing changes', () => {
  const data = { last_text_caption_sender_ms: 1000 };
  assert.strictEqual(t.employeeShouldHoldUnassignedMedia({ data, ownCaption: false, senderMs: 1400, burstSize: 2 }), false);
  assert.strictEqual(t.employeeShouldHoldUnassignedMedia({ data: { ...data, whatsapp_agent_self_intake: true }, ownCaption: false, senderMs: 1400, burstSize: 40 }), false);
  assert.strictEqual(t.employeeShouldHoldUnassignedMedia({ data, ownCaption: true, senderMs: 1400, burstSize: 40 }), false);
});

test('"1M USD" is a dollar price, not a million shillings', () => {
  assert(/USD 1M/i.test(t.normalizeCaptionPriceNotation('MUNYONYO APARTMENT BLOCK FOR SALE AT 1M USD MAKING 45M MONTHLY')));
  const facts = t.employeePropertyFacts('MUNYONYO APARTMENT BLOCK FOR SALE AT 1M USD MAKING 45M MONTHLY 25 DECIMALS WITH PRIVATE MAILO', {});
  assert.notStrictEqual(Number(facts.price), 1000000);
  assert.strictEqual(facts.priceMetadata.price_original_currency, 'USD');
});

test('a plot size is not a bedroom count', () => {
  const draft = t.parseEmployeeBedroomDraft('Kyanja Ring Road 6 units of One Bedroom Apartments On 12 Decimals Fully occupied with Monthly income of 7.2M Selling at 850M');
  assert.notStrictEqual(draft.bedrooms, 12);
});
