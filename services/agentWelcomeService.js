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
       GROUP BY 1 ORDER BY 2 DESC LIMIT 8`
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
    top_countries: countryRows.slice(0, 6),
    diaspora_countries: countryRows.filter((c) => c.code !== 'UG').slice(0, 5)
  };
  statsCache = { at: Date.now(), value };
  return value;
}

async function fetchAgent(agentId) {
  const result = await db.query(
    `SELECT id, makaug_agent_number, full_name, greeting_name, company_name, phone, whatsapp, email, status, created_at
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
     WHERE (p.agent_id = $1 OR COALESCE(p.extra_fields, '{}'::jsonb)->>'broker_agent_id' = $1::text)
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
  const countries = toInt(process.env.NETWORK_COUNTRIES || 7) || 7;
  return { monthly, target, countries, target_month: targetMonthName() };
}

/** "the end of October" — computed, so the promise never names a month that has been and gone. */
function targetMonthName(now = new Date()) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return next.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
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
  scale.push(`• ${nfmt(network.monthly)}+ people a month searching across our platforms, from ${nfmt(network.countries)} countries`);
  scale.push(`• On track for ${nfmt(network.target)} a month by the end of ${network.target_month}`);
  if (toInt(stats.agents) >= 25) scale.push(`• ${nfmt(stats.agents)} agents and brokers already listing`);
  if (stats.views_30d) scale.push(`• ${nfmt(stats.views_30d)} listing views on makaug in the last 30 days`);
  lines.push('');
  lines.push('*The audience you just joined*');
  lines.push(...scale);

  // Filtered here as well as in computePlatformStats: whoever assembled these
  // stats, a code we have no name for must not reach an agent dressed as a
  // country. "Ugandans abroad are searching from BR, BD" is not a sentence we
  // send anyone.
  const diaspora = (Array.isArray(stats.diaspora_countries) ? stats.diaspora_countries : [])
    .filter((c) => c && c.name && String(c.name) !== String(c.code));
  lines.push('');
  lines.push('*Built for the diaspora*');
  if (diaspora.length) {
    lines.push(`Ugandans abroad are searching from ${diaspora.map((c) => c.name).slice(0, 4).join(', ')} and beyond — they find your listing before they land.`);
  } else {
    lines.push('Ugandans in the UK, UAE, USA and across East Africa buy and build at home — they search first, then send money or fly in.');
  }
  lines.push('That is why a short video, a clear price and the exact area sell a listing here.');

  lines.push('');
  lines.push('*Why makaug is the best place to be found*');
  lines.push('• Your phone number sits on your listing — buyers call you directly');
  lines.push('• Buyers arrive from Google, our Ask AI search and our WhatsApp assistant');
  lines.push('• Video-first listings: a walk-through can sell to someone who is 6,000 km away');
  lines.push('• Every listing gets its first 7 days free');
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
  bits.push(`${nfmt(network.countries)} countries`);
  lines.push(bits.join(' · '));
  lines.push('');
  lines.push('Enquiries on your properties come straight to this number.');
  lines.push('The full details follow in the next message.');
  return lines.join('\n');
}

module.exports = {
  VERTICALS,
  networkAudience,
  targetMonthName,
  agentProfileUrl,
  buildShareCardCaption,
  countAgentListings,
  shareCardUrl,
  buildWelcomeCaption,
  buildWelcomeMessage,
  buildWelcomePack,
  computePlatformStats
};
