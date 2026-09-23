'use strict';

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

  const countryRows = (countries.rows || []).map((row) => ({
    code: row.code,
    name: countryName(row.code),
    visitors: toInt(row.visitors)
  }));

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
    `SELECT id, makaug_agent_number, full_name, company_name, phone, whatsapp, email, status, created_at
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

function buildWelcomeMessage({ agent = {}, stats = {} } = {}) {
  const firstName = String(agent.full_name || '').trim().split(/\s+/)[0] || 'there';
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

  lines.push('');
  lines.push('*What makaug is*');
  lines.push('Uganda’s property market, online — and we are building it into the place every Ugandan looks first, at home and abroad:');
  lines.push(VERTICALS);
  lines.push('The site runs in 9 languages, including Luganda, Swahili and Arabic, because our buyers are not all in Kampala.');

  const scale = [];
  if (stats.live_listings) scale.push(`• ${nfmt(stats.live_listings)} live listings`);
  if (toInt(stats.agents) >= 25) scale.push(`• ${nfmt(stats.agents)} agents and brokers already listing`);
  if (stats.views_30d) scale.push(`• ${nfmt(stats.views_30d)} listing views in the last 30 days`);
  if (stats.visitors_30d) scale.push(`• ${nfmt(stats.visitors_30d)} different people searching in the last 30 days`);
  if (scale.length) {
    lines.push('');
    lines.push('*The audience you just joined*');
    lines.push(...scale);
  }

  const diaspora = Array.isArray(stats.diaspora_countries) ? stats.diaspora_countries : [];
  lines.push('');
  lines.push('*Built for the diaspora*');
  if (diaspora.length) {
    lines.push(`We only began recording where visitors browse from this week, and Ugandans abroad are already searching from ${diaspora.map((c) => c.name).slice(0, 4).join(', ')} — they find your listing before they land.`);
  } else {
    lines.push('Ugandans in the UK, UAE, USA and across East Africa buy and build at home — they search first, then send money or fly in.');
  }
  lines.push('That is why a short video, a clear price and the exact area sell a listing here.');

  lines.push('');
  lines.push('*Why makaug is the best place to be found*');
  lines.push('• Your phone number sits on your listing — buyers call you directly and makaug takes no commission');
  lines.push('• Buyers arrive from Google, our Ask AI search and our WhatsApp assistant');
  lines.push('• Video-first listings: a walk-through can sell to someone who is 6,000 km away');
  lines.push('• Every listing gets its first 7 days free');
  lines.push('• Built for investors too: off plan, buy-to-let and a mortgage finder');
  lines.push('• You get a weekly WhatsApp report: views, visitors, enquiries and the countries watching you');

  lines.push('');
  lines.push('*Your first listing in 3 steps*');
  lines.push('1. Photos, or better, a short walk-through video');
  lines.push('2. A clear price and the exact area');
  lines.push('3. Post it — reply here if you want the team to do it for you');

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
  const firstName = String(agent.full_name || '').trim().split(/\s+/)[0] || 'there';
  const lines = [`*Welcome to makaug.com, ${firstName}!*`];
  if (agent.makaug_agent_number) lines.push(`Your Agent ID: *${agent.makaug_agent_number}*`);
  const bits = [];
  if (stats.live_listings) bits.push(`${nfmt(stats.live_listings)} live listings`);
  if (stats.visitors_30d) bits.push(`${nfmt(stats.visitors_30d)} searchers a month`);
  if (toInt(stats.countries_count) >= 5) bits.push(`visitors from ${nfmt(stats.countries_count)} countries`);
  if (bits.length) lines.push(bits.join(' · '));
  lines.push('');
  lines.push('The full details follow in the next message.');
  return lines.join('\n');
}

module.exports = {
  VERTICALS,
  agentProfileUrl,
  buildShareCardCaption,
  countAgentListings,
  shareCardUrl,
  buildWelcomeCaption,
  buildWelcomeMessage,
  buildWelcomePack,
  computePlatformStats
};
