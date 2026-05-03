'use strict';

const logger = require('../config/logger');
const { logNotification } = require('./notificationLogService');

function text(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch (_) {}
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

function normalizeCategory(value) {
  const category = lower(value);
  if (['rent', 'rental', 'to-rent'].includes(category)) return 'rent';
  if (['sale', 'for-sale', 'buy'].includes(category)) return 'sale';
  if (['student', 'student_accommodation', 'student-accommodation'].includes(category)) return 'student';
  if (category.includes('land')) return 'land';
  if (category.includes('commercial')) return 'commercial';
  return category || 'all';
}

function money(value) {
  const parsed = Number(String(value ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function locationBlob(item = {}) {
  return [
    item.location,
    item.full_address,
    item.fullAddress,
    item.address,
    item.area,
    item.neighbourhood,
    item.town,
    item.city,
    item.district,
    item.region,
    item.student_campus,
    item.campus
  ].map(lower).filter(Boolean).join(' ');
}

function savedSearchMatchesListing(savedSearch = {}, listing = {}) {
  const searchCategory = normalizeCategory(savedSearch.category || savedSearch.filters?.category);
  const listingCategory = normalizeCategory(listing.listing_type || listing.type || listing.category);
  if (searchCategory !== 'all' && listingCategory && searchCategory !== listingCategory) return false;

  const listingPrice = money(listing.price || listing.price_ugx || listing.pricePerMonth || listing.price_per_month);
  if (listingPrice != null) {
    const min = money(savedSearch.min_price || savedSearch.minPrice || savedSearch.filters?.minPrice || savedSearch.filters?.min_price);
    const max = money(savedSearch.max_price || savedSearch.maxPrice || savedSearch.filters?.maxPrice || savedSearch.filters?.max_price);
    if (min != null && listingPrice < min) return false;
    if (max != null && listingPrice > max) return false;
  }

  const beds = Number(listing.bedrooms || listing.beds || 0);
  const wantedBeds = Number(savedSearch.bedrooms || savedSearch.filters?.bedrooms || 0);
  if (wantedBeds && beds && beds < wantedBeds) return false;

  const wantedPropertyType = lower(savedSearch.property_type || savedSearch.propertyType || savedSearch.filters?.propertyType);
  const listingPropertyType = lower(listing.property_type || listing.propertyType);
  if (wantedPropertyType && listingPropertyType && wantedPropertyType !== listingPropertyType) return false;

  const searchLocation = lower(savedSearch.location || savedSearch.location_object?.query || savedSearch.location_object?.district || savedSearch.location_object?.town || savedSearch.location_object?.neighbourhood || savedSearch.filters?.location);
  if (searchLocation) {
    const listingLocation = locationBlob(listing);
    if (listingLocation && !listingLocation.includes(searchLocation)) return false;
  }

  const campus = lower(savedSearch.student_campus || savedSearch.filters?.campus);
  if (campus) {
    const listingCampus = lower(listing.student_campus || listing.campus || listing.extra_fields?.campus);
    if (listingCampus && !listingCampus.includes(campus)) return false;
  }

  return true;
}

function channelStatus(channel) {
  if (channel === 'in_app') return { status: 'pending', failureReason: null };
  if (channel === 'email' && (process.env.MAIL_WEBHOOK_URL || process.env.SMTP_HOST)) {
    return { status: 'pending', failureReason: null };
  }
  if (channel === 'whatsapp' && (process.env.WHATSAPP_PROVIDER || process.env.TWILIO_ACCOUNT_SID || process.env.WHATSAPP_WEB_BRIDGE_ENABLED === 'true')) {
    return { status: 'pending', failureReason: null };
  }
  if (channel === 'sms' && (process.env.TWILIO_ACCOUNT_SID || process.env.SMS_PROVIDER)) {
    return { status: 'pending', failureReason: null };
  }
  return { status: 'failed', failureReason: `${channel}_provider_missing` };
}

async function createAlertMatch(db, savedSearch, listing, channel) {
  const statusInfo = channelStatus(channel);
  const payload = {
    listing_title: listing.title,
    listing_reference: listing.inquiry_reference || listing.reference || listing.id,
    saved_search_label: savedSearch.label || savedSearch.location || savedSearch.category || 'Saved search',
    frequency: savedSearch.alert_frequency || 'weekly',
    channel
  };
  const result = await db.query(
    `INSERT INTO alert_matches (
       saved_search_id, listing_id, user_id, channel, status, sent_at,
       failure_reason, notification_payload_summary
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
     ON CONFLICT (saved_search_id, listing_id, channel) DO UPDATE
     SET status = CASE WHEN alert_matches.status = 'sent' THEN 'duplicate' ELSE alert_matches.status END
     RETURNING *`,
    [
      savedSearch.id,
      listing.id,
      savedSearch.user_id || null,
      channel,
      statusInfo.status,
      statusInfo.status === 'pending' && savedSearch.alert_frequency === 'instant' ? new Date() : null,
      statusInfo.failureReason,
      JSON.stringify(payload)
    ]
  );

  await logNotification(db, {
    userId: savedSearch.user_id || null,
    recipientPhone: savedSearch.phone || null,
    channel,
    type: 'alert_match_found',
    status: statusInfo.status === 'failed' ? 'failed' : 'queued',
    payloadSummary: payload,
    relatedListingId: listing.id,
    relatedSavedSearchId: savedSearch.id,
    failureReason: statusInfo.failureReason
  });

  return result.rows[0] || null;
}

async function matchListingToSavedSearches(db, listing = {}) {
  if (!db || !listing?.id) return { matched: 0, created: 0, failed: 0 };
  try {
    const searches = await db.query(
      `SELECT *
       FROM saved_searches
       WHERE status = 'active'
         AND COALESCE(alert_frequency, 'weekly') <> 'off'
       ORDER BY created_at ASC
       LIMIT 500`
    );
    let matched = 0;
    let created = 0;
    let failed = 0;
    for (const savedSearch of searches.rows) {
      if (!savedSearchMatchesListing(savedSearch, listing)) continue;
      matched += 1;
      const channels = asArray(savedSearch.alert_channels).length ? asArray(savedSearch.alert_channels) : ['in_app'];
      for (const rawChannel of channels) {
        const channel = lower(rawChannel).replace('-', '_') || 'in_app';
        const alert = await createAlertMatch(db, savedSearch, listing, channel);
        if (alert?.status === 'failed') failed += 1;
        if (alert) created += 1;
      }
      await db.query(
        `UPDATE saved_searches
         SET last_matched_at = NOW(),
             last_sent_at = CASE WHEN alert_frequency = 'instant' THEN NOW() ELSE last_sent_at END
         WHERE id = $1`,
        [savedSearch.id]
      );
    }
    return { matched, created, failed };
  } catch (error) {
    if (!['42P01', '42703'].includes(error.code)) {
      logger.warn('Saved-search alert matching failed', { listingId: listing.id, error: error.message });
    }
    return { matched: 0, created: 0, failed: 0, error: error.message };
  }
}

async function getAlertSummary(db) {
  const empty = { savedSearches: 0, pending: 0, sent: 0, failed: 0, channelBreakdown: [], failedAlerts: [] };
  try {
    const [searches, counts, channels, failed] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS count FROM saved_searches WHERE status = 'active'`),
      db.query(
        `SELECT
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM alert_matches`
      ),
      db.query(`SELECT channel, status, COUNT(*)::int AS count FROM alert_matches GROUP BY channel, status ORDER BY channel, status`),
      db.query(
        `SELECT am.*, ss.label AS saved_search_label, p.title AS listing_title
         FROM alert_matches am
         LEFT JOIN saved_searches ss ON ss.id = am.saved_search_id
         LEFT JOIN properties p ON p.id = am.listing_id
         WHERE am.status = 'failed'
         ORDER BY am.matched_at DESC
         LIMIT 50`
      )
    ]);
    return {
      savedSearches: searches.rows[0]?.count || 0,
      pending: counts.rows[0]?.pending || 0,
      sent: counts.rows[0]?.sent || 0,
      failed: counts.rows[0]?.failed || 0,
      channelBreakdown: channels.rows,
      failedAlerts: failed.rows
    };
  } catch (error) {
    if (!['42P01', '42703'].includes(error.code)) {
      logger.warn('Alert summary failed', { error: error.message });
    }
    return { ...empty, provider_missing: true, error: error.message };
  }
}

module.exports = {
  getAlertSummary,
  matchListingToSavedSearches,
  savedSearchMatchesListing
};
