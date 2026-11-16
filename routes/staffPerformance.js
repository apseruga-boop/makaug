'use strict';

const perf = require('../services/staffPerformance');
const commission = require('../services/staffCommission');

/**
 * Staff Performance (Road to 1000). Everyone on the desk can read it, call,
 * log an outcome and add numbers to a list. Targets, the assumed paid rate and
 * the points are King-only (PUT /staff-performance/settings is not in
 * utils/staffSharedKingTools.js, so it stays behind the admin check).
 */
function registerStaffPerformanceRoutes(router, { writeAudit, actorLabel } = {}) {
  const actorOf = (req) => {
    const user = req.userAuth || {};
    const name = typeof actorLabel === 'function' ? actorLabel(user) : [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    return name || user.email || req.adminAuth?.userId || req.staffAuth?.userId || 'staff';
  };
  const actorId = (req) => req.adminAuth?.userId || req.staffAuth?.userId || actorOf(req);
  const audit = async (req, action, details) => {
    if (typeof writeAudit === 'function') await writeAudit(action, { ...details, by: actorOf(req) }, actorId(req));
  };
  const fail = (res, next, error) => (error.status
    ? res.status(error.status).json({ ok: false, error: error.message })
    : next(error));

  router.get('/staff-performance', async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      return res.json({ ok: true, data: await perf.getDashboard() });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/staff-performance/prospects/:id/call', async (req, res, next) => {
    try {
      const out = await perf.startCall(req.params.id, {
        personKey: req.body?.person_key, actorAccount: actorOf(req), actorUserId: actorId(req)
      });
      await audit(req, 'outreach_call_started', { prospect_id: req.params.id, person: out.event.person_key });
      return res.json({ ok: true, data: { event_id: out.event.id, tel: out.tel } });
    } catch (error) {
      return fail(res, next, error);
    }
  });

  router.post('/staff-performance/prospects/:id/outcome', async (req, res, next) => {
    try {
      const event = await perf.logOutcome(req.params.id, {
        outcome: String(req.body?.outcome || ''),
        note: String(req.body?.note || '').trim(),
        followUpOn: req.body?.follow_up_on,
        personKey: req.body?.person_key,
        actorAccount: actorOf(req),
        actorUserId: actorId(req)
      });
      await audit(req, 'outreach_outcome_logged', { prospect_id: req.params.id, outcome: event.outcome, person: event.person_key });
      return res.status(201).json({ ok: true, data: event });
    } catch (error) {
      return fail(res, next, error);
    }
  });

  router.post('/staff-performance/lists', async (req, res, next) => {
    try {
      const out = await perf.addListNumbers({
        personKey: req.body?.person_key,
        text: String(req.body?.text || ''),
        listDay: req.body?.list_day,
        addedBy: actorOf(req),
        addedByPerson: String(req.body?.added_by_person || '').slice(0, 40)
      });
      await audit(req, 'outreach_list_added', { person: out.person_key, list_day: out.list_day, accepted: out.summary.accepted, refused: out.summary.refused });
      return res.status(201).json({ ok: true, data: out });
    } catch (error) {
      return fail(res, next, error);
    }
  });

  router.post('/staff-performance/lists/:id/number', async (req, res, next) => {
    try {
      const phone = await perf.listNumberToDial(req.params.id);
      await audit(req, 'outreach_list_number_opened', { list_number_id: req.params.id });
      return res.json({ ok: true, data: { phone } });
    } catch (error) {
      return fail(res, next, error);
    }
  });

  router.put('/staff-performance/settings', async (req, res, next) => {
    try {
      const out = await perf.saveSettings({
        targets: req.body?.targets,
        assumedPaidRate: req.body?.assumed_paid_rate,
        points: req.body?.points,
        actor: actorOf(req)
      });
      await audit(req, 'staff_performance_settings_saved', { targets: req.body?.targets, assumed_paid_rate: req.body?.assumed_paid_rate, points: req.body?.points, effective_from: out.effective_from });
      return res.json({ ok: true, data: out });
    } catch (error) {
      return fail(res, next, error);
    }
  });

  // Commission (16 Nov 2026). Admin only: none of these paths is in
  // utils/staffSharedKingTools.js, so staff accounts get 403 from the admin check.
  router.post('/staff-performance/commission/payouts', async (req, res, next) => {
    try {
      const out = await commission.createPayout({
        payday: req.body?.payday, accept: req.body?.accept, sends: await perf.loadSends(), actor: actorOf(req), actorId: actorId(req)
      });
      await audit(req, 'commission_payout_created', { payout_id: out.id, payday: out.payday, total_ugx: out.total_ugx, items: out.items });
      return res.status(201).json({ ok: true, data: out });
    } catch (error) {
      return fail(res, next, error);
    }
  });

  router.post('/staff-performance/commission/payouts/:id/review', async (req, res, next) => {
    try {
      const out = await commission.reviewPayout(req.params.id, { note: req.body?.note, sends: await perf.loadSends(), actor: actorOf(req), actorId: actorId(req) });
      await audit(req, 'commission_payout_reviewed', { payout_id: req.params.id, total_ugx: out.total_ugx, dropped: out.dropped.length });
      return res.json({ ok: true, data: out });
    } catch (error) {
      return fail(res, next, error);
    }
  });

  router.post('/staff-performance/commission/payouts/:id/paid', async (req, res, next) => {
    try {
      const out = await commission.markPayoutPaid(req.params.id, { reference: req.body?.reference, actor: actorOf(req), actorId: actorId(req) });
      await audit(req, 'commission_payout_paid', { payout_id: req.params.id, total_ugx: out.total_ugx, items: out.items });
      return res.json({ ok: true, data: out });
    } catch (error) {
      return fail(res, next, error);
    }
  });

  router.post('/staff-performance/commission/payouts/:id/cancel', async (req, res, next) => {
    try {
      const out = await commission.cancelPayout(req.params.id, { reason: req.body?.reason, actor: actorOf(req), actorId: actorId(req) });
      await audit(req, 'commission_payout_cancelled', { payout_id: req.params.id });
      return res.json({ ok: true, data: out });
    } catch (error) {
      return fail(res, next, error);
    }
  });

  router.post('/staff-performance/commission/recruits', async (req, res, next) => {
    try {
      const out = await commission.addRecruit({ name: req.body?.name, ratePct: req.body?.rate_pct, phone: req.body?.phone, actor: actorOf(req), actorId: actorId(req) });
      await audit(req, 'commission_recruit_added', { person: out.person_key, rate_pct: out.rate_pct });
      return res.status(201).json({ ok: true, data: out });
    } catch (error) {
      return fail(res, next, error);
    }
  });

  router.put('/staff-performance/commission/settings', async (req, res, next) => {
    try {
      const out = await commission.saveCommissionSettings({
        paysOn: req.body?.pays_on, holdDays: req.body?.hold_days, cutoffDay: req.body?.cutoff_day,
        defaultRatePct: req.body?.default_rate_pct, staff: req.body?.staff, actor: actorOf(req), actorId: actorId(req)
      });
      await audit(req, 'commission_settings_saved', { pays_on: out.pays_on, hold_days: out.hold_days });
      return res.json({ ok: true, data: out });
    } catch (error) {
      return fail(res, next, error);
    }
  });
}

module.exports = { registerStaffPerformanceRoutes };
