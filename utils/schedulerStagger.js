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
  agent_booking: 320_000,
  video_stills: 600_000,
  // After the harvest ticks. Startup repairs and the WhatsApp sweepers used
  // to fire in the first minute, on top of a deploy's migrations and the
  // still-running previous instance.
  startup_data_repairs: 620_000,
  whatsapp_media_retry: 640_000,
  whatsapp_batch_summary: 680_000
});

// Two instances overlap for a few minutes on a Render deploy. A pid offset
// keeps this process's first ticks from landing on the same second as the
// other instance's.
function deployJitterMs() {
  return (process.pid % 5) * 3_000;
}

function staggeredBootDelay(name) {
  const base = BOOT_DELAY_MS[name];
  if (!Number.isFinite(base)) throw new Error(`Unknown scheduler boot delay: ${name}`);
  return base + deployJitterMs();
}

module.exports = { BOOT_DELAY_MS, deployJitterMs, staggeredBootDelay };
