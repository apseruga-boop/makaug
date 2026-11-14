'use strict';

/**
 * Replies to the owner intro film and the how-to-list video.
 *
 * Arthur and Ronald send a private owner the owner film from WhatsApp (Agent
 * 007, option 4). It ends "Reply *LIST* to post your property". The how-to-list
 * video (option 5) ends the same way.
 *
 * Arthur, 14 Nov 2026: "if a normal person wants to list after they have
 * received the video, what is next for them? ... can we get a notification
 * about that ... they say list and then they start the listing process."
 *
 *  - LIST (or yes / ok / "I want to list") starts their listing there and
 *    then, sends the how-to video once, and tells Arthur and Ronald who it is.
 *  - "How much" gets the fee. "Who is this" gets who we are and who sent it.
 *  - "No thanks" marks them declined. Nobody is pinged.
 *  - "I am an agent" is somebody the agent plan suits: they are asked to reply
 *    AGENT, and Arthur and Ronald are told.
 *  - Any other first reply goes to Arthur and Ronald, and the owner is told
 *    it has been passed on.
 *
 * The words are here. routes/whatsapp.js (handleOwnerFilmReply) knows who got
 * the film and does the sending. Replies to the agent film are in
 * agentFilmReplyService.js.
 */

const { personalFirstName } = require('./agentFilmReplyService');
const { publishedPricing, ugxLabel } = require('../config/publishedPricing');

function clean(value, max = 500) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function digitsOf(value) {
  return String(value || '').replace(/\D+/g, '');
}

function normalise(text) {
  return clean(text, 300)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function ownerFee() {
  return Number(publishedPricing().owner_listing.monthly_ugx);
}

const LIST_BARE = /^(?:(?:HI|HELLO) )?(?:LIST|LISTS|LIST IT|LIST PLEASE|LIST PLS|YES|YES PLEASE|YES LIST|OK LIST|OKAY LIST|YEAH|YEP|YE|YEE|NDIO|SURE|START|BEGIN|GO|LETS GO|LET S GO|LETS START|LET S START|POST|POST IT|1|I AM READY|IM READY|READY)$/;
// "Ok" to a film is "I have seen it", not "start my listing".
const ACK = /^(?:OK|OKAY|OKEY|K|KK|KALE|SAWA|NOTED|ALRIGHT|ALL RIGHT|FINE|COOL|GOT IT|SEEN|WELL RECEIVED|RECEIVED|I WILL|I WILL CHECK|LET ME (?:SEE|CHECK|WATCH)(?: IT)?|LATER|WILL DO)$/;
const LIST_WORDS = /\b(?:I WANT TO (?:LIST|POST|SELL|RENT OUT|ADVERTISE)|I WOULD LIKE TO (?:LIST|POST|SELL|ADVERTISE)|I D LIKE TO (?:LIST|POST|SELL)|LIST MY|POST MY|ADVERTISE MY|HOW DO I (?:LIST|POST|START|BEGIN)|HOW CAN I (?:LIST|POST|START)|HELP ME (?:LIST|POST)|I HAVE A (?:HOUSE|PLOT|LAND|PROPERTY|RENTAL|SHOP|APARTMENT)|I M SELLING|I AM SELLING|IM SELLING)\b/;
const NO_WORDS = /^(?:STOP|UNSUBSCRIBE|NO|NOPE|NOT NOW|NEDDA|HAPANA)\b|\b(?:NOT INTERESTED|NO THANKS|NO THANK YOU|WRONG NUMBER|REMOVE ME|DONT SEND|DON T SEND|DO NOT SEND|NOT SELLING|NOTHING TO SELL)\b/;
const AGENT_WORDS = /\b(?:I AM AN? (?:AGENT|BROKER)|I M AN? (?:AGENT|BROKER)|IM AN? (?:AGENT|BROKER)|I AM A PROPERTY AGENT|WE ARE AGENTS|WE ARE AN AGENCY|I SELL FOR OTHER PEOPLE|I SELL FOR CLIENTS|FOR MY CLIENTS)\b|^(?:AGENT|BROKER|AN AGENT)$/;
const MONEY_WORDS = /\b(?:HOW MUCH|PRICE|COST|COSTS|FEES?|CHARGES?|CHARGED|FREE|PAY|PAYING|PAYMENT|MONEY|UGX|SHS|SHILLINGS|20K|20 000|20000|COMMISSION)\b/;
const WHO_WORDS = /\b(?:WHO (?:IS|IZ|R|ARE|S) (?:THIS|THAT|DIS|DAT|U|YOU|SPEAKING|IT|THESE)|WHO THIS|WHO DAT|WHO ARE YOU|WHAT IS (?:THIS|MAKAUG)|WHAT S (?:THIS|MAKAUG)|WHERE DID YOU GET MY (?:NUMBER|CONTACT|NO)|HOW DID YOU GET MY (?:NUMBER|CONTACT|NO)|WHICH COMPANY|WHO SENT (?:THIS|THAT|IT|ME)|I DON T KNOW YOU|DO I KNOW YOU)\b/;
const GREETING = /^(?:HI+|HELLO+|HELO|HEY|HEY THERE|HI THERE|HELLO THERE|GOOD (?:MORNING|AFTERNOON|EVENING|DAY)|MORNING|AFTERNOON|EVENING|GREETINGS|GYEBALE ?KO|OLI OTYA|JAMBO|HABARI(?: YAKO)?|MAMBO|SALAM|SALAAM)(?: (?:SIR|MADAM|BOSS|BRO|TEAM|MAKAUG|THERE|DEAR|FRIEND|PHILLIP|RONALD|ARTHUR))?$/;
const THANKS = /^(?:(?:OK|OKAY|YES|SURE|GREAT|NICE|COOL|ALRIGHT) )?(?:THANKS?|THANK YOU|THANK U|THANKYOU|THANX|THX|TNX|ASANTE|WEBALE|APWOYO)(?: (?:SO MUCH|VERY MUCH|A LOT|MUCH|SANA|NNYO|KO|BRO|BOSS|SIR|MADAM|DEAR|TEAM|AGAIN))*$/;
const HOW_LONG = /\b(?:HOW LONG|HOW MANY DAYS|WHEN (?:WILL|DOES) IT (?:GO LIVE|SHOW|APPEAR)|HOW FAST|HOW QUICK)\b/;

/**
 * What a reply to the owner film means:
 *  'list'     LIST, yes, ok, "I want to list my house"
 *  'no'       no thanks / not interested / stop / wrong number
 *  'agent'    "I am an agent": the agent plan, not this one
 *  'money'    how much / is it free
 *  'who'      who is this / where did you get my number
 *  'how_long' how long does it take
 *  'greeting' | 'thanks' | 'ack' (ok, noted, later)
 *  'other'    anything else
 */
function ownerFilmAnswer(text = '') {
  const t = normalise(text);
  if (!t) return '';
  if (NO_WORDS.test(t)) return 'no';
  if (t.length <= 40 && LIST_BARE.test(t)) return 'list';
  if (t.length <= 80 && AGENT_WORDS.test(t)) return 'agent';
  if (t.length <= 160 && LIST_WORDS.test(t)) return 'list';
  if (WHO_WORDS.test(t)) return 'who';
  if (t.length <= 160 && HOW_LONG.test(t)) return 'how_long';
  if (t.length <= 200 && MONEY_WORDS.test(t.replace(/\bFEEL FREE\b/g, ' '))) return 'money';
  if (t.length <= 60 && GREETING.test(t)) return 'greeting';
  if (t.length <= 80 && THANKS.test(t)) return 'thanks';
  if (t.length <= 40 && ACK.test(t)) return 'ack';
  return 'other';
}

function hi(first = '') {
  return first ? `, ${first}` : '';
}

/** The first message of their listing, in front of the "what are you listing?" question. */
function ownerListStartLine({ first = '' } = {}) {
  return `Let's get it listed${hi(first)}. 🏠 It takes about 5 minutes: a few short questions, your photos, and an ID check that only our team sees.`;
}

/**
 * The answer to anything that is not LIST. '' means the rest of the bot
 * answers it. `passedOn`: Arthur and Ronald have been told what they said.
 */
function ownerFilmReply({ kind = '', first = '', sentBy = '', fee = ownerFee(), passedOn = false } = {}) {
  const feeText = `${ugxLabel(fee)} a month per property`;
  const sender = clean(sentBy, 40) || 'Our team';
  switch (kind) {
    case 'money':
      return `Fair question${hi(first)}. Listing your own property on makaug is *${feeText}*, from the day it goes live. Nothing is charged automatically: when it is live I send you how to pay by MoMo. makaug takes no commission on your sale or your rent.\n\nReply *LIST* to start.`;
    case 'who':
      return `Hi${hi(first)}! 👋 This is *makaug.com*, Uganda's property website. ${sender} from our team sent you that short film.\n\nOwners list their own property with us, and buyers and tenants call them direct.\n\nReply *LIST* to post yours, or ask me anything.`;
    case 'how_long':
      return `About 5 minutes to send it${hi(first)}: a few short questions and your photos. Our team checks it, usually within 24 hours, and I message you the link the moment it is live.\n\nReply *LIST* to start.`;
    case 'greeting':
      return `Hello${hi(first)}! 👋 This is *makaug.com*. ${sender} from our team sent you our short film about listing your own property.\n\nReply *LIST* to start, or ask me anything about it.`;
    case 'thanks':
      return `You're welcome${hi(first)}! 🙌 When you are ready, reply *LIST* and I will take you through it. It takes about 5 minutes.`;
    case 'ack':
      return `👍 Whenever you are ready${hi(first)}, reply *LIST* and I will take you through it. It takes about 5 minutes.`;
    case 'no':
      return `No problem${first ? ` ${first}` : ''}, thank you for letting us know. If you ever want to list a property, reply *LIST* any time.`;
    case 'agent':
      return `Thanks${hi(first)}. If you sell or let for other people, the *agent plan* suits you better: your own agent page, every property under it, and one monthly fee for all of them.\n\nReply *AGENT* and Ronald will call you to set you up. Or reply *LIST* to post one property of your own.`;
    case 'other':
      if (!passedOn) return '';
      return `Thanks for your message${hi(first)}! 🙏 I've passed it to ${sender === 'Our team' ? 'our team' : sender}, who will get back to you.\n\nTo list your property now, reply *LIST*.`;
    default:
      return '';
  }
}

function kampalaDay(date) {
  if (!date) return '';
  try {
    return new Date(date).toLocaleString('en-GB', { timeZone: 'Africa/Kampala', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  } catch (_ignored) {
    return '';
  }
}

function filmLine(film = null) {
  if (!film) return '';
  const what = film.kind === 'lister' ? 'how-to-list video' : 'owner film';
  return `Got the ${what}${film.at ? ` on ${kampalaDay(film.at)}` : ''}${film.by ? ` from ${clean(film.by, 40)}` : ''}.`;
}

/**
 * The WhatsApp to Arthur and Ronald about an owner who got the film.
 *  'list'   they said LIST and their listing has started
 *  'reply'  their first reply, not LIST yet
 *  'agent'  they say they are an agent
 */
function ownerFilmNotice({ kind = 'list', digits = '', name = '', said = '', film = null, helpName = 'Ronald' } = {}) {
  const number = digitsOf(digits);
  const who = clean(name, 80);
  const head = {
    list: '🏡 *Owner wants to list — started on WhatsApp*',
    reply: '📩 *Owner replied to the film*',
    agent: '🧑‍💼 *Sent the owner film, but they are an agent*'
  }[kind] || '📩 *Owner replied to the film*';
  const next = {
    list: 'I have sent the how-to video and started their listing. I will tell you when they submit it. If it goes quiet, a call usually finishes it.',
    reply: `${helpName}: they have not said LIST yet. A quick call usually settles it.`,
    agent: `${helpName}: I asked them to reply AGENT. If they do, you will get the usual "agent wants to join" message.`
  }[kind];
  return [
    [head, `${who ? `${who} · ` : ''}+${number}`, `WhatsApp: https://wa.me/${number}`, filmLine(film), `They said: "${clean(said, 200)}"`].filter(Boolean).join('\n'),
    next
  ].filter(Boolean).join('\n\n');
}

/** The team's WhatsApp when a private owner's property reaches staff review. */
function ownerSubmittedNotice({ title = '', location = '', price = '', photos = 0, ownerName = '', digits = '', reference = '', film = null, adminUrl = 'https://makaug.com/admin' } = {}) {
  const number = digitsOf(digits);
  return [
    '📥 *New property from a private owner — waiting for review*',
    title ? `🏠 ${clean(title, 120)}` : '',
    location ? `📍 ${clean(location, 120)}` : '',
    price ? `💰 ${clean(price, 60)}` : '',
    `📸 ${Number(photos) || 0} ${Number(photos) === 1 ? 'photo' : 'photos'}`,
    `Owner: ${clean(ownerName, 80) || 'not given'}${number ? ` · +${number}` : ''}`,
    reference ? `Ref ${reference}` : '',
    film ? `They came from the ${film.kind === 'lister' ? 'how-to-list video' : 'owner film'}${film.by ? ` ${clean(film.by, 40)} sent` : ''}${film.at ? ` on ${kampalaDay(film.at)}` : ''}.` : '',
    `Review: ${adminUrl} (Listings › pending)`,
    'When you approve it, I send them the link and the payment link, and tell you.'
  ].filter(Boolean).join('\n');
}

/** The team's WhatsApp when a private owner's property goes live and the payment link has gone. */
function ownerLiveNotice({ title = '', ownerName = '', digits = '', url = '', fee = ownerFee(), payLink = '', freeDays = 0, sent = true } = {}) {
  const number = digitsOf(digits);
  const lines = [
    '✅ *Live — private owner*',
    `${clean(ownerName, 80) || 'Owner'}${number ? ` · +${number}` : ''}`,
    title ? `🏠 ${clean(title, 120)}` : '',
    url
  ];
  if (!sent) lines.push('', '⚠️ I could not send them the "your listing is live" message. Please send it from King.');
  else if (payLink) lines.push('', `I sent them the link and the payment link (${ugxLabel(fee)} a month).`, payLink, 'I will tell you the moment they pay, and it stays on *Who still owes* (Agent 007 → 7) until then.');
  else if (Number(freeDays) > 0) lines.push('', `I sent them the link. They are in their ${freeDays} free days.`);
  else lines.push('', 'I sent them the link.');
  return lines.filter((line) => line !== null).join('\n').replace(/\n{3,}/g, '\n\n');
}

module.exports = {
  ownerFilmAnswer,
  ownerFilmReply,
  ownerListStartLine,
  ownerFilmNotice,
  ownerSubmittedNotice,
  ownerLiveNotice,
  personalFirstName
};
