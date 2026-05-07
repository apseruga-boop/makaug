const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('../config/database');
const logger = require('../config/logger');
const { cleanText } = require('../middleware/validation');
const { logNotification } = require('../services/notificationLogService');

const router = express.Router();

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function normalizeFieldAgentCode(value = '') {
  const raw = cleanText(value).toUpperCase().replace(/\s+/g, '');
  if (!raw) return '';
  if (/^FA-\d{4,6}$/.test(raw)) return raw;
  if (/^FA\d{4,6}$/.test(raw)) return `FA-${raw.slice(2)}`;
  if (/^\d{1,6}$/.test(raw)) return `FA-${raw.padStart(4, '0')}`;
  return '';
}

function getProfile(user = {}) {
  return user.profile_data && typeof user.profile_data === 'object' && !Array.isArray(user.profile_data)
    ? user.profile_data
    : {};
}

function fieldAgentCodeForUser(user = {}) {
  const profile = getProfile(user);
  return normalizeFieldAgentCode(profile.field_agent_code || profile.employee_number || user.field_agent_code || '');
}

async function loadUserFromToken(token) {
  if (!token || !process.env.JWT_SECRET) return null;
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (!isUuid(decoded?.sub)) return null;
  const result = await db.query(
    `SELECT id, first_name, last_name, phone, email, role, status, preferred_language,
            preferred_contact_channel, profile_data, created_at, updated_at
     FROM users
     WHERE id = $1 AND status = 'active'
     LIMIT 1`,
    [decoded.sub]
  );
  return result.rows[0] || null;
}

async function requireFieldAgent(req, res, next) {
  const authHeader = req.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  try {
    const user = await loadUserFromToken(token);
    if (!user) return res.status(401).json({ ok: false, error: 'Sign in required' });
    if (user.role !== 'field_agent') return res.status(403).json({ ok: false, error: 'Field Agent access required' });
    req.userAuth = user;
    return next();
  } catch (error) {
    return res.status(401).json({ ok: false, error: 'Invalid session' });
  }
}

function propertyUrl(id) {
  const base = String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://makaug.com').replace(/\/$/, '');
  return `${base}/property/${id}`;
}

function listingStatus(row = {}) {
  const explicit = String(row.status || row.moderation_stage || row.review_status || '').toLowerCase();
  if (['approved', 'live', 'published'].includes(explicit)) return 'approved';
  if (['rejected', 'declined', 'fraud'].includes(explicit)) return 'rejected';
  if (['draft', 'archived'].includes(explicit)) return explicit;
  return 'pending';
}

function fieldAgentMatchSql(alias = 'p', codeParam = '$1') {
  return `(
    UPPER(COALESCE(${alias}.extra_fields->>'field_agent_id', '')) = ${codeParam}
    OR UPPER(COALESCE(${alias}.extra_fields->>'field_agent_code', '')) = ${codeParam}
    OR UPPER(COALESCE(${alias}.extra_fields->>'field_agent_reference', '')) = ${codeParam}
    OR UPPER(COALESCE(${alias}.extra_fields->>'agent_field_id', '')) = ${codeParam}
  )`;
}

function publicListing(row = {}, rejectionMap = new Map()) {
  const status = listingStatus(row);
  const latestRejection = rejectionMap.get(String(row.id)) || null;
  const reason = row.moderation_reason || row.extra_fields?.rejection_reason || latestRejection?.reason || latestRejection?.notes || null;
  return {
    id: row.id,
    title: row.title,
    listing_type: row.listing_type,
    property_type: row.property_type,
    status,
    moderation_stage: row.moderation_stage || status,
    moderation_reason: reason,
    area: row.area,
    district: row.district,
    address: row.address,
    price: row.price,
    price_period: row.price_period,
    period: row.price_period,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    primary_image_url: row.primary_image_url || null,
    image: row.primary_image_url || null,
    url: propertyUrl(row.id),
    created_at: row.created_at,
    updated_at: row.updated_at,
    field_agent_response_status: row.extra_fields?.field_agent_rejection_response_status || null
  };
}

async function latestRejectionEvents(ids = []) {
  if (!ids.length) return new Map();
  const result = await db.query(
    `SELECT DISTINCT ON (property_id)
            property_id, reason, notes, created_at
     FROM property_moderation_events
     WHERE property_id = ANY($1::uuid[])
       AND (action ILIKE '%reject%' OR status_to = 'rejected')
     ORDER BY property_id, created_at DESC`,
    [ids]
  );
  return new Map(result.rows.map((row) => [String(row.property_id), row]));
}

async function calculateRank(fieldAgentCode = '') {
  try {
    const result = await db.query(
      `SELECT code, approved_count,
              RANK() OVER (ORDER BY approved_count DESC, code ASC) AS rank
       FROM (
         SELECT UPPER(COALESCE(u.profile_data->>'field_agent_code', u.profile_data->>'employee_number', '')) AS code,
                COUNT(p.id) FILTER (WHERE p.status = 'approved' OR p.moderation_stage = 'approved')::int AS approved_count
         FROM users u
         LEFT JOIN properties p
           ON UPPER(COALESCE(p.extra_fields->>'field_agent_id', p.extra_fields->>'field_agent_code', p.extra_fields->>'field_agent_reference', ''))
            = UPPER(COALESCE(u.profile_data->>'field_agent_code', u.profile_data->>'employee_number', ''))
         WHERE u.role = 'field_agent'
         GROUP BY code
       ) ranked
       WHERE code <> ''`,
      []
    );
    const row = result.rows.find((item) => item.code === fieldAgentCode);
    return row ? Number(row.rank) : null;
  } catch (error) {
    logger.warn('Field agent rank calculation failed', { error: error.message });
    return null;
  }
}

router.get('/dashboard', requireFieldAgent, async (req, res, next) => {
  try {
    const user = req.userAuth;
    const profile = getProfile(user);
    const code = fieldAgentCodeForUser(user);
    if (!code) {
      return res.status(409).json({ ok: false, error: 'Field Agent ID is missing. Ask admin to re-save this account.' });
    }

    const listingsResult = await db.query(
      `SELECT p.*,
              (
                SELECT pi.url
                FROM property_images pi
                WHERE pi.property_id = p.id
                ORDER BY pi.is_primary DESC, pi.sort_order ASC, pi.created_at ASC
                LIMIT 1
              ) AS primary_image_url
       FROM properties p
       WHERE ${fieldAgentMatchSql('p', '$1')}
       ORDER BY p.created_at DESC
       LIMIT 250`,
      [code]
    );
    const ids = listingsResult.rows.map((row) => row.id);
    const rejectionMap = await latestRejectionEvents(ids);
    const listings = listingsResult.rows.map((row) => publicListing(row, rejectionMap));
    const approved = listings.filter((item) => item.status === 'approved');
    const rejected = listings.filter((item) => item.status === 'rejected');
    const pending = listings.filter((item) => item.status === 'pending' || item.status === 'draft');
    const payoutRate = parseInt(profile.payout_rate_ugx || user.payout_rate_ugx || '15000', 10) || 15000;
    const rank = await calculateRank(code);

    await logNotification(db, {
      userId: user.id,
      recipientPhone: user.phone,
      recipientEmail: user.email,
      channel: 'in_app',
      type: 'field_agent_dashboard_viewed',
      status: 'logged',
      payloadSummary: {
        field_agent_code: code,
        listings_count: listings.length,
        approved_count: approved.length,
        rejected_count: rejected.length,
        pending_count: pending.length
      }
    });

    return res.json({
      ok: true,
      data: {
        agent: {
          id: user.id,
          first_name: user.first_name,
          last_name: user.last_name,
          field_agent_code: code,
          employee_number: normalizeFieldAgentCode(profile.employee_number) || code,
          territory: profile.field_agent_territory || profile.territory || 'Uganda',
          status: user.status,
          payout_rate_ugx: payoutRate,
          payout_frequency: profile.payout_frequency || 'weekly',
          payout_day: profile.payout_day || 'Friday',
          notice: profile.field_agent_notes || ''
        },
        stats: {
          submitted: listings.length,
          approved: approved.length,
          rejected: rejected.length,
          pending: pending.length,
          conversion_rate: listings.length ? Math.round((approved.length / listings.length) * 100) : 0,
          payable_ugx: approved.length * payoutRate,
          rank
        },
        listings,
        rejectedListings: rejected,
        resources: [
          {
            title: 'Field Agent basics',
            body: 'Find real property opportunities, help owners list safely, and submit complete listings with photos, contact details, and location.',
            href: '/assets/docs/field-agent/makaug-field-agent-welcome-pack.pptx'
          },
          {
            title: 'Targets and payout',
            body: 'Target 10 quality listings per week. Approved live listings count toward weekly Friday payout after admin review.',
            href: '/assets/docs/field-agent/makaug-field-agent-job-description.docx'
          },
          {
            title: 'Online listing checklist',
            body: 'Use List Property, capture ownership/contact details, upload clear photos, confirm location, and submit for moderation.'
          },
          {
            title: 'WhatsApp listing checklist',
            body: 'Use List via WhatsApp when an owner needs guided help. Include property type, location, price, photos, and your Field Agent ID.'
          },
          {
            title: 'Rejection fixes',
            body: 'Common rejection reasons include unclear photos, duplicate listings, missing ownership/contact proof, weak location, and fraud risk.',
            href: '/assets/docs/field-agent/makaug-field-agent-training-deck.pptx'
          },
          {
            title: 'Safety and contract rules',
            body: 'Do not invent listings, request unsafe payments, or submit unverifiable properties. Fraud can suspend access and payout.',
            href: '/assets/docs/field-agent/makaug-field-agent-contract.docx'
          }
        ]
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/listings/:id/rejection-response', requireFieldAgent, async (req, res, next) => {
  try {
    const code = fieldAgentCodeForUser(req.userAuth);
    const listingId = req.params.id;
    const notes = cleanText(req.body.notes || req.body.message || req.body.response).slice(0, 1200);
    if (!isUuid(listingId)) return res.status(400).json({ ok: false, error: 'Invalid listing ID' });
    if (!code) return res.status(409).json({ ok: false, error: 'Field Agent ID is missing. Ask admin to re-save this account.' });
    if (notes.length < 8) return res.status(400).json({ ok: false, error: 'Add a short response before submitting' });

    const owned = await db.query(
      `SELECT id, title, status, moderation_stage, extra_fields
       FROM properties p
       WHERE p.id = $2
         AND ${fieldAgentMatchSql('p', '$1')}
       LIMIT 1`,
      [code, listingId]
    );
    if (!owned.rows.length) {
      return res.status(404).json({ ok: false, error: 'Listing not found for this Field Agent ID' });
    }

    await db.query(
      `INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, reason, notes, delivery)
       VALUES ($1,$2,'field_agent_rejection_response',$3,$4,$5,$6,$7::jsonb)`,
      [
        listingId,
        req.userAuth.id,
        owned.rows[0].moderation_stage || owned.rows[0].status || null,
        owned.rows[0].moderation_stage || owned.rows[0].status || null,
        'Field Agent response submitted',
        notes,
        JSON.stringify({ field_agent_code: code, source: 'field_agent_dashboard' })
      ]
    );

    await db.query(
      `UPDATE properties
       SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [
        listingId,
        JSON.stringify({
          field_agent_rejection_response: notes,
          field_agent_rejection_response_at: new Date().toISOString(),
          field_agent_rejection_response_status: 'submitted'
        })
      ]
    );

    await logNotification(db, {
      userId: req.userAuth.id,
      recipientPhone: req.userAuth.phone,
      recipientEmail: req.userAuth.email,
      channel: 'in_app',
      type: 'field_agent_rejection_response_submitted',
      status: 'logged',
      relatedListingId: listingId,
      payloadSummary: {
        field_agent_code: code,
        listing_id: listingId,
        title: owned.rows[0].title
      }
    });

    return res.json({ ok: true, data: { listing_id: listingId, status: 'submitted' } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
