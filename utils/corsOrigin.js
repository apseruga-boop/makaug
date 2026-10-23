'use strict';

// Anonymous analytics (web-vitals) is posted from makaug.com, www, and from
// browsers that send no Origin or the literal "null" (opaque documents).
// A listed CORS_ORIGINS value, localhost, and the tenant apex/www/subdomain
// are allowed. When CORS_ORIGINS is empty, every origin is allowed, which is
// the previous behaviour for an unconfigured process.

function normalizedOrigin(origin) {
  return String(origin || '').trim().replace(/\/+$/, '');
}

function tenantApex(tenantHost = '') {
  return String(tenantHost || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
}

function isAllowedCorsOrigin(origin, { allowedOrigins = [], tenantHost = '' } = {}) {
  if (origin == null || origin === '' || origin === 'null') return true;
  const list = (Array.isArray(allowedOrigins) ? allowedOrigins : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (!list.length) return true;
  const normalized = normalizedOrigin(origin);
  if (list.includes(String(origin).trim()) || list.includes(normalized)) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(normalized)) return true;
  const apex = tenantApex(tenantHost);
  if (!apex) return false;
  const escaped = apex.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^https?:\\/\\/(?:(?:[a-z0-9-]+\\.)*)?${escaped}(?::\\d+)?$`, 'i').test(normalized);
}

module.exports = { isAllowedCorsOrigin };
