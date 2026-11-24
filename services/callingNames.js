'use strict';

/**
 * Real names for the people we call (Arthur, 24 Nov 2026).
 *
 * Ronald's call list showed where a number had been found as its name:
 * "tiktok.com", "WhatsApp enquirer", "WhatsApp property seeker", "Unnamed".
 * When he marked someone Interested, the name box was already filled in with
 * it, and ten agent profiles opened that day under names like that. Their Hi
 * would have been answered "Hi tiktok.com!".
 *
 * - nameProblem(): what is wrong with a name, or '' when it can be used.
 * - On a call whose name is one of these, the caller is reminded to ask for
 *   the name, and a call that goes on (interested, call back, signed up…)
 *   cannot be saved without one (callingScreen.wrapUp).
 * - Profiles already saved like that are on the caller's Housekeeping list,
 *   "Name to fix", and in a message from King on their dashboard every
 *   morning. Their Hi waits for the name (callingFollowThrough.onHello).
 *
 * - Their WhatsApp name comes first (Arthur, 24 Nov 2026: "we don't want to
 *   prolong the process"): a Hi from one of them, under a WhatsApp name that
 *   is a real name, is approved with it there and then; the ones who wrote to
 *   us before take the name they wrote under. The caller is only asked when
 *   WhatsApp has no real name for them either (nameFromWhatsApp).
 *
 * Everything here stays inside makaug.com: no WhatsApp, SMS or email.
 */
const db = require('../config/database');
const logger = require('../config/logger');
const { maskPhoneLast3 } = require('./outreachSenderName');

// Where a number was found, or an app: never somebody's name.
const PLATFORM = Object.freeze(['tiktok', 'tik', 'tok', 'facebook', 'fb', 'instagram', 'insta', 'ig', 'whatsapp', 'whatsap', 'watsapp', 'youtube', 'yt', 'twitter', 'telegram', 'snapchat', 'linkedin', 'google', 'gmail', 'yahoo', 'jiji', 'olx', 'lamudi', 'property24', 'makaug', 'bolt', 'uber', 'safeboda', 'faras', 'glovo', 'jumia', 'truecaller', 'mtn', 'airtel', 'lyca', 'africell', 'sms', 'online', 'internet', 'website', 'web', 'app', 'link', 'post', 'video', 'status', 'group', 'channel', 'page', 'ad', 'advert', 'advertisement']);
// Stand-ins for a name.
const PLACEHOLDER = Object.freeze(['unnamed', 'unknown', 'noname', 'nameless', 'name', 'no', 'none', 'null', 'undefined', 'na', 'nil', 'contact', 'contacts', 'client', 'clients', 'customer', 'customers', 'caller', 'callers', 'lead', 'leads', 'user', 'someone', 'somebody', 'anonymous', 'private', 'number', 'new', 'prospect', 'person', 'people', 'interested', 'enquirer', 'enquiry', 'enquiries', 'inquirer', 'inquiry', 'seeker', 'seekers', 'sir', 'madam', 'mr', 'mrs', 'ms', 'miss', 'boss', 'bro', 'dear', 'friend', 'hello', 'hi']);
// What somebody does or sells: said with a name, never instead of one.
const GENERIC = Object.freeze(['property', 'properties', 'real', 'estate', 'estates', 'realty', 'realtor', 'realtors', 'home', 'homes', 'house', 'houses', 'housing', 'land', 'lands', 'plot', 'plots', 'soil', 'sand', 'vendor', 'vendors', 'seller', 'sellers', 'dealer', 'dealers', 'broker', 'brokers', 'agent', 'agents', 'agency', 'agencies', 'landlord', 'landlords', 'owner', 'owners', 'rental', 'rentals', 'rent', 'renting', 'apartment', 'apartments', 'hostel', 'hostels', 'room', 'rooms', 'business', 'company', 'ltd', 'limited', 'services', 'service', 'consult', 'consults', 'consultant', 'consultants', 'consulting', 'investment', 'investments', 'enterprise', 'enterprises', 'international', 'uganda', 'ug', 'the', 'and', 'of', 'for', 'in', 'at', 'by', 'a', 'an', 'com']);
const WORDS = Object.freeze({ platform: PLATFORM, placeholder: PLACEHOLDER, generic: GENERIC });

const ASK = 'Ask them: "What name should we put on your makaug page: yours, or your business\'s?"';

// What people call themselves, never a name on their own ("Boss Man", "Uncle").
const NICKNAMES = new Set(['man', 'lady', 'guy', 'boy', 'girl', 'king', 'queen', 'baby', 'babe', 'mummy', 'mum', 'mom', 'mama', 'dad', 'daddy', 'papa', 'sister', 'brother', 'sis', 'aunt', 'aunty', 'auntie', 'uncle', 'jajja', 'gentleman', 'official']);
// A motto or a sentence on a WhatsApp profile, not a name ("God is able",
// "Your trusted property partner").
const NOT_IN_A_NAME = new Set(['is', 'are', 'am', 'be', 'was', 'were', 'will', 'shall', 'can', 'cannot', 'do', 'does', 'did', 'not', 'never', 'always', 'all', 'every', 'everything', 'nothing', 'life', 'time', 'good', 'great', 'mood', 'vibes', 'only', 'your', 'my', 'our', 'me', 'you', 'we', 'us', 'it', 'this', 'that', 'best', 'trusted', 'deals', 'deal', 'sales', 'sale', 'team', 'partner', 'partners', 'solutions', 'world', 'quality', 'affordable', 'luxury', 'top', 'call', 'text', 'dm', 'inbox', 'available', 'here', 'now', 'today', 'god', 'gods', 'jesus', 'lord', 'allah', 'amen', 'favoured', 'favored', 'highly', 'forever']);

const words = (name) => String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .split(/[^a-z0-9]+/).filter(Boolean);

/** What is wrong with a name for greeting someone: '' when it can be used. */
function nameProblem(name = '') {
  const raw = String(name == null ? '' : name).trim();
  const shown = raw.length > 40 ? `${raw.slice(0, 40)}…` : raw;
  if ((raw.match(/\p{L}/gu) || []).length < 2) return raw ? `"${shown}" is not a name.` : 'There is no name for them yet.';
  if (/^n\s*\/\s*a$/i.test(raw)) return `"${shown}" is not a name.`;
  if (/(?:https?:|www\.|@|\.(?:com|ug|net|org|co|io|me|info|biz|tv)\b)/i.test(raw)) return `"${shown}" is where we found them, not their name.`;
  if ((raw.match(/\d/g) || []).length >= 5) return `"${shown}" is a number, not a name.`;
  const list = words(raw).filter((w) => !/^\d+$/.test(w));
  if (!list.length) return ''; // letters, all in another script
  const known = (w) => PLATFORM.includes(w) || PLACEHOLDER.includes(w) || GENERIC.includes(w);
  if (!list.every(known)) return '';
  if (list.some((w) => PLATFORM.includes(w))) return `"${shown}" is where we found them, not their name.`;
  if (list.some((w) => PLACEHOLDER.includes(w))) return `"${shown}" is not a name.`;
  return `"${shown}" says what they do, not who they are.`;
}

/**
 * The name on somebody's WhatsApp profile, when it is a name: "Testa Faith
 * Love 💕🌹" is "Testa Faith Love", "MUMMY TESTINA" is "Mummy Testina",
 * "moses.kato" is "Moses Kato". '' for a motto, a handle run together, a
 * stand-in or what they do ("God is able", "testamosmukasa", "Boss Man").
 */
function nameFromWhatsApp(raw = '') {
  // Emoji joiners and variation selectors are marks with nothing to mark.
  let text = String(raw == null ? '' : raw).normalize('NFKC').replace(/[\uFE00-\uFE0F\u200B-\u200D\u2060]/g, '').replace(/^[^\p{L}]+/u, '');
  // What follows the name: "Sarah | Kampala Homes", "Sarah - Realtor", "Sarah (Kira)".
  text = text.split(/\s[-–—]\s|[|,(\[{/\\:•·~*#@]/)[0];
  // A handle's dots and underscores sit between names.
  text = text.replace(/[._]+/g, ' ').replace(/[^\p{L}\p{M}\s'’-]/gu, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^['’-]+|['’-]+$/g, '').trim();
  if (!text) return '';
  const list = text.split(' ');
  if (list.length > 4) return '';
  const plain = list.map((w) => w.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/['’]s$/, ''));
  if (plain.some((w) => NOT_IN_A_NAME.has(w))) return '';
  // A handle typed as one word: "testamosmukasa".
  if (list.length === 1 && list[0].length > 12 && list[0] === list[0].toLowerCase()) return '';
  const known = (w) => NICKNAMES.has(w) || PLATFORM.includes(w) || PLACEHOLDER.includes(w) || GENERIC.includes(w);
  if (plain.every(known)) return '';
  // A name never starts with what they do: "Real Estate Agent Kira".
  if (GENERIC.includes(plain[0]) || PLATFORM.includes(plain[0])) return '';
  // "MOSES KATO", "moses kato": as a person writes it ("JB" stays).
  const oneCase = text === text.toUpperCase() || text === text.toLowerCase();
  const cased = oneCase
    ? list.map((w) => (w.length <= 2 && text !== text.toLowerCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join(' ')
    : text;
  if (nameProblem(cased)) return '';
  return cased.slice(0, 40).trim();
}

/** The name on the WhatsApp profile they last wrote to us from, or ''. */
async function storedWhatsappName(phoneKey = '', { dbc = db } = {}) {
  const key = String(phoneKey || '').replace(/\D/g, '').slice(-9);
  if (key.length !== 9) return '';
  const row = (await dbc.query(
    `SELECT payload->'metadata'->>'push_name' AS push_name FROM whatsapp_messages
      WHERE user_phone = ANY($1::text[]) AND direction = 'inbound'
        AND COALESCE(payload->'metadata'->>'push_name', '') <> ''
      ORDER BY created_at DESC LIMIT 1`,
    [[`+256${key}`, `256${key}`, `0${key}`]]
  ).catch(() => ({ rows: [] }))).rows[0];
  return row ? String(row.push_name || '') : '';
}

/** Profiles opened on a call, still waiting, under a name that cannot be used. */
async function profilesToFix({ dbc = db } = {}) {
  const found = (await dbc.query(
    `SELECT a.id, a.full_name, a.phone, a.whatsapp, a.created_at,
            p.metadata->>'said_hi_at' AS said_hi_at,
            c.person_key, c.note, c.wrapped_at
       FROM agents a
       LEFT JOIN agent_prospects p ON p.phone_key = RIGHT(REGEXP_REPLACE(COALESCE(a.whatsapp, a.phone, ''), '[^0-9]', '', 'g'), 9)
       LEFT JOIN LATERAL (
         SELECT person_key, note, wrapped_at FROM call_attempts
          WHERE phone_key = RIGHT(REGEXP_REPLACE(COALESCE(a.whatsapp, a.phone, ''), '[^0-9]', '', 'g'), 9) AND status = 'done'
          ORDER BY wrapped_at DESC NULLS LAST LIMIT 1) c ON TRUE
      WHERE a.removed_at IS NULL AND a.status = 'pending' AND a.agent_application_channel = 'calling_interested'
      ORDER BY a.created_at ASC
      LIMIT 200`
  ).catch((error) => {
    logger.warn('Names to fix could not be read', { error: error.message });
    return { rows: [] };
  })).rows;
  return found
    .map((row) => ({ ...row, problem: nameProblem(row.full_name) }))
    .filter((row) => row.problem);
}

/**
 * Profiles to fix whose WhatsApp name we already have, because they wrote to
 * us before: they take it, and come off the callers' lists. One whose Hi was
 * waiting is approved, with the welcome pack. Returns what was filled in.
 */
async function fillFromWhatsapp({ dbc = db } = {}) {
  const filled = [];
  for (const item of await profilesToFix({ dbc })) {
    const name = nameFromWhatsApp(await storedWhatsappName(item.whatsapp || item.phone, { dbc }));
    if (!name) continue;
    const out = await require('./callingFollowThrough').fixProfileName({ agentId: item.id, name, by: 'whatsapp_name' })
      .catch((error) => {
        logger.warn('A WhatsApp name could not be filled in', { error: error.message });
        return null;
      });
    if (!out) continue;
    filled.push({ agent_id: item.id, name, approved: out.approved });
    if (out.approved) {
      require('../routes/admin').runAgentApprovalFollowUps({ agentId: item.id, wasApproved: true, actor: 'calling_name_from_whatsapp' })
        .catch((error) => logger.warn('Welcome after a WhatsApp name not sent', { error: error.message }));
    }
  }
  return filled;
}

const shortDay = (value) => (value ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Kampala' }).format(new Date(value)) : '');

/** The morning message from King: the names to fix before they say Hi (pure). */
function digestBody(items = []) {
  const lines = items.map((it) => {
    const tail = maskPhoneLast3(it.whatsapp || it.phone || '');
    const note = String(it.note || '').replace(/\s+/g, ' ').trim();
    return `• ${it.full_name} · ${tail}${it.said_hi_at ? ' · said Hi, waiting for you' : ''}${note ? ` · "${note.slice(0, 80)}"` : ''}${it.wrapped_at ? ` (${shortDay(it.wrapped_at)})` : ''}`;
  });
  const parts = [
    `${items.length === 1 ? 'This agent was' : `These ${items.length} agents were`} saved from your calls under a name that isn't theirs, so we can't greet them properly yet:`,
    '',
    ...lines,
    '',
    'Please get each one\'s real name, or their business name, with a quick call or WhatsApp, and type it in on the calling screen: 🧹 Housekeeping → Name to fix. Anyone who says Hi before that gets a kind hello and waits; they are approved, with their welcome, the moment you save the name.',
    '',
    'On the calling list, a number with no real name (tiktok.com and the like) is flagged on its call card: ask who you are speaking with. A call that goes on (interested, a call back…) can\'t be saved without their name.'
  ];
  return parts.join('\n');
}

const DIGEST_TITLE = 'Names to fix before they say Hi';

/** Each caller's list, as a message from King on their dashboard, once a day. Returns what was sent. */
async function sendDailyDigest({ dbc = db, now = new Date(), hub = require('./teamHub'), refresh = false } = {}) {
  const items = await profilesToFix({ dbc });
  const people = await hub.staffPeople();
  const userFor = new Map(people.filter((p) => p.person_key).map((p) => [p.person_key, p.user_id]));
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala' }).format(now);
  const byUser = new Map();
  for (const it of items) {
    const userId = userFor.get(String(it.person_key || '')) || '';
    if (!byUser.has(userId)) byUser.set(userId, []);
    byUser.get(userId).push(it);
  }
  // Yesterday's lists are replaced by today's, so only the current one shows;
  // today's too when names were filled in since it went (refresh).
  await dbc.query(
    `UPDATE team_messages SET withdrawn_at = NOW()
      WHERE title = $1 AND withdrawn_at IS NULL AND (created_at AT TIME ZONE 'Africa/Kampala')::date ${refresh ? '<=' : '<'} $2::date`,
    [DIGEST_TITLE, today]
  ).catch(() => null);
  const sent = [];
  for (const [userId, list] of byUser) {
    const audience = userId ? 'person' : 'team';
    const already = (await dbc.query(
      `SELECT id FROM team_messages
        WHERE title = $1 AND withdrawn_at IS NULL AND audience = $2 AND COALESCE(to_user_id::text, '') = $3
          AND (created_at AT TIME ZONE 'Africa/Kampala')::date = $4::date
        LIMIT 1`,
      [DIGEST_TITLE, audience, userId, today]
    ).catch(() => ({ rows: [] }))).rows[0];
    if (already) continue;
    const out = await hub.send({ audience, to_user_id: userId || undefined, kind: 'note', title: DIGEST_TITLE, body: digestBody(list) }, { actor: 'King' });
    sent.push({ audience, count: list.length, id: out.id });
  }
  return { sent, profiles: items.length };
}

/** The title of the note that one of them said Hi, by the last three digits. */
const saidHiTitle = (agent = {}) => `Said Hi, needs a name: ${maskPhoneLast3(agent.whatsapp || agent.phone || '')}`;

/** When one of them says Hi before their name is fixed: the caller is told on their dashboard. */
async function tellCallerSaidHi({ agent = {}, personKey = '', via = 'whatsapp', at = new Date(), hub = require('./teamHub') } = {}) {
  const people = await hub.staffPeople();
  const userId = (people.find((p) => p.person_key && p.person_key === String(personKey || '')) || {}).user_id || '';
  const tail = maskPhoneLast3(agent.whatsapp || agent.phone || '');
  const when = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' }).format(at);
  return hub.send({
    audience: userId ? 'person' : 'team',
    to_user_id: userId || undefined,
    kind: 'note',
    title: saidHiTitle(agent),
    body: [
      `The agent on ${tail} said Hi on ${via === 'sms' ? 'SMS' : 'WhatsApp'} at ${when}, but their profile is under "${agent.full_name}", which isn't their name.`,
      '',
      'They got a kind hello and are waiting. Get their real name, or their business name, with a quick call or WhatsApp, and type it in on the calling screen: 🧹 Housekeeping → Name to fix. They are approved, with their welcome, the moment you save it.'
    ].join('\n')
  }, { actor: 'King' });
}

let digestTimer = null;
let lastDigestDay = '';
/** Every morning from 07:30 Kampala, once a day. */
function startNameDigest({ dbc = db } = {}) {
  if (digestTimer || !process.env.DATABASE_URL || process.env.NAME_DIGEST_ENABLED === 'false') return;
  const tick = async () => {
    const now = new Date();
    const local = new Date(now.getTime() + 3 * 3600 * 1000);
    const day = local.toISOString().slice(0, 10);
    if (lastDigestDay === day) return;
    if (local.getUTCHours() * 60 + local.getUTCMinutes() < 7 * 60 + 30) return;
    lastDigestDay = day;
    try {
      // Names we already have from WhatsApp first: only the rest go to the callers.
      const filled = await fillFromWhatsapp({ dbc });
      if (filled.length) logger.info('Names filled in from WhatsApp', { filled: filled.length });
      const out = await sendDailyDigest({ dbc, now, refresh: filled.length > 0 });
      if (out.sent.length) logger.info('Names to fix sent to the team', { sent: out.sent.length, profiles: out.profiles });
    } catch (error) {
      lastDigestDay = '';
      logger.warn('Names to fix digest failed', { error: error.message });
    }
  };
  digestTimer = setInterval(() => { tick().catch(() => {}); }, 20 * 60_000);
  digestTimer.unref?.();
  const { staggeredBootDelay } = require('../utils/schedulerStagger');
  setTimeout(() => { tick().catch(() => {}); }, staggeredBootDelay('name_digest')).unref?.();
}

module.exports = { WORDS, ASK, DIGEST_TITLE, nameProblem, nameFromWhatsApp, storedWhatsappName, fillFromWhatsapp, profilesToFix, digestBody, sendDailyDigest, saidHiTitle, tellCallerSaidHi, startNameDigest };
