const express = require('express');

const db = require('../config/database');
const { requireAdminApiKey } = require('../middleware/auth');
const { asArray, cleanText, toNullableInt } = require('../middleware/validation');
const { parsePagination, toPagination } = require('../utils/pagination');
const { DISTRICTS } = require('../utils/constants');
const { normalizeEmail, normalizeUgPhone } = require('../utils/adminOtpOverride');
const { createListingSubmitToken } = require('../utils/listingSubmitOtp');
const { processPendingCampaignQueue, refreshCampaignStatus } = require('../services/whatsappCampaignService');
const { generateCampaignCopy } = require('../services/aiService');
const {
  buildAutomatedListingReview,
  createOwnerEditToken,
  getOwnerPreviewUrl,
  hashOwnerEditToken,
  normalizeReviewChecklist,
  ownerEditTokenExpiry
} = require('../services/listingModerationService');
const {
  getCachedExternalDuplicateScan,
  scanAndCacheExternalDuplicates
} = require('../services/externalDuplicateScanService');

const router = express.Router();

router.use(requireAdminApiKey);

async function writeAudit(action, details = {}, actorId = 'admin_api_key') {
  try {
    await db.query(
      `INSERT INTO audit_logs (actor_id, action, details)
       VALUES ($1, $2, $3::jsonb)`,
      [actorId, action, JSON.stringify(details || {})]
    );
  } catch (_error) {
    // Avoid failing admin APIs when audit table is temporarily unavailable.
  }
}

function adminActorId(req) {
  return req.adminAuth?.userId || req.adminAuth?.type || 'admin_api_key';
}

async function loadPropertyReview(propertyId) {
  const property = await db.query(
    `SELECT
      p.*,
      a.id AS agent_id,
      a.full_name AS agent_name,
      a.company_name AS agent_company,
      a.phone AS agent_phone,
      a.email AS agent_email,
      a.licence_number AS agent_licence_number,
      a.registration_status AS agent_registration_status
     FROM properties p
     LEFT JOIN agents a ON a.id = p.agent_id
     WHERE p.id = $1
     LIMIT 1`,
    [propertyId]
  );

  if (!property.rows.length) return null;
  const listing = property.rows[0];

  const [
    images,
    previousListerListings,
    likelyDuplicates,
    reusedImages,
    idNumberMatches,
    matchingUsers,
    events
  ] = await Promise.all([
    db.query(
      `SELECT id, url, is_primary, sort_order, created_at
       FROM property_images
       WHERE property_id = $1
       ORDER BY is_primary DESC, sort_order ASC, created_at ASC`,
      [propertyId]
    ),
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
      [propertyId, listing.lister_phone || null, listing.lister_email || null]
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
        listing.title || '',
        listing.address || null,
        listing.listing_type,
        listing.district,
        listing.area,
        listing.price
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
      [propertyId, listing.id_number || null]
    ),
    db.query(
      `SELECT id, first_name, last_name, phone, email, role, status, created_at
       FROM users
       WHERE ($1::text IS NOT NULL AND phone = $1)
          OR ($2::text IS NOT NULL AND LOWER(COALESCE(email, '')) = LOWER($2))
       ORDER BY created_at DESC
       LIMIT 20`,
      [listing.lister_phone || null, listing.lister_email || null]
    ),
    db.query(
      `SELECT id, actor_id, action, status_from, status_to, checklist, reason, notes, delivery, created_at
       FROM property_moderation_events
       WHERE property_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [propertyId]
    )
  ]);

  const externalDuplicateScan = getCachedExternalDuplicateScan(listing);

  const automatedReview = buildAutomatedListingReview({
    listing,
    images: images.rows,
    previousListerListings: previousListerListings.rows,
    likelyDuplicates: likelyDuplicates.rows,
    reusedImages: reusedImages.rows,
    idNumberMatches: idNumberMatches.rows,
    matchingUsers: matchingUsers.rows,
    externalDuplicateScan
  });

  return {
    ...listing,
    owner_edit_token_hash: undefined,
    images: images.rows,
    review: {
      checklist: automatedReview.checklist,
      checklist_items: automatedReview.checks,
      notes: listing.moderation_notes || '',
      reason: listing.moderation_reason || listing.extra_fields?.moderation_reason || '',
      automated: automatedReview
    },
    quality_signals: {
      previous_lister_listing_count: previousListerListings.rows.length,
      previous_lister_listings: previousListerListings.rows,
      likely_duplicate_count: likelyDuplicates.rows.length,
      likely_duplicates: likelyDuplicates.rows,
      reused_image_count: reusedImages.rows.length,
      reused_images: reusedImages.rows,
      id_number_match_count: idNumberMatches.rows.length,
      id_number_matches: idNumberMatches.rows,
      matching_user_count: matchingUsers.rows.length,
      matching_users: matchingUsers.rows,
      external_duplicate_check: externalDuplicateScan
    },
    events: events.rows
  };
}

async function updatePropertyEditableFields({ propertyId, patch = {} }) {
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
  const values = [propertyId];
  const errors = [];
  let idx = 2;

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

  if (errors.length) {
    const err = new Error('Validation failed');
    err.status = 400;
    err.details = errors;
    throw err;
  }

  if (!setParts.length) return null;

  setParts.push('updated_at = NOW()');

  const updated = await db.query(
    `UPDATE properties
     SET ${setParts.join(', ')}
     WHERE id = $1
     RETURNING id`,
    values
  );

  return updated.rows[0] || null;
}

router.get('/summary', async (req, res, next) => {
  try {
    const [properties, agents, reports, requests, inquiries, users] = await Promise.all([
      db.query(
        `SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
          COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
          COUNT(*) FILTER (WHERE status = 'hidden')::int AS hidden,
          COUNT(*) FILTER (WHERE status = 'deleted')::int AS deleted,
          COUNT(*) FILTER (WHERE COALESCE(lister_type, 'owner') <> 'agent' AND agent_id IS NULL)::int AS private,
          COUNT(*) FILTER (WHERE COALESCE(lister_type, 'owner') = 'agent' OR agent_id IS NOT NULL)::int AS agent_listed,
          COUNT(*) FILTER (WHERE listing_type = 'student' OR students_welcome = TRUE)::int AS student_discoverable,
          COALESCE(ROUND((((COUNT(*) FILTER (WHERE status = 'approved'))::numeric / NULLIF(COUNT(*)::numeric, 0)) * 100)), 0)::int AS approval_rate_pct,
          COALESCE(ROUND((((COUNT(*) FILTER (WHERE status = 'rejected'))::numeric / NULLIF(COUNT(*)::numeric, 0)) * 100)), 0)::int AS rejection_rate_pct
         FROM properties`
      ),
      db.query(
        `SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'approved')::int AS approved
         FROM agents`
      ),
      db.query(
        `SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'open')::int AS open
         FROM report_listings`
      ),
      db.query('SELECT COUNT(*)::int AS total FROM property_requests'),
      db.query('SELECT COUNT(*)::int AS total FROM property_inquiries'),
      db.query(
        `SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE status = 'suspended')::int AS suspended,
          COUNT(*) FILTER (WHERE phone_verified = TRUE)::int AS phone_verified
         FROM users`
      )
    ]);

    return res.json({
      ok: true,
      data: {
        properties: properties.rows[0],
        agents: agents.rows[0],
        users: users.rows[0],
        reports: reports.rows[0],
        propertyRequests: requests.rows[0],
        inquiries: inquiries.rows[0]
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/recent', async (req, res, next) => {
  try {
    const [recentProperties, recentAgents, recentReports, recentUsers] = await Promise.all([
      db.query(
        `SELECT id, title, listing_type, district, status, created_at
         FROM properties
         ORDER BY created_at DESC
         LIMIT 20`
      ),
      db.query(
        `SELECT id, full_name, company_name, licence_number, status, created_at
         FROM agents
         ORDER BY created_at DESC
         LIMIT 20`
      ),
      db.query(
        `SELECT id, property_reference, reason, status, created_at
         FROM report_listings
         ORDER BY created_at DESC
         LIMIT 20`
      ),
      db.query(
        `SELECT id, first_name, last_name, phone, email, role, status, phone_verified, created_at
         FROM users
         ORDER BY created_at DESC
         LIMIT 20`
      )
    ]);

    return res.json({
      ok: true,
      data: {
        recentProperties: recentProperties.rows,
        recentAgents: recentAgents.rows,
        recentReports: recentReports.rows,
        recentUsers: recentUsers.rows
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/properties/live', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const values = [limit, offset];

    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total
       FROM properties p
       WHERE p.status = 'approved'`
    );
    const total = countResult.rows[0]?.total || 0;

    const rows = await db.query(
      `SELECT
        p.id,
        p.title,
        p.listing_type,
        p.district,
        p.area,
        p.price,
        p.price_period,
        p.status,
        p.inquiry_reference,
        p.lister_name,
        p.lister_phone,
        p.lister_email,
        p.created_at,
        p.updated_at,
        p.reviewed_at,
        p.approved_at,
        p.last_moderation_notification_at,
        COALESCE(p.approved_at, p.reviewed_at, p.updated_at, p.created_at) AS live_at,
        COALESCE(p.approved_at, p.reviewed_at, p.updated_at, p.created_at) + INTERVAL '14 days' AS follow_up_due_at,
        (NOW() >= COALESCE(p.approved_at, p.reviewed_at, p.updated_at, p.created_at) + INTERVAL '14 days') AS follow_up_due,
        img.url AS primary_image_url
       FROM properties p
       LEFT JOIN LATERAL (
         SELECT i.url
         FROM property_images i
         WHERE i.property_id = p.id
         ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC
         LIMIT 1
       ) img ON true
       WHERE p.status = 'approved'
       ORDER BY live_at DESC
       LIMIT $1
       OFFSET $2`,
      values
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

router.get('/properties/:id/review', async (req, res, next) => {
  try {
    const review = await loadPropertyReview(req.params.id);
    if (!review) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    return res.json({ ok: true, data: review });
  } catch (error) {
    return next(error);
  }
});

router.post('/properties/:id/external-duplicate-scan', async (req, res, next) => {
  try {
    const property = await db.query(
      `SELECT *
       FROM properties
       WHERE id = $1
       LIMIT 1`,
      [req.params.id]
    );
    if (!property.rows.length) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    const images = await db.query(
      `SELECT id, url, is_primary, sort_order, created_at
       FROM property_images
       WHERE property_id = $1
       ORDER BY is_primary DESC, sort_order ASC, created_at ASC`,
      [req.params.id]
    );

    const scan = await scanAndCacheExternalDuplicates({
      db,
      listing: property.rows[0],
      images: images.rows,
      force: req.body?.force !== false
    });

    await writeAudit('admin_property_external_duplicate_scan_run', {
      property_id: req.params.id,
      status: scan.status,
      provider: scan.provider
    }, adminActorId(req));

    return res.json({ ok: true, data: scan });
  } catch (error) {
    return next(error);
  }
});

router.patch('/properties/:id/review', async (req, res, next) => {
  try {
    const existing = await db.query('SELECT id, status, moderation_checklist FROM properties WHERE id = $1 LIMIT 1', [req.params.id]);
    if (!existing.rows.length) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    const listingPatch = req.body?.listing && typeof req.body.listing === 'object' ? req.body.listing : null;
    if (listingPatch) {
      await updatePropertyEditableFields({ propertyId: req.params.id, patch: listingPatch });
    }

    const checklist = req.body.checklist && typeof req.body.checklist === 'object'
      ? normalizeReviewChecklist(req.body.checklist)
      : normalizeReviewChecklist(existing.rows[0].moderation_checklist);
    const notes = cleanText(req.body.notes || req.body.review_notes) || null;
    const reason = cleanText(req.body.reason) || null;
    const stage = cleanText(req.body.stage) || 'in_review';
    const actorId = adminActorId(req);
    const reviewerUserId = req.adminAuth?.userId || null;

    const updated = await db.query(
      `UPDATE properties
       SET
         moderation_stage = $2,
         moderation_checklist = $3::jsonb,
         moderation_notes = COALESCE($4::text, moderation_notes),
         moderation_reason = COALESCE($5::text, moderation_reason),
         reviewed_by = COALESCE($6::uuid, reviewed_by),
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, status, moderation_stage, moderation_checklist, moderation_notes, moderation_reason, reviewed_by, updated_at`,
      [
        req.params.id,
        stage,
        JSON.stringify(checklist),
        notes,
        reason,
        reviewerUserId
      ]
    );

    await db.query(
      `INSERT INTO property_moderation_events (property_id, actor_id, action, checklist, reason, notes)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [
        req.params.id,
        actorId,
        listingPatch ? 'listing_review_updated_with_listing_edits' : 'listing_review_updated',
        JSON.stringify(checklist),
        reason,
        notes
      ]
    );

    await writeAudit('admin_property_review_updated', {
      property_id: req.params.id,
      stage,
      listing_edited: !!listingPatch
    }, actorId);

    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        ok: false,
        error: error.message,
        details: error.details || undefined
      });
    }
    return next(error);
  }
});

router.post('/properties/:id/review-token', async (req, res, next) => {
  try {
    const property = await db.query(
      `SELECT id, title, inquiry_reference, lister_name, lister_phone, lister_email
       FROM properties
       WHERE id = $1
       LIMIT 1`,
      [req.params.id]
    );
    if (!property.rows.length) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    const token = createOwnerEditToken();
    const expiresAt = ownerEditTokenExpiry();
    await db.query(
      `UPDATE properties
       SET owner_edit_token_hash = $2,
           owner_edit_token_expires_at = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [req.params.id, hashOwnerEditToken(token), expiresAt]
    );

    const url = getOwnerPreviewUrl(property.rows[0], token);
    await writeAudit('admin_property_review_token_created', {
      property_id: req.params.id,
      expires_at: expiresAt
    }, adminActorId(req));

    return res.json({
      ok: true,
      data: {
        property_id: req.params.id,
        owner_preview_url: url,
        expires_at: expiresAt
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/listing-submit-otp-override', async (req, res, next) => {
  try {
    const channel = cleanText(req.body.channel).toLowerCase() === 'email' ? 'email' : 'phone';
    const phone = normalizeUgPhone(req.body.phone);
    const email = normalizeEmail(req.body.email);
    const identifier = channel === 'email' ? email : phone;

    if (channel === 'email') {
      if (!identifier || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
        return res.status(400).json({ ok: false, error: 'Valid email is required' });
      }
    } else if (!identifier || !/^\+256\d{9}$/.test(identifier)) {
      return res.status(400).json({ ok: false, error: 'Valid Uganda phone is required' });
    }

    const token = createListingSubmitToken({ channel, phone, email });
    await writeAudit('admin_listing_submit_otp_override_created', {
      channel,
      identifier
    }, adminActorId(req));

    return res.json({
      ok: true,
      data: {
        channel,
        identifier,
        phone: channel === 'phone' ? phone : undefined,
        email: channel === 'email' ? email : undefined,
        listing_otp_token: token,
        expires_in: process.env.LISTING_OTP_EXPIRES_IN || '30m'
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/users', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const search = String(req.query.search || '').trim().toLowerCase();
    const rawStatus = String(req.query.status || '').trim().toLowerCase();
    const status = ['live', 'active', 'published'].includes(rawStatus)
      ? 'queued'
      : rawStatus;
    const role = String(req.query.role || '').trim().toLowerCase();

    const filters = [];
    const values = [];

    if (search) {
      values.push(`%${search}%`);
      filters.push(`(
        u.first_name ILIKE $${values.length}
        OR u.last_name ILIKE $${values.length}
        OR u.phone ILIKE $${values.length}
        OR COALESCE(u.email, '') ILIKE $${values.length}
      )`);
    }
    if (status) {
      values.push(status);
      filters.push(`u.status = $${values.length}`);
    }
    if (role) {
      values.push(role);
      filters.push(`u.role = $${values.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM users u ${where}`, values);
    const total = countResult.rows[0]?.total || 0;

    const listValues = [...values, limit, offset];
    const rows = await db.query(
      `SELECT
        u.id,
        u.first_name,
        u.last_name,
        u.phone,
        u.email,
        u.role,
        u.status,
        u.phone_verified,
        u.last_login_at,
        u.created_at,
        COALESCE(p.listings_count, 0) AS listings_count,
        COALESCE(i.inquiries_count, 0) AS inquiries_count
      FROM users u
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS listings_count
        FROM properties p
        WHERE p.lister_phone = u.phone
      ) p ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS inquiries_count
        FROM property_inquiries i
        WHERE i.contact_phone = u.phone OR i.contact_email = u.email
      ) i ON true
      ${where}
      ORDER BY u.created_at DESC
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

router.get('/users/:id', async (req, res, next) => {
  try {
    const user = await db.query(
      `SELECT id, first_name, last_name, phone, email, role, status, phone_verified, last_login_at, created_at, updated_at
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [req.params.id]
    );

    if (!user.rows.length) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const [listings, inquiries] = await Promise.all([
      db.query(
        `SELECT id, title, listing_type, district, area, status, created_at
         FROM properties
         WHERE lister_phone = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [user.rows[0].phone]
      ),
      db.query(
        `SELECT id, property_id, message, channel, created_at
         FROM property_inquiries
         WHERE contact_phone = $1 OR contact_email = $2
         ORDER BY created_at DESC
         LIMIT 100`,
        [user.rows[0].phone, user.rows[0].email]
      )
    ]);

    return res.json({
      ok: true,
      data: {
        ...user.rows[0],
        listings: listings.rows,
        inquiries: inquiries.rows
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/users/:id', async (req, res, next) => {
  try {
    const status = req.body.status ? String(req.body.status).trim().toLowerCase() : undefined;
    const role = req.body.role ? String(req.body.role).trim().toLowerCase() : undefined;
    const phoneVerified = typeof req.body.phone_verified === 'boolean' ? req.body.phone_verified : undefined;

    const allowedStatuses = ['active', 'suspended', 'deleted'];
    const allowedRoles = ['buyer_renter', 'property_owner', 'agent_broker', 'field_agent', 'admin'];

    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: 'Invalid status value' });
    }
    if (role && !allowedRoles.includes(role)) {
      return res.status(400).json({ ok: false, error: 'Invalid role value' });
    }
    if (status === undefined && role === undefined && phoneVerified === undefined) {
      return res.status(400).json({ ok: false, error: 'No supported fields to update' });
    }

    const setParts = [];
    const values = [req.params.id];
    let idx = 2;

    if (status !== undefined) {
      setParts.push(`status = $${idx}`);
      values.push(status);
      idx += 1;
    }
    if (role !== undefined) {
      setParts.push(`role = $${idx}`);
      values.push(role);
      idx += 1;
    }
    if (phoneVerified !== undefined) {
      setParts.push(`phone_verified = $${idx}`);
      values.push(phoneVerified);
      idx += 1;
    }

    const updated = await db.query(
      `UPDATE users
       SET ${setParts.join(', ')}
       WHERE id = $1
       RETURNING id, first_name, last_name, phone, email, role, status, phone_verified, updated_at`,
      values
    );

    if (!updated.rows.length) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    await writeAudit('admin_user_updated', {
      user_id: req.params.id,
      status: status || null,
      role: role || null,
      phone_verified: phoneVerified
    });

    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/agents', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const status = String(req.query.status || '').trim().toLowerCase();
    const search = String(req.query.search || '').trim().toLowerCase();

    const filters = [];
    const values = [];

    if (status) {
      values.push(status);
      filters.push(`a.status = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      filters.push(`(
        a.full_name ILIKE $${values.length}
        OR COALESCE(a.company_name, '') ILIKE $${values.length}
        OR COALESCE(a.email, '') ILIKE $${values.length}
        OR a.phone ILIKE $${values.length}
      )`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM agents a ${where}`, values);
    const total = countResult.rows[0]?.total || 0;

    const listValues = [...values, limit, offset];
    const rows = await db.query(
      `SELECT
        a.id,
        a.full_name,
        a.company_name,
        a.phone,
        a.email,
        a.licence_number,
        a.registration_status,
        a.status,
        a.created_at,
        a.updated_at
      FROM agents a
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

router.patch('/agents/:id/status', async (req, res, next) => {
  try {
    const status = String(req.body.status || '').trim().toLowerCase();
    const allowedStatuses = ['pending', 'approved', 'rejected', 'suspended'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: 'Invalid status value' });
    }

    const updated = await db.query(
      `UPDATE agents
       SET status = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, full_name, company_name, status, updated_at`,
      [req.params.id, status]
    );

    if (!updated.rows.length) {
      return res.status(404).json({ ok: false, error: 'Agent not found' });
    }

    await writeAudit('admin_agent_status_updated', {
      agent_id: req.params.id,
      status
    });

    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/reports', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const status = String(req.query.status || '').trim().toLowerCase();
    const search = String(req.query.search || '').trim().toLowerCase();

    const filters = [];
    const values = [];

    if (status) {
      values.push(status);
      filters.push(`r.status = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      filters.push(`(
        r.property_reference ILIKE $${values.length}
        OR r.reason ILIKE $${values.length}
        OR COALESCE(r.details, '') ILIKE $${values.length}
      )`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM report_listings r ${where}`, values);
    const total = countResult.rows[0]?.total || 0;

    const listValues = [...values, limit, offset];
    const rows = await db.query(
      `SELECT
        r.id,
        r.property_reference,
        r.reason,
        r.details,
        r.reporter_contact,
        r.status,
        r.created_at,
        r.updated_at
      FROM report_listings r
      ${where}
      ORDER BY r.created_at DESC
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

router.patch('/reports/:id/status', async (req, res, next) => {
  try {
    const status = String(req.body.status || '').trim().toLowerCase();
    const resolutionNote = String(req.body.resolution_note || '').trim();
    const allowedStatuses = ['open', 'in_review', 'resolved', 'dismissed'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: 'Invalid status value' });
    }

    const updated = await db.query(
      `UPDATE report_listings
       SET
         status = $2,
         details = CASE
           WHEN $3::text = '' THEN details
           ELSE CONCAT(COALESCE(details, ''), CASE WHEN COALESCE(details, '') = '' THEN '' ELSE E'\n\n' END, 'Admin note: ', $3::text)
         END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, property_reference, reason, details, reporter_contact, status, updated_at`,
      [req.params.id, status, resolutionNote]
    );

    if (!updated.rows.length) {
      return res.status(404).json({ ok: false, error: 'Report not found' });
    }

    await writeAudit('admin_report_status_updated', {
      report_id: req.params.id,
      status,
      resolution_note: resolutionNote || null
    });

    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/whatsapp/insights', async (req, res, next) => {
  try {
    const [
      msgCounts,
      activeUsers,
      optIn,
      queueCounts,
      topIntents,
      transcriptionCounts
    ] = await Promise.all([
      db.query(
        `SELECT
          COUNT(*) FILTER (WHERE direction = 'inbound')::int AS inbound,
          COUNT(*) FILTER (WHERE direction = 'outbound')::int AS outbound,
          COUNT(*)::int AS total
         FROM whatsapp_messages`
      ),
      db.query(
        `SELECT
          COUNT(DISTINCT user_phone)::int AS active_7d
         FROM whatsapp_messages
         WHERE created_at >= NOW() - INTERVAL '7 days'`
      ),
      db.query(
        `SELECT
          COUNT(*) FILTER (WHERE marketing_opt_in = TRUE)::int AS opted_in,
          COUNT(*) FILTER (WHERE marketing_opt_in = FALSE)::int AS opted_out
         FROM whatsapp_user_profiles`
      ),
      db.query(
        `SELECT
          COUNT(*) FILTER (WHERE status IN ('pending','retry'))::int AS pending,
          COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM outbound_message_queue
         WHERE channel = 'whatsapp'`
      ),
      db.query(
        `SELECT detected_intent, COUNT(*)::int AS total
         FROM whatsapp_intent_logs
         WHERE created_at >= NOW() - INTERVAL '14 days'
         GROUP BY detected_intent
         ORDER BY total DESC
         LIMIT 10`
      ),
      db.query(
        `SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS last_7d
         FROM transcriptions`
      )
    ]);

    return res.json({
      ok: true,
      data: {
        messages: msgCounts.rows[0],
        activeUsers: activeUsers.rows[0],
        optIn: optIn.rows[0],
        queue: queueCounts.rows[0],
        topIntents: topIntents.rows,
        transcriptions: transcriptionCounts.rows[0]
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/whatsapp/messages', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const direction = String(req.query.direction || '').trim().toLowerCase();
    const phone = String(req.query.phone || '').trim();
    const type = String(req.query.type || '').trim().toLowerCase();

    const filters = [];
    const values = [];

    if (direction) {
      values.push(direction);
      filters.push(`direction = $${values.length}`);
    }
    if (phone) {
      values.push(`%${phone}%`);
      filters.push(`user_phone ILIKE $${values.length}`);
    }
    if (type) {
      values.push(type);
      filters.push(`message_type = $${values.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM whatsapp_messages ${where}`, values);
    const total = countResult.rows[0]?.total || 0;

    const listValues = [...values, limit, offset];
    const rows = await db.query(
      `SELECT id, user_phone, wa_message_id, direction, message_type, payload, created_at
       FROM whatsapp_messages
       ${where}
       ORDER BY created_at DESC
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

router.get('/whatsapp/intents', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const phone = String(req.query.phone || '').trim();
    const intent = String(req.query.intent || '').trim().toLowerCase();

    const filters = [];
    const values = [];

    if (phone) {
      values.push(`%${phone}%`);
      filters.push(`user_phone ILIKE $${values.length}`);
    }
    if (intent) {
      values.push(intent);
      filters.push(`detected_intent = $${values.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM whatsapp_intent_logs ${where}`, values);
    const total = countResult.rows[0]?.total || 0;

    const listValues = [...values, limit, offset];
    const rows = await db.query(
      `SELECT id, user_phone, wa_message_id, detected_intent, confidence, language, current_step, raw_text, transcript, entities, model_used, created_at
       FROM whatsapp_intent_logs
       ${where}
       ORDER BY created_at DESC
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

router.get('/campaigns', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const status = String(req.query.status || '').trim().toLowerCase();

    const values = [];
    const where = status ? `WHERE status = $1` : '';
    if (status) values.push(status);

    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM marketing_campaigns ${where}`, values);
    const total = countResult.rows[0]?.total || 0;

    const listValues = [...values, limit, offset];
    const rows = await db.query(
      `SELECT
        c.*,
        COALESCE(q.total_recipients, 0) AS total_recipients,
        COALESCE(q.sent_count, 0) AS sent_count,
        COALESCE(q.pending_count, 0) AS pending_count,
        COALESCE(q.failed_count, 0) AS failed_count
       FROM marketing_campaigns c
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS total_recipients,
           COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count,
           COUNT(*) FILTER (WHERE status IN ('pending','retry'))::int AS pending_count,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count
         FROM outbound_message_queue q
         WHERE q.campaign_id = c.id
       ) q ON true
       ${where}
       ORDER BY c.created_at DESC
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

async function loadCampaign(campaignId) {
  const campaignResult = await db.query(
    `SELECT *
     FROM marketing_campaigns
     WHERE id = $1
     LIMIT 1`,
    [campaignId]
  );
  return campaignResult.rows[0] || null;
}

function getCampaignTargetFilter(campaign = {}) {
  return campaign.target_filter && typeof campaign.target_filter === 'object'
    ? campaign.target_filter
    : {};
}

async function queueCampaignRecipients({ campaign, limit = 2000 } = {}) {
  if (!campaign) {
    const error = new Error('Campaign not found');
    error.status = 404;
    throw error;
  }
  if (campaign.channel !== 'whatsapp') {
    const error = new Error('Only whatsapp channel queueing is currently supported');
    error.status = 400;
    throw error;
  }
  if (campaign.status === 'cancelled') {
    const error = new Error('Cancelled campaigns cannot be set live');
    error.status = 400;
    throw error;
  }
  if (!String(campaign.message_template || '').trim()) {
    const error = new Error('Campaign message is empty');
    error.status = 400;
    throw error;
  }

  const normalizedLimit = Math.max(1, Math.min(parseInt(limit, 10) || 2000, 20000));
  const filter = getCampaignTargetFilter(campaign);
  const languageFilter = Array.isArray(filter.languages)
    ? filter.languages.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const sinceDays = Math.max(0, parseInt(filter.active_within_days, 10) || 0);
  const minSeenAtClause = sinceDays > 0 ? `AND p.last_seen_at >= NOW() - ($2::text || ' days')::interval` : '';

  const profileValues = [normalizedLimit];
  if (sinceDays > 0) profileValues.push(String(sinceDays));

  const profiles = await db.query(
    `SELECT p.phone, p.preferred_language, p.marketing_opt_in
     FROM whatsapp_user_profiles p
     WHERE p.marketing_opt_in = TRUE
     ${minSeenAtClause}
     ORDER BY p.last_seen_at DESC
     LIMIT $1`,
    profileValues
  );

  let eligibleCount = 0;
  let insertedCount = 0;
  let skippedDuplicateCount = 0;
  for (const profile of profiles.rows) {
    const preferredLanguage = String(profile.preferred_language || '').toLowerCase();
    if (languageFilter.length && !languageFilter.includes(preferredLanguage)) {
      continue;
    }

    eligibleCount += 1;
    const inserted = await db.query(
      `INSERT INTO outbound_message_queue
        (user_phone, payload, status, attempts, next_attempt_at, campaign_id, channel, user_consent_snapshot, metadata)
       SELECT $1, $2::jsonb, 'pending', 0, NOW(), $3, 'whatsapp', TRUE, $4::jsonb
       WHERE NOT EXISTS (
         SELECT 1
         FROM outbound_message_queue q
         WHERE q.campaign_id = $3
           AND q.user_phone = $1
           AND q.status IN ('pending','retry','sent')
       )
       RETURNING id`,
      [
        profile.phone,
        JSON.stringify({
          text: campaign.message_template
        }),
        campaign.id,
        JSON.stringify({
          source: 'admin_campaign_queue',
          preferred_language: profile.preferred_language || 'en'
        })
      ]
    );
    if (inserted.rows.length) insertedCount += 1;
    else skippedDuplicateCount += 1;
  }

  const updated = await db.query(
    `UPDATE marketing_campaigns
     SET status = 'queued',
         queued_at = COALESCE(queued_at, NOW()),
         updated_at = NOW()
     WHERE id = $1
       AND status <> 'cancelled'
     RETURNING id, status, queued_at, sent_at, updated_at`,
    [campaign.id]
  );

  return {
    campaign: updated.rows[0] || campaign,
    eligible_recipients: eligibleCount,
    queued_recipients: insertedCount,
    skipped_duplicate_recipients: skippedDuplicateCount,
    requested_limit: normalizedLimit
  };
}

router.post('/campaigns/draft', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const objective = String(req.body.objective || '').trim();
    const audience = String(req.body.audience || '').trim();
    const language = String(req.body.language || 'English').trim();
    const channel = String(req.body.channel || 'whatsapp').trim().toLowerCase();
    const targetFilter = req.body.target_filter && typeof req.body.target_filter === 'object'
      ? req.body.target_filter
      : {};

    if (!name) {
      return res.status(400).json({ ok: false, error: 'name is required' });
    }
    if (!['whatsapp', 'sms', 'email'].includes(channel)) {
      return res.status(400).json({ ok: false, error: 'channel must be whatsapp, sms, or email' });
    }

    const generated = await generateCampaignCopy({
      objective,
      audience,
      language,
      channel
    });

    const inserted = await db.query(
      `INSERT INTO marketing_campaigns
        (name, channel, objective, message_template, target_filter, status, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'draft', $6)
       RETURNING *`,
      [
        name,
        channel,
        objective || null,
        generated.text,
        JSON.stringify(targetFilter),
        req.ip || 'admin_api_key'
      ]
    );

    await writeAudit('campaign_draft_created', {
      campaign_id: inserted.rows[0].id,
      channel,
      objective,
      model: generated.model
    });

    return res.status(201).json({
      ok: true,
      data: {
        ...inserted.rows[0],
        generated_by_model: generated.model
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/campaigns/:id/queue', async (req, res, next) => {
  try {
    const campaignId = req.params.id;
    const limit = Math.max(1, Math.min(parseInt(req.body.limit, 10) || 2000, 20000));

    const campaign = await loadCampaign(campaignId);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: 'Campaign not found' });
    }
    const queued = await queueCampaignRecipients({ campaign, limit });

    await writeAudit('campaign_queued', {
      campaign_id: campaign.id,
      eligible_recipients: queued.eligible_recipients,
      queued_recipients: queued.queued_recipients,
      skipped_duplicate_recipients: queued.skipped_duplicate_recipients,
      requested_limit: limit
    });

    return res.json({
      ok: true,
      data: {
        campaign_id: campaign.id,
        status: queued.campaign.status,
        queued_at: queued.campaign.queued_at,
        eligible_recipients: queued.eligible_recipients,
        queued_recipients: queued.queued_recipients,
        skipped_duplicate_recipients: queued.skipped_duplicate_recipients,
        requested_limit: queued.requested_limit
      }
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ ok: false, error: error.message });
    }
    return next(error);
  }
});

router.post('/campaigns/:id/live', async (req, res, next) => {
  try {
    const campaignId = req.params.id;
    const campaign = await loadCampaign(campaignId);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: 'Campaign not found' });
    }

    const limit = Math.max(1, Math.min(parseInt(req.body.limit, 10) || 2000, 20000));
    const maxAttempts = Math.max(1, Math.min(parseInt(req.body.max_attempts, 10) || 4, 10));
    const queued = await queueCampaignRecipients({ campaign, limit });
    const processLimit = Math.max(1, Math.min(parseInt(req.body.process_limit, 10) || Math.max(queued.queued_recipients, 100), 500));
    const processing = queued.queued_recipients > 0
      ? await processPendingCampaignQueue({ limit: processLimit, maxAttempts, campaignId: campaign.id })
      : { processed: 0, sent: 0, failed: 0, retried: 0, campaigns: [] };
    const status = await refreshCampaignStatus(campaign.id);

    await writeAudit('campaign_set_live', {
      campaign_id: campaign.id,
      eligible_recipients: queued.eligible_recipients,
      queued_recipients: queued.queued_recipients,
      skipped_duplicate_recipients: queued.skipped_duplicate_recipients,
      processing
    });

    return res.json({
      ok: true,
      data: {
        campaign_id: campaign.id,
        status: status?.status || queued.campaign.status,
        queued_at: status?.queued_at || queued.campaign.queued_at,
        sent_at: status?.sent_at || queued.campaign.sent_at || null,
        eligible_recipients: queued.eligible_recipients,
        queued_recipients: queued.queued_recipients,
        skipped_duplicate_recipients: queued.skipped_duplicate_recipients,
        processing,
        total_recipients: status?.total_recipients ?? queued.eligible_recipients,
        pending_count: status?.pending_count ?? 0,
        sent_count: status?.sent_count ?? 0,
        failed_count: status?.failed_count ?? 0
      }
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ ok: false, error: error.message });
    }
    return next(error);
  }
});

router.patch('/campaigns/:id/status', async (req, res, next) => {
  try {
    const campaignId = req.params.id;
    const requestedStatus = String(req.body.status || '').trim().toLowerCase();
    const campaign = await loadCampaign(campaignId);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: 'Campaign not found' });
    }

    if (['live', 'active', 'queued'].includes(requestedStatus)) {
      const limit = Math.max(1, Math.min(parseInt(req.body.limit, 10) || 2000, 20000));
      const queued = await queueCampaignRecipients({ campaign, limit });
      await writeAudit('campaign_status_set_live', {
        campaign_id: campaign.id,
        requested_status: requestedStatus,
        eligible_recipients: queued.eligible_recipients,
        queued_recipients: queued.queued_recipients,
        skipped_duplicate_recipients: queued.skipped_duplicate_recipients
      });
      return res.json({
        ok: true,
        data: {
          campaign_id: campaign.id,
          status: queued.campaign.status,
          queued_at: queued.campaign.queued_at,
          eligible_recipients: queued.eligible_recipients,
          queued_recipients: queued.queued_recipients,
          skipped_duplicate_recipients: queued.skipped_duplicate_recipients
        }
      });
    }

    if (requestedStatus === 'cancelled' || requestedStatus === 'canceled') {
      const updated = await db.query(
        `UPDATE marketing_campaigns
         SET status = 'cancelled',
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, status, updated_at`,
        [campaign.id]
      );
      await db.query(
        `UPDATE outbound_message_queue
         SET status = 'failed',
             last_error = 'cancelled_by_admin',
             updated_at = NOW()
         WHERE campaign_id = $1
           AND status IN ('pending','retry')`,
        [campaign.id]
      );
      await writeAudit('campaign_status_cancelled', { campaign_id: campaign.id });
      return res.json({ ok: true, data: updated.rows[0] });
    }

    if (!['draft', 'queued', 'sending', 'sent'].includes(requestedStatus)) {
      return res.status(400).json({ ok: false, error: 'Unsupported campaign status' });
    }

    const updated = await db.query(
      `UPDATE marketing_campaigns
       SET status = $2,
           updated_at = NOW()
       WHERE id = $1
         AND status <> 'cancelled'
       RETURNING id, status, queued_at, sent_at, updated_at`,
      [campaign.id, requestedStatus]
    );
    await writeAudit('campaign_status_updated', {
      campaign_id: campaign.id,
      requested_status: requestedStatus
    });
    return res.json({ ok: true, data: updated.rows[0] || null });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ ok: false, error: error.message });
    }
    return next(error);
  }
});

router.post('/campaigns/process-queue', async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.body.limit, 10) || 100, 500));
    const maxAttempts = Math.max(1, Math.min(parseInt(req.body.max_attempts, 10) || 4, 10));
    const result = await processPendingCampaignQueue({ limit, maxAttempts });

    await writeAudit('campaign_queue_processed', {
      limit,
      max_attempts: maxAttempts,
      result
    });

    return res.json({
      ok: true,
      data: result
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/campaigns/:id/cancel', async (req, res, next) => {
  try {
    const campaignId = req.params.id;
    const updated = await db.query(
      `UPDATE marketing_campaigns
       SET status = 'cancelled',
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, status, updated_at`,
      [campaignId]
    );
    if (!updated.rows.length) {
      return res.status(404).json({ ok: false, error: 'Campaign not found' });
    }

    await db.query(
      `UPDATE outbound_message_queue
       SET status = 'failed',
           last_error = 'cancelled_by_admin',
           updated_at = NOW()
       WHERE campaign_id = $1
         AND status IN ('pending','retry')`,
      [campaignId]
    );

    await writeAudit('campaign_cancelled', { campaign_id: campaignId });

    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
