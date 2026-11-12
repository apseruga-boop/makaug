'use strict';

const prospects = require('../services/agentProspectService');

function registerOutreachTrackerRoutes(router, { writeAudit, actorLabel } = {}) {
  const actorOf = (req) => {
    const user = req.userAuth || {};
    const name = typeof actorLabel === 'function'
      ? actorLabel(user)
      : [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    return name || user.email || req.adminAuth?.userId || req.staffAuth?.userId || 'staff';
  };

  router.get('/outreach-tracker', async (req, res, next) => {
    try {
      const rows = await prospects.listOutreach({
        status: String(req.query.status || '').trim(),
        pitchedBy: String(req.query.pitched_by || '').trim(),
        limit: Number(req.query.limit || 200)
      });
      return res.json({
        ok: true,
        data: rows,
        week_note: 'Tracking starts from the week of 10–16 Nov 2026 (London). New sends from Agent 007 option 3 are recorded automatically. Use Log a send for videos already sent this week that are not in the list.'
      });
    } catch (error) {
      return next(error);
    }
  });

  router.post('/outreach-tracker/log', async (req, res, next) => {
    try {
      const body = req.body || {};
      const recorded = await prospects.logManualOutreach({
        fullName: body.full_name || body.name || '',
        phone: body.phone || '',
        pitchedBy: body.pitched_by || '',
        pitchedByName: body.pitched_by_name || actorOf(req),
        videoKind: body.video_kind || 'agent',
        pitchedAt: body.pitched_at || body.sent_at || null,
        note: body.note || '',
        metadata: { source: 'staff_manual_log' }
      });
      if (typeof writeAudit === 'function') {
        await writeAudit('outreach_video_logged_manually', {
          prospect_id: recorded.prospect?.id,
          name: recorded.prospect?.full_name,
          phone_masked: prospects.maskPhoneLast3(recorded.prospect?.phone),
          by: actorOf(req)
        }, req.adminAuth?.userId || req.staffAuth?.userId || actorOf(req));
      }
      return res.status(201).json({ ok: true, data: prospects.publicProspect(recorded.prospect) });
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({
          ok: false,
          error: error.message,
          code: error.code || null,
          existing: error.existing ? prospects.publicProspect(error.existing) : null
        });
      }
      return next(error);
    }
  });

  router.patch('/outreach-tracker/:id/follow-up', async (req, res, next) => {
    try {
      const row = await prospects.setFollowUp(req.params.id, {
        status: req.body?.status || req.body?.follow_up || '',
        note: req.body?.note || '',
        actor: actorOf(req)
      });
      if (typeof writeAudit === 'function') {
        await writeAudit('outreach_follow_up_updated', {
          prospect_id: row.id,
          status: row.status,
          by: actorOf(req)
        }, req.adminAuth?.userId || req.staffAuth?.userId || actorOf(req));
      }
      return res.json({ ok: true, data: prospects.publicProspect(row) });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
      return next(error);
    }
  });

  router.post('/outreach-tracker/:id/do-not-contact', async (req, res, next) => {
    try {
      const value = req.body?.value !== false && String(req.body?.value || 'true').toLowerCase() !== 'false';
      const row = await prospects.setDoNotContact(req.params.id, { value, actor: actorOf(req) });
      if (typeof writeAudit === 'function') {
        await writeAudit('outreach_do_not_contact_updated', {
          prospect_id: row.id,
          do_not_contact: row.do_not_contact === true,
          by: actorOf(req)
        }, req.adminAuth?.userId || req.staffAuth?.userId || actorOf(req));
      }
      return res.json({ ok: true, data: prospects.publicProspect(row) });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
      return next(error);
    }
  });
}

module.exports = { registerOutreachTrackerRoutes };
