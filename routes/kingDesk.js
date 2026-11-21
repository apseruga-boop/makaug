'use strict';

const king = require('../services/kingDesk');
const kingCalls = require('../services/kingCalls');
const kingStaff = require('../services/kingStaff');
const kingReview = require('../services/kingReview');
const teamHub = require('../services/teamHub');
const teamLearnings = require('../services/teamLearnings');

/**
 * King desk pages (King only). These paths are not in
 * utils/staffSharedKingTools.js, so staff logins never reach them; the guard
 * below also refuses a moderator token outright.
 */
function registerKingDeskRoutes(router, { writeAudit } = {}) {
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
  router.get('/king/calls/:id', wrap(async (req, res) => res.json({ ok: true, data: await kingCalls.callDetail(req.params.id) })));
  router.put('/king/calls/:id/lesson', wrap(async (req, res) => {
    const actor = (req.adminAuth && (req.adminAuth.email || req.adminAuth.name)) || 'King';
    return res.json({ ok: true, data: await kingCalls.saveLesson(req.params.id, { note: req.body?.note, actor }) });
  }));
  // Staff, pay & targets.
  const actorOf = (req) => { const u = req.userAuth || {}; return [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email || 'King'; };
  const originOf = (req) => { const host = req.get('host') || 'makaug.com'; return `${/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https'}://${host}`; };
  const audit = async (req, action, details) => { if (typeof writeAudit === 'function') await writeAudit(action, { ...details, by: actorOf(req) }, req.adminAuth?.userId || actorOf(req)); };
  // Team hub (ops 3c): messages to the team or one person, Rules, T&Cs, Working hours, how-to video slots.
  router.get('/king/hub', wrap(async (req, res) => res.json({ ok: true, data: await teamHub.kingHub() })));
  router.post('/king/hub/messages', wrap(async (req, res) => {
    const out = await teamHub.send(req.body || {}, { actor: actorOf(req) });
    await audit(req, 'king_team_message_sent', { id: out.id, audience: out.audience, kind: out.kind });
    return res.status(201).json({ ok: true, data: out });
  }));
  router.post('/king/hub/messages/:id/withdraw', wrap(async (req, res) => res.json({ ok: true, data: await teamHub.withdraw(req.params.id, { actor: actorOf(req) }) })));
  router.put('/king/hub/pages/:key', wrap(async (req, res) => {
    const out = await teamHub.savePage(String(req.params.key), req.body?.body, { actor: actorOf(req) });
    await audit(req, 'king_team_page_saved', { key: out.key });
    return res.json({ ok: true, data: out });
  }));
  router.put('/king/hub/videos/:id', wrap(async (req, res) => res.json({ ok: true, data: await teamHub.saveVideo(String(req.params.id) === 'new' ? 'new' : req.params.id, req.body || {}, { actor: actorOf(req) }) })));
  router.post('/king/hub/videos/:id/remove', wrap(async (req, res) => res.json({ ok: true, data: await teamHub.removeVideo(req.params.id, { actor: actorOf(req) }) })));
  // Rejections & lessons (ops 3c part 2): King approves, edits or declines the team's script suggestions.
  router.get('/king/lessons', wrap(async (req, res) => res.json({ ok: true, data: await teamLearnings.kingView() })));
  router.post('/king/lessons', wrap(async (req, res) => res.status(201).json({ ok: true, data: await teamLearnings.suggest({ userId: req.adminAuth?.userId || req.userAuth?.id || 'king', name: actorOf(req), king: true }, req.body || {}) })));
  router.post('/king/lessons/:id/decide', wrap(async (req, res) => {
    const out = await teamLearnings.decide(req.params.id, req.body || {}, { actor: actorOf(req) });
    await audit(req, 'king_lesson_' + out.status, { id: out.id });
    return res.json({ ok: true, data: out });
  }));
  router.get('/king/staff', wrap(async (req, res) => res.json({ ok: true, data: await kingStaff.list() })));
  router.post('/king/staff', wrap(async (req, res) => {
    const out = await kingStaff.addStaff(req.body || {}, { actor: actorOf(req), origin: originOf(req) });
    await audit(req, 'king_staff_added', { user_id: out.user_id, person_key: out.person_key, scope: out.scope });
    return res.status(201).json({ ok: true, data: out });
  }));
  router.post('/king/staff/:id/remove', wrap(async (req, res) => {
    const out = await kingStaff.removeStaff(req.params.id, { reason_code: req.body?.reason_code, reason: req.body?.reason, actor: actorOf(req) });
    await audit(req, 'king_staff_removed', { user_id: out.user_id, person_key: out.person_key, reason_code: req.body?.reason_code });
    return res.json({ ok: true, data: out });
  }));
  router.post('/king/staff/:id/reactivate', wrap(async (req, res) => {
    const out = await kingStaff.reactivateStaff(req.params.id, { actor: actorOf(req) });
    await audit(req, 'king_staff_reactivated', { user_id: out.user_id, person_key: out.person_key });
    return res.json({ ok: true, data: out });
  }));
  router.put('/king/staff/salary', wrap(async (req, res) => {
    const out = await kingStaff.setSalary(req.body?.person_key, { month: req.body?.month, salary_ugx: req.body?.salary_ugx, note: req.body?.note, actor: actorOf(req) });
    await audit(req, 'king_staff_salary_set', { person_key: out.person_key, month: out.month });
    return res.json({ ok: true, data: out });
  }));
  router.put('/king/staff/targets', wrap(async (req, res) => res.json({ ok: true, data: await kingStaff.setTargets(req.body?.targets, { actor: actorOf(req) }) })));
  router.post('/king/staff/targets/keep', wrap(async (req, res) => res.json({ ok: true, data: await kingStaff.keepTargetsForToday({ actor: actorOf(req) }) })));
  // Review queues: Found online to review / Agent properties to review.
  router.get('/king/review/counts', wrap(async (req, res) => res.json({ ok: true, data: await kingReview.counts() })));
  router.get('/king/review/:kind(found|agent)', wrap(async (req, res) => {
    const [page, counts, week] = await Promise.all([
      kingReview.queue(req.params.kind, { filter: String(req.query?.filter || ''), limit: req.query?.limit, offset: req.query?.offset }),
      kingReview.counts(), kingReview.weekStats()]);
    return res.json({ ok: true, data: { ...page, counts, week } });
  }));
  router.post('/king/review/:id/send-back', wrap(async (req, res) => {
    const out = await kingReview.sendBack(req.params.id, { note: req.body?.note, actor: actorOf(req) });
    await audit(req, 'king_listing_sent_back', { property_id: out.id, ref: out.ref, note: String(req.body?.note || '').slice(0, 200) });
    return res.json({ ok: true, data: out });
  }));
  router.get('/king/payments', wrap(async (req, res) => res.json({ ok: true, data: await king.payments({ days: req.query?.days }) })));
}

module.exports = { registerKingDeskRoutes };
