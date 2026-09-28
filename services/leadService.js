'use strict';

const logger = require('../config/logger');

function text(value, fallback = '') {
  const cleaned = String(value ?? '').trim();
  return cleaned || fallback;
}

function integer(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const parsed = parseInt(String(value).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeChannel(value) {
  const channel = text(value, 'whatsapp').toLowerCase();
  return ['whatsapp', 'email', 'phone', 'sms', 'in_app'].includes(channel) ? channel : 'whatsapp';
}

function normalizeLanguage(value) {
  const lang = text(value, 'en').toLowerCase();
  return ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm'].includes(lang) ? lang : 'en';
}

function safeJson(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function isMissingTableError(error) {
  return ['42P01', '42703'].includes(error?.code);
}

const crypto = require('crypto');

// Canonical lead statuses. "Open" (still being worked) is the first four.
const LEAD_STATUSES = Object.freeze(['open', 'handed_over', 'contacted', 'qualified', 'won', 'lost', 'spam', 'closed']);
const OPEN_LEAD_STATUSES = Object.freeze(['open', 'handed_over', 'contacted', 'qualified']);
const CLOSED_LEAD_STATUSES = Object.freeze(['won', 'lost', 'spam', 'closed']);
const OPEN_LEAD_STATUS_SQL = `(${OPEN_LEAD_STATUSES.map((s) => `'${s}'`).join(',')})`;
const LEAD_STATUS_ALIASES = Object.freeze({
  new: 'open',
  pending: 'open',
  handedover: 'handed_over',
  'handed over': 'handed_over',
  sent: 'handed_over',
  in_progress: 'contacted',
  converted: 'won',
  closed_won: 'won',
  closed_lost: 'lost',
  junk: 'spam',
  matched_property_available: 'contacted'
});

function normalizeLeadStatus(value, fallback = 'open') {
  const raw = text(value).toLowerCase();
  if (!raw) return fallback;
  if (LEAD_STATUSES.includes(raw)) return raw;
  if (LEAD_STATUS_ALIASES[raw]) return LEAD_STATUS_ALIASES[raw];
  return null;
}

// Last nine digits identify a Ugandan (or most East African) mobile regardless
// of whether it was typed 07.., +2567.. or 2567...
function phoneKey(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : null;
}

const TEST_SOURCE_PATTERN = /(^|_)(qa|test|demo|smoke|soft_launch|launch_proof)(_|$)/i;

function isTestLeadInput(input = {}, source = '') {
  if (input.isTest === true || input.is_test === true) return true;
  if (TEST_SOURCE_PATTERN.test(String(source || ''))) return true;
  const meta = safeJson(input.metadata, {});
  return [meta.launch_proof, meta.is_test].some((value) => ['true', '1', 'yes'].includes(String(value ?? '').toLowerCase()));
}

function leadDedupeHours() {
  const hours = Number(process.env.LEAD_DEDUPE_HOURS || 24);
  return Number.isFinite(hours) && hours >= 0 ? hours : 24;
}

// Lead types that describe one person's interest in one listing or one need.
// Repeats of these inside the window update the original lead.
const DEDUPED_LEAD_TYPES = new Set([
  'enquiry', 'viewing', 'callback', 'property_need', 'property_need_request', 'property_need_unavailable', 'mortgage',
  'off_plan_enquiry', 'short_term_enquiry', 'advertiser', 'marketplace_service_request'
]);

function dedupeGroup(leadType) {
  // A WhatsApp click followed by a form enquiry on the same listing is the
  // same person with the same interest — one lead.
  if (['enquiry', 'viewing', 'callback'].includes(leadType)) return 'listing_interest';
  return leadType;
}

function buildLeadDedupeKey({ leadType, listingId, userId, phone, email, buyerRef, visitorId, location, category }) {
  if (!DEDUPED_LEAD_TYPES.has(leadType)) return null;
  const identity = userId ? `u:${userId}`
    : phoneKey(phone) ? `p:${phoneKey(phone)}`
      : text(email) ? `e:${text(email).toLowerCase()}`
        : text(visitorId) ? `v:${text(visitorId)}`
          : text(buyerRef) ? `r:${text(buyerRef)}`
            : null;
  if (!identity) return null;
  const subject = listingId ? `l:${listingId}` : `n:${text(category).toLowerCase()}|${text(location).toLowerCase()}`;
  return crypto.createHash('sha256').update(`${dedupeGroup(leadType)}|${subject}|${identity}`).digest('hex').slice(0, 40);
}

function scoreLead({ leadType, phone, email, budget, listingId, source } = {}) {
  let score = 10;
  if (phone) score += 15;
  if (email) score += 8;
  if (budget) score += 10;
  if (listingId) score += 10;
  if (['viewing', 'callback', 'mortgage'].includes(text(leadType).toLowerCase())) score += 25;
  if (['whatsapp', 'listing_detail_whatsapp', 'listing_card_whatsapp'].includes(text(source).toLowerCase())) score += 12;
  return Math.min(score, 100);
}

async function upsertContact(db, input = {}) {
  const userId = input.userId || null;
  const email = text(input.email).toLowerCase() || null;
  const phone = text(input.phone) || null;
  const whatsapp = text(input.whatsapp || input.whatsApp || input.phone) || null;
  const name = text(input.name || [input.firstName, input.lastName].filter(Boolean).join(' '), 'Unknown contact');
  const key = phoneKey(whatsapp || phone);

  // Nothing to identify the person by (an anonymous WhatsApp click): no
  // contact record — a row per click was how the CRM filled with ghosts.
  if (!userId && !key && !email) return null;

  // Anonymous enquirers: one person, one contact. Match on phone first, then
  // email, and fill in whatever the new enquiry adds.
  if (!userId && (key || email)) {
    const existing = await db.query(
      `SELECT id FROM contacts
        WHERE user_id IS NULL
          AND (($1::text IS NOT NULL AND phone_key = $1::text) OR ($2::text IS NOT NULL AND LOWER(email) = $2::text))
        ORDER BY ($1::text IS NOT NULL AND phone_key = $1::text) DESC, updated_at DESC
        LIMIT 1`,
      [key, email]
    ).catch((error) => (isMissingTableError(error) ? { rows: [] } : Promise.reject(error)));
    if (existing.rows[0]) {
      const updated = await db.query(
        `UPDATE contacts SET
           name = CASE WHEN $2 <> 'Unknown contact' AND (name IS NULL OR name IN ('Unknown contact', 'WhatsApp contact initiated')) THEN $2 ELSE name END,
           email = COALESCE(email, $3),
           phone = COALESCE(phone, $4),
           whatsapp = COALESCE(whatsapp, $5),
           phone_key = COALESCE(phone_key, $6),
           updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [existing.rows[0].id, name, email, phone, whatsapp, key]
      );
      return updated.rows[0] || null;
    }
  }

  const result = await db.query(
    `INSERT INTO contacts (
       user_id, name, email, phone, whatsapp, preferred_contact_channel,
       preferred_language, role_type, location_interest, category_interest,
       budget_range, consent_status, marketing_consent, whatsapp_consent, sms_consent, phone_key
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (user_id)
     WHERE user_id IS NOT NULL
     DO UPDATE SET
       name = COALESCE(NULLIF(EXCLUDED.name, 'Unknown contact'), contacts.name),
       email = COALESCE(EXCLUDED.email, contacts.email),
       phone = COALESCE(EXCLUDED.phone, contacts.phone),
       whatsapp = COALESCE(EXCLUDED.whatsapp, contacts.whatsapp),
       preferred_contact_channel = EXCLUDED.preferred_contact_channel,
       preferred_language = EXCLUDED.preferred_language,
       role_type = COALESCE(NULLIF(EXCLUDED.role_type, 'unknown'), contacts.role_type),
       location_interest = COALESCE(EXCLUDED.location_interest, contacts.location_interest),
       category_interest = COALESCE(EXCLUDED.category_interest, contacts.category_interest),
       budget_range = COALESCE(EXCLUDED.budget_range, contacts.budget_range),
       consent_status = EXCLUDED.consent_status,
       marketing_consent = EXCLUDED.marketing_consent,
       whatsapp_consent = EXCLUDED.whatsapp_consent,
       sms_consent = EXCLUDED.sms_consent,
       phone_key = COALESCE(EXCLUDED.phone_key, contacts.phone_key),
       updated_at = NOW()
     RETURNING *`,
    [
      userId,
      name,
      email,
      phone,
      whatsapp,
      normalizeChannel(input.preferredContactChannel || input.preferred_contact_channel),
      normalizeLanguage(input.preferredLanguage || input.preferred_language),
      text(input.roleType || input.role_type, 'unknown').toLowerCase(),
      text(input.locationInterest || input.location_interest) || null,
      text(input.categoryInterest || input.category_interest) || null,
      text(input.budgetRange || input.budget_range) || null,
      text(input.consentStatus || input.consent_status, 'unknown'),
      input.marketingConsent === true || input.marketing_consent === true,
      input.whatsappConsent === true || input.whatsapp_consent === true,
      input.smsConsent === true || input.sms_consent === true,
      key
    ]
  );

  return result.rows[0] || null;
}

async function addLeadActivity(db, input = {}) {
  if (!input.leadId) return null;
  const result = await db.query(
    `INSERT INTO lead_activities (
       lead_id, actor_user_id, actor_type, activity_type, message,
       old_status, new_status, metadata
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     RETURNING *`,
    [
      input.leadId,
      input.actorUserId || null,
      text(input.actorType, 'system'),
      text(input.activityType, 'note'),
      text(input.message) || null,
      text(input.oldStatus) || null,
      text(input.newStatus) || null,
      JSON.stringify(safeJson(input.metadata, {}))
    ]
  );
  return result.rows[0] || null;
}

async function findRecentDuplicateLead(db, dedupeKey) {
  if (!dedupeKey) return null;
  const hours = leadDedupeHours();
  if (!hours) return null;
  const result = await db.query(
    `SELECT * FROM leads
      WHERE dedupe_key = $1
        AND created_at >= NOW() - ($2 || ' hours')::interval
      ORDER BY created_at DESC
      LIMIT 1`,
    [dedupeKey, String(hours)]
  );
  return result.rows[0] || null;
}

function submittedContactOf(input = {}) {
  // What the person typed into THIS submission — the only contact details a
  // lister or agent is shown. Never the merged contact record.
  if (input.explicitContact !== true) return null;
  const c = input.contact || input;
  const snapshot = {
    name: text(c.name) || null,
    phone: text(c.phone || c.whatsapp) || null,
    email: text(c.email).toLowerCase() || null
  };
  return snapshot.name || snapshot.phone || snapshot.email ? snapshot : null;
}

const LEAD_TYPE_RANK = Object.freeze({ enquiry: 1, callback: 2, viewing: 3 });

async function recordRepeatOnLead(db, lead, input = {}, { source, leadType }) {
  const message = text(input.message);
  const previousType = text(lead.lead_type).toLowerCase();
  const upgradesType = (LEAD_TYPE_RANK[leadType] || 0) > (LEAD_TYPE_RANK[previousType] || 0) && previousType in LEAD_TYPE_RANK;
  const isClickMessage = /^WhatsApp contact initiated/i.test(message);
  const newMessage = Boolean(message) && !isClickMessage && message !== text(lead.message);
  const channel = text(input.channel) || null;
  const submitted = submittedContactOf(input);
  const metadataPatch = {
    ...safeJson(input.metadata, {}),
    ...(submitted ? { submitted_contact: { ...(safeJson(lead.metadata, {}).submitted_contact || {}), ...Object.fromEntries(Object.entries(submitted).filter(([, v]) => v)) } } : {})
  };
  const updated = await db.query(
    `UPDATE leads SET
       repeat_count = repeat_count + 1,
       last_repeat_at = NOW(),
       -- A form enquiry after a bare WhatsApp click carries the real message.
       message = CASE WHEN $2::text IS NOT NULL THEN $2 ELSE message END,
       -- A viewing or callback request outranks a plain enquiry.
       lead_type = CASE WHEN $3::boolean THEN $4 ELSE lead_type END,
       -- A form, viewing or bot enquiry after a click is no longer "just a click".
       channel = CASE WHEN COALESCE(channel, '') = 'whatsapp' AND $5::text IS NOT NULL AND $5::text <> 'whatsapp' THEN $5 ELSE COALESCE(channel, $5) END,
       contact_id = COALESCE(contact_id, $6),
       metadata = COALESCE(metadata, '{}'::jsonb) || $7::jsonb,
       lead_status = CASE WHEN lead_status IN ('lost', 'closed') THEN 'open' ELSE lead_status END,
       updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [lead.id, newMessage ? message : null, upgradesType, leadType, channel, input._contactId || null, JSON.stringify(metadataPatch)]
  );
  const row = updated.rows[0] || lead;
  await addLeadActivity(db, {
    leadId: row.id,
    actorType: 'system',
    activityType: 'repeat_enquiry',
    message: `Same person again via ${source}${newMessage ? `: ${message.slice(0, 200)}` : ''}`,
    metadata: { source, lead_type: leadType, ...(safeJson(input.metadata, {})) }
  });
  // Something the lister has not been told yet: a viewing/callback on top of an
  // enquiry, or a new written message. Callers hand these off again.
  return { ...row, _isRepeat: true, _hasNewForLister: upgradesType || newMessage, _upgradedType: upgradesType };
}

/**
 * The single way a lead enters the CRM.
 *
 * Returns the lead row. When the same person has already asked about the same
 * listing (or need) inside LEAD_DEDUPE_HOURS, the existing lead is updated and
 * returned with `_isRepeat: true` — callers use that to avoid notifying the
 * lister twice and to keep billable counts honest.
 *
 * Never throws: a CRM failure must not break the public form that called it.
 */
async function createLead(db, input = {}) {
  if (!db) return null;
  try {
    const contactInput = input.contact || input;
    const contact = await upsertContact(db, contactInput);
    const leadType = text(input.leadType || input.lead_type, 'enquiry').toLowerCase();
    const source = text(input.source, 'web').toLowerCase();
    const listingId = input.listingId || input.listing_id || null;
    const agentId = input.agentId || input.agent_id || null;
    const userId = input.userId || input.user_id || null;
    const phone = contactInput.phone || contactInput.whatsapp || input.phone || null;
    const email = contactInput.email || input.email || null;
    const buyerRef = text(input.buyerRef || input.buyer_ref || phone || email) || null;
    const isTest = isTestLeadInput(input, source);
    const budget = integer(input.budget, null);
    const status = normalizeLeadStatus(input.leadStatus || input.lead_status, 'open') || 'open';
    const dedupeKey = input.dedupe === false ? null : buildLeadDedupeKey({
      leadType,
      listingId,
      userId,
      phone,
      email,
      buyerRef,
      visitorId: input.visitorId || input.visitor_id,
      location: input.location,
      category: input.category
    });

    const duplicate = await findRecentDuplicateLead(db, dedupeKey);
    if (duplicate) {
      return recordRepeatOnLead(db, duplicate, { ...input, _contactId: contact?.id || null }, { source, leadType });
    }

    // Billable means a buyer lead for an agent's listing — never a test, never
    // the agent's own listing submission.
    const billable = !isTest && (input.billable === true || input.billable === 'true');
    const charged = input.charged === true || input.charged === 'true';
    const result = await db.query(
      `INSERT INTO leads (
         contact_id, user_id, listing_id, agent_id, buyer_ref, campaign_id, source, lead_type,
         category, location, budget, message, lifecycle_stage, lead_status,
         lead_score, priority, assigned_to_user_id, next_follow_up_at,
         last_contacted_at, sla_status, outcome, lost_reason, billable, charged, metered_at, metadata,
         dedupe_key, is_test, channel, dedupe_day
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,NOW(),$25::jsonb,$26,$27,$28,
               CASE WHEN $26::text IS NULL THEN NULL ELSE (NOW() AT TIME ZONE 'UTC')::date END)
       ON CONFLICT (dedupe_key, dedupe_day) WHERE dedupe_key IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        contact?.id || null,
        userId,
        listingId,
        agentId,
        buyerRef,
        input.campaignId || input.campaign_id || null,
        source,
        leadType,
        text(input.category) || null,
        text(input.location) || null,
        budget,
        text(input.message) || null,
        text(input.lifecycleStage || input.lifecycle_stage, 'new'),
        status,
        integer(input.leadScore || input.lead_score, scoreLead({
          leadType,
          phone,
          email,
          budget,
          listingId,
          source
        })),
        text(input.priority, 'normal'),
        input.assignedToUserId || input.assigned_to_user_id || null,
        input.nextFollowUpAt || input.next_follow_up_at || null,
        input.lastContactedAt || input.last_contacted_at || null,
        text(input.slaStatus || input.sla_status, 'open'),
        text(input.outcome) || null,
        text(input.lostReason || input.lost_reason) || null,
        billable,
        charged,
        JSON.stringify({
          ...safeJson(input.metadata, {}),
          ...(submittedContactOf(input) ? { submitted_contact: submittedContactOf(input) } : {}),
          metering: {
            source,
            listing_id: listingId,
            agent_id: agentId,
            buyer_ref: buyerRef,
            billable,
            charged
          }
        }),
        dedupeKey,
        isTest,
        text(input.channel || contactInput.preferredContactChannel || contactInput.preferred_contact_channel) || null
      ]
    );
    const lead = result.rows[0] || null;
    if (!lead && dedupeKey) {
      // Lost a race with an identical submission a moment ago: that one is the lead.
      const winner = await findRecentDuplicateLead(db, dedupeKey);
      if (winner) return recordRepeatOnLead(db, winner, { ...input, _contactId: contact?.id || null }, { source, leadType });
    }
    if (lead) {
      await addLeadActivity(db, {
        leadId: lead.id,
        actorUserId: input.actorUserId || userId,
        actorType: input.actorType || (userId ? 'user' : 'system'),
        activityType: input.activityType || `${leadType}_created`,
        message: input.activityMessage || input.message || `Lead created from ${source}`,
        metadata: {
          source,
          lead_type: leadType,
          ...(safeJson(input.metadata, {}))
        }
      });
    }
    return lead ? { ...lead, _isRepeat: false } : null;
  } catch (error) {
    // Always loud: a missing column here (migration not applied) would
    // otherwise lose every lead in silence.
    logger.error('CRM lead creation failed', {
      source: input.source,
      leadType: input.leadType || input.lead_type,
      code: error.code || null,
      error: error.message
    });
    return null;
  }
}

/**
 * Record what makaug did with a lead: sent to the lister, queued on the
 * WhatsApp bridge, contact shown only, or failed. Moves an open lead to
 * handed_over when it actually went somewhere.
 */
async function recordLeadHandoff(db, leadId, { status, detail = {} } = {}) {
  if (!db || !leadId || !status) return null;
  try {
    const delivered = ['sent', 'queued', 'simulated', 'contact_shown'].includes(status);
    const result = await db.query(
      `UPDATE leads SET
         handoff_status = $2,
         handoff_at = NOW(),
         handoff_detail = COALESCE(handoff_detail, '{}'::jsonb) || $3::jsonb,
         lead_status = CASE WHEN $4 AND lead_status = 'open' THEN 'handed_over' ELSE lead_status END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [leadId, status, JSON.stringify(safeJson(detail, {})), delivered]
    );
    await addLeadActivity(db, {
      leadId,
      actorType: 'system',
      activityType: `handoff_${status}`,
      message: detail.summary || `Lead handoff: ${status}`,
      newStatus: delivered ? 'handed_over' : null,
      metadata: detail
    });
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Lead handoff record failed', { leadId, status, error: error.message });
    return null;
  }
}

module.exports = {
  CLOSED_LEAD_STATUSES,
  LEAD_STATUSES,
  OPEN_LEAD_STATUSES,
  OPEN_LEAD_STATUS_SQL,
  addLeadActivity,
  buildLeadDedupeKey,
  createLead,
  isTestLeadInput,
  normalizeLeadStatus,
  phoneKey,
  recordLeadHandoff,
  scoreLead,
  upsertContact
};
