const jwt = require('jsonwebtoken');

const db = require('../config/database');

function authenticationError(message = 'Invalid token') {
  const error = new Error(message);
  error.code = 'AUTH_TOKEN_INVALID';
  error.status = 401;
  return error;
}

function transientAuthenticationBackendError(error) {
  const wrapped = new Error('Authentication service is temporarily unavailable');
  wrapped.code = 'AUTH_BACKEND_UNAVAILABLE';
  wrapped.status = 503;
  wrapped.cause = error;
  return wrapped;
}

function isAuthBackendUnavailable(error) {
  return error?.code === 'AUTH_BACKEND_UNAVAILABLE';
}

// A database that briefly refuses or drops connections (a restart, a failover,
// a full pool) usually comes back within a second. These are worth a retry;
// anything else (a bad query, a missing column) is not.
const TRANSIENT_DB_CODES = new Set([
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN',
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now (starting up)
  '53300', // too_many_connections
  '08000', '08001', '08003', '08004', '08006' // connection exceptions
]);
const TRANSIENT_DB_MESSAGE = /Connection terminated|timeout exceeded when trying to connect|connection refused|ECONNREFUSED|server closed the connection/i;

function isTransientDbError(error) {
  if (!error) return false;
  if (TRANSIENT_DB_CODES.has(error.code)) return true;
  if (Array.isArray(error.errors) && error.errors.some(isTransientDbError)) return true;
  return TRANSIENT_DB_MESSAGE.test(String(error.message || ''));
}

const AUTH_DB_ATTEMPTS = 3;
const AUTH_RETRY_AFTER_SECONDS = '5';

function authRetryBaseMs() {
  const value = Number(process.env.AUTH_DB_RETRY_BASE_MS);
  return Number.isFinite(value) && value >= 0 ? Math.min(value, 1000) : 150;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Two short waits (150 ms, then 450 ms): under a second in all, so a sign-in
// rides out a blip instead of failing, and a real outage answers 503 quickly.
async function queryUserWithRetry(userId) {
  const baseMs = authRetryBaseMs();
  let lastError;
  for (let attempt = 1; attempt <= AUTH_DB_ATTEMPTS; attempt += 1) {
    try {
      return await db.query(
        'SELECT id, first_name, last_name, phone, email, role, status, preferred_language, preferred_contact_channel, profile_data FROM users WHERE id = $1 LIMIT 1',
        [userId]
      );
    } catch (error) {
      lastError = error;
      if (!isTransientDbError(error) || attempt === AUTH_DB_ATTEMPTS) break;
      await sleep(baseMs * (3 ** (attempt - 1)));
    }
  }
  throw transientAuthenticationBackendError(lastError);
}

function sendAuthUnavailable(res) {
  res.set('Retry-After', AUTH_RETRY_AFTER_SECONDS);
  return res.status(503).json({
    ok: false,
    error: 'Sign-in is briefly unavailable. Please try again in a few seconds.',
    code: 'AUTH_BACKEND_UNAVAILABLE'
  });
}

function isAuthenticationError(error) {
  return error?.code === 'AUTH_TOKEN_INVALID'
    || ['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError'].includes(error?.name);
}

function tokenFromRequest(req) {
  const authHeader = req.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7);

  const cookieHeader = req.headers?.cookie || '';
  const cookies = String(cookieHeader || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const idx = part.indexOf('=');
      if (idx === -1) return acc;
      acc[decodeURIComponent(part.slice(0, idx).trim())] = decodeURIComponent(part.slice(idx + 1).trim());
      return acc;
    }, {});
  return cookies.makaug_auth_token || '';
}

async function loadActiveUserFromToken(req) {
  const token = tokenFromRequest(req);
  if (!token || !process.env.JWT_SECRET) return null;

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (_error) {
    throw authenticationError('Invalid or expired token');
  }
  const userId = decoded?.sub;
  if (!userId) throw authenticationError('Invalid token');

  const result = await queryUserWithRetry(userId);
  const user = result.rows[0];
  if (!user || user.status !== 'active') return null;
  return user;
}

async function isAdminBearerToken(req) {
  try {
    const user = await loadActiveUserFromToken(req);
    if (!['admin', 'super_admin'].includes(user?.role)) return false;

    req.adminAuth = { type: 'bearer', userId: user.id, role: user.role };
    req.userAuth = user;
    return true;
  } catch (_error) {
    if (!isAuthenticationError(_error)) throw _error;
    return false;
  }
}

// Staff and admin keep the listing itself. A public visitor does not.
// An invalid token is not staff. A database failure is thrown so the caller
// can still send the visitor to the area page.
async function hasStaffOrAdminAccess(req) {
  const headerKey = req.get('x-api-key');
  const expected = process.env.ADMIN_API_KEY;
  if (expected && headerKey === expected) {
    req.adminAuth = { type: 'api_key' };
    return true;
  }
  try {
    const user = await loadActiveUserFromToken(req);
    if (!user || !isStaffRole(user.role)) return false;
    req.userAuth = user;
    if (['admin', 'super_admin'].includes(String(user.role || '').toLowerCase())) {
      req.adminAuth = { type: 'bearer', userId: user.id, role: user.role };
    } else {
      req.staffAuth = { userId: user.id, role: user.role };
    }
    return true;
  } catch (error) {
    if (!isAuthenticationError(error)) throw error;
    return false;
  }
}

async function hasAdminAccess(req) {
  const headerKey = req.get('x-api-key');
  const expected = process.env.ADMIN_API_KEY;

  if (expected && headerKey === expected) {
    req.adminAuth = { type: 'api_key' };
    return true;
  }

  return isAdminBearerToken(req);
}

function requireAdminApiKey(req, res, next) {
  Promise.resolve(requireAdminAccess(req, res, next)).catch(next);
}

async function requireAdminAccess(req, res, next) {
  let allowed;
  try {
    allowed = await hasAdminAccess(req);
  } catch (error) {
    if (isAuthBackendUnavailable(error)) return sendAuthUnavailable(res);
    throw error;
  }
  if (allowed) {
    return next();
  }

  return res.status(401).json({
    ok: false,
    error: 'Unauthorized'
  });
}

function requireSuperAdminKey(req, res, next) {
  const headerKey = req.get('x-super-admin-key');
  const expected = process.env.SUPER_ADMIN_KEY;

  if (!expected) {
    return res.status(500).json({
      ok: false,
      error: 'SUPER_ADMIN_KEY is not configured on server'
    });
  }

  if (!headerKey || headerKey !== expected) {
    return res.status(401).json({
      ok: false,
      error: 'Unauthorized'
    });
  }

  return next();
}

async function requireAuthenticatedUser(req, res, next) {
  try {
    const user = await loadActiveUserFromToken(req);
    if (!user) return res.status(401).json({ ok: false, error: 'Sign in required' });
    req.userAuth = user;
    return next();
  } catch (_error) {
    // A database blip is not a signed-out user: 401 here makes the app drop
    // the session, so answer 503 and let the client try again.
    if (isAuthBackendUnavailable(_error)) return sendAuthUnavailable(res);
    return res.status(401).json({ ok: false, error: 'Sign in required' });
  }
}

function isStaffRole(role = '') {
  return ['moderator', 'admin', 'super_admin'].includes(String(role || '').toLowerCase());
}

async function requireStaffAccess(req, res, next) {
  try {
    const user = await loadActiveUserFromToken(req);
    if (!user || !isStaffRole(user.role)) {
      return res.status(403).json({ ok: false, error: 'Staff access required' });
    }
    req.userAuth = user;
    req.staffAuth = { userId: user.id, role: user.role };
    return next();
  } catch (_error) {
    if (isAuthBackendUnavailable(_error)) return sendAuthUnavailable(res);
    if (!isAuthenticationError(_error)) return next(_error);
    return res.status(401).json({ ok: false, error: 'Sign in required' });
  }
}

// Every await is inside the try. An await outside it used to reject the
// middleware's promise when the database refused a connection; Express 4 does
// not catch that, so it became an unhandled rejection and stopped the server.
async function requireListingModerationAccess(req, res, next) {
  try {
    if (await hasAdminAccess(req)) return next();
    const user = await loadActiveUserFromToken(req);
    if (!user || user.role !== 'moderator') {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    req.userAuth = user;
    req.adminAuth = { type: 'moderator', userId: user.id, role: user.role };
    return next();
  } catch (_error) {
    if (isAuthBackendUnavailable(_error)) return sendAuthUnavailable(res);
    if (!isAuthenticationError(_error)) return next(_error);
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
}

module.exports = {
  isTransientDbError,
  hasAdminAccess,
  hasStaffOrAdminAccess,
  isAuthenticationError,
  loadActiveUserFromToken,
  requireAdminApiKey,
  requireAuthenticatedUser,
  requireListingModerationAccess,
  requireStaffAccess,
  requireSuperAdminKey
};
