const jwt = require('jsonwebtoken');

const db = require('../config/database');

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

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const userId = decoded?.sub;
  if (!userId) return null;

  const result = await db.query(
    'SELECT id, first_name, last_name, phone, email, role, status, preferred_language, preferred_contact_channel, profile_data FROM users WHERE id = $1 LIMIT 1',
    [userId]
  );
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
  if (await hasAdminAccess(req)) {
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
    return res.status(401).json({ ok: false, error: 'Sign in required' });
  }
}

async function requireListingModerationAccess(req, res, next) {
  if (await hasAdminAccess(req)) return next();
  try {
    const user = await loadActiveUserFromToken(req);
    if (!user || user.role !== 'moderator') {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    req.userAuth = user;
    req.adminAuth = { type: 'moderator', userId: user.id, role: user.role };
    return next();
  } catch (_error) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
}

module.exports = {
  hasAdminAccess,
  requireAdminApiKey,
  requireAuthenticatedUser,
  requireListingModerationAccess,
  requireStaffAccess,
  requireSuperAdminKey
};
