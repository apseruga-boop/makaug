const express = require('express');

const db = require('../config/database');
const { requireAdminApiKey } = require('../middleware/auth');
const { cleanText } = require('../middleware/validation');
const {
  FOUNDATION_EVENT_SCHEMA,
  findActiveSite,
  ingestEvent,
  rotateSiteIngestApiKey
} = require('../services/aiFoundationService');
const { runFoundationExport } = require('../services/aiFoundationExportService');

const router = express.Router();

function parseInteger(value, fallback) {
  const n = parseInt(String(value || ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseFloatValue(value, fallback) {
  const n = parseFloat(String(value || ''));
  return Number.isFinite(n) ? n : fallback;
}

function asObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return fallback;
}

function asEventsArray(body) {
  if (Array.isArray(body?.events) && body.events.length) {
    return body.events;
  }
  if (body?.event && typeof body.event === 'object') {
    return [body.event];
  }
  return [];
}

router.get('/event-schema', (_req, res) => {
  return res.json({
    ok: true,
    data: FOUNDATION_EVENT_SCHEMA
  });
});

router.post('/ingest/events', async (req, res, next) => {
  try {
    const body = asObject(req.body, {});
    const siteCode = cleanText(body.site_code || body.siteCode, 100) || null;
    const siteKey = cleanText(req.get('x-site-key'), 300) || null;
    const adminKey = cleanText(req.get('x-api-key'), 300) || null;

    if (!siteKey && (!process.env.ADMIN_API_KEY || adminKey !== process.env.ADMIN_API_KEY)) {
      return res.status(401).json({
        ok: false,
        error: 'Unauthorized. Provide x-site-key or valid admin x-api-key.'
      });
    }

    const site = await findActiveSite({
      siteCode,
      siteKey
    });

    if (!site) {
      return res.status(404).json({
        ok: false,
        error: 'Active site not found. Check site_code or x-site-key.'
      });
    }

    const events = asEventsArray(body);
    if (!events.length) {
      return res.status(400).json({
        ok: false,
        error: 'Request must include event or events[]'
      });
    }

    const source = cleanText(body.source, 80) || 'unknown';
    const channel = cleanText(body.channel, 40) || 'web';
    const session = asObject(body.session, {});
    const requestIp = req.headers['x-forwarded-for']
      ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
      : req.ip;
    const userAgent = req.get('user-agent') || null;

    const results = [];
    for (const event of events) {
      const ingested = await ingestEvent({
        site,
        source,
        channel,
        session,
        event,
        requestIp,
        userAgent
      });
      results.push(ingested);
    }

    return res.status(202).json({
      ok: true,
      data: {
        tenant_code: site.tenant_code,
        site_code: site.site_code,
        accepted: results.filter((r) => !r.duplicate).length,
        duplicates: results.filter((r) => r.duplicate).length,
        results
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/sites/:siteCode/rotate-key', requireAdminApiKey, async (req, res, next) => {
  try {
    const siteCode = req.params.siteCode;
    const result = await rotateSiteIngestApiKey(siteCode);

    return res.status(201).json({
      ok: true,
      data: {
        site_id: result.site.id,
        site_code: result.site.code,
        site_name: result.site.name,
        ingest_api_key: result.ingestApiKey
      },
      warning: 'Store this key now. It is only returned once.'
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/sites', requireAdminApiKey, async (req, res, next) => {
  try {
    const siteCode = cleanText(req.query.site_code, 100) || null;
    const params = [];
    let where = '';
    if (siteCode) {
      params.push(siteCode);
      where = `WHERE s.code = $1`;
    }

    const { rows } = await db.query(
      `
        SELECT
          s.id,
          s.code,
          s.name,
          s.domain,
          s.status,
          s.tenant_id,
          t.code AS tenant_code,
          t.name AS tenant_name,
          (s.ingest_api_key_hash IS NOT NULL) AS ingest_key_configured,
          s.created_at,
          s.updated_at
        FROM ai_sites s
        JOIN ai_tenants t ON t.id = s.tenant_id
        ${where}
        ORDER BY t.code, s.code
      `,
      params
    );

    return res.json({
      ok: true,
      data: rows
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/stats', requireAdminApiKey, async (req, res, next) => {
  try {
    const siteCode = cleanText(req.query.site_code, 100) || null;

    let params = [];
    let siteWhere = '';
    if (siteCode) {
      params = [siteCode];
      siteWhere = 'WHERE s.code = $1';
    }

    const site = await db.query(
      `
        SELECT s.id, s.code, t.code AS tenant_code
        FROM ai_sites s
        JOIN ai_tenants t ON t.id = s.tenant_id
        ${siteWhere}
        ORDER BY s.created_at DESC
        LIMIT 1
      `,
      params
    );

    if (!site.rows.length) {
      return res.status(404).json({
        ok: false,
        error: 'Site not found'
      });
    }

    const siteId = site.rows[0].id;

    const [counts, intents, languages, eventTypes, outcomes, lastExport] = await Promise.all([
      db.query(
        `
          SELECT
            (SELECT COUNT(*)::int FROM ai_sessions WHERE site_id = $1) AS total_sessions,
            (SELECT COUNT(*)::int FROM ai_events_raw WHERE site_id = $1) AS total_raw_events,
            (SELECT COUNT(*)::int FROM ai_events_normalized WHERE site_id = $1) AS total_normalized_events,
            (SELECT COUNT(*)::int FROM ai_events_normalized WHERE site_id = $1 AND is_training_candidate = TRUE) AS training_candidates,
            (SELECT COUNT(*)::int FROM ai_events_raw WHERE site_id = $1 AND event_ts >= NOW() - INTERVAL '24 hours') AS raw_events_24h,
            (SELECT COUNT(*)::int FROM ai_events_normalized WHERE site_id = $1 AND event_ts >= NOW() - INTERVAL '24 hours') AS normalized_events_24h
        `,
        [siteId]
      ),
      db.query(
        `
          SELECT intent, COUNT(*)::int AS count
          FROM ai_events_normalized
          WHERE site_id = $1
          GROUP BY intent
          ORDER BY count DESC
          LIMIT 10
        `,
        [siteId]
      ),
      db.query(
        `
          SELECT language, COUNT(*)::int AS count
          FROM ai_events_normalized
          WHERE site_id = $1
          GROUP BY language
          ORDER BY count DESC
          LIMIT 10
        `,
        [siteId]
      ),
      db.query(
        `
          SELECT event_type, COUNT(*)::int AS count
          FROM ai_events_normalized
          WHERE site_id = $1
          GROUP BY event_type
          ORDER BY count DESC
          LIMIT 10
        `,
        [siteId]
      ),
      db.query(
        `
          SELECT COALESCE(outcome, 'unknown') AS outcome, COUNT(*)::int AS count
          FROM ai_events_normalized
          WHERE site_id = $1
          GROUP BY COALESCE(outcome, 'unknown')
          ORDER BY count DESC
          LIMIT 10
        `,
        [siteId]
      ),
      db.query(
        `
          SELECT id, status, total_exported, output_path, created_at, finished_at
          FROM ai_export_runs
          WHERE site_id = $1
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [siteId]
      )
    ]);

    return res.json({
      ok: true,
      data: {
        site: site.rows[0],
        counts: counts.rows[0] || {},
        top_intents: intents.rows,
        top_languages: languages.rows,
        top_event_types: eventTypes.rows,
        outcomes: outcomes.rows,
        last_export: lastExport.rows[0] || null
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/events/recent', requireAdminApiKey, async (req, res, next) => {
  try {
    const siteCode = cleanText(req.query.site_code, 100) || null;
    const limit = Math.max(1, Math.min(200, parseInteger(req.query.limit, 50)));

    let params = [];
    let siteWhere = '';
    if (siteCode) {
      params = [siteCode];
      siteWhere = 'WHERE s.code = $1';
    }

    const site = await db.query(
      `
        SELECT s.id, s.code, t.code AS tenant_code
        FROM ai_sites s
        JOIN ai_tenants t ON t.id = s.tenant_id
        ${siteWhere}
        ORDER BY s.created_at DESC
        LIMIT 1
      `,
      params
    );

    if (!site.rows.length) {
      return res.status(404).json({ ok: false, error: 'Site not found' });
    }

    const events = await db.query(
      `
        SELECT
          n.id,
          n.raw_event_id,
          n.event_ts,
          n.event_type,
          n.intent,
          n.intent_confidence,
          n.language,
          n.input_text,
          n.response_text,
          n.outcome,
          n.label,
          n.is_training_candidate,
          r.source,
          r.channel,
          r.processing_status,
          r.processing_error,
          r.dedupe_key
        FROM ai_events_normalized n
        JOIN ai_events_raw r ON r.id = n.raw_event_id
        WHERE n.site_id = $1
        ORDER BY n.event_ts DESC
        LIMIT $2
      `,
      [site.rows[0].id, limit]
    );

    return res.json({
      ok: true,
      data: {
        site: site.rows[0],
        events: events.rows
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/exports/run', requireAdminApiKey, async (req, res, next) => {
  try {
    const body = asObject(req.body, {});
    const output = await runFoundationExport({
      tenantCode: cleanText(body.tenant_code, 80) || null,
      siteCode: cleanText(body.site_code, 80) || null,
      days: parseInteger(body.days, 30),
      minConfidence: parseFloatValue(body.min_confidence, 0.55),
      limit: parseInteger(body.limit, 20000),
      createdBy: cleanText(body.created_by, 120) || 'admin_api',
      format: cleanText(body.format, 20) || 'jsonl'
    });

    return res.status(201).json({
      ok: true,
      data: output
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/exports/runs', requireAdminApiKey, async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(200, parseInteger(req.query.limit, 30)));
    const { rows } = await db.query(
      `
        SELECT
          r.id,
          r.format,
          r.days,
          r.min_confidence,
          r.total_exported,
          r.output_path,
          r.status,
          r.error_message,
          r.created_by,
          r.created_at,
          r.finished_at,
          t.code AS tenant_code,
          s.code AS site_code
        FROM ai_export_runs r
        LEFT JOIN ai_tenants t ON t.id = r.tenant_id
        LEFT JOIN ai_sites s ON s.id = r.site_id
        ORDER BY r.created_at DESC
        LIMIT $1
      `,
      [limit]
    );

    return res.json({
      ok: true,
      data: rows
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
