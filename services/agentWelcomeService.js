'use strict';

const { agentGreetingName } = require('./agentNameService');

// Welcome pack for an agent who has just joined makaug: the platform's real
// numbers, where its audience watches from, and a WhatsApp message that
// explains makaug without the agent needing to open the site.

const db = require('../config/database');
const { countryName } = require('./visitorCountryService');
const { brokerReportUrl, ensureAgentNumber, siteUrl } = require('./agentWeeklyReportService');
const { cardToken, cardVersion } = require('./agentReportCardService');

const STATS_TIMEOUT_MS = () => Number(process.env.AGENT_WELCOME_STATS_TIMEOUT_MS || 6000);

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function nfmt(value) {
  return toInt(value).toLocaleString('en-GB');
}

function safe(promise, fallback) {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), STATS_TIMEOUT_MS()))
  ]);
}

// Platform-wide numbers, cached briefly: every welcome message asks for these.
let statsCache = { at: 0, value: null };

async function computePlatformStats({ force = false } = {}) {
  const ttl = Number(process.env.AGENT_WELCOME_STATS_TTL_MS || 10 * 60 * 1000);
  if (!force && statsCache.value && Date.now() - statsCache.at < ttl) return statsCache.value;

  const [listings, agents, traffic, countries] = await Promise.all([
    safe(db.query(`SELECT COUNT(*)::int AS total FROM properties WHERE status = 'approved'`), { rows: [] }),
    safe(db.query(`SELECT COUNT(*)::int AS total FROM agents WHERE status = 'approved'`), { rows: [] }),
    safe(db.query(
      `SELECT COUNT(*)::int AS views, COUNT(DISTINCT client_id)::int AS visitors
       FROM analytics_events
       WHERE event_name = 'property_open' AND created_at >= NOW() - INTERVAL '30 days'`
    ), { rows: [] }),
    safe(db.query(
      `SELECT country_code AS code, COUNT(DISTINCT client_id)::int AS visitors
       FROM analytics_events
       WHERE event_name = 'property_open' AND country_code IS NOT NULL
         AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY 1 ORDER BY 2 DESC LIMIT 20`
    ), { rows: [] })
  ]);

  // countryName() hands back the raw code when it does not recognise it, which
  // put bubbles reading "BR" and "BD" on the welcome video and in the message
  // as if they were country names. A code we cannot name is a code we should
  // not show an agent.
  const countryRows = (countries.rows || [])
    .map((row) => ({ code: row.code, name: countryName(row.code), visitors: toInt(row.visitors) }))
    .filter((row) => row.name && row.name !== row.code);

  const value = {
    live_listings: toInt(listings.rows[0]?.total),
    agents: toInt(agents.rows[0]?.total),
    views_30d: toInt(traffic.rows[0]?.views),
    visitors_30d: toInt(traffic.rows[0]?.visitors),
    countries_count: countryRows.length,
    top_countries: countryRows.slice(0, 12),
    diaspora_countries: countryRows.filter((c) => c.code !== 'UG').slice(0, 10)
  };
  statsCache = { at: Date.now(), value };
  return value;
}

async function fetchAgent(agentId) {
  const result = await db.query(
    `SELECT id, makaug_agent_number, full_name, greeting_name, company_name, phone, whatsapp, email, status, created_at,
            fee_offer_mode, fee_offer_until, fee_offer_at, paid_until, fee_exempt, profile_photo_url
     FROM agents WHERE id = $1 LIMIT 1`,
    [agentId]
  );
  return result.rows[0] || null;
}

function agentProfileUrl(agent) {
  return `${siteUrl()}/agents/${encodeURIComponent(agent.id)}`;
}

function shareCardUrl(agent, version) {
  const stamp = String(version || new Date().toISOString().slice(0, 10).replace(/\D/g, ''));
  const token = cardToken(`${agent.id}:share`, stamp);
  if (!token) return '';
  return `${siteUrl()}/api/agents/share-card/${encodeURIComponent(agent.id)}.png?v=${stamp}&t=${token}`;
}

async function countAgentListings(agentId) {
  const result = await safe(db.query(
    `SELECT COUNT(*)::int AS total FROM properties p
     WHERE (p.agent_id::text = $1::text OR COALESCE(p.extra_fields, '{}'::jsonb)->>'broker_agent_id' = $1::text)
       AND p.status = 'approved'`,
    [agentId]
  ), { rows: [] });
  return toInt(result.rows[0]?.total);
}

async function buildWelcomePack(agentId) {
  const agent = await ensureAgentNumber(await fetchAgent(agentId));
  if (!agent) {
    const error = new Error('Agent not found');
    error.status = 404;
    throw error;
  }
  const [stats, listings] = await Promise.all([computePlatformStats(), countAgentListings(agent.id)]);
  return {
    agent,
    stats,
    listings,
    profile_url: agentProfileUrl(agent),
    share_card_url: shareCardUrl(agent)
  };
}

const VERTICALS = 'Rent · Buy · Land · Commercial · Students · Off Plan · Short stays';

// ---------------------------------------------------------------------------
// The audience we can honestly claim.
// ---------------------------------------------------------------------------
/**
 * makaug's own analytics count one narrow thing: people who opened a listing on
 * makaug in the last 30 days. The number an agent actually cares about is the
 * whole network — every makaug property is also searchable from the other
 * marketplaces in the group, and the traffic that matters is the sum.
 *
 * That figure does not live in this database, so it is stated here rather than
 * measured, and it is kept in one place with an env override so it can be
 * corrected without a deploy. Anything measured (live listings, the agent's own
 * listing count) still comes from the database — a number we quote to an agent
 * should be one we can stand behind if they ask where it came from.
 */
function networkAudience() {
  const monthly = toInt(process.env.NETWORK_MONTHLY_VISITORS || 10000) || 10000;
  const target = toInt(process.env.NETWORK_MONTHLY_VISITORS_TARGET || 20000) || 20000;
  const countries = toInt(process.env.NETWORK_COUNTRIES || 30) || 30;
  return { monthly, target, countries, target_month: targetMonthName() };
}

/** "the end of October" — computed, so the promise never names a month that has been and gone. */
// Countries our social channels are reaching beyond what the site's own
// analytics has counted yet. Arthur's list, 10 Oct 2026; override without a deploy.
function networkExtraCountries() {
  return String(process.env.NETWORK_EXTRA_COUNTRIES || 'Canada, South Africa, Germany, Sweden, Switzerland')
    .split(',').map((n) => n.trim()).filter(Boolean);
}

function targetMonthName(now = new Date()) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
}

function shortDay(iso) {
  const d = new Date(`${String(iso || '').slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// An agent approved with a free period: the 14-day trial new agents had from
// 10 Oct to 10 Nov 2026, or a free period staff give by hand. Null for everyone
// else (new agents get no free days since 10 Nov 2026).
function trialTerms(agent = {}) {
  if (agent.fee_offer_mode !== 'free_period' || !agent.fee_offer_until) return null;
  const revenue = require('./revenueService');
  const ends = revenue.isoDay(agent.fee_offer_until);
  if (!ends) return null;
  const start = agent.fee_offer_at ? revenue.kampalaDate(new Date(agent.fee_offer_at)) : revenue.kampalaDate();
  return {
    start: shortDay(start),
    ends: shortDay(ends),
    first_due: shortDay(revenue.addDays(ends, 1)),
    fee: Number(revenue.feeConfig().feeUgx || 50000).toLocaleString('en-US')
  };
}

function buildWelcomeMessage({ agent = {}, stats = {} } = {}) {
  const firstName = agentGreetingName(agent, 'there');
  const lines = [];
  lines.push('*Welcome to makaug.com*');
  lines.push(`Hi ${firstName}, your agent account is live. Here is what you have joined.`);
  if (agent.makaug_agent_number) {
    lines.push('');
    lines.push(`Your Agent ID: *${agent.makaug_agent_number}*`);
    lines.push('Quote it whenever you contact the makaug team.');
  }

  lines.push('');
  lines.push('*Your profile is live*');
  lines.push(`${agentProfileUrl(agent)}`);
  lines.push('Everything you list shows there — send that link to any buyer, or put the picture card below on your WhatsApp status.');
  // Agents who already have a picture on their page are not asked for one.
  if (!agent.profile_photo_url) {
    lines.push('');
    lines.push('*Add your profile picture*');
    lines.push('Reply *MY PHOTO* and send a clear photo of you, or your company logo. I tidy it up, put it on your profile and message you the moment it is live. Pages with a face or a logo get more enquiries.');
  }

  // The thing an agent actually wants to know, said before anything else we
  // might want to say about ourselves.
  const network = networkAudience();
  lines.push('');
  lines.push('*We send you the buyer*');
  lines.push('When someone enquires about one of your properties, that enquiry goes straight to you on WhatsApp — their name, their number and what they asked. You call them back yourself.');
  lines.push('makaug takes no commission and never sits in the middle of your deal.');

  lines.push('');
  lines.push('*What makaug is*');
  lines.push('Uganda’s property market, online — and we are building it into the place every Ugandan looks first, at home and abroad:');
  lines.push(VERTICALS);
  lines.push('The site runs in 9 languages, including Luganda, Swahili and Arabic, because our buyers are not all in Kampala.');

  const scale = [];
  if (stats.live_listings) scale.push(`• ${nfmt(stats.live_listings)} live listings`);
  scale.push(`• ${nfmt(network.monthly)}+ people a month searching across our platforms`);
  scale.push(`• Visitors from ${nfmt(network.countries)}+ countries, and the list grows every month`);
  // visitors_30d is deliberately not listed: a makaug-only head count next to the
  // network figure reads as two answers to the same question.
  if (stats.views_30d) scale.push(`• ${nfmt(stats.views_30d)} listing views on makaug in the last 30 days`);
  if (toInt(stats.agents) >= 25) scale.push(`• ${nfmt(stats.agents)} agents and brokers already listing`);
  scale.push(`• On track for ${nfmt(network.target)} a month by the end of ${network.target_month}`);
  lines.push('');
  lines.push('*The audience you just joined*');
  lines.push(...scale);

  // Filtered here as well as in computePlatformStats: whoever assembled these
  // stats, a code we have no name for must not reach an agent dressed as a
  // country. "Ugandans abroad are searching from BR, BD" is not a sentence we
  // send anyone.
  const live = (Array.isArray(stats.diaspora_countries) ? stats.diaspora_countries : [])
    .filter((c) => c && c.name && String(c.name) !== String(c.code))
    .map((c) => c.name);
  const seen = new Set(live.map((n) => n.toLowerCase()));
  const where = [...live, ...networkExtraCountries().filter((n) => !seen.has(n.toLowerCase()))].slice(0, 12);
  lines.push('');
  lines.push('*Built for the diaspora*');
  if (where.length) {
    lines.push(`People are finding makaug from ${where.join(', ')} and more — across the site and our social channels (TikTok, Instagram, X, YouTube and LinkedIn). They find your listing before they land.`);
  } else {
    lines.push('Ugandans in the UK, UAE, USA and across East Africa buy and build at home — they search first, then send money or fly in.');
  }
  lines.push('That is why a short video, a clear price and the exact area sell a listing here.');

  lines.push('');
  lines.push('*Why makaug is the best place to be found*');
  lines.push('• Your phone number sits on your listing — buyers call you directly');
  lines.push('• Buyers arrive from Google, our Ask AI search and our WhatsApp assistant');
  lines.push('• Video-first listings: a walk-through can sell to someone who is 6,000 km away');
  // The message says nothing about fees or free periods (Arthur, 10 Oct 2026):
  // the payment link follows the pack on its own, and an agent's listings are
  // covered by the agent plan, so the old per-listing "first 7 days free" line
  // has no replacement here (10 Nov 2026).
  lines.push('• Built for investors too: off plan, buy-to-let and a mortgage finder');
  lines.push('• You get a weekly WhatsApp report: views, visitors, enquiries and the countries watching you');

  lines.push('');
  lines.push('*How to post a property — right here on WhatsApp*');
  lines.push('This number knows you are a makaug agent, so there is nothing to log in to. Message from the number you registered with.');
  lines.push('1. Say *hello* — you get your agent menu');
  lines.push('2. Send the property: photos, or better, a short walk-through video');
  lines.push('3. In the caption: what it is, rent or sale, the exact area and district, and the price');
  lines.push('   e.g. “3 bedroom house for rent in Kira, Wakiso — UGX 1.2m a month”');
  lines.push('4. I confirm it straight away and tell you if anything is missing');
  lines.push('5. Our team reviews it, and I send you the link the moment it is live');
  lines.push('One property per message. Reply *SHARE* for your link and card, *STATUS* to check your properties, *HELP* for a person.');
  lines.push('You can also post it yourself on the site, whichever you prefer.');

  lines.push('');
  lines.push(`Start here: ${siteUrl()}/list-property`);
  lines.push(`Your dashboard: ${brokerReportUrl()}`);
  lines.push('Welcome aboard — reply to this message any time you need a hand.');
  return lines.join('\n').slice(0, 4000);
}

function buildShareCardCaption({ agent = {} } = {}) {
  const lines = ['*Your makaug share card*'];
  lines.push('Save this picture and put it on your WhatsApp status, or send it to a buyer.');
  lines.push('Anyone who scans the code lands on your makaug profile and every property you have live.');
  lines.push(agentProfileUrl(agent));
  return lines.join('\n');
}

function buildWelcomeCaption({ agent = {}, stats = {} } = {}) {
  const firstName = agentGreetingName(agent, 'there');
  const lines = [`*Welcome to makaug.com, ${firstName}!*`];
  if (agent.makaug_agent_number) lines.push(`Your Agent ID: *${agent.makaug_agent_number}*`);
  const network = networkAudience();
  const bits = [];
  if (stats.live_listings) bits.push(`${nfmt(stats.live_listings)} live listings`);
  bits.push(`${nfmt(network.monthly)}+ searchers a month`);
  bits.push(`${nfmt(network.countries)}+ countries`);
  lines.push(bits.join(' · '));
  lines.push('');
  lines.push('Enquiries on your properties come straight to this number.');
  lines.push('The full details follow in the next message.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The welcome an agent gets on the day they are approved (15 Nov 2026)
// ---------------------------------------------------------------------------
/**
 * Approval used to send seven to nine messages inside a minute: a personal
 * film, the 3,200-character message above, a share card, the how-to film, the
 * guide, the terms and the payment message, in whatever order the bridge sent
 * them. The two things a new agent has to do, accept the terms and pay, were
 * the sixth and seventh messages, and both were going unanswered.
 *
 * So it is three messages, in a fixed order, built round what the agent has
 * to do next:
 *   1. approved: their ID, their page and the steps, numbered;
 *   2. the one-minute how-to-post film;
 *   3. the payment message with the MoMo card, when a payment is due.
 * The share card (SHARE), the guide (its link is under the film) and a person
 * (HELP) are a word away rather than pushed at them on the first day. The long
 * message above is no longer part of it.
 */

const WELCOME_FILM_AFTER_MS = 20 * 1000;
const WELCOME_PLAN_AFTER_MS = 45 * 1000;
const WELCOME_NIGHT_FROM_HOUR = 22;
const WELCOME_NIGHT_TO_HOUR = 7;
const WELCOME_MORNING = { hour: 7, minute: 30 };
/** Somebody who wrote to us this recently is awake and in the chat. */
const WELCOME_IN_CHAT_MINUTES = 30;

function feeLabel() {
  const revenue = require('./revenueService');
  return `UGX ${Number(revenue.feeConfig().feeUgx || 50000).toLocaleString('en-GB')}`;
}

/**
 * The first message: approved, and what to do, in the order it is quickest to do it.
 * payment: 'follows' when the payment message is the last of the three, '' when nothing is due now.
 */
function buildApprovedMessage({ agent = {}, listings = 0 } = {}, { payment = '', termsAccepted = false } = {}) {
  const docs = require('./listingDocsService');
  const first = agentGreetingName(agent, '');
  const live = toInt(listings);
  const trial = trialTerms(agent);
  const lines = [`✅ *You are approved${first ? `, ${first}` : ''}. Welcome to makaug.*`, ''];
  if (agent.makaug_agent_number) lines.push(`Your agent ID: *${agent.makaug_agent_number}*`);
  lines.push(`Your page: ${agentProfileUrl(agent)}`);
  if (live) lines.push(`You already have ${nfmt(live)} ${live === 1 ? 'property' : 'properties'} live on it.`);

  const steps = [];
  if (!termsAccepted) steps.push(`Reply *AGREE* to accept the agent terms: ${docs.docUrls('agent_terms').pdf}`);
  steps.push(`Send your ${live ? 'next' : 'first'} property: photos or a short video, with what it is, the exact area and the price. The one-minute video below shows how.`);
  if (payment === 'follows' && !trial) steps.push(`Pay your plan, ${feeLabel()} a month. How to pay is in the last message below.`);
  const count = ['', 'One thing', 'Two things', 'Three things'][steps.length];
  lines.push('', `*${count} to do, in this chat:*`);
  steps.forEach((step, index) => lines.push(`*${index + 1}.* ${step}`));

  // A free period somebody gave them by hand: said once, with the day it ends.
  if (trial) {
    lines.push('', `🎁 Your plan is free until ${trial.ends}. From ${trial.first_due} it is UGX ${trial.fee} a month, and we remind you before then.`);
  }
  lines.push('', 'Every enquiry on your properties comes straight to this number, with the buyer’s name and number. makaug takes no commission.');
  lines.push('', 'Reply *HELP* at any time and a person will answer.');
  return lines.join('\n');
}

/** The second message: the how-to-post film, in the language they were first written to in. */
function buildHowToFilm({ agent = {} } = {}, { lang = '' } = {}) {
  const howTo = require('./agentHowToPostBroadcastService');
  const films = require('./filmLanguageService');
  const docs = require('./listingDocsService');
  const code = films.filmLanguage(lang);
  const name = agentGreetingName(agent, '');
  const guide = docs.docUrls('agent_guide').pdf;
  const caption = code
    ? [films.filmMessage('agent_howto', code, { first: name, greet: false }), '', `📘 Agent guide (PDF): ${guide}`].join('\n')
    : [
      howTo.buildWelcomeFilmCaption({ name }),
      '',
      '*SHARE* gives you your page link and card. *STATUS* shows where your properties are. *HELP* gets you a person.',
      `The two-page agent guide: ${guide}`
    ].join('\n');
  return { url: films.filmPath(howTo.videoUrl(), code), caption, lang: code };
}

/**
 * The third message: the plan and how to pay it, under the MoMo card.
 * As the last of the welcome it does not say "approved" again; sent on its own
 * (the welcome went earlier, or was not wanted) it does.
 */
function buildPlanMessage({ agent = {}, methodLine = '', url = '', withWelcome = true } = {}) {
  const first = agentGreetingName(agent, 'there');
  const pay = [methodLine, '', url ? `Your payment page: ${url}` : '', 'Your listings stay live while you are paid up.'].filter((line, index, all) => line !== '' || (all[index - 1] !== '' && index > 0)).join('\n');
  if (!withWelcome) {
    return `✅ *You are approved, ${first}* — your makaug agent account is live.\n\nYour subscription is ${feeLabel()} a month.\n${pay}`;
  }
  return `💳 *Your makaug plan: ${feeLabel()} a month*\n\n${pay}`;
}

/** When the Kampala night ends, if it is night there now: 7:30 in the morning. Null in the day. */
function kampalaNightEnds(now = new Date()) {
  const local = new Date(new Date(now).getTime() + 3 * 3600 * 1000);
  const hour = local.getUTCHours();
  if (hour >= WELCOME_NIGHT_TO_HOUR && hour < WELCOME_NIGHT_FROM_HOUR) return null;
  const morning = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + (hour >= WELCOME_NIGHT_FROM_HOUR ? 1 : 0), WELCOME_MORNING.hour, WELCOME_MORNING.minute);
  return new Date(morning - 3 * 3600 * 1000);
}

/**
 * When each of the three goes. In order, a little apart, so the film never
 * lands above the message that introduces it. Between 22:00 and 07:00 in
 * Kampala the whole welcome waits for the morning, unless the agent is in the
 * chat with us right now (or it is a preview to a member of staff).
 */
function welcomeSchedule({ now = new Date(), inChat = false, preview = false } = {}) {
  const morning = preview || inChat ? null : kampalaNightEnds(now);
  const start = morning || new Date(now);
  return {
    held_until: morning ? morning.toISOString() : null,
    approved_at: morning,
    film_at: new Date(start.getTime() + WELCOME_FILM_AFTER_MS),
    plan_at: new Date(start.getTime() + WELCOME_PLAN_AFTER_MS)
  };
}

/** "7:30am" for a held welcome, as Kampala reads the clock. */
function kampalaClock(value) {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '';
  const local = new Date(at.getTime() + 3 * 3600 * 1000);
  const hour = local.getUTCHours();
  const minute = String(local.getUTCMinutes()).padStart(2, '0');
  return `${hour % 12 || 12}${minute === '00' ? '' : `:${minute}`}${hour < 12 ? 'am' : 'pm'}`;
}

/**
 * What staff are told when a new agent's welcome cannot go yet because they
 * have never written to the makaug number, which writes first to nobody. On
 * 17 Nov 2026 a new agent was approved at 16:40, and the owner and the
 * employee who signed him up were told his welcome and payment link had gone,
 * while all five of his messages waited for him to write.
 */
function welcomeWaitsLine({ link = '' } = {}) {
  const hello = link || require('./filmLinkService').helloLink();
  return [
    'Nothing has reached them yet: they have never written to the makaug WhatsApp number, and it only writes to people who have written to it first.',
    'Their welcome, how-to video and payment link go the moment they send it a message. Send them this to tap and send:',
    hello
  ].join('\n');
}

/**
 * The welcome waited for the agent to write; they have, and its last message,
 * the payment link, has just gone. The staff who were told it was waiting hear
 * that it went. `row` is the queue row just marked sent; `queue` stands in for
 * the bridge's queue under test. Returns how many were told.
 */
async function tellTeamHeldWelcomeWent(row = {}, { queue = null } = {}) {
  const meta = (row && row.metadata) || {};
  if (meta.message_kind !== 'agent_fee_link_on_approval' || meta.held_for_first_message !== true) return 0;
  const send = queue || require('./whatsappWebBridgeService').queueWhatsappWebBridgeMessage;
  const name = String(meta.agent_name || '').trim() || 'The new agent';
  const agentTail = String(row.user_phone || '').replace(/\D/g, '').slice(-9);
  const team = [...new Set((Array.isArray(meta.tell_when_sent) ? meta.tell_when_sent : [])
    .map((phone) => String(phone || '').replace(/\D/g, ''))
    .filter((phone) => phone.length >= 9 && phone.slice(-9) !== agentTail))];
  let told = 0;
  for (const recipient of team) {
    await send({
      recipient,
      text: `✅ *${name} has their welcome and payment link now.* They wrote to the makaug number, so what was waiting for them is going out.`,
      source: String(process.env.AGENT_REPORT_WHATSAPP_SOURCE || 'whatsapp_runtime').trim().toLowerCase() || 'whatsapp_runtime',
      metadata: { message_kind: 'agent_welcome_went_notice', agent_id: meta.agent_id || null, reply_dedupe_key: `agent_welcome_went:${meta.agent_id || row.id}:${recipient}` }
    });
    told += 1;
  }
  return told;
}

/** One line for the member of staff who approved them: sent, waiting for them to write, or waiting for the morning. */
function welcomeSentLine(welcome = null) {
  if (!welcome) return '';
  if (welcome.error) return `Welcome NOT sent: ${welcome.error}`;
  if (welcome.skipped === 'already_sent') return 'They were welcomed before, so nothing was sent again.';
  if (welcome.skipped) return 'No welcome was sent with this approval.';
  if (welcome.waiting_for_first_message) return welcomeWaitsLine({ link: welcome.hello_link });
  if (welcome.held_until) return `It is night in Kampala, so their welcome goes at ${kampalaClock(welcome.held_until)}.`;
  return 'Their welcome and the how-to-post video have gone to them on WhatsApp.';
}

module.exports = {
  VERTICALS,
  WELCOME_IN_CHAT_MINUTES,
  buildApprovedMessage,
  buildHowToFilm,
  buildPlanMessage,
  kampalaNightEnds,
  kampalaClock,
  welcomeSchedule,
  welcomeSentLine,
  welcomeWaitsLine,
  tellTeamHeldWelcomeWent,
  networkAudience,
  networkExtraCountries,
  targetMonthName,
  agentProfileUrl,
  buildShareCardCaption,
  countAgentListings,
  shareCardUrl,
  buildWelcomeCaption,
  buildWelcomeMessage,
  trialTerms,
  buildWelcomePack,
  computePlatformStats
};
