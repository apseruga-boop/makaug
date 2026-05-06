const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('../config/database');
const logger = require('../config/logger');
const { cleanText } = require('../middleware/validation');
const { createLead } = require('../services/leadService');
const { getSupportEmail, sendSupportEmail } = require('../services/emailService');
const { logEmailEvent } = require('../services/emailLogService');
const { logNotification, notificationStatusFromDelivery } = require('../services/notificationLogService');
const { logWhatsAppMessage } = require('../services/whatsappMessageLogService');
const { sendWhatsAppText } = require('../services/whatsappNotificationService');

const router = express.Router();

const SUPPORTED_LANGUAGES = new Set(['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm']);
const CONTACT_CHANNELS = new Set(['whatsapp', 'email', 'phone', 'sms', 'in_app']);

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function asText(value, fallback = '') {
  const text = cleanText(value);
  return text || fallback;
}

function asLanguage(value, fallback = 'en') {
  const language = asText(value, fallback).toLowerCase();
  return SUPPORTED_LANGUAGES.has(language) ? language : fallback;
}

function asContactChannel(value, fallback = 'whatsapp') {
  const channel = asText(value, fallback).toLowerCase();
  return CONTACT_CHANNELS.has(channel) ? channel : fallback;
}

function asBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value).trim().toLowerCase());
}

function asInteger(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBigIntNumber(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const digits = String(value).replace(/[^\d]/g, '');
  if (!digits) return fallback;
  const parsed = Number.parseInt(digits, 10);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function asArray(value) {
  if (Array.isArray(value)) return value.map((item) => asText(item)).filter(Boolean).slice(0, 20);
  const text = asText(value);
  if (!text) return [];
  return text.split(',').map((item) => asText(item)).filter(Boolean).slice(0, 20);
}

function safeJson(value, fallback) {
  if (value && typeof value === 'object') return value;
  return fallback;
}

function normalizeCategory(value) {
  const text = asText(value).toLowerCase();
  if (!text) return '';
  if (text.includes('student')) return 'student';
  if (text.includes('commercial')) return 'commercial';
  if (text.includes('land')) return 'land';
  if (text.includes('rent')) return 'rent';
  if (text.includes('buy') || text.includes('sale')) return 'sale';
  return text.replace(/[^a-z0-9_ -]/g, '').slice(0, 40);
}

function propertyUrl(id) {
  const base = String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://makaug.com').replace(/\/$/, '');
  return `${base}/property/${id}`;
}

function propertyToCard(row, reason = 'Recommended for your saved preferences') {
  if (!row) return null;
  const location = [row.area, row.district].filter(Boolean).join(', ');
  return {
    id: row.id,
    title: row.title,
    listing_type: row.listing_type,
    location,
    district: row.district,
    area: row.area,
    address: row.address,
    price: row.price,
    price_period: row.price_period,
    period: row.price_period,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    property_type: row.property_type,
    primary_image_url: row.primary_image_url,
    image: row.primary_image_url,
    url: propertyUrl(row.id),
    reason
  };
}

function ownedListingToCard(row) {
  return {
    ...propertyToCard(row, row.status === 'approved' ? 'Live listing linked to your account' : `Status: ${row.status || 'pending'}`),
    description: row.description || '',
    status: row.status || 'pending',
    moderation_stage: row.moderation_stage || 'submitted',
    moderation_reason: row.moderation_reason || null,
    inquiry_reference: row.inquiry_reference || null,
    updated_at: row.updated_at || row.created_at || null,
    owner_last_edited_at: row.owner_last_edited_at || null
  };
}

function phoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function ownerContactParams(user = {}) {
  return {
    email: asText(user.email).toLowerCase() || null,
    phoneDigits: phoneDigits(user.phone) || null
  };
}

function ownerMatchSql(alias = 'p', emailParam = '$1', phoneParam = '$2') {
  return `(
    (${emailParam}::text IS NOT NULL AND ${emailParam}::text <> '' AND LOWER(COALESCE(${alias}.lister_email, '')) = LOWER(${emailParam}::text))
    OR (${phoneParam}::text IS NOT NULL AND ${phoneParam}::text <> '' AND regexp_replace(COALESCE(${alias}.lister_phone, ''), '\\D', '', 'g') = ${phoneParam}::text)
  )`;
}

function normalizeLocationObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out = {};
    [
      'query',
      'placeId',
      'fullAddress',
      'street',
      'area',
      'neighbourhood',
      'parish',
      'town',
      'city',
      'district',
      'region',
      'country',
      'latitude',
      'longitude',
      'lat',
      'lng',
      'plusCode',
      'radius',
      'radiusKm',
      'radiusMiles',
      'radiusUnit',
      'source',
      'language',
      'locationConfidence',
      'locationPrivacy'
    ].forEach((key) => {
      if (value[key] !== undefined && value[key] !== null && value[key] !== '') out[key] = value[key];
    });
    return out;
  }
  const query = asText(value);
  return query ? { query, fullAddress: query } : {};
}

function locationLabel(location = {}) {
  if (typeof location === 'string') return asText(location) || null;
  return asText(
    location.fullAddress
      || [location.neighbourhood, location.town || location.city, location.district, location.region].filter(Boolean).join(', ')
      || location.query
  ) || null;
}

function normalizeAlertFrequency(value, fallback = 'weekly') {
  const frequency = asText(value, fallback).toLowerCase();
  return ['instant', 'daily', 'weekly', 'off'].includes(frequency) ? frequency : fallback;
}

function normalizeAlertChannels(value) {
  const channels = asArray(value).map((channel) => asContactChannel(channel, '')).filter(Boolean);
  return channels.length ? [...new Set(channels)] : ['in_app'];
}

async function logActivity(userId, activityType, metadata = {}, extra = {}) {
  try {
    await db.query(
      `INSERT INTO property_seeker_activities (user_id, guest_session_id, activity_type, listing_id, search_id, lead_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        userId || null,
        extra.guestSessionId || null,
        activityType,
        extra.listingId || null,
        extra.searchId || null,
        extra.leadId || null,
        JSON.stringify(metadata || {})
      ]
    );
  } catch (error) {
    logger.warn('Property seeker activity log failed', { activityType, error: error.message });
  }
}

async function loadUserFromToken(token) {
  if (!token || !process.env.JWT_SECRET) return null;
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (!isUuid(decoded?.sub)) return null;
  const result = await db.query(
    `SELECT id, first_name, last_name, phone, email, role, status, marketing_opt_in,
            weekly_tips_opt_in, preferred_contact_channel, preferred_language, profile_data
     FROM users
     WHERE id = $1 AND status = 'active'
     LIMIT 1`,
    [decoded.sub]
  );
  return result.rows[0] || null;
}

async function requireAuth(req, res, next) {
  const authHeader = req.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  try {
    const user = await loadUserFromToken(token);
    if (!user) return res.status(401).json({ ok: false, error: 'Sign in required' });
    req.userAuth = user;
    return next();
  } catch (error) {
    return res.status(401).json({ ok: false, error: 'Invalid session' });
  }
}

async function optionalAuth(req, _res, next) {
  const authHeader = req.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  try {
    req.userAuth = await loadUserFromToken(token);
  } catch (_) {
    req.userAuth = null;
  }
  return next();
}

function completionPercent(profile, preferences) {
  const checks = [
    profile?.first_name,
    profile?.preferred_language,
    profile?.preferred_contact_channel,
    profile?.seeker_type,
    profile?.timeline,
    (preferences?.categories || []).length,
    (preferences?.preferred_locations || []).length,
    preferences?.max_budget,
    preferences?.bedrooms,
    preferences?.alert_frequency
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

async function loadProfile(userId) {
  const result = await db.query('SELECT * FROM property_seeker_profiles WHERE user_id = $1 LIMIT 1', [userId]);
  return result.rows[0] || null;
}

async function loadPreferences(userId) {
  const result = await db.query('SELECT * FROM property_seeker_preferences WHERE user_id = $1 LIMIT 1', [userId]);
  return result.rows[0] || null;
}

async function upsertProfile(user, patch = {}) {
  const current = await loadProfile(user.id);
  const merged = {
    first_name: asText(patch.first_name ?? patch.firstName, current?.first_name || user.first_name || ''),
    last_name: asText(patch.last_name ?? patch.lastName, current?.last_name || user.last_name || ''),
    preferred_language: asLanguage(patch.preferred_language ?? patch.preferredLanguage, current?.preferred_language || user.preferred_language || 'en'),
    preferred_contact_channel: asContactChannel(
      patch.preferred_contact_channel ?? patch.preferredContactChannel,
      current?.preferred_contact_channel || user.preferred_contact_channel || 'whatsapp'
    ),
    whatsapp_consent: asBoolean(patch.whatsapp_consent ?? patch.whatsAppConsent, current?.whatsapp_consent || false),
    email_alert_consent: asBoolean(patch.email_alert_consent ?? patch.emailAlertConsent, current?.email_alert_consent || false),
    sms_consent: asBoolean(patch.sms_consent ?? patch.smsConsent, current?.sms_consent || false),
    marketing_consent: asBoolean(patch.marketing_consent ?? patch.marketingConsent, current?.marketing_consent || user.marketing_opt_in !== false),
    seeker_type: asText(patch.seeker_type ?? patch.seekerType, current?.seeker_type || 'casual_browser'),
    current_goal: normalizeCategory(patch.current_goal ?? patch.currentGoal) || current?.current_goal || null,
    timeline: asText(patch.timeline, current?.timeline || null),
    onboarding_completed: asBoolean(patch.onboarding_completed ?? patch.onboardingCompleted, current?.onboarding_completed || false)
  };

  const preferences = await loadPreferences(user.id);
  merged.profile_completion_percent = completionPercent(merged, preferences || {});

  const result = await db.query(
    `INSERT INTO property_seeker_profiles (
       user_id, first_name, last_name, preferred_language, preferred_contact_channel,
       whatsapp_consent, email_alert_consent, sms_consent, marketing_consent,
       seeker_type, current_goal, timeline, profile_completion_percent, onboarding_completed
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (user_id)
     DO UPDATE SET
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       preferred_language = EXCLUDED.preferred_language,
       preferred_contact_channel = EXCLUDED.preferred_contact_channel,
       whatsapp_consent = EXCLUDED.whatsapp_consent,
       email_alert_consent = EXCLUDED.email_alert_consent,
       sms_consent = EXCLUDED.sms_consent,
       marketing_consent = EXCLUDED.marketing_consent,
       seeker_type = EXCLUDED.seeker_type,
       current_goal = EXCLUDED.current_goal,
       timeline = EXCLUDED.timeline,
       profile_completion_percent = EXCLUDED.profile_completion_percent,
       onboarding_completed = EXCLUDED.onboarding_completed,
       updated_at = NOW()
     RETURNING *`,
    [
      user.id,
      merged.first_name,
      merged.last_name,
      merged.preferred_language,
      merged.preferred_contact_channel,
      merged.whatsapp_consent,
      merged.email_alert_consent,
      merged.sms_consent,
      merged.marketing_consent,
      merged.seeker_type,
      merged.current_goal,
      merged.timeline,
      merged.profile_completion_percent,
      merged.onboarding_completed
    ]
  );

  await db.query(
    `UPDATE users
     SET preferred_language = $2,
         preferred_contact_channel = $3,
         profile_data = COALESCE(profile_data, '{}'::jsonb) || $4::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [
      user.id,
      merged.preferred_language,
      merged.preferred_contact_channel,
      JSON.stringify({ account_kind: 'property_seeker', seeker_type: merged.seeker_type })
    ]
  );

  return result.rows[0];
}

async function upsertPreferences(userId, patch = {}) {
  const current = await loadPreferences(userId);
  const merged = {
    categories: asArray(patch.categories ?? patch.goals ?? current?.categories),
    preferred_locations: asArray(patch.preferred_locations ?? patch.preferredLocations ?? patch.location ?? current?.preferred_locations),
    min_budget: asBigIntNumber(patch.min_budget ?? patch.minBudget, current?.min_budget || null),
    max_budget: asBigIntNumber(patch.max_budget ?? patch.maxBudget ?? patch.budget, current?.max_budget || null),
    currency: asText(patch.currency, current?.currency || 'UGX').toUpperCase().slice(0, 8),
    bedrooms: asInteger(patch.bedrooms, current?.bedrooms || null),
    bathrooms: asInteger(patch.bathrooms, current?.bathrooms || null),
    property_types: asArray(patch.property_types ?? patch.propertyTypes ?? current?.property_types),
    amenities: asArray(patch.amenities ?? current?.amenities),
    furnished_status: asText(patch.furnished_status ?? patch.furnishedStatus, current?.furnished_status || null),
    verification_preference: asText(patch.verification_preference ?? patch.verificationPreference, current?.verification_preference || 'open_with_warnings'),
    campus: asText(patch.campus, current?.campus || null),
    max_distance_to_campus: asInteger(patch.max_distance_to_campus ?? patch.maxDistanceToCampus, current?.max_distance_to_campus || null),
    land_title_preference: asText(patch.land_title_preference ?? patch.landTitlePreference, current?.land_title_preference || null),
    land_size_preference: asText(patch.land_size_preference ?? patch.landSizePreference, current?.land_size_preference || null),
    commercial_use: asText(patch.commercial_use ?? patch.commercialUse, current?.commercial_use || null),
    mortgage_interest: asBoolean(patch.mortgage_interest ?? patch.mortgageInterest, current?.mortgage_interest || false),
    deposit_amount: asBigIntNumber(patch.deposit_amount ?? patch.depositAmount, current?.deposit_amount || null),
    move_in_date: asText(patch.move_in_date ?? patch.moveInDate, current?.move_in_date || null),
    timeline: asText(patch.timeline, current?.timeline || null),
    alert_frequency: asText(patch.alert_frequency ?? patch.alertFrequency, current?.alert_frequency || 'weekly'),
    alert_channels: asArray(patch.alert_channels ?? patch.alertChannels ?? current?.alert_channels)
  };
  if (!merged.alert_channels.length) merged.alert_channels = ['in_app'];

  const result = await db.query(
    `INSERT INTO property_seeker_preferences (
       user_id, categories, preferred_locations, min_budget, max_budget, currency,
       bedrooms, bathrooms, property_types, amenities, furnished_status,
       verification_preference, campus, max_distance_to_campus, land_title_preference,
       land_size_preference, commercial_use, mortgage_interest, deposit_amount,
       move_in_date, timeline, alert_frequency, alert_channels
     )
     VALUES ($1,$2::jsonb,$3::jsonb,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb)
     ON CONFLICT (user_id)
     DO UPDATE SET
       categories = EXCLUDED.categories,
       preferred_locations = EXCLUDED.preferred_locations,
       min_budget = EXCLUDED.min_budget,
       max_budget = EXCLUDED.max_budget,
       currency = EXCLUDED.currency,
       bedrooms = EXCLUDED.bedrooms,
       bathrooms = EXCLUDED.bathrooms,
       property_types = EXCLUDED.property_types,
       amenities = EXCLUDED.amenities,
       furnished_status = EXCLUDED.furnished_status,
       verification_preference = EXCLUDED.verification_preference,
       campus = EXCLUDED.campus,
       max_distance_to_campus = EXCLUDED.max_distance_to_campus,
       land_title_preference = EXCLUDED.land_title_preference,
       land_size_preference = EXCLUDED.land_size_preference,
       commercial_use = EXCLUDED.commercial_use,
       mortgage_interest = EXCLUDED.mortgage_interest,
       deposit_amount = EXCLUDED.deposit_amount,
       move_in_date = EXCLUDED.move_in_date,
       timeline = EXCLUDED.timeline,
       alert_frequency = EXCLUDED.alert_frequency,
       alert_channels = EXCLUDED.alert_channels,
       updated_at = NOW()
     RETURNING *`,
    [
      userId,
      JSON.stringify(merged.categories),
      JSON.stringify(merged.preferred_locations),
      merged.min_budget,
      merged.max_budget,
      merged.currency,
      merged.bedrooms,
      merged.bathrooms,
      JSON.stringify(merged.property_types),
      JSON.stringify(merged.amenities),
      merged.furnished_status,
      merged.verification_preference,
      merged.campus,
      merged.max_distance_to_campus,
      merged.land_title_preference,
      merged.land_size_preference,
      merged.commercial_use,
      merged.mortgage_interest,
      merged.deposit_amount,
      merged.move_in_date || null,
      merged.timeline,
      merged.alert_frequency,
      JSON.stringify(merged.alert_channels)
    ]
  );

  const profile = await loadProfile(userId);
  if (profile) {
    await db.query(
      `UPDATE property_seeker_profiles
       SET profile_completion_percent = $2,
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId, completionPercent(profile, result.rows[0])]
    );
  }

  return result.rows[0];
}

function scoreListing(row, preferences = {}) {
  let score = 0;
  const reasons = [];
  const categories = asArray(preferences.categories).map(normalizeCategory).filter(Boolean);
  const locations = asArray(preferences.preferred_locations).map((x) => x.toLowerCase());
  const propertyTypes = asArray(preferences.property_types).map((x) => x.toLowerCase());
  const listingType = normalizeCategory(row.listing_type);
  if (categories.includes(listingType)) {
    score += 30;
    reasons.push(`matches your ${listingType} search`);
  }
  const locationText = [row.area, row.district, row.address].filter(Boolean).join(' ').toLowerCase();
  if (locations.some((loc) => loc && locationText.includes(loc))) {
    score += 30;
    reasons.push('close to your preferred area');
  }
  if (preferences.max_budget && row.price && Number(row.price) <= Number(preferences.max_budget)) {
    score += 20;
    reasons.push('within your budget');
  }
  if (preferences.bedrooms && row.bedrooms && Number(row.bedrooms) >= Number(preferences.bedrooms)) {
    score += 8;
    reasons.push('fits your bedroom preference');
  }
  if (propertyTypes.includes(asText(row.property_type).toLowerCase())) {
    score += 8;
    reasons.push('matches your property type');
  }
  if (row.status === 'approved') score += 5;
  if (!reasons.length) reasons.push('new live makaug.com listing you may want to review');
  return { score, reason: reasons.slice(0, 2).join(' and ') };
}

async function fetchRecommendations(userId, preferences = {}, limit = 12) {
  const result = await db.query(
    `SELECT p.id, p.listing_type, p.title, p.description, p.district, p.area, p.address,
            p.price, p.price_period, p.bedrooms, p.bathrooms, p.property_type,
            p.status, p.created_at, p.nearest_university, p.room_type, p.students_welcome,
            img.url AS primary_image_url
     FROM properties p
     LEFT JOIN LATERAL (
       SELECT url
       FROM property_images
       WHERE property_id = p.id
       ORDER BY is_primary DESC, sort_order ASC, created_at ASC
       LIMIT 1
     ) img ON true
     WHERE p.status = 'approved'
       AND NOT EXISTS (
         SELECT 1
         FROM hidden_listings h
         WHERE h.user_id = $1 AND h.listing_id = p.id
       )
     ORDER BY p.created_at DESC
     LIMIT 100`,
    [userId]
  );

  return result.rows
    .map((row) => ({ row, ...scoreListing(row, preferences) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => propertyToCard(item.row, item.reason));
}

async function fetchOwnedListings(user = {}, limit = 24) {
  const contact = ownerContactParams(user);
  if (!contact.email && !contact.phoneDigits) return [];
  const result = await db.query(
    `SELECT p.id, p.listing_type, p.title, p.description, p.district, p.area, p.address,
            p.price, p.price_period, p.bedrooms, p.bathrooms, p.property_type,
            p.status, p.moderation_stage, p.moderation_reason, p.inquiry_reference,
            p.owner_last_edited_at, p.updated_at, p.created_at,
            img.url AS primary_image_url
     FROM properties p
     LEFT JOIN LATERAL (
       SELECT url
       FROM property_images
       WHERE property_id = p.id
       ORDER BY is_primary DESC, sort_order ASC, created_at ASC
       LIMIT 1
     ) img ON true
     WHERE ${ownerMatchSql('p', '$1', '$2')}
       AND p.status <> 'deleted'
     ORDER BY p.updated_at DESC, p.created_at DESC
     LIMIT $3`,
    [contact.email, contact.phoneDigits, limit]
  );
  return result.rows.map(ownedListingToCard);
}

async function findOwnedListing(user = {}, id = '') {
  if (!isUuid(id)) return null;
  const contact = ownerContactParams(user);
  if (!contact.email && !contact.phoneDigits) return null;
  const result = await db.query(
    `SELECT *
     FROM properties p
     WHERE p.id = $1
       AND ${ownerMatchSql('p', '$2', '$3')}
       AND p.status <> 'deleted'
     LIMIT 1`,
    [id, contact.email, contact.phoneDigits]
  );
  return result.rows[0] || null;
}

async function logOwnedListingChange({ user = {}, listing = {}, action, previousStatus = null, delivery = {} }) {
  const eventType = action === 'delete' ? 'listing_deleted_by_owner' : 'listing_updated_by_owner';
  const subject = action === 'delete'
    ? `Your makaug.com listing was removed: ${listing.title || 'property listing'}`
    : `Your makaug.com listing update is in review: ${listing.title || 'property listing'}`;
  const text = action === 'delete'
    ? [
        `Hello ${user.first_name || 'there'},`,
        '',
        `Your makaug.com listing "${listing.title || 'property listing'}" has been removed from the public site.`,
        listing.inquiry_reference ? `Reference: ${listing.inquiry_reference}` : '',
        '',
        'If this was not you, contact makaug.com support immediately.',
        'https://makaug.com/dashboard'
      ].filter(Boolean).join('\n')
    : [
        `Hello ${user.first_name || 'there'},`,
        '',
        `Your makaug.com listing "${listing.title || 'property listing'}" has been updated and sent back to review.`,
        listing.inquiry_reference ? `Reference: ${listing.inquiry_reference}` : '',
        'We will notify you after admin review.',
        '',
        'https://makaug.com/dashboard'
      ].filter(Boolean).join('\n');

  const recipientEmail = user.email || listing.lister_email || null;
  let emailDelivery = delivery.email || { sent: false, reason: 'no_email_recipient' };
  if (recipientEmail) {
    try {
      emailDelivery = await sendSupportEmail({ to: recipientEmail, subject, text });
    } catch (error) {
      emailDelivery = { sent: false, error: error.message || 'email_failed' };
    }
  }

  await Promise.allSettled([
    db.query(
      `INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, reason, notes, delivery)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
      [
        listing.id,
        user.id || 'property_finder',
        eventType,
        previousStatus,
        listing.status || null,
        action === 'delete' ? 'owner removed listing from dashboard' : 'owner edited listing from dashboard',
        'Owner dashboard action',
        JSON.stringify({ email: emailDelivery, dashboard: true })
      ]
    ),
    logActivity(user.id, eventType, {
      listing_id: listing.id,
      inquiry_reference: listing.inquiry_reference || null,
      status: listing.status || null
    }, { listingId: listing.id }),
    logEmailEvent(db, {
      eventType,
      recipientEmail,
      recipientUserId: user.id,
      recipientRole: 'property_finder',
      templateKey: eventType,
      subject,
      language: asLanguage(user.preferred_language),
      status: notificationStatusFromDelivery(emailDelivery),
      provider: emailDelivery.provider || null,
      providerMessageId: emailDelivery.messageId || emailDelivery.provider_message_id || null,
      relatedListingId: listing.id,
      failureReason: emailDelivery.error || emailDelivery.reason || null,
      sentAt: emailDelivery.sent ? new Date() : null
    }),
    logNotification(db, {
      userId: user.id || null,
      recipientEmail,
      recipientPhone: user.phone || listing.lister_phone || null,
      channel: 'email',
      type: eventType,
      status: notificationStatusFromDelivery(emailDelivery),
      payloadSummary: { title: listing.title, inquiry_reference: listing.inquiry_reference || null, action },
      relatedListingId: listing.id,
      sentAt: emailDelivery.sent ? new Date() : null,
      failureReason: emailDelivery.error || emailDelivery.reason || null
    }),
    logWhatsAppMessage(db, {
      userId: user.id || null,
      recipientPhone: user.phone || listing.lister_phone || null,
      templateKey: eventType,
      messageType: 'dashboard_action',
      language: asLanguage(user.preferred_language),
      status: 'skipped',
      relatedListingId: listing.id,
      failureReason: 'dashboard_action_logged_email_primary'
    })
  ]);

  return { email: emailDelivery };
}

async function dashboardPayload(user) {
  const profile = await upsertProfile(user, {});
  const preferences = await upsertPreferences(user.id, {});
  const [recommendations, ownedListings, saved, recent, searches, needRequests, notes, comparisons, viewings, callbacks] = await Promise.all([
    fetchRecommendations(user.id, preferences, 12),
    fetchOwnedListings(user, 24),
    db.query(
      `SELECT sl.*, p.title, p.listing_type, p.district, p.area, p.price, p.price_period,
              img.url AS primary_image_url
       FROM saved_listings sl
       JOIN properties p ON p.id = sl.listing_id
       LEFT JOIN LATERAL (
         SELECT url FROM property_images WHERE property_id = p.id ORDER BY is_primary DESC, sort_order ASC, created_at ASC LIMIT 1
       ) img ON true
       WHERE sl.user_id = $1
       ORDER BY sl.updated_at DESC
       LIMIT 24`,
      [user.id]
    ),
    db.query(
      `SELECT rv.*, p.title, p.listing_type, p.district, p.area, p.price, p.price_period,
              img.url AS primary_image_url
       FROM recently_viewed_listings rv
       JOIN properties p ON p.id = rv.listing_id
       LEFT JOIN LATERAL (
         SELECT url FROM property_images WHERE property_id = p.id ORDER BY is_primary DESC, sort_order ASC, created_at ASC LIMIT 1
       ) img ON true
       WHERE rv.user_id = $1
       ORDER BY rv.viewed_at DESC
       LIMIT 12`,
      [user.id]
    ),
    db.query('SELECT * FROM saved_searches WHERE user_id = $1 AND status = $2 ORDER BY updated_at DESC LIMIT 20', [user.id, 'active']),
    db.query('SELECT * FROM property_need_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10', [user.id]),
    db.query('SELECT * FROM listing_notes WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 50', [user.id]),
    db.query('SELECT * FROM property_comparisons WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 10', [user.id]),
    db.query(
      `SELECT vb.*, p.title, p.listing_type, p.district, p.area
       FROM viewing_bookings vb
       LEFT JOIN properties p ON p.id = vb.listing_id
       WHERE vb.user_id = $1
       ORDER BY vb.created_at DESC
       LIMIT 20`,
      [user.id]
    ),
    db.query(
      `SELECT cb.*, p.title, p.listing_type, p.district, p.area
       FROM callback_requests cb
       LEFT JOIN properties p ON p.id = cb.listing_id
       WHERE cb.user_id = $1
       ORDER BY cb.created_at DESC
       LIMIT 20`,
      [user.id]
    )
  ]);

  const nextActions = [];
  if (profile.profile_completion_percent < 80) nextActions.push('Complete your property brief so makaug.com can recommend better matches.');
  if (!searches.rows.length) nextActions.push('Create a saved search and choose WhatsApp or email alerts.');
  if (!saved.rows.length) nextActions.push('Save promising listings so you can compare and revisit them.');
  if (!nextActions.length) nextActions.push('Review today’s recommendations and book a viewing for your favourite option.');

  return {
    profile,
    preferences,
    stats: {
      recommendations: recommendations.length,
      savedListings: saved.rows.length,
      ownedListings: ownedListings.length,
      savedSearches: searches.rows.length,
      recentlyViewed: recent.rows.length,
      needRequests: needRequests.rows.length
    },
    recommendations,
    ownedListings,
    savedListings: saved.rows.map((row) => propertyToCard(row, row.note || row.list_name || 'Saved to your shortlist')),
    recentlyViewed: recent.rows.map((row) => propertyToCard(row, `Viewed ${new Date(row.viewed_at).toLocaleDateString('en-GB')}`)),
    savedSearches: searches.rows,
    needRequests: needRequests.rows,
    notes: notes.rows,
    comparisons: comparisons.rows,
    viewings: viewings.rows,
    callbacks: callbacks.rows,
    nextActions,
    insights: {
      message: 'makaug.com is using your saved preferences, searches, views, and WhatsApp-ready demand data to improve matches safely.'
    }
  };
}

router.get('/profile', requireAuth, async (req, res, next) => {
  try {
    const profile = await upsertProfile(req.userAuth, {});
    const preferences = await upsertPreferences(req.userAuth.id, {});
    return res.json({ ok: true, data: { profile, preferences } });
  } catch (error) {
    logger.error('Failed to load property seeker profile', { error: error.message, userId: req.userAuth?.id });
    return next(error);
  }
});

router.post('/onboarding', requireAuth, async (req, res, next) => {
  try {
    const profile = await upsertProfile(req.userAuth, {
      ...safeJson(req.body.profile, {}),
      ...req.body,
      onboarding_completed: req.body.onboarding_completed !== false
    });
    const preferences = await upsertPreferences(req.userAuth.id, {
      ...safeJson(req.body.preferences, {}),
      categories: req.body.categories,
      preferred_locations: req.body.preferred_locations || req.body.locations
    });

    if (req.body.create_saved_search !== false) {
      const category = normalizeCategory(preferences.categories?.[0]) || profile.current_goal || 'any';
      const location = preferences.preferred_locations?.[0] || null;
      await db.query(
        `INSERT INTO saved_searches (
           user_id, category, filters, label, location, min_price, max_price, currency,
           bedrooms, bathrooms, property_type, amenities, verification_preference,
           student_campus, alert_frequency, alert_channels, language_preference, created_from
         )
         VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16::jsonb,$17,'dashboard')
         ON CONFLICT DO NOTHING`,
        [
          req.userAuth.id,
          category,
          JSON.stringify({ categories: preferences.categories, locations: preferences.preferred_locations }),
          [category, location].filter(Boolean).join(' in ') || 'MakaUg saved search',
          location,
          preferences.min_budget,
          preferences.max_budget,
          preferences.currency,
          preferences.bedrooms,
          preferences.bathrooms,
          preferences.property_types?.[0] || null,
          JSON.stringify(preferences.amenities || []),
          preferences.verification_preference,
          preferences.campus,
          preferences.alert_frequency,
          JSON.stringify(preferences.alert_channels || ['in_app']),
          profile.preferred_language
        ]
      );
    }

    return res.json({ ok: true, data: { profile, preferences } });
  } catch (error) {
    logger.error('Failed to save property seeker onboarding', { error: error.message, userId: req.userAuth?.id });
    return next(error);
  }
});

router.patch('/profile', requireAuth, async (req, res, next) => {
  try {
    const profile = await upsertProfile(req.userAuth, req.body);
    return res.json({ ok: true, data: { profile } });
  } catch (error) {
    return next(error);
  }
});

router.patch('/preferences', requireAuth, async (req, res, next) => {
  try {
    const preferences = await upsertPreferences(req.userAuth.id, req.body);
    return res.json({ ok: true, data: { preferences } });
  } catch (error) {
    return next(error);
  }
});

router.patch('/language', requireAuth, async (req, res, next) => {
  try {
    const preferred_language = asLanguage(req.body.preferred_language || req.body.language);
    const profile = await upsertProfile(req.userAuth, { preferred_language });
    return res.json({ ok: true, data: { profile } });
  } catch (error) {
    return next(error);
  }
});

router.patch('/contact-preferences', requireAuth, async (req, res, next) => {
  try {
    const profile = await upsertProfile(req.userAuth, req.body);
    return res.json({ ok: true, data: { profile } });
  } catch (error) {
    return next(error);
  }
});

router.get('/dashboard', requireAuth, async (req, res, next) => {
  try {
    return res.json({ ok: true, data: await dashboardPayload(req.userAuth) });
  } catch (error) {
    logger.error('Failed to load property seeker dashboard', { error: error.message, userId: req.userAuth?.id });
    return next(error);
  }
});

router.get('/my-listings', requireAuth, async (req, res, next) => {
  try {
    const items = await fetchOwnedListings(req.userAuth, asInteger(req.query.limit, 50));
    return res.json({ ok: true, data: { items, total: items.length } });
  } catch (error) {
    return next(error);
  }
});

router.patch('/my-listings/:id', requireAuth, async (req, res, next) => {
  try {
    const listing = await findOwnedListing(req.userAuth, req.params.id);
    if (!listing) return res.status(404).json({ ok: false, error: 'Listing not found for this account' });

    const updates = [];
    const values = [listing.id, ownerContactParams(req.userAuth).email, ownerContactParams(req.userAuth).phoneDigits];
    const add = (column, value) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };

    const title = asText(req.body.title);
    const description = asText(req.body.description);
    const district = asText(req.body.district);
    const area = asText(req.body.area);
    const address = asText(req.body.address);
    const propertyType = asText(req.body.property_type || req.body.propertyType);
    const pricePeriod = asText(req.body.price_period || req.body.pricePeriod);
    const price = asBigIntNumber(req.body.price, null);
    const bedrooms = asInteger(req.body.bedrooms, null);
    const bathrooms = asInteger(req.body.bathrooms, null);

    if (title) add('title', title);
    if (description) add('description', description);
    if (district) add('district', district);
    if (area) add('area', area);
    if (address) add('address', address);
    if (propertyType) add('property_type', propertyType);
    if (pricePeriod) add('price_period', pricePeriod);
    if (price !== null) add('price', price);
    if (bedrooms !== null) add('bedrooms', bedrooms);
    if (bathrooms !== null) add('bathrooms', bathrooms);

    if (!updates.length) return res.status(400).json({ ok: false, error: 'No valid listing changes supplied' });

    values.push(JSON.stringify({
      owner_dashboard_updated_by: req.userAuth.id,
      owner_dashboard_updated_at: new Date().toISOString()
    }));
    updates.push(`extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $${values.length}::jsonb`);
    updates.push(`status = CASE WHEN status = 'approved' THEN 'pending' ELSE status END`);
    updates.push(`moderation_stage = 'owner_updated'`);
    updates.push(`owner_last_edited_at = NOW()`);
    updates.push(`updated_at = NOW()`);

    const updateResult = await db.query(
      `UPDATE properties p
       SET ${updates.join(', ')}
       WHERE p.id = $1
         AND ${ownerMatchSql('p', '$2', '$3')}
         AND p.status <> 'deleted'
       RETURNING p.*`,
      values
    );
    const updated = updateResult.rows[0];
    const delivery = await logOwnedListingChange({
      user: req.userAuth,
      listing: updated,
      action: 'update',
      previousStatus: listing.status
    });
    return res.json({ ok: true, data: { listing: ownedListingToCard(updated), delivery } });
  } catch (error) {
    return next(error);
  }
});

router.delete('/my-listings/:id', requireAuth, async (req, res, next) => {
  try {
    const listing = await findOwnedListing(req.userAuth, req.params.id);
    if (!listing) return res.status(404).json({ ok: false, error: 'Listing not found for this account' });

    const contact = ownerContactParams(req.userAuth);
    const updateResult = await db.query(
      `UPDATE properties p
       SET status = 'deleted',
           moderation_stage = 'owner_deleted',
           owner_last_edited_at = NOW(),
           updated_at = NOW(),
           extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $4::jsonb
       WHERE p.id = $1
         AND ${ownerMatchSql('p', '$2', '$3')}
         AND p.status <> 'deleted'
       RETURNING p.*`,
      [
        listing.id,
        contact.email,
        contact.phoneDigits,
        JSON.stringify({
          owner_deleted_by_user_id: req.userAuth.id,
          owner_deleted_at: new Date().toISOString()
        })
      ]
    );
    const updated = updateResult.rows[0];
    const delivery = await logOwnedListingChange({
      user: req.userAuth,
      listing: updated,
      action: 'delete',
      previousStatus: listing.status
    });
    return res.json({ ok: true, data: { listing: ownedListingToCard(updated), delivery } });
  } catch (error) {
    return next(error);
  }
});

router.get('/recommendations', requireAuth, async (req, res, next) => {
  try {
    const preferences = await upsertPreferences(req.userAuth.id, {});
    const recommendations = await fetchRecommendations(req.userAuth.id, preferences, asInteger(req.query.limit, 12));
    return res.json({ ok: true, data: { recommendations } });
  } catch (error) {
    return next(error);
  }
});

router.get('/insights', requireAuth, async (req, res, next) => {
  try {
    const preferences = await upsertPreferences(req.userAuth.id, {});
    const location = preferences.preferred_locations?.[0] || null;
    const locationFilter = location ? `%${location}%` : null;
    const result = await db.query(
      `SELECT listing_type, COUNT(*)::int AS total, MIN(price) AS min_price, MAX(price) AS max_price
       FROM properties
       WHERE status = 'approved'
         AND ($1::text IS NULL OR district ILIKE $1 OR area ILIKE $1 OR address ILIKE $1)
       GROUP BY listing_type
       ORDER BY total DESC`,
      [locationFilter]
    );
    return res.json({
      ok: true,
      data: {
        location,
        rows: result.rows,
        note: 'Insights are based on available MakaUg listings and user demand.'
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/next-actions', requireAuth, async (req, res, next) => {
  try {
    const payload = await dashboardPayload(req.userAuth);
    return res.json({ ok: true, data: { nextActions: payload.nextActions } });
  } catch (error) {
    return next(error);
  }
});

router.post('/activity', optionalAuth, async (req, res, next) => {
  try {
    const activityType = asText(req.body.activity_type || req.body.activityType);
    if (!activityType) return res.status(400).json({ ok: false, error: 'activity_type is required' });
    const listingId = isUuid(req.body.listing_id || req.body.listingId) ? (req.body.listing_id || req.body.listingId) : null;
    const searchId = isUuid(req.body.search_id || req.body.searchId) ? (req.body.search_id || req.body.searchId) : null;
    const result = await db.query(
      `INSERT INTO property_seeker_activities (user_id, guest_session_id, activity_type, listing_id, search_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       RETURNING *`,
      [
        req.userAuth?.id || null,
        asText(req.body.guest_session_id || req.body.guestSessionId) || null,
        activityType,
        listingId,
        searchId,
        JSON.stringify(safeJson(req.body.metadata, {}))
      ]
    );
    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/need-request', optionalAuth, async (req, res, next) => {
  try {
    const preferredContactChannel = asContactChannel(req.body.preferred_contact_channel || req.body.preferredContactChannel, 'whatsapp');
    const language = asLanguage(req.body.language || req.body.preferred_language || req.userAuth?.preferred_language);
    const result = await db.query(
      `INSERT INTO property_need_requests (
         user_id, source, category, location, budget, currency, bedrooms, property_type,
         campus, land_title_preference, message, urgency, preferred_contact_channel, language
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        req.userAuth?.id || null,
        asText(req.body.source, 'dashboard'),
        normalizeCategory(req.body.category || req.body.goal) || null,
        asText(req.body.location) || null,
        asBigIntNumber(req.body.budget),
        asText(req.body.currency, 'UGX').toUpperCase().slice(0, 8),
        asInteger(req.body.bedrooms),
        asText(req.body.property_type || req.body.propertyType) || null,
        asText(req.body.campus) || null,
        asText(req.body.land_title_preference || req.body.landTitlePreference) || null,
        asText(req.body.message) || null,
        asText(req.body.urgency) || null,
        preferredContactChannel,
        language
      ]
    );
    const item = result.rows[0];
    const requesterName = req.userAuth ? [req.userAuth.first_name, req.userAuth.last_name].filter(Boolean).join(' ') : asText(req.body.name);
    const requesterEmail = asText(req.body.email || req.userAuth?.email) || null;
    const requesterPhone = asText(req.body.phone || req.userAuth?.phone) || null;
    const responseTarget = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const lead = await createLead(db, {
      userId: req.userAuth?.id || null,
      contact: {
        userId: req.userAuth?.id || null,
        name: requesterName,
        phone: requesterPhone,
        email: requesterEmail,
        preferredContactChannel: item.preferred_contact_channel,
        preferredLanguage: item.language,
        roleType: 'property_seeker',
        locationInterest: item.location,
        categoryInterest: item.category,
        budgetRange: item.budget ? String(item.budget) : ''
      },
      source: item.source || 'property_need_request',
      leadType: 'property_need_request',
      category: item.category,
      location: item.location,
      budget: item.budget,
      message: item.message,
      priority: item.urgency === 'immediately' ? 'high' : 'normal',
      nextFollowUpAt: responseTarget.toISOString(),
      activityType: 'property_need_request_created',
      activityMessage: 'Property need request submitted from property finder dashboard',
      metadata: {
        property_need_request_id: item.id,
        request_status: item.status,
        urgency: item.urgency,
        bedrooms: item.bedrooms,
        property_type: item.property_type,
        preferred_contact_channel: item.preferred_contact_channel,
        response_target_hours: 48,
        summary: asText(req.body.summary)
      }
    });
    if (lead?.contact_id) {
      await db.query('UPDATE property_need_requests SET contact_id = $1 WHERE id = $2', [lead.contact_id, item.id]);
      item.contact_id = lead.contact_id;
    }
    await logActivity(req.userAuth?.id || null, 'property_need_request_created', { property_need_request_id: item.id }, { leadId: lead?.id || null });
    const userSubject = 'Your makaug.com property request is now being tracked';
    const adminSubject = 'New makaug.com property need request';
    const requestText = [
      `Request: ${item.category || 'property'} in ${item.location || 'any area'}`,
      item.budget ? `Budget: USh ${Number(item.budget).toLocaleString('en-UG')}` : '',
      item.bedrooms ? `Bedrooms: ${item.bedrooms}` : '',
      item.urgency ? `Timing: ${item.urgency}` : '',
      `Preferred reply: ${item.preferred_contact_channel}`,
      item.message ? `Notes: ${item.message}` : '',
      `Status: ${item.status}`,
      `Reference: ${item.id}`
    ].filter(Boolean).join('\n');
    let userDelivery = {
      sent: false,
      skipped: true,
      reason: preferredContactChannel === 'email' ? 'no_email_recipient' : 'no_whatsapp_recipient'
    };
    let userDeliveryChannel = preferredContactChannel === 'email' ? 'email' : 'whatsapp';
    let adminDelivery = { sent: false, reason: 'not_attempted' };
    try {
      if (preferredContactChannel === 'email' && requesterEmail) {
        userDelivery = await sendSupportEmail({
          to: requesterEmail,
          subject: userSubject,
          text: [
            `Hello ${requesterName || 'there'},`,
            '',
            'We received your makaug.com property request and marked it as unresolved while the team searches.',
            'Target follow-up: within 24-48 hours.',
            '',
            requestText,
            '',
            'You can see your request status in your Property Finder dashboard.'
          ].join('\n')
        });
      } else if (preferredContactChannel === 'whatsapp' && requesterPhone) {
        userDelivery = await sendWhatsAppText({
          to: requesterPhone,
          body: [
            `Hi ${requesterName || 'there'}, makaug.com has received your property request.`,
            'Status: unresolved while our team searches.',
            'Target follow-up: within 24-48 hours.',
            '',
            requestText
          ].join('\n')
        });
      } else if (preferredContactChannel === 'email') {
        userDelivery = { sent: false, skipped: true, reason: 'no_email_recipient' };
      } else {
        userDelivery = { sent: false, skipped: true, reason: 'no_whatsapp_recipient' };
      }
	    } catch (deliveryError) {
	      logger.warn('Property need request user notification failed', { error: deliveryError.message, leadId: lead?.id || null, channel: userDeliveryChannel });
	      userDelivery = { sent: false, error: deliveryError.message || 'delivery_failed' };
	    }
	    try {
	      adminDelivery = await sendSupportEmail({
	        to: getSupportEmail(),
	        subject: adminSubject,
	        text: [
	          'A property finder could not find what they need.',
	          '',
	          requestText,
	          '',
	          requesterName ? `Name: ${requesterName}` : '',
	          requesterEmail ? `Email: ${requesterEmail}` : '',
	          requesterPhone ? `Phone: ${requesterPhone}` : '',
	          lead?.id ? `CRM lead: ${lead.id}` : '',
	          '',
	          'Admin action: review in CRM/leads, assign an agent, then mark resolved when completed.'
	        ].filter(Boolean).join('\n'),
	        replyTo: requesterEmail || undefined
	      });
	    } catch (adminEmailError) {
	      logger.warn('Property need request admin notification failed', { error: adminEmailError.message, leadId: lead?.id || null });
	      adminDelivery = { sent: false, error: adminEmailError.message || 'admin_email_failed' };
	    }
    const userDeliveryStatus = userDeliveryChannel === 'whatsapp' && userDelivery.reason === 'no_whatsapp_provider_configured'
      ? 'provider_missing'
      : notificationStatusFromDelivery(userDelivery);
    await Promise.allSettled([
      logEmailEvent(db, {
        eventType: 'property_need_request_submitted',
        recipientEmail: requesterEmail,
        recipientUserId: req.userAuth?.id || null,
        recipientRole: 'property_finder',
        templateKey: 'property_need_request_user_confirmation',
        subject: userSubject,
        language,
        status: userDeliveryChannel === 'email' ? userDeliveryStatus : 'skipped',
        provider: userDelivery.provider || null,
        providerMessageId: userDelivery.messageId || userDelivery.provider_message_id || null,
        relatedLeadId: lead?.id || null,
        failureReason: userDeliveryChannel === 'email' ? (userDelivery.error || userDelivery.reason || null) : 'preferred_channel_whatsapp',
        sentAt: userDeliveryChannel === 'email' && userDelivery.sent ? new Date() : null
      }),
      logEmailEvent(db, {
        eventType: 'property_need_request_submitted_admin',
        recipientEmail: getSupportEmail(),
        recipientRole: 'admin',
        templateKey: 'property_need_request_admin_alert',
        subject: adminSubject,
        language,
        status: notificationStatusFromDelivery(adminDelivery),
        provider: adminDelivery.provider || null,
        providerMessageId: adminDelivery.messageId || adminDelivery.provider_message_id || null,
        relatedLeadId: lead?.id || null,
        failureReason: adminDelivery.error || adminDelivery.reason || null,
        sentAt: adminDelivery.sent ? new Date() : null
      }),
      logNotification(db, {
        userId: req.userAuth?.id || null,
        recipientEmail: userDeliveryChannel === 'email' ? requesterEmail : null,
        recipientPhone: userDeliveryChannel === 'whatsapp' ? requesterPhone : null,
        channel: userDeliveryChannel,
        type: 'property_need_request_submitted',
        status: userDeliveryStatus,
        payloadSummary: {
          property_need_request_id: item.id,
          category: item.category,
          location: item.location,
          status: item.status,
          preferred_contact_channel: item.preferred_contact_channel,
          response_target_hours: 48
        },
        relatedLeadId: lead?.id || null,
        sentAt: userDelivery.sent ? new Date() : null,
        failureReason: userDelivery.error || userDelivery.reason || null
      }),
      logNotification(db, {
        userId: req.userAuth?.id || null,
        recipientEmail: getSupportEmail(),
        channel: 'email',
        type: 'property_need_request_admin_alert',
        status: notificationStatusFromDelivery(adminDelivery),
        payloadSummary: {
          property_need_request_id: item.id,
          category: item.category,
          location: item.location,
          preferred_contact_channel: item.preferred_contact_channel
        },
        relatedLeadId: lead?.id || null,
        sentAt: adminDelivery.sent ? new Date() : null,
        failureReason: adminDelivery.error || adminDelivery.reason || null
      }),
      logWhatsAppMessage(db, {
        userId: req.userAuth?.id || null,
        recipientPhone: requesterPhone,
        templateKey: 'property_need_request_submitted',
        messageType: 'property_need_request',
        language,
        status: userDeliveryChannel === 'whatsapp' ? userDeliveryStatus : 'skipped',
        failureReason: userDeliveryChannel === 'whatsapp'
          ? (userDelivery.error || userDelivery.reason || null)
          : 'preferred_channel_not_whatsapp',
        relatedLeadId: lead?.id || null,
        sentAt: userDeliveryChannel === 'whatsapp' && userDelivery.sent ? new Date() : null
      })
    ]);
    return res.status(201).json({
      ok: true,
      data: {
        ...item,
        lead_id: lead?.id || null,
        response_target_hours: 48,
        delivery: {
          userChannel: userDeliveryChannel,
          user: userDeliveryStatus,
          adminEmail: notificationStatusFromDelivery(adminDelivery)
        }
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/need-request', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query(
      'SELECT * FROM property_need_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.userAuth.id]
    );
    return res.json({ ok: true, data: { items: result.rows, total: result.rows.length } });
  } catch (error) {
    return next(error);
  }
});

router.get('/saved-searches', requireAuth, async (req, res, next) => {
  try {
    const status = asText(req.query.status, 'active');
    const result = await db.query(
      `SELECT *
       FROM saved_searches
       WHERE user_id = $1
         AND ($2::text = 'all' OR status = $2)
       ORDER BY updated_at DESC
       LIMIT 100`,
      [req.userAuth.id, status]
    );
    return res.json({ ok: true, data: { items: result.rows, total: result.rows.length } });
  } catch (error) {
    return next(error);
  }
});

router.post('/saved-searches', requireAuth, async (req, res, next) => {
  try {
    const incomingLocation = req.body.location || req.body.locationObject || req.body.filters?.location || (
      req.body.lat || req.body.latitude || req.body.lng || req.body.longitude
        ? {
            query: req.body.query,
            latitude: req.body.latitude || req.body.lat,
            longitude: req.body.longitude || req.body.lng,
            lat: req.body.lat || req.body.latitude,
            lng: req.body.lng || req.body.longitude,
            radiusKm: req.body.radiusKm || req.body.radius_km,
            radiusMiles: req.body.radiusMiles || req.body.radius_miles || req.body.radius,
            radiusUnit: req.body.radiusUnit || req.body.radius_unit || 'miles',
            source: req.body.source || req.body.created_from || req.body.createdFrom,
            language: req.body.language || req.body.language_preference || req.body.languagePreference
          }
        : req.body.query
    );
    const locationObject = normalizeLocationObject(incomingLocation);
    const category = normalizeCategory(req.body.category || req.body.listing_type || req.body.listingType) || 'any';
    const filters = {
      ...safeJson(req.body.filters, {}),
      location: locationObject,
      category,
      query: asText(req.body.query || req.body.search || req.body.area) || null,
      propertyType: asText(req.body.property_type || req.body.propertyType) || null,
      minPrice: asBigIntNumber(req.body.min_price || req.body.minPrice || req.body.minBudget),
      maxPrice: asBigIntNumber(req.body.max_price || req.body.maxPrice || req.body.maxBudget || req.body.budget),
      currency: asText(req.body.currency, 'UGX').toUpperCase().slice(0, 8),
      bedrooms: asInteger(req.body.bedrooms),
      bathrooms: asInteger(req.body.bathrooms),
      amenities: asArray(req.body.amenities),
      studentCampus: asText(req.body.student_campus || req.body.studentCampus || req.body.campus) || null,
      landTitleType: asText(req.body.land_title_type || req.body.landTitleType) || null,
      commercialType: asText(req.body.commercial_type || req.body.commercialType || req.body.commercial_subtype || req.body.commercialSubtype) || null,
      radiusKm: locationObject?.radiusKm || null,
      radiusMiles: locationObject?.radiusMiles || null,
      language: asLanguage(req.body.language_preference || req.body.languagePreference || req.body.language || req.userAuth.preferred_language),
      createdFrom: asText(req.body.created_from || req.body.createdFrom, 'web')
    };
    const alertChannels = normalizeAlertChannels(req.body.alert_channels || req.body.alertChannels);
    const result = await db.query(
      `INSERT INTO saved_searches (
         user_id, guest_session_id, phone, category, filters, label, location,
         min_price, max_price, currency, bedrooms, bathrooms, property_type,
         amenities, verification_preference, student_campus, student_distance,
         land_title_type, land_size, commercial_subtype, alert_frequency,
         alert_channels, language_preference, status, created_from
       )
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20,$21,$22::jsonb,$23,$24,$25)
       RETURNING *`,
      [
        req.userAuth.id,
        asText(req.body.guest_session_id || req.body.guestSessionId) || null,
        asText(req.body.phone || req.userAuth.phone) || null,
        category,
        JSON.stringify(filters),
        asText(req.body.label || req.body.title) || [category, locationLabel(locationObject)].filter(Boolean).join(' in ') || 'MakaUg saved search',
        locationLabel(locationObject),
        asBigIntNumber(req.body.min_price || req.body.minPrice || req.body.minBudget),
        asBigIntNumber(req.body.max_price || req.body.maxPrice || req.body.maxBudget || req.body.budget),
        asText(req.body.currency, 'UGX').toUpperCase().slice(0, 8),
        asInteger(req.body.bedrooms),
        asInteger(req.body.bathrooms),
        asText(req.body.property_type || req.body.propertyType) || null,
        JSON.stringify(asArray(req.body.amenities)),
        asText(req.body.verification_preference || req.body.verificationPreference) || null,
        asText(req.body.student_campus || req.body.studentCampus || req.body.campus) || null,
        asInteger(req.body.student_distance || req.body.studentDistance),
        asText(req.body.land_title_type || req.body.landTitleType) || null,
        asText(req.body.land_size || req.body.landSize) || null,
        asText(req.body.commercial_subtype || req.body.commercialSubtype) || null,
        normalizeAlertFrequency(req.body.alert_frequency || req.body.alertFrequency),
        JSON.stringify(alertChannels),
        asLanguage(req.body.language_preference || req.body.languagePreference || req.userAuth.preferred_language),
        'active',
        asText(req.body.created_from || req.body.createdFrom, 'web')
      ]
    );
    const savedSearch = result.rows[0];
    await logActivity(req.userAuth.id, 'saved_search_created', { saved_search_id: savedSearch.id, filters }, { searchId: savedSearch.id });
    await logNotification(db, {
      userId: req.userAuth.id,
      recipientPhone: req.userAuth.phone,
      recipientEmail: req.userAuth.email,
      channel: 'in_app',
      type: 'saved_search_created',
      status: 'logged',
      relatedSavedSearchId: savedSearch.id,
      payloadSummary: {
        label: savedSearch.label,
        category: savedSearch.category,
        location: savedSearch.location,
        alert_channels: alertChannels
      }
    });
    await createLead(db, {
      userId: req.userAuth.id,
      contact: {
        userId: req.userAuth.id,
        name: [req.userAuth.first_name, req.userAuth.last_name].filter(Boolean).join(' '),
        phone: req.userAuth.phone,
        email: req.userAuth.email,
        preferredContactChannel: req.userAuth.preferred_contact_channel,
        preferredLanguage: req.userAuth.preferred_language,
        roleType: 'property_seeker',
        locationInterest: savedSearch.location,
        categoryInterest: savedSearch.category,
        budgetRange: savedSearch.max_price ? String(savedSearch.max_price) : ''
      },
      source: 'saved_search',
      leadType: 'saved_search',
      category: savedSearch.category,
      location: savedSearch.location,
      budget: savedSearch.max_price,
      message: `Saved search created: ${savedSearch.label || savedSearch.category}`,
      metadata: { saved_search_id: savedSearch.id }
    });
    return res.status(201).json({ ok: true, data: savedSearch });
  } catch (error) {
    return next(error);
  }
});

router.patch('/saved-searches/:id', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'Invalid saved search id' });
    const updates = [];
    const values = [req.userAuth.id, id];
    const add = (field, value, cast = '') => {
      values.push(value);
      updates.push(`${field} = $${values.length}${cast}`);
    };
    if (Object.prototype.hasOwnProperty.call(req.body, 'label')) add('label', asText(req.body.label) || null);
    if (Object.prototype.hasOwnProperty.call(req.body, 'status')) {
      const status = asText(req.body.status, 'active').toLowerCase();
      if (!['active', 'paused', 'deleted'].includes(status)) return res.status(400).json({ ok: false, error: 'Invalid saved search status' });
      add('status', status);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'alert_frequency') || Object.prototype.hasOwnProperty.call(req.body, 'alertFrequency')) {
      add('alert_frequency', normalizeAlertFrequency(req.body.alert_frequency || req.body.alertFrequency));
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'alert_channels') || Object.prototype.hasOwnProperty.call(req.body, 'alertChannels')) {
      add('alert_channels', JSON.stringify(normalizeAlertChannels(req.body.alert_channels || req.body.alertChannels)), '::jsonb');
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'location') || Object.prototype.hasOwnProperty.call(req.body, 'filters')) {
      const current = await db.query('SELECT filters FROM saved_searches WHERE user_id = $1 AND id = $2 LIMIT 1', [req.userAuth.id, id]);
      if (!current.rows.length) return res.status(404).json({ ok: false, error: 'Saved search not found' });
      const locationObject = normalizeLocationObject(req.body.location || req.body.filters?.location);
      const filters = {
        ...safeJson(current.rows[0].filters, {}),
        ...safeJson(req.body.filters, {}),
        ...(Object.keys(locationObject).length ? { location: locationObject } : {})
      };
      add('filters', JSON.stringify(filters), '::jsonb');
      if (Object.keys(locationObject).length) add('location', locationLabel(locationObject));
    }
    if (!updates.length) return res.status(400).json({ ok: false, error: 'No saved search updates provided' });
    const result = await db.query(
      `UPDATE saved_searches
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE user_id = $1 AND id = $2
       RETURNING *`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Saved search not found' });
    await logActivity(req.userAuth.id, 'saved_search_updated', { saved_search_id: id }, { searchId: id });
    return res.json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.delete('/saved-searches/:id', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'Invalid saved search id' });
    const result = await db.query(
      `UPDATE saved_searches
       SET status = 'deleted', updated_at = NOW()
       WHERE user_id = $1 AND id = $2
       RETURNING id`,
      [req.userAuth.id, id]
    );
    await logActivity(req.userAuth.id, 'saved_search_deleted', { saved_search_id: id }, { searchId: id });
    return res.json({ ok: true, data: { removed: result.rowCount > 0 } });
  } catch (error) {
    return next(error);
  }
});

router.get('/saved-listings', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT sl.*, p.title, p.listing_type, p.district, p.area, p.price, p.price_period,
              img.url AS primary_image_url
       FROM saved_listings sl
       JOIN properties p ON p.id = sl.listing_id
       LEFT JOIN LATERAL (
         SELECT url FROM property_images WHERE property_id = p.id ORDER BY is_primary DESC, sort_order ASC, created_at ASC LIMIT 1
       ) img ON true
       WHERE sl.user_id = $1
       ORDER BY sl.updated_at DESC`,
      [req.userAuth.id]
    );
    return res.json({ ok: true, data: { items: result.rows.map((row) => propertyToCard(row, row.note || row.list_name)), total: result.rows.length } });
  } catch (error) {
    return next(error);
  }
});

router.post('/saved-listings', requireAuth, async (req, res, next) => {
  try {
    const listingId = req.body.listing_id || req.body.listingId;
    if (!isUuid(listingId)) return res.status(400).json({ ok: false, error: 'Valid listing_id is required' });
    const result = await db.query(
      `INSERT INTO saved_listings (user_id, listing_id, list_name, note, status)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, listing_id)
       DO UPDATE SET list_name = EXCLUDED.list_name, note = EXCLUDED.note, status = EXCLUDED.status, updated_at = NOW()
       RETURNING *`,
      [
        req.userAuth.id,
        listingId,
        asText(req.body.list_name || req.body.listName, 'Shortlist'),
        asText(req.body.note) || null,
        asText(req.body.status, 'saved')
      ]
    );
    await logActivity(req.userAuth.id, 'save_listing', { saved_listing_id: result.rows[0]?.id }, { listingId });
    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.delete('/saved-listings/:id', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'Invalid saved listing id' });
    const result = await db.query('DELETE FROM saved_listings WHERE user_id = $1 AND id = $2 RETURNING id', [req.userAuth.id, id]);
    await logActivity(req.userAuth.id, 'saved_listing_removed', { saved_listing_id: id });
    return res.json({ ok: true, data: { removed: result.rowCount > 0 } });
  } catch (error) {
    return next(error);
  }
});

router.post('/listing-notes', requireAuth, async (req, res, next) => {
  try {
    const listingId = req.body.listing_id || req.body.listingId;
    const note = asText(req.body.note);
    if (!isUuid(listingId) || !note) return res.status(400).json({ ok: false, error: 'listing_id and note are required' });
    const result = await db.query(
      `INSERT INTO listing_notes (user_id, listing_id, note)
       VALUES ($1,$2,$3)
       RETURNING *`,
      [req.userAuth.id, listingId, note]
    );
    await logActivity(req.userAuth.id, 'add_note', { note_id: result.rows[0]?.id }, { listingId });
    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/listing-notes', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM listing_notes WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100', [req.userAuth.id]);
    return res.json({ ok: true, data: { items: result.rows, total: result.rows.length } });
  } catch (error) {
    return next(error);
  }
});

router.patch('/listing-notes/:id', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    const note = asText(req.body.note);
    if (!isUuid(id) || !note) return res.status(400).json({ ok: false, error: 'Valid note id and note are required' });
    const result = await db.query(
      `UPDATE listing_notes
       SET note = $3, updated_at = NOW()
       WHERE user_id = $1 AND id = $2
       RETURNING *`,
      [req.userAuth.id, id, note]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Listing note not found' });
    await logActivity(req.userAuth.id, 'note_updated', { note_id: id }, { listingId: result.rows[0].listing_id });
    return res.json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.delete('/listing-notes/:id', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'Invalid note id' });
    const result = await db.query('DELETE FROM listing_notes WHERE user_id = $1 AND id = $2 RETURNING listing_id', [req.userAuth.id, id]);
    await logActivity(req.userAuth.id, 'note_deleted', { note_id: id }, { listingId: result.rows[0]?.listing_id || null });
    return res.json({ ok: true, data: { removed: result.rowCount > 0 } });
  } catch (error) {
    return next(error);
  }
});

router.get('/hidden-listings', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT h.*, p.title, p.listing_type, p.district, p.area
       FROM hidden_listings h
       JOIN properties p ON p.id = h.listing_id
       WHERE h.user_id = $1
       ORDER BY h.created_at DESC`,
      [req.userAuth.id]
    );
    return res.json({ ok: true, data: { items: result.rows, total: result.rows.length } });
  } catch (error) {
    return next(error);
  }
});

router.post('/hidden-listings', requireAuth, async (req, res, next) => {
  try {
    const listingId = req.body.listing_id || req.body.listingId;
    if (!isUuid(listingId)) return res.status(400).json({ ok: false, error: 'Valid listing_id is required' });
    const result = await db.query(
      `INSERT INTO hidden_listings (user_id, listing_id, reason)
       VALUES ($1,$2,$3)
       ON CONFLICT (user_id, listing_id)
       DO UPDATE SET reason = EXCLUDED.reason
       RETURNING *`,
      [req.userAuth.id, listingId, asText(req.body.reason) || null]
    );
    await logActivity(req.userAuth.id, 'hide_listing', { reason: result.rows[0]?.reason || null }, { listingId });
    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.delete('/hidden-listings/:id', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'Invalid hidden listing id' });
    const result = await db.query('DELETE FROM hidden_listings WHERE user_id = $1 AND id = $2 RETURNING listing_id', [req.userAuth.id, id]);
    await logActivity(req.userAuth.id, 'unhide_listing', { hidden_listing_id: id }, { listingId: result.rows[0]?.listing_id || null });
    return res.json({ ok: true, data: { removed: result.rowCount > 0 } });
  } catch (error) {
    return next(error);
  }
});

router.get('/property-comparison', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM property_comparisons WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 20', [req.userAuth.id]);
    return res.json({ ok: true, data: { items: result.rows, total: result.rows.length } });
  } catch (error) {
    return next(error);
  }
});

router.post('/property-comparison', requireAuth, async (req, res, next) => {
  try {
    const listingIds = asArray(req.body.listing_ids || req.body.listingIds).filter(isUuid).slice(0, 4);
    if (!listingIds.length) return res.status(400).json({ ok: false, error: 'At least one valid listing id is required' });
    const result = await db.query(
      `INSERT INTO property_comparisons (user_id, listing_ids, name)
       VALUES ($1,$2::jsonb,$3)
       RETURNING *`,
      [req.userAuth.id, JSON.stringify(listingIds), asText(req.body.name) || null]
    );
    await logActivity(req.userAuth.id, 'compare_listing', { comparison_id: result.rows[0]?.id, listing_ids: listingIds });
    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/property-comparison/:id', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'Invalid comparison id' });
    const listingIds = asArray(req.body.listing_ids || req.body.listingIds).filter(isUuid).slice(0, 4);
    const result = await db.query(
      `UPDATE property_comparisons
       SET listing_ids = COALESCE($3::jsonb, listing_ids),
           name = COALESCE($4, name),
           updated_at = NOW()
       WHERE user_id = $1 AND id = $2
       RETURNING *`,
      [
        req.userAuth.id,
        id,
        listingIds.length ? JSON.stringify(listingIds) : null,
        Object.prototype.hasOwnProperty.call(req.body, 'name') ? asText(req.body.name) || null : null
      ]
    );
    if (!result.rows.length) return res.status(404).json({ ok: false, error: 'Comparison not found' });
    await logActivity(req.userAuth.id, 'compare_updated', { comparison_id: id, listing_ids: listingIds });
    return res.json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.delete('/property-comparison/:id', requireAuth, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!isUuid(id)) return res.status(400).json({ ok: false, error: 'Invalid comparison id' });
    const result = await db.query('DELETE FROM property_comparisons WHERE user_id = $1 AND id = $2 RETURNING id', [req.userAuth.id, id]);
    await logActivity(req.userAuth.id, 'compare_deleted', { comparison_id: id });
    return res.json({ ok: true, data: { removed: result.rowCount > 0 } });
  } catch (error) {
    return next(error);
  }
});

router.post('/recently-viewed', optionalAuth, async (req, res, next) => {
  try {
    const listingId = req.body.listing_id || req.body.listingId;
    if (!isUuid(listingId)) return res.status(400).json({ ok: false, error: 'Valid listing_id is required' });
    const result = await db.query(
      `INSERT INTO recently_viewed_listings (user_id, guest_session_id, listing_id, source)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [req.userAuth?.id || null, asText(req.body.guest_session_id || req.body.guestSessionId) || null, listingId, asText(req.body.source, 'web')]
    );
    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/recently-viewed', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT rv.*, p.title, p.listing_type, p.district, p.area, p.price, p.price_period
       FROM recently_viewed_listings rv
       JOIN properties p ON p.id = rv.listing_id
       WHERE rv.user_id = $1
       ORDER BY rv.viewed_at DESC
       LIMIT 50`,
      [req.userAuth.id]
    );
    return res.json({ ok: true, data: { items: result.rows, total: result.rows.length } });
  } catch (error) {
    return next(error);
  }
});

router.get('/viewing-config/:listingId', optionalAuth, async (req, res, next) => {
  try {
    const listingId = req.params.listingId;
    if (!isUuid(listingId)) return res.status(400).json({ ok: false, error: 'Invalid listing id' });
    const result = await db.query(
      `SELECT *
       FROM viewing_configs
       WHERE listing_id = $1
       LIMIT 1`,
      [listingId]
    );
    return res.json({
      ok: true,
      data: result.rows[0] || {
        listing_id: listingId,
        accepts_viewings: false,
        booking_mode: 'disabled',
        contact_method: 'whatsapp'
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/viewing-config', requireAuth, async (req, res, next) => {
  try {
    const listingId = req.body.listing_id || req.body.listingId;
    if (!isUuid(listingId)) return res.status(400).json({ ok: false, error: 'Valid listing_id is required' });
    const bookingMode = asText(req.body.booking_mode || req.body.bookingMode, req.body.accepts_viewings === false ? 'disabled' : 'request_only').toLowerCase();
    const allowedModes = ['request_only', 'manual_confirm', 'auto_confirm_slots', 'open_house_only', 'callback_only', 'disabled'];
    const mode = allowedModes.includes(bookingMode) ? bookingMode : 'request_only';
    const result = await db.query(
      `INSERT INTO viewing_configs (
         listing_id, accepts_viewings, booking_mode, manager_type, manager_user_id,
         contact_method, available_days, available_time_windows, notice_period_hours,
         max_bookings_per_slot, blackout_dates, open_house_enabled,
         public_instructions, private_instructions, language_preference
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11::jsonb,$12,$13,$14,$15)
       ON CONFLICT (listing_id)
       DO UPDATE SET
         accepts_viewings = EXCLUDED.accepts_viewings,
         booking_mode = EXCLUDED.booking_mode,
         manager_type = EXCLUDED.manager_type,
         manager_user_id = EXCLUDED.manager_user_id,
         contact_method = EXCLUDED.contact_method,
         available_days = EXCLUDED.available_days,
         available_time_windows = EXCLUDED.available_time_windows,
         notice_period_hours = EXCLUDED.notice_period_hours,
         max_bookings_per_slot = EXCLUDED.max_bookings_per_slot,
         blackout_dates = EXCLUDED.blackout_dates,
         open_house_enabled = EXCLUDED.open_house_enabled,
         public_instructions = EXCLUDED.public_instructions,
         private_instructions = EXCLUDED.private_instructions,
         language_preference = EXCLUDED.language_preference,
         updated_at = NOW()
       RETURNING *`,
      [
        listingId,
        mode !== 'disabled' && asBoolean(req.body.accepts_viewings ?? req.body.acceptsViewings, true),
        mode,
        asText(req.body.manager_type || req.body.managerType, 'owner'),
        req.body.manager_user_id || req.body.managerUserId || req.userAuth.id,
        asContactChannel(req.body.contact_method || req.body.contactMethod, 'whatsapp'),
        JSON.stringify(asArray(req.body.available_days || req.body.availableDays)),
        JSON.stringify(safeJson(req.body.available_time_windows || req.body.availableTimeWindows, [])),
        asInteger(req.body.notice_period_hours || req.body.noticePeriodHours, 24),
        asInteger(req.body.max_bookings_per_slot || req.body.maxBookingsPerSlot, 1),
        JSON.stringify(asArray(req.body.blackout_dates || req.body.blackoutDates)),
        asBoolean(req.body.open_house_enabled || req.body.openHouseEnabled, false),
        asText(req.body.public_instructions || req.body.publicInstructions) || null,
        asText(req.body.private_instructions || req.body.privateInstructions) || null,
        asLanguage(req.body.language_preference || req.body.languagePreference || req.userAuth.preferred_language)
      ]
    );
    await logActivity(req.userAuth.id, 'viewing_config_updated', { viewing_config_id: result.rows[0]?.id, booking_mode: mode }, { listingId });
    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/viewings', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT vb.*, p.title, p.listing_type, p.district, p.area
       FROM viewing_bookings vb
       LEFT JOIN properties p ON p.id = vb.listing_id
       WHERE vb.user_id = $1
       ORDER BY vb.created_at DESC
       LIMIT 100`,
      [req.userAuth.id]
    );
    return res.json({ ok: true, data: { items: result.rows, total: result.rows.length } });
  } catch (error) {
    return next(error);
  }
});

router.post('/viewings', optionalAuth, async (req, res, next) => {
  try {
    const listingId = req.body.listing_id || req.body.listingId;
    if (!isUuid(listingId)) return res.status(400).json({ ok: false, error: 'Valid listing_id is required' });
    const config = await db.query('SELECT * FROM viewing_configs WHERE listing_id = $1 LIMIT 1', [listingId]);
    const viewingConfig = config.rows[0] || null;
    if (viewingConfig && (viewingConfig.accepts_viewings === false || viewingConfig.booking_mode === 'disabled' || viewingConfig.booking_mode === 'callback_only')) {
      return res.status(409).json({ ok: false, error: 'This listing is not accepting viewing bookings. Request a callback instead.' });
    }
    const name = asText(req.body.name || [req.userAuth?.first_name, req.userAuth?.last_name].filter(Boolean).join(' '), 'MakaUg user');
    const phone = asText(req.body.phone || req.userAuth?.phone) || null;
    const email = asText(req.body.email || req.userAuth?.email) || null;
    if (!phone && !email) return res.status(400).json({ ok: false, error: 'phone or email is required' });
    const lead = await createLead(db, {
      userId: req.userAuth?.id || null,
      listingId,
      contact: {
        userId: req.userAuth?.id || null,
        name,
        phone,
        email,
        preferredContactChannel: req.body.contact_method || req.body.contactMethod || req.userAuth?.preferred_contact_channel,
        preferredLanguage: req.body.language_preference || req.body.languagePreference || req.userAuth?.preferred_language,
        roleType: 'property_seeker'
      },
      source: req.body.source || 'viewing_booking',
      leadType: 'viewing',
      message: req.body.message || 'Viewing requested from MakaUg dashboard/web.',
      metadata: { preferred_date: req.body.preferred_date || req.body.preferredDate, preferred_time: req.body.preferred_time || req.body.preferredTime }
    });
    const result = await db.query(
      `INSERT INTO viewing_bookings (
         listing_id, user_id, name, phone, email, preferred_date, preferred_time,
         contact_method, message, status, source, language_preference, lead_id
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'requested',$10,$11,$12)
       RETURNING *`,
      [
        listingId,
        req.userAuth?.id || null,
        name,
        phone,
        email,
        asText(req.body.preferred_date || req.body.preferredDate) || null,
        asText(req.body.preferred_time || req.body.preferredTime) || null,
        asContactChannel(req.body.contact_method || req.body.contactMethod || req.userAuth?.preferred_contact_channel, 'whatsapp'),
        asText(req.body.message) || null,
        asText(req.body.source, 'web'),
        asLanguage(req.body.language_preference || req.body.languagePreference || req.userAuth?.preferred_language),
        lead?.id || null
      ]
    );
    await logActivity(req.userAuth?.id || null, 'book_viewing', { viewing_booking_id: result.rows[0]?.id }, { listingId, leadId: lead?.id || null });
    await logNotification(db, {
      userId: req.userAuth?.id || null,
      recipientPhone: phone,
      recipientEmail: email,
      channel: 'in_app',
      type: 'viewing_requested',
      status: 'logged',
      relatedListingId: listingId,
      relatedLeadId: lead?.id || null,
      payloadSummary: { viewing_booking_id: result.rows[0]?.id, preferred_date: result.rows[0]?.preferred_date, preferred_time: result.rows[0]?.preferred_time }
    });
    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/callbacks', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT cb.*, p.title, p.listing_type, p.district, p.area
       FROM callback_requests cb
       LEFT JOIN properties p ON p.id = cb.listing_id
       WHERE cb.user_id = $1
       ORDER BY cb.created_at DESC
       LIMIT 100`,
      [req.userAuth.id]
    );
    return res.json({ ok: true, data: { items: result.rows, total: result.rows.length } });
  } catch (error) {
    return next(error);
  }
});

router.post('/callbacks', optionalAuth, async (req, res, next) => {
  try {
    const listingId = isUuid(req.body.listing_id || req.body.listingId) ? (req.body.listing_id || req.body.listingId) : null;
    const name = asText(req.body.name || [req.userAuth?.first_name, req.userAuth?.last_name].filter(Boolean).join(' '), 'MakaUg user');
    const phone = asText(req.body.phone || req.userAuth?.phone) || null;
    const email = asText(req.body.email || req.userAuth?.email) || null;
    if (!phone && !email) return res.status(400).json({ ok: false, error: 'phone or email is required' });
    const lead = await createLead(db, {
      userId: req.userAuth?.id || null,
      listingId,
      contact: {
        userId: req.userAuth?.id || null,
        name,
        phone,
        email,
        preferredContactChannel: req.body.contact_method || req.body.contactMethod || req.userAuth?.preferred_contact_channel,
        preferredLanguage: req.body.language_preference || req.body.languagePreference || req.userAuth?.preferred_language,
        roleType: 'property_seeker'
      },
      source: req.body.source || 'callback_request',
      leadType: 'callback',
      message: req.body.message || 'Callback requested from MakaUg dashboard/web.',
      metadata: { preferred_callback_time: req.body.preferred_callback_time || req.body.preferredCallbackTime }
    });
    const result = await db.query(
      `INSERT INTO callback_requests (
         listing_id, user_id, name, phone, email, preferred_callback_time,
         contact_method, message, status, source, language_preference, lead_id
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'requested',$9,$10,$11)
       RETURNING *`,
      [
        listingId,
        req.userAuth?.id || null,
        name,
        phone,
        email,
        asText(req.body.preferred_callback_time || req.body.preferredCallbackTime) || null,
        asContactChannel(req.body.contact_method || req.body.contactMethod || req.userAuth?.preferred_contact_channel, 'whatsapp'),
        asText(req.body.message) || null,
        asText(req.body.source, 'web'),
        asLanguage(req.body.language_preference || req.body.languagePreference || req.userAuth?.preferred_language),
        lead?.id || null
      ]
    );
    await logActivity(req.userAuth?.id || null, 'request_callback', { callback_request_id: result.rows[0]?.id }, { listingId, leadId: lead?.id || null });
    await logNotification(db, {
      userId: req.userAuth?.id || null,
      recipientPhone: phone,
      recipientEmail: email,
      channel: 'in_app',
      type: 'callback_requested',
      status: 'logged',
      relatedListingId: listingId,
      relatedLeadId: lead?.id || null,
      payloadSummary: { callback_request_id: result.rows[0]?.id, preferred_callback_time: result.rows[0]?.preferred_callback_time }
    });
    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/enquiries', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT pi.*, p.title, p.listing_type, p.district, p.area
       FROM property_inquiries pi
       LEFT JOIN properties p ON p.id = pi.property_id
       WHERE (pi.contact_email = $2 AND $2::text IS NOT NULL)
          OR (pi.contact_phone = $3 AND $3::text IS NOT NULL)
       ORDER BY pi.created_at DESC
       LIMIT 100`,
      [req.userAuth.id, req.userAuth.email || null, req.userAuth.phone || null]
    );
    return res.json({ ok: true, data: { items: result.rows, total: result.rows.length } });
  } catch (error) {
    return next(error);
  }
});

router.get('/contact-history', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT *
       FROM property_seeker_activities
       WHERE user_id = $1
         AND activity_type IN ('contact_whatsapp','whatsapp_contact_initiated','contact_call','contact_email','book_viewing','request_callback')
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.userAuth.id]
    );
    return res.json({ ok: true, data: { items: result.rows, total: result.rows.length } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
