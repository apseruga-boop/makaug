'use strict';

// First-party device id for visitors without an account (26 Oct 2026, save
// journey fix). It is a random id in an HttpOnly cookie, so page scripts
// cannot read it and nothing else is stored in it. It is only set by the
// saves and alerts endpoints, never on page views.

const crypto = require('crypto');

const DEVICE_COOKIE_NAME = 'mk_did';
// Browsers cap cookie lifetime at 400 days.
const DEVICE_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

function parseCookieHeader(header = '') {
  return String(header || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const idx = part.indexOf('=');
      if (idx === -1) return acc;
      const key = part.slice(0, idx).trim();
      const raw = part.slice(idx + 1).trim();
      try {
        acc[decodeURIComponent(key)] = decodeURIComponent(raw);
      } catch (_error) {
        acc[key] = raw;
      }
      return acc;
    }, {});
}

function isValidDeviceId(value) {
  return DEVICE_ID_PATTERN.test(String(value || ''));
}

function newDeviceId() {
  return crypto.randomBytes(24).toString('base64url');
}

function readDeviceId(req) {
  const value = parseCookieHeader(req?.headers?.cookie || '')[DEVICE_COOKIE_NAME];
  return isValidDeviceId(value) ? value : '';
}

function deviceCookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(req?.secure) || req?.get?.('x-forwarded-proto') === 'https' || process.env.NODE_ENV === 'production',
    maxAge: DEVICE_COOKIE_MAX_AGE_MS,
    path: '/'
  };
}

// Returns the visitor's device id, creating one (and the cookie) when asked.
// The cookie is refreshed on every write so an active device keeps it.
function ensureDeviceId(req, res, { create = true } = {}) {
  let deviceId = readDeviceId(req);
  if (!deviceId && !create) return '';
  if (!deviceId) deviceId = newDeviceId();
  if (res && typeof res.cookie === 'function') {
    res.cookie(DEVICE_COOKIE_NAME, deviceId, deviceCookieOptions(req));
  }
  return deviceId;
}

module.exports = {
  DEVICE_COOKIE_MAX_AGE_MS,
  DEVICE_COOKIE_NAME,
  deviceCookieOptions,
  ensureDeviceId,
  isValidDeviceId,
  newDeviceId,
  parseCookieHeader,
  readDeviceId
};
