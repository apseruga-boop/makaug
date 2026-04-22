const express = require('express');

const db = require('../config/database');
const logger = require('../config/logger');
const smsService = require('../models/smsService');
const {
  sendPropertySubmissionNotification,
  sendSupportEmail
} = require('../services/emailService');
const {
  buildAutomatedListingReview,
  createOwnerEditToken,
  getOwnerPreviewUrl,
  hashOwnerEditToken,
  isOwnerEditTokenValid,
  normalizeReviewChecklist,
  ownerEditTokenExpiry,
  sendOwnerListingStatusNotifications,
  sendOwnerListingSubmissionNotifications
} = require('../services/listingModerationService');
const { scanAndCacheExternalDuplicates } = require('../services/externalDuplicateScanService');
const { hasAdminAccess, requireAdminApiKey } = require('../middleware/auth');
const {
  asArray,
  cleanText,
  toNullableInt,
  toNullableFloat,
  isValidEmail,
  isValidPhone
} = require('../middleware/validation');
const {
  canUseAdminOtpOverride,
  isAdminOtpOverrideMatch
} = require('../utils/adminOtpOverride');
const {
  createListingSubmitToken,
  verifyListingSubmitToken
} = require('../utils/listingSubmitOtp');
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

function isUsableSubmittedImageUrl(url) {
  const value = cleanText(url);
  return /^https?:\/\//i.test(value) || /^data:image\//i.test(value);
}

function toUuidOrNull(value) {
  const text = cleanText(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function getOwnerEditTokenFromRequest(req) {
  return cleanText(
    req.get('x-listing-edit-token')
      || req.query.edit_token
      || req.query.token
      || req.body?.edit_token
      || req.body?.token
  );
}

function canUseOwnerEditToken(property, token) {
  if (!property?.owner_edit_token_hash || !token) return false;
  const expiresAt = property.owner_edit_token_expires_at
    ? new Date(property.owner_edit_token_expires_at)
    : null;
  if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) return false;
  return isOwnerEditTokenValid(token, property.owner_edit_token_hash);
}

function publicPropertyRow(property, images = []) {
  const {
    owner_edit_token_hash: _ownerEditTokenHash,
    id_number: _idNumber,
    id_document_name: _idDocumentName,
    id_document_url: _idDocumentUrl,
    ...safeProperty
  } = property || {};
  return {
    ...safeProperty,
    id_number_present: !!property?.id_number,
    id_document_present: !!property?.id_document_name,
    images
  };
}

async function loadPropertyWithImages(propertyId) {
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
      a.registration_status AS agent_registration_status
     FROM properties p
     LEFT JOIN agents a ON a.id = p.agent_id
     WHERE p.id = $1`,
    [propertyId]
  );

  if (!property.rows.length) return null;

  const images = await db.query(
    `SELECT id, url, is_primary, sort_order
     FROM property_images
     WHERE property_id = $1
     ORDER BY is_primary DESC, sort_order ASC, created_at ASC`,
    [propertyId]
  );

  return {
    property: property.rows[0],
    images: images.rows
  };
}

async function loadAutomatedReviewForProperty(propertyId) {
  const loaded = await loadPropertyWithImages(propertyId);
  if (!loaded) return null;
  const { property, images } = loaded;
  const [
    previousListerListings,
    likelyDuplicates,
    reusedImages,
    idNumberMatches,
    matchingUsers
  ] = await Promise.all([
    db.query(
      `SELECT id, title, listing_type, district, area, price, status, created_at
       FROM properties
       WHERE id <> $1
         AND (
           ($2::text IS NOT NULL AND lister_phone = $2)
           OR ($3::text IS NOT NULL AND LOWER(COALESCE(lister_email, '')) = LOWER($3))
         )
       ORDER BY created_at DESC
       LIMIT 20`,
      [propertyId, property.lister_phone || null, property.lister_email || null]
    ),
    db.query(
      `SELECT id, title, listing_type, district, area, address, price, status, created_at
       FROM properties
       WHERE id <> $1
         AND (
           LOWER(title) = LOWER($2)
           OR (
             COALESCE(address, '') <> ''
             AND LOWER(COALESCE(address, '')) = LOWER(COALESCE($3::text, ''))
           )
           OR (
             listing_type = $4
             AND district = $5
             AND LOWER(area) = LOWER($6)
             AND COALESCE(price, 0) = COALESCE($7::bigint, 0)
           )
         )
       ORDER BY created_at DESC
       LIMIT 20`,
      [
        propertyId,
        property.title || '',
        property.address || null,
        property.listing_type,
        property.district,
        property.area,
        property.price
      ]
    ),
    db.query(
      `SELECT DISTINCT p.id, p.title, p.status, i.url
       FROM property_images current_i
       JOIN property_images i ON i.url = current_i.url AND i.property_id <> current_i.property_id
       JOIN properties p ON p.id = i.property_id
       WHERE current_i.property_id = $1
       ORDER BY p.title ASC
       LIMIT 20`,
      [propertyId]
    ),
    db.query(
      `SELECT id, title, lister_name, lister_phone, lister_email, status, created_at
       FROM properties
       WHERE id <> $1
         AND $2::text IS NOT NULL
         AND id_number = $2
       ORDER BY created_at DESC
       LIMIT 20`,
      [propertyId, property.id_number || null]
    ),
    db.query(
      `SELECT id, first_name, last_name, phone, email, role, status, created_at
       FROM users
       WHERE ($1::text IS NOT NULL AND phone = $1)
          OR ($2::text IS NOT NULL AND LOWER(COALESCE(email, '')) = LOWER($2))
       ORDER BY created_at DESC
       LIMIT 20`,
      [property.lister_phone || null, property.lister_email || null]
    )
  ]);

  const externalDuplicateScan = await scanAndCacheExternalDuplicates({
    db,
    listing: property,
    images
  });

  return buildAutomatedListingReview({
    listing: property,
    images,
    previousListerListings: previousListerListings.rows,
    likelyDuplicates: likelyDuplicates.rows,
    reusedImages: reusedImages.rows,
    idNumberMatches: idNumberMatches.rows,
    matchingUsers: matchingUsers.rows,
    externalDuplicateScan
  });
}

async function issueListingSubmitOtp({ channel = 'phone', phone = '', email = '' }) {
  const resolvedChannel = String(channel || 'phone').toLowerCase() === 'email' ? 'email' : 'phone';
  const identifier = resolvedChannel === 'email' ? normalizeEmail(email) : normalizeUgPhone(phone);
  const overrideAllowed = canUseAdminOtpOverride({ channel: resolvedChannel, identifier });
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
      if (overrideAllowed) {
        logger.warn('Listing OTP email failed, using ADMIN_OTP_OVERRIDE_CODE fallback');
        return { otp, expiresMinutes, channel: resolvedChannel, identifier };
      }
      const sendError = new Error('Failed to send OTP email');
      sendError.status = 400;
      throw sendError;
    }
    if (process.env.NODE_ENV === 'production' && (!delivery?.sent || delivery?.mocked)) {
      logger.warn('Listing email OTP delivery unavailable', { channel: resolvedChannel, delivery });
      if (overrideAllowed) {
        logger.warn('Listing OTP email delivery unavailable, using ADMIN_OTP_OVERRIDE_CODE fallback');
        return { otp, expiresMinutes, channel: resolvedChannel, identifier };
      }
      const reason = String(delivery?.error || delivery?.reason || '').toLowerCase();
      const configError = new Error(
        (reason.includes('smtpclientauthentication') || reason.includes('5.7.139'))
          ? 'Email OTP is blocked by Microsoft 365 tenant policy. Enable Authenticated SMTP or configure Microsoft Graph mail delivery.'
          : 'Email OTP delivery provider is not configured'
      );
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
      if (overrideAllowed) {
        logger.warn('Listing OTP SMS failed, using ADMIN_OTP_OVERRIDE_CODE fallback');
        return { otp, expiresMinutes, channel: resolvedChannel, identifier };
      }
      const sendError = new Error('Failed to send OTP SMS');
      sendError.status = 400;
      throw sendError;
    }
    if (process.env.NODE_ENV === 'production' && (delivery?.mocked || !delivery?.sid)) {
      if (overrideAllowed) {
        logger.warn('Listing OTP SMS delivery unavailable, using ADMIN_OTP_OVERRIDE_CODE fallback');
        return { otp, expiresMinutes, channel: resolvedChannel, identifier };
      }
      const configError = new Error('Phone OTP delivery provider is not configured');
      configError.status = 400;
      throw configError;
    }
  }

  return { otp, expiresMinutes, channel: resolvedChannel, identifier };
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
    const requestingModerationData = status && status !== 'approved';

    if (requestingModerationData && !(await hasAdminAccess(req))) {
      return res.status(403).json({
        ok: false,
        error: 'Admin access is required to list non-public properties'
      });
    }

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
    const loaded = await loadPropertyWithImages(req.params.id);

    if (!loaded) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    const { property, images } = loaded;
    const ownerToken = getOwnerEditTokenFromRequest(req);
    const canViewNonPublic = property.status === 'approved'
      || canUseOwnerEditToken(property, ownerToken)
      || await hasAdminAccess(req);

    if (!canViewNonPublic) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    return res.json({
      ok: true,
      data: publicPropertyRow(property, images)
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/preview', async (req, res, next) => {
  try {
    const loaded = await loadPropertyWithImages(req.params.id);
    if (!loaded) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    const { property, images } = loaded;
    const token = getOwnerEditTokenFromRequest(req);
    if (!canUseOwnerEditToken(property, token)) {
      return res.status(403).json({ ok: false, error: 'Invalid or expired listing preview token' });
    }

    return res.json({
      ok: true,
      data: {
        ...publicPropertyRow(property, images),
        owner_can_edit: ['pending', 'rejected'].includes(String(property.status || '').toLowerCase()),
        moderation_reason: property.moderation_reason || property.extra_fields?.moderation_reason || null
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/preview', async (req, res, next) => {
  try {
    const loaded = await loadPropertyWithImages(req.params.id);
    if (!loaded) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    const { property } = loaded;
    const token = getOwnerEditTokenFromRequest(req);
    if (!canUseOwnerEditToken(property, token)) {
      return res.status(403).json({ ok: false, error: 'Invalid or expired listing preview token' });
    }

    const currentStatus = String(property.status || '').toLowerCase();
    if (!['pending', 'rejected'].includes(currentStatus)) {
      return res.status(400).json({
        ok: false,
        error: 'This listing can only be edited while pending or rejected'
      });
    }

    const patch = req.body?.listing && typeof req.body.listing === 'object' ? req.body.listing : req.body;
    const fieldMap = {
      title: { column: 'title', value: cleanText(patch.title), required: true },
      description: { column: 'description', value: cleanText(patch.description), required: true },
      area: { column: 'area', value: cleanText(patch.area), required: true },
      address: { column: 'address', value: cleanText(patch.address) || null },
      price: { column: 'price', value: toNullableInt(patch.price) },
      price_period: { column: 'price_period', value: cleanText(patch.price_period) || null },
      property_type: { column: 'property_type', value: cleanText(patch.property_type) || null },
      title_type: { column: 'title_type', value: cleanText(patch.title_type) || null },
      bedrooms: { column: 'bedrooms', value: toNullableInt(patch.bedrooms) },
      bathrooms: { column: 'bathrooms', value: toNullableInt(patch.bathrooms) }
    };

    const setParts = [];
    const values = [req.params.id];
    let idx = 2;
    const errors = [];

    Object.entries(fieldMap).forEach(([bodyKey, spec]) => {
      if (!Object.prototype.hasOwnProperty.call(patch, bodyKey)) return;
      if (spec.required && !spec.value) errors.push(`${bodyKey} cannot be empty`);
      setParts.push(`${spec.column} = $${idx}`);
      values.push(spec.value);
      idx += 1;
    });

    if (Object.prototype.hasOwnProperty.call(patch, 'district')) {
      const district = cleanText(patch.district);
      if (!DISTRICTS.includes(district)) errors.push('district must be one of Uganda\'s valid districts');
      setParts.push(`district = $${idx}`);
      values.push(district);
      idx += 1;
    }

    if (Object.prototype.hasOwnProperty.call(patch, 'amenities')) {
      const amenities = asArray(patch.amenities).map((x) => cleanText(x)).filter(Boolean);
      setParts.push(`amenities = $${idx}::jsonb`);
      values.push(JSON.stringify(amenities));
      idx += 1;
    }

    const resubmit = req.body?.resubmit === true || String(req.body?.resubmit || '').toLowerCase() === 'true';
    if (resubmit) {
      setParts.push("status = 'pending'");
      setParts.push("moderation_stage = 'resubmitted'");
      setParts.push('moderation_reason = NULL');
      setParts.push('reviewed_at = NULL');
    }

    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });
    }

    if (!setParts.length) {
      return res.status(400).json({ ok: false, error: 'No supported listing fields supplied' });
    }

    setParts.push('owner_last_edited_at = NOW()');
    setParts.push('updated_at = NOW()');

    const updated = await db.query(
      `UPDATE properties
       SET ${setParts.join(', ')}
       WHERE id = $1
       RETURNING id, title, description, district, area, price, price_period, property_type, title_type, status, moderation_stage, owner_last_edited_at`,
      values
    );

    await db.query(
      `INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.params.id,
        'listing_owner',
        resubmit ? 'owner_listing_resubmitted' : 'owner_listing_edited',
        currentStatus,
        updated.rows[0]?.status || currentStatus,
        cleanText(req.body?.edit_note) || null
      ]
    );

    return res.json({ ok: true, data: updated.rows[0] });
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

    const usedOverride = isAdminOtpOverrideMatch({ code, channel, identifier });

    if (!usedOverride) {
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

      await db.query('UPDATE otps SET used = TRUE WHERE id = $1', [otpResult.rows[0].id]);
    } else {
      logger.warn('Listing OTP verified via ADMIN_OTP_OVERRIDE_CODE fallback', {
        channel,
        identifier
      });
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
    const invalidSubmittedImages = submittedImages.filter((url) => !isUsableSubmittedImageUrl(url));

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
      if (invalidSubmittedImages.length) {
        errors.push('Each property image must include a viewable image URL');
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
    const ownerEditToken = createOwnerEditToken();
    const ownerEditTokenHash = hashOwnerEditToken(ownerEditToken);
    const ownerEditTokenExpiresAt = ownerEditTokenExpiry();

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
        id_document_url,
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
        moderation_stage,
        owner_edit_token_hash,
        owner_edit_token_expires_at,
        expires_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
        $31,$32,$33,$34,$35,$36,$37,$38,$39,$40,
        $41,$42,$43,$44,$45,$46,$47,$48
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
        cleanText(body.id_document_url || body.extra_fields?.verify?.id_document_url) || null,
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
        'submitted',
        ownerEditTokenHash,
        ownerEditTokenExpiresAt,
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

    const ownerNotificationListing = {
      id: propertyId,
      title,
      listing_type: listingType,
      inquiry_reference: inquiryReference,
      lister_name: cleanText(body.lister_name) || null,
      lister_phone: listerPhone || null,
      lister_email: listerEmailNormalized || null
    };

    let ownerNotification = {
      email: { sent: false, reason: 'not_attempted' },
      whatsapp: { sent: false, reason: 'not_attempted' }
    };
    try {
      ownerNotification = await sendOwnerListingSubmissionNotifications({
        listing: ownerNotificationListing,
        token: ownerEditToken
      });
      await db.query(
        `INSERT INTO property_moderation_events (property_id, actor_id, action, status_to, delivery)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          propertyId,
          'system',
          'listing_submitted_for_review',
          status,
          JSON.stringify(ownerNotification)
        ]
      );
    } catch (error) {
      logger.error('Property submission owner notification failed:', error.message);
    }

    return res.status(201).json({
      ok: true,
      data: {
        id: propertyId,
        status,
        imagesUploaded: imageUrls.length,
        inquiry_reference: inquiryReference,
        new_until: newUntil,
        owner_preview_url: getOwnerPreviewUrl(ownerNotificationListing, ownerEditToken),
        owner_edit_token_expires_at: ownerEditTokenExpiresAt,
        support_notified: !!supportEmailNotification.sent,
        owner_notified: !!(ownerNotification.email?.sent || ownerNotification.whatsapp?.sent),
        owner_email_sent: ownerNotification.email?.sent === true,
        owner_whatsapp_sent: ownerNotification.whatsapp?.sent === true,
        owner_whatsapp_url: ownerNotification.whatsapp?.manual_url || null,
        owner_notification: ownerNotification,
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

    const exists = await db.query('SELECT id FROM properties WHERE id = $1 AND status = $2', [propertyId, 'approved']);
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
    const reviewNotes = cleanText(req.body.review_notes || req.body.notes) || null;

    if (!PROPERTY_STATUSES.includes(nextStatus)) {
      return res.status(400).json({ ok: false, error: 'Invalid status value' });
    }

    if (nextStatus === 'rejected' && !moderationReason) {
      return res.status(400).json({ ok: false, error: 'reason is required when rejecting a listing' });
    }

    const currentResult = await db.query(
      `SELECT id, status, moderation_checklist, owner_edit_token_hash
       FROM properties
       WHERE id = $1
       LIMIT 1`,
      [req.params.id]
    );

    if (!currentResult.rows.length) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    const current = currentResult.rows[0];
    const automatedReview = nextStatus === 'approved'
      ? await loadAutomatedReviewForProperty(req.params.id)
      : null;
    const checklistSource = automatedReview?.checklist
      || (req.body.checklist && typeof req.body.checklist === 'object' ? req.body.checklist : current.moderation_checklist);
    const checklist = normalizeReviewChecklist(checklistSource);
    const missingChecks = nextStatus === 'approved'
      ? (automatedReview?.blocking_failures || []).map((item) => `${item.label}: ${item.message}`)
      : [];

    if (missingChecks.length) {
      return res.status(400).json({
        ok: false,
        error: 'Approval checklist is incomplete',
        details: missingChecks
      });
    }

    const actorId = req.adminAuth?.userId || req.adminAuth?.type || 'admin_api_key';
    const reviewerUserId = toUuidOrNull(req.adminAuth?.userId);
    const regeneratedOwnerToken = nextStatus === 'rejected' ? createOwnerEditToken() : '';
    const regeneratedOwnerTokenHash = regeneratedOwnerToken ? hashOwnerEditToken(regeneratedOwnerToken) : null;
    const regeneratedOwnerTokenExpiresAt = regeneratedOwnerToken ? ownerEditTokenExpiry() : null;
    const moderationStage = nextStatus === 'approved'
      ? 'approved'
      : nextStatus === 'rejected'
        ? 'rejected'
        : nextStatus === 'pending'
          ? 'submitted'
          : nextStatus;

    const result = await db.query(
      `UPDATE properties
       SET
         status = $2,
         reviewed_at = NOW(),
         reviewed_by = COALESCE($7::uuid, reviewed_by),
         moderation_stage = $8,
         moderation_checklist = $4::jsonb,
         moderation_notes = COALESCE($5::text, moderation_notes),
         moderation_reason = $3::text,
         approved_at = CASE WHEN $2 = 'approved' THEN NOW() ELSE approved_at END,
         rejected_at = CASE WHEN $2 = 'rejected' THEN NOW() ELSE rejected_at END,
         owner_edit_token_hash = CASE WHEN $9::text IS NULL THEN owner_edit_token_hash ELSE $9::text END,
         owner_edit_token_expires_at = CASE WHEN $10::timestamptz IS NULL THEN owner_edit_token_expires_at ELSE $10::timestamptz END,
         updated_at = NOW(),
         extra_fields = CASE
           WHEN $3::text IS NULL OR trim($3::text) = '' THEN extra_fields
           ELSE COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object('moderation_reason', $3::text)
         END
       WHERE id = $1
       RETURNING id, title, listing_type, inquiry_reference, lister_name, lister_phone, lister_email, status, reviewed_at, moderation_stage, moderation_checklist, moderation_notes, moderation_reason, extra_fields`,
      [
        req.params.id,
        nextStatus,
        moderationReason,
        JSON.stringify(checklist),
        reviewNotes,
        actorId,
        reviewerUserId,
        moderationStage,
        regeneratedOwnerTokenHash,
        regeneratedOwnerTokenExpiresAt
      ]
    );

    const listing = result.rows[0];
    let notification = {
      email: { sent: false, reason: 'not_attempted' },
      whatsapp: { sent: false, reason: 'not_attempted' }
    };

    try {
      notification = await sendOwnerListingStatusNotifications({
        listing: {
          ...listing,
          owner_edit_token: regeneratedOwnerToken
        },
        status: nextStatus,
        reason: moderationReason
      });
      if (notification.email?.sent || notification.whatsapp?.sent) {
        await db.query(
          'UPDATE properties SET last_moderation_notification_at = NOW() WHERE id = $1',
          [listing.id]
        );
      }
    } catch (error) {
      notification = { sent: false, reason: 'notification_failed', error: error.message || 'send_failed' };
    }

    await db.query(
      `INSERT INTO property_moderation_events (
        property_id,
        actor_id,
        action,
        status_from,
        status_to,
        checklist,
        reason,
        notes,
        delivery
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb)`,
      [
        listing.id,
        actorId,
        'listing_status_changed',
        current.status,
        nextStatus,
        JSON.stringify(checklist),
        moderationReason,
        reviewNotes,
        JSON.stringify(notification)
      ]
    );

    return res.json({
      ok: true,
      data: {
        ...listing,
        moderation_reason: moderationReason || listing?.extra_fields?.moderation_reason || null,
        lister_notified: !!(notification.email?.sent || notification.whatsapp?.sent),
        notification,
        automated_review: automatedReview || undefined
      }
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
