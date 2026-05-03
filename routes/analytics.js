const express = require('express');

const db = require('../config/database');
const { cleanText } = require('../middleware/validation');
const { isConfigured, sendGA4Event } = require('../services/ga4Service');

const router = express.Router();

function isOptionalAnalyticsStorageError(error) {
  const parts = [];
  const collect = (item) => {
    if (!item) return;
    parts.push(item.message, item.code, item.stack, String(item));
    if (item.cause) collect(item.cause);
    if (Array.isArray(item.errors)) item.errors.forEach(collect);
  };
  collect(error);
  const message = parts.filter(Boolean).join(' ').toLowerCase();
  return !process.env.DATABASE_URL
    || message.includes('database_url')
    || message.includes('relation "analytics_events" does not exist')
    || message.includes('econnrefused')
    || message.includes('econnreset')
    || message.includes('enotfound')
    || message.includes('etimedout')
    || message.includes('connection terminated')
    || message.includes('timeout');
}

router.get('/config', (req, res) => {
  return res.json({
    ok: true,
    data: {
      ga4MeasurementId: process.env.GA4_MEASUREMENT_ID || null,
      ga4Enabled: isConfigured()
    }
  });
});

router.post('/event', async (req, res, next) => {
  try {
    const body = req.body || {};

    const eventName = cleanText(body.event_name || body.eventName);
    const clientId = cleanText(body.client_id || body.clientId || req.ip);
    const pagePath = cleanText(body.page_path || body.pagePath);
    const source = cleanText(body.source || 'web');
    const userPhone = cleanText(body.user_phone);
    const params = typeof body.params === 'object' && body.params ? body.params : {};

    if (!eventName) {
      return res.status(400).json({ ok: false, error: 'event_name is required' });
    }

    const saved = await db.query(
      `INSERT INTO analytics_events (
        event_name,
        client_id,
        user_phone,
        page_path,
        source,
        payload
      ) VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id, created_at`,
      [eventName, clientId, userPhone || null, pagePath || null, source, JSON.stringify(params)]
    );

    const ga4Result = await sendGA4Event({
      clientId,
      eventName,
      params: {
        page_path: pagePath || '/',
        source,
        ...params
      }
    });

    return res.status(201).json({
      ok: true,
      data: {
        id: saved.rows[0].id,
        createdAt: saved.rows[0].created_at,
        ga4: ga4Result
      }
    });
  } catch (error) {
    if (isOptionalAnalyticsStorageError(error)) {
      return res.status(202).json({
        ok: true,
        data: {
          stored: false,
          skippedReason: 'analytics_storage_unavailable'
        }
      });
    }
    return next(error);
  }
});

router.post('/web-vitals', async (req, res, next) => {
  try {
    const body = req.body || {};
    const metricName = cleanText(body.metricName || body.metric_name || body.name);
    const route = cleanText(body.route || body.page_path || body.pagePath);
    const rating = cleanText(body.rating || '');
    const sessionId = cleanText(body.sessionId || body.session_id || body.client_id || req.ip);
    const value = Number(body.value);

    if (!metricName || !Number.isFinite(value)) {
      return res.status(400).json({ ok: false, error: 'metricName and numeric value are required' });
    }

    const saved = await db.query(
      `INSERT INTO analytics_events (
        event_name,
        client_id,
        page_path,
        source,
        payload
      ) VALUES ($1,$2,$3,$4,$5)
      RETURNING id, created_at`,
      [
        `web_vital_${metricName.toLowerCase()}`,
        sessionId || req.ip,
        route || null,
        'web_vitals',
        JSON.stringify({
          metricName,
          value,
          rating,
          route,
          device: cleanText(body.device || ''),
          connection: cleanText(body.connection || '')
        })
      ]
    );

    return res.status(201).json({
      ok: true,
      data: {
        id: saved.rows[0].id,
        createdAt: saved.rows[0].created_at
      }
    });
  } catch (error) {
    if (isOptionalAnalyticsStorageError(error)) {
      return res.status(202).json({
        ok: true,
        data: {
          stored: false,
          skippedReason: 'analytics_storage_unavailable'
        }
      });
    }
    return next(error);
  }
});

module.exports = router;
