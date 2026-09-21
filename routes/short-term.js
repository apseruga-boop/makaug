'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const db = require('../config/database');
const logger = require('../config/logger');
const {
  fetchRates: hotelbedsRates,
  fetchUgandaHotels,
  shouldOfferPartnerSupply: hotelbedsShouldOffer
} = require('../services/hotelbedsSupplyService');
const {
  enrichWithContact: liteapiContacts,
  fetchRates: liteapiRates,
  fetchUgandaProperties,
  shouldOfferPartnerSupply: liteapiShouldOffer
} = require('../services/liteapiSupplyService');
const { bookingLinkFor } = require('../services/bookingAffiliateService');

const { requireAdminApiKey, requireStaffAccess } = require('../middleware/auth');
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
  submitShortTermReview,
  validateListingSubmission
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
const {
  KING_ACTIONS,
  REVIEW_CHECKS,
  STAFF_ACTIONS,
  STAGES,
  applyKingDecision,
  applyStaffDecision,
  buildAutomatedChecklist,
  loadModerationHistory,
  missingChecks,
  normalizeChecklist
} = require('../services/shortTermModerationService');

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
    review: {
      // Two gates. A moderator screens, the King publishes. Neither can do
      // the other's job.
      stages: STAGES,
      staff_actions: Object.keys(STAFF_ACTIONS),
      king_actions: Object.keys(KING_ACTIONS),
      checks: REVIEW_CHECKS
    },
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

    // Partner hotels fill an empty result and nothing else. They are returned
    // under their own key, never merged into `listings` - a merged row could
    // be counted as a host listing or read by something that assumes every
    // row carries a host's phone number, and this section's whole promise is
    // that they do.
    // LiteAPI first. Hotelbeds only if LiteAPI is switched off or comes back
    // empty, so the old behaviour is one environment variable away rather than
    // deleted - but it is the fallback now, not the source.
    if (liteapiShouldOffer(result.listings)) {
      const partners = await fetchUgandaProperties({ limit: result.limit });
      if (partners.length) {
        const query = req.query || {};

        // The phone number lives on the single-property endpoint, so this is
        // one call per row - made only for the rows actually being sent, and
        // cached for a day. It is worth it: a partner row with a phone number
        // keeps the promise the rest of the section makes.
        await liteapiContacts(partners);

        const rates = await liteapiRates({
          hotelIds: partners.map((row) => String(row.reference || '').replace(/^la-/, '')),
          checkIn: query.check_in,
          checkOut: query.check_out,
          adults: query.guests
        });

        partners.forEach((row) => {
          const rate = rates[row.reference];
          if (!rate || !rate.per_night) return;
          row.price_per_night = rate.per_night;
          row.price_display = formatUgx(rate.per_night);
          row.price_total_display = formatUgx(rate.total);
          row.price_nights = rate.nights;
          row.price_basis = {
            source_currency: rate.source_currency,
            source_total: rate.source_total,
            fx_rate: rate.fx_rate,
            markup_percent: rate.markup_percent
          };
        });

        result.partner_listings = partners;
        result.partner_source = 'liteapi';
      }
    }

    if (!result.partner_listings && hotelbedsShouldOffer(result.listings)) {
      const partners = await fetchUgandaHotels({ limit: result.limit });
      if (partners.length) {
        // Prices are per stay, not per hotel, so they are only fetched when the
        // visitor gave dates. Without dates there is nothing true to put on the
        // card: a made-up sample stay would answer a question nobody asked, and
        // it would spend a metered call doing it. fetchRates returns {} rather
        // than calling out at all in that case.
        const query = req.query || {};
        const rates = await hotelbedsRates({
          hotelCodes: partners.map((row) => String(row.reference || '').replace(/^hb-/, '')),
          checkIn: query.check_in,
          checkOut: query.check_out,
          adults: query.guests
        });

        partners.forEach((row) => {
          const rate = rates[row.reference];
          if (!rate || !rate.per_night) return;
          // Already converted to UGX by the service. Formatted here so the
          // client never has to know what currency a partner quoted in.
          row.price_per_night = rate.per_night;
          row.price_display = formatUgx(rate.per_night);
          row.price_total_display = formatUgx(rate.total);
          row.price_nights = rate.nights;
          // Kept on the row so a wrong price is arguable from the response
          // alone: what was quoted, in what currency, at what rate.
          row.price_basis = {
            source_currency: rate.source_currency,
            source_total: rate.source_total,
            fx_rate: rate.fx_rate,
            markup_percent: rate.markup_percent
          };
        });

        result.partner_listings = partners;
        result.partner_source = 'hotelbeds';
      }
    }

    // Booking.com through CJ Affiliate. A single outbound search link, not rows:
    // nothing from Booking.com is merged into listings or partner_listings, and
    // it is null (so the page shows nothing) until BOOKING_AFFILIATE_ENABLED,
    // CJ_PUBLISHER_PID and BOOKING_CJ_AD_ID are all set.
    result.booking_link = bookingLinkFor(req.query || {});

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
      hostUserId: req.userAuth?.id || null,
      listedVia: 'website',
      referralCode: req.body?.referral_code || req.query?.ref || null
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
// Staff-assisted intake.
//
// Most Ugandan hosts will not fill in a four step form on a phone, on mobile
// data, for a site they have not heard of. So whoever is building supply sits
// with the host, enters it for them and takes the photos on their own phone.
// That is how this section actually gets its first hundred places.
//
// The listing is flagged staff_assisted and records who typed it. It then goes
// through EXACTLY the same two gates as anything else - and because King
// review is admin-only, a moderator cannot enter a listing and then wave their
// own work through.
// ---------------------------------------------------------------------------

router.post('/staff/listings', requireStaffAccess, async (req, res) => {
  try {
    const created = await createShortTermListing(db, req.body || {}, {
      ip: req.ip,
      listedVia: 'staff_assisted',
      enteredByStaffId: req.staffAuth?.userId || null,
      enteredByStaffName: [req.userAuth?.first_name, req.userAuth?.last_name]
        .filter(Boolean).join(' ').trim() || req.staffAuth?.userId || null,
      referralCode: req.body?.referral_code || null,
      acquisitionNotes: req.body?.acquisition_notes || null
    });

    let uploadToken = null;
    try {
      uploadToken = createUploadToken(created.id);
    } catch (error) {
      logger.warn('Short term upload token could not be issued for staff intake', {
        marker: SHORT_TERM_MARKER,
        message: error?.message
      });
    }

    logger.info('Short term listing entered by staff on a host behalf', {
      marker: SHORT_TERM_MARKER,
      listingId: created.id,
      reference: created.reference,
      by: req.staffAuth?.userId
    });

    return res.status(201).json({
      ok: true,
      marker: SHORT_TERM_MARKER,
      listing: created,
      upload_token: uploadToken,
      photos_ready: photoUploadReady(),
      next_step: 'Saved and in the review queue. Add the photos now while you are still with the host.'
    });
  } catch (error) {
    return fail(res, error, 'Listing could not be saved');
  }
});

// Lets the intake form show the same validation the server enforces, before
// a colleague sitting in someone's living room loses the lot to a 400.
router.post('/staff/listings/validate', requireStaffAccess, (req, res) => {
  const result = validateListingSubmission(req.body || {});
  return res.json({ ok: true, valid: result.ok, errors: result.errors, marker: SHORT_TERM_MARKER });
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
    const requested = String(req.query.stage || req.query.status || '').trim();
    const stage = Object.keys(STAGES).includes(requested) ? requested : 'submitted';
    const result = await db.query(
      `SELECT l.id, l.reference, l.slug, l.title, l.district, l.area, l.status,
              l.moderation_stage, l.king_facts_confirmed,
              l.base_nightly_ugx, l.host_name, l.host_phone, l.host_type,
              l.right_to_let_declared, l.right_to_let_reference,
              l.listing_fee_status, l.preferred_payment_method,
              l.staff_reviewed_by, l.staff_reviewed_at,
              l.king_reviewed_by, l.king_reviewed_at,
              l.listed_via, l.entered_by_staff_name, l.referral_code,
              l.listed_at, l.expires_at, l.created_at,
              COALESCE(m.photo_count, 0)::int AS photo_count
       FROM st_listing l
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS photo_count FROM st_listing_media WHERE listing_id = l.id
       ) m ON TRUE
       WHERE l.moderation_stage = $1
       ORDER BY l.created_at DESC
       LIMIT 200`,
      [stage]
    );

    // So the queue screen can show both gates at once.
    const counts = await db.query(
      `SELECT moderation_stage, COUNT(*)::int AS total
       FROM st_listing GROUP BY moderation_stage`
    );

    res.set('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      marker: SHORT_TERM_MARKER,
      stage,
      stage_label: STAGES[stage],
      listings: result.rows,
      counts: counts.rows.reduce((acc, row) => {
        acc[row.moderation_stage] = row.total;
        return acc;
      }, {})
    });
  } catch (error) {
    return fail(res, error, 'Short term queue is unavailable');
  }
});

// ---------------------------------------------------------------------------
// GATE ONE: the staff moderator.
//
// A moderator screens the listing and hands it on. There is no decision here
// that publishes anything - the furthest this endpoint can move a listing is
// into king_review.
// ---------------------------------------------------------------------------

router.post('/staff/listings/:id/decision', requireStaffAccess, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ ok: false, error: 'Unknown listing' });
    }
    const action = String(req.body?.action || req.body?.decision || '').trim();
    if (!Object.keys(STAFF_ACTIONS).includes(action)) {
      return res.status(400).json({
        ok: false,
        error: `A moderator can only: ${Object.keys(STAFF_ACTIONS).join(', ')}. Publishing is the King's call.`
      });
    }
    const listing = await applyStaffDecision(db, req.params.id, {
      action,
      checklist: req.body?.checklist,
      reason: String(req.body?.reason || '').trim().slice(0, 500) || null,
      notes: String(req.body?.notes || '').trim().slice(0, 2000) || null,
      actor: { userId: req.staffAuth?.userId, role: req.staffAuth?.role }
    });
    return res.json({
      ok: true,
      marker: SHORT_TERM_MARKER,
      listing,
      note: action === 'pass_to_king'
        ? 'Sent for King review. It stays off the public site until the King approves it.'
        : undefined
    });
  } catch (error) {
    return fail(res, error, 'Decision could not be saved');
  }
});

// ---------------------------------------------------------------------------
// GATE TWO: King review.
//
// Admin or super admin only. This is the only endpoint in the codebase that
// can set king_facts_confirmed, and the public query will not show a listing
// without it.
// ---------------------------------------------------------------------------

router.post('/staff/listings/:id/king-decision', requireAdminApiKey, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ ok: false, error: 'Unknown listing' });
    }
    const action = String(req.body?.action || req.body?.decision || '').trim();
    if (!Object.keys(KING_ACTIONS).includes(action)) {
      return res.status(400).json({
        ok: false,
        error: `King review can only: ${Object.keys(KING_ACTIONS).join(', ')}.`
      });
    }
    const listing = await applyKingDecision(db, req.params.id, {
      action,
      checklist: req.body?.checklist,
      overrides: req.body?.overrides,
      factsConfirmed: req.body?.facts_confirmed === true || req.body?.facts_confirmed === 'true',
      reason: String(req.body?.reason || '').trim().slice(0, 500) || null,
      notes: String(req.body?.notes || '').trim().slice(0, 2000) || null,
      actor: {
        userId: req.adminAuth?.userId || req.adminAuth?.type || 'king',
        role: req.adminAuth?.role || 'king'
      }
    });
    return res.json({ ok: true, marker: SHORT_TERM_MARKER, listing });
  } catch (error) {
    return fail(res, error, 'Decision could not be saved');
  }
});

// What is still outstanding on a listing, plus who has touched it.
router.get('/staff/listings/:id/review', requireStaffAccess, async (req, res) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(400).json({ ok: false, error: 'Unknown listing' });
    }
    const result = await db.query(
      `SELECT l.*, COALESCE(m.photo_count, 0)::int AS photo_count
       FROM st_listing l
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS photo_count FROM st_listing_media WHERE listing_id = l.id
       ) m ON TRUE
       WHERE l.id = $1::uuid LIMIT 1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Listing not found' });
    const row = result.rows[0];

    const automated = buildAutomatedChecklist(row, { photoCount: row.photo_count });
    const saved = normalizeChecklist(row.moderation_checklist);
    const combined = normalizeChecklist({ ...automated, ...saved });

    res.set('Cache-Control', 'no-store');
    return res.json({
      ok: true,
      marker: SHORT_TERM_MARKER,
      listing: {
        id: String(row.id),
        reference: row.reference,
        title: row.title,
        district: row.district,
        area: row.area,
        host_name: row.host_name,
        host_phone: row.host_phone,
        base_nightly_ugx: Number(row.base_nightly_ugx || 0),
        photo_count: row.photo_count,
        status: row.status,
        moderation_stage: row.moderation_stage,
        stage_label: STAGES[row.moderation_stage] || row.moderation_stage,
        king_facts_confirmed: row.king_facts_confirmed === true,
        staff_reviewed_by: row.staff_reviewed_by,
        staff_reviewed_at: row.staff_reviewed_at,
        king_reviewed_by: row.king_reviewed_by,
        king_reviewed_at: row.king_reviewed_at,
        listing_fee_status: row.listing_fee_status,
        // The King should know whether a host filled this in or a colleague
        // typed it. A staff-assisted listing has not had an independent first
        // pair of eyes on it.
        listed_via: row.listed_via,
        entered_by_staff_name: row.entered_by_staff_name,
        referral_code: row.referral_code,
        acquisition_notes: row.acquisition_notes
      },
      checks: REVIEW_CHECKS,
      checklist: combined,
      automated,
      outstanding: missingChecks(combined),
      history: await loadModerationHistory(db, req.params.id)
    });
  } catch (error) {
    return fail(res, error, 'Review details are unavailable');
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
