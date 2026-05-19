'use strict';

const logger = require('../config/logger');
const { emailProviderConfigured, getSupportEmail, sendSupportEmail } = require('./emailService');
const { logEmailEvent } = require('./emailLogService');
const { createLead } = require('./leadService');

let outlookTokenCache = {
  token: null,
  expiresAt: 0
};

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(raw)) return false;
  return fallback;
}

function cleanText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function extractEmailAddress(value) {
  const raw = cleanText(value).toLowerCase();
  if (!raw) return '';
  const angle = raw.match(/<([^>]+)>/);
  return cleanText(angle?.[1] || raw).toLowerCase();
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isSchemaMissing(error) {
  return ['42P01', '42703', '42883'].includes(error?.code);
}

function getOutlookAgentConfig() {
  const tenantId = cleanText(process.env.OUTLOOK_AI_TENANT_ID || process.env.MS_GRAPH_TENANT_ID || process.env.M365_TENANT_ID);
  const clientId = cleanText(process.env.OUTLOOK_AI_CLIENT_ID || process.env.MS_GRAPH_CLIENT_ID || process.env.AZURE_CLIENT_ID);
  const clientSecret = cleanText(process.env.OUTLOOK_AI_CLIENT_SECRET || process.env.MS_GRAPH_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET);
  const mailbox = extractEmailAddress(
    process.env.OUTLOOK_AI_MAILBOX
      || process.env.MS_GRAPH_SENDER_EMAIL
      || process.env.M365_SENDER_EMAIL
      || getSupportEmail()
  );
  const enabled = boolEnv('OUTLOOK_AI_AGENT_ENABLED', false);
  const draftOnly = boolEnv('OUTLOOK_AI_DRAFT_ONLY', true);
  const requireApproval = boolEnv('OUTLOOK_AI_REQUIRE_APPROVAL', true);
  const pollUnreadOnly = boolEnv('OUTLOOK_AI_POLL_UNREAD_ONLY', true);
  const autoSendCategories = String(process.env.OUTLOOK_AI_AUTO_SEND_CATEGORIES || '')
    .split(',')
    .map((item) => cleanText(item).toLowerCase())
    .filter(Boolean);
  const maxMessages = Math.min(Math.max(parseInt(process.env.OUTLOOK_AI_POLL_LIMIT || '10', 10) || 10, 1), 50);
  const configured = Boolean(tenantId && clientId && clientSecret && mailbox);

  return {
    enabled,
    configured,
    draftOnly,
    requireApproval,
    pollUnreadOnly,
    maxMessages,
    autoSendCategories,
    mailbox,
    tenantId,
    clientId,
    clientSecret,
    safe: {
      enabled,
      configured,
      draftOnly,
      requireApproval,
      pollUnreadOnly,
      maxMessages,
      autoSendCategories,
      mailbox,
      microsoftGraphSendConfigured: emailProviderConfigured(),
      requiredGraphPermissions: ['Mail.Read', 'Mail.ReadWrite', 'Mail.Send']
    }
  };
}

function publicAgentStatus(config = getOutlookAgentConfig(), counters = {}) {
  return {
    ...config.safe,
    inboxSyncAvailable: config.enabled && config.configured,
    directSendAvailable: config.enabled && config.configured && !config.draftOnly,
    approvalMode: config.requireApproval || config.draftOnly ? 'approval_required' : 'direct_send_allowed',
    counters: {
      pendingDrafts: safeNumber(counters.pendingDrafts, 0),
      approvedDrafts: safeNumber(counters.approvedDrafts, 0),
      sentReplies: safeNumber(counters.sentReplies, 0),
      failedReplies: safeNumber(counters.failedReplies, 0),
      syncedThreads: safeNumber(counters.syncedThreads, 0)
    },
    guardrails: [
      'No raw mailbox passwords are accepted.',
      'OAuth / Microsoft Graph app permissions are required.',
      'Draft-only mode is on unless OUTLOOK_AI_DRAFT_ONLY=false.',
      'Sensitive legal, payment, fraud, security, or complaint messages require human approval.'
    ]
  };
}

async function getOutlookGraphToken(config = getOutlookAgentConfig()) {
  if (!config.configured) {
    throw new Error('outlook_graph_not_configured');
  }
  const now = Date.now();
  if (outlookTokenCache.token && outlookTokenCache.expiresAt > now + 30_000) {
    return outlookTokenCache.token;
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });

  const resp = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`outlook_graph_token_error_${resp.status}: ${errorText}`);
  }

  const data = await resp.json();
  const token = cleanText(data?.access_token);
  const expiresIn = parseInt(String(data?.expires_in || '3000'), 10) || 3000;
  if (!token) throw new Error('outlook_graph_token_missing');
  outlookTokenCache = {
    token,
    expiresAt: now + Math.max(60, expiresIn - 60) * 1000
  };
  return token;
}

async function outlookGraphRequest(path, options = {}, config = getOutlookAgentConfig()) {
  const token = await getOutlookGraphToken(config);
  const endpoint = path.startsWith('https://')
    ? path
    : `https://graph.microsoft.com/v1.0${path.startsWith('/') ? path : `/${path}`}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.headers || {})
  };
  if (options.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const resp = await fetch(endpoint, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined
      ? undefined
      : (typeof options.body === 'string' ? options.body : JSON.stringify(options.body))
  });
  if (!resp.ok) {
    const errorText = await resp.text();
    throw new Error(`outlook_graph_request_error_${resp.status}: ${errorText}`);
  }
  if (resp.status === 204) return null;
  return resp.json();
}

function mapGraphMessage(message = {}, config = getOutlookAgentConfig()) {
  const from = message.from?.emailAddress || {};
  return {
    graphMessageId: cleanText(message.id),
    internetMessageId: cleanText(message.internetMessageId),
    conversationId: cleanText(message.conversationId),
    mailbox: config.mailbox,
    fromEmail: extractEmailAddress(from.address),
    fromName: cleanText(from.name),
    subject: cleanText(message.subject, '(no subject)'),
    bodyPreview: cleanText(message.bodyPreview),
    receivedAt: cleanText(message.receivedDateTime) || new Date().toISOString(),
    webLink: cleanText(message.webLink),
    isRead: message.isRead === true,
    categories: Array.isArray(message.categories) ? message.categories : []
  };
}

async function fetchOutlookInboxMessages(options = {}) {
  const config = getOutlookAgentConfig();
  if (!config.enabled) return { ok: false, reason: 'outlook_agent_disabled', data: [] };
  if (!config.configured) return { ok: false, reason: 'outlook_graph_not_configured', data: [] };

  const limit = Math.min(Math.max(parseInt(options.limit || config.maxMessages, 10) || config.maxMessages, 1), 50);
  const params = new URLSearchParams({
    '$top': String(limit),
    '$orderby': 'receivedDateTime desc',
    '$select': 'id,internetMessageId,conversationId,subject,bodyPreview,receivedDateTime,webLink,isRead,from,categories'
  });
  if (options.unreadOnly ?? config.pollUnreadOnly) {
    params.set('$filter', 'isRead eq false');
  }
  const path = `/users/${encodeURIComponent(config.mailbox)}/mailFolders/inbox/messages?${params.toString()}`;
  const data = await outlookGraphRequest(path, {}, config);
  return {
    ok: true,
    data: Array.isArray(data?.value) ? data.value.map((message) => mapGraphMessage(message, config)) : []
  };
}

function classifyOutlookEmail(input = {}) {
  const hay = [
    input.subject,
    input.body,
    input.bodyPreview,
    input.fromEmail
  ].filter(Boolean).join(' ').toLowerCase();

  if (/fraud|scam|complain|complaint|unsafe|security|legal|lawyer|police|refund|deposit|payment|money|stolen|threat/.test(hay)) {
    return { category: 'fraud_safety', confidence: 0.93, requiresApproval: true, priority: 'urgent' };
  }
  if (/student|hostel|makerere|mubs|ucu|campus|semester|roommate/.test(hay)) {
    return { category: 'student_accommodation', confidence: 0.82, requiresApproval: false, priority: 'normal' };
  }
  if (/mortgage|loan|bank|finance|financing|afford/.test(hay)) {
    return { category: 'mortgage', confidence: 0.81, requiresApproval: false, priority: 'normal' };
  }
  if (/advert|sponsor|promote|campaign|banner|featured|boost/.test(hay)) {
    return { category: 'advertising', confidence: 0.8, requiresApproval: false, priority: 'normal' };
  }
  if (/broker|agent|licen[cs]e|commission|mandate/.test(hay)) {
    return { category: 'broker_support', confidence: 0.78, requiresApproval: false, priority: 'normal' };
  }
  if (/list my|listing|landlord|owner|sell my|rent out|upload|post my|property owner/.test(hay)) {
    return { category: 'list_property', confidence: 0.83, requiresApproval: false, priority: 'normal' };
  }
  if (/buy|rent|house|apartment|land|plot|commercial|warehouse|office|viewing|available|price|location/.test(hay)) {
    return { category: 'property_search', confidence: 0.76, requiresApproval: false, priority: 'normal' };
  }
  return { category: 'general_support', confidence: 0.54, requiresApproval: true, priority: 'normal' };
}

function replyChecklistForCategory(category) {
  const checklists = {
    property_search: [
      'Preferred area or district',
      'Budget range',
      'Buy or rent',
      'Bedrooms, land size, or commercial use',
      'Best WhatsApp number for quick follow-up'
    ],
    list_property: [
      'Property location',
      'Sale/rent price',
      'Photos or video',
      'Ownership or authority to list',
      'Your WhatsApp number'
    ],
    student_accommodation: [
      'University or campus',
      'Budget per semester',
      'Room type',
      'Move-in date',
      'Preferred WhatsApp number'
    ],
    broker_support: [
      'Broker/company name',
      'Areas covered',
      'Registration or licence details where available',
      'Listings you want to manage',
      'Best contact number'
    ],
    advertising: [
      'Campaign objective',
      'Preferred placement',
      'Budget range',
      'Creative assets or copy',
      'Campaign dates'
    ],
    mortgage: [
      'Property type',
      'Estimated budget',
      'Deposit available',
      'Employment or income type',
      'Best contact number'
    ],
    fraud_safety: [
      'Listing link or reference',
      'Names and contact details involved',
      'Payment or message evidence',
      'What happened',
      'Whether urgent support is needed'
    ]
  };
  return checklists[category] || [
    'What you need help with',
    'Relevant listing link or reference',
    'Preferred contact method',
    'Best phone or WhatsApp number'
  ];
}

function buildOutlookReplyDraft(input = {}) {
  const classification = classifyOutlookEmail(input);
  const config = getOutlookAgentConfig();
  const fromName = cleanText(input.fromName) || 'there';
  const needsHuman = classification.requiresApproval || config.requireApproval || config.draftOnly;
  const subject = /^re:/i.test(cleanText(input.subject))
    ? cleanText(input.subject)
    : `Re: ${cleanText(input.subject, 'Your makaug.com enquiry')}`;
  const checklist = replyChecklistForCategory(classification.category);
  const urgentLine = classification.category === 'fraud_safety'
    ? 'I have flagged this for human review because it may involve safety, payment, or fraud risk.'
    : 'I can help move this forward quickly.';
  const text = [
    `Hello ${fromName},`,
    '',
    'Thanks for contacting makaug.com.',
    urgentLine,
    '',
    'Please send:',
    ...checklist.map((item) => `- ${item}`),
    '',
    'A makaug team member will review the details and reply with the right next step.',
    '',
    'Regards,',
    'makaug'
  ].join('\n');
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.6;">
    ${text.split('\n').map((line) => {
      if (!line) return '<br>';
      if (line.startsWith('- ')) return `<div>${htmlEscape(line)}</div>`;
      return `<p style="margin:0 0 12px;">${htmlEscape(line)}</p>`;
    }).join('')}
  </div>`;

  return {
    subject,
    bodyText: text,
    bodyHtml: html,
    category: classification.category,
    confidence: classification.confidence,
    requiresApproval: needsHuman,
    priority: classification.priority,
    draftMode: config.draftOnly ? 'outlook_draft_only' : (needsHuman ? 'admin_approval' : 'direct_send_allowed')
  };
}

async function upsertOutlookThread(db, message = {}) {
  if (!db) return null;
  const classification = classifyOutlookEmail(message);
  try {
    const result = await db.query(
      `INSERT INTO outlook_email_threads (
         graph_message_id, internet_message_id, conversation_id, mailbox,
         from_email, from_name, subject, body_preview, category, status,
         confidence, requires_approval, received_at, metadata, last_synced_at, updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,NOW(),NOW())
       ON CONFLICT (graph_message_id)
       DO UPDATE SET
         internet_message_id = COALESCE(EXCLUDED.internet_message_id, outlook_email_threads.internet_message_id),
         conversation_id = COALESCE(EXCLUDED.conversation_id, outlook_email_threads.conversation_id),
         from_email = COALESCE(EXCLUDED.from_email, outlook_email_threads.from_email),
         from_name = COALESCE(EXCLUDED.from_name, outlook_email_threads.from_name),
         subject = COALESCE(EXCLUDED.subject, outlook_email_threads.subject),
         body_preview = COALESCE(EXCLUDED.body_preview, outlook_email_threads.body_preview),
         category = EXCLUDED.category,
         confidence = EXCLUDED.confidence,
         requires_approval = EXCLUDED.requires_approval,
         metadata = COALESCE(outlook_email_threads.metadata, '{}'::jsonb) || EXCLUDED.metadata,
         last_synced_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [
        cleanText(message.graphMessageId) || null,
        cleanText(message.internetMessageId) || null,
        cleanText(message.conversationId) || null,
        cleanText(message.mailbox || getOutlookAgentConfig().mailbox),
        extractEmailAddress(message.fromEmail),
        cleanText(message.fromName),
        cleanText(message.subject, '(no subject)'),
        cleanText(message.bodyPreview || message.body),
        classification.category,
        'new',
        classification.confidence,
        classification.requiresApproval,
        message.receivedAt || new Date().toISOString(),
        JSON.stringify({
          web_link: message.webLink || null,
          is_read: message.isRead === true,
          categories: Array.isArray(message.categories) ? message.categories : []
        })
      ]
    );
    const thread = result.rows[0] || null;
    if (thread) {
      await createLead(db, {
        source: 'outlook_email_agent',
        leadType: classification.category,
        category: classification.category,
        priority: classification.priority,
        contact: {
          name: cleanText(message.fromName, 'Outlook contact'),
          email: extractEmailAddress(message.fromEmail),
          preferredContactChannel: 'email'
        },
        message: [message.subject, message.bodyPreview || message.body].filter(Boolean).join('\n\n'),
        metadata: {
          outlook_thread_id: thread.id,
          graph_message_id: cleanText(message.graphMessageId),
          confidence: classification.confidence
        }
      });
      await logEmailEvent(db, {
        eventType: 'outlook_email_inbound',
        recipientEmail: extractEmailAddress(message.fromEmail),
        templateKey: classification.category,
        subject: cleanText(message.subject),
        status: 'logged',
        provider: 'outlook_graph'
      });
    }
    return thread;
  } catch (error) {
    if (!isSchemaMissing(error)) {
      logger.warn('Outlook email thread upsert failed', { error: error.message });
    }
    return null;
  }
}

async function createOutlookGraphDraft({ message, draft }) {
  const config = getOutlookAgentConfig();
  if (!config.enabled || !config.configured) {
    return { ok: false, reason: config.enabled ? 'outlook_graph_not_configured' : 'outlook_agent_disabled' };
  }
  const to = extractEmailAddress(message.fromEmail || message.toEmail);
  if (!to) return { ok: false, reason: 'missing_recipient' };

  if (message.graphMessageId) {
    const replyDraft = await outlookGraphRequest(
      `/users/${encodeURIComponent(config.mailbox)}/messages/${encodeURIComponent(message.graphMessageId)}/createReply`,
      { method: 'POST' },
      config
    );
    if (replyDraft?.id) {
      await outlookGraphRequest(
        `/users/${encodeURIComponent(config.mailbox)}/messages/${encodeURIComponent(replyDraft.id)}`,
        {
          method: 'PATCH',
          body: {
            body: {
              contentType: 'HTML',
              content: draft.bodyHtml
            }
          }
        },
        config
      );
      return { ok: true, graphDraftId: replyDraft.id, provider: 'outlook_graph' };
    }
  }

  const created = await outlookGraphRequest(
    `/users/${encodeURIComponent(config.mailbox)}/messages`,
    {
      method: 'POST',
      body: {
        subject: draft.subject,
        body: {
          contentType: 'HTML',
          content: draft.bodyHtml
        },
        toRecipients: [
          { emailAddress: { address: to } }
        ]
      }
    },
    config
  );
  return { ok: Boolean(created?.id), graphDraftId: created?.id || null, provider: 'outlook_graph' };
}

async function queueOutlookReplyDraft(db, input = {}, options = {}) {
  const message = {
    graphMessageId: cleanText(input.graphMessageId || input.graph_message_id),
    internetMessageId: cleanText(input.internetMessageId || input.internet_message_id),
    conversationId: cleanText(input.conversationId || input.conversation_id),
    mailbox: cleanText(input.mailbox || getOutlookAgentConfig().mailbox),
    fromEmail: extractEmailAddress(input.fromEmail || input.from_email || input.email),
    fromName: cleanText(input.fromName || input.from_name || input.name),
    subject: cleanText(input.subject, '(no subject)'),
    bodyPreview: cleanText(input.bodyPreview || input.body_preview || input.body),
    body: cleanText(input.body || input.bodyPreview || input.body_preview),
    receivedAt: input.receivedAt || input.received_at || new Date().toISOString(),
    webLink: cleanText(input.webLink || input.web_link),
    categories: Array.isArray(input.categories) ? input.categories : []
  };
  const thread = await upsertOutlookThread(db, message);
  const draft = buildOutlookReplyDraft(message);
  let graphDraft = null;
  if (options.createGraphDraft !== false) {
    try {
      graphDraft = await createOutlookGraphDraft({ message, draft });
    } catch (error) {
      graphDraft = { ok: false, reason: error.message || 'outlook_graph_draft_failed' };
      logger.warn('Outlook Graph draft creation failed', { error: error.message });
    }
  }

  try {
    const result = await db.query(
      `INSERT INTO outlook_email_actions (
         thread_id, graph_message_id, graph_draft_id, mailbox, from_email, to_email,
         subject, body_text, body_html, category, confidence, status, failure_reason, metadata, updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,NOW())
       RETURNING *`,
      [
        thread?.id || null,
        message.graphMessageId || null,
        graphDraft?.graphDraftId || null,
        message.mailbox,
        message.fromEmail || null,
        message.fromEmail || null,
        draft.subject,
        draft.bodyText,
        draft.bodyHtml,
        draft.category,
        draft.confidence,
        draft.requiresApproval ? 'draft_pending_approval' : 'draft_ready',
        graphDraft && graphDraft.ok === false ? graphDraft.reason || 'outlook_graph_draft_failed' : null,
        JSON.stringify({
          draft_mode: draft.draftMode,
          requires_approval: draft.requiresApproval,
          outlook_graph_draft: graphDraft || null,
          source: options.source || 'admin_dashboard'
        })
      ]
    );
    const action = result.rows[0] || null;
    await logEmailEvent(db, {
      eventType: 'outlook_ai_reply_drafted',
      recipientEmail: message.fromEmail,
      templateKey: draft.category,
      subject: draft.subject,
      status: action?.status || 'drafted',
      provider: graphDraft?.ok ? 'outlook_graph' : 'outlook_ai_agent',
      failureReason: graphDraft && graphDraft.ok === false ? graphDraft.reason : null
    });
    return { action, draft, graphDraft, thread };
  } catch (error) {
    if (isSchemaMissing(error)) {
      return {
        action: null,
        draft,
        graphDraft,
        thread,
        warning: 'outlook_email_schema_missing'
      };
    }
    throw error;
  }
}

async function syncOutlookInbox(db, options = {}) {
  const inbox = await fetchOutlookInboxMessages(options);
  if (!inbox.ok) return { ...inbox, drafted: [] };
  const drafted = [];
  for (const message of inbox.data) {
    const result = await queueOutlookReplyDraft(db, message, {
      source: 'outlook_inbox_sync',
      createGraphDraft: options.createGraphDraft !== false
    });
    drafted.push(result.action || {
      graph_message_id: message.graphMessageId,
      status: result.warning || 'draft_not_persisted',
      subject: result.draft?.subject
    });
  }
  return {
    ok: true,
    synced: inbox.data.length,
    drafted
  };
}

async function getOutlookActionCounters(db) {
  if (!db) return {};
  try {
    const [actions, threads] = await Promise.all([
      db.query(
        `SELECT
           COUNT(*) FILTER (WHERE status IN ('draft_pending_approval','draft_ready'))::int AS pending_drafts,
           COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_drafts,
           COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_replies,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_replies
         FROM outlook_email_actions`
      ),
      db.query('SELECT COUNT(*)::int AS synced_threads FROM outlook_email_threads')
    ]);
    return {
      pendingDrafts: actions.rows[0]?.pending_drafts || 0,
      approvedDrafts: actions.rows[0]?.approved_drafts || 0,
      sentReplies: actions.rows[0]?.sent_replies || 0,
      failedReplies: actions.rows[0]?.failed_replies || 0,
      syncedThreads: threads.rows[0]?.synced_threads || 0
    };
  } catch (error) {
    if (!isSchemaMissing(error)) {
      logger.warn('Outlook agent counter query failed', { error: error.message });
    }
    return {};
  }
}

async function getOutlookAgentStatus(db) {
  const config = getOutlookAgentConfig();
  const counters = await getOutlookActionCounters(db);
  return publicAgentStatus(config, counters);
}

async function listOutlookEmailActions(db, options = {}) {
  const limit = Math.min(Math.max(parseInt(options.limit || '50', 10) || 50, 1), 100);
  const status = cleanText(options.status);
  const values = [];
  const filters = [];
  if (status) {
    values.push(status);
    filters.push(`a.status = $${values.length}`);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  try {
    const result = await db.query(
      `SELECT a.*, t.body_preview AS inbound_preview, t.web_link, t.received_at
       FROM outlook_email_actions a
       LEFT JOIN outlook_email_threads t ON t.id = a.thread_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $${values.length + 1}`,
      [...values, limit]
    );
    return result.rows;
  } catch (error) {
    if (!isSchemaMissing(error)) {
      logger.warn('Outlook actions query failed', { error: error.message });
    }
    return [];
  }
}

async function updateOutlookActionStatus(db, id, patch = {}) {
  const cleanId = cleanText(id);
  if (!cleanId) return null;
  const result = await db.query(
    `UPDATE outlook_email_actions
     SET status = $2,
         approved_by = COALESCE($3, approved_by),
         approved_at = COALESCE($4, approved_at),
         sent_at = COALESCE($5, sent_at),
         failure_reason = $6,
         metadata = COALESCE(metadata, '{}'::jsonb) || $7::jsonb,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      cleanId,
      patch.status,
      patch.approvedBy || null,
      patch.approvedAt || null,
      patch.sentAt || null,
      patch.failureReason || null,
      JSON.stringify(patch.metadata || {})
    ]
  );
  return result.rows[0] || null;
}

async function approveOutlookEmailAction(db, id, actorId = 'admin_api_key') {
  const action = await updateOutlookActionStatus(db, id, {
    status: 'approved',
    approvedBy: actorId,
    approvedAt: new Date().toISOString(),
    metadata: { approved_from: 'king_dashboard' }
  });
  if (action) {
    await logEmailEvent(db, {
      eventType: 'outlook_ai_reply_approved',
      recipientEmail: action.to_email,
      templateKey: action.category,
      subject: action.subject,
      status: 'approved',
      provider: 'outlook_ai_agent'
    });
  }
  return action;
}

async function rejectOutlookEmailAction(db, id, actorId = 'admin_api_key', reason = '') {
  const action = await updateOutlookActionStatus(db, id, {
    status: 'rejected',
    approvedBy: actorId,
    failureReason: cleanText(reason, 'Rejected by admin'),
    metadata: { rejected_from: 'king_dashboard' }
  });
  if (action) {
    await logEmailEvent(db, {
      eventType: 'outlook_ai_reply_rejected',
      recipientEmail: action.to_email,
      templateKey: action.category,
      subject: action.subject,
      status: 'rejected',
      provider: 'outlook_ai_agent',
      failureReason: reason || 'Rejected by admin'
    });
  }
  return action;
}

async function sendApprovedOutlookEmailAction(db, id, actorId = 'admin_api_key') {
  const config = getOutlookAgentConfig();
  const current = await db.query('SELECT * FROM outlook_email_actions WHERE id = $1', [cleanText(id)]);
  const action = current.rows[0] || null;
  if (!action) return { sent: false, reason: 'outlook_action_not_found' };
  if (config.draftOnly) {
    return { sent: false, reason: 'outlook_draft_only_enabled', action };
  }
  if (!['approved', 'draft_ready'].includes(String(action.status || '').toLowerCase())) {
    return { sent: false, reason: 'outlook_action_not_approved', action };
  }
  if (!config.autoSendCategories.includes(String(action.category || '').toLowerCase())) {
    return { sent: false, reason: 'outlook_category_not_allowlisted', action };
  }

  let sendResult = null;
  try {
    if (action.graph_draft_id && config.configured) {
      await outlookGraphRequest(
        `/users/${encodeURIComponent(config.mailbox)}/messages/${encodeURIComponent(action.graph_draft_id)}/send`,
        { method: 'POST' },
        config
      );
      sendResult = { sent: true, provider: 'outlook_graph' };
    } else {
      sendResult = await sendSupportEmail({
        to: action.to_email,
        subject: action.subject,
        text: action.body_text,
        html: action.body_html,
        replyTo: getSupportEmail()
      });
    }
  } catch (error) {
    sendResult = { sent: false, provider: 'outlook_graph', error: error.message };
  }

  const updated = await updateOutlookActionStatus(db, id, {
    status: sendResult?.sent ? 'sent' : 'failed',
    approvedBy: actorId,
    sentAt: sendResult?.sent ? new Date().toISOString() : null,
    failureReason: sendResult?.sent ? null : (sendResult?.reason || sendResult?.error || 'outlook_send_failed'),
    metadata: {
      sent_from: 'king_dashboard',
      provider: sendResult?.provider || null
    }
  });
  await logEmailEvent(db, {
    eventType: 'outlook_ai_reply_send_attempt',
    recipientEmail: action.to_email,
    templateKey: action.category,
    subject: action.subject,
    status: sendResult?.sent ? 'sent' : 'failed',
    provider: sendResult?.provider || 'outlook_ai_agent',
    failureReason: sendResult?.sent ? null : (sendResult?.reason || sendResult?.error || 'outlook_send_failed'),
    sentAt: sendResult?.sent ? new Date().toISOString() : null
  });
  return { ...sendResult, action: updated };
}

module.exports = {
  approveOutlookEmailAction,
  buildOutlookReplyDraft,
  classifyOutlookEmail,
  fetchOutlookInboxMessages,
  getOutlookAgentConfig,
  getOutlookAgentStatus,
  listOutlookEmailActions,
  queueOutlookReplyDraft,
  rejectOutlookEmailAction,
  sendApprovedOutlookEmailAction,
  syncOutlookInbox
};
