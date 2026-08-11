const express = require('express');
const db = require('../config/database');
const { tenantFor } = require('../packages/shared-country-core');

const router = express.Router();
const ACTIVE_COUNTRY_CODE = String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase();
const ACTIVE_TENANT = tenantFor(ACTIVE_COUNTRY_CODE);
const ACTIVE_SERVICE = process.env.RENDER_SERVICE_NAME || `${ACTIVE_TENANT.brandName}-backend`;

router.get('/', async (req, res) => {
  try {
    const dbStatus = await db.healthcheck();

    return res.json({
      ok: true,
      service: ACTIVE_SERVICE,
      country_code: ACTIVE_COUNTRY_CODE,
      tenant: ACTIVE_TENANT.brandName,
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
      service: ACTIVE_SERVICE,
      country_code: ACTIVE_COUNTRY_CODE,
      tenant: ACTIVE_TENANT.brandName,
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
    '047_tiktok_realtor_mahad_video_index.sql',
    '048_tiktok_facebook_double_down_profiles.sql',
    '049_social_first_x_priority_profiles.sql',
    '050_publish_found_online_launch_inventory.sql',
    '051_enforce_social_only_preapproved_inventory.sql',
    '052_remove_implicit_found_online_approvals.sql',
    '053_remove_land_search_help_flags.sql',
    '054_restore_youtube_social_found_online_inventory.sql',
    '055_republish_curated_youtube_social_inventory.sql',
    '056_fix_social_source_location_pins.sql',
    '057_suspend_auto_source_agent_profiles.sql',
    '058_correct_lady_property_agent_kira_mansion.sql'
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
