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

// --- After the first reply ---------------------------------------------------
// 12 Nov 2026, the first afternoon of films. What prospects wrote back, and
// what the bot sent them:
//
//   "Who is that one"                    → the greeting menu
//   "Thanks", then "Hope no money z required" → the greeting menu, twice
//   (after AGENT) "1 and 5", "List a property", "Thanks",
//   "I mostly market :- land , houses and cars for sale"
//                                        → a lost reply, the private lister's
//                                          menu, its UGX 20,000-a-property film,
//                                          "I want to keep this quick" and
//                                          "Welcome back … CONTINUE"
//
// Arthur: look at what they said, answer it, and answer the next one the same
// way. Somebody who has the film is answered as a possible agent, by name, with
// one thing to do; what they tell us goes to Ronald for his call.

// The name staff typed is often the business ("Property consultant", "Real
// estate business"): "Hello Real" is worse than no name.
const NOT_A_FIRST_NAME = /^(?:REAL|PROPERTY|PROPERTIES|ESTATE|ESTATES|AGENCY|AGENCIES|AGENT|AGENTS|CONSULTANT|CONSULTANTS|CONSULTS|BUSINESS|COMPANY|CO|LTD|LIMITED|HOME|HOMES|LAND|LANDS|REALTY|REALTOR|REALTORS|BROKER|BROKERS|INVESTMENT|INVESTMENTS|GROUP|ENTERPRISE|ENTERPRISES|SERVICE|SERVICES|MAKAUG|THE|QUICK|BEST|PRIME|ROYAL|GLOBAL|UGANDA|KAMPALA|EMIRATES|HOUSE|HOUSES|RENTALS|PLOTS)$/;
const NAME_TITLES = /^(?:MR|MRS|MS|MISS|DR|ENG|ENGR|HON|PROF|REV|PASTOR|SIR|MADAM)\.?$/i;

function personalFirstName(name = '') {
  const words = clean(name, 80).split(/\s+/).filter(Boolean);
  const word = words.find((w) => !NAME_TITLES.test(w)) || '';
  if (!/^[A-Za-z][A-Za-z'’-]{1,20}$/.test(word)) return '';
  if (NOT_A_FIRST_NAME.test(word.toUpperCase().replace(/[^A-Z]/g, ''))) return '';
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

const PROSPECT_GREETING = /^(?:HI+|HELLO+|HELO|HEY|HEY THERE|HI THERE|HELLO THERE|GOOD (?:MORNING|AFTERNOON|EVENING|DAY)|MORNING|AFTERNOON|EVENING|GREETINGS|GYEBALE ?KO|OLI OTYA|JAMBO|HABARI(?: YAKO)?|MAMBO|NIAJE|SALAM|SALAAM|BONJOUR)(?: (?:SIR|MADAM|BOSS|BRO|TEAM|MAKAUG|THERE|DEAR|FRIEND|PHILLIP|RONALD))?$/;
const PROSPECT_WHO = /\b(?:WHO (?:IS|IZ|R|ARE|S) (?:THIS|THAT|DIS|DAT|U|YOU|SPEAKING|IT|THESE)|WHO THIS|WHO DAT|WHO ARE YOU|WHAT IS (?:THIS|MAKAUG)|WHAT S (?:THIS|MAKAUG)|WHERE DID YOU GET MY (?:NUMBER|CONTACT|NO)|HOW DID YOU GET MY (?:NUMBER|CONTACT|NO)|WHICH COMPANY|WHO SENT (?:THIS|THAT|IT|ME)|I DON T KNOW YOU|DO I KNOW YOU|INTRODUCE YOURSELF)\b/;
const PROSPECT_MONEY = /\b(?:MONEY|PAY|PAYING|PAYMENT|PAYMENTS|CHARGE|CHARGES|CHARGED|CHARGING|FREE|FEE|FEES|COST|COSTS|PRICE|PRICES|SUBSCRIPTION|HOW MUCH|UGX|SHS|SHILLINGS|50K|50 000|50000|COMMISSION)\b/;
const PROSPECT_MENU_PICK = /^(?:[1-6](?: ?(?:AND|N|&|,|\+) ?[1-6])*|LIST(?: A| MY)? PROPERT(?:Y|IES)|LIST|LISTING|POST(?: A| MY)? PROPERT(?:Y|IES)|JOIN|JOIN AS AN AGENT|JOIN MAKAUG|REGISTER|REGISTER ME|SIGN ME UP|SIGN UP)$/;
const PROSPECT_THANKS = /^(?:(?:OK|OKAY|YES|SURE|GREAT|NICE|COOL|ALRIGHT) )?(?:THANKS?|THANK YOU|THANK U|THANKYOU|THANX|THX|TNX|ASANTE|WEBALE|APWOYO)(?: (?:SO MUCH|VERY MUCH|A LOT|MUCH|SANA|NNYO|KO|BRO|BOSS|SIR|MADAM|DEAR|TEAM|AGAIN))*$/;
const CARS = /\b(?:CARS?|VEHICLES?|MOTORS?|MOTORCYCLES?|BODABODA|BODA BODA|BODAS?)\b/;
const PROPERTY_WORDS = /\b(?:LAND|LANDS|PLOTS?|HOUSES?|HOMES?|RENTALS?|APARTMENTS?|COMMERCIAL|SHOPS?|OFFICES?|BUILDINGS?|PROPERT(?:Y|IES))\b/;

function accentless(text = '') {
  return normalise(String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, ''));
}

/**
 * What a prospect's later message is: 'greeting', 'thanks', 'who', 'money',
 * 'menu' (a menu number or "list a property") or 'note' (anything else).
 */
function prospectFollowUpKind(text = '') {
  const t = accentless(text).replace(/\bFEEL FREE\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  if (t.length <= 60 && PROSPECT_GREETING.test(t)) return 'greeting';
  if (t.length <= 80 && PROSPECT_THANKS.test(t)) return 'thanks';
  if (PROSPECT_WHO.test(t)) return 'who';
  if (PROSPECT_MONEY.test(t)) return 'money';
  if (t.length <= 60 && PROSPECT_MENU_PICK.test(t)) return 'menu';
  return 'note';
}

function hi(first = '') {
  return first ? `, ${first}` : '';
}

/**
 * The answer to a prospect's later message. `interested` is someone who has
 * already said AGENT: they are waiting for Ronald's call, so nothing here
 * starts another flow. '' means the rest of the bot answers it.
 */
function prospectFollowUpReply({ kind = '', interested = false, first = '', helpName = 'Ronald', fee = 50000, text = '' } = {}) {
  const feeText = `UGX ${Number(fee || 50000).toLocaleString('en-US')} a month`;
  const join = `Reply *AGENT* if you'd like to join and ${helpName} will call you`;
  switch (kind) {
    case 'greeting':
      return interested
        ? `Hello${hi(first)}! 👋 ${helpName} will call you shortly to set you up as a makaug agent.`
        : `Hello${hi(first)}! 👋 This is *makaug.com*. ${helpName} from our team sent you our short film about listing your properties with us as an agent.\n\n${join}, or ask me anything about it.`;
    case 'thanks':
      return interested
        ? `You're welcome${hi(first)}! 🙌 ${helpName} will call you shortly to set you up.`
        : `You're welcome${hi(first)}! 🙌 If you'd like to list your properties with makaug, reply *AGENT* and ${helpName} will call you to set you up.`;
    case 'who':
      return `Hi${hi(first)}! 👋 This is *makaug.com*, Uganda's property website. ${helpName} from our team sent you that short film.\n\n`
        + 'Agents list their properties with us, and buyers and tenants in Uganda and abroad find them. '
        + (interested ? `${helpName} will call you shortly to set you up.` : `${join}, or ask me anything.`);
    case 'money':
      return `Fair question${hi(first)}. Joining makaug as an agent is *${feeText}*. That covers all your listings, short stays included, and makaug takes no commission on your deals.\n\n`
        + (interested ? `${helpName} will call you to talk it through.` : `Reply *AGENT* and ${helpName} will call you to talk it through.`);
    case 'menu':
      if (!interested) return '';
      return `You're in the right place${hi(first)}. ${helpName} will call you to set up your agent page first. After that you post every property here — the photos, the area and the price — all on the one monthly plan.`;
    case 'note': {
      if (!interested) return '';
      const t = accentless(text);
      const cars = CARS.test(t);
      const lines = [];
      if (cars && PROPERTY_WORDS.test(t)) {
        lines.push(`Thanks${hi(first)} — land and houses are exactly what makaug is for. We list property only, so the cars won't go on the site.`);
      } else if (cars) {
        lines.push(`Thanks${hi(first)}. makaug lists property only — land, houses, rentals, shops and short stays — so cars won't go on the site.`);
      } else {
        lines.push(`Thanks${hi(first)} — I've passed that to ${helpName} for your call.`);
        return lines.join('\n');
      }
      lines.push('', `I've passed this to ${helpName} for your call.`);
      return lines.join('\n');
    }
    default:
      return '';
  }
}

/** Whether Arthur and Ronald should see this message: what they said changes the call. */
function prospectNoteWorthy(kind = '') {
  return kind === 'money' || kind === 'note';
}

/** The note to Arthur and Ronald when a prospect tells us more after the first alert. */
function prospectNote({ digits = '', name = '', said = '', kind = '', interested = false, fee = 50000, helpName = 'Ronald' } = {}) {
  const number = digitsOf(digits);
  const feeText = `UGX ${Number(fee || 50000).toLocaleString('en-US')} a month`;
  return [
    kind === 'money' ? '💬 *Agent prospect asked about money*' : '💬 *More from an agent prospect*',
    `${clean(name, 80) ? `${clean(name, 80)} · ` : ''}+${number}`,
    `WhatsApp: https://wa.me/${number}`,
    `They said: "${clean(said, 300)}"`,
    kind === 'money' ? `I told them: ${feeText}, all listings, short stays included, no commission.` : '',
    interested
      ? `${helpName}: they already said AGENT — this is for your call.`
      : `${helpName}: they have not said AGENT yet. A call usually settles it.`
  ].filter(Boolean).join('\n');
}

module.exports = {
  ARTHUR_WHATSAPP,
  agentFilmAnswer,
  agentJoinAlertRecipients,
  agentInterestNotice,
  joinOrFindPrompt,
  parseJoinOrFind,
  personalFirstName,
  prospectFollowUpKind,
  prospectFollowUpReply,
  prospectNoteWorthy,
  prospectNote
};
