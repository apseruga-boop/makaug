'use strict';

/**
 * 27 Nov 2026. Arthur, sending agents the walkthrough film: agents share their
 * off-plan projects with the floor plan of each home type, makaug makes the
 * walkthrough video and the 3D walk-around from them (part of their plan), and
 * the loop closes: the plans are kept, the team is told what to make, and the
 * agent gets the link when it is approved. Every name and number here is made
 * up.
 */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const walk = require('../services/offPlanWalkthroughRequestService');
const desk = require('../services/leadDeskService');
const handoff = require('../services/leadHandoffService');
const bridge = require('../services/whatsappWebBridgeService');
const route = require('../routes/whatsapp').__test;

const AGENT_ID = '0d0d0d0d-0000-4000-8000-000000000001';
const DEV_ID = '0e0e0e0e-0000-4000-8000-000000000002';
const AGENT_PHONE = '+256700000141';
const PLAN = { url: 'https://media.makaug.com/whatsapp-employee-intake/source-evidence/plan-2bed.jpg', kind: 'image', publicEligible: false, evidenceOnly: true, mediaValidation: { accepted: false, verdict: 'screenshot_or_document', floor_plan: true, reason: 'Architectural floor plan drawing' } };
const PHOTO = { url: 'https://media.makaug.com/whatsapp-employee-intake/image/render.jpg', kind: 'image', publicEligible: true, mediaValidation: { accepted: true, verdict: 'accepted', reason: 'Exterior render of an apartment block' } };
const CAPTION = 'Testa Heights off-plan apartments in Testville, Kampala\n1 bedroom from USD 50,000\n2 bedroom from USD 90,000\nCompletion December 2027, payment plan over 24 months';

function withStubs(run) {
  const saved = { sendToTeam: desk.sendToTeam, deliverWhatsapp: handoff.deliverWhatsapp, waitsForThem: bridge.waitsForThem };
  const team = [];
  const agents = [];
  desk.sendToTeam = async (_db, body, kind) => { team.push({ body, kind }); return [{ to: 'team', status: 'queued' }]; };
  handoff.deliverWhatsapp = async ({ to, body, kind }) => { agents.push({ to, body, kind }); return { status: 'queued' }; };
  bridge.waitsForThem = async () => false;
  return Promise.resolve(run({ team, agents })).finally(() => Object.assign(desk, { sendToTeam: saved.sendToTeam }) && Object.assign(handoff, { deliverWhatsapp: saved.deliverWhatsapp }) && Object.assign(bridge, { waitsForThem: saved.waitsForThem }));
}

function fakeDb({ status = 'pending_review', extra = {}, openJob = null, agentPhone = AGENT_PHONE } = {}) {
  const state = {
    development: { id: DEV_ID, name: 'Testa Heights', slug: 'testa-heights', status, source_agent_id: AGENT_ID, source_agent_name: 'Testa Agent', floor_plans: [], unit_types: [], payment_plan: [], images: [], videos: [], amenities: [], nearby_places: [], brochure_settings: {}, walkthrough_settings: {}, extra_fields: extra },
    jobs: openJob ? [openJob] : [],
    writes: [],
    sql: []
  };
  state.db = {
    query: async (sql, params = []) => {
      const s = String(sql);
      state.sql.push(s);
      if (/FROM off_plan_developments d/i.test(s) && /WHERE d\.id = \$1/i.test(s)) return { rows: [{ ...state.development }] };
      if (/FROM off_plan_walkthrough_jobs/i.test(s) && /status = ANY/i.test(s)) return { rows: state.jobs.filter((job) => ['brief_ready', 'render_requested', 'draft_ready'].includes(job.status)) };
      if (/INSERT INTO off_plan_walkthrough_jobs/i.test(s)) {
        const job = { id: `job-${state.jobs.length + 1}`, development_id: params[0], floor_plan_url: params[1], status: 'brief_ready', settings: JSON.parse(params[4]) };
        state.jobs.push(job);
        return { rows: [job] };
      }
      if (/UPDATE off_plan_walkthrough_jobs SET settings/i.test(s)) {
        const job = state.jobs.find((item) => item.id === params[0]);
        if (job) job.settings = { ...job.settings, ...(params.length > 2 ? { agent_told_at: params[1], agent_told_status: params[2] } : JSON.parse(params[1])) };
        return { rows: job ? [job] : [] };
      }
      if (/UPDATE off_plan_developments SET/i.test(s)) {
        const columns = [...s.matchAll(/(\w+) = \$(\d+)/g)].map((m) => [m[1], params[Number(m[2]) - 1]]);
        const patch = {};
        for (const [column, value] of columns) {
          if (['updated_by'].includes(column)) continue;
          patch[column] = typeof value === 'string' && /^[[{]/.test(value) ? JSON.parse(value) : value;
        }
        state.writes.push(patch);
        Object.assign(state.development, patch);
        return { rows: [{ ...state.development }] };
      }
      if (/FROM agents WHERE id = \$1/i.test(s)) return { rows: [{ id: AGENT_ID, full_name: 'Testa Agent', greeting_name: 'Testa', phone: agentPhone, whatsapp: agentPhone, status: 'approved' }] };
      return { rows: [] };
    }
  };
  return state;
}

test('a floor plan is a floor plan, and a photo of a kitchen layout is still a photo', () => {
  assert.strictEqual(walk.isFloorPlanMedia(PLAN), true, 'the photo check says so');
  assert.strictEqual(walk.isFloorPlanMedia({ url: 'https://x/a.jpg', kind: 'image', name: 'Floor Plan 3 bed.jpg' }), true, 'the file says so');
  assert.strictEqual(walk.isFloorPlanMedia({ url: 'https://x/a.jpg', kind: 'image', mediaValidation: { accepted: false, verdict: 'screenshot_or_document', reason: 'Architectural drawing of a house' } }), true, 'the reason says so');
  assert.strictEqual(walk.isFloorPlanMedia({ url: 'https://x/a.jpg', kind: 'image', mediaValidation: { accepted: true, verdict: 'accepted', reason: 'Open kitchen layout with island' } }), false, 'a real photo');
  assert.strictEqual(walk.isFloorPlanMedia({ url: 'https://x/a.pdf', kind: 'document', mimeType: 'application/pdf' }, { offPlan: true }), true, 'a PDF with an off-plan project');
  assert.strictEqual(walk.isFloorPlanMedia({ url: 'https://x/a.pdf', kind: 'document', mimeType: 'application/pdf' }), false, 'a PDF with anything else is not');
  assert.strictEqual(walk.isFloorPlanMedia({ url: 'https://x/a.jpg', kind: 'image', publicEligible: false, mediaValidation: { accepted: false, verdict: 'screenshot_or_document', reason: 'document' } }, { offPlan: true, caption: 'Here are the floor plans' }), true, 'the drawing the caption speaks of');
  assert.strictEqual(walk.isFloorPlanMedia({ url: 'https://x/t.jpg', kind: 'image', publicEligible: false, mediaValidation: { accepted: false, verdict: 'screenshot_or_document', reason: 'land title document' } }, { offPlan: true, caption: CAPTION }), false, 'a title is not a plan');
  assert.strictEqual(walk.isFloorPlanMedia({ url: 'https://x/v.mp4', kind: 'video', name: 'layout tour.mp4' }), false);
});

test('an agent asking about off-plan or walkthroughs is told what to send; the project itself is not a question', () => {
  for (const said of ['How do I send my off plan project?', 'Walkthrough', 'OFF-PLAN', 'I have off-plan apartments in Testville', 'Can you make a walkthrough video for my project?', 'interested in the 3D tour']) {
    assert.ok(walk.asksAboutOffPlanWalkthroughs(said), said);
  }
  for (const said of ['Hello', 'Testa Heights off-plan 2BHK from USD 90,000', 'Off plan 3 bedroom at 450m in Testville', 'Is the house in Kira still available?', '']) {
    assert.ok(!walk.asksAboutOffPlanWalkthroughs(said), said);
  }
  const reply = walk.offPlanHowToShareReply({ name: 'Testa Agent' });
  assert.match(reply, /^🏗️ \*Off-plan projects and walkthroughs\* — happy to help, Testa\n/);
  assert.match(reply, /floor plan of each home type/);
  assert.match(reply, /It is included in your plan\./);
  assert.match(reply, /makaug\.com\/off-plan\/vanta-house$/);
});

test('the saved off-plan project asks for the floor plans, or says they came, and never calls a plan a private document', () => {
  const data = { whatsapp_agent_self_intake: true, agent: { id: AGENT_ID, full_name: 'Testa Agent', profile_photo_url: 'https://x/p.jpg' } };
  const facts = route.employeePropertyFacts(CAPTION, data);
  assert.strictEqual(facts.offPlan, true);
  const without = route.agentSelfIntakeSavedReply({ data, facts, storedMedia: [PHOTO], caption: CAPTION });
  assert.ok(without.includes(walk.walkthroughAskLine()), without);
  const withPlans = route.agentSelfIntakeSavedReply({ data, facts, storedMedia: [PHOTO, PLAN], caption: CAPTION });
  assert.ok(withPlans.includes('🎬 Floor plan received — we will make the walkthrough video and the 3D walk-around from it (included in your plan) and send you the link here.'), withPlans);
  assert.ok(!/🔒/.test(withPlans), 'not a private document');
  assert.match(withPlans, /📸 1 photo saved/);
  const plansOnly = route.agentSelfIntakeSavedReply({ data, facts, storedMedia: [PLAN, { ...PLAN, url: 'https://media.makaug.com/plan-3bed.jpg' }], caption: CAPTION });
  assert.match(plansOnly, /🎬 2 floor plans received/);
  assert.match(plansOnly, /\*Still needed:\* renders or site photos of the project/);
  // An ordinary listing is as before.
  const house = route.agentSelfIntakeSavedReply({ data, facts: route.employeePropertyFacts('3 bedroom house for sale in Kira at 450m', data), storedMedia: [PHOTO], caption: '3 bedroom house for sale in Kira at 450m' });
  assert.ok(!/🎬/.test(house), house);
});

test('floor plans open one walkthrough job, keep the plans on the project and tell the team once', async () => {
  await withStubs(async ({ team, agents }) => {
    const state = fakeDb();
    const now = new Date('2026-11-27T07:00:00Z');
    const first = await walk.requestWalkthrough(state.db, { developmentId: DEV_ID, floorPlans: walk.collectFloorPlans([PLAN, PHOTO]), from: 'Testa Agent', phone: AGENT_PHONE, now });
    assert.strictEqual(first.fresh.length, 1);
    assert.strictEqual(state.jobs.length, 1, 'a job for the off-plan desk');
    assert.strictEqual(state.jobs[0].status, 'brief_ready');
    assert.strictEqual(state.jobs[0].settings.requested_via, 'whatsapp');
    assert.deepStrictEqual(state.jobs[0].settings.floor_plans, [PLAN.url]);
    assert.deepStrictEqual(state.development.floor_plans.map((item) => item.url), [PLAN.url], 'on the project while it is in review');
    assert.strictEqual(state.development.extra_fields.walkthrough_request.status, 'requested');
    assert.strictEqual(state.development.extra_fields.walkthrough_request.phone_ending, '141');
    assert.strictEqual(team.length, 1);
    assert.match(team[0].body, /^🎬 \*Walkthrough to make — Testa Heights\*\nFrom Testa Agent \(number ending 141\) · 1 floor plan\n/);
    assert.ok(team[0].body.includes(PLAN.url));
    assert.ok(!team[0].body.includes('700000141'), 'only the last three digits');
    assert.strictEqual(agents.length, 0, 'the saved reply already told the agent');

    // The same plan again: nothing new. Another plan five minutes later: added, one notice is enough.
    const again = await walk.requestWalkthrough(state.db, { developmentId: DEV_ID, floorPlans: [walk.collectFloorPlans([PLAN])[0]], phone: AGENT_PHONE, now });
    assert.strictEqual(again.fresh.length, 0);
    const next = { ...PLAN, url: 'https://media.makaug.com/plan-3bed.jpg' };
    const later = await walk.requestWalkthrough(state.db, { developmentId: DEV_ID, floorPlans: walk.collectFloorPlans([next]), phone: AGENT_PHONE, tellSender: true, now: new Date(now.getTime() + 5 * 60000) });
    assert.strictEqual(later.fresh.length, 1);
    assert.strictEqual(state.jobs.length, 1, 'added to the open job');
    assert.deepStrictEqual(state.jobs[0].settings.floor_plans, [PLAN.url, next.url]);
    assert.strictEqual(team.length, 1, 'one notice for plans sent minutes apart');
    assert.strictEqual(agents.length, 1, 'the agent hears the plans after the project arrived');
    assert.strictEqual(agents[0].to, AGENT_PHONE);
    assert.strictEqual(agents[0].body, '🎬 Got the floor plan for *Testa Heights*. We will make the walkthrough video and the 3D walk-around from it — it is included in your plan — and send you the link here when it is ready.');
  });
});

test('a live page is not changed by plans; a member of staff sending them is not thanked', async () => {
  await withStubs(async ({ team, agents }) => {
    const state = fakeDb({ status: 'published' });
    await walk.requestWalkthrough(state.db, { developmentId: DEV_ID, floorPlans: walk.collectFloorPlans([PLAN]), phone: '+256700000199', tellSender: true, now: new Date('2026-11-27T07:00:00Z') });
    assert.deepStrictEqual(state.development.floor_plans, [], 'the live page waits for staff');
    assert.strictEqual(state.development.extra_fields.walkthrough_request.floor_plans.length, 1);
    assert.match(team[0].body, /makaug\.com\/off-plan\/testa-heights/);
    assert.strictEqual(agents.length, 0, 'not the agent: nobody is thanked');
  });
});

test('approved: the agent who asked gets the link once; a brief staff opened sends nothing', async () => {
  await withStubs(async ({ team, agents }) => {
    const state = fakeDb({ status: 'published', extra: { walkthrough_request: { status: 'requested', floor_plans: [PLAN.url] }, walkthroughs: [{ unit_key: '2bhk', tour_url: '/off-plan/testa-heights/tour?home=2bhk' }] } });
    const job = { id: 'job-9', development_id: DEV_ID, status: 'approved', output_video_url: 'https://makaug.com/assets/off-plan/testa-heights/tour-2bhk.mp4', settings: { requested_via: 'whatsapp' } };
    state.jobs.push(job);
    const told = await walk.notifyWalkthroughReady(state.db, job, { now: new Date('2026-11-27T08:00:00Z') });
    assert.strictEqual(told.sent, true);
    assert.strictEqual(agents.length, 1);
    assert.strictEqual(agents[0].to, AGENT_PHONE);
    assert.strictEqual(agents[0].body, [
      '🎬 *Testa, your walkthrough for Testa Heights is ready.*',
      '',
      'Buyers can watch it and walk around the home themselves on the project page:',
      'https://makaug.com/off-plan/testa-heights',
      '',
      '🚶 Walk around it yourself: https://makaug.com/off-plan/testa-heights/tour?home=2bhk',
      '',
      'Share the link with your buyers. Next off-plan project? Send it here with its floor plans and we will make its walkthrough too.',
      '',
      'Phillip, makaug.com'
    ].join('\n'));
    assert.strictEqual(state.development.extra_fields.walkthrough_request.status, 'ready');
    assert.match(team[0].body, /^🎬 \*Walkthrough approved — Testa Heights\.\* Testa has been sent the link\.$/);
    const twice = await walk.notifyWalkthroughReady(state.db, state.jobs[0]);
    assert.strictEqual(twice.reason, 'already_told');
    assert.strictEqual(agents.length, 1, 'never twice');
    const staffBrief = await walk.notifyWalkthroughReady(state.db, { id: 'job-10', development_id: DEV_ID, status: 'approved', settings: {} });
    assert.strictEqual(staffBrief.reason, 'not_requested_on_whatsapp');
    assert.strictEqual(agents.length, 1);
  });
});

test('in review: the video link, and word that the page follows', () => {
  const body = walk.walkthroughReadyMessage({ development: { name: 'Testa Heights', status: 'pending_review', slug: 'testa-heights' }, job: { output_video_url: 'https://makaug.com/assets/x.mp4' }, agent: { full_name: 'Testa Agent' } });
  assert.match(body, /^🎬 \*Testa, your walkthrough for Testa Heights is ready\.\*\n\nWatch it here:\nhttps:\/\/makaug\.com\/assets\/x\.mp4\n\nIt goes on the project page as soon as the page is live\./);
});

test('the pieces are wired: the photo check, the intake, the approval route and the agents\' question', () => {
  const ai = fs.readFileSync(path.join(__dirname, '../services/aiService.js'), 'utf8');
  assert.match(ai, /is_floor_plan \(boolean/);
  assert.match(ai, /floor_plan: parsed\.is_floor_plan === true/);
  const offPlan = fs.readFileSync(path.join(__dirname, '../routes/off-plan.js'), 'utf8');
  assert.match(offPlan, /walkthrough\.status === 'approved'[\s\S]{0,300}notifyWalkthroughReady\(db, walkthrough\)/);
  const wa = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');
  assert.match(wa, /offPlanWalkthroughs\.requestWalkthrough\(db, \{\s*developmentId: offPlanId/);
  assert.match(wa, /offPlanWalkthroughs\.asksAboutOffPlanWalkthroughs\(askedText\) && !\(await agentTalkIsForAPerson/);
  assert.match(wa, /if \(!facts\.knownDevelopment\?\.id\) delete data\.known_projects_checked_at;/);
  assert.ok(fs.existsSync(path.join(__dirname, '../scripts/off-plan-walkthroughs/README.md')));
});

test('a project is read the way the film asks agents to send it: its name, its place and the range of homes', () => {
  const sent = 'Off-plan project: Example Court, Testville\n2 and 3 bedroom apartments\n2 bedroom, 85 m², from UGX 280m\n3 bedroom, 120 m², from UGX 390m\nReady December 2027, pay over 24 months';
  assert.strictEqual(route.offPlanLabelledProjectName(sent), 'Example Court');
  assert.strictEqual(route.offPlanLabelledProjectName('Off plan: Example Court in Kira\n2 bed 280m'), 'Example Court');
  assert.strictEqual(route.offPlanLabelledProjectName('Project name: Example Court\nLocation: Kira'), 'Example Court');
  assert.strictEqual(route.offPlanLabelledProjectName('Example Court off-plan apartments in Kira'), 'Example Court');
  assert.strictEqual(route.offPlanLabelledProjectName('New off-plan apartments in Kira'), '', 'an advert word is not a name');
  assert.strictEqual(route.offPlanLabelledProjectName('Off-plan: 2 bedroom apartments in Kira'), '');
  assert.deepStrictEqual(route.offPlanBedroomRange('2 and 3 bedroom apartments'), { min: 2, max: 3 });
  assert.deepStrictEqual(route.offPlanBedroomRange('1, 2 & 3 bed from 150m'), { min: 1, max: 3 });
  assert.deepStrictEqual(route.offPlanBedroomRange('1BHK from USD 50,000, 3BHK from USD 160,000'), { min: 1, max: 3 });
  assert.strictEqual(route.offPlanBedroomRange('3 bedroom house'), null);
  const facts = route.employeePropertyFacts('Off-plan project: Example Court, Kira\n2 and 3 bedroom apartments\n2 bedroom, 85 m², from UGX 280m\n3 bedroom, 120 m², from UGX 390m\nReady December 2027, pay over 24 months', {});
  assert.strictEqual(facts.offPlanName, 'Example Court');
  assert.deepStrictEqual([facts.bedroomDraft.bedroom_options_min, facts.bedroomDraft.bedroom_options_max], [2, 3]);
  assert.strictEqual(facts.locationPatch.area, 'Kira');
  const named = route.employeePropertyFacts('Kira Heights off-plan apartments, 2 and 3 bedroom from 300m, completion 2027', {});
  assert.strictEqual(named.offPlanName, 'Kira Heights');
  assert.strictEqual(named.locationPatch.area, 'Kira', 'the place in the name, when it is the only one');
});

test('words on a photo after an off-plan project name its floor plan, not a new property', () => {
  const data = { off_plan_property_ids: ['p-1'], current_property_id: 'p-1' };
  assert.strictEqual(route.floorPlanWordsForOffPlanProject(data, '2 bedroom floor plan'), true);
  assert.strictEqual(route.floorPlanWordsForOffPlanProject(data, '2-bed, 92 m²'), true, 'a size alone');
  assert.strictEqual(route.floorPlanWordsForOffPlanProject(data, 'Layout'), true);
  assert.strictEqual(route.floorPlanWordsForOffPlanProject(data, '2 bedroom house in Kira for 300m'), false, 'a property with a price');
  assert.strictEqual(route.floorPlanWordsForOffPlanProject({ current_property_id: 'p-2' }, '2 bedroom floor plan'), false, 'not an off-plan project');
  assert.strictEqual(route.floorPlanWordsForOffPlanProject({ pending_property_caption: 'Off-plan project: Example Court, Kira\n2 and 3 bedroom apartments from UGX 280m' }, 'floor plan 3 bed'), true, 'its description waiting for photos');
  const noted = { };
  route.noteEmployeePropertyCreated(noted, 'p-9', [], 'Off-plan project: Example Court, Kira\n2 and 3 bedroom apartments from UGX 280m, handover 2027');
  assert.deepStrictEqual(noted.off_plan_property_ids, ['p-9']);
  assert.ok(!('known_projects_checked_at' in noted));
});

test('an off-plan project sent without photos is asked for its pictures and the floor plan of each home', () => {
  const notice = route.agentPendingNotice({ whatsapp_agent_self_intake: true, pending_property_caption: 'Off-plan project: Example Court, Testville\n2 and 3 bedroom apartments from UGX 280m, ready December 2027' });
  assert.match(notice, route.AGENT_DETAILS_THEN_PHOTOS, 'still answered by the burst like any description');
  assert.match(notice, /\(renders or site photos\) and the \*floor plan of each home type\*\. We make the walkthrough from the floor plans; it is included in your plan\./);
  const house = route.agentPendingNotice({ whatsapp_agent_self_intake: true, pending_property_caption: '3 bedroom house for sale in Kira at 450m' });
  assert.ok(!/floor plan/.test(house), house);
});

test('plans for a project whose walkthrough was already made are a new request, and the team hears at once', async () => {
  await withStubs(async ({ team }) => {
    const now = new Date('2026-11-27T09:00:00Z');
    const state = fakeDb({ extra: { walkthrough_request: { status: 'ready', requested_at: '2026-11-20T09:00:00Z', team_told_at: new Date(now.getTime() - 60000).toISOString(), floor_plans: [PLAN.url], files: [] } } });
    const next = { ...PLAN, url: 'https://media.makaug.com/plan-penthouse.jpg' };
    const result = await walk.requestWalkthrough(state.db, { developmentId: DEV_ID, floorPlans: walk.collectFloorPlans([next]), now });
    assert.strictEqual(result.teamTold, true, 'not held back by the last notice a minute ago');
    assert.strictEqual(team.length, 1);
    assert.strictEqual(state.development.extra_fields.walkthrough_request.status, 'requested');
    assert.strictEqual(state.development.extra_fields.walkthrough_request.requested_at, now.toISOString());
  });
});

test('a project sent again under the same name: its plans go to the project that is already there', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');
  const start = source.indexOf("logger.warn('Off-plan draft from Agent 007 not created'");
  const branch = source.slice(start, start + 1600);
  assert.match(branch, /SELECT id, name FROM off_plan_developments WHERE country_code = 'UG' AND slug = \$1 LIMIT 1/);
  assert.match(branch, /offPlanWalkthroughs\.requestWalkthrough\(db, \{\s*developmentId: existing\.id,/);
  assert.match(source, /phone: data\.phone \|\| data\.sender_phone \|\| data\.agent\?\.whatsapp \|\| data\.agent\?\.phone \|\| ''/);
});
