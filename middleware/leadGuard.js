'use strict';

/**
 * Spam protection for public lead forms.
 *
 *  - Per-IP budget on top of the site-wide /api limiter. Ugandan mobile
 *    networks put many people behind one IP (carrier NAT), so the budgets are
 *    generous: they stop scripts, not busy households.
 *  - Honeypot: the forms carry a hidden "website" field people never see. A
 *    bot that fills it gets a normal-looking success and nothing is stored.
 *  - Length caps so one submission cannot carry a novel.
 */

const rateLimit = require('express-rate-limit');

const HONEYPOT_FIELDS = ['website', 'company_website', 'hp_field'];

function limiter(max, envName, windowMinutes = 15) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max: Number(process.env[envName] || 0) || max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'Too many submissions. Please try again in a few minutes.' }
  });
}

// Each router makes its own limiter, so the budget for listing enquiries is
// not shared with help, careers or advertising forms.
const createLeadFormLimiter = () => limiter(40, 'LEAD_FORM_RATE_LIMIT_MAX');
const createLeadClickLimiter = () => limiter(150, 'LEAD_CLICK_RATE_LIMIT_MAX');

const FIELD_CAPS = Object.freeze({
  contact_name: 120,
  name: 120,
  full_name: 120,
  guest_name: 120,
  contact_phone: 40,
  phone: 40,
  contact_email: 160,
  email: 160,
  message: 2000,
  requirements: 2000,
  notes: 2000
});

function leadHoneypot(req, res, next) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const tripped = HONEYPOT_FIELDS.some((field) => String(body[field] ?? '').trim() !== '');
  if (tripped) {
    // Look like success so the bot moves on; store nothing.
    return res.status(201).json({ ok: true, data: { id: null, received: true } });
  }
  for (const [field, cap] of Object.entries(FIELD_CAPS)) {
    if (typeof body[field] === 'string' && body[field].length > cap) {
      body[field] = body[field].slice(0, cap);
    }
  }
  return next();
}

module.exports = {
  HONEYPOT_FIELDS,
  createLeadClickLimiter,
  createLeadFormLimiter,
  leadHoneypot
};
