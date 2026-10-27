'use strict';

// Saves and "alert me" searches for everyone, with or without an account
// (26 Oct 2026, area A). A visitor without an account is identified only by
// the first-party device cookie (services/deviceIdentity.js). A signed-in
// visitor's saves belong to the account; POST /merge moves a device's saves
// and alerts into the account right after sign-up or login.
//
// The old /api/saved-properties (account only) stays for older clients.

const express = require('express');

const db = require('../config/database');
const logger = require('../config/logger');
const { isAuthenticationError, loadActiveUserFromToken } = require('../middleware/auth');
const { ensureDeviceId, readDeviceId } = require('../services/deviceIdentity');
const { publicVisibleInventoryWhere } = require('../services/publicInventoryMetricsService');
const { enqueueConsentMessage } = require('../services/whatsappAlertDigestService');
const { recordSearchAlertConsent, SEARCH_ALERT_CONSENT_WORDING } = require('../services/marketingConsentService');

const router = express.Router();

const MAX_SAVES_PER_OWNER = 500;
const MAX_ALERT_SEARCHES_PER_OWNER = 20;

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function text(value, max = 200) {
  const out = String(value ?? '').trim();
  return out ? out.slice(0, max) : '';
}

function money(value) {
  const n = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function int(value) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeUgMobile(value) {
  const raw = String(value || '').replace(/[\s()-]/g, '');
  if (/^0\d{9}$/.test(raw)) return `+256${raw.slice(1)}`;
  if (/^256\d{9}$/.test(raw)) return `+${raw}`;
  if (/^\+256\d{9}$/.test(raw)) return raw;
  return '';
}

function normalizeCategory(value) {
  const v = text(value, 40).toLowerCase();
  if (['rent', 'rental', 'to-rent'].includes(v)) return 'rent';
  if (['sale', 'buy', 'for-sale'].includes(v)) return 'sale';
  if (v.startsWith('student')) return 'student';
  if (v.includes('land')) return 'land';
  if (v.includes('commercial')) return 'commercial';
  return v ? v.slice(0, 40) : 'all';
}

// Optional sign-in: a bad or expired token is treated as signed out (the
// visitor still has their device saves); a database failure is a 503.
async function resolveOwner(req, res, { createDevice = false } = {}) {
  let user = null;
  try {
    user = await loadActiveUserFromToken(req);
  } catch (error) {
    if (!isAuthenticationError(error)) throw error;
  }
  if (user) {
    return { kind: 'user', userId: user.id, user, deviceId: readDeviceId(req) };
  }
  const deviceId = createDevice ? ensureDeviceId(req, res) : readDeviceId(req);
  return { kind: 'device', userId: null, user: null, deviceId };
}

function ownerWhere(owner, alias = 'sp') {
  if (owner.kind === 'user') return { sql: `${alias}.user_id = $1`, params: [owner.userId] };
  return { sql: `${alias}.user_id IS NULL AND ${alias}.device_id = $1`, params: [owner.deviceId] };
}

async function listSaves(owner) {
  if (owner.kind === 'device' && !owner.deviceId) return [];
  const where = ownerWhere(owner);
  const result = await db.query(
    `SELECT sp.property_id, sp.created_at,
            p.title, p.listing_type, p.district, p.area, p.price, p.price_period, p.price_currency AS currency,
            p.bedrooms, p.inquiry_reference AS public_listing_id,
            (${publicVisibleInventoryWhere('p')}) AS available,
            img.url AS primary_image_url
     FROM saved_properties sp
     JOIN properties p ON p.id = sp.property_id
     LEFT JOIN LATERAL (
       SELECT url FROM property_images WHERE property_id = p.id
       ORDER BY is_primary DESC, sort_order ASC, created_at ASC LIMIT 1
     ) img ON true
     WHERE ${where.sql}
     ORDER BY sp.created_at DESC
     LIMIT ${MAX_SAVES_PER_OWNER}`,
    where.params
  );
  return result.rows;
}

function savesPayload(owner, rows) {
  const available = rows.filter((row) => row.available === true);
  return {
    owner: owner.kind,
    ids: available.map((row) => row.property_id),
    items: available.map((row) => ({
      property_id: row.property_id,
      saved_at: row.created_at,
      title: row.title,
      listing_type: row.listing_type,
      district: row.district,
      area: row.area,
      price: row.price,
      price_period: row.price_period,
      currency: row.currency,
      bedrooms: row.bedrooms,
      listing_code: row.public_listing_id,
      image_url: row.primary_image_url || null
    })),
    unavailable_count: rows.length - available.length,
    total: available.length
  };
}

router.get('/', async (req, res, next) => {
  try {
    const owner = await resolveOwner(req, res);
    const rows = await listSaves(owner);
    return res.json({ ok: true, data: savesPayload(owner, rows) });
  } catch (error) {
    logger.error('Failed to load saves', { error: error.message });
    return next(error);
  }
});

router.post('/merge', async (req, res, next) => {
  let client;
  try {
    const owner = await resolveOwner(req, res);
    if (owner.kind !== 'user') return res.status(401).json({ ok: false, error: 'Sign in required' });
    const deviceId = owner.deviceId;
    let merged = { saves: 0, searches: 0, consents: 0 };
    if (deviceId) {
      client = await db.getClient();
      await client.query('BEGIN');
      const saves = await client.query(
        `UPDATE saved_properties d
         SET user_id = $1, updated_at = NOW()
         WHERE d.device_id = $2 AND d.user_id IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM saved_properties u WHERE u.user_id = $1 AND u.property_id = d.property_id
           )`,
        [owner.userId, deviceId]
      );
      // The account already had these listings; the device copies are not needed.
      await client.query('DELETE FROM saved_properties WHERE device_id = $1 AND user_id IS NULL', [deviceId]);
      const searches = await client.query(
        `UPDATE saved_searches SET user_id = $1, updated_at = NOW()
         WHERE guest_session_id = $2 AND user_id IS NULL`,
        [owner.userId, deviceId]
      );
      const consents = await client.query(
        'UPDATE marketing_consent_events SET user_id = $1 WHERE device_id = $2 AND user_id IS NULL',
        [owner.userId, deviceId]
      );
      await client.query('COMMIT');
      merged = { saves: saves.rowCount, searches: searches.rowCount, consents: consents.rowCount };
    }
    const rows = await listSaves(owner);
    return res.json({ ok: true, data: { ...savesPayload(owner, rows), merged } });
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    logger.error('Failed to merge device saves', { error: error.message });
    return next(error);
  } finally {
    if (client) client.release();
  }
});

router.get('/searches', async (req, res, next) => {
  try {
    const owner = await resolveOwner(req, res);
    if (owner.kind === 'device' && !owner.deviceId) return res.json({ ok: true, data: { items: [], total: 0 } });
    const params = owner.kind === 'user' ? [owner.userId] : [owner.deviceId];
    const where = owner.kind === 'user' ? 'user_id = $1' : 'user_id IS NULL AND guest_session_id = $1';
    const result = await db.query(
      `SELECT id, label, category, location, min_price, max_price, bedrooms, property_type,
              alert_channels, alert_scope, alert_frequency, created_at
       FROM saved_searches
       WHERE ${where} AND status = 'active'
       ORDER BY created_at DESC
       LIMIT ${MAX_ALERT_SEARCHES_PER_OWNER}`,
      params
    );
    return res.json({ ok: true, data: { items: result.rows, total: result.rows.length } });
  } catch (error) {
    return next(error);
  }
});

// "Save this search / alert me". Saving the search never needs consent. A
// WhatsApp number plus the ticked box records consent for these alerts only.
router.post('/searches', async (req, res, next) => {
  let client;
  try {
    const owner = await resolveOwner(req, res, { createDevice: true });
    const body = req.body || {};
    const wantsWhatsapp = body.whatsapp_alerts === true || body.whatsapp_alerts === 'true';
    const phone = normalizeUgMobile(body.phone || (wantsWhatsapp && owner.user ? owner.user.phone : ''));
    if (wantsWhatsapp && !phone) {
      return res.status(400).json({ ok: false, error: 'Enter a Ugandan WhatsApp number like 07XX XXX XXX.' });
    }
    const ownerParams = owner.kind === 'user' ? [owner.userId] : [owner.deviceId];
    const ownerWhereSql = owner.kind === 'user' ? 'user_id = $1' : 'user_id IS NULL AND guest_session_id = $1';
    const count = await db.query(
      `SELECT COUNT(*)::int AS n FROM saved_searches WHERE ${ownerWhereSql} AND status = 'active'`,
      ownerParams
    );
    if ((count.rows[0]?.n || 0) >= MAX_ALERT_SEARCHES_PER_OWNER) {
      return res.status(429).json({ ok: false, error: 'You have the most saved searches allowed. Remove one first.' });
    }

    const category = normalizeCategory(body.category);
    const location = text(body.location || body.query, 120);
    const filters = {
      category,
      location: location || null,
      query: text(body.query, 120) || null,
      minPrice: money(body.min_price),
      maxPrice: money(body.max_price),
      bedrooms: int(body.bedrooms),
      propertyType: text(body.property_type, 60) || null,
      currency: 'UGX'
    };
    const label = text(body.label, 120)
      || [category === 'all' ? 'Properties' : category, location ? `in ${location}` : ''].filter(Boolean).join(' ');
    // WhatsApp alerts are recorded by alert_scope, not alert_channels, so the
    // older per-listing matcher (alertSchedulerService) never queues a
    // WhatsApp row. The daily digest job reads alert_scope instead.
    const channels = ['in_app'];

    client = await db.getClient();
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO saved_searches (
         user_id, guest_session_id, phone, category, filters, label, location,
         min_price, max_price, currency, bedrooms, property_type,
         alert_frequency, alert_channels, status, created_from, alert_scope
       )
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,'UGX',$10,$11,'daily',$12::jsonb,'active','results_alert_button',$13)
       RETURNING id, label, category, location, alert_channels, alert_scope, created_at`,
      [
        owner.userId,
        owner.kind === 'device' ? owner.deviceId : (owner.deviceId || null),
        phone || null,
        category,
        JSON.stringify(filters),
        label,
        location || null,
        filters.minPrice,
        filters.maxPrice,
        filters.bedrooms,
        filters.propertyType,
        JSON.stringify(channels),
        wantsWhatsapp ? 'search_alerts_whatsapp' : 'none'
      ]
    );
    const search = inserted.rows[0];
    let consent = null;
    if (wantsWhatsapp) {
      consent = await recordSearchAlertConsent(client, {
        userId: owner.userId,
        deviceId: owner.kind === 'device' ? owner.deviceId : (owner.deviceId || null),
        phone,
        savedSearchId: search.id
      });
      await client.query('UPDATE saved_searches SET consent_record_id = $1 WHERE id = $2', [consent.id, search.id]);
      // A confirmation row, written as 'preview' (not sent) unless
      // WHATSAPP_ALERTS_ENABLED=true. Nothing on the website sends it.
      await enqueueConsentMessage(client, {
        kind: 'consent_confirmation',
        userId: owner.userId,
        deviceId: owner.kind === 'device' ? owner.deviceId : null,
        phone,
        label: search.label,
        savedSearchId: search.id,
        consentEventId: consent.id
      });
    }
    await client.query('COMMIT');
    return res.status(201).json({
      ok: true,
      data: {
        search,
        owner: owner.kind,
        whatsapp_alerts: Boolean(consent),
        consent: consent ? {
          id: consent.id,
          purpose: consent.purpose,
          wording_version: consent.wording_version,
          wording: SEARCH_ALERT_CONSENT_WORDING.text,
          consented_at: consent.consented_at
        } : null
      }
    });
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    logger.error('Failed to save search alert', { error: error.message });
    return next(error);
  } finally {
    if (client) client.release();
  }
});

router.delete('/searches/:id', async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) return res.status(400).json({ ok: false, error: 'Invalid saved search id' });
    const owner = await resolveOwner(req, res);
    if (owner.kind === 'device' && !owner.deviceId) return res.json({ ok: true, data: { removed: false } });
    const where = owner.kind === 'user' ? 'user_id = $1' : 'user_id IS NULL AND guest_session_id = $1';
    const result = await db.query(
      `UPDATE saved_searches SET status = 'deleted', updated_at = NOW()
       WHERE ${where} AND id = $2 RETURNING id`,
      [owner.kind === 'user' ? owner.userId : owner.deviceId, req.params.id]
    );
    return res.json({ ok: true, data: { removed: result.rowCount > 0 } });
  } catch (error) {
    return next(error);
  }
});

router.post('/:propertyId', async (req, res, next) => {
  const propertyId = req.params.propertyId;
  if (!isUuid(propertyId)) return res.status(400).json({ ok: false, error: 'Invalid property id' });
  try {
    const property = await db.query(
      `SELECT p.id FROM properties p WHERE p.id = $1 AND ${publicVisibleInventoryWhere('p')} LIMIT 1`,
      [propertyId]
    );
    if (!property.rows.length) return res.status(404).json({ ok: false, error: 'This property is not available to save.' });

    const owner = await resolveOwner(req, res, { createDevice: true });
    if (owner.kind === 'user') {
      await db.query(
        `INSERT INTO saved_properties (user_id, property_id, device_id, source)
         VALUES ($1, $2, $3, 'web')
         ON CONFLICT (user_id, property_id) DO UPDATE SET updated_at = NOW()`,
        [owner.userId, propertyId, owner.deviceId || null]
      );
    } else {
      const count = await db.query(
        'SELECT COUNT(*)::int AS n FROM saved_properties WHERE device_id = $1 AND user_id IS NULL',
        [owner.deviceId]
      );
      if ((count.rows[0]?.n || 0) >= MAX_SAVES_PER_OWNER) {
        return res.status(429).json({ ok: false, error: 'Saved list is full on this device. Sign in to save more.' });
      }
      await db.query(
        `INSERT INTO saved_properties (device_id, property_id, source)
         VALUES ($1, $2, 'device')
         ON CONFLICT (device_id, property_id) WHERE user_id IS NULL AND device_id IS NOT NULL
         DO UPDATE SET updated_at = NOW()`,
        [owner.deviceId, propertyId]
      );
    }
    return res.status(201).json({ ok: true, data: { property_id: propertyId, saved: true, owner: owner.kind } });
  } catch (error) {
    logger.error('Failed to save property', { error: error.message, propertyId });
    return next(error);
  }
});

router.delete('/:propertyId', async (req, res, next) => {
  const propertyId = req.params.propertyId;
  if (!isUuid(propertyId)) return res.status(400).json({ ok: false, error: 'Invalid property id' });
  try {
    const owner = await resolveOwner(req, res);
    if (owner.kind === 'device' && !owner.deviceId) {
      return res.json({ ok: true, data: { property_id: propertyId, saved: false, removed: false } });
    }
    const where = ownerWhere(owner, 'saved_properties');
    const result = await db.query(
      `DELETE FROM saved_properties WHERE ${where.sql} AND property_id = $2`,
      [...where.params, propertyId]
    );
    return res.json({ ok: true, data: { property_id: propertyId, saved: false, removed: result.rowCount > 0, owner: owner.kind } });
  } catch (error) {
    logger.error('Failed to remove saved property', { error: error.message, propertyId });
    return next(error);
  }
});

module.exports = router;
module.exports._test = { normalizeUgMobile, normalizeCategory, savesPayload };
