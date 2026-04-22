const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('../config/database');
const { asArray, cleanText, isValidEmail, isValidPhone } = require('../middleware/validation');
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
        a.bio,
        a.profile_photo_url,
        a.licence_number,
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

    const errors = [];

    if (!fullName) errors.push('full_name is required');
    if (!phone) errors.push('phone is required');

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

    const districtsCovered = parseCsvList(body.districts_covered);
    const specializations = parseCsvList(body.specializations);

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
        profile_photo_url,
        bio,
        status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending')
      RETURNING id, status, created_at`,
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
        cleanText(body.nin) || null,
        cleanText(body.area_certificate_url) || null,
        cleanText(body.profile_photo_url) || null,
        cleanText(body.bio) || null
      ]
    );

    return res.status(201).json({ ok: true, data: inserted.rows[0] });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Licence number or contact already registered' });
    }
    return next(error);
  }
});

module.exports = router;
