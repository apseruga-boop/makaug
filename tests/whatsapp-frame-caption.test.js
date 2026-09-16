'use strict';

/**
 * Guards on reading a caption out of a listing frame.
 *
 * The dangerous failure here is not a missed read — it is an invented one. A
 * guessed price on a real listing reaches buyers. These cover the paths that
 * decide whether anything is returned at all, without needing a vision call.
 */

const assert = require('assert');

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const { readListingCaptionFromFrame } = require('../services/aiService');

(async () => {
  const nothing = await readListingCaptionFromFrame({});
  assert.strictEqual(nothing.found, false, 'no frame -> nothing found');
  assert.strictEqual(nothing.caption, '', 'no frame -> no caption');
  assert.strictEqual(nothing.reason, 'frame_missing');
  assert.strictEqual(nothing.price_text, null, 'no frame -> never a price');
  console.log('✓ a missing frame yields nothing, never a guess');

  for (const bad of ['not-a-data-url', 'data:text/plain;base64,aGk=', 'data:video/mp4;base64,AAAA', '']) {
    const r = await readListingCaptionFromFrame({ imageDataUrl: bad });
    assert.strictEqual(r.found, false, `rejected: ${bad.slice(0, 24)}`);
    assert.strictEqual(r.reason, 'frame_missing');
  }
  console.log('✓ non-image payloads are rejected before any vision call');

  // Oversized frames must be refused rather than silently truncated.
  const huge = `data:image/jpeg;base64,${'A'.repeat(4_400_000)}`;
  const big = await readListingCaptionFromFrame({ imageDataUrl: huge });
  assert.strictEqual(big.found, false, 'oversized frame refused');
  assert.strictEqual(big.reason, 'frame_too_large');
  console.log('✓ an oversized frame is refused, not truncated');

  // With no provider configured the answer is "unavailable", never a fabrication.
  const ok = `data:image/jpeg;base64,${'A'.repeat(2048)}`;
  const noProvider = await readListingCaptionFromFrame({ imageDataUrl: ok });
  assert.strictEqual(noProvider.found, false, 'no provider -> nothing found');
  assert.ok(
    ['vision_provider_unavailable', 'frame_read_failed', 'no_text_found'].includes(noProvider.reason),
    `expected a safe reason, got ${noProvider.reason}`
  );
  assert.strictEqual(noProvider.price_text, null, 'never a price without a real read');
  assert.strictEqual(noProvider.listing_type, null, 'never a listing type without a real read');
  console.log('✓ an unavailable provider returns nothing rather than a fabricated listing');

  console.log('\nFrame caption guard tests passed.');
})().catch((err) => { console.error('✗', err); process.exit(1); });
