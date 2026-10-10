'use strict';

/**
 * What an anonymous visitor may be sent about a listing or an agent.
 *
 * An explicit allow-list, not a deny-list. The old public row was `SELECT p.*`
 * minus three columns, so every column added later (moderation notes, who
 * reviewed it, billing logs, the lister's own phone and email) went public the
 * day it was created. On 9 Oct 2026 the live API was returning all of those to
 * anyone, and /api/agents/:id returned each listing's raw extra_fields
 * (including the WhatsApp message ids and staff photo removals).
 *
 * A key that is not listed here is not sent. To expose a new field publicly,
 * add it here on purpose.
 *
 * Staff, and an owner holding a valid edit token, still get the full row:
 * `privileged` skips the filter.
 */

const PUBLIC_LISTING_KEYS = new Set([
  'address', 'agent_company', 'agent_email', 'agent_id', 'agent_name', 'agent_phone',
  'agent_registration_status', 'agent_whatsapp', 'amenities', 'area', 'bathrooms', 'bedrooms',
  'boost_tier', 'canonical_location_id', 'canonical_location_level', 'commercial_intent',
  'contact_phone', 'contract_months', 'created_at', 'deposit_amount', 'description',
  'development_id', 'distance_to_uni_km', 'district', 'expires_at', 'extra_fields', 'featured',
  'featured_at', 'featured_until', 'floor_area_sqm', 'furnishing', 'id', 'image', 'images',
  'inquiry_reference', 'land_size_unit', 'land_size_value', 'land_verification', 'latitude',
  'listed_by', 'listed_via', 'lister_name', 'lister_type', 'listing_origin', 'listing_type',
  'longitude', 'nearest_university', 'new_until', 'parking_bays', 'price', 'price_currency',
  'price_fx_as_of', 'price_fx_rate_ugx', 'price_on_application', 'price_original',
  'price_original_currency', 'price_period', 'primary_image_url', 'property_type',
  'public_contact_phone', 'public_copy_reviewed', 'found_online_notice', 'published_at', 'room_arrangement', 'room_type',
  'sold_at', 'source', 'status', 'student_universities', 'students_welcome',
  'third_party_discovery_result', 'title', 'title_type', 'transaction_type', 'updated_at',
  'usable_size_sqm', 'year_built'
]);

// extra_fields keys a listing card or detail page on the public site reads.
const PUBLIC_EXTRA_KEYS = new Set([
  'added_to_makaug_at', 'added_to_makaug_label', 'area_highlights', 'canonical_location_id',
  'canonical_location_level', 'city', 'contact_phone', 'cover_image_url', 'distance_to_uni_km',
  'featured', 'featured_at', 'first_posted_online_at', 'first_posted_online_label',
  'first_seen_online_at', 'first_seen_online_label', 'found_online', 'image_count',
  'land_title_available', 'land_title_available_label', 'location_resolution_confidence',
  'location_resolution_status', 'media_duration', 'media_type', 'nearby_facilities',
  'nearest_university', 'neighborhood', 'oembed_thumbnail_url', 'original_publish_date_status',
  'preferred_contact_method', 'price_currency', 'price_fx_as_of', 'price_fx_rate_ugx',
  'price_original', 'price_original_currency', 'public_contact_phone', 'public_display_name',
  'region', 'resolved_location_label', 'size_raw', 'social_search_candidate', 'source_agent_name',
  'source_audience_label', 'source_badge', 'source_batch', 'source_card_description',
  'source_channel_url', 'source_contact_label', 'source_contact_method', 'source_contact_platform',
  'source_contact_url', 'source_followers_label', 'source_hover_description', 'source_listing_key',
  'source_name', 'source_platform', 'source_post_date_confidence', 'source_post_date_status',
  'source_published_at', 'source_published_label', 'source_registry_key', 'source_thumbnail_url',
  'source_type', 'source_unavailable', 'source_unavailable_reason', 'source_url', 'source_url_status',
  'source_urls', 'sourced_inventory_candidate', 'street_name', 'student_campus',
  'student_universities', 'third_party_discovery_result', 'thumbnail_url', 'tiktok_thumbnail_url',
  'tiktok_url', 'video_thumbnail_url', 'video_tours', 'video_url', 'video_urls',
  'youtube_channel_url', 'youtube_url'
]);

function pick(source, allowed) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  for (const key of Object.keys(source)) {
    if (allowed.has(key)) out[key] = source[key];
  }
  return out;
}

/** Only the extra_fields keys the public site reads. */
function pickPublicExtra(extra) {
  return pick(extra, PUBLIC_EXTRA_KEYS);
}

/**
 * The listing as an anonymous visitor may see it. `privileged` (staff, or an
 * owner with a valid edit token) returns the row untouched.
 */
function publicListingPayload(row, { privileged = false } = {}) {
  if (privileged || !row || typeof row !== 'object') return row;
  const out = pick(row, PUBLIC_LISTING_KEYS);
  // The approval time is what the "new" badge counts from, so it is exposed as
  // a date of publication rather than as a moderation field.
  if (out.published_at == null && row.approved_at) out.published_at = row.approved_at;
  return out;
}

const DIRECT_AGENT_MARKER = '[DIRECT_AGENT_AUTHORISED]';

/**
 * An agent as the public may see them. The user id and the free-text
 * verification note stay server-side; the one fact the public profile shows
 * (direct_agent_authorised) is sent as a plain boolean instead. The internal
 * review flags private_id_profile_reviewed and profile_claim_pending are
 * staff-only (C3, 10 Oct 2026).
 */
function publicAgentPayload(row) {
  if (!row || typeof row !== 'object') return row;
  const {
    user_id: _userId,
    verification_reason: reason,
    private_id_profile_reviewed: _idReviewed,
    profile_claim_pending: _claimPending,
    ...rest
  } = row;
  const note = String(reason || '');
  return {
    ...rest,
    direct_agent_authorised: note.includes(DIRECT_AGENT_MARKER)
  };
}

/** A listing on a public agent profile: allow-listed columns, filtered extras. */
function publicAgentListingPayload(row) {
  if (!row || typeof row !== 'object') return row;
  return { ...row, extra_fields: pickPublicExtra(row.extra_fields) };
}

module.exports = {
  PUBLIC_LISTING_KEYS,
  PUBLIC_EXTRA_KEYS,
  pickPublicExtra,
  publicListingPayload,
  publicAgentPayload,
  publicAgentListingPayload
};
