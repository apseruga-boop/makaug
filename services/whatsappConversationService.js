const db = require('../config/database');
const { normalizeUgPhoneForWhatsApp } = require('./whatsappNotificationService');

const WHATSAPP_CONVERSATION_STATUSES = [
  'open',
  'ai_active',
  'awaiting_customer',
  'needs_human',
  'escalated',
  'resolved',
  'archived'
];

const WHATSAPP_CONVERSATION_CATEGORIES = [
  'uncategorized',
  'property_search',
  'property_listing',
  'broker_help',
  'mortgage',
  'account',
  'support',
  'fraud_report',
  'marketing',
  'general'
];

const WHATSAPP_CONVERSATION_PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const WHATSAPP_CONVERSATION_AI_MODES = ['autopilot', 'copilot', 'off'];

function normalizeConversationPhone(phone) {
  const normalized = normalizeUgPhoneForWhatsApp(phone);
  return normalized || String(phone || '').replace(/\s+/g, '').trim();
}

function normalizeConversationCategory(value, fallback = 'uncategorized') {
  const raw = String(value || '').trim().toLowerCase();
  if (WHATSAPP_CONVERSATION_CATEGORIES.includes(raw)) return raw;
  return fallback;
}

function normalizeConversationStatus(value, fallback = 'open') {
  const raw = String(value || '').trim().toLowerCase();
  if (WHATSAPP_CONVERSATION_STATUSES.includes(raw)) return raw;
  return fallback;
}

function normalizeConversationPriority(value, fallback = 'normal') {
  const raw = String(value || '').trim().toLowerCase();
  if (WHATSAPP_CONVERSATION_PRIORITIES.includes(raw)) return raw;
  return fallback;
}

function normalizeConversationAiMode(value, fallback = 'autopilot') {
  const raw = String(value || '').trim().toLowerCase();
  if (WHATSAPP_CONVERSATION_AI_MODES.includes(raw)) return raw;
  return fallback;
}

function mapIntentToConversationCategory(intent = '') {
  const raw = String(intent || '').trim().toLowerCase();
  if (raw === 'property_search' || raw === 'looking_for_property_lead') return 'property_search';
  if (raw === 'property_listing') return 'property_listing';
  if (raw === 'agent_search' || raw === 'agent_registration') return 'broker_help';
  if (raw === 'mortgage_help') return 'mortgage';
  if (raw === 'account_help' || raw === 'saved_properties') return 'account';
  if (raw === 'support') return 'support';
  if (raw === 'report_listing') return 'fraud_report';
  if (raw === 'marketing_opt_in' || raw === 'marketing_opt_out') return 'marketing';
  if (!raw || raw === 'unknown') return 'uncategorized';
  return 'general';
}

function buildManualWhatsAppUrl(phone, message = '') {
  const recipient = normalizeConversationPhone(phone);
  if (!recipient) return '';
  const body = String(message || '').trim();
  return `https://wa.me/${recipient}${body ? `?text=${encodeURIComponent(body)}` : ''}`;
}

async function getWhatsappConversationControl(phone) {
  const normalizedPhone = normalizeConversationPhone(phone);
  if (!normalizedPhone) return null;

  const result = await db.query(
    `SELECT *
     FROM whatsapp_conversation_state
     WHERE phone = $1
     LIMIT 1`,
    [normalizedPhone]
  );

  return result.rows[0] || null;
}

async function syncWhatsappConversationState({
  phone,
  direction = 'inbound',
  intent = null,
  preferredLanguage = null,
  currentStep = null,
  provider = 'whatsapp',
  messageType = 'text',
  ai = false,
  human = false,
  metadata = {}
} = {}) {
  const normalizedPhone = normalizeConversationPhone(phone);
  if (!normalizedPhone) return null;

  const normalizedDirection = String(direction || 'inbound').trim().toLowerCase() === 'outbound' ? 'outbound' : 'inbound';
  const nextCategory = intent ? mapIntentToConversationCategory(intent) : null;
  const normalizedLanguage = String(preferredLanguage || '').trim().toLowerCase() || null;
  const meta = {
    ...(metadata && typeof metadata === 'object' ? metadata : {}),
    last_provider: provider || 'whatsapp',
    last_message_type: messageType || 'text',
    last_intent: intent || undefined,
    last_step: currentStep || undefined,
    last_language: normalizedLanguage || undefined
  };

  const result = await db.query(
    `INSERT INTO whatsapp_conversation_state (
      phone,
      status,
      category,
      category_source,
      priority,
      ai_mode,
      metadata,
      last_message_at,
      last_inbound_at,
      last_outbound_at,
      last_ai_reply_at,
      last_human_reply_at
    ) VALUES (
      $1,
      'open',
      COALESCE($2, 'uncategorized'),
      'auto',
      'normal',
      'autopilot',
      $3::jsonb,
      NOW(),
      CASE WHEN $4 = 'inbound' THEN NOW() ELSE NULL END,
      CASE WHEN $4 = 'outbound' THEN NOW() ELSE NULL END,
      CASE WHEN $4 = 'outbound' AND $5::boolean THEN NOW() ELSE NULL END,
      CASE WHEN $4 = 'outbound' AND $6::boolean THEN NOW() ELSE NULL END
    )
    ON CONFLICT (phone) DO UPDATE
    SET
      last_message_at = NOW(),
      last_inbound_at = CASE
        WHEN $4 = 'inbound' THEN NOW()
        ELSE whatsapp_conversation_state.last_inbound_at
      END,
      last_outbound_at = CASE
        WHEN $4 = 'outbound' THEN NOW()
        ELSE whatsapp_conversation_state.last_outbound_at
      END,
      last_ai_reply_at = CASE
        WHEN $4 = 'outbound' AND $5::boolean THEN NOW()
        ELSE whatsapp_conversation_state.last_ai_reply_at
      END,
      last_human_reply_at = CASE
        WHEN $4 = 'outbound' AND $6::boolean THEN NOW()
        ELSE whatsapp_conversation_state.last_human_reply_at
      END,
      category = CASE
        WHEN whatsapp_conversation_state.category_source = 'manual' THEN whatsapp_conversation_state.category
        WHEN $2 IS NULL THEN whatsapp_conversation_state.category
        ELSE $2
      END,
      category_source = CASE
        WHEN whatsapp_conversation_state.category_source = 'manual' THEN whatsapp_conversation_state.category_source
        WHEN $2 IS NULL THEN whatsapp_conversation_state.category_source
        ELSE 'auto'
      END,
      metadata = COALESCE(whatsapp_conversation_state.metadata, '{}'::jsonb) || $3::jsonb,
      updated_at = NOW()
    RETURNING *`,
    [
      normalizedPhone,
      nextCategory,
      JSON.stringify(meta),
      normalizedDirection,
      ai === true,
      human === true
    ]
  );

  return result.rows[0] || null;
}

async function updateWhatsappConversationControl(phone, patch = {}, actorId = 'admin_api_key') {
  const normalizedPhone = normalizeConversationPhone(phone);
  if (!normalizedPhone) {
    const error = new Error('Invalid phone');
    error.status = 400;
    throw error;
  }

  const setParts = [];
  const values = [normalizedPhone];
  let idx = 2;

  if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
    setParts.push(`status = $${idx}`);
    values.push(normalizeConversationStatus(patch.status));
    idx += 1;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'category')) {
    setParts.push(`category = $${idx}`);
    values.push(normalizeConversationCategory(patch.category));
    idx += 1;
    setParts.push(`category_source = 'manual'`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'priority')) {
    setParts.push(`priority = $${idx}`);
    values.push(normalizeConversationPriority(patch.priority));
    idx += 1;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'assigned_to')) {
    setParts.push(`assigned_to = NULLIF($${idx}, '')`);
    values.push(String(patch.assigned_to || '').trim());
    idx += 1;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'ai_mode')) {
    setParts.push(`ai_mode = $${idx}`);
    values.push(normalizeConversationAiMode(patch.ai_mode));
    idx += 1;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'last_summary')) {
    setParts.push(`last_summary = NULLIF($${idx}, '')`);
    values.push(String(patch.last_summary || '').trim());
    idx += 1;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'admin_notes')) {
    setParts.push(`admin_notes = NULLIF($${idx}, '')`);
    values.push(String(patch.admin_notes || '').trim());
    idx += 1;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'tags')) {
    const tags = Array.isArray(patch.tags)
      ? patch.tags.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    setParts.push(`tags = $${idx}::jsonb`);
    values.push(JSON.stringify(tags));
    idx += 1;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'metadata')) {
    setParts.push(`metadata = COALESCE(metadata, '{}'::jsonb) || $${idx}::jsonb`);
    values.push(JSON.stringify(patch.metadata && typeof patch.metadata === 'object' ? patch.metadata : {}));
    idx += 1;
  }

  if (!setParts.length) {
    return getWhatsappConversationControl(normalizedPhone);
  }

  setParts.push(`updated_at = NOW()`);

  const insertValues = {
    status: normalizeConversationStatus(patch.status),
    category: normalizeConversationCategory(patch.category),
    priority: normalizeConversationPriority(patch.priority),
    ai_mode: normalizeConversationAiMode(patch.ai_mode),
    assigned_to: String(patch.assigned_to || '').trim() || null,
    last_summary: String(patch.last_summary || '').trim() || null,
    admin_notes: String(patch.admin_notes || '').trim() || null,
    tags: Array.isArray(patch.tags) ? patch.tags.map((value) => String(value || '').trim()).filter(Boolean) : [],
    metadata: {
      ...(patch.metadata && typeof patch.metadata === 'object' ? patch.metadata : {}),
      updated_by: actorId || 'admin_api_key'
    }
  };

  const result = await db.query(
    `INSERT INTO whatsapp_conversation_state (
      phone,
      status,
      category,
      category_source,
      priority,
      assigned_to,
      ai_mode,
      last_summary,
      admin_notes,
      tags,
      metadata,
      last_message_at
    ) VALUES (
      $1,
      $${idx},
      $${idx + 1},
      CASE WHEN $${idx + 1} IS NULL OR $${idx + 1} = 'uncategorized' THEN 'auto' ELSE 'manual' END,
      $${idx + 2},
      $${idx + 3},
      $${idx + 4},
      $${idx + 5},
      $${idx + 6},
      $${idx + 7}::jsonb,
      $${idx + 8}::jsonb,
      NOW()
    )
    ON CONFLICT (phone) DO UPDATE
    SET ${setParts.join(', ')}
    RETURNING *`,
    [
      ...values,
      insertValues.status,
      insertValues.category,
      insertValues.priority,
      insertValues.assigned_to,
      insertValues.ai_mode,
      insertValues.last_summary,
      insertValues.admin_notes,
      JSON.stringify(insertValues.tags),
      JSON.stringify(insertValues.metadata)
    ]
  );

  return result.rows[0] || null;
}

module.exports = {
  WHATSAPP_CONVERSATION_STATUSES,
  WHATSAPP_CONVERSATION_CATEGORIES,
  WHATSAPP_CONVERSATION_PRIORITIES,
  WHATSAPP_CONVERSATION_AI_MODES,
  buildManualWhatsAppUrl,
  getWhatsappConversationControl,
  mapIntentToConversationCategory,
  normalizeConversationAiMode,
  normalizeConversationCategory,
  normalizeConversationPhone,
  normalizeConversationPriority,
  normalizeConversationStatus,
  syncWhatsappConversationState,
  updateWhatsappConversationControl
};
