'use strict';

const fs = require('fs');
const path = require('path');

function createWhatsappPairingRateLimitStore(options = {}) {
  const profileDir = path.resolve(String(options.profileDir || '.'));
  const refreshNonce = String(options.refreshNonce || '').trim();
  const stateFile = path.join(profileDir, '.makaug-pairing-rate-limit.json');
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const configuredCooldownMs = Number(options.cooldownMs);
  const cooldownMs = Number.isFinite(configuredCooldownMs) && configuredCooldownMs > 0
    ? configuredCooldownMs
    : 24 * 60 * 60 * 1000;

  function read() {
    try {
      const parsed = JSON.parse(String(fs.readFileSync(stateFile, 'utf8') || '{}'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_error) {
      return null;
    }
  }

  function isExpired(state) {
    const blockedAtMs = Date.parse(String(state?.blocked_at || ''));
    if (!Number.isFinite(blockedAtMs)) return true;
    return now() - blockedAtMs >= cooldownMs;
  }

  function clear() {
    try {
      fs.unlinkSync(stateFile);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  return {
    isBlocked() {
      const state = read();
      if (!state) return false;
      const sameRefreshWindow = !refreshNonce || String(state.refresh_nonce || '') === refreshNonce;
      if (!sameRefreshWindow) return false;
      if (!isExpired(state)) return true;
      clear();
      return false;
    },
    mark() {
      const existing = read();
      if (
        existing
        && String(existing.refresh_nonce || '') === refreshNonce
        && !isExpired(existing)
      ) return;
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify({
        blocked_at: new Date(now()).toISOString(),
        refresh_nonce: refreshNonce || null
      }), { mode: 0o600 });
    },
    clear,
    stateFile
  };
}

module.exports = {
  createWhatsappPairingRateLimitStore
};
