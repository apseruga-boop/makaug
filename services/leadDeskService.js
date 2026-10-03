'use strict';

const { agentGreetingName } = require('./agentNameService');

/**
 * Lead desk — every person makaug could not serve straight away, in one place.
 *
 * Sources (copied in, never duplicated — source_ref is the source row):
 *   whatsapp         property_leads (WhatsApp search with no match)
 *   website_form     property_requests ("Tell us what you need" / "Looking for…")
 *   property_finder  property_need_requests (seeker / student dashboards)
 *   ask_ai           leads with source ask_ai_zero_result (Ask AI found nothing)
 *
 * Each request is due to an agent within 24 hours. Staff send it to a
 * registered agent (one WhatsApp, edited and previewed first), record what the
 * agent said, and when a matching property is approved later the desk flags
 * it so the person can be sent the link. A daily report goes out at 07:00
 * Kampala time with what is new, what is overdue and what is waiting.
 */

const logger = require('../config/logger');
const { runBackgroundWork } = require('../config/database');
const { deliverWhatsapp } = require('./leadHandoffService');
const { sendSupportEmail } = require('./emailService');
const { logNotification } = require('./notificationLogService');
const {
  buildAgentReferralMessage,
  cleanSaid,
  listReferralAgents,
  loadReferralAgent,
  notifyClientsOfReferral,
  buildClientReferralMessage,
  withAreaCoverage,
  wantPhrase
} = require('./leadReferralService');

const SOURCES = Object.freeze({
  whatsapp: 'WhatsApp',
  website_form: 'Website form',
  property_finder: 'Property finder',
  student: 'Student finder',
  ask_ai: 'Ask AI'
});

const RESPONSES = Object.freeze({
  awaiting: 'Waiting for agent',
  has_property: 'Agent has a property',
  contacted_client: 'Agent contacted the client',
  no_match: 'Agent has nothing',
  no_response: 'Agent did not respond',
  deal_done: 'Deal done'
});

const ARCHIVE_REASONS = Object.freeze(['old', 'duplicate', 'spam', 'fulfilled', 'not_serious', 'not_a_request', 'other']);

function text(value, fallback = '') {
  const cleaned = String(value ?? '').trim();
  return cleaned || fallback;
}

function siteUrl() {
  return text(process.env.PUBLIC_SITE_URL || process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL, 'https://makaug.com').replace(/\/+$/, '');
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1e9) return `UGX ${(n / 1e9).toFixed(n % 1e9 ? 1 : 0)}bn`;
  if (n >= 1e6) return `UGX ${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}m`;
  return `UGX ${Math.round(n).toLocaleString('en-UG')}`;
}

// The SQL every source shares: a sensible "want", an area that is a place (the
// WhatsApp parser sometimes stores a whole sentence there), what they said
// without the bot's own bookkeeping, and the last nine digits of the phone.
const WANT_SQL = (col) => `(CASE
  WHEN LOWER(COALESCE(${col}, '')) IN ('rent', 'rental', 'to_rent', 'for_rent') THEN 'rent'
  WHEN LOWER(COALESCE(${col}, '')) IN ('sale', 'buy', 'for_sale', 'house', 'home') THEN 'sale'
  WHEN LOWER(COALESCE(${col}, '')) IN ('land', 'plot', 'plots') THEN 'land'
  WHEN LOWER(COALESCE(${col}, '')) IN ('commercial', 'office', 'shop', 'warehouse') THEN 'commercial'
  WHEN LOWER(COALESCE(${col}, '')) IN ('student', 'students', 'hostel') THEN 'student'
  WHEN LOWER(COALESCE(${col}, '')) IN ('short_term', 'short-term', 'shortstay', 'short_stay') THEN 'short_term'
  ELSE 'any' END)`;
const AREA_IS_SENTENCE_SQL = (col) => `(LENGTH(TRIM(COALESCE(${col}, ''))) > 40
  OR COALESCE(ARRAY_LENGTH(REGEXP_SPLIT_TO_ARRAY(TRIM(COALESCE(${col}, '')), '\\s+'), 1), 0) > 5
  OR COALESCE(${col}, '') ~* '(makaug|looking for|i''m|i am|please|help me|\\?)')`;
const AREA_SQL = (col) => `(CASE
  WHEN NULLIF(TRIM(COALESCE(${col}, '')), '') IS NULL THEN NULL
  WHEN LOWER(TRIM(${col})) IN ('any', 'anywhere', 'any area', 'uganda') THEN NULL
  WHEN ${AREA_IS_SENTENCE_SQL(col)} THEN NULL
  ELSE INITCAP(TRIM(${col})) END)`;
const SAID_SQL = (col) => `NULLIF(TRIM(REGEXP_REPLACE(COALESCE(${col}, ''),
  '^(No approved listings found for (natural )?query( in [a-z_]+)?:\\s*|Auto-captured[^.]*\\.?\\s*|WhatsApp property request had no exact match\\.?\\s*)', '', 'i')), '')`;
const PHONE_KEY_SQL = (col) => `NULLIF(RIGHT(REGEXP_REPLACE(COALESCE(${col}, ''), '\\D', '', 'g'), 9), '')`;

/**
 * Copy new requests from every source into demand_leads. Safe to run as often
 * as you like.
 */
// Numbers that are makaug itself or its own team testing the bot — never leads.
let extraInternalPhones = [];
function internalPhoneKeys() {
  return String([
    process.env.LEAD_DESK_EXCLUDE_PHONES,
    process.env.AI_CEO_OWNER_PHONES,
    process.env.AI_CEO_PHONE_TEST_OWNER,
    process.env.AI_CEO_REPORT_WHATSAPP_RECIPIENTS,
    process.env.MAKAUG_WHATSAPP_NUMBER,
    process.env.MAKAUG_WHATSAPP_NUMBERS,
    process.env.WHATSAPP_BUSINESS_NUMBER,
    process.env.AGENT_HELP_CONTACT_PHONE || '256709402189',
    ...extraInternalPhones,
    '256780863394'
  ].filter(Boolean).join(','))
    .split(/[,;\s]+/)
    .map((v) => v.replace(/\D/g, '').slice(-9))
    .filter((v) => v.length === 9);
}

// A real person's number: digits only (spaces, + and dashes allowed), 9–15
// digits, and none of the self-test markers the bot's simulator writes.
const REAL_PHONE_SQL = (col) => `(COALESCE(${col}, '') !~* '(dryrun|sim-|selftest|self-test|test)'
  AND COALESCE(${col}, '') !~ '[A-Za-z:]'
  AND LENGTH(REGEXP_REPLACE(COALESCE(${col}, ''), '\\D', '', 'g')) BETWEEN 9 AND 15)`;
const NOT_INTERNAL_SQL = (col) => `(COALESCE(${PHONE_KEY_SQL(col)}, '') <> ALL($2::text[]))`;

// How fast a request must reach an agent. Default 2 hours.
function slaHours() {
  const h = Number(process.env.LEAD_DESK_SLA_HOURS || 2);
  return Number.isFinite(h) && h > 0 ? Math.min(h, 72) : 2;
}

// --- Is this a real property request? ---------------------------------------
// The WhatsApp bot logs a "search with no match" whenever it could not find a
// listing for what someone typed — including "thanks", "please do", "reply in
// Luganda" or an agency pasting its own advert. Those are not people wanting
// property, so they are taken off the desk (reason not_a_request, restorable).
const PROPERTY_WORDS = /\b(house|houses|home|homes|rent|rental|renting|let|lease|buy|buying|sale|sell|selling|land|plot|plots|acre|acres|decimal|apartment|apartments|flat|flats|room|rooms|bedroom|bedrooms|bed|hostel|office|shop|warehouse|commercial|property|properties|bungalow|mansion|villa|condo|estate|nyumba|shamba|chumba|kiwanja|ardhi|kupangisha|kukodisha|kununua|ennyumba|enju|ttaka|okupangisa|okugula|okuguula|ekisenge|amayumba)\b/i;
const LANGUAGE_REQUEST = /\b(language|languages|luganda|lunganda|rukiga|runyankole|runyankore|swahili|kiswahili|acholi|lusoga|amharic|arabic|respond in|reply in|response in|chat in|speak)\b/i;
const ADVERT_TEXT = /\b(welcome to|we specialize|we specialise|our services|contact us (on|at)|call us|follow us|#\w+)/i;
const BOT_BOOKKEEPING = /^(No approved listings found[^:.]*[:.]?\s*|Auto-captured[^.]*\.?\s*|WhatsApp property request had no exact match\.?\s*)/i;

let locationRegistry = null;
function resolvePlace(textValue) {
  const value = text(textValue);
  if (!value) return null;
  try {
    locationRegistry = locationRegistry || require('../utils/ugandaLocationRegistry');
    const direct = locationRegistry.resolveCanonicalUgandaLocation(value);
    if (direct?.status === 'matched' && direct.match) return direct.match;
    const fromText = typeof locationRegistry.resolveCanonicalUgandaLocationFromText === 'function'
      ? locationRegistry.resolveCanonicalUgandaLocationFromText(value) : null;
    if (fromText?.status === 'matched' && fromText.match) return fromText.match;
    if (fromText && fromText.name && !fromText.status) return fromText;
  } catch (_ignored) { /* registry unavailable */ }
  return null;
}

function judgeDemandLead(lead = {}) {
  const raw = lead.metadata || {};
  const said = text(lead.message).replace(BOT_BOOKKEEPING, '').trim();
  const areaText = text(lead.area);
  const all = `${areaText} ${said}`.trim();
  const place = resolvePlace(areaText) || resolvePlace(said);
  const hasPropertyWord = PROPERTY_WORDS.test(all);
  const hasWant = text(lead.want) && lead.want !== 'any';
  if (ADVERT_TEXT.test(said) && said.length > 60) return { keep: false, why: 'an advert, not a request' };
  if (LANGUAGE_REQUEST.test(all) && !hasPropertyWord) return { keep: false, why: 'asked about language, not property' };
  if (!hasPropertyWord && !hasWant && !place) return { keep: false, why: 'no property or place mentioned' };
  if (!hasPropertyWord && !hasWant && place && said && !resolvePlace(areaText) && said.split(/\s+/).length > 4) {
    return { keep: false, why: 'conversation, not a request' };
  }
  const junkArea = !areaText || /\d{1,2}:\d{2}|^\d+$|\b(am|pm)\b/i.test(areaText) || LANGUAGE_REQUEST.test(areaText);
  return { keep: true, area: place ? text(place.name) : (junkArea ? null : areaText), clearArea: junkArea && !place, message: said || null };
}

async function screenWhatsappDemand(db) {
  const rows = await db.query(
    `SELECT id, source, want, area, message, metadata
       FROM demand_leads
      WHERE source = 'whatsapp' AND archived_at IS NULL AND first_sent_at IS NULL
        AND COALESCE(metadata->>'screened', '') = ''
      ORDER BY asked_at DESC LIMIT 500`
  ).catch(() => ({ rows: [] }));
  let removed = 0;
  for (const lead of rows.rows) {
    const verdict = judgeDemandLead(lead);
    if (!verdict.keep) {
      await db.query(
        `UPDATE demand_leads SET archived_at = NOW(), archived_reason = 'not_a_request', archived_by = 'screening',
                metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('screened', 'not_a_request', 'screen_reason', $2::text, 'status_before_removal', status),
                status = 'archived'
          WHERE id = $1`, [lead.id, verdict.why]);
      removed += 1;
    } else {
      await db.query(
        `UPDATE demand_leads SET area = CASE WHEN $4::boolean THEN NULL ELSE COALESCE($2, area) END, message = COALESCE($3, message),
                metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('screened', 'ok')
          WHERE id = $1`, [lead.id, verdict.area, verdict.message, Boolean(verdict.clearArea)]);
    }
  }
  return removed;
}

async function loadExtraInternalPhones(db) {
  try {
    const rows = await db.query(`SELECT value FROM billing_settings WHERE key = 'confirmers'`);
    const list = Array.isArray(rows.rows[0]?.value) ? rows.rows[0].value : [];
    extraInternalPhones = list.map((c) => String(c?.phone || '')).filter(Boolean);
  } catch (_ignored) { /* table may not exist yet */ }
}

let fullSyncDone = false;

async function syncDemandLeads(db, { days = 365, full = false } = {}) {
  // The first sync in a process looks back a year; after that only the last
  // three days, so the 15-minute tick stays cheap on a small database.
  const effectiveDays = full || !fullSyncDone ? days : Math.min(Number(days) || 3, 3);
  const window = String(Math.max(1, Math.min(730, Number(effectiveDays) || 365)));
  const counts = {};
  await loadExtraInternalPhones(db);
  const internal = internalPhoneKeys();
  const run = async (label, sql) => {
    try {
      const result = await db.query(sql, [window, internal]);
      counts[label] = result.rowCount;
    } catch (error) {
      if (!['42P01', '42703'].includes(error.code)) logger.warn('Lead desk sync failed', { source: label, error: error.message });
      counts[label] = 0;
    }
  };

  await run('whatsapp', `
    INSERT INTO demand_leads (source, source_ref, name, phone, phone_key, email, want, area, budget, message, asked_at, due_at, metadata)
    SELECT 'whatsapp', 'property_leads:' || pl.id,
           NULLIF(pl.name, ''), pl.phone, ${PHONE_KEY_SQL('pl.phone')}, NULLIF(pl.email, ''),
           ${WANT_SQL('pl.category')}, ${AREA_SQL('pl.preferred_area')}, NULLIF(pl.budget, 0)::bigint,
           COALESCE(${SAID_SQL('pl.notes')}, CASE WHEN ${AREA_IS_SENTENCE_SQL('pl.preferred_area')} THEN TRIM(pl.preferred_area) END),
           pl.created_at, pl.created_at + INTERVAL '24 hours',
           jsonb_build_object('raw_area', pl.preferred_area, 'raw_category', pl.category)
      FROM property_leads pl
     WHERE pl.purpose = 'search'
       AND pl.created_at >= NOW() - ($1 || ' days')::interval
       AND ${REAL_PHONE_SQL('pl.phone')}
       AND ${NOT_INTERNAL_SQL('pl.phone')}
    ON CONFLICT (source_ref) DO NOTHING`);

  await run('website_form', `
    INSERT INTO demand_leads (source, source_ref, name, phone, phone_key, email, want, area, budget, message, asked_at, due_at)
    SELECT 'website_form', 'property_requests:' || pr.id,
           NULLIF(pr.full_name, ''), pr.phone, ${PHONE_KEY_SQL('pr.phone')}, NULLIF(pr.email, ''),
           ${WANT_SQL('pr.listing_type')}, ${AREA_SQL('pr.preferred_locations')}, NULLIF(pr.max_budget, 0),
           NULLIF(TRIM(pr.requirements), ''), pr.created_at, pr.created_at + INTERVAL '24 hours'
      FROM property_requests pr
     WHERE pr.created_at >= NOW() - ($1 || ' days')::interval
       AND (${REAL_PHONE_SQL('pr.phone')} OR (NULLIF(pr.phone, '') IS NULL AND NULLIF(pr.email, '') IS NOT NULL))
       AND ${NOT_INTERNAL_SQL('pr.phone')}
       AND COALESCE(pr.email, '') !~* '(makaug\\.invalid|@example\\.|test@|qa@)'
    ON CONFLICT (source_ref) DO NOTHING`);

  await run('property_finder', `
    INSERT INTO demand_leads (source, source_ref, name, phone, phone_key, email, want, area, budget, bedrooms, message, asked_at, due_at, metadata)
    SELECT CASE WHEN LOWER(COALESCE(nr.category, '')) = 'student' THEN 'student' ELSE 'property_finder' END,
           'property_need_requests:' || nr.id,
           COALESCE(NULLIF(c.name, ''), NULLIF(TRIM(CONCAT_WS(' ', u.first_name::text, u.last_name::text)), '')),
           COALESCE(NULLIF(c.whatsapp, ''), NULLIF(c.phone, ''), u.phone),
           ${PHONE_KEY_SQL("COALESCE(NULLIF(c.whatsapp, ''), NULLIF(c.phone, ''), u.phone)")},
           COALESCE(NULLIF(c.email, ''), u.email),
           ${WANT_SQL('nr.category')}, ${AREA_SQL("COALESCE(NULLIF(nr.location, ''), nr.campus)")}, NULLIF(nr.budget, 0), nr.bedrooms,
           NULLIF(TRIM(nr.message), ''), nr.created_at, nr.created_at + INTERVAL '24 hours',
           jsonb_build_object('campus', nr.campus, 'property_type', nr.property_type, 'urgency', nr.urgency)
      FROM property_need_requests nr
      LEFT JOIN contacts c ON c.id = nr.contact_id
      LEFT JOIN users u ON u.id = nr.user_id
     WHERE nr.created_at >= NOW() - ($1 || ' days')::interval
       AND COALESCE(NULLIF(c.whatsapp, ''), NULLIF(c.phone, ''), u.phone, NULLIF(c.email, ''), u.email) IS NOT NULL
       AND (${REAL_PHONE_SQL("COALESCE(NULLIF(c.whatsapp, ''), NULLIF(c.phone, ''), u.phone)")}
            OR COALESCE(NULLIF(c.whatsapp, ''), NULLIF(c.phone, ''), u.phone) IS NULL)
       AND ${NOT_INTERNAL_SQL("COALESCE(NULLIF(c.whatsapp, ''), NULLIF(c.phone, ''), u.phone)")}
    ON CONFLICT (source_ref) DO NOTHING`);

  await run('ask_ai', `
    INSERT INTO demand_leads (source, source_ref, name, phone, phone_key, email, want, area, budget, message, asked_at, due_at)
    SELECT 'ask_ai', 'leads:' || l.id,
           NULLIF(c.name, ''), COALESCE(NULLIF(c.whatsapp, ''), c.phone),
           ${PHONE_KEY_SQL("COALESCE(NULLIF(c.whatsapp, ''), c.phone)")}, NULLIF(c.email, ''),
           ${WANT_SQL('l.category')}, ${AREA_SQL('l.location')}, l.budget,
           NULLIF(TRIM(l.message), ''), l.created_at, l.created_at + INTERVAL '24 hours'
      FROM leads l
      LEFT JOIN contacts c ON c.id = l.contact_id
     WHERE l.source = 'ask_ai_zero_result'
       AND COALESCE(l.is_test, FALSE) = FALSE
       AND l.created_at >= NOW() - ($1 || ' days')::interval
       AND COALESCE(NULLIF(c.whatsapp, ''), NULLIF(c.phone, ''), NULLIF(c.email, '')) IS NOT NULL
       AND (${REAL_PHONE_SQL("COALESCE(NULLIF(c.whatsapp, ''), c.phone)")} OR COALESCE(NULLIF(c.whatsapp, ''), c.phone) IS NULL)
       AND ${NOT_INTERNAL_SQL("COALESCE(NULLIF(c.whatsapp, ''), c.phone)")}
    ON CONFLICT (source_ref) DO NOTHING`);

  // Self-test traffic and makaug's own numbers that got in before the filters.
  await run('purged_test_traffic', `
    DELETE FROM demand_leads
     WHERE first_sent_at IS NULL
       AND $1::text IS NOT NULL
       AND (
         (phone IS NOT NULL AND NOT ${REAL_PHONE_SQL('phone')})
         OR COALESCE(phone_key, '') = ANY($2::text[])
       )`);

  // Searches already sent from the old demand panel keep their history.
  await run('legacy_referrals', `
    WITH legacy AS (
      SELECT dl.id AS demand_lead_id, pl.payload->'last_referral' AS r
        FROM demand_leads dl
        JOIN property_leads pl ON dl.source_ref = 'property_leads:' || pl.id
       WHERE pl.payload ? 'last_referral'
         AND NOT EXISTS (SELECT 1 FROM demand_lead_referrals x WHERE x.demand_lead_id = dl.id)
    ), inserted AS (
      INSERT INTO demand_lead_referrals (demand_lead_id, agent_id, agent_name, sent_at, sent_by)
      SELECT demand_lead_id,
             CASE WHEN (r->>'agent_id') ~* '^[0-9a-f-]{36}$' THEN (r->>'agent_id')::uuid END,
             r->>'agent_name',
             CASE WHEN (r->>'at') ~ '^\d{4}-\d{2}-\d{2}' THEN (r->>'at')::timestamptz ELSE NOW() END,
             r->>'by'
        FROM legacy
      RETURNING demand_lead_id, sent_at
    )
    UPDATE demand_leads dl
       SET status = CASE WHEN dl.status = 'new' THEN 'sent_to_agent' ELSE dl.status END,
           first_sent_at = COALESCE(dl.first_sent_at, i.sent_at),
           last_sent_at = GREATEST(COALESCE(dl.last_sent_at, i.sent_at), i.sent_at)
      FROM inserted i
     WHERE dl.id = i.demand_lead_id
       AND $1::text IS NOT NULL AND $2::text[] IS NOT NULL`);

  try {
    counts.screened_out = await screenWhatsappDemand(db);
  } catch (error) {
    logger.warn('Lead desk screening failed', { error: error.message });
  }

  // Every unsent request runs on the current target (LEAD_DESK_SLA_HOURS).
  try {
    await db.query(
      `UPDATE demand_leads SET due_at = asked_at + make_interval(hours => $1::int)
        WHERE first_sent_at IS NULL AND archived_at IS NULL
          AND due_at IS DISTINCT FROM asked_at + make_interval(hours => $1::int)`,
      [Math.round(slaHours())]
    );
  } catch (error) {
    logger.warn('Lead desk due-time update failed', { error: error.message });
  }
  fullSyncDone = true;
  return counts;
}

/**
 * Find approved properties listed after each open request that fit it:
 * same kind, same area (area or district), and within budget (+15%).
 */
let lastMatchRunAt = null;

async function refreshMatches(db, { force = false } = {}) {
  // Nothing new listed since the last run → nothing new can match.
  if (!force && lastMatchRunAt) {
    const newest = await db.query(
      `SELECT MAX(GREATEST(created_at, COALESCE(updated_at, created_at))) AS at FROM properties WHERE LOWER(COALESCE(status, '')) = 'approved'`
    ).catch(() => ({ rows: [{}] }));
    const at = newest.rows[0]?.at ? new Date(newest.rows[0].at) : null;
    if (!at || at <= lastMatchRunAt) return 0;
  }
  lastMatchRunAt = new Date();
  const result = await db.query(`
    WITH open AS (
      SELECT * FROM demand_leads
       WHERE archived_at IS NULL
         AND status NOT IN ('closed', 'client_notified')
         AND asked_at >= NOW() - INTERVAL '90 days'
         AND want <> 'any'
         AND area IS NOT NULL
    ), found AS (
      SELECT o.id,
             ARRAY(
               SELECT p.id FROM properties p
                WHERE LOWER(COALESCE(p.status, '')) = 'approved'
                  AND p.created_at > o.asked_at
                  AND p.created_at <= o.asked_at + INTERVAL '60 days'
                  AND (o.want = 'any'
                       OR LOWER(COALESCE(p.listing_type, '')) = o.want
                       OR (o.want = 'student' AND LOWER(COALESCE(p.listing_type, '')) IN ('student', 'students')))
                  AND (o.area IS NULL OR LOWER(p.area) = LOWER(o.area) OR LOWER(p.district) = LOWER(o.area)
                       OR p.area ILIKE '%' || REPLACE(REPLACE(REPLACE(o.area, '\\', '\\\\'), '%', '\\%'), '_', '\\_') || '%')
                  AND COALESCE(NULLIF(p.price_currency, ''), 'UGX') = 'UGX'
                  AND LOWER(COALESCE(p.price_period, '')) NOT IN ('night', 'nightly', 'per_night', 'day', 'daily', 'week', 'weekly')
                  AND (o.budget IS NULL OR (p.price > 0 AND p.price <= o.budget * 1.15))
                ORDER BY p.created_at DESC
                LIMIT 5
             ) AS ids
        FROM open o
    )
    UPDATE demand_leads dl
       SET matched_listing_ids = f.ids,
           match_checked_at = NOW(),
           status = CASE WHEN CARDINALITY(f.ids) > 0 AND dl.status IN ('new', 'sent_to_agent') THEN 'matched' ELSE dl.status END
      FROM found f
     WHERE dl.id = f.id
       AND (dl.matched_listing_ids IS DISTINCT FROM f.ids OR dl.match_checked_at IS NULL)
     RETURNING dl.id`);
  await db.query(`
    UPDATE demand_leads
       SET matched_listing_ids = '{}',
           status = CASE WHEN status = 'matched' THEN CASE WHEN first_sent_at IS NOT NULL THEN 'sent_to_agent' ELSE 'new' END ELSE status END
     WHERE CARDINALITY(matched_listing_ids) > 0
       AND client_notified_at IS NULL
       AND (want = 'any' OR area IS NULL OR asked_at < NOW() - INTERVAL '90 days')`).catch(() => {});
  return result.rowCount;
}

/**
 * Everything the desk screen needs, grouped by what + where.
 */
async function loadDesk(db, { view = 'open', source = '', want = '', limit = 3000 } = {}) {
  const filters = [];
  const values = [];
  if (view === 'archived') filters.push('dl.archived_at IS NOT NULL');
  else if (view === 'all') filters.push('TRUE');
  else filters.push("dl.archived_at IS NULL AND dl.status NOT IN ('closed')");
  if (source && SOURCES[source]) { values.push(source); filters.push(`dl.source = $${values.length}`); }
  if (want) { values.push(want); filters.push(`dl.want = $${values.length}`); }

  const leads = await db.query(
    `SELECT dl.*,
            COALESCE(r.items, '[]'::json) AS referrals,
            COALESCE(m.items, '[]'::json) AS matches
       FROM demand_leads dl
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
                  'id', x.id, 'agent_id', x.agent_id, 'agent_name', x.agent_name, 'sent_at', x.sent_at,
                  'response', x.response, 'responded_at', x.responded_at, 'response_notes', x.response_notes,
                  'nudged_at', x.nudged_at) ORDER BY x.sent_at DESC) AS items
           FROM demand_lead_referrals x WHERE x.demand_lead_id = dl.id
       ) r ON TRUE
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object(
                  'id', p.id, 'title', p.title, 'price', p.price, 'area', p.area, 'district', p.district,
                  'listing_type', p.listing_type, 'reference', p.inquiry_reference, 'created_at', p.created_at)
                  ORDER BY p.created_at DESC) AS items
           FROM properties p WHERE p.id = ANY(dl.matched_listing_ids)
       ) m ON TRUE
      WHERE ${filters.join(' AND ')}
      ORDER BY dl.asked_at DESC
      LIMIT ${Math.max(1, Math.min(20000, Number(limit) || 3000))}`,
    values
  );

  const now = Date.now();
  const groups = new Map();
  for (const row of leads.rows) {
    const key = `${row.want}|${(row.area || '').toLowerCase()}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key, want: row.want, area: row.area || null, leads: [], sources: new Set(),
        budget_min: null, budget_max: null, first_asked_at: row.asked_at, last_asked_at: row.asked_at,
        due_at: null, unsent: 0, awaiting: 0, matches: 0, last_referral: null
      });
    }
    const g = groups.get(key);
    const sent = Boolean(row.first_sent_at);
    g.leads.push({ ...row, overdue: !sent && new Date(row.due_at).getTime() < now });
    g.sources.add(row.source);
    if (row.budget) {
      g.budget_min = g.budget_min == null ? Number(row.budget) : Math.min(g.budget_min, Number(row.budget));
      g.budget_max = g.budget_max == null ? Number(row.budget) : Math.max(g.budget_max, Number(row.budget));
    }
    if (new Date(row.asked_at) < new Date(g.first_asked_at)) g.first_asked_at = row.asked_at;
    if (new Date(row.asked_at) > new Date(g.last_asked_at)) g.last_asked_at = row.asked_at;
    if (!sent) {
      g.unsent += 1;
      if (!g.due_at || new Date(row.due_at) < new Date(g.due_at)) g.due_at = row.due_at;
    }
    const refs = Array.isArray(row.referrals) ? row.referrals : [];
    g.awaiting += refs.filter((r) => r.response === 'awaiting').length ? 1 : 0;
    if (refs[0] && (!g.last_referral || new Date(refs[0].sent_at) > new Date(g.last_referral.sent_at))) g.last_referral = refs[0];
    if (Array.isArray(row.matches) && row.matches.length && !row.client_notified_at) g.matches += 1;
  }
  const people = (g) => new Set(g.leads.map((l) => l.phone_key || l.email || l.id)).size;
  const list = Array.from(groups.values()).map((g) => ({
    ...g,
    sources: Array.from(g.sources),
    people: people(g),
    asks: g.leads.length,
    overdue: g.leads.some((l) => l.overdue)
  })).sort((a, b) => {
    // Overdue first, then soonest due, then matches waiting, then most recent.
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    if (a.unsent && b.unsent) return new Date(a.due_at) - new Date(b.due_at);
    if (Boolean(a.unsent) !== Boolean(b.unsent)) return a.unsent ? -1 : 1;
    if (Boolean(a.matches) !== Boolean(b.matches)) return a.matches ? -1 : 1;
    return new Date(b.last_asked_at) - new Date(a.last_asked_at);
  });

  const summary = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE archived_at IS NULL AND status <> 'closed')::int AS open,
      COUNT(*) FILTER (WHERE archived_at IS NULL AND asked_at >= NOW() - INTERVAL '24 hours')::int AS new_today,
      COUNT(*) FILTER (WHERE archived_at IS NULL AND status <> 'closed' AND first_sent_at IS NULL AND due_at >= NOW())::int AS due_soon,
      COUNT(*) FILTER (WHERE archived_at IS NULL AND status <> 'closed' AND first_sent_at IS NULL AND due_at < NOW())::int AS overdue,
      COUNT(*) FILTER (WHERE archived_at IS NULL AND EXISTS (
        SELECT 1 FROM demand_lead_referrals x WHERE x.demand_lead_id = demand_leads.id AND x.response = 'awaiting'))::int AS awaiting_agent,
      COUNT(*) FILTER (WHERE archived_at IS NULL AND CARDINALITY(matched_listing_ids) > 0 AND client_notified_at IS NULL)::int AS matches_to_send,
      COUNT(*) FILTER (WHERE archived_at IS NULL AND first_sent_at >= NOW() - INTERVAL '24 hours')::int AS sent_today,
      COUNT(*) FILTER (WHERE archived_at IS NOT NULL)::int AS removed
    FROM demand_leads`);

  return { summary: { ...summary.rows[0], sla_hours: slaHours() }, groups: list, sources: SOURCES, responses: RESPONSES };
}

async function loadLeadsByIds(db, ids = []) {
  const clean = (Array.isArray(ids) ? ids : []).map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200);
  if (!clean.length) return [];
  const result = await db.query('SELECT * FROM demand_leads WHERE id = ANY($1::uuid[])', [clean]);
  return result.rows;
}

function needFromLeads(leads = []) {
  const first = leads[0] || {};
  const seen = new Set();
  const people = [];
  for (const l of [...leads].sort((a, b) => new Date(b.asked_at) - new Date(a.asked_at))) {
    const key = l.phone_key || l.email || l.id;
    if (seen.has(key) || !l.phone) continue;
    seen.add(key);
    people.push({ name: l.name, phone: l.phone, budget: l.budget, said: cleanSaid(l.message), askedAt: l.asked_at });
  }
  return { type: first.want || 'any', area: first.area || '', people };
}

/**
 * Send (or preview) one WhatsApp to an agent for a set of desk leads.
 */
async function referLeads(db, {
  ids, agentId, text: overrideText = '', previewTo = '', dryRun = false, actor = 'admin',
  notifyClients = true, clientText = ''
}) {
  const loadedAgent = await loadReferralAgent(db, agentId);
  if (!loadedAgent) return { error: 'Pick an approved makaug agent with a WhatsApp number', status: 400 };
  const leads = await loadLeadsByIds(db, ids);
  const need = needFromLeads(leads);
  if (!need.people.length) return { error: 'None of these leads has a phone number to pass on', status: 400 };
  const agent = await withAreaCoverage(db, loadedAgent, need.area);
  const generated = buildAgentReferralMessage({ agent, need });
  if (dryRun) {
    const sample = need.people[0] || {};
    const clientSample = buildClientReferralMessage({ agent, need, person: sample });
    return {
      data: {
        text: generated,
        agent,
        people: need.people.length,
        // One template for everyone: {name} is filled in per person.
        client_text: need.people.length > 1 && text(sample.name)
          ? clientSample.replace(`Hi ${text(sample.name).split(/\s+/)[0]},`, 'Hi {name},')
          : clientSample,
        client_count: Math.min(need.people.length, 10)
      }
    };
  }
  const body = text(overrideText).slice(0, 3500) || generated;
  const to = previewTo || agent.whatsapp;
  const delivery = await deliverWhatsapp({ to, body, kind: previewTo ? 'desk_referral_preview' : 'desk_referral', leadId: null, nonce: Date.now() });
  const delivered = ['queued', 'sent', 'simulated'].includes(delivery.status);
  await logNotification(db, {
    recipientPhone: to,
    channel: 'whatsapp',
    type: previewTo ? 'lead_referral_preview' : 'lead_referral_to_agent',
    status: delivery.status,
    failureReason: delivered ? null : delivery.reason || null,
    payloadSummary: { agent_id: agent.id, agent_name: agent.full_name, actor, desk_leads: leads.length }
  });
  let clients = [];
  if (delivered && notifyClients) {
    // The people who asked are told who has their request (a preview sends
    // one sample to the preview number instead).
    clients = await notifyClientsOfReferral(db, { agent, need, overrideText: clientText, previewTo, actor });
  }
  if (delivered && !previewTo) {
    // Only the people the agent was actually sent (the message lists up to 10).
    const included = new Set(need.people.slice(0, 10).map((p) => String(p.phone || '').replace(/\D/g, '').slice(-9)));
    const sentLeads = leads.filter((l) => l.phone && included.has(String(l.phone_key || l.phone).replace(/\D/g, '').slice(-9)));
    await db.query(
      `INSERT INTO demand_lead_referrals (demand_lead_id, agent_id, agent_name, sent_by, message)
       SELECT UNNEST($1::uuid[]), $2, $3, $4, $5`,
      [sentLeads.map((l) => l.id), agent.id, agent.full_name, actor, body]
    );
    await db.query(
      `UPDATE demand_leads
          SET status = CASE WHEN status IN ('new', 'matched') THEN 'sent_to_agent' ELSE status END,
              first_sent_at = COALESCE(first_sent_at, NOW()),
              last_sent_at = NOW()
        WHERE id = ANY($1::uuid[])`,
      [sentLeads.map((l) => l.id)]
    );
    const told = new Set(clients.filter((c) => ['queued', 'sent', 'simulated'].includes(c.status)).map((c) => String(c.phone).replace(/\D/g, '').slice(-9)));
    if (told.size) {
      await db.query(
        `UPDATE demand_leads SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('client_told_agent_at', NOW(), 'client_told_agent', $2::text)
          WHERE id = ANY($1::uuid[])`,
        [sentLeads.filter((l) => told.has(String(l.phone_key || l.phone).replace(/\D/g, '').slice(-9))).map((l) => l.id), agent.full_name]
      );
    }
  }
  return {
    data: {
      delivery, text: body, agent: { id: agent.id, full_name: agent.full_name }, preview: Boolean(previewTo),
      clients_told: clients.filter((c) => ['queued', 'sent', 'simulated'].includes(c.status)).length,
      clients
    },
    delivered
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function recordResponse(db, referralId, { response, notes = '' } = {}) {
  if (!UUID_RE.test(String(referralId || ''))) return { error: 'Referral not found', status: 404 };
  if (!RESPONSES[response]) return { error: `response must be one of: ${Object.keys(RESPONSES).join(', ')}`, status: 400 };
  const updated = await db.query(
    `UPDATE demand_lead_referrals
        SET response = $2, responded_at = CASE WHEN $2 = 'awaiting' THEN NULL ELSE NOW() END,
            response_notes = NULLIF($3, '')
      WHERE id = $1::uuid
      RETURNING *`,
    [referralId, response, text(notes).slice(0, 1000)]
  );
  const ref = updated.rows[0];
  if (!ref) return { error: 'Referral not found', status: 404 };
  const leadStatus = { has_property: 'agent_has_property', contacted_client: 'agent_has_property', deal_done: 'closed' }[response];
  if (leadStatus) {
    await db.query('UPDATE demand_leads SET status = $2 WHERE id = $1 AND archived_at IS NULL', [ref.demand_lead_id, leadStatus]);
  }
  return { data: ref };
}

function buildNudgeMessage({ referral, lead }) {
  const first = agentGreetingName({ id: referral.agent_id, full_name: referral.agent_name }, 'there');
  const when = new Date(referral.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const where = lead.area ? ` in ${lead.area}` : '';
  return [
    `Hi ${first}, a quick follow-up from makaug.com.`,
    '',
    `On ${when} we sent you a lead: someone looking for ${wantPhrase(lead.want)}${where}${lead.phone ? ` (${lead.phone})` : ''}.`,
    '',
    'Were you able to reach them, and do you have something that fits? A one-word reply is fine: YES, NO or DONE.',
    '',
    'Thank you,',
    'makaug.com'
  ].join('\n');
}

async function nudgeReferral(db, referralId, { previewTo = '', dryRun = false, actor = 'admin' } = {}) {
  if (!UUID_RE.test(String(referralId || ''))) return { error: 'Referral not found', status: 404 };
  const found = await db.query(
    `SELECT r.*, a.full_name, COALESCE(NULLIF(a.whatsapp, ''), a.phone) AS whatsapp
       FROM demand_lead_referrals r LEFT JOIN agents a ON a.id = r.agent_id
      WHERE r.id = $1::uuid`,
    [referralId]
  );
  const referral = found.rows[0];
  if (!referral) return { error: 'Referral not found', status: 404 };
  if (!referral.whatsapp) return { error: 'That agent has no WhatsApp number', status: 400 };
  const lead = (await loadLeadsByIds(db, [referral.demand_lead_id]))[0] || {};
  const body = buildNudgeMessage({ referral, lead });
  if (dryRun) return { data: { text: body } };
  const delivery = await deliverWhatsapp({ to: previewTo || referral.whatsapp, body, kind: 'desk_nudge', leadId: null, nonce: Date.now() });
  const delivered = ['queued', 'sent', 'simulated'].includes(delivery.status);
  if (delivered && !previewTo) await db.query('UPDATE demand_lead_referrals SET nudged_at = NOW() WHERE id = $1', [referralId]);
  await logNotification(db, { recipientPhone: previewTo || referral.whatsapp, channel: 'whatsapp', type: 'lead_referral_nudge', status: delivery.status, payloadSummary: { actor, referral_id: referralId } });
  return { data: { delivery, text: body }, delivered };
}

async function archiveLeads(db, { ids = [], reason = 'other', actor = 'admin' } = {}) {
  const why = ARCHIVE_REASONS.includes(reason) ? reason : 'other';
  const clean = (Array.isArray(ids) ? ids : []).map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (!clean.length) return { data: { removed: 0 } };
  const result = await db.query(
    `UPDATE demand_leads SET archived_at = NOW(), archived_reason = $2, archived_by = $3,
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('status_before_removal', status),
            status = 'archived'
      WHERE id = ANY($1::uuid[]) AND archived_at IS NULL`,
    [clean, why, actor]
  );
  return { data: { removed: result.rowCount } };
}

async function archiveOlderThan(db, { days = 30, actor = 'admin' } = {}) {
  const d = Math.max(7, Math.min(365, Number(days) || 30));
  const result = await db.query(
    `UPDATE demand_leads SET archived_at = NOW(), archived_reason = 'old', archived_by = $2,
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('status_before_removal', status),
            status = 'archived'
      WHERE archived_at IS NULL AND asked_at < NOW() - ($1 || ' days')::interval`,
    [String(d), actor]
  );
  return { data: { removed: result.rowCount, older_than_days: d } };
}

async function restoreLeads(db, { ids = [] } = {}) {
  const clean = (Array.isArray(ids) ? ids : []).map(String).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const result = await db.query(
    `UPDATE demand_leads
        SET archived_at = NULL, archived_reason = NULL, archived_by = NULL,
            status = COALESCE(NULLIF(metadata->>'status_before_removal', 'archived'),
                              CASE WHEN first_sent_at IS NOT NULL THEN 'sent_to_agent' ELSE 'new' END)
      WHERE id = ANY($1::uuid[])`,
    [clean]
  );
  return { data: { restored: result.rowCount } };
}

function buildClientMatchMessage({ lead = {}, listing = {} }) {
  const first = text(lead.name).split(/\s+/)[0];
  const where = lead.area ? ` in ${lead.area}` : '';
  const when = lead.asked_at ? new Date(lead.asked_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : '';
  const price = money(listing.price);
  return [
    first ? `Hi ${first}, this is makaug.com.` : 'Hi, this is makaug.com.',
    '',
    `${when ? `On ${when} you` : 'You'} asked us about ${wantPhrase(lead.want)}${where}. A property has come up that may fit:`,
    '',
    `${text(listing.title, 'New listing')}${price ? ` — ${price}` : ''}`,
    `${siteUrl()}/property/${listing.id}`,
    '',
    'Tap the link to see the photos and contact the lister directly.',
    'makaug.com shows you the lister; any viewing or payment is between you and them. Never pay before you have seen the property and its documents.'
  ].join('\n');
}

async function notifyClientOfMatch(db, { leadId, listingId, text: overrideText = '', previewTo = '', dryRun = false, actor = 'admin' }) {
  const lead = (await loadLeadsByIds(db, [leadId]))[0];
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (!lead.phone && !previewTo) return { error: 'This person left no phone number', status: 400 };
  const listingRows = await db.query(
    `SELECT id, title, price, area, district, status FROM properties WHERE id = $1::uuid AND LOWER(COALESCE(status, '')) = 'approved'`,
    [listingId]
  ).catch(() => ({ rows: [] }));
  const listing = listingRows.rows[0];
  if (!listing) return { error: 'That listing is not live', status: 400 };
  if (!previewTo && !dryRun && String(lead.client_notified_listing_id || '') === String(listing.id)) {
    return { error: 'This client has already been sent that property', status: 409 };
  }
  const generated = buildClientMatchMessage({ lead, listing });
  if (dryRun) return { data: { text: generated } };
  const body = text(overrideText).slice(0, 3000) || generated;
  const to = previewTo || lead.phone;
  const delivery = await deliverWhatsapp({ to, body, kind: previewTo ? 'desk_match_preview' : 'desk_match', leadId: null, nonce: Date.now() });
  const delivered = ['queued', 'sent', 'simulated'].includes(delivery.status);
  await logNotification(db, { recipientPhone: to, channel: 'whatsapp', type: previewTo ? 'demand_match_preview' : 'demand_match_to_client', status: delivery.status, relatedListingId: listing.id, payloadSummary: { actor, demand_lead_id: lead.id } });
  if (delivered && !previewTo) {
    await db.query(
      `UPDATE demand_leads SET client_notified_at = NOW(), client_notified_listing_id = $2, status = 'client_notified' WHERE id = $1`,
      [lead.id, listing.id]
    );
  }
  return { data: { delivery, text: body, preview: Boolean(previewTo) }, delivered };
}

// The desk refreshes when opened, but never more than once every two minutes:
// matching scans the listings, and the database is small.
let lastRefreshAt = 0;
let refreshInFlight = null;
async function refreshIfStale(db, { maxAgeMs = 120000, force = false } = {}) {
  // Never two refreshes at once: a second caller waits for the running one.
  if (refreshInFlight) {
    await refreshInFlight.catch(() => {});
    if (!force) return { skipped: true };
  }
  if (!force && Date.now() - lastRefreshAt < maxAgeMs) return { skipped: true };
  lastRefreshAt = Date.now();
  refreshInFlight = runBackgroundWork(async () => {
    const synced = await syncDemandLeads(db, { days: 365, full: force });
    const matched = await refreshMatches(db, { force });
    return { synced, matched };
  });
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

const SOURCE_SHORT = Object.freeze({ whatsapp: 'WA', website_form: 'Web', property_finder: 'Finder', student: 'Student', ask_ai: 'AI' });

async function buildDailyReport(db) {
  await syncDemandLeads(db, { days: 365 });
  await refreshMatches(db);
  const desk = await loadDesk(db, { view: 'open' });
  const s = desk.summary || {};
  const lines = [
    `makaug lead desk — ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Kampala' })}`,
    '',
    `New in the last 24h: ${s.new_today || 0}`,
    `Overdue (not sent to an agent within ${slaHours()}h): ${s.overdue || 0}`,
    `Due soon (not sent yet): ${s.due_soon || 0}`,
    `Sent to agents in the last 24h: ${s.sent_today || 0}`,
    `Waiting for an agent's answer: ${s.awaiting_agent || 0}`,
    `Properties found to send to clients: ${s.matches_to_send || 0}`,
    `Open in total: ${s.open || 0}`
  ];
  // Agents now post by WhatsApp; their properties wait in review until a person approves them.
  const agentQueue = await db.query(
    `SELECT COUNT(*)::int AS waiting,
            COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) / 3600, 0)::int AS oldest_hours
       FROM properties
      WHERE status = 'pending' AND agent_id IS NOT NULL
        AND source = 'whatsapp_employee_intake'
        AND COALESCE(extra_fields->>'whatsapp_employee_subject_role', '') = 'agent'`
  ).then((r) => r.rows[0]).catch(() => null);
  if (agentQueue && agentQueue.waiting) {
    lines.push('', `Agent properties waiting for review: ${agentQueue.waiting} (oldest ${agentQueue.oldest_hours}h) — approve them in Admin › Listings.`);
  }
  // Money: what came in yesterday, what nobody has checked, who is behind.
  const moneyRow = await db.query(
    `SELECT
       (SELECT COALESCE(SUM(amount_ugx), 0) FROM revenue_entries WHERE direction = 'in' AND voided_at IS NULL AND paid_at >= NOW() - INTERVAL '24 hours')::bigint AS in_24h,
       (SELECT COUNT(*) FROM revenue_entries WHERE voided_at IS NULL AND verified_status <> 'verified')::int AS unchecked,
       (SELECT COUNT(*) FROM money_sms_inbox WHERE matched_entry_id IS NULL AND direction = 'in')::int AS unrecorded_sms,
       (SELECT COUNT(*) FROM agents WHERE status = 'approved' AND removed_at IS NULL AND NOT fee_exempt
          AND (paid_until IS NULL OR paid_until < (NOW() AT TIME ZONE 'Africa/Kampala')::date))::int AS overdue`
  ).then((r) => r.rows[0]).catch(() => null);
  if (moneyRow) {
    lines.push('', `Money in (last 24h): UGX ${Number(moneyRow.in_24h).toLocaleString('en-US')} · not yet checked: ${moneyRow.unchecked} · MoMo SMS not recorded: ${moneyRow.unrecorded_sms} · agents behind on fees: ${moneyRow.overdue} — Admin › Sales & Revenue.`);
  }
  const urgent = desk.groups.filter((g) => g.unsent).slice(0, 10);
  if (urgent.length) {
    lines.push('', 'To send to an agent today:');
    urgent.forEach((g) => {
      const bits = [
        `${g.people} ${g.people === 1 ? 'person' : 'people'}`,
        wantPhrase(g.want),
        g.area ? `in ${g.area}` : 'area not given',
        g.budget_max ? `up to ${money(g.budget_max)}` : '',
        g.sources.map((src) => SOURCE_SHORT[src] || src).join('/'),
        g.overdue ? 'OVERDUE' : ''
      ].filter(Boolean);
      lines.push(`• ${bits.join(' · ')}`);
    });
  }
  const matches = desk.groups.filter((g) => g.matches).slice(0, 5);
  if (matches.length) {
    lines.push('', 'Property has come up — send to the client:');
    matches.forEach((g) => lines.push(`• ${wantPhrase(g.want)}${g.area ? ` in ${g.area}` : ''} (${g.matches})`));
  }
  lines.push('', `Open the desk: ${siteUrl()}/admin (Leads & Notifications)`);
  return { text: lines.join('\n'), summary: s };
}

function reportRecipients() {
  return String(process.env.LEAD_DESK_REPORT_WHATSAPP || process.env.AI_CEO_REPORT_WHATSAPP_RECIPIENTS || '')
    .split(',').map((v) => v.trim()).filter(Boolean);
}

async function sendDailyReport(db, { to = '', actor = 'scheduler', log = true, text: overrideText = '' } = {}) {
  const report = await buildDailyReport(db);
  if (text(overrideText)) report.text = text(overrideText).slice(0, 4000);
  const recipients = to ? [to] : reportRecipients();
  const results = [];
  for (const recipient of recipients) {
    const delivery = await deliverWhatsapp({ to: recipient, body: report.text, kind: 'desk_daily_report', leadId: null, nonce: Date.now() });
    results.push({ to: recipient, status: delivery.status });
  }
  const email = text(process.env.LEAD_DESK_REPORT_EMAIL || process.env.LEAD_TEAM_EMAIL || process.env.SUPPORT_EMAIL);
  if (!to && email) {
    const sent = await sendSupportEmail({ to: email, subject: 'makaug lead desk — daily report', text: report.text }).catch((error) => ({ sent: false, reason: error.message }));
    results.push({ to: email, status: sent.sent ? 'sent' : (sent.reason || 'not_sent') });
  }
  if (log) await logNotification(db, {
    channel: 'whatsapp',
    type: to ? 'lead_desk_report_manual' : 'lead_desk_daily_report',
    status: results.some((r) => ['queued', 'sent', 'simulated'].includes(r.status)) ? 'sent' : 'failed',
    payloadSummary: { actor, results, summary: report.summary }
  });
  return { text: report.text, results };
}

// --- Optional: send overdue requests to the best-placed agent automatically. --
// Off unless LEAD_DESK_AUTO_SEND=true. Picks the approved agent who covers the
// area (or has live listings there); never guesses when nobody does.
async function autoSendOverdue(db) {
  if (String(process.env.LEAD_DESK_AUTO_SEND || '').toLowerCase() !== 'true') return { skipped: 'disabled' };
  const desk = await loadDesk(db, { view: 'open' });
  const sent = [];
  const recentCutoff = Date.now() - 3 * 86400000;
  for (const g of desk.groups.filter((x) => x.overdue && x.area)) {
    // Never auto-send old requests (e.g. the first-day backfill).
    if (!g.leads.some((l) => !l.first_sent_at && new Date(l.asked_at).getTime() >= recentCutoff)) continue;
    const agents = await listReferralAgents(db, { area: g.area, limit: 5 });
    const best = agents.find((a) => a.match);
    if (!best) continue;
    const ids = g.leads.filter((l) => !l.first_sent_at && new Date(l.asked_at).getTime() >= recentCutoff).map((l) => l.id);
    const result = await referLeads(db, { ids, agentId: best.id, actor: 'auto_send' });
    if (result.delivered) sent.push({ area: g.area, want: g.want, agent: best.full_name, people: ids.length });
  }
  return { sent };
}

// --- Keeping on top of it: instant alerts and overdue reminders. ------------

function alertRecipients() {
  return String(process.env.LEAD_DESK_ALERT_WHATSAPP || process.env.LEAD_DESK_REPORT_WHATSAPP || process.env.AI_CEO_REPORT_WHATSAPP_RECIPIENTS || '')
    .split(',').map((v) => v.trim()).filter(Boolean);
}

function inQuietHours(date = new Date()) {
  const raw = String(process.env.LEAD_DESK_QUIET_HOURS ?? '22-7').trim();
  if (!raw || raw === 'off') return false;
  const [start, end] = raw.split('-').map((v) => Number(v));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const h = kampalaHour(date);
  return start > end ? (h >= start || h < end) : (h >= start && h < end);
}

const SOURCE_LABEL = SOURCES;

function leadLine(l) {
  const who = text(l.name) || text(l.phone) || 'Someone';
  const what = `${wantPhrase(l.want)}${l.area ? ` in ${l.area}` : ''}`;
  const budget = money(l.budget) ? `, up to ${money(l.budget)}` : '';
  const said = cleanSaid(l.message);
  return `• ${who} — ${what}${budget} (${SOURCE_LABEL[l.source] || l.source})${said ? ` — "${said.slice(0, 90)}"` : ''}`;
}

async function sendToTeam(db, body, type) {
  const results = [];
  for (const recipient of alertRecipients()) {
    const delivery = await deliverWhatsapp({ to: recipient, body, kind: type, leadId: null, nonce: Date.now() });
    results.push({ to: recipient, status: delivery.status });
  }
  if (results.length) {
    await logNotification(db, { channel: 'whatsapp', type, status: results.some((r) => ['queued', 'sent', 'simulated'].includes(r.status)) ? 'sent' : 'failed', payloadSummary: { results } });
  }
  return results;
}

/** A WhatsApp to the team the moment new requests land (one message per batch). */
async function sendNewLeadAlerts(db, { force = false } = {}) {
  if (!alertRecipients().length) return { skipped: 'no_recipients' };
  if (!force && inQuietHours()) return { skipped: 'quiet_hours' };
  const fresh = await db.query(
    `SELECT * FROM demand_leads
      WHERE archived_at IS NULL AND first_sent_at IS NULL
        AND asked_at >= NOW() - INTERVAL '2 days'
        AND NOT (metadata ? 'alerted_at')
      ORDER BY asked_at ASC
      LIMIT 25`
  );
  if (!fresh.rows.length) return { sent: 0 };
  const lines = [
    `New on the makaug lead desk (${fresh.rows.length}):`,
    '',
    ...fresh.rows.map(leadLine),
    '',
    `Send to an agent within ${slaHours()} hours: ${siteUrl()}/admin (Leads & Notifications)`
  ];
  const results = await sendToTeam(db, lines.join('\n'), 'lead_desk_new_alert');
  if (results.some((r) => ['queued', 'sent', 'simulated'].includes(r.status))) {
    await db.query(
      `UPDATE demand_leads SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('alerted_at', NOW()) WHERE id = ANY($1::uuid[])`,
      [fresh.rows.map((r) => r.id)]
    );
  }
  return { sent: fresh.rows.length, results };
}

/** One reminder per request that passes the target without going to an agent. */
async function sendOverdueReminders(db, { force = false } = {}) {
  if (!alertRecipients().length) return { skipped: 'no_recipients' };
  if (!force && inQuietHours()) return { skipped: 'quiet_hours' };
  const late = await db.query(
    `SELECT * FROM demand_leads
      WHERE archived_at IS NULL AND first_sent_at IS NULL
        AND due_at < NOW()
        AND asked_at >= NOW() - INTERVAL '2 days'
        AND NOT (metadata ? 'reminded_at')
      ORDER BY asked_at ASC
      LIMIT 25`
  );
  if (!late.rows.length) return { sent: 0 };
  const lines = [
    `Reminder: ${late.rows.length} lead-desk request${late.rows.length === 1 ? ' has' : 's have'} passed the ${slaHours()}-hour mark without going to an agent:`,
    '',
    ...late.rows.map((l) => {
      const hours = Math.max(1, Math.round((Date.now() - new Date(l.asked_at).getTime()) / 3600000));
      return `${leadLine(l)} — waiting ${hours}h`;
    }),
    '',
    `Open the desk: ${siteUrl()}/admin (Leads & Notifications)`
  ];
  const results = await sendToTeam(db, lines.join('\n'), 'lead_desk_overdue_reminder');
  if (results.some((r) => ['queued', 'sent', 'simulated'].includes(r.status))) {
    await db.query(
      `UPDATE demand_leads SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('reminded_at', NOW()) WHERE id = ANY($1::uuid[])`,
      [late.rows.map((r) => r.id)]
    );
  }
  return { sent: late.rows.length, results };
}

function kampalaHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Africa/Kampala' }).format(date));
}

function kampalaDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Kampala' }).format(date);
}

let schedulerTimer = null;
let reportClaimedFor = null;

async function tickLeadDesk(db) {
  return runBackgroundWork(async () => {
    lastRefreshAt = Date.now();
    await syncDemandLeads(db, { days: 365 });
    await refreshMatches(db);
    await sendNewLeadAlerts(db).catch((error) => logger.warn('Lead desk new-lead alert failed', { error: error.message }));
    await sendOverdueReminders(db).catch((error) => logger.warn('Lead desk reminder failed', { error: error.message }));
    const reportHour = Math.max(0, Math.min(23, Number(process.env.LEAD_DESK_REPORT_HOUR || 7)));
    if (kampalaHour() === reportHour) {
      // Claim today's report before sending, so a slow send, a failed log or
      // a second tick in the same hour cannot send it twice.
      const today = kampalaDay();
      const claim = reportClaimedFor === today ? { rows: [] } : await db.query(
        `INSERT INTO notifications (channel, type, status, payload_summary)
         SELECT 'whatsapp', 'lead_desk_daily_report', 'sending', jsonb_build_object('day', $1::text)
          WHERE NOT EXISTS (
            SELECT 1 FROM notifications WHERE type = 'lead_desk_daily_report'
               AND created_at >= NOW() - INTERVAL '20 hours'
          )
         RETURNING id`,
        [today]
      ).catch(() => ({ rows: [] }));
      if (claim.rows.length) {
        reportClaimedFor = today;
        await autoSendOverdue(db).catch((error) => logger.warn('Lead desk auto-send failed', { error: error.message }));
        let status = 'skipped_no_recipients';
        if (reportRecipients().length || process.env.LEAD_DESK_REPORT_EMAIL) {
          const sent = await sendDailyReport(db, { actor: `scheduler:${today}`, log: false });
          status = sent.results.some((r) => ['queued', 'sent', 'simulated'].includes(r.status)) ? 'sent' : 'failed';
          await db.query(`UPDATE notifications SET status = $2, payload_summary = payload_summary || $3::jsonb WHERE id = $1`,
            [claim.rows[0].id, status, JSON.stringify({ results: sent.results })]).catch(() => {});
        } else {
          await db.query(`UPDATE notifications SET status = $2 WHERE id = $1`, [claim.rows[0].id, status]).catch(() => {});
        }
      }
    }
  });
}

function startLeadDeskScheduler(db) {
  if (schedulerTimer || !process.env.DATABASE_URL || process.env.LEAD_DESK_SCHEDULER_ENABLED === 'false') return;
  const pollMs = Math.max(2 * 60_000, Number(process.env.LEAD_DESK_POLL_MS || 5 * 60_000));
  schedulerTimer = setInterval(() => {
    tickLeadDesk(db).catch((error) => logger.error('Lead desk tick failed', { error: error.message }));
  }, pollMs);
  schedulerTimer.unref?.();
  setTimeout(() => {
    tickLeadDesk(db).catch((error) => logger.error('Lead desk boot tick failed', { error: error.message }));
  }, 45_000).unref?.();
  logger.info('Lead desk scheduler armed', { pollMs, slaHours: slaHours(), alertRecipients: alertRecipients().length, reportHourKampala: Number(process.env.LEAD_DESK_REPORT_HOUR || 7) });
}

function csvCell(value) {
  const s = value == null ? '' : (typeof value === 'object' ? JSON.stringify(value) : String(value));
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

async function deskCsv(db, { view = 'all' } = {}) {
  const desk = await loadDesk(db, { view, limit: 20000 });
  const header = ['asked_at', 'source', 'name', 'phone', 'email', 'want', 'area', 'budget', 'message', 'status', 'due_at', 'first_sent_at', 'agents', 'agent_responses', 'matched_listings', 'client_notified_at', 'removed_reason'];
  const lines = [header.map(csvCell).join(',')];
  desk.groups.forEach((g) => g.leads.forEach((l) => {
    const refs = Array.isArray(l.referrals) ? l.referrals : [];
    lines.push([
      l.asked_at, SOURCES[l.source] || l.source, l.name, l.phone, l.email, l.want, l.area, l.budget, l.message, l.status,
      l.due_at, l.first_sent_at, refs.map((r) => r.agent_name).join('; '), refs.map((r) => RESPONSES[r.response] || r.response).join('; '),
      (Array.isArray(l.matches) ? l.matches : []).map((m) => m.reference || m.id).join('; '), l.client_notified_at, l.archived_reason
    ].map(csvCell).join(','));
  }));
  return `﻿${lines.join('\n')}`;
}

module.exports = {
  judgeDemandLead,
  ARCHIVE_REASONS,
  inQuietHours,
  sendNewLeadAlerts,
  sendOverdueReminders,
  sendToTeam,
  alertRecipients,
  slaHours,
  internalPhoneKeys,
  RESPONSES,
  SOURCES,
  archiveLeads,
  archiveOlderThan,
  autoSendOverdue,
  buildClientMatchMessage,
  buildDailyReport,
  buildNudgeMessage,
  deskCsv,
  loadDesk,
  notifyClientOfMatch,
  nudgeReferral,
  recordResponse,
  referLeads,
  refreshIfStale,
  refreshMatches,
  restoreLeads,
  sendDailyReport,
  startLeadDeskScheduler,
  syncDemandLeads,
  tickLeadDesk
};
