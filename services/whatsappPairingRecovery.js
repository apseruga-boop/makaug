'use strict';

function normalizeRetryMs(value, fallback = 10 * 60 * 1000) {
  const parsed = Number(value);
  const candidate = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(30 * 60 * 1000, Math.max(60 * 1000, candidate));
}

function createWhatsappPairingRecovery(options = {}) {
  const retryMs = normalizeRetryMs(options.retryMs);
  let lastAttemptAt = 0;

  return {
    plan({
      now = Date.now(),
      waitingForLogin = false,
      pairingCodeVisible = false,
      pairingRateLimited = false
    } = {}) {
      if (!waitingForLogin) {
        lastAttemptAt = 0;
        return { shouldAttempt: false, state: 'not_waiting_for_login', retryAfterMs: 0 };
      }

      if (pairingRateLimited) {
        return { shouldAttempt: false, state: 'pairing_rate_limited', retryAfterMs: 0 };
      }

      if (pairingCodeVisible) {
        return { shouldAttempt: false, state: 'pairing_code_visible', retryAfterMs: 0 };
      }

      const elapsedMs = lastAttemptAt ? Math.max(0, now - lastAttemptAt) : retryMs;
      if (!lastAttemptAt || elapsedMs >= retryMs) {
        lastAttemptAt = now;
        return { shouldAttempt: true, state: 'pairing_attempt_due', retryAfterMs: 0 };
      }

      return {
        shouldAttempt: false,
        state: 'pairing_retry_backoff',
        retryAfterMs: Math.max(0, retryMs - elapsedMs)
      };
    },
    reset() {
      lastAttemptAt = 0;
    },
    retryMs
  };
}

module.exports = {
  createWhatsappPairingRecovery,
  normalizeRetryMs
};
