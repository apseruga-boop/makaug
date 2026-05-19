const db = require('../config/database');
const logger = require('../config/logger');
const { sendSupportEmail, getSupportEmail } = require('./emailService');
const { queueWhatsappWebBridgeMessage } = require('./whatsappWebBridgeService');

const AI_CEO_AGENT_CODE = 'managing_director_ceo';

const DEFAULT_KILL_SWITCHES = {
  autonomous_listing_approval: false,
  autonomous_public_posting: false,
  autonomous_payment_spend: false,
  autonomous_bulk_outreach: false,
  autonomous_password_or_access_changes: false,
  autonomous_data_deletion: false,
  email_direct_send_without_founder_command: false,
  founder_approval_required_for_external_actions: true
};

const PHONE_COMMAND_KEYWORDS = [
  'ceo',
  'md',
  'report',
  'morning',
  'status',
  'visitors',
  'visited',
  'listings',
  'pending',
  'leads',
  'whatsapp',
  'email',
  'reply',
  'respond',
  'send',
  'revenue',
  'advertising',
  'agents',
  'brokers',
  'health'
];

const REPORT_RECIPIENT_READ_ONLY_INTENTS = new Set([
  'morning_report',
  'whatsapp_health',
  'lead_report',
  'listing_report',
  'agent_report',
  'revenue_report',
  'general'
]);

function safeText(value, max = 4000) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function asBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = String(value || '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

function summarizeError(error) {
  return error?.message || error?.code || error?.name || String(error || '') || 'unknown_error';
}

function normalizeDigits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function normalizePhoneForOwnerMatch(value = '') {
  const dryRunMatch = String(value || '').match(/^dryrun:([^:]+):/i);
  if (dryRunMatch) return normalizePhoneForOwnerMatch(dryRunMatch[1]);
  const digits = normalizeDigits(value);
  if (!digits) return '';
  if (digits.startsWith('00')) return digits.slice(2);
  return digits;
}

function envList(...keys) {
  return keys
    .flatMap((key) => String(process.env[key] || '').split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

function getConfiguredOwnerPhones() {
  return envList(
    'AI_CEO_OWNER_PHONES',
    'AI_CEO_OWNER_PHONE',
    'FOUNDER_PHONE',
    'FOUNDER_WHATSAPP',
    'SUPER_ADMIN_PHONE'
  )
    .map(normalizePhoneForOwnerMatch)
    .filter(Boolean)
    .filter((phone, index, phones) => phones.indexOf(phone) === index);
}

function uniquePhones(values = []) {
  return values
    .map(normalizePhoneForOwnerMatch)
    .filter(Boolean)
    .filter((phone, index, phones) => phones.indexOf(phone) === index);
}

function getConfiguredReportWhatsappRecipients() {
  return uniquePhones([
    ...getConfiguredOwnerPhones(),
    ...envList(
      'AI_CEO_REPORT_WHATSAPP_RECIPIENTS',
      'AI_CEO_REPORT_WHATSAPP_RECIPIENT',
      'AI_CEO_OWNER_REPORT_PHONES'
    )
  ]);
}

function getConfiguredOwnerTelegramChats() {
  return envList('AI_CEO_TELEGRAM_OWNER_CHAT_IDS', 'TELEGRAM_OWNER_CHAT_IDS')
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function isAiCeoOwnerPhone(phone) {
  const incoming = normalizePhoneForOwnerMatch(phone);
  if (!incoming) return false;
  return getConfiguredOwnerPhones().some((allowed) => {
    return incoming === allowed || incoming.endsWith(allowed) || allowed.endsWith(incoming);
  });
}

function isAiCeoReportRecipientPhone(phone) {
  const incoming = normalizePhoneForOwnerMatch(phone);
  if (!incoming) return false;
  return getConfiguredReportWhatsappRecipients().some((allowed) => {
    return incoming === allowed || incoming.endsWith(allowed) || allowed.endsWith(incoming);
  });
}

function isAiCeoTelegramOwnerChat(chatId) {
  const incoming = String(chatId || '').trim();
  if (!incoming) return false;
  return getConfiguredOwnerTelegramChats().includes(incoming);
}

function isOwnerWhatsappControlEnabled() {
  return asBool(process.env.AI_CEO_OWNER_WHATSAPP_ENABLED, true);
}

function isAiCeoPhoneCommand(text = '') {
  const clean = safeText(text, 1000).toLowerCase();
  if (!clean) return false;
  const prefix = String(process.env.AI_CEO_OWNER_COMMAND_PREFIX || '').trim().toLowerCase();
  if (prefix && clean.startsWith(prefix)) return true;
  if (/^(ceo|ai ceo|md|boss|maka ceo|makaug ceo)\b/.test(clean)) return true;
  return PHONE_COMMAND_KEYWORDS.some((keyword) => clean.includes(keyword));
}

async function safeOne(sql, params = [], fallback = {}) {
  try {
    const result = await db.query(sql, params);
    return result.rows[0] || fallback;
  } catch (error) {
    logger.warn('AI CEO query skipped', { error: summarizeError(error) });
    return fallback;
  }
}

async function safeRows(sql, params = []) {
  try {
    const result = await db.query(sql, params);
    return result.rows || [];
  } catch (error) {
    logger.warn('AI CEO rows skipped', { error: summarizeError(error) });
    return [];
  }
}

async function safeCount(sql, params = []) {
  const row = await safeOne(sql, params, { total: 0 });
  return Number(row.total || 0);
}

async function getCeoAgent() {
  return safeOne(
    `SELECT id, code, name, description, enabled, run_mode, config, created_at, updated_at
     FROM ai_agents
     WHERE code = $1
     LIMIT 1`,
    [AI_CEO_AGENT_CODE],
    {
      id: null,
      code: AI_CEO_AGENT_CODE,
      name: 'makaug AI CEO',
      description: 'Founder-controlled AI assistant.',
      enabled: false,
      run_mode: 'recommend',
      config: {}
    }
  );
}

function getKillSwitches(agent = {}) {
  const switches = agent?.config?.killSwitches && typeof agent.config.killSwitches === 'object'
    ? agent.config.killSwitches
    : {};
  return { ...DEFAULT_KILL_SWITCHES, ...switches };
}

function emailProviderConfigured() {
  return Boolean(
    process.env.MAIL_WEBHOOK_URL
    || process.env.SMTP_HOST
    || (process.env.MS_GRAPH_TENANT_ID && process.env.MS_GRAPH_CLIENT_ID && process.env.MS_GRAPH_CLIENT_SECRET)
  );
}

function directEmailModeEnabled() {
  return String(process.env.AI_CEO_EMAIL_SEND_MODE || 'draft').trim().toLowerCase() === 'direct';
}

async function collectCeoMetrics() {
  const [
    todayEngagement,
    last48Engagement,
    totalListings,
    pendingListings,
    approvedListings,
    rejectedListings,
    todayListings,
    pendingFieldAgentListings,
    users,
    pendingBrokers,
    approvedBrokers,
    openLeads,
    hotLeads,
    overdueTasks,
    propertyRequests,
    failedEmails,
    failedWhatsapp,
    inboundWhatsapp24h,
    outboundWhatsapp24h,
    whatsappNeedsHuman,
    adOpenLeads,
    liveAds,
    paidRevenue,
    quotedPipeline,
    unpaidInvoices,
    recentCommands
  ] = await Promise.all([
    safeOne(
      `SELECT COUNT(*)::int AS events,
              COUNT(DISTINCT COALESCE(NULLIF(client_id, ''), NULLIF(user_phone, ''), payload->>'session_id'))::int AS visitors
       FROM analytics_events
       WHERE created_at >= CURRENT_DATE`,
      [],
      { events: 0, visitors: 0 }
    ),
    safeOne(
      `SELECT COUNT(*)::int AS events,
              COUNT(DISTINCT COALESCE(NULLIF(client_id, ''), NULLIF(user_phone, ''), payload->>'session_id'))::int AS visitors,
              COUNT(*) FILTER (WHERE event_name IN ('property_open','property_view','listing_detail_view'))::int AS property_views,
              COUNT(*) FILTER (WHERE event_name IN ('property_search','near_me_search','search_submit'))::int AS searches
       FROM analytics_events
       WHERE created_at >= NOW() - INTERVAL '48 hours'`,
      [],
      { events: 0, visitors: 0, property_views: 0, searches: 0 }
    ),
    safeCount('SELECT COUNT(*)::int AS total FROM properties'),
    safeCount("SELECT COUNT(*)::int AS total FROM properties WHERE status = 'pending'"),
    safeCount("SELECT COUNT(*)::int AS total FROM properties WHERE status IN ('approved','sold')"),
    safeCount("SELECT COUNT(*)::int AS total FROM properties WHERE status = 'rejected'"),
    safeCount('SELECT COUNT(*)::int AS total FROM properties WHERE created_at >= CURRENT_DATE'),
    safeCount("SELECT COUNT(*)::int AS total FROM properties WHERE status = 'pending' AND (source = 'field_agent' OR listed_via = 'field_agent' OR extra_fields->>'source_role' = 'field_agent')"),
    safeOne(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE role = 'field_agent')::int AS field_agents,
              COUNT(*) FILTER (WHERE role IN ('agent_broker','broker'))::int AS broker_accounts
       FROM users`,
      [],
      { total: 0, field_agents: 0, broker_accounts: 0 }
    ),
    safeCount("SELECT COUNT(*)::int AS total FROM agents WHERE status = 'pending' OR COALESCE(registration_status, 'not_registered') <> 'registered'"),
    safeCount("SELECT COUNT(*)::int AS total FROM agents WHERE status = 'approved' OR COALESCE(registration_status, 'not_registered') = 'registered'"),
    safeCount("SELECT COUNT(*)::int AS total FROM leads WHERE lead_status NOT IN ('closed','resolved','won','lost','archived')"),
    safeCount("SELECT COUNT(*)::int AS total FROM leads WHERE lead_status NOT IN ('closed','resolved','won','lost','archived') AND (priority IN ('high','urgent') OR lead_score >= 50)"),
    safeCount("SELECT COUNT(*)::int AS total FROM lead_tasks WHERE status = 'open' AND due_at < NOW()"),
    safeCount('SELECT COUNT(*)::int AS total FROM property_requests'),
    safeCount("SELECT COUNT(*)::int AS total FROM email_logs WHERE status IN ('failed','provider_missing','bounced','error')"),
    safeCount("SELECT COUNT(*)::int AS total FROM whatsapp_message_logs WHERE status IN ('failed','provider_missing','error')"),
    safeCount("SELECT COUNT(*)::int AS total FROM whatsapp_messages WHERE direction = 'inbound' AND created_at >= NOW() - INTERVAL '24 hours'"),
    safeCount("SELECT COUNT(*)::int AS total FROM whatsapp_messages WHERE direction = 'outbound' AND created_at >= NOW() - INTERVAL '24 hours'"),
    safeCount("SELECT COUNT(*)::int AS total FROM whatsapp_conversation_state WHERE status IN ('needs_human','escalated')"),
    safeCount("SELECT COUNT(*)::int AS total FROM advertising_inquiries WHERE status IN ('new','contacted','proposal_sent')"),
    safeCount("SELECT COUNT(*)::int AS total FROM advertising_campaigns WHERE status = 'live'"),
    safeOne("SELECT COALESCE(SUM(paid_amount_ugx), 0)::bigint AS total FROM advertising_campaigns WHERE payment_status = 'paid'", [], { total: 0 }).then((row) => Number(row.total || 0)),
    safeOne("SELECT COALESCE(SUM(quoted_amount_ugx), 0)::bigint AS total FROM advertising_campaigns WHERE status NOT IN ('cancelled')", [], { total: 0 }).then((row) => Number(row.total || 0)),
    safeCount("SELECT COUNT(*)::int AS total FROM invoices WHERE status NOT IN ('paid','void','cancelled')"),
    safeRows(
      `SELECT intent, status, created_at
       FROM ai_ceo_commands
       ORDER BY created_at DESC
       LIMIT 5`
    )
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
      total: totalListings,
      pending: pendingListings,
      approved: approvedListings,
      rejected: rejectedListings,
      created_today: todayListings,
      pending_field_agent: pendingFieldAgentListings
    },
    accounts: {
      total_users: Number(users.total || 0),
      field_agents: Number(users.field_agents || 0),
      broker_accounts: Number(users.broker_accounts || 0),
      pending_brokers: pendingBrokers,
      approved_brokers: approvedBrokers
    },
    leads: {
      open: openLeads,
      hot: hotLeads,
      overdue_tasks: overdueTasks,
      property_requests: propertyRequests
    },
    communications: {
      outgoing_email_configured: emailProviderConfigured(),
      inbound_email_configured: asBool(process.env.AI_CEO_INBOUND_EMAIL_ENABLED, false),
      failed_emails: failedEmails,
      failed_whatsapp: failedWhatsapp,
      whatsapp_inbound_24h: inboundWhatsapp24h,
      whatsapp_outbound_24h: outboundWhatsapp24h,
      whatsapp_needs_human: whatsappNeedsHuman
    },
    revenue: {
      ad_open_leads: adOpenLeads,
      live_ads: liveAds,
      paid_ad_revenue_ugx: paidRevenue,
      quoted_pipeline_ugx: quotedPipeline,
      unpaid_invoices: unpaidInvoices
    },
    recent_commands: recentCommands
  };
}

function buildPriorities(metrics = {}) {
  const priorities = [];
  if ((metrics.listings?.pending || 0) > 0) {
    priorities.push({
      area: 'Listing review',
      priority: 'high',
      message: `${metrics.listings.pending} listings need review before they can go live.`
    });
  }
  if ((metrics.accounts?.pending_brokers || 0) > 0) {
    priorities.push({
      area: 'Broker verification',
      priority: 'high',
      message: `${metrics.accounts.pending_brokers} broker profiles need verification.`
    });
  }
  if ((metrics.leads?.hot || 0) > 0 || (metrics.leads?.overdue_tasks || 0) > 0) {
    priorities.push({
      area: 'Lead follow-up',
      priority: 'high',
      message: `${metrics.leads.hot} hot leads and ${metrics.leads.overdue_tasks} overdue tasks need action.`
    });
  }
  if ((metrics.communications?.failed_emails || 0) > 0 || (metrics.communications?.failed_whatsapp || 0) > 0) {
    priorities.push({
      area: 'Communications',
      priority: 'critical',
      message: `${metrics.communications.failed_emails} email failures and ${metrics.communications.failed_whatsapp} WhatsApp failures need checking.`
    });
  }
  if ((metrics.revenue?.ad_open_leads || 0) > 0 || (metrics.revenue?.unpaid_invoices || 0) > 0) {
    priorities.push({
      area: 'Revenue',
      priority: 'medium',
      message: `${metrics.revenue.ad_open_leads} advertiser leads and ${metrics.revenue.unpaid_invoices} unpaid invoices are open.`
    });
  }
  if (!priorities.length) {
    priorities.push({
      area: 'Operations',
      priority: 'normal',
      message: 'No urgent blockers found in the available backend data.'
    });
  }
  return priorities.slice(0, 6);
}

function buildApprovalsRequired(metrics = {}) {
  const approvals = [];
  if ((metrics.listings?.pending || 0) > 0) {
    approvals.push({ type: 'listings', count: metrics.listings.pending, route: '/admin#review' });
  }
  if ((metrics.accounts?.pending_brokers || 0) > 0) {
    approvals.push({ type: 'brokers', count: metrics.accounts.pending_brokers, route: '/admin#accounts' });
  }
  if ((metrics.revenue?.ad_open_leads || 0) > 0) {
    approvals.push({ type: 'advertising', count: metrics.revenue.ad_open_leads, route: '/admin#ads' });
  }
  return approvals;
}

function formatMoney(value) {
  return `UGX ${Number(value || 0).toLocaleString('en-US')}`;
}

function buildFounderReportText(metrics, priorities = [], reportType = 'morning') {
  const p = priorities.map((item, idx) => `${idx + 1}. ${item.message}`).join('\n');
  return [
    `makaug AI CEO ${reportType} report`,
    '',
    `Today: ${metrics.engagement.today_visitors} visitors, ${metrics.engagement.today_events} events.`,
    `Last 48h: ${metrics.engagement.last_48h_visitors} visitors, ${metrics.engagement.last_48h_property_views} property views, ${metrics.engagement.last_48h_searches} searches.`,
    `Listings: ${metrics.listings.pending} pending, ${metrics.listings.approved} live/approved, ${metrics.listings.created_today} created today.`,
    `Brokers/agents: ${metrics.accounts.pending_brokers} broker reviews, ${metrics.accounts.field_agents} field agents.`,
    `Leads: ${metrics.leads.open} open, ${metrics.leads.hot} hot, ${metrics.leads.overdue_tasks} overdue tasks.`,
    `Comms: email ${metrics.communications.outgoing_email_configured ? 'configured' : 'not configured'}, ${metrics.communications.failed_emails} email failures, ${metrics.communications.failed_whatsapp} WhatsApp failures.`,
    `Revenue: ${metrics.revenue.ad_open_leads} ad leads, ${metrics.revenue.live_ads} live ads, ${formatMoney(metrics.revenue.paid_ad_revenue_ugx)} paid.`,
    '',
    'Top actions:',
    p || '1. Keep monitoring. No urgent backend blockers found.',
    '',
    'Reply with: CEO listings, CEO leads, CEO email health, or CEO send email to name@example.com subject: ... message: ...'
  ].join('\n');
}

async function saveCeoReport({ reportType = 'morning', summary, metrics, priorities, approvals, killSwitches, deliveryChannels, runId = null, createdBy = 'ai_ceo' }) {
  const result = await db.query(
    `INSERT INTO ai_ceo_reports (
      run_id, report_type, summary, metrics, priorities, approvals_required, kill_switches, delivery_channels, created_by
     ) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9)
     RETURNING *`,
    [
      runId,
      reportType,
      summary,
      JSON.stringify(metrics || {}),
      JSON.stringify(priorities || []),
      JSON.stringify(approvals || []),
      JSON.stringify(killSwitches || {}),
      JSON.stringify(deliveryChannels || []),
      createdBy
    ]
  );
  return result.rows[0] || null;
}

async function runCeoMorningReport({ reportType = 'morning', createdBy = 'founder_dashboard' } = {}) {
  const agent = await getCeoAgent();
  const metrics = await collectCeoMetrics();
  const priorities = buildPriorities(metrics);
  const approvals = buildApprovalsRequired(metrics);
  const killSwitches = getKillSwitches(agent);
  const deliveryChannels = Array.isArray(agent?.config?.deliveryChannels)
    ? agent.config.deliveryChannels
    : ['dashboard', 'whatsapp_owner', 'telegram_owner'];
  const summary = buildFounderReportText(metrics, priorities, reportType);
  const report = await saveCeoReport({
    reportType,
    summary,
    metrics,
    priorities,
    approvals,
    killSwitches,
    deliveryChannels,
    createdBy
  });
  return { agent, report, metrics, priorities, approvals, summary, killSwitches, deliveryChannels };
}

function detectCeoCommandIntent(commandText = '') {
  const text = safeText(commandText, 2000).toLowerCase();
  if (!text) return 'empty';
  if (/(send|reply|respond).*\bemail\b|\bemail\b.*\b(to|reply|respond|send)\b/.test(text)) return 'email_reply';
  if (/(whatsapp|chatbot|bot|message failures?)/.test(text)) return 'whatsapp_health';
  if (/(lead|query|enquir|callback|follow up|follow-up)/.test(text)) return 'lead_report';
  if (/(listing|property|pending|approve|review)/.test(text)) return 'listing_report';
  if (/(broker|agent|field agent)/.test(text)) return 'agent_report';
  if (/(ad|advert|revenue|money|invoice|payment|boost)/.test(text)) return 'revenue_report';
  if (/(visitor|traffic|view|search|how many|report|morning|status|health)/.test(text)) return 'morning_report';
  return 'general';
}

function extractEmailDraftFromCommand(commandText = '') {
  const raw = String(commandText || '').trim();
  const to = (raw.match(/\bto\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i) || [])[1] || '';
  const subjectMatch = raw.match(/\bsubject\s*:\s*([\s\S]*?)(?:\bmessage\s*:|\bbody\s*:|$)/i);
  const messageMatch = raw.match(/\b(?:message|body)\s*:\s*([\s\S]+)$/i);
  const subject = safeText(subjectMatch?.[1] || 'makaug follow-up', 180);
  const text = safeText(messageMatch?.[1] || '', 5000);
  return { to: to.toLowerCase(), subject, text };
}

async function queueFounderApprovalAction({ actionType, payload, reason, riskLevel = 'high' }) {
  const result = await db.query(
    `INSERT INTO ai_agent_actions (
      finding_id, action_type, action_payload, status, requires_founder_approval, approval_reason, risk_level
     ) VALUES (NULL, $1, $2::jsonb, 'pending', TRUE, $3, $4)
     RETURNING id, action_type, action_payload, status, requires_founder_approval, approval_reason, risk_level, created_at`,
    [
      safeText(actionType, 120),
      JSON.stringify(payload || {}),
      safeText(reason || 'Founder approval required before this action is executed.', 500),
      ['low', 'medium', 'high', 'critical'].includes(String(riskLevel || '').toLowerCase()) ? String(riskLevel).toLowerCase() : 'high'
    ]
  );
  return result.rows[0] || null;
}

async function saveCommandLog({
  channel,
  requestedBy,
  requesterPhone = null,
  requesterChatId = null,
  commandText,
  status,
  intent,
  responseSummary,
  responsePayload,
  requiresFounderApproval = false
}) {
  const result = await db.query(
    `INSERT INTO ai_ceo_commands (
      channel, requested_by, requester_phone, requester_chat_id, command_text, status, intent,
      response_summary, response_payload, requires_founder_approval, handled_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,NOW())
     RETURNING *`,
    [
      channel || 'dashboard',
      requestedBy || 'founder',
      requesterPhone || null,
      requesterChatId || null,
      safeText(commandText, 4000),
      status || 'answered',
      intent || 'general',
      safeText(responseSummary, 6000),
      JSON.stringify(responsePayload || {}),
      !!requiresFounderApproval
    ]
  );
  return result.rows[0] || null;
}

async function handleEmailCommand({ commandText, channel, requestedBy, requesterPhone, requesterChatId }) {
  const draft = extractEmailDraftFromCommand(commandText);
  if (!draft.to || !draft.text) {
    const response = [
      'I can handle that, but I need the email address and message in one command.',
      '',
      'Use:',
      'CEO send email to client@example.com subject: makaug update message: Hello, thanks for contacting makaug...'
    ].join('\n');
    const command = await saveCommandLog({
      channel,
      requestedBy,
      requesterPhone,
      requesterChatId,
      commandText,
      status: 'needs_approval',
      intent: 'email_reply',
      responseSummary: response,
      responsePayload: { missing: ['to', 'message'] },
      requiresFounderApproval: true
    });
    return { response, command, requiresFounderApproval: true };
  }

  if (directEmailModeEnabled()) {
    const delivery = await sendSupportEmail({
      to: draft.to,
      subject: draft.subject,
      text: draft.text
    });
    const response = delivery?.sent
      ? `Email sent to ${draft.to}: ${draft.subject}`
      : `I tried to send the email to ${draft.to}, but delivery did not complete: ${delivery?.reason || delivery?.error || 'provider unavailable'}.`;
    const command = await saveCommandLog({
      channel,
      requestedBy,
      requesterPhone,
      requesterChatId,
      commandText,
      status: delivery?.sent ? 'answered' : 'failed',
      intent: 'email_reply',
      responseSummary: response,
      responsePayload: { draft, delivery },
      requiresFounderApproval: false
    });
    return { response, command, delivery, requiresFounderApproval: false };
  }

  const action = await queueFounderApprovalAction({
    actionType: 'send_support_email',
    payload: draft,
    reason: 'Email reply drafted from AI CEO phone/dashboard command. Direct sending is off unless AI_CEO_EMAIL_SEND_MODE=direct.',
    riskLevel: 'high'
  });
  const response = [
    `I drafted the email to ${draft.to}.`,
    `Subject: ${draft.subject}`,
    '',
    'It is waiting for founder approval before sending. Turn on AI_CEO_EMAIL_SEND_MODE=direct only when you want founder phone commands to send immediately.'
  ].join('\n');
  const command = await saveCommandLog({
    channel,
    requestedBy,
    requesterPhone,
    requesterChatId,
    commandText,
    status: 'needs_approval',
    intent: 'email_reply',
    responseSummary: response,
    responsePayload: { draft, action },
    requiresFounderApproval: true
  });
  return { response, command, action, requiresFounderApproval: true };
}

async function handleCeoCommand({
  commandText,
  channel = 'dashboard',
  requestedBy = 'founder_dashboard',
  requesterPhone = null,
  requesterChatId = null
} = {}) {
  const cleanCommand = safeText(commandText, 4000);
  if (!cleanCommand) {
    const response = 'Tell me what you want the makaug AI CEO to check or do.';
    return { response, status: 'blocked', intent: 'empty' };
  }

  const intent = detectCeoCommandIntent(cleanCommand);
  if (intent === 'email_reply') {
    return handleEmailCommand({ commandText: cleanCommand, channel, requestedBy, requesterPhone, requesterChatId });
  }

  const reportType = 'command';
  const reportData = await runCeoMorningReport({ reportType, createdBy: requestedBy });
  let response = reportData.summary;

  if (intent === 'listing_report') {
    response = [
      'makaug AI CEO listing report',
      '',
      `${reportData.metrics.listings.pending} listings need review.`,
      `${reportData.metrics.listings.approved} listings are approved/live.`,
      `${reportData.metrics.listings.created_today} listings were created today.`,
      `${reportData.metrics.listings.pending_field_agent} pending listings came through field-agent flow.`,
      '',
      'You still approve what goes live. I will only report and draft recommendations.'
    ].join('\n');
  } else if (intent === 'lead_report') {
    response = [
      'makaug AI CEO lead report',
      '',
      `${reportData.metrics.leads.open} open leads.`,
      `${reportData.metrics.leads.hot} hot/high-priority leads.`,
      `${reportData.metrics.leads.overdue_tasks} overdue follow-up tasks.`,
      `${reportData.metrics.leads.property_requests} property need requests.`
    ].join('\n');
  } else if (intent === 'whatsapp_health') {
    response = [
      'makaug AI CEO WhatsApp health',
      '',
      `${reportData.metrics.communications.whatsapp_inbound_24h} inbound WhatsApp messages in 24h.`,
      `${reportData.metrics.communications.whatsapp_outbound_24h} outbound WhatsApp messages in 24h.`,
      `${reportData.metrics.communications.whatsapp_needs_human} conversations need human follow-up.`,
      `${reportData.metrics.communications.failed_whatsapp} WhatsApp delivery failures.`
    ].join('\n');
  } else if (intent === 'revenue_report') {
    response = [
      'makaug AI CEO revenue report',
      '',
      `${reportData.metrics.revenue.ad_open_leads} advertiser leads are open.`,
      `${reportData.metrics.revenue.live_ads} ads are live.`,
      `${formatMoney(reportData.metrics.revenue.paid_ad_revenue_ugx)} paid ad revenue recorded.`,
      `${formatMoney(reportData.metrics.revenue.quoted_pipeline_ugx)} quoted ad pipeline.`,
      `${reportData.metrics.revenue.unpaid_invoices} unpaid invoices.`
    ].join('\n');
  } else if (intent === 'agent_report') {
    response = [
      'makaug AI CEO broker and field-agent report',
      '',
      `${reportData.metrics.accounts.pending_brokers} broker reviews pending.`,
      `${reportData.metrics.accounts.approved_brokers} approved brokers.`,
      `${reportData.metrics.accounts.field_agents} field-agent accounts.`,
      `${reportData.metrics.listings.pending_field_agent} pending field-agent listings.`
    ].join('\n');
  }

  const command = await saveCommandLog({
    channel,
    requestedBy,
    requesterPhone,
    requesterChatId,
    commandText: cleanCommand,
    status: 'answered',
    intent,
    responseSummary: response,
    responsePayload: reportData,
    requiresFounderApproval: false
  });

  return { ...reportData, response, command, status: 'answered', intent };
}

async function getCeoStatus() {
  const agent = await getCeoAgent();
  const metrics = await collectCeoMetrics();
  const killSwitches = getKillSwitches(agent);
  const latestReport = await safeOne(
    `SELECT id, report_type, status, summary, created_at, sent_at
     FROM ai_ceo_reports
     ORDER BY created_at DESC
     LIMIT 1`,
    [],
    null
  );
  const pendingActions = await safeRows(
    `SELECT id, action_type, action_payload, status, requires_founder_approval, approval_reason, risk_level, created_at
     FROM ai_agent_actions
     WHERE status = 'pending'
       AND (requires_founder_approval = TRUE OR action_type IN ('send_support_email','draft_customer_reply','draft_social_post','create_ad_campaign','spend_ad_budget'))
     ORDER BY created_at DESC
     LIMIT 10`
  );
  return {
    agent,
    metrics,
    killSwitches,
    latestReport,
    pendingActions,
    phoneControl: {
      whatsapp_enabled: isOwnerWhatsappControlEnabled(),
      configured_owner_phone_count: getConfiguredOwnerPhones().length,
      configured_report_recipient_count: getConfiguredReportWhatsappRecipients().length,
      command_prefix: process.env.AI_CEO_OWNER_COMMAND_PREFIX || 'keyword based',
      telegram_configured: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      telegram_owner_chat_count: getConfiguredOwnerTelegramChats().length
    },
    emailControl: {
      outgoing_configured: emailProviderConfigured(),
      inbound_configured: asBool(process.env.AI_CEO_INBOUND_EMAIL_ENABLED, false),
      send_mode: directEmailModeEnabled() ? 'direct' : 'draft'
    }
  };
}

async function handleOwnerWhatsappCommand({ phone, commandText, contactName = '' }) {
  if (!isOwnerWhatsappControlEnabled()) {
    return { handled: false, reason: 'owner_whatsapp_control_disabled' };
  }
  if (!isAiCeoPhoneCommand(commandText)) {
    return { handled: false, reason: 'not_ai_ceo_command' };
  }
  const isOwner = isAiCeoOwnerPhone(phone);
  const isReportRecipient = isAiCeoReportRecipientPhone(phone);
  if (!isOwner && !isReportRecipient) {
    return { handled: false, reason: 'not_configured_owner_phone' };
  }
  const intent = detectCeoCommandIntent(commandText);
  if (!isOwner && !REPORT_RECIPIENT_READ_ONLY_INTENTS.has(intent)) {
    return {
      handled: true,
      status: 'blocked',
      intent,
      response: [
        'This WhatsApp number can receive and request AI CEO reports only.',
        'Ask the founder to add you to AI_CEO_OWNER_PHONES if you need command access.'
      ].join('\n')
    };
  }
  const result = await handleCeoCommand({
    commandText,
    channel: 'whatsapp_owner',
    requestedBy: isOwner
      ? (contactName ? `whatsapp:${contactName}` : 'whatsapp_owner')
      : (contactName ? `whatsapp_report_recipient:${contactName}` : 'whatsapp_report_recipient'),
    requesterPhone: phone
  });
  return { handled: true, reportOnly: !isOwner, ...result };
}

async function sendReportToFounderWhatsapp(reportText, { source = 'ai_ceo', actorId = 'ai_ceo' } = {}) {
  const recipients = getConfiguredReportWhatsappRecipients();
  if (!recipients.length) return { sent: false, reason: 'no_report_whatsapp_recipient_configured' };
  const sent = [];
  for (const recipient of recipients) {
    try {
      const queued = await queueWhatsappWebBridgeMessage({
        recipient,
        text: reportText,
        source,
        actorId,
        metadata: { ai_ceo: true }
      });
      sent.push({ recipient, queue_id: queued?.id || null });
    } catch (error) {
      sent.push({ recipient, error: error.message });
    }
  }
  return { sent: sent.some((item) => item.queue_id), recipients: sent };
}

async function sendTelegramMessage(chatId, text) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!token) return { sent: false, reason: 'telegram_bot_token_missing' };
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: String(text || '').slice(0, 3900)
    })
  });
  const payload = await response.json().catch(() => ({}));
  return { sent: response.ok, status: response.status, payload };
}

async function handleInboundEmailForCeo({ from, subject, text, messageId = '', channel = 'email' } = {}) {
  const sender = safeText(from, 320);
  const body = safeText(text, 5000);
  if (!sender || !body) {
    return { ok: false, error: 'from and text are required' };
  }
  const action = await queueFounderApprovalAction({
    actionType: 'send_support_email',
    payload: {
      to: sender,
      subject: `Re: ${safeText(subject || 'makaug message', 180)}`,
      text: `Thanks for contacting makaug.\n\n[AI CEO draft reply needed]\n\nOriginal message:\n${body}`
    },
    reason: 'Inbound email received for AI CEO drafting. Founder approval required before reply is sent.',
    riskLevel: 'medium'
  });
  const response = `Email from ${sender} logged. I created a reply draft for founder review.`;
  const command = await saveCommandLog({
    channel,
    requestedBy: sender,
    commandText: `Inbound email: ${subject || '(no subject)'} ${body}`,
    status: 'needs_approval',
    intent: 'email_reply',
    responseSummary: response,
    responsePayload: { from: sender, subject, messageId, action },
    requiresFounderApproval: true
  });
  return { ok: true, response, command, action };
}

module.exports = {
  AI_CEO_AGENT_CODE,
  collectCeoMetrics,
  detectCeoCommandIntent,
  directEmailModeEnabled,
  emailProviderConfigured,
  getCeoStatus,
  getConfiguredOwnerPhones,
  getConfiguredReportWhatsappRecipients,
  handleCeoCommand,
  handleInboundEmailForCeo,
  handleOwnerWhatsappCommand,
  isAiCeoOwnerPhone,
  isAiCeoPhoneCommand,
  isAiCeoReportRecipientPhone,
  isAiCeoTelegramOwnerChat,
  runCeoMorningReport,
  sendReportToFounderWhatsapp,
  sendTelegramMessage
};
