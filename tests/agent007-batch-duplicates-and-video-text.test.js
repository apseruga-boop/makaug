'use strict';
/**
 * 26 Oct 2026, Arthur for Francis Isabirye: four adverts forwarded, nothing saved.
 *  - Namugongo Sonde rental units (400m) refused as a repeat of a different
 *    Namugongo listing at the same price;
 *  - Kira Kitukutwe, a real repeat, skipped without a word;
 *  - two videos with their words on screen and no caption blocked COMPLETE.
 */
const assert = require('assert');
const test = require('node:test');
process.env.NODE_ENV = 'test';
const { decideIntakeRepeat, captionsDescribeDifferentListings } = require('../utils/listingIntakeQuality');
const router = require('../routes/whatsapp');
const { bestCaptionFromOnScreenText, noteEmployeeBatchDuplicate, employeeBatchDuplicateLines, captionPendingVideosFromOnScreenText } = router.__test;

const augustRow = {
  id: 'caa20188-beaa-4526-a094-9e0a8f69a527',
  status: 'approved',
  price: '400000000',
  area: 'Namugongo',
  caption_hash: 'other',
  source_caption: 'Forwarded\nNamugongo 2 houses in same compound each 2 bedrooms 2 bathrooms on sale UGX 400 million',
  phone_digits: '256768524008'
};

test('a different Namugongo listing at the same price is not a repeat', () => {
  const decision = decideIntakeRepeat({
    caption: 'Namugongo Sonde 6 double rental units monthly income 3.9 million on sale UGX 400 million',
    captionHash: 'new',
    phoneDigits: '768524008',
    area: 'Namugongo',
    price: 400000000
  }, [augustRow]);
  assert.strictEqual(decision, null);
});

test('the same advert sent again is still a repeat', () => {
  const decision = decideIntakeRepeat({
    caption: 'Namugongo 2 houses in same compound, each 2 bedrooms 2 bathrooms on sale UGX 400m',
    captionHash: 'new',
    phoneDigits: '768524008',
    area: 'Namugongo',
    price: 400000000
  }, [augustRow]);
  assert(decision && decision.match_type === 'duplicate');
});

test('a short caption with no description still matches on phone, area and price', () => {
  assert.strictEqual(captionsDescribeDifferentListings('Namugongo 400m', augustRow.source_caption), false);
});

test('repeats are named in the batch, once each', () => {
  const data = {};
  noteEmployeeBatchDuplicate(data, 'Kira Kitukutwe 4 bedrooms house on 100 by 100 plot private mailo title UGX 285 million', { id: '08f29aca-7e92-401f-ad90-f8636830e88c', status: 'approved' });
  noteEmployeeBatchDuplicate(data, 'Kira Kitukutwe again', { id: '08f29aca-7e92-401f-ad90-f8636830e88c', status: 'approved' });
  const lines = employeeBatchDuplicateLines(data);
  assert.strictEqual(lines.length, 1);
  assert(/already live \(ref 08F29ACA\)/.test(lines[0]));
});

test('video text reading is skipped when there is a caption or no video', async () => {
  assert.deepStrictEqual(await captionPendingVideosFromOnScreenText({ data: { pending_property_caption: 'x' } }), []);
  assert.deepStrictEqual(await captionPendingVideosFromOnScreenText({ data: { pending_property_media: [{ url: 'https://media.makaug.com/a.jpg', mimeType: 'image/jpeg' }] } }), []);
});

test('the clearest line of on-screen text becomes the caption', () => {
  const raw = [
    'i acre Mutundwe near Victoria Primary school = = op uexiag - billion...0768524008',
    'SE LE Nictorian ary school UGX 14 4 billion...0768524008 pr',
    'One acre Mutundwe near Victoria Primary school uex 1.4 billion...0768524008',
    '= Shans oe 26 we Pl LS in yal Cp i ee 9 oul'
  ].join('\n');
  const best = bestCaptionFromOnScreenText(raw, {});
  assert(best, 'a caption should be found');
  assert(/Mutundwe/.test(best.text));
  assert.strictEqual(best.facts.locationPatch.area, 'Mutundwe');
});

test('scenery noise gives no caption', () => {
  assert.strictEqual(bestCaptionFromOnScreenText('Da. EN _ 7, RCN Fae CTU GS\nCNN TR CON Sigel =n Ce', {}), null);
});
