'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createWhatsappPairingRateLimitStore } = require('../services/whatsappPairingRateLimitStore');

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-whatsapp-pairing-'));

try {
  const firstNonce = createWhatsappPairingRateLimitStore({ profileDir, refreshNonce: 'nonce-1' });
  assert.strictEqual(firstNonce.isBlocked(), false, 'a fresh profile must allow its first pairing attempt');

  firstNonce.mark();
  assert.strictEqual(firstNonce.isBlocked(), true, 'a provider rate limit must block further attempts');
  assert.strictEqual(fs.existsSync(firstNonce.stateFile), true, 'the provider block must be persisted on profile disk');

  const afterRestart = createWhatsappPairingRateLimitStore({ profileDir, refreshNonce: 'nonce-1' });
  assert.strictEqual(afterRestart.isBlocked(), true, 'the provider block must survive a worker restart');

  const operatorRefresh = createWhatsappPairingRateLimitStore({ profileDir, refreshNonce: 'nonce-2' });
  assert.strictEqual(operatorRefresh.isBlocked(), false, 'a new operator refresh nonce must permit exactly one fresh attempt');
  operatorRefresh.mark();
  assert.strictEqual(operatorRefresh.isBlocked(), true, 'a failed operator refresh must persist the new provider block');

  operatorRefresh.clear();
  assert.strictEqual(operatorRefresh.isBlocked(), false, 'a successful login must clear the provider block');
} finally {
  fs.rmSync(profileDir, { recursive: true, force: true });
}

console.log('WhatsApp pairing rate-limit persistence ok');
