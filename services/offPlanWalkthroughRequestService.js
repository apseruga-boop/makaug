'use strict';

/**
 * Walkthroughs for agents' off-plan projects (27 Nov 2026).
 *
 * Arthur, sending the agents the film about Vanta House's walkthroughs: agents
 * share their off-plan projects on WhatsApp with the floor plan of each home
 * type, makaug makes the walkthrough video and the 3D walk-around from those
 * plans, it is part of their plan, and the loop has to close. This is the loop:
 *
 *   1. An agent sends the project (a caption Agent 007 reads as off-plan) and
 *      the floor plans, in the same message or after it.
 *   2. requestWalkthrough: the plans are kept on the project, a walkthrough job
 *      is opened for the off-plan desk, and the team is told what to make.
 *   3. Staff make the walkthrough (scripts/off-plan-walkthroughs/README.md),
 *      attach the video on the off-plan desk and approve it.
 *   4. notifyWalkthroughReady: the agent gets the link on WhatsApp. Like every
 *      message from the makaug number it waits until they have written lately.
 */

// What a floor plan is called, in a caption, a file name or the photo check's
// reason for turning a picture away.
const FLOOR_PLAN_WORDS = /\b(?:floor[\s_-]*plans?|floorplans?|lay[\s_-]?outs?|house[\s_-]*plans?|building[\s_-]*plans?|unit[\s_-]*plans?|apartment[\s_-]*plans?|blue[\s_-]*prints?|architectural|architects?['’]?\s+drawings?|technical\s+drawings?|2d\s+plans?)\b/i;

// Plans sent in several messages make one notice for the team, not one each.
const TEAM_NOTICE_GAP_MS = 10 * 60 * 1000;
const OPEN_JOB_STATUSES = ['brief_ready', 'render_requested', 'draft_ready'];

function clean(value, max = 2000) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').slice(0, max);
}

function siteBase() {
  return clean(process.env.PUBLIC_SITE_URL || process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://makaug.com', 300).replace(/\/+$/, '');
}

function lastThree(phone = '') {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 3 ? digits.slice(-3) : '';
}

function firstName(name = '') {
  return clean(name, 120).split(' ')[0] || '';
}

/**
 * A floor plan among the pictures and files an agent sent. The photo check
 * says so (floor_plan), or the file or the check's reason names one. In an
 * off-plan project's message a PDF is its plans or brochure, and a drawing the
 * photo check turned away is the plan the caption speaks of.
 */
function isFloorPlanMedia(item = {}, { caption = '', offPlan = false } = {}) {
  const kind = String(item?.kind || '').toLowerCase();
  if (!['image', 'document'].includes(kind)) return false;
  const validation = item.mediaValidation && typeof item.mediaValidation === 'object' ? item.mediaValidation : {};
  if (validation.floor_plan === true) return true;
  if (FLOOR_PLAN_WORDS.test(String(item.name || ''))) return true;
  // A real photo whose reason mentions a "kitchen layout" is still a photo.
  if (validation.accepted !== true && FLOOR_PLAN_WORDS.test(`${validation.reason || ''} ${validation.scene_type || ''}`)) return true;
  if (!offPlan) return false;
  if (kind === 'document') return /pdf/i.test(String(item.mimeType || '')) || /\.pdf\b/i.test(String(item.name || item.url || ''));
  return FLOOR_PLAN_WORDS.test(String(caption || ''))
    && (item.publicEligible === false || item.evidenceOnly === true)
    && validation.verdict === 'screenshot_or_document';
}

function collectFloorPlans(storedMedia = [], options = {}) {
  const seen = new Set();
  return (Array.isArray(storedMedia) ? storedMedia : [])
    .filter((item) => /^https:\/\//i.test(String(item?.url || '')) && isFloorPlanMedia(item, options))
    .filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .map((item) => ({ url: item.url, kind: item.kind === 'document' ? 'document' : 'image', name: clean(item.name, 120) }));
}

/** "1 floor plan", "3 floor plans", "2 floor plans and a PDF". */
function floorPlanWords(plans = []) {
  const images = plans.filter((item) => item.kind !== 'document').length;
  const files = plans.filter((item) => item.kind === 'document').length;
  const parts = [];
  if (images) parts.push(`${images} floor ${images === 1 ? 'plan' : 'plans'}`);
  if (files) parts.push(files === 1 ? 'a PDF' : `${files} PDFs`);
  return parts.join(' and ') || 'floor plans';
}

/** The line an agent's saved off-plan project carries when no plan came with it. */
function walkthroughAskLine() {
  return '🎬 *Walkthrough video — included in your plan.* Send the floor plan of each home type (a photo or a PDF of the drawing) with its size, e.g. _2-bed, 92 m²_, and we will make the walkthrough video and the 3D walk-around from it.';
}

/** The line when plans came with it. */
function walkthroughReceivedLine(plans = []) {
  const one = plans.length === 1;
  return `🎬 ${one ? 'Floor plan' : floorPlanWords(plans).replace(/^./, (c) => c.toUpperCase())} received — we will make the walkthrough video and the 3D walk-around from ${one ? 'it' : 'them'} (included in your plan) and send you the link here.`;
}

/** What an agent who asks about off-plan or walkthroughs is told to send. */
function offPlanHowToShareReply({ name = '' } = {}) {
  const first = firstName(name);
  return [
    `🏗️ *Off-plan projects and walkthroughs*${first ? ` — happy to help, ${first}` : ''}`,
    '',
    'Send your project here, in one message:',
    '• its name and where it is',
    '• the home types, with their sizes and prices',
    '• when it will be ready, and the payment plan',
    '',
    'Then send the *floor plan of each home type* — a photo or a PDF of the drawing.',
    '',
    '🎬 We make the walkthrough video and the 3D walk-around from the floor plans and send you the link here. It is included in your plan.',
    '',
    `See one: ${siteBase().replace(/^https?:\/\//, '')}/off-plan/vanta-house`
  ].join('\n');
}

// "How do I send my off plan project?", "Walkthrough", "I have off-plan
// apartments" — about off-plan or walkthroughs, and not the project itself.
const OFF_PLAN_TOPIC = /\b(?:off[\s-]?plan|offplan|walk[\s-]?throughs?|walk[\s-]?arounds?|3d\s+tours?|virtual\s+tours?)\b/i;
function asksAboutOffPlanWalkthroughs(text = '') {
  const said = clean(text, 400);
  if (!said || said.length > 220 || !OFF_PLAN_TOPIC.test(said)) return false;
  if (/^\s*(?:off[\s-]?plan|offplan|walk[\s-]?throughs?|walk[\s-]?through videos?)\s*[.!?]*\s*$/i.test(said)) return true;
  // A price or a size is the project being sent, not a question about it.
  if (/(?:usd|ugx|ush|shs?|\$)\s*[\d,.]+|\b\d[\d,.]*\s*(?:m|million|k|bn|billion|sqm|sq\.?\s*m|m2|m²|acres?|decimals?)\b|\b\d\s*(?:bhk|bed(?:room)?s?)\b/i.test(said)) return false;
  return /\?|\b(?:how|what|can|could|do you|does|is it|send|share|want|interested|i have|we have|my|our|please|pls|tell me|more info)\b/i.test(said);
}

async function openJobFor(db, developmentId) {
  const result = await db.query(
    `SELECT * FROM off_plan_walkthrough_jobs
      WHERE development_id = $1 AND status = ANY($2::text[])
      ORDER BY created_at DESC
      LIMIT 1`,
    [developmentId, OPEN_JOB_STATUSES]
  );
  return result.rows[0] || null;
}

async function sendToAgent({ to, body, kind, key }) {
  const { deliverWhatsapp } = require('./leadHandoffService');
  return deliverWhatsapp({ to, body, kind, leadId: null, nonce: key });
}

function requestTeamNotice({ development = {}, request = {}, plans = [] }) {
  const extra = development.extra_fields && typeof development.extra_fields === 'object' ? development.extra_fields : {};
  const live = development.status === 'published' && development.slug;
  const ending = request.phone_ending ? ` (number ending ${request.phone_ending})` : '';
  return [
    `🎬 *Walkthrough to make — ${clean(development.name, 120)}*`,
    `From ${clean(request.from, 120) || 'an agent'}${ending} · ${floorPlanWords(plans)}${plans.length < (request.floor_plans || []).length + (request.files || []).length ? ` (${(request.floor_plans || []).length + (request.files || []).length} in all)` : ''}`,
    live ? `${siteBase()}/off-plan/${encodeURIComponent(development.slug)}` : 'The project is in review on the off-plan desk.',
    ...plans.slice(0, 6).map((item) => item.url),
    '',
    `Make the walkthrough from the plans, add the video on the off-plan desk and approve it: ${firstName(request.from) || 'the agent'} gets the link on WhatsApp.`,
    extra.contact_mode === 'listing_request' && development.status !== 'published' ? 'The project itself still needs checking before it goes live.' : ''
  ].filter((line, index, all) => line || (index > 0 && all[index - 1])).join('\n').trim();
}

/**
 * Floor plans for a project: keep them, open (or add to) its walkthrough job,
 * and tell the team. `tellSender`: also thank whoever sent them, when that is
 * the agent the project is from (a member of staff loading it is not thanked).
 * Plans already on the request are not counted twice.
 */
async function requestWalkthrough(db, { developmentId = '', floorPlans = [], propertyId = '', from = '', phone = '', tellSender = false, now = new Date() } = {}) {
  const offPlanService = require('./offPlanService');
  const plans = (Array.isArray(floorPlans) ? floorPlans : []).filter((item) => /^https:\/\//i.test(String(item?.url || '')));
  if (!developmentId || !plans.length) return null;
  const development = await offPlanService.getManagedDevelopment(db, developmentId);
  if (!development) return null;
  const extra = development.extra_fields && typeof development.extra_fields === 'object' ? development.extra_fields : {};
  const request = extra.walkthrough_request && typeof extra.walkthrough_request === 'object' ? { ...extra.walkthrough_request } : {};
  const known = new Set([...(request.floor_plans || []), ...(request.files || [])].map(String));
  const fresh = plans.filter((item, index, all) => !known.has(item.url) && all.findIndex((other) => other.url === item.url) === index);
  if (!fresh.length) return { development, job: null, fresh: [], teamTold: false, senderTold: false };
  const images = fresh.filter((item) => item.kind !== 'document');
  const files = fresh.filter((item) => item.kind === 'document');
  const at = now.toISOString();

  // A walkthrough already made and new plans after it: a new request.
  const reopened = !request.requested_at || request.status === 'ready';
  request.status = 'requested';
  request.requested_at = reopened ? at : request.requested_at;
  request.updated_at = at;
  request.via = 'whatsapp';
  request.from = clean(from, 120) || request.from || development.source_agent_name || development.source_display_name || 'Agent';
  request.phone_ending = lastThree(phone) || request.phone_ending || null;
  request.floor_plans = [...(request.floor_plans || []), ...images.map((item) => item.url)].slice(-24);
  request.files = [...(request.files || []), ...files.map((item) => item.url)].slice(-12);
  if (propertyId) request.property_id = String(propertyId);

  let job = await openJobFor(db, development.id);
  const jobPlans = { floor_plans: request.floor_plans, files: request.files };
  if (job) {
    const updated = await db.query(
      `UPDATE off_plan_walkthrough_jobs SET settings = COALESCE(settings, '{}'::jsonb) || $2::jsonb, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [job.id, JSON.stringify(jobPlans)]
    );
    job = updated.rows[0] || job;
  } else {
    job = await offPlanService.createWalkthroughJob(db, development.id, {
      floor_plan_url: (images[0] || files[0]).url,
      narration: `Requested on WhatsApp by ${request.from}`,
      settings: { requested_via: 'whatsapp', from: request.from, property_id: request.property_id || null, ...jobPlans }
    }, { actorRole: 'whatsapp_employee_intake' });
  }
  request.job_id = job?.id || request.job_id || null;

  const nowMs = now.getTime();
  // A new request (a walkthrough already made, and plans for another) is always news.
  const teamTold = reopened || !(request.team_told_at && nowMs - Date.parse(request.team_told_at) < TEAM_NOTICE_GAP_MS);
  if (teamTold) request.team_told_at = at;
  let senderTold = false;
  let agentPhone = '';
  if (tellSender && development.source_agent_id && phone) {
    const agent = (await db.query('SELECT phone, whatsapp, status FROM agents WHERE id = $1', [development.source_agent_id]).catch(() => ({ rows: [] }))).rows[0];
    const tail = String(phone).replace(/\D/g, '').slice(-9);
    agentPhone = agent && agent.status === 'approved' && [agent.whatsapp, agent.phone].some((value) => tail && String(value || '').replace(/\D/g, '').slice(-9) === tail) ? phone : '';
    senderTold = Boolean(agentPhone) && !(request.sender_told_at && nowMs - Date.parse(request.sender_told_at) < TEAM_NOTICE_GAP_MS);
    if (senderTold) request.sender_told_at = at;
  }

  // Kept on the project's floor plans while it is in review; a live page
  // changes only when staff accept the update its plans came with.
  const patch = { extra_fields: { ...extra, walkthrough_request: request } };
  if (development.status !== 'published' && images.length) {
    const have = new Set((Array.isArray(development.floor_plans) ? development.floor_plans : []).map((item) => String(item?.url || '')));
    patch.floor_plans = [
      ...(Array.isArray(development.floor_plans) ? development.floor_plans : []),
      ...images.filter((item) => !have.has(item.url)).map((item) => ({ url: item.url, caption: `Floor plan from ${request.from} on WhatsApp`, kind: 'floor_plan', source: 'whatsapp' }))
    ];
  }
  await offPlanService.writeDevelopment(db, patch, { id: development.id, actorRole: 'whatsapp_employee_intake' });
  await offPlanService.recordEvent(db, {
    developmentId: development.id,
    action: 'walkthrough_requested',
    actorRole: 'whatsapp_employee_intake',
    payload: { walkthrough_job_id: request.job_id, floor_plans: images.length, files: files.length, property_id: request.property_id || null }
  }).catch(() => null);

  if (teamTold) {
    await require('./leadDeskService').sendToTeam(db, requestTeamNotice({ development, request, plans: fresh }), 'off_plan_walkthrough_requested').catch(() => null);
  }
  if (senderTold) {
    const one = fresh.length === 1;
    await sendToAgent({
      to: agentPhone,
      body: `🎬 Got ${one ? 'the floor plan' : `the ${floorPlanWords(fresh)}`} for *${clean(development.name, 120)}*. We will make the walkthrough video and the 3D walk-around from ${one ? 'it' : 'them'} — it is included in your plan — and send you the link here when it is ready.`,
      kind: 'off_plan_walkthrough_requested',
      key: `${development.id}:${request.floor_plans.length + request.files.length}`
    }).catch(() => null);
  }
  return { development, job, fresh, teamTold, senderTold };
}

function walkthroughReadyMessage({ development = {}, job = {}, agent = {} } = {}) {
  const first = firstName(agent.greeting_name || agent.full_name);
  const live = development.status === 'published' && development.slug;
  const page = live ? `${siteBase()}/off-plan/${encodeURIComponent(development.slug)}` : '';
  const walkthroughs = Array.isArray(development.extra_fields?.walkthroughs) ? development.extra_fields.walkthroughs : [];
  const tour = live ? walkthroughs.map((item) => clean(item?.tour_url, 400)).find((url) => url.startsWith('/off-plan/')) : '';
  return [
    `🎬 *${first ? `${first}, your` : 'Your'} walkthrough for ${clean(development.name, 120)} is ready.*`,
    '',
    live ? 'Buyers can watch it and walk around the home themselves on the project page:' : 'Watch it here:',
    live ? page : clean(job.output_video_url, 600),
    ...(tour ? ['', `🚶 Walk around it yourself: ${siteBase()}${tour}`] : []),
    ...(live ? [] : ['', 'It goes on the project page as soon as the page is live.']),
    '',
    'Share the link with your buyers. Next off-plan project? Send it here with its floor plans and we will make its walkthrough too.',
    '',
    'Phillip, makaug.com'
  ].join('\n');
}

/**
 * The walkthrough is approved: the agent who asked for it gets the link, once.
 * Only jobs that came from an agent on WhatsApp; a brief staff opened
 * themselves sends nothing to anyone.
 */
async function notifyWalkthroughReady(db, job = {}, { now = new Date() } = {}) {
  if (!job?.id || String(job.status) !== 'approved') return { sent: false, reason: 'not_approved' };
  const settings = job.settings && typeof job.settings === 'object' ? job.settings : {};
  if (settings.requested_via !== 'whatsapp') return { sent: false, reason: 'not_requested_on_whatsapp' };
  if (settings.agent_told_at) return { sent: false, reason: 'already_told' };
  const offPlanService = require('./offPlanService');
  const development = await offPlanService.getManagedDevelopment(db, job.development_id);
  if (!development) return { sent: false, reason: 'no_project' };
  const agent = development.source_agent_id
    ? (await db.query('SELECT id, full_name, greeting_name, phone, whatsapp, status FROM agents WHERE id = $1', [development.source_agent_id])).rows[0]
    : null;
  if (!agent || String(agent.status) !== 'approved') return { sent: false, reason: 'no_approved_agent' };
  const to = clean(agent.whatsapp || agent.phone, 40);
  if (!to) return { sent: false, reason: 'no_phone' };
  const body = walkthroughReadyMessage({ development, job, agent });
  const delivery = await sendToAgent({ to, body, kind: 'off_plan_walkthrough_ready', key: job.id });
  const at = now.toISOString();
  await db.query(
    `UPDATE off_plan_walkthrough_jobs SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('agent_told_at', $2::text, 'agent_told_status', $3::text) WHERE id = $1`,
    [job.id, at, clean(delivery?.status, 40) || 'unknown']
  );
  const extra = development.extra_fields && typeof development.extra_fields === 'object' ? development.extra_fields : {};
  if (extra.walkthrough_request && typeof extra.walkthrough_request === 'object') {
    await offPlanService.writeDevelopment(db, {
      extra_fields: { ...extra, walkthrough_request: { ...extra.walkthrough_request, status: 'ready', ready_at: at, ready_job_id: job.id } }
    }, { id: development.id, actorRole: 'off_plan_walkthrough' }).catch(() => null);
  }
  const waits = await require('./whatsappWebBridgeService').waitsForThem(to).catch(() => false);
  await require('./leadDeskService').sendToTeam(
    db,
    `🎬 *Walkthrough approved — ${clean(development.name, 120)}.* ${firstName(agent.full_name) || 'The agent'} has been sent the link${waits ? `; it goes when they next write (nothing from them in the last ${require('./whatsappWebBridgeService').wroteWithinDays()} days)` : ''}.`,
    'off_plan_walkthrough_ready'
  ).catch(() => null);
  return { sent: ['queued', 'sent', 'simulated'].includes(String(delivery?.status)), delivery, waits, body };
}

module.exports = {
  FLOOR_PLAN_WORDS,
  asksAboutOffPlanWalkthroughs,
  collectFloorPlans,
  floorPlanWords,
  isFloorPlanMedia,
  notifyWalkthroughReady,
  offPlanHowToShareReply,
  requestTeamNotice,
  requestWalkthrough,
  walkthroughAskLine,
  walkthroughReadyMessage,
  walkthroughReceivedLine
};
