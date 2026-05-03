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

  const result = await db.query(
    `INSERT INTO contacts (
       user_id, name, email, phone, whatsapp, preferred_contact_channel,
       preferred_language, role_type, location_interest, category_interest,
       budget_range, consent_status, marketing_consent, whatsapp_consent, sms_consent
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
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
      input.smsConsent === true || input.sms_consent === true
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

async function createLead(db, input = {}) {
  if (!db) return null;
  try {
    const contact = await upsertContact(db, input.contact || input);
    const leadType = text(input.leadType || input.lead_type, 'enquiry').toLowerCase();
    const source = text(input.source, 'web').toLowerCase();
    const listingId = input.listingId || input.listing_id || null;
    const budget = integer(input.budget, null);
    const result = await db.query(
      `INSERT INTO leads (
         contact_id, user_id, listing_id, campaign_id, source, lead_type,
         category, location, budget, message, lifecycle_stage, lead_status,
         lead_score, priority, assigned_to_user_id, next_follow_up_at,
         last_contacted_at, sla_status, outcome, lost_reason, metadata
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb)
       RETURNING *`,
      [
        contact?.id || null,
        input.userId || input.user_id || null,
        listingId,
        input.campaignId || input.campaign_id || null,
        source,
        leadType,
        text(input.category) || null,
        text(input.location) || null,
        budget,
        text(input.message) || null,
        text(input.lifecycleStage || input.lifecycle_stage, 'new'),
        text(input.leadStatus || input.lead_status, 'open'),
        integer(input.leadScore || input.lead_score, scoreLead({
          leadType,
          phone: input.contact?.phone || input.phone,
          email: input.contact?.email || input.email,
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
        JSON.stringify(safeJson(input.metadata, {}))
      ]
    );
    const lead = result.rows[0] || null;
    if (lead) {
      await addLeadActivity(db, {
        leadId: lead.id,
        actorUserId: input.actorUserId || input.userId || input.user_id || null,
        actorType: input.actorType || (input.userId || input.user_id ? 'user' : 'system'),
        activityType: input.activityType || `${leadType}_created`,
        message: input.activityMessage || input.message || `Lead created from ${source}`,
        metadata: {
          source,
          lead_type: leadType,
          ...(safeJson(input.metadata, {}))
        }
      });
    }
    return lead;
  } catch (error) {
    if (!isMissingTableError(error)) {
      logger.warn('CRM lead creation failed', {
        source: input.source,
        leadType: input.leadType || input.lead_type,
        error: error.message
      });
    }
    return null;
  }
}

module.exports = {
  addLeadActivity,
  createLead,
  scoreLead,
  upsertContact
};
