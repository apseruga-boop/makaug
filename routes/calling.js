'use strict';

const calling = require('../services/callingScreen');
const extras = require('../services/callingExtras');

/**
 * Calling screen. Staff (Ronald, Harriet, anyone on the desk) use the session,
 * queue, wrap-up, add-a-number, feed, stats and their own report. King-only:
 * the team performance view, the evidence trail, targets and reviewing added
 * numbers (those paths are not in utils/staffSharedKingTools.js, so staff get
 * 403 from the admin check).
 */
function registerCallingRoutes(router, { writeAudit, actorLabel } = {}) {
  const actorOf = (req) => {
    const user = req.userAuth || {};
    const name = typeof actorLabel === 'function' ? actorLabel(user) : [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    return name || user.email || req.adminAuth?.userId || req.staffAuth?.userId || 'staff';
  };
  const actorId = (req) => String(req.adminAuth?.userId || req.staffAuth?.userId || req.userAuth?.id || '');
  const audit = async (req, action, details) => {
    if (typeof writeAudit === 'function') await writeAudit(action, { ...details, by: actorOf(req) }, actorId(req) || actorOf(req));
  };
  const wrap = (fn) => async (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      return await fn(req, res);
    } catch (error) {
      if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
      return next(error);
    }
  };
  const sid = (req) => String(req.body?.session_id || req.query?.session_id || '');

  const isKing = (req) => Boolean(req.adminAuth && req.adminAuth.type !== 'moderator');
  const scope = (req) => extras.scopeOf(req.userAuth || {});
  const originOf = (req) => {
    const host = req.get('host') || 'makaug.com';
    const proto = /^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? 'http' : 'https';
    return `${proto}://${host}`;
  };
  const opts = (req) => ({ sessionId: sid(req), at: req.body?.at || null, op: req.body?.op || '' });

  router.get('/calling/bootstrap', wrap(async (req, res) => res.json({ ok: true, data: await calling.bootstrap({ userId: actorId(req), scope: scope(req), isKing: isKing(req) }) })));

  router.post('/calling/sessions', wrap(async (req, res) => {
    const out = await calling.startSession({ personKey: req.body?.person_key, taskKey: req.body?.task_key, device: req.body?.device, actorAccount: actorOf(req), actorUserId: actorId(req) });
    await audit(req, 'calling_session_started', { session_id: out.session.id, person: out.person.key, task: out.task.key });
    return res.status(201).json({ ok: true, data: { session_id: out.session.id, person_key: out.person.key, task_key: out.task.key, started_at: out.session.started_at } });
  }));

  router.post('/calling/sessions/:id/heartbeat', wrap(async (req, res) => {
    const s = await calling.heartbeat(req.params.id, { totals: req.body?.totals, events: req.body?.events });
    return res.json({ ok: true, data: { last_heartbeat_at: s.last_heartbeat_at } });
  }));

  router.post('/calling/sessions/:id/task', wrap(async (req, res) => {
    const s = await calling.switchTask(req.params.id, req.body?.task_key);
    return res.json({ ok: true, data: { task_key: s.task_key } });
  }));

  router.post('/calling/sessions/:id/next', wrap(async (req, res) => res.json({ ok: true, data: await calling.nextNumber(req.params.id) })));

  router.post('/calling/sessions/:id/end', wrap(async (req, res) => {
    const s = await calling.endSession(req.params.id);
    if (s) await audit(req, 'calling_session_ended', { session_id: req.params.id, person: s.person_key });
    const summary = s ? await extras.saveSummary(s.person_key, undefined, 'session_end').catch(() => null) : null;
    return res.json({ ok: true, data: { ended: Boolean(s), summary } });
  }));

  // Put a lead / enquiry / WhatsApp contact on screen now (same never-twice rules).
  router.post('/calling/sessions/:id/claim', wrap(async (req, res) => {
    const out = await extras.claimContact(req.params.id, { kind: req.body?.kind, ref: req.body?.ref });
    await audit(req, 'calling_lead_claimed', { session_id: req.params.id, kind: req.body?.kind, ref: req.body?.ref });
    return res.json({ ok: true, data: out });
  }));

  router.post('/calling/attempts/:id/tap', wrap(async (req, res) => res.json({ ok: true, data: await calling.tap(req.params.id, opts(req)) })));
  router.post('/calling/attempts/:id/end', wrap(async (req, res) => res.json({ ok: true, data: await calling.endCall(req.params.id, opts(req)) })));

  router.post('/calling/attempts/:id/wrapup', wrap(async (req, res) => {
    const out = await calling.wrapUp(req.params.id, {
      ...opts(req), outcome: req.body?.outcome, note: req.body?.note, callbackAt: req.body?.callback_at, checklist: req.body?.checklist
    });
    await audit(req, 'calling_call_wrapped_up', { attempt_id: out.id, person: out.person_key, task: out.task_key, outcome: out.outcome, flags: out.flags });
    return res.json({ ok: true, data: out });
  }));

  router.get('/calling/counts', wrap(async (req, res) => res.json({ ok: true, data: await calling.queueCounts(req.query?.person_key) })));
  router.post('/calling/attempts/:id/skip', wrap(async (req, res) => res.json({ ok: true, data: await calling.skip(req.params.id, { sessionId: sid(req), reason: req.body?.reason, reasonCode: req.body?.reason_code, note: req.body?.note }) })));

  router.post('/calling/numbers', wrap(async (req, res) => {
    const out = await calling.submitNumber({ personKey: req.body?.person_key, name: req.body?.name, phone: req.body?.phone, note: req.body?.note, addedBy: actorOf(req) });
    await audit(req, 'calling_number_added', { submission_id: out.id, status: out.status, person: req.body?.person_key });
    return res.status(201).json({ ok: true, data: out });
  }));

  router.get('/calling/stats', wrap(async (req, res) => {
    extras.autoSaveAtFive().catch(() => null);
    return res.json({ ok: true, data: await calling.stats(req.query?.person_key, { sessionId: req.query?.session_id || null }) });
  }));
  router.get('/calling/summary', wrap(async (req, res) => res.json({ ok: true, data: await extras.dailySummary(req.query?.person_key, req.query?.day || undefined) })));
  router.get('/calling/whatsapp', wrap(async (req, res) => res.json({ ok: true, data: { read_only: true, items: await extras.whatsappFeed({}) } })));
  router.get('/calling/whatsapp/:ref', wrap(async (req, res) => res.json({ ok: true, data: await extras.whatsappThread(req.params.ref, { caller: req.query?.caller || '' }) })));
  router.get('/calling/leads', wrap(async (req, res) => res.json({ ok: true, data: { items: await extras.leadFeed({}) } })));
  router.get('/calling/timeline', wrap(async (req, res) => {
    // Staff open a timeline from a call; King can also open one from the pipeline by phone key.
    const byKey = isKing(req) ? req.query?.phone_key : '';
    return res.json({ ok: true, data: await extras.timeline({ attemptId: req.query?.attempt_id || '', phoneKey: byKey || '' }) });
  }));
  router.get('/calling/feed', wrap(async (req, res) => res.json({ ok: true, data: await calling.feed(req.query?.person_key) })));
  router.get('/calling/report', wrap(async (req, res) => res.json({ ok: true, data: await calling.report(req.query?.person_key, req.query?.day || undefined) })));

  // King only.
  router.get('/calling/performance', wrap(async (req, res) => {
    await extras.autoSaveAtFive().catch(() => null);
    return res.json({ ok: true, data: await calling.performance({ day: req.query?.day || undefined }) });
  }));
  router.get('/calling/summaries', wrap(async (req, res) => res.json({ ok: true, data: await extras.savedSummaries({ day: req.query?.day || undefined }) })));
  router.get('/calling/pipeline', wrap(async (req, res) => res.json({ ok: true, data: await extras.pipeline({ includeArchived: req.query?.archived === '1' }) })));
  router.post('/calling/pipeline/:phone_key', wrap(async (req, res) => {
    const out = await extras.savePipeline(req.params.phone_key, { ...req.body, actor: actorOf(req) });
    await audit(req, 'calling_pipeline_saved', { phone_key_last3: String(req.params.phone_key).slice(-3), archived: out.archived });
    return res.json({ ok: true, data: out });
  }));
  router.get('/calling/logins', wrap(async (req, res) => res.json({ ok: true, data: await extras.listLogins() })));
  router.post('/calling/logins/:user_id/link', wrap(async (req, res) => {
    const out = await extras.makeSetupLink(req.params.user_id, { actor: actorOf(req), origin: originOf(req) });
    await audit(req, 'calling_setup_link_made', { user_id: req.params.user_id, expires_at: out.expires_at });
    return res.json({ ok: true, data: out });
  }));
  router.get('/calling/evidence', wrap(async (req, res) => res.json({ ok: true, data: await calling.evidence(req.query?.person_key, req.query?.day || undefined) })));
  router.put('/calling/targets', wrap(async (req, res) => {
    const out = await calling.saveTargets({ targets: req.body?.targets, actor: actorOf(req) });
    await audit(req, 'calling_targets_saved', { targets: out });
    return res.json({ ok: true, data: out });
  }));
  router.get('/calling/numbers', wrap(async (req, res) => res.json({ ok: true, data: await calling.listSubmissions({ status: req.query?.status || 'pending' }) })));
  router.post('/calling/numbers/:id/review', wrap(async (req, res) => {
    const out = await calling.reviewSubmission(req.params.id, { decision: req.body?.decision, name: req.body?.name, actor: actorOf(req) });
    await audit(req, 'calling_number_reviewed', { submission_id: req.params.id, status: out.status });
    return res.json({ ok: true, data: out });
  }));
}

module.exports = { registerCallingRoutes };
