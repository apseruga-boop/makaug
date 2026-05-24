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

router.get('/migrations', async (_req, res) => {
  const required = [
    '033_task3_engagement_crm.sql',
    '034_task4_super_admin_alerts_payments.sql',
    '044_clean_sourced_candidates_seed_found_online_2026.sql',
    '045_expand_found_online_sweep_images_and_sources.sql',
    '046_tiktok_deep_sweep_source_profiles.sql',
    '047_tiktok_realtor_mahad_video_index.sql'
  ];
  try {
    const result = await db.query(
      `SELECT filename, applied_at
       FROM schema_migrations
       WHERE filename = ANY($1::text[])
       ORDER BY filename`,
      [required]
    );
    const applied = new Map(result.rows.map((row) => [row.filename, row.applied_at]));
    return res.json({
      ok: true,
      migrations: required.map((filename) => ({
        filename,
        applied: applied.has(filename),
        appliedAt: applied.get(filename) || null
      }))
    });
  } catch (error) {
    return res.status(503).json({
      ok: false,
      error: 'Migration status unavailable'
    });
  }
});

module.exports = router;
