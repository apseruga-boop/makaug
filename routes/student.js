const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('../config/database');
const logger = require('../config/logger');
const { cleanText } = require('../middleware/validation');

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

function asNumber(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const parsed = Number.parseFloat(String(value).replace(/,/g, ''));
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
  if (Array.isArray(value)) return value.map((item) => asText(item)).filter(Boolean).slice(0, 30);
  const text = asText(value);
  if (!text) return [];
  return text.split(',').map((item) => asText(item)).filter(Boolean).slice(0, 30);
}

function safeJson(value, fallback) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function propertyUrl(id) {
  const base = String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://makaug.com').replace(/\/$/, '');
  return `${base}/property/${id}`;
}

async function loadUserFromToken(token) {
  if (!token || !process.env.JWT_SECRET) return null;
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (!isUuid(decoded?.sub)) return null;
  const result = await db.query(
    `SELECT id, first_name, last_name, phone, email, role, status, marketing_opt_in,
            preferred_contact_channel, preferred_language, profile_data
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
  } catch (_) {
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

function isStudentListing(row) {
  const listingType = asText(row?.listing_type).toLowerCase();
  const propertyType = asText(row?.property_type).toLowerCase();
  return listingType === 'student'
    || listingType === 'students'
    || row?.students_welcome === true
    || !!row?.nearest_university
    || ['hostel', 'studio', 'room', 'shared room', 'self-contained room'].includes(propertyType);
}

function propertyToCard(row, reason = 'Recommended for your student housing preferences') {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    listing_type: row.listing_type,
    district: row.district,
    area: row.area,
    location: [row.area, row.district].filter(Boolean).join(', '),
    address: row.address,
    price: row.price,
    price_period: row.price_period,
    period: row.price_period,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    property_type: row.property_type,
    nearest_university: row.nearest_university,
    distance_to_uni_km: row.distance_to_uni_km,
    room_type: row.room_type,
    room_arrangement: row.room_arrangement,
    students_welcome: row.students_welcome,
    primary_image_url: row.primary_image_url,
    image: row.primary_image_url,
    url: propertyUrl(row.id),
    reason
  };
}

async function loadPreference(userId) {
  const result = await db.query('SELECT * FROM student_preferences WHERE user_id = $1 LIMIT 1', [userId]);
  return result.rows[0] || null;
}

async function upsertPreference(user, patch = {}) {
  const current = await loadPreference(user.id);
  const merged = {
    campus: asText(patch.campus, current?.campus || null),
    university: asText(patch.university, current?.university || null),
    preferred_locations: asArray(patch.preferred_locations ?? patch.preferredLocations ?? patch.locations ?? current?.preferred_locations),
    min_budget: asBigIntNumber(patch.min_budget ?? patch.minBudget, current?.min_budget || null),
    max_budget: asBigIntNumber(patch.max_budget ?? patch.maxBudget ?? patch.budget, current?.max_budget || null),
    currency: asText(patch.currency, current?.currency || 'UGX').toUpperCase().slice(0, 8),
    price_period_preference: asText(patch.price_period_preference ?? patch.pricePeriodPreference, current?.price_period_preference || 'semester'),
    room_type: asText(patch.room_type ?? patch.roomType, current?.room_type || null),
    shared_or_self_contained: asText(patch.shared_or_self_contained ?? patch.sharedOrSelfContained, current?.shared_or_self_contained || null),
    wifi_required: asBoolean(patch.wifi_required ?? patch.wiFiRequired, current?.wifi_required || false),
    security_required: asBoolean(patch.security_required, current?.security_required ?? true),
    water_required: asBoolean(patch.water_required, current?.water_required ?? true),
    meals_required: asBoolean(patch.meals_required, current?.meals_required || false),
    shuttle_required: asBoolean(patch.shuttle_required, current?.shuttle_required || false),
    parking_required: asBoolean(patch.parking_required, current?.parking_required || false),
    gender_policy_preference: asText(patch.gender_policy_preference ?? patch.genderPolicyPreference, current?.gender_policy_preference || null),
    max_distance_to_campus: asNumber(patch.max_distance_to_campus ?? patch.maxDistanceToCampus, current?.max_distance_to_campus || null),
    preferred_language: asLanguage(patch.preferred_language ?? patch.preferredLanguage ?? patch.language, current?.preferred_language || user.preferred_language || 'en'),
    alert_channels: asArray(patch.alert_channels ?? patch.alertChannels ?? current?.alert_channels),
    alert_frequency: asText(patch.alert_frequency ?? patch.alertFrequency, current?.alert_frequency || 'weekly')
  };
  if (!merged.alert_channels.length) merged.alert_channels = ['in_app'];

  const result = await db.query(
    `INSERT INTO student_preferences (
       user_id, campus, university, preferred_locations, min_budget, max_budget, currency,
       price_period_preference, room_type, shared_or_self_contained, wifi_required,
       security_required, water_required, meals_required, shuttle_required, parking_required,
       gender_policy_preference, max_distance_to_campus, preferred_language, alert_channels, alert_frequency
     )
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21)
     ON CONFLICT (user_id)
     DO UPDATE SET
       campus = EXCLUDED.campus,
       university = EXCLUDED.university,
       preferred_locations = EXCLUDED.preferred_locations,
       min_budget = EXCLUDED.min_budget,
       max_budget = EXCLUDED.max_budget,
       currency = EXCLUDED.currency,
       price_period_preference = EXCLUDED.price_period_preference,
       room_type = EXCLUDED.room_type,
       shared_or_self_contained = EXCLUDED.shared_or_self_contained,
       wifi_required = EXCLUDED.wifi_required,
       security_required = EXCLUDED.security_required,
       water_required = EXCLUDED.water_required,
       meals_required = EXCLUDED.meals_required,
       shuttle_required = EXCLUDED.shuttle_required,
       parking_required = EXCLUDED.parking_required,
       gender_policy_preference = EXCLUDED.gender_policy_preference,
       max_distance_to_campus = EXCLUDED.max_distance_to_campus,
       preferred_language = EXCLUDED.preferred_language,
       alert_channels = EXCLUDED.alert_channels,
       alert_frequency = EXCLUDED.alert_frequency,
       updated_at = NOW()
     RETURNING *`,
    [
      user.id,
      merged.campus,
      merged.university,
      JSON.stringify(merged.preferred_locations),
      merged.min_budget,
      merged.max_budget,
      merged.currency,
      merged.price_period_preference,
      merged.room_type,
      merged.shared_or_self_contained,
      merged.wifi_required,
      merged.security_required,
      merged.water_required,
      merged.meals_required,
      merged.shuttle_required,
      merged.parking_required,
      merged.gender_policy_preference,
      merged.max_distance_to_campus,
      merged.preferred_language,
      JSON.stringify(merged.alert_channels),
      merged.alert_frequency
    ]
  );

  await db.query(
    `UPDATE users
     SET preferred_language = $2,
         profile_data = COALESCE(profile_data, '{}'::jsonb) || $3::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [
      user.id,
      merged.preferred_language,
      JSON.stringify({
        account_kind: 'student',
        seeker_type: 'student',
        student_campus: merged.campus,
        student_university: merged.university
      })
    ]
  );

  return result.rows[0];
}

function scoreStudentListing(row, preference = {}) {
  let score = 0;
  const reasons = [];
  const campus = asText(preference.campus || preference.university).toLowerCase();
  const locations = asArray(preference.preferred_locations).map((x) => x.toLowerCase());
  const locationText = [row.area, row.district, row.address, row.nearest_university].filter(Boolean).join(' ').toLowerCase();
  const roomType = asText(preference.room_type).toLowerCase();

  if (isStudentListing(row)) {
    score += 25;
    reasons.push('student-friendly listing');
  }
  if (campus && locationText.includes(campus)) {
    score += 30;
    reasons.push(`near ${preference.campus || preference.university}`);
  }
  if (locations.some((location) => location && locationText.includes(location))) {
    score += 22;
    reasons.push('close to your preferred area');
  }
  if (preference.max_budget && row.price && Number(row.price) <= Number(preference.max_budget)) {
    score += 18;
    reasons.push('within your budget');
  }
  if (roomType && asText(row.room_type || row.property_type).toLowerCase().includes(roomType)) {
    score += 10;
    reasons.push('matches your room type');
  }
  if (preference.max_distance_to_campus && row.distance_to_uni_km && Number(row.distance_to_uni_km) <= Number(preference.max_distance_to_campus)) {
    score += 10;
    reasons.push('within your campus distance');
  }
  if (!reasons.length) reasons.push('useful student accommodation option to review');
  return { score, reason: reasons.slice(0, 2).join(' and ') };
}

async function fetchStudentRecommendations(userId, preference = {}, limit = 12) {
  const result = await db.query(
    `SELECT p.id, p.listing_type, p.title, p.description, p.district, p.area, p.address,
            p.price, p.price_period, p.bedrooms, p.bathrooms, p.property_type,
            p.status, p.created_at, p.nearest_university, p.distance_to_uni_km,
            p.room_type, p.room_arrangement, p.students_welcome,
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
       AND (p.listing_type IN ('student','students') OR p.students_welcome = TRUE OR p.nearest_university IS NOT NULL)
       AND NOT EXISTS (
         SELECT 1
         FROM hidden_listings h
         WHERE h.user_id = $1 AND h.listing_id = p.id
       )
     ORDER BY p.created_at DESC
     LIMIT 120`,
    [userId]
  );

  return result.rows
    .map((row) => ({ row, ...scoreStudentListing(row, preference) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => propertyToCard(item.row, item.reason));
}

async function studentDashboardPayload(user) {
  const preference = await upsertPreference(user, {});
  const [recommendations, saved, searches, recent, needs] = await Promise.all([
    fetchStudentRecommendations(user.id, preference, 12),
    db.query(
      `SELECT sl.*, p.title, p.listing_type, p.district, p.area, p.price, p.price_period,
              p.nearest_university, p.distance_to_uni_km, p.room_type, p.students_welcome,
              img.url AS primary_image_url
       FROM saved_listings sl
       JOIN properties p ON p.id = sl.listing_id
       LEFT JOIN LATERAL (
         SELECT url FROM property_images WHERE property_id = p.id ORDER BY is_primary DESC, sort_order ASC, created_at ASC LIMIT 1
       ) img ON true
       WHERE sl.user_id = $1
         AND (p.listing_type IN ('student','students') OR p.students_welcome = TRUE OR p.nearest_university IS NOT NULL)
       ORDER BY sl.updated_at DESC
       LIMIT 24`,
      [user.id]
    ),
    db.query(
      `SELECT *
       FROM saved_searches
       WHERE user_id = $1 AND status = 'active' AND (category = 'student' OR student_campus IS NOT NULL)
       ORDER BY updated_at DESC
       LIMIT 20`,
      [user.id]
    ),
    db.query(
      `SELECT rv.*, p.title, p.listing_type, p.district, p.area, p.price, p.price_period,
              p.nearest_university, p.distance_to_uni_km, p.room_type, p.students_welcome,
              img.url AS primary_image_url
       FROM recently_viewed_listings rv
       JOIN properties p ON p.id = rv.listing_id
       LEFT JOIN LATERAL (
         SELECT url FROM property_images WHERE property_id = p.id ORDER BY is_primary DESC, sort_order ASC, created_at ASC LIMIT 1
       ) img ON true
       WHERE rv.user_id = $1
         AND (p.listing_type IN ('student','students') OR p.students_welcome = TRUE OR p.nearest_university IS NOT NULL)
       ORDER BY rv.viewed_at DESC
       LIMIT 12`,
      [user.id]
    ),
    db.query(
      `SELECT *
       FROM property_need_requests
       WHERE user_id = $1 AND category = 'student'
       ORDER BY created_at DESC
       LIMIT 10`,
      [user.id]
    )
  ]);

  return {
    profile: {
      first_name: user.first_name,
      last_name: user.last_name,
      preferred_language: preference.preferred_language,
      preferred_contact_channel: user.preferred_contact_channel || 'whatsapp',
      account_kind: 'student'
    },
    preference,
    stats: {
      recommendations: recommendations.length,
      savedListings: saved.rows.length,
      savedSearches: searches.rows.length,
      recentlyViewed: recent.rows.length,
      needRequests: needs.rows.length
    },
    recommendations,
    savedListings: saved.rows.map((row) => propertyToCard(row, row.note || row.list_name || 'Saved student option')),
    savedSearches: searches.rows,
    recentlyViewed: recent.rows.map((row) => propertyToCard(row, `Viewed ${new Date(row.viewed_at).toLocaleDateString('en-GB')}`)),
    needRequests: needs.rows,
    nextActions: [
      preference.campus ? 'Review the newest rooms around your campus.' : 'Add your campus so MakaUg can prioritise closer rooms.',
      searches.rows.length ? 'Check whether your student alert frequency still suits you.' : 'Create a student accommodation alert.',
      saved.rows.length ? 'Compare your saved student options before booking a viewing.' : 'Save your favourite student rooms to build a shortlist.'
    ]
  };
}

router.get('/preferences', requireAuth, async (req, res, next) => {
  try {
    const preference = await upsertPreference(req.userAuth, {});
    return res.json({ ok: true, data: { preference } });
  } catch (error) {
    logger.error('Failed to load student preference', { error: error.message, userId: req.userAuth?.id });
    return next(error);
  }
});

router.patch('/preferences', requireAuth, async (req, res, next) => {
  try {
    const preference = await upsertPreference(req.userAuth, req.body);
    return res.json({ ok: true, data: { preference } });
  } catch (error) {
    logger.error('Failed to save student preference', { error: error.message, userId: req.userAuth?.id });
    return next(error);
  }
});

router.get('/dashboard', requireAuth, async (req, res, next) => {
  try {
    return res.json({ ok: true, data: await studentDashboardPayload(req.userAuth) });
  } catch (error) {
    logger.error('Failed to load student dashboard', { error: error.message, userId: req.userAuth?.id });
    return next(error);
  }
});

router.get('/recommendations', requireAuth, async (req, res, next) => {
  try {
    const preference = await upsertPreference(req.userAuth, {});
    const recommendations = await fetchStudentRecommendations(req.userAuth.id, preference, asNumber(req.query.limit, 12));
    return res.json({ ok: true, data: { recommendations } });
  } catch (error) {
    return next(error);
  }
});

router.post('/need-request', optionalAuth, async (req, res, next) => {
  try {
    const result = await db.query(
      `INSERT INTO property_need_requests (
         user_id, source, category, location, budget, currency, campus, message,
         urgency, preferred_contact_channel, language
       )
       VALUES ($1,$2,'student',$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        req.userAuth?.id || null,
        asText(req.body.source, 'student_dashboard'),
        asText(req.body.location || req.body.preferred_location || req.body.preferredLocation) || null,
        asBigIntNumber(req.body.budget || req.body.max_budget || req.body.maxBudget),
        asText(req.body.currency, 'UGX').toUpperCase().slice(0, 8),
        asText(req.body.campus) || null,
        asText(req.body.message) || null,
        asText(req.body.urgency) || null,
        asContactChannel(req.body.preferred_contact_channel || req.body.preferredContactChannel, 'whatsapp'),
        asLanguage(req.body.language || req.body.preferred_language)
      ]
    );
    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/activity', optionalAuth, async (req, res, next) => {
  try {
    const activityType = asText(req.body.activity_type || req.body.activityType);
    if (!activityType) return res.status(400).json({ ok: false, error: 'activity_type is required' });
    const listingId = isUuid(req.body.listing_id || req.body.listingId) ? (req.body.listing_id || req.body.listingId) : null;
    const result = await db.query(
      `INSERT INTO property_seeker_activities (user_id, guest_session_id, activity_type, listing_id, metadata)
       VALUES ($1,$2,$3,$4,$5::jsonb)
       RETURNING *`,
      [
        req.userAuth?.id || null,
        asText(req.body.guest_session_id || req.body.guestSessionId) || null,
        `student_${activityType}`,
        listingId,
        JSON.stringify(safeJson(req.body.metadata, {}))
      ]
    );
    return res.status(201).json({ ok: true, data: result.rows[0] });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
