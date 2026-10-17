'use strict';

const logger = require('../config/logger');

// Inbound WhatsApp photos used to run in the web process with no global cap:
// one number's burst kept every data URL alive, and other numbers ran beside it.
// Concurrency stays at 1 unless WHATSAPP_MEDIA_CONCURRENCY is set, and never
// above 2. A sender past the burst is delayed, not dropped.
//
// Moving download, vision, sharp and S3 onto makaug-whatsapp-ai-runtime is the
// longer split: the web process would ACK Meta and forward the inbound id and
// URL, that service would claim the row in Postgres, and the WhatsApp token
// plus S3 env would live there. This queue keeps the bytes out of a pile in
// the web process until that move.

const SENDER_WINDOW_MS = 80_000;

function senderBurstLimit() {
  return Math.max(1, parseInt(process.env.WHATSAPP_SENDER_BURST || '2', 10) || 2);
}

function senderDeferMs() {
  return Math.max(0, parseInt(process.env.WHATSAPP_SENDER_DEFER_MS || '1500', 10) || 1500);
}

let active = 0;
let peakActive = 0;
const waiters = [];
const senderArrivals = new Map();

function concurrencyLimit() {
  const requested = parseInt(process.env.WHATSAPP_MEDIA_CONCURRENCY || '1', 10) || 1;
  return Math.max(1, Math.min(2, requested));
}

function senderKey(phone = '') {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.slice(-12) || 'unknown';
}

function enqueueWhatsappMediaWork(fn) {
  return new Promise((resolve, reject) => {
    const start = () => {
      active += 1;
      peakActive = Math.max(peakActive, active);
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          active = Math.max(0, active - 1);
          const next = waiters.shift();
          if (next) next();
        });
    };
    if (active < concurrencyLimit()) start();
    else waiters.push(start);
  });
}

async function deferForSenderBurst(phone = '') {
  const key = senderKey(phone);
  const now = Date.now();
  const recent = (senderArrivals.get(key) || []).filter((at) => now - at < SENDER_WINDOW_MS);
  recent.push(now);
  senderArrivals.set(key, recent);
  if (recent.length <= senderBurstLimit()) return { deferred: false, count: recent.length };
  const overflow = recent.length - senderBurstLimit();
  const deferMs = Math.min(20_000, senderDeferMs() * overflow);
  logger.warn('WhatsApp media deferred for sender burst', { sender: key, overflow, defer_ms: deferMs });
  if (deferMs > 0) await new Promise((resolve) => setTimeout(resolve, deferMs));
  return { deferred: true, count: recent.length, defer_ms: deferMs };
}

function resetWhatsappMediaQueueForTests() {
  active = 0;
  peakActive = 0;
  waiters.length = 0;
  senderArrivals.clear();
}

function whatsappMediaQueueStats() {
  return { active, peakActive, waiting: waiters.length, concurrency: concurrencyLimit() };
}

module.exports = {
  enqueueWhatsappMediaWork,
  deferForSenderBurst,
  resetWhatsappMediaQueueForTests,
  whatsappMediaQueueStats,
  senderKey
};
