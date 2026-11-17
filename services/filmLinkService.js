'use strict';

/**
 * The joining film, asked for.
 *
 * 15 Nov 2026, 3:42pm UK: WhatsApp restricted the makaug number for "spam,
 * automated or bulk messaging" and removed the link that carries every
 * message. In the three days before, the number had sent the joining film to
 * 33 people who had never written to it. 25 of them never answered. WhatsApp
 * counts the messages a number sends that nobody answers, and a film that
 * arrives from a number its receiver does not know is the one most likely to
 * be blocked or reported.
 *
 * A film that is asked for is none of that: it is a reply. So every member of
 * staff has a link of their own. It opens WhatsApp on the makaug number with
 * "FILM" and their name already typed. The person taps it, presses send, and
 * the film comes back from the makaug number. The link goes wherever staff
 * reach people first: an SMS, a call, a comment under the lister's own post.
 * The film still counts for the member of staff whose link it was.
 *
 * And the number may still write first, a little: a few new chats a day, in
 * working hours, with time between them. The first days after a restriction
 * it writes first to nobody.
 */

const filmLanguages = require('./filmLanguageService');

const FILLER = new Set(['please', 'pls', 'plz', 'me', 'send', 'the', 'for', 'agents', 'agent', 'makaug', 'video', 'from', 'by', 'via']);
// "Film studio", "film location": somebody looking for a place, not asking for the film.
const PLACE_WORDS = new Set([
  'studio', 'studios', 'location', 'locations', 'set', 'house', 'room', 'rooms', 'hall', 'space', 'office', 'shop',
  'land', 'plot', 'rent', 'rental', 'sale', 'hire', 'crew', 'school', 'festival', 'production', 'equipment'
]);

function digitsOf(value = '') {
  return String(value || '').replace(/\D/g, '');
}

/** The number the link opens: makaug's own WhatsApp number. */
function makaugWhatsappDigits(env = process.env) {
  const first = String(env.MAKAUG_WHATSAPP_NUMBER || env.WHATSAPP_BUSINESS_NUMBER || '').split(',')[0];
  return digitsOf(first) || '256780863394';
}

/** "Jane Example" → "JANE": the word that follows FILM in that person's link. */
function staffKey(name = '') {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  return first.normalize('NFKD').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 20);
}

/**
 * The people a film can be credited to, each once, by first name. When two
 * share a first name neither gets a named link (the film would be credited to
 * the wrong one); they share the plain link until one is renamed in King.
 */
function filmLinkStaff(people = []) {
  const byKey = new Map();
  const clashes = new Set();
  for (const person of Array.isArray(people) ? people : []) {
    const key = staffKey(person && person.name);
    const phone = digitsOf(person && person.phone);
    if (!key || phone.length < 9) continue;
    const seen = byKey.get(key);
    if (seen && seen.phone.slice(-9) !== phone.slice(-9)) clashes.add(key);
    if (!seen) byKey.set(key, { key, name: String(person.name).trim().split(/\s+/)[0], phone });
  }
  return [...byKey.values()].filter((person) => !clashes.has(person.key));
}

/** The link a member of staff gives out. With no name it is the plain link. */
function filmLink(name = '', { env = process.env } = {}) {
  const key = staffKey(name);
  return `https://wa.me/${makaugWhatsappDigits(env)}?text=${encodeURIComponent(key ? `FILM ${key}` : 'FILM')}`;
}

/**
 * A chat with the makaug number, "Hi makaug" already typed. For somebody the
 * number may not write to first because they have never written to it: a new
 * agent whose welcome is waiting taps it, presses send, and everything waiting
 * for them goes (17 Nov 2026).
 */
function helloLink({ env = process.env } = {}) {
  return `https://wa.me/${makaugWhatsappDigits(env)}?text=${encodeURIComponent('Hi makaug')}`;
}

// What somebody may put in front of the word: the link types FILM for them,
// and people say hello first.
const OPENING = /^(?:(?:hi|hello|hey|hallo|helo|morning|afternoon|evening|good\s+(?:morning|afternoon|evening|day))\s+)*/i;

/**
 * Read "FILM", "Film Jane", "FILM PETER LUGANDA", "Hello, film please".
 * Returns { staff, lang } or null.
 *
 * FILM followed by the name of a member of staff is what a link types, and is
 * a request for the film whatever else is said around it. FILM on its own has
 * to stand nearly alone: "Film studio for rent in Ntinda" is a search, so
 * every other word has to be a language the film is in or a word that says
 * nothing, with one unknown word allowed (a name we no longer have, a slip of
 * the thumb).
 */
function parseFilmRequest(text = '', staff = []) {
  const clean = String(text || '').replace(/[^\p{L}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > 160) return null;
  const people = filmLinkStaff(staff);
  const words = clean.split(' ');
  const languageIn = (list) => {
    for (const word of list) {
      const language = filmLanguages.languageWord(word);
      if (language) return filmLanguages.filmLanguage(language);
    }
    return '';
  };

  // "FILM JANE", anywhere in what they sent.
  for (let i = 0; i < words.length - 1; i += 1) {
    if (words[i].toLowerCase() !== 'film') continue;
    const key = staffKey(words[i + 1]);
    const person = people.find((entry) => entry.key === key);
    // A language is one named after the name, in a word: a stray "s" or "l"
    // in a longer message is not Swahili or Luganda.
    if (person) return { staff: person, lang: languageIn(words.slice(i + 2).filter((word) => word.length >= 3)) };
  }

  const rest = clean.replace(OPENING, '');
  if (rest.length > 60 || !/^film\b/i.test(rest)) return null;
  const after = rest.slice(4).split(' ').filter(Boolean);
  if (after.length > 5) return null;
  let who = null;
  let lang = '';
  let unknown = 0;
  for (const word of after) {
    const key = staffKey(word);
    const person = people.find((entry) => entry.key === key);
    if (person) { who = who || person; continue; }
    const language = filmLanguages.languageWord(word);
    if (language) { lang = lang || filmLanguages.filmLanguage(language); continue; }
    if (FILLER.has(word.toLowerCase())) continue;
    if (PLACE_WORDS.has(word.toLowerCase())) return null;
    unknown += 1;
    if (unknown > 1) return null;
  }
  return { staff: who, lang };
}

/**
 * Whether the limits on writing first are in force. They are, unless
 * OUTREACH_FIRST_CONTACT_LIMITS says off. Under test (NODE_ENV=test, or Node's
 * own test runner, which is how most of the tests here are run) they are off
 * unless a test turns them on, so that a test of a film going out does not
 * pass or fail by the day and the hour it is run.
 */
function limitsOn(env = process.env) {
  const flag = String(env.OUTREACH_FIRST_CONTACT_LIMITS || '').trim().toLowerCase();
  if (['off', 'false', '0', 'no'].includes(flag)) return false;
  if (['on', 'true', '1', 'yes'].includes(flag)) return true;
  if (env.NODE_TEST_CONTEXT) return false;
  return String(env.NODE_ENV || '').toLowerCase() !== 'test';
}

/**
 * How many chats the number may open in a day by sending a film to somebody
 * who has not written to it, when, and how far apart. `notBefore` is the end
 * of the days it opens none at all.
 */
function outreachLimits(env = process.env) {
  const number = (value, fallback, min, max) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.trunc(n))) : fallback;
  };
  const quiet = new Date(String(env.OUTREACH_FIRST_CONTACT_FROM || '2026-11-18T04:00:00Z'));
  return {
    perDay: number(env.OUTREACH_FIRST_CONTACT_PER_DAY, 5, 0, 50),
    minutesApart: number(env.OUTREACH_FIRST_CONTACT_MINUTES_APART, 20, 0, 240),
    fromHour: number(env.OUTREACH_FIRST_CONTACT_FROM_HOUR, 9, 0, 23),
    toHour: number(env.OUTREACH_FIRST_CONTACT_TO_HOUR, 18, 1, 24),
    notBefore: Number.isNaN(quiet.getTime()) ? null : quiet
  };
}

function kampalaHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Kampala' }).format(date)) % 24;
}

function kampalaDayWords(date) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kampala', weekday: 'long', day: 'numeric', month: 'short' }).format(date);
}

/**
 * Whether the number may write first to one more person now.
 * `sentToday` is how many it has opened today, `lastAt` when it last did.
 * Returns { ok: true, left } or { ok: false, code, why }.
 */
function firstContactDecision({ sentToday = 0, lastAt = null, now = new Date(), limits = outreachLimits() } = {}) {
  if (limits.notBefore && now.getTime() < limits.notBefore.getTime()) {
    return { ok: false, code: 'cooling_off', why: `The makaug number is writing first to nobody until ${kampalaDayWords(limits.notBefore)}. WhatsApp restricted it on 15 Nov for sending films to people who had not written to it.` };
  }
  if (limits.perDay <= 0) {
    return { ok: false, code: 'first_contact_off', why: 'The makaug number does not write first to anybody at the moment.' };
  }
  const hour = kampalaHour(now);
  if (hour < limits.fromHour || hour >= limits.toHour) {
    return { ok: false, code: 'outside_hours', why: `The makaug number only writes first to somebody between ${limits.fromHour}:00 and ${limits.toHour}:00.` };
  }
  if (Number(sentToday) >= limits.perDay) {
    return { ok: false, code: 'daily_limit', why: `The makaug number writes first to ${limits.perDay} new people a day, and today's ${limits.perDay} are used.` };
  }
  const last = lastAt ? new Date(lastAt).getTime() : 0;
  const waitMinutes = last ? Math.ceil(limits.minutesApart - (now.getTime() - last) / 60000) : 0;
  if (waitMinutes > 0) {
    return { ok: false, code: 'too_soon', why: `The last one went a few minutes ago, and they go at least ${limits.minutesApart} minutes apart. Try again in ${waitMinutes} minute${waitMinutes === 1 ? '' : 's'}.` };
  }
  return { ok: true, left: limits.perDay - Number(sentToday) - 1 };
}

// What a member of staff is told while the number writes to nobody first.
const ONLY_WROTE_WHY = 'The makaug number now only writes to people who have written to it first. WhatsApp removed its link on 15 Nov and again on 16 Nov, each time two seconds after it wrote to somebody who had not.';

/**
 * The line under the name-and-number way in Agent 007: how far the number
 * itself will write first, today. Nothing when the limits are off.
 */
function firstContactNote({ now = new Date(), limits = outreachLimits(), on = limitsOn(), onlyWrote = false } = {}) {
  const onlyIfTheyWrote = 'A name and number sent here gets the film only if they have written to this number before. For everybody else, your link.';
  if (onlyWrote) return `_The number itself writes first to nobody. ${onlyIfTheyWrote}_`;
  if (!on) return '';
  if (limits.notBefore && now.getTime() < limits.notBefore.getTime()) {
    return `_Until ${kampalaDayWords(limits.notBefore)} the number itself writes first to nobody. ${onlyIfTheyWrote}_`;
  }
  if (limits.perDay <= 0) return `_The number itself does not write first to anybody at the moment. ${onlyIfTheyWrote}_`;
  return `_The number itself writes first to ${limits.perDay} new people a day, ${limits.fromHour}:00 to ${limits.toHour}:00. Your link is for everybody else._`;
}

/** What a member of staff is told when the number will not write first: why, and their link. */
function useYourLinkMessage({ why = '', name = '', film = 'film' } = {}) {
  return [
    why,
    '',
    `Give them your link instead. Everyone who taps it and presses send gets the ${film} from this number straight away, and it counts for you:`,
    filmLink(name),
    '',
    'Send the link by SMS, say it on a call, or put it under their post.'
  ].join('\n').trim();
}

module.exports = {
  limitsOn,
  makaugWhatsappDigits,
  staffKey,
  filmLinkStaff,
  filmLink,
  helloLink,
  parseFilmRequest,
  outreachLimits,
  firstContactDecision,
  firstContactNote,
  ONLY_WROTE_WHY,
  useYourLinkMessage
};
