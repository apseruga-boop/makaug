'use strict';

// API rate limit (C4, 10 Oct 2026). One staff or admin dashboard load fires
// dozens of API calls, so two moderators on the same office Wi-Fi or mobile
// NAT shared one per-IP budget (1,000 per 15 minutes) and got "429 Too many
// requests" from the review queue during normal moderation. Signed-in staff
// and admins are now counted per user with a higher ceiling; anonymous traffic
// keeps the per-IP limit.

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { rateLimitClientKey } = require('./clientIp');

const WINDOW_MS = 15 * 60 * 1000;
const ANONYMOUS_MAX = 1000;
const STAFF_MAX = 5000;
const STAFF_ROLES = new Set(['moderator', 'admin', 'super_admin']);

function tokenFromRequest(req) {
  const header = String(req.get?.('authorization') || '');
  if (/^Bearer\s+/i.test(header)) return header.replace(/^Bearer\s+/i, '').trim();
  const match = String(req.get?.('cookie') || '').match(/(?:^|;\s*)makaug_auth_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

// { kind: 'staff', id } for a verified staff/admin token or the admin API key,
// otherwise null. Only a token signed with JWT_SECRET counts.
function staffIdentity(req) {
  if (req._rateLimitStaff !== undefined) return req._rateLimitStaff;
  let identity = null;
  const apiKey = req.get?.('x-api-key') || req.get?.('x-admin-api-key');
  if (apiKey && process.env.ADMIN_API_KEY && safeEqual(apiKey, process.env.ADMIN_API_KEY)) {
    identity = { kind: 'staff', id: 'admin-api-key' };
  } else {
    const token = tokenFromRequest(req);
    if (token && process.env.JWT_SECRET) {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        const role = String(payload?.role || '').toLowerCase();
        if (STAFF_ROLES.has(role) && payload?.sub) identity = { kind: 'staff', id: String(payload.sub) };
      } catch (_error) {
        identity = null;
      }
    }
  }
  req._rateLimitStaff = identity;
  return identity;
}

function apiRateLimitKey(req) {
  const staff = staffIdentity(req);
  return staff ? `staff:${staff.id}` : `ip:${rateLimitClientKey(req)}`;
}

function apiRateLimitMax(req) {
  return staffIdentity(req) ? STAFF_MAX : ANONYMOUS_MAX;
}

module.exports = {
  WINDOW_MS,
  ANONYMOUS_MAX,
  STAFF_MAX,
  apiRateLimitKey,
  apiRateLimitMax,
  staffIdentity
};
