'use strict';

const desk = require('../services/staffDesk');

/**
 * Staff desk pages (Arthur, 21 Nov 2026). Shared with staff logins through
 * utils/staffSharedKingTools.js. A staff login always gets its own data: the
 * person key comes from the signed-in user, never from the request.
 */
function registerStaffDeskRoutes(router) {
  const isKing = (req) => Boolean(req.adminAuth && req.adminAuth.type !== 'moderator');
  const me = (req) => {
    const u = req.userAuth || {};
    const p = u.profile_data && typeof u.profile_data === 'object' ? u.profile_data : {};
    return { userId: String(u.id || req.staffAuth?.userId || ''), personKey: String(p.person_key || ''), name: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email || 'staff' };
  };
  const personFor = (req) => (isKing(req) && req.query?.person_key ? String(req.query.person_key) : me(req).personKey);
  const wrap = (fn) => async (req, res, next) => {
    try { res.set('Cache-Control', 'no-store'); return await fn(req, res); } catch (error) {
      if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
      return next(error);
    }
  };
  router.get('/desk/home', wrap(async (req, res) => res.json({ ok: true, data: await desk.home(personFor(req)) })));
  router.get('/desk/performance', wrap(async (req, res) => res.json({ ok: true, data: await desk.performance(personFor(req)) })));
  router.get('/desk/pay', wrap(async (req, res) => res.json({ ok: true, data: await desk.myPay(personFor(req)) })));
  router.get('/desk/profile', wrap(async (req, res) => {
    const m = me(req); if (!m.userId) return res.status(401).json({ ok: false, error: 'Sign in first.' });
    return res.json({ ok: true, data: await desk.profileOf(m.userId) });
  }));
  router.put('/desk/profile', wrap(async (req, res) => {
    const m = me(req); if (!m.userId) return res.status(401).json({ ok: false, error: 'Sign in first.' });
    return res.json({ ok: true, data: await desk.saveProfile(m.userId, m.personKey, req.body || {}, { actor: m.name }) });
  }));
  // King only: one staff member's full profile, ID number included.
  router.get('/king/staff/:id/profile', wrap(async (req, res) => {
    if (!isKing(req)) return res.status(403).json({ ok: false, error: 'King only.' });
    if (!/^[0-9a-f-]{36}$/i.test(String(req.params.id || ''))) return res.status(400).json({ ok: false, error: 'Invalid staff id.' });
    return res.json({ ok: true, data: await desk.profileOf(req.params.id, { king: true }) });
  }));
}

/**
 * Own data only: a staff login that has its own calling name can only ask the
 * calling routes about itself, whatever person_key it sends.
 */
function ownPersonOnly(req, _res, next) {
  const king = Boolean(req.adminAuth && req.adminAuth.type !== 'moderator');
  if (!king) {
    const p = req.userAuth && req.userAuth.profile_data && typeof req.userAuth.profile_data === 'object' ? req.userAuth.profile_data : {};
    const own = String(p.person_key || '');
    if (own) {
      if (req.query && Object.prototype.hasOwnProperty.call(req.query, 'person_key')) req.query.person_key = own;
      if (req.body && typeof req.body === 'object' && Object.prototype.hasOwnProperty.call(req.body, 'person_key')) req.body.person_key = own;
    }
  }
  return next();
}

module.exports = { registerStaffDeskRoutes, ownPersonOnly };
