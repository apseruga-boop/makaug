'use strict';

// Boot ticks used to land together (X, YouTube and the marketplace drip all
// at about five seconds). Each delay is unique and at least 20 seconds apart
// so a deploy does not start every scan in the same second.
const BOOT_DELAY_MS = Object.freeze({
  marketplace_cache: 20_000,
  marketplace_drip: 50_000,
  x_source_drip: 80_000,
  youtube_source_drip: 110_000,
  marketplace_lifecycle: 140_000,
  featured_rotation: 170_000,
  pay_link: 200_000,
  lead_desk: 230_000,
  billing: 260_000,
  greeting_names: 290_000,
  video_stills: 600_000
});

module.exports = { BOOT_DELAY_MS };
