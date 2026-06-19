const express = require('express');

const db = require('../config/database');
const logger = require('../config/logger');
const { requireStaffAccess } = require('../middleware/auth');
const { cleanText } = require('../middleware/validation');
const { parsePagination, toPagination } = require('../utils/pagination');
const { publicLivePropertyStatusSql } = require('../utils/publicInventoryStatus');
const { addLeadActivity } = require('../services/leadService');
const { getProviderClient, getProviderMeta, getTaskModel } = require('../services/llmProvider');

const router = express.Router();

router.use(requireStaffAccess);

const PENDING_REVIEW_STATUSES = ['pending', 'pending_review', 'test_pending_review', 'pending_review_hidden', 'draft', 'submitted', 'in_review', 'under_review'];
const FINAL_REVIEW_STATUSES = ['approved', 'live', 'published', 'sold', 'hidden', 'deleted', 'rejected', 'declined', 'fraud', 'archived'];
const OPEN_LEAD_STATUSES = ['open', 'new', 'contacted', 'qualified'];
const OPEN_AD_STATUSES = ['new', 'contacted', 'proposal_sent'];

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
    moderation: [
      'Confirm the location from the strongest evidence first: address, map pin, source caption, then broader extracted area.',
      'Never approve when the district/town hierarchy is wrong or the location is missing.',
      'Check phone, price, property type, images, duplicate risk, title status, and safety notes before publishing.',
      'Use reject/request-change when ownership, location, contact, or image rights are not clear.'
    ],
    leads: [
      'Work hot and overdue leads first. Add every call, WhatsApp, or email as a lead activity.',
      'Match no-result WhatsApp leads to approved listings only.',
      'Keep leads open until the customer is contacted or assigned to an agent/broker.'
    ],
    advertising: [
      'Record advertiser interest, product, target area, target page, estimated value, and next follow-up.',
      'Do not mark payments paid unless King/admin has proof.',
      'Campaign creative must be reviewed before it is marked live.'
    ],
    scripts: [
      'Hello, this is makaug.com. I am checking your property/listing request so we only publish accurate information.',
      'Before makaug can approve this listing, please confirm the exact area, district, price, contact number, and image permission.',
      'For advertising, makaug can place sponsored space across website search, student pages, land/commercial pages, broker spotlight, and WhatsApp sponsored matches.'
    ],
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
    whatsappRows
  ] = await Promise.all([
    safeOne(
      `SELECT
         COUNT(*) FILTER (WHERE ${pendingReviewWhere('p')})::int AS pending_review,
         COUNT(*) FILTER (WHERE ${publicLivePropertyStatusSql('p')})::int AS live,
         COUNT(*) FILTER (WHERE LOWER(COALESCE(p.status, '')) = 'rejected')::int AS rejected
       FROM properties p`,
      [],
      { pending_review: 0, live: 0, rejected: 0 }
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
      `SELECT p.id, p.title, p.listing_type, p.property_type, p.district, p.area, p.price, p.price_period,
              p.status, p.moderation_stage, p.moderation_reason, p.created_at, p.updated_at,
              p.inquiry_reference, p.lister_name, p.lister_phone, p.lister_email, img.url AS primary_image_url
       FROM properties p
       LEFT JOIN LATERAL (
         SELECT url FROM property_images i WHERE i.property_id = p.id ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC LIMIT 1
       ) img ON true
       WHERE ${pendingReviewWhere('p')}
       ORDER BY COALESCE(p.updated_at, p.created_at) DESC
       LIMIT 20`
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
              last_message_at, updated_at
       FROM whatsapp_conversation_state
       WHERE assigned_to = $1 OR status IN ('needs_human','escalated','open')
       ORDER BY COALESCE(last_message_at, updated_at) DESC
       LIMIT 20`,
      [staffId]
    )
  ]);

  return {
    staff: publicStaffUser(req.userAuth),
    summary: {
      listings: listingSummary,
      my_moderation: myModeration,
      leads: leadSummary,
      advertising: adSummary,
      whatsapp: whatsappSummary
    },
    review_queue: reviewRows,
    leads: leadRows,
    advertising_inquiries: adRows,
    whatsapp_conversations: whatsappRows,
    recent_activity: recentActivity,
    training: trainingGuide(),
    ai: {
      provider: getProviderMeta(),
      assistant_endpoint: '/api/staff/assistant/query'
    }
  };
}

router.get('/dashboard', async (req, res, next) => {
  try {
    await logStaffActivity(req, 'staff_dashboard_opened', { metadata: { role: req.userAuth?.role } });
    return res.json({ ok: true, data: await dashboardPayload(req) });
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

    const areaMatch = question.match(/\b(?:in|around|near|for)\s+([a-z][a-z\s-]{2,40})/i);
    const area = cleanText(areaMatch?.[1] || '').replace(/\b(properties|property|houses|land|rent|sale|area|district)\b/gi, '').trim();
    const demandRows = await safeRows(
      `SELECT
         COALESCE(NULLIF(location, ''), metadata->>'preferred_area', 'Unknown') AS location,
         COUNT(*)::int AS lead_count,
         COUNT(*) FILTER (WHERE lead_status = 'open')::int AS open_count,
         COALESCE(AVG(budget), 0)::bigint AS avg_budget
       FROM leads
       WHERE ($1::text = '' OR location ILIKE $2 OR metadata->>'preferred_area' ILIKE $2 OR message ILIKE $2)
       GROUP BY 1
       ORDER BY lead_count DESC, location ASC
       LIMIT 10`,
      [area, `%${area}%`]
    );
    const listingRows = await safeRows(
      `SELECT
         COALESCE(NULLIF(area, ''), NULLIF(district, ''), 'Unknown') AS location,
         COUNT(*) FILTER (WHERE ${publicLivePropertyStatusSql('p')})::int AS live_listings,
         COUNT(*) FILTER (WHERE ${pendingReviewWhere('p')})::int AS pending_review
       FROM properties p
       WHERE ($1::text = '' OR p.area ILIKE $2 OR p.district ILIKE $2 OR p.address ILIKE $2)
       GROUP BY 1
       ORDER BY live_listings DESC, pending_review DESC, location ASC
       LIMIT 10`,
      [area, `%${area}%`]
    );
    const context = { question, area: area || null, demand: demandRows, listings: listingRows };
    let answer = [
      area ? `For ${area}, I found these staff-safe signals:` : 'Here are the staff-safe makaug signals I can share:',
      `Leads: ${demandRows.reduce((total, row) => total + safeNumber(row, 'lead_count'), 0)} captured in the matching demand sample.`,
      `Live listings: ${listingRows.reduce((total, row) => total + safeNumber(row, 'live_listings'), 0)} in the matching listing sample.`,
      `Pending moderation: ${listingRows.reduce((total, row) => total + safeNumber(row, 'pending_review'), 0)}.`
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
            content: 'You are the makaug staff data assistant. Answer from the provided JSON only. Be concise. Do not expose private financials, secrets, admin API keys, or platform owner-only controls.'
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
