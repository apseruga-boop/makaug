const jwt = require('jsonwebtoken');

const db = require('../config/database');

async function isAdminBearerToken(req) {
  const authHeader = req.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token || !process.env.JWT_SECRET) return false;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded?.sub;
    if (!userId) return false;

    const result = await db.query(
      'SELECT id, role, status FROM users WHERE id = $1 LIMIT 1',
      [userId]
    );
    const user = result.rows[0];
    if (user?.role !== 'admin' || user?.status !== 'active') return false;

    req.adminAuth = { type: 'bearer', userId: user.id };
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

module.exports = {
  hasAdminAccess,
  requireAdminApiKey,
  requireSuperAdminKey
};
