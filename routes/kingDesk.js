'use strict';

const king = require('../services/kingDesk');

/**
 * King desk pages (King only). These paths are not in
 * utils/staffSharedKingTools.js, so staff logins never reach them; the guard
 * below also refuses a moderator token outright.
 */
function registerKingDeskRoutes(router) {
  const isKing = (req) => Boolean(req.adminAuth && req.adminAuth.type !== 'moderator');
  const wrap = (fn) => async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      if (!isKing(req)) return res.status(403).json({ ok: false, error: 'King only.' });
      return await fn(req, res);
    } catch (error) {
      if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
      return next(error);
    }
  };
  router.get('/king/overview', wrap(async (req, res) => res.json({ ok: true, data: await king.overview() })));
  router.get('/king/payments', wrap(async (req, res) => res.json({ ok: true, data: await king.payments({ days: req.query?.days }) })));
}

module.exports = { registerKingDeskRoutes };
