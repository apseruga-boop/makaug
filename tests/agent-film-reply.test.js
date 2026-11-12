'use strict';

/**
 * 12 Nov 2026. The agent film ends "Reply AGENT here if you would like to join
 * and we will set you up". A bare "AGENT" was read as "find me an agent" — the
 * bot asked which district they needed an agent in — and nobody at makaug was
 * told. Arthur: "make sure that I get a notification ... Ronald gets a
 * notification as well".
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const film = require('../services/agentFilmReplyService');

test('what a reply to the film means', () => {
  for (const text of ['AGENT', 'agent', 'Agent.', 'AGENT 🙏', 'Yes agent', 'agent please', 'I am an agent', 'Hi agent']) {
    assert.strictEqual(film.agentFilmAnswer(text), 'agent', text);
  }
  for (const text of ['Yes', 'yes please', 'OK', 'Interested', "I'm interested", 'How much?', 'Hello, how does it work?', 'Call me', 'JOIN', 'I would like to join, I am in Mukono']) {
    assert.strictEqual(film.agentFilmAnswer(text), 'interested', text);
  }
  for (const text of ['No thanks', 'not interested', "I'm not interested", 'STOP', 'Wrong number']) {
    assert.strictEqual(film.agentFilmAnswer(text), 'no', text);
  }
  for (const text of ['Who is this?', 'I need an agent in Kira for a 2 bedroom house']) {
    assert.strictEqual(film.agentFilmAnswer(text), 'other', text);
  }
  assert.strictEqual(film.agentFilmAnswer(''), '');
});

test('Arthur and Ronald always hear; a configured list replaces them; each number once', () => {
  assert.deepStrictEqual(film.agentJoinAlertRecipients({}), ['+447757773202', '+256709402189']);
  assert.deepStrictEqual(film.agentJoinAlertRecipients({ AGENT_HELP_CONTACT_PHONE: '+256 700 000 111' }), ['+447757773202', '+256 700 000 111']);
  assert.deepStrictEqual(
    film.agentJoinAlertRecipients({ AGENT_JOIN_ALERT_WHATSAPP: '+447757773202, 447757773202 ,+256709402189' }),
    ['+447757773202', '+256709402189']
  );
});

test('the notice says who, how to reach them, what they said, and what they will ask on the call', () => {
  const notice = film.agentInterestNotice({
    digits: '256755310313',
    name: 'Kasiita',
    said: 'AGENT',
    film: { at: '2026-11-12T06:20:20Z', by: 'Ronald' },
    fee: 50000,
    helpName: 'Ronald',
    payLine: 'Set them up — reply:\n*NEW AGENT* their name +256755310313'
  });
  assert.match(notice, /^🧑‍💼 \*Agent wants to join makaug — please call\*/);
  assert.match(notice, /Kasiita · \+256755310313/);
  assert.match(notice, /https:\/\/wa\.me\/256755310313/);
  assert.match(notice, /Got the agent film on 12 Nov, 9:20 from Ronald\./);
  assert.match(notice, /They said: "AGENT"/);
  assert.match(notice, /Ronald: please call them today\. I told them you will\./);
  for (const question of ['How much?', 'What do I get?', 'How do I post?', 'Is it legit?', 'What next?']) {
    assert.ok(notice.includes(`*${question}*`), question);
  }
  assert.match(notice, /UGX 50,000 a month, short stays included\. No free trial or free days, no commission/);
  assert.match(notice, /\*NEW AGENT\* their name \+256755310313$/);

  const replied = film.agentInterestNotice({ digits: '256755310313', said: 'Who is this?', replyOnly: true });
  assert.match(replied, /^📩 \*Agent prospect replied to the film\*/);
  assert.match(replied, /they have not said AGENT yet, but they replied/);
});

test('"AGENT" from someone who never got the film: join or find, in words (a bare 1 would accept a guest booking)', () => {
  const prompt = film.joinOrFindPrompt();
  assert.match(prompt, /Reply \*JOIN\* or \*FIND\*/);
  assert.doesNotMatch(prompt, /1️⃣|2️⃣/);
  assert.strictEqual(film.parseJoinOrFind('join'), 'join');
  assert.strictEqual(film.parseJoinOrFind('Find an agent'), 'find');
  assert.strictEqual(film.parseJoinOrFind('maybe'), '');
});

test('the WhatsApp runtime reads a film reply before anything else can read "AGENT" as "find an agent"', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
  const runtime = source.slice(source.indexOf('async function processInboundRuntimeUnlocked'));
  const hook = runtime.indexOf('handleAgentFilmReply({');
  assert.ok(hook > 0);
  assert.ok(hook < runtime.indexOf('handlePaymentClaimMessage({'), 'before payments');
  assert.ok(hook < runtime.indexOf('classifyWhatsappIntent({'), 'before the intent guess');
  assert.ok(hook < runtime.indexOf('processMessage('), 'before the menu rule that sends "agent" to an agent search');
  // The join request tells Arthur and Ronald, with the questions to expect.
  const join = source.slice(source.indexOf('async function agentJoinRequestReply'), source.indexOf('// --- Replies to the agent film'));
  assert.match(join, /agentFilm\.agentInterestNotice\(\{/);
  assert.match(join, /sendToTeam\(db, body, 'agent_join_request', \{ extraRecipients: recipients \}\)/);
  assert.match(join, /const recipients = agentFilm\.agentJoinAlertRecipients\(\)/);
  // The film remembers who it went to, so the reply can say who it is.
  const pitch = source.slice(source.indexOf('async function sendAgentPitchVideo'), source.indexOf('async function payLinkMethodLine'));
  assert.match(pitch, /name: normalizeInput\(name\)\.slice\(0, 120\)/);
  // The prospect list moves on: interested or declined.
  assert.match(source, /markAgentProspectReply\(phone, 'interested', said\)/);
  assert.match(source, /markAgentProspectReply\(phone, 'declined', said\)/);
});
