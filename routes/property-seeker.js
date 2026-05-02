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
  if (!reasons.length) reasons.push('new live MakaUg listing you may want to review');
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

async function dashboardPayload(user) {
  const profile = await upsertProfile(user, {});
  const preferences = await upsertPreferences(user.id, {});
  const [recommendations, saved, recent, searches, needRequests] = await Promise.all([
    fetchRecommendations(user.id, preferences, 12),
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
    db.query('SELECT * FROM property_need_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10', [user.id])
  ]);

  const nextActions = [];
  if (profile.profile_completion_percent < 80) nextActions.push('Complete your property brief so MakaUg can recommend better matches.');
  if (!searches.rows.length) nextActions.push('Create a saved search and choose WhatsApp or email alerts.');
  if (!saved.rows.length) nextActions.push('Save promising listings so you can compare and revisit them.');
  if (!nextActions.length) nextActions.push('Review today’s recommendations and book a viewing for your favourite option.');

  return {
    profile,
    preferences,
    stats: {
      recommendations: recommendations.length,
      savedListings: saved.rows.length,
      savedSearches: searches.rows.length,
      recentlyViewed: recent.rows.length,
      needRequests: needRequests.rows.length
    },
    recommendations,
    savedListings: saved.rows.map((row) => propertyToCard(row, row.note || row.list_name || 'Saved to your shortlist')),
    recentlyViewed: recent.rows.map((row) => propertyToCard(row, `Viewed ${new Date(row.viewed_at).toLocaleDateString('en-GB')}`)),
    savedSearches: searches.rows,
    needRequests: needRequests.rows,
    nextActions,
    insights: {
      message: 'MakaUg is using your saved preferences, searches, views, and WhatsApp-ready demand data to improve matches safely.'
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
        asContactChannel(req.body.preferred_contact_channel || req.body.preferredContactChannel, 'whatsapp'),
        asLanguage(req.body.language || req.body.preferred_language)
      ]
    );
    return res.status(201).json({ ok: true, data: result.rows[0] });
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

module.exports = router;
