const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('../config/database');
const logger = require('../config/logger');
const smsService = require('../models/smsService');
const {
  sendOtpEmail,
  sendPropertySubmissionNotification,
  sendSupportEmail
} = require('../services/emailService');
const {
  buildOwnerStatusMessage,
  buildAutomatedListingReview,
  createOwnerEditToken,
  getDirectWhatsAppUrl,
  getOwnerPreviewUrl,
  hashOwnerEditToken,
  isOwnerEditTokenValid,
  normalizeReviewChecklist,
  ownerEditTokenExpiry,
  sendOwnerListingStatusNotifications,
  sendOwnerListingSubmissionNotifications
} = require('../services/listingModerationService');
const { getCachedExternalDuplicateScan } = require('../services/externalDuplicateScanService');
const { captureLearningEvent } = require('../services/aiLearningCaptureService');
const { buildListingReference } = require('../services/listingReferenceService');
const { matchListingToSavedSearches } = require('../services/alertSchedulerService');
const { logNotification, notificationStatusFromDelivery } = require('../services/notificationLogService');
const { logEmailEvent } = require('../services/emailLogService');
const { logWhatsAppMessage } = require('../services/whatsappMessageLogService');
const { createLead } = require('../services/leadService');
const { ensurePostVerificationRecords } = require('../services/authFlowService');
const { prepareMediaUrlForStorage } = require('../services/cloudMediaStorageService');
const {
  buildIdentityVerificationExtra,
  listingRequiresIdentityVerification
} = require('../services/listingIdentityDocumentService');
const { hasAdminAccess, requireAdminApiKey, requireListingModerationAccess } = require('../middleware/auth');
const {
  asArray,
  cleanText,
  toNullableInt,
  toNullableFloat,
  isValidEmail,
  isValidPhone
} = require('../middleware/validation');
const {
  canUseAdminOtpOverride,
  isAdminOtpOverrideMatch
} = require('../utils/adminOtpOverride');
const {
  createListingSubmitToken,
  verifyListingSubmitToken
} = require('../utils/listingSubmitOtp');
const { parsePagination, toPagination } = require('../utils/pagination');
const { DISTRICTS, UNIVERSITIES, LISTING_TYPES, PROPERTY_STATUSES } = require('../utils/constants');
const {
  isPublicLivePropertyStatus,
  publicLivePropertyStatusSql
} = require('../utils/publicInventoryStatus');
const {
  DEFAULT_SEARCH_RADIUS_MILES,
  buildHaversineSql,
  kmToMiles,
  normalizeRadiusKm,
  isPointInUganda,
  roundLocationForAnalytics
} = require('../services/locationSearchService');
const {
  buildUgNlisLandVerificationPack,
  sanitizeUgNlisLandVerificationFields
} = require('../services/ugnlisLandVerificationService');
const {
  landTitleAvailabilityLabel,
  normalizeLandTitleAvailability
} = require('../utils/landTitleAvailability');
const {
  inferNearestUniversityFromListing,
  normalizeUniversityList,
  normalizeUniversityName
} = require('../utils/universityMatcher');
const {
  PUBLIC_INVENTORY_METRICS_MARKER,
  loadPublicOpportunitySummary,
  publicLaunchTestListingFastCondition
} = require('../services/publicInventoryMetricsService');
const {
  COMMERCIAL_TRANSACTION_TYPES,
  COMMERCIAL_PROPERTY_TYPES,
  normalizeCommercialTransactionType,
  normalizeCommercialPropertyType,
  commercialMisclassificationWarning
} = require('../utils/commercialClassification');
const { listingPriceQuality } = require('../utils/listingPriceQuality');
const { propertyPriceMetadata } = require('../utils/propertyPriceCurrency');

const router = express.Router();
const LAUNCH_SEED_LISTING_MARKERS = ['SOFT LAUNCH TEST - DELETE', 'QA TEST - DELETE'];
const LAUNCH_DUMMY_LISTING_TITLES = new Set(['sdgsdgd', 'sgsgsgsgs']);

function readPositiveIntegerEnv(names, fallback) {
  for (const name of names) {
    const value = Number(process.env[name]);
    if (Number.isFinite(value) && value > 0) return Math.floor(value);
  }
  return fallback;
}

function isPublicTikTokProfileUrl(value = '') {
  try {
    const url = new URL(String(value || '').trim());
    if (!/^(?:www\.)?tiktok\.com$/i.test(url.hostname)) return false;
    return /^\/@[^/]+\/?$/i.test(url.pathname);
  } catch (error) {
    return false;
  }
}

function isPublicTikTokVideoUrl(value = '') {
  try {
    const url = new URL(String(value || '').trim());
    if (!/(?:^|\.)tiktok\.com$/i.test(url.hostname)) return false;
    return /\/@[^/]+\/video\/\d+/i.test(url.pathname) || /^\/(?:t|v)\//i.test(url.pathname);
  } catch (error) {
    return false;
  }
}

const PUBLIC_PROPERTIES_CACHE_TTL_MS = readPositiveIntegerEnv(
  ['PUBLIC_PROPERTIES_CACHE_TTL_MS', 'PUBLIC_OPPORTUNITY_SUMMARY_CACHE_TTL_MS'],
  60 * 1000
);
const PUBLIC_PROPERTIES_CACHE_MAX_AGE_SECONDS = Math.max(1, Math.floor(PUBLIC_PROPERTIES_CACHE_TTL_MS / 1000));
const PUBLIC_PROPERTIES_CACHE_STALE_SECONDS = 300;
const PUBLIC_PROPERTIES_CACHE_MAX_ENTRIES = 120;
const PUBLIC_PROPERTIES_CACHE_REFRESH_AGENT = 'makaug-public-inventory-cache-warmup';
const PUBLIC_LOCATION_SEARCH_PERFORMANCE_MARKER = 'properties-location-search-cache-key-20260725';
const PUBLIC_PROPERTIES_CACHE_IGNORED_QUERY_KEYS = new Set([
  'cache_refresh',
  'cacheRefresh',
  'deploy_probe',
  'v',
  '_',
  '_cb',
  'cb'
]);
const PUBLIC_LOCATION_SEARCH_COLUMNS = Object.freeze([
  "p.area",
  "p.district"
]);
const publicPropertiesResponseCache = new Map();

function runPublicInventoryFollowup(task, label, context = {}) {
  Promise.resolve()
    .then(task)
    .catch((error) => {
      logger.warn(label, { ...context, message: error.message });
    });
}

function publicPropertiesCacheControl() {
  return `public, max-age=${PUBLIC_PROPERTIES_CACHE_MAX_AGE_SECONDS}, stale-while-revalidate=${PUBLIC_PROPERTIES_CACHE_STALE_SECONDS}`;
}

function publicPropertiesCacheKey(req) {
  const query = req.query || {};
  const normalized = new Map();
  for (const [rawKey, rawValue] of Object.entries(query)) {
    const key = String(rawKey);
    if (PUBLIC_PROPERTIES_CACHE_IGNORED_QUERY_KEYS.has(key)) continue;
    if (['area', 'search', 'query'].includes(key)) continue;
    if (['listing_type', 'type', 'category'].includes(key)) continue;
    if (['status', 'public_only', 'publicOnly'].includes(key)) continue;
    if (['include_summary', 'includeSummary', 'summary'].includes(key)) {
      normalized.set('include_summary', parseBooleanLike(rawValue, true) ? '1' : '0');
      continue;
    }
    if (['featured', 'is_featured', 'isFeatured'].includes(key)) {
      normalized.set('featured', parseBooleanLike(rawValue, false) ? '1' : '0');
      continue;
    }
    normalized.set(key, Array.isArray(rawValue) ? rawValue.map(String).sort().join(',') : String(rawValue));
  }
  const area = cleanText(query.area || query.search || query.query);
  const listingType = normalizeListingType(query.listing_type || query.type || query.category);
  normalized.set('status', cleanText(query.status || 'approved').toLowerCase());
  normalized.set('public_only', '1');
  if (area) normalized.set('area', normalizePublicSearchNeedle(area));
  if (listingType) normalized.set('listing_type', listingType);
  const { page, limit } = parsePagination(query);
  normalized.set('page', String(page));
  normalized.set('limit', String(limit));
  if (!normalized.has('include_summary')) normalized.set('include_summary', '1');
  const entries = Array.from(normalized.entries()).sort(([a], [b]) => a.localeCompare(b));
  return entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&') || 'default';
}

function isPublicCacheRefreshRequest(req) {
  if (!parseBooleanLike(req.query.cache_refresh || req.query.cacheRefresh, false)) return false;
  return String(req.get('user-agent') || '').includes(PUBLIC_PROPERTIES_CACHE_REFRESH_AGENT);
}

function getPublicPropertiesCache(req) {
  const key = publicPropertiesCacheKey(req);
  const cached = publicPropertiesResponseCache.get(key);
  if (!cached) return { key, payload: null };
  if ((Date.now() - cached.createdAt) > PUBLIC_PROPERTIES_CACHE_TTL_MS) {
    publicPropertiesResponseCache.delete(key);
    return { key, payload: null };
  }
  return { key, payload: cached.payload };
}

function setPublicPropertiesCache(key, payload) {
  if (!key || !payload) return;
  publicPropertiesResponseCache.set(key, { createdAt: Date.now(), payload });
  if (publicPropertiesResponseCache.size <= PUBLIC_PROPERTIES_CACHE_MAX_ENTRIES) return;
  const oldestKey = publicPropertiesResponseCache.keys().next().value;
  if (oldestKey) publicPropertiesResponseCache.delete(oldestKey);
}

function clearPublicPropertiesCache(reason = 'public_inventory_changed') {
  if (!publicPropertiesResponseCache.size) return;
  const entries = publicPropertiesResponseCache.size;
  publicPropertiesResponseCache.clear();
  logger.info('Cleared public properties response cache', { reason, entries });
}

function addFilter(filters, values, clause, ...vals) {
  let prepared = clause;
  vals.forEach((v) => {
    values.push(v);
    prepared = prepared.replace('?', `$${values.length}`);
  });
  filters.push(prepared);
}

function isTransientPublicPropertyDatabaseError(error = {}) {
  if (['POOL_TIMEOUT', 'ETIMEDOUT', 'ECONNRESET', '53300', '57P01', '57P02', '57P03', '08000', '08003', '08006'].includes(error.code)) {
    return true;
  }
  return /client acquisition timed out|connection timeout|connection terminated|timeout exceeded/i.test(
    String(error.message || '')
  );
}

async function withPublicPropertyDatabaseRetry(operation) {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientPublicPropertyDatabaseError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 125));
    return operation();
  }
}

function normalizeListingOrigin(value = '') {
  const origin = cleanText(value).toLowerCase().replace(/[\s-]+/g, '_');
  const aliases = {
    found: 'found_online',
    online: 'found_online',
    sourced: 'found_online',
    owner: 'private',
    privately_listed: 'private',
    broker: 'agent',
    agency: 'agent',
    agent_listed: 'agent'
  };
  const normalized = aliases[origin] || origin;
  return ['found_online', 'private', 'agent'].includes(normalized) ? normalized : '';
}

function foundOnlinePropertySql(alias = 'p') {
  const a = alias ? `${alias}.` : '';
  return `(
    LOWER(COALESCE(${a}source, '')) = 'found_online_property_source_v1'
    OR LOWER(COALESCE(${a}listed_via, '')) = 'found_online'
    OR LOWER(COALESCE(${a}extra_fields->>'source_badge', '')) IN ('found_online', 'found online', 'sourced_online', 'sourced online')
    OR LOWER(COALESCE(${a}extra_fields->>'found_online', 'false')) IN ('true', '1', 'yes')
    OR LOWER(COALESCE(${a}extra_fields->>'found_online_candidate', 'false')) IN ('true', '1', 'yes')
    OR LOWER(COALESCE(${a}extra_fields->>'social_search_candidate', 'false')) IN ('true', '1', 'yes')
    OR LOWER(COALESCE(${a}extra_fields->>'sourced_inventory_candidate', 'false')) IN ('true', '1', 'yes')
  )`;
}

function listingOriginSql(alias = 'p') {
  const a = alias ? `${alias}.` : '';
  return `(CASE
    WHEN ${foundOnlinePropertySql(alias)} THEN 'found_online'
    WHEN ${a}agent_id IS NOT NULL OR LOWER(COALESCE(${a}lister_type, '')) = 'agent' THEN 'agent'
    ELSE 'private'
  END)`;
}

function normalizePublicSearchNeedle(value = '') {
  return cleanText(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function addPublicLocationSearchFilter(filters, values, value = '') {
  const needle = normalizePublicSearchNeedle(value);
  if (!needle) return false;
  const clauses = [];
  PUBLIC_LOCATION_SEARCH_COLUMNS.forEach((columnSql) => {
    values.push(needle);
    const exactRef = `$${values.length}`;
    clauses.push(`(
      LOWER(TRIM(COALESCE(${columnSql}, ''))) = ${exactRef}
    )`);
  });
  filters.push(`(${clauses.join(' OR ')})`);
  return true;
}

function addPublicCardLocationSearchFilter(filters, values, value = '') {
  const raw = cleanText(value, 120);
  if (!raw) return false;
  addFilter(
    filters,
    values,
    `(
      p.area = ?
      OR p.district = ?
      OR p.extra_fields->>'city' = ?
      OR p.extra_fields->>'neighborhood' = ?
      OR p.extra_fields->>'region' = ?
      OR p.extra_fields->>'resolved_location_label' = ?
    )`,
    raw,
    raw,
    raw,
    raw,
    raw,
    raw
  );
  return true;
}

function isLaunchSeedListing(row = {}) {
  const title = String(row.title || '');
  const normalizedTitle = title.trim().toLowerCase();
  const description = String(row.description || '');
  const extraText = (() => {
    try {
      return typeof row.extra_fields === 'string'
        ? row.extra_fields
        : JSON.stringify(row.extra_fields || {});
    } catch (_) {
      return '';
    }
  })();
  const publicTrainingDemoText = [
    title,
    description,
    row.source,
    row.listed_via,
    row.lister_name,
    row.moderation_notes,
    row.moderation_reason,
    extraText
  ].filter(Boolean).join(' ');
  return LAUNCH_DUMMY_LISTING_TITLES.has(normalizedTitle)
    || LAUNCH_SEED_LISTING_MARKERS.some((marker) => title.includes(marker) || description.includes(marker))
    || /\bmakaug training\b|\btraining visibility\b|\bvisibility check\b|\bstock unsplash\b|\bdemo listing\b|\bqa test\b|\btest zone\b|\bsoft_launch\b|\blaunch_proof\b/i.test(publicTrainingDemoText);
}

function addPublicLaunchSeedFilter(filters, values) {
  filters.push(`NOT ${publicLaunchTestListingFastCondition('p')}`);
}

function normalizeListingType(type) {
  const t = cleanText(type).toLowerCase();
  if (t === 'students') return 'student';
  return t;
}

function statusListingPatchFromBody(body = {}) {
  const candidate = body.listing && typeof body.listing === 'object'
    ? body.listing
    : (body.listing_patch && typeof body.listing_patch === 'object'
      ? body.listing_patch
      : (body.listingPatch && typeof body.listingPatch === 'object' ? body.listingPatch : null));
  if (!candidate || Array.isArray(candidate)) return {};
  return candidate;
}

async function applyStatusListingPatchBeforeModeration(req, propertyId, existing = {}, rawPatch = {}) {
  const patch = statusListingPatchFromBody({ listing: rawPatch });
  if (!Object.keys(patch).length) return { changed_fields: [], property: existing };
  if (!Object.prototype.hasOwnProperty.call(patch, 'listing_type')) {
    const alias = patch.listingType ?? patch.type ?? patch.category;
    if (alias != null) patch.listing_type = alias;
  }
  if (!Object.prototype.hasOwnProperty.call(patch, 'price_period')) {
    const alias = patch.pricePeriod ?? patch.period;
    if (alias != null) patch.price_period = alias;
  }
  if (!Object.prototype.hasOwnProperty.call(patch, 'transaction_type')) {
    const alias = patch.transactionType ?? patch.commercial_mode ?? patch.commercial_intent;
    if (alias != null) patch.transaction_type = alias;
  }
  const effectiveListingType = normalizeListingType(patch.listing_type || existing.listing_type);
  if (effectiveListingType === 'commercial' && Object.prototype.hasOwnProperty.call(patch, 'property_type')) {
    patch.property_type = normalizeCommercialPropertyType(patch.property_type, {
      title: patch.title || existing.title,
      description: patch.description || existing.description
    });
  }

  const setParts = [];
  const values = [propertyId];
  const changed = [];
  const add = (column, value, cast = '') => {
    values.push(value);
    setParts.push(`${column} = $${values.length}${cast}`);
    changed.push(column);
  };
  const validateError = (message, details = []) => {
    const error = new Error(message);
    error.status = 400;
    error.details = details.length ? details : undefined;
    return error;
  };
  const fieldMap = {
    title: (value) => cleanText(value),
    description: (value) => cleanText(value),
    listing_type: (value) => {
      const listingType = normalizeListingType(value);
      if (listingType && !LISTING_TYPES.includes(listingType)) {
        throw validateError('listing_type must be sale, rent, land, commercial, or student');
      }
      return listingType;
    },
    area: (value) => cleanText(value),
    district: (value) => {
      const district = cleanText(value);
      if (district && !DISTRICTS.includes(district)) {
        throw validateError('district must be one of Uganda\'s valid districts');
      }
      return district;
    },
    address: (value) => cleanText(value) || null,
    price: (value) => toNullableInt(value),
    price_period: (value) => cleanText(value) || null,
    transaction_type: (value) => {
      const transactionType = normalizeCommercialTransactionType(value);
      if (value && !transactionType) {
        throw validateError('transaction_type must be rent or sale');
      }
      return transactionType || null;
    },
    property_type: (value) => cleanText(value) || null,
    title_type: (value) => cleanText(value) || null,
    bedrooms: (value) => toNullableInt(value),
    bathrooms: (value) => toNullableInt(value),
    lister_name: (value) => cleanText(value) || null,
    lister_phone: (value) => {
      const phone = normalizePhone(value) || null;
      if (phone && !isValidPhone(phone)) throw validateError('lister_phone must be a valid phone number');
      return phone;
    },
    lister_email: (value) => {
      const email = normalizeEmail(value) || null;
      if (email && !isValidEmail(email)) throw validateError('lister_email must be a valid email address');
      return email;
    },
    latitude: (value) => toNullableFloat(value),
    longitude: (value) => toNullableFloat(value)
  };

  Object.entries(fieldMap).forEach(([key, transform]) => {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) return;
    const value = transform(patch[key]);
    if (['title', 'description', 'area', 'district', 'listing_type'].includes(key) && !value) return;
    add(key, value);
  });

  const extraPatch = {};
  [
    'region',
    'city',
    'neighborhood',
    'street_name',
    'location_note',
    'source_url',
    'source_platform',
    'geocoding_provider',
    'place_id',
    'location_confidence',
    'map_pin_source',
    'land_title_available',
    'nearest_university',
    'distance_to_uni_km',
    'room_type',
    'room_arrangement',
    'gender_pref',
    'student_room_label'
  ].forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(patch, key)) extraPatch[key] = cleanText(patch[key]) || null;
  });
  if (Object.prototype.hasOwnProperty.call(patch, 'students_welcome')) {
    extraPatch.students_welcome = parseBooleanLike(patch.students_welcome, false);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'student_universities')) {
    extraPatch.student_universities = asArray(patch.student_universities).map((item) => cleanText(item)).filter(Boolean);
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'amenities')) {
    const amenities = asArray(patch.amenities).map((item) => cleanText(item)).filter(Boolean);
    values.push(JSON.stringify(amenities));
    setParts.push(`amenities = $${values.length}::jsonb`);
    changed.push('amenities');
  }
  if (Object.keys(extraPatch).length) {
    extraPatch.staff_status_listing_patch_applied_at = new Date().toISOString();
    extraPatch.staff_status_listing_patch_applied_by = req.adminAuth?.userId || req.adminAuth?.type || 'moderation_api';
    values.push(JSON.stringify(extraPatch));
    setParts.push(`extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $${values.length}::jsonb`);
    changed.push('extra_fields');
  }

  if (!setParts.length) return { changed_fields: [], property: existing };

  const updated = await db.query(
    `UPDATE properties
     SET ${setParts.join(', ')}, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    values
  );
  const property = updated.rows[0] || existing;
  await db.query(
    `INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, notes, delivery)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [
      propertyId,
      req.adminAuth?.userId || req.adminAuth?.type || 'moderation_api',
      'listing_facts_updated_with_status',
      existing.status || null,
      property.status || null,
      'Listing facts were updated as part of the moderation status action.',
      JSON.stringify({ changed_fields: changed })
    ]
  ).catch((error) => {
    logger.warn('Listing status fact-update audit failed', {
      property_id: propertyId,
      message: error.message
    });
  });
  return { changed_fields: changed, property };
}

function publicOpportunityBucketSql(alias = 'p') {
  const a = alias;
  const directType = `LOWER(TRIM(COALESCE(${a}.listing_type, '')))`;
  const propertyType = `LOWER(COALESCE(${a}.property_type, ''))`;
  const period = `LOWER(COALESCE(${a}.price_period, ''))`;
  const text = `LOWER(CONCAT_WS(' ',
    ${a}.title,
    ${a}.description,
    ${a}.property_type,
    ${a}.price_period,
    ${a}.extra_fields->>'room_type',
    ${a}.extra_fields->>'commercial_type',
    ${a}.extra_fields->>'title_type'
  ))`;
  return `CASE
    WHEN ${directType} IN ('sale', 'rent', 'commercial', 'land') THEN ${directType}
    WHEN ${directType} IN ('student', 'students') THEN 'student'
    WHEN ${propertyType} ~* '(land|plot|acre|decimal|estate plots?)' THEN 'land'
    WHEN ${propertyType} ~* '(commercial|office|shop|retail|warehouse|showroom|restaurant|industrial)' THEN 'commercial'
    WHEN ${text} ~* '(student|hostel|university|campus|bedsitter)' THEN 'student'
    WHEN ${text} ~* '(commercial|office|shop|retail|warehouse|showroom|restaurant|industrial)' THEN 'commercial'
    WHEN ${text} ~* '(land|plot|acre|decimal|estate plots?)' THEN 'land'
    WHEN ${period} IN ('mo', 'month', 'monthly', 'per_month') OR ${text} ~* '(rent|rental|lease|per month|monthly)' THEN 'rent'
    WHEN ${text} ~* '(for sale|sale|selling|buy)' THEN 'sale'
    ELSE 'other'
  END`;
}

function fastPublicOpportunityBucketSql(alias = 'p') {
  const a = alias;
  const directType = `LOWER(TRIM(COALESCE(${a}.listing_type, '')))`;
  const propertyType = `LOWER(COALESCE(${a}.property_type, ''))`;
  const period = `LOWER(COALESCE(${a}.price_period, ''))`;
  return `CASE
    WHEN ${directType} IN ('sale', 'rent', 'commercial', 'land') THEN ${directType}
    WHEN ${directType} IN ('student', 'students') THEN 'student'
    WHEN ${directType} = 'rent' AND ${a}.students_welcome = TRUE THEN 'student'
    WHEN ${propertyType} ~* '(land|plot|acre|decimal|estate plots?)' THEN 'land'
    WHEN ${propertyType} ~* '(commercial|office|shop|retail|warehouse|showroom|restaurant|industrial)' THEN 'commercial'
    WHEN ${propertyType} ~* '(hostel|student|campus|dorm|bedsitter)' THEN 'student'
    WHEN ${period} IN ('mo', 'month', 'monthly', 'per_month') THEN 'rent'
    ELSE 'sale'
  END`;
}

function normalizePublicOpportunitySummary(row = {}) {
  const sale = Number(row.sale || 0) || 0;
  const rent = Number(row.rent || 0) || 0;
  const student = Number(row.student || 0) || 0;
  const commercial = Number(row.commercial || 0) || 0;
  const land = Number(row.land || 0) || 0;
  const other = Number(row.other || 0) || 0;
  const total = Number(row.total || 0) || (sale + rent + student + commercial + land + other);
  return {
    total,
    sale,
    rent,
    student,
    commercial,
    land,
    other,
    by_type: {
      sale,
      rent,
      student,
      commercial,
      land,
      other
    }
  };
}

function approximatePublicPagination({ page, limit, offset, rowCount, hasMore }) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Number(limit) || 1);
  const safeOffset = Math.max(0, Number(offset) || 0);
  const safeRowCount = Math.max(0, Number(rowCount) || 0);
  return {
    total: safeOffset + safeRowCount + (hasMore ? 1 : 0),
    page: safePage,
    limit: safeLimit,
    totalPages: hasMore ? safePage + 1 : Math.max(1, safePage),
    approximate: true
  };
}

const PUBLIC_AREA_PIN_OVERRIDES = [
  { name: 'Namasuba', district: 'Wakiso', latitude: 0.258, longitude: 32.558, aliases: ['Namasuba', 'Namasuba Kampala', 'Namasuba Entebbe Road', 'Rahim Foods', 'Rahim Foods Namasuba'] },
  { name: 'Ndejje', district: 'Wakiso', latitude: 0.244, longitude: 32.553, aliases: ['Ndejje', 'Ndejje Lubugumu'] },
  { name: 'Munyonyo', district: 'Kampala', latitude: 0.236, longitude: 32.623, aliases: ['Munyonyo', 'Munyonjo', 'Munyonyo Kampala', 'Munyonyo Uganda'] },
  { name: 'Bujjuko Akright Estate', district: 'Wakiso', latitude: 0.374, longitude: 32.389, aliases: ['Bujjuko Akright', 'Bujuuko Akright', 'Akright', 'Bujjuko', 'Bujuuko'] },
  { name: 'Kakiri', district: 'Wakiso', latitude: 0.409, longitude: 32.38, aliases: ['Kakiri', 'Kakiri Masulita', 'Kakiri Masulita Hoima Road', 'Hoima Road'] },
  { name: 'Masulita', district: 'Wakiso', latitude: 0.51, longitude: 32.46, aliases: ['Masulita'] },
  { name: 'Masindi', district: 'Masindi', latitude: 1.683, longitude: 31.715, aliases: ['Masindi', 'Masindi Town', 'Masindi Municipality'] },
  { name: 'Kira', district: 'Wakiso', latitude: 0.3978, longitude: 32.6414, aliases: ['Kira', 'Kira Town'] },
  { name: 'Kira-Mulawa', district: 'Wakiso', latitude: 0.412, longitude: 32.65, aliases: ['Kira-Mulawa', 'Kira Mulawa', 'Mulawa'] },
  { name: 'Kira-Nsasa', district: 'Wakiso', latitude: 0.428, longitude: 32.665, aliases: ['Kira-Nsasa', 'Kira Nsasa', 'Nsasa'] },
  { name: 'Nansana', district: 'Wakiso', latitude: 0.364, longitude: 32.52, aliases: ['Nansana', 'Nansana Municipality', 'Nansana Town'] },
  { name: 'Namugongo', district: 'Wakiso', latitude: 0.363, longitude: 32.636, aliases: ['Namugongo'] },
  { name: 'Najjera', district: 'Wakiso', latitude: 0.396, longitude: 32.615, aliases: ['Najjera', 'Najjeera'] },
  { name: 'Kitende', district: 'Wakiso', latitude: 0.197, longitude: 32.535, aliases: ['Kitende'] },
  { name: 'Kajjansi', district: 'Wakiso', latitude: 0.216, longitude: 32.552, aliases: ['Kajjansi', 'Kajansi'] },
  { name: 'Bwebajja Akright', district: 'Wakiso', latitude: 0.198, longitude: 32.535, aliases: ['Bwebajja Akright', 'Bwebajja'] },
  { name: 'Seguku', district: 'Wakiso', latitude: 0.247, longitude: 32.555, aliases: ['Seguku', 'Sseguku'] },
  { name: 'Entebbe Road', district: 'Wakiso', latitude: 0.216, longitude: 32.552, aliases: ['Entebbe Road'] },
  { name: 'Kasangati-Nangabo', district: 'Wakiso', latitude: 0.434, longitude: 32.61, aliases: ['Kasangati-Nangabo', 'Kasangati Nangabo', 'Kasangati', 'Nangabo'] },
  { name: 'Katosi', district: 'Mukono', latitude: 0.181, longitude: 32.797, aliases: ['Katosi', 'Mpunge', 'Mpungwe', 'Katosi Mpunge'] },
  { name: 'Kololo', district: 'Kampala', latitude: 0.356, longitude: 32.612, aliases: ['Kololo'] },
  { name: 'Komamboga / Kyanja', district: 'Kampala', latitude: 0.394, longitude: 32.598, aliases: ['Komamboga', 'Kyanja', 'Komamboga Kyanja'] },
  { name: 'Kyebando', district: 'Kampala', latitude: 0.368, longitude: 32.584, aliases: ['Kyebando'] },
  { name: 'Kikoni', district: 'Kampala', latitude: 0.333, longitude: 32.565, aliases: ['Kikoni'] },
  { name: 'Nakawa', district: 'Kampala', latitude: 0.334, longitude: 32.61, aliases: ['Nakawa'] },
  { name: 'Ndeeba', district: 'Kampala', latitude: 0.301, longitude: 32.548, aliases: ['Ndeeba'] },
  { name: 'Kikuubo', district: 'Kampala', latitude: 0.314, longitude: 32.576, aliases: ['Kikuubo'] }
];

function publicAreaAliasPattern(alias = '') {
  return String(alias || '')
    .trim()
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\s+/g, '\\s+')
    .replace(/-/g, '[-\\s]+');
}

function publicLocationOverrideFromText(value = '') {
  const haystack = cleanText(value);
  if (!haystack) return null;
  const sorted = PUBLIC_AREA_PIN_OVERRIDES
    .flatMap((point) => (point.aliases || [point.name]).map((alias) => ({ ...point, alias })))
    .sort((a, b) => String(b.alias || '').length - String(a.alias || '').length);
  for (const point of sorted) {
    const pattern = publicAreaAliasPattern(point.alias);
    if (!pattern) continue;
    if (new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, 'i').test(haystack)) return point;
  }
  return null;
}

function publicLocationOverrideForListing(row = {}, extra = row.extra_fields || {}) {
  return publicLocationOverrideFromText([
    row.area,
    row.address,
    extra.resolved_location_label,
    row.title,
    row.description
  ].filter(Boolean).join(' '));
}

function isUsablePublicCoordinate(latitude, longitude) {
  const lat = toNullableFloat(latitude);
  const lng = toNullableFloat(longitude);
  return lat != null && lng != null && isPointInUganda(lat, lng);
}

function cleanPublicListingCopy(value = '') {
  return cleanText(value)
    .replace(/\s*Confirm the exact property pin with the listing agent before approval\.?/gi, '')
    .replace(/\s*Confirm exact gate or plot pin with the agent before public approval\.?/gi, '')
    .replace(/\s*Confirm latest availability, exact pin, and ownership authority before featuring\.?/gi, '')
    .replace(/\s*Pending King review[^.]*\.?/gi, '')
    .trim();
}

function listingLooksStudentLike(row = {}) {
  const text = [
    row.listing_type,
    row.category,
    row.property_type,
    row.title,
    row.description
  ].filter(Boolean).join(' ').toLowerCase();
  return row.students_welcome === true
    || row.students_welcome === 'true'
    || /\b(student|students|hostel|campus|university|dorm|dormitory)\b/i.test(text);
}

function studentUniversityContextFor(row = {}, safeExtra = null) {
  const extra = safeExtra || (row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {});
  const explicit = normalizeUniversityName(
    row.nearest_university
    || extra.nearest_university
    || extra.nearest_uni
    || extra.student_campus
    || extra.student_university
    || extra.university
  );
  const nearestUniversity = explicit || (listingLooksStudentLike(row)
    ? inferNearestUniversityFromListing({ ...row, extra_fields: extra })
    : '');
  const distanceRaw = row.distance_to_uni_km ?? extra.distance_to_uni_km ?? extra.uni_distance ?? null;
  const distance = toNullableFloat(distanceRaw);
  const universities = normalizeUniversityList([
    ...(Array.isArray(extra.student_universities) ? extra.student_universities : []),
    nearestUniversity
  ]);
  return {
    nearest_university: nearestUniversity || null,
    distance_to_uni_km: distance,
    student_universities: universities
  };
}

function redactThirdPartyPublicText(value = '') {
  return cleanPublicListingCopy(value)
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '')
    .replace(/#[\p{L}\p{N}_-]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sourceTextFragments(value, depth = 0) {
  if (value == null || depth > 3) return [];
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => sourceTextFragments(item, depth + 1));
  }
  if (typeof value === 'object') {
    return [
      value.text,
      value.comment,
      value.caption,
      value.description,
      value.message,
      value.reply,
      value.creator_reply,
      value.creator_response,
      value.body,
      value.title
    ].flatMap((item) => sourceTextFragments(item, depth + 1));
  }
  return [];
}

function collapseRepeatedSourceText(value = '') {
  const words = cleanText(value).split(/\s+/).filter(Boolean);
  if (words.length < 6) return words.join(' ');
  let current = words;
  const maxSize = Math.min(36, Math.floor(current.length / 2));
  for (let size = maxSize; size >= 2; size -= 1) {
    const next = [];
    for (let i = 0; i < current.length;) {
      const chunk = current.slice(i, i + size);
      const key = chunk.join(' ').toLowerCase();
      let repeats = 1;
      while (
        i + ((repeats + 1) * size) <= current.length
        && current.slice(i + repeats * size, i + (repeats + 1) * size).join(' ').toLowerCase() === key
      ) {
        repeats += 1;
      }
      next.push(...chunk);
      i += repeats * size;
    }
    current = next;
  }
  return current.join(' ').replace(/\s+/g, ' ').trim();
}

function buildPublicSourceHoverDescription(extraFields = {}) {
  const extra = extraFields && typeof extraFields === 'object' ? extraFields : {};
  const fragments = [
    extra.source_visual_text,
    extra.video_ocr_text,
    extra.frame_ocr_text,
    extra.source_text,
    extra.source_caption,
    extra.source_description,
    extra.source_title,
    extra.source_comments
  ].flatMap((item) => sourceTextFragments(item));
  const seen = new Set();
  const parts = [];
  fragments.forEach((fragment) => {
    const cleaned = redactThirdPartyPublicText(fragment);
    if (!cleaned || cleaned.length < 3) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    parts.push(cleaned);
  });
  return collapseRepeatedSourceText(parts.join(' ')).slice(0, 900);
}

function publicAreaLabelFor(property = {}, extra = {}) {
  return cleanText(
    extra.resolved_location_label
    || property.area
    || property.district
    || property.address
    || 'Uganda'
  ) || 'Uganda';
}

function thirdPartyTypeLabel(property = {}) {
  const type = cleanText(property.listing_type || property.category || '').toLowerCase();
  if (type === 'land') return 'land';
  if (type === 'rent') return 'property for rent';
  if (type === 'commercial') return 'commercial property';
  if (type === 'student' || type === 'students') return 'student accommodation';
  return 'property for sale';
}

function publicPriceLabelFor(property = {}) {
  const raw = property.price == null ? '' : String(property.price).replace(/[^\d.]/g, '');
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0) return 'Price upon application';
  const period = cleanText(property.price_period || '').toLowerCase();
  return `USh ${Math.round(amount).toLocaleString('en-US')}${period === 'month' ? '/month' : ''}`;
}

function buildThirdPartyPublicTitle(property = {}, extra = {}) {
  const reviewedFields = Array.isArray(extra.king_review_corrected_fields) ? extra.king_review_corrected_fields : [];
  const reviewedTitle = redactThirdPartyPublicText(property.title || '');
  const reviewedTitleLooksCopied = String(property.title || '').includes('#')
    || reviewedTitle.length > 120
    || reviewedTitle.split(/\s+/).filter(Boolean).length > 14;
  const typeForReview = cleanText(property.listing_type || property.category || '').toLowerCase();
  if (
    reviewedTitle
    && (extra.king_review_facts_confirmed === true || reviewedFields.includes('title'))
    && !reviewedTitleLooksCopied
    && !(typeForReview !== 'land' && /^land\s+in\b/i.test(reviewedTitle))
  ) {
    return reviewedTitle;
  }
  const area = publicAreaLabelFor(property, extra);
  const type = thirdPartyTypeLabel(property);
  const beds = Number(property.bedrooms);
  const roomLabel = Number.isFinite(beds) && beds > 0 && type !== 'land' ? `${beds}-bed ` : '';
  const propertyType = redactThirdPartyPublicText(property.property_type || '').toLowerCase();
  if (type === 'land') {
    const size = redactThirdPartyPublicText(extra.size_raw || property.land_size || '');
    return `${size ? `${size} ` : ''}Land in ${area}`.trim();
  }
  if (type === 'property for rent') return `${roomLabel}${propertyType || 'Property'} for rent in ${area}`.trim();
  if (type === 'commercial property') return `${propertyType || 'Commercial property'} in ${area}`.trim();
  if (type === 'student accommodation') return `Student accommodation in ${area}`.trim();
  return `${roomLabel}${propertyType || 'Property'} for sale in ${area}`.trim();
}

function buildThirdPartyPublicSummary(property = {}, extra = {}) {
  const area = publicAreaLabelFor(property, extra);
  const type = thirdPartyTypeLabel(property);
  const sourcePlatform = redactThirdPartyPublicText(extra.source_platform || 'the original source');
  const sourceName = redactThirdPartyPublicText(extra.source_name || extra.source_agent_name || '');
  const reviewedFields = Array.isArray(extra.king_review_corrected_fields) ? extra.king_review_corrected_fields : [];
  const reviewedDescription = redactThirdPartyPublicText(property.description || '');
  const reviewedDescriptionLooksCopied = !reviewedDescription
    || reviewedDescription.length > 420
    || /\boriginal post date\b|\bsource post\b|\bthird-party\b|makaug has not verified/i.test(reviewedDescription);
  const price = publicPriceLabelFor(property);
  const bedrooms = Number(property.bedrooms);
  const bathrooms = Number(property.bathrooms);
  const landTitleAvailable = normalizeLandTitleAvailability(
    extra.land_title_available
      ?? extra.landTitleAvailable
      ?? extra.title_available
      ?? extra.land_title_status,
    extra.source_title,
    extra.source_caption,
    extra.source_description,
    extra.source_text,
    extra.source_visual_text
  );
  const landTitleLabel = landTitleAvailabilityLabel(landTitleAvailable);
  const facts = [
    area && `Area: ${area}`,
    type && `Type: ${type}`,
    price && `Guide price: ${price}`,
    landTitleLabel && `Land title: ${landTitleLabel}`,
    Number.isFinite(bedrooms) && bedrooms > 0 ? `Bedrooms: ${bedrooms}` : '',
    Number.isFinite(bathrooms) && bathrooms > 0 ? `Bathrooms: ${bathrooms}` : ''
  ].filter(Boolean).join('. ');
  const source = sourceName ? `${sourceName} on ${sourcePlatform}` : sourcePlatform;
  if (
    reviewedDescription
    && (extra.king_review_facts_confirmed === true || reviewedFields.includes('description'))
    && !reviewedDescriptionLooksCopied
  ) {
    return `${reviewedDescription} Third-party property result found from ${source}. Makaug provides a search and discovery preview using limited factual information only. Makaug has not verified ownership, availability, price, land title, seller authority, image rights, or contact details. Open the original source before contacting the seller, arranging a viewing, or making any payment.`
      .replace(/\s+/g, ' ')
      .trim();
  }
  return `${buildThirdPartyPublicTitle(property, extra)} is a third-party property result found from ${source}. Makaug provides a search and discovery preview using limited factual information only. ${facts}. Makaug has not verified ownership, availability, price, land title, seller authority, image rights, or contact details. Open the original source before contacting the seller, arranging a viewing, or making any payment.`
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePhone(phone) {
  return cleanText(phone).replace(/\s+/g, '');
}

function normalizeEmail(email) {
  return cleanText(email).toLowerCase();
}

function getBearerToken(req) {
  const authHeader = req.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
  const cookieHeader = req.get('cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)makaug_auth_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function hasAdminCredentialHint(req) {
  return Boolean(req.get('x-api-key') || getBearerToken(req));
}

async function getOptionalAuthUser(req) {
  const token = getBearerToken(req);
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const result = await db.query(
      `SELECT id, first_name, last_name, phone, email, role, status, profile_data
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [decoded.sub]
    );
    return result.rows[0] || null;
  } catch (_) {
    return null;
  }
}

function normalizeUgPhone(phone) {
  const value = normalizePhone(phone);
  if (/^0\d{9}$/.test(value)) return `+256${value.slice(1)}`;
  if (/^256\d{9}$/.test(value)) return `+${value}`;
  return value;
}

function normalizePublicUgandaContactPhone(value = '') {
  const compact = String(value || '').replace(/[^\d+]+/g, '');
  const phone = normalizeUgPhone(compact);
  return phone && isValidPhone(phone) && isValidUgPhone(phone) ? phone : '';
}

function publicUgandaContactPhoneFromText(text = '') {
  const raw = String(text || '');
  const matches = raw.match(/(?:\+?256|0)(?:[\s().-]*\d){9}/g) || [];
  for (const match of matches) {
    const phone = normalizePublicUgandaContactPhone(match);
    if (phone) return phone;
  }
  return '';
}

function publicContactPhoneFromExtra(extra = {}) {
  const raw = extra && typeof extra === 'object' ? extra : {};
  const rawSourcePost = raw.raw_source_post && typeof raw.raw_source_post === 'object' ? raw.raw_source_post : {};
  const directPhone = [
    raw.public_contact_phone,
    raw.contact_phone,
    raw.phone,
    raw.whatsapp,
    raw.whatsapp_phone,
    raw.lister_phone,
    raw.lister_whatsapp,
    raw.source_phone,
    raw.source_whatsapp,
    raw.contact_phone_alt,
    raw.phone_alt,
    rawSourcePost.public_contact_phone,
    rawSourcePost.contact_phone,
    rawSourcePost.phone,
    rawSourcePost.whatsapp,
    rawSourcePost.lister_phone
  ].map(normalizePublicUgandaContactPhone).find(Boolean);
  if (directPhone) return directPhone;
  return publicUgandaContactPhoneFromText([
    raw.source_text,
    raw.source_caption,
    raw.source_description,
    raw.source_visual_text,
    raw.video_ocr_text,
    raw.frame_ocr_text,
    raw.source_hover_description,
    raw.source_card_description,
    rawSourcePost.source_text,
    rawSourcePost.caption,
    rawSourcePost.description,
    rawSourcePost.title,
    Array.isArray(rawSourcePost.comments) ? rawSourcePost.comments.join(' ') : ''
  ].filter(Boolean).join(' '));
}

function publicContactPhoneForRow(row = {}, safeExtra = null) {
  const extraPhone = publicContactPhoneFromExtra(row?.extra_fields || {});
  const safeExtraPhone = normalizePublicUgandaContactPhone(safeExtra?.public_contact_phone || safeExtra?.contact_phone || '');
  const rowPhone = normalizePublicUgandaContactPhone(row?.lister_phone || row?.contact_phone || row?.phone || row?.whatsapp || '');
  return safeExtraPhone || extraPhone || rowPhone || '';
}

function compactPublicCardRow(row = {}, currency = 'UGX') {
  const safeExtra = publicExtraFields(row.admin_extra_fields || row.extra_fields || {});
  const foundOnlinePublic = isFoundOnlinePublicRow(row, safeExtra);
  const locationOverride = publicLocationOverrideForListing(row, safeExtra);
  const hasUsablePublicPin = isUsablePublicCoordinate(row.latitude, row.longitude);
  const publicDistrict = locationOverride?.district || row.district;
  const publicLatitude = !hasUsablePublicPin && locationOverride ? locationOverride.latitude : row.latitude;
  const publicLongitude = !hasUsablePublicPin && locationOverride ? locationOverride.longitude : row.longitude;
  const primaryImageUrl = foundOnlinePublic ? null : normalizePublicImageUrl(row.primary_image_url);
  const publicTitle = foundOnlinePublic
    ? buildThirdPartyPublicTitle(row, safeExtra)
    : cleanPublicListingCopy(row.title || '');
  const publicDescription = foundOnlinePublic
    ? buildThirdPartyPublicSummary(row, safeExtra)
    : cleanPublicListingCopy(row.description || '');
  const studentContext = studentUniversityContextFor(row, safeExtra);
  const publicContactPhone = publicContactPhoneForRow(row, safeExtra);
  const distanceKm = row.distance_km == null ? null : Number(Number(row.distance_km).toFixed(3));
  const distanceMiles = distanceKm == null ? null : Number(kmToMiles(Number(distanceKm)).toFixed(2));
  const publicExtra = {
    source_platform: safeExtra.source_platform || null,
    source_badge: safeExtra.source_badge || null,
    source_url: safeExtra.source_url || null,
    video_url: safeExtra.video_url || row.video_url || null,
    youtube_url: safeExtra.youtube_url || row.youtube_url || null,
    thumbnail_url: safeExtra.thumbnail_url || safeExtra.source_thumbnail_url || null,
    source_thumbnail_url: safeExtra.source_thumbnail_url || safeExtra.thumbnail_url || null,
    source_card_description: safeExtra.source_card_description || null,
    found_online: safeExtra.found_online === true,
    social_search_candidate: safeExtra.social_search_candidate === true,
    sourced_inventory_candidate: safeExtra.sourced_inventory_candidate === true,
    third_party_discovery_result: foundOnlinePublic,
    public_contact_phone: publicContactPhone || null,
    contact_phone: publicContactPhone || null,
    nearest_university: studentContext.nearest_university || null,
    student_campus: studentContext.nearest_university || null,
    student_universities: studentContext.student_universities || [],
    distance_to_uni_km: studentContext.distance_to_uni_km,
    resolved_location_label: safeExtra.resolved_location_label || row.resolved_location_label || null
  };
  return {
    id: row.id,
    listing_type: row.listing_type,
    title: publicTitle,
    description: publicDescription,
    district: publicDistrict,
    area: row.area,
    address: row.address,
    price: row.price,
    price_currency: row.price_currency || 'UGX',
    price_original: row.price_original,
    price_fx_rate_ugx: row.price_fx_rate_ugx,
    price_fx_as_of: row.price_fx_as_of,
    price_period: row.price_period,
    transaction_type: row.transaction_type || null,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    property_type: row.property_type,
    room_type: row.room_type || null,
    title_type: row.title_type || null,
    status: row.status,
    created_at: row.created_at,
    latitude: publicLatitude,
    longitude: publicLongitude,
    students_welcome: row.students_welcome,
    nearest_university: studentContext.nearest_university || null,
    distance_to_uni_km: studentContext.distance_to_uni_km,
    student_universities: studentContext.student_universities,
    primary_image_url: primaryImageUrl,
    currency,
    featured: row.featured === true,
    distance_km: distanceKm,
    distance_miles: distanceMiles,
    listed_by: row.listed_by || null,
    listing_origin: row.listing_origin || (foundOnlinePublic ? 'found_online' : (row.listed_by || 'private')),
    registration_status: row.registration_status || null,
    public_contact_phone: publicContactPhone || null,
    contact_phone: publicContactPhone || null,
    extra_fields: publicExtra,
    third_party_discovery_result: foundOnlinePublic
  };
}

function phoneDigits(phone = '') {
  return normalizePhone(phone).replace(/\D+/g, '');
}

async function findBrokerAgentForUser(user = {}) {
  if (!user?.id || user.role !== 'agent_broker') return null;
  const email = normalizeEmail(user.email || '');
  const digits = phoneDigits(user.phone || '');
  const profile = user.profile_data && typeof user.profile_data === 'object' ? user.profile_data : {};
  const brokerAgentIdRaw = cleanText(profile.broker_agent_id || '');
  const brokerAgentId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(brokerAgentIdRaw)
    ? brokerAgentIdRaw
    : '';
  const result = await db.query(
    `SELECT id, full_name, phone, whatsapp, email, status
     FROM agents
     WHERE ($1::uuid IS NOT NULL AND id = $1)
        OR user_id = $2
        OR ($3::text <> '' AND LOWER(COALESCE(email, '')) = LOWER($3))
        OR ($4::text <> '' AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $4)
        OR ($4::text <> '' AND regexp_replace(COALESCE(whatsapp, ''), '\\D', '', 'g') = $4)
     ORDER BY id = $1 DESC, user_id = $2 DESC, updated_at DESC
     LIMIT 1`,
    [brokerAgentId || null, user.id, email, digits]
  );
  return result.rows[0] || null;
}

function isValidUgPhone(phone) {
  return /^\+256\d{9}$/.test(phone);
}

function normalizeUgNin(value = '') {
  return cleanText(value).replace(/\s+/g, '').toUpperCase();
}

function isValidUgNin(value = '') {
  return /^(CM|CF|PM|PF)[A-Z0-9]{12}$/.test(normalizeUgNin(value));
}

function normalizePreferredLanguage(value) {
  const lang = cleanText(value).toLowerCase();
  return ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm'].includes(lang) ? lang : 'en';
}

function getListingOtpCopy(language = 'en', { otp, expiresMinutes, audience = 'listing' } = {}) {
  const lang = normalizePreferredLanguage(language);
  const catalog = {
    en: {
      listing: `makaug listing verification: your one-time code is ${otp}. It expires in ${expiresMinutes} minutes. Enter it on makaug.com to continue publishing your property.`,
      agent: `makaug agent verification: your one-time code is ${otp}. It expires in ${expiresMinutes} minutes. Enter it on makaug.com to continue your agent application.`
    },
    lg: {
      listing: `makaug okukakasa listing: code yo ey’omulundi gumu ye ${otp}. Eggwaako mu ddakiika ${expiresMinutes}. Giyingize ku makaug.com okutwaliza mu maaso okutangaza property yo.`,
      agent: `makaug okukakasa agent application: code yo ey’omulundi gumu ye ${otp}. Eggwaako mu ddakiika ${expiresMinutes}. Giyingize ku makaug.com okutwaliza mu maaso okusaba okuba agent.`
    },
    sw: {
      listing: `Uthibitishaji wa listing ya makaug: msimbo wako wa mara moja ni ${otp}. Unaisha baada ya dakika ${expiresMinutes}. Uweke kwenye makaug.com ili uendelee kuchapisha mali yako.`,
      agent: `Uthibitishaji wa ombi la agent la makaug: msimbo wako wa mara moja ni ${otp}. Unaisha baada ya dakika ${expiresMinutes}. Uweke kwenye makaug.com ili uendelee na ombi lako la agent.`
    },
    ac: {
      listing: `makaug kubeero me listing: code mamegi acel acel tye ${otp}. Bi toyo i dakika ${expiresMinutes}. Ket i makaug.com me mede ki keto property ni live.`,
      agent: `makaug kubeero me agent application: code mamegi acel acel tye ${otp}. Bi toyo i dakika ${expiresMinutes}. Ket i makaug.com me mede ki application me agent.`
    },
    ny: {
      listing: `Okwehamya listing ya makaug: koodi yawe y’omurundi gumwe ni ${otp}. Egiherwaaho omu dakikha ${expiresMinutes}. Gigyandike aha makaug.com kugira ogume n'okutangaza property yawe.`,
      agent: `Okwehamya okusaba kwa agent kwa makaug: koodi yawe y’omurundi gumwe ni ${otp}. Egiherwaaho omu dakikha ${expiresMinutes}. Gigyandike aha makaug.com kugira ogume n’okusaba kwawe kwa agent.`
    },
    rn: {
      listing: `Okuhamya listing ya makaug: code yawe y’omulundi gumwe ni ${otp}. Erahwa mu dakikha ${expiresMinutes}. Gishyire ku makaug.com kugira ogume n’okutangaza property yawe.`,
      agent: `Okuhamya application ya agent ya makaug: code yawe y’omulundi gumwe ni ${otp}. Erahwa mu dakikha ${expiresMinutes}. Gishyire ku makaug.com kugira ogume n’okusaba kwawe kwa agent.`
    },
    sm: {
      listing: `Okukakasa listing ya makaug: code yo ey’omulundi gumu ye ${otp}. Eggwaako mu ddakiika ${expiresMinutes}. Giyingize ku makaug.com osobole okutwala mu maaso okutangaza property yo.`,
      agent: `Okukakasa okusaba kwa agent ku makaug: code yo ey’omulundi gumu ye ${otp}. Eggwaako mu ddakiika ${expiresMinutes}. Giyingize ku makaug.com osobole okutwala mu maaso okusaba kwa agent.`
    }
  };
  return catalog[lang]?.[audience] || catalog.en[audience] || catalog.en.listing;
}

function isUsableSubmittedImageUrl(url) {
  const value = cleanText(url);
  return /^https?:\/\//i.test(value) || /^data:image\//i.test(value);
}

function isAcceptedNationalIdPhoto({ name = '', url = '', mimeType = '' } = {}) {
  const fileName = cleanText(name).toLowerCase();
  const mediaUrl = cleanText(url);
  const type = cleanText(mimeType).toLowerCase();
  if (!fileName && !mediaUrl && !type) return false;
  if (/\.pdf$/i.test(fileName) || type.includes('pdf') || /^data:application\/pdf/i.test(mediaUrl)) return false;
  if (/^data:image\//i.test(mediaUrl)) return true;
  if (type.startsWith('image/')) return true;
  if (/\.(jpe?g|png|webp|heic|heif)$/i.test(fileName)) return true;
  if (/\.(jpe?g|png|webp|heic|heif)(?:$|[?#])/i.test(mediaUrl)) return true;
  return false;
}

function toUuidOrNull(value) {
  const text = cleanText(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null;
}

function getOwnerEditTokenFromRequest(req) {
  return cleanText(
    req.get('x-listing-edit-token')
      || req.query.edit_token
      || req.query.token
      || req.body?.edit_token
      || req.body?.token
  );
}

function canUseOwnerEditToken(property, token) {
  if (!property?.owner_edit_token_hash || !token) return false;
  const expiresAt = property.owner_edit_token_expires_at
    ? new Date(property.owner_edit_token_expires_at)
    : null;
  if (!expiresAt || Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) return false;
  return isOwnerEditTokenValid(token, property.owner_edit_token_hash);
}

function normalizePublicImageUrl(value) {
  const raw = cleanText(value);
  if (!raw) return null;
  const svgMatch = raw.match(/^data:image\/svg\+xml(?:;charset=[^,;]+)?(?:;utf8)?,(.*)$/i);
  if (!svgMatch) return raw;
  const payload = svgMatch[1] || '';
  let svg = payload;
  if (!payload.includes('<')) {
    try {
      svg = decodeURIComponent(payload);
    } catch (error) {
      svg = payload;
    }
  }
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function safePublicSourceUrl(value) {
  const url = cleanText(value);
  return /^https?:\/\//i.test(url) ? url : '';
}

function inferPublicSourcePlatform(value = '') {
  const url = cleanText(value).toLowerCase();
  if (url.includes('tiktok.com')) return 'TikTok';
  if (url.includes('instagram.com')) return 'Instagram';
  if (url.includes('facebook.com') || url.includes('fb.watch')) return 'Facebook';
  if (url.includes('x.com') || url.includes('twitter.com')) return 'X/Twitter';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'YouTube';
  return '';
}

function publicSourceDateConfidence(extra = {}) {
  const raw = extra.raw_source_post && typeof extra.raw_source_post === 'object' ? extra.raw_source_post : {};
  return cleanText(
    extra.source_post_date_confidence
      || extra.sourceDateConfidence
      || extra.date_confidence
      || raw.source_post_date_confidence
      || raw.sourceDateConfidence
      || raw.date_confidence
      || ''
  ).toLowerCase();
}

function publicSourceDateNeedsPlatformConfirmation(extra = {}) {
  const confidence = publicSourceDateConfidence(extra);
  const raw = extra.raw_source_post && typeof extra.raw_source_post === 'object' ? extra.raw_source_post : {};
  const importMethod = cleanText(raw.import_method || extra.import_method || '').toLowerCase();
  const platform = cleanText(extra.source_platform || '').toLowerCase();
  if (!confidence) return platform === 'tiktok' && importMethod === 'no_api_exact_social_url_intake';
  return /inferred_from_public_post_id|inferred.*(?:video|status|post|id)|estimated|needs_.*date_confirmation/.test(confidence);
}

function publicSourceDateMs(value) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

function publicSourceDateOutOfOrder(firstPostedRaw, firstSeenRaw, addedToMakaugRaw) {
  const firstPostedMs = publicSourceDateMs(firstPostedRaw);
  if (firstPostedMs == null) return false;
  const firstSeenMs = publicSourceDateMs(firstSeenRaw);
  const addedMs = publicSourceDateMs(addedToMakaugRaw);
  return (firstSeenMs != null && firstPostedMs > firstSeenMs)
    || (addedMs != null && firstPostedMs > addedMs);
}

function publicExtraFields(extraFields = {}) {
  const extra = extraFields && typeof extraFields === 'object' ? extraFields : {};
  const rawSourcePost = extra.raw_source_post && typeof extra.raw_source_post === 'object' ? extra.raw_source_post : {};
  const landTitleAvailable = normalizeLandTitleAvailability(
    extra.land_title_available
      ?? extra.landTitleAvailable
      ?? extra.title_available
      ?? extra.land_title_status,
    extra.source_title,
    extra.source_caption,
    extra.source_description,
    extra.source_text,
    extra.source_visual_text,
    extra.video_ocr_text,
    extra.frame_ocr_text
  );
  const sourceHoverDescription = buildPublicSourceHoverDescription(extra);
  const sourceDateNeedsConfirmation = publicSourceDateNeedsPlatformConfirmation(extra);
  const sourceDateConfirmationLabel = 'Original post date is being confirmed from the source platform.';
  const safeSourceUrls = Array.isArray(extra.source_urls)
    ? extra.source_urls.filter((url) => /^https?:\/\//i.test(String(url || ''))).slice(0, 5)
    : [];
  const sourceUrl = safePublicSourceUrl(
    extra.source_url
      || extra.source_post_url
      || extra.post_url
      || extra.platform_url
      || extra.original_url
      || safeSourceUrls[0]
  );
  const sourceContactUrl = safePublicSourceUrl(
    extra.source_contact_url
      || extra.source_channel_url
      || extra.youtube_channel_url
      || extra.social_profile_url
      || extra.channel_url
      || extra.creator_url
      || sourceUrl
      || safeSourceUrls[0]
  );
  const sourcePlatform = cleanText(extra.source_platform)
    || inferPublicSourcePlatform(sourceUrl)
    || inferPublicSourcePlatform(sourceContactUrl);
  const sourceContactPlatform = cleanText(extra.source_contact_platform)
    || sourcePlatform
    || inferPublicSourcePlatform(sourceContactUrl);
  const publicContactPhone = publicContactPhoneFromExtra(extra);
  const rawSourceContactMethod = cleanText(extra.source_contact_method || '');
  const sourceContactHasPhoneClaim = /(?:phone|call|whatsapp)/i.test(`${rawSourceContactMethod} ${extra.source_contact_label || ''}`);
  const sourceContactLabel = publicContactPhone || !sourceContactHasPhoneClaim
    ? (cleanText(extra.source_contact_label) || (sourceContactUrl ? `Contact via ${sourceContactPlatform || 'source'} source` : null))
    : (sourceContactUrl ? `Contact via ${sourceContactPlatform || 'source'} source` : null);
  const sourceContactMethod = publicContactPhone || !sourceContactHasPhoneClaim
    ? (rawSourceContactMethod || null)
    : (sourceContactUrl ? 'social' : null);
  const nearestUniversity = normalizeUniversityName(
    extra.nearest_university
    || extra.nearest_uni
    || extra.student_campus
    || extra.student_university
    || extra.university
  );
  const studentUniversities = normalizeUniversityList([
    ...(Array.isArray(extra.student_universities) ? extra.student_universities : []),
    nearestUniversity
  ]);
  const tiktokUrl = safePublicSourceUrl(
    extra.tiktok_url
      || extra.tiktok_video_url
      || (/tiktok\.com/i.test(String(extra.video_url || '')) ? extra.video_url : '')
      || (/tiktok\.com/i.test(String(sourceUrl || '')) ? sourceUrl : '')
  );
  const youtubeUrl = safePublicSourceUrl(
    extra.youtube_url
      || (/youtube\.com|youtu\.be/i.test(String(extra.video_url || '')) ? extra.video_url : '')
      || (/youtube\.com|youtu\.be/i.test(String(sourceUrl || '')) ? sourceUrl : '')
  );
  const videoUrl = safePublicSourceUrl(
    extra.video_url
      || youtubeUrl
      || tiktokUrl
      || (/youtube\.com|youtu\.be|tiktok\.com/i.test(String(sourceUrl || '')) ? sourceUrl : '')
  );
  const sourceHasTikTokVideoPost = isPublicTikTokVideoUrl(sourceUrl)
    || isPublicTikTokVideoUrl(tiktokUrl)
    || isPublicTikTokVideoUrl(videoUrl);
  const tiktokProfileOnlyContact = isPublicTikTokProfileUrl(sourceContactUrl) && !sourceHasTikTokVideoPost;
  const tiktokThumbnailUrl = normalizePublicImageUrl(extra.tiktok_thumbnail_url);
  const oembedThumbnailUrl = normalizePublicImageUrl(extra.oembed_thumbnail_url);
  const sourceThumbnailUrl = normalizePublicImageUrl(
    tiktokThumbnailUrl
      || oembedThumbnailUrl
      || extra.source_thumbnail_url
      || extra.video_thumbnail_url
      || extra.thumbnail_url
      || extra.cover_image_url
      || (Array.isArray(extra.photo_source_urls) ? extra.photo_source_urls[0] : '')
      || (Array.isArray(extra.authorised_photo_urls) ? extra.authorised_photo_urls[0] : '')
  );
  const mediaTypeRaw = cleanText(
    extra.media_type
      || extra.source_media_type
      || extra.post_media_type
      || rawSourcePost.media_type
      || rawSourcePost.source_media_type
      || ''
  ).toLowerCase();
  const mediaType = mediaTypeRaw.includes('photo') || mediaTypeRaw.includes('image')
    ? 'image'
    : mediaTypeRaw.includes('video') || mediaTypeRaw.includes('reel')
      ? 'video'
      : null;
  const mediaDuration = cleanText(
    extra.media_duration
      || extra.video_duration
      || extra.duration
      || extra.duration_label
      || rawSourcePost.media_duration
      || rawSourcePost.video_duration
      || rawSourcePost.duration
      || ''
  );
  const imageCount = Number(
    extra.image_count
      || extra.photo_count
      || extra.media_image_count
      || rawSourcePost.image_count
      || rawSourcePost.photo_count
      || (Array.isArray(extra.authorised_photo_urls) ? extra.authorised_photo_urls.length : 0)
      || (Array.isArray(extra.photo_source_urls) ? extra.photo_source_urls.length : 0)
      || 0
  ) || null;
  const sourceUnavailable = extra.source_unavailable === true
    || tiktokProfileOnlyContact
    || /(?:dead|deleted|removed|unavailable|not_found|not found|account_does_not_exist|account does not exist|404|410)/i.test(String(extra.source_url_status || extra.source_status || extra.source_availability_status || ''));
  const sourceUnavailableReason = tiktokProfileOnlyContact
    ? 'TikTok profile contact is not an exact property source and may be deleted or renamed.'
    : (extra.source_unavailable_reason || extra.source_url_status_reason || null);
  const firstPostedOnlineAt = sourceDateNeedsConfirmation ? null : (extra.first_posted_online_at || null);
  const sourcePublishedAt = sourceDateNeedsConfirmation ? null : (extra.source_published_at || null);
  const firstPostedRawForOrder = firstPostedOnlineAt
    || sourcePublishedAt
    || extra.video_published_at
    || extra.video_posted_at
    || extra.post_published_at
    || extra.post_posted_at
    || extra.platform_posted_at
    || extra.youtube_published_at
    || extra.youtube_source_published_at
    || extra.published_at
    || extra.publishedAt
    || extra.original_posted_at
    || extra.source_posted_at;
  const firstSeenOnlineAt = extra.first_seen_online_at || extra.source_first_seen_at || null;
  const addedToMakaugAt = extra.added_to_makaug_at || null;
  const sourceDateOutOfOrder = publicSourceDateOutOfOrder(firstPostedRawForOrder, firstSeenOnlineAt, addedToMakaugAt);
  const sourceDateConflictLabel = 'Source date conflicts with first pickup, so makaug is confirming it from the platform.';
  return {
    city: extra.city || null,
    neighborhood: extra.neighborhood || null,
    street_name: extra.street_name || null,
    region: extra.region || null,
    resolved_location_label: extra.resolved_location_label || null,
    public_display_name: extra.public_display_name || null,
    preferred_contact_method: extra.preferred_contact_method || null,
    nearest_university: nearestUniversity || null,
    distance_to_uni_km: toNullableFloat(extra.distance_to_uni_km ?? extra.uni_distance),
    student_campus: nearestUniversity || extra.student_campus || null,
    student_universities: studentUniversities,
    land_title_available: landTitleAvailable || null,
    land_title_available_label: landTitleAvailabilityLabel(landTitleAvailable) || null,
    video_url: videoUrl || null,
    youtube_url: youtubeUrl || null,
    tiktok_url: tiktokUrl || null,
    thumbnail_url: sourceThumbnailUrl || null,
    source_thumbnail_url: sourceThumbnailUrl || null,
    video_thumbnail_url: sourceThumbnailUrl || null,
    cover_image_url: sourceThumbnailUrl || null,
    tiktok_thumbnail_url: tiktokThumbnailUrl || null,
    oembed_thumbnail_url: oembedThumbnailUrl || null,
    media_type: mediaType,
    media_duration: mediaDuration || null,
    image_count: imageCount,
    public_contact_phone: publicContactPhone || null,
    contact_phone: publicContactPhone || null,
    source_unavailable: sourceUnavailable,
    source_url_status: extra.source_url_status || extra.source_status || null,
    source_unavailable_reason: sourceUnavailableReason,
    found_online: extra.found_online === true,
    third_party_discovery_result: extra.found_online === true
      || extra.social_search_candidate === true
      || extra.sourced_inventory_candidate === true
      || /found|sourced/i.test(String(extra.source_badge || '')),
    social_search_candidate: extra.social_search_candidate === true,
    sourced_inventory_candidate: extra.sourced_inventory_candidate === true,
    source_badge: extra.source_badge || null,
    source_batch: extra.source_batch || null,
    source_registry_key: extra.source_registry_key || null,
    source_listing_key: extra.source_listing_key || null,
    source_platform: sourcePlatform || null,
    source_type: extra.source_type || null,
    source_name: extra.source_name || null,
    source_agent_name: extra.source_agent_name || extra.source_name || null,
    source_url: sourceUrl || null,
    source_urls: safeSourceUrls,
    first_seen_online_at: firstSeenOnlineAt,
    first_seen_online_label: extra.first_seen_online_label || null,
    first_posted_online_at: sourceDateOutOfOrder ? null : firstPostedOnlineAt,
    first_posted_online_label: sourceDateNeedsConfirmation
      ? sourceDateConfirmationLabel
      : (sourceDateOutOfOrder ? sourceDateConflictLabel : (extra.first_posted_online_label || null)),
    source_published_at: sourceDateOutOfOrder ? null : sourcePublishedAt,
    source_published_label: sourceDateNeedsConfirmation
      ? sourceDateConfirmationLabel
      : (sourceDateOutOfOrder ? sourceDateConflictLabel : (extra.source_published_label || null)),
    source_post_date_confidence: publicSourceDateConfidence(extra) || null,
    source_post_date_status: sourceDateNeedsConfirmation
      ? 'needs_source_platform_date_confirmation'
      : (sourceDateOutOfOrder ? 'source_date_conflicts_with_first_pickup' : (extra.source_post_date_status || null)),
    original_publish_date_status: sourceDateNeedsConfirmation
      ? sourceDateConfirmationLabel
      : (sourceDateOutOfOrder ? sourceDateConflictLabel : (extra.original_publish_date_status || null)),
    added_to_makaug_at: addedToMakaugAt,
    added_to_makaug_label: extra.added_to_makaug_label || null,
    source_followers_label: extra.source_followers_label || null,
    source_audience_label: extra.source_audience_label || null,
    source_contact_url: sourceUnavailable ? null : (sourceContactUrl || null),
    source_contact_label: sourceUnavailable ? null : sourceContactLabel,
    source_contact_method: sourceContactMethod,
    source_contact_platform: sourceContactPlatform || null,
    source_hover_description: sourceHoverDescription || null,
    source_card_description: sourceHoverDescription || null,
    source_channel_url: extra.source_channel_url || extra.youtube_channel_url || null,
    youtube_channel_url: extra.youtube_channel_url || extra.source_channel_url || null,
    area_highlights: cleanPublicListingCopy(extra.area_highlights || ''),
    nearby_facilities: Array.isArray(extra.nearby_facilities) ? extra.nearby_facilities : [],
    size_raw: extra.size_raw || '',
    price_currency: extra.price_currency || null,
    price_original: extra.price_original ?? null,
    price_fx_rate_ugx: extra.price_fx_rate_ugx ?? null,
    price_fx_as_of: extra.price_fx_as_of || null,
    featured: extra.featured === true,
    featured_at: extra.featured_at || null
  };
}

function isFoundOnlinePublicRow(property = {}, safeExtra = null) {
  const extra = safeExtra || publicExtraFields(property?.extra_fields || {});
  const sourceText = [
    property?.source,
    property?.listed_via,
    extra?.source_badge,
    extra?.source_batch,
    extra?.source_platform,
    extra?.source_url,
    extra?.video_url
  ].filter(Boolean).join(' ').toLowerCase();
  return extra?.found_online === true
    || extra?.social_search_candidate === true
    || extra?.sourced_inventory_candidate === true
    || extra?.third_party_discovery_result === true
    || sourceText.includes('found_online')
    || sourceText.includes('found online')
    || sourceText.includes('sourced_online')
    || sourceText.includes('sourced online')
    || /tiktok\.com|youtube\.com|youtu\.be|instagram\.com|facebook\.com|fb\.watch|x\.com|twitter\.com/.test(sourceText);
}

function publicPropertyRow(property, images = []) {
  const {
    owner_edit_token_hash: _ownerEditTokenHash,
    id_number: _idNumber,
    id_document_name: _idDocumentName,
    id_document_url: _idDocumentUrl,
    ...safeProperty
  } = property || {};
  const safeExtra = publicExtraFields(property?.extra_fields);
  const foundOnlinePublic = isFoundOnlinePublicRow(property, safeExtra);
  const locationOverride = publicLocationOverrideForListing(safeProperty, safeExtra);
  const hasUsablePublicPin = isUsablePublicCoordinate(safeProperty.latitude, safeProperty.longitude);
  const publicTitle = foundOnlinePublic
    ? buildThirdPartyPublicTitle(safeProperty, safeExtra)
    : cleanPublicListingCopy(safeProperty.title || '');
  const publicDescription = foundOnlinePublic
    ? buildThirdPartyPublicSummary(safeProperty, safeExtra)
    : cleanPublicListingCopy(safeProperty.description || '');
  const studentContext = studentUniversityContextFor(safeProperty, safeExtra);
  const publicContactPhone = publicContactPhoneForRow(property, safeExtra);
  const extraWithStudentContext = {
    ...safeExtra,
    public_contact_phone: publicContactPhone || null,
    contact_phone: publicContactPhone || null,
    ...(studentContext.nearest_university ? {
      nearest_university: studentContext.nearest_university,
      student_campus: studentContext.nearest_university,
      student_universities: studentContext.student_universities
    } : {}),
    ...(studentContext.distance_to_uni_km != null ? { distance_to_uni_km: studentContext.distance_to_uni_km } : {})
  };
  return {
    ...safeProperty,
    title: publicTitle,
    description: publicDescription,
    district: locationOverride?.district || safeProperty.district,
    latitude: !hasUsablePublicPin && locationOverride ? locationOverride.latitude : safeProperty.latitude,
    longitude: !hasUsablePublicPin && locationOverride ? locationOverride.longitude : safeProperty.longitude,
    nearest_university: studentContext.nearest_university || safeProperty.nearest_university || null,
    distance_to_uni_km: studentContext.distance_to_uni_km,
    student_universities: studentContext.student_universities,
    extra_fields: extraWithStudentContext,
    land_verification: buildUgNlisLandVerificationPack(property?.extra_fields || {}),    featured: safeProperty.featured === true || String(safeExtra?.featured || '').toLowerCase() === 'true',
    featured_at: safeProperty.featured_at || safeExtra?.featured_at || null,
    public_contact_phone: publicContactPhone || null,
    contact_phone: publicContactPhone || null,
    id_number_present: !!property?.id_number,
    id_document_present: !!property?.id_document_name,
    agent_id: foundOnlinePublic ? null : safeProperty.agent_id,
    lister_phone: foundOnlinePublic ? null : safeProperty.lister_phone,
    lister_email: foundOnlinePublic ? null : safeProperty.lister_email,
    primary_image_url: foundOnlinePublic ? null : safeProperty.primary_image_url,
    image: foundOnlinePublic ? null : safeProperty.image,
    images: foundOnlinePublic ? [] : images,
    third_party_discovery_result: foundOnlinePublic,
    listing_origin: foundOnlinePublic ? 'found_online' : (safeProperty.listed_by || (safeProperty.agent_id || safeProperty.lister_type === 'agent' ? 'agent' : 'private'))
  };
}

async function loadPropertyWithImages(propertyId) {
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
      a.email AS agent_email,
      a.registration_status AS agent_registration_status
     FROM properties p
     LEFT JOIN agents a ON a.id = p.agent_id
     WHERE p.id = $1`,
    [propertyId]
  );

  if (!property.rows.length) return null;

  const images = await db.query(
    `SELECT id, url, is_primary, sort_order, slot_key, room_label
     FROM property_images
     WHERE property_id = $1
     ORDER BY is_primary DESC, sort_order ASC, created_at ASC`,
    [propertyId]
  );

  return {
    property: property.rows[0],
    images: images.rows
  };
}

async function loadAutomatedReviewForProperty(propertyId) {
  const loaded = await loadPropertyWithImages(propertyId);
  if (!loaded) return null;
  const { property, images } = loaded;
  const [
    previousListerListings,
    likelyDuplicates,
    reusedImages,
    idNumberMatches,
    matchingUsers
  ] = await Promise.all([
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
      [propertyId, property.lister_phone || null, property.lister_email || null]
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
        property.title || '',
        property.address || null,
        property.listing_type,
        property.district,
        property.area,
        property.price
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
      [propertyId, property.id_number || null]
    ),
    db.query(
      `SELECT id, first_name, last_name, phone, email, role, status, created_at
       FROM users
       WHERE ($1::text IS NOT NULL AND phone = $1)
          OR ($2::text IS NOT NULL AND LOWER(COALESCE(email, '')) = LOWER($2))
       ORDER BY created_at DESC
       LIMIT 20`,
      [property.lister_phone || null, property.lister_email || null]
    )
  ]);

  const externalDuplicateScan = getCachedExternalDuplicateScan(property);

  return buildAutomatedListingReview({
    listing: property,
    images,
    previousListerListings: previousListerListings.rows,
    likelyDuplicates: likelyDuplicates.rows,
    reusedImages: reusedImages.rows,
    idNumberMatches: idNumberMatches.rows,
    matchingUsers: matchingUsers.rows,
    externalDuplicateScan
  });
}

async function issueListingSubmitOtp({ channel = 'phone', phone = '', email = '', preferredLanguage = 'en', audience = 'listing' }) {
  const resolvedChannel = String(channel || 'phone').toLowerCase() === 'email' ? 'email' : 'phone';
  const identifier = resolvedChannel === 'email' ? normalizeEmail(email) : normalizeUgPhone(phone);
  const overrideAllowed = canUseAdminOtpOverride({ channel: resolvedChannel, identifier });
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresMinutes = Math.max(parseInt(process.env.OTP_EXPIRES_MINUTES || '10', 10), 1);
  const normalizedLanguage = normalizePreferredLanguage(preferredLanguage);
  const otpCopy = getListingOtpCopy(normalizedLanguage, { otp, expiresMinutes, audience });
  if (!identifier) {
    throw new Error('Missing OTP identifier');
  }

  await db.query(
    "UPDATE otps SET used = TRUE WHERE phone = $1 AND purpose = 'listing_submit' AND used = FALSE",
    [identifier]
  );

  await db.query(
    `INSERT INTO otps (phone, code, purpose, expires_at)
     VALUES ($1, $2, 'listing_submit', NOW() + ($3::text || ' minutes')::interval)`,
    [identifier, otp, String(expiresMinutes)]
  );

  const emailDeliveryConfirmed = (delivery) => delivery?.sent === true && delivery?.mocked !== true;
  const phoneDeliveryConfirmed = (delivery) => {
    if (!delivery || delivery.mocked) return false;
    if (delivery.sid || delivery.messageId || delivery.sent === true) return true;
    const status = String(delivery.status || '').trim().toLowerCase();
    if (!status || /(fail|reject|invalid|error|undeliver)/i.test(status)) return false;
    return ['sent', 'success', 'submitted', 'queued', 'accepted', 'buffered'].includes(status);
  };

  if (resolvedChannel === 'email') {
    let delivery = null;
    try {
      delivery = await sendOtpEmail({
        to: identifier,
        subject: audience === 'agent' ? 'makaug agent verification code' : 'makaug listing verification code',
        otp,
        expiresMinutes,
        purpose: audience === 'agent' ? 'agent' : 'listing',
        intro: audience === 'agent'
          ? 'Welcome to makaug broker verification. Use this code to continue your broker application.'
          : 'Use this code to continue publishing your property on makaug.',
        footer: otpCopy
      });
    } catch (error) {
      logger.error('Listing OTP email failed:', error.message);
      if (overrideAllowed) {
        logger.warn('Listing OTP email failed, using ADMIN_OTP_OVERRIDE_CODE fallback');
        return { otp, expiresMinutes, channel: resolvedChannel, identifier };
      }
      const sendError = new Error('Failed to send OTP email');
      sendError.status = 400;
      throw sendError;
    }
    if (process.env.NODE_ENV === 'production' && !emailDeliveryConfirmed(delivery)) {
      logger.warn('Listing email OTP delivery unavailable', { channel: resolvedChannel, delivery });
      if (overrideAllowed) {
        logger.warn('Listing OTP email delivery unavailable, using ADMIN_OTP_OVERRIDE_CODE fallback');
        return { otp, expiresMinutes, channel: resolvedChannel, identifier };
      }
      const reason = String(delivery?.error || delivery?.reason || '').toLowerCase();
      const configError = new Error(
        (reason.includes('smtpclientauthentication') || reason.includes('5.7.139'))
          ? 'Email OTP is blocked by Microsoft 365 tenant policy. Enable Authenticated SMTP or configure Microsoft Graph mail delivery.'
          : 'Email OTP delivery provider is not configured'
      );
      configError.status = 400;
      throw configError;
    }
  } else {
    let delivery = null;
    try {
      delivery = await smsService.sendSMS(
        identifier,
        otpCopy
      );
    } catch (error) {
      logger.error('Listing OTP SMS failed:', error.message);
      if (overrideAllowed) {
        logger.warn('Listing OTP SMS failed, using ADMIN_OTP_OVERRIDE_CODE fallback');
        return { otp, expiresMinutes, channel: resolvedChannel, identifier };
      }
      const sendError = new Error('Failed to send OTP SMS');
      sendError.status = 400;
      throw sendError;
    }
    if (process.env.NODE_ENV === 'production' && !phoneDeliveryConfirmed(delivery)) {
      if (overrideAllowed) {
        logger.warn('Listing OTP SMS delivery unavailable, using ADMIN_OTP_OVERRIDE_CODE fallback');
        return { otp, expiresMinutes, channel: resolvedChannel, identifier };
      }
      const configError = new Error('Phone OTP delivery provider is not configured');
      configError.status = 400;
      throw configError;
    }
  }

  return { otp, expiresMinutes, channel: resolvedChannel, identifier };
}

function parseBooleanLike(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = cleanText(value).toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

function identityVerificationConfirmedFromBody(body = {}, checklist = {}) {
  if (parseBooleanLike(body.identity_verified, false)) return true;
  if (parseBooleanLike(body.identityVerified, false)) return true;
  if (parseBooleanLike(body.identity_document_verified, false)) return true;
  if (parseBooleanLike(body.identityDocumentVerified, false)) return true;
  if (parseBooleanLike(body.id_document_clear_and_matches, false)) return true;
  if (parseBooleanLike(checklist.identity_document_verified, false)
      && parseBooleanLike(checklist.identity_number_matches_document, false)) return true;
  if (parseBooleanLike(checklist.identity_verified, false)) return true;
  return false;
}

function normalizeStructuredRejectionReasons(body = {}) {
  const rawReasons = body.structured_rejection_reasons
    || body.rejection_reasons
    || body.structuredRejectionReasons
    || body.rejectionReasons
    || [];
  return asArray(rawReasons)
    .map((item) => cleanText(item).toLowerCase().replace(/[^a-z0-9_ -]+/g, '').replace(/\s+/g, '_'))
    .filter(Boolean)
    .slice(0, 8);
}

function buildManualOwnerStatusNotification({ listing = {}, status, reason }) {
  const message = buildOwnerStatusMessage({ listing, status, reason });
  const phone = cleanText(listing.lister_phone);
  const email = cleanText(listing.lister_email);
  return {
    email: {
      sent: false,
      reason: email ? 'manual_first_fast_status_update' : 'no_lister_email',
      subject: message.subject,
      message: message.text
    },
    whatsapp: {
      sent: false,
      reason: phone ? 'manual_first_fast_status_update' : 'no_lister_phone',
      phone: phone || null,
      message: message.whatsapp,
      manual_url: phone ? getDirectWhatsAppUrl(phone, message.whatsapp) : ''
    }
  };
}

async function getPrimaryImageUrlForProperty(propertyId) {
  if (!propertyId) return '';
  try {
    const result = await db.query(
      `SELECT url
       FROM property_images
       WHERE property_id = $1
       ORDER BY is_primary DESC, sort_order ASC, created_at ASC
       LIMIT 1`,
      [propertyId]
    );
    return cleanText(result.rows[0]?.url || '');
  } catch (error) {
    logger.warn('Unable to load primary listing image for notification', {
      property_id: propertyId,
      message: error.message
    });
    return '';
  }
}

function isSourcedInventoryCandidateRecord(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const source = cleanText(row.source || extra.source).toLowerCase();
  const listedVia = cleanText(row.listed_via || extra.listed_via).toLowerCase();
  return row.sourced_inventory_candidate === true
    || row.found_online_candidate === true
    || extra.sourced_inventory_candidate === true
    || extra.found_online_candidate === true
    || extra.found_online === true
    || source === 'sourced_inventory_candidate_v1'
    || source === 'found_online_property_source_v1'
    || listedVia === 'sourced_inventory'
    || listedVia === 'found_online';
}

function sourcedCandidateRecordHasApprovalLocation(row = {}) {
  const extra = row.extra_fields && typeof row.extra_fields === 'object' ? row.extra_fields : {};
  const hasCoordinates = row.latitude != null && row.longitude != null;
  return Boolean(
    cleanText(row.area)
      || cleanText(row.district)
      || cleanText(row.address)
      || cleanText(row.location)
      || cleanText(extra.area)
      || cleanText(extra.district)
      || cleanText(extra.location)
      || cleanText(extra.source_area)
      || cleanText(extra.source_location)
      || cleanText(extra.location_label)
      || hasCoordinates
  );
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
      if (listingTypeFilter === 'student') {
        values.push('student', 'students');
        whereType = ` AND listing_type IN ($2, $3)`;
      } else {
        values.push(listingTypeFilter);
        whereType = ` AND listing_type = $2`;
      }
    }

    const areas = await db.query(
      `SELECT DISTINCT area
       FROM properties
       WHERE ${publicLivePropertyStatusSql('')} AND area ILIKE $1${whereType}
       ORDER BY area ASC
       LIMIT 20`,
      values
    );

    const streets = await db.query(
      `SELECT DISTINCT extra_fields->>'street_name' AS street_name
       FROM properties
       WHERE ${publicLivePropertyStatusSql('')}
         AND COALESCE(extra_fields->>'street_name', '') ILIKE $1${whereType}
       ORDER BY extra_fields->>'street_name' ASC
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
    streets.rows.forEach((r) => {
      if (r.street_name) items.push({ label: r.street_name, category: 'street' });
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

async function listPropertiesHandler(req, res, next) {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const filters = [];
    const values = [];

    const listingType = normalizeListingType(req.query.listing_type || req.query.type || req.query.category);
    const studentPortal = parseBooleanLike(req.query.student_portal, false);
    const district = cleanText(req.query.district);
    const area = cleanText(req.query.area || req.query.search || req.query.query);
    const status = cleanText(req.query.status || 'approved').toLowerCase();
    const minPrice = toNullableInt(req.query.min_price || req.query.minPrice);
    const maxPrice = toNullableInt(req.query.max_price || req.query.maxPrice);
    const minBeds = toNullableInt(req.query.min_beds || req.query.bedrooms);
    const maxBeds = toNullableInt(req.query.max_beds);
    const bathrooms = toNullableInt(req.query.bathrooms);
    const propertyType = cleanText(req.query.property_type || req.query.propertyType);
    const listingOrigin = normalizeListingOrigin(req.query.listing_origin || req.query.listingOrigin || req.query.origin_type);
    const amenities = asArray(req.query.amenities).map((item) => cleanText(item).toLowerCase()).filter(Boolean);
    const furnished = cleanText(req.query.furnished || req.query.furnishing).toLowerCase();
    const minSize = toNullableFloat(req.query.min_size || req.query.minSize || req.query.min_area_sqm || req.query.minAreaSqm || req.query.min_acres || req.query.minAcres);
    const maxSize = toNullableFloat(req.query.max_size || req.query.maxSize || req.query.max_area_sqm || req.query.maxAreaSqm || req.query.max_acres || req.query.maxAcres);
    const maxStudentDistanceKm = toNullableFloat(req.query.max_distance_km || req.query.distance_to_uni_km || req.query.distanceToUniKm);
    const studentCampus = cleanText(req.query.studentCampus || req.query.student_campus);
    const landTitleType = cleanText(req.query.landTitleType || req.query.land_title_type);
    const landTitleAvailable = normalizeLandTitleAvailability(req.query.landTitleAvailable ?? req.query.land_title_available ?? req.query.titleAvailable ?? req.query.title_available);
    const commercialType = cleanText(req.query.commercialType || req.query.commercial_type);
    const transactionType = normalizeCommercialTransactionType(req.query.transactionType || req.query.transaction_type);
    const currency = cleanText(req.query.currency || 'UGX').toUpperCase();
    const source = cleanText(req.query.source || 'web_search');
    const language = cleanText(req.query.language || req.query.lang || 'en').toLowerCase();
    const sessionId = cleanText(req.query.session || req.query.session_id || req.query.guest_session_id);
    const locationSource = cleanText(req.query.locationSource || req.query.location_source);
    const publicOnly = parseBooleanLike(req.query.public_only || req.query.publicOnly, false);
    const featuredRaw = req.query.featured ?? req.query.is_featured ?? req.query.isFeatured;
    const featuredFilterRequested = featuredRaw !== undefined && featuredRaw !== null && cleanText(featuredRaw) !== '';
    const featuredOnly = parseBooleanLike(featuredRaw, false);
    const summaryOnly = parseBooleanLike(req.query.summary_only || req.query.summaryOnly, false);
    const includeSummary = summaryOnly || parseBooleanLike(req.query.include_summary ?? req.query.includeSummary ?? true, true);
    const cardFieldsOnly = parseBooleanLike(req.query.card_fields ?? req.query.cardFields ?? false, false);
    const radiusUnit = cleanText(req.query.radiusUnit || req.query.radius_unit || (req.query.radiusMiles || req.query.radius_miles ? 'miles' : 'km')).toLowerCase();
    const requestingModerationData = status && status !== 'approved';
    const searchLat = toNullableFloat(req.query.lat || req.query.latitude);
    const searchLng = toNullableFloat(req.query.lng || req.query.longitude);
    const requestedRadiusKm = toNullableFloat(req.query.radiusKm || req.query.radius_km);
    const requestedRadiusMiles = toNullableFloat(req.query.radiusMiles || req.query.radius_miles || req.query.radius);
    const hasRadiusSearch = searchLat != null && searchLng != null;
    const radiusKm = requestedRadiusKm || normalizeRadiusKm(requestedRadiusMiles ? requestedRadiusMiles * 1.609344 : null, DEFAULT_SEARCH_RADIUS_MILES);
    let distanceSql = 'NULL::numeric';

    let adminAccess = false;
    if (requestingModerationData && !publicOnly) {
      adminAccess = await hasAdminAccess(req);
      if (!adminAccess) {
        return res.status(403).json({
          ok: false,
          error: 'Admin access is required to list non-public properties'
        });
      }
    } else if (!publicOnly && hasAdminCredentialHint(req)) {
      adminAccess = await hasAdminAccess(req);
    }

    const canUsePublicResponseCache = req.method === 'GET'
      && !adminAccess
      && !hasAdminCredentialHint(req)
      && !hasRadiusSearch
      && (publicOnly || status === 'approved' || !status);
    const forcePublicCacheRefresh = canUsePublicResponseCache && isPublicCacheRefreshRequest(req);
    const publicCache = canUsePublicResponseCache ? getPublicPropertiesCache(req) : { key: '', payload: null };
    if (publicCache.payload && !forcePublicCacheRefresh) {
      res.set('Cache-Control', publicPropertiesCacheControl());
      res.set('X-Makaug-Properties-Cache', 'HIT');
      return res.json(publicCache.payload);
    }

    // Anonymous list callers only need public card data. Keep moderation fields
    // on authenticated paths so the common public route avoids the heavier
    // agent join and wide row materialization.
    const fastPublicCardFields = !adminAccess;

    if (publicOnly || !adminAccess) {
      addPublicLaunchSeedFilter(filters, values);
    }

    if (studentPortal) {
      addFilter(filters, values, "(p.listing_type IN (?, ?) OR (p.listing_type = ? AND p.students_welcome = ?))", 'student', 'students', 'rent', true);
    } else if (listingType && LISTING_TYPES.includes(listingType)) {
      if (listingType === 'student') {
        addFilter(filters, values, 'p.listing_type IN (?, ?)', 'student', 'students');
      } else {
        addFilter(filters, values, 'p.listing_type = ?', listingType);
      }
    }

    if (district) {
      addFilter(filters, values, 'p.district = ?', district);
    }

    if (area) {
      if (cardFieldsOnly && !adminAccess) {
        addPublicCardLocationSearchFilter(filters, values, area);
      } else if (publicOnly || !adminAccess) {
        addPublicLocationSearchFilter(filters, values, area);
      } else {
        addFilter(
          filters,
          values,
          '(p.area ILIKE ? OR p.title ILIKE ? OR p.district ILIKE ? OR COALESCE(p.address, \'\') ILIKE ? OR COALESCE(p.description, \'\') ILIKE ? OR COALESCE(p.extra_fields->>\'city\', \'\') ILIKE ? OR COALESCE(p.extra_fields->>\'neighborhood\', \'\') ILIKE ? OR COALESCE(p.extra_fields->>\'street_name\', \'\') ILIKE ? OR COALESCE(p.extra_fields->>\'region\', \'\') ILIKE ? OR COALESCE(p.extra_fields->>\'resolved_location_label\', \'\') ILIKE ?)',
          `%${area}%`,
          `%${area}%`,
          `%${area}%`,
          `%${area}%`,
          `%${area}%`,
          `%${area}%`,
          `%${area}%`,
          `%${area}%`,
          `%${area}%`,
          `%${area}%`
        );
      }
    }

    if (status && status !== 'all') {
      if (status === 'approved') {
        filters.push(publicLivePropertyStatusSql('p'));
      } else {
        addFilter(filters, values, 'p.status = ?', status);
      }
    } else if (publicOnly || !adminAccess) {
      filters.push(publicLivePropertyStatusSql('p'));
    }
    if (featuredFilterRequested) {
      if (featuredOnly) {
        filters.push("(COALESCE(p.extra_fields->>'featured', 'false') IN ('true', '1', 'yes'))");
      } else {
        filters.push("(COALESCE(p.extra_fields->>'featured', 'false') NOT IN ('true', '1', 'yes'))");
      }
    }
    if (listingOrigin) {
      addFilter(filters, values, `${listingOriginSql('p')} = ?`, listingOrigin);
    }

    if (minPrice != null) addFilter(filters, values, 'p.price >= ?', minPrice);
    if (maxPrice != null) addFilter(filters, values, 'p.price <= ?', maxPrice);
    if (minBeds != null) addFilter(filters, values, 'p.bedrooms >= ?', minBeds);
    if (maxBeds != null) addFilter(filters, values, 'p.bedrooms <= ?', maxBeds);
    if (bathrooms != null) addFilter(filters, values, 'p.bathrooms >= ?', bathrooms);
    if (propertyType) {
      addFilter(
        filters,
        values,
        "(p.property_type ILIKE ? OR p.listing_type ILIKE ? OR COALESCE(p.extra_fields->>'room_type', '') ILIKE ? OR COALESCE(p.extra_fields->>'commercial_type', '') ILIKE ?)",
        `%${propertyType}%`,
        `%${propertyType}%`,
        `%${propertyType}%`,
        `%${propertyType}%`
      );
    }
    if (amenities.length) {
      amenities.forEach((amenity) => {
        addFilter(
          filters,
          values,
          "(LOWER(COALESCE(p.amenities::text, '')) LIKE ? OR LOWER(COALESCE(p.description, '')) LIKE ? OR LOWER(COALESCE(p.extra_fields::text, '')) LIKE ?)",
          `%${amenity}%`,
          `%${amenity}%`,
          `%${amenity}%`
        );
      });
    }
    if (furnished) {
      const furnishedNeedle = `%${furnished}%`;
      addFilter(
        filters,
        values,
        "(LOWER(COALESCE(p.furnishing, '')) LIKE ? OR LOWER(COALESCE(p.extra_fields->>'furnished', p.extra_fields->>'furnishing', '')) LIKE ? OR LOWER(COALESCE(p.description, '')) LIKE ?)",
        furnishedNeedle,
        furnishedNeedle,
        furnishedNeedle
      );
    }
    if (minSize != null) {
      addFilter(filters, values, "COALESCE(p.floor_area_sqm, p.usable_size_sqm, p.land_size_value) >= ?", minSize);
    }
    if (maxSize != null) {
      addFilter(filters, values, "COALESCE(p.floor_area_sqm, p.usable_size_sqm, p.land_size_value) <= ?", maxSize);
    }
    if (maxStudentDistanceKm != null) {
      addFilter(filters, values, 'p.distance_to_uni_km <= ?', maxStudentDistanceKm);
    }
    if (studentCampus) {
      addFilter(
        filters,
        values,
        "(COALESCE(p.nearest_university, p.extra_fields->>'nearest_university', '') ILIKE ? OR COALESCE(p.extra_fields->>'student_campus', '') ILIKE ? OR COALESCE(p.description, '') ILIKE ?)",
        `%${studentCampus}%`,
        `%${studentCampus}%`,
        `%${studentCampus}%`
      );
    }
    if (landTitleType) {
      addFilter(filters, values, "(COALESCE(p.title_type, '') ILIKE ? OR COALESCE(p.extra_fields->>'title_type', '') ILIKE ?)", `%${landTitleType}%`, `%${landTitleType}%`);
    }
    if (landTitleAvailable) {
      addFilter(
        filters,
        values,
        "LOWER(COALESCE(p.extra_fields->>'land_title_available', p.extra_fields->>'landTitleAvailable', p.extra_fields->>'title_available', '')) = ?",
        landTitleAvailable
      );
    }
    if (transactionType) {
      addFilter(filters, values, 'p.transaction_type = ?', transactionType);
    }
    if (commercialType) {
      const normalizedCommercialType = normalizeCommercialPropertyType(commercialType) || commercialType.toLowerCase();
      addFilter(filters, values, "LOWER(COALESCE(p.property_type, p.extra_fields->>'commercial_type', '')) = ?", normalizedCommercialType);
    }

    if (hasRadiusSearch) {
      if (!isPointInUganda(searchLat, searchLng)) {
        try {
          await db.query(
            `INSERT INTO property_search_requests (user_phone, payload)
             VALUES (NULL, $1::jsonb)`,
            [JSON.stringify({
              source: source || 'web_radius_search',
              language,
              session_id: sessionId || null,
              location: {
                analytics: roundLocationForAnalytics(searchLat, searchLng)
              },
              radius_km: Number(radiusKm.toFixed(3)),
              radius_miles: Number(kmToMiles(radiusKm).toFixed(2)),
              radius_unit: radiusUnit || 'miles',
              location_source: locationSource || null,
              outside_uganda: true,
              fallback: 'manual_uganda_search'
            })]
          );
        } catch (logError) {
          logger.warn('Failed to log outside-Uganda radius search', { error: logError.message });
        }
        return res.status(400).json({
          ok: false,
          error: 'Location appears outside Uganda. Choose a Ugandan area or search all Uganda.',
          data: {
            outside_uganda: true,
            fallback: 'manual_uganda_search'
          }
        });
      }
      values.push(searchLat);
      const latRef = `$${values.length}`;
      values.push(searchLng);
      const lngRef = `$${values.length}`;
      distanceSql = buildHaversineSql(latRef, lngRef);
      filters.push('p.latitude IS NOT NULL');
      filters.push('p.longitude IS NOT NULL');
      values.push(radiusKm);
      filters.push(`${distanceSql} <= $${values.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    let opportunitySummary;
    let opportunitySummaryMeta = null;
    if (includeSummary) {
      try {
        const summaryResult = await loadPublicOpportunitySummary({
          where,
          values,
          timeoutMs: 4000
        });
        opportunitySummary = summaryResult.summary;
        opportunitySummaryMeta = summaryResult.meta;
      } catch (error) {
        logger.warn('Public property list is continuing without a cold summary', {
          code: error?.code,
          message: error?.message
        });
        opportunitySummary = null;
        opportunitySummaryMeta = {
          cache: 'unavailable',
          marker: PUBLIC_INVENTORY_METRICS_MARKER,
          fallback_reason: error?.code === '57014'
            ? 'statement_timeout'
            : error?.code === 'POOL_TIMEOUT' ? 'pool_timeout' : 'query_failed'
        };
      }
    } else {
      opportunitySummary = null;
    }
    const hasOpportunitySummary = Boolean(opportunitySummary);
    const total = hasOpportunitySummary ? Number(opportunitySummary.total || 0) : null;
    if (summaryOnly) {
      if (opportunitySummaryMeta?.marker) res.set('X-Makaug-Properties-Count-Marker', opportunitySummaryMeta.marker);
      return res.json({
        ok: true,
        data: [],
        summary: {
          public_opportunities: opportunitySummary || null
        },
        pagination: hasOpportunitySummary
          ? toPagination(total, page, limit)
          : { page, limit, total: null, total_pages: null },
        meta: {
          marker: PUBLIC_INVENTORY_METRICS_MARKER,
          ...(area ? { search_count_marker: PUBLIC_LOCATION_SEARCH_PERFORMANCE_MARKER } : {}),
          count_cache: opportunitySummaryMeta?.cache || 'unknown',
          ...(opportunitySummaryMeta?.fallback_reason ? { count_fallback_reason: opportunitySummaryMeta.fallback_reason } : {})
        }
      });
    }
    if (hasOpportunitySummary && total === 0) {
      try {
        await db.query(
          `INSERT INTO property_search_requests (user_phone, payload)
           VALUES (NULL, $1::jsonb)`,
          [JSON.stringify({
            source: hasRadiusSearch ? 'web_radius_no_results' : 'web_no_results',
            original_source: source || null,
            search_type: listingType || (studentPortal ? 'student' : 'any'),
            query: area || null,
            filters: {
              min_price: minPrice,
              max_price: maxPrice,
              currency,
              bedrooms: minBeds,
              bathrooms,
              property_type: propertyType || null,
              amenities,
              student_campus: studentCampus || null,
              land_title_type: landTitleType || null,
              land_title_available: landTitleAvailable || null,
              commercial_type: commercialType || null,
              transaction_type: transactionType || null,
              listing_origin: listingOrigin || null
            },
            location: hasRadiusSearch ? {
              lat: Number(searchLat.toFixed(5)),
              lng: Number(searchLng.toFixed(5)),
              analytics: roundLocationForAnalytics(searchLat, searchLng)
            } : null,
            radius_km: hasRadiusSearch ? Number(radiusKm.toFixed(3)) : null,
            radius_miles: hasRadiusSearch ? Number(kmToMiles(radiusKm).toFixed(2)) : null,
            radius_unit: hasRadiusSearch ? (radiusUnit || 'miles') : null,
            location_source: hasRadiusSearch ? (locationSource || null) : null,
            language,
            session_id: sessionId || null,
            result_count: 0
          })]
        );
      } catch (logError) {
        logger.warn('Failed to log no-results property search', { error: logError.message });
      }
    }

    const publicPriceSortMaxUgx = 100000000000;
    const priceSortRankSql = `(CASE WHEN p.price IS NOT NULL AND p.price > 0 AND p.price <= ${publicPriceSortMaxUgx} THEN 0 ELSE 1 END)`;
    const sortMap = {
      featured: "p.extra_fields->>'featured_at' DESC NULLS LAST, p.updated_at DESC, p.created_at DESC, p.id DESC",
      newest: 'p.created_at DESC, p.id DESC',
      oldest: 'p.created_at ASC, p.id ASC',
      price_asc: `${priceSortRankSql} ASC, p.price ASC NULLS LAST, p.created_at DESC, p.id DESC`,
      price_desc: `${priceSortRankSql} ASC, p.price DESC NULLS LAST, p.created_at DESC, p.id DESC`
    };

    const defaultSort = featuredFilterRequested && featuredOnly ? 'featured' : 'newest';
    const sortBy = cleanText(req.query.sort || defaultSort).toLowerCase();
    const orderBy = hasRadiusSearch
      ? `${distanceSql} ASC NULLS LAST, p.created_at DESC, p.id DESC`
      : (sortMap[sortBy] || sortMap.newest);

    const publicExtraFieldsSql = `(COALESCE(p.extra_fields, '{}'::jsonb)
        - 'raw_source_post'
        - 'source_text'
        - 'source_caption'
        - 'source_description'
        - 'source_visual_text'
        - 'video_ocr_text'
        - 'frame_ocr_text'
        - 'source_comments'
        - 'source_transcript'
        - 'transcript'
        - 'ocr_text'
        - 'raw_caption')`;
    const extraFieldsSelectSql = adminAccess
      ? 'p.extra_fields AS admin_extra_fields'
      : `${publicExtraFieldsSql} AS admin_extra_fields`;
    const rowLimit = hasOpportunitySummary ? limit : limit + 1;
    const listValues = [...values, rowLimit, offset];

    const listSql = fastPublicCardFields
      ? `SELECT
          p.id,
          p.listing_type,
          p.title,
          p.description,
          p.district,
          p.area,
          p.address,
          p.price,
          p.price_currency,
          p.price_original,
          p.price_fx_rate_ugx,
          p.price_fx_as_of,
          p.price_period,
          p.transaction_type,
          p.bedrooms,
          p.bathrooms,
          p.property_type,
          p.nearest_university,
          p.distance_to_uni_km,
          p.room_type,
          p.title_type,
          p.status,
          p.created_at,
          p.latitude,
          p.longitude,
          p.students_welcome,
          p.agent_id,
          p.lister_phone,
          ${extraFieldsSelectSql},
          COALESCE(p.extra_fields->>'found_online_candidate', p.extra_fields->>'sourced_inventory_candidate') AS found_online_candidate,
          p.extra_fields->>'city' AS city,
          p.extra_fields->>'neighborhood' AS neighborhood,
          p.extra_fields->>'street_name' AS street_name,
          p.extra_fields->>'video_url' AS video_url,
          p.extra_fields->>'youtube_url' AS youtube_url,
          p.extra_fields->>'preferred_contact_method' AS preferred_contact_method,
          p.extra_fields->>'region' AS region,
          p.extra_fields->>'resolved_location_label' AS resolved_location_label,
          ${distanceSql} AS distance_km,
          (COALESCE(p.extra_fields->>'featured', 'false') IN ('true', '1', 'yes')) AS featured,
          p.extra_fields->>'featured_at' AS featured_at,
          CASE
            WHEN p.agent_id IS NOT NULL OR p.lister_type = 'agent' THEN 'agent'
            ELSE 'private'
          END AS listed_by,
          ${listingOriginSql('p')} AS listing_origin,
          COALESCE(p.extra_fields->>'lister_registration_status', 'not_registered') AS registration_status,
          img.url AS primary_image_url
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
        OFFSET $${values.length + 2}`
      : `WITH public_page_source AS (
        SELECT
          p.id,
          p.listing_type,
          p.title,
          p.description,
          p.district,
          p.area,
          p.address,
          p.price,
          p.price_currency,
          p.price_original,
          p.price_fx_rate_ugx,
          p.price_fx_as_of,
          p.price_period,
          p.transaction_type,
          p.bedrooms,
          p.bathrooms,
          p.property_type,
          p.nearest_university,
          p.distance_to_uni_km,
          p.room_type,
          p.room_arrangement,
          p.title_type,
          p.status,
          p.moderation_stage,
          p.moderation_notes,
          p.moderation_reason,
          p.sold_at,
          p.created_at,
          p.latitude,
          p.longitude,
          p.students_welcome,
          p.new_until,
          p.inquiry_reference,
          p.amenities,
          p.agent_id,
          p.source,
          p.listed_via,
          p.lister_name,
          p.lister_phone,
          p.lister_email,
          ${extraFieldsSelectSql},
          COALESCE(p.extra_fields->>'found_online_candidate', p.extra_fields->>'sourced_inventory_candidate') AS found_online_candidate,
          p.extra_fields->>'city' AS city,
          p.extra_fields->>'neighborhood' AS neighborhood,
          p.extra_fields->>'street_name' AS street_name,
          p.extra_fields->>'video_url' AS video_url,
          p.extra_fields->>'youtube_url' AS youtube_url,
          p.extra_fields->>'preferred_contact_method' AS preferred_contact_method,
          p.extra_fields->>'region' AS region,
          p.extra_fields->>'resolved_location_label' AS resolved_location_label,
          ${distanceSql} AS distance_km,
          (COALESCE(p.extra_fields->>'featured', 'false') IN ('true', '1', 'yes')) AS featured,
          p.extra_fields->>'featured_at' AS featured_at,
          CASE
            WHEN p.agent_id IS NOT NULL OR p.lister_type = 'agent' THEN 'agent'
            ELSE 'private'
          END AS listed_by,
          ${listingOriginSql('p')} AS listing_origin,
          CASE
            WHEN p.agent_id IS NOT NULL THEN COALESCE(a.registration_status, 'not_registered')
            WHEN p.lister_type = 'agent' THEN COALESCE(p.extra_fields->>'lister_registration_status', 'not_registered')
            ELSE COALESCE(p.extra_fields->>'lister_registration_status', 'not_registered')
          END AS registration_status
        FROM properties p
        LEFT JOIN agents a ON a.id = p.agent_id
        ${where}
        ORDER BY ${orderBy}
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
      ),
      public_page AS (
        SELECT public_page_source.*, ROW_NUMBER() OVER () AS __page_order
        FROM public_page_source
      )
      SELECT
        public_page.*,
        img.url AS primary_image_url
      FROM public_page
      LEFT JOIN LATERAL (
        SELECT i.url
        FROM property_images i
        WHERE i.property_id = public_page.id
        ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC
        LIMIT 1
      ) img ON true
      ORDER BY public_page.__page_order`;
    const listResult = await withPublicPropertyDatabaseRetry(() => db.query(listSql, listValues));
    const hasMoreRows = !hasOpportunitySummary && listResult.rows.length > limit;
    const responseRows = hasMoreRows ? listResult.rows.slice(0, limit) : listResult.rows;
    const pagination = hasOpportunitySummary
      ? toPagination(total, page, limit)
      : approximatePublicPagination({
        page,
        limit,
        offset,
        rowCount: responseRows.length,
        hasMore: hasMoreRows
      });
    if (hasRadiusSearch) {
      try {
        await db.query(
          `INSERT INTO property_search_requests (user_phone, payload)
           VALUES (NULL, $1::jsonb)`,
          [JSON.stringify({
            source: source || 'web_radius_search',
            search_type: listingType || (studentPortal ? 'student' : 'any'),
            query: area || null,
            language,
            session_id: sessionId || null,
            location: {
              lat: Number(searchLat.toFixed(5)),
              lng: Number(searchLng.toFixed(5)),
              analytics: roundLocationForAnalytics(searchLat, searchLng)
            },
            radius_km: Number(radiusKm.toFixed(3)),
            radius_miles: Number(kmToMiles(radiusKm).toFixed(2)),
            radius_unit: radiusUnit || 'miles',
            location_source: locationSource || null,
            filters: {
              min_price: minPrice,
              max_price: maxPrice,
              currency,
              bedrooms: minBeds,
              bathrooms,
              property_type: propertyType || null,
              amenities,
              student_campus: studentCampus || null,
              land_title_type: landTitleType || null,
              land_title_available: landTitleAvailable || null,
              commercial_type: commercialType || null,
              transaction_type: transactionType || null
            },
            result_count: responseRows.length,
            outside_uganda: false
          })]
        );
      } catch (logError) {
        logger.warn('Failed to log radius property search', { error: logError.message });
      }
    }

    const payload = {
      ok: true,
      data: responseRows.map((row) => {
        if (cardFieldsOnly && !adminAccess) {
          return compactPublicCardRow(row, currency);
        }
        const {
          admin_extra_fields: adminExtraFields,
          source: rowSource,
          listed_via: rowListedVia,
          lister_name: rowListerName,
          lister_phone: rowListerPhone,
          lister_email: rowListerEmail,
          moderation_stage: rowModerationStage,
          moderation_notes: rowModerationNotes,
          moderation_reason: rowModerationReason,
          found_online_candidate: rowFoundOnlineCandidate,
          __page_order: rowPageOrder,
          ...publicRow
        } = row;
        const distanceKm = row.distance_km == null ? null : Number(Number(row.distance_km).toFixed(3));
        const safeExtra = publicExtraFields(adminExtraFields || {});
        const foundOnlinePublic = isFoundOnlinePublicRow(row, safeExtra);
        const primaryImageUrl = foundOnlinePublic ? null : normalizePublicImageUrl(row.primary_image_url);
        const locationOverride = publicLocationOverrideForListing(row, safeExtra);
        const hasUsablePublicPin = isUsablePublicCoordinate(row.latitude, row.longitude);
        const publicDistrict = locationOverride?.district || row.district;
        const publicLatitude = !hasUsablePublicPin && locationOverride ? locationOverride.latitude : row.latitude;
        const publicLongitude = !hasUsablePublicPin && locationOverride ? locationOverride.longitude : row.longitude;
        const publicTitle = foundOnlinePublic
          ? buildThirdPartyPublicTitle(row, safeExtra)
          : cleanPublicListingCopy(publicRow.title || '');
        const publicDescription = foundOnlinePublic
          ? buildThirdPartyPublicSummary(row, safeExtra)
          : cleanPublicListingCopy(publicRow.description || '');
        const studentContext = studentUniversityContextFor(row, safeExtra);
        const publicContactPhone = publicContactPhoneForRow(row, safeExtra);
        const publicExtra = {
          ...safeExtra,
          public_contact_phone: publicContactPhone || null,
          contact_phone: publicContactPhone || null,
          ...(studentContext.nearest_university ? {
            nearest_university: studentContext.nearest_university,
            student_campus: studentContext.nearest_university,
            student_universities: studentContext.student_universities
          } : {}),
          ...(studentContext.distance_to_uni_km != null ? { distance_to_uni_km: studentContext.distance_to_uni_km } : {})
        };
        const responseRow = {
          ...publicRow,
          title: publicTitle,
          description: publicDescription,
          district: publicDistrict,
          latitude: publicLatitude,
          longitude: publicLongitude,
          agent_id: foundOnlinePublic ? null : publicRow.agent_id,
          primary_image_url: primaryImageUrl,
          listingId: row.id,
          slug: row.id,
          url: `/property/${row.id}`,
          category: row.listing_type,
          currency,
          location: [row.area, publicDistrict].filter(Boolean).join(', '),
          image: primaryImageUrl,
          verification_status: row.registration_status || null,
          availability: row.status,
          sponsored: row.featured === true,
          listing_origin: row.listing_origin || (foundOnlinePublic ? 'found_online' : (row.listed_by || 'private')),
          distance_km: distanceKm,
          distanceKm,
          distance_miles: distanceKm == null ? null : Number(kmToMiles(Number(distanceKm)).toFixed(2)),
          distanceMiles: distanceKm == null ? null : Number(kmToMiles(Number(distanceKm)).toFixed(2)),
          nearest_university: studentContext.nearest_university || null,
          distance_to_uni_km: studentContext.distance_to_uni_km,
          student_universities: studentContext.student_universities,
          public_contact_phone: publicContactPhone || null,
          contact_phone: publicContactPhone || null,
          extra_fields: publicExtra,
          third_party_discovery_result: foundOnlinePublic
        };
        if (adminAccess) {
          responseRow.source = rowSource || null;
          responseRow.listed_via = rowListedVia || null;
          responseRow.lister_name = rowListerName || null;
          responseRow.lister_phone = rowListerPhone || null;
          responseRow.lister_email = rowListerEmail || null;
          responseRow.moderation_stage = rowModerationStage || null;
          responseRow.moderation_notes = rowModerationNotes || null;
          responseRow.moderation_reason = rowModerationReason || null;
          responseRow.extra_fields = adminExtraFields || {};
          responseRow.found_online_candidate = rowFoundOnlineCandidate === 'true'
            || adminExtraFields?.found_online_candidate === true
            || adminExtraFields?.found_online === true;
        }
        return responseRow;
      }),
      search: hasRadiusSearch ? {
        latitude: searchLat,
        longitude: searchLng,
        radius_km: Number(radiusKm.toFixed(3)),
        radius_miles: Number(kmToMiles(radiusKm).toFixed(2)),
        privacy: {
          exact_location_public: false,
          analytics_location: roundLocationForAnalytics(searchLat, searchLng)
        }
      } : null,
      summary: {
        public_opportunities: hasOpportunitySummary ? opportunitySummary : null
      },
      pagination,
      meta: {
        marker: PUBLIC_INVENTORY_METRICS_MARKER,
        ...(area ? { search_count_marker: PUBLIC_LOCATION_SEARCH_PERFORMANCE_MARKER } : {}),
        ...(includeSummary ? { count_cache: opportunitySummaryMeta?.cache || 'unknown' } : {}),
        ...(opportunitySummaryMeta?.fallback_reason ? { count_fallback_reason: opportunitySummaryMeta.fallback_reason } : {})
      }
    };
    if (canUsePublicResponseCache) setPublicPropertiesCache(publicCache.key, payload);
    res.set('Cache-Control', canUsePublicResponseCache ? publicPropertiesCacheControl() : 'no-store');
    res.set('X-Makaug-Properties-Cache', canUsePublicResponseCache ? (forcePublicCacheRefresh ? 'REFRESH' : 'MISS') : 'BYPASS');
    return res.json(payload);
  } catch (error) {
    return next(error);
  }
}

router.get('/search', listPropertiesHandler);
router.get('/', listPropertiesHandler);

const PROPERTY_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

router.param('id', (req, res, next, id) => {
  if (!PROPERTY_UUID_PATTERN.test(String(id || '').trim())) {
    return res.status(400).json({
      ok: false,
      error: 'Invalid property id'
    });
  }
  return next();
});

router.get('/:id', async (req, res, next) => {
  try {
    const loaded = await loadPropertyWithImages(req.params.id);

    if (!loaded) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    const { property, images } = loaded;
    const ownerToken = getOwnerEditTokenFromRequest(req);
    const ownerCanPreview = canUseOwnerEditToken(property, ownerToken);
    const adminAccess = hasAdminCredentialHint(req) ? await hasAdminAccess(req) : false;
    const canViewNonPublic = isPublicLivePropertyStatus(property.status)
      || ownerCanPreview
      || adminAccess;

    if (!canViewNonPublic) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    if (isLaunchSeedListing(property) && !ownerCanPreview && !adminAccess) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    return res.json({
      ok: true,
      data: publicPropertyRow(property, images)
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id/preview', async (req, res, next) => {
  try {
    const loaded = await loadPropertyWithImages(req.params.id);
    if (!loaded) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    const { property, images } = loaded;
    const token = getOwnerEditTokenFromRequest(req);
    if (!canUseOwnerEditToken(property, token)) {
      return res.status(403).json({ ok: false, error: 'Invalid or expired listing preview token' });
    }

    return res.json({
      ok: true,
      data: {
        ...publicPropertyRow(property, images),
        owner_can_edit: ['pending', 'rejected'].includes(String(property.status || '').toLowerCase()),
        moderation_reason: property.moderation_reason || property.extra_fields?.moderation_reason || null
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/preview', async (req, res, next) => {
  try {
    const loaded = await loadPropertyWithImages(req.params.id);
    if (!loaded) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    const { property } = loaded;
    const token = getOwnerEditTokenFromRequest(req);
    if (!canUseOwnerEditToken(property, token)) {
      return res.status(403).json({ ok: false, error: 'Invalid or expired listing preview token' });
    }

    const currentStatus = String(property.status || '').toLowerCase();
    if (!['pending', 'rejected'].includes(currentStatus)) {
      return res.status(400).json({
        ok: false,
        error: 'This listing can only be edited while pending or rejected'
      });
    }

    const patch = req.body?.listing && typeof req.body.listing === 'object' ? req.body.listing : req.body;
    const fieldMap = {
      title: { column: 'title', value: cleanText(patch.title), required: true },
      description: { column: 'description', value: cleanText(patch.description), required: true },
      area: { column: 'area', value: cleanText(patch.area), required: true },
      address: { column: 'address', value: cleanText(patch.address) || null },
      price: { column: 'price', value: toNullableInt(patch.price) },
      price_period: { column: 'price_period', value: cleanText(patch.price_period) || null },
      transaction_type: {
        column: 'transaction_type',
        value: normalizeCommercialTransactionType(
          patch.transaction_type || patch.transactionType || patch.commercial_mode || patch.commercial_intent,
          {
            pricePeriod: patch.price_period || property.price_period,
            title: patch.title || property.title,
            description: patch.description || property.description
          }
        ) || null
      },
      property_type: { column: 'property_type', value: cleanText(patch.property_type) || null },
      title_type: { column: 'title_type', value: cleanText(patch.title_type) || null },
      bedrooms: { column: 'bedrooms', value: toNullableInt(patch.bedrooms) },
      bathrooms: { column: 'bathrooms', value: toNullableInt(patch.bathrooms) }
    };

    const setParts = [];
    const values = [req.params.id];
    let idx = 2;
    const errors = [];

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

    const resubmit = req.body?.resubmit === true || String(req.body?.resubmit || '').toLowerCase() === 'true';
    if (resubmit) {
      setParts.push("status = 'pending'");
      setParts.push("moderation_stage = 'resubmitted'");
      setParts.push('moderation_reason = NULL');
      setParts.push('reviewed_at = NULL');
    }

    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });
    }

    if (!setParts.length) {
      return res.status(400).json({ ok: false, error: 'No supported listing fields supplied' });
    }

    setParts.push('owner_last_edited_at = NOW()');
    setParts.push('updated_at = NOW()');

    const updated = await db.query(
      `UPDATE properties
       SET ${setParts.join(', ')}
       WHERE id = $1
       RETURNING id, title, description, district, area, price, price_period, property_type, title_type, status, moderation_stage, owner_last_edited_at`,
      values
    );

    await db.query(
      `INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, notes)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.params.id,
        'listing_owner',
        resubmit ? 'owner_listing_resubmitted' : 'owner_listing_edited',
        currentStatus,
        updated.rows[0]?.status || currentStatus,
        cleanText(req.body?.edit_note) || null
      ]
    );

    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/request-submit-otp', async (req, res, next) => {
  try {
    const channelInput = cleanText(req.body.channel).toLowerCase();
    const channel = channelInput === 'email' ? 'email' : 'phone';
    const phone = normalizeUgPhone(req.body.phone);
    const email = normalizeEmail(req.body.email);
    const preferredLanguage = normalizePreferredLanguage(req.body.preferred_language);
    const audience = cleanText(req.body.audience).toLowerCase() === 'agent' ? 'agent' : 'listing';

    if (channel === 'email') {
      if (!email || !isValidEmail(email)) {
        return res.status(400).json({ ok: false, error: 'Valid email is required' });
      }
    } else if (!phone || !isValidPhone(phone) || !isValidUgPhone(phone)) {
      return res.status(400).json({ ok: false, error: 'Valid Uganda phone is required' });
    }

    const { otp, expiresMinutes, identifier } = await issueListingSubmitOtp({ channel, phone, email, preferredLanguage, audience });

    return res.json({
      ok: true,
      data: {
        channel,
        identifier,
        phone: channel === 'phone' ? phone : undefined,
        email: channel === 'email' ? email : undefined,
        expires_minutes: expiresMinutes,
        message: channel === 'email' ? 'OTP sent to email' : 'OTP sent by SMS',
        ...(process.env.NODE_ENV === 'production' ? {} : { dev_otp: otp })
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/verify-submit-otp', async (req, res, next) => {
  try {
    const channelInput = cleanText(req.body.channel).toLowerCase();
    const channel = channelInput === 'email' ? 'email' : 'phone';
    const phone = normalizeUgPhone(req.body.phone);
    const email = normalizeEmail(req.body.email);
    const code = cleanText(req.body.code);
    const identifier = channel === 'email' ? email : phone;

    if (!identifier || !code) {
      return res.status(400).json({ ok: false, error: `${channel} and code are required` });
    }
    if (channel === 'phone' && (!isValidPhone(phone) || !isValidUgPhone(phone))) {
      return res.status(400).json({ ok: false, error: 'Valid Uganda phone is required' });
    }
    if (channel === 'email' && !isValidEmail(email)) {
      return res.status(400).json({ ok: false, error: 'Valid email is required' });
    }

    const usedOverride = isAdminOtpOverrideMatch({ code, channel, identifier });

    if (!usedOverride) {
      const otpResult = await db.query(
        `SELECT *
         FROM otps
         WHERE phone = $1
           AND code = $2
           AND purpose = 'listing_submit'
           AND used = FALSE
           AND expires_at > NOW()
         ORDER BY created_at DESC
         LIMIT 1`,
        [identifier, code]
      );

      if (!otpResult.rows.length) {
        return res.status(400).json({ ok: false, error: 'Invalid or expired OTP code' });
      }

      await db.query('UPDATE otps SET used = TRUE WHERE id = $1', [otpResult.rows[0].id]);
    } else {
      logger.warn('Listing OTP verified via ADMIN_OTP_OVERRIDE_CODE fallback', {
        channel,
        identifier
      });
    }
    const listingOtpToken = createListingSubmitToken({ channel, phone, email });

    return res.json({
      ok: true,
      data: {
        channel,
        identifier,
        phone: channel === 'phone' ? phone : undefined,
        email: channel === 'email' ? email : undefined,
        listing_otp_token: listingOtpToken,
        expires_in: process.env.LISTING_OTP_EXPIRES_IN || '30m'
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/listing-intent', async (req, res, next) => {
  try {
    const body = req.body || {};
    const modeRaw = cleanText(body.mode || body.listing_mode).toLowerCase();
    const mode = modeRaw === 'whatsapp_ai' || modeRaw === 'whatsapp' ? 'whatsapp_ai' : 'online';
    const listingTypeRaw = normalizeListingType(body.listing_type || body.type);
    const listingType = LISTING_TYPES.includes(listingTypeRaw) ? listingTypeRaw : 'sale';
    const title = cleanText(body.title) || null;
    const location = cleanText(body.location || body.full_address || body.area || body.district) || null;
    const phone = normalizeUgPhone(body.phone || body.whatsapp || body.user_phone);
    const email = normalizeEmail(body.email || body.user_email);
    const language = normalizePreferredLanguage(body.language || body.preferred_language);
    const sourcePage = cleanText(body.source_page) || '/list-property';

    const lead = await createLead(db, {
      contact: {
        name: cleanText(body.name) || 'Listing owner',
        phone: isValidPhone(phone) ? phone : null,
        email: isValidEmail(email) ? email : null,
        preferredContactChannel: mode === 'whatsapp_ai' ? 'whatsapp' : 'in_app',
        preferredLanguage: language,
        roleType: 'listing_owner',
        locationInterest: location || '',
        categoryInterest: listingType
      },
      source: mode === 'whatsapp_ai' ? 'list_property_whatsapp_ai' : 'list_property_online',
      leadType: 'listing_owner',
      category: listingType,
      location: location || '',
      message: mode === 'whatsapp_ai'
        ? 'Owner chose WhatsApp AI listing path.'
        : 'Owner chose online listing form.',
      activityType: 'listing_path_selected',
      metadata: {
        mode,
        listing_type: listingType,
        title,
        location,
        source_page: sourcePage
      }
    });

    await logNotification(db, {
      recipientPhone: isValidPhone(phone) ? phone : null,
      recipientEmail: isValidEmail(email) ? email : null,
      channel: mode === 'whatsapp_ai' ? 'whatsapp' : 'in_app',
      type: 'list_property_path_selected',
      status: mode === 'whatsapp_ai' ? 'provider_missing' : 'logged',
      failureReason: mode === 'whatsapp_ai' ? 'External WhatsApp handoff opens from browser; inbound provider confirms when configured.' : null,
      payloadSummary: {
        mode,
        listing_type: listingType,
        title,
        location,
        source_page: sourcePage
      },
      relatedLeadId: lead?.id || null
    });

    if (mode === 'whatsapp_ai') {
      await logWhatsAppMessage(db, {
        recipientPhone: process.env.MAKAUG_WHATSAPP_NUMBER || '+256760112587',
        templateKey: 'list_property_whatsapp_ai',
        messageType: 'handoff',
        language,
        status: 'manual_url',
        relatedLeadId: lead?.id || null,
        failureReason: 'wa.me handoff logged; provider inbox records delivery when configured.'
      });
    }

    captureLearningEvent({
      eventName: 'list_property_path_selected',
      source: sourcePage,
      channel: mode === 'whatsapp_ai' ? 'whatsapp' : 'web',
      sessionId: `list_property_intent:${Date.now()}`,
      externalUserId: phone || email || sourcePage,
      inputText: [mode, listingType, title, location].filter(Boolean).join(' | '),
      responseText: mode === 'whatsapp_ai' ? 'User selected WhatsApp AI listing path.' : 'User selected online listing path.',
      payload: {
        mode,
        listing_type: listingType,
        title,
        location,
        source_page: sourcePage,
        related_lead_id: lead?.id || null
      },
      entities: {
        listing_type: listingType,
        location: location || ''
      },
      dedupeKey: `list_property_intent:${mode}:${listingType}:${sourcePage}:${phone || email || 'anonymous'}`,
      requestIp: req.ip,
      userAgent: req.get('user-agent')
    });

    return res.status(201).json({
      ok: true,
      data: {
        mode,
        listing_type: listingType,
        lead_id: lead?.id || null,
        logged: true
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const authUser = await getOptionalAuthUser(req);
    const extraFields = typeof body.extra_fields === 'object' && body.extra_fields !== null ? body.extra_fields : {};
    const landVerificationPatch = sanitizeUgNlisLandVerificationFields({
      ...extraFields,
      ...body,
      land_verification: body.land_verification || extraFields.land_verification,
      ugnlis: body.ugnlis || extraFields.ugnlis,
      ugnlis_transaction_number: body.ugnlis_transaction_number ?? extraFields.ugnlis_transaction_number
    });
    if (Object.keys(landVerificationPatch).length) {
      Object.assign(extraFields, landVerificationPatch);
    }
    const requestedBrokerSubmission = authUser?.role === 'agent_broker'
      && (
        cleanText(body.lister_type).toLowerCase() === 'agent'
        || cleanText(body.listed_via).toLowerCase().includes('broker')
        || extraFields?.broker_submission === true
      );
    let brokerAgent = requestedBrokerSubmission ? await findBrokerAgentForUser(authUser) : null;
    if (requestedBrokerSubmission && !brokerAgent) {
      await ensurePostVerificationRecords(db, authUser);
      brokerAgent = await findBrokerAgentForUser(authUser);
    }
    const brokerCanSkipOwnerIdentity = Boolean(brokerAgent?.id);

    const listingType = normalizeListingType(body.listing_type);
    const title = cleanText(body.title);
    const district = cleanText(body.district);
    const area = cleanText(body.area);
    const description = cleanText(body.description);
    const priceMetadata = propertyPriceMetadata(body.price, {
      currency: body.price_currency || body.currency,
      fxAsOf: body.price_fx_as_of || undefined
    });
    const price = priceMetadata.price;
    const transactionType = normalizeCommercialTransactionType(
      body.transaction_type || body.transactionType || body.commercial_mode || body.commercial_intent,
      {
        pricePeriod: body.price_period,
        title,
        description
      }
    );
    const commercialPropertyType = listingType === 'commercial'
      ? normalizeCommercialPropertyType(body.property_type || body.commercial_type, { title, description })
      : cleanText(body.property_type);

    const errors = [];

    if (!LISTING_TYPES.includes(listingType)) errors.push('listing_type is required and must be valid');
    if (!title) errors.push('title is required');
    if (!district) errors.push('district is required');
    if (!area) errors.push('area is required');
    if (!description) errors.push('description is required');
    if (price == null || price < 10000) {
      errors.push('price must be provided in UGX or USD and convert to at least UGX 10,000');
    }
    if (listingType === 'commercial' && !transactionType) {
      errors.push('transaction_type is required for commercial listings and must be rent or sale');
    }
    if (listingType === 'commercial' && !commercialPropertyType) {
      errors.push('property_type is required for commercial listings');
    }

    if (district && !DISTRICTS.includes(district)) {
      errors.push('district must be one of Uganda\'s valid districts');
    }

    const brokerFullName = cleanText([authUser?.first_name, authUser?.last_name].filter(Boolean).join(' '));
    const listerName = brokerCanSkipOwnerIdentity
      ? (brokerAgent.full_name || brokerFullName || 'makaug broker')
      : cleanText(body.lister_name);
    const listerEmail = brokerCanSkipOwnerIdentity
      ? cleanText(authUser?.email || brokerAgent?.email || body.lister_email)
      : cleanText(body.lister_email);
    const listerEmailNormalized = normalizeEmail(listerEmail);
    const listerPhone = brokerCanSkipOwnerIdentity
      ? normalizeUgPhone(authUser?.phone || brokerAgent?.phone || brokerAgent?.whatsapp || body.lister_phone)
      : normalizeUgPhone(body.lister_phone);
    const listingOtpToken = cleanText(body.listing_otp_token);
    const otpChannelInput = cleanText(body.otp_channel || body.extra_fields?.verify?.otp_channel || 'phone').toLowerCase();
    const otpChannel = otpChannelInput === 'email' ? 'email' : 'phone';
    const latitude = toNullableFloat(body.latitude);
    const longitude = toNullableFloat(body.longitude);
    const studentsWelcome = parseBooleanLike(body.students_welcome, false);
    const verificationTermsAccepted = parseBooleanLike(body.verification_terms_accepted, false);
    const inquiryReference = cleanText(body.inquiry_reference) || buildListingReference();
    const newUntilDate = body.new_until ? new Date(body.new_until) : new Date(Date.now() + (5 * 24 * 60 * 60 * 1000));
    const newUntil = Number.isNaN(newUntilDate.getTime()) ? new Date(Date.now() + (5 * 24 * 60 * 60 * 1000)) : newUntilDate;
    const idNumber = normalizeUgNin(body.id_number || extraFields?.verify?.nin || extraFields?.verify?.id_number);
    const idDocumentName = cleanText(body.id_document_name || extraFields?.verify?.id_document_name);
    let idDocumentUrl = cleanText(body.id_document_url || extraFields?.verify?.id_document_url);
    const idDocumentType = cleanText(body.id_document_type || body.id_document_mime_type || extraFields?.verify?.id_document_type || extraFields?.verify?.id_document_mime_type);

    if (listerEmail && !isValidEmail(listerEmail)) errors.push('lister_email is invalid');
    if (listerPhone && !isValidPhone(listerPhone)) errors.push('lister_phone is invalid');
    if (listerPhone && !isValidUgPhone(listerPhone)) errors.push('lister_phone must be a valid Uganda phone (+256XXXXXXXXX)');
    if (latitude != null && (latitude < -90 || latitude > 90)) errors.push('latitude is out of range');
    if (longitude != null && (longitude < -180 || longitude > 180)) errors.push('longitude is out of range');

    const listedVia = cleanText(body.listed_via || (brokerCanSkipOwnerIdentity ? 'broker_dashboard' : 'website')).toLowerCase();
    const listedViaBrokerPath = listedVia.includes('broker');
    const enforceWebsiteSubmissionRules = !brokerCanSkipOwnerIdentity && (listedVia === 'website' || listedVia === 'web' || listedVia === 'desktop' || listedViaBrokerPath);
    const resolvedListerType = brokerCanSkipOwnerIdentity ? 'agent' : (cleanText(body.lister_type) || 'owner');
    if (listedViaBrokerPath && !brokerCanSkipOwnerIdentity) {
      errors.push('Signed-in broker profile is required before using the broker listing path');
    }
    const submittedImageItems = asArray(body.images)
      .map((item) => {
        if (typeof item === 'string') {
          return { url: cleanText(item), slot_key: null, room_label: null };
        }
        return {
          url: cleanText(item?.url),
          slot_key: cleanText(item?.slot_key || item?.slot) || null,
          room_label: cleanText(item?.room_label || item?.label || item?.slot_label) || null
        };
      })
      .filter((item) => item.url);
    const submittedImages = submittedImageItems.map((item) => item.url);
    const invalidSubmittedImages = submittedImages.filter((url) => !isUsableSubmittedImageUrl(url));
    const websiteMinImages = 5;
    const websiteMaxImages = 20;

    if (enforceWebsiteSubmissionRules) {
      if (!listerEmailNormalized || !isValidEmail(listerEmailNormalized)) {
        errors.push('lister_email is required for online listing review updates');
      }
      if (!listerPhone) {
        errors.push('lister_phone is required for online listing contact');
      }
      if (submittedImages.length < websiteMinImages || submittedImages.length > websiteMaxImages) {
        errors.push(`At least ${websiteMinImages} and no more than ${websiteMaxImages} property images are required for website submissions`);
      }
      if (invalidSubmittedImages.length) {
        errors.push('Each property image must include a viewable image URL');
      }
      if (!idNumber) {
        errors.push('id_number is required for online listing review');
      } else if (!isValidUgNin(idNumber)) {
        errors.push('id_number must be a valid Uganda NIN');
      }
      if (!idDocumentName && !idDocumentUrl) {
        errors.push('National ID photo is required. Upload a photo image; PDFs are not accepted');
      } else if (!isAcceptedNationalIdPhoto({ name: idDocumentName, url: idDocumentUrl, mimeType: idDocumentType })) {
        errors.push('National ID must be uploaded as a photo image. PDFs are not accepted. Please take a picture and upload it');
      }
      if (listingOtpToken) {
        const verified = verifyListingSubmitToken(listingOtpToken);
        if (!verified.ok) {
          errors.push('listing_otp_token is invalid or expired');
        } else if (verified.channel === 'email') {
          if (!listerEmailNormalized || verified.identifier !== listerEmailNormalized) {
            errors.push('listing_otp_token does not match lister_email');
          }
        } else if (!listerPhone || verified.identifier !== listerPhone) {
          errors.push('listing_otp_token does not match lister_phone');
        }
      }
    }

    // All public submissions are forced to pending review.
    const status = 'pending';
    const ownerEditToken = createOwnerEditToken();
    const ownerEditTokenHash = hashOwnerEditToken(ownerEditToken);
    const ownerEditTokenExpiresAt = ownerEditTokenExpiry();

    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });
    }

    idDocumentUrl = await prepareMediaUrlForStorage(idDocumentUrl, {
      keyPrefix: `listing-submissions/${inquiryReference}/identity`,
      filename: idDocumentName || 'national-id-photo',
      isPrivate: true,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      maxBytes: 5 * 1024 * 1024,
      label: 'National ID photo'
    });
    if (idDocumentUrl || idNumber) {
      extraFields.verify = {
        ...(extraFields.verify && typeof extraFields.verify === 'object' ? extraFields.verify : {}),
        ...(idDocumentUrl ? { id_document_url: idDocumentUrl } : {}),
        ...(idNumber ? { nin: idNumber, id_number: idNumber } : {})
      };
    }
    const storedSubmittedImageItems = [];
    for (const [index, item] of submittedImageItems.entries()) {
      storedSubmittedImageItems.push({
        ...item,
        url: await prepareMediaUrlForStorage(item.url, {
          keyPrefix: `listing-submissions/${inquiryReference}/photos`,
          filename: item.room_label || item.slot_key || `property-photo-${index + 1}`,
          isPrivate: false,
          allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
          maxBytes: 6 * 1024 * 1024,
          label: 'Property image'
        })
      });
    }

    const amenities = asArray(body.amenities).map((x) => cleanText(x)).filter(Boolean);
    const videoUrl = cleanText(body.video_url || body.youtube_url || extraFields.video_url || extraFields.youtube_url);
    const availableFrom = cleanText(body.available_from || extraFields.available_from);
    const preferredContactMethod = cleanText(body.preferred_contact_method || extraFields.preferred_contact_method || body.extra_fields?.contact_pref).toLowerCase();
    if (videoUrl) extraFields.video_url = videoUrl;
    if (/youtube\.com|youtu\.be/i.test(videoUrl)) extraFields.youtube_url = videoUrl;
    if (availableFrom) extraFields.available_from = availableFrom;
    if (['phone', 'whatsapp', 'email', 'both'].includes(preferredContactMethod)) {
      extraFields.preferred_contact_method = preferredContactMethod;
    }
    extraFields.price_currency = priceMetadata.price_currency;
    extraFields.price_original = priceMetadata.price_original;
    extraFields.price_fx_rate_ugx = priceMetadata.price_fx_rate_ugx;
    extraFields.price_fx_as_of = priceMetadata.price_fx_as_of;
    extraFields.price_conversion_basis = priceMetadata.price_currency === 'USD'
      ? 'Original submitted USD guide converted to canonical UGX for search and valuation.'
      : 'Original submitted UGX guide stored without conversion.';
    const landTitleAvailable = normalizeLandTitleAvailability(
      body.land_title_available
        ?? body.landTitleAvailable
        ?? body.title_available
        ?? extraFields.land_title_available
        ?? extraFields.landTitleAvailable
        ?? extraFields.title_available
        ?? extraFields.land_title_status,
      title,
      description,
      extraFields.source_title,
      extraFields.source_caption,
      extraFields.source_description,
      extraFields.source_text,
      extraFields.source_visual_text
    );
    if (landTitleAvailable) {
      extraFields.land_title_available = landTitleAvailable;
      extraFields.land_title_available_label = landTitleAvailabilityLabel(landTitleAvailable);
    }
    if (brokerCanSkipOwnerIdentity) {
      extraFields.broker_submission = true;
      extraFields.broker_agent_id = brokerAgent.id;
      extraFields.broker_listing_review = 'Admin approval required before this broker listing goes live.';
      extraFields.skip_owner_identity_recheck = true;
    }
    const nearestUniversity = normalizeUniversityName(
      body.nearest_university
      || extraFields.nearest_university
      || extraFields.nearest_uni
      || extraFields.student_campus
      || extraFields.student_university
      || extraFields.university
    ) || ((listingType === 'student' || studentsWelcome)
      ? inferNearestUniversityFromListing({
        ...body,
        listing_type: listingType,
        title,
        description,
        district,
        area,
        address: cleanText(body.address) || '',
        extra_fields: extraFields
      })
      : '');
    const distanceToUniversityKm = toNullableFloat(body.distance_to_uni_km ?? extraFields.distance_to_uni_km ?? extraFields.uni_distance);
    if (nearestUniversity) {
      extraFields.nearest_university = nearestUniversity;
      extraFields.student_campus = nearestUniversity;
      extraFields.student_universities = normalizeUniversityList([
        ...(Array.isArray(extraFields.student_universities) ? extraFields.student_universities : []),
        nearestUniversity
      ]);
    }
    if (distanceToUniversityKm != null) {
      extraFields.distance_to_uni_km = distanceToUniversityKm;
    }

    const insertResult = await db.query(
      `INSERT INTO properties (
        listing_type,
        transaction_type,
        title,
        description,
        district,
        area,
        address,
        price,
        price_currency,
        price_original,
        price_fx_rate_ugx,
        price_fx_as_of,
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
        latitude,
        longitude,
        students_welcome,
        verification_terms_accepted,
        inquiry_reference,
        id_number,
        id_document_name,
        id_document_url,
        new_until,
        amenities,
        extra_fields,
        lister_name,
        lister_phone,
        lister_email,
        lister_type,
        listed_via,
        source,
        status,
        moderation_stage,
        owner_edit_token_hash,
        owner_edit_token_expires_at,
        expires_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
        $31,$32,$33,$34,$35,$36,$37,$38,$39,$40,
        $41,$42,$43,$44,$45,$46,$47,$48,$49,$50,
        $51,$52,$53
      ) RETURNING id, created_at`,
      [
        listingType,
        transactionType || null,
        title,
        description,
        district,
        area,
        cleanText(body.address) || null,
        price,
        priceMetadata.price_currency,
        priceMetadata.price_original,
        priceMetadata.price_fx_rate_ugx,
        priceMetadata.price_fx_as_of,
        cleanText(body.price_period) || null,
        toNullableInt(body.bedrooms),
        toNullableInt(body.bathrooms),
        commercialPropertyType || null,
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
        nearestUniversity || null,
        distanceToUniversityKm,
        cleanText(body.room_type) || null,
        cleanText(body.room_arrangement) || null,
        cleanText(body.commercial_intent) || null,
        latitude,
        longitude,
        listingType === 'student' ? true : studentsWelcome,
        verificationTermsAccepted,
        inquiryReference,
        idNumber || null,
        idDocumentName || null,
        idDocumentUrl || null,
        newUntil,
        JSON.stringify(amenities),
        JSON.stringify(extraFields),
        listerName || null,
        listerPhone || null,
        listerEmailNormalized || null,
        resolvedListerType,
        listedVia || 'website',
        cleanText(body.source) || 'website',
        status,
        'submitted',
        ownerEditTokenHash,
        ownerEditTokenExpiresAt,
        body.expires_at ? new Date(body.expires_at) : null
      ]
    );

    const propertyId = insertResult.rows[0].id;
    if (brokerCanSkipOwnerIdentity) {
      await db.query(
        `UPDATE properties
         SET agent_id = $2,
             lister_type = 'agent',
             lister_name = COALESCE(NULLIF($3, ''), lister_name),
             lister_phone = COALESCE(NULLIF($4, ''), lister_phone),
             lister_email = COALESCE(NULLIF($5, ''), lister_email),
             extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $6::jsonb,
             updated_at = NOW()
         WHERE id = $1`,
        [
          propertyId,
          brokerAgent.id,
          listerName,
          listerPhone,
          listerEmailNormalized,
          JSON.stringify({
            broker_agent_id: brokerAgent.id,
            broker_status: brokerAgent.status || 'pending',
            broker_submission: true
          })
        ]
      );
    }
    captureLearningEvent({
      eventName: 'property_listing_submitted',
      source: cleanText(body.source) || 'website',
      channel: 'web',
      sessionId: `property_listing:${propertyId}`,
      externalUserId: listerPhone || listerEmailNormalized || listerName || propertyId,
      inputText: [title, description, district, area].filter(Boolean).join(' | '),
      responseText: 'Listing submitted for makaug admin review.',
      payload: {
        id: propertyId,
        listing_type: listingType,
        title,
        district,
        area,
        price,
        price_period: cleanText(body.price_period) || null,
        property_type: cleanText(body.property_type) || null,
        available_from: extraFields.available_from || null,
        lister_type: resolvedListerType,
        image_count: submittedImages.length,
        inquiry_reference: inquiryReference
      },
      entities: {
        location: [area, district].filter(Boolean).join(', '),
        listing_type: listingType,
        budget_ugx: price
      },
      dedupeKey: `property_listing:${propertyId}`,
      requestIp: req.ip,
      userAgent: req.get('user-agent')
    });

    const imageItems = storedSubmittedImageItems.slice(0, enforceWebsiteSubmissionRules ? websiteMaxImages : 20);
    const imageUrls = imageItems.map((item) => item.url);

    for (let i = 0; i < imageUrls.length; i += 1) {
      await db.query(
        `INSERT INTO property_images (property_id, url, is_primary, sort_order, slot_key, room_label)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [propertyId, imageUrls[i], i === 0, i, imageItems[i]?.slot_key || null, imageItems[i]?.room_label || null]
      );
    }

    const submissionLead = await createLead(db, {
      listingId: propertyId,
      agentId: brokerCanSkipOwnerIdentity ? brokerAgent.id : null,
      buyerRef: listerPhone || listerEmailNormalized || inquiryReference,
      billable: false,
      charged: false,
      contact: {
        name: listerName || 'Listing owner',
        phone: listerPhone || null,
        email: listerEmailNormalized || null,
        preferredContactChannel: preferredContactMethod || 'whatsapp',
        preferredLanguage: normalizePreferredLanguage(body.preferred_language),
        roleType: brokerCanSkipOwnerIdentity ? 'broker' : (resolvedListerType || 'listing_owner'),
        locationInterest: [area, district].filter(Boolean).join(', '),
        categoryInterest: listingType,
        budgetRange: price ? String(price) : ''
      },
      source: 'listing_submission',
      leadType: 'listing_owner',
      category: listingType,
      location: [area, district].filter(Boolean).join(', '),
      budget: price,
      message: `Property submitted for review: ${title}`,
      activityType: 'listing_submitted',
      metadata: {
        inquiry_reference: inquiryReference,
        image_count: imageUrls.length,
        listed_via: listedVia || 'website',
        broker_agent_id: brokerCanSkipOwnerIdentity ? brokerAgent.id : null
      }
    });

    let supportEmailNotification = { sent: false, mocked: true };
    try {
      supportEmailNotification = await sendPropertySubmissionNotification({
        propertyId,
        payload: {
          ...body,
          lister_name: listerName,
          lister_phone: listerPhone,
          lister_email: listerEmailNormalized || null,
          listing_type: listingType,
          district,
          area,
          title,
          inquiry_reference: inquiryReference
        },
        imageCount: imageUrls.length
      });
    } catch (error) {
      logger.error('Property submission support email failed:', error.message);
    }

    let liveListingCount = null;
    try {
      const liveCountResult = await db.query(
        "SELECT COUNT(*)::int AS total FROM properties WHERE status IN ('approved', 'live', 'published')"
      );
      liveListingCount = liveCountResult.rows[0]?.total ?? null;
    } catch (error) {
      logger.warn('Unable to load public live listing count for submitted confirmation', { message: error.message });
    }

    const ownerNotificationListing = {
      id: propertyId,
      title,
      listing_type: listingType,
      inquiry_reference: inquiryReference,
      created_at: insertResult.rows[0].created_at,
      submitted_at: insertResult.rows[0].created_at,
      price,
      currency: cleanText(body.currency || body.price_currency) || 'UGX',
      price_period: cleanText(body.price_period) || null,
      area,
      district,
      primary_image_url: imageUrls[0] || null,
      live_count: liveListingCount,
      lister_name: listerName || null,
      lister_phone: listerPhone || null,
      lister_email: listerEmailNormalized || null
    };

    let ownerNotification = {
      email: { sent: false, reason: 'not_attempted' },
      whatsapp: { sent: false, reason: 'not_attempted' }
    };
    try {
      ownerNotification = await sendOwnerListingSubmissionNotifications({
        listing: ownerNotificationListing,
        token: ownerEditToken
      });
      await db.query(
        `INSERT INTO property_moderation_events (property_id, actor_id, action, status_to, delivery)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          propertyId,
          'system',
          'listing_submitted_for_review',
          status,
          JSON.stringify(ownerNotification)
        ]
      );
    } catch (error) {
      logger.error('Property submission owner notification failed:', error.message);
    }

    await Promise.allSettled([
      logEmailEvent(db, {
        eventType: 'listing_submitted',
        recipientEmail: listerEmailNormalized || null,
        recipientRole: resolvedListerType || 'owner',
        templateKey: 'property_submitted',
        subject: 'Your makaug property listing has been submitted',
        language: normalizePreferredLanguage(body.preferred_language),
        status: notificationStatusFromDelivery(ownerNotification.email),
        provider: ownerNotification.email?.provider || null,
        providerMessageId: ownerNotification.email?.messageId || ownerNotification.email?.provider_message_id || null,
        relatedListingId: propertyId,
        relatedLeadId: submissionLead?.id || null,
        failureReason: ownerNotification.email?.error || ownerNotification.email?.reason || null,
        sentAt: ownerNotification.email?.sent ? new Date() : null
      }),
      logEmailEvent(db, {
        eventType: 'new_listing_pending_review',
        recipientEmail: process.env.SUPPORT_EMAIL || 'info@makaug.com',
        recipientRole: 'admin',
        templateKey: 'admin_alert',
        subject: `New listing pending review • ${inquiryReference}`,
        language: 'en',
        status: notificationStatusFromDelivery(supportEmailNotification),
        relatedListingId: propertyId,
        failureReason: supportEmailNotification?.error || supportEmailNotification?.reason || null,
        sentAt: supportEmailNotification?.sent ? new Date() : null
      }),
      logWhatsAppMessage(db, {
        recipientPhone: listerPhone || null,
        templateKey: 'listing_submitted',
        messageType: 'template',
        language: normalizePreferredLanguage(body.preferred_language),
        status: notificationStatusFromDelivery(ownerNotification.whatsapp),
        relatedListingId: propertyId,
        relatedLeadId: submissionLead?.id || null,
        failureReason: ownerNotification.whatsapp?.error || ownerNotification.whatsapp?.reason || null,
        sentAt: ownerNotification.whatsapp?.sent ? new Date() : null
      }),
      logNotification(db, {
        recipientEmail: listerEmailNormalized || null,
        recipientPhone: listerPhone || null,
        channel: 'email',
        type: 'listing_submitted',
        status: notificationStatusFromDelivery(ownerNotification.email),
        payloadSummary: {
          title,
          inquiry_reference: inquiryReference,
          status,
          delivery: ownerNotification.email || {}
        },
        relatedListingId: propertyId,
        sentAt: ownerNotification.email?.sent ? new Date() : null,
        failureReason: ownerNotification.email?.error || ownerNotification.email?.reason || null
      }),
      logNotification(db, {
        recipientPhone: listerPhone || null,
        channel: 'whatsapp',
        type: 'listing_submitted',
        status: notificationStatusFromDelivery(ownerNotification.whatsapp),
        payloadSummary: {
          title,
          inquiry_reference: inquiryReference,
          status,
          manual_url_available: Boolean(ownerNotification.whatsapp?.manual_url)
        },
        relatedListingId: propertyId,
        sentAt: ownerNotification.whatsapp?.sent ? new Date() : null,
        failureReason: ownerNotification.whatsapp?.error || ownerNotification.whatsapp?.reason || null
      }),
      logNotification(db, {
        recipientEmail: process.env.SUPPORT_EMAIL || 'info@makaug.com',
        channel: 'email',
        type: 'new_listing_pending_review',
        status: notificationStatusFromDelivery(supportEmailNotification),
        payloadSummary: {
          title,
          inquiry_reference: inquiryReference,
          status,
          category: listingType,
          location: [area, district].filter(Boolean).join(', ')
        },
        relatedListingId: propertyId,
        sentAt: supportEmailNotification?.sent ? new Date() : null,
        failureReason: supportEmailNotification?.error || supportEmailNotification?.reason || null
      }),
      logNotification(db, {
        channel: 'in_app',
        type: 'listing_pending_review',
        status: 'logged',
        payloadSummary: { title, inquiry_reference: inquiryReference, status },
        relatedListingId: propertyId,
        relatedLeadId: submissionLead?.id || null
      })
    ]);

    return res.status(201).json({
      ok: true,
      data: {
        id: propertyId,
        status,
        imagesUploaded: imageUrls.length,
        inquiry_reference: inquiryReference,
        new_until: newUntil,
        owner_preview_url: getOwnerPreviewUrl(ownerNotificationListing, ownerEditToken),
        owner_edit_token_expires_at: ownerEditTokenExpiresAt,
        support_notified: !!supportEmailNotification.sent,
        owner_notified: !!(ownerNotification.email?.sent || ownerNotification.whatsapp?.sent),
        owner_email_sent: ownerNotification.email?.sent === true,
        owner_whatsapp_sent: ownerNotification.whatsapp?.sent === true,
        owner_whatsapp_url: ownerNotification.whatsapp?.manual_url || null,
        owner_notification: ownerNotification,
        support_email: process.env.SUPPORT_EMAIL || 'info@makaug.com'
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/:id/whatsapp-click', async (req, res, next) => {
  try {
    const propertyId = req.params.id;
    const source = cleanText(req.body.source) || 'listing_detail_whatsapp';
    const ctaLocation = cleanText(req.body.cta_location) || source;
    const message = cleanText(req.body.message) || 'WhatsApp contact initiated from makaug';
    const contactName = cleanText(req.body.contact_name) || 'WhatsApp contact initiated';
    const contactPhone = cleanText(req.body.contact_phone);
    const contactEmail = cleanText(req.body.contact_email);
    const targetPhone = cleanText(req.body.target_phone);
    const language = cleanText(req.body.language) || 'en';

    if (contactPhone && !isValidPhone(contactPhone)) {
      return res.status(400).json({ ok: false, error: 'contact_phone is invalid' });
    }
    if (contactEmail && !isValidEmail(contactEmail)) {
      return res.status(400).json({ ok: false, error: 'contact_email is invalid' });
    }

    const exists = await db.query(
      `SELECT
         p.id,
         p.agent_id,
         p.title,
         p.inquiry_reference,
         p.status,
         p.lister_name,
         p.lister_phone,
         p.lister_email,
         a.full_name AS agent_name,
         a.phone AS agent_phone,
         a.whatsapp AS agent_whatsapp,
         a.email AS agent_email
       FROM properties p
       LEFT JOIN agents a ON a.id = p.agent_id
       WHERE p.id = $1
         AND (${publicLivePropertyStatusSql('p')} OR LOWER(COALESCE(p.status, '')) = 'sold')
       LIMIT 1`,
      [propertyId]
    );
    if (!exists.rows.length) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    const listingContact = exists.rows[0];
    const resolvedTargetPhone = targetPhone || listingContact.agent_whatsapp || listingContact.agent_phone || listingContact.lister_phone || null;
    const resolvedTargetEmail = listingContact.agent_email || listingContact.lister_email || null;
    const resolvedTargetName = listingContact.agent_name || listingContact.lister_name || null;

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
      [propertyId, contactName, contactPhone || null, contactEmail || null, message, 'whatsapp']
    );

    const lead = await createLead(db, {
      listingId: propertyId,
      agentId: listingContact.agent_id || null,
      buyerRef: contactPhone || contactEmail || req.ip || null,
      billable: Boolean(listingContact.agent_id),
      charged: false,
      contact: {
        name: contactName,
        phone: contactPhone || null,
        email: contactEmail || null,
        preferredContactChannel: 'whatsapp',
        preferredLanguage: language,
        roleType: 'property_seeker'
      },
      source,
      leadType: 'enquiry',
      message,
      activityType: 'whatsapp_contact_initiated',
      metadata: {
        cta_location: ctaLocation,
        target_phone_present: Boolean(resolvedTargetPhone),
        agent_id: listingContact.agent_id || null,
        billable: Boolean(listingContact.agent_id),
        property_reference: exists.rows[0].inquiry_reference || null,
        property_inquiry_id: inserted.rows[0].id
      }
    });

    await logNotification(db, {
      recipientPhone: resolvedTargetPhone || null,
      recipientEmail: resolvedTargetEmail || null,
      channel: 'in_app',
      type: 'whatsapp_contact_initiated',
      status: 'logged',
      payloadSummary: {
        source,
        cta_location: ctaLocation,
        language,
        property_title: exists.rows[0].title,
        inquiry_reference: exists.rows[0].inquiry_reference,
        inquiry_id: inserted.rows[0].id,
        target_contact_name: resolvedTargetName
      },
      relatedListingId: propertyId,
      relatedLeadId: lead?.id || null
    });

    return res.status(201).json({ ok: true, data: inserted.rows[0] });
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

    const exists = await db.query(
      `SELECT
         p.id,
         p.agent_id,
         p.title,
         p.inquiry_reference,
         p.lister_name,
         p.lister_phone,
         p.lister_email,
         a.full_name AS agent_name,
         a.phone AS agent_phone,
         a.whatsapp AS agent_whatsapp,
         a.email AS agent_email
       FROM properties p
       LEFT JOIN agents a ON a.id = p.agent_id
       WHERE p.id = $1
         AND p.status = $2`,
      [propertyId, 'approved']
    );
    if (!exists.rows.length) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    const listingContact = exists.rows[0];
    const targetPhone = listingContact.agent_whatsapp || listingContact.agent_phone || listingContact.lister_phone || null;
    const targetEmail = listingContact.agent_email || listingContact.lister_email || null;
    const targetName = listingContact.agent_name || listingContact.lister_name || null;

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

    const lead = await createLead(db, {
      listingId: propertyId,
      agentId: listingContact.agent_id || null,
      buyerRef: contactPhone || contactEmail || req.ip || null,
      billable: Boolean(listingContact.agent_id),
      charged: false,
      contact: {
        name: contactName,
        phone: contactPhone || null,
        email: contactEmail || null,
        preferredContactChannel: cleanText(req.body.channel) || 'web',
        roleType: 'property_seeker'
      },
      source: cleanText(req.body.channel) || 'web',
      leadType: 'enquiry',
      message: message || 'Property enquiry submitted from makaug.',
      activityType: 'property_enquiry_created',
      metadata: {
        property_inquiry_id: inserted.rows[0].id,
        agent_id: listingContact.agent_id || null,
        billable: Boolean(listingContact.agent_id),
        target_contact_name: targetName,
        property_reference: listingContact.inquiry_reference || null,
        property_title: listingContact.title || null
      }
    });

    await logNotification(db, {
      recipientPhone: targetPhone || null,
      recipientEmail: targetEmail || null,
      channel: 'in_app',
      type: 'property_enquiry_for_lister',
      status: 'logged',
      payloadSummary: {
        inquiry_id: inserted.rows[0].id,
        property_title: listingContact.title,
        inquiry_reference: listingContact.inquiry_reference,
        target_contact_name: targetName
      },
      relatedListingId: propertyId,
      relatedLeadId: lead?.id || null
    });

    return res.status(201).json({ ok: true, data: inserted.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/:id/status', requireListingModerationAccess, async (req, res, next) => {
  try {
    const nextStatus = cleanText(req.body.status).toLowerCase();
    let moderationReason = cleanText(req.body.reason) || null;
    const reviewNotes = cleanText(req.body.review_notes || req.body.notes) || null;
    const warningOverrides = req.body.warning_overrides && typeof req.body.warning_overrides === 'object'
      ? req.body.warning_overrides
      : {};
    const fastAdminRender = parseBooleanLike(req.body.fast_admin_render || req.body.fastAdminRender, false);
    const manualNotificationOnly = parseBooleanLike(
      req.body.manual_notification_only
        || req.body.manualNotificationOnly
        || fastAdminRender,
      false
    );

    if (!PROPERTY_STATUSES.includes(nextStatus)) {
      return res.status(400).json({ ok: false, error: 'Invalid status value' });
    }

    const actorRole = String(req.adminAuth?.role || '').toLowerCase();
    if (actorRole === 'moderator') {
      const moderatorAllowedStatuses = new Set(['approved', 'rejected', 'pending']);
      if (!moderatorAllowedStatuses.has(nextStatus)) {
        return res.status(403).json({
          ok: false,
          error: 'Moderator accounts can only approve, reject, or return listings to pending review'
        });
      }
      const moderatorRequestedSourcedOverride = parseBooleanLike(req.body.sourced_candidate_override || req.body.sourced_candidate_special_dispensation, false);
      const moderatorConfirmedSourceReview = parseBooleanLike(req.body.source_reviewed || req.body.staff_source_reviewed, false);
      if (moderatorRequestedSourcedOverride && !moderatorConfirmedSourceReview) {
        return res.status(403).json({
          ok: false,
          error: 'Found-online staff approval requires source review confirmation'
        });
      }
    }

    if (nextStatus === 'rejected' && !moderationReason) {
      return res.status(400).json({ ok: false, error: 'reason is required when rejecting a listing' });
    }
    const structuredRejectionReasons = normalizeStructuredRejectionReasons(req.body);

    const currentResult = await db.query(
      `SELECT *
       FROM properties
       WHERE id = $1
       LIMIT 1`,
      [req.params.id]
    );

    if (!currentResult.rows.length) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    let current = currentResult.rows[0];
    const approvalWarnings = [];
    const listingPatchResult = await applyStatusListingPatchBeforeModeration(
      req,
      req.params.id,
      current,
      statusListingPatchFromBody(req.body)
    );
    if (listingPatchResult.changed_fields.length) {
      current = listingPatchResult.property || current;
      approvalWarnings.push(`Listing facts updated before moderation status change: ${listingPatchResult.changed_fields.join(', ')}`);
    }
    const highMonthlyPriceConfirmed = parseBooleanLike(
      req.body.high_monthly_price_confirmed
        || req.body.highMonthlyPriceConfirmed
        || req.body.price_basis_confirmed
        || req.body.priceBasisConfirmed,
      false
    );
    if (nextStatus === 'approved') {
      const priceQuality = listingPriceQuality(current, { highMonthlyPriceConfirmed });
      if (!priceQuality.ok) {
        return res.status(400).json({
          ok: false,
          error: 'Listing price data must be corrected or confirmed before approval',
          details: priceQuality.reasons,
          price_quality: priceQuality
        });
      }
      if (priceQuality.warnings.length) {
        approvalWarnings.push(`Price basis confirmed by staff: ${priceQuality.warnings.join(', ')}`);
      }
    }
    const actorId = req.adminAuth?.userId || req.adminAuth?.type || 'admin_api_key';
    const reviewerUserId = toUuidOrNull(req.adminAuth?.userId);
    const isSourcedCandidate = isSourcedInventoryCandidateRecord(current);
    if (nextStatus === 'approved' && normalizeListingType(current.listing_type) === 'commercial') {
      const commercialTransactionType = normalizeCommercialTransactionType(current.transaction_type);
      const commercialPropertyType = normalizeCommercialPropertyType(current.property_type, {
        title: current.title,
        description: current.description
      });
      const missingCommercialFields = [];
      if (!commercialTransactionType) missingCommercialFields.push('Select For rent or For sale.');
      if (!commercialPropertyType) missingCommercialFields.push('Select a commercial property type.');
      if (missingCommercialFields.length) {
        return res.status(400).json({
          ok: false,
          error: 'Commercial transaction and property type are required before approval',
          details: missingCommercialFields
        });
      }
      const classificationWarning = commercialMisclassificationWarning(current);
      if (classificationWarning) approvalWarnings.push(classificationWarning);
    }
    const requestedSourcedCandidateOverride = nextStatus === 'approved'
      && parseBooleanLike(req.body.sourced_candidate_override || req.body.sourced_candidate_special_dispensation, false);
    const sourcedCandidateConsentConfirmed = parseBooleanLike(req.body.consent_confirmed, false);
    const sourcedCandidateImageRightsConfirmed = parseBooleanLike(req.body.image_rights_confirmed, false);
    const sourcedCandidateLocationConfirmed = parseBooleanLike(req.body.found_online_location_confirmed || req.body.location_confirmed, false);
    const sourcedCandidateSourceReviewed = parseBooleanLike(req.body.source_reviewed || req.body.staff_source_reviewed, false);

    if (requestedSourcedCandidateOverride && !isSourcedCandidate) {
      return res.status(403).json({
        ok: false,
        error: 'Found-online approval is only available for found-online intake records'
      });
    }

    if (requestedSourcedCandidateOverride && !sourcedCandidateRecordHasApprovalLocation(current)) {
      return res.status(400).json({
        ok: false,
        error: 'Location is required before found-online approval',
        details: [
          'Add at least an area, district, address, source location, or valid coordinates before approving.',
          'Found-online approval can override missing contact, ID, image-count, pricing, and declaration checks, but it cannot override missing location.'
        ]
      });
    }

    const sourcedCandidateOverride = requestedSourcedCandidateOverride && isSourcedCandidate;
    let automatedReview = null;
    const canSkipAutomatedReviewForSourcedOverride = nextStatus === 'approved'
      && sourcedCandidateOverride
      && sourcedCandidateSourceReviewed
      && sourcedCandidateRecordHasApprovalLocation(current);
    if (nextStatus === 'approved' && !canSkipAutomatedReviewForSourcedOverride) {
      try {
        automatedReview = await loadAutomatedReviewForProperty(req.params.id);
      } catch (error) {
        logger.error('Automated approval review failed; continuing with saved checklist', {
          property_id: req.params.id,
          message: error.message
        });
        approvalWarnings.push('Automated review refresh failed; used saved checklist data.');
      }
    } else if (canSkipAutomatedReviewForSourcedOverride) {
      approvalWarnings.push('Found-online source override used saved checklist data for fast moderation write.');
    }
    const checklistSource = automatedReview?.checklist
      || (req.body.checklist && typeof req.body.checklist === 'object' ? req.body.checklist : current.moderation_checklist);
    const checklist = { ...normalizeReviewChecklist(checklistSource) };
    const missingChecks = nextStatus === 'approved'
      ? (automatedReview?.checks || [])
        .filter((item) => {
          const status = String(item?.status || '').toLowerCase();
          return (status === 'fail' || status === 'error') && item?.blocking === true && item?.overrideable !== true;
        })
        .map((item) => `${item.label}: ${item.message}`)
      : [];
    const warningOverrideKeys = new Set(Object.keys(warningOverrides || {}).filter(Boolean));
    const missingWarningOverrides = nextStatus === 'approved'
      ? (automatedReview?.checks || [])
        .filter((item) => {
          const status = String(item?.status || '').toLowerCase();
          return status === 'warning' || ((status === 'fail' || status === 'error') && item?.overrideable === true);
        })
        .filter((item) => !warningOverrideKeys.has(cleanText(item.key || item.label)))
        .map((item) => `${item.label}: open evidence and override this review flag before approving`)
      : [];

    if (missingChecks.length && !sourcedCandidateOverride) {
      return res.status(400).json({
        ok: false,
        error: 'Approval checklist is incomplete',
        details: missingChecks
      });
    }

    if (missingWarningOverrides.length && !sourcedCandidateOverride) {
      return res.status(400).json({
        ok: false,
        error: 'Approval warnings require admin override',
        details: missingWarningOverrides
      });
    }

    const identityVerificationRequired = nextStatus === 'approved'
      && !sourcedCandidateOverride
      && listingRequiresIdentityVerification(current);
    const identityVerificationConfirmed = identityVerificationConfirmedFromBody(req.body, checklist);
    let identityVerificationExtraFields = null;
    if (identityVerificationRequired) {
      if (!identityVerificationConfirmed) {
        return res.status(400).json({
          ok: false,
          error: 'ID verification confirmation is required before approval',
          details: [
            'Open the Identity panel, check that the National ID photo is clear, and confirm the ID number matches the document before approving.'
          ]
        });
      }
      const verifiedAt = new Date().toISOString();
      checklist.identity_document_verified = true;
      checklist.identity_number_matches_document = true;
      checklist.identity_verified = true;
      moderationReason = moderationReason || 'Approved - identity verified: ID photo clear and ID number matches. Listing details confirmed.';
      identityVerificationExtraFields = buildIdentityVerificationExtra({
        actorId,
        actorRole: actorRole || req.adminAuth?.type || 'staff',
        verifiedAt
      });
      approvalWarnings.push('National ID photo and ID number match were confirmed before approval.');
    }

    let sourcedCandidateDispensation = null;
    if (sourcedCandidateOverride) {
      moderationReason = moderationReason || 'Approved as found-online intake after location was confirmed and non-location source-review checks were overridden.';
      sourcedCandidateDispensation = {
        used: true,
        source: 'found_online_property_source_v1',
        at: new Date().toISOString(),
        actor_id: actorId,
        approval_policy: 'location_required_non_location_checks_staff_or_admin_override',
        location_confirmed: sourcedCandidateLocationConfirmed || sourcedCandidateRecordHasApprovalLocation(current),
        source_reviewed: sourcedCandidateSourceReviewed,
        consent_confirmed: sourcedCandidateConsentConfirmed,
        image_rights_confirmed: sourcedCandidateImageRightsConfirmed,
        missing_checks_overridden: missingChecks,
        warning_checks_overridden: missingWarningOverrides,
        reason: moderationReason
      };
      approvalWarnings.push('Found-online approval used; staff/admin confirmed location and overrode non-location review checks.');
    }
    const sourcedCandidateExtraFields = sourcedCandidateDispensation
      ? {
        sourced_candidate_special_dispensation: sourcedCandidateDispensation,
        found_online_approval_policy: 'location_required_non_location_checks_staff_or_admin_override',
        found_online_location_confirmed: sourcedCandidateDispensation.location_confirmed,
        found_online_source_reviewed: sourcedCandidateDispensation.source_reviewed,
        found_online_non_location_checks_overridden: true,
        ...(sourcedCandidateConsentConfirmed ? { consent_confirmed: true } : {}),
        ...(sourcedCandidateImageRightsConfirmed ? {
          image_rights_confirmed: true,
          image_rights_status: 'admin_confirmed_authorised'
        } : {})
      }
      : null;
    const structuredRejectionExtraFields = nextStatus === 'rejected' && structuredRejectionReasons.length
      ? {
        structured_rejection_reasons: structuredRejectionReasons,
        structured_rejection_message: moderationReason
      }
      : null;
    const priceBasisExtraFields = nextStatus === 'approved' && highMonthlyPriceConfirmed
      ? {
        price_basis_verified: true,
        price_basis_verified_at: new Date().toISOString(),
        price_basis_verified_by: actorId
      }
      : null;
    const moderationExtraFields = {
      ...(sourcedCandidateExtraFields || {}),
      ...(identityVerificationExtraFields || {}),
      ...(structuredRejectionExtraFields || {}),
      ...(priceBasisExtraFields || {})
    };
    const moderationExtraFieldsJson = Object.keys(moderationExtraFields).length
      ? JSON.stringify(moderationExtraFields)
      : null;

    const regeneratedOwnerToken = nextStatus === 'rejected' ? createOwnerEditToken() : '';
    const regeneratedOwnerTokenHash = regeneratedOwnerToken ? hashOwnerEditToken(regeneratedOwnerToken) : null;
    const regeneratedOwnerTokenExpiresAt = regeneratedOwnerToken ? ownerEditTokenExpiry() : null;
    const moderationStage = nextStatus === 'approved'
      ? 'approved'
      : nextStatus === 'rejected'
        ? 'rejected'
        : nextStatus === 'pending'
          ? 'submitted'
          : nextStatus;

    let listing;
    try {
      const result = await db.query(
        `UPDATE properties
         SET
           status = $2,
           reviewed_at = NOW(),
           reviewed_by = COALESCE($7::uuid, reviewed_by),
           moderation_stage = $8,
           moderation_checklist = $4::jsonb,
           moderation_notes = COALESCE($5::text, moderation_notes),
           moderation_reason = $3::text,
           approved_at = CASE WHEN $2 = 'approved' THEN NOW() ELSE approved_at END,
           sold_at = CASE WHEN $2 = 'sold' THEN NOW() WHEN $2 = 'approved' THEN NULL ELSE sold_at END,
           rejected_at = CASE WHEN $2 = 'rejected' THEN NOW() ELSE rejected_at END,
           owner_edit_token_hash = CASE WHEN $9::text IS NULL THEN owner_edit_token_hash ELSE $9::text END,
           owner_edit_token_expires_at = CASE WHEN $10::timestamptz IS NULL THEN owner_edit_token_expires_at ELSE $10::timestamptz END,
           updated_at = NOW(),
           extra_fields = (
             CASE
               WHEN $3::text IS NULL OR trim($3::text) = '' THEN COALESCE(extra_fields, '{}'::jsonb)
               ELSE COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object('moderation_reason', $3::text)
             END
           ) || jsonb_build_object('review_warning_overrides', $11::jsonb)
             || COALESCE($12::jsonb, '{}'::jsonb)
         WHERE id = $1
         RETURNING id, title, listing_type, inquiry_reference, lister_name, lister_phone, lister_email, status,
                   price, price_period, area, district, created_at,
                   reviewed_at, approved_at, last_moderation_notification_at, moderation_stage,
                   moderation_checklist, moderation_notes, moderation_reason, extra_fields`,
        [
          req.params.id,
          nextStatus,
          moderationReason,
          JSON.stringify(checklist),
          reviewNotes,
          actorId,
          reviewerUserId,
          moderationStage,
          regeneratedOwnerTokenHash,
          regeneratedOwnerTokenExpiresAt,
          JSON.stringify(warningOverrides),
          moderationExtraFieldsJson
        ]
      );
      listing = result.rows[0];
    } catch (error) {
      logger.error('Full listing status update failed; trying compact fallback update', {
        property_id: req.params.id,
        status: nextStatus,
        message: error.message
      });
      approvalWarnings.push('Full moderation column update failed; compact status update was used.');
      const fallbackResult = await db.query(
        `UPDATE properties
         SET
           status = $2,
           reviewed_at = NOW(),
           sold_at = CASE WHEN $2 = 'sold' THEN NOW() WHEN $2 = 'approved' THEN NULL ELSE sold_at END,
           updated_at = NOW(),
           extra_fields = COALESCE(extra_fields, '{}'::jsonb)
             || jsonb_build_object(
               'moderation_stage', $3::text,
               'moderation_checklist', $4::jsonb,
               'moderation_notes', $5::text,
               'moderation_reason', $6::text,
               'review_warning_overrides', $7::jsonb
             )
             || COALESCE($8::jsonb, '{}'::jsonb)
         WHERE id = $1
         RETURNING id, title, listing_type, inquiry_reference, lister_name, lister_phone, lister_email, status,
                   price, price_period, area, district, created_at, reviewed_at, extra_fields`,
        [
          req.params.id,
          nextStatus,
          moderationStage,
          JSON.stringify(checklist),
          reviewNotes,
          moderationReason,
          JSON.stringify(warningOverrides),
          moderationExtraFieldsJson
        ]
      );
      listing = {
        ...fallbackResult.rows[0],
        moderation_stage: moderationStage,
        moderation_checklist: checklist,
        moderation_notes: reviewNotes,
        moderation_reason: moderationReason
      };
    }
    if (nextStatus === 'approved') {
      listing.primary_image_url = await getPrimaryImageUrlForProperty(listing.id);
    }
    let notification = {
      email: { sent: false, reason: 'not_attempted' },
      whatsapp: { sent: false, reason: 'not_attempted' }
    };

    try {
      const notificationListing = {
        ...listing,
        owner_edit_token: regeneratedOwnerToken
      };
      if (manualNotificationOnly && ['approved', 'rejected'].includes(nextStatus)) {
        notification = buildManualOwnerStatusNotification({
          listing: notificationListing,
          status: nextStatus,
          reason: moderationReason
        });
      } else {
        notification = await sendOwnerListingStatusNotifications({
          listing: notificationListing,
          status: nextStatus,
          reason: moderationReason
        });
        if (notification.email?.sent || notification.whatsapp?.sent) {
          await db.query(
            'UPDATE properties SET last_moderation_notification_at = NOW() WHERE id = $1',
            [listing.id]
          );
        }
      }
    } catch (error) {
      notification = { sent: false, reason: 'notification_failed', error: error.message || 'send_failed' };
    }

    const writeModerationAuditEvents = async () => {
      try {
        const moderationEventDelivery = {
          ...notification,
          ...(sourcedCandidateDispensation ? { sourced_candidate_special_dispensation: sourcedCandidateDispensation } : {}),
          ...(identityVerificationExtraFields ? { identity_verification: identityVerificationExtraFields.identity_verification } : {}),
          ...(structuredRejectionReasons.length ? { structured_rejection_reasons: structuredRejectionReasons } : {})
        };
        await db.query(
          `INSERT INTO property_moderation_events (
            property_id,
            actor_id,
            action,
            status_from,
            status_to,
            checklist,
            reason,
            notes,
            delivery
          ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb)`,
          [
            listing.id,
            actorId,
            'listing_status_changed',
            current.status,
            nextStatus,
            JSON.stringify(checklist),
            moderationReason,
            reviewNotes,
            JSON.stringify(moderationEventDelivery)
          ]
        );
        if (sourcedCandidateDispensation) {
          await db.query(
            `INSERT INTO property_moderation_events (
              property_id,
              actor_id,
              action,
              status_from,
              status_to,
              checklist,
              reason,
              notes,
              delivery
            ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb)`,
            [
              listing.id,
              actorId,
              'found_online_approval_used',
              current.status,
              nextStatus,
              JSON.stringify(checklist),
              moderationReason,
              'Staff/admin confirmed location and overrode non-location checks for this found-online approval.',
              JSON.stringify(sourcedCandidateDispensation)
            ]
          );
        }
      } catch (error) {
        logger.error('Listing moderation event write failed after status update', {
          property_id: listing.id,
          status: nextStatus,
          message: error.message
        });
        approvalWarnings.push('Moderation history event could not be written, but the listing status was updated.');
      }

      if (actorRole === 'moderator') {
        await db.query(
          `INSERT INTO staff_activity_logs (staff_user_id, action, target_type, target_id, metadata)
           VALUES ($1,$2,$3,$4,$5::jsonb)`,
          [
            reviewerUserId,
            nextStatus === 'approved' ? 'staff_listing_approved' : (nextStatus === 'rejected' ? 'staff_listing_rejected' : 'staff_listing_returned_pending'),
            'property',
            listing.id,
            JSON.stringify({
              status_from: current.status,
              status_to: nextStatus,
              title: listing.title || null,
              reason: moderationReason || null,
              structured_rejection_reasons: structuredRejectionReasons,
              identity_verified: !!identityVerificationExtraFields,
              lister_notified: !!(notification.email?.sent || notification.whatsapp?.sent)
            })
          ]
        ).catch(() => {});
      }
    };

    const buildStatusResponse = (alertMatching = null) => ({
      ok: true,
      data: {
        ...listing,
        moderation_reason: moderationReason || listing?.extra_fields?.moderation_reason || null,
        lister_notified: !!(notification.email?.sent || notification.whatsapp?.sent),
        notification,
        alert_matching: alertMatching,
        warnings: approvalWarnings,
        automated_review: automatedReview || undefined
      }
    });

    if (fastAdminRender && manualNotificationOnly && ['approved', 'rejected', 'pending'].includes(nextStatus)) {
      clearPublicPropertiesCache(`listing_status_${current.status || 'unknown'}_to_${nextStatus}`);
      runPublicInventoryFollowup(
        writeModerationAuditEvents,
        'Deferred fast moderation audit failed',
        { property_id: listing.id, status: nextStatus }
      );
      let fastAlertMatching = null;
      if (nextStatus === 'approved' && current.status !== 'approved') {
        fastAlertMatching = { deferred: true, reason: 'fast_manual_notification_response' };
        runPublicInventoryFollowup(
          () => matchListingToSavedSearches(db, { ...current, ...listing }),
          'Deferred listing saved-search matching failed',
          { property_id: listing.id }
        );
      }
      return res.json(buildStatusResponse(fastAlertMatching));
    }

    await writeModerationAuditEvents();

    let alertMatching = null;
    if (nextStatus === 'approved' && current.status !== 'approved') {
      alertMatching = await matchListingToSavedSearches(db, { ...current, ...listing });
    }
    clearPublicPropertiesCache(`listing_status_${current.status || 'unknown'}_to_${nextStatus}`);

    return res.json(buildStatusResponse(alertMatching));
  } catch (error) {
    logger.error('Listing status update failed', {
      property_id: req.params.id,
      status: req.body?.status,
      message: error.message
    });
    return res.status(error.status || error.statusCode || 500).json({
      ok: false,
      error: 'Status update failed',
      details: [error.message || 'Unknown server error']
    });
  }
});

module.exports = router;
module.exports._test = {
  publicPropertiesCacheKey
};
