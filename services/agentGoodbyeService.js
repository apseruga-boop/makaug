'use strict';

/**
 * Removing an agent from King (Agents → the agent → Remove agent), by reason.
 *
 * Arthur, 10 Nov 2026: staff choose why the agent is going, and what happens
 * follows from that. When an agent leaves because they cancelled:
 *   - their properties come off makaug and their profile and login are closed;
 *   - their number is set back to an ordinary WhatsApp contact: no agent menu,
 *     reports, reminders or payment messages, and the chat is marked
 *     "former agent" in the inbox;
 *   - they get a short goodbye on WhatsApp (properties down, sorry to see you
 *     go, come back any time on makaug's WhatsApp) and a personal film, like
 *     the welcome film, of what their properties did: properties that went
 *     live, people and the countries they came from, and the overall views
 *     with social media, which are the site's views times 20 (Arthur: "social
 *     media adds x20 to the views you can see"; AGENT_OVERALL_VIEWS_MULTIPLIER);
 *   - their personal details (ID photos and files, NIN, ID expiry, email,
 *     profile photo, bio) are kept for 30 days in case they come back, then
 *     deleted by runFormerAgentDetailDeletion. Their name and phone number are
 *     never deleted, so we know them when they get back in touch.
 * The other reasons send nothing and delete nothing.
 */

const db = require('../config/database');
const { agentGreetingName } = require('./agentNameService');
const { countryName } = require('./visitorCountryService');

const DETAIL_KEEP_DAYS_DEFAULT = 30;

function detailKeepDays(env = process.env) {
  const n = Number(env.AGENT_DETAILS_KEEP_DAYS);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : DETAIL_KEEP_DAYS_DEFAULT;
}

const REMOVAL_REASONS = Object.freeze([
  {
    code: 'cancelled',
    label: "They're leaving: cancelled or won't pay",
    goodbye: true,
    deletePersonal: true,
    closeLogin: true,
    does: 'Listings and profile off makaug, login closed, WhatsApp set back to a normal number. They get the goodbye message and their goodbye film. Their ID and personal details are deleted after 30 days; their name and number are kept.'
  },
  {
    code: 'not_paying',
    label: 'Has not paid yet',
    closeLogin: true,
    does: 'Listings and profile off makaug, login closed. Nothing is sent, and their details are kept so they can come back when they pay.'
  },
  {
    code: 'rules',
    label: 'Broke the rules (fake or wrong listings)',
    closeLogin: true,
    does: 'Listings and profile off makaug, login closed. Nothing is sent. Their ID is kept, for fraud or police requests.'
  },
  {
    code: 'duplicate',
    label: 'Duplicate or test record',
    does: 'Profile and listings off makaug. Nothing is sent. For a second record of the same person, or a test.'
  },
  {
    code: 'other',
    label: 'Something else',
    needsNote: true,
    does: 'Profile and listings off makaug. Nothing is sent. Say why in the note.'
  }
]);

function removalReason(code) {
  const key = String(code || '').trim().toLowerCase();
  return REMOVAL_REASONS.find((r) => r.code === key) || null;
}

/** The text kept in agents.removed_reason: the reason, then the staff note. */
function removedReasonText(reason, note = '') {
  const clean = String(note || '').replace(/\s+/g, ' ').trim();
  if (!reason) return clean.slice(0, 300);
  if (reason.code === 'other') return clean.slice(0, 300);
  return (clean ? `${reason.label} — ${clean}` : reason.label).slice(0, 300);
}

function prettyUgNumber(digits) {
  return digits.length === 12 && digits.startsWith('256')
    ? `+256 ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`
    : `+${digits}`;
}

/** makaug's own WhatsApp, the number former agents come back on (Arthur: never a staff member's). */
function makaugWhatsapp() {
  const { resolveMakaugSupportPhone } = require('./whatsappLinkService');
  let digits = String(resolveMakaugSupportPhone('') || '').replace(/\D+/g, '');
  if (digits.length === 10 && digits.startsWith('0')) digits = `256${digits.slice(1)}`;
  if (digits.length < 9) digits = '256780863394';
  return { name: 'makaug', digits, pretty: prettyUgNumber(digits) };
}

/** Overall views = the site's views x this (Arthur, 10 Nov 2026: "social media adds x20 to the views you can see"). */
function overallViewsMultiplier(env = process.env) {
  const n = Number(env.AGENT_OVERALL_VIEWS_MULTIPLIER);
  return Number.isFinite(n) && n >= 1 && n <= 100 ? n : 20;
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** A rounded "about" figure for an estimate: 123 → 120, 1,234 → 1,200. */
function aboutFigure(value) {
  const v = toInt(value);
  if (v < 100) return v;
  const step = v < 1000 ? 10 : 100;
  return Math.round(v / step) * step;
}

function cleanTitle(title) {
  return String(title || '').replace(/\s+/g, ' ').trim();
}

const OWNED_SQL = `
  SELECT p.id, p.title, p.area, p.district, p.status, p.approved_at, p.created_at
    FROM properties p
   WHERE p.agent_id::text = $1::text
      OR COALESCE(p.extra_fields, '{}'::jsonb)->>'broker_agent_id' = $1::text`;

/**
 * Everything the agent's properties did on makaug, all time: the properties
 * that went live, views and people (distinct visitors), the countries they
 * came from, enquiries, and the estimated reach with social media.
 */
async function lifetimeStats(agentId, { dbc = db } = {}) {
  const owned = (await dbc.query(OWNED_SQL, [String(agentId)])).rows;
  const ids = owned.map((row) => String(row.id));
  const liveIds = owned.filter((row) => row.approved_at || row.status === 'approved').map((row) => String(row.id));
  const listingsUp = owned.filter((row) => ['approved', 'pending'].includes(String(row.status || ''))).length;
  const empty = {
    properties_live: liveIds.length,
    listings_up: listingsUp,
    views: 0,
    visitors: 0,
    enquiries: 0,
    country_count: 0,
    countries: [],
    top_listings: [],
    views_multiplier: overallViewsMultiplier(),
    overall_views: 0
  };
  if (!ids.length) return empty;
  const safe = (promise, fallback) => promise.catch(() => fallback);
  const [totals, countries, perListing, asks] = await Promise.all([
    safe(dbc.query(
      `SELECT COUNT(*)::int AS views, COUNT(DISTINCT e.client_id)::int AS visitors,
              COUNT(DISTINCT e.country_code) FILTER (WHERE e.country_code IS NOT NULL AND e.country_code NOT IN ('XX', 'T1'))::int AS country_count
         FROM analytics_events e
        WHERE e.event_name = 'property_open'
          AND e.payload->>'property_id' = ANY($1::text[])`,
      [ids]
    ), { rows: [{}] }),
    safe(dbc.query(
      `SELECT e.country_code AS code, COUNT(DISTINCT e.client_id)::int AS visitors
         FROM analytics_events e
        WHERE e.event_name = 'property_open'
          AND e.country_code IS NOT NULL
          AND e.payload->>'property_id' = ANY($1::text[])
        GROUP BY 1
        ORDER BY 2 DESC, 1
        LIMIT 12`,
      [ids]
    ), { rows: [] }),
    safe(dbc.query(
      `SELECT e.payload->>'property_id' AS id, COUNT(*)::int AS views, COUNT(DISTINCT e.client_id)::int AS visitors
         FROM analytics_events e
        WHERE e.event_name = 'property_open'
          AND e.payload->>'property_id' = ANY($1::text[])
        GROUP BY 1`,
      [ids]
    ), { rows: [] }),
    // Same basis as the weekly report: one per person, test leads left out.
    safe(dbc.query(
      `SELECT
         (SELECT COUNT(*)::int FROM leads l
           WHERE l.listing_id = ANY($1::uuid[])
             AND l.is_test = FALSE
             AND l.lead_type IN ('enquiry', 'viewing', 'callback')
             AND NOT (COALESCE(l.channel, '') = 'whatsapp' AND COALESCE(l.source, '') NOT LIKE 'whatsapp_bot%')) AS enquiries,
         (SELECT COUNT(*)::int FROM property_inquiries pi
           WHERE pi.property_id = ANY($1::uuid[])
             AND pi.channel = 'whatsapp'
             AND pi.is_repeat = FALSE) AS whatsapp_clicks`,
      [ids]
    ), { rows: [{}] })
  ]);
  const t = totals.rows[0] || {};
  const countryList = countries.rows
    .map((row) => {
      const code = String(row.code || '').trim().toUpperCase();
      const name = countryName(code);
      return { code, name, visitors: toInt(row.visitors) };
    })
    // A code we have no name for never reaches an agent dressed as a country.
    .filter((c) => c.name && c.name !== 'Unknown' && c.name !== c.code && c.visitors > 0);
  const byId = new Map(owned.map((row) => [String(row.id), row]));
  const topListings = perListing.rows
    .map((row) => ({ ...row, property: byId.get(String(row.id)) }))
    .filter((row) => row.property && toInt(row.views) > 0)
    .sort((a, b) => toInt(b.views) - toInt(a.views))
    .slice(0, 3)
    .map((row) => ({
      id: String(row.id),
      title: cleanTitle(row.property.title) || 'Property',
      area: [row.property.area, row.property.district].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(', '),
      views: toInt(row.views),
      visitors: toInt(row.visitors)
    }));
  const views = toInt(t.views);
  const multiplier = overallViewsMultiplier();
  const a = asks.rows[0] || {};
  return {
    properties_live: liveIds.length,
    listings_up: listingsUp,
    views,
    visitors: toInt(t.visitors),
    enquiries: toInt(a.enquiries) + toInt(a.whatsapp_clicks),
    country_count: Math.max(toInt(t.country_count), countryList.length),
    countries: countryList.slice(0, 6),
    top_listings: topListings,
    // Views on makaug plus our social media: the site's views x 20.
    views_multiplier: multiplier,
    overall_views: Math.round(views * multiplier)
  };
}

/** What the goodbye film and message are made from. Holds no personal details. */
async function buildGoodbyePayload(agentId, { dbc = db } = {}) {
  const agent = (await dbc.query(
    `SELECT id, full_name, greeting_name, company_name, makaug_agent_number, created_at, approved_at
       FROM agents WHERE id = $1 LIMIT 1`,
    [agentId]
  )).rows[0];
  if (!agent) throw Object.assign(new Error('Agent not found'), { status: 404 });
  const stats = await lifetimeStats(agent.id, { dbc });
  return {
    agent: {
      id: String(agent.id),
      full_name: agent.full_name || '',
      greeting_name: agentGreetingName(agent, ''),
      company_name: agent.company_name || '',
      makaug_agent_number: agent.makaug_agent_number || '',
      joined_at: agent.approved_at || agent.created_at || null
    },
    stats,
    contact: makaugWhatsapp(),
    keep_days: detailKeepDays(),
    built_at: new Date().toISOString()
  };
}

/**
 * The written WhatsApp goodbye: short (Arthur, 10 Nov 2026). The numbers are
 * in the film; the message says the properties are down, sorry to see you go,
 * when their details are deleted, and how to come back. Nothing about fees.
 */
function buildGoodbyeMessage(payload = {}) {
  const agent = payload.agent || {};
  const s = payload.stats || {};
  const contact = payload.contact || makaugWhatsapp();
  const days = toInt(payload.keep_days) || detailKeepDays();
  const firstName = agentGreetingName(agent, 'there');
  const hadListings = toInt(s.properties_live) > 0 || toInt(s.listings_up) > 0;
  return [
    `Hi ${firstName},`,
    '',
    `${hadListings ? 'Your properties are now off makaug.com and your agent account is closed' : 'Your agent account on makaug.com is closed'}, so you won't get any more agent messages from us. We're sad to see you go, and thank you for ${hadListings ? 'listing with us' : 'joining us'}. Your goodbye film is below.`,
    '',
    `We'll delete your ID and personal details after ${days} days, in case you change your mind before then. We keep your number, so whenever you want to come back, just WhatsApp makaug on ${contact.pretty}.`,
    '',
    'Phillip, makaug.com'
  ].join('\n');
}

function buildGoodbyeCaption(payload = {}) {
  const firstName = agentGreetingName(payload.agent || {}, 'there');
  return `🎬 *Thank you, ${firstName}* — your time on makaug.com in one short film.`;
}

/** What King shows before staff press Remove: the reason, what it does, and what is sent. */
function describeRemoval(reason) {
  if (!reason) return [];
  const out = ['Their profile comes off makaug, and their live and pending listings are hidden (nothing is deleted).'];
  if (reason.closeLogin) out.push('Their makaug login is closed.');
  if (reason.deletePersonal) out.push(`In ${detailKeepDays()} days their ID photos and ID files, NIN, ID expiry, email, profile photo and bio are deleted. Restore them before then and nothing is lost. Kept for good: name, phone number, agent number, payment records and the hidden listings.`);
  if (reason.goodbye) {
    out.push('Their WhatsApp is set back to a normal number (no agent menu, reports, reminders or payment messages) and the chat is marked "former agent".');
    out.push('They get the goodbye message below, then their goodbye film.');
  } else {
    out.push('Nothing is sent to them.');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Personal details

const AGENT_PERSONAL_COLUMNS = [
  'nin', 'id_expiry_date', 'identity_document_url', 'identity_document_name', 'identity_document_type',
  'identity_document_uploaded_at', 'area_certificate_url', 'profile_photo_url', 'profile_photo_kind', 'bio', 'email'
];

const USER_PERSONAL_KEYS = [
  'broker_national_id_number', 'broker_identity_document_url', 'broker_identity_document_name',
  'broker_identity_document_type', 'broker_identity_document_uploaded_at', 'broker_identity_document_uploaded',
  'broker_profile_photo_url', 'broker_bio', 'national_id_expiry_date', 'national_id_number'
];

const COLUMN_LABELS = {
  nin: 'NIN',
  id_expiry_date: 'ID expiry',
  identity_document_url: 'sign-up ID photo',
  area_certificate_url: 'area certificate',
  profile_photo_url: 'profile photo',
  bio: 'bio',
  email: 'email'
};

async function existingColumns(client, table) {
  const result = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`,
    [table]
  );
  return new Set(result.rows.map((row) => row.column_name));
}

/**
 * Deletes the agent's personal details, inside the caller's transaction.
 * Returns what was cleared and the stored files to delete once committed.
 */
async function deletePersonalDetails(client, agentId) {
  const columns = await existingColumns(client, 'agents');
  const present = AGENT_PERSONAL_COLUMNS.filter((c) => columns.has(c));
  const before = present.length
    ? (await client.query(`SELECT ${present.join(', ')}, ${columns.has('user_id') ? 'user_id' : 'NULL::uuid AS user_id'} FROM agents WHERE id = $1`, [agentId])).rows[0] || {}
    : {};
  const filled = present.filter((c) => before[c] !== null && before[c] !== undefined && String(before[c]).trim() !== '');
  const files = [];
  if (before.identity_document_url) files.push({ ref: String(before.identity_document_url), kind: 'id' });
  if (before.area_certificate_url) files.push({ ref: String(before.area_certificate_url), kind: 'certificate' });
  if (before.profile_photo_url) files.push({ ref: String(before.profile_photo_url), kind: 'photo' });
  if (present.length) {
    await client.query(`UPDATE agents SET ${present.map((c) => `${c} = NULL`).join(', ')}, updated_at = NOW() WHERE id = $1`, [agentId]);
  }

  let idFilesDeleted = 0;
  const hasIdFiles = (await client.query(`SELECT to_regclass('agent_identity_files') IS NOT NULL AS ok`)).rows[0]?.ok;
  if (hasIdFiles) {
    idFilesDeleted = (await client.query('DELETE FROM agent_identity_files WHERE agent_id = $1 RETURNING id', [agentId])).rows.length;
  }

  let userCleared = false;
  if (before.user_id) {
    const user = (await client.query('SELECT email, profile_data FROM users WHERE id = $1', [before.user_id])).rows[0];
    if (user) {
      const data = user.profile_data && typeof user.profile_data === 'object' ? user.profile_data : {};
      if (data.broker_identity_document_url) files.push({ ref: String(data.broker_identity_document_url), kind: 'id' });
      if (data.broker_profile_photo_url) files.push({ ref: String(data.broker_profile_photo_url), kind: 'photo' });
      await client.query(
        `UPDATE users SET email = NULL, profile_data = COALESCE(profile_data, '{}'::jsonb) - $2::text[], updated_at = NOW() WHERE id = $1`,
        [before.user_id, USER_PERSONAL_KEYS]
      );
      userCleared = Boolean(user.email) || USER_PERSONAL_KEYS.some((k) => data[k] !== undefined);
    }
  }
  const cleared = filled
    .map((c) => COLUMN_LABELS[c] || null)
    .filter(Boolean)
    .filter((v, i, arr) => arr.indexOf(v) === i);
  if (idFilesDeleted) cleared.push(`${idFilesDeleted} ID file${idFilesDeleted === 1 ? '' : 's'}`);
  if (userCleared) cleared.push('login email and sign-up ID');
  return { cleared, id_files_deleted: idFilesDeleted, files: files.filter((f, i, arr) => arr.findIndex((x) => x.ref === f.ref) === i) };
}

/** After commit: delete the stored ID photos (and the profile photo if nobody else uses it). Best effort. */
async function deleteStoredFiles(files = [], { dbc = db, storage = require('./cloudMediaStorageService') } = {}) {
  const out = { deleted: 0, kept: 0, failed: 0 };
  if (!files.length || !storage.cloudMediaStorageConfigured()) return out;
  for (const file of files) {
    const ref = String(file.ref || '').trim();
    if (!ref || /^data:/i.test(ref)) continue;
    let parsed = null;
    try { parsed = storage.parseStoredS3ObjectRef(ref); } catch (_e) { parsed = null; }
    if (!parsed?.key) { out.kept += 1; continue; }
    if (file.kind === 'photo') {
      // A logo can be shared by two records of the same company.
      const used = await dbc.query(
        `SELECT 1 FROM agents WHERE profile_photo_url = $1
          UNION ALL SELECT 1 FROM users WHERE profile_data->>'broker_profile_photo_url' = $1
          LIMIT 1`,
        [ref]
      ).then((r) => r.rows.length > 0).catch(() => true);
      if (used) { out.kept += 1; continue; }
    }
    try {
      await storage.deleteStoredS3Object(ref);
      out.deleted += 1;
    } catch (error) {
      out.failed += 1;
      console.warn('[agent-goodbye] stored file not deleted:', error.message);
    }
  }
  return out;
}

/**
 * An agent who cancelled keeps their details for 30 days in case they come
 * back (Arthur, 10 Nov 2026); then they are deleted here. Name and phone
 * number are never deleted. Restoring the agent before the date clears the
 * removal, so nothing is deleted. Safe to run any number of times.
 */
async function runFormerAgentDetailDeletion(dbc = db, { now = new Date(), logger = console } = {}) {
  const due = (await dbc.query(
    `SELECT id FROM agents
      WHERE removed_at IS NOT NULL
        AND removal_snapshot->>'reason_code' = 'cancelled'
        AND removal_snapshot->>'personal_deleted_at' IS NULL
        AND COALESCE((removal_snapshot->>'personal_delete_after')::timestamptz, removed_at + make_interval(days => $2::int)) <= $1::timestamptz
      ORDER BY removed_at
      LIMIT 50`,
    [new Date(now).toISOString(), detailKeepDays()]
  )).rows;
  const deleted = [];
  for (const row of due) {
    const client = await dbc.getClient();
    let personal = null;
    try {
      await client.query('BEGIN');
      const locked = (await client.query('SELECT id, removed_at, removal_snapshot FROM agents WHERE id = $1 FOR UPDATE', [row.id])).rows[0];
      const snap = locked?.removal_snapshot || {};
      if (!locked?.removed_at || snap.reason_code !== 'cancelled' || snap.personal_deleted_at) {
        await client.query('ROLLBACK');
        continue;
      }
      personal = await deletePersonalDetails(client, row.id);
      await client.query(
        `UPDATE agents SET removal_snapshot = COALESCE(removal_snapshot, '{}'::jsonb) || $2::jsonb, updated_at = NOW() WHERE id = $1`,
        [row.id, JSON.stringify({ personal_deleted: personal.cleared, personal_deleted_at: new Date(now).toISOString() })]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      logger.warn('[agent-goodbye] personal details not deleted yet', row.id, error.message);
      continue;
    } finally {
      client.release();
    }
    await dbc.query(
      `INSERT INTO audit_logs (actor_id, action, details) VALUES ('system', 'agent_personal_details_deleted', $1::jsonb)`,
      [JSON.stringify({ agent_id: String(row.id), deleted: personal.cleared })]
    ).catch(() => null);
    await deleteStoredFiles(personal.files, { dbc }).catch(() => null);
    deleted.push({ id: String(row.id), deleted: personal.cleared });
  }
  return { checked: due.length, deleted };
}

let detailTimer = null;

/** Checks four times a day; the first check waits for the deploy to settle. */
function startFormerAgentDetailScheduler(dbc = db, { bootDelayMs = 10 * 60 * 1000, intervalMs = 6 * 60 * 60 * 1000, logger = console } = {}) {
  if (detailTimer) return detailTimer;
  const run = () => runFormerAgentDetailDeletion(dbc, { logger })
    .then((result) => { if (result.deleted.length) logger.info?.(`[agent-goodbye] personal details deleted for ${result.deleted.length} former agent(s)`); })
    .catch((error) => logger.warn('[agent-goodbye] detail deletion check failed:', error.message));
  const first = setTimeout(run, bootDelayMs);
  first.unref?.();
  detailTimer = setInterval(run, intervalMs);
  detailTimer.unref?.();
  return detailTimer;
}

// ---------------------------------------------------------------------------
// WhatsApp

function phoneKeys(agent = {}) {
  return [agent.whatsapp, agent.phone]
    .map((p) => String(p || '').replace(/\D+/g, ''))
    .filter((d) => d.length >= 9)
    .map((d) => d.slice(-9))
    .filter((v, i, arr) => arr.indexOf(v) === i);
}

/**
 * Sets a former agent's number back to an ordinary WhatsApp contact: any
 * agent conversation in progress is cleared, the chat is marked "former agent"
 * with a note for staff, and the bot stops treating the number as an agent.
 */
async function resetFormerAgentWhatsapp({ agent = {}, note = '', dbc = db } = {}) {
  const keys = phoneKeys(agent);
  let sessions = 0;
  let chats = 0;
  let skipped = 0;
  for (const key of keys) {
    // Two records can share a number (the same person signed up twice). If
    // another record on this number is still an approved agent, the number is
    // still an agent's: leave the chat alone.
    const stillAgent = (await dbc.query(
      `SELECT 1 FROM agents
        WHERE id::text <> $2::text AND removed_at IS NULL AND status = 'approved'
          AND (RIGHT(regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g'), 9) = $1
            OR RIGHT(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 9) = $1)
        LIMIT 1`,
      [key, String(agent.id || '')]
    ).catch(() => ({ rows: [] }))).rows.length > 0;
    if (stillAgent) { skipped += 1; continue; }
    sessions += (await dbc.query(
      `UPDATE whatsapp_sessions
          SET current_step = 'greeting', listing_draft = '{}'::jsonb, session_data = '{}'::jsonb, updated_at = NOW()
        WHERE RIGHT(regexp_replace(phone, '\\D', '', 'g'), 9) = $1
        RETURNING phone`,
      [key]
    ).catch(() => ({ rows: [] }))).rows.length;
    chats += (await dbc.query(
      `UPDATE whatsapp_conversation_state
          SET tags = CASE WHEN COALESCE(tags, '[]'::jsonb) ? 'former agent' THEN tags ELSE COALESCE(tags, '[]'::jsonb) || '["former agent"]'::jsonb END,
              admin_notes = LEFT(CONCAT_WS(E'\\n', NULLIF($2::text, ''), admin_notes), 4000),
              updated_at = NOW()
        WHERE RIGHT(regexp_replace(phone, '\\D', '', 'g'), 9) = $1
        RETURNING phone`,
      [key, note]
    ).catch(() => ({ rows: [] }))).rows.length;
  }
  forgetAgentNumbers(agent);
  return { sessions_reset: sessions, chats_marked: chats, shared_numbers_left: skipped };
}

/**
 * Queues the goodbye: the message now, the film once it is rendered (so it
 * always arrives after the message). If the film cannot be made, the message
 * still goes. `queue` is queueWhatsappWebBridgeMessage; `videos` the video
 * service (both passed in so the order can be tested).
 */
async function queueGoodbye({ payload, to, version, preview = false, source = 'whatsapp_runtime', actorId = 'admin', baseUrl, queue, videos } = {}) {
  const digits = String(to || '').replace(/\D+/g, '');
  if (digits.length < 9) return { sent: false, reason: 'no_whatsapp_number' };
  const agentId = String(payload?.agent?.id || '');
  const dedupeBase = `agent_goodbye:${agentId}:${preview ? `preview:${Date.now()}` : version}`;
  const message = await queue({
    recipient: digits,
    text: buildGoodbyeMessage(payload),
    source,
    actorId,
    metadata: { message_kind: 'agent_goodbye', agent_id: agentId, preview, part: 'message', reply_dedupe_key: `${dedupeBase}:message` }
  });
  const film = { status: 'not_available', url: '' };
  const url = videos && videos.isVideoRenderingAvailable() ? videos.goodbyeVideoUrl(payload.agent, baseUrl, version) : '';
  if (url) {
    film.status = 'rendering';
    film.url = url;
    film.done = videos.ensureGoodbyeVideo(payload, version)
      .then(() => queue({
        recipient: digits,
        text: buildGoodbyeCaption(payload),
        mediaUrl: url,
        mediaType: 'video',
        source,
        actorId,
        metadata: { message_kind: 'agent_goodbye', agent_id: agentId, preview, part: 'film', reply_dedupe_key: `${dedupeBase}:film` }
      }))
      .then((queued) => ({ queued: true, id: queued?.id || null }))
      .catch((error) => {
        console.warn('[agent-goodbye] film not sent:', error.message);
        return { queued: false, error: error.message };
      });
  }
  return { sent: true, to: digits, message_id: message?.id || null, film };
}

/** On restore: the chat is no longer a former agent's. */
async function unmarkFormerAgentWhatsapp({ agent = {}, dbc = db } = {}) {
  for (const key of phoneKeys(agent)) {
    await dbc.query(
      `UPDATE whatsapp_conversation_state SET tags = COALESCE(tags, '[]'::jsonb) - 'former agent', updated_at = NOW()
        WHERE RIGHT(regexp_replace(phone, '\\D', '', 'g'), 9) = $1`,
      [key]
    ).catch(() => null);
  }
  forgetAgentNumbers(agent);
}

function forgetAgentNumbers(agent = {}) {
  try {
    const whatsapp = require('../routes/whatsapp');
    if (typeof whatsapp.forgetAgentPhone === 'function') {
      [agent.whatsapp, agent.phone].filter(Boolean).forEach((p) => whatsapp.forgetAgentPhone(p));
    }
  } catch (_error) {
    // The lookup cache expires on its own within five minutes.
  }
}

module.exports = {
  REMOVAL_REASONS,
  AGENT_PERSONAL_COLUMNS,
  USER_PERSONAL_KEYS,
  removalReason,
  removedReasonText,
  describeRemoval,
  makaugWhatsapp,
  overallViewsMultiplier,
  detailKeepDays,
  aboutFigure,
  lifetimeStats,
  buildGoodbyePayload,
  buildGoodbyeMessage,
  buildGoodbyeCaption,
  deletePersonalDetails,
  deleteStoredFiles,
  resetFormerAgentWhatsapp,
  unmarkFormerAgentWhatsapp,
  queueGoodbye,
  runFormerAgentDetailDeletion,
  startFormerAgentDetailScheduler,
  phoneKeys
};
