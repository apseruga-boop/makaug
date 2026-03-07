const express = require('express');

const db = require('../config/database');
const { cleanText, toNullableInt, isValidEmail, isValidPhone } = require('../middleware/validation');

const router = express.Router();

async function handleReportListing(req, res, next) {
  try {
    const propertyReference = cleanText(req.body.property_reference || req.body.property_url);
    const reason = cleanText(req.body.reason);

    if (!propertyReference || !reason) {
      return res.status(400).json({
        ok: false,
        error: 'property_reference and reason are required'
      });
    }

    const result = await db.query(
      `INSERT INTO report_listings (
        property_reference,
        reason,
        details,
        reporter_contact,
        status
      ) VALUES ($1,$2,$3,$4,'open')
      RETURNING id, status, created_at`,
      [
        propertyReference,
        reason,
        cleanText(req.body.details) || null,
        cleanText(req.body.reporter_contact || req.body.contact) || null
      ]
    );

    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
}

async function handleLookingForProperty(req, res, next) {
  try {
    const fullName = cleanText(req.body.name);
    const phone = cleanText(req.body.phone);
    const email = cleanText(req.body.email);
    const requirements = cleanText(req.body.requirements || req.body.description);

    const errors = [];
    if (!fullName) errors.push('name is required');
    if (!phone) errors.push('phone is required');
    if (!requirements) errors.push('requirements are required');
    if (phone && !isValidPhone(phone)) errors.push('phone is invalid');
    if (email && !isValidEmail(email)) errors.push('email is invalid');

    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });
    }

    const inserted = await db.query(
      `INSERT INTO property_requests (
        full_name,
        phone,
        email,
        preferred_locations,
        listing_type,
        max_budget,
        requirements
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id, created_at`,
      [
        fullName,
        phone,
        email || null,
        cleanText(req.body.preferred_locations) || null,
        cleanText(req.body.listing_type) || null,
        toNullableInt(req.body.max_budget),
        requirements
      ]
    );

    return res.status(201).json({ ok: true, data: inserted.rows[0] });
  } catch (error) {
    return next(error);
  }
}

router.post('/report-listing', handleReportListing);
router.post('/report', handleReportListing);
router.post('/looking-for-property', handleLookingForProperty);
router.post('/looking', handleLookingForProperty);

module.exports = router;
