'use strict';

const express = require('express');

const db = require('../config/database');
const { requireStaffAccess } = require('../middleware/auth');
const { openToken } = require('../services/agentBookingService');

const router = express.Router();

router.get('/staff-flags', requireStaffAccess, async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT f.id, f.kind, f.message, f.created_at, f.booking_id, f.listing_id,
              r.intent, r.status, r.visitor_name, r.visitor_phone, a.full_name AS agent_name
         FROM agent_booking_staff_flags f
         LEFT JOIN agent_booking_requests r ON r.id = f.booking_id
         LEFT JOIN agents a ON a.id = r.agent_id
        WHERE f.resolved_at IS NULL
        ORDER BY f.created_at DESC
        LIMIT 50`
    );
    return res.json({ ok: true, data: rows.rows });
  } catch (error) {
    if (error.code === '42P01') return res.json({ ok: true, data: [] });
    return next(error);
  }
});

router.post('/staff-flags/:id/resolve', requireStaffAccess, async (req, res, next) => {
  try {
    const result = await db.query(
      `UPDATE agent_booking_staff_flags
          SET resolved_at = NOW()
        WHERE id = $1 AND resolved_at IS NULL
        RETURNING id`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Flag not found' });
    return res.json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

async function handleToken(req, res, next) {
  try {
    const result = await openToken(db, req.params.token, {
      method: req.method,
      purpose: req.get('purpose') || req.get('sec-purpose') || '',
      body: req.body || {},
      lang: String(req.query.lang || 'en').slice(0, 8)
    });
    res.status(result.status);
    res.set('Cache-Control', 'no-store');
    res.type(result.contentType || 'text/html');
    return res.send(result.body);
  } catch (error) {
    return next(error);
  }
}

router.get('/token/:token', handleToken);
router.post('/token/:token', handleToken);

module.exports = router;
module.exports.handleToken = handleToken;
