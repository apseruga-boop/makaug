'use strict';

/**
 * One-time staff setup links (King makes them in Staff Performance → Calling →
 * Logins). Public on purpose: the 256-bit token in the link is the proof, it
 * works once and only for 48 hours, and only its SHA-256 hash is stored.
 */
const express = require('express');
const extras = require('../services/callingExtras');

const router = express.Router();
const tries = new Map(); // simple per-IP brake: 20 attempts / 10 min

router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Robots-Tag', 'noindex');
  const ip = req.ip || 'x';
  const now = Date.now();
  const t = (tries.get(ip) || []).filter((x) => now - x < 600000);
  t.push(now);
  tries.set(ip, t);
  if (t.length > 20) return res.status(429).json({ ok: false, error: 'Too many tries. Wait 10 minutes.' });
  return next();
});

const wrap = (fn) => async (req, res, next) => {
  try { return await fn(req, res); } catch (e) {
    if (e.status) return res.status(e.status).json({ ok: false, error: e.message });
    return next(e);
  }
};

router.get('/:token', wrap(async (req, res) => res.json({ ok: true, data: await extras.checkSetup(req.params.token) })));
router.post('/:token', express.json({ limit: '4kb' }), wrap(async (req, res) => res.json({ ok: true, data: await extras.completeSetup(req.params.token, req.body?.password) })));

module.exports = router;
