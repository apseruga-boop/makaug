'use strict';

/**
 * The joining film, asked for.
 *
 * 15 Nov 2026: WhatsApp restricted the makaug number for "spam, automated or
 * bulk messaging" and removed the link that carries every message. In the
 * three days before, the number had sent the joining film to 33 people who
 * had never written to it, and 25 of them never answered. The same day a
 * target of several hundred films a day was set for the weeks to come.
 *
 * A film somebody asks for is a reply, and replies are what the number is
 * for. So each member of staff has a link that opens WhatsApp on the makaug
 * number with FILM and their name typed. Whoever presses send gets the film,
 * and it counts for that member of staff. The number itself still writes
 * first, to a few new people a day, and to nobody in the first days after
 * the restriction.
 *
 * Every name and number here is made up.
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const links = require('../services/filmLinkService');
const agentFilm = require('../services/agentFilmReplyService');
const route = require('../routes/whatsapp').__test;

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
const STAFF = [
  { name: 'Jane Example', phone: '+447700900123' },
  { name: 'Peter Okello', phone: '256700555830' }
];

test('each member of staff has a link that opens WhatsApp on the makaug number with FILM and their name typed', () => {
  assert.strictEqual(links.filmLink('Jane Example', { env: {} }), 'https://wa.me/256780863394?text=FILM%20JANE');
  assert.strictEqual(links.filmLink('', { env: {} }), 'https://wa.me/256780863394?text=FILM');
  assert.strictEqual(links.filmLink('Peter', { env: { MAKAUG_WHATSAPP_NUMBER: '+256 700 555 001' } }), 'https://wa.me/256700555001?text=FILM%20PETER');
  assert.deepStrictEqual(links.filmLinkStaff(STAFF).map((person) => person.key), ['JANE', 'PETER']);
  // Two people with one first name: neither link can say whose film it was.
  assert.deepStrictEqual(links.filmLinkStaff([...STAFF, { name: 'Jane Other', phone: '256700555831' }]).map((person) => person.key), ['PETER']);
  // The same person listed twice is one person.
  assert.deepStrictEqual(links.filmLinkStaff([...STAFF, { name: 'Jane', phone: '447700900123' }]).map((person) => person.key), ['JANE', 'PETER']);
});

test('FILM is read as a request for the film, and a search for a film studio is not', () => {
  assert.deepStrictEqual(links.parseFilmRequest('FILM JANE', STAFF), { staff: { key: 'JANE', name: 'Jane', phone: '447700900123' }, lang: '' });
  assert.strictEqual(links.parseFilmRequest('film peter', STAFF).staff.name, 'Peter');
  for (const plain of ['FILM', 'Film', ' film. ', 'Film please', 'send me the film', 'FILM for agents'].filter((text) => /^\s*film/i.test(text))) {
    assert.deepStrictEqual(links.parseFilmRequest(plain, STAFF), { staff: null, lang: '' }, plain);
  }
  assert.strictEqual(links.parseFilmRequest('FILM JANE LUGANDA', STAFF).lang, 'lg');
  assert.strictEqual(links.parseFilmRequest('Film Swahili', STAFF).lang, 'sw');
  // A name we do not have still gets the film, credited to nobody.
  assert.deepStrictEqual(links.parseFilmRequest('FILM JANNE', STAFF), { staff: null, lang: '' });
  // People say hello first, and say more after. FILM and the name is what the
  // link typed, whatever is around it.
  assert.strictEqual(links.parseFilmRequest('Hello, FILM JANE', STAFF).staff.name, 'Jane');
  assert.strictEqual(links.parseFilmRequest('*FILM JANE*', STAFF).staff.name, 'Jane');
  assert.deepStrictEqual(links.parseFilmRequest('Good morning. FILM PETER, this is Sarah of Kira Homes, we spoke on the phone', STAFF), { staff: { key: 'PETER', name: 'Peter', phone: '256700555830' }, lang: '' });
  assert.strictEqual(links.parseFilmRequest('FILM JANE it\u2019s Sarah', STAFF).lang, '', 'a stray s is not Swahili');
  assert.strictEqual(links.parseFilmRequest('Hi FILM JANE in Swahili please', STAFF).lang, 'sw');
  assert.deepStrictEqual(links.parseFilmRequest('Hello film please', STAFF), { staff: null, lang: '' });
  assert.deepStrictEqual(links.parseFilmRequest('Good morning, FILM', STAFF), { staff: null, lang: '' });
  for (const not of ['Film studio for rent in Ntinda', 'film location', 'filming a wedding in Kira', 'Film house Kololo', 'I want the film', 'FILM one two', 'Hello, do you have a film studio to rent', 'Hello Jane', '']) {
    assert.strictEqual(links.parseFilmRequest(not, STAFF), null, not);
  }
});

test('the number writes first to a few new people a day, in working hours, some minutes apart, and to nobody while it cools off', () => {
  const limits = { perDay: 5, minutesApart: 20, fromHour: 9, toHour: 18, notBefore: new Date('2026-11-18T04:00:00Z') };
  const noon = new Date('2026-11-18T09:00:00Z'); // 12:00 in Kampala
  const cooling = links.firstContactDecision({ now: new Date('2026-11-16T09:00:00Z'), limits });
  assert.strictEqual(cooling.ok, false);
  assert.strictEqual(cooling.code, 'cooling_off');
  assert.match(cooling.why, /writing first to nobody until Wednesday,? 18 Nov/);

  assert.deepStrictEqual(links.firstContactDecision({ sentToday: 0, now: noon, limits }), { ok: true, left: 4 });
  assert.deepStrictEqual(links.firstContactDecision({ sentToday: 4, lastAt: new Date(noon.getTime() - 21 * 60000), now: noon, limits }), { ok: true, left: 0 });
  const used = links.firstContactDecision({ sentToday: 5, now: noon, limits });
  assert.strictEqual(used.code, 'daily_limit');
  assert.match(used.why, /5 new people a day, and today's 5 are used/);
  const soon = links.firstContactDecision({ sentToday: 1, lastAt: new Date(noon.getTime() - 5 * 60000), now: noon, limits });
  assert.strictEqual(soon.code, 'too_soon');
  assert.match(soon.why, /Try again in 15 minutes/);
  assert.strictEqual(links.firstContactDecision({ now: new Date('2026-11-18T05:30:00Z'), limits }).code, 'outside_hours', '08:30 in Kampala');
  assert.strictEqual(links.firstContactDecision({ now: new Date('2026-11-18T15:00:00Z'), limits }).code, 'outside_hours', '18:00 in Kampala');
  assert.strictEqual(links.firstContactDecision({ now: noon, limits: { ...limits, perDay: 0 } }).code, 'first_contact_off');

  // The defaults, and that they can be changed without a release.
  const defaults = links.outreachLimits({});
  assert.deepStrictEqual({ perDay: defaults.perDay, minutesApart: defaults.minutesApart, fromHour: defaults.fromHour, toHour: defaults.toHour }, { perDay: 5, minutesApart: 20, fromHour: 9, toHour: 18 });
  assert.strictEqual(defaults.notBefore.toISOString(), '2026-11-18T04:00:00.000Z', 'Wednesday 18 Nov, 7:00am in Kampala');
  assert.strictEqual(links.outreachLimits({ OUTREACH_FIRST_CONTACT_PER_DAY: '8', OUTREACH_FIRST_CONTACT_MINUTES_APART: '30' }).perDay, 8);
  assert.strictEqual(links.outreachLimits({ OUTREACH_FIRST_CONTACT_PER_DAY: '900' }).perDay, 50, 'never hundreds');
});

test('the limits are on unless they are turned off, and stay out of tests of other things', () => {
  assert.strictEqual(links.limitsOn({ NODE_ENV: 'production' }), true);
  assert.strictEqual(links.limitsOn({}), true);
  assert.strictEqual(links.limitsOn({ NODE_ENV: 'production', OUTREACH_FIRST_CONTACT_LIMITS: 'off' }), false);
  assert.strictEqual(links.limitsOn({ NODE_ENV: 'test' }), false);
  assert.strictEqual(links.limitsOn({ NODE_ENV: 'test', OUTREACH_FIRST_CONTACT_LIMITS: 'on' }), true);
  // Most tests here are run by Node's test runner and never set NODE_ENV. A
  // test of a film going out must not pass or fail by the day it is run.
  assert.strictEqual(links.limitsOn({ NODE_TEST_CONTEXT: 'child-v8' }), false);
  assert.strictEqual(links.limitsOn({ NODE_TEST_CONTEXT: 'child-v8', OUTREACH_FIRST_CONTACT_LIMITS: 'on' }), true);
  assert.strictEqual(links.limitsOn({ NODE_ENV: 'production', NODE_TEST_CONTEXT: '' }), true);
});

test('a member of staff who is refused is told why and given their link', () => {
  const told = links.useYourLinkMessage({ why: 'The makaug number writes first to 5 new people a day, and today\'s 5 are used.', name: 'Jane Example', film: 'joining film' });
  assert.match(told, /^The makaug number writes first to 5 new people a day/);
  assert.match(told, /Give them your link instead\. Everyone who taps it and presses send gets the joining film from this number straight away, and it counts for you:/);
  assert.match(told, /https:\/\/wa\.me\/\d+\?text=FILM%20JANE/);
  assert.match(told, /by SMS, say it on a call, or put it under their post/);
});

test('Agent 007 shows the link first, and every way a film goes out asks whether the number may write first', () => {
  const prompt = route.agentFilmPromptFor(agentFilm.ARTHUR_WHATSAPP);
  assert.match(prompt, /^🔗 \*Your film link\*\nhttps:\/\/wa\.me\/\d+\?text=FILM%20[A-Z]+\n/);
  assert.match(prompt, /There is no limit on these\./);
  assert.match(prompt, /Name \| phone number|name and (?:phone )?number/i, 'the name-and-number way is still there');
  assert.doesNotMatch(prompt, /writes first/, 'with the limits off, nothing is said about them');
  // With them on, the line under it says how far the number will write first that day.
  const limits = { perDay: 5, minutesApart: 20, fromHour: 9, toHour: 18, notBefore: new Date('2026-11-18T04:00:00Z') };
  assert.strictEqual(links.firstContactNote({ on: false, limits }), '');
  assert.strictEqual(
    links.firstContactNote({ on: true, limits, now: new Date('2026-11-16T06:00:00Z') }),
    '_Until Wednesday 18 Nov the number itself writes first to nobody. A name and number sent here gets the film only if they have written to this number in the last 7 days. For everybody else, your link._'
  );
  assert.strictEqual(
    links.firstContactNote({ on: true, limits, now: new Date('2026-11-18T06:00:00Z') }),
    '_The number itself writes first to 5 new people a day, 9:00 to 18:00. Your link is for everybody else._'
  );
  assert.match(links.firstContactNote({ on: true, limits: { ...limits, perDay: 0 }, now: new Date('2026-11-18T06:00:00Z') }), /does not write first to anybody at the moment/);

  assert.strictEqual((source.match(/await firstContactAllowed\(dialable\)/g) || []).length, 3, 'the agent film, the owner film and the payment link');
  assert.match(source, /sendAgentPitchVideo\(\{ phone: digits, name, sentBy: who \? who\.phone : 'film_link', lang: asked\.lang, askedFirst: true \}\)/, 'a film that was asked for says so');
  assert.match(source, /I could not send the film just then\. Please send \*FILM\* again in a minute\./, 'and when it cannot be sent they are told, not answered as if FILM were a search');
  assert.match(source, /metadata->>'first_contact' = 'true'/, 'only the number writing first is counted against the day');
  // A payment link to somebody new is counted as one of the day's too, film or no film.
  assert.match(source, /writingFirst = firstContact\.ok && !firstContact\.wrote && !firstContact\.unlimited;/);
  assert.match(source, /requestedBy: phone,\n\s+firstContact: writingFirst\n/);
  assert.match(source, /message_kind: 'agent_pay_link_staff_sent',[\s\S]{0,400}\.\.\.\(firstContact \? \{ first_contact: true \} : \{\}\),/);
  // Before a reply to a film is looked for: FILM is the start, not an answer.
  assert.ok(source.indexOf('const filmAsked = await handleFilmLinkRequest({') < source.indexOf('const ownerFilmReplied = await handleOwnerFilmReply({'));
  assert.ok(source.indexOf('const filmAsked = await handleFilmLinkRequest({') > 0);
});

test('with the limits off, as under test, a film goes as it always did', async () => {
  assert.deepStrictEqual(await route.firstContactAllowed('256700555061'), { ok: true, wrote: false, unlimited: true });
});
