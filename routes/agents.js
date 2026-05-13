const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('../config/database');
const { asArray, cleanText, isValidEmail, isValidPhone } = require('../middleware/validation');
const { logNotification } = require('../services/notificationLogService');
const { normalizeEmail, normalizeUgPhone } = require('../utils/adminOtpOverride');
const { parsePagination, toPagination } = require('../utils/pagination');

const router = express.Router();

function verifyListingSubmitToken(token) {
  const secret = process.env.LISTING_OTP_JWT_SECRET
    || process.env.JWT_SECRET
    || (process.env.NODE_ENV === 'production' ? '' : 'dev-listing-otp-secret');
  if (!secret) return { ok: false, error: 'missing_jwt_secret' };

  try {
    const decoded = jwt.verify(token, secret);
    const channel = String(decoded?.channel || 'phone').toLowerCase() === 'email' ? 'email' : 'phone';
    const identifier = channel === 'email'
      ? normalizeEmail(decoded?.email || decoded?.identifier)
      : normalizeUgPhone(decoded?.phone || decoded?.identifier);

    if (decoded?.purpose !== 'listing_submit' || !identifier) {
      return { ok: false, error: 'invalid_purpose' };
    }

    return { ok: true, channel, identifier };
  } catch (error) {
    return { ok: false, error: 'invalid_or_expired' };
  }
}

function parseCsvList(value) {
  if (Array.isArray(value)) {
    return value.map((x) => cleanText(x)).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseBooleanLike(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = cleanText(value).toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

function cleanBrokerUpload(value, fallbackName = 'broker document') {
  if (!value || typeof value !== 'object') return null;
  const name = cleanText(value.name || fallbackName).slice(0, 160) || fallbackName;
  const type = cleanText(value.type || value.mime || 'application/octet-stream').slice(0, 120);
  const size = Number(value.size || 0) || 0;
  const dataUrl = String(value.data_url || value.dataUrl || '').trim();
  const url = cleanText(value.url || value.href || '').slice(0, 2000);
  if (size > 5 * 1024 * 1024) {
    const err = new Error(`${fallbackName} is too large. Upload must be 5MB or smaller.`);
    err.status = 400;
    throw err;
  }
  const allowedDataUrl = dataUrl.startsWith('data:image/');
  const allowedUrl = /^https?:\/\//i.test(url);
  if (!allowedDataUrl && !allowedUrl) return null;
  return {
    name,
    type,
    size,
    data_url: allowedDataUrl ? dataUrl : undefined,
    url: allowedUrl ? url : undefined,
    uploaded_at: new Date().toISOString()
  };
}

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const search = cleanText(req.query.search);
    const district = cleanText(req.query.district);
    const status = cleanText(req.query.status || 'approved');

    const filters = [];
    const values = [];

    if (search) {
      values.push(`%${search}%`);
      filters.push(`(a.full_name ILIKE $${values.length} OR a.company_name ILIKE $${values.length})`);
    }

    if (district) {
      values.push(district);
      filters.push(`$${values.length} = ANY(a.districts_covered)`);
    }

    if (status && status !== 'all') {
      values.push(status);
      filters.push(`a.status = $${values.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const totalResult = await db.query(`SELECT COUNT(*)::int AS total FROM agents a ${where}`, values);
    const total = totalResult.rows[0]?.total || 0;

    const listValues = [...values, limit, offset];
    const rows = await db.query(
      `SELECT
        a.id,
        a.full_name,
        a.company_name,
        a.phone,
        a.whatsapp,
        a.email,
        a.registration_status,
        a.featured_homepage,
        a.featured_at,
        a.bio,
        a.profile_photo_url,
        a.licence_number,
        a.identity_document_name,
        a.identity_document_url,
        a.identity_document_uploaded_at,
        a.verification_reason,
        a.privacy_consent_accepted,
        a.privacy_consent_at,
        a.data_retention_notice_accepted,
        a.data_retention_notice_at,
        a.user_id,
        a.status,
        a.rating,
        a.sales_count,
        a.districts_covered,
        a.specializations,
        COALESCE(p.active_listings, 0) AS listings_count
      FROM agents a
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS active_listings
        FROM properties p
        WHERE p.agent_id = a.id AND p.status = 'approved'
      ) p ON true
      ${where}
      ORDER BY a.created_at DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}`,
      listValues
    );

    return res.json({
      ok: true,
      data: rows.rows,
      pagination: toPagination(total, page, limit)
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const agent = await db.query(
      `SELECT
        a.*,
        COALESCE(p.active_listings, 0) AS listings_count
      FROM agents a
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS active_listings
        FROM properties p
        WHERE p.agent_id = a.id
      ) p ON true
      WHERE a.id = $1`,
      [req.params.id]
    );

    if (!agent.rows.length) {
      return res.status(404).json({ ok: false, error: 'Agent not found' });
    }

    const listings = await db.query(
      `SELECT id, title, listing_type, district, area, price, price_period, status, created_at
       FROM properties
       WHERE agent_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.params.id]
    );

    return res.json({
      ok: true,
      data: {
        ...agent.rows[0],
        listings: listings.rows
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/register', async (req, res, next) => {
  try {
    const body = req.body || {};

    const fullName = cleanText(body.full_name);
    const licenceNumber = cleanText(body.licence_number);
    const registrationStatus = 'not_registered';
    const listingLimit = 2147483647;
    const resolvedLicence = licenceNumber || `PENDING-${Date.now()}`;
    const phone = cleanText(body.phone);
    const email = cleanText(body.email);
    const listingOtpToken = cleanText(body.listing_otp_token);
    const otpChannelInput = cleanText(body.otp_channel || 'phone').toLowerCase();
    const otpChannel = otpChannelInput === 'email' ? 'email' : 'phone';
    const nin = cleanText(body.nin || body.national_id_number);
    const verificationReason = cleanText(body.verification_reason || body.reason).slice(0, 1200);
    const identityDocument = cleanBrokerUpload(body.identity_document || body.national_id_document || body.id_document, 'National ID photo');
    const privacyConsentAccepted = parseBooleanLike(body.privacy_consent_accepted || body.privacy_accepted, false);
    const dataRetentionNoticeAccepted = parseBooleanLike(body.data_retention_notice_accepted || body.data_deletion_notice_accepted, false);
    const districtsCovered = parseCsvList(body.districts_covered);
    const specializations = parseCsvList(body.specializations);

    const errors = [];

    if (!fullName) errors.push('full_name is required');
    if (!phone) errors.push('phone is required');
    if (!email) errors.push('email is required');
    if (!districtsCovered.length) errors.push('districts_covered is required');
    if (!nin) errors.push('national_id_number is required');
    if (!verificationReason) errors.push('verification_reason is required');
    if (!identityDocument) errors.push('national_id_document is required');
    if (!privacyConsentAccepted) errors.push('privacy_consent_accepted is required');
    if (!dataRetentionNoticeAccepted) errors.push('data_retention_notice_accepted is required');

    if (phone && !isValidPhone(phone)) errors.push('phone is invalid');
    if (email && !isValidEmail(email)) errors.push('email is invalid');
    if (!listingOtpToken) {
      errors.push('listing_otp_token is required. Verify OTP before broker registration');
    } else {
      const verified = verifyListingSubmitToken(listingOtpToken);
      if (!verified.ok) {
        errors.push('listing_otp_token is invalid or expired');
      } else if (verified.channel !== otpChannel) {
        errors.push('listing_otp_token channel does not match otp_channel');
      } else if (verified.channel === 'email') {
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail || verified.identifier !== normalizedEmail) {
          errors.push('listing_otp_token does not match email');
        }
      } else {
        const normalizedPhone = normalizeUgPhone(phone);
        if (!normalizedPhone || verified.identifier !== normalizedPhone) {
          errors.push('listing_otp_token does not match phone');
        }
      }
    }

    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });
    }

    const inserted = await db.query(
      `INSERT INTO agents (
        full_name,
        company_name,
        licence_number,
        registration_status,
        listing_limit,
        phone,
        whatsapp,
        email,
        districts_covered,
        specializations,
        nin,
        area_certificate_url,
        identity_document_name,
        identity_document_url,
        identity_document_type,
        identity_document_uploaded_at,
        verification_reason,
        privacy_consent_accepted,
        privacy_consent_at,
        data_retention_notice_accepted,
        data_retention_notice_at,
        profile_photo_url,
        bio,
        status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),$16,$17,NOW(),$18,NOW(),$19,$20,'pending')
      RETURNING id, status, registration_status, created_at`,
      [
        fullName,
        cleanText(body.company_name) || null,
        resolvedLicence,
        registrationStatus,
        listingLimit,
        phone,
        cleanText(body.whatsapp) || null,
        email || null,
        districtsCovered,
        specializations,
        nin || null,
        cleanText(body.area_certificate_url) || null,
        identityDocument.name,
        identityDocument.data_url || identityDocument.url || null,
        identityDocument.type || null,
        verificationReason,
        privacyConsentAccepted,
        dataRetentionNoticeAccepted,
        cleanText(body.profile_photo_url) || null,
        cleanText(body.bio) || null
      ]
    );

    await logNotification(db, {
      recipientPhone: phone,
      recipientEmail: email,
      channel: 'in_app',
      type: 'new_broker_verification_request',
      status: 'logged',
      payloadSummary: {
        agent_id: inserted.rows[0]?.id,
        full_name: fullName,
        company_name: cleanText(body.company_name) || null,
        districts_covered: districtsCovered,
        national_id_document_uploaded: Boolean(identityDocument),
        privacy_consent_accepted: privacyConsentAccepted,
        data_retention_notice_accepted: dataRetentionNoticeAccepted
      }
    });

    return res.status(201).json({ ok: true, data: inserted.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Licence number or contact already registered' });
    }
    return next(error);
  }
});

module.exports = router;
