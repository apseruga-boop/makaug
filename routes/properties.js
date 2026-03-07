const express = require('express');

const db = require('../config/database');
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
    const district = cleanText(req.query.district);
    const area = cleanText(req.query.area || req.query.search);
    const status = cleanText(req.query.status || 'approved').toLowerCase();
    const minPrice = toNullableInt(req.query.min_price);
    const maxPrice = toNullableInt(req.query.max_price);
    const minBeds = toNullableInt(req.query.min_beds);
    const maxBeds = toNullableInt(req.query.max_beds);
    const propertyType = cleanText(req.query.property_type);

    if (listingType && LISTING_TYPES.includes(listingType)) {
      addFilter(filters, values, 'p.listing_type = ?', listingType);
    }

    if (district) {
      addFilter(filters, values, 'p.district = ?', district);
    }

    if (area) {
      addFilter(
        filters,
        values,
        '(p.area ILIKE ? OR p.title ILIKE ? OR p.district ILIKE ?)',
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
        p.amenities,
        img.url AS primary_image_url,
        CASE
          WHEN p.agent_id IS NOT NULL OR p.lister_type = 'agent' THEN 'agent'
          ELSE 'private'
        END AS listed_by
      FROM properties p
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
        a.email AS agent_email
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
    const listerPhone = cleanText(body.lister_phone);

    if (listerEmail && !isValidEmail(listerEmail)) errors.push('lister_email is invalid');
    if (listerPhone && !isValidPhone(listerPhone)) errors.push('lister_phone is invalid');

    const status = cleanText(body.status || 'pending').toLowerCase();
    if (!PROPERTY_STATUSES.includes(status)) {
      errors.push('status is invalid');
    }

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
        $31,$32,$33,$34,$35,$36
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
        JSON.stringify(amenities),
        JSON.stringify(extraFields),
        cleanText(body.lister_name) || null,
        listerPhone || null,
        listerEmail || null,
        cleanText(body.lister_type) || 'owner',
        cleanText(body.listed_via) || 'website',
        cleanText(body.source) || 'website',
        status,
        body.expires_at ? new Date(body.expires_at) : null
      ]
    );

    const propertyId = insertResult.rows[0].id;

    const imageUrls = asArray(body.images)
      .map((item) => (typeof item === 'string' ? item : item?.url))
      .map((url) => cleanText(url))
      .filter(Boolean)
      .slice(0, 20);

    for (let i = 0; i < imageUrls.length; i += 1) {
      await db.query(
        `INSERT INTO property_images (property_id, url, is_primary, sort_order)
         VALUES ($1, $2, $3, $4)`,
        [propertyId, imageUrls[i], i === 0, i]
      );
    }

    return res.status(201).json({
      ok: true,
      data: {
        id: propertyId,
        status,
        imagesUploaded: imageUrls.length
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

    if (!PROPERTY_STATUSES.includes(nextStatus)) {
      return res.status(400).json({ ok: false, error: 'Invalid status value' });
    }

    const result = await db.query(
      `UPDATE properties
       SET status = $2, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $1
       RETURNING id, status, reviewed_at`,
      [req.params.id, nextStatus]
    );

    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    return res.json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
