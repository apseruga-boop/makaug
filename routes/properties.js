const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('../config/database');
const logger = require('../config/logger');
const smsService = require('../models/smsService');
const {
  sendPropertySubmissionNotification,
  sendSupportEmail,
  sendListingModerationNotification
} = require('../services/emailService');
const { requireAdminApiKey } = require('../middleware/auth');
const {
  asArray,
  cleanText,
  toNullableInt,
  toNullableFloat,
  isValidEmail,
  isValidPhone
} = require('../middleware/validation');
const { parsePagination, toPagination } = require('../utils/pagination');
const { DISTRICTS, UNIVERSITIES, LISTING_TYPES, PROPERTY_STATUSES } = require('../utils/constants');

const router = express.Router();

function addFilter(filters, values, clause, ...vals) {
  let prepared = clause;
  vals.forEach((v) => {
    values.push(v);
    prepared = prepared.replace('?', `$${values.length}`);
  });
  filters.push(prepared);
}

function normalizeListingType(type) {
  const t = cleanText(type).toLowerCase();
  if (t === 'students') return 'student';
  return t;
}

function normalizePhone(phone) {
  return cleanText(phone).replace(/\s+/g, '');
}

function normalizeEmail(email) {
  return cleanText(email).toLowerCase();
}

function normalizeUgPhone(phone) {
  const value = normalizePhone(phone);
  if (/^0\d{9}$/.test(value)) return `+256${value.slice(1)}`;
  if (/^256\d{9}$/.test(value)) return `+${value}`;
  return value;
}

function isValidUgPhone(phone) {
  return /^\+256\d{9}$/.test(phone);
}

async function issueListingSubmitOtp({ channel = 'phone', phone = '', email = '' }) {
  const resolvedChannel = String(channel || 'phone').toLowerCase() === 'email' ? 'email' : 'phone';
  const identifier = resolvedChannel === 'email' ? normalizeEmail(email) : normalizeUgPhone(phone);
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresMinutes = Math.max(parseInt(process.env.OTP_EXPIRES_MINUTES || '10', 10), 1);
  if (!identifier) {
    throw new Error('Missing OTP identifier');
  }

  await db.query(
    "UPDATE otps SET used = TRUE WHERE phone = $1 AND purpose = 'listing_submit' AND used = FALSE",
    [identifier]
  );

  await db.query(
    `INSERT INTO otps (phone, code, purpose, expires_at)
     VALUES ($1, $2, 'listing_submit', NOW() + ($3::text || ' minutes')::interval)`,
    [identifier, otp, String(expiresMinutes)]
  );

  if (resolvedChannel === 'email') {
    let delivery = null;
    try {
      delivery = await sendSupportEmail({
        to: identifier,
        subject: 'MakaUg listing OTP code',
        text: `Your MakaUg listing OTP is ${otp}. Valid for ${expiresMinutes} minutes. Do not share this code.`
      });
    } catch (error) {
      logger.error('Listing OTP email failed:', error.message);
      const sendError = new Error('Failed to send OTP email');
      sendError.status = 400;
      throw sendError;
    }
    if (process.env.NODE_ENV === 'production' && (!delivery?.sent || delivery?.mocked)) {
      const configError = new Error('Email OTP delivery provider is not configured');
      configError.status = 400;
      throw configError;
    }
  } else {
    let delivery = null;
    try {
      delivery = await smsService.sendSMS(
        identifier,
        `MakaUg listing OTP: ${otp}. Valid for ${expiresMinutes} minutes. Do not share this code.`
      );
    } catch (error) {
      logger.error('Listing OTP SMS failed:', error.message);
      const sendError = new Error('Failed to send OTP SMS');
      sendError.status = 400;
      throw sendError;
    }
    if (process.env.NODE_ENV === 'production' && (delivery?.mocked || !delivery?.sid)) {
      const configError = new Error('Phone OTP delivery provider is not configured');
      configError.status = 400;
      throw configError;
    }
  }

  return { otp, expiresMinutes, channel: resolvedChannel, identifier };
}

function createListingSubmitToken({ channel = 'phone', phone = '', email = '' }) {
  const resolvedChannel = String(channel || 'phone').toLowerCase() === 'email' ? 'email' : 'phone';
  const normalizedPhone = normalizeUgPhone(phone);
  const normalizedEmail = normalizeEmail(email);
  const identifier = resolvedChannel === 'email' ? normalizedEmail : normalizedPhone;
  const secret = process.env.LISTING_OTP_JWT_SECRET
    || process.env.JWT_SECRET
    || (process.env.NODE_ENV === 'production' ? '' : 'dev-listing-otp-secret');
  if (!secret) {
    throw new Error('JWT secret missing for listing OTP token generation');
  }

  return jwt.sign(
    {
      purpose: 'listing_submit',
      channel: resolvedChannel,
      identifier,
      phone: normalizedPhone || null,
      email: normalizedEmail || null
    },
    secret,
    { expiresIn: process.env.LISTING_OTP_EXPIRES_IN || '30m' }
  );
}

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
    return {
      ok: true,
      channel,
      identifier,
      phone: normalizeUgPhone(decoded?.phone),
      email: normalizeEmail(decoded?.email)
    };
  } catch (error) {
    return { ok: false, error: 'invalid_or_expired' };
  }
}

function parseBooleanLike(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = cleanText(value).toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

router.get('/suggestions', async (req, res, next) => {
  try {
    const query = cleanText(req.query.query).toLowerCase();
    const type = normalizeListingType(req.query.type || req.query.listing_type);

    if (query.length < 1) {
      return res.json({ ok: true, data: [] });
    }

    const listingTypeFilter = LISTING_TYPES.includes(type) ? type : null;

    const values = [`%${query}%`];
    let whereType = '';
    if (listingTypeFilter) {
      values.push(listingTypeFilter === 'student' ? 'student' : listingTypeFilter);
      whereType = ` AND listing_type = $2`;
    }

    const areas = await db.query(
      `SELECT DISTINCT area
       FROM properties
       WHERE status = 'approved' AND area ILIKE $1${whereType}
       ORDER BY area ASC
       LIMIT 20`,
      values
    );

    const districts = DISTRICTS.filter((d) => d.toLowerCase().includes(query)).slice(0, 20);

    let universities = [];
    if (listingTypeFilter === 'student' || cleanText(req.query.for) === 'students') {
      universities = UNIVERSITIES.filter((u) => u.toLowerCase().includes(query)).slice(0, 20);
    }

    const items = [];

    areas.rows.forEach((r) => {
      if (r.area) items.push({ label: r.area, category: 'area' });
    });

    districts.forEach((d) => items.push({ label: d, category: 'district' }));
    universities.forEach((u) => items.push({ label: u, category: 'university' }));

    const dedup = [];
    const seen = new Set();
    for (const item of items) {
      const key = item.label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(item);
      if (dedup.length >= 25) break;
    }

    return res.json({ ok: true, data: dedup });
  } catch (error) {
    return next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const filters = [];
    const values = [];

    const listingType = normalizeListingType(req.query.listing_type);
    const studentPortal = parseBooleanLike(req.query.student_portal, false);
    const district = cleanText(req.query.district);
    const area = cleanText(req.query.area || req.query.search);
    const status = cleanText(req.query.status || 'approved').toLowerCase();
    const minPrice = toNullableInt(req.query.min_price);
    const maxPrice = toNullableInt(req.query.max_price);
    const minBeds = toNullableInt(req.query.min_beds);
    const maxBeds = toNullableInt(req.query.max_beds);
    const propertyType = cleanText(req.query.property_type);

    if (studentPortal) {
      addFilter(filters, values, "(p.listing_type = ? OR p.students_welcome = ?)", 'student', true);
    } else if (listingType && LISTING_TYPES.includes(listingType)) {
      addFilter(filters, values, 'p.listing_type = ?', listingType);
    }

    if (district) {
      addFilter(filters, values, 'p.district = ?', district);
    }

    if (area) {
      addFilter(
        filters,
        values,
        '(p.area ILIKE ? OR p.title ILIKE ? OR p.district ILIKE ? OR COALESCE(p.address, \'\') ILIKE ? OR COALESCE(p.description, \'\') ILIKE ? OR COALESCE(p.extra_fields->>\'city\', \'\') ILIKE ? OR COALESCE(p.extra_fields->>\'neighborhood\', \'\') ILIKE ? OR COALESCE(p.extra_fields->>\'region\', \'\') ILIKE ? OR COALESCE(p.extra_fields->>\'resolved_location_label\', \'\') ILIKE ?)',
        `%${area}%`,
        `%${area}%`,
        `%${area}%`,
        `%${area}%`,
        `%${area}%`,
        `%${area}%`,
        `%${area}%`,
        `%${area}%`,
        `%${area}%`
      );
    }

    if (status && status !== 'all') {
      addFilter(filters, values, 'p.status = ?', status);
    }

    if (minPrice != null) addFilter(filters, values, 'p.price >= ?', minPrice);
    if (maxPrice != null) addFilter(filters, values, 'p.price <= ?', maxPrice);
    if (minBeds != null) addFilter(filters, values, 'p.bedrooms >= ?', minBeds);
    if (maxBeds != null) addFilter(filters, values, 'p.bedrooms <= ?', maxBeds);
    if (propertyType) addFilter(filters, values, 'p.property_type = ?', propertyType);

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM properties p ${where}`, values);
    const total = countResult.rows[0]?.total || 0;

    const sortMap = {
      newest: 'p.created_at DESC',
      price_asc: 'p.price ASC NULLS LAST',
      price_desc: 'p.price DESC NULLS LAST'
    };

    const sortBy = cleanText(req.query.sort || 'newest').toLowerCase();
    const orderBy = sortMap[sortBy] || sortMap.newest;

    const listValues = [...values, limit, offset];

    const listResult = await db.query(
      `SELECT
        p.id,
        p.listing_type,
        p.title,
        p.description,
        p.district,
        p.area,
        p.price,
        p.price_period,
        p.bedrooms,
        p.bathrooms,
        p.property_type,
        p.title_type,
        p.status,
        p.created_at,
        p.latitude,
        p.longitude,
        p.students_welcome,
        p.new_until,
        p.inquiry_reference,
        p.amenities,
        img.url AS primary_image_url,
        CASE
          WHEN p.agent_id IS NOT NULL OR p.lister_type = 'agent' THEN 'agent'
          ELSE 'private'
        END AS listed_by,
        CASE
          WHEN p.agent_id IS NOT NULL THEN COALESCE(a.registration_status, 'registered')
          WHEN p.lister_type = 'agent' THEN 'not_registered'
          ELSE 'not_registered'
        END AS registration_status
      FROM properties p
      LEFT JOIN agents a ON a.id = p.agent_id
      LEFT JOIN LATERAL (
        SELECT i.url
        FROM property_images i
        WHERE i.property_id = p.id
        ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC
        LIMIT 1
      ) img ON true
      ${where}
      ORDER BY ${orderBy}
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}`,
      listValues
    );

    return res.json({
      ok: true,
      data: listResult.rows,
      pagination: toPagination(total, page, limit)
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const property = await db.query(
      `SELECT
        p.*,
        CASE
          WHEN p.agent_id IS NOT NULL OR p.lister_type = 'agent' THEN 'agent'
          ELSE 'private'
        END AS listed_by,
        a.id AS agent_id,
        a.full_name AS agent_name,
        a.company_name AS agent_company,
        a.phone AS agent_phone,
        a.whatsapp AS agent_whatsapp,
        a.email AS agent_email,
        a.registration_status AS agent_registration_status,
        a.listing_limit AS agent_listing_limit
      FROM properties p
      LEFT JOIN agents a ON a.id = p.agent_id
      WHERE p.id = $1`,
      [req.params.id]
    );

    if (!property.rows.length) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    const images = await db.query(
      `SELECT id, url, is_primary, sort_order
       FROM property_images
       WHERE property_id = $1
       ORDER BY is_primary DESC, sort_order ASC, created_at ASC`,
      [req.params.id]
    );

    return res.json({
      ok: true,
      data: {
        ...property.rows[0],
        images: images.rows
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/request-submit-otp', async (req, res, next) => {
  try {
    const channelInput = cleanText(req.body.channel).toLowerCase();
    const channel = channelInput === 'email' ? 'email' : 'phone';
    const phone = normalizeUgPhone(req.body.phone);
    const email = normalizeEmail(req.body.email);

    if (channel === 'email') {
      if (!email || !isValidEmail(email)) {
        return res.status(400).json({ ok: false, error: 'Valid email is required' });
      }
    } else if (!phone || !isValidPhone(phone) || !isValidUgPhone(phone)) {
      return res.status(400).json({ ok: false, error: 'Valid Uganda phone is required' });
    }

    const { otp, expiresMinutes, identifier } = await issueListingSubmitOtp({ channel, phone, email });

    return res.json({
      ok: true,
      data: {
        channel,
        identifier,
        phone: channel === 'phone' ? phone : undefined,
        email: channel === 'email' ? email : undefined,
        expires_minutes: expiresMinutes,
        message: 'OTP sent',
        ...(process.env.NODE_ENV === 'production' ? {} : { dev_otp: otp })
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/verify-submit-otp', async (req, res, next) => {
  try {
    const channelInput = cleanText(req.body.channel).toLowerCase();
    const channel = channelInput === 'email' ? 'email' : 'phone';
    const phone = normalizeUgPhone(req.body.phone);
    const email = normalizeEmail(req.body.email);
    const code = cleanText(req.body.code);
    const identifier = channel === 'email' ? email : phone;

    if (!identifier || !code) {
      return res.status(400).json({ ok: false, error: `${channel} and code are required` });
    }
    if (channel === 'phone' && (!isValidPhone(phone) || !isValidUgPhone(phone))) {
      return res.status(400).json({ ok: false, error: 'Valid Uganda phone is required' });
    }
    if (channel === 'email' && !isValidEmail(email)) {
      return res.status(400).json({ ok: false, error: 'Valid email is required' });
    }

    const otpResult = await db.query(
      `SELECT *
       FROM otps
       WHERE phone = $1
         AND code = $2
         AND purpose = 'listing_submit'
         AND used = FALSE
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [identifier, code]
    );

    if (!otpResult.rows.length) {
      return res.status(400).json({ ok: false, error: 'Invalid or expired OTP code' });
    }

    if (otpResult.rows.length) {
      await db.query('UPDATE otps SET used = TRUE WHERE id = $1', [otpResult.rows[0].id]);
    }
    const listingOtpToken = createListingSubmitToken({ channel, phone, email });

    return res.json({
      ok: true,
      data: {
        channel,
        identifier,
        phone: channel === 'phone' ? phone : undefined,
        email: channel === 'email' ? email : undefined,
        listing_otp_token: listingOtpToken,
        expires_in: process.env.LISTING_OTP_EXPIRES_IN || '30m'
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};

    const listingType = normalizeListingType(body.listing_type);
    const title = cleanText(body.title);
    const district = cleanText(body.district);
    const area = cleanText(body.area);
    const description = cleanText(body.description);
    const price = toNullableInt(body.price);

    const errors = [];

    if (!LISTING_TYPES.includes(listingType)) errors.push('listing_type is required and must be valid');
    if (!title) errors.push('title is required');
    if (!district) errors.push('district is required');
    if (!area) errors.push('area is required');
    if (!description) errors.push('description is required');
    if (price == null || price < 10000) errors.push('price must be provided in UGX');

    if (district && !DISTRICTS.includes(district)) {
      errors.push('district must be one of Uganda\'s valid districts');
    }

    const listerEmail = cleanText(body.lister_email);
    const listerEmailNormalized = normalizeEmail(listerEmail);
    const listerPhone = normalizeUgPhone(body.lister_phone);
    const listingOtpToken = cleanText(body.listing_otp_token);
    const otpChannelInput = cleanText(body.otp_channel || body.extra_fields?.verify?.otp_channel || 'phone').toLowerCase();
    const otpChannel = otpChannelInput === 'email' ? 'email' : 'phone';
    const latitude = toNullableFloat(body.latitude);
    const longitude = toNullableFloat(body.longitude);
    const studentsWelcome = parseBooleanLike(body.students_welcome, false);
    const verificationTermsAccepted = parseBooleanLike(body.verification_terms_accepted, false);
    const inquiryReference = cleanText(body.inquiry_reference) || null;
    const newUntilDate = body.new_until ? new Date(body.new_until) : new Date(Date.now() + (5 * 24 * 60 * 60 * 1000));
    const newUntil = Number.isNaN(newUntilDate.getTime()) ? new Date(Date.now() + (5 * 24 * 60 * 60 * 1000)) : newUntilDate;

    if (listerEmail && !isValidEmail(listerEmail)) errors.push('lister_email is invalid');
    if (listerPhone && !isValidPhone(listerPhone)) errors.push('lister_phone is invalid');
    if (listerPhone && !isValidUgPhone(listerPhone)) errors.push('lister_phone must be a valid Uganda phone (+256XXXXXXXXX)');
    if (latitude != null && (latitude < -90 || latitude > 90)) errors.push('latitude is out of range');
    if (longitude != null && (longitude < -180 || longitude > 180)) errors.push('longitude is out of range');

    const listedVia = cleanText(body.listed_via || 'website').toLowerCase();
    const enforceOtp = listedVia === 'website' || listedVia === 'web' || listedVia === 'desktop';
    const submittedImages = asArray(body.images)
      .map((item) => (typeof item === 'string' ? item : item?.url))
      .map((url) => cleanText(url))
      .filter(Boolean);

    if (enforceOtp) {
      if (otpChannel === 'email') {
        if (!listerEmailNormalized || !isValidEmail(listerEmailNormalized)) {
          errors.push('lister_email is required for email OTP verification');
        }
      } else if (!listerPhone) {
        errors.push('lister_phone is required for OTP verification');
      }
      if (submittedImages.length !== 5) {
        errors.push('Exactly 5 property images are required for website submissions');
      }
      if (!listingOtpToken) {
        errors.push('listing_otp_token is required. Verify OTP before submit');
      } else {
        const verified = verifyListingSubmitToken(listingOtpToken);
        if (!verified.ok) {
          errors.push('listing_otp_token is invalid or expired');
        } else if (verified.channel === 'email') {
          if (!listerEmailNormalized || verified.identifier !== listerEmailNormalized) {
            errors.push('listing_otp_token does not match lister_email');
          }
        } else if (!listerPhone || verified.identifier !== listerPhone) {
          errors.push('listing_otp_token does not match lister_phone');
        }
      }
    }

    // All public submissions are forced to pending review.
    const status = 'pending';

    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });
    }

    const amenities = asArray(body.amenities).map((x) => cleanText(x)).filter(Boolean);
    const extraFields = typeof body.extra_fields === 'object' && body.extra_fields !== null ? body.extra_fields : {};

    const insertResult = await db.query(
      `INSERT INTO properties (
        listing_type,
        title,
        description,
        district,
        area,
        address,
        price,
        price_period,
        bedrooms,
        bathrooms,
        property_type,
        title_type,
        year_built,
        furnishing,
        contract_months,
        deposit_amount,
        land_size_value,
        land_size_unit,
        floor_area_sqm,
        usable_size_sqm,
        parking_bays,
        nearest_university,
        distance_to_uni_km,
        room_type,
        room_arrangement,
        commercial_intent,
        latitude,
        longitude,
        students_welcome,
        verification_terms_accepted,
        inquiry_reference,
        id_number,
        id_document_name,
        new_until,
        amenities,
        extra_fields,
        lister_name,
        lister_phone,
        lister_email,
        lister_type,
        listed_via,
        source,
        status,
        expires_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
        $31,$32,$33,$34,$35,$36,$37,$38,$39,$40,
        $41,$42,$43,$44
      ) RETURNING id`,
      [
        listingType,
        title,
        description,
        district,
        area,
        cleanText(body.address) || null,
        price,
        cleanText(body.price_period) || null,
        toNullableInt(body.bedrooms),
        toNullableInt(body.bathrooms),
        cleanText(body.property_type) || null,
        cleanText(body.title_type) || null,
        toNullableInt(body.year_built),
        cleanText(body.furnishing) || null,
        toNullableInt(body.contract_months),
        toNullableInt(body.deposit_amount),
        toNullableFloat(body.land_size_value),
        cleanText(body.land_size_unit) || null,
        toNullableFloat(body.floor_area_sqm),
        toNullableFloat(body.usable_size_sqm),
        toNullableInt(body.parking_bays),
        cleanText(body.nearest_university) || null,
        toNullableFloat(body.distance_to_uni_km),
        cleanText(body.room_type) || null,
        cleanText(body.room_arrangement) || null,
        cleanText(body.commercial_intent) || null,
        latitude,
        longitude,
        listingType === 'student' ? true : studentsWelcome,
        verificationTermsAccepted,
        inquiryReference,
        cleanText(body.id_number) || null,
        cleanText(body.id_document_name) || null,
        newUntil,
        JSON.stringify(amenities),
        JSON.stringify(extraFields),
        cleanText(body.lister_name) || null,
        listerPhone || null,
        listerEmailNormalized || null,
        cleanText(body.lister_type) || 'owner',
        listedVia || 'website',
        cleanText(body.source) || 'website',
        status,
        body.expires_at ? new Date(body.expires_at) : null
      ]
    );

    const propertyId = insertResult.rows[0].id;

    const imageUrls = submittedImages.slice(0, enforceOtp ? 5 : 20);

    for (let i = 0; i < imageUrls.length; i += 1) {
      await db.query(
        `INSERT INTO property_images (property_id, url, is_primary, sort_order)
         VALUES ($1, $2, $3, $4)`,
        [propertyId, imageUrls[i], i === 0, i]
      );
    }

    let supportEmailNotification = { sent: false, mocked: true };
    try {
      supportEmailNotification = await sendPropertySubmissionNotification({
        propertyId,
        payload: {
          ...body,
          lister_phone: listerPhone,
          lister_email: listerEmailNormalized || null,
          listing_type: listingType,
          district,
          area,
          title,
          inquiry_reference: inquiryReference
        },
        imageCount: imageUrls.length
      });
    } catch (error) {
      logger.error('Property submission support email failed:', error.message);
    }

    return res.status(201).json({
      ok: true,
      data: {
        id: propertyId,
        status,
        imagesUploaded: imageUrls.length,
        inquiry_reference: inquiryReference,
        new_until: newUntil,
        support_notified: !!supportEmailNotification.sent,
        support_email: process.env.SUPPORT_EMAIL || 'info@makaug.com'
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/inquiries', async (req, res, next) => {
  try {
    const propertyId = req.params.id;
    const contactName = cleanText(req.body.contact_name);
    const contactPhone = cleanText(req.body.contact_phone);
    const contactEmail = cleanText(req.body.contact_email);
    const message = cleanText(req.body.message);

    const errors = [];
    if (!contactName) errors.push('contact_name is required');
    if (!contactPhone && !contactEmail) errors.push('contact_phone or contact_email is required');
    if (contactPhone && !isValidPhone(contactPhone)) errors.push('contact_phone is invalid');
    if (contactEmail && !isValidEmail(contactEmail)) errors.push('contact_email is invalid');

    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });
    }

    const exists = await db.query('SELECT id FROM properties WHERE id = $1', [propertyId]);
    if (!exists.rows.length) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    const inserted = await db.query(
      `INSERT INTO property_inquiries (
        property_id,
        contact_name,
        contact_phone,
        contact_email,
        message,
        channel
      ) VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id, created_at`,
      [
        propertyId,
        contactName,
        contactPhone || null,
        contactEmail || null,
        message || null,
        cleanText(req.body.channel) || 'web'
      ]
    );

    return res.status(201).json({ ok: true, data: inserted.rows[0] });
  } catch (error) {
    return next(error);
  }
});
router.patch('/:id/status', requireAdminApiKey, async (req, res, next) => {
  try {
    const nextStatus = cleanText(req.body.status).toLowerCase();
    const moderationReason = cleanText(req.body.reason) || null;

    if (!PROPERTY_STATUSES.includes(nextStatus)) {
      return res.status(400).json({ ok: false, error: 'Invalid status value' });
    }

    const result = await db.query(
      `UPDATE properties
       SET
         status = $2,
         reviewed_at = NOW(),
         updated_at = NOW(),
         extra_fields = CASE
           WHEN $3::text IS NULL OR trim($3::text) = '' THEN extra_fields
           ELSE COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object('moderation_reason', $3::text)
         END
       WHERE id = $1
       RETURNING id, title, listing_type, inquiry_reference, lister_name, lister_email, status, reviewed_at, extra_fields`,
      [req.params.id, nextStatus, moderationReason]
    );

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    const listing = result.rows[0];
    let notification = { sent: false, reason: 'no_lister_email' };
    if (listing?.lister_email) {
      try {
        notification = await sendListingModerationNotification({
          to: listing.lister_email,
          listing,
          status: nextStatus,
          reason: moderationReason
        });
      } catch (_e) {
        notification = { sent: false, reason: 'email_failed' };
      }
    }

    return res.json({
      ok: true,
      data: {
        ...listing,
        moderation_reason: moderationReason || listing?.extra_fields?.moderation_reason || null,
        lister_notified: !!notification.sent
      }
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
