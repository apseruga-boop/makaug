'use strict';

/**
 * A person on our team is talking to them.
 *
 * 21 Nov 2026. A message Arthur had approved went to an agent at 08:46 in
 * Kampala, typed in the WhatsApp inbox: a new feature on his project's page,
 * and "When are you free next week?". He answered at 13:41: "Good afternoon
 * Brother", "Hope you are doing well", "I'm always available". His chat was
 * still in the session he posts his properties in, so the assistant answered
 * him: "I did not save that, because it does not describe a property and I
 * did not want to create an empty one", and then the same again, opened with
 * "Here it is again". Nobody on the team was told he had replied.
 *
 * Nothing told the assistant a person was in the middle of a conversation
 * with him. Switching his chat to copilot would not have helped either: an
 * agent's posting session answers before that switch is looked at.
 *
 * So, for a few days after somebody on the team types a message to an agent
 * from the inbox, what that agent types back that is talk (a hello, an "ok",
 * an answer, a question) is theirs: the assistant sends nothing, and the team
 * gets one note with the agent's words. Properties, photos and the words the
 * assistant acts on (COMPLETE, HELP, STATUS, MENU ...) carry on as before.
 */

const DEFAULT_HOURS = 72;
const MAX_HOURS = 14 * 24;

/** How long after a typed message the conversation stays with the person who typed it. */
function threadHours(env = process.env) {
  const hours = Number(env.WHATSAPP_PERSON_THREAD_HOURS);
  return Number.isFinite(hours) && hours >= 1 && hours <= MAX_HOURS ? Math.round(hours) : DEFAULT_HOURS;
}

/** How long the line has to stay quiet before the team's note goes: a few lines sent together make one note. */
function noteQuietMs(env = process.env) {
  const seconds = Number(env.WHATSAPP_PERSON_THREAD_NOTE_QUIET_SECONDS);
  return (Number.isFinite(seconds) && seconds >= 0 && seconds <= 600 ? seconds : 45) * 1000;
}

/** What the inbox marks a message a member of staff sent from it (routes/admin.js, the reply route). */
const SENT_FROM_THE_INBOX = Object.freeze(['admin_human_reply', 'admin_ai_reply']);

/**
 * The last message somebody on the team typed to this number that reached it,
 * inside the window: { at, text }, or null.
 *
 * Read from the queue the bridge sends from, where the inbox says who wrote a
 * message (reply_kind). The copy in whatsapp_messages cannot tell a typed
 * message from an automatic one: both are stored as 'whatsapp_runtime', the
 * source the bridge drains. A message sent without the bridge is marked in
 * whatsapp_messages itself, and is read from there.
 */
async function lastTypedByTeam(db, phone, { hours = threadHours(), now = new Date() } = {}) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 9) return null;
  const result = await db.query(
    `SELECT at, text FROM (
       SELECT COALESCE(sent_at, updated_at) AS at, COALESCE(payload->>'text', '') AS text
         FROM outbound_message_queue
        WHERE user_phone = ANY($1::text[])
          AND channel = 'whatsapp'
          AND status = 'sent'
          AND metadata->>'reply_kind' = ANY($4::text[])
          AND COALESCE(metadata->>'duplicate_suppressed', 'false') <> 'true'
          -- The index is (user_phone, created_at); a message can wait a night in the queue before it goes.
          AND created_at > $2::timestamptz - (($3::int + 48) * INTERVAL '1 hour')
          AND COALESCE(sent_at, updated_at) > $2::timestamptz - ($3::int * INTERVAL '1 hour')
       UNION ALL
       SELECT created_at AS at, COALESCE(payload->>'reply', '') AS text
         FROM whatsapp_messages
        WHERE user_phone = ANY($1::text[])
          AND direction = 'outbound'
          AND payload->>'source' = ANY($4::text[])
          AND created_at > $2::timestamptz - ($3::int * INTERVAL '1 hour')
     ) typed
     ORDER BY at DESC
     LIMIT 1`,
    [[digits, `+${digits}`], now.toISOString(), hours, [...SENT_FROM_THE_INBOX]]
  );
  const row = result.rows && result.rows[0];
  if (!row || !row.at) return null;
  const at = row.at instanceof Date ? row.at : new Date(row.at);
  if (Number.isNaN(at.getTime())) return null;
  return { at, text: String(row.text || '') };
}

function oneLine(value, max = 240) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return Array.from(text).length > max ? `${Array.from(text).slice(0, max - 1).join('')}…` : text;
}

function kampalaWhen(date) {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kampala', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
  } catch (_error) {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/**
 * The note the team gets: who wrote and their words. With `typed` (what
 * somebody on our team last typed to them) it is an answer to a person: the
 * assistant has said nothing, and the reply is theirs to send. Without it,
 * it is a message the assistant could not place and has thanked them for.
 * The number is shown by its last three digits; the reply goes from the
 * inbox, where the conversation is.
 */
function teamNote({ name = '', company = '', phone = '', lines = [], typed = null, siteUrl = 'https://makaug.com' } = {}) {
  const digits = String(phone || '').replace(/\D/g, '');
  const who = oneLine(name, 80) || 'An agent';
  const firm = oneLine(company, 80);
  const said = (Array.isArray(lines) ? lines : []).map((line) => oneLine(line, 300)).filter(Boolean);
  const typedAt = typed && typed.at ? (typed.at instanceof Date ? typed.at : new Date(typed.at)) : null;
  const typedText = typed ? oneLine(typed.text, 160) : '';
  const inbox = `${String(siteUrl || '').replace(/\/+$/, '')}/admin`;
  return [
    typed ? `💬 *${who} wrote back on WhatsApp*` : `💬 *A message from ${who} the assistant could not place*`,
    `${who}${firm && firm.toLowerCase() !== who.toLowerCase() ? ` (${firm})` : ''}${digits.length >= 3 ? ` · number ending ${digits.slice(-3)}` : ''}`,
    '',
    said.length === 1 ? 'They wrote:' : `They wrote (${said.length} messages):`,
    ...said.map((line) => `"${line}"`),
    '',
    typedAt && !Number.isNaN(typedAt.getTime())
      ? `Our team last wrote to them ${kampalaWhen(typedAt)}, Kampala time${typedText ? `: "${typedText}"` : '.'}`
      : '',
    typed
      ? 'The assistant has not answered: a person on our team is talking to them, so this reply is yours.'
      : 'The assistant thanked them and said it had passed this to the team. It is not a property, and not something it has an answer to.',
    typed ? `Answer from the WhatsApp inbox: ${inbox}` : `If it needs an answer, reply from the WhatsApp inbox: ${inbox}`
  ].filter((line, index, all) => line || (index > 0 && all[index - 1])).join('\n');
}

module.exports = {
  DEFAULT_HOURS,
  SENT_FROM_THE_INBOX,
  threadHours,
  noteQuietMs,
  lastTypedByTeam,
  teamNote
};
