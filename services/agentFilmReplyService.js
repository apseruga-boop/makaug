'use strict';

/**
 * Replies to the agent film.
 *
 * Ronald sends prospects the "makaug for agents" film from WhatsApp (Agent 007,
 * option 3: sendAgentPitchVideo in routes/whatsapp.js). It ends "Reply *AGENT*
 * here if you would like to join and we will set you up."
 *
 * Arthur, 12 Nov 2026: "when they say agent ... I don't know what happened." A
 * bare "AGENT" was read as "find me an agent": the bot asked which district
 * they needed an agent in, and nobody at makaug heard a thing. Now:
 *
 *  - "AGENT" (or yes / interested / how much / call me) after the film is
 *    someone who wants to join. They are told Ronald will call them, and
 *    Arthur and Ronald get a WhatsApp: who it is, what they said, the
 *    questions they will probably ask and what to answer, and how to set them
 *    up.
 *  - Any other first reply to the film still tells Arthur and Ronald (they
 *    engaged), while the bot answers the message as usual.
 *  - "No thanks" marks the prospect declined; nobody is pinged.
 *  - "AGENT" from someone who never got the film is asked: join, or find one?
 *
 * The prospect's row in agent_prospects moves from pitched to interested (or
 * declined), so the prospect list shows who to call.
 */

const ARTHUR_WHATSAPP = '+447757773202';

function clean(value, max = 500) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function digitsOf(value) {
  return String(value || '').replace(/\D+/g, '');
}

function normalise(text) {
  return clean(text, 300).toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * What a reply to the film means:
 *  'agent'      — "AGENT", as the film asks ("Agent please", "Yes agent", "I am an agent")
 *  'interested' — yes / interested / join / how much / call me / tell me more
 *  'no'         — no thanks / not interested / stop / wrong number
 *  'other'      — anything else
 */
// "How does it work?", "I'm interested", "how much is it" — inside a short message too.
const INTEREST_WORDS = /\b(?:INTERESTED|HOW MUCH|PRICE|COST|FEES?|HOW DOES IT WORK|HOW DO I (?:JOIN|REGISTER|START|SIGN UP|PAY)|SIGN ME UP|REGISTER ME|CALL ME|I WANT TO JOIN|I D LIKE TO JOIN|I WOULD LIKE TO JOIN|TELL ME MORE|MORE INFO(?:RMATION)?|JOIN)\b/;

function agentFilmAnswer(text = '') {
  const t = normalise(text);
  if (!t) return '';
  if (/^(?:STOP|UNSUBSCRIBE|NO|NOPE|NOT NOW)\b/.test(t)
    || /\b(?:NOT INTERESTED|NO THANKS|NO THANK YOU|WRONG NUMBER|REMOVE ME|DONT SEND|DO NOT SEND)\b/.test(t)) return 'no';
  if (t.length <= 40 && /^(?:(?:HI|HELLO) )?(?:YES |OK |OKAY )?(?:I AM |IM |I M )?(?:AN )?AGENTS?(?: PLEASE| PLS| YES| HERE| THANKS| THANK YOU)?$/.test(t)) return 'agent';
  if (t.length <= 60 && /^(?:(?:HI|HELLO) )?(?:YES|YES PLEASE|YES I AM|YEAH|YEP|OK|OKAY|SURE)$/.test(t)) return 'interested';
  if (t.length <= 160 && INTEREST_WORDS.test(t)) return 'interested';
  return 'other';
}

/**
 * Who hears that a prospect wants to join: Arthur and Ronald, always (Arthur,
 * 12 Nov 2026: "make sure that I get a notification ... Ronald gets a
 * notification as well"). AGENT_JOIN_ALERT_WHATSAPP (comma-separated) replaces
 * them. The lead-desk alert list still gets it too, as before.
 */
function agentJoinAlertRecipients(env = process.env) {
  const configured = String(env.AGENT_JOIN_ALERT_WHATSAPP || '').split(/[,;\s]+/).filter(Boolean);
  const list = configured.length ? configured : [ARTHUR_WHATSAPP, String(env.AGENT_HELP_CONTACT_PHONE || '+256709402189')];
  const seen = new Set();
  return list.filter((value) => {
    const key = digitsOf(value).slice(-9);
    if (key.length < 9 || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function kampalaDay(date) {
  if (!date) return '';
  try {
    return new Date(date).toLocaleString('en-GB', { timeZone: 'Africa/Kampala', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  } catch (_ignored) {
    return '';
  }
}

/**
 * The WhatsApp to Arthur and Ronald. Ronald calls the prospect, so their full
 * number and a tap-to-chat link are in it; so are the questions a prospect
 * asks on that call and the answers, so the call is quick.
 */
function agentInterestNotice({
  digits = '',
  name = '',
  said = '',
  film = null,
  existing = null,
  fee = 50000,
  helpName = 'Ronald',
  payLine = '',
  replyOnly = false
} = {}) {
  const number = digitsOf(digits);
  const who = clean(name, 80);
  const filmLine = film
    ? `Got the agent film${film.at ? ` on ${kampalaDay(film.at)}` : ''}${film.by ? ` from ${clean(film.by, 40)}` : ''}.`
    : '';
  const feeText = `UGX ${Number(fee || 50000).toLocaleString('en-US')} a month`;
  const head = [
    replyOnly ? '📩 *Agent prospect replied to the film*' : '🧑‍💼 *Agent wants to join makaug — please call*',
    `${who ? `${who} · ` : ''}+${number}${existing ? ` (agent application ${clean(existing.status, 20)})` : ''}`,
    `WhatsApp: https://wa.me/${number}`,
    filmLine,
    `They said: "${clean(said, 200)}"`
  ].filter(Boolean);
  const ask = replyOnly
    ? `${helpName}: they have not said AGENT yet, but they replied. A quick call usually settles it.`
    : `${helpName}: please call them today. I told them you will.`;
  const crib = [
    '*They will probably ask:*',
    `• *How much?* ${feeText}, short stays included. No free trial or free days, no commission. Paid by MoMo (merchant code) or the pay link.`,
    '• *What do I get?* Their own agent page with every listing under it; enquiries come straight to their WhatsApp; Ugandans at home and abroad see their properties.',
    '• *How do I post?* Send photos and the details to the makaug WhatsApp. Our team checks it and it goes live.',
    '• *Is it legit?* MAKAUG ONLINE REAL ESTATE LTD, makaug.com, in 9 languages.',
    '• *What next?* We register them, send the pay link, and approve them once paid.'
  ];
  return [head.join('\n'), ask, crib.join('\n'), clean(payLine, 1000) ? String(payLine).trim() : '']
    .filter(Boolean)
    .join('\n\n');
}

/**
 * The question for "AGENT" from someone who never got the film. Words, not
 * 1/2: a bare "1" from someone with a guest's booking open would accept it.
 */
function joinOrFindPrompt() {
  return [
    '👔 Do you want to *join makaug as an agent* (list your properties with us), or *find an agent* to help you buy, rent or sell?',
    '',
    'Reply *JOIN* or *FIND*.'
  ].join('\n');
}

function parseJoinOrFind(text = '') {
  const t = normalise(text);
  if (/^(1|JOIN|JOIN MAKAUG|JOIN AS AN AGENT|JOIN AS AGENT|AGENT|BECOME AN AGENT|REGISTER|SIGN UP|LIST)$/.test(t)) return 'join';
  if (/^(2|FIND|FIND AN AGENT|FIND AGENT|FIND ONE|SEARCH)$/.test(t)) return 'find';
  return '';
}

module.exports = {
  ARTHUR_WHATSAPP,
  agentFilmAnswer,
  agentJoinAlertRecipients,
  agentInterestNotice,
  joinOrFindPrompt,
  parseJoinOrFind
};
