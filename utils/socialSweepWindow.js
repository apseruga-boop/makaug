'use strict';

const DEFAULT_SOCIAL_SWEEP_LOOKBACK_DAYS = 30;

function socialSweepPublishedAfter(days = DEFAULT_SOCIAL_SWEEP_LOOKBACK_DAYS, now = Date.now()) {
  const lookbackDays = Math.max(1, Number.parseInt(days, 10) || DEFAULT_SOCIAL_SWEEP_LOOKBACK_DAYS);
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  return new Date(safeNowMs - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
}

module.exports = {
  DEFAULT_SOCIAL_SWEEP_LOOKBACK_DAYS,
  socialSweepPublishedAfter,
};
