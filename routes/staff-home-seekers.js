'use strict';

// Staff view of home seekers (26 Oct 2026, areas D and E):
// - who signed up as a home seeker, what was saved (account or device) and
//   which "alert me" searches were made, with counts for the last 24 hours;
// - the "agreed in person" tick that records marketing consent given face to
//   face, with the date it was given;
// - the WhatsApp alert rows waiting (written as previews; nothing is sent).

const express = require('express');
const db = require('../config/database');
const logger = require('../config/logger');
const { requireStaffAccess } = require('../middleware/auth');
const {
  STAFF_IN_PERSON_CONSENT_WORDING,
  recordUserMarketingConsent,
  validConsentedAt
} = require('../services/marketingConsentService');
const { getPendingAlertSummary, runWhatsappAlertDigest } = require('../services/whatsappAlertDigestService');

const router = express.Router();
router.use(requireStaffAccess);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEEKER_ROLES = ['buyer_renter', 'student'];

function deviceLabel(deviceId) {
  const id = String(deviceId || '');
  return id ? `Device …${id.slice(-6)}` : 'Device';
}

// The date staff ticked as the day the person agreed, at midday Kampala time,
// so the stored timestamp falls on that calendar day in Uganda and the UK.
function inPersonConsentDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return new Date();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return validConsentedAt(`${raw}T12:00:00+03:00`);
}

async function loadHomeSeekerOverview(runner = db, { days = 14 } = {}) {
  const windowDays = Math.min(Math.max(Number(days) || 14, 1), 90);
  const [counts, signups, saves, alerts] = await Promise.all([
    runner.query(
      `SELECT
         (SELECT COUNT(*)::int FROM users
           WHERE role = ANY($1::text[]) AND created_at >= NOW() - INTERVAL '24 hours') AS signups_24h,
         (SELECT COUNT(*)::int FROM users
           WHERE role = ANY($1::text[]) AND created_at >= NOW() - ($2::int * INTERVAL '1 day')) AS signups_window,
         (SELECT COUNT(*)::int FROM saved_properties WHERE created_at >= NOW() - INTERVAL '24 hours') AS saves_24h,
         (SELECT COUNT(*)::int FROM saved_properties
           WHERE user_id IS NULL AND created_at >= NOW() - INTERVAL '24 hours') AS device_saves_24h,
         (SELECT COUNT(*)::int FROM saved_searches
           WHERE created_from = 'results_alert_button' AND created_at >= NOW() - INTERVAL '24 hours') AS alerts_24h,
         (SELECT COUNT(*)::int FROM users WHERE marketing_opt_in = TRUE) AS whatsapp_marketing_yes`,
      [SEEKER_ROLES, windowDays]
    ),
    runner.query(
      `SELECT u.id, u.first_name, u.last_name, u.phone, u.email, u.role, u.created_at,
              u.phone_verified, u.email_verified, u.marketing_opt_in, u.marketing_consent_at,
              u.marketing_consent_source, u.profile_data->>'audience' AS audience,
              (SELECT COUNT(*)::int FROM saved_properties sp WHERE sp.user_id = u.id) AS saves
       FROM users u
       WHERE u.role = ANY($1::text[])
         AND u.created_at >= NOW() - ($2::int * INTERVAL '1 day')
       ORDER BY u.created_at DESC
       LIMIT 50`,
      [SEEKER_ROLES, windowDays]
    ),
    runner.query(
      `SELECT sp.id, sp.property_id, sp.user_id, sp.device_id, sp.source, sp.created_at,
              p.title, p.inquiry_reference AS listing_code, p.district, p.area,
              u.first_name, u.last_name, u.phone
       FROM saved_properties sp
       JOIN properties p ON p.id = sp.property_id
       LEFT JOIN users u ON u.id = sp.user_id
       WHERE sp.created_at >= NOW() - ($1::int * INTERVAL '1 day')
       ORDER BY sp.created_at DESC
       LIMIT 50`,
      [windowDays]
    ),
    runner.query(
      `SELECT ss.id, ss.label, ss.user_id, ss.guest_session_id, ss.phone, ss.alert_scope, ss.created_at,
              u.first_name, u.last_name
       FROM saved_searches ss
       LEFT JOIN users u ON u.id = ss.user_id
       WHERE ss.created_from = 'results_alert_button'
         AND ss.status = 'active'
         AND ss.created_at >= NOW() - ($1::int * INTERVAL '1 day')
       ORDER BY ss.created_at DESC
       LIMIT 50`,
      [windowDays]
    )
  ]);
  const c = counts.rows[0] || {};
  const name = (row) => [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return {
    window_days: windowDays,
    counts: {
      signups_24h: c.signups_24h || 0,
      signups_window: c.signups_window || 0,
      saves_24h: c.saves_24h || 0,
      device_saves_24h: c.device_saves_24h || 0,
      alerts_24h: c.alerts_24h || 0,
      whatsapp_marketing_yes: c.whatsapp_marketing_yes || 0,
      new_24h: (c.signups_24h || 0) + (c.saves_24h || 0) + (c.alerts_24h || 0)
    },
    signups: signups.rows.map((row) => ({
      id: row.id,
      name: name(row) || 'No name',
      phone: row.phone || '',
      email: row.email || '',
      audience: row.audience || 'finder',
      created_at: row.created_at,
      verified: row.phone_verified ? 'phone' : (row.email_verified ? 'email' : 'no'),
      marketing_opt_in: row.marketing_opt_in === true,
      marketing_consent_at: row.marketing_consent_at,
      marketing_consent_source: row.marketing_consent_source || null,
      saves: row.saves || 0
    })),
    saves: saves.rows.map((row) => ({
      id: row.id,
      property_id: row.property_id,
      title: row.title,
      listing_code: row.listing_code,
      place: [row.area, row.district].filter(Boolean).join(', '),
      who: row.user_id ? (name(row) || row.phone || 'Account') : deviceLabel(row.device_id),
      kind: row.user_id ? 'account' : 'device',
      created_at: row.created_at
    })),
    alerts: alerts.rows.map((row) => ({
      id: row.id,
      label: row.label,
      who: row.user_id ? (name(row) || 'Account') : deviceLabel(row.guest_session_id),
      kind: row.user_id ? 'account' : 'device',
      whatsapp: row.alert_scope === 'search_alerts_whatsapp',
      phone: row.phone || '',
      created_at: row.created_at
    }))
  };
}

router.get('/', async (req, res, next) => {
  try {
    const overview = await loadHomeSeekerOverview(db, { days: req.query.days });
    let whatsappAlerts = null;
    try {
      whatsappAlerts = await getPendingAlertSummary(db);
    } catch (error) {
      if (!['42P01', '42703'].includes(error.code)) throw error;
    }
    return res.json({ ok: true, data: { ...overview, whatsapp_alerts: whatsappAlerts } });
  } catch (error) {
    return next(error);
  }
});

// "Agreed in person" tick. Records consent the person gave face to face, on
// the date staff enter (today when left empty). Unticking records a "no".
router.post('/users/:id/marketing-consent-in-person', async (req, res, next) => {
  const userId = String(req.params.id || '');
  if (!UUID_PATTERN.test(userId)) return res.status(400).json({ ok: false, error: 'Invalid user id' });
  const agreed = req.body?.agreed !== false && req.body?.agreed !== 'false';
  const consentedAt = inPersonConsentDate(req.body?.agreed_on);
  if (!consentedAt) {
    return res.status(400).json({ ok: false, error: 'agreed_on must be a date (YYYY-MM-DD) that is not in the future' });
  }
  let client;
  try {
    client = await db.getClient();
    await client.query('BEGIN');
    const found = await client.query('SELECT id, phone FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!found.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'User not found' });
    }
    const event = await recordUserMarketingConsent(client, {
      userId,
      phone: found.rows[0].phone || null,
      granted: agreed,
      source: agreed ? 'staff_in_person' : 'staff_withdrawn',
      wordingVersion: STAFF_IN_PERSON_CONSENT_WORDING.version,
      wordingText: STAFF_IN_PERSON_CONSENT_WORDING.text,
      recordedBy: req.staffAuth?.userId || null,
      consentedAt
    });
    const updated = await client.query(
      `SELECT id, marketing_opt_in, marketing_consent_at, marketing_consent_source, marketing_consent_wording_version
       FROM users WHERE id = $1`,
      [userId]
    );
    await client.query('COMMIT');
    return res.json({ ok: true, data: { user: updated.rows[0], consent_event_id: event?.id || null } });
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    logger.error('Failed to record in-person consent', { error: error.message });
    return next(error);
  } finally {
    if (client) client.release();
  }
});

// Writes today's WhatsApp alert digest rows now (previews while
// WHATSAPP_ALERTS_ENABLED is off). Never sends anything.
router.post('/whatsapp-alerts/run', async (_req, res, next) => {
  try {
    const summary = await runWhatsappAlertDigest(db);
    return res.json({ ok: true, data: summary });
  } catch (error) {
    return next(error);
  }
});

router._test = { inPersonConsentDate, loadHomeSeekerOverview };

module.exports = router;
