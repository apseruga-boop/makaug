'use strict';

/**
 * A new agent's welcome: three messages, in order (15 Nov 2026).
 *
 * Approval used to send seven to nine messages inside a minute: a personal
 * film, a 3,200-character message, a share card, the how-to film, the guide,
 * the terms and the payment message, and they arrived in whatever order the
 * bridge sent them. The two things a new agent has to do, accept the terms and
 * pay, were the sixth and seventh messages, and both were going unanswered.
 *
 * So it is three, built round what the agent has to do next:
 *   1. approved: their ID, their page and the steps, numbered;
 *   2. the one-minute how-to-post film;
 *   3. how to pay, under the MoMo card, when a payment is due.
 * Tested here: the words, the order and the gaps, the wait for morning when
 * it is night in Kampala, and that nothing is promised that is not sent.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

process.env.WHATSAPP_DELIVERY_MODE = 'web_bridge';
process.env.AI_CEO_OWNER_PHONES = '256700555099';

// The bridge's queue, before anything that sends is loaded.
const bridge = require('../services/whatsappWebBridgeService');
const queued = [];
let queueDown = false;
bridge.queueWhatsappWebBridgeMessage = async (message) => {
  if (queueDown) throw new Error('queue down');
  queued.push(message);
  return { id: `q-${queued.length}` };
};

const db = require('../config/database');
const payLinks = require('../services/payLinkService');
const welcome = require('../services/agentWelcomeService');
const films = require('../services/filmLanguageService');
const admin = require('../routes/admin');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const AGENT_ID = '11111111-2222-4333-8444-555555555555';
const AGENT = { id: AGENT_ID, makaug_agent_number: 'MKA-AG-0042', full_name: 'Gilbert Ssali', phone: '+256701000137', whatsapp: '+256701000137', status: 'approved', fee_exempt: false, paid_until: null };
const MIDDAY = new Date('2026-11-16T09:00:00Z');   // 12:00 in Kampala
const NIGHT = new Date('2026-11-14T19:07:30Z');    // 22:07 in Kampala, when one agent got seven messages in 29 seconds

/** A world with one agent in it; everything that would touch the database or make a pay link is answered here. */
async function withAgent({ agent = {}, inChat = false, pitchedIn = '', termsAccepted = false, listings = 0, payLinkFails = false } = {}, run) {
  const row = { ...AGENT, ...agent };
  const calls = [];
  const madeLinks = [];
  const original = { query: db.query, create: payLinks.createPayLink, page: payLinks.pageData };
  db.query = async (sql, params = []) => {
    calls.push({ sql: String(sql), params });
    if (/FROM agents WHERE id = \$1/i.test(sql)) return { rows: [row] };
    if (/FROM audit_logs[\s\S]*'explainer_video_sent'/i.test(sql)) return { rows: pitchedIn ? [{ lang: pitchedIn }] : [] };
    if (/FROM audit_logs WHERE action = \$1/i.test(sql)) return { rows: termsAccepted ? [{ created_at: new Date() }] : [] };
    if (/FROM whatsapp_messages/i.test(sql)) return { rows: inChat ? [{ ok: 1 }] : [] };
    if (/FROM properties p\s+WHERE \(p\.agent_id::text/i.test(sql)) return { rows: [{ total: listings }] };
    return { rows: [] };
  };
  payLinks.createPayLink = async (_db, input) => {
    if (payLinkFails) throw new Error('pay links are down');
    madeLinks.push(input);
    return { url: 'https://makaug.com/pay/MKAB12CD', link: { code: 'MKAB12CD' } };
  };
  payLinks.pageData = async () => ({ card_available: false });
  queued.length = 0;
  queueDown = false;
  try {
    return await run({ row, calls, madeLinks, stamped: (column) => calls.some((call) => new RegExp(`UPDATE agents SET ${column} = NOW\\(\\)`).test(call.sql)) });
  } finally {
    db.query = original.query;
    payLinks.createPayLink = original.create;
    payLinks.pageData = original.page;
    queueDown = false;
  }
}

const toAgent = () => queued.filter((message) => String(message.recipient).replace(/\D/g, '') === '256701000137');
const toStaff = () => queued.filter((message) => String(message.recipient).replace(/\D/g, '') === '256700555099');

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

test('the first message: approved, their ID and page, and three things to do, numbered', () => {
  const text = welcome.buildApprovedMessage({ agent: AGENT, listings: 0 }, { payment: 'follows' });
  const lines = text.split('\n');
  assert.strictEqual(lines[0], '✅ *You are approved, Gilbert. Welcome to makaug.*');
  assert.match(text, /Your agent ID: \*MKA-AG-0042\*/);
  assert.match(text, new RegExp(`Your page: https://makaug\\.com/agents/${AGENT_ID}`));
  assert.match(text, /\*Three things to do, in this chat:\*/);
  assert.match(text, /\*1\.\* Reply \*AGREE\* to accept the agent terms: https:\/\/makaug\.com\/legal\/makaug-agent-terms\.pdf/);
  assert.match(text, /\*2\.\* Send your first property: photos or a short video, with what it is, the exact area and the price\. The one-minute video below shows how\./);
  assert.match(text, /\*3\.\* Pay your plan, UGX 50,000 a month\. How to pay is in the last message below\./);
  assert.match(text, /Every enquiry on your properties comes straight to this number, with the buyer’s name and number\. makaug takes no commission\./);
  assert.match(text, /Reply \*HELP\* at any time and a person will answer\.$/);
  assert.ok(text.length < 800, `it is ${text.length} characters; the one it replaces was 3,246`);
  // Nothing we cannot stand behind: the audience figures went with the long message.
  assert.doesNotMatch(text, /10,000|20,000 a month|countries|diaspora|live listings/i);
});

test('only what they still have to do is asked for', () => {
  const noFee = welcome.buildApprovedMessage({ agent: AGENT }, { payment: '' });
  assert.match(noFee, /\*Two things to do, in this chat:\*/);
  assert.doesNotMatch(noFee, /Pay your plan|last message below|UGX/, 'nothing is due, so nothing is said about paying');

  const agreed = welcome.buildApprovedMessage({ agent: AGENT }, { payment: 'follows', termsAccepted: true });
  assert.match(agreed, /\*Two things to do, in this chat:\*/);
  assert.doesNotMatch(agreed, /AGREE/, 'they accepted the terms already');
  assert.match(agreed, /\*1\.\* Send your first property/);
  assert.match(agreed, /\*2\.\* Pay your plan/);

  const one = welcome.buildApprovedMessage({ agent: AGENT, listings: 4 }, { payment: '', termsAccepted: true });
  assert.match(one, /You already have 4 properties live on it\./);
  assert.match(one, /\*One thing to do, in this chat:\*\n\*1\.\* Send your next property/);
  assert.match(welcome.buildApprovedMessage({ agent: AGENT, listings: 1 }), /You already have 1 property live on it\./);

  // No ID yet, no name we can use: still a sound message.
  const bare = welcome.buildApprovedMessage({ agent: { id: 'x' } });
  assert.match(bare, /^✅ \*You are approved\. Welcome to makaug\.\*/);
  assert.doesNotMatch(bare, /undefined|null|Your agent ID/);
});

test('a free period somebody gave by hand is said once, with the day it ends, instead of the payment step', () => {
  const agent = { ...AGENT, fee_offer_mode: 'free_period', fee_offer_until: '2026-12-14', fee_offer_at: '2026-11-15T08:00:00Z' };
  const text = welcome.buildApprovedMessage({ agent }, { payment: 'follows' });
  assert.match(text, /🎁 Your plan is free until 14 Dec\. From 15 Dec it is UGX 50,000 a month, and we remind you before then\./);
  assert.doesNotMatch(text, /Pay your plan|last message below/);
  assert.match(text, /\*Two things to do, in this chat:\*/);
});

test('the second message is the how-to film, with the three words and the guide under it', () => {
  const film = welcome.buildHowToFilm({ agent: AGENT });
  assert.strictEqual(film.url, 'https://makaug.com/assets/marketing/makaug-agent-how-to-post-v3.mp4');
  assert.strictEqual(film.lang, '');
  assert.match(film.caption, /^\*How to post your properties, Gilbert — in under a minute\* 🎬/);
  assert.match(film.caption, /\*SHARE\* gives you your page link and card\. \*STATUS\* shows where your properties are\. \*HELP\* gets you a person\./);
  assert.match(film.caption, /The two-page agent guide: https:\/\/makaug\.com\/legal\/makaug-agent-guide\.pdf/);
  assert.ok(film.caption.length < 600, `caption is ${film.caption.length} characters`);
});

test('an agent first written to in Luganda or Swahili gets the film and its words in that language', () => {
  for (const [lang, file, word] of [['lg', '-lg.mp4', /Engeri y’okuweereza/], ['sw', '-sw.mp4', /Jinsi ya kutuma mali/]]) {
    const film = welcome.buildHowToFilm({ agent: AGENT }, { lang });
    assert.ok(film.url.endsWith(`makaug-agent-how-to-post-v3${file}`), film.url);
    assert.strictEqual(film.lang, lang);
    assert.match(film.caption, word);
    assert.match(film.caption, /^🎬 /, 'no second hello: the first message has greeted them');
    assert.match(film.caption, /\*SHARE\*[\s\S]*\*STATUS\*[\s\S]*\*HELP\*/, 'the words the assistant listens for stay as they are');
    assert.match(film.caption, /📘 Agent guide \(PDF\): https:\/\/makaug\.com\/legal\/makaug-agent-guide\.pdf/);
  }
  assert.strictEqual(welcome.buildHowToFilm({ agent: AGENT }, { lang: 'fr' }).lang, '', 'a language with no film is English');
  // The staff send still opens with a hello; only the welcome leaves it off.
  assert.match(films.filmMessage('agent_howto', 'lg', { first: 'Gilbert' }), /^Oli otya Gilbert 👋/);
  assert.match(films.filmMessage('agent_howto', 'lg', { first: 'Gilbert', greet: false }), /^🎬 /);
});

test('the third message is the plan and how to pay it; on its own it still says approved', () => {
  const method = '📱 *Pay with MTN MoMo:* dial *165*3#';
  const last = welcome.buildPlanMessage({ agent: AGENT, methodLine: method, url: 'https://makaug.com/pay/MKAB12CD', withWelcome: true });
  assert.match(last, /^💳 \*Your makaug plan: UGX 50,000 a month\*\n\n📱 \*Pay with MTN MoMo/);
  assert.match(last, /Your payment page: https:\/\/makaug\.com\/pay\/MKAB12CD\nYour listings stay live while you are paid up\.$/);
  assert.doesNotMatch(last, /approved/i, 'the first message said so');
  const alone = welcome.buildPlanMessage({ agent: AGENT, methodLine: method, url: 'https://makaug.com/pay/MKAB12CD', withWelcome: false });
  assert.match(alone, /^✅ \*You are approved, Gilbert\* — your makaug agent account is live\.\n\nYour subscription is UGX 50,000 a month\./);
  assert.match(alone, /Your payment page: https:\/\/makaug\.com\/pay\/MKAB12CD/);
});

// ---------------------------------------------------------------------------
// When it goes
// ---------------------------------------------------------------------------

test('in the day the three go now, twenty and forty-five seconds apart', () => {
  const plan = welcome.welcomeSchedule({ now: MIDDAY });
  assert.strictEqual(plan.held_until, null);
  assert.strictEqual(plan.approved_at, null, 'the first goes at once');
  assert.strictEqual(plan.film_at.getTime() - MIDDAY.getTime(), 20000);
  assert.strictEqual(plan.plan_at.getTime() - MIDDAY.getTime(), 45000);
});

test('between 22:00 and 07:00 in Kampala the welcome waits for 7:30 in the morning', () => {
  const late = welcome.welcomeSchedule({ now: NIGHT });
  assert.strictEqual(late.held_until, '2026-11-15T04:30:00.000Z', '7:30am the next morning');
  assert.strictEqual(late.approved_at.toISOString(), '2026-11-15T04:30:00.000Z');
  assert.strictEqual(late.film_at.toISOString(), '2026-11-15T04:30:20.000Z');
  assert.strictEqual(late.plan_at.toISOString(), '2026-11-15T04:30:45.000Z');
  // 02:00 in Kampala: the same morning, not the next one.
  assert.strictEqual(welcome.welcomeSchedule({ now: new Date('2026-11-14T23:00:00Z') }).held_until, '2026-11-15T04:30:00.000Z');
  // The edges: 21:59 and 07:00 go, 22:00 and 06:59 wait.
  const at = (clock) => welcome.welcomeSchedule({ now: new Date(`2026-11-14T${clock}:00Z`) }).held_until;
  assert.strictEqual(at('18:59'), null, '21:59 in Kampala');
  assert.strictEqual(at('19:00'), '2026-11-15T04:30:00.000Z', '22:00');
  assert.strictEqual(at('03:59'), '2026-11-14T04:30:00.000Z', '06:59');
  assert.strictEqual(at('04:00'), null, '07:00');
  // Somebody in the chat with us is awake; a preview goes to a member of staff who asked for it.
  assert.strictEqual(welcome.welcomeSchedule({ now: NIGHT, inChat: true }).held_until, null);
  assert.strictEqual(welcome.welcomeSchedule({ now: NIGHT, preview: true }).held_until, null);
  assert.strictEqual(welcome.kampalaClock('2026-11-15T04:30:00.000Z'), '7:30am');
  assert.strictEqual(welcome.kampalaClock('2026-11-15T09:00:00.000Z'), '12pm');
});

test('the member of staff is told what happened to the welcome', () => {
  assert.strictEqual(welcome.welcomeSentLine({ format: 'three_messages' }), 'Their welcome and the how-to-post video have gone to them on WhatsApp.');
  assert.strictEqual(welcome.welcomeSentLine({ held_until: '2026-11-15T04:30:00.000Z' }), 'It is night in Kampala, so their welcome goes at 7:30am.');
  assert.strictEqual(welcome.welcomeSentLine({ error: 'No WhatsApp number to send to' }), 'Welcome NOT sent: No WhatsApp number to send to');
  assert.strictEqual(welcome.welcomeSentLine({ skipped: 'already_sent' }), 'They were welcomed before, so nothing was sent again.');
  assert.strictEqual(welcome.welcomeSentLine({ skipped: 'not_requested' }), 'No welcome was sent with this approval.');
  const team = read('services/teamBillingCommandService.js');
  assert.strictEqual((team.match(/welcomeLine\(welcome\)/g) || []).length, 2, 'both WhatsApp approvals say it');
});

// ---------------------------------------------------------------------------
// The send
// ---------------------------------------------------------------------------

test('approval queues three messages for the agent, in order, and tells the team once', async () => {
  await withAgent({}, async ({ row, calls, madeLinks, stamped }) => {
    const result = await admin.queueAgentWelcomePack({ agentId: AGENT_ID, actorId: 'test', feeLink: { agent: row, force: true }, now: MIDDAY });
    const sent = toAgent();
    assert.deepStrictEqual(sent.map((message) => message.metadata.part), ['approved', 'welcome_how_to_film', 'welcome_plan']);
    assert.deepStrictEqual(sent.map((message) => message.mediaType || 'text'), ['text', 'video', 'image']);
    assert.match(sent[0].text, /\*Three things to do, in this chat:\*/);
    assert.strictEqual(sent[0].sendAt, null, 'the first goes now');
    assert.strictEqual(new Date(sent[1].sendAt).getTime() - MIDDAY.getTime(), 20000);
    assert.strictEqual(new Date(sent[2].sendAt).getTime() - MIDDAY.getTime(), 45000);
    assert.strictEqual(sent[1].mediaUrl, 'https://makaug.com/assets/marketing/makaug-agent-how-to-post-v3.mp4');
    assert.strictEqual(sent[1].metadata.broadcast_key, 'agent_how_to_post_v1', 'so the all-agents broadcast never sends them the film again');
    assert.match(sent[2].text, /^💳 \*Your makaug plan: UGX 50,000 a month\*/);
    assert.match(sent[2].text, /Your payment page: https:\/\/makaug\.com\/pay\/MKAB12CD/);
    assert.match(sent[2].mediaUrl, /\/pay\/MKAB12CD\/momo-card\.png/);
    assert.strictEqual(sent[2].metadata.message_kind, 'agent_fee_link_on_approval');
    assert.strictEqual(madeLinks.length, 1, 'one pay link');
    // Total: a quarter of what it was.
    const characters = sent.reduce((sum, message) => sum + message.text.length, 0);
    assert.ok(characters < 1800, `${characters} characters in all`);
    // The team: one note, and it says the link has gone.
    const notes = toStaff();
    assert.strictEqual(notes.length, 1);
    assert.match(notes[0].text, /Gilbert Ssali is approved and the payment link has gone to them/);
    assert.ok(stamped('welcome_sent_at') && stamped('pay_link_sent_at'));
    // The link itself is marked as sent, so "how do I pay?" finds it and King lists it as asked for.
    const marked = calls.find((call) => /UPDATE pay_links[\s\S]*sent_at = NOW\(\)/.test(call.sql));
    assert.deepStrictEqual(marked.params, ['MKAB12CD', '256701000137', 'queued']);
    assert.strictEqual(result.format, 'three_messages');
    assert.strictEqual(result.held_until, null);
    assert.strictEqual(result.fee_link.sent, true);
    assert.deepStrictEqual(Object.values(result.queued).filter(Boolean).length, 2, 'the third is the payment message, reported under fee_link');
  });
});

test('nothing from the old pack is sent: no personal film, long message, share card, guide picture or terms picture', async () => {
  await withAgent({}, async ({ row }) => {
    await admin.queueAgentWelcomePack({ agentId: AGENT_ID, actorId: 'test', feeLink: { agent: row, force: true }, now: MIDDAY });
    const all = toAgent().map((message) => `${message.metadata.part} ${message.metadata.message_kind} ${message.mediaUrl || ''} ${message.text}`).join('\n');
    assert.doesNotMatch(all, /share_card|agent_guide_pdf|agent_terms_pdf|full_welcome|share-card|cover\.png|What makaug is|The audience you just joined/);
  });
  const source = read('routes/admin.js');
  const pack = source.slice(source.indexOf('async function queueAgentWelcomePack'), source.indexOf("router.post('/agent-welcome/:agentId/send'"));
  assert.doesNotMatch(pack, /ensureWelcomeVideo|buildWelcomeMessage|buildShareCardCaption|agentGuideCaption|agentTermsCaption/, 'and nothing is rendered on approval any more');
});

test('at night the whole welcome waits for the morning, and the team is told so now', async () => {
  await withAgent({}, async ({ row }) => {
    const result = await admin.queueAgentWelcomePack({ agentId: AGENT_ID, actorId: 'test', feeLink: { agent: row, force: true }, now: NIGHT });
    assert.deepStrictEqual(toAgent().map((message) => new Date(message.sendAt).toISOString()), ['2026-11-15T04:30:00.000Z', '2026-11-15T04:30:20.000Z', '2026-11-15T04:30:45.000Z']);
    assert.strictEqual(result.held_until, '2026-11-15T04:30:00.000Z');
    assert.strictEqual(result.fee_link.goes_at, '2026-11-15T04:30:45.000Z');
    const note = toStaff()[0];
    assert.match(note.text, /Gilbert Ssali is approved\.\* It is night in Kampala, so their welcome and the payment link go to them at 7:30am\./);
    assert.ok(!note.sendAt, 'the team hears straight away');
  });
});

test('at night, an agent who wrote to us in the last half hour gets it now', async () => {
  await withAgent({ inChat: true }, async ({ row, calls }) => {
    const result = await admin.queueAgentWelcomePack({ agentId: AGENT_ID, actorId: 'test', feeLink: { agent: row, force: true }, now: NIGHT });
    assert.strictEqual(result.held_until, null);
    assert.strictEqual(toAgent()[0].sendAt, null);
    const asked = calls.find((call) => /FROM whatsapp_messages/.test(call.sql));
    assert.deepStrictEqual(asked.params, [['256701000137', '+256701000137'], 30], 'their own messages, the last thirty minutes');
    assert.match(asked.sql, /direction = 'inbound'/);
  });
});

test('nobody is promised a payment message that is not coming', async () => {
  // Joined before the fee: nothing to pay.
  await withAgent({ agent: { fee_exempt: true } }, async ({ row, madeLinks }) => {
    const result = await admin.queueAgentWelcomePack({ agentId: AGENT_ID, actorId: 'test', feeLink: { agent: row, force: true }, now: MIDDAY });
    assert.deepStrictEqual(toAgent().map((message) => message.metadata.part), ['approved', 'welcome_how_to_film']);
    assert.doesNotMatch(toAgent()[0].text, /Pay your plan|last message below/);
    assert.strictEqual(madeLinks.length, 0);
    assert.deepStrictEqual(result.fee_link, { sent: false, reason: 'fee_exempt' });
    assert.strictEqual(toStaff().length, 0);
  });
  // The employee who registered them said not to send the link.
  await withAgent({ agent: { pay_link_on_approval: false } }, async ({ row }) => {
    const result = await admin.queueAgentWelcomePack({ agentId: AGENT_ID, actorId: 'test', feeLink: { agent: row, force: false }, now: MIDDAY });
    assert.deepStrictEqual(toAgent().map((message) => message.metadata.part), ['approved', 'welcome_how_to_film']);
    assert.doesNotMatch(toAgent()[0].text, /Pay your plan/);
    assert.strictEqual(result.fee_link.reason, 'employee_declined');
  });
  // The pay link could not be made: the welcome still goes, without the promise.
  await withAgent({ payLinkFails: true }, async ({ row, stamped }) => {
    const result = await admin.queueAgentWelcomePack({ agentId: AGENT_ID, actorId: 'test', feeLink: { agent: row, force: true }, now: MIDDAY });
    assert.deepStrictEqual(toAgent().map((message) => message.metadata.part), ['approved', 'welcome_how_to_film']);
    assert.doesNotMatch(toAgent()[0].text, /Pay your plan/);
    assert.strictEqual(result.fee_link.sent, false);
    assert.strictEqual(result.fee_link.reason, 'pay_link_failed');
    assert.ok(stamped('welcome_sent_at') && !stamped('pay_link_sent_at'), 'welcomed, and still to be asked for the money');
  });
  // No fee message was asked for at all (a free period, or a payment taken at approval).
  await withAgent({}, async () => {
    const result = await admin.queueAgentWelcomePack({ agentId: AGENT_ID, actorId: 'test', now: MIDDAY });
    assert.deepStrictEqual(toAgent().map((message) => message.metadata.part), ['approved', 'welcome_how_to_film']);
    assert.strictEqual(result.fee_link, null);
  });
});

test('the terms are not asked for twice, and the film follows the language they were written to in', async () => {
  await withAgent({ termsAccepted: true, pitchedIn: 'lg' }, async ({ row, calls }) => {
    const result = await admin.queueAgentWelcomePack({ agentId: AGENT_ID, actorId: 'test', feeLink: { agent: row, force: true }, now: MIDDAY });
    const [first, film] = toAgent();
    assert.doesNotMatch(first.text, /AGREE/);
    assert.match(first.text, /\*Two things to do, in this chat:\*/);
    assert.ok(film.mediaUrl.endsWith('makaug-agent-how-to-post-v3-lg.mp4'));
    assert.strictEqual(film.metadata.film_language, 'lg');
    assert.match(film.text, /Engeri y’okuweereza/);
    assert.strictEqual(result.language, 'lg');
    const asked = calls.find((call) => /'explainer_video_sent'/.test(call.sql));
    assert.deepStrictEqual(asked.params, ['701000137'], 'matched on the last nine digits');
  });
});

test('the assistant is made to look again at who this number is, so their AGREE is not answered as a stranger’s', async () => {
  // It remembers for five minutes that a number is not an agent's. Somebody
  // approved a minute after writing to us is about to be asked to reply AGREE.
  const whatsapp = require('../routes/whatsapp');
  const original = whatsapp.forgetAgentPhone;
  const forgotten = [];
  whatsapp.forgetAgentPhone = (number) => { forgotten.push(String(number)); };
  try {
    await withAgent({}, async ({ row }) => {
      await admin.queueAgentWelcomePack({ agentId: AGENT_ID, actorId: 'test', feeLink: { agent: row, force: true }, now: MIDDAY });
      assert.ok(forgotten.includes('+256701000137'));
      forgotten.length = 0;
      await admin.queueAgentWelcomePack({ agentId: AGENT_ID, previewTo: '256700555002', actorId: 'test', now: MIDDAY });
      assert.strictEqual(forgotten.length, 0, 'a preview changes nothing about the agent');
    });
  } finally {
    whatsapp.forgetAgentPhone = original;
  }
  assert.strictEqual(typeof original, 'function');
  const source = read('routes/admin.js');
  const followUps = source.slice(source.indexOf('async function runAgentApprovalFollowUps'), source.indexOf('async function queueAgentWelcomePack'));
  assert.match(followUps, /forgetAgentLookup\(agent\);/, 'and on every approval, welcomed before or not');
});

test('if the welcome cannot be queued the agent is not marked welcomed, and no payment message goes alone', async () => {
  await withAgent({}, async ({ row, stamped }) => {
    queueDown = true;
    await assert.rejects(admin.queueAgentWelcomePack({ agentId: AGENT_ID, actorId: 'test', feeLink: { agent: row, force: true }, now: MIDDAY }), /queue down/);
    assert.strictEqual(queued.length, 0);
    assert.ok(!stamped('welcome_sent_at') && !stamped('pay_link_sent_at'), 'so the start-up catch-up tries them again');
  });
});

test('a preview shows a member of staff all three, now, and touches nothing of the agent’s', async () => {
  await withAgent({}, async ({ madeLinks, stamped }) => {
    const result = await admin.queueAgentWelcomePack({ agentId: AGENT_ID, previewTo: '+256 700 555 002', actorId: 'test', now: NIGHT });
    assert.strictEqual(toAgent().length, 0, 'nothing to the agent');
    const preview = queued.filter((message) => message.recipient === '256700555002');
    assert.deepStrictEqual(preview.map((message) => message.metadata.part), ['approved', 'welcome_how_to_film', 'welcome_plan']);
    assert.ok(preview.every((message) => message.metadata.preview === true));
    assert.strictEqual(preview[0].sendAt, null, 'not held for the morning');
    assert.match(preview[2].text, /Your payment page: https:\/\/makaug\.com\/pay\/\(their own link\)/);
    assert.match(preview[2].mediaUrl, /\/pay\/momo-card\.png/, 'the card without a link of its own');
    assert.strictEqual(madeLinks.length, 0, 'no pay link is made for a preview');
    assert.ok(!stamped('welcome_sent_at') && !stamped('pay_link_sent_at'));
    assert.strictEqual(toStaff().length, 0, 'and the team is not told an agent was approved');
    assert.strictEqual(result.preview, true);
    assert.strictEqual(result.held_until, null);
  });
});

// King's panel has three buttons: Preview pack, Send to my WhatsApp, Send to
// agent. All three ask the same question first, so what is shown is what goes.
test('a welcome sent by hand from King carries how to pay as its third message when a payment is due', async () => {
  await withAgent({}, async ({ madeLinks, stamped }) => {
    const byHand = await admin.handSentWelcomeFee(AGENT_ID);
    assert.strictEqual(byHand.payMessage, true);
    assert.strictEqual(byHand.agent.id, AGENT_ID);
    await admin.queueAgentWelcomePack({ agentId: AGENT_ID, actorId: 'test', feeLink: { agent: byHand.agent, force: false }, samplePayMessage: byHand.payMessage, now: MIDDAY });
    assert.deepStrictEqual(toAgent().map((message) => message.metadata.part), ['approved', 'welcome_how_to_film', 'welcome_plan']);
    assert.match(toAgent()[0].text, /\*3\.\* Pay your plan, UGX 50,000 a month\. How to pay is in the last message below\./);
    assert.match(toAgent()[2].text, /Your payment page: https:\/\/makaug\.com\/pay\/MKAB12CD/, 'their own link');
    assert.strictEqual(madeLinks.length, 1);
    assert.ok(stamped('pay_link_sent_at'));
    assert.strictEqual(toStaff().length, 1, 'and the team is told it went');
  });
});

test('with nothing to pay, no link wanted, or no approval yet, it is two messages: shown, previewed and sent alike', async () => {
  const cases = [
    [{ fee_exempt: true }, 'fee_exempt'],
    [{ pay_link_on_approval: false }, 'employee_declined'],
    [{ status: 'pending' }, 'not_approved']
  ];
  for (const [agent, reason] of cases) {
    await withAgent({ agent }, async ({ madeLinks, stamped }) => {
      const byHand = await admin.handSentWelcomeFee(AGENT_ID);
      assert.strictEqual(byHand.payMessage, false, reason);
      assert.strictEqual(byHand.reason, reason);
      await admin.queueAgentWelcomePack({ agentId: AGENT_ID, actorId: 'test', feeLink: null, samplePayMessage: false, now: MIDDAY });
      assert.deepStrictEqual(toAgent().map((message) => message.metadata.part), ['approved', 'welcome_how_to_film'], reason);
      assert.doesNotMatch(toAgent()[0].text, /Pay your plan|last message below/, 'the first message promises no payment message');
      assert.strictEqual(madeLinks.length, 0);
      assert.ok(!stamped('pay_link_sent_at'));
      // The same two to a member of staff: a preview does not show a payment message the agent would not get.
      queued.length = 0;
      await admin.queueAgentWelcomePack({ agentId: AGENT_ID, previewTo: '256700555002', actorId: 'test', samplePayMessage: false, now: MIDDAY });
      assert.deepStrictEqual(queued.map((message) => message.metadata.part), ['approved', 'welcome_how_to_film'], reason);
    });
  }
  await withAgent({ agent: { id: 'gone' } }, async () => {
    const original = db.query;
    db.query = async () => ({ rows: [] });
    try {
      assert.deepStrictEqual(await admin.handSentWelcomeFee('gone'), { agent: null, payMessage: false, reason: 'no_agent' });
    } finally {
      db.query = original;
    }
  });
});

test('whatever else must follow the welcome still runs after it, and never after a preview', async () => {
  await withAgent({}, async () => {
    let followed = 0;
    await admin.queueAgentWelcomePack({ agentId: AGENT_ID, actorId: 'test', afterQueued: () => { followed += 1; }, now: MIDDAY });
    assert.strictEqual(followed, 1);
    await admin.queueAgentWelcomePack({ agentId: AGENT_ID, previewTo: '256700555002', actorId: 'test', afterQueued: () => { followed += 1; }, now: MIDDAY });
    assert.strictEqual(followed, 1);
  });
});

test('an agent with no WhatsApp number is refused before anything is made or sent', async () => {
  await withAgent({ agent: { phone: '', whatsapp: '' } }, async ({ row, madeLinks }) => {
    await assert.rejects(admin.queueAgentWelcomePack({ agentId: AGENT_ID, actorId: 'test', feeLink: { agent: row, force: true } }), /No WhatsApp number to send to/);
    assert.strictEqual(queued.length, 0);
    assert.strictEqual(madeLinks.length, 0);
  });
});

// ---------------------------------------------------------------------------
// What they say back
// ---------------------------------------------------------------------------

test('"How do I pay?", a minute after the welcome, is answered with how to pay', async () => {
  const route = require('../routes/whatsapp').__test;
  const original = db.query;
  const asked = [];
  db.query = async (sql, params = []) => {
    asked.push(String(sql));
    return /FROM pay_links/i.test(sql) ? { rows: [{ code: 'MKAB12CD', amount_ugx: 50000, sent_at: new Date().toISOString() }] } : { rows: [] };
  };
  try {
    const how = await route.agentPayLinkAside({ agent: AGENT, cleanBody: 'How do I pay?' });
    assert.match(how, /^Here is how, Gilbert\. 👇/, 'not "Yes, tap it": that answers a different question');
    assert.match(how, /UGX 50,000 a month/);
    assert.match(how, /pay\/MKAB12CD/);
    assert.match(how, /\*27248497\*/, 'the merchant code');
    assert.match(how, /keep sending me properties now/);
    const tap = await route.agentPayLinkAside({ agent: AGENT, cleanBody: 'Can I tap the link' });
    assert.match(tap, /^Yes, Gilbert — tap it, it is from us/);
    assert.match(await route.agentPayLinkAside({ agent: AGENT, cleanBody: 'how do i pay, is the link safe?' }), /^Yes, Gilbert — tap it/);
    // The link from the day they were approved counts even where it was never marked as sent.
    const lookup = asked.find((sql) => /FROM pay_links l/.test(sql));
    assert.match(lookup, /a\.pay_link_sent_at IS NOT NULL/);
    assert.match(lookup, /l\.created_at BETWEEN a\.pay_link_sent_at - INTERVAL '10 minutes' AND a\.pay_link_sent_at \+ INTERVAL '10 minutes'/);
  } finally {
    db.query = original;
  }
  // And it is heard from an agent who is not in the middle of posting, which is where a new agent is.
  const source = read('routes/whatsapp.js');
  assert.match(source, /if \(!active && AGENT_PAY_LINK_QUESTION\.test\(askedText\)\) \{\s+const payingAgent = await findApprovedAgentByPhone\(phone\);/);
  const gate = source.indexOf('if (!active && AGENT_PAY_LINK_QUESTION.test(askedText))');
  assert.ok(gate > 0 && gate < source.indexOf('if (!active && (agentVoiceOnly || AGENT_HELP.test(askedText)'), 'before the agent menu takes the message');
});

// ---------------------------------------------------------------------------
// Order on the wire
// ---------------------------------------------------------------------------

test('the bridge is handed messages in the order they fell due, not the order the database returns them', async () => {
  const original = db.query;
  // Returned scrambled, as UPDATE … RETURNING is free to do.
  const rows = [
    { id: 'c', due_at: '2026-11-16T09:00:45Z', created_at: '2026-11-16T09:00:00.300Z' },
    { id: 'a', due_at: '2026-11-16T09:00:00Z', created_at: '2026-11-16T09:00:00.100Z' },
    { id: 'd', due_at: '2026-11-16T09:00:45Z', created_at: '2026-11-16T09:00:00.400Z' },
    { id: 'b', due_at: '2026-11-16T09:00:20Z', created_at: '2026-11-16T09:00:00.200Z' }
  ];
  let sql = '';
  db.query = async (text) => { sql = String(text); return { rows }; };
  try {
    const claimed = await require('../services/whatsappWebBridgeService').claimWhatsappWebBridgeMessages({ clientId: 'order-test', limit: 10 });
    assert.deepStrictEqual(claimed.map((row) => row.id), ['a', 'b', 'c', 'd']);
    assert.match(sql, /SELECT q\.id, q\.next_attempt_at AS due_at/);
    assert.match(sql, /RETURNING q\.\*, claimable\.due_at/);
  } finally {
    db.query = original;
  }
});

// ---------------------------------------------------------------------------
// The doors it is sent through
// ---------------------------------------------------------------------------

test('every approval route sends the same three, with the payment message as the last of them', () => {
  const source = read('routes/admin.js');
  // King's approve button.
  assert.match(source, /feeLink: feeLinkDue \? \{ agent: updated\.rows\[0\], force: req\.body\.send_pay_link === true \} : null/);
  // Agent 007, the WhatsApp approval and the start-up catch-up.
  assert.match(source, /queueAgentWelcomePack\(\{ agentId, actorId, feeLink: feeLinkWanted \? \{ agent, force: true \} : null \}\)/);
  assert.doesNotMatch(source, /afterQueued: feeLinkDue|afterQueued: feeLinkWanted/, 'the payment message is part of the welcome, not something run after it');
  // What King reports back is what actually happened to the payment message.
  assert.match(source, /feeLink = welcome\?\.fee_link/);
});

test('King previews the messages that will be sent, and says when a welcome is waiting for the morning', () => {
  const source = read('routes/admin.js');
  const preview = source.slice(source.indexOf("router.get('/agent-welcome/:agentId'"), source.indexOf("router.post('/lead-handoff/preview'"));
  assert.match(preview, /handSentWelcomeFee\(pack\.agent\.id\)/);
  assert.match(preview, /buildAgentWelcomeMessages\(pack, \{ lang, sampleFee: byHand\.payMessage \}\)/, 'the messages "Send to agent" would send');
  assert.match(preview, /messages: built\.messages/);
  assert.match(preview, /held_until: schedule\.held_until/);
  assert.match(preview, /welcomed_at: byHand\.agent\?\.welcome_sent_at \|\| null/);
  // The two send buttons ask the same question, so they send what was shown.
  const send = source.slice(source.indexOf("router.post('/agent-welcome/:agentId/send'"), source.indexOf("router.post('/agent-reports/bulk-send'"));
  assert.match(send, /const byHand = await handSentWelcomeFee\(req\.params\.agentId\)/);
  assert.match(send, /feeLink: byHand\.payMessage \? \{ agent: byHand\.agent, force: false \} : null/);
  assert.match(send, /samplePayMessage: byHand\.payMessage/);
  const app = read('assets/makaug-app.js');
  assert.match(app, /function agentWelcomePreviewHtml\(data = \{\}\)/);
  assert.match(app, /They were sent a welcome on \$\{adminEscape\(adminShortDate\(data\.welcomed_at\)\)\}\. “Send to agent” sends this one as well\./);
  assert.match(app, /the film 20 seconds after the first message\$\{hasPlan \? ", the payment message 25 seconds after that" : ""\}\./);
  assert.match(app, /It is night in Kampala: the welcome goes to the agent at \$\{adminKampalaClock\(res\.data\.held_until\)\}\./, 'a welcome sent by hand at night says it is waiting');
  // At night the payment message waits with the welcome, and King does not call it sent.
  assert.match(app, /const payLinkHeld = Boolean\(response\?\.data\?\.fee_link\?\.goes_at\);/);
  assert.match(app, /payLinkHeld \? " The payment link goes with their welcome\." : " Payment link sent\."/);
  assert.match(app, /f\.goes_at \? " The payment link goes with it\." : " Payment link sent\."/);
  assert.match(source, /heldUntil && sendAt \? \{ goes_at: new Date\(sendAt\)\.toISOString\(\) \} : \{\}/, 'the server says when it goes');
  assert.match(app, /their welcome goes at \$\{adminKampalaClock\(welcome\.held_until\)\}/);
  assert.match(read('index.html'), /Three WhatsApp messages, in this order: approved \(their ID, their page and what to do next\), the one-minute how-to-post film, then how to pay when a payment is due\./);
});
