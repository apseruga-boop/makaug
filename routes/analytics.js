const express = require('express');

const db = require('../config/database');
const { cleanText } = require('../middleware/validation');
const { isConfigured, sendGA4Event } = require('../services/ga4Service');

const router = express.Router();

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
    return next(error);
  }
});

module.exports = router;
