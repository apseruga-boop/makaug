'use strict';

const calling = require('../services/callingScreen');
const extras = require('../services/callingExtras');
const day = require('../services/callingDay');

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
    // From 17:00 Kampala the day can't be closed until the cash check is signed.
    if (!isKing(req) && day.kampalaHour() >= 17 && !(await day.cashStatus()).done) {
      return res.status(409).json({ ok: false, code: 'cash_check', error: 'Do the 17:00 cash check first: every account, signed with your initials.' });
    }
    const s = await calling.endSession(req.params.id);
    if (s) await day.planResult(s.person_key, undefined, { save: true }).catch(() => null);
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
      ...opts(req), outcome: req.body?.outcome, note: req.body?.note, callbackAt: req.body?.callback_at, checklist: req.body?.checklist,
      transcript: req.body?.transcript, nextStep: req.body?.next_step
    });
    await audit(req, 'calling_call_wrapped_up', { attempt_id: out.id, person: out.person_key, task: out.task_key, outcome: out.outcome, flags: out.flags });
    return res.json({ ok: true, data: out });
  }));

  router.get('/calling/counts', wrap(async (req, res) => res.json({ ok: true, data: await calling.queueCounts(req.query?.person_key) })));
  router.post('/calling/attempts/:id/skip', wrap(async (req, res) => res.json({ ok: true, data: await calling.skip(req.params.id, { sessionId: sid(req), reason: req.body?.reason, reasonCode: req.body?.reason_code, note: req.body?.note }) })));

  router.post('/calling/numbers', wrap(async (req, res) => {
    const out = await calling.submitNumber({ personKey: req.body?.person_key, name: req.body?.name, phone: req.body?.phone, note: req.body?.note, howKnown: req.body?.how_known, mode: req.body?.mode, addedBy: actorOf(req) });
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

  // Incoming call answered on the laptop: put it on screen as a live call.
  router.post('/calling/sessions/:id/inbound', wrap(async (req, res) => {
    const r = await calling.startInbound(req.params.id, { phone: req.body?.phone, fromAttempt: req.body?.from_attempt, name: req.body?.name });
    await audit(req, 'calling_inbound_started', { session_id: req.params.id, attempt_id: r.attempt_id });
    return res.json({ ok: true, data: r });
  }));
  // SMS from the company SIM (sms: link) and the agent-video unlock.
  const contact = require('../services/callingContact');
  router.get('/calling/attempts/:id/contact', wrap(async (req, res) => res.json({ ok: true, data: await contact.videoState(req.params.id) })));
  router.post('/calling/attempts/:id/sms', wrap(async (req, res) => res.json({ ok: true, data: await contact.logSms(req.params.id, { personKey: req.body?.person_key, lang: req.body?.lang }) })));
  router.post('/calling/attempts/:id/video-request', wrap(async (req, res) => {
    const r = await contact.requestVideo(req.params.id, { personKey: req.body?.person_key, videoKey: req.body?.video_key });
    await audit(req, 'calling_video_requested', { attempt_id: req.params.id, request_id: r.id });
    return res.json({ ok: true, data: r });
  }));
  router.get('/calling/live', wrap(async (req, res) => res.json({ ok: true, data: await contact.liveSite() })));
  // Payment SMS proof: screenshot read in the browser (Tesseract.js), checked here, claim for King.
  const smsProof = require('../services/paymentSmsProof');
  const proofWrap = (fn) => wrap(async (req, res) => { try { return await fn(req, res); } catch (e) { if (e instanceof smsProof.ProofError) return res.status(e.status).json({ ok: false, error: e.message, code: e.code }); throw e; } });
  router.post('/calling/sms-proof/parse', proofWrap(async (req, res) => {
    let phone = String(req.body?.phone || '');
    if (req.body?.attempt_id) phone = (await require('../config/database').query('SELECT phone FROM call_attempts WHERE id::text = $1', [String(req.body.attempt_id)])).rows[0]?.phone || phone;
    const parsed = smsProof.parseSmsText(req.body?.text || '');
    const fields = { ...parsed, ...(req.body?.fields || {}) };
    const c = await smsProof.checkFields(fields, { phone });
    const k = (v) => String(v || '').replace(/\D+/g, '').slice(-9);
    return res.json({ ok: true, data: { parsed: { ...parsed, sender_phone_masked: parsed.sender_phone ? `•••${k(parsed.sender_phone).slice(-3)}` : null }, problems: c.hard, flags: c.flags, plan: c.plan.label, min_ugx: c.plan.min_ugx, who: c.plan.who ? String(c.plan.who).split(/\s+/)[0] : '' } });
  }));
  router.post('/calling/sms-proof', proofWrap(async (req, res) => {
    const r = await smsProof.submitProof({ attemptId: req.body?.attempt_id || null, phone: req.body?.phone || '', personKey: req.body?.person_key || actorOf(req), imageDataUrl: req.body?.image, ocrText: req.body?.ocr_text, ocrConfidence: req.body?.ocr_confidence, fields: req.body?.fields || {} });
    await audit(req, 'calling_sms_proof_uploaded', { proof_id: r.id, claim_id: r.claim_id });
    return res.json({ ok: true, data: r });
  }));
  router.get('/calling/sms-proofs/:id/image', proofWrap(async (req, res) => {
    const img = await smsProof.imageFor(req.params.id);
    res.set('Cache-Control', 'private, no-store');
    if (img.redirect) return res.redirect(302, img.redirect);
    res.type(img.type); return res.send(img.buffer);
  }));
  router.get('/calling/lookup', wrap(async (req, res) => res.json({ ok: true, data: await extras.lookup(req.query?.phone) })));
  router.get('/calling/search', wrap(async (req, res) => res.json({ ok: true, data: await calling.searchCalls(req.query?.q, { personKey: isKing(req) ? (req.query?.person_key || '') : '' }) })));
  // Meeting mode: King sets the times + Meet link; callers get the report 10 min before and keep notes.
  const meeting = require('../services/callingMeeting');
  const actorName = (req) => String(req.adminAuth?.name || req.adminAuth?.email || actorId(req) || (isKing(req) ? 'King' : 'staff')).slice(0, 60);
  router.get('/calling/meeting', wrap(async (req, res) => res.json({ ok: true, data: await meeting.status(req.query?.person_key) })));
  router.get('/calling/meeting/report', wrap(async (req, res) => res.json({ ok: true, data: await meeting.buildReport(req.query?.person_key) })));
  router.post('/calling/meeting/notes', wrap(async (req, res) => res.json({ ok: true, data: await meeting.saveNotes(req.body?.person_key, req.body || {}, { actor: actorName(req) }) })));
  router.get('/calling/meeting/history', wrap(async (req, res) => res.json({ ok: true, data: await meeting.history({ personKey: req.query?.person_key || '', limit: req.query?.limit }) })));
  router.get('/calling/meeting/settings', wrap(async (req, res) => res.json({ ok: true, data: await meeting.getSettings() })));
  router.post('/calling/meeting/settings', wrap(async (req, res) => res.json({ ok: true, data: await meeting.saveSettings(req.body || {}, actorName(req)) })));
  // v5: day split (King sets it) and housekeeping follow-ups.
  const planner = require('../services/callingPlanner');
  router.get('/calling/day-split', wrap(async (req, res) => res.json({ ok: true, data: req.query?.person_key ? await planner.dayPlan(req.query.person_key) : await planner.getSplit() })));
  router.put('/calling/day-split', wrap(async (req, res) => {
    if (!isKing(req)) return res.status(403).json({ ok: false, error: 'Only King can change the day split.' });
    const out = await planner.saveSplit(req.body || {}, 'King');
    await audit(req, 'calling_day_split_saved', { blocks: out.blocks.length, reset: Boolean(req.body?.reset) });
    return res.json({ ok: true, data: out });
  }));
  router.get('/calling/housekeeping', wrap(async (req, res) => res.json({ ok: true, data: await planner.housekeeping(req.query?.person_key) })));
  router.post('/calling/housekeeping/done', wrap(async (req, res) => res.json({ ok: true, data: await planner.markHousekeeping(req.body?.person_key, { key: req.body?.key, note: req.body?.note, status: req.body?.status }) })));
  router.get('/calling/my-money', wrap(async (req, res) => res.json({ ok: true, data: await day.myMoney(req.query?.person_key) })));
  // Money on the number on screen: send the pay link / MoMo code, mark "they paid".
  router.get('/calling/attempts/:id/payment', wrap(async (req, res) => {
    const a = (await require('../config/database').query('SELECT phone_key FROM call_attempts WHERE id = $1', [req.params.id])).rows[0];
    if (!a) return res.status(404).json({ ok: false, error: 'Call not found.' });
    return res.json({ ok: true, data: await day.paymentState(a.phone_key) });
  }));
  router.post('/calling/attempts/:id/pay', wrap(async (req, res) => {
    const r = await day.sendPayment(req.params.id, { how: req.body?.how === 'momo' ? 'momo' : 'link', personKey: req.body?.person_key });
    await audit(req, 'calling_payment_sent', { attempt_id: req.params.id, how: req.body?.how, sent: r.sent });
    return res.json({ ok: true, data: r });
  }));
  router.post('/calling/attempts/:id/paid-claim', wrap(async (req, res) => {
    const r = await day.markClaimed(req.params.id, { personKey: req.body?.person_key, note: req.body?.note, txid: req.body?.txid });
    await audit(req, 'calling_payment_claimed', { attempt_id: req.params.id, claim_id: r.claim_id });
    return res.json({ ok: true, data: r });
  }));
  // The morning plan (King agrees it; the caller signs with initials) and the 17:00 cash check.
  router.get('/calling/plan', wrap(async (req, res) => res.json({ ok: true, data: await day.planResult(req.query?.person_key, req.query?.day || undefined) })));
  router.post('/calling/plan', wrap(async (req, res) => {
    const b = req.body || {};
    const r = await day.savePlan(b.person_key, { ...b, agreedBy: isKing(req) && b.agree ? actorOf(req) : '', initials: b.initials || '' });
    await audit(req, 'calling_plan_saved', { person: r.person_key, day: b.day || null });
    return res.json({ ok: true, data: await day.planResult(r.person_key, b.day || undefined) });
  }));
  router.get('/calling/cash', wrap(async (req, res) => res.json({ ok: true, data: await day.cashStatus() })));
  router.post('/calling/cash', wrap(async (req, res) => {
    const r = await day.saveCash({ personKey: req.body?.person_key, initials: req.body?.initials, entries: req.body?.entries });
    await audit(req, 'calling_cash_check_signed', { person: req.body?.person_key, done: r.done });
    return res.json({ ok: true, data: r });
  }));

  // King only.
  router.get('/calling/videos', wrap(async (req, res) => res.json({ ok: true, data: await contact.listVideoRequests({ status: req.query?.status || '' }) })));
  router.post('/calling/videos/:id/decide', wrap(async (req, res) => {
    const r = await contact.decideVideo(req.params.id, { approve: req.body?.approve === true, actor: actorOf(req), note: req.body?.note });
    await audit(req, 'calling_video_decided', { request_id: req.params.id, status: r.status });
    return res.json({ ok: true, data: r });
  }));
  router.post('/calling/videos/:id/sent', wrap(async (req, res) => res.json({ ok: true, data: await contact.markVideoSentByHand(req.params.id, { actor: actorOf(req) }) })));
  router.get('/calling/sms-proofs', wrap(async (req, res) => res.json({ ok: true, data: await smsProof.listProofs({ status: req.query?.status || '' }) })));
  router.get('/calling/blocks', wrap(async (req, res) => res.json({ ok: true, data: await calling.listBlocks() })));
  router.post('/calling/blocks/:phone_key/remove', wrap(async (req, res) => {
    const r = await calling.unblockNumber(String(req.params.phone_key).replace(/\D/g, '').slice(-9), { actor: actorOf(req), note: req.body?.note });
    await audit(req, 'calling_block_removed', { phone_key_last3: r.phone_key.slice(-3) });
    return res.json({ ok: true, data: r });
  }));
  router.get('/calling/calls-summary', wrap(async (req, res) => res.json({ ok: true, data: await calling.callsSummary(day.periodRange(req.query?.period || 'day', req.query?.day || calling.kampalaDay())) })));
  router.get('/calling/activity', wrap(async (req, res) => res.json({ ok: true, data: await day.activity({ period: req.query?.period, day: req.query?.day || undefined, personKey: req.query?.person_key || '' }) })));
  router.get('/calling/cashlog', wrap(async (req, res) => res.json({ ok: true, data: await day.cashLog({ period: req.query?.period, day: req.query?.day || undefined }) })));
  router.get('/calling/plans', wrap(async (req, res) => res.json({ ok: true, data: await day.plans({ period: req.query?.period, day: req.query?.day || undefined }) })));
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
