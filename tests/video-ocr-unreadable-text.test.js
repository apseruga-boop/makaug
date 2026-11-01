const test = require('node:test');
const assert = require('node:assert/strict');
const ocr = require('../services/videoCaptionOcrService');

// Noise read from drone footage on C08F2A, including the stray "3 Bn".
const NOISE = 'oe\n7% |\nie, 2 Hi\nDHRU es\neT\nREE SEE SEER\nRo a fc 5\nAE Bila Now LA PN\nBa el eT\n5 i RESET = ye\nSIRT Se dE 2\nGithLiGe\nTo 0 Bh\n3 Bn\nBEANE ie = ky\nTae Voles )\nST a 4 WET Deo y';
const REAL = 'LAND FOR SALE\n5 ACRES IN SSISA\nUGX 65 MILLION\nCALL 0700000000';

test('noise from field footage is not readable text', () => {
  assert.equal(ocr.ocrTextIsReadable(NOISE), false);
  assert.equal(ocr.ocrTextIsReadable(''), false);
});

test('a real price card is readable', () => {
  assert.equal(ocr.ocrTextIsReadable(REAL), true);
});

test('stored noisy records give no facts and do not block approval', () => {
  const record = { status: ocr.STATUS_DONE, ocr_text: NOISE, conflicts: [{ dimension: 'price', message: 'x' }] };
  assert.deepEqual(ocr.videoFactsForRecord(record), {});
  const decision = ocr.decideVideoCaptionApproval({ record, property: { price: 65000000, extra_fields: {} } });
  assert.equal(decision.blocked, false);
  const view = ocr.publicOcrView(record);
  assert.deepEqual(view.conflicts, []);
  assert.match(view.text, /no clear text/i);
});

test('unreadable status shows the note', () => {
  const view = ocr.publicOcrView({ status: ocr.STATUS_UNREADABLE, ocr_text: '' });
  assert.match(view.text, /no clear text/i);
});
