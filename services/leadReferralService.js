'use strict';

const { agentGreetingName } = require('./agentNameService');

/**
 * Referring a lead to an agent.
 *
 * Some leads have nobody to go to automatically: a WhatsApp search makaug
 * could not answer, a "tell us what you need" request, a listing with no
 * contact. Staff pick a registered agent from a list and makaug sends that
 * agent a WhatsApp: who is looking, for what, where, at what budget, and how
 * to reach them. The agent reaches out; makaug steps out.
 *
 * Only approved, registered agents can be picked — never a scraped poster or a
 * source-sweep profile (see registeredAgentSql).
 */

const { registeredAgentSql, deliverWhatsapp } = require('./leadHandoffService');
const { addLeadActivity, recordLeadHandoff } = require('./leadService');
const { logNotification } = require('./notificationLogService');

function text(value, fallback = '') {
  const cleaned = String(value ?? '').trim();
  return cleaned || fallback;
}

const WANT_PHRASES = Object.freeze({
  rent: 'a place to rent',
  sale: 'a property to buy',
  buy: 'a property to buy',
  land: 'land to buy',
  commercial: 'commercial space',
  student: 'student accommodation',
  students: 'student accommodation',
  short_term: 'a short stay',
  off_plan: 'an off-plan property',
  any: 'a property'
});

function wantPhrase(type = '') {
  const key = text(type, 'any').toLowerCase().replace(/\s+/g, '_');
  return WANT_PHRASES[key] || `a ${key.replace(/_/g, ' ')} property`;
}

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n >= 1e9) return `UGX ${(n / 1e9).toFixed(n % 1e9 ? 1 : 0)}bn`;
  if (n >= 1e6) return `UGX ${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}m`;
  return `UGX ${Math.round(n).toLocaleString('en-UG')}`;
}

function ago(value) {
  if (!value) return '';
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

// What the person actually typed, without the bot's own bookkeeping around it.
function cleanSaid(value = '') {
  const said = text(value)
    .replace(/^No approved listings found for (natural )?query( in [a-z_]+)?:\s*/i, '')
    .replace(/^(Auto-captured[^.]*\.?|WhatsApp property request had no exact match\.?)\s*/i, '')
    .trim();
  return said.length >= 3 ? said : '';
}

function displayPhone(value = '') {
  const digits = String(value).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('256')) return `+256 ${digits.slice(3, 6)} ${digits.slice(6)}`;
  if (digits.length === 10 && digits.startsWith('0')) return `+256 ${digits.slice(1, 4)} ${digits.slice(4)}`;
  return digits ? `+${digits}` : '';
}

/**
 * The WhatsApp an agent receives for a referred lead.
 * need: { type, area, people: [{ name, phone, budget, said, askedAt }] }
 */
function buildAgentReferralMessage({ agent = {}, need = {} } = {}) {
  const people = (Array.isArray(need.people) ? need.people : []).filter((p) => p && p.phone).slice(0, 10);
  const firstName = agentGreetingName(agent, 'there');
  const where = text(need.area) && !/^anywhere$/i.test(need.area) ? ` in ${text(need.area)}` : '';
  const what = wantPhrase(need.type);
  const lines = [`Hi ${firstName}, this is makaug.com.`, ''];

  if (people.length <= 1) {
    const p = people[0] || {};
    lines.push(`We have a lead for you: someone is looking for ${what}${where}.`);
    lines.push('');
    if (p.name) lines.push(`Name: ${p.name}`);
    if (p.phone) lines.push(`WhatsApp: ${displayPhone(p.phone)}`);
    if (money(p.budget)) lines.push(`Budget: up to ${money(p.budget)}`);
    if (cleanSaid(p.said)) lines.push(`What they said: "${cleanSaid(p.said).slice(0, 220)}"`);
    if (p.askedAt) lines.push(`Asked: ${ago(p.askedAt)}`);
  } else {
    lines.push(`We have ${people.length} leads for you: people looking for ${what}${where}.`);
    lines.push('');
    people.forEach((p, index) => {
      const bits = [p.name, displayPhone(p.phone), money(p.budget) ? `budget up to ${money(p.budget)}` : '', p.askedAt ? `asked ${ago(p.askedAt)}` : '']
        .filter(Boolean);
      lines.push(`${index + 1}. ${bits.join(' · ')}`);
      const said = cleanSaid(p.said);
      if (said) lines.push(`   "${said.slice(0, 160)}"`);
    });
  }

  lines.push('');
  lines.push(people.length > 1
    ? 'If you have something that fits, please reach out to them directly on WhatsApp.'
    : 'If you have something that fits, please reach out to them directly on WhatsApp.');
  lines.push('And if you have it, list it on makaug.com so others can find it too.');
  lines.push('');
  lines.push('Thank you,');
  lines.push('makaug.com');
  return lines.join('\n');
}

function siteUrl() {
  return text(process.env.PUBLIC_SITE_URL || process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL, 'https://makaug.com').replace(/\/+$/, '');
}

const BROWSE_PATHS = Object.freeze({
  rent: '/to-rent', sale: '/for-sale', buy: '/for-sale', land: '/land', commercial: '/commercial',
  student: '/student-accommodation', students: '/student-accommodation', short_term: '/short-term', any: '/for-sale'
});

/** The live listings page for what they asked, filtered to their area and budget. */
function browseUrl(need = {}, person = {}) {
  const path = BROWSE_PATHS[text(need.type, 'any').toLowerCase()] || '/for-sale';
  const params = new URLSearchParams();
  if (text(need.area) && !/^anywhere$/i.test(need.area)) params.set('area', text(need.area));
  if (Number(person.budget) > 0) params.set('max_price', String(Math.round(Number(person.budget))));
  const qs = params.toString();
  return `${siteUrl()}${path}${qs ? `?${qs}` : ''}`;
}

function agentProfileUrl(agent = {}) {
  return agent.id ? `${siteUrl()}/agents/${encodeURIComponent(agent.id)}` : `${siteUrl()}/brokers`;
}

/**
 * The WhatsApp the person who asked receives when their request goes to an
 * agent: who has it, that they cover the area, the agent's profile, and the
 * live listings for what they want in the meantime.
 */
function buildClientReferralMessage({ agent = {}, need = {}, person = {} } = {}) {
  const first = text(person.name).split(/\s+/)[0];
  const area = text(need.area) && !/^anywhere$/i.test(need.area) ? text(need.area) : '';
  const agentName = text(agent.full_name || agent.name, 'one of our approved agents');
  const company = text(agent.company_name);
  return [
    first ? `Hi ${first}, this is makaug.com.` : 'Hi, this is makaug.com.',
    '',
    `You asked us about ${wantPhrase(need.type)}${area ? ` in ${area}` : ''}. We have passed your request to ${agentName}${company && company !== agentName ? ` (${company})` : ''}, one of makaug's approved agents${area && agent.covers_area ? `, who covers ${area}` : ''}.`,
    '',
    `They will contact you on WhatsApp with properties that fit. You can see their profile here:`,
    agentProfileUrl(agent),
    '',
    'While you wait, everything live on makaug that matches your search is here:',
    browseUrl(need, person),
    '',
    'makaug.com connects you with the agent; any viewing, payment or agreement is between you and them. Never pay before you have seen the property and its documents.'
  ].join('\n');
}

/**
 * Send the "your request has gone to <agent>" message to each person.
 * overrideText may contain {name}, filled per person. previewTo sends one
 * sample instead. Returns per-person results.
 */
async function notifyClientsOfReferral(db, { agent, need, overrideText = '', previewTo = '', actor = 'admin' } = {}) {
  const people = (Array.isArray(need.people) ? need.people : []).filter((p) => p && p.phone).slice(0, 10);
  const results = [];
  const targets = previewTo ? people.slice(0, 1) : people;
  for (const person of targets) {
    const first = text(person.name).split(/\s+/)[0];
    const body = text(overrideText)
      ? text(overrideText).replace(/\{name\}/g, first || 'there').slice(0, 3000)
      : buildClientReferralMessage({ agent, need, person });
    const to = previewTo || person.phone;
    const delivery = await deliverWhatsapp({ to, body, kind: previewTo ? 'client_referral_preview' : 'client_referral', leadId: null, nonce: Date.now() });
    await logNotification(db, {
      recipientPhone: to,
      channel: 'whatsapp',
      type: previewTo ? 'client_referral_preview' : 'client_told_agent_assigned',
      status: delivery.status,
      failureReason: ['failed', 'skipped'].includes(delivery.status) ? delivery.reason || null : null,
      payloadSummary: { agent_id: agent.id, agent_name: agent.full_name, actor }
    });
    results.push({ phone: person.phone, status: delivery.status, text: body });
  }
  return results;
}

/**
 * Registered, approved agents with a WhatsApp/phone, best match for the area
 * first (districts covered, then where their live listings are).
 */
async function listReferralAgents(db, { area = '', search = '', limit = 200 } = {}) {
  const needle = text(area).toLowerCase();
  const query = text(search).toLowerCase();
  const result = await db.query(
    `SELECT
       a.id, a.full_name, a.company_name, a.makaug_agent_number,
       COALESCE(NULLIF(a.whatsapp, ''), a.phone) AS whatsapp,
       a.districts_covered,
       (a.user_id IS NOT NULL) AS has_login,
       COALESCE(a.verified_badge, FALSE) AS verified_badge,
       COALESCE(live.n, 0)::int AS live_listings,
       COALESCE(live.in_area, 0)::int AS live_in_area,
       (
         $1 <> '' AND EXISTS (
           SELECT 1 FROM UNNEST(COALESCE(a.districts_covered, '{}'::text[])) d
            WHERE LOWER(d) = $1 OR $1 LIKE '%' || LOWER(d) || '%' OR LOWER(d) LIKE '%' || $1 || '%'
         )
       ) AS covers_area
     FROM agents a
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS n,
              COUNT(*) FILTER (WHERE $1 <> '' AND (LOWER(COALESCE(p.area, '')) = $1 OR LOWER(COALESCE(p.district, '')) = $1)) AS in_area
         FROM properties p
        WHERE p.agent_id = a.id AND LOWER(COALESCE(p.status, '')) = 'approved'
     ) live ON TRUE
     WHERE ${registeredAgentSql('a')}
       AND LENGTH(REGEXP_REPLACE(COALESCE(NULLIF(a.whatsapp, ''), a.phone, ''), '\\D', '', 'g')) >= 9
       AND ($2 = '' OR LOWER(a.full_name) LIKE '%' || $2 || '%' OR LOWER(COALESCE(a.company_name, '')) LIKE '%' || $2 || '%')
     ORDER BY covers_area DESC, live_in_area DESC, live_listings DESC, a.full_name ASC
     LIMIT $3`,
    [needle, query, Math.min(Math.max(Number(limit) || 200, 1), 500)]
  );
  return result.rows.map((row) => ({
    ...row,
    match: row.covers_area || row.live_in_area > 0
  }));
}

/** Does this agent cover the area (districts covered, or live listings there)? */
async function withAreaCoverage(db, agent, area = '') {
  const needle = text(area).toLowerCase();
  if (!agent || !needle || /^anywhere$/i.test(needle)) return { ...agent, covers_area: false };
  const result = await db.query(
    `SELECT (
        EXISTS (SELECT 1 FROM agents a, UNNEST(COALESCE(a.districts_covered, '{}'::text[])) d
                 WHERE a.id = $1::uuid AND (LOWER(d) = $2 OR $2 LIKE '%' || LOWER(d) || '%' OR LOWER(d) LIKE '%' || $2 || '%'))
        OR EXISTS (SELECT 1 FROM properties p
                    WHERE p.agent_id = $1::uuid AND LOWER(COALESCE(p.status, '')) = 'approved'
                      AND (LOWER(COALESCE(p.area, '')) = $2 OR LOWER(COALESCE(p.district, '')) = $2))
      ) AS covers`,
    [agent.id, needle]
  ).catch(() => ({ rows: [{ covers: false }] }));
  return { ...agent, covers_area: Boolean(result.rows[0]?.covers) };
}

async function loadReferralAgent(db, agentId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(agentId || ''))) return null;
  const result = await db.query(
    `SELECT a.id, a.full_name, a.company_name, a.makaug_agent_number,
            COALESCE(NULLIF(a.whatsapp, ''), a.phone) AS whatsapp
       FROM agents a
      WHERE a.id = $1::uuid AND ${registeredAgentSql('a')}
      LIMIT 1`,
    [agentId]
  );
  return result.rows[0] || null;
}

/**
 * The people behind one row of the "searches we could not answer" panel.
 */
async function loadDemandGroup(db, { searchType = 'any', area = 'Anywhere', days = 90 } = {}) {
  const result = await db.query(
    `SELECT id, phone, name, budget, notes, created_at
       FROM property_leads
      WHERE purpose = 'search'
        AND created_at >= NOW() - ($3 || ' days')::interval
        AND LOWER(COALESCE(NULLIF(category, ''), 'any')) = LOWER($1)
        AND INITCAP(COALESCE(NULLIF(TRIM(preferred_area), ''), 'anywhere')) = $2
      ORDER BY created_at DESC`,
    [text(searchType, 'any'), text(area, 'Anywhere'), String(Math.max(1, Math.min(365, Number(days) || 90)))]
  );
  // Every row is marked as referred; each person appears once (latest ask).
  const seen = new Set();
  const rows = result.rows.filter((r) => {
    const key = String(r.phone || '').replace(/\D/g, '').slice(-9);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    ids: result.rows.map((r) => r.id),
    people: rows.map((r) => ({
      name: text(r.name) && !/whatsapp/i.test(r.name) ? text(r.name) : '',
      phone: r.phone,
      budget: r.budget,
      said: /^Auto-captured/i.test(text(r.notes)) ? '' : text(r.notes),
      askedAt: r.created_at
    }))
  };
}

/**
 * One CRM lead as a referral need.
 */
async function loadLeadNeed(db, leadId) {
  if (!/^[0-9a-f-]{36}$/i.test(String(leadId || ''))) return null;
  const result = await db.query(
    `SELECT l.*, c.name AS contact_name, COALESCE(NULLIF(c.whatsapp, ''), c.phone) AS contact_phone,
            p.title AS listing_title, p.area AS listing_area, p.district AS listing_district, p.listing_type AS listing_type
       FROM leads l
       LEFT JOIN contacts c ON c.id = l.contact_id
       LEFT JOIN properties p ON p.id = l.listing_id
      WHERE l.id = $1::uuid
      LIMIT 1`,
    [leadId]
  );
  const lead = result.rows[0];
  if (!lead) return null;
  const submitted = (lead.metadata && lead.metadata.submitted_contact) || {};
  const phone = text(submitted.phone || lead.contact_phone);
  const message = text(lead.message);
  return {
    lead,
    need: {
      type: lead.category || lead.listing_type || lead.metadata?.search_type || 'any',
      area: lead.location || lead.metadata?.preferred_area || lead.listing_area || lead.listing_district || '',
      people: phone ? [{
        name: text(submitted.name || lead.contact_name).replace(/^(WhatsApp (property seeker|enquirer|contact initiated)|Unknown contact)$/i, ''),
        phone,
        budget: lead.budget,
        said: /^(WhatsApp contact initiated|Asked about |Auto-captured|Property enquiry submitted)/i.test(message) ? '' : (lead.metadata?.original_message || message),
        askedAt: lead.created_at
      }] : []
    }
  };
}

/**
 * Send (or preview) a referral. previewTo sends the same text to the admin's
 * own number instead of the agent. Returns { delivery, text }.
 */
async function sendReferral(db, { agent, text: body, previewTo = '', actor = 'admin', relatedLeadId = null, kind = 'referral' } = {}) {
  const to = previewTo || agent.whatsapp;
  const delivery = await deliverWhatsapp({
    to,
    body,
    kind: previewTo ? `referral_preview_${kind}` : `referral_${kind}`,
    leadId: relatedLeadId,
    nonce: Date.now()
  });
  await logNotification(db, {
    recipientPhone: to,
    channel: 'whatsapp',
    type: previewTo ? 'lead_referral_preview' : 'lead_referral_to_agent',
    status: delivery.status,
    failureReason: ['failed', 'skipped'].includes(delivery.status) ? delivery.reason || null : null,
    sentAt: delivery.status === 'sent' ? new Date() : null,
    payloadSummary: { agent_id: agent.id, agent_name: agent.full_name, actor, kind, provider: delivery.provider || null },
    relatedLeadId
  });
  return delivery;
}

async function markDemandReferred(db, ids = [], referral = {}) {
  if (!ids.length) return;
  await db.query(
    `UPDATE property_leads
        SET payload = COALESCE(payload, '{}'::jsonb)
                      || jsonb_build_object('last_referral', $2::jsonb)
                      || jsonb_build_object('referrals', COALESCE(payload->'referrals', '[]'::jsonb) || jsonb_build_array($2::jsonb))
      WHERE id = ANY($1::uuid[])`,
    [ids, JSON.stringify(referral)]
  );
  // The matching CRM leads (WhatsApp no-match) carry the referral too.
  await db.query(
    `UPDATE leads l
        SET metadata = COALESCE(l.metadata, '{}'::jsonb)
                       || jsonb_build_object('last_referral', $2::jsonb, 'match_status', 'referred_to_agent'),
            lead_status = CASE WHEN l.lead_status = 'open' THEN 'handed_over' ELSE l.lead_status END,
            handoff_status = 'referred_to_agent',
            handoff_at = NOW(),
            updated_at = NOW()
       FROM contacts c
      WHERE c.id = l.contact_id
        AND l.source = 'whatsapp_no_match'
        AND c.phone_key = ANY(
          SELECT RIGHT(REGEXP_REPLACE(pl.phone, '\\D', '', 'g'), 9) FROM property_leads pl WHERE pl.id = ANY($1::uuid[])
        )
        AND l.created_at >= NOW() - INTERVAL '120 days'`,
    [ids, JSON.stringify(referral)]
  ).catch(() => {});
}

async function markLeadReferred(db, lead, referral = {}) {
  await db.query(
    `UPDATE leads
        SET metadata = COALESCE(metadata, '{}'::jsonb)
                       || jsonb_build_object('last_referral', $2::jsonb)
                       || jsonb_build_object('referrals', COALESCE(metadata->'referrals', '[]'::jsonb) || jsonb_build_array($2::jsonb)),
            lead_status = CASE WHEN lead_status = 'open' THEN 'handed_over' ELSE lead_status END,
            handoff_status = 'referred_to_agent',
            handoff_at = NOW(),
            updated_at = NOW()
      WHERE id = $1`,
    [lead.id, JSON.stringify(referral)]
  );
  await addLeadActivity(db, {
    leadId: lead.id,
    actorType: 'admin',
    activityType: 'referred_to_agent',
    message: `Referred to ${referral.agent_name} on WhatsApp`,
    newStatus: 'handed_over',
    metadata: referral
  });
}

module.exports = {
  withAreaCoverage,
  agentProfileUrl,
  browseUrl,
  buildClientReferralMessage,
  notifyClientsOfReferral,
  buildAgentReferralMessage,
  cleanSaid,
  listReferralAgents,
  loadDemandGroup,
  loadLeadNeed,
  loadReferralAgent,
  markDemandReferred,
  markLeadReferred,
  sendReferral,
  wantPhrase,
  _recordLeadHandoff: recordLeadHandoff
};
