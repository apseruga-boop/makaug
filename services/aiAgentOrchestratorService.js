const db = require('../config/database');
const logger = require('../config/logger');
const { sendSupportEmail } = require('./emailService');
const { suggestWhatsappAssistantReply } = require('./aiService');

function safeInt(value, fallback = 0) {
  const n = parseInt(String(value || ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function asBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = String(value || '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

function safeText(value, max = 1000) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

const AI_CEO_AGENT_CODE = 'managing_director_ceo';

const DEFAULT_CEO_KILL_SWITCHES = {
  autonomous_listing_approval: false,
  autonomous_public_posting: false,
  autonomous_payment_spend: false,
  autonomous_bulk_outreach: false,
  autonomous_password_or_access_changes: false,
  autonomous_data_deletion: false,
  customer_reply_requires_review_when_confidence_low: true,
  founder_approval_required_for_external_actions: true
};

const CEO_OPERATING_AREAS = [
  'site_health',
  'listing_review',
  'broker_and_field_agent_ops',
  'crm_leads',
  'customer_comms',
  'whatsapp_ai_health',
  'email_sms_health',
  'advertising_revenue',
  'social_content_drafts',
  'llm_learning'
];

const CEO_FINAL_LISTING_STATUSES = [
  'approved',
  'live',
  'published',
  'sold',
  'hidden',
  'deleted',
  'rejected',
  'declined',
  'fraud',
  'archived',
  'off_market',
  'paused',
  'inactive',
  'expired',
  'removed',
  'unavailable',
  'duplicate',
  'actioned'
];

const CEO_APPROVAL_ACTION_TYPES = new Set([
  'set_property_status',
  'send_support_email',
  'update_agent_status',
  'draft_customer_reply',
  'draft_outreach_email',
  'draft_social_post',
  'create_ad_campaign',
  'spend_ad_budget',
  'delete_customer_data',
  'change_user_access',
  'notify_founder'
]);

function ceoSqlList(values = []) {
  return values.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(', ');
}

function ceoColumn(alias, column) {
  return alias ? `${alias}.${column}` : column;
}

function ceoPendingReviewWhere(alias = 'p') {
  const final = ceoSqlList(CEO_FINAL_LISTING_STATUSES);
  return `(
    LOWER(COALESCE(${ceoColumn(alias, 'status')}, '')) NOT IN (${final})
    AND LOWER(COALESCE(${ceoColumn(alias, 'moderation_stage')}, '')) NOT IN (${final})
  )`;
}

function ceoPublicLiveWhere(alias = 'p') {
  return `(${ceoColumn(alias, 'status')} = 'approved' OR (${ceoColumn(alias, 'status')} = 'sold' AND ${ceoColumn(alias, 'sold_at')} >= NOW() - INTERVAL '7 days'))`;
}

function getCeoKillSwitches(agentConfig = {}) {
  const configSwitches = agentConfig && typeof agentConfig === 'object' && agentConfig.killSwitches
    ? agentConfig.killSwitches
    : {};
  return { ...DEFAULT_CEO_KILL_SWITCHES, ...configSwitches };
}

function getCeoDeliveryChannels(agentConfig = {}) {
  const channels = Array.isArray(agentConfig?.deliveryChannels) ? agentConfig.deliveryChannels : [];
  return channels.length ? channels : ['dashboard', 'email_founder', 'whatsapp_owner'];
}

function buildApprovalRecommendation({ actionType = 'founder_review_required', payload = {}, reason, riskLevel = 'high' }) {
  return {
    action_type: actionType,
    requires_founder_approval: true,
    risk_level: riskLevel,
    approval_reason: safeText(reason || 'Founder approval required before this external or irreversible action.', 500),
    action_payload: {
      ...payload,
      founder_review_required: true
    }
  };
}

async function getAgentByCode(code) {
  const result = await db.query(
    `SELECT id, code, name, description, enabled, run_mode, config, created_at, updated_at
     FROM ai_agents
     WHERE code = $1
     LIMIT 1`,
    [code]
  );
  return result.rows[0] || null;
}

async function listAgents() {
  const result = await db.query(
    `SELECT id, code, name, description, enabled, run_mode, config, created_at, updated_at
     FROM ai_agents
     ORDER BY code ASC`
  );
  return result.rows;
}

async function updateAgent(agentId, updates = {}) {
  const set = [];
  const values = [agentId];
  let idx = 2;

  if (updates.enabled !== undefined) {
    set.push(`enabled = $${idx++}`);
    values.push(asBool(updates.enabled));
  }
  if (updates.run_mode !== undefined) {
    set.push(`run_mode = $${idx++}`);
    values.push(String(updates.run_mode || 'recommend').trim().toLowerCase());
  }
  if (updates.config !== undefined) {
    set.push(`config = $${idx++}::jsonb`);
    values.push(JSON.stringify(updates.config || {}));
  }

  if (!set.length) {
    throw new Error('No updates provided');
  }

  const result = await db.query(
    `UPDATE ai_agents
     SET ${set.join(', ')}, updated_at = NOW()
     WHERE id = $1
     RETURNING id, code, name, description, enabled, run_mode, config, updated_at`,
    values
  );

  return result.rows[0] || null;
}

async function insertRun({ agent, triggerSource = 'manual', createdBy = 'admin_api_key', inputPayload = {} }) {
  const result = await db.query(
    `INSERT INTO ai_agent_runs (agent_id, trigger_source, status, input_payload, created_by)
     VALUES ($1, $2, 'started', $3::jsonb, $4)
     RETURNING id, agent_id, trigger_source, status, input_payload, output_summary, started_at, finished_at, created_at`,
    [agent.id, triggerSource, JSON.stringify(inputPayload || {}), createdBy]
  );
  return result.rows[0];
}

async function finalizeRun({ runId, status = 'completed', outputSummary = {}, errorMessage = null }) {
  const result = await db.query(
    `UPDATE ai_agent_runs
     SET status = $2,
         output_summary = $3::jsonb,
         error_message = $4,
         finished_at = NOW()
     WHERE id = $1
     RETURNING id, status, output_summary, error_message, started_at, finished_at`,
    [runId, status, JSON.stringify(outputSummary || {}), errorMessage]
  );
  return result.rows[0] || null;
}

async function insertFinding({ runId, agentId, finding }) {
  const result = await db.query(
    `INSERT INTO ai_agent_findings (
      run_id, agent_id, entity_type, entity_id, severity, finding_type, message, recommendation
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     RETURNING id, run_id, agent_id, entity_type, entity_id, severity, finding_type, message, recommendation, status, created_at`,
    [
      runId,
      agentId,
      safeText(finding.entity_type, 60),
      safeText(finding.entity_id, 120),
      safeText(finding.severity, 20).toLowerCase() || 'medium',
      safeText(finding.finding_type, 120),
      safeText(finding.message, 1500),
      JSON.stringify(finding.recommendation || {})
    ]
  );
  return result.rows[0];
}

async function createActionFromFinding({ findingId, recommendation = {} }) {
  const actionType = safeText(recommendation.action_type, 120);
  if (!actionType) return null;

  const actionPayload = recommendation.action_payload && typeof recommendation.action_payload === 'object'
    ? recommendation.action_payload
    : {};
  const requiresFounderApproval = recommendation.requires_founder_approval !== undefined
    ? asBool(recommendation.requires_founder_approval)
    : CEO_APPROVAL_ACTION_TYPES.has(actionType);
  const riskLevel = ['low', 'medium', 'high', 'critical'].includes(String(recommendation.risk_level || '').toLowerCase())
    ? String(recommendation.risk_level).toLowerCase()
    : (requiresFounderApproval ? 'high' : 'medium');
  const approvalReason = safeText(
    recommendation.approval_reason || (requiresFounderApproval ? 'Founder approval required before the AI CEO takes this action.' : ''),
    500
  ) || null;

  const result = await db.query(
    `INSERT INTO ai_agent_actions (
       finding_id, action_type, action_payload, status, requires_founder_approval, approval_reason, risk_level
     )
     VALUES ($1, $2, $3::jsonb, 'pending', $4, $5, $6)
     RETURNING id, finding_id, action_type, action_payload, status, requires_founder_approval, approval_reason, risk_level, created_at`,
    [findingId, actionType, JSON.stringify(actionPayload), requiresFounderApproval, approvalReason, riskLevel]
  );
  return result.rows[0] || null;
}

function mergeConfig(agentConfig, fallback) {
  if (!agentConfig || typeof agentConfig !== 'object') return { ...fallback };
  return { ...fallback, ...agentConfig };
}

async function safeCount(sql, params = []) {
  try {
    const result = await db.query(sql, params);
    return Number(result.rows[0]?.total || 0);
  } catch (error) {
    logger.warn('AI agent count skipped', { error: error.message });
    return 0;
  }
}

async function safeOne(sql, params = [], fallback = {}) {
  try {
    const result = await db.query(sql, params);
    return result.rows[0] || fallback;
  } catch (error) {
    logger.warn('AI agent query skipped', { error: error.message });
    return fallback;
  }
}

async function safeRows(sql, params = []) {
  try {
    const result = await db.query(sql, params);
    return result.rows || [];
  } catch (error) {
    logger.warn('AI agent rows skipped', { error: error.message });
    return [];
  }
}

async function runListingQualityGuard({ agent, limit = 40 }) {
  const config = mergeConfig(agent.config, {
    minDescriptionLength: 80,
    minPhotos: 5
  });

  const rows = await db.query(
    `SELECT
       p.id,
       p.title,
       p.status,
       p.lister_email,
       p.latitude,
       p.longitude,
       CHAR_LENGTH(COALESCE(p.description, ''))::int AS description_length,
       COALESCE(img.photo_count, 0)::int AS photo_count
     FROM properties p
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS photo_count
       FROM property_images
       WHERE property_id = p.id
     ) img ON TRUE
     WHERE p.status = 'pending'
     ORDER BY p.created_at ASC
     LIMIT $1`,
    [limit]
  );

  const findings = [];
  for (const row of rows.rows) {
    if (row.description_length < safeInt(config.minDescriptionLength, 80)) {
      findings.push({
        entity_type: 'property',
        entity_id: row.id,
        severity: 'medium',
        finding_type: 'weak_description',
        message: `Listing "${row.title}" has a short description (${row.description_length} chars).`,
        recommendation: row.lister_email
          ? {
              action_type: 'send_support_email',
              action_payload: {
                to: row.lister_email,
                subject: 'Please improve your makaug listing description',
                text: 'Your listing description is too short. Please add key details (features, road access, nearby amenities, and condition) before approval.'
              }
            }
          : {}
      });
    }

    if (row.photo_count < safeInt(config.minPhotos, 5)) {
      findings.push({
        entity_type: 'property',
        entity_id: row.id,
        severity: 'high',
        finding_type: 'insufficient_photos',
        message: `Listing "${row.title}" has ${row.photo_count} photos. Minimum is ${safeInt(config.minPhotos, 5)}.`,
        recommendation: row.lister_email
          ? {
              action_type: 'send_support_email',
              action_payload: {
                to: row.lister_email,
                subject: 'Add required photos to your makaug listing',
                text: 'Your listing needs at least 5 clear photos (front, living area, bedroom, kitchen, bathroom) before approval.'
              }
            }
          : {}
      });
    }

    if (row.latitude == null || row.longitude == null) {
      findings.push({
        entity_type: 'property',
        entity_id: row.id,
        severity: 'medium',
        finding_type: 'missing_map_coordinates',
        message: `Listing "${row.title}" has no latitude/longitude pin.`,
        recommendation: {}
      });
    }
  }

  return {
    findings,
    summary: {
      checked_properties: rows.rows.length,
      findings_count: findings.length
    }
  };
}

async function runIdMatchGuard({ agent, limit = 40 }) {
  const config = mergeConfig(agent.config, {
    ninRegex: '^(CM|CF|PM|PF)[A-Z0-9]{12}$'
  });
  const ninRegex = new RegExp(config.ninRegex, 'i');

  const rows = await db.query(
    `SELECT id, title, lister_email, id_number, id_document_name, id_document_url
     FROM properties
     WHERE status = 'pending'
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );

  const findings = [];
  for (const row of rows.rows) {
    if (!row.id_number || !ninRegex.test(String(row.id_number || '').trim())) {
      findings.push({
        entity_type: 'property',
        entity_id: row.id,
        severity: 'high',
        finding_type: 'invalid_nin_format',
        message: `Listing "${row.title}" has invalid or missing NIN format.`,
        recommendation: row.lister_email
          ? {
              action_type: 'send_support_email',
              action_payload: {
                to: row.lister_email,
                subject: 'NIN verification needed for your makaug listing',
                text: 'Please provide a valid Uganda NIN format (for example starting with CM/CF) so we can continue review.'
              }
            }
          : {}
      });
    }

    if (!row.id_document_name || !row.id_document_url) {
      findings.push({
        entity_type: 'property',
        entity_id: row.id,
        severity: 'critical',
        finding_type: 'missing_id_document',
        message: `Listing "${row.title}" has no viewable uploaded ID document.`,
        recommendation: {}
      });
    }
  }

  return {
    findings,
    summary: {
      checked_properties: rows.rows.length,
      findings_count: findings.length
    }
  };
}

async function runImageIntegrityGuard({ agent, limit = 60 }) {
  const _config = mergeConfig(agent.config, { maxDuplicateListingsPerImage: 1 });

  const dupRows = await db.query(
    `SELECT
       pi.url,
       ARRAY_AGG(DISTINCT pi.property_id)::text[] AS property_ids,
       COUNT(DISTINCT pi.property_id)::int AS listing_count
     FROM property_images pi
     JOIN properties p ON p.id = pi.property_id
     WHERE p.status IN ('pending', 'approved')
     GROUP BY pi.url
     HAVING COUNT(DISTINCT pi.property_id) > 1
     ORDER BY COUNT(DISTINCT pi.property_id) DESC
     LIMIT $1`,
    [limit]
  );

  const findings = [];
  for (const row of dupRows.rows) {
    const ids = Array.isArray(row.property_ids) ? row.property_ids : [];
    ids.forEach((propertyId) => {
      findings.push({
        entity_type: 'property',
        entity_id: propertyId,
        severity: 'high',
        finding_type: 'duplicate_image_url',
        message: `Property image URL appears in ${row.listing_count} different listings.`,
        recommendation: {
          action_type: 'set_property_status',
          action_payload: {
            property_id: propertyId,
            status: 'pending',
            reason: 'duplicate_image_detected_by_ai_agent'
          }
        }
      });
    });
  }

  return {
    findings,
    summary: {
      duplicate_image_groups: dupRows.rows.length,
      findings_count: findings.length
    }
  };
}

async function runSupportTriageAssistant({ agent, limit = 30 }) {
  const _config = mergeConfig(agent.config, { maxReportsPerRun: 30 });

  const reportRows = await db.query(
    `SELECT id, property_reference, reason, details, status
     FROM listing_reports
     WHERE status IN ('open', 'in_review')
     ORDER BY created_at ASC
     LIMIT $1`,
    [limit]
  );

  const findings = [];

  for (const report of reportRows.rows) {
    const aiReply = await suggestWhatsappAssistantReply({
      userMessage: `Create a short support response for listing report ${report.id}. Reason: ${report.reason}. Details: ${safeText(report.details, 400)}`,
      intent: 'report_listing',
      language: 'en',
      context: {
        property_reference: report.property_reference,
        report_id: report.id
      },
      source: 'support_triage_assistant'
    });

    findings.push({
      entity_type: 'listing_report',
      entity_id: report.id,
      severity: 'low',
      finding_type: 'support_reply_draft',
      message: `Draft support response generated for report ${report.id}.`,
      recommendation: {
        action_type: 'draft_support_reply',
        action_payload: {
          report_id: report.id,
          property_reference: report.property_reference,
          draft_reply: aiReply.text
        }
      }
    });
  }

  return {
    findings,
    summary: {
      checked_reports: reportRows.rows.length,
      findings_count: findings.length
    }
  };
}

async function collectCeoOperatingMetrics() {
  const [
    todayEngagement,
    last48Engagement,
    pendingListings,
    liveListings,
    pendingFieldAgentListings,
    activeFieldAgents,
    pendingBrokers,
    approvedBrokers,
    failedEmails,
    failedNotifications,
    failedWhatsapp,
    openLeads,
    hotLeads,
    overdueTasks,
    propertyRequests,
    whatsappNeedsHuman,
    whatsappInbound24h,
    whatsappOutbound24h,
    missedCalls24h,
    pendingCampaigns,
    liveAds,
    adOpenLeads,
    paidRevenue,
    quotedPipeline,
    unpaidInvoices,
    trainingCandidates,
    feedbackRows,
    recentErrors
  ] = await Promise.all([
    safeOne(
      `SELECT
         COUNT(*)::int AS events,
         COUNT(DISTINCT COALESCE(NULLIF(client_id, ''), NULLIF(user_phone, ''), payload->>'session_id'))::int AS visitors
       FROM analytics_events
       WHERE created_at >= CURRENT_DATE`,
      [],
      { events: 0, visitors: 0 }
    ),
    safeOne(
      `SELECT
         COUNT(*)::int AS events,
         COUNT(DISTINCT COALESCE(NULLIF(client_id, ''), NULLIF(user_phone, ''), payload->>'session_id'))::int AS visitors,
         COUNT(*) FILTER (WHERE event_name IN ('property_open','property_view'))::int AS property_views,
         COUNT(*) FILTER (WHERE event_name IN ('property_search','near_me_search'))::int AS searches
       FROM analytics_events
       WHERE created_at >= NOW() - INTERVAL '48 hours'`,
      [],
      { events: 0, visitors: 0, property_views: 0, searches: 0 }
    ),
    safeCount(`SELECT COUNT(*)::int AS total FROM properties p WHERE ${ceoPendingReviewWhere('p')}`),
    safeCount(`SELECT COUNT(*)::int AS total FROM properties p WHERE ${ceoPublicLiveWhere('p')}`),
    safeCount(`SELECT COUNT(*)::int AS total FROM properties p WHERE ${ceoPendingReviewWhere('p')} AND (source = 'field_agent' OR listed_via = 'field_agent' OR extra_fields->>'source_role' = 'field_agent')`),
    safeCount("SELECT COUNT(*)::int AS total FROM users WHERE role = 'field_agent' AND status = 'active'"),
    safeCount("SELECT COUNT(*)::int AS total FROM agents WHERE status = 'pending' OR COALESCE(registration_status, 'not_registered') <> 'registered'"),
    safeCount("SELECT COUNT(*)::int AS total FROM agents WHERE status = 'approved' AND COALESCE(registration_status, 'not_registered') = 'registered'"),
    safeCount("SELECT COUNT(*)::int AS total FROM email_logs WHERE status IN ('failed','provider_missing','bounced','error')"),
    safeCount("SELECT COUNT(*)::int AS total FROM notifications WHERE status IN ('failed','provider_missing','bounced','error')"),
    safeCount("SELECT COUNT(*)::int AS total FROM whatsapp_message_logs WHERE status IN ('failed','provider_missing','error')"),
    safeCount("SELECT COUNT(*)::int AS total FROM leads WHERE lead_status = 'open'"),
    safeCount("SELECT COUNT(*)::int AS total FROM leads WHERE lead_status = 'open' AND (priority IN ('high','urgent') OR lead_score >= 50)"),
    safeCount("SELECT COUNT(*)::int AS total FROM lead_tasks WHERE status = 'open' AND due_at < NOW()"),
    safeCount("SELECT COUNT(*)::int AS total FROM property_requests"),
    safeCount("SELECT COUNT(*)::int AS total FROM whatsapp_conversation_state WHERE status IN ('needs_human','escalated')"),
    safeCount("SELECT COUNT(*)::int AS total FROM whatsapp_messages WHERE direction = 'inbound' AND created_at >= NOW() - INTERVAL '24 hours'"),
    safeCount("SELECT COUNT(*)::int AS total FROM whatsapp_messages WHERE direction = 'outbound' AND created_at >= NOW() - INTERVAL '24 hours'"),
    safeCount("SELECT COUNT(*)::int AS total FROM whatsapp_call_events WHERE created_at >= NOW() - INTERVAL '24 hours'"),
    safeCount("SELECT COUNT(*)::int AS total FROM advertising_campaigns WHERE status IN ('draft','awaiting_payment','paid','paid_pending_approval','changes_requested')"),
    safeCount("SELECT COUNT(*)::int AS total FROM advertising_campaigns WHERE status = 'live'"),
    safeCount("SELECT COUNT(*)::int AS total FROM advertising_inquiries WHERE status IN ('new','contacted','proposal_sent')"),
    safeOne("SELECT COALESCE(SUM(paid_amount_ugx), 0)::bigint AS total FROM advertising_campaigns WHERE payment_status = 'paid'", [], { total: 0 }).then((row) => Number(row.total || 0)),
    safeOne("SELECT COALESCE(SUM(quoted_amount_ugx), 0)::bigint AS total FROM advertising_campaigns WHERE status NOT IN ('cancelled')", [], { total: 0 }).then((row) => Number(row.total || 0)),
    safeCount("SELECT COUNT(*)::int AS total FROM invoices WHERE status NOT IN ('paid','void','cancelled')"),
    safeCount("SELECT COUNT(*)::int AS total FROM ai_events_normalized WHERE is_training_candidate = TRUE AND created_at >= NOW() - INTERVAL '7 days'"),
    safeCount("SELECT COUNT(*)::int AS total FROM ai_model_feedback WHERE created_at >= NOW() - INTERVAL '7 days'"),
    safeCount("SELECT COUNT(*)::int AS total FROM ai_agent_runs WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '24 hours'")
  ]);

  return {
    generated_at: new Date().toISOString(),
    engagement: {
      today_events: Number(todayEngagement.events || 0),
      today_visitors: Number(todayEngagement.visitors || 0),
      last_48h_events: Number(last48Engagement.events || 0),
      last_48h_visitors: Number(last48Engagement.visitors || 0),
      last_48h_property_views: Number(last48Engagement.property_views || 0),
      last_48h_searches: Number(last48Engagement.searches || 0)
    },
    listings: {
      pending: pendingListings,
      live: liveListings,
      pending_field_agent: pendingFieldAgentListings
    },
    brokers_and_field_agents: {
      pending_brokers: pendingBrokers,
      approved_brokers: approvedBrokers,
      active_field_agents: activeFieldAgents,
      pending_field_agent_listings: pendingFieldAgentListings
    },
    leads: {
      open: openLeads,
      hot: hotLeads,
      overdue_tasks: overdueTasks,
      property_requests: propertyRequests
    },
    communications: {
      failed_emails: failedEmails,
      failed_notifications: failedNotifications,
      failed_whatsapp: failedWhatsapp,
      whatsapp_needs_human: whatsappNeedsHuman,
      whatsapp_inbound_24h: whatsappInbound24h,
      whatsapp_outbound_24h: whatsappOutbound24h,
      missed_calls_24h: missedCalls24h
    },
    advertising: {
      pending_campaigns: pendingCampaigns,
      live_ads: liveAds,
      open_ad_leads: adOpenLeads,
      paid_revenue_ugx: paidRevenue,
      quoted_pipeline_ugx: quotedPipeline,
      unpaid_invoices: unpaidInvoices
    },
    learning: {
      training_candidates_7d: trainingCandidates,
      feedback_rows_7d: feedbackRows
    },
    system_health: {
      failed_ai_agent_runs_24h: recentErrors
    }
  };
}

function buildCeoPriorities(metrics, config = {}) {
  const priorities = [];
  const addPriority = (item) => priorities.push({
    requires_founder_approval: false,
    ...item
  });
  const leadSlaHours = safeInt(config.leadSlaHours, 4);

  if (metrics.listings.pending > 0) {
    addPriority({
      area: 'listing_review',
      severity: metrics.listings.pending >= safeInt(config.reviewBacklogHigh, 20) ? 'high' : 'medium',
      title: 'Listings waiting for approval',
      metric: metrics.listings.pending,
      route: '/admin/moderation',
      action: 'Review, approve, reject, or request changes. AI CEO must not make listings live.'
    });
  }
  if (metrics.brokers_and_field_agents.pending_brokers > 0) {
    addPriority({
      area: 'broker_and_field_agent_ops',
      severity: metrics.brokers_and_field_agents.pending_brokers >= 5 ? 'high' : 'medium',
      title: 'Broker accounts need founder review',
      metric: metrics.brokers_and_field_agents.pending_brokers,
      route: '/admin/accounts',
      action: 'Check ID, privacy consent, profile quality, and approve only when ready.',
      requires_founder_approval: true
    });
  }
  if (metrics.leads.hot > 0 || metrics.leads.overdue_tasks > 0) {
    addPriority({
      area: 'crm_leads',
      severity: metrics.leads.overdue_tasks > 0 ? 'high' : 'medium',
      title: 'Lead follow-up queue',
      metric: metrics.leads.hot + metrics.leads.overdue_tasks,
      route: '/admin/crm',
      action: `Follow hot leads and tasks older than ${leadSlaHours} hours first; draft replies before sending.`
    });
  }
  if (metrics.communications.whatsapp_needs_human > 0 || metrics.communications.missed_calls_24h > 0) {
    addPriority({
      area: 'whatsapp_ai_health',
      severity: metrics.communications.whatsapp_needs_human > 0 ? 'high' : 'medium',
      title: 'WhatsApp conversations need human attention',
      metric: metrics.communications.whatsapp_needs_human + metrics.communications.missed_calls_24h,
      route: '/admin/whatsapp-inbox',
      action: 'Review escalations, missed calls, language handling, and unresolved conversations.'
    });
  }
  if ((metrics.communications.failed_emails + metrics.communications.failed_notifications + metrics.communications.failed_whatsapp) > 0) {
    addPriority({
      area: 'email_sms_health',
      severity: (metrics.communications.failed_emails + metrics.communications.failed_notifications + metrics.communications.failed_whatsapp) >= safeInt(config.failedNotificationHigh, 5) ? 'critical' : 'high',
      title: 'Failed communication provider logs',
      metric: metrics.communications.failed_emails + metrics.communications.failed_notifications + metrics.communications.failed_whatsapp,
      route: '/admin/notifications',
      action: 'Check email, SMS, and WhatsApp failures before customer trust is affected.'
    });
  }
  if (metrics.advertising.open_ad_leads > 0 || metrics.advertising.pending_campaigns > 0 || metrics.advertising.unpaid_invoices > 0) {
    addPriority({
      area: 'advertising_revenue',
      severity: metrics.advertising.unpaid_invoices > 0 ? 'high' : 'medium',
      title: 'Advertising revenue follow-up',
      metric: metrics.advertising.open_ad_leads + metrics.advertising.pending_campaigns + metrics.advertising.unpaid_invoices,
      route: '/admin/advertising',
      action: 'Turn advertiser interest into reviewed campaign drafts, invoices, payments, and live placements.',
      requires_founder_approval: true
    });
  }
  if (metrics.system_health.failed_ai_agent_runs_24h > 0) {
    addPriority({
      area: 'site_health',
      severity: 'critical',
      title: 'AI operations failures',
      metric: metrics.system_health.failed_ai_agent_runs_24h,
      route: '/admin/setup-status',
      action: 'Inspect failed agent runs, provider health, and backend connection probes.'
    });
  }
  if (metrics.learning.training_candidates_7d > 0 || metrics.learning.feedback_rows_7d > 0) {
    addPriority({
      area: 'llm_learning',
      severity: 'low',
      title: 'Learning data ready for review',
      metric: metrics.learning.training_candidates_7d + metrics.learning.feedback_rows_7d,
      route: '/admin/whatsapp-inbox',
      action: 'Review training candidates before feeding them into the LLM improvement loop.'
    });
  }

  return priorities;
}

function buildCeoApprovalsRequired(metrics) {
  return [
    {
      area: 'listing_review',
      label: 'Listings cannot go live without founder/admin approval',
      count: metrics.listings.pending,
      route: '/admin/moderation'
    },
    {
      area: 'broker_review',
      label: 'Broker applications require ID and account review',
      count: metrics.brokers_and_field_agents.pending_brokers,
      route: '/admin/accounts'
    },
    {
      area: 'advertising_revenue',
      label: 'Campaigns, spend, public placements, and paid boosts need founder approval',
      count: metrics.advertising.pending_campaigns + metrics.advertising.unpaid_invoices,
      route: '/admin/advertising'
    },
    {
      area: 'external_comms',
      label: 'Low-confidence customer replies, social posts, and lead-gen outreach remain draft-only until reviewed',
      count: metrics.leads.hot + metrics.communications.whatsapp_needs_human,
      route: '/admin/crm'
    }
  ].filter((item) => item.count > 0 || item.area === 'external_comms');
}

function summarizeCeoReport(metrics, priorities) {
  const topPriority = priorities[0]?.title || 'No urgent blocker found';
  return [
    `makaug AI CEO morning report: ${metrics.engagement.today_visitors} visitor(s) today, ${metrics.engagement.last_48h_property_views} property view(s) in the last 48h.`,
    `${metrics.listings.pending} listing(s) need review, ${metrics.brokers_and_field_agents.pending_brokers} broker application(s) need review, ${metrics.leads.open} lead(s) are open.`,
    `Advertising shows UGX ${metrics.advertising.paid_revenue_ugx} paid and UGX ${metrics.advertising.quoted_pipeline_ugx} quoted pipeline.`,
    `Top intervention: ${topPriority}.`
  ].join(' ');
}

async function buildManagingDirectorMorningReport({ agent = null, run = null, reportType = 'morning' } = {}) {
  const ceoAgent = agent || await getAgentByCode(AI_CEO_AGENT_CODE);
  const config = mergeConfig(ceoAgent?.config, {});
  const metrics = await collectCeoOperatingMetrics();
  const priorities = buildCeoPriorities(metrics, config);
  const approvalsRequired = buildCeoApprovalsRequired(metrics);
  const killSwitches = getCeoKillSwitches(config);

  return {
    report_type: reportType,
    generated_at: metrics.generated_at,
    run_id: run?.id || null,
    agent_code: AI_CEO_AGENT_CODE,
    summary: summarizeCeoReport(metrics, priorities),
    metrics,
    priorities,
    approvals_required: approvalsRequired,
    kill_switches: killSwitches,
    delivery_channels: getCeoDeliveryChannels(config),
    operating_areas: Array.isArray(config.operatingAreas) && config.operatingAreas.length
      ? config.operatingAreas
      : CEO_OPERATING_AREAS
  };
}

async function saveCeoReport({ report, runId = null, createdBy = 'ai_ceo' }) {
  const result = await db.query(
    `INSERT INTO ai_ceo_reports (
       run_id, report_type, status, summary, metrics, priorities, approvals_required, kill_switches, delivery_channels, created_by
     )
     VALUES ($1, $2, 'sent_to_founder', $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9)
     RETURNING id, run_id, report_date, report_type, status, summary, metrics, priorities, approvals_required, kill_switches, delivery_channels, created_by, created_at`,
    [
      runId,
      safeText(report.report_type, 30) || 'morning',
      safeText(report.summary, 2000),
      JSON.stringify(report.metrics || {}),
      JSON.stringify(report.priorities || []),
      JSON.stringify(report.approvals_required || []),
      JSON.stringify(report.kill_switches || {}),
      JSON.stringify(report.delivery_channels || []),
      safeText(createdBy, 120) || 'ai_ceo'
    ]
  );
  return result.rows[0] || null;
}

async function runManagingDirectorCeo({ agent }) {
  const config = mergeConfig(agent.config, {
    maxFindings: 25,
    reviewBacklogHigh: 20,
    failedNotificationHigh: 5,
    leadSlaHours: 4
  });
  const report = await buildManagingDirectorMorningReport({ agent });

  const findings = (report.priorities || []).slice(0, safeInt(config.maxFindings, 25)).map((priority) => {
    const approvalRecommendation = priority.requires_founder_approval
      ? buildApprovalRecommendation({
          actionType: 'founder_review_required',
          payload: {
            route: priority.route,
            area: priority.area,
            title: priority.title,
            recommended_action: priority.action
          },
          reason: `${priority.title} needs founder/admin approval or review before any external change.`,
          riskLevel: priority.severity === 'critical' ? 'critical' : 'high'
        })
      : {
          action_type: 'open_admin_workflow',
          action_payload: {
            path: priority.route,
            area: priority.area,
            focus: priority.title,
            recommended_action: priority.action
          },
          risk_level: priority.severity === 'critical' ? 'high' : 'medium',
          requires_founder_approval: false
        };
    return {
      entity_type: priority.area,
      entity_id: priority.area,
      severity: priority.severity,
      finding_type: priority.area === 'broker_and_field_agent_ops' ? 'broker_approval_backlog' : priority.area,
      message: `${priority.title}: ${priority.metric}. ${priority.action}`,
      recommendation: approvalRecommendation
    };
  });

  return {
    findings,
    summary: {
      role: AI_CEO_AGENT_CODE,
      ai_ceo_operating_system: true,
      morning_report_ready: true,
      pending_listings: report.metrics.listings.pending,
      pending_brokers: report.metrics.brokers_and_field_agents.pending_brokers,
      failed_emails: report.metrics.communications.failed_emails,
      failed_notifications: report.metrics.communications.failed_notifications,
      failed_whatsapp: report.metrics.communications.failed_whatsapp,
      open_leads: report.metrics.leads.open,
      pending_campaigns: report.metrics.advertising.pending_campaigns,
      unpaid_invoices: report.metrics.advertising.unpaid_invoices,
      paid_revenue_ugx: report.metrics.advertising.paid_revenue_ugx,
      kill_switches: report.kill_switches,
      approvals_required: report.approvals_required,
      findings_count: findings.length
    }
  };
}

async function runAgentChecks({ agent, limit = 40 }) {
  if (agent.code === AI_CEO_AGENT_CODE) return runManagingDirectorCeo({ agent, limit });
  if (agent.code === 'listing_quality_guard') return runListingQualityGuard({ agent, limit });
  if (agent.code === 'id_match_guard') return runIdMatchGuard({ agent, limit });
  if (agent.code === 'image_integrity_guard') return runImageIntegrityGuard({ agent, limit });
  if (agent.code === 'support_triage_assistant') return runSupportTriageAssistant({ agent, limit });

  return {
    findings: [],
    summary: {
      skipped: true,
      reason: `No handler implemented for ${agent.code}`
    }
  };
}

async function runAgent({ agentCode, triggerSource = 'manual', createdBy = 'admin_api_key', limit = 40 }) {
  const agent = await getAgentByCode(agentCode);
  if (!agent) {
    throw new Error(`Agent not found: ${agentCode}`);
  }

  const run = await insertRun({
    agent,
    triggerSource,
    createdBy,
    inputPayload: { limit }
  });

  try {
    const output = await runAgentChecks({ agent, limit });
    const insertedFindings = [];

    for (const finding of output.findings || []) {
      const inserted = await insertFinding({
        runId: run.id,
        agentId: agent.id,
        finding
      });
      insertedFindings.push(inserted);

      if (agent.run_mode === 'recommend' || agent.run_mode === 'auto') {
        await createActionFromFinding({
          findingId: inserted.id,
          recommendation: inserted.recommendation
        });
      }
    }

    const summary = {
      ...(output.summary || {}),
      findings_created: insertedFindings.length,
      run_mode: agent.run_mode
    };

    const finalized = await finalizeRun({
      runId: run.id,
      status: 'completed',
      outputSummary: summary
    });

    return {
      agent,
      run: finalized,
      findings: insertedFindings
    };
  } catch (error) {
    logger.error('AI agent run failed', { agent: agent.code, error: error.message });
    const finalized = await finalizeRun({
      runId: run.id,
      status: 'failed',
      outputSummary: { failed: true },
      errorMessage: error.message
    });
    return {
      agent,
      run: finalized,
      findings: []
    };
  }
}

async function runAllEnabledAgents({ triggerSource = 'manual', createdBy = 'admin_api_key', limit = 40 }) {
  const agents = await db.query(
    `SELECT id, code, name, description, enabled, run_mode, config
     FROM ai_agents
     WHERE enabled = TRUE
     ORDER BY code ASC`
  );

  const results = [];
  for (const agent of agents.rows) {
    // sequential by design to control DB load and keep audit order deterministic
    // eslint-disable-next-line no-await-in-loop
    const result = await runAgent({
      agentCode: agent.code,
      triggerSource,
      createdBy,
      limit
    });
    results.push(result);
  }
  return results;
}

async function runCeoMorningReport({ triggerSource = 'manual_morning_report', createdBy = 'founder_dashboard', limit = 40 } = {}) {
  const runResult = await runAgent({
    agentCode: AI_CEO_AGENT_CODE,
    triggerSource,
    createdBy,
    limit
  });
  const report = await buildManagingDirectorMorningReport({
    agent: runResult.agent,
    run: runResult.run,
    reportType: 'morning'
  });
  const savedReport = await saveCeoReport({
    report,
    runId: runResult.run?.id || null,
    createdBy
  });
  return {
    agent: runResult.agent,
    run: runResult.run,
    findings: runResult.findings,
    report: savedReport || report
  };
}

async function getCeoStatus() {
  const agent = await getAgentByCode(AI_CEO_AGENT_CODE);
  const config = mergeConfig(agent?.config, {});
  const [currentMetrics, lastReport, lastRun, openFindings, pendingActions, recentCommands] = await Promise.all([
    collectCeoOperatingMetrics(),
    safeOne(
      `SELECT id, run_id, report_date, report_type, status, summary, metrics, priorities, approvals_required, kill_switches, delivery_channels, created_by, created_at
       FROM ai_ceo_reports
       ORDER BY created_at DESC
       LIMIT 1`,
      [],
      null
    ),
    safeOne(
      `SELECT r.id, r.status, r.output_summary, r.error_message, r.started_at, r.finished_at, r.created_at
       FROM ai_agent_runs r
       JOIN ai_agents a ON a.id = r.agent_id
       WHERE a.code = $1
       ORDER BY r.created_at DESC
       LIMIT 1`,
      [AI_CEO_AGENT_CODE],
      null
    ),
    safeRows(
      `SELECT f.id, f.severity, f.finding_type, f.message, f.recommendation, f.status, f.created_at
       FROM ai_agent_findings f
       JOIN ai_agents a ON a.id = f.agent_id
       WHERE a.code = $1
         AND f.status = 'open'
       ORDER BY
         CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
         f.created_at DESC
       LIMIT 20`,
      [AI_CEO_AGENT_CODE]
    ),
    safeRows(
      `SELECT act.id, act.action_type, act.action_payload, act.status, act.requires_founder_approval, act.approval_reason, act.risk_level, act.created_at
       FROM ai_agent_actions act
       JOIN ai_agent_findings f ON f.id = act.finding_id
       JOIN ai_agents a ON a.id = f.agent_id
       WHERE a.code = $1
         AND act.status IN ('pending','failed')
       ORDER BY
         CASE act.risk_level WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
         act.created_at DESC
       LIMIT 20`,
      [AI_CEO_AGENT_CODE]
    ),
    safeRows(
      `SELECT id, channel, requested_by, command_text, status, intent, response_summary, requires_founder_approval, created_at, handled_at
       FROM ai_ceo_commands
       ORDER BY created_at DESC
       LIMIT 10`
    )
  ]);

  return {
    agent,
    enabled: !!agent?.enabled,
    run_mode: agent?.run_mode || 'recommend',
    operating_areas: Array.isArray(config.operatingAreas) && config.operatingAreas.length
      ? config.operatingAreas
      : CEO_OPERATING_AREAS,
    kill_switches: getCeoKillSwitches(config),
    delivery_channels: getCeoDeliveryChannels(config),
    current_metrics: currentMetrics,
    current_dashboard_metrics: {
      pending_listings: Number(currentMetrics?.listings?.pending || 0),
      live_listings: Number(currentMetrics?.listings?.live || 0),
      open_leads: Number(currentMetrics?.leads?.open || 0),
      broker_pending: Number(currentMetrics?.brokers_and_field_agents?.pending_brokers || 0)
    },
    last_report: lastReport,
    last_run: lastRun,
    open_findings: openFindings,
    pending_actions: pendingActions,
    recent_commands: recentCommands,
    guardrails: Array.isArray(config.guardrails) ? config.guardrails : []
  };
}

function detectCeoCommandIntent(commandText) {
  const text = String(commandText || '').toLowerCase();
  if (/\b(approve|go live|delete|remove|post|publish|spend|pay|change password|grant access|revoke access|bulk|blast)\b/.test(text)) return 'approval_guardrail';
  if (/money|revenue|advert|ad |ads|invoice|payment|boost/.test(text)) return 'advertising_revenue';
  if (/visitor|visited|traffic|view|search/.test(text)) return 'traffic_report';
  if (/listing|property|properties|review/.test(text)) return 'listing_report';
  if (/lead|query|queries|customer|callback|viewing/.test(text)) return 'lead_report';
  if (/whatsapp|call|message|language|chatbot/.test(text)) return 'whatsapp_health';
  if (/field agent|agent|broker/.test(text)) return 'agent_ops';
  if (/email|sms|notification/.test(text)) return 'communication_health';
  if (/learn|llm|training|model/.test(text)) return 'llm_learning';
  return 'morning_report';
}

function buildCeoCommandResponse({ intent, commandText, report }) {
  const metrics = report.metrics || {};
  const dangerous = intent === 'approval_guardrail';
  const topPriorities = (report.priorities || []).slice(0, 4);
  let responseSummary = report.summary;
  let responsePayload = {
    intent,
    command_text: safeText(commandText, 1000),
    metrics,
    priorities: topPriorities,
    next_actions: topPriorities.map((item) => ({
      title: item.title,
      route: item.route,
      action: item.action,
      requires_founder_approval: !!item.requires_founder_approval
    })),
    kill_switches: report.kill_switches
  };

  if (intent === 'traffic_report') {
    responseSummary = `Traffic: ${metrics.engagement.today_visitors} visitor(s) today, ${metrics.engagement.today_events} event(s) today, ${metrics.engagement.last_48h_property_views} property view(s), and ${metrics.engagement.last_48h_searches} search event(s) in the last 48h.`;
  } else if (intent === 'listing_report') {
    responseSummary = `Listings: ${metrics.listings.live} live, ${metrics.listings.pending} pending review, and ${metrics.listings.pending_field_agent} pending from field-agent flows. Nothing goes live until founder/admin approval.`;
  } else if (intent === 'lead_report') {
    responseSummary = `Leads: ${metrics.leads.open} open, ${metrics.leads.hot} hot/high-value, ${metrics.leads.overdue_tasks} overdue task(s), and ${metrics.leads.property_requests} property request(s).`;
  } else if (intent === 'whatsapp_health') {
    responseSummary = `WhatsApp: ${metrics.communications.whatsapp_inbound_24h} inbound and ${metrics.communications.whatsapp_outbound_24h} outbound message(s) in 24h, ${metrics.communications.whatsapp_needs_human} needing human review, ${metrics.communications.missed_calls_24h} missed call event(s), and ${metrics.communications.failed_whatsapp} failed WhatsApp log(s).`;
  } else if (intent === 'agent_ops') {
    responseSummary = `Agents: ${metrics.brokers_and_field_agents.pending_brokers} broker application(s) need review, ${metrics.brokers_and_field_agents.approved_brokers} broker(s) are registered, ${metrics.brokers_and_field_agents.active_field_agents} field agent(s) are active, and ${metrics.brokers_and_field_agents.pending_field_agent_listings} field-agent listing(s) are pending.`;
  } else if (intent === 'communication_health') {
    responseSummary = `Comms health: ${metrics.communications.failed_emails} failed email log(s), ${metrics.communications.failed_notifications} failed notification(s), and ${metrics.communications.failed_whatsapp} failed WhatsApp log(s).`;
  } else if (intent === 'advertising_revenue') {
    responseSummary = `Revenue: UGX ${metrics.advertising.paid_revenue_ugx} paid, UGX ${metrics.advertising.quoted_pipeline_ugx} quoted pipeline, ${metrics.advertising.open_ad_leads} ad lead(s), ${metrics.advertising.pending_campaigns} pending campaign(s), and ${metrics.advertising.unpaid_invoices} unpaid invoice(s).`;
  } else if (intent === 'llm_learning') {
    responseSummary = `Learning loop: ${metrics.learning.training_candidates_7d} training candidate(s) and ${metrics.learning.feedback_rows_7d} model feedback row(s) are available from the last 7 days. Review before feeding improvements into the chatbot.`;
  } else if (dangerous) {
    responseSummary = 'Guardrail active: I can prepare the recommendation, draft, route, or report, but I will not approve listings, delete data, publish posts, spend money, send bulk outreach, or change access without founder approval.';
    responsePayload = {
      ...responsePayload,
      blocked_action: true,
      approval_required: true
    };
  }

  return {
    responseSummary,
    responsePayload,
    requiresFounderApproval: dangerous
  };
}

async function handleCeoCommand({ commandText, channel = 'dashboard', requestedBy = 'founder_dashboard' }) {
  const cleanCommand = safeText(commandText, 2000);
  if (!cleanCommand) {
    throw new Error('AI CEO command is required');
  }
  const normalizedChannel = ['dashboard', 'whatsapp_owner', 'telegram_owner', 'email', 'system'].includes(String(channel || '').trim())
    ? String(channel).trim()
    : 'dashboard';

  const agent = await getAgentByCode(AI_CEO_AGENT_CODE);
  const report = await buildManagingDirectorMorningReport({ agent, reportType: 'command' });
  const intent = detectCeoCommandIntent(cleanCommand);
  const response = buildCeoCommandResponse({ intent, commandText: cleanCommand, report });
  const status = response.requiresFounderApproval ? 'needs_approval' : 'answered';

  const inserted = await db.query(
    `INSERT INTO ai_ceo_commands (
       channel, requested_by, command_text, status, intent, response_summary, response_payload, requires_founder_approval, handled_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, NOW())
     RETURNING id, channel, requested_by, command_text, status, intent, response_summary, response_payload, requires_founder_approval, created_at, handled_at`,
    [
      normalizedChannel,
      safeText(requestedBy, 120) || 'founder_dashboard',
      cleanCommand,
      status,
      intent,
      safeText(response.responseSummary, 3000),
      JSON.stringify(response.responsePayload || {}),
      response.requiresFounderApproval
    ]
  );

  return {
    command: inserted.rows[0],
    report,
    response: {
      summary: response.responseSummary,
      payload: response.responsePayload,
      requires_founder_approval: response.requiresFounderApproval
    }
  };
}

async function listRuns({ limit = 50 }) {
  const result = await db.query(
    `SELECT
       r.id,
       r.agent_id,
       a.code AS agent_code,
       a.name AS agent_name,
       r.trigger_source,
       r.status,
       r.input_payload,
       r.output_summary,
       r.error_message,
       r.created_by,
       r.started_at,
       r.finished_at,
       r.created_at
     FROM ai_agent_runs r
     JOIN ai_agents a ON a.id = r.agent_id
     ORDER BY r.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

async function listFindings({ status = '', severity = '', agentCode = '', limit = 100 }) {
  const filters = [];
  const values = [];

  if (status) {
    values.push(status);
    filters.push(`f.status = $${values.length}`);
  }
  if (severity) {
    values.push(severity);
    filters.push(`f.severity = $${values.length}`);
  }
  if (agentCode) {
    values.push(agentCode);
    filters.push(`a.code = $${values.length}`);
  }

  values.push(limit);
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const result = await db.query(
    `SELECT
       f.id,
       f.run_id,
       f.agent_id,
       a.code AS agent_code,
       a.name AS agent_name,
       f.entity_type,
       f.entity_id,
       f.severity,
       f.finding_type,
       f.message,
       f.recommendation,
       f.status,
       f.notes,
       f.resolved_by,
       f.resolved_at,
       f.created_at
     FROM ai_agent_findings f
     JOIN ai_agents a ON a.id = f.agent_id
     ${where}
     ORDER BY f.created_at DESC
     LIMIT $${values.length}`,
    values
  );

  return result.rows;
}

async function decideFinding({ findingId, decision, actorId = 'admin_api_key', notes = '' }) {
  const normalized = String(decision || '').trim().toLowerCase();
  if (!['accepted', 'dismissed', 'resolved'].includes(normalized)) {
    throw new Error('Invalid decision');
  }

  const updated = await db.query(
    `UPDATE ai_agent_findings
     SET status = $2,
         notes = $3,
         resolved_by = $4,
         resolved_at = NOW()
     WHERE id = $1
     RETURNING id, recommendation, status, resolved_by, resolved_at`,
    [findingId, normalized, safeText(notes, 1200) || null, actorId]
  );

  const finding = updated.rows[0];
  if (!finding) return null;

  let action = null;
  if (normalized === 'accepted') {
    action = await createActionFromFinding({
      findingId: finding.id,
      recommendation: finding.recommendation
    });
  }

  return {
    finding,
    action
  };
}

async function listActions({ status = '', limit = 100 }) {
  const values = [];
  let where = '';
  if (status) {
    values.push(status);
    where = `WHERE a.status = $1`;
  }
  values.push(limit);

  const result = await db.query(
    `SELECT
       a.id,
       a.finding_id,
       a.action_type,
       a.action_payload,
       a.status,
       a.approved_by,
       a.executed_by,
       a.requires_founder_approval,
       a.approval_reason,
       a.risk_level,
       a.result_payload,
       a.error_message,
       a.created_at,
       a.updated_at
     FROM ai_agent_actions a
     ${where}
     ORDER BY a.created_at DESC
     LIMIT $${values.length}`,
    values
  );
  return result.rows;
}

async function approveAction({ actionId, actorId = 'admin_api_key' }) {
  const result = await db.query(
    `UPDATE ai_agent_actions
     SET status = 'approved',
         approved_by = $2,
         updated_at = NOW()
     WHERE id = $1
       AND status IN ('pending', 'failed')
     RETURNING id, action_type, action_payload, status, approved_by, requires_founder_approval, approval_reason, risk_level, updated_at`,
    [actionId, actorId]
  );
  return result.rows[0] || null;
}

async function executeAction({ actionId, actorId = 'super_admin_key' }) {
  const actionResult = await db.query(
    `SELECT id, finding_id, action_type, action_payload, status, requires_founder_approval, approval_reason, risk_level
     FROM ai_agent_actions
     WHERE id = $1
     LIMIT 1`,
    [actionId]
  );
  const action = actionResult.rows[0];
  if (!action) return null;

  if (!['approved', 'pending', 'failed'].includes(action.status)) {
    throw new Error('Action is not executable in current state');
  }
  if (action.requires_founder_approval && action.status !== 'approved') {
    throw new Error('Founder approval required before this AI CEO action can execute');
  }

  const payload = action.action_payload && typeof action.action_payload === 'object'
    ? action.action_payload
    : {};

  try {
    let resultPayload = {};

    if (action.action_type === 'set_property_status') {
      const propertyId = safeText(payload.property_id, 120);
      const status = safeText(payload.status, 30).toLowerCase();
      const reason = safeText(payload.reason, 500);

      if (!propertyId || !status) throw new Error('set_property_status missing property_id or status');

      const updated = await db.query(
        `UPDATE properties
         SET status = $2,
             reviewed_at = NOW(),
             extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object('ai_action_reason', $3)
         WHERE id = $1
         RETURNING id, status, reviewed_at`,
        [propertyId, status, reason || null]
      );

      resultPayload = {
        updated: updated.rows[0] || null
      };
    } else if (action.action_type === 'send_support_email') {
      const emailResult = await sendSupportEmail({
        to: payload.to || process.env.SUPPORT_EMAIL || 'info@makaug.com',
        subject: safeText(payload.subject, 200) || 'makaug follow-up',
        text: safeText(payload.text, 5000) || 'No message body provided.'
      });

      resultPayload = {
        email: emailResult
      };
    } else if (action.action_type === 'update_agent_status') {
      const agentId = safeText(payload.agent_id, 120);
      const status = safeText(payload.status, 30).toLowerCase();
      if (!agentId || !status) throw new Error('update_agent_status missing agent_id or status');

      const updated = await db.query(
        `UPDATE agents
         SET status = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING id, status, updated_at`,
        [agentId, status]
      );

      resultPayload = {
        updated: updated.rows[0] || null
      };
    } else if (action.action_type === 'draft_support_reply') {
      resultPayload = {
        draft: payload
      };
    } else if ([
      'open_admin_workflow',
      'founder_review_required',
      'draft_customer_reply',
      'draft_outreach_email',
      'draft_social_post',
      'run_health_probe',
      'notify_founder'
    ].includes(action.action_type)) {
      resultPayload = {
        no_external_side_effect: true,
        review_payload: payload,
        guardrail: action.requires_founder_approval
          ? 'Founder approval was required for this reviewed AI CEO action.'
          : 'No external mutation was performed.'
      };
    } else {
      throw new Error(`Unsupported action_type: ${action.action_type}`);
    }

    const updatedAction = await db.query(
      `UPDATE ai_agent_actions
       SET status = 'executed',
           executed_by = $2,
           result_payload = $3::jsonb,
           error_message = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, action_type, status, executed_by, result_payload, updated_at`,
      [action.id, actorId, JSON.stringify(resultPayload)]
    );

    if (action.finding_id) {
      await db.query(
        `UPDATE ai_agent_findings
         SET status = 'resolved',
             resolved_by = $2,
             resolved_at = NOW(),
             notes = COALESCE(notes, '') || CASE WHEN COALESCE(notes, '') = '' THEN '' ELSE E'\n' END || 'Resolved by AI action execution.'
         WHERE id = $1`,
        [action.finding_id, actorId]
      );
    }

    return updatedAction.rows[0] || null;
  } catch (error) {
    await db.query(
      `UPDATE ai_agent_actions
       SET status = 'failed',
           executed_by = $2,
           error_message = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [action.id, actorId, safeText(error.message, 1000)]
    );
    throw error;
  }
}

module.exports = {
  listAgents,
  updateAgent,
  runAgent,
  runAllEnabledAgents,
  runCeoMorningReport,
  getCeoStatus,
  handleCeoCommand,
  buildManagingDirectorMorningReport,
  listRuns,
  listFindings,
  decideFinding,
  listActions,
  approveAction,
  executeAction
};
