const assert = require('assert');

const {
  normalizeSourceUrl,
  uniqueNormalizedSourceUrls,
} = require('../utils/sourceUrlNormalization');

assert.strictEqual(
  normalizeSourceUrl('https://www.tiktok.com/@SomeAgent/video/7521234567890?is_from_webapp=1&utm_source=x'),
  'https://www.tiktok.com/@someagent/video/7521234567890',
  'TikTok video URLs should collapse to the canonical @handle/video/id form'
);

assert.strictEqual(
  normalizeSourceUrl('https://youtu.be/abc123XYZ?t=30'),
  'https://www.youtube.com/watch?v=abc123XYZ',
  'youtu.be URLs should collapse to canonical watch URLs'
);

assert.strictEqual(
  normalizeSourceUrl('https://twitter.com/MakaugAgent/status/123456789?s=20'),
  'https://x.com/makaugagent/status/123456789',
  'Twitter status URLs should collapse to x.com status URLs'
);

assert.deepStrictEqual(
  uniqueNormalizedSourceUrls([
    'https://www.tiktok.com/@SomeAgent/video/7521234567890?utm_source=a',
    'https://www.tiktok.com/@someagent/video/7521234567890?utm_source=b',
  ]),
  ['https://www.tiktok.com/@someagent/video/7521234567890'],
  'duplicate source URL variants should collapse to one suppression key'
);

console.log('source URL normalization tests passed');
