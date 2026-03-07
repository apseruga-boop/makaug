const express = require('express');
const db = require('../config/database');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const dbStatus = await db.healthcheck();

    return res.json({
      ok: true,
      service: 'makayug-backend',
      env: process.env.NODE_ENV || 'development',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      database: {
        ok: true,
        now: dbStatus.now
      }
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      service: 'makayug-backend',
      database: {
        ok: false,
        error: 'Database unreachable'
      }
    });
  }
});

module.exports = router;
