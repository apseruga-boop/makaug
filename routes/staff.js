const express = require('express');

const db = require('../config/database');
const logger = require('../config/logger');
const { requireStaffAccess } = require('../middleware/auth');
const { cleanText } = require('../middleware/validation');
const { parsePagination, toPagination } = require('../utils/pagination');
const { DISTRICTS, LISTING_TYPES } = require('../utils/constants');
const { publicLivePropertyStatusSql } = require('../utils/publicInventoryStatus');
const {
  districtForKnownArea,
  normalizeReviewLocationHierarchy,
  regionForDistrict
} = require('../utils/ugandaLocationHierarchy');
const { addLeadActivity } = require('../services/leadService');
const { getProviderClient, getProviderMeta, getTaskModel } = require('../services/llmProvider');
const {
  SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
  importExactSocialSourcePosts,
  runSocialPlatformPostSweep
} = require('../services/socialPlatformPostDiscoveryService');

const router = express.Router();

router.use(requireStaffAccess);

const PENDING_REVIEW_STATUSES = ['pending', 'pending_review', 'test_pending_review', 'pending_review_hidden', 'draft', 'submitted', 'in_review', 'under_review'];
const FINAL_REVIEW_STATUSES = ['approved', 'live', 'published', 'sold', 'hidden', 'deleted', 'rejected', 'declined', 'fraud', 'archived'];
const OPEN_LEAD_STATUSES = ['open', 'new', 'contacted', 'qualified'];
const OPEN_AD_STATUSES = ['new', 'contacted', 'proposal_sent'];
const STAFF_CONTACT_EXPORT_LIMIT = 50;

function boolLike(value) {
  return ['true', '1', 'yes', 'y', 'on'].includes(String(value || '').trim().toLowerCase());
}

function safeJsonObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function normalizePhoneLite(value) {
  const raw = cleanText(value);
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('256')) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 10) return `+256${digits.slice(1)}`;
  if (digits.length === 9) return `+256${digits}`;
  return raw.startsWith('+') ? raw : `+${digits}`;
}

function toNullableInt(value) {
  if (value == null || value === '') return null;
  const n = parseInt(String(value).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function toNullableFloat(value) {
  if (value == null || value === '') return null;
  const n = parseFloat(String(value).replace(/,/g, '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function firstNonEmpty(...values) {
  return values.map((value) => cleanText(value)).find(Boolean) || '';
}

function staffMetricDefinitions() {
  return {
    total_properties: {
      label: 'Total Properties',
      meaning: 'Every property record in makaug, across live, pending, rejected, hidden, and source-imported records.',
      action: 'Use this to understand total stock. Staff normally work pending review and live follow-up, not deleted/system records.'
    },
    pending_review: {
      label: 'Pending Review',
      meaning: 'Listings not public yet because they still need staff or King moderation.',
      action: 'Open Preview & edit, confirm location/contact/photos/duplicates, then approve live or reject with a reason.'
    },
    my_approvals: {
      label: 'My Approvals',
      meaning: 'Listings this staff account personally approved through the real publish route.',
      action: 'Use this to track your daily contribution. King can audit each approval in moderation history.'
    },
    open_leads: {
      label: 'Open Leads',
      meaning: 'People who asked for property help or listing follow-up and have not been closed.',
      action: 'Claim the lead, call or WhatsApp the person, add a note, then update status after contact.'
    },
    ad_leads: {
      label: 'Ad Leads',
      meaning: 'Businesses or agents interested in paid makaug advertising space.',
      action: 'Claim, contact, record target area/package/budget, then move to proposal sent.'
    },
    whatsapp_human: {
      label: 'WhatsApp Needs Human',
      meaning: 'WhatsApp conversations where AI or routing marked human follow-up as needed.',
      action: 'Open the chat, answer the customer, then add notes or move related leads forward.'
    },
    source_duplicates: {
      label: 'Possible Duplicates',
      meaning: 'Pending rows that match another listing by phone, title, address, price/location, or exact social source URL.',
      action: 'Do not approve until you compare the duplicate warning and decide whether to merge, reject, or keep pending.'
    },
    bank_leads: {
      label: 'Bank / Mortgage Leads',
      meaning: 'People who used mortgage, affordability, or bank-finance flows.',
      action: 'Contact with the approved mortgage script and capture which bank/product they need.'
    }
  };
}

function sqlList(values = []) {
  return values.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(', ');
}

function pendingReviewWhere(alias = 'p') {
  const prefix = alias ? `${alias}.` : '';
  return `
    LOWER(COALESCE(${prefix}status, '')) NOT IN (${sqlList(FINAL_REVIEW_STATUSES)})
    AND (
      LOWER(COALESCE(${prefix}status, '')) IN (${sqlList(PENDING_REVIEW_STATUSES)})
      OR LOWER(COALESCE(${prefix}moderation_stage, '')) IN (${sqlList(PENDING_REVIEW_STATUSES)})
    )
  `;
}

function actorId(req) {
  return req.userAuth?.id || req.staffAuth?.userId || null;
}

function staffProfile(user = {}) {
  return user.profile_data && typeof user.profile_data === 'object' && !Array.isArray(user.profile_data)
    ? user.profile_data
    : {};
}

function publicStaffUser(user = {}) {
  const profile = staffProfile(user);
  const paymentProfile = safeJsonObject(profile.payment_profile, {});
  const channelAccess = profile.channel_access && typeof profile.channel_access === 'object' && !Array.isArray(profile.channel_access)
    ? profile.channel_access
    : {
      listings: true,
      leads: true,
      advertising: true,
      whatsapp: true,
      social_media: true,
      ai_assistant: true
    };
  const permissions = profile.permissions && typeof profile.permissions === 'object' && !Array.isArray(profile.permissions)
    ? profile.permissions
    : {
      listing_moderation: true,
      lead_generation: true,
      advertising_sales: true,
      whatsapp_conversations: true,
      training_library: true,
      ai_assistant: true,
      financial_admin: false,
      user_admin: false,
      system_settings: false
    };
  return {
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    preferred_contact_channel: user.preferred_contact_channel || 'whatsapp',
    preferred_language: user.preferred_language || 'en',
    staff_code: profile.staff_code || profile.employee_number || '',
    personal_email: profile.personal_email || '',
    payment_profile: {
      simba_account: firstNonEmpty(paymentProfile.simba_account, profile.simba_account, profile.simba_pay_id),
      payment_provider: firstNonEmpty(paymentProfile.payment_provider, profile.payment_provider, profile.mobile_money_provider, 'mobile_money'),
      mobile_money_name: firstNonEmpty(paymentProfile.mobile_money_name, profile.mobile_money_name),
      mobile_money_phone: firstNonEmpty(paymentProfile.mobile_money_phone, profile.mobile_money_phone, user.phone),
      bank_name: firstNonEmpty(paymentProfile.bank_name, profile.bank_name),
      bank_account_name: firstNonEmpty(paymentProfile.bank_account_name, profile.bank_account_name),
      bank_account_last4: firstNonEmpty(paymentProfile.bank_account_last4, profile.bank_account_last4),
      payout_notes: firstNonEmpty(paymentProfile.payout_notes, profile.payout_notes)
    },
    channel_access: channelAccess,
    permissions
  };
}

function safeNumber(row, key) {
  return Number(row?.[key] || 0) || 0;
}

async function safeOne(sql, params = [], fallback = {}) {
  try {
    const result = await db.query(sql, params);
    return result.rows[0] || fallback;
  } catch (error) {
    if (!['42P01', '42703'].includes(error.code)) {
      logger.warn('Staff dashboard query failed', { message: error.message });
    }
    return fallback;
  }
}

async function safeRows(sql, params = []) {
  try {
    const result = await db.query(sql, params);
    return result.rows;
  } catch (error) {
    if (!['42P01', '42703'].includes(error.code)) {
      logger.warn('Staff dashboard rows query failed', { message: error.message });
    }
    return [];
  }
}

async function logStaffActivity(req, action, { targetType = null, targetId = null, metadata = {} } = {}) {
  const staffUserId = actorId(req);
  const payload = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  await db.query(
    `INSERT INTO staff_activity_logs (staff_user_id, action, target_type, target_id, metadata)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [staffUserId, action, targetType, targetId ? String(targetId) : null, JSON.stringify(payload)]
  ).catch(async (error) => {
    if (!['42P01', '42703'].includes(error.code)) throw error;
    await db.query(
      `INSERT INTO audit_logs (actor_id, action, details)
       VALUES ($1,$2,$3::jsonb)`,
      [staffUserId || 'staff_user', action, JSON.stringify({ target_type: targetType, target_id: targetId, ...payload })]
    ).catch(() => {});
  });
}

function trainingGuide() {
  return {
    moderation: {
      goal: 'Only accurate, contactable, non-duplicate listings should go live.',
      steps: [
        'Open Preview & edit before any approval. Do not approve from the queue card.',
        'Confirm location from strongest evidence first: address/map pin, source caption, phone conversation, then extracted area.',
        'Fix hierarchy before saving: Nansana belongs to Wakiso, Masindi belongs to Masindi, Arua City/Pokea belongs to Arua.',
        'Check title, listing type, property type, price, title type, contact number, description, image rights, and duplicate warnings.',
        'Approve only after preview is saved. Reject when ownership, contact path, source evidence, or location cannot be confirmed.'
      ]
    },
    source_intake: {
      goal: 'Bring TikTok, YouTube, Facebook, X/Twitter, student housing, and WhatsApp source leads into one shared queue without duplicates.',
      steps: [
        'Paste exact post/video links or copied source text into Source intake.',
        'Preview first. The preview shows how many rows are new, existing, duplicates, source-review only, or queue-ready.',
        'Queue only exact property posts with a location, source/contact route, and usable evidence. Source pages alone stay in source review.',
        'After queueing, all staff see the same moderation queue. Whoever cleans it first should save notes so nobody duplicates work.',
        'If a duplicate warning appears, compare source URL, title, phone, area, price, and image evidence before publishing.'
      ]
    },
    leads: {
      goal: 'Turn customer demand into a contacted lead, then into a viewing, broker handoff, or saved requirement.',
      steps: [
        'Open leads with high priority, overdue status, or WhatsApp no-match first.',
        'Claim means the lead is assigned to you and marked contacted. Add a note after every call or WhatsApp.',
        'Ask for desired location, budget, property type, timing, and whether they want rent, sale, land, student, commercial, or bank finance.',
        'Match customers to approved live listings only. Never promise a pending listing is available.',
        'Close only after outcome is known: contacted, qualified, lost, or handed to King/admin.'
      ]
    },
    advertising: {
      goal: 'Sell makaug advertising space while keeping payment confirmation with King/admin.',
      steps: [
        'Record business name, phone, target district/area, product interest, package, budget, and next follow-up.',
        'Available products: sponsored search space, student page space, land/commercial placements, broker spotlight, WhatsApp sponsored matches, and homepage/category slots.',
        'Move to contacted after first call, proposal_sent after package/price is sent, and won only when King/admin confirms payment proof.',
        'Do not mark paid, discount, or refund from staff dashboard.'
      ]
    },
    whatsapp: {
      goal: 'Make WhatsApp conversations human-readable and actioned quickly.',
      steps: [
        'Open conversations marked needs_human, escalated, hot, or open with recent customer messages.',
        'Use the WhatsApp link to respond, then create or update the matching lead/listing note.',
        'Escalate fraud, deposit, payment, legal, abuse, or safety questions to King/admin.',
        'If AI gave no results, capture the customer requirement and create a lead instead of leaving the chat idle.'
      ]
    },
    bank_leads: {
      goal: 'Capture mortgage and bank-finance demand for follow-up and future lender partnerships.',
      steps: [
        'Ask property price, deposit available, term length, household income range, preferred bank, and target area.',
        'Do not promise approval. Explain that makaug records the request and prepares the bank/mortgage callback path.',
        'Tag the lead as mortgage/bank finance and add next follow-up.'
      ]
    },
    scripts: {
      goal: 'Keep staff responses consistent.',
      steps: [
        'Listing check: Hello, this is makaug.com. I am checking your property so we only publish accurate information. Please confirm exact area, district, price, contact number, and image permission.',
        'Buyer lead: Hello, this is makaug.com. I saw your property request. Which area, budget, property type, and timeline should I use to match you with live listings?',
        'Advertising: makaug can place sponsored space across search, student pages, land/commercial pages, broker spotlight, and WhatsApp sponsored matches. Which area and budget should we prepare?',
        'Bank lead: makaug can record your mortgage or bank-finance request. Please share property price, deposit, term, income range, and preferred bank if any.'
      ]
    },
    videos: [
      { title: 'Moderation walkthrough', url: '/assets/docs/field-agent/makaug-field-agent-training-deck.pptx' },
      { title: 'Field agent welcome pack', url: '/assets/docs/field-agent/makaug-field-agent-welcome-pack.pptx' }
    ]
  };
}

async function dashboardPayload(req) {
  const staffId = actorId(req);
  const [
    listingSummary,
    myModeration,
    leadSummary,
    adSummary,
    whatsappSummary,
    recentActivity,
    reviewRows,
    leadRows,
    adRows,
    whatsappRows,
    sourceSummary,
    duplicateSummary,
    sourceRows,
    sourceQueueRows,
    mortgageSummary,
    mortgageRows,
    paymentSummary
  ] = await Promise.all([
    safeOne(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE ${pendingReviewWhere('p')})::int AS pending_review,
         COUNT(*) FILTER (WHERE ${publicLivePropertyStatusSql('p')})::int AS live,
         COUNT(*) FILTER (WHERE LOWER(COALESCE(p.status, '')) = 'rejected')::int AS rejected,
         COUNT(*) FILTER (WHERE COALESCE(p.extra_fields->>'found_online', p.extra_fields->>'found_online_candidate', p.extra_fields->>'social_search_candidate', '') ~* '^(true|1|yes)$')::int AS found_online,
         COUNT(*) FILTER (WHERE LOWER(COALESCE(p.source, p.listed_via, '')) IN ('website','web'))::int AS website_submitted
       FROM properties p`,
      [],
      { total: 0, pending_review: 0, live: 0, rejected: 0, found_online: 0, website_submitted: 0 }
    ),
    safeOne(
      `SELECT
         COUNT(*)::int AS total_actions,
         COUNT(*) FILTER (WHERE status_to IN ('approved','live','published'))::int AS approvals,
         COUNT(*) FILTER (WHERE status_to = 'rejected')::int AS rejections,
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 day')::int AS actions_24h
       FROM property_moderation_events
       WHERE actor_id = $1`,
      [staffId],
      { total_actions: 0, approvals: 0, rejections: 0, actions_24h: 0 }
    ),
    safeOne(
      `SELECT
         COUNT(*) FILTER (WHERE lead_status = ANY($1::text[]))::int AS open,
         COUNT(*) FILTER (WHERE assigned_to_user_id = $2)::int AS assigned_to_me,
         COUNT(*) FILTER (WHERE priority IN ('high','urgent') OR lead_score >= 50)::int AS hot,
         COUNT(*) FILTER (WHERE next_follow_up_at < NOW() AND lead_status = 'open')::int AS overdue
       FROM leads`,
      [OPEN_LEAD_STATUSES, staffId],
      { open: 0, assigned_to_me: 0, hot: 0, overdue: 0 }
    ),
    safeOne(
      `SELECT
         COUNT(*) FILTER (WHERE status = ANY($1::text[]))::int AS open_inquiries,
         COUNT(*) FILTER (WHERE assigned_to_user_id = $2)::int AS assigned_to_me,
         COUNT(*) FILTER (WHERE status = 'won')::int AS won_inquiries,
         COALESCE(SUM(estimated_value_ugx) FILTER (WHERE status IN ('proposal_sent','won')), 0)::bigint AS staff_visible_pipeline_ugx
       FROM advertising_inquiries`,
      [OPEN_AD_STATUSES, staffId],
      { open_inquiries: 0, assigned_to_me: 0, won_inquiries: 0, staff_visible_pipeline_ugx: 0 }
    ),
    safeOne(
      `SELECT
         COUNT(*) FILTER (WHERE status IN ('needs_human','escalated'))::int AS needs_human,
         COUNT(*) FILTER (WHERE status = 'open')::int AS open,
         COUNT(*) FILTER (WHERE assigned_to = $1)::int AS assigned_to_me
       FROM whatsapp_conversation_state`,
      [staffId],
      { needs_human: 0, open: 0, assigned_to_me: 0 }
    ),
    safeRows(
      `SELECT id, action, target_type, target_id, metadata, created_at
       FROM staff_activity_logs
       WHERE staff_user_id = $1
       ORDER BY created_at DESC
       LIMIT 25`,
      [staffId]
    ),
    safeRows(
      `SELECT p.id, p.title, p.description, p.listing_type, p.property_type, p.district, p.area, p.address,
              p.price, p.price_period, p.bedrooms, p.bathrooms, p.title_type,
              p.status, p.moderation_stage, p.moderation_reason, p.created_at, p.updated_at,
              p.inquiry_reference, p.lister_name, p.lister_phone, p.lister_email, p.source, p.listed_via,
              p.extra_fields,
              COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'tiktok_url', p.extra_fields->>'youtube_url', p.extra_fields->>'video_url') AS source_url,
              COALESCE(p.extra_fields->>'source_platform', p.extra_fields->>'source_badge', p.source, p.listed_via) AS source_platform,
              COALESCE(dup.duplicate_count, 0)::int AS duplicate_count,
              img.url AS primary_image_url
       FROM properties p
       LEFT JOIN LATERAL (
         SELECT url FROM property_images i WHERE i.property_id = p.id ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC LIMIT 1
       ) img ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS duplicate_count
         FROM properties d
         WHERE d.id <> p.id
           AND (
             (COALESCE(p.lister_phone, '') <> '' AND d.lister_phone = p.lister_phone)
             OR LOWER(COALESCE(d.title, '')) = LOWER(COALESCE(p.title, ''))
             OR (
               COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', '') <> ''
               AND COALESCE(d.extra_fields->>'source_url', d.extra_fields->>'source_post_url', '') = COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', '')
             )
             OR (
               COALESCE(p.area, '') <> ''
               AND COALESCE(p.district, '') <> ''
               AND LOWER(COALESCE(d.area, '')) = LOWER(COALESCE(p.area, ''))
               AND d.district = p.district
               AND COALESCE(d.price, 0) = COALESCE(p.price, 0)
             )
           )
       ) dup ON true
       WHERE ${pendingReviewWhere('p')}
       ORDER BY COALESCE(dup.duplicate_count, 0) DESC, COALESCE(p.updated_at, p.created_at) DESC
       LIMIT 30`
    ),
    safeRows(
      `SELECT l.*, c.name AS contact_name, c.phone AS contact_phone, c.email AS contact_email, c.whatsapp AS contact_whatsapp, p.title AS listing_title
       FROM leads l
       LEFT JOIN contacts c ON c.id = l.contact_id
       LEFT JOIN properties p ON p.id = l.listing_id
       WHERE l.assigned_to_user_id = $1 OR l.lead_status = ANY($2::text[])
       ORDER BY CASE WHEN l.assigned_to_user_id = $1 THEN 0 ELSE 1 END, l.created_at DESC
       LIMIT 20`,
      [staffId, OPEN_LEAD_STATUSES]
    ),
    safeRows(
      `SELECT id, full_name, business_name, email, phone, product_interests, target_locations,
              target_listing_types, budget_ugx, status, estimated_value_ugx, assigned_to_user_id,
              internal_notes, created_at, updated_at
       FROM advertising_inquiries
       WHERE assigned_to_user_id = $1 OR status = ANY($2::text[])
       ORDER BY CASE WHEN assigned_to_user_id = $1 THEN 0 ELSE 1 END, created_at DESC
       LIMIT 20`,
      [staffId, OPEN_AD_STATUSES]
    ),
    safeRows(
      `SELECT phone, status, category, priority, assigned_to, latest_preview, last_intent, preferred_language,
              last_message_at, last_inbound_at, last_outbound_at, last_ai_reply_at, last_human_reply_at,
              metadata, updated_at
       FROM whatsapp_conversation_state
       WHERE assigned_to = $1 OR status IN ('needs_human','escalated','open')
       ORDER BY COALESCE(last_message_at, updated_at) DESC
       LIMIT 20`,
      [staffId]
    ),
    safeOne(
      `SELECT
         COUNT(*)::int AS total_sources,
         COUNT(*) FILTER (WHERE status = 'active')::int AS active_sources,
         COUNT(*) FILTER (WHERE platform ILIKE 'tiktok')::int AS tiktok_sources,
         COUNT(*) FILTER (WHERE platform ILIKE 'youtube')::int AS youtube_sources,
         COUNT(*) FILTER (WHERE platform ILIKE 'facebook')::int AS facebook_sources,
         COUNT(*) FILTER (WHERE platform ILIKE 'x' OR platform ILIKE 'twitter')::int AS x_sources,
         COUNT(*) FILTER (WHERE can_contact_directly = true)::int AS direct_contact_sources
       FROM property_source_registry`,
      [],
      { total_sources: 0, active_sources: 0, tiktok_sources: 0, youtube_sources: 0, facebook_sources: 0, x_sources: 0, direct_contact_sources: 0 }
    ),
    safeOne(
      `WITH pending AS (
         SELECT p.id, p.title, p.area, p.district, p.price, p.lister_phone, p.extra_fields
         FROM properties p
         WHERE ${pendingReviewWhere('p')}
       )
       SELECT COUNT(*)::int AS possible_duplicates
       FROM pending p
       WHERE EXISTS (
         SELECT 1
         FROM properties d
         WHERE d.id <> p.id
           AND (
             (COALESCE(p.lister_phone, '') <> '' AND d.lister_phone = p.lister_phone)
             OR LOWER(COALESCE(d.title, '')) = LOWER(COALESCE(p.title, ''))
             OR (
               COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', '') <> ''
               AND COALESCE(d.extra_fields->>'source_url', d.extra_fields->>'source_post_url', '') = COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', '')
             )
           )
       )`,
      [],
      { possible_duplicates: 0 }
    ),
    safeRows(
      `SELECT id, source_name, platform, source_type, source_url, handle, contact_phone, contact_phone_alt,
              contact_email, districts, listing_types, status, trust_level, consent_status, scrape_policy,
              can_contact_directly, last_seen_at, last_checked_at, notes
       FROM property_source_registry
       ORDER BY COALESCE(last_seen_at, last_checked_at, created_at) DESC
       LIMIT 12`
    ),
    safeRows(
      `SELECT p.id, p.title, p.area, p.district, p.status, p.updated_at,
              COALESCE(p.extra_fields->>'source_platform', p.source, p.listed_via) AS platform,
              COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'youtube_url', p.extra_fields->>'tiktok_url') AS source_url,
              p.lister_phone,
              COALESCE(p.extra_fields->>'source_name', p.lister_name, 'Found online') AS source_name
       FROM properties p
       WHERE ${pendingReviewWhere('p')}
         AND (
           COALESCE(p.extra_fields->>'found_online', p.extra_fields->>'found_online_candidate', p.extra_fields->>'social_search_candidate', '') ~* '^(true|1|yes)$'
           OR COALESCE(p.extra_fields->>'source_url', p.extra_fields->>'source_post_url', p.extra_fields->>'youtube_url', p.extra_fields->>'tiktok_url', '') <> ''
         )
       ORDER BY COALESCE(p.updated_at, p.created_at) DESC
       LIMIT 12`
    ),
    safeOne(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS last_7_days,
         COUNT(*) FILTER (WHERE user_phone IS NOT NULL AND user_phone <> '')::int AS with_phone
       FROM mortgage_enquiries`,
      [],
      { total: 0, last_7_days: 0, with_phone: 0 }
    ),
    safeRows(
      `SELECT id, user_phone, property_price, property_purpose, deposit_percent, term_years,
              household_income, payload, created_at
       FROM mortgage_enquiries
       ORDER BY created_at DESC
       LIMIT 20`
    ),
    safeOne(
      `SELECT
         (SELECT COUNT(*)::int FROM payment_links WHERE status IN ('created','pending','sent')) AS open_payment_links,
         (SELECT COUNT(*)::int FROM invoices WHERE status IN ('draft','sent','unpaid','pending')) AS open_invoices,
         (SELECT COUNT(*)::int FROM invoices WHERE status = 'paid') AS paid_invoices
       `,
      [],
      { open_payment_links: 0, open_invoices: 0, paid_invoices: 0 }
    )
  ]);

  return {
    staff: publicStaffUser(req.userAuth),
    summary: {
      listings: listingSummary,
      my_moderation: myModeration,
      leads: leadSummary,
      advertising: adSummary,
      whatsapp: whatsappSummary,
      sources: sourceSummary,
      duplicates: duplicateSummary,
      bank_leads: mortgageSummary,
      payments: paymentSummary,
      definitions: staffMetricDefinitions()
    },
    review_queue: reviewRows,
    leads: leadRows,
    advertising_inquiries: adRows,
    whatsapp_conversations: whatsappRows,
    source_intake: {
      batch_id: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
      summary: sourceSummary,
      possible_duplicates: safeNumber(duplicateSummary, 'possible_duplicates'),
      source_registry: sourceRows,
      queued_found_online: sourceQueueRows,
      exact_import_endpoint: '/api/staff/source-intake/exact-social/import',
      sweep_endpoint: '/api/staff/source-intake/social-sweep'
    },
    bank_leads: {
      summary: mortgageSummary,
      rows: mortgageRows
    },
    payments: {
      summary: paymentSummary,
      staff_payment_profile: publicStaffUser(req.userAuth).payment_profile,
      note: 'Staff can save their payout details here. Payment confirmation, paid invoices, discounts, and refunds remain King/admin controlled.'
    },
    recent_activity: recentActivity,
    training: trainingGuide(),
    ai: {
      provider: getProviderMeta(),
      assistant_endpoint: '/api/staff/assistant/query'
    }
  };
}

function normalizeStaffListingPatch(existing = {}, patch = {}) {
  const normalized = safeJsonObject(patch, {});
  const currentExtra = safeJsonObject(existing.extra_fields, {});
  const base = {
    area: Object.prototype.hasOwnProperty.call(normalized, 'area') ? cleanText(normalized.area) : cleanText(existing.area),
    district: Object.prototype.hasOwnProperty.call(normalized, 'district') ? cleanText(normalized.district) : cleanText(existing.district),
    region: Object.prototype.hasOwnProperty.call(normalized, 'region') ? cleanText(normalized.region) : cleanText(currentExtra.region),
    city: Object.prototype.hasOwnProperty.call(normalized, 'city') ? cleanText(normalized.city) : cleanText(currentExtra.city),
    neighborhood: Object.prototype.hasOwnProperty.call(normalized, 'neighborhood') ? cleanText(normalized.neighborhood) : cleanText(currentExtra.neighborhood)
  };

  const knownAreaDistrict = districtForKnownArea(base.area) || districtForKnownArea(base.neighborhood) || districtForKnownArea(base.city);
  const callerSuppliedDistrict = Object.prototype.hasOwnProperty.call(normalized, 'district');
  const errors = [];
  if (knownAreaDistrict && base.district && base.district !== knownAreaDistrict && callerSuppliedDistrict) {
    errors.push(`${base.area || base.neighborhood || base.city} belongs to ${knownAreaDistrict}, not ${base.district}`);
  } else if (knownAreaDistrict && (!base.district || base.district !== knownAreaDistrict)) {
    normalized.district = knownAreaDistrict;
    base.district = knownAreaDistrict;
  }
  if (base.district && DISTRICTS.includes(base.district) && !base.region) {
    normalized.region = regionForDistrict(base.district);
    base.region = normalized.region;
  }
  const hierarchy = normalizeReviewLocationHierarchy(base);
  errors.push(...hierarchy.errors);

  const listingTypeRaw = cleanText(normalized.listing_type || normalized.listingType || normalized.type || normalized.category);
  if (listingTypeRaw) {
    const listingType = listingTypeRaw.toLowerCase() === 'students' ? 'student' : listingTypeRaw.toLowerCase();
    if (!LISTING_TYPES.includes(listingType)) errors.push('listing_type must be sale, rent, land, commercial, or student');
    normalized.listing_type = listingType;
  }

  if (Object.prototype.hasOwnProperty.call(normalized, 'district') && normalized.district && !DISTRICTS.includes(cleanText(normalized.district))) {
    errors.push('district must be one of Uganda\'s valid districts');
  }

  return {
    patch: normalized,
    hierarchy,
    errors: [...new Set(errors)]
  };
}

async function updateStaffEditableListing(req, propertyId, listingPatch = {}, reviewPatch = {}) {
  const existingResult = await db.query('SELECT * FROM properties WHERE id = $1 LIMIT 1', [propertyId]);
  if (!existingResult.rows.length) {
    const error = new Error('Property not found');
    error.status = 404;
    throw error;
  }
  const existing = existingResult.rows[0];
  const { patch, hierarchy, errors } = normalizeStaffListingPatch(existing, listingPatch);
  if (errors.length) {
    const error = new Error(errors[0]);
    error.status = 400;
    error.details = errors;
    throw error;
  }

  const setParts = [];
  const values = [propertyId];
  const changed = [];
  const add = (column, value, cast = '') => {
    values.push(value);
    setParts.push(`${column} = $${values.length}${cast}`);
    changed.push(column);
  };
  const fieldMap = {
    title: (value) => cleanText(value),
    description: (value) => cleanText(value),
    listing_type: (value) => cleanText(value).toLowerCase(),
    area: (value) => cleanText(value),
    district: (value) => cleanText(value),
    address: (value) => cleanText(value) || null,
    price: (value) => toNullableInt(value),
    price_period: (value) => cleanText(value) || null,
    property_type: (value) => cleanText(value) || null,
    title_type: (value) => cleanText(value) || null,
    bedrooms: (value) => toNullableInt(value),
    bathrooms: (value) => toNullableInt(value),
    lister_name: (value) => cleanText(value) || null,
    lister_phone: (value) => normalizePhoneLite(value) || null,
    lister_email: (value) => cleanText(value).toLowerCase() || null,
    latitude: (value) => toNullableFloat(value),
    longitude: (value) => toNullableFloat(value)
  };

  Object.entries(fieldMap).forEach(([key, transform]) => {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) return;
    const value = transform(patch[key]);
    if (['title', 'description', 'area', 'district', 'listing_type'].includes(key) && !value) return;
    add(key, value);
  });

  const extraPatch = {};
  ['region', 'city', 'neighborhood', 'street_name', 'location_note', 'source_url', 'source_platform'].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(patch, key)) extraPatch[key] = cleanText(patch[key]) || null;
  });
  if (hierarchy.region) extraPatch.region = hierarchy.region;
  if (hierarchy.city) extraPatch.city = hierarchy.city;
  if (hierarchy.neighborhood) extraPatch.neighborhood = hierarchy.neighborhood;
  if (Object.keys(extraPatch).length) {
    extraPatch.staff_location_reviewed_at = new Date().toISOString();
    extraPatch.staff_location_reviewed_by = actorId(req);
    values.push(JSON.stringify(extraPatch));
    setParts.push(`extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $${values.length}::jsonb`);
    changed.push('extra_fields');
  }

  const checklist = safeJsonObject(reviewPatch.checklist, null);
  if (checklist) {
    add('moderation_checklist', JSON.stringify(checklist), '::jsonb');
  }
  const notes = cleanText(reviewPatch.notes || reviewPatch.review_notes);
  if (notes) add('moderation_notes', notes);
  const reason = cleanText(reviewPatch.reason);
  if (reason) add('moderation_reason', reason);
  const stage = cleanText(reviewPatch.stage) || 'in_review';
  add('moderation_stage', stage);

  if (!setParts.length) return { changed_fields: [], property: existing };

  const updated = await db.query(
    `UPDATE properties
     SET ${setParts.join(', ')}, reviewed_by = COALESCE($${values.length + 1}::uuid, reviewed_by), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [...values, actorId(req)]
  );
  await db.query(
    `INSERT INTO property_moderation_events (property_id, actor_id, action, reason, notes, checklist, delivery)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
    [
      propertyId,
      actorId(req),
      'staff_listing_preview_saved',
      reason || null,
      notes || null,
      JSON.stringify(checklist || {}),
      JSON.stringify({ changed_fields: changed, hierarchy })
    ]
  ).catch(() => {});
  await logStaffActivity(req, 'staff_listing_preview_saved', {
    targetType: 'property',
    targetId: propertyId,
    metadata: { changed_fields: changed, hierarchy }
  });
  return { changed_fields: changed, property: updated.rows[0] };
}

async function loadStaffPropertyPreview(propertyId) {
  const property = await safeOne(
    `SELECT p.*
     FROM properties p
     WHERE p.id::text = $1 OR p.inquiry_reference = $1
     LIMIT 1`,
    [cleanText(propertyId)],
    null
  );
  if (!property) return null;
  const [images, duplicates, events] = await Promise.all([
    safeRows(
      `SELECT id, url, is_primary, sort_order, slot_key, room_label, created_at
       FROM property_images
       WHERE property_id = $1
       ORDER BY is_primary DESC, sort_order ASC, created_at ASC`,
      [property.id]
    ),
    safeRows(
      `SELECT id, title, listing_type, district, area, address, price, status, lister_phone,
              COALESCE(extra_fields->>'source_url', extra_fields->>'source_post_url', '') AS source_url,
              created_at
       FROM properties
       WHERE id <> $1
         AND (
           (COALESCE($2::text, '') <> '' AND lister_phone = $2)
           OR LOWER(COALESCE(title, '')) = LOWER(COALESCE($3::text, ''))
           OR (
             COALESCE($4::text, '') <> ''
             AND COALESCE(extra_fields->>'source_url', extra_fields->>'source_post_url', '') = $4
           )
           OR (
             COALESCE($5::text, '') <> ''
             AND COALESCE($6::text, '') <> ''
             AND LOWER(COALESCE(area, '')) = LOWER($5)
             AND district = $6
             AND COALESCE(price, 0) = COALESCE($7::bigint, 0)
           )
         )
       ORDER BY created_at DESC
       LIMIT 20`,
      [
        property.id,
        property.lister_phone || null,
        property.title || '',
        firstNonEmpty(property.extra_fields?.source_url, property.extra_fields?.source_post_url),
        property.area || '',
        property.district || '',
        property.price || 0
      ]
    ),
    safeRows(
      `SELECT id, actor_id, action, status_from, status_to, reason, notes, created_at
       FROM property_moderation_events
       WHERE property_id = $1
       ORDER BY created_at DESC
       LIMIT 30`,
      [property.id]
    )
  ]);
  const extra = safeJsonObject(property.extra_fields, {});
  const sourceUrl = firstNonEmpty(extra.source_url, extra.source_post_url, extra.tiktok_url, extra.youtube_url, extra.video_url);
  return {
    ...property,
    images,
    duplicate_review: {
      count: duplicates.length,
      rows: duplicates,
      must_check_before_approval: duplicates.length > 0
    },
    source_evidence: {
      platform: firstNonEmpty(extra.source_platform, extra.source_badge, property.source, property.listed_via),
      source_url: sourceUrl,
      source_contact_url: firstNonEmpty(extra.source_contact_url, extra.source_channel_url),
      source_name: firstNonEmpty(extra.source_name, extra.public_display_name, property.lister_name),
      first_posted_online: firstNonEmpty(extra.first_posted_online_label, extra.source_published_label, extra.first_posted_online_at)
    },
    location_review: {
      region: firstNonEmpty(extra.region, regionForDistrict(property.district)),
      city: firstNonEmpty(extra.city),
      neighborhood: firstNonEmpty(extra.neighborhood),
      known_area_district: districtForKnownArea(property.area) || '',
      warnings: districtForKnownArea(property.area) && districtForKnownArea(property.area) !== property.district
        ? [`${property.area} belongs to ${districtForKnownArea(property.area)}, not ${property.district}`]
        : []
    },
    review: {
      checklist: safeJsonObject(property.moderation_checklist, {}),
      notes: property.moderation_notes || '',
      reason: property.moderation_reason || extra.moderation_reason || ''
    },
    events
  };
}

function extractQuestionFilter(question = '') {
  const lower = String(question || '').toLowerCase();
  const district = DISTRICTS.find((item) => lower.includes(item.toLowerCase())) || '';
  const quoted = question.match(/["']([^"']{2,60})["']/)?.[1] || '';
  const areaMatch = question.match(/\b(?:in|around|near|for|at)\s+([a-z][a-z\s-]{2,40})/i);
  const area = cleanText(quoted || areaMatch?.[1] || '')
    .replace(/\b(properties|property|houses|house|land|rent|sale|area|district|website|uganda|phone|numbers|contacts|people)\b/gi, '')
    .trim();
  const limitMatch = question.match(/\b(?:top|first|limit|show)\s+(\d{1,3})\b/i);
  return {
    district,
    area: area && area.length > 2 ? area : '',
    limit: Math.min(STAFF_CONTACT_EXPORT_LIMIT, Math.max(1, parseInt(limitMatch?.[1] || STAFF_CONTACT_EXPORT_LIMIT, 10) || STAFF_CONTACT_EXPORT_LIMIT))
  };
}

function wantsContactExport(question = '') {
  return /\b(phone|phones|number|numbers|contact|contacts|whatsapp|email|emails|download|csv|list)\b/i.test(question);
}

function csvEscape(value) {
  const text = String(value == null ? '' : value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function contactsCsv(rows = []) {
  const headers = ['source', 'name', 'phone', 'email', 'location', 'label', 'reference', 'status'];
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((key) => csvEscape(row[key])).join(','))
  ].join('\n');
}

function normalizeContactRow(row = {}) {
  return {
    source: row.source || '',
    name: row.name || '',
    phone: normalizePhoneLite(row.phone || row.whatsapp || ''),
    email: row.email || '',
    location: row.location || '',
    label: row.label || '',
    reference: row.reference || '',
    status: row.status || ''
  };
}

async function collectStaffContactRows(question = '') {
  const filter = extractQuestionFilter(question);
  const like = `%${filter.area || filter.district || ''}%`;
  const params = [filter.area || filter.district || '', like, filter.limit];
  const [listingRows, leadRows, propertyLeadRows, mortgageRows, whatsappRows, adRows] = await Promise.all([
    safeRows(
      `SELECT 'property_listing' AS source, id::text AS reference, COALESCE(lister_name, title) AS name,
              lister_phone AS phone, lister_email AS email,
              CONCAT_WS(', ', NULLIF(area, ''), NULLIF(district, '')) AS location,
              title AS label, status
       FROM properties p
       WHERE ${publicLivePropertyStatusSql('p')}
         AND (COALESCE(lister_phone, '') <> '' OR COALESCE(lister_email, '') <> '')
         AND ($1::text = '' OR area ILIKE $2 OR district ILIKE $2 OR address ILIKE $2 OR title ILIKE $2)
       ORDER BY approved_at DESC NULLS LAST, updated_at DESC
       LIMIT $3`,
      params
    ),
    safeRows(
      `SELECT 'lead' AS source, l.id::text AS reference, COALESCE(c.name, 'Lead contact') AS name,
              COALESCE(c.phone, c.whatsapp) AS phone, c.email AS email,
              COALESCE(NULLIF(l.location, ''), l.metadata->>'preferred_area', '') AS location,
              COALESCE(l.message, l.lead_type, 'Lead') AS label, l.lead_status AS status
       FROM leads l
       LEFT JOIN contacts c ON c.id = l.contact_id
       WHERE (COALESCE(c.phone, c.whatsapp, c.email, '') <> '')
         AND ($1::text = '' OR l.location ILIKE $2 OR l.message ILIKE $2 OR l.metadata->>'preferred_area' ILIKE $2)
       ORDER BY l.created_at DESC
       LIMIT $3`,
      params
    ),
    safeRows(
      `SELECT 'property_lead' AS source, id::text AS reference, COALESCE(name, 'Property lead') AS name,
              phone, email, preferred_area AS location,
              COALESCE(notes, purpose, category, 'Property lead') AS label, 'open' AS status
       FROM property_leads
       WHERE (COALESCE(phone, email, '') <> '')
         AND ($1::text = '' OR preferred_area ILIKE $2 OR notes ILIKE $2 OR category ILIKE $2)
       ORDER BY created_at DESC
       LIMIT $3`,
      params
    ),
    safeRows(
      `SELECT 'mortgage_enquiry' AS source, id::text AS reference, 'Mortgage lead' AS name,
              user_phone AS phone, '' AS email,
              COALESCE(payload->>'location', payload->>'preferred_area', '') AS location,
              CONCAT_WS(' ', property_purpose, property_price::text) AS label, 'open' AS status
       FROM mortgage_enquiries
       WHERE COALESCE(user_phone, '') <> ''
         AND ($1::text = '' OR payload->>'location' ILIKE $2 OR payload->>'preferred_area' ILIKE $2 OR property_purpose ILIKE $2)
       ORDER BY created_at DESC
       LIMIT $3`,
      params
    ),
    safeRows(
      `SELECT 'whatsapp_conversation' AS source, phone AS reference, 'WhatsApp contact' AS name,
              phone, '' AS email, COALESCE(metadata->>'location', metadata->>'preferred_area', '') AS location,
              COALESCE(latest_preview, last_intent, category, 'WhatsApp conversation') AS label, status
       FROM whatsapp_conversation_state
       WHERE COALESCE(phone, '') <> ''
         AND ($1::text = '' OR latest_preview ILIKE $2 OR last_intent ILIKE $2 OR metadata->>'location' ILIKE $2)
       ORDER BY COALESCE(last_message_at, updated_at) DESC
       LIMIT $3`,
      params
    ),
    safeRows(
      `SELECT 'advertising_inquiry' AS source, id::text AS reference, COALESCE(full_name, business_name, 'Advertiser') AS name,
              phone, email, COALESCE(target_locations::text, '') AS location,
              COALESCE(product_interests::text, 'Advertising inquiry') AS label, status
       FROM advertising_inquiries
       WHERE COALESCE(phone, email, '') <> ''
         AND ($1::text = '' OR full_name ILIKE $2 OR business_name ILIKE $2 OR target_locations::text ILIKE $2)
       ORDER BY created_at DESC
       LIMIT $3`,
      params
    )
  ]);
  const seen = new Set();
  const rows = [...listingRows, ...leadRows, ...propertyLeadRows, ...mortgageRows, ...whatsappRows, ...adRows]
    .map(normalizeContactRow)
    .filter((row) => row.phone || row.email)
    .filter((row) => {
      const key = `${row.source}:${row.phone || row.email}:${row.reference}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, filter.limit);
  return { rows, filter };
}

router.get('/dashboard', async (req, res, next) => {
  try {
    await logStaffActivity(req, 'staff_dashboard_opened', { metadata: { role: req.userAuth?.role } });
    return res.json({ ok: true, data: await dashboardPayload(req) });
  } catch (error) {
    return next(error);
  }
});

router.patch('/profile', async (req, res, next) => {
  try {
    const userId = actorId(req);
    const currentProfile = staffProfile(req.userAuth);
    const firstName = cleanText(req.body.first_name || req.body.firstName);
    const lastName = cleanText(req.body.last_name || req.body.lastName);
    const phone = normalizePhoneLite(req.body.phone);
    const personalEmail = cleanText(req.body.personal_email || req.body.personalEmail).toLowerCase();
    const paymentProfile = {
      simba_account: cleanText(req.body.simba_account || req.body.simbaAccount),
      payment_provider: cleanText(req.body.payment_provider || req.body.paymentProvider || 'mobile_money'),
      mobile_money_name: cleanText(req.body.mobile_money_name || req.body.mobileMoneyName),
      mobile_money_phone: normalizePhoneLite(req.body.mobile_money_phone || req.body.mobileMoneyPhone || phone || req.userAuth.phone),
      bank_name: cleanText(req.body.bank_name || req.body.bankName),
      bank_account_name: cleanText(req.body.bank_account_name || req.body.bankAccountName),
      bank_account_last4: cleanText(req.body.bank_account_last4 || req.body.bankAccountLast4).replace(/\D/g, '').slice(-4),
      payout_notes: cleanText(req.body.payout_notes || req.body.payoutNotes)
    };
    const profilePatch = {
      ...currentProfile,
      personal_email: personalEmail || currentProfile.personal_email || '',
      payment_profile: {
        ...safeJsonObject(currentProfile.payment_profile, {}),
        ...paymentProfile
      },
      staff_settings_updated_at: new Date().toISOString()
    };
    const updated = await db.query(
      `UPDATE users
       SET first_name = COALESCE(NULLIF($2, ''), first_name),
           last_name = COALESCE(NULLIF($3, ''), last_name),
           phone = COALESCE(NULLIF($4, ''), phone),
           profile_data = COALESCE(profile_data, '{}'::jsonb) || $5::jsonb,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, first_name, last_name, phone, email, role, status, preferred_language, preferred_contact_channel, profile_data`,
      [userId, firstName, lastName, phone, JSON.stringify(profilePatch)]
    );
    req.userAuth = updated.rows[0] || req.userAuth;
    await logStaffActivity(req, 'staff_profile_saved', {
      targetType: 'staff_profile',
      targetId: userId,
      metadata: { has_payment_profile: true, has_personal_email: !!personalEmail }
    });
    return res.json({ ok: true, data: publicStaffUser(req.userAuth) });
  } catch (error) {
    return next(error);
  }
});

router.get('/properties/:id/preview', async (req, res, next) => {
  try {
    const preview = await loadStaffPropertyPreview(req.params.id);
    if (!preview) return res.status(404).json({ ok: false, error: 'Property not found' });
    await logStaffActivity(req, 'staff_listing_preview_opened', {
      targetType: 'property',
      targetId: preview.id,
      metadata: { duplicate_count: preview.duplicate_review?.count || 0 }
    });
    return res.json({ ok: true, data: preview });
  } catch (error) {
    return next(error);
  }
});

router.patch('/properties/:id/review', async (req, res, next) => {
  try {
    const listingPatch = safeJsonObject(req.body.listing, req.body || {});
    const reviewPatch = {
      checklist: safeJsonObject(req.body.checklist, {}),
      notes: req.body.notes || req.body.review_notes,
      reason: req.body.reason,
      stage: req.body.stage || 'in_review'
    };
    const saved = await updateStaffEditableListing(req, req.params.id, listingPatch, reviewPatch);
    const preview = await loadStaffPropertyPreview(req.params.id);
    return res.json({ ok: true, data: preview, changed_fields: saved.changed_fields || [] });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ ok: false, error: error.message, details: error.details || undefined });
    }
    return next(error);
  }
});

router.post('/source-intake/exact-social/import', async (req, res, next) => {
  try {
    const posts = Array.isArray(req.body?.posts) ? req.body.posts : (Array.isArray(req.body) ? req.body : []);
    const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
    const rawText = cleanText(req.body?.raw_text || req.body?.rawText || req.body?.text || '');
    const dryRun = req.body?.dry_run !== false && req.body?.dryRun !== false;
    const result = await importExactSocialSourcePosts({
      db,
      posts,
      urls,
      rawText,
      dryRun,
      fetchOembed: req.body?.fetch_oembed !== false && req.body?.fetchOembed !== false,
      fetchPublicMetadata: req.body?.fetch_public_metadata !== false && req.body?.fetchPublicMetadata !== false
    });
    await logStaffActivity(req, dryRun ? 'staff_social_import_previewed' : 'staff_social_import_queued', {
      targetType: 'source_intake',
      metadata: {
        batch_id: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
        dry_run: dryRun,
        exact_social_url_count: result.exact_social_url_count || 0,
        created_properties: result.created_properties || 0,
        existing_properties: result.existing_properties || 0,
        review_queue_properties: result.review_queue_properties || 0,
        source_review_count: result.source_review_count || 0
      }
    });
    return res.json({ ok: true, data: result });
  } catch (error) {
    return next(error);
  }
});

router.post('/source-intake/social-sweep', async (req, res, next) => {
  try {
    const platform = cleanText(req.body?.platform || 'all').toLowerCase() || 'all';
    const focus = cleanText(req.body?.focus || req.body?.sweep_focus || req.body?.sweepFocus || '');
    const dryRun = req.body?.dry_run !== false && req.body?.dryRun !== false;
    const maxSources = Math.min(15, Math.max(1, parseInt(req.body?.max_sources || req.body?.maxSources || 8, 10) || 8));
    const result = await runSocialPlatformPostSweep({
      db,
      platform,
      focus,
      dryRun,
      maxSources,
      sourceOffset: Math.max(0, parseInt(req.body?.source_offset || req.body?.sourceOffset || 0, 10) || 0),
      maxResultsPerSource: Math.min(10, Math.max(1, parseInt(req.body?.max_results || req.body?.maxResults || 5, 10) || 5)),
      searchMode: cleanText(req.body?.x_search_mode || req.body?.xSearchMode || 'all'),
      lookbackDays: Math.max(0, parseInt(req.body?.lookback_days || req.body?.lookbackDays || 0, 10) || 0),
      publishedAfter: cleanText(req.body?.published_after || req.body?.publishedAfter || '2026-01-01T00:00:00.000Z')
    });
    await logStaffActivity(req, dryRun ? 'staff_social_sweep_previewed' : 'staff_social_sweep_run', {
      targetType: 'source_intake',
      metadata: {
        batch_id: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
        platform,
        focus,
        dry_run: dryRun,
        max_sources: maxSources,
        discovered_posts_count: result.discovered_posts_count || 0,
        created_properties: result.import_result?.created_properties || 0,
        existing_properties: result.import_result?.existing_properties || 0
      }
    });
    return res.json({ ok: true, data: result });
  } catch (error) {
    return next(error);
  }
});

router.patch('/leads/:id', async (req, res, next) => {
  try {
    const leadId = req.params.id;
    const previous = await db.query('SELECT * FROM leads WHERE id = $1 LIMIT 1', [leadId]);
    if (!previous.rows.length) return res.status(404).json({ ok: false, error: 'Lead not found' });

    const updates = [];
    const values = [];
    const add = (field, value, cast = '') => {
      values.push(value);
      updates.push(`${field} = $${values.length}${cast}`);
    };
    ['lead_status', 'lifecycle_stage', 'priority', 'sla_status', 'outcome', 'lost_reason'].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) add(field, cleanText(req.body[field]) || null);
    });
    if (Object.prototype.hasOwnProperty.call(req.body, 'assigned_to_me')) {
      add('assigned_to_user_id', req.body.assigned_to_me === false ? null : actorId(req));
    } else if (Object.prototype.hasOwnProperty.call(req.body, 'assigned_to_user_id')) {
      const requestedAssignee = cleanText(req.body.assigned_to_user_id) || null;
      if (requestedAssignee && requestedAssignee !== actorId(req)) {
        return res.status(403).json({ ok: false, error: 'Moderators can only assign a lead to themselves from this dashboard' });
      }
      add('assigned_to_user_id', requestedAssignee);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'next_follow_up_at')) add('next_follow_up_at', cleanText(req.body.next_follow_up_at) || null, '::timestamptz');
    if (Object.prototype.hasOwnProperty.call(req.body, 'last_contacted_at')) add('last_contacted_at', cleanText(req.body.last_contacted_at) || null, '::timestamptz');
    if (!updates.length) return res.status(400).json({ ok: false, error: 'No lead updates provided' });

    values.push(leadId);
    const updated = await db.query(
      `UPDATE leads SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    );
    await addLeadActivity(db, {
      leadId,
      actorUserId: actorId(req),
      actorType: 'moderator',
      activityType: 'staff_lead_update',
      oldStatus: previous.rows[0].lead_status,
      newStatus: updated.rows[0].lead_status,
      message: cleanText(req.body.note) || 'Lead updated by staff',
      metadata: { changed_fields: updates.map((item) => item.split(' = ')[0]) }
    });
    await logStaffActivity(req, 'staff_lead_updated', { targetType: 'lead', targetId: leadId, metadata: { changed_fields: updates.map((item) => item.split(' = ')[0]) } });
    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/leads/:id/activities', async (req, res, next) => {
  try {
    const leadId = req.params.id;
    const found = await db.query('SELECT id FROM leads WHERE id = $1 LIMIT 1', [leadId]);
    if (!found.rows.length) return res.status(404).json({ ok: false, error: 'Lead not found' });
    const activity = await addLeadActivity(db, {
      leadId,
      actorUserId: actorId(req),
      actorType: 'moderator',
      activityType: cleanText(req.body.activity_type || req.body.activityType) || 'note',
      message: cleanText(req.body.message || req.body.note) || null,
      metadata: req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {}
    });
    await logStaffActivity(req, 'staff_lead_activity_added', { targetType: 'lead', targetId: leadId, metadata: { activity_id: activity?.id || null } });
    return res.status(201).json({ ok: true, data: activity });
  } catch (error) {
    return next(error);
  }
});

router.patch('/advertising/inquiries/:id', async (req, res, next) => {
  try {
    const inquiryId = req.params.id;
    const allowedStatuses = ['new', 'contacted', 'proposal_sent', 'won', 'lost', 'archived'];
    const status = req.body.status ? cleanText(req.body.status).toLowerCase() : undefined;
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: 'Invalid inquiry status' });
    }
    const updates = [];
    const values = [];
    const add = (column, value, cast = '') => {
      values.push(value);
      updates.push(`${column} = $${values.length}${cast}`);
    };
    if (status) add('status', status);
    if (Object.prototype.hasOwnProperty.call(req.body, 'internal_notes')) add('internal_notes', cleanText(req.body.internal_notes) || null);
    if (Object.prototype.hasOwnProperty.call(req.body, 'estimated_value_ugx')) add('estimated_value_ugx', Math.max(0, parseInt(req.body.estimated_value_ugx, 10) || 0));
    if (Object.prototype.hasOwnProperty.call(req.body, 'assigned_to_me')) add('assigned_to_user_id', req.body.assigned_to_me === false ? null : actorId(req));
    if (!updates.length) return res.status(400).json({ ok: false, error: 'No updates provided' });

    values.push(inquiryId);
    const updated = await db.query(
      `UPDATE advertising_inquiries
       SET ${updates.join(', ')}, last_staff_action_at = NOW(), updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING *`,
      values
    );
    if (!updated.rows.length) return res.status(404).json({ ok: false, error: 'Advertising inquiry not found' });
    await logStaffActivity(req, 'staff_advertising_inquiry_updated', { targetType: 'advertising_inquiry', targetId: inquiryId, metadata: { status: updated.rows[0].status } });
    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/assistant/query', async (req, res, next) => {
  try {
    const question = cleanText(req.body.question || req.body.prompt);
    if (!question) return res.status(400).json({ ok: false, error: 'question is required' });

    if (wantsContactExport(question)) {
      const { rows: contacts, filter } = await collectStaffContactRows(question);
      const csv = contactsCsv(contacts);
      const answer = contacts.length
        ? [
          `Found ${contacts.length} staff-accessible contact${contacts.length === 1 ? '' : 's'}${filter.area || filter.district ? ` matching ${filter.area || filter.district}` : ''}.`,
          `Sources include live listing owners, CRM leads, WhatsApp conversations, mortgage/bank enquiries, property leads, and advertising inquiries where contact details exist.`,
          `Showing the first ${contacts.length}; use Copy CSV to download/share the working list.`
        ].join(' ')
        : 'No matching staff-accessible contact rows were found. Try a wider location, ask for all open leads, or check whether the record has a phone/email saved.';
      await logStaffActivity(req, 'staff_ai_contact_lookup', {
        targetType: 'staff_ai',
        metadata: {
          question,
          area: filter.area || null,
          district: filter.district || null,
          returned_contacts: contacts.length
        }
      });
      return res.json({
        ok: true,
        data: {
          answer,
          model: 'staff_contact_export_v1',
          provider: getProviderMeta(),
          contacts,
          csv,
          csv_filename: `makaug-staff-contacts-${new Date().toISOString().slice(0, 10)}.csv`,
          contact_count: contacts.length,
          filter
        }
      });
    }

    const areaMatch = question.match(/\b(?:in|around|near|for)\s+([a-z][a-z\s-]{2,40})/i);
    const area = cleanText(areaMatch?.[1] || '').replace(/\b(properties|property|houses|land|rent|sale|area|district)\b/gi, '').trim();
    const [demandRows, listingRows, whatsappRows, sourceRows, adRows, bankRows] = await Promise.all([
      safeRows(
        `SELECT
           COALESCE(NULLIF(location, ''), metadata->>'preferred_area', 'Unknown') AS location,
           COUNT(*)::int AS lead_count,
           COUNT(*) FILTER (WHERE lead_status = 'open')::int AS open_count,
           COUNT(*) FILTER (WHERE priority IN ('high','urgent') OR lead_score >= 50)::int AS hot_count,
           COALESCE(AVG(budget), 0)::bigint AS avg_budget
         FROM leads
         WHERE ($1::text = '' OR location ILIKE $2 OR metadata->>'preferred_area' ILIKE $2 OR message ILIKE $2)
         GROUP BY 1
         ORDER BY lead_count DESC, location ASC
         LIMIT 10`,
        [area, `%${area}%`]
      ),
      safeRows(
        `SELECT
           COALESCE(NULLIF(area, ''), NULLIF(district, ''), 'Unknown') AS location,
           COUNT(*) FILTER (WHERE ${publicLivePropertyStatusSql('p')})::int AS live_listings,
           COUNT(*) FILTER (WHERE ${pendingReviewWhere('p')})::int AS pending_review,
           COUNT(*) FILTER (WHERE COALESCE(lister_phone, '') <> '')::int AS listings_with_phone
         FROM properties p
         WHERE ($1::text = '' OR p.area ILIKE $2 OR p.district ILIKE $2 OR p.address ILIKE $2)
         GROUP BY 1
         ORDER BY live_listings DESC, pending_review DESC, location ASC
         LIMIT 10`,
        [area, `%${area}%`]
      ),
      safeRows(
        `SELECT category, status, COUNT(*)::int AS count
         FROM whatsapp_conversation_state
         WHERE ($1::text = '' OR latest_preview ILIKE $2 OR metadata->>'location' ILIKE $2)
         GROUP BY category, status
         ORDER BY count DESC
         LIMIT 10`,
        [area, `%${area}%`]
      ),
      safeRows(
        `SELECT platform, status, COUNT(*)::int AS count
         FROM property_source_registry
         WHERE ($1::text = '' OR source_name ILIKE $2 OR source_url ILIKE $2 OR array_to_string(districts, ', ') ILIKE $2)
         GROUP BY platform, status
         ORDER BY count DESC
         LIMIT 10`,
        [area, `%${area}%`]
      ),
      safeRows(
        `SELECT status, COUNT(*)::int AS count, COALESCE(SUM(estimated_value_ugx), 0)::bigint AS pipeline_ugx
         FROM advertising_inquiries
         WHERE ($1::text = '' OR target_locations::text ILIKE $2 OR business_name ILIKE $2 OR message ILIKE $2)
         GROUP BY status
         ORDER BY count DESC
         LIMIT 10`,
        [area, `%${area}%`]
      ),
      safeRows(
        `SELECT COALESCE(payload->>'preferred_area', payload->>'location', 'Unknown') AS location,
                COUNT(*)::int AS mortgage_count,
                COUNT(*) FILTER (WHERE user_phone IS NOT NULL AND user_phone <> '')::int AS with_phone
         FROM mortgage_enquiries
         WHERE ($1::text = '' OR payload->>'preferred_area' ILIKE $2 OR payload->>'location' ILIKE $2 OR property_purpose ILIKE $2)
         GROUP BY 1
         ORDER BY mortgage_count DESC
         LIMIT 10`,
        [area, `%${area}%`]
      )
    ]);
    const context = {
      question,
      area: area || null,
      demand: demandRows,
      listings: listingRows,
      whatsapp: whatsappRows,
      sources: sourceRows,
      advertising: adRows,
      bank_mortgage: bankRows,
      metric_definitions: staffMetricDefinitions()
    };
    let answer = [
      area ? `For ${area}, I found these staff-safe signals:` : 'Here are the staff-safe makaug signals I can share:',
      `Leads: ${demandRows.reduce((total, row) => total + safeNumber(row, 'lead_count'), 0)} captured in the matching demand sample.`,
      `Live listings: ${listingRows.reduce((total, row) => total + safeNumber(row, 'live_listings'), 0)} in the matching listing sample.`,
      `Pending moderation: ${listingRows.reduce((total, row) => total + safeNumber(row, 'pending_review'), 0)}.`,
      `WhatsApp open/needs-human signals: ${whatsappRows.reduce((total, row) => total + safeNumber(row, 'count'), 0)}.`
    ].join(' ');
    let model = 'staff_safe_template';
    const client = getProviderClient();
    if (client) {
      model = getTaskModel('staff_assistant', 'gpt-4.1-mini');
      const completion = await client.chat.completions.create({
        model,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: 'You are the makaug staff data assistant. Answer from the provided JSON only. Be concise and action-oriented. Staff can use operational contact data only through the explicit contact export mode; do not invent phone numbers. Do not expose owner financials, secrets, admin API keys, passwords, discounts, refunds, or platform owner-only controls.'
          },
          { role: 'user', content: JSON.stringify(context) }
        ]
      });
      answer = cleanText(completion?.choices?.[0]?.message?.content || answer) || answer;
    }
    await logStaffActivity(req, 'staff_ai_question_answered', { targetType: 'staff_ai', metadata: { question, area: area || null, model } });
    return res.json({ ok: true, data: { answer, model, context, provider: getProviderMeta() } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
