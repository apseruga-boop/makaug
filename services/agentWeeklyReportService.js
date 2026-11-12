'use strict';

const { agentGreetingName } = require('./agentNameService');

const db = require('../config/database');
const { countryName } = require('./visitorCountryService');
const { generateMakaugAgentNumber } = require('./authFlowService');
const { resolveAgentByNumber } = require('./agentPhoneService');
const { countableListingViewSql } = require('./analyticsEventFilter');

const REPORT_TIMEZONE_OFFSET = '+03:00'; // Africa/Kampala, no DST
const REPORT_STATUSES = ['draft', 'approved', 'sent'];
const METRIC_KEYS = ['views', 'visitors', 'enquiries', 'whatsapp_clicks', 'saves'];
const METRIC_LABELS = {
  views: 'Listing views',
  visitors: 'Unique visitors',
  enquiries: 'Message enquiries',
  whatsapp_clicks: 'WhatsApp clicks',
  saves: 'Saves'
};
const DEFAULT_SITE_URL = 'https://makaug.com';
const BROKER_REPORT_PATH = '/broker-dashboard#broker-report-panel';

function siteUrl() {
  const base = String(process.env.PUBLIC_SITE_URL || process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || DEFAULT_SITE_URL).trim();
  return base.replace(/\/+$/, '') || DEFAULT_SITE_URL;
}

function propertyUrl(id) {
  return `${siteUrl()}/property/${encodeURIComponent(String(id || ''))}`;
}

function brokerReportUrl() {
  return `${siteUrl()}${BROKER_REPORT_PATH}`;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateString, days) {
  const d = new Date(`${dateString}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

// Weeks run Monday–Sunday, Kampala time. Without a week_start, the last completed week.
function resolveReportWeek(weekStart, now = new Date()) {
  let start = String(weekStart || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(start) && !Number.isNaN(Date.parse(`${start}T00:00:00Z`))) {
    const d = new Date(`${start}T00:00:00Z`);
    const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
    start = addDays(start, -dow);
  } else {
    const kampalaNow = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const today = isoDate(kampalaNow);
    const dow = (kampalaNow.getUTCDay() + 6) % 7;
    start = addDays(today, -dow - 7);
  }
  const end = addDays(start, 6);
  return {
    weekStart: start,
    weekEnd: end,
    startsAt: `${start}T00:00:00${REPORT_TIMEZONE_OFFSET}`,
    endsBefore: `${addDays(start, 7)}T00:00:00${REPORT_TIMEZONE_OFFSET}`,
    previousStartsAt: `${addDays(start, -7)}T00:00:00${REPORT_TIMEZONE_OFFSET}`
  };
}

function formatWeekRange(weekStart, weekEnd) {
  const opts = { day: 'numeric', month: 'short', timeZone: 'UTC' };
  const a = new Date(`${weekStart}T00:00:00Z`);
  const b = new Date(`${weekEnd}T00:00:00Z`);
  return `${a.toLocaleDateString('en-GB', opts)} – ${b.toLocaleDateString('en-GB', { ...opts, year: 'numeric' })}`;
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

function percentChange(current, previous) {
  const c = toInt(current);
  const p = toInt(previous);
  if (!p) return null;
  return Math.round(((c - p) / p) * 100);
}

const SOURCE_LABELS = {
  direct: 'Typed makaug.com / saved link', google: 'Google search', bing: 'Bing search', facebook: 'Facebook',
  instagram: 'Instagram', whatsapp: 'WhatsApp', tiktok: 'TikTok', x: 'X (Twitter)', twitter: 'X (Twitter)',
  youtube: 'YouTube', linkedin: 'LinkedIn', referral: 'Links on other websites', chatgpt: 'ChatGPT', email: 'Email'
};

function sourceLabel(value) {
  const key = String(value || 'direct').toLowerCase().replace(/^www\./, '').replace(/\.(com|co\.ug|org|net)$/, '');
  if (SOURCE_LABELS[key]) return SOURCE_LABELS[key];
  return key.charAt(0).toUpperCase() + key.slice(1, 28);
}

const SOCIAL_VIEW_CHANNELS = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'whatsapp_status', label: 'WhatsApp status' }
];

// Countries that often show up as cloud or scraper traffic on makaug.
// Real buyer markets (UG, KE, TZ, RW, GB, US, AE, CA, AU, ZA) are left out.
const LIKELY_DATACENTRE_COUNTRY_CODES = new Set(['SG', 'CN', 'NL', 'IE', 'FI', 'SC', 'HK', 'RU']);

function cleanSocialViews(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  SOCIAL_VIEW_CHANNELS.forEach(({ key }) => {
    const n = toInt(src[key]);
    if (n) out[key] = n;
  });
  return out;
}

function socialViewsTotal(views = {}) {
  return SOCIAL_VIEW_CHANNELS.reduce((sum, { key }) => sum + toInt(views[key]), 0);
}

function formatSocialViewsLine(views = {}) {
  const parts = SOCIAL_VIEW_CHANNELS
    .map(({ key, label }) => (toInt(views[key]) ? `${label} ${toInt(views[key]).toLocaleString('en-GB')}` : ''))
    .filter(Boolean);
  return parts.join(' · ');
}

function mergeReportExtras(computed = {}, existing = {}) {
  const extras = { ...(computed || {}) };
  const saved = cleanSocialViews(existing?.social_views);
  if (Object.keys(saved).length) extras.social_views = saved;
  else delete extras.social_views;
  return extras;
}

function attachExtrasInsights(insights, extras = {}) {
  const lines = Array.isArray(insights) ? insights.slice() : [];
  if (extras.rank) lines.push(`You ranked #${extras.rank.position} of ${extras.rank.total} agents on makaug by listing views.`);
  if (extras.busiest_day && extras.peak_hour) lines.push(`Busiest day was ${extras.busiest_day.day}; most views came ${extras.peak_hour.label} (Kampala time).`);
  const topSource = (extras.traffic_sources || [])[0];
  if (topSource) lines.push(`Most visitors found your listings via ${topSource.source === 'direct' ? 'direct visits' : topSource.source}.`);
  return lines;
}

function countryVisitorTotals(topCountries = []) {
  const list = Array.isArray(topCountries) ? topCountries : [];
  const total = list.reduce((sum, c) => sum + toInt(c.visitors), 0);
  const datacentre = list.filter((c) => LIKELY_DATACENTRE_COUNTRY_CODES.has(String(c.code || '').toUpperCase()));
  const datacentreVisitors = datacentre.reduce((sum, c) => sum + toInt(c.visitors), 0);
  const uganda = list.filter((c) => String(c.code || '').toUpperCase() === 'UG').reduce((sum, c) => sum + toInt(c.visitors), 0);
  const abroadReal = list
    .filter((c) => {
      const code = String(c.code || '').toUpperCase();
      return code && code !== 'UG' && !LIKELY_DATACENTRE_COUNTRY_CODES.has(code);
    })
    .reduce((sum, c) => sum + toInt(c.visitors), 0);
  return {
    total,
    uganda,
    abroadReal,
    datacentreVisitors,
    datacentreShare: total ? Math.round((datacentreVisitors / total) * 100) : 0,
    ugandaShare: total ? Math.round((uganda / total) * 100) : 0,
    datacentreNames: datacentre.slice(0, 3).map((c) => c.name).filter(Boolean)
  };
}

function propertyOpenMatchSql(alias, idsParam, startParam, endParam) {
  return `${alias}.event_name = 'property_open'
         AND ${alias}.created_at >= $${startParam} AND ${alias}.created_at < $${endParam}
         AND ${alias}.payload->>'property_id' = ANY($${idsParam}::text[])
         AND ${countableListingViewSql(alias)}`;
}

function prepareBulkReportSends(reports = []) {
  return (Array.isArray(reports) ? reports : []).map((report) => {
    if (!report || !report.id) {
      return { ok: false, error: 'Report not found' };
    }
    const status = String(report.status || '');
    if (status !== 'approved' && status !== 'sent') {
      return { ok: false, id: report.id, agent: report.agent, error: 'Approve the report before sending it to the agent' };
    }
    const to = String(report.agent?.whatsapp || report.agent?.phone || '').replace(/\D+/g, '');
    if (!to || to.length < 9) {
      return { ok: false, id: report.id, agent: report.agent, error: 'No WhatsApp number to send to' };
    }
    return { ok: true, id: report.id, agent: report.agent, to, report };
  });
}

function cleanMetrics(input = {}) {
  const out = {};
  METRIC_KEYS.forEach((key) => { out[key] = toInt(input?.[key]); });
  return out;
}

function cleanTextList(list, max = 8, maxLen = 280) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, max);
}

function cleanListings(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 10).map((item) => ({
    id: String(item?.id || '').slice(0, 64),
    title: String(item?.title || '').trim().slice(0, 160),
    area: String(item?.area || '').trim().slice(0, 120),
    url: /^https:\/\//.test(String(item?.url || '')) ? String(item.url).slice(0, 500) : (item?.id ? propertyUrl(item.id) : ''),
    views: toInt(item?.views),
    visitors: toInt(item?.visitors),
    enquiries: toInt(item?.enquiries),
    image_count: toInt(item?.image_count)
  })).filter((item) => item.title);
}

function cleanCountries(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 10).map((item) => {
    const code = String(item?.code || '').trim().toUpperCase().slice(0, 2);
    return {
      code,
      name: String(item?.name || countryName(code)).trim().slice(0, 80),
      visitors: toInt(item?.visitors)
    };
  }).filter((item) => item.name && item.visitors > 0);
}

async function fetchAgentById(agentId) {
  const result = await db.query(
    `SELECT id, makaug_agent_number, full_name, company_name, phone, whatsapp, email, status
     FROM agents WHERE id = $1 LIMIT 1`,
    [agentId]
  );
  return result.rows[0] || null;
}

async function findAgent({ agentId, agentNumber, query } = {}) {
  if (agentId) return fetchAgentById(agentId);
  const number = String(agentNumber || '').trim();
  if (number) return resolveAgentByNumber(db, number);
  return null;
}

async function searchAgents(query, limit = 20) {
  const q = String(query || '').trim();
  const result = await db.query(
    `SELECT a.id, a.makaug_agent_number, a.full_name, a.company_name, a.phone, a.whatsapp, a.status,
            (SELECT COUNT(*)::int FROM properties p
              WHERE (p.agent_id = a.id OR COALESCE(p.extra_fields, '{}'::jsonb)->>'broker_agent_id' = a.id::text)
                AND p.status = 'approved') AS active_listings
     FROM agents a
     WHERE $1 = ''
        OR a.full_name ILIKE '%' || $1 || '%'
        OR COALESCE(a.company_name, '') ILIKE '%' || $1 || '%'
        OR COALESCE(a.makaug_agent_number, '') ILIKE '%' || $1 || '%'
        OR regexp_replace(COALESCE(a.phone, '') || ' ' || COALESCE(a.whatsapp, ''), '\\D', '', 'g') LIKE '%' || regexp_replace($1, '\\D', '', 'g') || '%' AND regexp_replace($1, '\\D', '', 'g') <> ''
     ORDER BY active_listings DESC, a.full_name ASC
     LIMIT $2`,
    [q, Math.min(Math.max(Number(limit) || 20, 1), 100)]
  );
  return result.rows;
}

const OWNED_PROPERTIES_SQL = `
  SELECT p.id FROM properties p
  WHERE p.agent_id::text = $1::text OR COALESCE(p.extra_fields, '{}'::jsonb)->>'broker_agent_id' = $1::text`;

// The agent's property ids, fetched once and passed to every window query:
// `= ANY($ids)` lets Postgres use the property_open index per id instead of
// scanning a week of events.
async function fetchOwnedPropertyIds(agentId) {
  const result = await db.query(`${OWNED_PROPERTIES_SQL}`, [agentId]);
  return result.rows.map((row) => String(row.id));
}

async function computePeriodMetrics(ids, startsAt, endsBefore) {
  if (!ids.length) return cleanMetrics({});
  const [views, enquiries, saves] = await Promise.all([
    db.query(
      `SELECT COUNT(*)::int AS views, COUNT(DISTINCT e.client_id)::int AS visitors
       FROM analytics_events e
       WHERE ${propertyOpenMatchSql('e', 1, 2, 3)}`,
      [ids, startsAt, endsBefore]
    ),
    // Honest counts: one per person, repeats and test leads excluded.
    //   enquiries       = people who sent a form enquiry, viewing/callback
    //                     request, or asked on makaug WhatsApp
    //   whatsapp_clicks = people who opened WhatsApp to the agent (first
    //                     click only)
    db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM leads l
           WHERE l.created_at >= $2 AND l.created_at < $3
             AND l.listing_id = ANY($1::uuid[])
             AND l.is_test = FALSE
             AND l.lead_type IN ('enquiry', 'viewing', 'callback')
             AND NOT (COALESCE(l.channel, '') = 'whatsapp' AND COALESCE(l.source, '') NOT LIKE 'whatsapp_bot%')) AS enquiries,
         (SELECT COUNT(*)::int FROM property_inquiries pi
           WHERE pi.created_at >= $2 AND pi.created_at < $3
             AND pi.property_id = ANY($1::uuid[])
             AND pi.channel = 'whatsapp'
             AND pi.is_repeat = FALSE) AS whatsapp_clicks`,
      [ids, startsAt, endsBefore]
    ),
    db.query(
      `SELECT COUNT(*)::int AS saves FROM saved_properties sp
       WHERE sp.created_at >= $2 AND sp.created_at < $3
         AND sp.property_id = ANY($1::uuid[])`,
      [ids, startsAt, endsBefore]
    ).catch(() => ({ rows: [{ saves: 0 }] }))
  ]);
  return cleanMetrics({
    views: views.rows[0]?.views,
    visitors: views.rows[0]?.visitors,
    enquiries: enquiries.rows[0]?.enquiries,
    whatsapp_clicks: enquiries.rows[0]?.whatsapp_clicks,
    saves: saves.rows[0]?.saves
  });
}

async function computeTopListings(ids, startsAt, endsBefore, limit = 5) {
  if (!ids.length) return [];
  const result = await db.query(
    `WITH owned AS (
       SELECT p.id, p.title, p.area, p.district, p.status
       FROM properties p
       WHERE p.id = ANY($1::uuid[])
     ),
     v AS (
       SELECT e.payload->>'property_id' AS pid, COUNT(*)::int AS views, COUNT(DISTINCT e.client_id)::int AS visitors
       FROM analytics_events e
       WHERE ${propertyOpenMatchSql('e', 1, 2, 3)}
       GROUP BY 1
     ),
     q AS (
       -- Same basis as the summary: one per person per listing.
       SELECT l.listing_id AS property_id, COUNT(*)::int AS enquiries
       FROM leads l
       WHERE l.created_at >= $2 AND l.created_at < $3 AND l.listing_id = ANY($1::uuid[])
         AND l.is_test = FALSE
         AND l.lead_type IN ('enquiry', 'viewing', 'callback')
       GROUP BY 1
     )
     SELECT o.id, o.title, o.area, o.district, o.status,
            COALESCE(v.views, 0) AS views, COALESCE(v.visitors, 0) AS visitors, COALESCE(q.enquiries, 0) AS enquiries,
            (SELECT COUNT(*)::int FROM property_images img WHERE img.property_id = o.id) AS image_count
     FROM owned o
     LEFT JOIN v ON v.pid = o.id::text
     LEFT JOIN q ON q.property_id = o.id
     WHERE COALESCE(v.views, 0) > 0 OR COALESCE(q.enquiries, 0) > 0
     ORDER BY COALESCE(v.views, 0) DESC, COALESCE(q.enquiries, 0) DESC
     LIMIT $4`,
    [ids, startsAt, endsBefore, limit]
  );
  return cleanListings(result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    area: [row.area, row.district].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(', '),
    url: propertyUrl(row.id),
    views: row.views,
    visitors: row.visitors,
    enquiries: row.enquiries,
    image_count: row.image_count
  })));
}

async function computeTopCountries(ids, startsAt, endsBefore, limit = 6) {
  if (!ids.length) return [];
  const result = await db.query(
    `SELECT e.country_code AS code, COUNT(DISTINCT e.client_id)::int AS visitors
     FROM analytics_events e
     WHERE ${propertyOpenMatchSql('e', 1, 2, 3)}
       AND e.country_code IS NOT NULL
     GROUP BY 1
     ORDER BY 2 DESC
     LIMIT $4`,
    [ids, startsAt, endsBefore, limit]
  );
  return cleanCountries(result.rows.map((row) => ({ code: row.code, name: countryName(row.code), visitors: row.visitors })));
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function hourLabel(hour) {
  const h = Number(hour);
  const fmt = (v) => { const x = ((v % 24) + 24) % 24; const suffix = x < 12 ? 'am' : 'pm'; const n = x % 12 === 0 ? 12 : x % 12; return `${n}${suffix}`; };
  return `${fmt(h)}–${fmt(h + 2)}`;
}

// More context for the report: how people found the agent, when they look,
// how the agent ranks, what was added, and countries so far this week.

async function computeExtras(agentId, ids, startsAt, endsBefore, metrics = {}) {
  // Extras are nice-to-have: a slow or failing query is skipped, never allowed
  // to hold up the report.
  const safe = (promise, fallback) => Promise.race([
    promise.catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), Number(process.env.AGENT_REPORT_EXTRAS_TIMEOUT_MS || 6000)))
  ]);
  const [sources, days, hours, rank, added, soFar] = await Promise.all([
    safe(db.query(
      `SELECT LOWER(COALESCE(NULLIF(e.payload->>'traffic_source', ''), 'direct')) AS source, COUNT(DISTINCT e.client_id)::int AS visitors
       FROM analytics_events e
       WHERE ${propertyOpenMatchSql('e', 1, 2, 3)}
       GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
      [ids, startsAt, endsBefore]
    ), { rows: [] }),
    safe(db.query(
      `SELECT EXTRACT(DOW FROM e.created_at AT TIME ZONE 'Africa/Kampala')::int AS dow, COUNT(*)::int AS views
       FROM analytics_events e
       WHERE ${propertyOpenMatchSql('e', 1, 2, 3)}
       GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
      [ids, startsAt, endsBefore]
    ), { rows: [] }),
    safe(db.query(
      `SELECT (FLOOR(EXTRACT(HOUR FROM e.created_at AT TIME ZONE 'Africa/Kampala') / 2) * 2)::int AS band, COUNT(*)::int AS views
       FROM analytics_events e
       WHERE ${propertyOpenMatchSql('e', 1, 2, 3)}
       GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
      [ids, startsAt, endsBefore]
    ), { rows: [] }),
    safe(db.query(
      `WITH per_property AS (
         SELECT e.payload->>'property_id' AS pid, COUNT(*)::int AS views
         FROM analytics_events e
         WHERE e.event_name = 'property_open' AND e.created_at >= $2 AND e.created_at < $3
           AND ${countableListingViewSql('e')}
         GROUP BY 1
       ),
       per_agent AS (
         SELECT COALESCE(p.agent_id::text, p.extra_fields->>'broker_agent_id') AS agent, SUM(pp.views)::int AS views
         FROM per_property pp
         JOIN properties p ON p.id::text = pp.pid
         WHERE COALESCE(p.agent_id::text, p.extra_fields->>'broker_agent_id') IS NOT NULL
         GROUP BY 1
       )
       SELECT (SELECT COUNT(*)::int FROM per_agent) AS total,
              (SELECT COUNT(*)::int + 1 FROM per_agent WHERE views > COALESCE((SELECT views FROM per_agent WHERE agent = $1::text), 0)) AS position,
              EXISTS (SELECT 1 FROM per_agent WHERE agent = $1::text) AS ranked`,
      [agentId, startsAt, endsBefore]
    ), { rows: [] }),
    safe(db.query(
      `SELECT COUNT(*)::int AS added FROM properties p
       WHERE p.id = ANY($1::uuid[]) AND p.created_at >= $2 AND p.created_at < $3`,
      [ids, startsAt, endsBefore]
    ), { rows: [] }),
    safe(db.query(
      `SELECT e.country_code AS code, COUNT(DISTINCT e.client_id)::int AS visitors
       FROM analytics_events e
       WHERE e.event_name = 'property_open' AND e.created_at >= date_trunc('week', NOW() AT TIME ZONE 'Africa/Kampala') AT TIME ZONE 'Africa/Kampala'
         AND e.country_code IS NOT NULL
         AND e.payload->>'property_id' = ANY($1::text[])
         AND ${countableListingViewSql('e')}
       GROUP BY 1 ORDER BY 2 DESC LIMIT 6`,
      [ids]
    ), { rows: [] })
  ]);
  const extras = {};
  if (sources.rows.length) extras.traffic_sources = sources.rows.map((r) => ({ source: r.source, visitors: toInt(r.visitors) }));
  if (days.rows[0]) extras.busiest_day = { day: DAY_NAMES[days.rows[0].dow] || '', views: toInt(days.rows[0].views) };
  if (hours.rows[0]) extras.peak_hour = { label: hourLabel(hours.rows[0].band), views: toInt(hours.rows[0].views) };
  if (rank.rows[0] && rank.rows[0].ranked && rank.rows[0].total > 1) extras.rank = { position: toInt(rank.rows[0].position), total: toInt(rank.rows[0].total) };
  extras.new_listings = toInt(added.rows[0]?.added);
  if (metrics.active_listings && metrics.views) extras.views_per_listing = Math.round((metrics.views / metrics.active_listings) * 10) / 10;
  if (soFar.rows.length) extras.countries_so_far = cleanCountries(soFar.rows.map((r) => ({ code: r.code, name: countryName(r.code), visitors: r.visitors })));
  return extras;
}

async function countryTrackingSince() {
  const result = await db.query(
    `SELECT MIN(created_at) AS since FROM analytics_events WHERE country_code IS NOT NULL`
  ).catch(() => ({ rows: [] }));
  return result.rows[0]?.since || null;
}

async function countActiveListings(agentId) {
  const result = await db.query(
    `SELECT COUNT(*)::int AS total FROM properties p
     WHERE (p.agent_id::text = $1::text OR COALESCE(p.extra_fields, '{}'::jsonb)->>'broker_agent_id' = $1::text)
       AND p.status = 'approved'`,
    [agentId]
  );
  return toInt(result.rows[0]?.total);
}

function buildInsights({ metrics = {}, previous = {}, topListings = [], topCountries = [], activeListings = 0, extras = {} } = {}) {
  const insights = [];
  const nextSteps = [];
  const m = cleanMetrics(metrics);
  const p = cleanMetrics(previous);
  const totalEnquiries = m.enquiries + m.whatsapp_clicks;
  const prevEnquiries = p.enquiries + p.whatsapp_clicks;
  const social = cleanSocialViews(extras.social_views);
  const socialTotal = socialViewsTotal(social);
  const countries = countryVisitorTotals(topCountries);
  const peakHint = extras.busiest_day && extras.peak_hour
    ? ` Most people looked on ${extras.busiest_day.day}s around ${extras.peak_hour.label} — share your best listings on WhatsApp just before then.`
    : '';

  if (!m.views && !totalEnquiries && !socialTotal) {
    insights.push('No one opened your listings this week.');
    nextSteps.push(activeListings
      ? 'Refresh your photos, titles and prices, then share your listings on WhatsApp and social media.'
      : 'You have no live listings. Add a property from your broker dashboard to start getting views.');
    return { insights, nextSteps };
  }

  const viewChange = percentChange(m.views, p.views);
  if (viewChange !== null) {
    insights.push(viewChange >= 0
      ? `Views up ${viewChange}% on last week (${m.views.toLocaleString('en-GB')} vs ${p.views.toLocaleString('en-GB')}).`
      : `Views down ${Math.abs(viewChange)}% on last week (${m.views.toLocaleString('en-GB')} vs ${p.views.toLocaleString('en-GB')}).`);
  } else if (m.views) {
    insights.push(`${m.views.toLocaleString('en-GB')} views from ${m.visitors.toLocaleString('en-GB')} people this week.`);
  }

  const visitorChange = percentChange(m.visitors, p.visitors);
  if (visitorChange !== null && Math.abs(visitorChange) >= 15) {
    insights.push(`${m.visitors.toLocaleString('en-GB')} different people looked at your listings — ${visitorChange >= 0 ? 'up' : 'down'} ${Math.abs(visitorChange)}% on last week.`);
  }

  if (socialTotal) {
    insights.push(`Social posts you tracked had ${socialTotal.toLocaleString('en-GB')} views (${formatSocialViewsLine(social)}).`);
  }

  const enquiryChange = percentChange(totalEnquiries, prevEnquiries);
  if (totalEnquiries) {
    const rate = m.visitors ? Math.round((totalEnquiries / m.visitors) * 1000) / 10 : 0;
    insights.push(`${totalEnquiries} enquir${totalEnquiries === 1 ? 'y' : 'ies'}${enquiryChange !== null ? ` (${enquiryChange >= 0 ? '+' : ''}${enquiryChange}%)` : ''}${rate ? ` — ${rate}% of visitors got in touch` : ''}.`);
  } else if (m.visitors >= 20 || (m.views >= 20 && !totalEnquiries)) {
    insights.push(`${m.visitors || m.views} people viewed your listings on makaug but none got in touch.`);
    nextSteps.push(`Check your prices and add clear photos and a short video — views without enquiries usually mean the listing is missing detail.${peakHint}`);
  }

  if (countries.total) {
    if (countries.datacentreShare >= 40 && totalEnquiries === 0) {
      const names = countries.datacentreNames.join(', ');
      insights.push(`${countries.datacentreShare}% of recorded visitors came from ${names || 'countries that often include automated traffic'}. Treat that share with care and focus on the ${countries.uganda ? `${countries.ugandaShare}% in Uganda` : 'buyers you can reach in Uganda'}.`);
      nextSteps.push('Share your strongest listings in Uganda WhatsApp groups and on your status, and reply to anyone who gets in touch within the hour.');
    } else if (countries.abroadReal || (countries.total - countries.uganda - countries.datacentreVisitors) > 0 || (countries.uganda && countries.ugandaShare < 90)) {
      const abroad = countries.total - countries.uganda;
      const share = Math.round((abroad / countries.total) * 100);
      if (share >= 10 && countries.abroadReal) {
        const names = topCountries.filter((c) => {
          const code = String(c.code || '').toUpperCase();
          return code && code !== 'UG' && !LIKELY_DATACENTRE_COUNTRY_CODES.has(code);
        }).slice(0, 3).map((c) => c.name).join(', ');
        insights.push(`${share}% of your visitors are outside Uganda (${names}).`);
        nextSteps.push('Add a video walk-through so buyers abroad can view without travelling.');
      } else if (share >= 10 && !countries.abroadReal && countries.datacentreShare >= 10) {
        const names = countries.datacentreNames.join(', ');
        insights.push(`A large share of recorded visitors came from ${names || 'outside Uganda'}. Some of that can be automated traffic, so do not treat every view as a buyer.`);
      }
    }
  }

  const top = topListings[0];
  if (top && m.views && top.views) {
    const share = Math.round((top.views / m.views) * 100);
    if (share >= 30 && topListings.length > 1) {
      insights.push(`"${top.title}" brought in ${share}% of your views.`);
      nextSteps.push(`Boost "${top.title}" for 7 days to build on its momentum.`);
    }
  }

  const noPhotos = topListings.filter((l) => !l.image_count);
  if (noPhotos.length) {
    nextSteps.push(`Add photos to ${noPhotos.length === 1 ? `"${noPhotos[0].title}"` : `${noPhotos.length} of your top ${topListings.length} listings`} — ${noPhotos.length === 1 ? 'it has' : 'they have'} none, and listings with photos get far more enquiries.`);
  }
  const fewPhotos = topListings.find((l) => l.views >= 10 && l.image_count > 0 && l.image_count < 5);
  if (fewPhotos) nextSteps.push(`Add more photos to "${fewPhotos.title}" — it has ${fewPhotos.image_count} and is getting views.`);

  const noEnquiry = topListings.find((l) => l.views >= 20 && !l.enquiries);
  if (noEnquiry && noEnquiry !== fewPhotos) nextSteps.push(`"${noEnquiry.title}" got ${noEnquiry.views} views and no enquiries — review the price and description.`);

  if (extras.rank && extras.rank.position === 1 && totalEnquiries === 0 && m.views) {
    nextSteps.push('You had the most listing views on makaug this week, but no enquiries yet — tighten the price, photos and title on your top listing so visitors have a reason to message.');
  }

  if (socialTotal && totalEnquiries === 0) {
    nextSteps.push('Your social posts are being seen. Put the makaug listing link and your WhatsApp number on the post so viewers can enquire in one tap.');
  }

  if (peakHint && totalEnquiries && !nextSteps.some((s) => /just before then/.test(s))) {
    nextSteps.push(`Post or share again just before ${extras.peak_hour.label} on ${extras.busiest_day.day}s — that is when people are already looking.`);
  }

  if (!nextSteps.length) nextSteps.push('Reply to every enquiry within the hour — fast replies win most deals.');
  return { insights: insights.slice(0, 7), nextSteps: nextSteps.slice(0, 6) };
}

// Every agent who gets a report gets a makaug agent ID. Older and imported
// agents were created before IDs existed, so issue one the first time.
async function ensureAgentNumber(agent) {
  if (!agent || agent.makaug_agent_number) return agent;
  const number = await generateMakaugAgentNumber(db);
  const result = await db.query(
    `UPDATE agents SET makaug_agent_number = COALESCE(NULLIF(makaug_agent_number, ''), $2), updated_at = NOW()
     WHERE id = $1 RETURNING makaug_agent_number`,
    [agent.id, number]
  );
  return { ...agent, makaug_agent_number: result.rows[0]?.makaug_agent_number || number };
}

async function computeAgentWeeklyReport({ agentId, weekStart } = {}) {
  const agent = await ensureAgentNumber(await fetchAgentById(agentId));
  if (!agent) {
    const error = new Error('Agent not found');
    error.status = 404;
    throw error;
  }
  const week = resolveReportWeek(weekStart);
  const ownedIds = await fetchOwnedPropertyIds(agent.id);
  const [metrics, previous, topListings, topCountries, activeListings, trackingSince] = await Promise.all([
    computePeriodMetrics(ownedIds, week.startsAt, week.endsBefore),
    computePeriodMetrics(ownedIds, week.previousStartsAt, week.startsAt),
    computeTopListings(ownedIds, week.startsAt, week.endsBefore),
    computeTopCountries(ownedIds, week.startsAt, week.endsBefore),
    countActiveListings(agent.id),
    countryTrackingSince()
  ]);
  const extras = await computeExtras(agent.id, ownedIds, week.startsAt, week.endsBefore, { ...metrics, active_listings: activeListings });
  const built = buildInsights({ metrics, previous, topListings, topCountries, activeListings, extras });
  const insights = attachExtrasInsights(built.insights, extras);
  const nextSteps = built.nextSteps;
  return {
    extras,
    agent,
    week_start: week.weekStart,
    week_end: week.weekEnd,
    metrics: { ...metrics, active_listings: activeListings },
    previous_metrics: previous,
    top_listings: topListings,
    top_countries: topCountries,
    insights,
    next_steps: nextSteps,
    country_tracking_since: trackingSince
  };
}

function formatReportRow(row, agent = null) {
  if (!row) return null;
  const a = agent || {
    id: row.agent_id,
    makaug_agent_number: row.makaug_agent_number,
    full_name: row.full_name,
    company_name: row.company_name,
    phone: row.phone,
    whatsapp: row.whatsapp
  };
  const toDate = (value) => (value instanceof Date ? isoDate(value) : String(value || '').slice(0, 10));
  return {
    id: row.id,
    agent: a,
    week_start: toDate(row.week_start),
    week_end: toDate(row.week_end),
    metrics: row.metrics || {},
    previous_metrics: row.previous_metrics || {},
    top_listings: row.top_listings || [],
    top_countries: row.top_countries || [],
    insights: row.insights || [],
    next_steps: row.next_steps || [],
    country_tracking_since: row.country_tracking_since || null,
    extras: row.extras || {},
    social_views: cleanSocialViews((row.extras || {}).social_views),
    status: row.status,
    edited_by: row.edited_by || null,
    sent_at: row.sent_at || null,
    sent_to: row.sent_to || null,
    last_preview_to: row.last_preview_to || null,
    last_preview_at: row.last_preview_at || null,
    updated_at: row.updated_at || null
  };
}

const REPORT_SELECT = `
  SELECT r.*, a.makaug_agent_number, a.full_name, a.company_name, a.phone, a.whatsapp
  FROM agent_weekly_reports r
  JOIN agents a ON a.id = r.agent_id`;

async function getReportById(id) {
  const result = await db.query(`${REPORT_SELECT} WHERE r.id = $1 LIMIT 1`, [id]);
  return formatReportRow(result.rows[0]);
}

async function getReportForAgentWeek(agentId, weekStart) {
  const result = await db.query(`${REPORT_SELECT} WHERE r.agent_id = $1 AND r.week_start = $2 LIMIT 1`, [agentId, weekStart]);
  return formatReportRow(result.rows[0]);
}

async function listReports({ weekStart, status } = {}) {
  const params = [];
  const where = [];
  if (weekStart) { params.push(resolveReportWeek(weekStart).weekStart); where.push(`r.week_start = $${params.length}`); }
  if (status && REPORT_STATUSES.includes(status)) { params.push(status); where.push(`r.status = $${params.length}`); }
  const result = await db.query(
    `${REPORT_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.week_start DESC, a.full_name ASC LIMIT 200`,
    params
  );
  return result.rows.map((row) => formatReportRow(row));
}

// Creates the draft, or refreshes the numbers on an existing draft. Approved/sent
// reports keep their edited content unless refreshNumbers is explicitly requested.
async function generateReport({ agentId, weekStart, actor = 'admin', refreshNumbers = false } = {}) {
  const computed = await computeAgentWeeklyReport({ agentId, weekStart });
  const existing = await getReportForAgentWeek(computed.agent.id, computed.week_start);
  if (existing && existing.status !== 'draft' && !refreshNumbers) return existing;
  const keepText = existing && existing.edited_by && existing.edited_by !== 'auto';
  const extras = mergeReportExtras(computed.extras, existing?.extras || {});
  let insights = computed.insights;
  let nextSteps = computed.next_steps;
  if (!keepText) {
    const built = buildInsights({
      metrics: computed.metrics,
      previous: computed.previous_metrics,
      topListings: computed.top_listings,
      topCountries: computed.top_countries,
      activeListings: computed.metrics.active_listings,
      extras
    });
    insights = attachExtrasInsights(built.insights, extras);
    nextSteps = built.nextSteps;
  }
  const result = await db.query(
    `INSERT INTO agent_weekly_reports (
       agent_id, week_start, week_end, metrics, previous_metrics, top_listings, top_countries,
       insights, next_steps, country_tracking_since, status, edited_by, extras
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11,$13)
     ON CONFLICT (agent_id, week_start) DO UPDATE SET
       metrics = EXCLUDED.metrics,
       previous_metrics = EXCLUDED.previous_metrics,
       top_listings = EXCLUDED.top_listings,
       top_countries = EXCLUDED.top_countries,
       insights = CASE WHEN $12 THEN agent_weekly_reports.insights ELSE EXCLUDED.insights END,
       next_steps = CASE WHEN $12 THEN agent_weekly_reports.next_steps ELSE EXCLUDED.next_steps END,
       country_tracking_since = EXCLUDED.country_tracking_since,
       extras = EXCLUDED.extras,
       updated_at = NOW()
     RETURNING id`,
    [
      computed.agent.id, computed.week_start, computed.week_end,
      JSON.stringify(computed.metrics), JSON.stringify(computed.previous_metrics),
      JSON.stringify(computed.top_listings), JSON.stringify(computed.top_countries),
      JSON.stringify(insights), JSON.stringify(nextSteps),
      computed.country_tracking_since, keepText ? existing.edited_by : 'auto', Boolean(keepText),
      JSON.stringify(extras || {})
    ]
  );
  return getReportById(result.rows[0].id);
}

async function updateReport(id, changes = {}, actor = 'admin') {
  const current = await getReportById(id);
  if (!current) {
    const error = new Error('Report not found');
    error.status = 404;
    throw error;
  }
  const next = {
    metrics: changes.metrics ? { ...current.metrics, ...cleanMetrics({ ...current.metrics, ...changes.metrics }), active_listings: toInt(changes.metrics.active_listings ?? current.metrics.active_listings) } : current.metrics,
    previous_metrics: changes.previous_metrics ? cleanMetrics({ ...current.previous_metrics, ...changes.previous_metrics }) : current.previous_metrics,
    top_listings: changes.top_listings ? cleanListings(changes.top_listings) : current.top_listings,
    top_countries: changes.top_countries ? cleanCountries(changes.top_countries) : current.top_countries,
    insights: changes.insights ? cleanTextList(changes.insights) : current.insights,
    next_steps: changes.next_steps ? cleanTextList(changes.next_steps) : current.next_steps,
    status: REPORT_STATUSES.includes(changes.status) ? changes.status : current.status,
    extras: changes.social_views
      ? { ...(current.extras || {}), social_views: cleanSocialViews(changes.social_views) }
      : (current.extras || {})
  };
  await db.query(
    `UPDATE agent_weekly_reports SET
       metrics = $2, previous_metrics = $3, top_listings = $4, top_countries = $5,
       insights = $6, next_steps = $7, status = $8, edited_by = $9, extras = $10, updated_at = NOW()
     WHERE id = $1`,
    [
      id, JSON.stringify(next.metrics), JSON.stringify(next.previous_metrics), JSON.stringify(next.top_listings),
      JSON.stringify(next.top_countries), JSON.stringify(next.insights), JSON.stringify(next.next_steps),
      next.status, String(actor || 'admin').slice(0, 120), JSON.stringify(next.extras || {})
    ]
  );
  return getReportById(id);
}

function buildWhatsAppReportMessage(report) {
  const r = report || {};
  const a = r.agent || {};
  const m = r.metrics || {};
  const p = r.previous_metrics || {};
  const x = r.extras || {};
  const change = (key) => {
    const pctChange = percentChange(m[key], p[key]);
    return pctChange === null ? '' : ` (${pctChange > 0 ? '+' : ''}${pctChange}% vs last week)`;
  };
  const n = (v) => toInt(v).toLocaleString('en-GB');
  const firstName = agentGreetingName(a, 'there');
  const company = String(a.company_name || '').trim();
  const showCompany = company && company.toLowerCase() !== String(a.full_name || '').trim().toLowerCase();
  const enquiries = toInt(m.enquiries) + toInt(m.whatsapp_clicks);
  const lines = [];

  lines.push('*makaug.com — Your Weekly Performance Report*');
  lines.push(`Hi ${firstName}, here is everything your listings did this week.`);
  lines.push('');
  lines.push(`Agent: *${a.full_name || 'makaug agent'}*${showCompany ? ` · ${company}` : ''}`);
  if (a.makaug_agent_number) lines.push(`Agent ID: *${a.makaug_agent_number}*`);
  lines.push(`Week: ${formatWeekRange(r.week_start, r.week_end)}`);
  lines.push(`Live listings: ${n(m.active_listings)}${toInt(x.new_listings) ? ` (${n(x.new_listings)} added this week)` : ''}`);
  lines.push('');

  lines.push('*Your numbers*');
  METRIC_KEYS.forEach((key) => { lines.push(`• ${METRIC_LABELS[key]}: *${n(m[key])}*${change(key)}`); });
  if (m.visitors) lines.push(`• Visitors who got in touch: *${Math.round((enquiries / toInt(m.visitors)) * 1000) / 10}%*`);
  if (x.views_per_listing) lines.push(`• Views per listing: *${x.views_per_listing}*`);
  if (x.rank && x.rank.position) lines.push(`• Your rank on makaug: *#${n(x.rank.position)} of ${n(x.rank.total)} agents* by views`);
  const social = cleanSocialViews(x.social_views || r.social_views);
  if (socialViewsTotal(social)) {
    lines.push(`• Social media views (entered by makaug): *${formatSocialViewsLine(social)}*`);
  }

  const countries = Array.isArray(r.top_countries) && r.top_countries.length
    ? r.top_countries
    : (Array.isArray(x.countries_so_far) ? x.countries_so_far : []);
  const countryHeading = (Array.isArray(r.top_countries) && r.top_countries.length)
    ? '*Top countries viewing your listings*'
    : '*Countries viewing your listings (so far this week)*';
  if (countries.length) {
    const totalCountry = countries.reduce((sum, c) => sum + toInt(c.visitors), 0) || 1;
    lines.push('');
    lines.push(countryHeading);
    countries.slice(0, 6).forEach((c, i) => lines.push(`${i + 1}. ${c.name} — ${n(c.visitors)} visitor${toInt(c.visitors) === 1 ? '' : 's'} (${Math.round((toInt(c.visitors) / totalCountry) * 100)}%)`));
  }

  const sources = Array.isArray(x.traffic_sources) ? x.traffic_sources : [];
  if (sources.length) {
    const totalSource = sources.reduce((sum, c) => sum + toInt(c.visitors), 0) || 1;
    lines.push('');
    lines.push('*How people found your listings*');
    sources.slice(0, 5).forEach((src) => {
      const label = sourceLabel(src.source);
      lines.push(`• ${label} — ${Math.round((toInt(src.visitors) / totalSource) * 100)}% (${n(src.visitors)} visitor${toInt(src.visitors) === 1 ? '' : 's'})`);
    });
  }

  if (x.busiest_day || x.peak_hour) {
    lines.push('');
    lines.push('*When buyers are looking*');
    if (x.busiest_day) lines.push(`• Busiest day: ${x.busiest_day.day} (${n(x.busiest_day.views)} views)`);
    if (x.peak_hour) lines.push(`• Peak time: ${x.peak_hour.label} Uganda time`);
  }

  const listings = Array.isArray(r.top_listings) ? r.top_listings : [];
  if (listings.length) {
    lines.push('');
    lines.push('*Your best-performing properties*');
    listings.slice(0, 5).forEach((l, i) => {
      const areaHead = String(l.area || '').split(',')[0].trim().toLowerCase();
      const showArea = l.area && !(areaHead && String(l.title || '').toLowerCase().includes(areaHead));
      lines.push(`${i + 1}. ${l.title}${showArea ? `, ${l.area}` : ''} — ${n(l.views)} views, ${n(l.enquiries)} enquir${toInt(l.enquiries) === 1 ? 'y' : 'ies'}`);
      if (l.url) lines.push(`   ${l.url}`);
    });
  }

  if (Array.isArray(r.insights) && r.insights.length) {
    lines.push('');
    lines.push('*What this means*');
    r.insights.forEach((line) => lines.push(`• ${line}`));
  }
  if (Array.isArray(r.next_steps) && r.next_steps.length) {
    lines.push('');
    lines.push('*Recommended next steps*');
    r.next_steps.forEach((line) => lines.push(`• ${line}`));
  }

  lines.push('');
  lines.push('Everything above is your full report — nothing to log into.');
  lines.push(`To edit listings, boost a property or see past weeks, sign in: ${brokerReportUrl()}`);
  lines.push('Questions? Just reply to this message.');
  return lines.join('\n').slice(0, 4000);
}

// Short caption that rides under the report card image on WhatsApp.
function buildWhatsAppCardCaption(report) {
  const r = report || {};
  const a = r.agent || {};
  const firstName = agentGreetingName(a, 'there');
  const lines = [];
  lines.push(`*Hi ${firstName}, your makaug weekly report is here* (${formatWeekRange(r.week_start, r.week_end)})`);
  if (a.makaug_agent_number) lines.push(`Agent ID: *${a.makaug_agent_number}*`);
  const m = r.metrics || {};
  const x = r.extras || {};
  lines.push(`${toInt(m.views).toLocaleString('en-GB')} views · ${toInt(m.visitors).toLocaleString('en-GB')} visitors · ${(toInt(m.enquiries) + toInt(m.whatsapp_clicks)).toLocaleString('en-GB')} enquiries`);
  const highlights = [];
  if (x.rank && x.rank.position) highlights.push(`Rank #${x.rank.position} of ${x.rank.total}`);
  if (x.busiest_day) highlights.push(`Busiest day ${x.busiest_day.day}`);
  if (x.peak_hour) highlights.push(`Peak ${x.peak_hour.label}`);
  if (highlights.length) lines.push(highlights.join(' · '));
  const social = cleanSocialViews((r.extras || {}).social_views || r.social_views);
  if (socialViewsTotal(social)) lines.push(`Social media views: ${formatSocialViewsLine(social)}`);
  const listings = (Array.isArray(r.top_listings) ? r.top_listings : []).filter((l) => l.url).slice(0, 3);
  if (listings.length) {
    lines.push('');
    lines.push('*Your best-performing properties*');
    listings.forEach((l, i) => lines.push(`${i + 1}. ${l.title}\n${l.url}`));
  }
  const steps = (Array.isArray(r.next_steps) ? r.next_steps : []).slice(0, 3);
  if (steps.length) {
    lines.push('');
    lines.push('*This week, try:*');
    steps.forEach((s) => lines.push(`• ${s}`));
  }
  lines.push('');
  lines.push('*Open your full interactive report* (log in to your makaug broker account):');
  lines.push(brokerReportUrl());
  return lines.join('\n');
}

async function recordReportSent(id, { to, preview }) {
  if (preview) {
    await db.query(
      `UPDATE agent_weekly_reports SET last_preview_to = $2, last_preview_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id, to]
    );
  } else {
    await db.query(
      `UPDATE agent_weekly_reports SET status = 'sent', sent_to = $2, sent_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id, to]
    );
  }
  return getReportById(id);
}

// What an agent sees in their dashboard: the approved/sent report for the week,
// otherwise live numbers computed on the spot.
async function getAgentFacingReport(agent, weekStart) {
  const week = resolveReportWeek(weekStart);
  const saved = await getReportForAgentWeek(agent.id, week.weekStart);
  if (saved && ['approved', 'sent'].includes(saved.status)) return { ...saved, source: 'reviewed' };
  const live = await computeAgentWeeklyReport({ agentId: agent.id, weekStart: week.weekStart });
  return { ...live, status: 'live', source: 'live' };
}

async function listAgentReportWeeks(agentId) {
  const result = await db.query(
    `SELECT week_start, week_end, status FROM agent_weekly_reports
     WHERE agent_id = $1 AND status IN ('approved', 'sent')
     ORDER BY week_start DESC LIMIT 12`,
    [agentId]
  ).catch(() => ({ rows: [] }));
  return result.rows.map((row) => ({
    week_start: row.week_start instanceof Date ? isoDate(row.week_start) : String(row.week_start).slice(0, 10),
    week_end: row.week_end instanceof Date ? isoDate(row.week_end) : String(row.week_end).slice(0, 10),
    status: row.status
  }));
}

module.exports = {
  BROKER_REPORT_PATH,
  METRIC_KEYS,
  METRIC_LABELS,
  REPORT_STATUSES,
  brokerReportUrl,
  SOCIAL_VIEW_CHANNELS,
  LIKELY_DATACENTRE_COUNTRY_CODES,
  attachExtrasInsights,
  buildInsights,
  buildWhatsAppCardCaption,
  buildWhatsAppReportMessage,
  cleanCountries,
  cleanListings,
  cleanSocialViews,
  cleanTextList,
  computeAgentWeeklyReport,
  computePeriodMetrics,
  computeExtras,
  formatSocialViewsLine,
  hourLabel,
  mergeReportExtras,
  prepareBulkReportSends,
  socialViewsTotal,
  ensureAgentNumber,
  findAgent,
  formatWeekRange,
  generateReport,
  getAgentFacingReport,
  getReportById,
  listAgentReportWeeks,
  listReports,
  percentChange,
  propertyUrl,
  recordReportSent,
  resolveReportWeek,
  siteUrl,
  sourceLabel,
  searchAgents,
  updateReport
};
