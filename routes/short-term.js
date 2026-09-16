'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const db = require('../config/database');
const logger = require('../config/logger');
const { requireStaffAccess } = require('../middleware/auth');
const {
  shortTermEnabled,
  shortTermIntakeEnabled,
  shortTermReviewsEnabled
} = require('../utils/shortTermFeatureFlags');
const {
  AMENITY_CATALOGUE,
  CANCELLATION_POLICIES,
  LISTING_FEE_UGX,
  LISTING_TERM_MONTHS,
  PAYMENT_METHODS,
  PLACE_TYPES,
  SHORT_TERM_MARKER,
  createShortTermListing,
  formatUgx,
  getShortTermListing,
  isStayAvailable,
  listPublishedReviews,
  loadShortTermPublicCount,
  quoteStay,
  recordShortTermLead,
  reportShortTermListing,
  searchShortTermListings,
  submitShortTermReview
} = require('../services/shortTermService');
const {
  MAX_IMAGES_PER_LISTING,
  MAX_UPLOAD_BYTES,
  MAX_EDGE_PX,
  ALLOWED_MIME_TYPES,
  attachListingPhoto,
  createUploadToken,
  listListingPhotos,
  photoUploadReady
} = require('../services/shortTermMediaService');

const router = express.Router();

// ---------------------------------------------------------------------------
// The flag guard sits in front of every route in this file.
//
// With SHORT_TERM_ENABLED unset or false the whole section answers 404, exactly
// as it did before this code existed. That is the rollback: one env var, no
// redeploy of anything else, no migration reversed.
// ---------------------------------------------------------------------------

router.use((req, res, next) => {
  if (!shortTermEnabled()) {
    res.set('X-makaug-Short-Term', 'disabled');
    return res.status(404).json({ ok: false, error: 'Not found' });
  }
  res.set('X-makaug-Short-Term', SHORT_TERM_MARKER);
  return next();
});

// Public writes get their own tighter budget on top of the site-wide /api
// limiter, so a script cannot fill a host's enquiry list or a listing's
// review wall.
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many submissions. Try again in a few minutes.' }
});

const intakeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many listing submissions from this connection. Try again later.' }
});

function fail(res, error, fallbackMessage) {
  const status = Number(error?.status) || 500;
  if (status >= 500) {
    logger.error('Short term request failed', {
      marker: SHORT_TERM_MARKER,
      message: error?.message,
      code: error?.code
    });
  }
  return res.status(status).json({
    ok: false,
    error: status >= 500 ? fallbackMessage : (error?.message || fallbackMessage),
    details: Array.isArray(error?.details) ? error.details : undefined
  });
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

// ---------------------------------------------------------------------------
// Reference data. This is what the listing wizard and the filter bar read.
// ---------------------------------------------------------------------------

router.get('/meta', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  return res.json({
    ok: true,
    marker: SHORT_TERM_MARKER,
    amenities: AMENITY_CATALOGUE,
    place_types: PLACE_TYPES,
    cancellation_policies: CANCELLATION_POLICIES,
    payment_methods: PAYMENT_METHODS,
    intake_open: shortTermIntakeEnabled(),
    reviews_open: shortTermReviewsEnabled(),
    photos: {
      ready: photoUploadReady(),
      max_per_listing: MAX_IMAGES_PER_LISTING,
      max_bytes: MAX_UPLOAD_BYTES,
      max_edge_px: MAX_EDGE_PX,
      accepted: ALLOWED_MIME_TYPES,
      // Said out loud because hosts photograph their own front door: the
      // location baked into a phone photo is removed before anything is
      // published.
      note: 'Photos are resized and re-encoded on upload, which removes the location data a phone stores inside them.'
    },
    fee: {
      amount_ugx: LISTING_FEE_UGX,
      display: formatUgx(LISTING_FEE_UGX),
      term_months: LISTING_TERM_MONTHS,
      // Stated on the API as well as the page, because this is the single
      // fact that keeps makaug out of the transaction.
      basis: 'Flat listing fee. makaug charges no commission on any stay and never handles guest money.'
    }
  });
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

router.get('/search', async (req, res) => {
  try {
    const result = await searchShortTermListings(db, req.query || {});
    res.set('Cache-Control', 'public, max-age=60');
    res.set('X-makaug-Short-Term-Results', String(result.listings.length));
    return res.json({ ok: true, ...result });
  } catch (error) {
    return fail(res, error, 'Short term search is unavailable');
  }
});

// Pins for the map. Deliberately thin: the map only needs a point, a price and
// a way through to the listing.
router.get('/map', async (req, res) => {
  try {
    const result = await searchShortTermListings(db, { ...(req.query || {}), limit: 48 });
    const pins = result.listings
      .filter((listing) => Number.isFinite(listing.latitude) && Number.isFinite(listing.longitude))
      .map((listing) => ({
        id: listing.id,
        slug: listing.slug,
        title: listing.title,
        url: listing.url,
        latitude: listing.latitude,
        longitude: listing.longitude,
        nightly_ugx: listing.nightly_ugx,
        nightly_display: listing.nightly_display,
        primary_image: listing.primary_image,
        review_count: listing.review_count,
        review_average: listing.review_average
      }));
    res.set('Cache-Control', 'public, max-age=60');
    return res.json({ ok: true, pins, total: result.total, marker: SHORT_TERM_MARKER });
  } catch (error) {
    return fail(res, error, 'Short term map is unavailable');
  }
});

// What short term contributes to the site-wide property total.
router.get('/summary', async (_req, res) => {
  try {
    const total = await loadShortTermPublicCount(db);
    res.set('Cache-Control', 'public, max-age=60');
    return res.json({
      ok: true,
      marker: SHORT_TERM_MARKER,
      short_term_total: total,
      counts_towards_site_total: true
    });
  } catch (error) {
    return fail(res, error, 'Short term summary is unavailable');
  }
});

// ---------------------------------------------------------------------------
// One listing
// ---------------------------------------------------------------------------

router.get('/listings/:slug', async (req, res) => {
  try {
    const listing = await getShortTermListing(db, req.params.slug);
    if (!listing) return res.status(404).json({ ok: false, error: 'Listing not found' });

    const quote = quoteStay(listing, {
      checkIn: req.query.check_in,
      checkOut: req.query.check_out,
      guests: req.query.guests
    });
    const availability = isStayAvailable(
      listing.availability,
      req.query.check_in,
      req.query.check_out
    );

    const reviews = shortTermReviewsEnabled()
      ? await listPublishedReviews(db, listing.id)
      : [];

    db.query('UPDATE st_listing SET view_count = view_count + 1 WHERE id = $1::uuid', [listing.id])
      .catch(() => null);

    res.set('Cache-Control', 'public, max-age=60');
    return res.json({
      ok: true,
      marker: SHORT_TERM_MARKER,
      listing,
      quote,
      availability,
      reviews,
      reviews_open: shortTermReviewsEnabled()
    });
  } catch (error) {
    return fail(res, error, 'Listing is unavailable');
  }
});

// ---------------------------------------------------------------------------
// Guest enquiry
//
// The response hands back the host's own phone and WhatsApp link. makaug does
// not relay the message, does not follow it up, and never reports back whether
// the host replied. Discovery, not brokerage.
// ---------------------------------------------------------------------------

router.post('/listings/:id/enquiries', writeLimiter, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ ok: false, error: 'Unknown listing' });
    }
    const listing = await getShortTermListing(db, req.params.id);
    if (!listing) return res.status(404).json({ ok: false, error: 'Listing not found' });

    const lead = await recordShortTermLead(db, listing.id, req.body || {});

    return res.status(201).json({
      ok: true,
      marker: SHORT_TERM_MARKER,
      enquiry: lead,
      contact: listing.contact,
      host_name: listing.host_name,
      next_step: 'Contact the host directly using the details above. makaug does not pass messages on, take bookings or hold any money.'
    });
  } catch (error) {
    return fail(res, error, 'Enquiry could not be recorded');
  }
});

// ---------------------------------------------------------------------------
// Reviews and scores under a privately listed place
// ---------------------------------------------------------------------------

router.get('/listings/:id/reviews', async (req, res) => {
  try {
    if (!shortTermReviewsEnabled()) return res.json({ ok: true, reviews: [], reviews_open: false });
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ ok: false, error: 'Unknown listing' });
    }
    const reviews = await listPublishedReviews(db, req.params.id, req.query.limit);
    res.set('Cache-Control', 'public, max-age=120');
    return res.json({ ok: true, reviews, reviews_open: true, marker: SHORT_TERM_MARKER });
  } catch (error) {
    return fail(res, error, 'Reviews are unavailable');
  }
});

router.post('/listings/:id/reviews', writeLimiter, async (req, res) => {
  try {
    if (!shortTermReviewsEnabled()) {
      return res.status(404).json({ ok: false, error: 'Reviews are not open' });
    }
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ ok: false, error: 'Unknown listing' });
    }
    const listing = await getShortTermListing(db, req.params.id);
    if (!listing) return res.status(404).json({ ok: false, error: 'Listing not found' });

    const review = await submitShortTermReview(db, listing.id, req.body || {});
    return res.status(201).json({
      ok: true,
      marker: SHORT_TERM_MARKER,
      review,
      message: 'Thanks. Your review goes to a moderator before it appears under this place.'
    });
  } catch (error) {
    return fail(res, error, 'Review could not be saved');
  }
});

router.post('/listings/:id/reports', writeLimiter, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ ok: false, error: 'Unknown listing' });
    }
    const listing = await getShortTermListing(db, req.params.id);
    if (!listing) return res.status(404).json({ ok: false, error: 'Listing not found' });

    const report = await reportShortTermListing(db, listing.id, req.body || {});
    return res.status(201).json({ ok: true, report, marker: SHORT_TERM_MARKER });
  } catch (error) {
    return fail(res, error, 'Report could not be saved');
  }
});

// ---------------------------------------------------------------------------
// Host intake
// ---------------------------------------------------------------------------

router.post('/listings', intakeLimiter, async (req, res) => {
  try {
    if (!shortTermIntakeEnabled()) {
      return res.status(503).json({
        ok: false,
        error: 'Short term listing submissions are not open yet'
      });
    }
    const created = await createShortTermListing(db, req.body || {}, {
      ip: req.ip,
      hostUserId: req.userAuth?.id || null
    });
    // Hosts list without an account on purpose - an account requirement is
    // what stops most Ugandan landlords listing at all. This signed, expiring
    // token is what lets them attach photos to the listing they just made,
    // without the listing id alone being enough for anyone else to.
    let uploadToken = null;
    try {
      uploadToken = createUploadToken(created.id);
    } catch (error) {
      logger.warn('Short term upload token could not be issued', {
        marker: SHORT_TERM_MARKER,
        message: error?.message
      });
    }
    return res.status(201).json({
      ok: true,
      marker: SHORT_TERM_MARKER,
      listing: created,
      upload_token: uploadToken,
      photos_ready: photoUploadReady(),
      next_step: `Your place is with our team for review. The listing fee is ${formatUgx(LISTING_FEE_UGX)} for ${LISTING_TERM_MONTHS} months, payable once the listing is approved. makaug takes no commission on any stay.`
    });
  } catch (error) {
    return fail(res, error, 'Listing could not be saved');
  }
});

// ---------------------------------------------------------------------------
// Listing photos
//
// One photo per request. A host on Kampala mobile data sees each photo land
// rather than staring at one large request that either all works or all fails.
// ---------------------------------------------------------------------------

const photoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many photo uploads from this connection. Try again later.' }
});

router.post('/listings/:id/photos', photoLimiter, async (req, res) => {
  try {
    if (!shortTermIntakeEnabled()) {
      return res.status(503).json({ ok: false, error: 'Short term listing submissions are not open yet' });
    }
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ ok: false, error: 'Unknown listing' });
    }
    const photo = await attachListingPhoto(db, req.params.id, {
      dataUrl: req.body?.data_url,
      caption: req.body?.caption,
      token: req.body?.upload_token
    });
    return res.status(201).json({ ok: true, marker: SHORT_TERM_MARKER, photo });
  } catch (error) {
    return fail(res, error, 'Photo could not be saved');
  }
});

router.get('/listings/:id/photos', async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ ok: false, error: 'Unknown listing' });
    }
    const photos = await listListingPhotos(db, req.params.id);
    res.set('Cache-Control', 'public, max-age=60');
    return res.json({ ok: true, photos, marker: SHORT_TERM_MARKER });
  } catch (error) {
    return fail(res, error, 'Photos are unavailable');
  }
});

// ---------------------------------------------------------------------------
// Staff review queue
// ---------------------------------------------------------------------------

router.get('/staff/queue', requireStaffAccess, async (req, res) => {
  try {
    const status = ['pending', 'approved', 'rejected', 'suspended', 'draft', 'expired']
      .includes(String(req.query.status || '').trim())
      ? String(req.query.status).trim()
      : 'pending';
    const result = await db.query(
      `SELECT l.id, l.reference, l.slug, l.title, l.district, l.area, l.status,
              l.base_nightly_ugx, l.host_name, l.host_phone, l.host_type,
              l.right_to_let_declared, l.right_to_let_reference,
              l.listing_fee_status, l.preferred_payment_method,
              l.listed_at, l.expires_at, l.created_at
       FROM st_listing l
       WHERE l.status = $1
       ORDER BY l.created_at DESC
       LIMIT 200`,
      [status]
    );
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, marker: SHORT_TERM_MARKER, status, listings: result.rows });
  } catch (error) {
    return fail(res, error, 'Short term queue is unavailable');
  }
});

router.post('/staff/listings/:id/decision', requireStaffAccess, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ ok: false, error: 'Unknown listing' });
    }
    const decision = String(req.body?.decision || '').trim();
    if (!['approve', 'reject', 'suspend'].includes(decision)) {
      return res.status(400).json({ ok: false, error: 'Decision must be approve, reject or suspend' });
    }
    const reason = String(req.body?.reason || '').trim().slice(0, 500) || null;

    if (decision === 'approve') {
      const result = await db.query(
        `UPDATE st_listing
         SET status = 'approved',
             reviewed_at = NOW(),
             rejection_reason = NULL,
             listed_at = COALESCE(listed_at, NOW()),
             expires_at = COALESCE(expires_at, NOW() + (listing_term_months || ' months')::interval)
         WHERE id = $1::uuid
         RETURNING id, status, listed_at, expires_at`,
        [req.params.id]
      );
      if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Listing not found' });
      logger.info('Short term listing approved', {
        marker: SHORT_TERM_MARKER,
        listingId: req.params.id,
        by: req.staffAuth?.userId
      });
      return res.json({ ok: true, listing: result.rows[0] });
    }

    const result = await db.query(
      `UPDATE st_listing
       SET status = $2, reviewed_at = NOW(), rejection_reason = $3
       WHERE id = $1::uuid
       RETURNING id, status, rejection_reason`,
      [req.params.id, decision === 'reject' ? 'rejected' : 'suspended', reason]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Listing not found' });
    return res.json({ ok: true, listing: result.rows[0] });
  } catch (error) {
    return fail(res, error, 'Decision could not be saved');
  }
});

router.post('/staff/listings/:id/payment', requireStaffAccess, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ ok: false, error: 'Unknown listing' });
    }
    const status = String(req.body?.status || '').trim();
    if (!['paid', 'pending', 'failed', 'refunded', 'waived'].includes(status)) {
      return res.status(400).json({ ok: false, error: 'Unsupported payment status' });
    }
    const method = String(req.body?.method || '').trim();
    const reference = String(req.body?.provider_reference || '').trim().slice(0, 200) || null;

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE st_listing_payment
         SET status = $2,
             provider_reference = COALESCE($3, provider_reference),
             method = COALESCE(NULLIF($4, ''), method),
             recorded_by = $5
         WHERE listing_id = $1::uuid`,
        [req.params.id, status, reference, method, req.staffAuth?.userId || 'staff']
      );
      const listingFeeStatus = status === 'paid' ? 'paid' : status === 'waived' ? 'waived' : 'pending';
      const updated = await client.query(
        `UPDATE st_listing
         SET listing_fee_status = $2,
             expires_at = CASE
               WHEN $2 IN ('paid','waived')
                 THEN COALESCE(listed_at, NOW()) + (listing_term_months || ' months')::interval
               ELSE expires_at
             END
         WHERE id = $1::uuid
         RETURNING id, listing_fee_status, expires_at`,
        [req.params.id, listingFeeStatus]
      );
      await client.query('COMMIT');
      if (!updated.rows.length) return res.status(404).json({ ok: false, error: 'Listing not found' });
      return res.json({ ok: true, listing: updated.rows[0] });
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return fail(res, error, 'Payment could not be recorded');
  }
});

router.get('/staff/listings/:id/leads', requireStaffAccess, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ ok: false, error: 'Unknown listing' });
    }
    const result = await db.query(
      `SELECT id, guest_name, guest_phone, guest_email, party_size,
              check_in, check_out, message, channel, created_at
       FROM st_lead WHERE listing_id = $1::uuid
       ORDER BY created_at DESC LIMIT 200`,
      [req.params.id]
    );
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, leads: result.rows, marker: SHORT_TERM_MARKER });
  } catch (error) {
    return fail(res, error, 'Enquiries are unavailable');
  }
});

router.get('/staff/reviews', requireStaffAccess, async (req, res) => {
  try {
    const status = ['pending', 'published', 'rejected'].includes(String(req.query.status || '').trim())
      ? String(req.query.status).trim()
      : 'pending';
    const result = await db.query(
      `SELECT r.id, r.listing_id, l.title AS listing_title, l.slug AS listing_slug,
              r.reviewer_name, r.rating, r.comment, r.stayed_on, r.status, r.created_at
       FROM st_review r
       JOIN st_listing l ON l.id = r.listing_id
       WHERE r.status = $1
       ORDER BY r.created_at DESC LIMIT 200`,
      [status]
    );
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, reviews: result.rows, status, marker: SHORT_TERM_MARKER });
  } catch (error) {
    return fail(res, error, 'Review queue is unavailable');
  }
});

router.post('/staff/reviews/:id/decision', requireStaffAccess, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ ok: false, error: 'Unknown review' });
    }
    const decision = String(req.body?.decision || '').trim();
    if (!['publish', 'reject'].includes(decision)) {
      return res.status(400).json({ ok: false, error: 'Decision must be publish or reject' });
    }
    const result = await db.query(
      `UPDATE st_review
       SET status = $2,
           published_at = CASE WHEN $2 = 'published' THEN NOW() ELSE NULL END,
           moderation_note = $3
       WHERE id = $1::uuid
       RETURNING id, status, published_at`,
      [
        req.params.id,
        decision === 'publish' ? 'published' : 'rejected',
        String(req.body?.note || '').trim().slice(0, 500) || null
      ]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Review not found' });
    return res.json({ ok: true, review: result.rows[0] });
  } catch (error) {
    return fail(res, error, 'Decision could not be saved');
  }
});

module.exports = router;
