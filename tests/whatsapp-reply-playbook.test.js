'use strict';

/**
 * 12 Nov 2026. Arthur: "have a look at what the response is and what you
 * should respond ... and going forward, you make sure you respond in the same
 * manner." Every message below is a real reply from 9 to 12 Nov 2026, word
 * for word, that the bot answered with a menu, a search or the mortgage notice.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const playbook = require('../services/whatsappReplyPlaybook');
const film = require('../services/agentFilmReplyService');
const prospects = require('../services/agentProspectService');

test('what a reply to one of our messages is', () => {
  const cases = {
    Thanks: 'thanks',
    'thanks bro': 'thanks',
    'Thank you so much': 'thanks',
    'Ok thanks': 'thanks',
    'Webale nnyo': 'thanks',
    'Thanks for the info': 'thanks',
    Noted: 'ack',
    '👍': 'ack',
    '🙏🙏': 'ack',
    'But does the app really have clients? I would gladly pay the 50k if it\'s working': 'proof',
    'Is this site really working?': 'proof',
    'This is in Mukono not nkaaseke': 'correction',
    'The price is wrong, it should be 200m': 'correction',
    'Please change the location to Seeta': 'correction',
    'its not opening': 'link_broken',
    'The link is not working': 'link_broken',
    'It is sold': 'sold',
    'Already taken, remove it please': 'sold',
    'Delete am not interested': 'delete',
    'Remove me': 'delete',
    'Not interested anymore': 'opt_out',
    'https://youtube.com/@chiefpropertiesuganda?si=NBgSUWrGLEAekxGn': 'social',
    'Kindly subscribe to my YouTube channel for more details': 'social'
  };
  for (const [text, kind] of Object.entries(cases)) {
    assert.strictEqual(playbook.replyKind(text), kind, text);
  }
  // The same evening, after the catch-up message (12 Nov, 20:23 to 20:37).
  assert.strictEqual(playbook.replyKind("Okay. That's interesting"), 'ack');
  assert.strictEqual(playbook.replyKind('Its actually 6 acres with a huge warehouse with a transformer In mukono 6km off tarmac Selling 2.3bn ugx With a private mailo land title'), 'correction');
  assert.strictEqual(playbook.replyKind('Area is Mukono not nkaaseke'), 'correction');
  assert.strictEqual(playbook.correctionFollowUpReply({ first: 'Benard' }), "Got it, Benard — I've added that to the same fix for the team.");
  // Left to the rest of the bot.
  for (const text of ['Am looking for a single room house in mutungo', '2', 'Kampala bunga', 'I have paid 50000', 'Hello']) {
    assert.strictEqual(playbook.replyKind(text), '', text);
  }
});

test('"ok" after a notice needs nothing back; after a question it is an answer', () => {
  assert.ok(!playbook.asksSomething('🎉 *Your property is live on makaug.com*\nGot another one? Send it here.'));
  assert.ok(!playbook.asksSomething('Great to hear from you! Want to talk now? Call or WhatsApp Ronald on +256 709 402 189.'));
  assert.ok(!playbook.asksSomething('Reply *AGENT* here if you would like to join and we will set you up.'));
  assert.ok(playbook.asksSomething('📍 Which area or district are you looking in?'));
  assert.ok(playbook.asksSomething('Do you want to carry on? 🙂'));
  assert.ok(playbook.asksSomething('🏠 What are you listing?\n1️⃣ House/Property for SALE\n2️⃣ House/Property for RENT'));
  assert.ok(playbook.asksSomething('Reply *YES* to confirm.'));
});

test('a WhatsApp Business auto-reply is recognised; a person introducing themselves is not', () => {
  assert.ok(playbook.looksLikeAutoReply('Welcome! This is Kampala&Beyond Property Agency:'));
  assert.ok(playbook.looksLikeAutoReply('Thank you for contacting Kakx Real Estate. We will get back to you shortly.'));
  assert.ok(playbook.looksLikeAutoReply('Hello, we are currently away. Our business hours are 8am to 6pm.'));
  for (const text of ['Hello this is Benard, thanks', 'Thanks', 'Agent', 'Who is that one', 'This is in Mukono not nkaaseke']) {
    assert.ok(!playbook.looksLikeAutoReply(text), text);
  }
});

test('"Thanks" gets a short answer, never the menu', () => {
  const live = '🎉 *Your property is live on makaug.com*\nMatugga 100M ugx\n🔗 https://makaug.com/property/a85b50b9-7ea1-4316-bcd5-7fcc7c522910';
  assert.strictEqual(playbook.thanksReply({ first: 'Benard', role: 'agent', lastSent: live }), "You're welcome, Benard! 🙌 Put the link on your WhatsApp status — every view counts.");
  assert.strictEqual(playbook.thanksReply({ first: 'Lord', role: 'agent', lastSent: '☀️ *makaug Morning Brief* · Thu 12 Nov' }), "You're welcome, Lord! 🙌 Glad it helps.");
  assert.strictEqual(playbook.thanksReply({ first: '', role: 'other' }), "You're welcome! 🙌");
  assert.match(playbook.thanksMidFlowReply({ first: 'Sorah' }), /^You're welcome, Sorah! 🙌 Carry on whenever you're ready/);
});

test('"Does the app really have clients?" gets the numbers, and Ronald is asked to call', () => {
  const reply = playbook.proofReply({
    first: 'Benard',
    stats: { live_listings: 3150 },
    network: { monthly: 10000, countries: 30 },
    own: { properties_live: 6, views: 214, visitors: 151 },
    helpName: 'Ronald'
  });
  assert.match(reply, /^Fair question, Benard\. Here's makaug right now:/);
  assert.match(reply, /• 3,150 live listings/);
  assert.match(reply, /• 10,000\+ people a month searching across our site and social channels/);
  assert.match(reply, /• Visitors from 30\+ countries/);
  assert.match(reply, /• Your 6 live properties have been opened 214 times by 151 people on the site so far/);
  assert.match(reply, /straight to your WhatsApp/);
  assert.match(reply, /Ronald will call you to talk it through\.$/);
  assert.doesNotMatch(reply, /free/i);

  const alert = playbook.proofAlert({ name: 'Benard Gaita', digits: '256752360507', said: 'But does the app really have clients?', agent: { status: 'approved' }, own: { properties_live: 6 } });
  assert.match(alert, /^🔥 \*Agent asking if makaug works — please call\*/);
  assert.match(alert, /Benard Gaita · \+256752360507/);
  assert.match(alert, /https:\/\/wa\.me\/256752360507/);
  assert.match(alert, /Agent approved · 6 properties live/);
});

test('a wrong detail, a sold property and a link that will not open go to the team with the listing', () => {
  const link = 'https://makaug.com/property/000f79c1-ca94-44e8-a25c-994d93c7b0a2';
  assert.match(playbook.correctionReply({ first: 'Benard', link }), /^Thanks, Benard — I've sent that to our team to fix on your listing:\nhttps:\/\/makaug\.com\/property\/000f79c1/);
  const alert = playbook.correctionAlert({
    name: 'Benard Gaita',
    digits: '256752360507',
    said: 'This is in Mukono not nkaaseke',
    listing: { id: 'x', title: '6-bed commercial land for sale in Transformer', district: 'Nakaseke', price: 2300000000 },
    link
  });
  assert.match(alert, /They said: "This is in Mukono not nkaaseke"/);
  assert.match(alert, /Listing: 6-bed commercial land for sale in Transformer — Nakaseke · UGX 2,300,000,000/);
  assert.match(playbook.soldReply({ first: 'Benard', title: 'Matugga 100M ugx' }), /take \*Matugga 100M ugx\* down/);
  assert.match(playbook.linkBrokenReply({ first: 'Lord', link: 'https://makaug.com/property/1d420a2f-c8c1-452e-9474-7cf703491761' }), /^Sorry about that, Lord\. Here's your property again:\nhttps:\/\/makaug\.com\/property\/1d420a2f/);
  assert.match(playbook.linkBrokenReply({ first: 'Migadde', link: 'https://makaug.com/pay/MKXABTZT' }), /Here's your payment link again/);
  assert.strictEqual(playbook.makaugLinkIn('🔗 https://makaug.com/property/1d420a2f-c8c1-452e-9474-7cf703491761\n\nShare that link'), 'https://makaug.com/property/1d420a2f-c8c1-452e-9474-7cf703491761');
  assert.strictEqual(playbook.propertyIdIn('🔗 https://makaug.com/property/1D420A2F-C8C1-452E-9474-7CF703491761'), '1d420a2f-c8c1-452e-9474-7cf703491761');
});

test('a former agent who says "Delete" is told it is done, and the team is told why', () => {
  assert.strictEqual(playbook.formerAgentDeleteReply({ first: 'George' }), "Done, George. You won't get any more messages from us, and we're deleting your details now instead of in 30 days. Thank you for your time with makaug.");
  const alert = playbook.formerAgentDeleteAlert({ name: 'George', digits: '256700000150', said: 'Delete am not interested', removedAt: '2026-11-10T14:04:00Z' });
  assert.match(alert, /Removed on 10 Nov\./);
  assert.match(alert, /please do not contact them again/);
});

test('replies to the agent film after the first one', () => {
  const kinds = {
    'Who is that one': 'who',
    Hello: 'greeting',
    Thanks: 'thanks',
    'Hope no money z required': 'money',
    'Is it free?': 'money',
    '1 and 5': 'menu',
    'List a property': 'menu',
    'I mostly market :- land , houses and cars for sale': 'note',
    'Feel free to call me after 5': 'note'
  };
  for (const [text, kind] of Object.entries(kinds)) {
    assert.strictEqual(film.prospectFollowUpKind(text), kind, text);
  }

  const who = film.prospectFollowUpReply({ kind: 'who', helpName: 'Ronald' });
  assert.match(who, /^Hi! 👋 This is \*makaug\.com\*, Uganda's property website\. Ronald from our team sent you that short film\./);
  assert.match(who, /Reply \*AGENT\* if you'd like to join and Ronald will call you, or ask me anything\.$/);

  const money = film.prospectFollowUpReply({ kind: 'money', helpName: 'Ronald', fee: 50000 });
  assert.match(money, /^Fair question\. Joining makaug as an agent is \*UGX 50,000 a month\*\. That covers all your listings, short stays included, and makaug takes no commission on your deals\./);
  assert.doesNotMatch(money, /free/i);

  // Somebody who has already said AGENT is waiting for Ronald: nothing starts another flow.
  assert.match(film.prospectFollowUpReply({ kind: 'menu', interested: true, first: 'Sorah', helpName: 'Ronald' }), /^You're in the right place, Sorah\. Ronald will call you to set up your agent page first\./);
  const cars = film.prospectFollowUpReply({ kind: 'note', interested: true, first: 'Sorah', helpName: 'Ronald', text: 'I mostly market :- land , houses and cars for sale' });
  assert.match(cars, /land and houses are exactly what makaug is for\. We list property only, so the cars won't go on the site\./);
  assert.match(cars, /I've passed this to Ronald for your call\.$/);
  assert.strictEqual(film.prospectFollowUpReply({ kind: 'thanks', interested: true, first: 'Sorah', helpName: 'Ronald' }), "You're welcome, Sorah! 🙌 Ronald will call you shortly to set you up.");
  // Before AGENT, a menu number or a stray message is the rest of the bot's.
  assert.strictEqual(film.prospectFollowUpReply({ kind: 'menu', interested: false }), '');
  assert.strictEqual(film.prospectFollowUpReply({ kind: 'note', interested: false }), '');

  const note = film.prospectNote({ digits: '256777866452', name: 'Real estate business', said: 'Hope no money z required', kind: 'money', fee: 50000, helpName: 'Ronald' });
  assert.match(note, /^💬 \*Agent prospect asked about money\*/);
  assert.match(note, /I told them: UGX 50,000 a month, all listings, short stays included, no commission\./);
  assert.match(note, /Ronald: they have not said AGENT yet\./);
  assert.ok(film.prospectNoteWorthy('money') && film.prospectNoteWorthy('note'));
  assert.ok(!film.prospectNoteWorthy('thanks') && !film.prospectNoteWorthy('greeting') && !film.prospectNoteWorthy('menu'));
});

test('a business name is not a first name', () => {
  assert.strictEqual(film.personalFirstName('Sorah Estates'), 'Sorah');
  assert.strictEqual(film.personalFirstName('Real estate business'), '');
  assert.strictEqual(film.personalFirstName('Property consultant'), '');
  assert.strictEqual(film.personalFirstName('Emirates property services'), '');
  assert.strictEqual(film.personalFirstName('Engr Jamil'), 'Jamil');
  assert.strictEqual(film.personalFirstName('KASIITA'), 'Kasiita');
});

test('Agent 007 will not "send" the film to a number with the wrong number of digits', () => {
  assert.match(prospects.prospectPhoneProblem('07044120230'), /^That number has 11 digits\. A Ugandan number has 10/);
  assert.ok(!prospects.isUsableProspectPhone('07044120230'));
  assert.match(prospects.prospectPhoneProblem('2567044120230'), /has 13 digits\. With 256 in front, a Ugandan number has 12/);
  for (const ok of ['0772123456', '0700839917', '256752360507', '+256 752 360 507', '772123456', '+447757773202']) {
    assert.strictEqual(prospects.prospectPhoneProblem(ok), '', ok);
    assert.ok(prospects.isUsableProspectPhone(ok), ok);
  }
});

test('"not interested" is not a mortgage question', () => {
  const ai = require('../services/aiService');
  const heuristic = ai.__test?.heuristicIntent || ai.heuristicIntent;
  if (typeof heuristic === 'function') {
    assert.notStrictEqual(heuristic('Delete am not interested').intent, 'mortgage_help');
    assert.strictEqual(heuristic('I need a mortgage').intent, 'mortgage_help');
  }
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'aiService.js'), 'utf8');
  assert.doesNotMatch(source, /\(mortgage\|loan\|deposit\|repayment\|interest\|home loan\)/);
  assert.match(source, /interest rates\?/);
});

test('the runtime checks for an auto-reply before the film, and answers replies before Agent 007 and the menus', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
  const runtime = source.slice(source.indexOf('async function processInboundRuntimeUnlocked'));
  const autoReply = runtime.indexOf('replyPlaybook.looksLikeAutoReply(effectiveBody)');
  const filmHook = runtime.indexOf('handleAgentFilmReply({');
  const payments = runtime.indexOf('handlePaymentClaimMessage({');
  const paused = runtime.indexOf('billingPausedAgentReply({');
  const playbookHook = runtime.indexOf('handleReplyPlaybook({');
  const employee = runtime.indexOf('handleEmployeeWhatsappIntake({');
  assert.ok(autoReply > 0 && autoReply < filmHook, 'auto-replies before the film');
  assert.ok(filmHook < payments, 'film before payments');
  assert.ok(payments < playbookHook && paused < playbookHook, 'payments and paused billing first');
  assert.ok(playbookHook < employee, 'before Agent 007');
  assert.ok(playbookHook < runtime.indexOf('classifyWhatsappIntent({'), 'before the intent guess');
  // Staff are never answered by it, and a person who took over the chat keeps it.
  const handler = source.slice(source.indexOf('async function handleReplyPlaybook'), source.indexOf('async function handleReplyPlaybook') + 2500);
  assert.match(handler, /isStaffIntakeNumber\(\{ phone, session \}\) \|\| staffNameForNumber\(phone\)/);
  assert.match(handler, /'needs_human', 'escalated'/);
  // While posting, "Area is Mukono not nkaaseke" is a fix passed to the team, not "I did not save that".
  const correction = source.slice(source.indexOf('async function applyAgentCorrection'), source.indexOf('async function applyAgentCorrection') + 5000);
  assert.match(correction, /\(\?:not\|instead of\|rather than\)/);
  assert.match(correction, /correction\|correct\|sorry\|actually\|wrong\|change\|price\|area\|location\|place\|district/);
  // "It's sold" keeps its own flow, which finds the listing and marks it sold.
  const playbookBody = source.slice(source.indexOf('async function handleReplyPlaybook'), source.indexOf('async function handleReplyPlaybook') + 9000);
  assert.ok(playbookBody.indexOf('if (isSoldAnnouncement(said)) return null;') > 0
    && playbookBody.indexOf('if (isSoldAnnouncement(said)) return null;') < playbookBody.indexOf('replyPlaybook.soldReply('));
  // The film's follow-ups stay out of an agent's payments.
  const filmReply = source.slice(source.indexOf('async function handleAgentFilmReply'), source.indexOf('async function agentFilmAlertedRecently'));
  assert.match(filmReply, /if \(agentStatus === 'approved'\) return null;/);
  assert.match(filmReply, /PAID\|DEPOSITED\|TRANSFERRED\|TRANSACTION/);
  // "Hello" then "Agent": the first reply is claimed at once, and its alert
  // waits a moment and stands down if they said AGENT meanwhile.
  const claim = filmReply.indexOf("'agent_film_reply_notified'");
  assert.ok(claim > 0 && claim < filmReply.indexOf("deferWhatsappWork('Agent film first reply notice'"));
  assert.match(filmReply, /action = 'agent_join_requested' AND details->>'phone' = \$1 AND created_at >= \$2/);
  // A reply that would repeat our last message word for word is not sent.
  assert.match(filmReply, /has your details and will call you shortly/);
  assert.match(runtime, /if \(filmReply\?\.silent\) return \{ message: '', nextStep: filmReply\.nextStep \|\| sessionStep \};/);
});
