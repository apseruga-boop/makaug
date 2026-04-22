const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('../config/database');
const logger = require('../config/logger');

const router = express.Router();

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function requireUserAuth(req, res, next) {
  const authHeader = req.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token || !process.env.JWT_SECRET) {
    return res.status(401).json({ ok: false, error: 'Sign in required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded?.sub;
    if (!isUuid(userId)) {
      return res.status(401).json({ ok: false, error: 'Invalid session' });
    }

    const result = await db.query(
      'SELECT id, role, status FROM users WHERE id = $1 AND status = $2 LIMIT 1',
      [userId, 'active']
    );

    if (!result.rows.length) {
      return res.status(401).json({ ok: false, error: 'Invalid session' });
    }

    req.userAuth = result.rows[0];
    return next();
  } catch (error) {
    return res.status(401).json({ ok: false, error: 'Invalid session' });
  }
}

router.use(requireUserAuth);

router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT sp.property_id, sp.created_at, p.title, p.status
       FROM saved_properties sp
       JOIN properties p ON p.id = sp.property_id
       WHERE sp.user_id = $1 AND p.status = 'approved'
       ORDER BY sp.created_at DESC`,
      [req.userAuth.id]
    );

    return res.json({
      ok: true,
      data: {
        ids: result.rows.map((row) => row.property_id),
        items: result.rows,
        total: result.rows.length
      }
    });
  } catch (error) {
    logger.error('Failed to load saved properties', { error: error.message, userId: req.userAuth?.id });
    return next(error);
  }
});

router.post('/:propertyId', async (req, res, next) => {
  const propertyId = req.params.propertyId;
  if (!isUuid(propertyId)) {
    return res.status(400).json({ ok: false, error: 'Invalid property id' });
  }

  try {
    const property = await db.query(
      'SELECT id, status FROM properties WHERE id = $1 LIMIT 1',
      [propertyId]
    );

    if (!property.rows.length || property.rows[0].status !== 'approved') {
      return res.status(404).json({ ok: false, error: 'Property is not available to save' });
    }

    const saved = await db.query(
      `INSERT INTO saved_properties (user_id, property_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, property_id)
       DO UPDATE SET updated_at = NOW()
       RETURNING property_id, created_at, updated_at`,
      [req.userAuth.id, propertyId]
    );

    return res.json({ ok: true, data: saved.rows[0] });
  } catch (error) {
    logger.error('Failed to save property', { error: error.message, userId: req.userAuth?.id, propertyId });
    return next(error);
  }
});

router.delete('/:propertyId', async (req, res, next) => {
  const propertyId = req.params.propertyId;
  if (!isUuid(propertyId)) {
    return res.status(400).json({ ok: false, error: 'Invalid property id' });
  }

  try {
    const removed = await db.query(
      `DELETE FROM saved_properties
       WHERE user_id = $1 AND property_id = $2
       RETURNING property_id`,
      [req.userAuth.id, propertyId]
    );

    return res.json({
      ok: true,
      data: {
        property_id: propertyId,
        removed: removed.rowCount > 0
      }
    });
  } catch (error) {
    logger.error('Failed to remove saved property', { error: error.message, userId: req.userAuth?.id, propertyId });
    return next(error);
  }
});

module.exports = router;
