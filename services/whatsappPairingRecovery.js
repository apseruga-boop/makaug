'use strict';

function normalizeRetryMs(value, fallback = 10 * 60 * 1000) {
  const parsed = Number(value);
  const candidate = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(30 * 60 * 1000, Math.max(60 * 1000, candidate));
}

function createWhatsappPairingRecovery(options = {}) {
  const retryMs = normalizeRetryMs(options.retryMs);
  const requireOperatorRefresh = options.requireOperatorRefresh === true;
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

      // Production workers that have an operator refresh nonce must never
      // resubmit a phone number on a timer. A failed/stale pairing code can
      // otherwise turn into repeated device-link attempts and trigger
      // WhatsApp's provider cooldown. The caller handles a new nonce as the
      // single explicit attempt before consulting this recovery plan.
      if (requireOperatorRefresh) {
        return { shouldAttempt: false, state: 'operator_refresh_required', retryAfterMs: 0 };
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
    retryMs,
    requireOperatorRefresh
  };
}

module.exports = {
  createWhatsappPairingRecovery,
  normalizeRetryMs
};
