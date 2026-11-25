'use strict';

const desk = require('../services/staffDesk');
const pipe = require('../services/staffPipeline');
const leadsDesk = require('../services/staffLeads');
const teamHub = require('../services/teamHub');
const teamLearnings = require('../services/teamLearnings');

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
  router.get('/desk/home', wrap(async (req, res) => {
    const pk = personFor(req);
    if (!pk && isKing(req)) return res.json({ ok: true, data: { king_view: true, me: { first_name: 'King', name: 'King', scope: '', king: true, photo: '' }, profile_missing: [] } });
    return res.json({ ok: true, data: await desk.home(pk) });
  }));
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
  // 3b pipeline pages. Writes always act as the signed-in person.
  const scopeOf = (req) => { const u = req.userAuth || {}; const p = u.profile_data && typeof u.profile_data === 'object' ? u.profile_data : {}; return String(p.staff_scope || ''); };
  const needMe = (req) => { const pk = me(req).personKey; if (!pk) { const e = new Error('Your login has no calling name yet. Ask King.'); e.status = 403; throw e; } return pk; };
  router.get('/desk/owed', wrap(async (req, res) => res.json({ ok: true, data: await pipe.owed(personFor(req)) })));
  router.post('/desk/owed/:id', wrap(async (req, res) => res.json({ ok: true, data: await pipe.lateOutcome(needMe(req), req.params.id, req.body || {}) })));
  router.get('/desk/pipeline', wrap(async (req, res) => res.json({ ok: true, data: await pipe.pipeline(personFor(req)) })));
  router.get('/desk/approve', wrap(async (req, res) => res.json({ ok: true, data: await pipe.toApprove(personFor(req), { caller: !isKing(req) && scopeOf(req) === 'caller' }) })));
  // Opened on a call, waiting for their Hi (Arthur, 25 Nov 2026: King listed them, the staff desk said 0).
  router.get('/desk/approve/awaiting-hi', wrap(async (req, res) => res.json({ ok: true, data: await pipe.toApprove(personFor(req), { caller: !isKing(req) && scopeOf(req) === 'caller', awaitingHi: true }) })));
  router.get('/desk/owes', wrap(async (req, res) => res.json({ ok: true, data: await pipe.owes(personFor(req)) })));
  router.post('/desk/owes/:id/chase', wrap(async (req, res) => res.json({ ok: true, data: await pipe.chase(needMe(req), req.params.id, { note: req.body?.note }) })));
  router.get('/desk/missed', wrap(async (req, res) => res.json({ ok: true, data: await pipe.missed(personFor(req)) })));
  router.post('/desk/missed/wa/:id/call-back', wrap(async (req, res) => res.json({ ok: true, data: await pipe.takeWhatsappMissed(needMe(req), req.params.id) })));
  // Sidebar badges (Arthur, 22 Nov 2026): each count comes from the same function as its page.
  router.get('/desk/badges', wrap(async (req, res) => {
    const pk = personFor(req);
    const caller = !isKing(req) && scopeOf(req) === 'caller';
    const calling = require('../services/callingScreen');
    const [queue, due, approve, owes, missed, owed] = await Promise.all([
      pk ? calling.queueCounts(pk).catch(() => null) : Promise.resolve(null),
      pipe.followUpsDue(pk).catch(() => 0),
      pipe.toApprove(pk, { caller }).catch(() => []),
      pipe.owes(pk).catch(() => ({ items: [] })),
      pipe.missed(pk).catch(() => []),
      pipe.owed(pk).catch(() => [])
    ]);
    const toCall = queue ? Object.entries(queue).filter(([k]) => !['housekeeping', 'international'].includes(k)).reduce((t, [, v]) => t + (Number(v) || 0), 0) : null;
    return res.json({ ok: true, data: {
      to_call: toCall, follow_ups_due: due, approve: approve.length, owes: (owes.items || []).length,
      missed: missed.filter((m) => !m.called_back_at).length, missed_whatsapp: missed.filter((m) => m.source === 'whatsapp' && !m.called_back_at).length,
      outcome_owed: owed.length, king_view: isKing(req) && !pk, at: new Date().toISOString()
    } });
  }));
  router.post('/desk/missed', wrap(async (req, res) => res.status(201).json({ ok: true, data: await pipe.logMissed(needMe(req), req.body || {}) })));
  router.post('/desk/missed/:id/dismiss', wrap(async (req, res) => res.json({ ok: true, data: await pipe.dismissMissed(needMe(req), req.params.id) })));
  // Staff Leads & WhatsApp (read only). Callers do not get this page.
  const leadUser = (req) => {
    if (!isKing(req) && scopeOf(req) === 'caller') { const e = new Error('Your login is for the calling screen only.'); e.status = 403; throw e; }
    const u = req.userAuth || {};
    return { userId: String(u.id || req.adminAuth?.userId || req.staffAuth?.userId || '') || null, name: me(req).name, king: isKing(req) };
  };
  router.get('/desk/leads', wrap(async (req, res) => res.json({ ok: true, data: await leadsDesk.desk(leadUser(req), { filter: String(req.query?.filter || 'action') }) })));
  router.post('/desk/leads/from-chat', wrap(async (req, res) => res.status(201).json({ ok: true, data: await leadsDesk.addFromChat(leadUser(req), req.body?.message_id) })));
  router.post('/desk/leads/:key/outcome', wrap(async (req, res) => res.json({ ok: true, data: await leadsDesk.outcome(leadUser(req), req.params.key, req.body || {}) })));
  // Team hub (ops 3c): King's messages to the team or to me, Rules, T&Cs, Working hours, how-to videos. Read only, plus "Got it".
  router.get('/desk/hub', wrap(async (req, res) => res.json({ ok: true, data: await teamHub.staffHub(me(req).userId) })));
  router.post('/desk/hub/read', wrap(async (req, res) => res.json({ ok: true, data: await teamHub.markRead(me(req).userId, req.body?.ids) })));
  // Rejections & lessons (ops 3c part 2): team counts (no names or numbers), approved lessons, my suggestions.
  router.get('/desk/lessons', wrap(async (req, res) => res.json({ ok: true, data: await teamLearnings.staffView({ userId: me(req).userId }) })));
  router.post('/desk/lessons', wrap(async (req, res) => res.status(201).json({ ok: true, data: await teamLearnings.suggest({ userId: me(req).userId, name: me(req).name, king: false }, req.body || {}) })));
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
