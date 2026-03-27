function requireAdminApiKey(req, res, next) {
  const headerKey = req.get('x-api-key');
  const expected = process.env.ADMIN_API_KEY;

  if (!expected) {
    return res.status(500).json({
      ok: false,
      error: 'ADMIN_API_KEY is not configured on server'
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
  requireAdminApiKey,
  requireSuperAdminKey
};
