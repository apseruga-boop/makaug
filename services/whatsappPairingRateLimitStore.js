'use strict';

const fs = require('fs');
const path = require('path');

function createWhatsappPairingRateLimitStore(options = {}) {
  const profileDir = path.resolve(String(options.profileDir || '.'));
  const refreshNonce = String(options.refreshNonce || '').trim();
  const stateFile = path.join(profileDir, '.makaug-pairing-rate-limit.json');

  function read() {
    try {
      const parsed = JSON.parse(String(fs.readFileSync(stateFile, 'utf8') || '{}'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_error) {
      return null;
    }
  }

  return {
    isBlocked() {
      const state = read();
      if (!state) return false;
      return !refreshNonce || String(state.refresh_nonce || '') === refreshNonce;
    },
    mark() {
      const existing = read();
      if (existing && String(existing.refresh_nonce || '') === refreshNonce) return;
      fs.mkdirSync(profileDir, { recursive: true });
      fs.writeFileSync(stateFile, JSON.stringify({
        blocked_at: new Date().toISOString(),
        refresh_nonce: refreshNonce || null
      }), { mode: 0o600 });
    },
    clear() {
      try {
        fs.unlinkSync(stateFile);
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    },
    stateFile
  };
}

module.exports = {
  createWhatsappPairingRateLimitStore
};
