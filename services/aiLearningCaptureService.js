const db = require('../config/database');
const { ingestEvent } = require('./aiFoundationService');

function cleanText(value, max = 4000) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

function asObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

async function ensureDefaultSite() {
  const tenantCode = cleanText(process.env.AI_DEFAULT_TENANT_CODE || 'makaug', 100);
  const siteCode = cleanText(process.env.AI_DEFAULT_SITE_CODE || 'makaug-web', 100);

  const tenant = await db.query(
    `
      INSERT INTO ai_tenants (code, name, status, metadata)
      VALUES ($1, $2, 'active', $3::jsonb)
      ON CONFLICT (code)
      DO UPDATE SET status = 'active', updated_at = NOW()
      RETURNING id, code, name
    `,
    [tenantCode, 'MakaUg', JSON.stringify({ source: 'auto_capture' })]
  );

  const site = await db.query(
    `
      INSERT INTO ai_sites (tenant_id, code, name, domain, status, metadata)
      VALUES ($1, $2, $3, $4, 'active', $5::jsonb)
      ON CONFLICT (tenant_id, code)
      DO UPDATE SET status = 'active', domain = COALESCE(EXCLUDED.domain, ai_sites.domain), updated_at = NOW()
      RETURNING id AS site_id, tenant_id, code AS site_code, name AS site_name
    `,
    [
      tenant.rows[0].id,
      siteCode,
      'MakaUg Website',
      (process.env.PUBLIC_BASE_URL || 'https://makaug.com').replace(/^https?:\/\//, ''),
      JSON.stringify({ source: 'auto_capture' })
    ]
  );

  return {
    tenant_id: tenant.rows[0].id,
    tenant_code: tenant.rows[0].code,
    tenant_name: tenant.rows[0].name,
    site_id: site.rows[0].site_id,
    site_code: site.rows[0].site_code,
    site_name: site.rows[0].site_name
  };
}

function inferIntent(eventName) {
  const name = cleanText(eventName, 120).toLowerCase();
  if (name.includes('property_request')) return 'looking_for_property_lead';
  if (name.includes('listing')) return 'property_listing';
  if (name.includes('advertising')) return 'support';
  if (name.includes('agent')) return 'agent_search';
  return 'unknown';
}

async function captureLearningEvent({
  eventName,
  source = 'website',
  channel = 'web',
  sessionId,
  externalUserId,
  language = 'en',
  inputText,
  responseText,
  payload,
  entities,
  outcome = 'submitted',
  dedupeKey,
  requestIp = null,
  userAgent = null
}) {
  try {
    const site = await ensureDefaultSite();
    const eventPayload = {
      event_type: eventName,
      intent: inferIntent(eventName),
      intent_confidence: 0.86,
      language,
      input_text: inputText,
      response_text: responseText,
      entities: asObject(entities, {}),
      attributes: asObject(payload, {}),
      outcome,
      label: 'auto_captured',
      is_training_candidate: Boolean(inputText || responseText),
      ...asObject(payload, {})
    };

    return await ingestEvent({
      site,
      source,
      channel,
      session: {
        external_session_id: sessionId || dedupeKey || `${eventName}:${Date.now()}`,
        external_user_id: externalUserId || null,
        language,
        metadata: { auto_capture: true }
      },
      event: {
        event_name: eventName,
        dedupe_key: dedupeKey || null,
        payload: eventPayload
      },
      requestIp,
      userAgent
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      console.warn('[ai-learning] capture skipped:', error.message || error);
    }
    return null;
  }
}

module.exports = {
  captureLearningEvent
};
