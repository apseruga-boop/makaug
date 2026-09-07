'use strict';

const assert = require('assert');
const {
  createWhatsappPairingRecovery,
  normalizeRetryMs
} = require('../services/whatsappPairingRecovery');

assert.strictEqual(normalizeRetryMs(1), 60_000, 'pairing retries must never spin faster than once per minute');
assert.strictEqual(normalizeRetryMs(60 * 60 * 1000), 30 * 60 * 1000, 'pairing retries must remain bounded');

const recovery = createWhatsappPairingRecovery({ retryMs: 10 * 60 * 1000 });
assert.strictEqual(recovery.plan({ now: 1_000, waitingForLogin: true }).shouldAttempt, true, 'first login recovery must run immediately');

const backedOff = recovery.plan({ now: 31_000, waitingForLogin: true });
assert.strictEqual(backedOff.shouldAttempt, false, 'heartbeat must not resubmit phone pairing');
assert.strictEqual(backedOff.state, 'pairing_retry_backoff');
assert.strictEqual(backedOff.retryAfterMs, 570_000);

const stableCode = recovery.plan({ now: 700_000, waitingForLogin: true, pairingCodeVisible: true });
assert.strictEqual(stableCode.shouldAttempt, false, 'a visible code must remain stable for the operator');
assert.strictEqual(stableCode.state, 'pairing_code_visible');

const rateLimited = recovery.plan({ now: 700_000, waitingForLogin: true, pairingRateLimited: true });
assert.strictEqual(rateLimited.shouldAttempt, false, 'the worker must not retry while WhatsApp has rate limited device linking');
assert.strictEqual(rateLimited.state, 'pairing_rate_limited');

assert.strictEqual(recovery.plan({ now: 700_000, waitingForLogin: false }).state, 'not_waiting_for_login');
assert.strictEqual(recovery.plan({ now: 701_000, waitingForLogin: true }).shouldAttempt, true, 'a later logout must start a fresh recovery immediately');

console.log('WhatsApp phone-pairing recovery backoff ok');
