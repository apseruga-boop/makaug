'use strict';

/**
 * What we say when someone writes back to something we sent them.
 *
 * Arthur, 12 Nov 2026: "have a look at what the response is and what you
 * should respond ... and going forward, you make sure you respond in the same
 * manner." Every rule here is a real reply from 9 to 12 Nov 2026 that the bot
 * answered with the menu, a search or the mortgage notice:
 *
 *   to "your property is live"
 *     "Welcome! This is Kampala&Beyond Property Agency:"  (his WhatsApp
 *       Business auto-reply)                       → a search of Kampala
 *     "Thanks" / "thanks bro"                       → the menu, or "I can help with that…"
 *     "This is in Mukono not nkaaseke"              → a search of Mukono
 *     "its not opening"                             → the menu
 *   from an agent
 *     "But does the app really have clients? I would gladly pay the 50k if
 *       it's working"                               → a search for property under UGX 50,000
 *     a YouTube link, then "Kindly subscribe to my YouTube channel"
 *                                                   → the menu, twice
 *   to the goodbye a former agent gets
 *     "Delete am not interested"                    → the mortgage notice
 *
 * The answers are short, say what happens next, and never repeat themselves.
 * Anything somebody has to act on (a hot lead, a wrong listing, a deletion
 * request) also goes to the team, so the reply is not the end of it.
 *
 * Replies to the agent film are in agentFilmReplyService.js.
 */

function normalise(text = '') {
  return String(text == null ? '' : text)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clean(value, max = 300) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

// --- WhatsApp Business auto-replies -----------------------------------------
// A business account answers any new chat with its greeting or away message,
// within seconds of ours. Answering it starts two machines talking.
const AUTO_REPLY_PATTERNS = [
  /^(?:WELCOME|GREETINGS|DEAR (?:VALUED )?(?:CUSTOMER|CLIENT))\b.{0,40}\b(?:THIS IS|YOU HAVE REACHED|YOU VE REACHED|WELCOME TO)\b/,
  /^WELCOME TO\b/,
  /\bTHANK(?:S| YOU) FOR (?:CONTACTING|REACHING OUT|REACHING|MESSAGING|YOUR MESSAGE|CHOOSING|GETTING IN TOUCH|TEXTING)\b/,
  /\b(?:WE|I) (?:ARE|AM|RE|M) (?:CURRENTLY )?(?:AWAY|UNAVAILABLE|NOT AVAILABLE|OUT OF (?:THE )?OFFICE|CLOSED)\b/,
  /\bWILL (?:GET BACK|RESPOND|REPLY|BE IN TOUCH)(?: TO YOU)? (?:SHORTLY|SOON|AS SOON AS POSSIBLE|ASAP|WITHIN)\b/,
  /\b(?:OUR )?(?:BUSINESS|WORKING|OPENING|OFFICE) HOURS\b/
];

/** How soon after our message an auto-reply arrives. Ten minutes covers a slow bridge. */
const AUTO_REPLY_WINDOW_SECONDS = 600;

function looksLikeAutoReply(text = '') {
  const t = normalise(text);
  if (!t || t.length > 500) return false;
  return AUTO_REPLY_PATTERNS.some((re) => re.test(t));
}

// --- What a reply is ----------------------------------------------------------
const POLITE = '(?:SO MUCH|VERY MUCH|A LOT|LOTS|MUCH|SANA|NNYO|KO|BRO|BOSS|SIR|MADAM|DEAR|MAN|BRA|TEAM|MAKAUG|PHILLIP|RONALD|GUYS|FRIEND|BROTHER|SISTER|AGAIN|INDEED|NOTED|RECEIVED|OK|OKAY)';
const THANKS_FOR = '(?: FOR (?:THE |THIS |THAT |YOUR )?(?:INFO|INFORMATION|UPDATE|MESSAGE|LINK|VIDEO|FILM|BRIEF|NEWS|FEEDBACK|REMINDER|HELP|SUPPORT))?';
const THANKS = new RegExp(`^(?:(?:OK|OKAY|YES|SURE|WOW|GREAT|NICE|COOL|GOOD|ALRIGHT|NOTED) )?(?:THANKS?|THANK YOU|THANK U|THANKYOU|THANX|THNX|THX|TNX|TANX|TANKS|ASANTE|WEBALE|APWOYO|MERCI)${THANKS_FOR}(?: ${POLITE})*$`);
const ACK = /^(?:OK|OKAY|OK OK|OKAY OKAY|K|KK|NOTED|WELL NOTED|ALRIGHT|ALL RIGHT|SURE|FINE|GOT IT|RECEIVED|WELL RECEIVED|COOL|GOOD|GREAT|NICE|AMEN|YES|YEAH|YEP)(?: (?:SIR|MADAM|BOSS|BRO|DEAR|TEAM|THEN))?$/;
// "Okay. That's interesting" (Benard, 12 Nov, after our numbers) got the mortgage notice.
const REACTION = /^(?:(?:OK|OKAY|WOW|OH|AH) )?(?:(?:THAT S|THATS|THAT IS|IT S|ITS|VERY|SO|REALLY) )?(?:INTERESTING|GOOD TO KNOW|NICE TO KNOW|GOOD|GREAT|NICE|COOL|FINE|AWESOME|WONDERFUL|EXCELLENT|AMAZING|IMPRESSIVE)$/;
const EMOJI_ONLY = /^[\s\u{1F44D}\u{1F64F}\u{1F64C}\u{1F44C}\u{1F4AF}\u{2705}\u{1F60A}\u{2764}\u{FE0F}\u{2665}\u{1F91D}\u{1F44F}\u{1F642}\u{263A}\u{1F4AA}]+$/u;

const PROOF = /\b(?:(?:DOES|DO|DID|IS|ARE|WILL|CAN|HAS|HAVE)\b.{0,30}\b(?:CLIENTS?|CUSTOMERS?|BUYERS?|TENANTS?|LEADS?|ENQUIRY|ENQUIRIES|INQUIRY|INQUIRIES|TRAFFIC|VISITORS?)\b|(?:IS|DOES)\b.{0,20}\b(?:IT|THIS|THE APP|THE SITE|THE WEBSITE|MAKAUG|YOUR APP|YOUR SITE)\b.{0,15}\b(?:WORK|WORKING|WORKS|REAL|LEGIT|GENUINE|EFFECTIVE)\b|IF IT S WORKING|IF IT IS WORKING|IF IT WORKS)\b/;

const LINK_BROKEN = /\b(?:NOT|NT|ISN T|IS NOT|CAN T|CANT|CANNOT|CAN NOT|WON T|WONT|DOESN T|DOESNT|DOES NOT|DIDN T|DIDNT|FAILED TO|FAILS TO|UNABLE TO|REFUSED TO|REFUSING TO)\b.{0,12}\b(?:OPEN|OPENING|OPENS|LOAD|LOADING|LOADS|WORK|WORKING|SHOW|SHOWING|GO THROUGH|ACCESS)\b|\b(?:LINK|PAGE|SITE|WEBSITE)\b.{0,12}\b(?:BROKEN|DEAD|ERROR|BLANK|DOWN)\b/;

const SOLD = /\b(?:SOLD|SOLD OFF|SOLD OUT|ALREADY TAKEN|BEEN TAKEN|IS TAKEN|NO LONGER AVAILABLE|NOT AVAILABLE ANYMORE|NOT AVAILABLE AGAIN|ALREADY RENTED|BEEN RENTED|ALREADY OCCUPIED|OFF THE MARKET|TAKE IT DOWN|TAKE IT OFF|PULL IT DOWN|REMOVE THE (?:LISTING|PROPERTY|ADVERT|AD|POST))\b/;

// "This is in Mukono not nkaaseke": a wrong detail on a listing that just went up.
const DETAIL = '(?:LOCATION|DISTRICT|AREA|PLACE|PRICE|TITLE|BEDROOMS?|DECIMALS?|ACRES?|SIZE|PHOTOS?|PICTURES?|DETAILS?|DESCRIPTION|NAME|AMOUNT|FIGURE)';
const CORRECTION = new RegExp([
  // 12 Nov, 20:25: "Its actually 6 acres with a huge warehouse … In mukono"
  // became a second listing instead of a fix to the first.
  '^(?:(?:IT S|ITS|IT IS|THIS IS|THAT IS|THATS|THIS ONE IS|THE (?:PROPERTY|LAND|HOUSE|PLOT|PLACE) IS)\\s+)?ACTUALLY\\b',
  '\\b(?:IT S|IT IS|ITS|THIS IS|THAT IS|THATS|THIS ONE IS|IT IS LOCATED|LOCATED|SITUATED)\\s+(?:IN|AT)\\s+[A-Z0-9]+.{0,30}\\bNOT\\b',
  '\\bNOT\\s+(?:IN|AT)\\s+[A-Z]+',
  // "Area is Mukono not nkaaseke" (the same evening).
  '\\b(?:IS|IN|AT)\\s+[A-Z]+\\s+NOT\\s+(?:IN\\s+|AT\\s+)?[A-Z]+\\b',
  `\\b(?:WRONG|INCORRECT|MISTAKE|NOT CORRECT|NOT RIGHT)\\b.{0,30}\\b${DETAIL}\\b`,
  `\\b${DETAIL}\\b.{0,30}\\b(?:WRONG|INCORRECT|MISTAKE|NOT CORRECT|NOT RIGHT|SHOULD BE)\\b`,
  `\\b(?:THE |MY )?${DETAIL}\\s+IS\\s+(?:IN|AT|ACTUALLY)\\b`,
  '\\b(?:IT|THIS|THAT)\\s+SHOULD BE\\b',
  `\\b(?:PLEASE |PLS |KINDLY )?(?:CORRECT|CHANGE|EDIT|UPDATE|FIX)\\s+(?:IT|THE|THIS|THAT|MY|${DETAIL})\\b`
].join('|'));

const DELETE_ME = /\b(?:DELETE|ERASE|REMOVE ME|REMOVE MY|REMOVE MINE|WIPE)\b/;
const OPT_OUT = /\b(?:STOP|UNSUBSCRIBE|NOT INTERESTED|NO LONGER INTERESTED|DON T (?:MESSAGE|TEXT|CONTACT|SEND|DISTURB)|DONT (?:MESSAGE|TEXT|CONTACT|SEND|DISTURB)|DO NOT (?:MESSAGE|TEXT|CONTACT|SEND|DISTURB)|LEAVE ME|STOP (?:MESSAGING|SENDING|TEXTING))\b/;

const SOCIAL_LINK = /https?:\/\/\S*(?:youtube\.com|youtu\.be|tiktok\.com|facebook\.com|fb\.watch|fb\.com|instagram\.com|twitter\.com|x\.com)\b/i;
const SOCIAL_ASK = /\b(?:SUBSCRIBE TO MY|FOLLOW MY|LIKE MY|CHECK OUT MY|VISIT MY|WATCH MY)\b.{0,20}\b(?:CHANNEL|PAGE|YOUTUBE|TIKTOK|FACEBOOK|INSTAGRAM|ACCOUNT|VIDEOS?)\b/;

/**
 * What a short reply is, in the words above. '' for anything else, which the
 * rest of the bot answers as before.
 */
function replyKind(text = '') {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return '';
  if (EMOJI_ONLY.test(raw)) return 'ack';
  if (SOCIAL_LINK.test(raw)) return 'social';
  const t = normalise(raw);
  if (!t) return '';
  if (t.length <= 80 && THANKS.test(t)) return 'thanks';
  if (t.length <= 40 && (ACK.test(t) || REACTION.test(t))) return 'ack';
  if (t.length > 400) return '';
  if (DELETE_ME.test(t)) return 'delete';
  if (LINK_BROKEN.test(t)) return 'link_broken';
  if (SOLD.test(t)) return 'sold';
  if (CORRECTION.test(t)) return 'correction';
  if (PROOF.test(t)) return 'proof';
  if (SOCIAL_ASK.test(t)) return 'social';
  if (OPT_OUT.test(t)) return 'opt_out';
  return '';
}

/**
 * Whether our message asked them something: a question at the end, numbered
 * options, or "reply YES". An "ok" to that is an answer; to a notice it is not.
 */
function asksSomething(text = '') {
  const t = String(text || '').trim();
  if (!t) return false;
  const lastLine = t.split('\n').map((line) => line.trim()).filter(Boolean).pop() || '';
  if (/\?[\s\p{Extended_Pictographic}\u{FE0F}]*$/u.test(lastLine)) return true;
  if (/(?:^|\n)\s*(?:1️?⃣|1 —|1 -|1\.|1\))\s/u.test(t)) return true;
  return /\breply \*?(?:yes|no|1|2|join|find|continue|confirm|agree)\b/i.test(t);
}

/** The first makaug link in a message: a property, a pay link, a profile, a guide. */
function makaugLinkIn(text = '') {
  const match = String(text || '').match(/https?:\/\/(?:www\.)?makaug\.com\/[^\s)*_]+/i);
  return match ? match[0].replace(/[.,;:!]+$/, '') : '';
}

function propertyIdIn(text = '') {
  const match = String(text || '').match(/makaug\.com\/property\/([0-9a-f-]{36})/i);
  return match ? match[1].toLowerCase() : '';
}

function linkLabel(url = '') {
  if (/\/pay\//i.test(url)) return 'your payment link';
  if (/\/property\//i.test(url)) return 'your property';
  if (/\/agents\//i.test(url)) return 'your profile page';
  if (/\.pdf\b/i.test(url)) return 'the guide';
  return 'the link';
}

// --- Replies -------------------------------------------------------------------
function hi(first = '') {
  return first ? `, ${first}` : '';
}

/** "Thanks" from someone we wrote to: a short answer, never the menu. */
function thanksReply({ first = '', role = '', lastSent = '' } = {}) {
  if (role === 'agent' && /Your property is live/i.test(lastSent)) {
    return `You're welcome${hi(first)}! 🙌 Put the link on your WhatsApp status — every view counts.`;
  }
  if (role === 'agent' && /Morning Brief|Afternoon Brief/i.test(lastSent)) {
    return `You're welcome${hi(first)}! 🙌 Glad it helps.`;
  }
  if (role === 'former_agent') {
    return `You're welcome${hi(first)}. You're always welcome back — just message us here.`;
  }
  return `You're welcome${hi(first)}! 🙌`;
}

/** "Thanks" in the middle of a flow: answer it, and leave them where they were. */
function thanksMidFlowReply({ first = '' } = {}) {
  return `You're welcome${hi(first)}! 🙌 Carry on whenever you're ready — reply with one of the options above, or *MENU* to start again.`;
}

function nfmt(value) {
  return Number(value || 0).toLocaleString('en-US');
}

/**
 * "Does the app really have clients?" Answer with what is true today, and get
 * a person on the phone: someone asking this is deciding whether to pay.
 */
function proofReply({ first = '', stats = {}, network = {}, own = null, helpName = 'Ronald' } = {}) {
  const lines = [`Fair question${hi(first)}. Here's makaug right now:`];
  if (stats.live_listings) lines.push(`• ${nfmt(stats.live_listings)} live listings`);
  if (network.monthly) lines.push(`• ${nfmt(network.monthly)}+ people a month searching across our site and social channels`);
  if (network.countries) lines.push(`• Visitors from ${nfmt(network.countries)}+ countries`);
  if (own && Number(own.properties_live) > 0) {
    const people = Number(own.visitors) > 0 ? ` by ${nfmt(own.visitors)} people` : '';
    lines.push(Number(own.views) > 0
      ? `• Your ${nfmt(own.properties_live)} live ${Number(own.properties_live) === 1 ? 'property has' : 'properties have'} been opened ${nfmt(own.views)} times${people} on the site so far`
      : `• Your ${nfmt(own.properties_live)} live ${Number(own.properties_live) === 1 ? 'property is' : 'properties are'} on the site and in our searches now`);
  }
  lines.push('');
  lines.push('When someone enquires about one of your properties, it comes straight to your WhatsApp — their name, their number and what they asked. makaug takes no commission.');
  lines.push(`${helpName} will call you to talk it through.`);
  return lines.join('\n');
}

function correctionReply({ first = '', link = '' } = {}) {
  return `Thanks${hi(first)} — I've sent that to our team to fix on your listing${link ? `:\n${link}` : '.'}\n\nThey'll let you know when it's done.`;
}

/** A second fix right after the first: added to it, not the same answer again. */
function correctionFollowUpReply({ first = '' } = {}) {
  return `Got it${hi(first)} — I've added that to the same fix for the team.`;
}

function soldReply({ first = '', title = '' } = {}) {
  return `Thanks${hi(first)} — I've told our team to take ${title ? `*${clean(title, 90)}*` : 'it'} down. Send the next one whenever you're ready.`;
}

function linkBrokenReply({ first = '', link = '' } = {}) {
  if (!link) {
    return `Sorry about that${hi(first)}. Send me a screenshot of what you see, and our team will check it.`;
  }
  return `Sorry about that${hi(first)}. Here's ${linkLabel(link)} again:\n${link}\n\nIf it still won't open, send me a screenshot of what you see and our team will check it.`;
}

function socialReply({ first = '' } = {}) {
  return [
    `Thanks${hi(first)} — nice one! 🎬`,
    '',
    'To get those properties on makaug, send each one here: the photos or a short video, what it is, the area and the price. It goes live under your agent page.'
  ].join('\n');
}

function formerAgentDeleteReply({ first = '' } = {}) {
  return `Done${hi(first)}. You won't get any more messages from us, and we're deleting your details now instead of in 30 days. Thank you for your time with makaug.`;
}

function formerAgentOptOutReply({ first = '' } = {}) {
  return `Understood${hi(first)}. You won't get any more messages from us. If you ever want to come back, just message us here.`;
}

// --- Team notes ----------------------------------------------------------------
function who({ name = '', digits = '' } = {}) {
  return `${clean(name, 80) ? `${clean(name, 80)} · ` : ''}+${String(digits || '').replace(/\D/g, '')}`;
}

function proofAlert({ name = '', digits = '', said = '', agent = {}, own = null, helpName = 'Ronald' } = {}) {
  const status = String(agent.status || '');
  return [
    '🔥 *Agent asking if makaug works — please call*',
    who({ name, digits }),
    `WhatsApp: https://wa.me/${String(digits || '').replace(/\D/g, '')}`,
    `They said: "${clean(said, 240)}"`,
    [status ? `Agent ${status}` : '', own && Number(own.properties_live) >= 0 ? `${nfmt(own.properties_live)} ${Number(own.properties_live) === 1 ? 'property' : 'properties'} live` : ''].filter(Boolean).join(' · '),
    '',
    `${helpName}: they are deciding whether it is worth paying. I sent them the numbers; a call today closes it.`
  ].filter((line) => line !== '').join('\n');
}

function listingLine(listing = {}) {
  if (!listing || !listing.id) return '';
  const where = [...new Set([listing.area, listing.district].map((v) => clean(v, 60)).filter(Boolean))].join(', ');
  const price = Number(listing.price) > 0 ? `UGX ${nfmt(listing.price)}` : '';
  return [clean(listing.title, 120), [where, price].filter(Boolean).join(' · ')].filter(Boolean).join(' — ');
}

function correctionAlert({ name = '', digits = '', said = '', listing = null, link = '' } = {}) {
  return [
    '✏️ *Listing correction from an agent — please fix in King*',
    who({ name, digits }),
    `They said: "${clean(said, 240)}"`,
    listing ? `Listing: ${listingLine(listing)}` : '',
    link || '',
    '',
    'Let them know on WhatsApp once it is fixed.'
  ].filter((line) => line !== '').join('\n');
}

function soldAlert({ name = '', digits = '', said = '', listing = null, link = '' } = {}) {
  return [
    '🏷️ *Agent says a listing is no longer available — please take it down*',
    who({ name, digits }),
    `They said: "${clean(said, 240)}"`,
    listing ? `Listing: ${listingLine(listing)}` : '',
    link || ''
  ].filter((line) => line !== '').join('\n');
}

function linkBrokenAlert({ name = '', digits = '', said = '', link = '' } = {}) {
  return [
    '🔗 *Someone says a link we sent will not open*',
    who({ name, digits }),
    `They said: "${clean(said, 240)}"`,
    link ? `The link: ${link}` : 'No makaug link in our last messages to them.',
    'I sent it again and asked for a screenshot if it still fails.'
  ].join('\n');
}

function formerAgentDeleteAlert({ name = '', digits = '', said = '', removedAt = null } = {}) {
  const day = removedAt ? new Date(removedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Kampala' }) : '';
  return [
    '🗑️ *Former agent asked us to delete their details*',
    who({ name, digits }),
    `They said: "${clean(said, 240)}"`,
    day ? `Removed on ${day}. Their ID and personal details are deleted at the next check, instead of after 30 days; their name and number stay so we know them.` : 'Their ID and personal details are deleted at the next check, instead of after 30 days.',
    'They asked for no more messages: please do not contact them again.'
  ].join('\n');
}

module.exports = {
  AUTO_REPLY_WINDOW_SECONDS,
  normalise,
  looksLikeAutoReply,
  replyKind,
  asksSomething,
  makaugLinkIn,
  propertyIdIn,
  linkLabel,
  thanksReply,
  thanksMidFlowReply,
  proofReply,
  correctionReply,
  correctionFollowUpReply,
  soldReply,
  linkBrokenReply,
  socialReply,
  formerAgentDeleteReply,
  formerAgentOptOutReply,
  proofAlert,
  correctionAlert,
  soldAlert,
  linkBrokenAlert,
  formerAgentDeleteAlert
};
