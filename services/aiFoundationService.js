const crypto = require('crypto');

const db = require('../config/database');

const SUPPORTED_LANGUAGES = new Set(['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm']);
const SUPPORTED_INTENTS = new Set([
  'property_search',
  'property_listing',
  'agent_search',
  'agent_registration',
  'mortgage_help',
  'account_help',
  'saved_properties',
  'support',
  'report_listing',
  'looking_for_property_lead',
  'unknown'
]);

function toSha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function cleanText(value, max = 2000) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function asObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return fallback;
}

function toEventTimestamp(value) {
  if (!value) return new Date();
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return new Date();
  return dt;
}

function normalizeLanguage(value) {
  const code = cleanText(value, 10).toLowerCase();
  if (!code) return 'en';
  return SUPPORTED_LANGUAGES.has(code) ? code : 'en';
}

function normalizeIntent(value) {
  const intent = cleanText(value, 80).toLowerCase();
  if (!intent) return 'unknown';
  return SUPPORTED_INTENTS.has(intent) ? intent : 'unknown';
}

function normalizeEventName(value) {
  const raw = cleanText(value, 120).toLowerCase();
  if (!raw) return 'unknown_event';
  return raw.replace(/[^a-z0-9._:-]/g, '_').slice(0, 120) || 'unknown_event';
}

function normalizeChannel(value) {
  const raw = cleanText(value, 40).toLowerCase();
  if (!raw) return 'web';
  return raw;
}

function normalizeSource(value) {
  const raw = cleanText(value, 80).toLowerCase();
  if (!raw) return 'unknown';
  return raw;
}

function toNullableConfidence(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function pickInputText(payload) {
  const p = asObject(payload);
  return cleanText(
    p.input_text ||
      p.user_text ||
      p.user_message ||
      p.message_text ||
      (asObject(p.message).text || asObject(p.input).text || p.transcript || ''),
    4000
  );
}

function pickResponseText(payload) {
  const p = asObject(payload);
  return cleanText(
    p.response_text ||
      p.reply_text ||
      p.assistant_text ||
      p.bot_reply ||
      (asObject(p.response).text || asObject(p.reply).text || ''),
    4000
  );
}

function isTrainingCandidate({ intentConfidence, inputText, responseText, outcome }) {
  const threshold = Number(process.env.AI_TRAINING_MIN_CONFIDENCE || '0.55');
  if (!inputText || !responseText) return false;
  if (intentConfidence != null && intentConfidence < threshold) return false;
  const status = cleanText(outcome, 80).toLowerCase();
  if (status && ['error', 'failed', 'invalid'].includes(status)) return false;
  return true;
}

function buildNormalizedFields(rawEvent) {
  const payload = asObject(rawEvent.payload);
  const eventType = normalizeEventName(payload.event_type || rawEvent.event_name || 'unknown_event');
  const language = normalizeLanguage(payload.language || payload.lang || rawEvent.channel);
  const intent = normalizeIntent(payload.intent || payload.detected_intent || payload.intent_name);
  const intentConfidence = toNullableConfidence(
    payload.intent_confidence || payload.confidence || payload.intent_score
  );
  const inputText = pickInputText(payload);
  const responseText = pickResponseText(payload);
  const entities = asObject(payload.entities, {});
  const attributes = asObject(payload.attributes, {});
  const outcome = cleanText(payload.outcome || payload.status || payload.result, 80) || null;
  const label = cleanText(payload.label || payload.training_label, 120) || null;
  const training = isTrainingCandidate({
    intentConfidence,
    inputText,
    responseText,
    outcome
  });

  return {
    eventType,
    intent,
    intentConfidence,
    language,
    inputText: inputText || null,
    responseText: responseText || null,
    entities,
    attributes,
    outcome,
    label,
    isTrainingCandidate: training
  };
}

async function findActiveSite({ siteCode, siteKey }) {
  const code = cleanText(siteCode, 100) || null;
  const key = cleanText(siteKey, 300) || null;
  const hashedKey = key ? toSha256(key) : null;

  const conditions = [];
  const params = [];

  if (code) {
    params.push(code);
    conditions.push(`s.code = $${params.length}`);
  }
  if (hashedKey) {
    params.push(hashedKey);
    conditions.push(`s.ingest_api_key_hash = $${params.length}`);
  }
  if (!conditions.length) {
    return null;
  }

  const sql = `
    SELECT
      s.id AS site_id,
      s.code AS site_code,
      s.name AS site_name,
      s.tenant_id,
      t.code AS tenant_code,
      t.name AS tenant_name
    FROM ai_sites s
    JOIN ai_tenants t ON t.id = s.tenant_id
    WHERE s.status = 'active'
      AND t.status = 'active'
      AND ${conditions.join(' AND ')}
    LIMIT 1
  `;

  const { rows } = await db.query(sql, params);
  return rows[0] || null;
}

async function upsertSession({
  tenantId,
  siteId,
  channel,
  language,
  externalSessionId,
  externalUserId,
  metadata
}) {
  if (!externalSessionId) return null;

  const { rows } = await db.query(
    `
      INSERT INTO ai_sessions (
        tenant_id, site_id, external_session_id, external_user_id, channel, language, metadata
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
      ON CONFLICT (site_id, external_session_id)
      DO UPDATE SET
        external_user_id = COALESCE(EXCLUDED.external_user_id, ai_sessions.external_user_id),
        channel = EXCLUDED.channel,
        language = EXCLUDED.language,
        metadata = ai_sessions.metadata || EXCLUDED.metadata,
        last_seen_at = NOW()
      RETURNING id
    `,
    [
      tenantId,
      siteId,
      externalSessionId,
      externalUserId || null,
      normalizeChannel(channel),
      normalizeLanguage(language),
      JSON.stringify(asObject(metadata, {}))
    ]
  );

  return rows[0]?.id || null;
}

async function getExistingRawByDedupe(siteId, dedupeKey) {
  if (!dedupeKey) return null;
  const { rows } = await db.query(
    `
      SELECT id
      FROM ai_events_raw
      WHERE site_id = $1
        AND dedupe_key = $2
      LIMIT 1
    `,
    [siteId, dedupeKey]
  );
  return rows[0]?.id || null;
}

async function ingestEvent({
  site,
  source,
  channel,
  session,
  event,
  requestIp = null,
  userAgent = null
}) {
  const sessionInfo = asObject(session, {});
  const eventInfo = asObject(event, {});
  const payload = asObject(eventInfo.payload, {});
  const dedupeKey = cleanText(eventInfo.dedupe_key, 200) || null;
  const eventName = normalizeEventName(eventInfo.event_name || payload.event_name || payload.event_type);

  const existingRaw = await getExistingRawByDedupe(site.site_id, dedupeKey);
  if (existingRaw) {
    const existingNorm = await db.query(
      `SELECT id FROM ai_events_normalized WHERE raw_event_id = $1 LIMIT 1`,
      [existingRaw]
    );
    return {
      duplicate: true,
      rawEventId: existingRaw,
      normalizedEventId: existingNorm.rows[0]?.id || null
    };
  }

  const sessionId = await upsertSession({
    tenantId: site.tenant_id,
    siteId: site.site_id,
    channel: channel || eventInfo.channel || payload.channel || 'web',
    language: sessionInfo.language || payload.language || 'en',
    externalSessionId:
      cleanText(sessionInfo.external_session_id || sessionInfo.session_id || payload.session_id, 180) || null,
    externalUserId: cleanText(sessionInfo.external_user_id || sessionInfo.user_id || payload.user_id, 180) || null,
    metadata: asObject(sessionInfo.metadata, {})
  });

  let raw;
  try {
    const rawInsert = await db.query(
      `
        INSERT INTO ai_events_raw (
          tenant_id, site_id, session_id, source, channel, event_name, schema_version,
          event_ts, request_ip, user_agent, dedupe_key, payload
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
        RETURNING id, event_name, event_ts, channel, payload
      `,
      [
        site.tenant_id,
        site.site_id,
        sessionId,
        normalizeSource(source || eventInfo.source || payload.source || 'unknown'),
        normalizeChannel(channel || eventInfo.channel || payload.channel || 'web'),
        eventName,
        cleanText(eventInfo.schema_version || '1.0', 20),
        toEventTimestamp(eventInfo.event_ts || payload.event_ts || payload.timestamp),
        requestIp,
        cleanText(userAgent, 512) || null,
        dedupeKey,
        JSON.stringify(payload)
      ]
    );
    raw = rawInsert.rows[0];
  } catch (error) {
    if (error?.code === '23505' && dedupeKey) {
      const concurrentRawId = await getExistingRawByDedupe(site.site_id, dedupeKey);
      const existingNorm = await db.query(
        `SELECT id FROM ai_events_normalized WHERE raw_event_id = $1 LIMIT 1`,
        [concurrentRawId]
      );
      return {
        duplicate: true,
        rawEventId: concurrentRawId,
        normalizedEventId: existingNorm.rows[0]?.id || null
      };
    }
    throw error;
  }

  const norm = buildNormalizedFields(raw);

  try {
    const normInsert = await db.query(
      `
        INSERT INTO ai_events_normalized (
          raw_event_id, tenant_id, site_id, session_id, event_ts, channel, event_type,
          intent, intent_confidence, language, input_text, response_text,
          entities, attributes, outcome, label, is_training_candidate
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,$12,
          $13::jsonb,$14::jsonb,$15,$16,$17
        )
        RETURNING id
      `,
      [
        raw.id,
        site.tenant_id,
        site.site_id,
        sessionId,
        raw.event_ts,
        raw.channel,
        norm.eventType,
        norm.intent,
        norm.intentConfidence,
        norm.language,
        norm.inputText,
        norm.responseText,
        JSON.stringify(norm.entities),
        JSON.stringify(norm.attributes),
        norm.outcome,
        norm.label,
        norm.isTrainingCandidate
      ]
    );

    await db.query(
      `UPDATE ai_events_raw SET processing_status = 'normalized', processing_error = NULL WHERE id = $1`,
      [raw.id]
    );

    return {
      duplicate: false,
      rawEventId: raw.id,
      normalizedEventId: normInsert.rows[0]?.id || null
    };
  } catch (error) {
    await db.query(
      `UPDATE ai_events_raw SET processing_status = 'error', processing_error = $2 WHERE id = $1`,
      [raw.id, cleanText(error.message, 1000)]
    );
    throw error;
  }
}

function generateIngestApiKey() {
  return `msk_${crypto.randomBytes(24).toString('hex')}`;
}

async function rotateSiteIngestApiKey(siteCode) {
  const code = cleanText(siteCode, 100);
  if (!code) {
    throw new Error('site_code is required');
  }
  const plainKey = generateIngestApiKey();
  const hash = toSha256(plainKey);

  const { rows } = await db.query(
    `
      UPDATE ai_sites
      SET ingest_api_key_hash = $2
      WHERE code = $1
      RETURNING id, code, name
    `,
    [code, hash]
  );

  if (!rows.length) {
    throw new Error('Site not found');
  }

  return {
    site: rows[0],
    ingestApiKey: plainKey
  };
}

const FOUNDATION_EVENT_SCHEMA = {
  schema_version: '1.0',
  required_top_level: ['site_code', 'event'],
  top_level: {
    site_code: 'string',
    source: 'string (optional)',
    channel: 'string (optional)',
    session: {
      external_session_id: 'string (recommended)',
      external_user_id: 'string (optional)',
      language: 'en|lg|sw|ac|ny|rn|sm (optional)',
      metadata: 'object (optional)'
    },
    event: {
      event_name: 'string (required)',
      schema_version: 'string (optional, default 1.0)',
      event_ts: 'ISO timestamp (optional)',
      dedupe_key: 'string (optional but recommended)',
      payload: 'object (required)'
    },
    events: 'array<event> (optional; can send batch)'
  },
  normalized_fields: [
    'event_type',
    'intent',
    'intent_confidence',
    'language',
    'input_text',
    'response_text',
    'entities',
    'attributes',
    'outcome',
    'label',
    'is_training_candidate'
  ],
  dedupe_rule: 'dedupe_key unique per site_code',
  auth_headers: ['x-site-key (preferred)', 'x-api-key (admin fallback)']
};

module.exports = {
  FOUNDATION_EVENT_SCHEMA,
  SUPPORTED_LANGUAGES: Array.from(SUPPORTED_LANGUAGES),
  SUPPORTED_INTENTS: Array.from(SUPPORTED_INTENTS),
  normalizeLanguage,
  normalizeIntent,
  normalizeEventName,
  normalizeChannel,
  normalizeSource,
  toSha256,
  findActiveSite,
  ingestEvent,
  rotateSiteIngestApiKey
};
