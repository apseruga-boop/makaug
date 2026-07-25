const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const db = require('../config/database');
const { requireAdminApiKey } = require('../middleware/auth');
const { asArray, cleanText, toNullableInt, toNullableFloat, isValidEmail, isValidPhone } = require('../middleware/validation');
const { parsePagination, toPagination } = require('../utils/pagination');
const { DISTRICTS, LISTING_TYPES } = require('../utils/constants');
const { normalizeReviewLocationHierarchy, districtForKnownArea } = require('../utils/ugandaLocationHierarchy');
const { normalizeEmail, normalizeUgPhone } = require('../utils/adminOtpOverride');
const {
  normalizeCommercialTransactionType,
  normalizeCommercialPropertyType,
} = require('../utils/commercialClassification');
const { createListingSubmitToken } = require('../utils/listingSubmitOtp');
const { publicLivePropertyStatusSql } = require('../utils/publicInventoryStatus');
const {
  landTitleAvailabilityLabel,
  normalizeLandTitleAvailability
} = require('../utils/landTitleAvailability');
const { sourceQualitySuppressedSql } = require('../utils/sourceContentQuality');
const {
  buildUgNlisLandVerificationPack,
  sanitizeUgNlisLandVerificationFields
} = require('../services/ugnlisLandVerificationService');
const { processPendingCampaignQueue, refreshCampaignStatus } = require('../services/whatsappCampaignService');
const { generateCampaignCopy, suggestWhatsappAssistantReply } = require('../services/aiService');
const { sendWhatsAppText } = require('../services/whatsappNotificationService');
const {
  buildAutomatedListingReview,
  createOwnerEditToken,
  getOwnerPreviewUrl,
  hashOwnerEditToken,
  normalizeReviewChecklist,
  ownerEditTokenExpiry
} = require('../services/listingModerationService');
const {
  getCachedExternalDuplicateScan,
  scanAndCacheExternalDuplicates
} = require('../services/externalDuplicateScanService');
const {
  WHATSAPP_CONVERSATION_AI_MODES,
  WHATSAPP_CONVERSATION_CATEGORIES,
  WHATSAPP_CONVERSATION_PRIORITIES,
  WHATSAPP_CONVERSATION_STATUSES,
  buildManualWhatsAppUrl,
  normalizeConversationAiMode,
  normalizeConversationCategory,
  normalizeConversationPhone,
  normalizeConversationPriority,
  normalizeConversationStatus,
  updateWhatsappConversationControl,
  mapIntentToConversationCategory,
  syncWhatsappConversationState
} = require('../services/whatsappConversationService');
const {
  getWhatsappDeliveryMode,
  getWhatsappWebBridgeStatus,
  isWhatsappWebBridgeEnabled,
  queueWhatsappWebBridgeMessage
} = require('../services/whatsappWebBridgeService');
const { evaluateHostedWhatsappBridgeReadiness } = require('../services/whatsappBridgeReadiness');
const {
  emailProviderConfigured: emailProviderConfiguredByService,
  emailProviderDiagnostic,
  getDefaultEmailFrom,
  getSupportEmail,
  getSupportWhatsappUrl,
  lookupResendDomainRecords,
  sendBrokerApprovalEmail,
  sendSupportEmail
} = require('../services/emailService');
const {
  buildAdvertisingQuoteBreakdown,
  estimateAdvertisingQuote,
  findAdvertisingPackage,
  findAdvertisingPlacement,
  getAdvertisingPlacements,
  getAdvertisingPackages,
  getAdvertisingRateCard,
  mergePlacementWithCatalog,
  mergePlacementRowsWithCatalog,
  summarizeAdvertisingPackageKeys
} = require('../services/advertisingCatalogService');
const { addLeadActivity, createLead } = require('../services/leadService');
const { getAlertSummary, matchListingToSavedSearches } = require('../services/alertSchedulerService');
const { MONETIZATION_SPINE_MARKER, markInvoicePaidManually, paymentProviderConfigured } = require('../services/paymentProviderService');
const { logNotification, notificationStatusFromDelivery } = require('../services/notificationLogService');
const { logEmailEvent } = require('../services/emailLogService');
const { logWhatsAppMessage } = require('../services/whatsappMessageLogService');
const { prepareMediaUrlForStorage, prepareUploadObjectForStorage, uploadBufferToS3 } = require('../services/cloudMediaStorageService');
const {
  PUBLIC_INVENTORY_METRICS_MARKER,
  loadPublicOpportunitySummary,
  normalizePublicOpportunitySummary,
  publicVisibleInventoryWhere
} = require('../services/publicInventoryMetricsService');
const {
  buildListingIdentityDocumentPayload
} = require('../services/listingIdentityDocumentService');
const {
  approveOutlookEmailAction,
  getOutlookAgentStatus,
  listOutlookEmailActions,
  queueOutlookReplyDraft,
  rejectOutlookEmailAction,
  sendApprovedOutlookEmailAction,
  syncOutlookInbox
} = require('../services/outlookAiEmailAgentService');
const { sendPhoneOtp } = require('../services/phoneOtpDeliveryService');
const { buildListingReference } = require('../services/listingReferenceService');
const SOURCED_INVENTORY_CANDIDATE_SOURCE = 'sourced_inventory_candidate_v1';
const {
  BAKAIMA_BATCH_ID,
  seedBakaimaAuthorisedListings
} = require('../services/bakaimaSourcedListingsService');
const {
  CARNELIAN_BATCH_ID,
  seedCarnelianAuthorisedListings
} = require('../services/carnelianSourcedListingsService');
const {
  FOUND_ONLINE_SOURCE_POST_IMPORT_BATCH_ID,
  SOCIAL_SEARCH_BATCH_ID,
  queueFoundOnlineSourcePostListings,
  seedSocialSearchAuthorisedListings
} = require('../services/socialSearchSourcedListingsService');
const {
  PROPERTY_SOURCE_REGISTRY_BATCH_ID,
  listPropertySourceRegistry,
  seedPropertySourceRegistry,
  summarizePropertySourceRegistry
} = require('../services/propertySourceRegistryService');
const {
  SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
  importExactSocialSourcePosts,
  importTikTokExactVideoPosts,
  runSocialPlatformPostSweep
} = require('../services/socialPlatformPostDiscoveryService');
const {
  getXSourceDripStatus,
  pauseXSourceDrip,
  runXSourceDripOnce,
  startXSourceDrip,
  updateXSourceDripConfig
} = require('../services/xSourceDripService');
const {
  getYouTubeSourceDripStatus,
  pauseYouTubeSourceDrip,
  runYouTubeSourceDripOnce,
  startYouTubeSourceDrip,
  updateYouTubeSourceDripConfig
} = require('../services/youtubeSourceDripService');
const {
  FEATURED_ROTATION_MARKER,
  loadFeaturedRotationStatus,
  runFeaturedRotation
} = require('../services/featuredRotationService');
const {
  auditMarketplaceRelevance,
  getMarketplaceDripStatus,
  importMarketplaceSourceCandidates,
  pauseMarketplaceDrip,
  runMarketplaceDripOnce,
  seedMarketplaceSourceRegistry,
  startMarketplaceDrip,
  updateMarketplaceDripConfig
} = require('../services/marketplaceNationalDripService');
const {
  runTikTokAutopublishAgent
} = require('../services/tiktokAutopublishAgentService');
const { getProviderMeta } = require('../services/llmProvider');
const { translationProviderStatus } = require('../services/translationProviderService');
const { DEFAULT_SEARCH_RADIUS_MILES, DEFAULT_SEARCH_RADIUS_KM } = require('../services/locationSearchService');
const { isPointInUganda } = require('../services/locationSearchService');
const {
  retryEmailLog,
  retryNotification,
  retryWhatsAppLog
} = require('../services/notificationRetryService');
const {
  normalizeObjectKey,
  storageEnvConfigured,
  uploadBufferToS3: uploadBackupBufferToS3
} = require('../services/s3ObjectStorageService');

const router = express.Router();

router.use(requireAdminApiKey);

const FIELD_AGENT_DEFAULT_PAYOUT_UGX = 5000;
const FIELD_AGENT_PAYOUT_DAY = 'Friday';
const FIELD_AGENT_ID_START = 7300;
const FIELD_AGENT_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
const FIELD_AGENT_DIRECTORY_LIMIT = 10000;
const ADMIN_LISTING_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
const ADMIN_LISTING_IMAGE_MAX_COUNT = 20;
const LAUNCH_TEST_LISTING_MARKERS = ['SOFT LAUNCH TEST - DELETE', 'QA TEST - DELETE'];
const LAUNCH_TEST_DUMMY_TITLES = ['sdgsdgd', 'sgsgsgsgs'];
const PUBLIC_SITE_URL = String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://makaug.com').replace(/\/+$/, '');
let propertySourceRegistrySeedJob = null;
const LEAD_PROPERTY_MATCH_LIMIT = 10;
const ADMIN_PENDING_REVIEW_STATUSES = [
  'pending',
  'pending_review',
  'test_pending_review',
  'pending_review_hidden',
  'draft',
  'submitted',
  'resubmitted',
  'in_review',
  'under_review',
  'needs_review',
  'awaiting_review',
  'queued',
  'source_review',
  'source_review_required',
  'pending_king_source_review',
  'king_review'
];
const ADMIN_FINAL_REVIEW_STATUSES = [
  'approved',
  'live',
  'published',
  'sold',
  'hidden',
  'deleted',
  'rejected',
  'declined',
  'fraud',
  'archived',
  'off_market',
  'paused',
  'inactive',
  'expired',
  'removed',
  'unavailable',
  'duplicate',
  'actioned'
];
function adminSqlList(values = []) {
  return values.map((value) => `'${String(value).replace(/'/g, "''")}'`).join(', ');
}

function adminColumn(alias, column) {
  return alias ? `${alias}.${column}` : column;
}

function adminLowerColumn(alias, column) {
  return `LOWER(COALESCE(${adminColumn(alias, column)}, ''))`;
}

function adminPendingReviewWhere(alias = 'p') {
  const statusExpr = adminLowerColumn(alias, 'status');
  const stageExpr = adminLowerColumn(alias, 'moderation_stage');
  const pending = adminSqlList(ADMIN_PENDING_REVIEW_STATUSES);
  return `(
    ${statusExpr} IN (${pending})
    OR ${stageExpr} IN (${pending})
  )`;
}

function adminPendingReviewFastWhere(alias = 'p') {
  const pending = adminSqlList(ADMIN_PENDING_REVIEW_STATUSES);
  return `(
    COALESCE(${adminColumn(alias, 'status')}, '') IN (${pending})
    OR COALESCE(${adminColumn(alias, 'moderation_stage')}, '') IN (${pending})
  )`;
}

function adminSourceQualitySuppressedFlagSql(alias = 'p') {
  const extra = adminColumn(alias, 'extra_fields');
  return `(
    COALESCE(${extra}->'source_quality_review'->>'suppressed', '') ~* '^(true|1|yes)$'
    OR COALESCE(${extra}->>'source_quality_suppressed', '') ~* '^(true|1|yes)$'
  )`;
}

function adminActiveReviewQueueWhere(alias = 'p') {
  return `(
    ${adminPendingReviewWhere(alias)}
    AND NOT ${adminSourceQualitySuppressedFlagSql(alias)}
  )`;
}

function adminLaunchTestListingFastCondition(alias = 'p') {
  const col = (column) => adminColumn(alias, column);
  return `(
    COALESCE(${col('source')}, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(${col('listed_via')}, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(${col('lister_email')}, '') ~* '(makaug\\.invalid|test@|qa@|dummy|sample)'
    OR COALESCE(${col('inquiry_reference')}, '') ~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'
    OR COALESCE(${col('extra_fields')}->>'is_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(${col('extra_fields')}->>'qa_test_delete', '') ~* '^(true|1|yes)$'
    OR COALESCE(${col('extra_fields')}->>'soft_launch_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(${col('extra_fields')}->>'launch_proof', '') ~* '^(true|1|yes)$'
    OR COALESCE(${col('extra_fields')}->>'non_public_test', '') ~* '^(true|1|yes)$'
  )`;
}

function adminDefaultReviewQueueWhere(alias = 'p') {
  return `(
    ${adminActiveReviewQueueWhere(alias)}
    AND NOT ${adminLaunchTestListingFastCondition(alias)}
  )`;
}

function adminFoundOnlineReviewQueueWhere(alias = 'p') {
  const source = adminColumn(alias, 'source');
  const listedVia = adminColumn(alias, 'listed_via');
  return `(
    ${adminPendingReviewFastWhere(alias)}
    AND (
      ${source} = 'found_online_property_source_v1'
      OR ${listedVia} = 'found_online'
    )
    AND NOT ${adminLaunchTestListingFastCondition(alias)}
  )`;
}

function adminActionableReviewQueueWhere(alias = 'p') {
  const source = adminColumn(alias, 'source');
  const listedVia = adminColumn(alias, 'listed_via');
  return `(
    ${adminPendingReviewWhere(alias)}
    AND NOT ${adminLaunchTestListingFastCondition(alias)}
    AND (
      NOT ${adminSourceQualitySuppressedFlagSql(alias)}
      OR ${source} = 'found_online_property_source_v1'
      OR ${listedVia} = 'found_online'
    )
  )`;
}

function adminLaunchTestListingCondition(alias = 'p') {
  const col = (column) => adminColumn(alias, column);
  return `(
    ${LAUNCH_TEST_LISTING_MARKERS.map((marker) => `(COALESCE(${col('title')}, '') ILIKE '%${marker}%' OR COALESCE(${col('description')}, '') ILIKE '%${marker}%')`).join(' OR ')}
    OR LOWER(TRIM(COALESCE(${col('title')}, ''))) IN (${LAUNCH_TEST_DUMMY_TITLES.map((title) => `'${title}'`).join(', ')})
    OR COALESCE(${col('source')}, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(${col('listed_via')}, '') ~* '(qa|test|demo|soft_launch|launch_proof)'
    OR COALESCE(${col('lister_name')}, '') ~* '(qa test delete|qa owner|dummy|sample)'
    OR COALESCE(${col('lister_email')}, '') ~* '(makaug\\.invalid|test@|qa@|dummy|sample)'
    OR COALESCE(${col('inquiry_reference')}, '') ~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'
    OR COALESCE(${col('extra_fields')}->>'is_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(${col('extra_fields')}->>'qa_test_delete', '') ~* '^(true|1|yes)$'
    OR COALESCE(${col('extra_fields')}->>'soft_launch_test', '') ~* '^(true|1|yes)$'
    OR COALESCE(${col('extra_fields')}->>'launch_proof', '') ~* '^(true|1|yes)$'
    OR COALESCE(${col('extra_fields')}->>'non_public_test', '') ~* '^(true|1|yes)$'
  )`;
}

function adminFeaturedListingCondition(alias = 'p') {
  return `(COALESCE(${adminColumn(alias, 'extra_fields')}->>'featured', 'false') IN ('true', '1', 'yes'))`;
}

function adminPublicLiveListingCondition(alias = 'p') {
  const markers = LAUNCH_TEST_LISTING_MARKERS.map((marker) => {
    const safeMarker = marker.replace(/'/g, "''");
    return `(COALESCE(${adminColumn(alias, 'title')}, '') NOT ILIKE '%${safeMarker}%' AND COALESCE(${adminColumn(alias, 'description')}, '') NOT ILIKE '%${safeMarker}%')`;
  });
  const dummyTitles = LAUNCH_TEST_DUMMY_TITLES.map((title) => `'${title.replace(/'/g, "''")}'`).join(', ');
  return `(
    ${markers.join('\n    AND ')}
    AND LOWER(TRIM(COALESCE(${adminColumn(alias, 'title')}, ''))) NOT IN (${dummyTitles})
    AND COALESCE(${adminColumn(alias, 'source')}, '') !~* '(qa|test|demo|soft_launch|launch_proof)'
    AND COALESCE(${adminColumn(alias, 'listed_via')}, '') !~* '(qa|test|demo|soft_launch|launch_proof)'
    AND COALESCE(${adminColumn(alias, 'lister_name')}, '') !~* '(qa test delete|qa owner|dummy|sample)'
    AND COALESCE(${adminColumn(alias, 'lister_email')}, '') !~* '(makaug\\.invalid|test@|qa@|dummy|sample)'
    AND COALESCE(${adminColumn(alias, 'inquiry_reference')}, '') !~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'
    AND COALESCE(${adminColumn(alias, 'extra_fields')}->>'qa_test_delete', '') !~* '^(true|1|yes)$'
    AND COALESCE(${adminColumn(alias, 'extra_fields')}->>'soft_launch_test', '') !~* '^(true|1|yes)$'
    AND COALESCE(${adminColumn(alias, 'extra_fields')}->>'is_test', '') !~* '^(true|1|yes)$'
    AND COALESCE(${adminColumn(alias, 'extra_fields')}->>'launch_proof', '') !~* '^(true|1|yes)$'
    AND COALESCE(${adminColumn(alias, 'extra_fields')}->>'non_public_test', '') !~* '^(true|1|yes)$'
  )`;
}

function adminPublicLiveListingWhere(alias = 'p') {
  return `(${adminColumn(alias, 'status')} = 'approved' OR (${adminColumn(alias, 'status')} = 'sold' AND ${adminColumn(alias, 'sold_at')} >= NOW() - INTERVAL '7 days')) AND ${adminPublicLiveListingCondition(alias)}`;}

function adminPublicLiveListingFastWhere(alias = 'p') {
  return `(${adminColumn(alias, 'status')} = 'approved' OR (${adminColumn(alias, 'status')} = 'sold' AND ${adminColumn(alias, 'sold_at')} >= NOW() - INTERVAL '7 days')) AND NOT ${adminLaunchTestListingFastCondition(alias)}`;
}

function safeJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch (_error) {
      return fallback;
    }
  }
  return fallback;
}

function normalizeLeadListingType(value = 'any') {
  const clean = cleanText(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (['sale', 'sell', 'buy', 'for_sale', 'purchase'].includes(clean)) return 'sale';
  if (['rent', 'rental', 'to_rent', 'lease'].includes(clean)) return 'rent';
  if (['land', 'plot'].includes(clean)) return 'land';
  if (['student', 'students', 'hostel', 'student_accommodation'].includes(clean)) return 'student';
  if (['commercial', 'office', 'shop', 'business'].includes(clean)) return 'commercial';
  return 'any';
}

function numberOrNull(value) {
  if (value == null || value === '') return null;
  const parsed = Number(String(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function leadSearchCriteria(lead = {}) {
  const metadata = safeJsonObject(lead.metadata);
  const filters = safeJsonObject(metadata.filters);
  const searchType = normalizeLeadListingType(metadata.search_type || filters.searchType || filters.search_type || lead.category || lead.lead_type);
  const area = cleanText(metadata.preferred_area || filters.area || lead.location);
  const maxBudget = numberOrNull(filters.maxBudgetUgx || filters.max_budget_ugx || metadata.max_budget_ugx || lead.budget);
  const bedsMin = numberOrNull(filters.bedsMin || filters.beds_min || metadata.beds_min);
  const propertyType = cleanText(filters.propertyType || filters.property_type || metadata.property_type);
  return {
    searchType,
    area: area && area.toLowerCase() !== 'any' ? area : '',
    maxBudget,
    bedsMin,
    propertyType,
    originalMessage: cleanText(metadata.original_message || lead.message),
    metadata
  };
}

function addLeadPropertyMatchFilters(values, criteria = {}, relax = {}) {
  let where = `WHERE ${adminPublicLiveListingWhere('p')}`;
  const searchType = normalizeLeadListingType(criteria.searchType || 'any');
  if (!relax.searchType && searchType !== 'any') {
    if (searchType === 'student') {
      where += ` AND (
        p.listing_type = 'student'
        OR p.students_welcome = TRUE
        OR p.title ILIKE '%student%'
        OR p.title ILIKE '%hostel%'
        OR p.description ILIKE '%student%'
        OR p.description ILIKE '%hostel%'
        OR COALESCE(p.property_type, '') ILIKE '%hostel%'
      )`;
    } else {
      values.push(searchType);
      where += ` AND p.listing_type = $${values.length}`;
    }
  }

  const area = cleanText(criteria.area);
  if (!relax.area && area) {
    values.push(`%${area}%`);
    const idx = values.length;
    where += ` AND (
      p.district ILIKE $${idx}
      OR p.area ILIKE $${idx}
      OR p.title ILIKE $${idx}
      OR COALESCE(p.address, '') ILIKE $${idx}
      OR COALESCE(p.description, '') ILIKE $${idx}
      OR COALESCE(p.extra_fields->>'city', '') ILIKE $${idx}
      OR COALESCE(p.extra_fields->>'neighborhood', '') ILIKE $${idx}
      OR COALESCE(p.extra_fields->>'region', '') ILIKE $${idx}
      OR COALESCE(p.extra_fields->>'resolved_location_label', '') ILIKE $${idx}
    )`;
  }

  const maxBudget = numberOrNull(criteria.maxBudget);
  if (!relax.budget && maxBudget) {
    values.push(maxBudget);
    where += ` AND p.price IS NOT NULL AND p.price <= $${values.length}`;
  }

  const bedsMin = numberOrNull(criteria.bedsMin);
  if (!relax.beds && bedsMin) {
    values.push(bedsMin);
    where += ` AND COALESCE(p.bedrooms, 0) >= $${values.length}`;
  }

  const propertyType = cleanText(criteria.propertyType);
  if (!relax.propertyType && propertyType) {
    values.push(`%${propertyType}%`);
    const idx = values.length;
    where += ` AND (
      COALESCE(p.property_type, '') ILIKE $${idx}
      OR p.title ILIKE $${idx}
      OR p.description ILIKE $${idx}
    )`;
  }
  return where;
}

async function queryLeadPropertyMatches(criteria = {}, strength = 'exact', relax = {}, limit = LEAD_PROPERTY_MATCH_LIMIT) {
  const values = [];
  const where = addLeadPropertyMatchFilters(values, criteria, relax);
  values.push(Math.max(1, Math.min(LEAD_PROPERTY_MATCH_LIMIT, Number(limit) || LEAD_PROPERTY_MATCH_LIMIT)));
  const limitIdx = values.length;
  const result = await db.query(
    `SELECT p.id, p.title, p.listing_type, p.district, p.area, p.price, p.price_period,
            p.bedrooms, p.bathrooms, p.property_type, p.inquiry_reference, p.created_at,
            img.url AS primary_image_url
     FROM properties p
     LEFT JOIN LATERAL (
       SELECT CASE WHEN url ~* '^https?://' AND length(url) < 500 THEN url ELSE NULL END AS url
       FROM property_images
       WHERE property_id = p.id
       ORDER BY is_primary DESC, sort_order ASC, created_at ASC
       LIMIT 1
     ) img ON TRUE
     ${where}
     ORDER BY
       CASE WHEN p.price IS NULL THEN 1 ELSE 0 END ASC,
       p.created_at DESC
     LIMIT $${limitIdx}`,
    values
  );
  return result.rows.map((row) => ({
    ...row,
    match_strength: strength,
    public_url: `${PUBLIC_SITE_URL}/property/${row.id}`
  }));
}

async function findLeadPropertyMatches(lead = {}, limit = LEAD_PROPERTY_MATCH_LIMIT) {
  const criteria = leadSearchCriteria(lead);
  const attempts = [
    { strength: 'exact', relax: {} },
    { strength: 'similar_area', relax: { budget: true, beds: true, propertyType: true } },
    { strength: 'similar_type', relax: { area: true, budget: true, beds: true, propertyType: true } },
    { strength: 'broader_live', relax: { searchType: true, area: true, budget: true, beds: true, propertyType: true } }
  ];
  const seen = new Set();
  const matches = [];
  let exactCount = 0;
  for (const attempt of attempts) {
    if (matches.length >= limit) break;
    const rows = await queryLeadPropertyMatches(criteria, attempt.strength, attempt.relax, limit);
    rows.forEach((row) => {
      const id = String(row.id || '');
      if (!id || seen.has(id) || matches.length >= limit) return;
      seen.add(id);
      if (attempt.strength === 'exact') exactCount += 1;
      matches.push(row);
    });
  }
  return { criteria, exactCount, matches };
}

function formatLeadMatchPrice(row = {}) {
  const price = numberOrNull(row.price);
  if (!price) return '';
  const period = cleanText(row.price_period);
  return `USh ${Math.round(price).toLocaleString('en-UG')}${period ? ` ${period}` : ''}`;
}

function buildLeadMatchWhatsappMessage({ lead = {}, property = {}, criteria = {} } = {}) {
  const title = cleanText(property.title) || 'a makaug property';
  const location = [property.area, property.district].map(cleanText).filter(Boolean).join(', ') || cleanText(criteria.area) || 'Uganda';
  const price = formatLeadMatchPrice(property);
  const original = cleanText(criteria.originalMessage || lead.message);
  const url = property.public_url || `${PUBLIC_SITE_URL}/property/${property.id}`;
  return [
    'Hi, this is makaug.com.',
    original ? `You previously asked us for: "${original.slice(0, 180)}"` : 'You previously asked us to help find a property.',
    'We found a live property that may match what you were looking for:',
    `${title}`,
    `Location: ${location}`,
    price ? `Price: ${price}` : '',
    `View photos, map, and enquiry options: ${url}`,
    'Reply here if you would like help booking a viewing or requesting a callback.',
    'Reply STOP if you no longer want makaug.com property follow-ups.'
  ].filter(Boolean).join('\n');
}

function numberOrZero(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function fieldAgentProfile(row = {}) {
  return row.profile_data && typeof row.profile_data === 'object' ? row.profile_data : {};
}

function fieldAgentTerritory(row = {}) {
  const profile = fieldAgentProfile(row);
  return cleanText(profile.field_agent_territory || profile.territory || row.territory || 'Uganda') || 'Uganda';
}

function fieldAgentPayoutRate(row = {}) {
  const profile = fieldAgentProfile(row);
  const rate = numberOrZero(profile.payout_rate_ugx || row.payout_rate_ugx || FIELD_AGENT_DEFAULT_PAYOUT_UGX);
  return rate > 0 ? rate : FIELD_AGENT_DEFAULT_PAYOUT_UGX;
}

function fieldAgentReachScore(row = {}) {
  return numberOrZero(row.property_views_count)
    + numberOrZero(row.property_saves_count)
    + numberOrZero(row.inquiries_count)
    + numberOrZero(row.route_events_count);
}

function decorateFieldAgentPerformanceRows(rows = []) {
  const decorated = rows.map((row) => {
    const accepted = numberOrZero(row.approved_listings_count);
    const payoutRate = fieldAgentPayoutRate(row);
    const reachScore = fieldAgentReachScore(row);
    return {
      ...row,
      field_agent_territory: fieldAgentTerritory(row),
      field_agent_reach_score: reachScore,
      field_agent_payout_rate_ugx: payoutRate,
      field_agent_friday_due_ugx: accepted * payoutRate
    };
  });

  const sortPerformance = (a, b) => {
    const acceptedDelta = numberOrZero(b.approved_listings_count) - numberOrZero(a.approved_listings_count);
    if (acceptedDelta) return acceptedDelta;
    const listingDelta = numberOrZero(b.listings_count) - numberOrZero(a.listings_count);
    if (listingDelta) return listingDelta;
    const reachDelta = numberOrZero(b.field_agent_reach_score) - numberOrZero(a.field_agent_reach_score);
    if (reachDelta) return reachDelta;
    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
  };

  [...decorated].sort(sortPerformance).forEach((row, index) => {
    row.field_agent_rank = index + 1;
  });

  const byTerritory = new Map();
  decorated.forEach((row) => {
    const territory = row.field_agent_territory || 'Uganda';
    if (!byTerritory.has(territory)) byTerritory.set(territory, []);
    byTerritory.get(territory).push(row);
  });

  byTerritory.forEach((territoryRows, territory) => {
    const regionAccepted = territoryRows.reduce((total, row) => total + numberOrZero(row.approved_listings_count), 0);
    const regionReach = territoryRows.reduce((total, row) => total + numberOrZero(row.field_agent_reach_score), 0);
    territoryRows.sort(sortPerformance).forEach((row, index) => {
      row.field_agent_region_rank = index + 1;
      row.field_agent_region_count = territoryRows.length;
      row.field_agent_region_accepted_count = regionAccepted;
      row.field_agent_region_reach_score = regionReach;
      row.field_agent_region = territory;
    });
  });

  return decorated;
}

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfUtcWeekMonday(date = new Date()) {
  const start = startOfUtcDay(date);
  const dayOffset = (start.getUTCDay() + 6) % 7;
  return addUtcDays(start, -dayOffset);
}

function normalizeFieldAgentPayoutPeriod(value = '') {
  const raw = cleanText(value).toLowerCase().replace(/\s+/g, '_');
  if (['this_friday', 'current_friday', 'friday', 'current_week_pay'].includes(raw)) return 'this_friday';
  if (['previous_friday', 'last_friday', 'previous_week', 'last_week'].includes(raw)) return 'previous_friday';
  if (['this_week', 'week_to_date'].includes(raw)) return 'this_week';
  if (['last_7_days', 'rolling_7_days'].includes(raw)) return 'last_7_days';
  if (['all', 'all_time'].includes(raw)) return 'all';
  return 'current_due';
}

function fieldAgentPayoutWindow(period = 'current_due') {
  const key = normalizeFieldAgentPayoutPeriod(period);
  const now = new Date();
  const thisWeekStart = startOfUtcWeekMonday(now);
  const thisWeekEnd = addUtcDays(thisWeekStart, 7);
  const currentFriday = addUtcDays(thisWeekStart, 4);
  const previousWeekStart = addUtcDays(thisWeekStart, -7);
  const previousWeekEnd = thisWeekStart;
  const weekBeforePreviousStart = addUtcDays(thisWeekStart, -14);
  const weekBeforePreviousEnd = previousWeekStart;

  const windows = {
    current_due: {
      period_key: 'current_due',
      period_label: 'Current due ledger',
      period_description: 'All accepted Field Agent-linked listings currently counted as payable. Use the weekly filters to audit the Friday pay window.',
      pay_by_date: currentFriday.toISOString(),
      period_start: null,
      period_end: null,
      has_range: false
    },
    this_friday: {
      period_key: 'this_friday',
      period_label: 'This Friday payout',
      period_description: 'Accepted listings from the previous completed week, paid on this Friday.',
      pay_by_date: currentFriday.toISOString(),
      period_start: previousWeekStart.toISOString(),
      period_end: previousWeekEnd.toISOString(),
      has_range: true
    },
    previous_friday: {
      period_key: 'previous_friday',
      period_label: 'Previous Friday payout',
      period_description: 'Accepted listings from the week before the current Friday payout window.',
      pay_by_date: addUtcDays(previousWeekStart, 4).toISOString(),
      period_start: weekBeforePreviousStart.toISOString(),
      period_end: weekBeforePreviousEnd.toISOString(),
      has_range: true
    },
    this_week: {
      period_key: 'this_week',
      period_label: 'This week so far',
      period_description: 'Accepted listings from the current week. This is a projection until the week closes.',
      pay_by_date: addUtcDays(thisWeekEnd, 4).toISOString(),
      period_start: thisWeekStart.toISOString(),
      period_end: thisWeekEnd.toISOString(),
      has_range: true
    },
    last_7_days: {
      period_key: 'last_7_days',
      period_label: 'Last 7 days',
      period_description: 'Rolling seven-day audit of accepted listings linked to Field Agents.',
      pay_by_date: currentFriday.toISOString(),
      period_start: addUtcDays(now, -7).toISOString(),
      period_end: now.toISOString(),
      has_range: true
    },
    all: {
      period_key: 'all',
      period_label: 'All accepted listings',
      period_description: 'Every accepted Field Agent-linked listing in the backend feed.',
      pay_by_date: currentFriday.toISOString(),
      period_start: null,
      period_end: null,
      has_range: false
    }
  };

  return {
    payout_day: FIELD_AGENT_PAYOUT_DAY,
    ...(windows[key] || windows.current_due)
  };
}

async function writeAudit(action, details = {}, actorId = 'admin_api_key') {
  try {
    await db.query(
      `INSERT INTO audit_logs (actor_id, action, details)
       VALUES ($1, $2, $3::jsonb)`,
      [actorId, action, JSON.stringify(details || {})]
    );
  } catch (_error) {
    // Avoid failing admin APIs when audit table is temporarily unavailable.
  }
}

function adminActorId(req) {
  return req.adminAuth?.userId || req.adminAuth?.type || 'admin_api_key';
}

function parseBooleanLike(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = cleanText(value).toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'y', 'on', 'authorised', 'authorized'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

function dataUrlApproxBytes(value = '') {
  const match = String(value || '').match(/^data:[^,]+,([a-z0-9+/=\s]+)$/i);
  if (!match) return 0;
  const base64 = match[1].replace(/\s+/g, '');
  return Math.floor((base64.length * 3) / 4);
}

function cleanAdminListingImageUpload(value = {}, fallbackLabel = 'Authorised property photo') {
  if (!value || typeof value !== 'object') return null;
  const url = String(value.url || value.data_url || value.dataUrl || '').trim();
  if (!url) return null;
  const isImageDataUrl = /^data:image\/(?:jpe?g|png|webp|gif);base64,/i.test(url);
  const isRemoteImageUrl = /^https?:\/\//i.test(url);
  if (!isImageDataUrl && !isRemoteImageUrl) {
    const err = new Error('Listing image must be an image upload or HTTPS image URL.');
    err.status = 400;
    throw err;
  }
  if (isImageDataUrl) {
    const approxBytes = dataUrlApproxBytes(url);
    if (approxBytes > ADMIN_LISTING_IMAGE_MAX_BYTES) {
      const err = new Error('Listing image is too large. Upload must be 6MB or smaller after compression.');
      err.status = 400;
      throw err;
    }
  }
  return {
    url,
    slot_key: cleanText(value.slot_key || value.slot || '').slice(0, 80) || null,
    room_label: cleanText(value.room_label || value.label || fallbackLabel).slice(0, 120) || fallbackLabel,
    is_primary: parseBooleanLike(value.is_primary || value.primary, false),
    sort_order: Math.max(0, parseInt(value.sort_order, 10) || 0)
  };
}

function normalizeFieldAgentCode(value = '') {
  const raw = cleanText(value).toUpperCase().replace(/\s+/g, '');
  if (!raw) return '';
  if (/^FA-\d{4,6}$/.test(raw)) return raw;
  if (/^FA\d{4,6}$/.test(raw)) return `FA-${raw.slice(2)}`;
  if (/^\d{1,6}$/.test(raw)) return `FA-${raw.padStart(4, '0')}`;
  return '';
}

function normalizeAdminPropertyStatus(value = '') {
  const raw = cleanText(value).toLowerCase();
  if (['approved', 'live', 'published'].includes(raw)) return 'approved';
  if (['pending', 'pending_review', 'test_pending_review', 'pending_review_hidden', 'draft', 'submitted', 'in_review', 'under_review'].includes(raw)) return 'pending';
  if (['rejected', 'declined', 'fraud'].includes(raw)) return 'rejected';
  if (['hidden', 'off_market', 'paused', 'archived'].includes(raw)) return 'hidden';
  if (['sold', 'completed'].includes(raw)) return 'sold';
  if (['deleted', 'removed', 'trash'].includes(raw)) return 'deleted';
  return raw || 'pending';
}

function normalizeFieldAgentContactPhone(value = '') {
  const raw = cleanText(value).replace(/[^\d+]/g, '');
  if (!raw) return '';
  if (/^00\d{10,15}$/.test(raw)) return `+${raw.slice(2)}`;
  if (/^0\d{9}$/.test(raw)) return `+256${raw.slice(1)}`;
  if (/^256\d{9}$/.test(raw)) return `+${raw}`;
  if (/^\+\d{10,15}$/.test(raw)) return raw;
  if (/^\d{10,15}$/.test(raw)) return raw;
  return raw;
}

function isLegacyZeroFieldAgentCode(value = '') {
  return /^FA-0+$/.test(String(value || '').trim().toUpperCase());
}

async function generateNextFieldAgentCode() {
  const result = await db.query(
    `SELECT profile_data->>'field_agent_code' AS field_agent_code,
            profile_data->>'employee_number' AS employee_number
     FROM users
     WHERE role = 'field_agent'`
  );
  let max = FIELD_AGENT_ID_START;
  for (const row of result.rows) {
    for (const value of [row.field_agent_code, row.employee_number]) {
      const normalized = normalizeFieldAgentCode(value);
      const number = parseInt(normalized.replace(/\D/g, ''), 10);
      if (Number.isFinite(number) && number > max) max = number;
    }
  }
  return `FA-${String(max + 1).padStart(4, '0')}`;
}

function cleanFieldAgentUpload(value, fallbackName = 'document') {
  if (!value || typeof value !== 'object') return null;
  const name = cleanText(value.name || fallbackName).slice(0, 160) || fallbackName;
  const type = cleanText(value.type || value.mime || 'application/octet-stream').slice(0, 120);
  const size = Number(value.size || 0) || 0;
  const dataUrl = String(value.data_url || value.dataUrl || '').trim();
  const url = cleanText(value.url || value.href || '').slice(0, 2000);
  if (size > FIELD_AGENT_UPLOAD_MAX_BYTES) {
    const err = new Error(`${fallbackName} is too large. Upload must be 2MB or smaller.`);
    err.status = 400;
    throw err;
  }
  const allowedDataUrl = dataUrl.startsWith('data:application/pdf')
    || dataUrl.startsWith('data:image/')
    || dataUrl.startsWith('data:application/msword')
    || dataUrl.startsWith('data:application/vnd.openxmlformats-officedocument');
  const allowedUrl = /^https?:\/\//i.test(url) || url.startsWith('/assets/docs/field-agent/');
  if (!allowedDataUrl && !allowedUrl) return null;
  return {
    name,
    type,
    size,
    data_url: allowedDataUrl ? dataUrl : undefined,
    url: allowedUrl ? url : undefined,
    uploaded_at: new Date().toISOString()
  };
}

function envSet(key) {
  return Boolean(String(process.env[key] || '').trim());
}

function emailProviderConfigured() {
  return emailProviderConfiguredByService();
}

function outboundEmailDisclosureOk(text = '') {
  const body = String(text || '').toLowerCase();
  return body.includes('makaug.com')
    && body.includes('unsubscribe')
    && (body.includes('https://makaug.com') || body.includes('makaug.com'));
}

function outboundWhatsappDisclosureOk(text = '') {
  const body = String(text || '').toLowerCase();
  return body.includes('makaug.com') && /\bstop\b/.test(body);
}

function emailDomain(value = '') {
  const email = normalizeEmail(value);
  const [, domain] = email.split('@');
  return domain || '';
}

function phoneLastDigits(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  return digits ? digits.slice(-4) : '';
}

function splitBrokerName(fullName = '') {
  const parts = cleanText(fullName).split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: 'Broker', lastName: 'Account' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' ') || 'Broker'
  };
}

function generateBrokerTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let output = 'Mk';
  for (let i = 0; i < 10; i += 1) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `${output}!`;
}

const STAFF_DEFAULT_PERMISSIONS = {
  listing_moderation: true,
  lead_generation: true,
  advertising_sales: true,
  whatsapp_conversations: true,
  training_library: true,
  ai_assistant: true,
  financial_admin: false,
  user_admin: false,
  system_settings: false
};

function normalizeStaffCode(value = '', fallbackIndex = 1) {
  const cleaned = cleanText(value)
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 24);
  if (cleaned) return cleaned;
  const number = Math.max(1, parseInt(fallbackIndex, 10) || 1);
  return `MOD-${String(number).padStart(3, '0')}`;
}

function normalizeStaffPermissions(value = {}) {
  const source = safeJsonObject(value, {});
  return Object.keys(STAFF_DEFAULT_PERMISSIONS).reduce((permissions, key) => {
    permissions[key] = typeof source[key] === 'boolean'
      ? source[key]
      : STAFF_DEFAULT_PERMISSIONS[key];
    return permissions;
  }, {});
}

function normalizeStaffChannelAccess(value = {}) {
  const source = safeJsonObject(value, {});
  return {
    listings: source.listings !== false,
    leads: source.leads !== false,
    advertising: source.advertising !== false,
    whatsapp: source.whatsapp !== false,
    social_media: source.social_media !== false,
    ai_assistant: source.ai_assistant !== false
  };
}

function generateStaffTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let output = 'MkStaff';
  for (let i = 0; i < 10; i += 1) {
    output += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return `${output}!`;
}

function defaultStaffSeed(index = 1) {
  const number = Math.max(1, parseInt(index, 10) || 1);
  const suffix = String(number).padStart(2, '0');
  return {
    first_name: `Moderator ${number}`,
    last_name: 'Makaug',
    email: `moderator${number}@staff.makaug.internal`,
    personal_email: '',
    phone: `+2567000010${suffix}`,
    staff_code: normalizeStaffCode('', number),
    status: 'active'
  };
}

function buildStaffProfilePatch(input = {}, staffCode, existingProfile = {}) {
  const existing = safeJsonObject(existingProfile, {});
  const personalEmail = normalizeEmail(input.personal_email || input.personalEmail || existing.personal_email || '');
  return {
    ...existing,
    audience: 'moderator',
    account_kind: 'moderator',
    staff_dashboard_enabled: true,
    staff_code: staffCode,
    employee_number: staffCode,
    personal_email: personalEmail,
    channel_access: normalizeStaffChannelAccess(input.channel_access || existing.channel_access),
    permissions: normalizeStaffPermissions(input.permissions || existing.permissions),
    staff_notes: cleanText(input.notes || input.staff_notes || existing.staff_notes || '').slice(0, 500),
    password_managed_by_admin: true,
    force_password_change: false
  };
}

function publicStaffAccount(row = {}, temporaryPassword = '') {
  const profile = safeJsonObject(row.profile_data, {});
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    phone: row.phone,
    email: row.email,
    role: row.role,
    status: row.status,
    phone_verified: row.phone_verified,
    preferred_contact_channel: row.preferred_contact_channel,
    preferred_language: row.preferred_language,
    staff_code: profile.staff_code || profile.employee_number || '',
    personal_email: profile.personal_email || '',
    channel_access: normalizeStaffChannelAccess(profile.channel_access),
    permissions: normalizeStaffPermissions(profile.permissions),
    staff_notes: profile.staff_notes || '',
    last_login_at: row.last_login_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    temporary_password: temporaryPassword || undefined
  };
}

async function upsertModeratorStaffAccount(input = {}, req = null, fallbackIndex = 1) {
  const seed = { ...defaultStaffSeed(fallbackIndex), ...safeJsonObject(input, input || {}) };
  const firstName = cleanText(seed.first_name || seed.firstName || seed.name || `Moderator ${fallbackIndex}`).slice(0, 80);
  const lastName = cleanText(seed.last_name || seed.lastName || 'Makaug').slice(0, 80);
  const email = normalizeEmail(seed.email);
  const phone = normalizeUgPhone(seed.phone) || cleanText(seed.phone);
  const status = cleanText(seed.status || 'active').toLowerCase();
  const staffCode = normalizeStaffCode(seed.staff_code || seed.staffCode || seed.employee_number, fallbackIndex);
  const suppliedPassword = cleanText(seed.password || seed.temporary_password || seed.tempPassword);
  const allowedStatuses = ['active', 'suspended', 'deleted'];

  if (!firstName || !lastName || !email || !phone) {
    const error = new Error('Staff first name, surname, email, and phone are required');
    error.status = 400;
    throw error;
  }
  if (!isValidEmail(email)) {
    const error = new Error('Enter a valid staff email address');
    error.status = 400;
    throw error;
  }
  if (!isValidPhone(phone)) {
    const error = new Error('Enter a full staff phone number with country code, e.g. +256701123456');
    error.status = 400;
    throw error;
  }
  if (!allowedStatuses.includes(status)) {
    const error = new Error('Invalid staff account status');
    error.status = 400;
    throw error;
  }

  const existing = await db.query(
    `SELECT *
     FROM users
     WHERE LOWER(email) = LOWER($1)
        OR phone = $2
        OR UPPER(COALESCE(profile_data->>'staff_code', profile_data->>'employee_number', '')) = $3
     ORDER BY created_at ASC
     LIMIT 1`,
    [email, phone, staffCode]
  );
  const existingUser = existing.rows[0] || null;
  const shouldResetPassword = !existingUser || Boolean(suppliedPassword) || parseBooleanLike(seed.reset_password || seed.resetPassword, false);
  const temporaryPassword = shouldResetPassword ? (suppliedPassword || generateStaffTemporaryPassword()) : '';
  const passwordHash = shouldResetPassword ? await bcrypt.hash(temporaryPassword, 12) : null;
  const existingProfile = existingUser?.profile_data && typeof existingUser.profile_data === 'object'
    ? existingUser.profile_data
    : {};
  const profilePatch = buildStaffProfilePatch(seed, staffCode, existingProfile);
  const actorId = adminActorId(req || {});

  let saved;
  if (existingUser) {
    const updated = await db.query(
      `UPDATE users
       SET first_name = $2,
           last_name = $3,
           phone = $4,
           email = $5,
           role = 'moderator',
           password_hash = COALESCE($6::text, password_hash),
           phone_verified = TRUE,
           status = $7,
           marketing_opt_in = FALSE,
           weekly_tips_opt_in = FALSE,
           preferred_contact_channel = 'whatsapp',
           preferred_language = COALESCE(NULLIF($8, ''), preferred_language, 'en'),
           profile_data = COALESCE(profile_data, '{}'::jsonb) || $9::jsonb,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, first_name, last_name, phone, email, role, status, phone_verified, preferred_contact_channel, preferred_language, profile_data, last_login_at, created_at, updated_at`,
      [
        existingUser.id,
        firstName,
        lastName,
        phone,
        email,
        passwordHash,
        status,
        cleanText(seed.preferred_language || seed.preferredLanguage || 'en').slice(0, 8),
        JSON.stringify(profilePatch)
      ]
    );
    saved = updated.rows[0];
  } else {
    const inserted = await db.query(
      `INSERT INTO users (
        first_name,
        last_name,
        phone,
        email,
        role,
        password_hash,
        phone_verified,
        status,
        marketing_opt_in,
        weekly_tips_opt_in,
        preferred_contact_channel,
        preferred_language,
        profile_data
      ) VALUES ($1,$2,$3,$4,'moderator',$5,TRUE,$6,FALSE,FALSE,'whatsapp',$7,$8::jsonb)
      RETURNING id, first_name, last_name, phone, email, role, status, phone_verified, preferred_contact_channel, preferred_language, profile_data, last_login_at, created_at, updated_at`,
      [
        firstName,
        lastName,
        phone,
        email,
        passwordHash,
        status,
        cleanText(seed.preferred_language || seed.preferredLanguage || 'en').slice(0, 8) || 'en',
        JSON.stringify(profilePatch)
      ]
    );
    saved = inserted.rows[0];
  }

  await writeAudit(existingUser ? 'moderator_staff_account_updated' : 'moderator_staff_account_created', {
    staff_user_id: saved.id,
    staff_code: staffCode,
    email,
    phone
  }, actorId);

  return publicStaffAccount(saved, temporaryPassword);
}

async function provisionApprovedBrokerAccount(agent = {}, req = null) {
  const email = normalizeEmail(agent.email);
  const phone = normalizeUgPhone(agent.phone) || cleanText(agent.phone);
  if (!email) {
    return { status: 'skipped', reason: 'broker_email_missing' };
  }
  if (!phone) {
    return { status: 'skipped', reason: 'broker_phone_missing' };
  }

  const existing = await db.query(
    `SELECT *
     FROM users
     WHERE LOWER(email) = LOWER($1)
        OR phone = $2
     ORDER BY created_at ASC
     LIMIT 1`,
    [email, phone]
  );
  const existingUser = existing.rows[0] || null;
  const existingProfile = existingUser?.profile_data && typeof existingUser.profile_data === 'object'
    ? existingUser.profile_data
    : {};
  const alreadyProvisioned = Boolean(existingProfile.broker_account_provisioned_at);
  const temporaryPassword = alreadyProvisioned ? '' : generateBrokerTemporaryPassword();
  const passwordHash = temporaryPassword ? await bcrypt.hash(temporaryPassword, 12) : null;
  const { firstName, lastName } = splitBrokerName(agent.full_name);
  const nowIso = new Date().toISOString();
  const profilePatch = {
    ...existingProfile,
    audience: 'agent',
    account_kind: 'agent',
    broker_review_status: 'approved',
    broker_account_status: 'approved',
    broker_agent_id: agent.id,
    makaug_agent_number: agent.makaug_agent_number || '',
    broker_company: agent.company_name || '',
    agent_company: agent.company_name || '',
    agent_districts: Array.isArray(agent.districts_covered) ? agent.districts_covered.join(', ') : '',
    agent_specialities: Array.isArray(agent.specializations) ? agent.specializations.join(', ') : '',
    agent_experience_years: Number(agent.experience_years || 0) || 0,
    national_id_number: agent.nin || existingProfile.national_id_number || '',
    national_id_expiry_date: agent.id_expiry_date || existingProfile.national_id_expiry_date || '',
    broker_identity_document_uploaded: Boolean(agent.identity_document_url),
    broker_identity_document_name: agent.identity_document_name || '',
    broker_identity_document_uploaded_at: agent.identity_document_uploaded_at || '',
    broker_privacy_consent_accepted: agent.privacy_consent_accepted === true,
    broker_data_retention_notice_accepted: agent.data_retention_notice_accepted === true,
    broker_verification_reason: agent.verification_reason || '',
    approved_by_admin: true,
    broker_approved_at: nowIso,
    broker_account_provisioned_at: existingProfile.broker_account_provisioned_at || nowIso,
    force_password_change: Boolean(temporaryPassword) || existingProfile.force_password_change === true
  };

  let saved;
  if (existingUser) {
    const updated = await db.query(
      `UPDATE users
       SET first_name = $2,
           last_name = $3,
           phone = $4,
           email = $5,
           role = 'agent_broker',
           password_hash = CASE WHEN $6::text IS NULL THEN password_hash ELSE $6 END,
           phone_verified = TRUE,
           status = 'active',
           preferred_contact_channel = 'whatsapp',
           profile_data = COALESCE(profile_data, '{}'::jsonb) || $7::jsonb,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, first_name, last_name, phone, email, role, status, phone_verified, preferred_language, profile_data, created_at, updated_at`,
      [
        existingUser.id,
        firstName,
        lastName,
        phone,
        email,
        passwordHash,
        JSON.stringify(profilePatch)
      ]
    );
    saved = updated.rows[0];
  } else {
    const inserted = await db.query(
      `INSERT INTO users (
        first_name,
        last_name,
        phone,
        email,
        role,
        password_hash,
        phone_verified,
        status,
        marketing_opt_in,
        weekly_tips_opt_in,
        preferred_contact_channel,
        preferred_language,
        profile_data
      ) VALUES ($1,$2,$3,$4,'agent_broker',$5,TRUE,'active',TRUE,TRUE,'whatsapp','en',$6::jsonb)
      RETURNING id, first_name, last_name, phone, email, role, status, phone_verified, preferred_language, profile_data, created_at, updated_at`,
      [
        firstName,
        lastName,
        phone,
        email,
        passwordHash,
        JSON.stringify(profilePatch)
      ]
    );
    saved = inserted.rows[0];
  }

  await db.query(
    `UPDATE agents
     SET user_id = $2,
         approved_user_id = $2,
         approved_at = COALESCE(approved_at, NOW()),
         updated_at = NOW()
     WHERE id = $1`,
    [agent.id, saved.id]
  );

  const siteUrl = String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://makaug.com').replace(/\/$/, '');
  const dashboardUrl = `${siteUrl}/broker-dashboard`;
  const supportUrl = getSupportWhatsappUrl();
  let emailDelivery = { sent: false, reason: 'email_provider_missing' };
  if (emailProviderConfigured()) {
    emailDelivery = await sendBrokerApprovalEmail({
      to: email,
      firstName,
      agent,
      temporaryPassword,
      dashboardUrl,
      supportUrl
    });
  }
  const emailStatus = emailProviderConfigured()
    ? notificationStatusFromDelivery(emailDelivery)
    : 'provider_missing';

  await logEmailEvent(db, {
    eventType: 'broker_account_approved',
    recipientUserId: saved.id,
    recipientEmail: email,
    recipientRole: 'agent_broker',
    templateKey: temporaryPassword ? 'broker_account_approved_temp_password' : 'broker_account_approved_existing_login',
    subject: temporaryPassword ? 'Your makaug.com broker account is ready' : 'Your makaug.com broker account has been approved',
    language: saved.preferred_language || 'en',
    status: emailStatus,
    provider: emailDelivery.provider || null,
    providerMessageId: emailDelivery.id || null,
    failureReason: emailDelivery.error || emailDelivery.reason || null,
    sentAt: emailDelivery.sent ? new Date() : null
  });
  await logNotification(db, {
    userId: saved.id,
    recipientPhone: phone,
    recipientEmail: email,
    channel: 'email',
    type: 'broker_account_approved',
    status: emailStatus,
    failureReason: emailDelivery.error || emailDelivery.reason || null,
    payloadSummary: {
      agent_id: agent.id,
      makaug_agent_number: agent.makaug_agent_number || null,
      temporary_password_issued: Boolean(temporaryPassword),
      provider_configured: emailProviderConfigured(),
      dashboard_url: dashboardUrl
    }
  });
  await writeAudit('broker_account_provisioned', {
    agent_id: agent.id,
    makaug_agent_number: agent.makaug_agent_number || null,
    user_id: saved.id,
    temporary_password_issued: Boolean(temporaryPassword),
    email_status: emailStatus
  }, adminActorId(req || {}));

  return {
    status: 'provisioned',
    user_id: saved.id,
    email_status: emailStatus,
    temporary_password_issued: Boolean(temporaryPassword),
    force_password_change: Boolean(profilePatch.force_password_change)
  };
}

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildFieldAgentProvisionEmail({ firstName, fieldAgentCode, pin, territory, payoutRateUgx, dashboardUrl, supportUrl }) {
  const safeFirstName = firstName || 'there';
  const safePayoutRate = Number(payoutRateUgx || FIELD_AGENT_DEFAULT_PAYOUT_UGX);
  const text = [
    `Hello ${safeFirstName},`,
    '',
    'You have been registered as a makaug.com Field Agent.',
    '',
    `Field Agent ID: ${fieldAgentCode}`,
    `4-digit PIN: ${pin}`,
    `Territory: ${territory || 'Uganda'}`,
    `Payout per approved listing: USh ${safePayoutRate.toLocaleString('en-UG')}`,
    `Payout schedule: every ${FIELD_AGENT_PAYOUT_DAY}, based on approved listings from the previous week.`,
    '',
    'Keep your PIN private. Use your Field Agent ID and PIN to sign in, track approved listings, see rejected listings, contest rejections, download payout slips, and read training resources.',
    `Open your dashboard: ${dashboardUrl}`,
    `WhatsApp Operations: ${supportUrl}`,
    '',
    'Welcome aboard.'
  ].join('\n');
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your makaug.com Field Agent access</title></head>
  <body style="margin:0;background:#eff6ff;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;background:#eff6ff;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #bfdbfe;border-radius:22px;overflow:hidden;">
          <tr><td style="padding:30px;background:linear-gradient(135deg,#0f3b6d,#2563eb,#22c55e);color:#ffffff;">
            <div style="font-size:28px;font-weight:900;"><span>makaug</span><span style="color:#f8d767;">.com</span></div>
            <div style="margin-top:8px;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#dbeafe;">Field Agent access</div>
            <h1 style="margin:18px 0 0;font-size:27px;line-height:1.2;">Welcome ${escapeHtml(safeFirstName)}, your Field Agent account is ready.</h1>
          </td></tr>
          <tr><td style="padding:28px;">
            <div style="border:1px solid #bfdbfe;background:#eff6ff;border-radius:18px;padding:16px;margin-bottom:18px;">
              <div style="font-size:13px;color:#1e3a8a;font-weight:900;text-transform:uppercase;">Private sign-in details</div>
              <div style="font-size:24px;font-weight:900;color:#111827;margin-top:8px;">${escapeHtml(fieldAgentCode)}</div>
              <div style="font-size:16px;color:#111827;margin-top:8px;">PIN: <strong>${escapeHtml(pin)}</strong></div>
              <div style="font-size:13px;color:#475569;margin-top:8px;">Keep this PIN private. makaug.com admin will never ask you to post it publicly.</div>
              <div style="font-size:13px;color:#475569;margin-top:8px;">Payout: <strong>USh ${safePayoutRate.toLocaleString('en-UG')}</strong> per approved listing, reviewed every ${FIELD_AGENT_PAYOUT_DAY}.</div>
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="width:50%;padding:7px;"><div style="border:1px solid #dcfce7;background:#f0fdf4;border-radius:16px;padding:14px;"><strong>Track listings</strong><br><span style="font-size:13px;color:#4b5563;">See submitted, approved, pending, and rejected listings linked to your Field Agent ID.</span></div></td>
                <td style="width:50%;padding:7px;"><div style="border:1px solid #dcfce7;background:#f0fdf4;border-radius:16px;padding:14px;"><strong>Payout slips</strong><br><span style="font-size:13px;color:#4b5563;">Download weekly and monthly payment slips from your dashboard.</span></div></td>
              </tr>
              <tr>
                <td style="width:50%;padding:7px;"><div style="border:1px solid #dcfce7;background:#f0fdf4;border-radius:16px;padding:14px;"><strong>Training</strong><br><span style="font-size:13px;color:#4b5563;">Preview and download the welcome pack, training deck, contract, and FAQs.</span></div></td>
                <td style="width:50%;padding:7px;"><div style="border:1px solid #dcfce7;background:#f0fdf4;border-radius:16px;padding:14px;"><strong>Support</strong><br><span style="font-size:13px;color:#4b5563;">Use WhatsApp Operations for listing, rejection, contract, or payout help.</span></div></td>
              </tr>
            </table>
            <div style="margin-top:22px;">
              <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:13px;padding:14px 18px;font-size:14px;font-weight:900;margin-right:8px;">Open Field Agent dashboard</a>
              <a href="${escapeHtml(supportUrl)}" style="display:inline-block;background:#ecfdf3;color:#166534;text-decoration:none;border:1px solid #bbf7d0;border-radius:13px;padding:13px 16px;font-size:14px;font-weight:900;">WhatsApp Operations</a>
            </div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
  return { text, html };
}

function buildFieldAgentPaymentEmail({ firstName, fieldAgentCode, amountUgx, paymentReference, paymentMethod, paidAt, receiptHref, dashboardUrl }) {
  const safeFirstName = firstName || 'there';
  const safeAmount = Number(amountUgx || 0);
  const methodLabel = cleanText(paymentMethod || 'mobile_money').replace(/_/g, ' ');
  const text = [
    `Hello ${safeFirstName},`,
    '',
    'A makaug.com Field Agent payment has been recorded for your account.',
    '',
    `Field Agent ID: ${fieldAgentCode}`,
    `Amount: USh ${safeAmount.toLocaleString('en-UG')}`,
    `Payment method: ${methodLabel}`,
    `Payment reference: ${paymentReference}`,
    `Payment date: ${paidAt}`,
    receiptHref ? `Receipt/proof: ${receiptHref}` : '',
    '',
    `You can also see this payment inside your dashboard: ${dashboardUrl}`,
    '',
    'Thank you for your field work.'
  ].filter(Boolean).join('\n');
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>makaug.com Field Agent payment</title></head>
  <body style="margin:0;background:#fffbeb;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;background:#fffbeb;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #fde68a;border-radius:22px;overflow:hidden;">
          <tr><td style="padding:26px;background:linear-gradient(135deg,#14532d,#15803d,#f59e0b);color:#ffffff;">
            <div style="font-size:26px;font-weight:900;"><span>makaug</span><span style="color:#fde68a;">.com</span></div>
            <h1 style="margin:16px 0 0;font-size:25px;line-height:1.2;">Payment recorded for ${escapeHtml(safeFirstName)}</h1>
          </td></tr>
          <tr><td style="padding:26px;">
            <div style="border:1px solid #fde68a;background:#fffbeb;border-radius:18px;padding:16px;">
              <div style="font-size:13px;color:#92400e;font-weight:900;text-transform:uppercase;">Field Agent payment</div>
              <div style="font-size:28px;font-weight:900;color:#14532d;margin-top:8px;">USh ${safeAmount.toLocaleString('en-UG')}</div>
              <div style="font-size:14px;color:#374151;margin-top:10px;">Reference: <strong>${escapeHtml(paymentReference)}</strong></div>
              <div style="font-size:14px;color:#374151;margin-top:6px;">Method: <strong>${escapeHtml(methodLabel)}</strong></div>
              <div style="font-size:14px;color:#374151;margin-top:6px;">Date: <strong>${escapeHtml(paidAt)}</strong></div>
            </div>
            <div style="margin-top:22px;">
              <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#15803d;color:#ffffff;text-decoration:none;border-radius:13px;padding:14px 18px;font-size:14px;font-weight:900;margin-right:8px;">Open dashboard</a>
              ${receiptHref ? `<a href="${escapeHtml(receiptHref)}" style="display:inline-block;background:#fffbeb;color:#92400e;text-decoration:none;border:1px solid #fde68a;border-radius:13px;padding:13px 16px;font-size:14px;font-weight:900;">View receipt</a>` : ''}
            </div>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
  return { text, html };
}

function anyEnv(keys = []) {
  return keys.some((key) => envSet(key));
}

function africasTalkingUsernameConfigured() {
  return envSet('AFRICASTALKING_USERNAME') || envSet('AFRICASTALKING_UESERNAME');
}

function africasTalkingSmsConfigured() {
  return envSet('AFRICASTALKING_API_KEY') && africasTalkingUsernameConfigured();
}

function twilioSmsConfigured() {
  const hasSender = envSet('TWILIO_FROM_SMS')
    || envSet('TWILIO_SMS_FROM')
    || (envSet('TWILIO_FROM') && !String(process.env.TWILIO_FROM || '').trim().toLowerCase().startsWith('whatsapp:'));
  return envSet('TWILIO_ACCOUNT_SID') && envSet('TWILIO_AUTH_TOKEN') && hasSender;
}

function smsProviderWarnings() {
  const warnings = [];
  if (envSet('AFRICASTALKING_UESERNAME') && !envSet('AFRICASTALKING_USERNAME')) {
    warnings.push('AFRICASTALKING_UESERNAME is misspelled. Add AFRICASTALKING_USERNAME and remove the misspelled key after deploy.');
  }
  if (envSet('AFRICASTALKING_SENDER_ID')) {
    warnings.push('If Africa’s Talking SMS fails, confirm AFRICASTALKING_SENDER_ID is approved or temporarily remove it to use the default sender.');
  }
  return warnings;
}

function missingSmsEnv() {
  const usingTwilio = envSet('TWILIO_ACCOUNT_SID') || envSet('TWILIO_AUTH_TOKEN') || envSet('TWILIO_FROM_SMS') || envSet('TWILIO_SMS_FROM');
  const usingAfricasTalking = envSet('AFRICASTALKING_API_KEY') || africasTalkingUsernameConfigured() || String(process.env.SMS_PROVIDER || '').toLowerCase().includes('africa');
  if (usingTwilio && !usingAfricasTalking) {
    const missing = [];
    if (!envSet('TWILIO_ACCOUNT_SID')) missing.push('TWILIO_ACCOUNT_SID');
    if (!envSet('TWILIO_AUTH_TOKEN')) missing.push('TWILIO_AUTH_TOKEN');
    if (!envSet('TWILIO_FROM_SMS') && !envSet('TWILIO_SMS_FROM')) missing.push('TWILIO_FROM_SMS');
    return missing;
  }

  const missing = [];
  if (!envSet('AFRICASTALKING_API_KEY')) missing.push('AFRICASTALKING_API_KEY');
  if (!africasTalkingUsernameConfigured()) missing.push('AFRICASTALKING_USERNAME');
  return missing;
}

function mediaStorageProvider() {
  return String(process.env.MEDIA_STORAGE_PROVIDER || 'local').trim().toLowerCase();
}

function mediaStorageRequiredEnv(provider = mediaStorageProvider()) {
  if (provider === 's3') {
    return ['MEDIA_STORAGE_PROVIDER', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
  }
  if (provider === 's3_presigned') {
    return ['MEDIA_STORAGE_PROVIDER', 'S3_PRESIGN_ENDPOINT'];
  }
  if (provider === 'supabase') {
    return ['MEDIA_STORAGE_PROVIDER', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_STORAGE_BUCKET'];
  }
  return ['MEDIA_STORAGE_PROVIDER', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
}

function missingMediaStorageEnv() {
  const provider = mediaStorageProvider();
  if (provider === 'local') return mediaStorageRequiredEnv('s3');
  if (!['s3', 's3_presigned', 'supabase'].includes(provider)) return ['MEDIA_STORAGE_PROVIDER'];
  return missingEnv(mediaStorageRequiredEnv(provider));
}

function mediaStorageConfigured() {
  const provider = mediaStorageProvider();
  return ['s3', 's3_presigned', 'supabase'].includes(provider) && missingMediaStorageEnv().length === 0;
}

function backupStorageProvider() {
  return process.env.DATA_BACKUP_BUCKET ? 's3' : 'missing';
}
function backupStorageRequiredEnv() {
  return ['DATA_BACKUP_BUCKET', 'DATA_BACKUP_PREFIX', 'DATA_BACKUP_LOCAL_PATHS', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
}

function missingBackupStorageEnv() {
  return missingEnv(backupStorageRequiredEnv());
}

function backupStorageConfigured() {
  return storageEnvConfigured({ bucket: process.env.DATA_BACKUP_BUCKET }) && missingBackupStorageEnv().length === 0;}

function providerConfigured(provider) {
  const keyGroups = {
    email: ['RESEND_API_KEY', 'SMTP_HOST', 'MAIL_WEBHOOK_URL', 'MS_GRAPH_CLIENT_ID'],
    whatsapp: ['WHATSAPP_PROVIDER', 'WHATSAPP_WEB_BRIDGE_ENABLED', 'WHATSAPP_WEB_BRIDGE_TOKEN', 'TWILIO_ACCOUNT_SID', 'META_WHATSAPP_TOKEN', 'AFRICASTALKING_API_KEY'],
    google_places: ['GOOGLE_MAPS_API_KEY', 'PUBLIC_GOOGLE_MAPS_API_KEY'],
    openai_llm: ['OPENAI_API_KEY', 'LLM_API_KEY', 'OLLAMA_BASE_URL'],
    payment_link: ['PAYMENT_LINK_BASE_URL', 'PAYMENT_PROVIDER_API_KEY', 'PAYMENT_PROVIDER_WEBHOOK_SECRET'],
    backups: ['DATA_BACKUP_BUCKET', 'DATA_BACKUP_PREFIX', 'DATA_BACKUP_LOCAL_PATHS', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
    public_base_url: ['PUBLIC_BASE_URL', 'APP_BASE_URL']
  };
  if (provider === 'sms') return africasTalkingSmsConfigured() || twilioSmsConfigured();
  if (provider === 'media_storage') return mediaStorageConfigured();
  if (provider === 'backups') return backupStorageConfigured();
  return anyEnv(keyGroups[provider] || []);
}

function providerEnvKeys(provider) {
  const keyGroups = {
    email: ['RESEND_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM'],
    whatsapp: ['WHATSAPP_PROVIDER', 'WHATSAPP_WEB_BRIDGE_ENABLED', 'WHATSAPP_WEB_BRIDGE_TOKEN', 'TWILIO_ACCOUNT_SID', 'META_WHATSAPP_TOKEN'],
    sms: ['SMS_PROVIDER', 'TWILIO_ACCOUNT_SID', 'AFRICASTALKING_API_KEY', 'AFRICASTALKING_USERNAME'],
    media_storage: mediaStorageRequiredEnv(),
    google_places: ['GOOGLE_MAPS_API_KEY', 'PUBLIC_GOOGLE_MAPS_API_KEY'],
    openai_llm: ['OPENAI_API_KEY', 'LLM_PROVIDER', 'LLM_API_KEY', 'OLLAMA_BASE_URL'],
    payment_link: ['PAYMENT_LINK_BASE_URL', 'PAYMENT_PROVIDER_API_KEY', 'PAYMENT_PROVIDER_WEBHOOK_SECRET'],
    backups: backupStorageRequiredEnv(),
    super_admin: ['SUPER_ADMIN_EMAIL', 'SUPER_ADMIN_INITIAL_PASSWORD', 'DATABASE_URL', 'JWT_SECRET'],
    public_base_url: ['PUBLIC_BASE_URL', 'APP_BASE_URL']
  };
  return keyGroups[provider] || [];
}

function missingEnv(keys = []) {
  return keys.filter((key) => !envSet(key));
}

function missingProviderEnv(provider) {
  if (provider === 'sms') return missingSmsEnv();
  if (provider === 'media_storage') return missingMediaStorageEnv();
  if (provider === 'backups') return missingBackupStorageEnv();  return missingEnv(providerEnvKeys(provider));
}

const ADMIN_DASHBOARD_CACHE_TTL_MS = 15000;
const ADMIN_REVIEW_QUEUE_CACHE_TTL_MS = 8000;
const ADMIN_SAFE_QUERY_TIMEOUT_MS = 3500;
const ADMIN_REVIEW_QUEUE_QUERY_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.ADMIN_REVIEW_QUEUE_QUERY_TIMEOUT_MS || 4000)
);
const adminDashboardResponseCache = new Map();
let adminSummaryLastKnownGoodPayload = null;

function clearAdminReviewQueueCache() {
  for (const cacheKey of adminDashboardResponseCache.keys()) {
    const key = String(cacheKey);
    if (
      key.includes('admin-review-queue-v')
      || key.includes('admin-command-centre-v4')
      || key.includes('admin-summary-v5-properties-list-count-fast')
      || key.includes('admin-actionable-review-count-v1')
    ) {
      adminDashboardResponseCache.delete(cacheKey);
    }
  }
}

function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function hasUsefulAdminSummaryNumbers(payload = {}) {
  const properties = payload?.data?.properties || {};
  return Number(properties.public_live || 0) > 0
    || Number(properties.approved || 0) > 0
    || Number(properties.total || 0) > 0;
}

function rememberAdminSummaryLastKnownGood(payload = {}) {
  if (!hasUsefulAdminSummaryNumbers(payload)) return payload;
  adminSummaryLastKnownGoodPayload = cloneJson(payload);
  return payload;
}

function buildAdminSummaryLastKnownGoodPayload(error, source = 'admin_summary_last_known_good') {
  if (!adminSummaryLastKnownGoodPayload) return null;
  const payload = cloneJson(adminSummaryLastKnownGoodPayload);
  payload.meta = {
    ...(payload.meta || {}),
    cache: source,
    stale: true,
    partial: true,
    fallback_reason: adminSummaryFallbackReason(error),
    generated_at: new Date().toISOString(),
    last_known_good_generated_at: payload.meta?.generated_at || null
  };
  if (payload.data?.properties) {
    payload.data.properties = {
      ...payload.data.properties,
      _fallback_reason: adminSummaryFallbackReason(error)
    };
  }
  return payload;
}

function adminCacheEntryIsFresh(entry) {
  return entry?.value && Number(entry.expiresAt || 0) > Date.now();
}

async function adminCachedPayload(cacheKey, ttlMs, producer) {
  const existing = adminDashboardResponseCache.get(cacheKey);
  if (adminCacheEntryIsFresh(existing)) return existing.value;
  if (existing?.promise) return existing.promise;

  const promise = Promise.resolve()
    .then(producer)
    .then((value) => {
      adminDashboardResponseCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + Math.max(1000, Number(ttlMs) || ADMIN_DASHBOARD_CACHE_TTL_MS)
      });
      return value;
    })
    .catch((error) => {
      if (existing?.value) {
        const stalePayload = cloneJson(existing.value);
        stalePayload.meta = {
          ...(stalePayload.meta || {}),
          cache: `${cacheKey}_stale`,
          stale: true,
          partial: true,
          fallback_reason: adminSafeQueryFallbackReason(error) || error?.code || 'query_failed',
          generated_at: new Date().toISOString(),
          last_known_good_generated_at: stalePayload.meta?.generated_at || null
        };
        adminDashboardResponseCache.set(cacheKey, {
          value: stalePayload,
          expiresAt: Date.now() + Math.max(1000, Math.min(Number(ttlMs) || ADMIN_DASHBOARD_CACHE_TTL_MS, 5000))
        });
        return stalePayload;
      }
      adminDashboardResponseCache.delete(cacheKey);
      throw error;
    });

  adminDashboardResponseCache.set(cacheKey, { promise, expiresAt: 0 });
  return promise;
}

function adminSafeQueryFallbackReason(error) {
  if (['42P01', '42703', '42704'].includes(error?.code)) return error.code;
  if (error?.code === '57014') return 'statement_timeout';
  if (error?.code === 'POOL_TIMEOUT') return 'pool_timeout';
  if (/statement timeout|canceling statement/i.test(String(error?.message || ''))) return 'statement_timeout';
  if (/client acquisition timed out|connection timeout|timeout exceeded/i.test(String(error?.message || ''))) return 'pool_timeout';
  return '';
}

async function adminTimedQuery(sql, values = [], timeoutMs = ADMIN_SAFE_QUERY_TIMEOUT_MS) {
  let acquireTimedOut = false;
  const acquireTimeoutMs = Math.max(250, Math.min(Number(timeoutMs) || ADMIN_SAFE_QUERY_TIMEOUT_MS, 900));
  const clientPromise = db.getClient().then((client) => {
    if (acquireTimedOut) {
      client.release();
      return null;
    }
    return client;
  });
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      acquireTimedOut = true;
      const error = new Error('Database client acquisition timed out');
      error.code = 'POOL_TIMEOUT';
      reject(error);
    }, acquireTimeoutMs);
  });
  const client = await Promise.race([clientPromise, timeoutPromise]);
  if (!client) {
    const error = new Error('Database client acquisition timed out');
    error.code = 'POOL_TIMEOUT';
    throw error;
  }
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', [
      'statement_timeout',
      `${Math.max(250, Number(timeoutMs) || ADMIN_SAFE_QUERY_TIMEOUT_MS)}ms`
    ]);
    const result = await client.query(sql, values);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function safeOne(sql, values = [], fallback = {}, options = {}) {
  try {
    const result = options.timeoutMs === 0
      ? await db.query(sql, values)
      : await adminTimedQuery(sql, values, options.timeoutMs || ADMIN_SAFE_QUERY_TIMEOUT_MS);
    return result.rows[0] || fallback;
  } catch (error) {
    const fallbackReason = adminSafeQueryFallbackReason(error);
    if (fallbackReason) return { ...fallback, _fallback_reason: fallbackReason };
    throw error;
  }
}

async function safeRows(sql, values = [], options = {}) {
  try {
    const result = options.timeoutMs === 0
      ? await db.query(sql, values)
      : await adminTimedQuery(sql, values, options.timeoutMs || ADMIN_SAFE_QUERY_TIMEOUT_MS);
    return result.rows || [];
  } catch (error) {
    if (adminSafeQueryFallbackReason(error)) return [];
    throw error;
  }
}

async function safeCount(sql, values = [], options = {}) {
  const row = await safeOne(sql, values, { total: 0 }, options);
  return Number(row.total || 0);
}

async function adminActionableReviewQueueCount({ timeoutMs = ADMIN_SAFE_QUERY_TIMEOUT_MS } = {}) {
  const payload = await adminCachedPayload('admin-actionable-review-count-v1', ADMIN_DASHBOARD_CACHE_TTL_MS, async () => {
    const standardWhere = `(
      ${adminDefaultReviewQueueWhere('p')}
      AND COALESCE(p.source, '') <> 'found_online_property_source_v1'
      AND COALESCE(p.listed_via, '') <> 'found_online'
    )`;
    const pendingStatuses = adminSqlList(ADMIN_PENDING_REVIEW_STATUSES);
    const foundOnlinePending = `(
      COALESCE(p.status, '') IN (${pendingStatuses})
      OR COALESCE(p.moderation_stage, '') IN (${pendingStatuses})
    )`;

    // Keep this sequential: command-centre already launches its widgets in parallel,
    // so nested parallel queries can exhaust the pool on a cold dashboard load.
    const standard = await safeCount(
      `SELECT COUNT(*)::int AS total FROM properties p WHERE ${standardWhere}`,
      [],
      { timeoutMs }
    );
    const foundOnline = await safeCount(
      `SELECT (
         SELECT COUNT(*)::int
         FROM properties p
         WHERE p.source = 'found_online_property_source_v1'
           AND ${foundOnlinePending}
       ) + (
         SELECT COUNT(*)::int
         FROM properties p
         WHERE p.listed_via = 'found_online'
           AND p.source IS DISTINCT FROM 'found_online_property_source_v1'
           AND ${foundOnlinePending}
       ) AS total`,
      [],
      { timeoutMs }
    );
    return { total: standard + foundOnline, standard, found_online: foundOnline };
  });
  return Number(payload?.total || 0);
}

function adminSummaryFallbackReason(error) {
  return adminSafeQueryFallbackReason(error) || error?.code || 'query_failed';
}

async function adminSummaryOne(sql, values = [], fallback = {}, options = {}) {
  try {
    return await safeOne(sql, values, fallback, options);
  } catch (error) {
    const fallbackReason = adminSummaryFallbackReason(error);
    logger.warn('Admin summary widget fell back after query failure', {
      reason: fallbackReason,
      code: error?.code,
      message: error?.message
    });
    return { ...fallback, _fallback_reason: fallbackReason };
  }
}

async function adminSummaryRows(sql, values = [], options = {}) {
  try {
    return await safeRows(sql, values, options);
  } catch (error) {
    logger.warn('Admin summary list widget fell back after query failure', {
      reason: adminSummaryFallbackReason(error),
      code: error?.code,
      message: error?.message
    });
    return [];
  }
}

async function adminSummaryCount(sql, values = [], options = {}) {
  const row = await adminSummaryOne(sql, values, { total: 0 }, options);
  return Number(row.total || 0);
}

function zeroPublicInventorySummary() {
  return normalizePublicOpportunitySummary({});
}

async function safePublicInventorySummaryForAdmin() {
  try {
    return await loadPublicOpportunitySummary({ timeoutMs: 750 });
  } catch (error) {
    return {
      summary: zeroPublicInventorySummary(),
      meta: {
        marker: PUBLIC_INVENTORY_METRICS_MARKER,
        cache: 'fallback',
        fallback_reason: error?.code === '57014'
          ? 'statement_timeout'
          : error?.code === 'POOL_TIMEOUT' ? 'pool_timeout' : 'query_failed'
      }
    };
  }
}

async function loadAdminPropertiesSummaryFast() {
  const [
    publicInventory,
    totalRow,
    pending,
    approved,
    publicFeatured,
    rejected,
    hidden,
    deleted,
    privateListed,
    agentListed,
    studentDiscoverable
  ] = await Promise.all([
    safePublicInventorySummaryForAdmin(),
    adminSummaryOne(
      "SELECT GREATEST(COALESCE(reltuples::bigint, 0), 0)::int AS total FROM pg_class WHERE oid = 'properties'::regclass",
      [],
      { total: 0 },
      { timeoutMs: 500 }
    ),
    adminActionableReviewQueueCount({ timeoutMs: 2500 }),
    adminSummaryCount("SELECT COUNT(*)::int AS total FROM properties WHERE status = 'approved'", [], { timeoutMs: 700 }),
    adminSummaryCount(
      `SELECT COUNT(*)::int AS total
       FROM properties p
       WHERE ${publicVisibleInventoryWhere('p')}
         AND ${adminFeaturedListingCondition('p')}`,
      [],
      { timeoutMs: 700 }
    ),
    adminSummaryCount("SELECT COUNT(*)::int AS total FROM properties WHERE status = 'rejected'", [], { timeoutMs: 700 }),
    adminSummaryCount("SELECT COUNT(*)::int AS total FROM properties WHERE status = 'hidden'", [], { timeoutMs: 700 }),
    adminSummaryCount("SELECT COUNT(*)::int AS total FROM properties WHERE status = 'deleted'", [], { timeoutMs: 700 }),
    adminSummaryCount("SELECT COUNT(*)::int AS total FROM properties WHERE COALESCE(lister_type, 'owner') <> 'agent' AND agent_id IS NULL", [], { timeoutMs: 700 }),
    adminSummaryCount("SELECT COUNT(*)::int AS total FROM properties WHERE COALESCE(lister_type, 'owner') = 'agent' OR agent_id IS NOT NULL", [], { timeoutMs: 700 }),
    adminSummaryCount("SELECT COUNT(*)::int AS total FROM properties WHERE listing_type = 'student' OR students_welcome = TRUE", [], { timeoutMs: 700 })
  ]);
  const total = Number(totalRow?.total || 0) || 0;
  const publicLive = Number(publicInventory?.summary?.total || 0) || 0;
  return {
    total,
    pending,
    approved,
    public_live: publicLive,
    public_featured: publicFeatured,
    rejected,
    hidden,
    deleted,
    private: privateListed,
    agent_listed: agentListed,
    student_discoverable: studentDiscoverable,
    approval_rate_pct: total ? Math.round((publicLive / total) * 100) : 0,
    rejection_rate_pct: total ? Math.round((rejected / total) * 100) : 0,
    public_opportunities: publicInventory.summary || zeroPublicInventorySummary(),
    public_count_marker: publicInventory.meta?.marker || PUBLIC_INVENTORY_METRICS_MARKER,
    public_count_cache: publicInventory.meta?.cache || 'unknown',
    ...(publicInventory.meta?.fallback_reason ? { _fallback_reason: publicInventory.meta.fallback_reason } : {})
  };
}

async function buildAdminSummaryFallbackPayload(error) {
  const lastKnownGood = buildAdminSummaryLastKnownGoodPayload(error);
  if (lastKnownGood) return lastKnownGood;

  const publicInventory = await safePublicInventorySummaryForAdmin();
  const publicLive = Number(publicInventory?.summary?.total || 0) || 0;
  const reason = adminSummaryFallbackReason(error);
  const unknownCount = null;
  return {
    ok: true,
    data: {
      properties: {
        total: publicLive || null,
        pending: unknownCount,
        approved: publicLive || null,
        public_live: publicLive || null,
        public_featured: unknownCount,
        rejected: unknownCount,
        hidden: unknownCount,
        deleted: unknownCount,
        private: unknownCount,
        agent_listed: unknownCount,
        student_discoverable: publicLive > 0 ? publicInventory?.summary?.student || 0 : null,
        approval_rate_pct: publicLive ? 100 : null,
        rejection_rate_pct: publicLive ? 0 : null,
        public_opportunities: publicInventory.summary || zeroPublicInventorySummary(),
        public_count_marker: publicInventory.meta?.marker || PUBLIC_INVENTORY_METRICS_MARKER,
        public_count_cache: publicInventory.meta?.cache || 'fallback',
        _fallback_reason: reason
      },
      agents: { total: null, pending: null, approved: null, _fallback_reason: reason },
      users: { total: null, active: null, suspended: null, phone_verified: null, weekly_tips_opt_in: null, marketing_opt_in: null, social_linked: null, _fallback_reason: reason },
      reports: { total: null, open: null, _fallback_reason: reason },
      propertyRequests: { total: null, _fallback_reason: reason },
      inquiries: { total: null, _fallback_reason: reason },
      engagement: { property_views: null, property_saves: null, broker_profile_views: null, property_inquiries: null, route_events: null, _fallback_reason: reason },
      ai_insights: {
        last_48h: { property_views: null, unique_visitors: null, property_saves: null, property_inquiries: null, route_events: null, _fallback_reason: reason },
        top_areas: [],
        top_listing_types: []
      }
    },
    meta: {
      cache: 'admin_summary_route_fallback',
      cache_ttl_ms: ADMIN_DASHBOARD_CACHE_TTL_MS,
      public_count_marker: PUBLIC_INVENTORY_METRICS_MARKER,
      generated_at: new Date().toISOString(),
      partial: true,
      stale: true,
      fallback_reason: reason
    }
  };
}

async function createLaunchAudit(req, action, details = {}) {
  await writeAudit(action, {
    ...details,
    launch_proof: true,
    created_by: 'admin_setup_status'
  }, adminActorId(req));
}

function adminTestEmail() {
  return process.env.SUPER_ADMIN_EMAIL || process.env.SUPPORT_EMAIL || process.env.EMAIL_FROM || 'owner@makaug.com';
}

function adminTestPhone() {
  return process.env.SMS_TEST_PHONE || process.env.SUPER_ADMIN_PHONE || process.env.SUPPORT_WHATSAPP || process.env.WHATSAPP_TEST_PHONE || '+256760112587';
}

function launchTimestamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

async function uploadBackupStorageCanary() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const prefix = normalizeObjectKey(process.env.DATA_BACKUP_PREFIX || 'makaug');
  const payload = Buffer.from(`${JSON.stringify({
    app: 'makaug',
    kind: 'admin_backup_storage_canary',
    created_at: new Date().toISOString(),
    data_backup_local_paths: process.env.DATA_BACKUP_LOCAL_PATHS || null
  }, null, 2)}\n`, 'utf8');

  return uploadBackupBufferToS3({
    bucket: process.env.DATA_BACKUP_BUCKET,
    key: `${prefix}/canary/${stamp}-admin-backup-storage.json`,
    bytes: payload,
    mimeType: 'application/json',
    isPrivate: true
  });
}

async function uploadMediaStorageCanary() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzv9WQAAAABJRU5ErkJggg==',
    'base64'
  );

  return uploadBufferToS3({
    key: `provider-tests/media-storage/${stamp}-admin-media-storage.png`,
    bytes: tinyPng,
    mimeType: 'image/png'
  });
}

async function createSafeLaunchProperty(req, overrides = {}) {
  const reference = buildListingReference();
  const result = await db.query(
    `INSERT INTO properties (
       listing_type, title, description, district, area, address, price,
       bedrooms, bathrooms, property_type, amenities, extra_fields,
       lister_name, lister_phone, lister_email, lister_type, status, source, listed_via
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15,$16,$17,$18,$19)
     RETURNING *`,
    [
      overrides.listing_type || 'sale',
      overrides.title || `Launch proof hidden listing ${reference}`,
      overrides.description || 'Admin-only safe property submission test. This record is for launch proof and should not be approved publicly.',
      overrides.district || 'Kampala',
      overrides.area || 'Ntinda',
      overrides.address || 'Launch proof landmark, Ntinda',
      overrides.price || 150000000,
      overrides.bedrooms || 2,
      overrides.bathrooms || 1,
      overrides.property_type || 'house',
      JSON.stringify(['launch_test']),
      JSON.stringify({
        is_test: true,
        launch_proof: true,
        non_public_test: true,
        reference,
        location_object: {
          query: 'Ntinda launch proof',
          fullAddress: 'Launch proof landmark, Ntinda, Kampala, Uganda',
          area: 'Ntinda',
          city: 'Kampala',
          district: 'Kampala',
          country: 'Uganda',
          latitude: 0.353,
          longitude: 32.616,
          locationConfidence: 'test',
          locationPrivacy: 'admin_only'
        }
      }),
      overrides.lister_name || 'makaug Launch Proof',
      overrides.lister_phone || adminTestPhone(),
      overrides.lister_email || adminTestEmail(),
      'owner',
      'pending',
      'admin_test',
      'admin_setup_status'
    ]
  );
  const listing = result.rows[0];
  const lead = await createLead(db, {
    source: 'admin_property_submission_test',
    leadType: 'listing_submission',
    category: listing.listing_type,
    location: `${listing.area}, ${listing.district}`,
    listingId: listing.id,
    contact: {
      name: listing.lister_name,
      email: listing.lister_email,
      phone: listing.lister_phone,
      roleType: 'owner',
      preferredContactChannel: 'whatsapp'
    },
    message: `Safe property submission proof for ${reference}`,
    metadata: { reference, launch_proof: true, non_public_test: true }
  });
  await logEmailEvent(db, {
    eventType: 'listing_submitted',
    recipientEmail: listing.lister_email,
    recipientRole: 'property_owner',
    templateKey: 'listing_submitted_confirmation',
    subject: 'Your makaug property listing has been submitted',
    status: providerConfigured('email') ? 'queued' : 'provider_missing',
    provider: providerConfigured('email') ? 'configured' : null,
    relatedListingId: listing.id,
    relatedLeadId: lead?.id || null,
    failureReason: providerConfigured('email') ? null : 'email_provider_missing'
  });
  await logNotification(db, {
    recipientPhone: listing.lister_phone,
    recipientEmail: listing.lister_email,
    channel: 'in_app',
    type: 'listing_submitted',
    status: 'logged',
    relatedListingId: listing.id,
    relatedLeadId: lead?.id || null,
    payloadSummary: { reference, launch_proof: true, status: 'pending_review' }
  });
  await logWhatsAppMessage(db, {
    recipientPhone: listing.lister_phone,
    templateKey: 'listing_submitted_confirmation',
    messageType: 'template',
    status: providerConfigured('whatsapp') ? 'queued' : 'provider_missing',
    relatedListingId: listing.id,
    relatedLeadId: lead?.id || null,
    failureReason: providerConfigured('whatsapp') ? null : 'whatsapp_provider_missing'
  });
  await createLaunchAudit(req, 'safe_property_submission_test', {
    listing_id: listing.id,
    lead_id: lead?.id || null,
    reference
  });
  return { listing, lead, reference };
}

function whatsappPayloadPreview(payload = {}, messageType = 'text') {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const type = String(messageType || safePayload?.message_type || 'text').toLowerCase();
  const text = String(
    safePayload.effectiveBody
      || safePayload.body
      || safePayload.reply
      || safePayload.text
      || ''
  ).trim();

  if (text) return text.slice(0, 280);
  if (type === 'location') {
    const label = String(safePayload?.sharedLocation?.label || safePayload?.sharedLocation?.address || '').trim();
    return label ? `Shared location: ${label}` : 'Shared location';
  }
  if (type === 'voice') return 'Voice note';
  if (type === 'image') return 'Image';
  if (type === 'document') return 'Document';
  if (type === 'media' || type === 'video') return 'Media attachment';
  return 'Message';
}

function buildConversationNeedsAttention(conversation = {}) {
  const status = String(conversation.status || 'open').toLowerCase();
  if (['needs_human', 'escalated'].includes(status)) return true;
  const lastInbound = new Date(conversation.last_inbound_at || 0).getTime();
  const lastResponse = Math.max(
    new Date(conversation.last_human_reply_at || 0).getTime(),
    new Date(conversation.last_ai_reply_at || 0).getTime(),
    new Date(conversation.last_outbound_at || 0).getTime()
  );
  return lastInbound > 0 && lastInbound > lastResponse;
}

const WHATSAPP_CONVERSATION_BASE_SQL = `
  WITH phones AS (
    SELECT phone FROM whatsapp_conversation_state
    UNION
    SELECT DISTINCT user_phone AS phone FROM whatsapp_messages
  ),
  latest_message AS (
    SELECT DISTINCT ON (m.user_phone)
      m.user_phone,
      m.direction,
      m.message_type,
      m.payload,
      m.created_at
    FROM whatsapp_messages m
    ORDER BY m.user_phone, m.created_at DESC
  ),
  message_counts AS (
    SELECT
      user_phone,
      COUNT(*)::int AS total_messages,
      COUNT(*) FILTER (WHERE direction = 'inbound')::int AS inbound_count,
      COUNT(*) FILTER (WHERE direction = 'outbound')::int AS outbound_count,
      MAX(created_at) AS last_message_at
    FROM whatsapp_messages
    GROUP BY user_phone
  ),
  latest_intent AS (
    SELECT DISTINCT ON (i.user_phone)
      i.user_phone,
      i.detected_intent,
      i.confidence,
      i.language,
      i.current_step,
      i.created_at
    FROM whatsapp_intent_logs i
    ORDER BY i.user_phone, i.created_at DESC
  )
  SELECT
    p.phone,
    COALESCE(c.status, 'open') AS status,
    COALESCE(c.category, 'uncategorized') AS category,
    COALESCE(c.priority, 'normal') AS priority,
    COALESCE(c.ai_mode, 'autopilot') AS ai_mode,
    COALESCE(c.category_source, 'auto') AS category_source,
    c.assigned_to,
    c.last_summary,
    c.admin_notes,
    COALESCE(c.tags, '[]'::jsonb) AS tags,
    COALESCE(c.metadata, '{}'::jsonb) AS metadata,
    COALESCE(c.last_message_at, mc.last_message_at, lm.created_at, s.last_message_at) AS last_message_at,
    c.last_inbound_at,
    c.last_outbound_at,
    c.last_ai_reply_at,
    c.last_human_reply_at,
    COALESCE(mc.total_messages, 0) AS total_messages,
    COALESCE(mc.inbound_count, 0) AS inbound_count,
    COALESCE(mc.outbound_count, 0) AS outbound_count,
    lm.direction AS latest_direction,
    lm.message_type AS latest_message_type,
    lm.payload AS latest_payload,
    li.detected_intent AS last_intent,
    li.confidence AS last_intent_confidence,
    li.language AS detected_language,
    COALESCE(wup.preferred_language, s.language, li.language, 'en') AS preferred_language,
    COALESCE(s.current_step, li.current_step, 'greeting') AS current_step,
    u.id AS user_id,
    CONCAT_WS(' ', NULLIF(u.first_name, ''), NULLIF(u.last_name, '')) AS user_name,
    u.role AS user_role,
    u.status AS user_status,
    u.email AS user_email,
    a.id AS agent_id,
    a.full_name AS agent_name,
    a.company_name AS agent_company,
    a.status AS agent_status,
    a.registration_status AS agent_registration_status
  FROM phones p
  LEFT JOIN whatsapp_conversation_state c
    ON c.phone = p.phone
  LEFT JOIN message_counts mc
    ON mc.user_phone = p.phone
  LEFT JOIN latest_message lm
    ON lm.user_phone = p.phone
  LEFT JOIN latest_intent li
    ON li.user_phone = p.phone
  LEFT JOIN whatsapp_user_profiles wup
    ON wup.phone = p.phone
  LEFT JOIN whatsapp_sessions s
    ON s.phone = p.phone
  LEFT JOIN LATERAL (
    SELECT id, first_name, last_name, role, status, email
    FROM users
    WHERE phone = p.phone
    ORDER BY created_at DESC
    LIMIT 1
  ) u ON true
  LEFT JOIN LATERAL (
    SELECT id, full_name, company_name, status, registration_status
    FROM agents
    WHERE phone = p.phone
       OR whatsapp = p.phone
    ORDER BY created_at DESC
    LIMIT 1
  ) a ON true
`;

async function listWhatsappConversations(query = {}) {
  const { page, limit, offset } = parsePagination(query);
  const search = String(query.search || '').trim().toLowerCase();
  const status = String(query.status || '').trim().toLowerCase();
  const category = String(query.category || '').trim().toLowerCase();
  const aiMode = String(query.ai_mode || '').trim().toLowerCase();
  const priority = String(query.priority || '').trim().toLowerCase();

  const filters = [];
  const values = [];

  if (search) {
    values.push(`%${search}%`);
    filters.push(`(
      convo.phone ILIKE $${values.length}
      OR COALESCE(convo.user_name, '') ILIKE $${values.length}
      OR COALESCE(convo.user_email, '') ILIKE $${values.length}
      OR COALESCE(convo.agent_name, '') ILIKE $${values.length}
      OR COALESCE(convo.agent_company, '') ILIKE $${values.length}
      OR COALESCE(convo.last_summary, '') ILIKE $${values.length}
      OR COALESCE(convo.admin_notes, '') ILIKE $${values.length}
      OR COALESCE(convo.last_intent, '') ILIKE $${values.length}
      OR COALESCE(convo.latest_payload->>'body', '') ILIKE $${values.length}
      OR COALESCE(convo.latest_payload->>'effectiveBody', '') ILIKE $${values.length}
      OR COALESCE(convo.latest_payload->>'reply', '') ILIKE $${values.length}
    )`);
  }

  if (status) {
    values.push(normalizeConversationStatus(status));
    filters.push(`convo.status = $${values.length}`);
  }

  if (category) {
    values.push(normalizeConversationCategory(category));
    filters.push(`convo.category = $${values.length}`);
  }

  if (aiMode) {
    values.push(normalizeConversationAiMode(aiMode));
    filters.push(`convo.ai_mode = $${values.length}`);
  }

  if (priority) {
    values.push(normalizeConversationPriority(priority));
    filters.push(`convo.priority = $${values.length}`);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const countResult = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM (${WHATSAPP_CONVERSATION_BASE_SQL}) convo
     ${where}`,
    values
  );
  const total = countResult.rows[0]?.total || 0;

  const listValues = [...values, limit, offset];
  const rows = await db.query(
    `SELECT *
     FROM (${WHATSAPP_CONVERSATION_BASE_SQL}) convo
     ${where}
     ORDER BY convo.last_message_at DESC NULLS LAST, convo.phone ASC
     LIMIT $${values.length + 1}
     OFFSET $${values.length + 2}`,
    listValues
  );

  const conversations = rows.rows.map((row) => {
    const latestPreview = whatsappPayloadPreview(row.latest_payload, row.latest_message_type);
    const contactName = row.user_name || row.agent_name || null;
    const participantType = row.agent_id
      ? 'broker'
      : row.user_id
        ? 'account'
        : 'guest';
    return {
      ...row,
      latest_preview: latestPreview,
      contact_name: contactName,
      participant_type: participantType,
      needs_attention: buildConversationNeedsAttention(row)
    };
  });

  const summaryResult = await db.query(
    `SELECT
      COUNT(*)::int AS total_conversations,
      COUNT(*) FILTER (WHERE last_message_at >= NOW() - INTERVAL '7 days')::int AS active_7d,
      COUNT(*) FILTER (WHERE status IN ('needs_human', 'escalated'))::int AS needs_human,
      COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
      COUNT(*) FILTER (WHERE ai_mode = 'autopilot')::int AS autopilot,
      COUNT(*) FILTER (WHERE ai_mode = 'copilot')::int AS copilot,
      COUNT(*) FILTER (WHERE ai_mode = 'off')::int AS manual_only
     FROM (${WHATSAPP_CONVERSATION_BASE_SQL}) convo`,
    []
  );

  return {
    conversations,
    summary: summaryResult.rows[0] || {},
    pagination: toPagination(total, page, limit)
  };
}

async function loadWhatsappConversationDetail(phone) {
  const normalizedPhone = normalizeConversationPhone(phone);
  if (!normalizedPhone) {
    const error = new Error('Invalid WhatsApp phone');
    error.status = 400;
    throw error;
  }

  const conversationResult = await db.query(
    `SELECT *
     FROM (${WHATSAPP_CONVERSATION_BASE_SQL}) convo
     WHERE convo.phone = $1
     LIMIT 1`,
    [normalizedPhone]
  );

  if (!conversationResult.rows.length) return null;

  const conversation = conversationResult.rows[0];
  conversation.latest_preview = whatsappPayloadPreview(conversation.latest_payload, conversation.latest_message_type);
  conversation.contact_name = conversation.user_name || conversation.agent_name || null;
  conversation.participant_type = conversation.agent_id
    ? 'broker'
    : conversation.user_id
      ? 'account'
      : 'guest';
  conversation.needs_attention = buildConversationNeedsAttention(conversation);

  const [messagesResult, intentsResult, relatedResult] = await Promise.all([
    db.query(
      `SELECT *
       FROM (
         SELECT id, user_phone, wa_message_id, direction, message_type, payload, created_at
         FROM whatsapp_messages
         WHERE user_phone = $1
         ORDER BY created_at DESC
         LIMIT 120
       ) m
       ORDER BY created_at ASC`,
      [normalizedPhone]
    ),
    db.query(
      `SELECT id, detected_intent, confidence, language, current_step, raw_text, transcript, entities, model_used, created_at
       FROM whatsapp_intent_logs
       WHERE user_phone = $1
       ORDER BY created_at DESC
       LIMIT 25`,
      [normalizedPhone]
    ),
    db.query(
      `SELECT
        (SELECT COUNT(*)::int FROM property_search_requests WHERE user_phone = $1) AS search_requests,
        (SELECT COUNT(*)::int FROM property_leads WHERE phone = $1) AS property_leads,
        (SELECT COUNT(*)::int FROM mortgage_enquiries WHERE user_phone = $1) AS mortgage_leads,
        (SELECT COUNT(*)::int FROM agent_applications WHERE phone = $1) AS agent_applications,
        (SELECT COUNT(*)::int FROM properties WHERE lister_phone = $1) AS listings`,
      [normalizedPhone]
    )
  ]);

  return {
    conversation,
    messages: messagesResult.rows.map((row) => ({
      ...row,
      preview: whatsappPayloadPreview(row.payload, row.message_type)
    })),
    intents: intentsResult.rows,
    related: relatedResult.rows[0] || {}
  };
}

function publicPreviewExtraFields(extraFields = {}) {
  const extra = extraFields && typeof extraFields === 'object' ? extraFields : {};
  return {
    city: extra.city || null,
    neighborhood: extra.neighborhood || null,
    street_name: extra.street_name || null,
    region: extra.region || null,
    resolved_location_label: extra.resolved_location_label || null,
    public_display_name: extra.public_display_name || null,
    preferred_contact_method: extra.preferred_contact_method || null,
    video_url: extra.video_url || null,
    youtube_url: extra.youtube_url || null,
    area_highlights: extra.area_highlights || '',
    nearby_facilities: Array.isArray(extra.nearby_facilities) ? extra.nearby_facilities : [],
    translations: extra.translations && typeof extra.translations === 'object' ? extra.translations : {},
    size_raw: extra.size_raw || '',
    featured: extra.featured === true,
    featured_at: extra.featured_at || null
  };
}

function buildAdminLivePreviewPayload(review = {}) {
  const images = Array.isArray(review.images) ? review.images : [];
  const primaryImage = images.find((image) => image?.is_primary)?.url || images[0]?.url || null;
  const {
    owner_edit_token_hash: _ownerEditTokenHash,
    owner_edit_token_expires_at: _ownerEditTokenExpiresAt,
    id_number: _idNumber,
    id_document_name: _idDocumentName,
    id_document_url: _idDocumentUrl,
    review: _review,
    quality_signals: _qualitySignals,
    events: _events,
    moderation_notes: _moderationNotes,
    moderation_reason: _moderationReason,
    extra_fields: rawExtraFields,
    ...safe
  } = review || {};
  return {
    ...safe,
    listingId: safe.id,
    slug: safe.id,
    url: safe.id ? `/property/${safe.id}` : '',
    category: safe.listing_type,
    location: [safe.area, safe.district].filter(Boolean).join(', '),
    image: primaryImage,
    primary_image_url: primaryImage,
    extra_fields: publicPreviewExtraFields(rawExtraFields),
    featured: rawExtraFields?.featured === true,
    featured_at: rawExtraFields?.featured_at || null,
    owner_preview_visible: true,
    admin_preview: true,
    preview_status: safe.status || 'pending',
    images
  };
}

async function loadPropertyReview(propertyId) {
  const lookup = cleanText(propertyId);
  const property = await db.query(
    `SELECT
      p.*,
      a.id AS agent_id,
      a.full_name AS agent_name,
      a.company_name AS agent_company,
      a.phone AS agent_phone,
      a.email AS agent_email,
      a.licence_number AS agent_licence_number,
      a.registration_status AS agent_registration_status
     FROM properties p
     LEFT JOIN agents a ON a.id = p.agent_id
     WHERE p.id::text = $1 OR p.inquiry_reference = $1
     LIMIT 1`,
    [lookup]
  );

  if (!property.rows.length) return null;
  const listing = property.rows[0];
  const resolvedPropertyId = listing.id;

  const [
    images,
    previousListerListings,
    likelyDuplicates,
    reusedImages,
    idNumberMatches,
    matchingUsers,
    events
  ] = await Promise.all([
    db.query(
      `SELECT id, url, is_primary, sort_order, slot_key, room_label, created_at
       FROM property_images
       WHERE property_id = $1
       ORDER BY is_primary DESC, sort_order ASC, created_at ASC`,
      [resolvedPropertyId]
    ),
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
      [resolvedPropertyId, listing.lister_phone || null, listing.lister_email || null]
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
        resolvedPropertyId,
        listing.title || '',
        listing.address || null,
        listing.listing_type,
        listing.district,
        listing.area,
        listing.price
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
      [resolvedPropertyId]
    ),
    db.query(
      `SELECT id, title, lister_name, lister_phone, lister_email, status, created_at
       FROM properties
       WHERE id <> $1
         AND $2::text IS NOT NULL
         AND id_number = $2
       ORDER BY created_at DESC
       LIMIT 20`,
      [resolvedPropertyId, listing.id_number || null]
    ),
    db.query(
      `SELECT id, first_name, last_name, phone, email, role, status, created_at
       FROM users
       WHERE ($1::text IS NOT NULL AND phone = $1)
          OR ($2::text IS NOT NULL AND LOWER(COALESCE(email, '')) = LOWER($2))
       ORDER BY created_at DESC
       LIMIT 20`,
      [listing.lister_phone || null, listing.lister_email || null]
    ),
    db.query(
      `SELECT id, actor_id, action, status_from, status_to, checklist, reason, notes, delivery, created_at
       FROM property_moderation_events
       WHERE property_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [resolvedPropertyId]
    )
  ]);

  const externalDuplicateScan = getCachedExternalDuplicateScan(listing);

  const automatedReview = buildAutomatedListingReview({
    listing,
    images: images.rows,
    previousListerListings: previousListerListings.rows,
    likelyDuplicates: likelyDuplicates.rows,
    reusedImages: reusedImages.rows,
    idNumberMatches: idNumberMatches.rows,
    matchingUsers: matchingUsers.rows,
    externalDuplicateScan
  });

  return {
    ...listing,
    owner_edit_token_hash: undefined,
    id_document_url: undefined,
    id_document_available: !!(listing.id_document_url || listing.extra_fields?.verify?.id_document_url),
    images: images.rows,
    review: {
      checklist: automatedReview.checklist,
      checklist_items: automatedReview.checks,
      notes: listing.moderation_notes || '',
      reason: listing.moderation_reason || listing.extra_fields?.moderation_reason || '',
      warning_overrides: listing.extra_fields?.review_warning_overrides || {},
      automated: automatedReview
    },
    quality_signals: {
      previous_lister_listing_count: previousListerListings.rows.length,
      previous_lister_listings: previousListerListings.rows,
      likely_duplicate_count: likelyDuplicates.rows.length,
      likely_duplicates: likelyDuplicates.rows,
      reused_image_count: reusedImages.rows.length,
      reused_images: reusedImages.rows,
      id_number_match_count: idNumberMatches.rows.length,
      id_number_matches: idNumberMatches.rows,
      matching_user_count: matchingUsers.rows.length,
      matching_users: matchingUsers.rows,
      external_duplicate_check: externalDuplicateScan
    },
    events: events.rows
  };
}

function districtForKnownLocationText(value = '') {
  const text = cleanText(value);
  if (!text) return '';
  const direct = districtForKnownArea(text);
  if (direct) return direct;
  return text
    .split(/[,;|/]+/)
    .map((part) => districtForKnownArea(part))
    .find(Boolean) || '';
}

async function updatePropertyEditableFields({ propertyId, patch = {} }) {
  const normalizedPatch = { ...patch };
  if (!Object.prototype.hasOwnProperty.call(normalizedPatch, 'listing_type')) {
    const typeAlias = normalizedPatch.listingType ?? normalizedPatch.type ?? normalizedPatch.category;
    if (typeAlias != null) normalizedPatch.listing_type = typeAlias;
  }
  if (!Object.prototype.hasOwnProperty.call(normalizedPatch, 'latitude')) {
    const latAlias = normalizedPatch.lat;
    if (latAlias != null) normalizedPatch.latitude = latAlias;
  }
  if (!Object.prototype.hasOwnProperty.call(normalizedPatch, 'longitude')) {
    const lngAlias = normalizedPatch.lng ?? normalizedPatch.lon ?? normalizedPatch.long;
    if (lngAlias != null) normalizedPatch.longitude = lngAlias;
  }
  if (!Object.prototype.hasOwnProperty.call(normalizedPatch, 'land_title_available')) {
    const landTitleAlias = normalizedPatch.landTitleAvailable ?? normalizedPatch.title_available ?? normalizedPatch.titleAvailable;
    if (landTitleAlias != null) normalizedPatch.land_title_available = landTitleAlias;
  }
  if (!Object.prototype.hasOwnProperty.call(normalizedPatch, 'transaction_type')) {
    const transactionAlias = normalizedPatch.transactionType ?? normalizedPatch.commercial_mode ?? normalizedPatch.commercial_intent;
    if (transactionAlias != null) normalizedPatch.transaction_type = transactionAlias;
  }
  const effectiveListingType = cleanText(normalizedPatch.listing_type || normalizedPatch.listingType).toLowerCase();
  if (effectiveListingType === 'commercial' && Object.prototype.hasOwnProperty.call(normalizedPatch, 'property_type')) {
    normalizedPatch.property_type = normalizeCommercialPropertyType(normalizedPatch.property_type, {
      title: normalizedPatch.title,
      description: normalizedPatch.description
    });
  }

  const fieldMap = {
    title: { column: 'title', value: cleanText(normalizedPatch.title), required: true },
    description: { column: 'description', value: cleanText(normalizedPatch.description), required: true },
    area: { column: 'area', value: cleanText(normalizedPatch.area), required: true },
    address: { column: 'address', value: cleanText(normalizedPatch.address) || null },
    price: { column: 'price', value: toNullableInt(normalizedPatch.price) },
    price_period: { column: 'price_period', value: cleanText(normalizedPatch.price_period) || null },
    transaction_type: { column: 'transaction_type', value: normalizeCommercialTransactionType(normalizedPatch.transaction_type) || null },
    property_type: { column: 'property_type', value: cleanText(normalizedPatch.property_type) || null },
    title_type: { column: 'title_type', value: cleanText(normalizedPatch.title_type) || null },
    lister_phone: { column: 'lister_phone', value: cleanText(normalizeUgPhone(normalizedPatch.lister_phone)) || null },
    bedrooms: { column: 'bedrooms', value: toNullableInt(normalizedPatch.bedrooms) },
    bathrooms: { column: 'bathrooms', value: toNullableInt(normalizedPatch.bathrooms) },
    nearest_university: { column: 'nearest_university', value: cleanText(normalizedPatch.nearest_university) || null },
    distance_to_uni_km: { column: 'distance_to_uni_km', value: toNullableFloat(normalizedPatch.distance_to_uni_km) },
    room_type: { column: 'room_type', value: cleanText(normalizedPatch.room_type) || null },
    students_welcome: { column: 'students_welcome', value: parseBooleanLike(normalizedPatch.students_welcome, false) }
  };

  const setParts = [];
  const values = [propertyId];
  const errors = [];
  const correctedFields = [];
  const extraPatch = {};
  let idx = 2;

  const hasLocationHierarchyPatch = ['region', 'district', 'city', 'neighborhood'].some((key) => (
    Object.prototype.hasOwnProperty.call(normalizedPatch, key)
  ));
  if (hasLocationHierarchyPatch) {
    const hierarchy = normalizeReviewLocationHierarchy(normalizedPatch);
    errors.push(...hierarchy.errors);
    if (hierarchy.region) normalizedPatch.region = hierarchy.region;
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'city')) normalizedPatch.city = hierarchy.city;
    if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'neighborhood')) normalizedPatch.neighborhood = hierarchy.neighborhood;
  }
  const selectedDistrict = cleanText(normalizedPatch.district);
  if (selectedDistrict && Object.prototype.hasOwnProperty.call(normalizedPatch, 'address')) {
    const addressDistrict = districtForKnownLocationText(normalizedPatch.address);
    if (addressDistrict && addressDistrict !== selectedDistrict) {
      errors.push('address/location note must match the selected district');
    }
  }

  Object.entries(fieldMap).forEach(([bodyKey, spec]) => {
    if (!Object.prototype.hasOwnProperty.call(normalizedPatch, bodyKey)) return;
    if (spec.required && !spec.value) errors.push(`${bodyKey} cannot be empty`);
    setParts.push(`${spec.column} = $${idx}`);
    values.push(spec.value);
    correctedFields.push(spec.column);
    idx += 1;
  });

  if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'lister_phone')) {
    const phone = cleanText(normalizeUgPhone(normalizedPatch.lister_phone));
    if (phone && !isValidPhone(phone)) errors.push('lister_phone is invalid');
  }

  if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'listing_type')) {
    const listingType = cleanText(normalizedPatch.listing_type).toLowerCase();
    const normalizedType = listingType === 'students' ? 'student' : listingType;
    if (!LISTING_TYPES.includes(normalizedType)) {
      errors.push('listing_type must be one of sale, rent, land, commercial, or student');
    }
    setParts.push(`listing_type = $${idx}`);
    values.push(normalizedType);
    correctedFields.push('listing_type');
    idx += 1;
  }

  if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'district')) {
    const district = cleanText(normalizedPatch.district);
    if (district && !DISTRICTS.includes(district)) errors.push('district must be one of Uganda\'s valid districts');
    setParts.push(`district = $${idx}`);
    values.push(district || null);
    correctedFields.push('district');
    idx += 1;
  }

  const toNullableCoordinate = (value) => {
    if (value == null || value === '') return null;
    const raw = String(value).trim().replace(/\s/g, '');
    const normalized = raw.includes(',') && !raw.includes('.') && raw.split(',').length === 2
      ? raw.replace(',', '.')
      : raw.replace(/,/g, '');
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : null;
  };

  if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'latitude')) {
    const latitude = toNullableCoordinate(normalizedPatch.latitude);
    const longitude = toNullableCoordinate(normalizedPatch.longitude);
    if (latitude != null && longitude != null && !isPointInUganda(latitude, longitude) && !errors.includes('map pin must be inside Uganda')) errors.push('map pin must be inside Uganda');
    else if (latitude != null && (latitude < -90 || latitude > 90)) errors.push('latitude is out of range');
    setParts.push(`latitude = $${idx}`);
    values.push(latitude);
    correctedFields.push('latitude');
    idx += 1;
  }

  if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'longitude')) {
    const longitude = toNullableCoordinate(normalizedPatch.longitude);
    const latitude = toNullableCoordinate(normalizedPatch.latitude);
    if (latitude != null && longitude != null && !isPointInUganda(latitude, longitude) && !errors.includes('map pin must be inside Uganda')) errors.push('map pin must be inside Uganda');
    else if (longitude != null && (longitude < -180 || longitude > 180)) errors.push('longitude is out of range');
    setParts.push(`longitude = $${idx}`);
    values.push(longitude);
    correctedFields.push('longitude');
    idx += 1;
  }

  if (
    (Object.prototype.hasOwnProperty.call(normalizedPatch, 'latitude') || Object.prototype.hasOwnProperty.call(normalizedPatch, 'longitude'))
    && ((toNullableCoordinate(normalizedPatch.latitude) == null) !== (toNullableCoordinate(normalizedPatch.longitude) == null))
    && !errors.includes('latitude and longitude must be confirmed together')
  ) {
    errors.push('latitude and longitude must be confirmed together');
  }

  if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'amenities')) {
    const amenities = asArray(normalizedPatch.amenities).map((x) => cleanText(x)).filter(Boolean);
    setParts.push(`amenities = $${idx}::jsonb`);
    values.push(JSON.stringify(amenities));
    correctedFields.push('amenities');
    idx += 1;
  }

  const addExtraPatch = (bodyKey, extraKey = bodyKey) => {
    if (!Object.prototype.hasOwnProperty.call(normalizedPatch, bodyKey)) return;
    const value = cleanText(normalizedPatch[bodyKey]);
    extraPatch[extraKey] = value || null;
    correctedFields.push(extraKey);
  };
  addExtraPatch('region');
  addExtraPatch('city');
  addExtraPatch('neighborhood');
  addExtraPatch('street_name');
  addExtraPatch('location_name');
  addExtraPatch('location_confidence');
  addExtraPatch('geocoding_provider');
  addExtraPatch('place_id');
  addExtraPatch('map_pin_source');
  addExtraPatch('nearest_university');
  addExtraPatch('distance_to_uni_km');
  addExtraPatch('room_type');
  addExtraPatch('room_arrangement');
  addExtraPatch('gender_pref');
  addExtraPatch('student_room_label');

  if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'students_welcome')) {
    extraPatch.students_welcome = parseBooleanLike(normalizedPatch.students_welcome, false);
    correctedFields.push('students_welcome');
  }

  if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'lister_phone')) {
    const phone = cleanText(normalizeUgPhone(normalizedPatch.lister_phone));
    extraPatch.contact_phone = phone || null;
    extraPatch.public_contact_phone = phone || null;
  }

  if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'student_universities')) {
    extraPatch.student_universities = asArray(normalizedPatch.student_universities).map((item) => cleanText(item)).filter(Boolean);
    correctedFields.push('student_universities');
  }

  if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'land_title_available')) {
    const landTitleAvailable = normalizeLandTitleAvailability(normalizedPatch.land_title_available);
    extraPatch.land_title_available = landTitleAvailable || null;
    extraPatch.land_title_available_label = landTitleAvailabilityLabel(landTitleAvailable) || null;
    correctedFields.push('land_title_available');
  }

  if (errors.length) {
    const err = new Error('Validation failed');
    err.status = 400;
    err.details = errors;
    throw err;
  }

  if (!setParts.length && !Object.keys(extraPatch).length) return null;

  const latitude = toNullableCoordinate(normalizedPatch.latitude);
  const longitude = toNullableCoordinate(normalizedPatch.longitude);
  const hasExactCoordinates = latitude != null && longitude != null && isPointInUganda(latitude, longitude);
  const resolvedLocationLabel = [
    cleanText(normalizedPatch.street_name),
    cleanText(normalizedPatch.neighborhood) || cleanText(normalizedPatch.area),
    cleanText(normalizedPatch.city),
    cleanText(normalizedPatch.district)
  ].filter(Boolean).join(', ');
  setParts.push(`extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $${idx}::jsonb`);
  values.push(JSON.stringify({
    ...extraPatch,
    king_review_corrected_fields: Array.from(new Set(correctedFields)),
    king_review_corrected_at: new Date().toISOString(),
    king_review_facts_confirmed: true,
    king_review_public_listing_facts: {
      title: cleanText(normalizedPatch.title),
      listing_type: cleanText(normalizedPatch.listing_type),
      region: cleanText(normalizedPatch.region),
      district: cleanText(normalizedPatch.district),
      city: cleanText(normalizedPatch.city),
      neighborhood: cleanText(normalizedPatch.neighborhood),
      area: cleanText(normalizedPatch.area),
      address: cleanText(normalizedPatch.address),
      street_name: cleanText(normalizedPatch.street_name),
      property_type: cleanText(normalizedPatch.property_type),
      title_type: cleanText(normalizedPatch.title_type),
      land_title_available: extraPatch.land_title_available || null,
      land_title_available_label: extraPatch.land_title_available_label || null,
      lister_phone: cleanText(normalizeUgPhone(normalizedPatch.lister_phone)) || null,
      nearest_university: cleanText(normalizedPatch.nearest_university),
      distance_to_uni_km: toNullableFloat(normalizedPatch.distance_to_uni_km),
      room_type: cleanText(normalizedPatch.room_type),
      students_welcome: parseBooleanLike(normalizedPatch.students_welcome, false),
      room_arrangement: cleanText(normalizedPatch.room_arrangement),
      gender_pref: cleanText(normalizedPatch.gender_pref),
      student_universities: asArray(normalizedPatch.student_universities).map((item) => cleanText(item)).filter(Boolean),
      price: toNullableInt(normalizedPatch.price),
      price_period: cleanText(normalizedPatch.price_period),
      latitude,
      longitude
    },
    review_location_hierarchy: {
      region: cleanText(normalizedPatch.region),
      district: cleanText(normalizedPatch.district),
      city: cleanText(normalizedPatch.city),
      neighborhood: cleanText(normalizedPatch.neighborhood),
      area: cleanText(normalizedPatch.area),
      street_name: cleanText(normalizedPatch.street_name)
    },
    ...(resolvedLocationLabel ? { resolved_location_label: resolvedLocationLabel } : {}),
    ...(hasExactCoordinates ? {
      map_pin_confirmed: true,
      map_pin_source: cleanText(normalizedPatch.map_pin_source) || 'king_review',
      map_pin_confirmed_at: new Date().toISOString()
    } : {})
  }));
  idx += 1;

  setParts.push('updated_at = NOW()');

  const updated = await db.query(
    `UPDATE properties
     SET ${setParts.join(', ')}
     WHERE id = $1
     RETURNING id`,
    values
  );

  return updated.rows[0] || null;
}

router.get('/summary', async (req, res, next) => {
  try {
    const payload = await adminCachedPayload('admin-summary-v5-properties-list-count-fast', ADMIN_DASHBOARD_CACHE_TTL_MS, async () => {
      const [
        properties,
        agents,
        reports,
        requests,
        inquiries,
        users,
        engagement,
        engagement48h,
        topAreas48h,
        topListingTypes48h
      ] = await Promise.all([
        loadAdminPropertiesSummaryFast(),
        adminSummaryOne(
          `SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
            COUNT(*) FILTER (WHERE status = 'approved')::int AS approved
           FROM agents`,
          [],
          { total: 0, pending: 0, approved: 0 },
          { timeoutMs: 650 }
        ),
        adminSummaryOne(
          `SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'open')::int AS open
           FROM report_listings`,
          [],
          { total: 0, open: 0 },
          { timeoutMs: 650 }
        ),
        adminSummaryOne('SELECT COUNT(*)::int AS total FROM property_requests', [], { total: 0 }, { timeoutMs: 650 }),
        adminSummaryOne('SELECT COUNT(*)::int AS total FROM property_inquiries', [], { total: 0 }, { timeoutMs: 650 }),
        adminSummaryOne(
          `SELECT
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'active')::int AS active,
            COUNT(*) FILTER (WHERE status = 'suspended')::int AS suspended,
            COUNT(*) FILTER (WHERE phone_verified = TRUE)::int AS phone_verified,
            COUNT(*) FILTER (WHERE weekly_tips_opt_in = TRUE)::int AS weekly_tips_opt_in,
            COUNT(*) FILTER (WHERE marketing_opt_in = TRUE)::int AS marketing_opt_in,
            COUNT(*) FILTER (WHERE oauth_provider IS NOT NULL)::int AS social_linked
           FROM users`,
          [],
          { total: 0, active: 0, suspended: 0, phone_verified: 0, weekly_tips_opt_in: 0, marketing_opt_in: 0, social_linked: 0 },
          { timeoutMs: 650 }
        ),
        adminSummaryOne(
          `SELECT
            COUNT(*) FILTER (WHERE event_name IN ('property_open','property_view'))::int AS property_views,
            COUNT(*) FILTER (WHERE event_name IN ('property_save','property_saved','save_property'))::int AS property_saves,
            COUNT(*) FILTER (WHERE event_name IN ('broker_profile_open','broker_profile_view'))::int AS broker_profile_views,
            COUNT(*) FILTER (WHERE event_name IN ('property_inquiry_submit','property_inquiry'))::int AS property_inquiries,
            COUNT(*) FILTER (WHERE event_name IN ('property_directions_open','directions_open','route_time_view'))::int AS route_events
           FROM analytics_events`,
          [],
          { property_views: 0, property_saves: 0, broker_profile_views: 0, property_inquiries: 0, route_events: 0 },
          { timeoutMs: 650 }
        ),
        adminSummaryOne(
          `SELECT
            COUNT(*) FILTER (WHERE event_name IN ('property_open','property_view'))::int AS property_views,
            COUNT(DISTINCT client_id) FILTER (WHERE event_name IN ('property_open','property_view','page_view','property_search'))::int AS unique_visitors,
            COUNT(*) FILTER (WHERE event_name IN ('property_save','property_saved','save_property'))::int AS property_saves,
            COUNT(*) FILTER (WHERE event_name IN ('property_inquiry_submit','property_inquiry'))::int AS property_inquiries,
            COUNT(*) FILTER (WHERE event_name IN ('property_directions_open','directions_open','route_time_view'))::int AS route_events
           FROM analytics_events
           WHERE created_at >= NOW() - INTERVAL '2 days'`,
          [],
          { property_views: 0, unique_visitors: 0, property_saves: 0, property_inquiries: 0, route_events: 0 },
          { timeoutMs: 650 }
        ),
        adminSummaryRows(
          `SELECT
            COALESCE(NULLIF(payload->>'area', ''), NULLIF(payload->>'district', ''), 'Unknown area') AS area,
            COUNT(*)::int AS events
           FROM analytics_events
           WHERE created_at >= NOW() - INTERVAL '2 days'
             AND event_name IN ('property_open','property_view','property_search','near_me_search')
           GROUP BY 1
           ORDER BY events DESC, area ASC
           LIMIT 5`,
          [],
          { timeoutMs: 650 }
        ),
        adminSummaryRows(
          `SELECT
            COALESCE(NULLIF(payload->>'listing_type', ''), NULLIF(payload->>'tab', ''), 'unknown') AS listing_type,
            COUNT(*)::int AS events
           FROM analytics_events
           WHERE created_at >= NOW() - INTERVAL '2 days'
             AND event_name IN ('property_open','property_view','property_search','near_me_search')
           GROUP BY 1
           ORDER BY events DESC, listing_type ASC
           LIMIT 5`,
          [],
          { timeoutMs: 650 }
        )
      ]);

      return rememberAdminSummaryLastKnownGood({
      ok: true,
      data: {
        properties,
        agents,
        users,
        reports,
        propertyRequests: requests,
        inquiries,
        engagement,
        ai_insights: {
          last_48h: engagement48h,
          top_areas: topAreas48h,
          top_listing_types: topListingTypes48h
        }
      },
      meta: {
        cache: 'admin_summary_v5_properties_list_count_fast',
        cache_ttl_ms: ADMIN_DASHBOARD_CACHE_TTL_MS,
        public_count_marker: PUBLIC_INVENTORY_METRICS_MARKER,
        generated_at: new Date().toISOString(),
        partial: [properties, agents, reports, requests, inquiries, users, engagement, engagement48h].some((row) => row?._fallback_reason)
      }
      });
    });

    return res.json(rememberAdminSummaryLastKnownGood(payload));
  } catch (error) {
    logger.warn('Admin summary route returned fallback payload after producer failure', {
      reason: adminSummaryFallbackReason(error),
      code: error?.code,
      message: error?.message
    });
    try {
      return res.status(200).json(await buildAdminSummaryFallbackPayload(error));
    } catch (fallbackError) {
      return next(fallbackError);
    }
  }
});

router.get('/command-centre', async (_req, res, next) => {
  try {
    const payload = await adminCachedPayload('admin-command-centre-v4', ADMIN_DASHBOARD_CACHE_TTL_MS, async () => {
    const [
      pendingListings,
      liveListings,
      deletedListings,
      hiddenListings,
      brokerPending,
      brokerApproved,
      crmLeads,
      hotLeads,
      overdueTasks,
      whatsappNeedsHuman,
      failedEmails,
      failedWhatsapp,
      adOpenLeads,
      liveAds,
      paidRevenue,
      quotedPipeline,
      testListings,
      testUsers,
      propertyRequests
    ] = await Promise.all([
      adminActionableReviewQueueCount({ timeoutMs: 3000 }),
      safeCount(`SELECT COUNT(*)::int AS total FROM properties p WHERE ${adminPublicLiveListingFastWhere('p')}`),
      safeCount("SELECT COUNT(*)::int AS total FROM properties WHERE status = 'deleted'"),
      safeCount("SELECT COUNT(*)::int AS total FROM properties WHERE status = 'hidden'"),
      safeCount("SELECT COUNT(*)::int AS total FROM agents WHERE status = 'pending' OR COALESCE(registration_status, 'not_registered') <> 'registered'"),
      safeCount("SELECT COUNT(*)::int AS total FROM agents WHERE status = 'approved' AND COALESCE(registration_status, 'not_registered') = 'registered'"),
      safeCount(`${adminLeadUnionSql()} SELECT COUNT(*)::int AS total FROM all_leads WHERE lead_status = 'open'`),
      safeCount(`${adminLeadUnionSql()} SELECT COUNT(*)::int AS total FROM all_leads WHERE priority IN ('high','urgent') OR lead_score >= 50`),
      safeCount("SELECT COUNT(*)::int AS total FROM lead_tasks WHERE status = 'open' AND due_at < NOW()"),
      safeCount("SELECT COUNT(*)::int AS total FROM whatsapp_conversation_state WHERE status IN ('needs_human','escalated')"),
      safeCount("SELECT COUNT(*)::int AS total FROM email_logs WHERE status IN ('failed','provider_missing','bounced','error')"),
      safeCount("SELECT COUNT(*)::int AS total FROM whatsapp_message_logs WHERE status IN ('failed','provider_missing','error')"),
      safeCount("SELECT COUNT(*)::int AS total FROM advertising_inquiries WHERE status IN ('new','contacted','proposal_sent')"),
      safeCount("SELECT COUNT(*)::int AS total FROM advertising_campaigns WHERE status = 'live'"),
      safeOne("SELECT COALESCE(SUM(paid_amount_ugx), 0)::bigint AS total FROM advertising_campaigns WHERE payment_status = 'paid'", [], { total: 0 }).then((row) => Number(row.total || 0)),
      safeOne("SELECT COALESCE(SUM(quoted_amount_ugx), 0)::bigint AS total FROM advertising_campaigns WHERE status NOT IN ('cancelled')", [], { total: 0 }).then((row) => Number(row.total || 0)),
      safeCount(
        `SELECT COUNT(*)::int AS total
         FROM properties
         WHERE COALESCE(extra_fields->>'is_test', '') = 'true'
            OR COALESCE(extra_fields->>'launch_proof', '') = 'true'
            OR LOWER(COALESCE(title, '')) ~ '(qa|test|delete|dummy|sample|launch proof)'
            OR LOWER(COALESCE(lister_email, '')) LIKE '%makaug.invalid%'`
      ),
      safeCount(
        `SELECT COUNT(*)::int AS total
         FROM users
         WHERE LOWER(COALESCE(email, '')) LIKE '%makaug.invalid%'
            OR LOWER(CONCAT_WS(' ', first_name, last_name, email)) ~ '(qa|test|delete|dummy|sample)'`
      ),
      safeCount('SELECT COUNT(*)::int AS total FROM property_requests')
    ]);

    const decisions = [
      {
        key: 'listing_review',
        label: 'Listings waiting for approval',
        value: pendingListings,
        priority: pendingListings ? 'high' : 'clear',
        route: '/admin/moderation',
        tab: 'review',
        action: 'Approve, reject, hide, or request changes before anything goes live.'
      },
      {
        key: 'broker_review',
        label: 'Broker accounts needing review',
        value: brokerPending,
        priority: brokerPending ? 'high' : 'clear',
        route: '/admin/accounts',
        tab: 'accounts',
        action: 'Review ID, privacy consent, status, and send access only after approval.'
      },
      {
        key: 'lead_follow_up',
        label: 'Open CRM leads',
        value: crmLeads,
        priority: hotLeads || overdueTasks ? 'high' : crmLeads ? 'medium' : 'clear',
        route: '/admin/crm',
        tab: 'notifications',
        action: 'Follow hot and overdue leads first; assign owner action where needed.'
      },
      {
        key: 'whatsapp_handoff',
        label: 'WhatsApp needs human',
        value: whatsappNeedsHuman,
        priority: whatsappNeedsHuman ? 'high' : 'clear',
        route: '/admin/whatsapp-inbox',
        tab: 'whatsapp',
        action: 'Open escalated conversations, reply, resolve, or hand over to owner.'
      },
      {
        key: 'advertising_revenue',
        label: 'Advertising pipeline',
        value: adOpenLeads,
        priority: adOpenLeads ? 'medium' : 'clear',
        route: '/admin/advertising',
        tab: 'ads',
        action: 'Turn advertiser interest into campaign drafts, invoices, payments, and live placements.'
      },
      {
        key: 'communication_health',
        label: 'Failed communication logs',
        value: failedEmails + failedWhatsapp,
        priority: failedEmails + failedWhatsapp ? 'high' : 'clear',
        route: '/admin/notifications',
        tab: 'notifications',
        action: 'Check failed email and WhatsApp logs before launch traffic increases.'
      },
      {
        key: 'launch_cleanup',
        label: 'QA/test records hidden by clean mode',
        value: testListings + testUsers,
        priority: testListings + testUsers ? 'medium' : 'clear',
        route: '/admin/listings',
        tab: 'listings',
        action: 'Default view hides obvious test records; uncheck clean mode when you need to audit them.'
      }
    ];

    return {
      ok: true,
      data: {
        generated_at: new Date().toISOString(),
        metrics: {
          pending_listings: pendingListings,
          live_listings: liveListings,
          hidden_listings: hiddenListings,
          deleted_listings: deletedListings,
          broker_pending: brokerPending,
          broker_approved: brokerApproved,
          open_leads: crmLeads,
          hot_leads: hotLeads,
          overdue_tasks: overdueTasks,
          whatsapp_needs_human: whatsappNeedsHuman,
          failed_emails: failedEmails,
          failed_whatsapp: failedWhatsapp,
          advertising_open_leads: adOpenLeads,
          live_ads: liveAds,
          paid_revenue_ugx: paidRevenue,
          quoted_pipeline_ugx: quotedPipeline,
          test_records: testListings + testUsers,
          property_requests: propertyRequests
        },
        decisions
      },
      meta: {
        cache: 'admin_command_centre_v4',
        cache_ttl_ms: ADMIN_DASHBOARD_CACHE_TTL_MS
      }
    };
    });

    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get('/recent', async (req, res, next) => {
  try {
    const [recentProperties, recentAgents, recentReports, recentUsers, recentPropertyRequests] = await Promise.all([
      db.query(
        `SELECT id, title, listing_type, district, status, created_at
         FROM properties
         ORDER BY created_at DESC
         LIMIT 20`
      ),
      db.query(
        `SELECT id, full_name, company_name, licence_number, status, created_at
         FROM agents
         ORDER BY created_at DESC
         LIMIT 20`
      ),
      db.query(
        `SELECT id, property_reference, reason, status, created_at
         FROM report_listings
         ORDER BY created_at DESC
         LIMIT 20`
      ),
      db.query(
        `SELECT
          id,
          first_name,
          last_name,
          phone,
          email,
          role,
          status,
          phone_verified,
          marketing_opt_in,
          weekly_tips_opt_in,
          preferred_contact_channel,
          oauth_provider,
          last_login_at,
          created_at
         FROM users
         ORDER BY created_at DESC
         LIMIT 20`
      ),
      db.query(
        `SELECT
          id,
          full_name,
          phone,
          email,
          preferred_locations,
          listing_type,
          max_budget,
          requirements,
          created_at
         FROM property_requests
         ORDER BY created_at DESC
         LIMIT 20`
      )
    ]);

    return res.json({
      ok: true,
      data: {
        recentProperties: recentProperties.rows,
        recentAgents: recentAgents.rows,
        recentReports: recentReports.rows,
        recentUsers: recentUsers.rows,
        recentPropertyRequests: recentPropertyRequests.rows
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/properties/review-queue', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const includeTestLike = parseBooleanLike(req.query.include_test_like || req.query.includeTestLike, false);
    const includeTotal = parseBooleanLike(req.query.include_total || req.query.includeTotal, false);
    const includeImages = parseBooleanLike(req.query.include_images || req.query.includeImages, false);
    const queueType = cleanText(req.query.queue || req.query.queue_type || req.query.queueType).toLowerCase();
    const filters = [queueType === 'found_online'
      ? adminFoundOnlineReviewQueueWhere('p')
      : (includeTestLike ? adminActiveReviewQueueWhere('p') : adminActionableReviewQueueWhere('p'))];
    const values = [];
    const search = cleanText(req.query.search || req.query.q);
    const listingType = cleanText(req.query.listing_type || req.query.type).toLowerCase();

    if (listingType && LISTING_TYPES.includes(listingType)) {
      values.push(listingType);
      filters.push(`p.listing_type = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      const idx = values.length;
      filters.push(`(
        p.title ILIKE $${idx}
        OR p.area ILIKE $${idx}
        OR p.district ILIKE $${idx}
        OR COALESCE(p.inquiry_reference, '') ILIKE $${idx}
        OR COALESCE(p.lister_phone, '') ILIKE $${idx}
        OR COALESCE(p.extra_fields->>'source_name', '') ILIKE $${idx}
        OR COALESCE(p.extra_fields->>'source_platform', '') ILIKE $${idx}
      )`);
    }

    const where = `WHERE ${filters.join(' AND ')}`;
    const cacheKey = JSON.stringify({
      route: 'admin-review-queue-v6-indexed-status',
      page,
      limit,
      includeTestLike,
      includeTotal,
      includeImages,
      search,
      listingType,
      queueType
    });

    const payload = await adminCachedPayload(cacheKey, ADMIN_REVIEW_QUEUE_CACHE_TTL_MS, async () => {
      let exactTotal = null;
      let exactTotalAvailable = false;
      let countFallbackReason = '';
      if (includeTotal || search || listingType) {
        const countRow = await safeOne(
          `SELECT COUNT(*)::int AS total FROM properties p ${where}`,
          values,
          { total: 0 },
          { timeoutMs: 2000 }
        );
        exactTotal = Number(countRow.total || 0);
        countFallbackReason = countRow._fallback_reason || '';
        exactTotalAvailable = !countFallbackReason;
      }

      const imageSelect = includeImages ? 'img.url AS primary_image_url' : 'NULL::text AS primary_image_url';
      const imageJoin = includeImages
        ? `LEFT JOIN LATERAL (
           SELECT i.url
           FROM property_images i
           WHERE i.property_id = p.id
           ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC
           LIMIT 1
         ) img ON true`
        : '';
      const rowLimit = limit + 1;
      const rows = await adminTimedQuery(
          `SELECT
             p.id,
             p.title,
             p.listing_type,
             p.property_type,
             p.district,
             p.area,
             p.price,
             p.price_currency,
             p.price_original,
             p.price_fx_rate_ugx,
             p.price_fx_as_of,
             p.price_period,
             p.status,
             p.moderation_stage,
             p.moderation_notes,
             p.moderation_reason,
             p.inquiry_reference,
             p.source,
             p.listed_via,
             p.lister_type,
             p.agent_id,
             p.lister_name,
             p.lister_phone,
             p.lister_email,
             p.created_at,
             p.updated_at,
             p.extra_fields,
             CONCAT('/property/', p.id::text) AS property_url,
             ${imageSelect}
           FROM properties p
           ${imageJoin}
           ${where}
           ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC NULLS LAST, p.id DESC
           LIMIT $${values.length + 1}
           OFFSET $${values.length + 2}`,
        [...values, rowLimit, offset],
        ADMIN_REVIEW_QUEUE_QUERY_TIMEOUT_MS
      );
      const rawRows = rows.rows || [];

      const hasMore = rawRows.length > limit;
      const responseRows = rawRows.slice(0, limit);
      const inferredTotal = offset + responseRows.length + (hasMore ? 1 : 0);
      const total = exactTotalAvailable ? exactTotal : inferredTotal;
      const pagination = toPagination(total, page, limit);
      if (!exactTotalAvailable) pagination.totalPages = page + (hasMore ? 1 : 0);

      return {
        ok: true,
        data: responseRows,
        pagination,
        meta: {
          status: 'review_queue',
          cache: 'admin_review_queue_v6_indexed_status',
          cache_ttl_ms: ADMIN_REVIEW_QUEUE_CACHE_TTL_MS,
          include_test_like: includeTestLike,
          include_total: includeTotal,
          include_images: includeImages,
          queue_type: queueType || 'all',
          has_more: hasMore,
          total_exact: exactTotalAvailable,
          partial_total: !exactTotalAvailable,
          count_fallback_reason: countFallbackReason,
          row_fallback_reason: '',
          count_filter: queueType === 'found_online'
            ? 'admin_found_online_review_queue'
            : (includeTestLike ? 'admin_active_review_queue' : 'admin_actionable_review_queue'),
          source_quality_filter: 'stored_suppression_flag_only',
          pending_statuses: ADMIN_PENDING_REVIEW_STATUSES,
          final_statuses_excluded: ADMIN_FINAL_REVIEW_STATUSES
        }
      };
    });

    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get('/properties/actioned', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const includeTestLike = parseBooleanLike(req.query.include_test_like || req.query.includeTestLike, false);
    const includeTotal = parseBooleanLike(req.query.include_total || req.query.includeTotal, false);
    const includeImages = parseBooleanLike(req.query.include_images || req.query.includeImages, false);
    const finalStatuses = adminSqlList(ADMIN_FINAL_REVIEW_STATUSES);
    const filters = [`(
      LOWER(COALESCE(p.status, '')) IN (${finalStatuses})
      OR LOWER(COALESCE(p.moderation_stage, '')) IN (${finalStatuses})
    )`];
    const values = [];
    const search = cleanText(req.query.search || req.query.q);
    const listingType = cleanText(req.query.listing_type || req.query.type).toLowerCase();

    if (!includeTestLike) filters.push(`NOT ${adminLaunchTestListingFastCondition('p')}`);
    if (listingType && LISTING_TYPES.includes(listingType)) {
      values.push(listingType);
      filters.push(`p.listing_type = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      const idx = values.length;
      filters.push(`(
        p.title ILIKE $${idx}
        OR p.area ILIKE $${idx}
        OR p.district ILIKE $${idx}
        OR COALESCE(p.inquiry_reference, '') ILIKE $${idx}
        OR COALESCE(p.lister_phone, '') ILIKE $${idx}
        OR COALESCE(p.extra_fields->>'source_name', '') ILIKE $${idx}
        OR COALESCE(p.extra_fields->>'source_platform', '') ILIKE $${idx}
      )`);
    }

    const where = `WHERE ${filters.join(' AND ')}`;
    const cacheKey = JSON.stringify({
      route: 'admin-actioned-v1',
      page,
      limit,
      includeTestLike,
      includeTotal,
      includeImages,
      search,
      listingType
    });

    const payload = await adminCachedPayload(cacheKey, ADMIN_REVIEW_QUEUE_CACHE_TTL_MS, async () => {
      let exactTotal = null;
      let exactTotalAvailable = false;
      let countFallbackReason = '';
      if (includeTotal || search || listingType) {
        const countRow = await safeOne(
          `SELECT COUNT(*)::int AS total FROM properties p ${where}`,
          values,
          { total: 0 },
          { timeoutMs: 2000 }
        );
        exactTotal = Number(countRow.total || 0);
        countFallbackReason = countRow._fallback_reason || '';
        exactTotalAvailable = !countFallbackReason;
      }

      const imageSelect = includeImages ? 'img.url AS primary_image_url' : 'NULL::text AS primary_image_url';
      const imageJoin = includeImages
        ? `LEFT JOIN LATERAL (
           SELECT i.url
           FROM property_images i
           WHERE i.property_id = p.id
           ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC
           LIMIT 1
         ) img ON true`
        : '';
      const rowLimit = limit + 1;
      let rowFallbackReason = '';
      let rawRows = [];
      try {
        const rows = await adminTimedQuery(
          `SELECT
             p.id,
             p.title,
             p.listing_type,
             p.property_type,
             p.district,
             p.area,
             p.price,
             p.price_currency,
             p.price_original,
             p.price_fx_rate_ugx,
             p.price_fx_as_of,
             p.price_period,
             p.status,
             p.moderation_stage,
             p.moderation_notes,
             p.moderation_reason,
             p.inquiry_reference,
             p.source,
             p.listed_via,
             p.lister_type,
             p.agent_id,
             p.lister_name,
             p.lister_phone,
             p.lister_email,
             p.created_at,
             p.updated_at,
             p.reviewed_at,
             p.approved_at,
             p.extra_fields,
             CONCAT('/property/', p.id::text) AS property_url,
             ${imageSelect}
           FROM properties p
           ${imageJoin}
           ${where}
           ORDER BY COALESCE(p.reviewed_at, p.approved_at, p.updated_at, p.created_at) DESC NULLS LAST, p.id DESC
           LIMIT $${values.length + 1}
           OFFSET $${values.length + 2}`,
          [...values, rowLimit, offset],
          9000
        );
        rawRows = rows.rows || [];
      } catch (error) {
        rowFallbackReason = adminSafeQueryFallbackReason(error);
        if (!rowFallbackReason) throw error;
      }

      const hasMore = rawRows.length > limit;
      const responseRows = rawRows.slice(0, limit);
      const inferredTotal = offset + responseRows.length + (hasMore ? 1 : 0);
      const total = exactTotalAvailable ? exactTotal : inferredTotal;
      const pagination = toPagination(total, page, limit);
      if (!exactTotalAvailable) pagination.totalPages = page + (hasMore ? 1 : 0);

      return {
        ok: true,
        data: responseRows,
        pagination,
        meta: {
          status: 'actioned',
          cache: 'admin_actioned_v1',
          cache_ttl_ms: ADMIN_REVIEW_QUEUE_CACHE_TTL_MS,
          include_test_like: includeTestLike,
          include_total: includeTotal,
          include_images: includeImages,
          has_more: hasMore,
          total_exact: exactTotalAvailable,
          partial_total: !exactTotalAvailable,
          count_fallback_reason: countFallbackReason,
          row_fallback_reason: rowFallbackReason,
          final_statuses_included: ADMIN_FINAL_REVIEW_STATUSES
        }
      };
    });

    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

router.get('/properties/live', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const values = [limit, offset];
    const includeTestLike = parseBooleanLike(req.query.include_test_like || req.query.includeTestLike, false);
    const publicLiveCondition = includeTestLike ? publicLivePropertyStatusSql('p') : adminPublicLiveListingWhere('p');
    const featuredCondition = adminFeaturedListingCondition('p');

    const countResult = await db.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE ${featuredCondition})::int AS featured_total
       FROM properties p
       WHERE ${publicLiveCondition}`
    );
    const total = countResult.rows[0]?.total || 0;
    const parityResult = await db.query(
      `SELECT
        COUNT(*) FILTER (WHERE ${adminPublicLiveListingWhere('p')})::int AS public_visible_total,
        COUNT(*) FILTER (WHERE ${adminPublicLiveListingWhere('p')} AND ${adminFeaturedListingCondition('p')})::int AS featured_total
       FROM properties p`
    );
    const publicInventory = {
      public_visible_total: Number(parityResult.rows[0]?.public_visible_total || 0),
      featured_total: Number(parityResult.rows[0]?.featured_total || 0)
    };
    const rows = await db.query(
      `SELECT
        p.id,
        p.title,
        p.listing_type,
        p.district,
        p.area,
        p.price,
        p.price_period,
        p.status,
        p.sold_at,
        p.inquiry_reference,
        p.lister_name,
        p.lister_phone,
        p.lister_email,
        p.created_at,
        p.updated_at,
        p.reviewed_at,
        p.approved_at,
        p.last_moderation_notification_at,
        p.extra_fields,
        CONCAT('/property/', p.id::text) AS property_url,
        TRUE AS public_visible,
        (COALESCE(p.extra_fields->>'featured', 'false') IN ('true', '1', 'yes')) AS featured,
        p.extra_fields->>'featured_at' AS featured_at,
        COALESCE(p.approved_at, p.reviewed_at, p.updated_at, p.created_at) AS live_at,
        COALESCE(p.approved_at, p.reviewed_at, p.updated_at, p.created_at) + INTERVAL '14 days' AS follow_up_due_at,
        (NOW() >= COALESCE(p.approved_at, p.reviewed_at, p.updated_at, p.created_at) + INTERVAL '14 days') AS follow_up_due,
        img.url AS primary_image_url
       FROM properties p
       LEFT JOIN LATERAL (
         SELECT i.url
         FROM property_images i
         WHERE i.property_id = p.id
         ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC
         LIMIT 1
       ) img ON true
       WHERE ${publicLiveCondition}
       ORDER BY live_at DESC
       LIMIT $1
       OFFSET $2`,
      values
    );

    return res.json({
      ok: true,
      data: rows.rows,
      pagination: toPagination(total, page, limit),
      summary: {
        public_inventory: {
          ...publicInventory,
          page_rows: rows.rows.length,
          total_rows: total
        }
      },
      meta: {
        status: 'live',
        include_test_like: includeTestLike,
        public_parity: {
          ...publicInventory,
          page_rows: rows.rows.length,
          total_rows: total,
          same_as_public_api: !includeTestLike && total === publicInventory.public_visible_total,
          public_api_endpoint: '/api/properties?status=approved&public_only=1',
          featured_api_endpoint: '/api/properties?status=approved&featured=true&public_only=1&sort=featured'
        }
      }    });
  } catch (error) {
    return next(error);
  }
});

router.post('/sourced-inventory-candidates/seed', async (req, res, next) => {
  try {
    await writeAudit('admin_generic_candidate_seed_rejected', {
      source: SOURCED_INVENTORY_CANDIDATE_SOURCE,
      reason: 'generic_candidates_retired_found_online_only'
    }, adminActorId(req));
    return res.status(410).json({
      ok: false,
      error: 'Generic placeholder candidates are retired. Use found-online source posts/imports only.'
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/bakaima-authorised-land-listings/seed', async (req, res, next) => {
  try {
    const replace = req.body?.replace !== false;
    const result = await seedBakaimaAuthorisedListings({
      db,
      replace
    });
    await writeAudit('admin_bakaima_authorised_land_listings_seeded', {
      source: SOURCED_INVENTORY_CANDIDATE_SOURCE,
      batch_id: BAKAIMA_BATCH_ID,
      replace,
      created_properties: result.created_properties,
      contact: result.contact
    }, adminActorId(req));
    return res.json({ ok: true, data: result });
  } catch (error) {
    return next(error);
  }
});

router.post('/carnelian-authorised-listings/seed', async (req, res, next) => {
  try {
    const replace = req.body?.replace !== false;
    const result = await seedCarnelianAuthorisedListings({
      db,
      replace
    });
    await writeAudit('admin_carnelian_authorised_listings_seeded', {
      source: SOURCED_INVENTORY_CANDIDATE_SOURCE,
      batch_id: CARNELIAN_BATCH_ID,
      replace,
      created_properties: result.created_properties,
      agent: result.agent
    }, adminActorId(req));
    return res.json({ ok: true, data: result });
  } catch (error) {
    return next(error);
  }
});

router.post('/social-search-authorised-listings/seed', async (req, res, next) => {
  try {
    const replace = req.body?.replace !== false;
    const result = await seedSocialSearchAuthorisedListings({
      db,
      replace
    });
    await writeAudit('admin_social_search_authorised_listings_seeded', {
      source: SOURCED_INVENTORY_CANDIDATE_SOURCE,
      batch_id: SOCIAL_SEARCH_BATCH_ID,
      replace,
      created_properties: result.created_properties,
      existing_properties: result.existing_properties,
      review_queue_properties: result.review_queue_properties,
      already_live_or_approved_properties: result.already_live_or_approved_properties?.length || 0,
      source_review_count: result.source_review_count || 0,
      daily_target_status: result.daily_target_status,
      agents: result.agents
    }, adminActorId(req));
    return res.json({ ok: true, data: result });
  } catch (error) {
    return next(error);
  }
});

router.post('/found-online-source-posts/import', async (req, res, next) => {
  try {
    const posts = Array.isArray(req.body?.posts)
      ? req.body.posts
      : (Array.isArray(req.body) ? req.body : []);
    const dryRun = req.body?.dry_run === true || req.body?.dryRun === true;
    const result = await queueFoundOnlineSourcePostListings({
      db,
      posts,
      dryRun,
      createProfilesForRepeatedSourcesOnly: false
    });
    await writeAudit('admin_found_online_source_posts_imported', {
      source: SOURCED_INVENTORY_CANDIDATE_SOURCE,
      batch_id: FOUND_ONLINE_SOURCE_POST_IMPORT_BATCH_ID,
      dry_run: dryRun,
      received_posts: result.received_posts,
      normalized_posts: result.normalized_posts,
      eligible_to_queue_count: result.eligible_to_queue_count,
      created_properties: result.created_properties,
      existing_properties: result.existing_properties,
      review_queue_properties: result.review_queue_properties,
      source_review_count: result.source_review_count,
      daily_target_status: result.daily_target_status
    }, adminActorId(req));
    return res.json({ ok: true, data: result });
  } catch (error) {
    return next(error);
  }
});

router.post('/social-platform-posts/sweep', async (req, res, next) => {
  try {
    const platform = req.body?.platform || 'all';
    const dryRun = req.body?.dry_run === true || req.body?.dryRun === true;
    const maxSources = Math.min(60, Math.max(1, parseInt(req.body?.max_sources || req.body?.maxSources || 50, 10) || 50));
    const sourceOffset = req.body?.source_offset || req.body?.sourceOffset || 0;
    const maxResultsPerSource = Math.min(25, Math.max(1, parseInt(req.body?.max_results || req.body?.maxResults || 25, 10) || 25));
    const maxPagesPerSource = 1;
    const youtubeJobMode = req.body?.youtube_job_mode || req.body?.youtubeJobMode || 'all';
    const searchMode = req.body?.x_search_mode || req.body?.xSearchMode || 'all';
    const lookbackDays = req.body?.lookback_days || req.body?.lookbackDays || 0;
    const publishedAfter = req.body?.published_after || req.body?.publishedAfter || '2026-01-01T00:00:00.000Z';
    const xPublishedAfter = req.body?.x_published_after || req.body?.xPublishedAfter || publishedAfter;
    const focus = req.body?.focus || req.body?.sweep_focus || req.body?.sweepFocus || '';
    const result = await runSocialPlatformPostSweep({
      db,
      platform,
      focus,
      dryRun,
      maxSources,
      sourceOffset,
      maxResultsPerSource,
      maxPagesPerSource,
      youtubeJobMode,
      searchMode,
      lookbackDays,
      xPublishedAfter,
      publishedAfter,
      timeBudgetMs: 45000
    });
    await writeAudit('admin_social_platform_posts_sweep', {
      source: SOURCED_INVENTORY_CANDIDATE_SOURCE,
      batch_id: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
      platform,
      focus,
      dry_run: dryRun,
      published_after: publishedAfter,
      x_published_after: xPublishedAfter,
      tiktok_capture_task_count: result.tiktok?.capture_task_count || 0,
      facebook_capture_task_count: result.facebook?.capture_task_count || 0,
      instagram_capture_task_count: result.instagram?.capture_task_count || 0,
      youtube_search_job_count: result.youtube?.search_job_count || 0,
      youtube_api_configured: result.youtube?.api_configured === true,
      youtube_live_ready_count: result.youtube?.confidence_summary?.live_ready_count || 0,
      youtube_direct_phone_count: result.youtube?.confidence_summary?.direct_phone_count || 0,
      x_search_job_count: result.x?.search_job_count || 0,
      x_api_configured: result.x?.api_configured === true,
      discovered_posts_count: result.discovered_posts_count || 0,
      created_properties: result.import_result?.created_properties || 0,
      existing_properties: result.import_result?.existing_properties || 0,
      review_queue_properties: result.import_result?.review_queue_properties || 0,
      elapsed_ms: result.performance?.elapsed_ms || 0,
      time_budget_ms: result.performance?.time_budget_ms || 0,
      partial_results: result.partial_results === true || result.performance?.partial_results === true,
      time_budget_exhausted: result.time_budget_exhausted === true || result.performance?.time_budget_exhausted === true,
    }, adminActorId(req));
    return res.json({ ok: true, data: result });
  } catch (error) {
    return next(error);
  }
});

router.get('/x-source-drip', async (_req, res, next) => {
  try {
    const result = await getXSourceDripStatus(db);
    return res.json({ ok: true, data: result });
  } catch (error) {
    return next(error);
  }
});

router.patch('/x-source-drip', async (req, res, next) => {
  try {
    const state = await updateXSourceDripConfig(db, req.body || {});
    await writeAudit('admin_x_source_drip_configured', {
      state: {
        enabled: state.enabled,
        cursor_offset: state.cursor_offset,
        source_count: state.source_count,
        base_interval_minutes: state.base_interval_minutes,
        batch_size: state.batch_size,
        max_results: state.max_results,
        search_mode: state.search_mode,
        published_after: state.published_after,
        target_reviewable: state.target_reviewable,
        monthly_read_cap: state.monthly_read_cap,
        monthly_read_count: state.monthly_read_count
      }
    }, adminActorId(req));
    return res.json({ ok: true, data: await getXSourceDripStatus(db) });
  } catch (error) {
    return next(error);
  }
});

router.get('/featured-rotation', async (_req, res, next) => {
  try {
    return res.json({
      ok: true,
      data: await loadFeaturedRotationStatus(db)
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/featured-rotation/run-once', async (req, res, next) => {
  try {
    const actorId = adminActorId(req);
    const result = await runFeaturedRotation(db, {
      force: true,
      actorId
    });
    await writeAudit('admin_featured_rotation_run_once', {
      marker: FEATURED_ROTATION_MARKER,
      status: result.status || result.reason || '',
      changed: result.changed === true,
      selected_count: Number(result.selected_count || 0),
      selected_ids: result.selected_ids || [],
      missing: result.missing || [],
      rejection_summary: result.rejection_summary || {}
    }, actorId);
    return res.status(result.ok === false ? 409 : 200).json({ ok: result.ok !== false, data: result });
  } catch (error) {
    return next(error);
  }
});

router.post('/x-source-drip/start', async (req, res, next) => {
  try {
    const state = await startXSourceDrip(db, req.body || {});
    await writeAudit('admin_x_source_drip_started', {
      cursor_offset: state.cursor_offset,
      source_count: state.source_count,
      interval_minutes: state.base_interval_minutes,
      batch_size: state.batch_size,
      max_results: state.max_results,
      published_after: state.published_after,
      monthly_read_cap: state.monthly_read_cap,
      monthly_read_count: state.monthly_read_count
    }, adminActorId(req));
    return res.json({ ok: true, data: await getXSourceDripStatus(db) });
  } catch (error) {
    return next(error);
  }
});

router.post('/x-source-drip/pause', async (req, res, next) => {
  try {
    const reason = cleanText(req.body?.reason || 'paused_by_admin');
    const state = await pauseXSourceDrip(db, reason);
    await writeAudit('admin_x_source_drip_paused', {
      reason: state.pause_reason,
      cursor_offset: state.cursor_offset
    }, adminActorId(req));
    return res.json({ ok: true, data: await getXSourceDripStatus(db) });
  } catch (error) {
    return next(error);
  }
});

router.post('/x-source-drip/run-once', async (req, res, next) => {
  try {
    const result = await runXSourceDripOnce(db, {
      force: req.body?.force !== false,
      actorId: adminActorId(req)
    });
    await writeAudit('admin_x_source_drip_run_once', {
      ok: result.ok === true,
      skipped: result.skipped === true,
      reason: result.reason || result.error || '',
      result: result.result || null
    }, adminActorId(req));
    return res.status(result.ok === false ? 500 : 200).json({ ok: result.ok !== false, data: result });
  } catch (error) {
    return next(error);
  }
});

router.get('/youtube-source-drip', async (_req, res, next) => {
  try {
    const result = await getYouTubeSourceDripStatus(db);
    return res.json({ ok: true, data: result });
  } catch (error) {
    return next(error);
  }
});

router.patch('/youtube-source-drip', async (req, res, next) => {
  try {
    const state = await updateYouTubeSourceDripConfig(db, req.body || {});
    await writeAudit('admin_youtube_source_drip_configured', {
      state: {
        enabled: state.enabled,
        cursor_offset: state.cursor_offset,
        source_count: state.source_count,
        base_interval_minutes: state.base_interval_minutes,
        batch_size: state.batch_size,
        max_results: state.max_results,
        job_mode: state.job_mode,
        published_after: state.published_after,
        target_reviewable: state.target_reviewable,
        monthly_read_cap: state.monthly_read_cap,
        monthly_read_count: state.monthly_read_count
      }
    }, adminActorId(req));
    return res.json({ ok: true, data: await getYouTubeSourceDripStatus(db) });
  } catch (error) {
    return next(error);
  }
});

router.post('/youtube-source-drip/start', async (req, res, next) => {
  try {
    const state = await startYouTubeSourceDrip(db, req.body || {});
    await writeAudit('admin_youtube_source_drip_started', {
      cursor_offset: state.cursor_offset,
      source_count: state.source_count,
      interval_minutes: state.base_interval_minutes,
      batch_size: state.batch_size,
      max_results: state.max_results,
      job_mode: state.job_mode,
      published_after: state.published_after,
      monthly_read_cap: state.monthly_read_cap,
      monthly_read_count: state.monthly_read_count
    }, adminActorId(req));
    return res.json({ ok: true, data: await getYouTubeSourceDripStatus(db) });
  } catch (error) {
    return next(error);
  }
});

router.post('/youtube-source-drip/pause', async (req, res, next) => {
  try {
    const reason = cleanText(req.body?.reason || 'paused_by_admin');
    const state = await pauseYouTubeSourceDrip(db, reason);
    await writeAudit('admin_youtube_source_drip_paused', {
      reason: state.pause_reason,
      cursor_offset: state.cursor_offset
    }, adminActorId(req));
    return res.json({ ok: true, data: await getYouTubeSourceDripStatus(db) });
  } catch (error) {
    return next(error);
  }
});

router.post('/youtube-source-drip/run-once', async (req, res, next) => {
  try {
    const result = await runYouTubeSourceDripOnce(db, {
      force: req.body?.force !== false,
      actorId: adminActorId(req)
    });
    await writeAudit('admin_youtube_source_drip_run_once', {
      ok: result.ok === true,
      skipped: result.skipped === true,
      reason: result.reason || result.error || '',
      result: result.result || null
    }, adminActorId(req));
    return res.status(result.ok === false ? 500 : 200).json({ ok: result.ok !== false, data: result });
  } catch (error) {
    return next(error);
  }
});

router.get('/marketplace-drip', async (_req, res, next) => {
  try {
    return res.json({ ok: true, data: await getMarketplaceDripStatus(db) });
  } catch (error) {
    return next(error);
  }
});

router.post('/marketplace-drip/seed-registry', async (req, res, next) => {
  try {
    const result = await seedMarketplaceSourceRegistry(db);
    await writeAudit('admin_marketplace_drip_registry_seeded', result, adminActorId(req));
    return res.json({ ok: true, data: { result, status: await getMarketplaceDripStatus(db) } });
  } catch (error) {
    return next(error);
  }
});

router.post('/marketplace-drip/import-source-candidates', async (req, res, next) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ ok: false, error: 'rows[] is required.' });
    const result = await importMarketplaceSourceCandidates(db, rows, { actorId: adminActorId(req) });
    await writeAudit('admin_marketplace_source_candidates_imported', result, adminActorId(req));
    return res.json({ ok: true, data: result });
  } catch (error) {
    return next(error);
  }
});

router.post('/marketplace-drip/relevance-audit', async (req, res, next) => {
  try {
    const dryRun = req.body?.dry_run !== false;
    const result = await auditMarketplaceRelevance(db, {
      dryRun,
      actorId: adminActorId(req)
    });
    await writeAudit(dryRun ? 'admin_marketplace_relevance_dry_run' : 'admin_marketplace_relevance_purge', {
      marker: result.marker,
      scanned: result.scanned,
      clean: result.clean,
      hidden: result.hidden,
      queued_review: result.queued_review,
      reasons: result.reasons
    }, adminActorId(req));
    return res.json({ ok: true, data: result });
  } catch (error) {
    return next(error);
  }
});

router.patch('/marketplace-drip', async (req, res, next) => {
  try {
    const state = await updateMarketplaceDripConfig(db, req.body || {});
    await writeAudit('admin_marketplace_drip_configured', {
      cursor_offset: state.cursor_offset,
      interval_minutes: state.base_interval_minutes,
      batch_size: state.batch_size,
      monthly_request_cap: state.monthly_request_cap,
      target_businesses: state.target_businesses
    }, adminActorId(req));
    return res.json({ ok: true, data: await getMarketplaceDripStatus(db) });
  } catch (error) {
    return next(error);
  }
});

router.post('/marketplace-drip/start', async (req, res, next) => {
  try {
    const state = await startMarketplaceDrip(db, req.body || {});
    await writeAudit('admin_marketplace_drip_started', {
      cursor_offset: state.cursor_offset,
      interval_minutes: state.base_interval_minutes,
      batch_size: state.batch_size,
      monthly_request_cap: state.monthly_request_cap
    }, adminActorId(req));
    return res.json({ ok: true, data: await getMarketplaceDripStatus(db) });
  } catch (error) {
    return next(error);
  }
});

router.post('/marketplace-drip/pause', async (req, res, next) => {
  try {
    const state = await pauseMarketplaceDrip(db, cleanText(req.body?.reason || 'paused_by_admin'));
    await writeAudit('admin_marketplace_drip_paused', {
      reason: state.pause_reason,
      cursor_offset: state.cursor_offset
    }, adminActorId(req));
    return res.json({ ok: true, data: await getMarketplaceDripStatus(db) });
  } catch (error) {
    return next(error);
  }
});

router.post('/marketplace-drip/run-once', async (req, res, next) => {
  try {
    const result = await runMarketplaceDripOnce(db, {
      force: req.body?.force !== false,
      actorId: adminActorId(req)
    });
    await writeAudit('admin_marketplace_drip_run_once', {
      ok: result.ok === true,
      skipped: result.skipped === true,
      reason: result.reason || result.error || '',
      result: result.result || null
    }, adminActorId(req));
    return res.status(result.ok === false ? 500 : 200).json({ ok: result.ok !== false, data: result });
  } catch (error) {
    return next(error);
  }
});

router.post('/tiktok-source-posts/import', async (req, res, next) => {
  try {
    const posts = Array.isArray(req.body?.posts)
      ? req.body.posts
      : (Array.isArray(req.body) ? req.body : []);
    const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
    const rawText = req.body?.raw_text || req.body?.rawText || req.body?.text || '';
    const dryRun = req.body?.dry_run === true || req.body?.dryRun === true;
    const fetchOembed = req.body?.fetch_oembed !== false && req.body?.fetchOembed !== false;
    const result = await importTikTokExactVideoPosts({
      db,
      posts,
      urls,
      rawText,
      dryRun,
      fetchOembed
    });
    await writeAudit('admin_tiktok_exact_posts_imported', {
      source: SOURCED_INVENTORY_CANDIDATE_SOURCE,
      batch_id: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
      dry_run: dryRun,
      exact_video_url_count: result.exact_video_url_count,
      oembed_fetch_count: result.oembed_fetch_count,
      created_properties: result.created_properties,
      existing_properties: result.existing_properties,
      review_queue_properties: result.review_queue_properties,
      source_review_count: result.source_review_count,
    }, adminActorId(req));
    return res.json({ ok: true, data: result });
  } catch (error) {
    return next(error);
  }
});

router.post('/tiktok-autopublish-agent/run', async (req, res, next) => {
  try {
    const dryRun = req.body?.dry_run !== false && req.body?.dryRun !== false;
    const confirmLive = req.body?.confirm_live === true || req.body?.confirmLive === true;
    const posts = Array.isArray(req.body?.posts)
      ? req.body.posts
      : (Array.isArray(req.body) ? req.body : []);
    const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
    const hashtagSequence = Array.isArray(req.body?.hashtag_sequence)
      ? req.body.hashtag_sequence
      : (Array.isArray(req.body?.hashtagSequence) ? req.body.hashtagSequence : undefined);
    const result = await runTikTokAutopublishAgent({
      db,
      hashtag: req.body?.hashtag || req.body?.tag || 'ugandarealestate',
      hashtagSequence,
      policyMode: req.body?.policy_mode || req.body?.policyMode || 'strict',
      liveLimit: req.body?.live_limit || req.body?.liveLimit || 5,
      reviewLimit: req.body?.review_limit || req.body?.reviewLimit || 100,
      scanLimit: req.body?.scan_limit || req.body?.scanLimit || 250,
      dryRun,
      confirmLive,
      posts,
      urls,
      rawText: req.body?.raw_text || req.body?.rawText || req.body?.text || '',
      fetchOembed: req.body?.fetch_oembed !== false && req.body?.fetchOembed !== false
    });
    await writeAudit('admin_tiktok_autopublish_agent_run', {
      batch_id: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
      dry_run: dryRun,
      confirm_live: confirmLive,
      hashtag: result.hashtag,
      review_queue_before: result.review_queue_before,
      review_queue_after: result.review_queue_after,
      scanned_candidates: result.scanned_candidates,
      published_live_count: result.published_live_count,
      ready_review_count: result.ready_review_count,
      blocked_count: result.blocked_count,
      not_100_percent_reason: result.not_100_percent_reason || ''
    }, adminActorId(req));
    return res.status(result.ok === false ? 400 : 200).json({ ok: result.ok !== false, data: result });
  } catch (error) {
    return next(error);
  }
});

router.post('/exact-social-source-posts/import', async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    const posts = Array.isArray(req.body?.posts)
      ? req.body.posts
      : (Array.isArray(req.body) ? req.body : []);
    const urls = Array.isArray(req.body?.urls) ? req.body.urls : [];
    const rawText = req.body?.raw_text || req.body?.rawText || req.body?.text || '';
    const dryRun = req.body?.dry_run === true || req.body?.dryRun === true;
    const fetchOembed = req.body?.fetch_oembed !== false && req.body?.fetchOembed !== false;
    const fetchPublicMetadata = req.body?.fetch_public_metadata !== false && req.body?.fetchPublicMetadata !== false;
    const result = await importExactSocialSourcePosts({
      db,
      posts,
      urls,
      rawText,
      dryRun,
      fetchOembed,
      fetchPublicMetadata
    });
    if (!dryRun && (
      Number(result.created_properties || 0) > 0
      || Number(result.existing_properties || 0) > 0
    )) {
      clearAdminReviewQueueCache();
    }
    await writeAudit('admin_exact_social_source_posts_imported', {
      source: SOURCED_INVENTORY_CANDIDATE_SOURCE,
      batch_id: SOCIAL_PLATFORM_POST_DISCOVERY_BATCH_ID,
      dry_run: dryRun,
      exact_social_url_count: result.exact_social_url_count,
      metadata_fetch_count: result.metadata_fetch_count,
      created_properties: result.created_properties,
      existing_properties: result.existing_properties,
      review_queue_properties: result.review_queue_properties,
      source_review_count: result.source_review_count,
    }, adminActorId(req));
    return res.json({ ok: true, data: result });
  } catch (error) {
    const missingQueueSchema = error?.code === '42703' && /transaction_type/i.test(String(error?.message || ''));
    const persistenceFailure = missingQueueSchema
      || error?.code === 'FOUND_ONLINE_PERSISTENCE_CHECK_FAILED'
      || error?.code === 'FOUND_ONLINE_QUEUE_EMPTY';
    if (persistenceFailure) {
      return res.status(503).json({
        ok: false,
        error: missingQueueSchema
          ? 'Found Online queue storage is not ready. Apply database migration 079_commercial_transaction_subtype.sql, then retry.'
          : 'Found Online rows were not persisted. Nothing was queued; retry after the storage check is repaired.',
        code: error.code || 'FOUND_ONLINE_QUEUE_UNAVAILABLE'
      });
    }
    return next(error);
  }
});

router.post('/property-source-registry/seed', async (req, res, next) => {
  try {
    const result = await seedPropertySourceRegistry({ db });
    await writeAudit('admin_property_source_registry_seeded', {
      source: SOURCED_INVENTORY_CANDIDATE_SOURCE,
      batch_id: PROPERTY_SOURCE_REGISTRY_BATCH_ID,
      upserted_sources: result.upserted_sources,
      pruned_stale_sources: result.pruned_stale_sources,
      by_platform: result.by_platform
    }, adminActorId(req));
    return res.json({
      ok: true,
      data: {
        ...result,
        summary: summarizePropertySourceRegistry()
      }
    });
  } catch (error) {
    return next(error);
  }
});

function publicPropertySourceRegistrySeedJob(job = propertySourceRegistrySeedJob) {
  if (!job) {
    return {
      exists: false,
      status: 'idle',
      marker: 'source-registry-async-seed-20260715',
    };
  }
  return {
    exists: true,
    id: job.id,
    status: job.status,
    marker: 'source-registry-async-seed-20260715',
    started_at: job.started_at,
    finished_at: job.finished_at || null,
    elapsed_ms: job.finished_at
      ? new Date(job.finished_at).getTime() - new Date(job.started_at).getTime()
      : Date.now() - new Date(job.started_at).getTime(),
    phase: job.phase || '',
    upserted_sources: job.upserted_sources || 0,
    total_sources: job.total_sources || 0,
    batch_size: job.batch_size || 0,
    result: job.result || null,
    error: job.error || null,
  };
}

function startPropertySourceRegistrySeedJob(req) {
  if (propertySourceRegistrySeedJob?.status === 'running') {
    return {
      already_running: true,
      job: publicPropertySourceRegistrySeedJob(propertySourceRegistrySeedJob),
    };
  }

  const job = {
    id: crypto.randomUUID(),
    status: 'running',
    started_at: new Date().toISOString(),
    phase: 'queued',
    upserted_sources: 0,
    total_sources: 0,
    batch_size: 0,
    result: null,
    error: null,
  };
  propertySourceRegistrySeedJob = job;
  const actorId = adminActorId(req);

  setImmediate(async () => {
    try {
      const result = await seedPropertySourceRegistry({
        db,
        onProgress: (progress = {}) => {
          job.phase = progress.phase || job.phase;
          job.upserted_sources = Number(progress.upserted_sources || job.upserted_sources || 0);
          job.total_sources = Number(progress.total_sources || job.total_sources || 0);
          job.batch_size = Number(progress.batch_size || job.batch_size || 0);
        },
      });
      job.status = 'completed';
      job.phase = 'completed';
      job.finished_at = new Date().toISOString();
      job.result = {
        upserted_sources: result.upserted_sources,
        pruned_stale_sources: result.pruned_stale_sources,
        by_platform: result.by_platform,
        by_status: result.by_status,
        returned_count: result.returned_count,
      };
      await writeAudit('admin_property_source_registry_seeded_async', {
        source: SOURCED_INVENTORY_CANDIDATE_SOURCE,
        batch_id: PROPERTY_SOURCE_REGISTRY_BATCH_ID,
        job_id: job.id,
        upserted_sources: result.upserted_sources,
        pruned_stale_sources: result.pruned_stale_sources,
        by_platform: result.by_platform,
      }, actorId);
    } catch (error) {
      job.status = 'failed';
      job.phase = 'failed';
      job.finished_at = new Date().toISOString();
      job.error = {
        message: error.message || 'Source registry seed failed',
        code: error.code || null,
      };
    }
  });

  return {
    already_running: false,
    job: publicPropertySourceRegistrySeedJob(job),
  };
}

router.get('/property-source-registry/seed-status', async (_req, res) => {
  return res.json({
    ok: true,
    data: publicPropertySourceRegistrySeedJob(),
  });
});

router.post('/property-source-registry/seed-async', async (req, res) => {
  const result = startPropertySourceRegistrySeedJob(req);
  return res.status(result.already_running ? 200 : 202).json({
    ok: true,
    data: result,
  });
});

router.get('/property-source-registry', async (req, res, next) => {
  try {
    const result = await listPropertySourceRegistry({
      db,
      limit: req.query.limit || 250
    });
    return res.json({
      ok: true,
      data: {
        ...result,
        summary: summarizePropertySourceRegistry()
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/test-listings/cleanup-april-29', async (req, res, next) => {
  try {
    const actorId = adminActorId(req);
    const reason = 'Removed April 29 test batch per founder launch cleanup';
    const targetRows = await db.query(
      `SELECT
         id::text AS id,
         title,
         status,
         created_at,
         inquiry_reference,
         source,
         listed_via
       FROM properties
       WHERE created_at >= TIMESTAMPTZ '2026-04-29 00:00:00+00'
         AND created_at < TIMESTAMPTZ '2026-04-30 00:00:00+00'
         AND COALESCE(status, '') <> 'deleted'
         AND (
           COALESCE(source, '') ~* '(qa|test|seed|demo|soft_launch|launch_proof)'
           OR COALESCE(listed_via, '') ~* '(qa|test|seed|demo|soft_launch|launch_proof)'
           OR COALESCE(title, '') ~* '(qa|test|delete|dummy|sample|launch proof|soft launch|hajsk|dbdd|fgfgf|hssjjk|dkskdk|akdk|fsbf|bxb|xcv|sdgsdgd|sgsgsgsgs)'
           OR COALESCE(description, '') ~* '(qa|test|delete|dummy|sample|launch proof|soft launch|hajsk|dbdd|fgfgf|hssjjk|dkskdk|akdk|fsbf|bxb|xcv|sdgsdgd|sgsgsgsgs)'
           OR COALESCE(lister_name, '') ~* '(qa|test|delete|dummy|sample)'
           OR COALESCE(lister_email, '') ~* '(makaug\\.invalid|test@|qa@|dummy|sample)'
           OR COALESCE(inquiry_reference, '') ~* '(qa|test|dummy|sample)'
           OR COALESCE(extra_fields->>'is_test', '') ~* '^(true|1|yes)$'
           OR COALESCE(extra_fields->>'launch_proof', '') ~* '^(true|1|yes)$'
           OR COALESCE(extra_fields->>'non_public_test', '') ~* '^(true|1|yes)$'
         )
       ORDER BY created_at ASC
       LIMIT 500`
    );

    const ids = targetRows.rows.map((row) => row.id).filter(Boolean);
    if (!ids.length) {
      await writeAudit('april_29_test_batch_cleanup_checked', {
        matched: 0,
        action: 'none'
      }, actorId);
      return res.json({
        ok: true,
        data: {
          matched: 0,
          deleted: 0,
          listings: []
        }
      });
    }

    const cleanupMeta = {
      cleaned_at: new Date().toISOString(),
      actor_id: actorId,
      reason,
      scope: 'test-like properties created on 2026-04-29 only'
    };
    const updated = await db.query(
      `UPDATE properties
       SET
         status = 'deleted',
         moderation_stage = 'deleted',
         moderation_reason = $2,
         updated_at = NOW(),
         extra_fields = COALESCE(extra_fields, '{}'::jsonb)
           || jsonb_build_object('april_29_test_batch_cleanup', $3::jsonb)
       WHERE id::text = ANY($1::text[])
       RETURNING id::text AS id, title, status, created_at, inquiry_reference`,
      [ids, reason, JSON.stringify(cleanupMeta)]
    );

    for (const row of updated.rows) {
      try {
        const previous = targetRows.rows.find((item) => item.id === row.id);
        await db.query(
          `INSERT INTO property_moderation_events (
            property_id,
            actor_id,
            action,
            status_from,
            status_to,
            reason,
            notes,
            delivery
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [
            row.id,
            actorId,
            'april_29_test_batch_cleanup',
            previous?.status || null,
            'deleted',
            reason,
            'Soft-deleted from Motherboard Listing Control; ordinary non-test listings from the same date were not matched.',
            JSON.stringify(cleanupMeta)
          ]
        );
      } catch (_error) {
        // The cleanup itself should not fail if the audit trail insert has a temporary schema issue.
      }
    }

    await writeAudit('april_29_test_batch_cleanup', {
      matched: ids.length,
      deleted: updated.rows.length,
      listings: updated.rows.map((row) => ({
        id: row.id,
        title: row.title,
        inquiry_reference: row.inquiry_reference
      }))
    }, actorId);

    return res.json({
      ok: true,
      data: {
        matched: ids.length,
        deleted: updated.rows.length,
        listings: updated.rows
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/test-listings/cleanup-live', async (req, res, next) => {
  try {
    const actorId = adminActorId(req);
    const reason = 'Removed launch/test listings from live and featured controls';
    const testCondition = adminLaunchTestListingCondition('p');
    const targetRows = await db.query(
      `SELECT
         p.id::text AS id,
         p.title,
         p.status,
         p.created_at,
         p.approved_at,
         p.inquiry_reference,
         p.source,
         p.listed_via,
         (COALESCE(p.extra_fields->>'featured', 'false') IN ('true', '1', 'yes')) AS featured
       FROM properties p
       WHERE COALESCE(p.status, '') <> 'deleted'
         AND (
           p.status IN ('approved','sold','hidden')
           OR COALESCE(p.extra_fields->>'featured', 'false') IN ('true', '1', 'yes')
         )
         AND ${testCondition}
       ORDER BY COALESCE(p.approved_at, p.reviewed_at, p.updated_at, p.created_at) DESC
       LIMIT 1000`
    );

    const ids = targetRows.rows.map((row) => row.id).filter(Boolean);
    if (!ids.length) {
      await writeAudit('live_test_listing_cleanup_checked', {
        matched: 0,
        action: 'none'
      }, actorId);
      return res.json({
        ok: true,
        data: {
          matched: 0,
          deleted: 0,
          listings: []
        }
      });
    }

    const cleanupMeta = {
      cleaned_at: new Date().toISOString(),
      actor_id: actorId,
      reason,
      scope: 'test-like approved, sold, hidden, or featured properties only'
    };
    const updated = await db.query(
      `UPDATE properties
       SET
         status = 'deleted',
         moderation_stage = 'deleted',
         moderation_reason = $2,
         updated_at = NOW(),
         extra_fields = COALESCE(extra_fields, '{}'::jsonb)
           || jsonb_build_object(
             'featured', false,
             'featured_removed_at', NOW()::text,
             'live_test_listing_cleanup', $3::jsonb
           )
       WHERE id::text = ANY($1::text[])
       RETURNING id::text AS id, title, status, created_at, approved_at, inquiry_reference`,
      [ids, reason, JSON.stringify(cleanupMeta)]
    );

    for (const row of updated.rows) {
      try {
        const previous = targetRows.rows.find((item) => item.id === row.id);
        await db.query(
          `INSERT INTO property_moderation_events (
            property_id,
            actor_id,
            action,
            status_from,
            status_to,
            reason,
            notes,
            delivery
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [
            row.id,
            actorId,
            'live_test_listing_cleanup',
            previous?.status || null,
            'deleted',
            reason,
            'Soft-deleted because the record matched launch/test markers and should not appear in Live & Featured controls.',
            JSON.stringify({
              ...cleanupMeta,
              was_featured: previous?.featured === true
            })
          ]
        );
      } catch (_error) {
        // The cleanup should still succeed if moderation event logging is temporarily unavailable.
      }
    }

    await writeAudit('live_test_listing_cleanup', {
      matched: ids.length,
      deleted: updated.rows.length,
      listings: updated.rows.map((row) => ({
        id: row.id,
        title: row.title,
        inquiry_reference: row.inquiry_reference
      }))
    }, actorId);

    return res.json({
      ok: true,
      data: {
        matched: ids.length,
        deleted: updated.rows.length,
        listings: updated.rows
      }
    });
  } catch (error) {
    return next(error);
  }
});

async function sendAdminPropertyReview(req, res, next) {
  try {
    const review = await loadPropertyReview(req.params.id);
    if (!review) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    return res.json({ ok: true, data: review });
  } catch (error) {
    return next(error);
  }
}

router.get('/properties/:id', sendAdminPropertyReview);
router.get('/properties/:id/review', sendAdminPropertyReview);

router.get('/properties/:id/id-document', async (req, res, next) => {
  const actorId = adminActorId(req);
  try {
    const data = await buildListingIdentityDocumentPayload(db, req.params.id, {
      actorId,
      actorRole: req.adminAuth?.role || req.adminAuth?.type || 'admin',
      source: 'king_dashboard'
    });
    await writeAudit('admin_identity_document_accessed', {
      property_id: data.property_id,
      inquiry_reference: data.inquiry_reference || null,
      storage: data.document?.storage || null,
      expires_at: data.document?.expires_at || null
    }, actorId);
    return res.json({ ok: true, data });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    return next(error);
  }
});

router.get('/properties/:id/live-preview', async (req, res, next) => {
  try {
    const review = await loadPropertyReview(req.params.id);
    if (!review) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    return res.json({
      ok: true,
      data: buildAdminLivePreviewPayload(review)
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/properties/:id/images', async (req, res, next) => {
  const actorId = adminActorId(req);
  const client = await db.pool.connect();
  try {
    const confirmRights = parseBooleanLike(req.body?.confirm_rights || req.body?.image_rights_confirmed, false);
    if (!confirmRights) {
      return res.status(400).json({
        ok: false,
        error: 'Admin image upload requires image rights confirmation'
      });
    }
    const requestedImages = Array.isArray(req.body?.images) ? req.body.images : [req.body || {}];
    const uploads = requestedImages
      .map((item, index) => cleanAdminListingImageUpload(item, index === 0 ? 'Primary authorised photo' : `Authorised photo ${index + 1}`))
      .filter(Boolean);
    if (!uploads.length) {
      return res.status(400).json({ ok: false, error: 'No listing images were provided' });
    }
    if (uploads.length > ADMIN_LISTING_IMAGE_MAX_COUNT) {
      return res.status(400).json({ ok: false, error: `Upload no more than ${ADMIN_LISTING_IMAGE_MAX_COUNT} listing images at once` });
    }

    await client.query('BEGIN');
    const property = await client.query('SELECT id, status FROM properties WHERE id = $1 LIMIT 1', [req.params.id]);
    if (!property.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }
    const replaceAll = parseBooleanLike(req.body?.replace_all || req.body?.replaceAll, false);
    const existingCount = await client.query('SELECT COUNT(*)::int AS count FROM property_images WHERE property_id = $1', [req.params.id]);
    const shouldMakeFirstPrimary = replaceAll || Number(existingCount.rows[0]?.count || 0) === 0 || uploads.some((image) => image.is_primary);
    if (replaceAll) {
      await client.query('DELETE FROM property_images WHERE property_id = $1', [req.params.id]);
    }
    if (shouldMakeFirstPrimary) {
      await client.query('UPDATE property_images SET is_primary = false WHERE property_id = $1', [req.params.id]);
    }
    const storedUploads = [];
    for (const [index, image] of uploads.entries()) {
      storedUploads.push({
        ...image,
        url: await prepareMediaUrlForStorage(image.url, {
          keyPrefix: `properties/${req.params.id}/admin-images`,
          filename: image.room_label || image.slot_key || `admin-photo-${index + 1}`,
          isPrivate: false,
          allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
          maxBytes: ADMIN_LISTING_IMAGE_MAX_BYTES,
          label: 'Admin listing image'
        })
      });
    }
    const requestedPrimaryIndex = uploads.findIndex((image) => image.is_primary);
    const created = [];
    for (const [index, image] of storedUploads.entries()) {
      const isPrimary = shouldMakeFirstPrimary
        ? (requestedPrimaryIndex >= 0 ? index === requestedPrimaryIndex : index === 0)
        : false;
      const inserted = await client.query(
        `INSERT INTO property_images (property_id, url, is_primary, sort_order, slot_key, room_label)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, url, is_primary, sort_order, slot_key, room_label, created_at`,
        [
          req.params.id,
          image.url,
          isPrimary,
          image.sort_order || index,
          image.slot_key,
          image.room_label
        ]
      );
      created.push(inserted.rows[0]);
    }
    await client.query(
      `UPDATE properties
       SET extra_fields = COALESCE(extra_fields, '{}'::jsonb)
         || jsonb_build_object(
           'consent_confirmed', true,
           'image_rights_confirmed', true,
           'image_rights_status', 'admin_uploaded_authorised_images',
           'admin_image_upload', $2::jsonb
         ),
         updated_at = NOW()
       WHERE id = $1`,
      [req.params.id, JSON.stringify({
        at: new Date().toISOString(),
        actor_id: actorId,
        action: replaceAll ? 'replace_all' : 'add',
        image_count: created.length
      })]
    );
    await client.query(
      `INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, reason, notes, delivery)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7::jsonb)`,
      [
        req.params.id,
        actorId,
        replaceAll ? 'admin_listing_images_replaced' : 'admin_listing_images_uploaded',
        property.rows[0].status,
        'Admin confirmed image rights and uploaded authorised listing photos.',
        `${created.length} authorised image(s) ${replaceAll ? 'replaced all existing listing images' : 'added to the listing'}.`,
        JSON.stringify({ image_count: created.length, replace_all: replaceAll })
      ]
    );
    await client.query('COMMIT');
    await writeAudit(replaceAll ? 'admin_listing_images_replaced' : 'admin_listing_images_uploaded', {
      property_id: req.params.id,
      image_count: created.length,
      replace_all: replaceAll
    }, actorId);
    const review = await loadPropertyReview(req.params.id);
    return res.json({ ok: true, data: review });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    return next(error);
  } finally {
    client.release();
  }
});

router.patch('/properties/:id/images/:imageId', async (req, res, next) => {
  const actorId = adminActorId(req);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT p.id AS property_id, p.status, i.id AS image_id, i.is_primary
       FROM properties p
       JOIN property_images i ON i.property_id = p.id
       WHERE p.id = $1 AND i.id = $2
       LIMIT 1`,
      [req.params.id, req.params.imageId]
    );
    if (!existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Listing image not found' });
    }

    const hasNewImage = Boolean(String(req.body?.url || req.body?.data_url || req.body?.dataUrl || '').trim());
    if (hasNewImage && !parseBooleanLike(req.body?.confirm_rights || req.body?.image_rights_confirmed, false)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'Replacing a listing image requires image rights confirmation' });
    }
    let image = hasNewImage
      ? cleanAdminListingImageUpload(req.body || {}, cleanText(req.body?.room_label || req.body?.label) || 'Authorised property photo')
      : null;
    if (image) {
      image = {
        ...image,
        url: await prepareMediaUrlForStorage(image.url, {
          keyPrefix: `properties/${req.params.id}/admin-images`,
          filename: image.room_label || image.slot_key || `admin-photo-${req.params.imageId}`,
          isPrivate: false,
          allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
          maxBytes: ADMIN_LISTING_IMAGE_MAX_BYTES,
          label: 'Admin listing image'
        })
      };
    }
    const setParts = [];
    const values = [req.params.id, req.params.imageId];
    let paramIndex = 3;
    if (image) {
      setParts.push(`url = $${paramIndex++}`);
      values.push(image.url);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'room_label') || Object.prototype.hasOwnProperty.call(req.body || {}, 'label') || image) {
      setParts.push(`room_label = $${paramIndex++}`);
      values.push(image?.room_label || cleanText(req.body?.room_label || req.body?.label).slice(0, 120) || null);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'slot_key') || Object.prototype.hasOwnProperty.call(req.body || {}, 'slot') || image) {
      setParts.push(`slot_key = $${paramIndex++}`);
      values.push(image?.slot_key || cleanText(req.body?.slot_key || req.body?.slot).slice(0, 80) || null);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, 'sort_order')) {
      setParts.push(`sort_order = $${paramIndex++}`);
      values.push(Math.max(0, parseInt(req.body.sort_order, 10) || 0));
    }
    const makePrimary = parseBooleanLike(req.body?.is_primary || req.body?.primary, false);
    if (makePrimary) {
      await client.query('UPDATE property_images SET is_primary = false WHERE property_id = $1', [req.params.id]);
      setParts.push('is_primary = true');
    }
    if (!setParts.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'No image changes were provided' });
    }
    const updated = await client.query(
      `UPDATE property_images
       SET ${setParts.join(', ')}
       WHERE property_id = $1 AND id = $2
       RETURNING id, url, is_primary, sort_order, slot_key, room_label, created_at`,
      values
    );
    if (hasNewImage) {
      await client.query(
        `UPDATE properties
         SET extra_fields = COALESCE(extra_fields, '{}'::jsonb)
           || jsonb_build_object(
             'consent_confirmed', true,
             'image_rights_confirmed', true,
             'image_rights_status', 'admin_uploaded_authorised_images',
             'admin_image_upload', $2::jsonb
           ),
           updated_at = NOW()
         WHERE id = $1`,
        [req.params.id, JSON.stringify({
          at: new Date().toISOString(),
          actor_id: actorId,
          action: 'replace_one',
          image_id: req.params.imageId
        })]
      );
    }
    await client.query(
      `INSERT INTO property_moderation_events (property_id, actor_id, action, status_from, status_to, reason, notes, delivery)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7::jsonb)`,
      [
        req.params.id,
        actorId,
        hasNewImage ? 'admin_listing_image_replaced' : 'admin_listing_image_updated',
        existing.rows[0].status,
        hasNewImage ? 'Admin confirmed image rights and replaced a listing photo.' : 'Admin updated listing image metadata.',
        hasNewImage ? 'One authorised listing image was replaced.' : 'Listing image metadata was updated.',
        JSON.stringify({ image_id: req.params.imageId, primary: makePrimary, replaced: hasNewImage })
      ]
    );
    await client.query('COMMIT');
    await writeAudit(hasNewImage ? 'admin_listing_image_replaced' : 'admin_listing_image_updated', {
      property_id: req.params.id,
      image_id: req.params.imageId,
      primary: makePrimary,
      replaced: hasNewImage
    }, actorId);
    const review = await loadPropertyReview(req.params.id);
    return res.json({ ok: true, data: review, image: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    return next(error);
  } finally {
    client.release();
  }
});

router.delete('/properties/:id/images/:imageId', async (req, res, next) => {
  const actorId = adminActorId(req);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `DELETE FROM property_images
       WHERE property_id = $1 AND id = $2
       RETURNING id, is_primary`,
      [req.params.id, req.params.imageId]
    );
    if (!existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Listing image not found' });
    }
    if (existing.rows[0].is_primary) {
      await client.query(
        `UPDATE property_images
         SET is_primary = true
         WHERE id = (
           SELECT id
           FROM property_images
           WHERE property_id = $1
           ORDER BY sort_order ASC, created_at ASC
           LIMIT 1
         )`,
        [req.params.id]
      );
    }
    await client.query('UPDATE properties SET updated_at = NOW() WHERE id = $1', [req.params.id]);
    await client.query(
      `INSERT INTO property_moderation_events (property_id, actor_id, action, reason, notes, delivery)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        req.params.id,
        actorId,
        'admin_listing_image_deleted',
        'Admin removed listing photo.',
        'One listing image was removed from King review.',
        JSON.stringify({ image_id: req.params.imageId })
      ]
    );
    await client.query('COMMIT');
    await writeAudit('admin_listing_image_deleted', {
      property_id: req.params.id,
      image_id: req.params.imageId
    }, actorId);
    const review = await loadPropertyReview(req.params.id);
    return res.json({ ok: true, data: review });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
});

router.post('/properties/:id/external-duplicate-scan', async (req, res, next) => {
  try {
    const property = await db.query(
      `SELECT *
       FROM properties
       WHERE id = $1
       LIMIT 1`,
      [req.params.id]
    );
    if (!property.rows.length) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    const images = await db.query(
      `SELECT id, url, is_primary, sort_order, slot_key, room_label, created_at
       FROM property_images
       WHERE property_id = $1
       ORDER BY is_primary DESC, sort_order ASC, created_at ASC`,
      [req.params.id]
    );

    const scan = await scanAndCacheExternalDuplicates({
      db,
      listing: property.rows[0],
      images: images.rows,
      force: req.body?.force !== false
    });

    await writeAudit('admin_property_external_duplicate_scan_run', {
      property_id: req.params.id,
      status: scan.status,
      provider: scan.provider
    }, adminActorId(req));

    return res.json({ ok: true, data: scan });
  } catch (error) {
    return next(error);
  }
});

router.patch('/properties/:id/review', async (req, res, next) => {
  try {
    const existing = await db.query('SELECT id, status, moderation_checklist, extra_fields FROM properties WHERE id = $1 LIMIT 1', [req.params.id]);
    if (!existing.rows.length) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    const listingPatch = req.body?.listing && typeof req.body.listing === 'object' ? req.body.listing : null;
    if (listingPatch) {
      await updatePropertyEditableFields({ propertyId: req.params.id, patch: listingPatch });
    }

    const checklist = req.body.checklist && typeof req.body.checklist === 'object'
      ? normalizeReviewChecklist(req.body.checklist)
      : normalizeReviewChecklist(existing.rows[0].moderation_checklist);
    const notes = cleanText(req.body.notes || req.body.review_notes) || null;
    const reason = cleanText(req.body.reason) || null;
    const stage = cleanText(req.body.stage) || 'in_review';
    const warningOverrides = req.body.warning_overrides && typeof req.body.warning_overrides === 'object'
      ? req.body.warning_overrides
      : (existing.rows[0].extra_fields?.review_warning_overrides || {});
    const actorId = adminActorId(req);
    const reviewerUserId = req.adminAuth?.userId || null;

    const updated = await db.query(
      `UPDATE properties
       SET
         moderation_stage = $2,
         moderation_checklist = $3::jsonb,
         moderation_notes = COALESCE($4::text, moderation_notes),
         moderation_reason = COALESCE($5::text, moderation_reason),
         reviewed_by = COALESCE($6::uuid, reviewed_by),
         extra_fields = COALESCE(extra_fields, '{}'::jsonb) || jsonb_build_object('review_warning_overrides', $7::jsonb),
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, status, moderation_stage, moderation_checklist, moderation_notes, moderation_reason,
         reviewed_by, extra_fields, listing_type, title, description, district, area, address,
         price, price_period, transaction_type, property_type, bedrooms, bathrooms, latitude, longitude, amenities, updated_at`,
      [
        req.params.id,
        stage,
        JSON.stringify(checklist),
        notes,
        reason,
        reviewerUserId,
        JSON.stringify(warningOverrides)
      ]
    );

    await db.query(
      `INSERT INTO property_moderation_events (property_id, actor_id, action, checklist, reason, notes)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
      [
        req.params.id,
        actorId,
        listingPatch ? 'listing_review_updated_with_listing_edits' : 'listing_review_updated',
        JSON.stringify(checklist),
        reason,
        notes
      ]
    );

    await writeAudit('admin_property_review_updated', {
      property_id: req.params.id,
      stage,
      listing_edited: !!listingPatch,
      warning_override_count: Object.keys(warningOverrides || {}).length
    }, actorId);

    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({
        ok: false,
        error: error.message,
        details: error.details || undefined
      });
    }
    return next(error);
  }
});

router.patch('/properties/:id/land-verification', async (req, res, next) => {
  try {
    const patch = sanitizeUgNlisLandVerificationFields(req.body || {});
    if (!Object.keys(patch).length) {
      return res.status(400).json({ ok: false, error: 'No land verification fields supplied' });
    }
    const updated = await db.query(
      `UPDATE properties
       SET extra_fields = COALESCE(extra_fields, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, title, listing_type, extra_fields, updated_at`,
      [req.params.id, JSON.stringify(patch)]
    );
    if (!updated.rows.length) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }
    const actorId = adminActorId(req);
    await db.query(
      `INSERT INTO property_moderation_events (property_id, actor_id, action, notes)
       VALUES ($1, $2, $3, $4)`,
      [req.params.id, actorId, 'land_verification_updated', cleanText(req.body?.ugnlis_search_notes || req.body?.verification_notes || '') || null]
    );
    await writeAudit('admin_land_verification_updated', {
      property_id: req.params.id,
      fields: Object.keys(patch)
    }, actorId);
    const row = updated.rows[0];
    return res.json({
      ok: true,
      data: {
        ...row,
        land_verification: buildUgNlisLandVerificationPack({ extra_fields: row.extra_fields || {} })
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/properties/:id/review-token', async (req, res, next) => {
  try {
    const property = await db.query(
      `SELECT id, title, inquiry_reference, lister_name, lister_phone, lister_email
       FROM properties
       WHERE id = $1
       LIMIT 1`,
      [req.params.id]
    );
    if (!property.rows.length) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    const token = createOwnerEditToken();
    const expiresAt = ownerEditTokenExpiry();
    await db.query(
      `UPDATE properties
       SET owner_edit_token_hash = $2,
           owner_edit_token_expires_at = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [req.params.id, hashOwnerEditToken(token), expiresAt]
    );

    const url = getOwnerPreviewUrl(property.rows[0], token);
    await writeAudit('admin_property_review_token_created', {
      property_id: req.params.id,
      expires_at: expiresAt
    }, adminActorId(req));

    return res.json({
      ok: true,
      data: {
        property_id: req.params.id,
        owner_preview_url: url,
        expires_at: expiresAt
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/listing-submit-otp-override', async (req, res, next) => {
  try {
    const channel = cleanText(req.body.channel).toLowerCase() === 'email' ? 'email' : 'phone';
    const phone = normalizeUgPhone(req.body.phone);
    const email = normalizeEmail(req.body.email);
    const identifier = channel === 'email' ? email : phone;

    if (channel === 'email') {
      if (!identifier || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
        return res.status(400).json({ ok: false, error: 'Valid email is required' });
      }
    } else if (!identifier || !/^\+256\d{9}$/.test(identifier)) {
      return res.status(400).json({ ok: false, error: 'Valid Uganda phone is required' });
    }

    const token = createListingSubmitToken({ channel, phone, email });
    await writeAudit('admin_listing_submit_otp_override_created', {
      channel,
      identifier
    }, adminActorId(req));

    return res.json({
      ok: true,
      data: {
        channel,
        identifier,
        phone: channel === 'phone' ? phone : undefined,
        email: channel === 'email' ? email : undefined,
        listing_otp_token: token,
        expires_in: process.env.LISTING_OTP_EXPIRES_IN || '30m'
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/users', async (req, res, next) => {
  try {
    let { page, limit, offset } = parsePagination(req.query);
    const search = String(req.query.search || '').trim().toLowerCase();
    const rawStatus = String(req.query.status || '').trim().toLowerCase();
    const status = rawStatus;
    const role = String(req.query.role || '').trim().toLowerCase();
    const weeklyTipsOnly = String(req.query.weekly_tips_only || '').trim().toLowerCase();

    if (role === 'field_agent') {
      limit = Math.min(Math.max(parseInt(req.query.limit || String(FIELD_AGENT_DIRECTORY_LIMIT), 10), 1), FIELD_AGENT_DIRECTORY_LIMIT);
      offset = (page - 1) * limit;
    }

    const filters = [];
    const values = [];

    if (search) {
      values.push(`%${search}%`);
      filters.push(`(
        u.first_name ILIKE $${values.length}
        OR u.last_name ILIKE $${values.length}
        OR u.phone ILIKE $${values.length}
        OR COALESCE(u.email, '') ILIKE $${values.length}
      )`);
    }
    if (status) {
      values.push(status);
      filters.push(`u.status = $${values.length}`);
    }
    if (role) {
      values.push(role);
      filters.push(`u.role = $${values.length}`);
    }
    if (['1', 'true', 'yes'].includes(weeklyTipsOnly)) {
      filters.push('u.weekly_tips_opt_in = TRUE');
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM users u ${where}`, values);
    const total = countResult.rows[0]?.total || 0;

    const listValues = [...values, limit, offset];
    const rows = await db.query(
      `SELECT
        u.id,
        u.first_name,
        u.last_name,
        u.phone,
        u.email,
        u.role,
        u.status,
        u.phone_verified,
        u.marketing_opt_in,
        u.weekly_tips_opt_in,
        u.preferred_contact_channel,
        u.preferred_language,
        u.profile_data,
        u.oauth_provider,
        u.last_login_at,
        u.created_at,
        COALESCE(p.listings_count, 0) AS listings_count,
        COALESCE(p.approved_listings_count, 0) AS approved_listings_count,
        COALESCE(p.pending_listings_count, 0) AS pending_listings_count,
        COALESCE(p.rejected_listings_count, 0) AS rejected_listings_count,
        COALESCE(p.approved_this_week_count, 0) AS approved_this_week_count,
        COALESCE(p.last_listing_at, NULL) AS last_listing_at,
        COALESCE(i.inquiries_count, 0) AS inquiries_count,
        COALESCE(e.property_views_count, 0) AS property_views_count,
        COALESCE(e.property_saves_count, 0) AS property_saves_count,
        COALESCE(e.route_events_count, 0) AS route_events_count,
        e.last_activity_at
      FROM users u
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS listings_count,
          COUNT(*) FILTER (WHERE LOWER(COALESCE(p.status, p.moderation_stage, '')) IN ('approved', 'live', 'published'))::int AS approved_listings_count,
          COUNT(*) FILTER (WHERE LOWER(COALESCE(p.status, p.moderation_stage, '')) IN ('pending', 'pending_review', 'test_pending_review', 'pending_review_hidden', 'draft', 'submitted', 'in_review', 'under_review'))::int AS pending_listings_count,
          COUNT(*) FILTER (WHERE LOWER(COALESCE(p.status, p.moderation_stage, '')) IN ('rejected', 'declined', 'fraud'))::int AS rejected_listings_count,
          COUNT(*) FILTER (
            WHERE LOWER(COALESCE(p.status, p.moderation_stage, '')) IN ('approved', 'live', 'published')
              AND COALESCE(p.updated_at, p.created_at) >= NOW() - INTERVAL '7 days'
          )::int AS approved_this_week_count,
          MAX(p.created_at) AS last_listing_at
        FROM properties p
        WHERE p.lister_phone = u.phone
           OR (
             u.role = 'field_agent'
             AND COALESCE(u.profile_data->>'field_agent_code', u.profile_data->>'employee_number', '') <> ''
             AND UPPER(COALESCE(p.extra_fields->>'field_agent_id', p.extra_fields->>'field_agent_code', p.extra_fields->>'field_agent_reference', p.extra_fields->>'agent_field_id', ''))
               = UPPER(COALESCE(u.profile_data->>'field_agent_code', u.profile_data->>'employee_number', ''))
           )
      ) p ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS inquiries_count
        FROM property_inquiries i
        WHERE i.contact_phone = u.phone OR i.contact_email = u.email
      ) i ON true
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE ae.event_name IN ('property_open','property_view'))::int AS property_views_count,
          COUNT(*) FILTER (WHERE ae.event_name IN ('property_save','property_saved','save_property'))::int AS property_saves_count,
          COUNT(*) FILTER (WHERE ae.event_name IN ('property_directions_open','directions_open','route_time_view'))::int AS route_events_count,
          MAX(ae.created_at) AS last_activity_at
        FROM analytics_events ae
        WHERE ae.user_phone = u.phone
           OR ae.payload->>'user_id' = u.id::text
           OR ae.payload->>'user_phone' = u.phone
           OR (u.email IS NOT NULL AND ae.payload->>'user_email' = LOWER(u.email))
      ) e ON true
      ${where}
      ORDER BY u.created_at DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}`,
      listValues
    );

    const data = role === 'field_agent'
      ? decorateFieldAgentPerformanceRows(rows.rows)
      : rows.rows;

    return res.json({
      ok: true,
      data,
      pagination: toPagination(total, page, limit)
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/users/:id', async (req, res, next) => {
  try {
    const user = await db.query(
      `SELECT
         id,
         first_name,
         last_name,
         phone,
         email,
         role,
         status,
         phone_verified,
         marketing_opt_in,
         weekly_tips_opt_in,
         preferred_contact_channel,
         preferred_language,
         profile_data,
         oauth_provider,
         last_login_at,
         last_weekly_tip_sent_at,
         created_at,
         updated_at
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [req.params.id]
    );

    if (!user.rows.length) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const profile = user.rows[0].profile_data && typeof user.rows[0].profile_data === 'object'
      ? user.rows[0].profile_data
      : {};
    const fieldAgentCode = normalizeFieldAgentCode(profile.field_agent_code || profile.employee_number);
    const [listings, inquiries, engagement] = await Promise.all([
      db.query(
        `SELECT id, title, listing_type, district, area, status, moderation_stage, created_at, updated_at
         FROM properties
         WHERE lister_phone = $1
            OR (
              $2 <> ''
              AND UPPER(COALESCE(extra_fields->>'field_agent_id', extra_fields->>'field_agent_code', extra_fields->>'field_agent_reference', extra_fields->>'agent_field_id', '')) = $2
            )
         ORDER BY created_at DESC
         LIMIT 1000`,
        [user.rows[0].phone, fieldAgentCode]
      ),
      db.query(
        `SELECT id, property_id, message, channel, created_at
         FROM property_inquiries
         WHERE contact_phone = $1 OR contact_email = $2
         ORDER BY created_at DESC
         LIMIT 100`,
        [user.rows[0].phone, user.rows[0].email]
      ),
      db.query(
        `SELECT
          COUNT(*) FILTER (WHERE event_name IN ('property_open','property_view'))::int AS property_views_count,
          COUNT(*) FILTER (WHERE event_name IN ('property_save','property_saved','save_property'))::int AS property_saves_count,
          COUNT(*) FILTER (WHERE event_name IN ('property_directions_open','directions_open','route_time_view'))::int AS route_events_count,
          MAX(created_at) AS last_activity_at
         FROM analytics_events
         WHERE user_phone = $1
            OR payload->>'user_id' = $2
            OR payload->>'user_phone' = $1`,
        [user.rows[0].phone, String(user.rows[0].id)]
      )
    ]);

    return res.json({
      ok: true,
      data: {
        ...user.rows[0],
        listings: listings.rows,
        inquiries: inquiries.rows,
        engagement: engagement.rows[0] || {}
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/staff', async (req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT
         u.id,
         u.first_name,
         u.last_name,
         u.phone,
         u.email,
         u.role,
         u.status,
         u.phone_verified,
         u.preferred_contact_channel,
         u.preferred_language,
         u.profile_data,
         u.last_login_at,
         u.created_at,
         u.updated_at,
         COALESCE(m.moderated_count, 0)::int AS moderated_count,
         COALESCE(m.approved_count, 0)::int AS approved_count,
         COALESCE(m.rejected_count, 0)::int AS rejected_count,
         m.last_moderation_at,
         COALESCE(a.activity_count, 0)::int AS activity_count,
         a.last_activity_at
       FROM users u
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS moderated_count,
           COUNT(*) FILTER (WHERE action ILIKE '%approved%' OR status_to IN ('approved','live','published'))::int AS approved_count,
           COUNT(*) FILTER (WHERE action ILIKE '%rejected%' OR status_to IN ('rejected','declined','fraud'))::int AS rejected_count,
           MAX(created_at) AS last_moderation_at
         FROM property_moderation_events
         WHERE actor_id::text = u.id::text
       ) m ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS activity_count, MAX(created_at) AS last_activity_at
         FROM staff_activity_logs
         WHERE staff_user_id::text = u.id::text
       ) a ON true
       WHERE u.role = 'moderator'
          OR COALESCE(u.profile_data->>'staff_dashboard_enabled', '') ILIKE 'true'
       ORDER BY COALESCE(u.profile_data->>'staff_code', u.profile_data->>'employee_number', u.created_at::text) ASC`
    );

    return res.json({
      ok: true,
      data: rows.rows.map((row) => ({
        ...publicStaffAccount(row),
        moderated_count: row.moderated_count,
        approved_count: row.approved_count,
        rejected_count: row.rejected_count,
        last_moderation_at: row.last_moderation_at,
        activity_count: row.activity_count,
        last_activity_at: row.last_activity_at
      }))
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/staff/bootstrap-five', async (req, res, next) => {
  try {
    const requestedStaff = Array.isArray(req.body?.staff) && req.body.staff.length
      ? req.body.staff.slice(0, 5)
      : [1, 2, 3, 4, 5].map((index) => defaultStaffSeed(index));
    while (requestedStaff.length < 5) {
      requestedStaff.push(defaultStaffSeed(requestedStaff.length + 1));
    }

    const accounts = [];
    for (const [index, staffInput] of requestedStaff.entries()) {
      accounts.push(await upsertModeratorStaffAccount({
        ...staffInput,
        reset_password: parseBooleanLike(req.body?.reset_password || req.body?.resetPassword, false)
      }, req, index + 1));
    }

    await writeAudit('moderator_staff_bootstrap_five', {
      staff_count: accounts.length,
      passwords_returned_count: accounts.filter((account) => account.temporary_password).length
    }, adminActorId(req));

    return res.json({
      ok: true,
      data: {
        accounts,
        login_url: '/staff-dashboard',
        password_policy: 'Moderator passwords are created or reset by King/admin only.',
        passwords_returned_count: accounts.filter((account) => account.temporary_password).length
      }
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    return next(error);
  }
});

router.post('/staff', async (req, res, next) => {
  try {
    const account = await upsertModeratorStaffAccount(req.body || {}, req, 1);
    return res.status(201).json({
      ok: true,
      data: {
        account,
        login_url: '/staff-dashboard',
        password_policy: 'Moderator passwords are created or reset by King/admin only.'
      }
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    return next(error);
  }
});

router.patch('/staff/:id', async (req, res, next) => {
  try {
    const existing = await db.query(
      `SELECT id, first_name, last_name, phone, email, role, status, preferred_language, profile_data
       FROM users
       WHERE id = $1 AND (role = 'moderator' OR COALESCE(profile_data->>'staff_dashboard_enabled', '') ILIKE 'true')
       LIMIT 1`,
      [req.params.id]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ ok: false, error: 'Moderator staff account not found' });
    }

    const current = existing.rows[0];
    const profile = safeJsonObject(current.profile_data, {});
    const account = await upsertModeratorStaffAccount({
      first_name: Object.prototype.hasOwnProperty.call(req.body || {}, 'first_name') ? req.body.first_name : current.first_name,
      last_name: Object.prototype.hasOwnProperty.call(req.body || {}, 'last_name') ? req.body.last_name : current.last_name,
      phone: Object.prototype.hasOwnProperty.call(req.body || {}, 'phone') ? req.body.phone : current.phone,
      email: Object.prototype.hasOwnProperty.call(req.body || {}, 'email') ? req.body.email : current.email,
      status: Object.prototype.hasOwnProperty.call(req.body || {}, 'status') ? req.body.status : current.status,
      preferred_language: Object.prototype.hasOwnProperty.call(req.body || {}, 'preferred_language') ? req.body.preferred_language : current.preferred_language,
      staff_code: Object.prototype.hasOwnProperty.call(req.body || {}, 'staff_code') ? req.body.staff_code : (profile.staff_code || profile.employee_number),
      personal_email: Object.prototype.hasOwnProperty.call(req.body || {}, 'personal_email') ? req.body.personal_email : profile.personal_email,
      channel_access: Object.prototype.hasOwnProperty.call(req.body || {}, 'channel_access') ? req.body.channel_access : profile.channel_access,
      permissions: Object.prototype.hasOwnProperty.call(req.body || {}, 'permissions') ? req.body.permissions : profile.permissions,
      staff_notes: Object.prototype.hasOwnProperty.call(req.body || {}, 'staff_notes') ? req.body.staff_notes : profile.staff_notes,
      reset_password: parseBooleanLike(req.body?.reset_password || req.body?.resetPassword, false),
      password: req.body?.password
    }, req, 1);

    return res.json({ ok: true, data: account });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    return next(error);
  }
});

router.post('/staff/:id/password-reset', async (req, res, next) => {
  try {
    const existing = await db.query(
      `SELECT id, first_name, last_name, phone, email, role, status, preferred_language, profile_data
       FROM users
       WHERE id = $1 AND (role = 'moderator' OR COALESCE(profile_data->>'staff_dashboard_enabled', '') ILIKE 'true')
       LIMIT 1`,
      [req.params.id]
    );
    if (!existing.rows.length) {
      return res.status(404).json({ ok: false, error: 'Moderator staff account not found' });
    }
    const current = existing.rows[0];
    const profile = safeJsonObject(current.profile_data, {});
    const account = await upsertModeratorStaffAccount({
      first_name: current.first_name,
      last_name: current.last_name,
      phone: current.phone,
      email: current.email,
      status: current.status,
      preferred_language: current.preferred_language,
      staff_code: profile.staff_code || profile.employee_number,
      personal_email: profile.personal_email,
      channel_access: profile.channel_access,
      permissions: profile.permissions,
      staff_notes: profile.staff_notes,
      password: req.body?.password,
      reset_password: true
    }, req, 1);

    await writeAudit('moderator_staff_password_reset', {
      staff_user_id: current.id,
      staff_code: account.staff_code
    }, adminActorId(req));

    return res.json({
      ok: true,
      data: {
        account,
        temporary_password: account.temporary_password,
        password_policy: 'Share this password once. Staff cannot reset it themselves.'
      }
    });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    return next(error);
  }
});

router.get('/staff/activity', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10) || 100, 1), 500);
    const staffUserId = cleanText(req.query.staff_user_id || req.query.staffUserId);
    const action = cleanText(req.query.action).slice(0, 120);
    const filters = [];
    const values = [];
    if (staffUserId) {
      values.push(staffUserId);
      filters.push(`sal.staff_user_id = $${values.length}`);
    }
    if (action) {
      values.push(`%${action}%`);
      filters.push(`sal.action ILIKE $${values.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    values.push(limit);
    const rows = await db.query(
      `SELECT
         sal.id,
         sal.staff_user_id,
         sal.action,
         sal.target_type,
         sal.target_id,
         sal.metadata,
         sal.created_at,
         u.first_name,
         u.last_name,
         u.email,
         u.phone,
         COALESCE(u.profile_data->>'staff_code', u.profile_data->>'employee_number', '') AS staff_code
       FROM staff_activity_logs sal
       LEFT JOIN users u ON u.id = sal.staff_user_id
       ${where}
       ORDER BY sal.created_at DESC
       LIMIT $${values.length}`,
      values
    );
    return res.json({ ok: true, data: rows.rows });
  } catch (error) {
    return next(error);
  }
});

router.get('/field-agents/listings', async (req, res, next) => {
  try {
    const requestedStatus = normalizeAdminPropertyStatus(req.query.status || 'all');
    const limit = Math.min(Math.max(parseInt(req.query.limit || '1000', 10) || 1000, 1), 5000);
    const payoutWindow = fieldAgentPayoutWindow(req.query.period || 'all');
    const statusExpr = "LOWER(COALESCE(p.status, p.moderation_stage, ''))";
    let statusClause = '';
    if (requestedStatus === 'approved') {
      statusClause = `AND ${statusExpr} IN ('approved', 'live', 'published')`;
    } else if (requestedStatus === 'pending') {
      statusClause = `AND ${statusExpr} IN ('pending', 'pending_review', 'test_pending_review', 'pending_review_hidden', 'draft', 'submitted', 'in_review', 'under_review')`;
    } else if (requestedStatus === 'rejected') {
      statusClause = `AND ${statusExpr} IN ('rejected', 'declined', 'fraud')`;
    } else if (requestedStatus === 'hidden') {
      statusClause = `AND ${statusExpr} IN ('hidden', 'off_market', 'paused', 'archived')`;
    }
    const values = [limit];
    let payoutWindowClause = '';
    if (requestedStatus === 'approved' && payoutWindow.has_range) {
      values.push(payoutWindow.period_start, payoutWindow.period_end);
      payoutWindowClause = `AND COALESCE(p.updated_at, p.created_at) >= $2::timestamptz
                            AND COALESCE(p.updated_at, p.created_at) < $3::timestamptz`;
    }

    const rows = await db.query(
      `SELECT
         p.id,
         p.title,
         p.listing_type,
         p.property_type,
         p.district,
         p.area,
         p.price,
         p.status,
         p.moderation_stage,
         p.created_at,
         p.updated_at,
         u.id AS field_agent_user_id,
         u.first_name AS field_agent_first_name,
         u.last_name AS field_agent_last_name,
         u.phone AS field_agent_phone,
         u.email AS field_agent_email,
         u.status AS field_agent_status,
         COALESCE(u.profile_data->>'field_agent_code', u.profile_data->>'employee_number', '') AS field_agent_code,
         COALESCE(u.profile_data->>'field_agent_territory', u.profile_data->>'territory', 'Uganda') AS field_agent_territory,
         CASE
           WHEN COALESCE(u.profile_data->>'payout_rate_ugx', '') ~ '^[0-9]+$'
             THEN (u.profile_data->>'payout_rate_ugx')::int
           ELSE ${FIELD_AGENT_DEFAULT_PAYOUT_UGX}
         END AS payout_rate_ugx
       FROM properties p
       JOIN users u
         ON u.role = 'field_agent'
        AND (
          p.lister_phone = u.phone
          OR (
            COALESCE(u.profile_data->>'field_agent_code', u.profile_data->>'employee_number', '') <> ''
            AND UPPER(COALESCE(p.extra_fields->>'field_agent_id', p.extra_fields->>'field_agent_code', p.extra_fields->>'field_agent_reference', p.extra_fields->>'agent_field_id', ''))
              = UPPER(COALESCE(u.profile_data->>'field_agent_code', u.profile_data->>'employee_number', ''))
          )
       )
       WHERE 1=1
       ${statusClause}
       ${payoutWindowClause}
       ORDER BY COALESCE(p.updated_at, p.created_at) DESC
       LIMIT $1`,
      values
    );

    const data = rows.rows.map((row) => {
      const normalizedStatus = normalizeAdminPropertyStatus(row.status || row.moderation_stage);
      const payoutRate = Number(row.payout_rate_ugx || FIELD_AGENT_DEFAULT_PAYOUT_UGX) || FIELD_AGENT_DEFAULT_PAYOUT_UGX;
      return {
        id: row.id,
        title: row.title,
        listing_type: row.listing_type,
        property_type: row.property_type,
        district: row.district,
        area: row.area,
        price: row.price,
        status: row.status,
        moderation_stage: row.moderation_stage,
        status_normalized: normalizedStatus,
        created_at: row.created_at,
        updated_at: row.updated_at,
        field_agent_user_id: row.field_agent_user_id,
        field_agent_name: `${row.field_agent_first_name || ''} ${row.field_agent_last_name || ''}`.trim() || 'Field Agent',
        field_agent_phone: row.field_agent_phone,
        field_agent_email: row.field_agent_email,
        field_agent_status: row.field_agent_status,
        field_agent_code: row.field_agent_code,
        field_agent_territory: row.field_agent_territory,
        payout_rate_ugx: payoutRate,
        payout_due_ugx: normalizedStatus === 'approved' ? payoutRate : 0
      };
    });

    return res.json({
      ok: true,
      data,
      meta: {
        status: requestedStatus,
        payout_window: requestedStatus === 'approved' ? payoutWindow : undefined,
        limit,
        count: data.length
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/field-agents/payouts', async (req, res, next) => {
  try {
    const payoutWindow = fieldAgentPayoutWindow(req.query.period || 'current_due');
    const limit = Math.min(Math.max(parseInt(req.query.limit || String(FIELD_AGENT_DIRECTORY_LIMIT), 10) || FIELD_AGENT_DIRECTORY_LIMIT, 1), FIELD_AGENT_DIRECTORY_LIMIT);
    const values = [];
    let payoutWindowClause = '';
    if (payoutWindow.has_range) {
      values.push(payoutWindow.period_start, payoutWindow.period_end);
      payoutWindowClause = `AND COALESCE(p.updated_at, p.created_at) >= $1::timestamptz
                            AND COALESCE(p.updated_at, p.created_at) < $2::timestamptz`;
    }
    values.push(limit);
    const limitParam = values.length;

    const rows = await db.query(
      `SELECT
         u.id,
         u.first_name,
         u.last_name,
         u.phone,
         u.email,
         u.status,
         u.profile_data,
         COALESCE(u.profile_data->>'field_agent_code', u.profile_data->>'employee_number', '') AS field_agent_code,
         COALESCE(u.profile_data->>'field_agent_territory', u.profile_data->>'territory', 'Uganda') AS field_agent_territory,
         COALESCE(pay.accepted_count, 0)::int AS accepted_count,
         COALESCE(pay.listings, '[]'::jsonb) AS listings
       FROM users u
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS accepted_count,
           COALESCE(
             jsonb_agg(
               jsonb_build_object(
                 'id', p.id,
                 'title', p.title,
                 'listing_type', p.listing_type,
                 'property_type', p.property_type,
                 'district', p.district,
                 'area', p.area,
                 'price', p.price,
                 'status', p.status,
                 'moderation_stage', p.moderation_stage,
                 'created_at', p.created_at,
                 'updated_at', p.updated_at
               )
               ORDER BY COALESCE(p.updated_at, p.created_at) DESC
             ) FILTER (WHERE p.id IS NOT NULL),
             '[]'::jsonb
           ) AS listings
         FROM properties p
         WHERE (
           p.lister_phone = u.phone
           OR (
             COALESCE(u.profile_data->>'field_agent_code', u.profile_data->>'employee_number', '') <> ''
             AND UPPER(COALESCE(p.extra_fields->>'field_agent_id', p.extra_fields->>'field_agent_code', p.extra_fields->>'field_agent_reference', p.extra_fields->>'agent_field_id', ''))
               = UPPER(COALESCE(u.profile_data->>'field_agent_code', u.profile_data->>'employee_number', ''))
           )
         )
           AND LOWER(COALESCE(p.status, p.moderation_stage, '')) IN ('approved', 'live', 'published')
           ${payoutWindowClause}
       ) pay ON true
       WHERE u.role = 'field_agent'
       ORDER BY COALESCE(pay.accepted_count, 0) DESC, u.created_at DESC
       LIMIT $${limitParam}`,
      values
    );

    const data = rows.rows.map((row) => {
      const payoutRate = fieldAgentPayoutRate(row);
      const acceptedCount = numberOrZero(row.accepted_count);
      return {
        id: row.id,
        first_name: row.first_name,
        last_name: row.last_name,
        phone: row.phone,
        email: row.email,
        status: row.status,
        field_agent_code: row.field_agent_code,
        field_agent_territory: row.field_agent_territory,
        payout_rate_ugx: payoutRate,
        accepted_count: acceptedCount,
        payout_due_ugx: acceptedCount * payoutRate,
        pay_by_date: payoutWindow.pay_by_date,
        listings: Array.isArray(row.listings) ? row.listings : []
      };
    });

    const totalDue = data.reduce((total, row) => total + numberOrZero(row.payout_due_ugx), 0);
    const dueCount = data.filter((row) => numberOrZero(row.payout_due_ugx) > 0).length;

    return res.json({
      ok: true,
      data,
      meta: {
        ...payoutWindow,
        count: data.length,
        due_count: dueCount,
        total_due_ugx: totalDue,
        limit
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/property-requests', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const search = String(req.query.search || '').trim();
    const filters = [];
    const values = [];

    if (search) {
      values.push(`%${search}%`);
      filters.push(`(
        dr.full_name ILIKE $${values.length}
        OR COALESCE(dr.phone, '') ILIKE $${values.length}
        OR COALESCE(dr.email, '') ILIKE $${values.length}
        OR COALESCE(dr.preferred_locations, '') ILIKE $${values.length}
        OR COALESCE(dr.listing_type, '') ILIKE $${values.length}
        OR COALESCE(dr.requirements, '') ILIKE $${values.length}
        OR COALESCE(dr.metadata->>'original_message', '') ILIKE $${values.length}
      )`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const demandRequestsCte = `
      WITH demand_requests AS (
        SELECT
          pr.id::text AS id,
          pr.id::text AS request_id,
          NULL::text AS lead_id,
          'property_request' AS source,
          pr.full_name,
          pr.phone,
          pr.email,
          pr.preferred_locations,
          pr.listing_type,
          pr.max_budget,
          pr.requirements,
          pr.created_at,
          NULL::text AS lead_status,
          NULL::text AS lifecycle_stage,
          '{}'::jsonb AS metadata,
          NULL::text AS match_status
        FROM property_requests pr
        UNION ALL
        SELECT
          ('lead:' || l.id::text) AS id,
          NULL::text AS request_id,
          l.id::text AS lead_id,
          'whatsapp_no_match' AS source,
          COALESCE(NULLIF(c.name, ''), 'WhatsApp property seeker') AS full_name,
          COALESCE(NULLIF(c.whatsapp, ''), NULLIF(c.phone, '')) AS phone,
          c.email,
          COALESCE(NULLIF(l.location, ''), NULLIF(l.metadata->>'preferred_area', ''), 'Any area') AS preferred_locations,
          COALESCE(NULLIF(l.category, ''), NULLIF(l.metadata->>'search_type', ''), NULLIF(l.lead_type, ''), 'property need') AS listing_type,
          l.budget AS max_budget,
          COALESCE(NULLIF(l.metadata->>'original_message', ''), NULLIF(l.message, ''), 'WhatsApp property request had no exact match.') AS requirements,
          l.created_at,
          l.lead_status,
          l.lifecycle_stage,
          COALESCE(l.metadata, '{}'::jsonb) AS metadata,
          COALESCE(NULLIF(l.metadata->>'match_status', ''), 'waiting_for_listing') AS match_status
        FROM leads l
        LEFT JOIN contacts c ON c.id = l.contact_id
        WHERE l.source = 'whatsapp_no_match'
          AND l.lead_type = 'property_need_unavailable'
          AND l.lead_status = 'open'
      )`;
    const countResult = await db.query(
      `${demandRequestsCte}
       SELECT COUNT(*)::int AS total
       FROM demand_requests dr
       ${where}`,
      values
    );
    const total = countResult.rows[0]?.total || 0;

    const listValues = [...values, limit, offset];
    const rows = await db.query(
      `${demandRequestsCte}
       SELECT
        dr.id,
        dr.request_id,
        dr.lead_id,
        dr.source,
        dr.full_name,
        dr.phone,
        dr.email,
        dr.preferred_locations,
        dr.listing_type,
        dr.max_budget,
        dr.requirements,
        dr.created_at,
        dr.lead_status,
        dr.lifecycle_stage,
        dr.metadata,
        dr.match_status
       FROM demand_requests dr
       ${where}
       ORDER BY dr.created_at DESC
       LIMIT $${values.length + 1}
       OFFSET $${values.length + 2}`,
      listValues
    );

    return res.json({
      ok: true,
      data: rows.rows,
      pagination: toPagination(total, page, limit)
    });
  } catch (error) {
    return next(error);
  }
});

function normalizeJsonList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function safeJsonb(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (_error) {
    return fallback;
  }
}

function advertisingMoney(value) {
  return `UGX ${Number(value || 0).toLocaleString('en-UG')}`;
}

async function notifyAdvertisingCampaignChange(campaign = {}, previous = {}) {
  const email = String(campaign.advertiser_email || '').trim();
  const phone = String(campaign.advertiser_phone || '').trim();
  const supportEmail = getSupportEmail();
  const whatsappUrl = getSupportWhatsappUrl();
  const becamePaid = campaign.payment_status === 'paid' && previous.payment_status !== 'paid';
  const becameLive = campaign.status === 'live' && previous.status !== 'live';

  if (!becamePaid && !becameLive) return;

  const lines = [
    `Hello ${campaign.advertiser_name || 'there'},`,
    '',
    becameLive
      ? 'Your makaug advertising campaign is now live.'
      : 'makaug has recorded your advertising payment.',
    '',
    `Campaign: ${campaign.campaign_name || '-'}`,
    `Package: ${campaign.package_label || campaign.package_key || '-'}`,
    `Status: ${campaign.status || '-'}`,
    `Payment: ${campaign.payment_status || '-'}`,
    `Paid Amount: ${advertisingMoney(campaign.paid_amount_ugx)}`,
    campaign.payment_reference ? `Payment Reference: ${campaign.payment_reference}` : '',
    campaign.starts_at ? `Starts: ${campaign.starts_at}` : '',
    campaign.ends_at ? `Ends: ${campaign.ends_at}` : '',
    campaign.creative_preview_url ? `Creative Preview: ${campaign.creative_preview_url}` : '',
    '',
    'makaug will track impressions, clicks, and leads while the campaign is active.',
    `Need help? WhatsApp: ${whatsappUrl}`,
    `Email: ${supportEmail}`
  ].filter(Boolean).join('\n');

  if (email) {
    await sendSupportEmail({
      to: email,
      subject: becameLive
        ? `[makaug Ads] Campaign live - ${campaign.campaign_name || 'Your ad'}`
        : `[makaug Ads] Payment received - ${campaign.campaign_name || 'Your ad'}`,
      text: lines
    });
  }

  if (phone) {
    await sendWhatsAppText({
      to: phone,
      body: [
        becameLive ? 'Your makaug ad is live.' : 'makaug has recorded your ad payment.',
        `Campaign: ${campaign.campaign_name || '-'}`,
        `Status: ${campaign.status || '-'}`,
        campaign.ends_at ? `Runs until: ${new Date(campaign.ends_at).toLocaleDateString('en-GB')}` : '',
        'We will keep tracking performance for you.'
      ].filter(Boolean).join('\n')
    });
  }
}

router.get('/advertising/packages', (_req, res) => {
  return res.json({ ok: true, data: getAdvertisingPackages() });
});

router.get('/advertising/rate-card', (_req, res) => {
  return res.json({ ok: true, data: getAdvertisingRateCard() });
});

router.get('/monetization/products', async (_req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT key, type, name, description, price, currency, billing, active, feature_flag, metadata, updated_at
       FROM products
       ORDER BY type ASC, key ASC`
    );
    return res.json({
      ok: true,
      marker: MONETIZATION_SPINE_MARKER,
      data: rows.rows
    });
  } catch (error) {
    if (['42P01', '42703'].includes(error.code)) {
      return res.json({ ok: true, marker: MONETIZATION_SPINE_MARKER, data: [], provider_missing: true });
    }
    return next(error);
  }
});

router.patch('/monetization/products/:key', async (req, res, next) => {
  try {
    const productKey = cleanText(req.params.key);
    const updates = [];
    const values = [];
    const add = (column, value, cast = '') => {
      values.push(value);
      updates.push(`${column} = $${values.length}${cast}`);
    };
    if (Object.prototype.hasOwnProperty.call(req.body, 'price')) {
      add('price', Math.max(0, Number(req.body.price) || 0));
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'currency')) {
      add('currency', cleanText(req.body.currency || 'UGX').toUpperCase().slice(0, 8) || 'UGX');
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'billing')) {
      add('billing', cleanText(req.body.billing || 'one_off').toLowerCase().slice(0, 40) || 'one_off');
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'active')) {
      add('active', parseBooleanLike(req.body.active, false));
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'description')) {
      add('description', cleanText(req.body.description || ''));
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'metadata')) {
      add('metadata', JSON.stringify(safeJsonb(req.body.metadata, {})), '::jsonb');
    }
    if (!productKey) return res.status(400).json({ ok: false, error: 'product key is required' });
    if (!updates.length) return res.status(400).json({ ok: false, error: 'No product updates provided' });

    values.push(productKey);
    const updated = await db.query(
      `UPDATE products
       SET ${updates.join(', ')},
           updated_at = NOW()
       WHERE key = $${values.length}
       RETURNING *`,
      values
    );
    if (!updated.rows.length) return res.status(404).json({ ok: false, error: 'Product not found' });
    await writeAudit('monetization_product_updated', { product_key: productKey }, adminActorId(req));
    return res.json({ ok: true, marker: MONETIZATION_SPINE_MARKER, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/advertising/placements', async (_req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT *
       FROM advertising_placements
       ORDER BY sort_order ASC, label ASC`
    );
    const data = mergePlacementRowsWithCatalog(rows.rows);
    return res.json({ ok: true, data });
  } catch (error) {
    if (['42P01', '42703'].includes(error.code) || String(error.message || '').includes('advertising_placements')) {
      return res.json({ ok: true, data: getAdvertisingPlacements() });
    }
    return next(error);
  }
});

router.patch('/advertising/placements/:key', async (req, res, next) => {
  try {
    const placementKey = String(req.params.key || '').trim();
    const updates = [];
    const values = [];
    const add = (column, value) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };

    if (Object.prototype.hasOwnProperty.call(req.body, 'is_active')) add('is_active', !!req.body.is_active);
    if (Object.prototype.hasOwnProperty.call(req.body, 'base_price_ugx')) add('base_price_ugx', Math.max(0, parseInt(req.body.base_price_ugx, 10) || 0));
    if (Object.prototype.hasOwnProperty.call(req.body, 'notes')) add('notes', String(req.body.notes || '').trim() || null);
    if (Object.prototype.hasOwnProperty.call(req.body, 'preview_image_url')) add('preview_image_url', String(req.body.preview_image_url || '').trim() || null);
    if (Object.prototype.hasOwnProperty.call(req.body, 'headline')) add('headline', String(req.body.headline || '').trim() || null);
    if (Object.prototype.hasOwnProperty.call(req.body, 'cta_label')) add('cta_label', String(req.body.cta_label || '').trim() || null);
    if (Object.prototype.hasOwnProperty.call(req.body, 'cta_url')) add('cta_url', String(req.body.cta_url || '').trim() || null);
    if (Object.prototype.hasOwnProperty.call(req.body, 'background_position')) add('background_position', String(req.body.background_position || '').trim() || null);
    if (Object.prototype.hasOwnProperty.call(req.body, 'copy_side')) {
      const copySide = String(req.body.copy_side || '').trim().toLowerCase();
      if (!['left', 'right'].includes(copySide)) {
        return res.status(400).json({ ok: false, error: 'copy_side must be left or right' });
      }
      add('copy_side', copySide);
    }

    if (!updates.length) return res.status(400).json({ ok: false, error: 'No placement updates provided' });

    values.push(placementKey);
    const updated = await db.query(
      `UPDATE advertising_placements
       SET ${updates.join(', ')},
           updated_at = NOW()
       WHERE key = $${values.length}
       RETURNING *`,
      values
    );
    if (!updated.rows.length) return res.status(404).json({ ok: false, error: 'Advertising placement not found' });
    await writeAudit('advertising_placement_updated', { placement_key: placementKey }, adminActorId(req));
    return res.json({ ok: true, data: mergePlacementWithCatalog(updated.rows[0]) });
  } catch (error) {
    return next(error);
  }
});

router.get('/advertising/summary', async (_req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT
        (SELECT COUNT(*)::int FROM advertising_inquiries WHERE status = 'new') AS new_inquiries,
        (SELECT COUNT(*)::int FROM advertising_inquiries WHERE status IN ('new','contacted','proposal_sent')) AS open_inquiries,
        (SELECT COUNT(*)::int FROM advertising_campaigns WHERE status = 'live') AS live_campaigns,
        (SELECT COUNT(*)::int FROM advertising_campaigns WHERE status IN ('draft','awaiting_payment','paid')) AS pipeline_campaigns,
        (SELECT COALESCE(SUM(paid_amount_ugx),0)::bigint FROM advertising_campaigns WHERE payment_status = 'paid') AS paid_revenue_ugx,
        (SELECT COALESCE(SUM(quoted_amount_ugx),0)::bigint FROM advertising_campaigns WHERE status NOT IN ('cancelled')) AS quoted_pipeline_ugx,
        (SELECT COALESCE(SUM(impressions),0)::bigint FROM advertising_campaigns) AS impressions,
        (SELECT COALESCE(SUM(clicks),0)::bigint FROM advertising_campaigns) AS clicks,
        (SELECT COALESCE(SUM(leads),0)::bigint FROM advertising_campaigns) AS leads,
        (SELECT COUNT(*)::int FROM advertising_placements WHERE is_active = true) AS active_placements,
        (SELECT COUNT(*)::int FROM advertising_placements WHERE is_premium = true AND is_active = true) AS premium_placements`
    );
    return res.json({ ok: true, data: rows.rows[0] || {} });
  } catch (error) {
    if (String(error.message || '').includes('advertising_placements')) {
      try {
        const rows = await db.query(
          `SELECT
            (SELECT COUNT(*)::int FROM advertising_inquiries WHERE status = 'new') AS new_inquiries,
            (SELECT COUNT(*)::int FROM advertising_inquiries WHERE status IN ('new','contacted','proposal_sent')) AS open_inquiries,
            (SELECT COUNT(*)::int FROM advertising_campaigns WHERE status = 'live') AS live_campaigns,
            (SELECT COUNT(*)::int FROM advertising_campaigns WHERE status IN ('draft','awaiting_payment','paid')) AS pipeline_campaigns,
            (SELECT COALESCE(SUM(paid_amount_ugx),0)::bigint FROM advertising_campaigns WHERE payment_status = 'paid') AS paid_revenue_ugx,
            (SELECT COALESCE(SUM(quoted_amount_ugx),0)::bigint FROM advertising_campaigns WHERE status NOT IN ('cancelled')) AS quoted_pipeline_ugx,
            (SELECT COALESCE(SUM(impressions),0)::bigint FROM advertising_campaigns) AS impressions,
            (SELECT COALESCE(SUM(clicks),0)::bigint FROM advertising_campaigns) AS clicks,
            (SELECT COALESCE(SUM(leads),0)::bigint FROM advertising_campaigns) AS leads`
        );
        return res.json({ ok: true, data: { ...(rows.rows[0] || {}), active_placements: 0, premium_placements: 0 } });
      } catch (fallbackError) {
        return next(fallbackError);
      }
    }
    return next(error);
  }
});

router.get('/advertising/inquiries', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const status = String(req.query.status || '').trim().toLowerCase();
    const search = String(req.query.search || '').trim();
    const values = [];
    const filters = [];

    if (status) {
      values.push(status);
      filters.push(`status = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      filters.push(`(
        full_name ILIKE $${values.length}
        OR COALESCE(business_name, '') ILIKE $${values.length}
        OR COALESCE(email, '') ILIKE $${values.length}
        OR COALESCE(phone, '') ILIKE $${values.length}
        OR COALESCE(message, '') ILIKE $${values.length}
      )`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM advertising_inquiries ${where}`, values);
    const total = countResult.rows[0]?.total || 0;
    const rows = await db.query(
      `SELECT *
       FROM advertising_inquiries
       ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length + 1}
       OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );

    return res.json({ ok: true, data: rows.rows, pagination: toPagination(total, page, limit) });
  } catch (error) {
    return next(error);
  }
});

router.patch('/advertising/inquiries/:id', async (req, res, next) => {
  try {
    const inquiryId = req.params.id;
    const allowedStatuses = ['new', 'contacted', 'proposal_sent', 'won', 'lost', 'archived'];
    const status = req.body.status ? String(req.body.status).trim().toLowerCase() : undefined;
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: 'Invalid inquiry status' });
    }

    const updates = [];
    const values = [];
    const add = (column, value, cast = '') => {
      values.push(value);
      updates.push(`${column} = $${values.length}${cast}`);
    };

    if (status) add('status', status);
    if (Object.prototype.hasOwnProperty.call(req.body, 'internal_notes')) add('internal_notes', String(req.body.internal_notes || '').trim() || null);
    if (Object.prototype.hasOwnProperty.call(req.body, 'estimated_value_ugx')) add('estimated_value_ugx', Math.max(0, parseInt(req.body.estimated_value_ugx, 10) || 0));

    if (!updates.length) {
      return res.status(400).json({ ok: false, error: 'No updates provided' });
    }

    values.push(inquiryId);
    const updated = await db.query(
      `UPDATE advertising_inquiries
       SET ${updates.join(', ')},
           updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING *`,
      values
    );

    if (!updated.rows.length) return res.status(404).json({ ok: false, error: 'Advertising inquiry not found' });
    await writeAudit('advertising_inquiry_updated', { inquiry_id: inquiryId, status }, adminActorId(req));
    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/advertising/campaigns', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const status = String(req.query.status || '').trim().toLowerCase();
    const values = [];
    const where = status ? 'WHERE c.status = $1' : '';
    if (status) values.push(status);

    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM advertising_campaigns c ${where}`, values);
    const total = countResult.rows[0]?.total || 0;
    const rows = await db.query(
      `SELECT c.*, i.full_name AS inquiry_full_name, i.business_name AS inquiry_business_name
       FROM advertising_campaigns c
       LEFT JOIN advertising_inquiries i ON i.id = c.inquiry_id
       ${where}
       ORDER BY c.created_at DESC
       LIMIT $${values.length + 1}
       OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );

    return res.json({ ok: true, data: rows.rows, pagination: toPagination(total, page, limit) });
  } catch (error) {
    return next(error);
  }
});

router.post('/advertising/campaigns', async (req, res, next) => {
  try {
    const inquiryId = String(req.body.inquiry_id || '').trim() || null;
    let inquiry = null;
    if (inquiryId) {
      const found = await db.query(`SELECT * FROM advertising_inquiries WHERE id = $1`, [inquiryId]);
      inquiry = found.rows[0] || null;
      if (!inquiry) return res.status(404).json({ ok: false, error: 'Advertising inquiry not found' });
    }

    const packageKey = String(req.body.package_key || req.body.package || '').trim().toLowerCase();
    const pkg = findAdvertisingPackage(packageKey) || summarizeAdvertisingPackageKeys(safeJsonb(inquiry?.product_interests, [])).at(0) || null;
    const advertiserName = String(req.body.advertiser_name || inquiry?.business_name || inquiry?.full_name || '').trim();
    const campaignName = String(req.body.campaign_name || req.body.name || `${advertiserName || 'Advertiser'} campaign`).trim();
    if (!advertiserName) return res.status(400).json({ ok: false, error: 'advertiser_name is required' });
    if (!campaignName) return res.status(400).json({ ok: false, error: 'campaign_name is required' });

    const selectedPlacements = normalizeJsonList(req.body.placements);
    const placements = selectedPlacements.length
      ? selectedPlacements
      : (pkg?.placement_keys || pkg?.placements || []);
    const inferredTargetPages = placements
      .map((key) => findAdvertisingPlacement(key)?.page_key)
      .filter(Boolean);
    const targetPages = normalizeJsonList(req.body.target_pages || req.body.pages).length
      ? normalizeJsonList(req.body.target_pages || req.body.pages)
      : inferredTargetPages;
    const placementQuote = buildAdvertisingQuoteBreakdown({
      placementKeys: placements,
      durationDays: req.body.duration_days || pkg?.duration_days || inquiry?.desired_duration_days || 7
    });
    const packageQuote = buildAdvertisingQuoteBreakdown({
      packageKeys: pkg?.key ? [pkg.key] : safeJsonb(inquiry?.product_interests, [])
    });
    const quotedAmount = Math.max(
      0,
      parseInt(req.body.quoted_amount_ugx, 10)
        || Number(packageQuote.total_ugx || 0)
        || Number(placementQuote.total_ugx || 0)
        || Number(pkg?.price_ugx || estimateAdvertisingQuote(safeJsonb(inquiry?.product_interests, [])))
        || 0
    );
    const targetLocations = normalizeJsonList(req.body.target_locations).length
      ? normalizeJsonList(req.body.target_locations)
      : safeJsonb(inquiry?.target_locations, []);
    const targetListingTypes = normalizeJsonList(req.body.target_listing_types).length
      ? normalizeJsonList(req.body.target_listing_types)
      : safeJsonb(inquiry?.target_listing_types, []);
    const audienceSegments = normalizeJsonList(req.body.audience_segments).length
      ? normalizeJsonList(req.body.audience_segments)
      : safeJsonb(inquiry?.audience_segments, []);
    const durationDays = Math.max(0, parseInt(req.body.duration_days, 10) || Number(pkg?.duration_days || inquiry?.desired_duration_days || 7));
    const reportCadence = ['none', 'daily', 'weekly', 'post_campaign', 'dashboard'].includes(String(req.body.report_cadence || '').trim())
      ? String(req.body.report_cadence).trim()
      : 'weekly';
    const approvalStatus = ['draft', 'sent', 'approved', 'changes_requested', 'rejected'].includes(String(req.body.advertiser_approval_status || '').trim())
      ? String(req.body.advertiser_approval_status).trim()
      : 'draft';
    const headline = String(req.body.creative_headline || '').trim();
    const body = String(req.body.creative_body || '').trim();
    const cta = String(req.body.creative_cta || 'View on makaug').trim();
    const ctaUrl = String(req.body.creative_cta_url || '').trim();

    const inserted = await db.query(
      `INSERT INTO advertising_campaigns (
        inquiry_id,
        advertiser_name,
        advertiser_email,
        advertiser_phone,
        campaign_name,
        package_key,
        package_label,
        placements,
        target_locations,
        target_listing_types,
        audience_segments,
        linked_property_id,
        creative_brief,
        logo_url,
        creative_preview_url,
        ai_copy,
        advertiser_approval_status,
        report_cadence,
        target_pages,
        pricing_model,
        quoted_amount_ugx,
        status,
        starts_at,
        ends_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16::jsonb,$17,$18,$19::jsonb,$20,$21,'draft',NULL,NULL)
      RETURNING *`,
      [
        inquiryId,
        advertiserName,
        String(req.body.advertiser_email || inquiry?.email || '').trim() || null,
        String(req.body.advertiser_phone || inquiry?.phone || '').trim() || null,
        campaignName,
        pkg?.key || packageKey || null,
        pkg?.label || null,
        JSON.stringify(placements),
        JSON.stringify(targetLocations),
        JSON.stringify(targetListingTypes),
        JSON.stringify(audienceSegments),
        String(req.body.linked_property_id || inquiry?.linked_property_id || '').trim() || null,
        String(req.body.creative_brief || inquiry?.message || '').trim() || null,
        String(req.body.logo_url || '').trim() || null,
        String(req.body.creative_preview_url || '').trim() || null,
        JSON.stringify({
          headline: headline || `${pkg?.label || 'makaug advertising'} for ${targetLocations.join(', ') || 'Uganda'}`,
          body: body || pkg?.description || 'Reach active property seekers on makaug.',
          call_to_action: cta || 'View on makaug',
          cta_url: ctaUrl || null
        }),
        approvalStatus,
        reportCadence,
        JSON.stringify(targetPages),
        pkg?.pricing_model || 'fixed_days',
        quotedAmount
      ]
    );

    if (inquiryId) {
      await db.query(`UPDATE advertising_inquiries SET status = 'proposal_sent', updated_at = NOW() WHERE id = $1`, [inquiryId]);
    }

    await writeAudit('advertising_campaign_created', { campaign_id: inserted.rows[0].id, inquiry_id: inquiryId }, adminActorId(req));
    return res.status(201).json({ ok: true, data: { ...inserted.rows[0], duration_days: durationDays } });
  } catch (error) {
    return next(error);
  }
});

router.patch('/advertising/campaigns/:id', async (req, res, next) => {
  try {
    const campaignId = req.params.id;
    const allowedStatuses = ['draft', 'awaiting_payment', 'paid', 'live', 'paused', 'completed', 'cancelled'];
    const allowedPaymentStatuses = ['unpaid', 'invoiced', 'paid', 'refunded', 'waived'];
    const allowedCreativeStatuses = ['brief_needed', 'draft', 'review', 'approved', 'live_asset'];
    const allowedApprovalStatuses = ['draft', 'sent', 'approved', 'changes_requested', 'rejected'];
    const allowedReportCadences = ['none', 'daily', 'weekly', 'post_campaign', 'dashboard'];
    const updates = [];
    const values = [];
    const add = (column, value, cast = '') => {
      values.push(value);
      updates.push(`${column} = $${values.length}${cast}`);
    };
    const previousResult = await db.query(
      `SELECT *
       FROM advertising_campaigns
       WHERE id = $1
       LIMIT 1`,
      [campaignId]
    );
    const previousCampaign = previousResult.rows[0] || null;
    if (!previousCampaign) return res.status(404).json({ ok: false, error: 'Advertising campaign not found' });

    if (req.body.status) {
      const status = String(req.body.status).trim().toLowerCase();
      if (!allowedStatuses.includes(status)) return res.status(400).json({ ok: false, error: 'Invalid campaign status' });
      const effectivePaymentStatus = String(req.body.payment_status || previousCampaign.payment_status || '').trim().toLowerCase();
      const effectiveApprovalStatus = String(req.body.advertiser_approval_status || previousCampaign.advertiser_approval_status || '').trim().toLowerCase();
      if (status === 'live' && effectiveApprovalStatus !== 'approved') {
        return res.status(409).json({ ok: false, error: 'Advertiser approval is required before a campaign can go live.' });
      }
      if (status === 'live' && !['paid', 'waived'].includes(effectivePaymentStatus)) {
        return res.status(409).json({ ok: false, error: 'Paid or waived payment status is required before a campaign can go live.' });
      }
      add('status', status);
      if (status === 'live') add('activated_at', new Date().toISOString(), '::timestamptz');
    }
    if (req.body.payment_status) {
      const status = String(req.body.payment_status).trim().toLowerCase();
      if (!allowedPaymentStatuses.includes(status)) return res.status(400).json({ ok: false, error: 'Invalid payment status' });
      add('payment_status', status);
    }
    if (req.body.creative_status) {
      const status = String(req.body.creative_status).trim().toLowerCase();
      if (!allowedCreativeStatuses.includes(status)) return res.status(400).json({ ok: false, error: 'Invalid creative status' });
      add('creative_status', status);
    }
    if (req.body.advertiser_approval_status) {
      const status = String(req.body.advertiser_approval_status).trim().toLowerCase();
      if (!allowedApprovalStatuses.includes(status)) return res.status(400).json({ ok: false, error: 'Invalid advertiser approval status' });
      add('advertiser_approval_status', status);
    }
    if (req.body.report_cadence) {
      const cadence = String(req.body.report_cadence).trim().toLowerCase();
      if (!allowedReportCadences.includes(cadence)) return res.status(400).json({ ok: false, error: 'Invalid report cadence' });
      add('report_cadence', cadence);
    }

    [
      'campaign_name',
      'payment_reference',
      'payment_method',
      'payment_url',
      'creative_brief',
      'logo_url',
      'creative_preview_url'
    ].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) add(field, String(req.body[field] || '').trim() || null);
    });
    if (Object.prototype.hasOwnProperty.call(req.body, 'quoted_amount_ugx')) add('quoted_amount_ugx', Math.max(0, parseInt(req.body.quoted_amount_ugx, 10) || 0));
    if (Object.prototype.hasOwnProperty.call(req.body, 'paid_amount_ugx')) add('paid_amount_ugx', Math.max(0, parseInt(req.body.paid_amount_ugx, 10) || 0));
    if (Object.prototype.hasOwnProperty.call(req.body, 'starts_at')) add('starts_at', String(req.body.starts_at || '').trim() || null, '::timestamptz');
    if (Object.prototype.hasOwnProperty.call(req.body, 'ends_at')) add('ends_at', String(req.body.ends_at || '').trim() || null, '::timestamptz');
    if (Object.prototype.hasOwnProperty.call(req.body, 'impressions')) add('impressions', Math.max(0, parseInt(req.body.impressions, 10) || 0));
    if (Object.prototype.hasOwnProperty.call(req.body, 'clicks')) add('clicks', Math.max(0, parseInt(req.body.clicks, 10) || 0));
    if (Object.prototype.hasOwnProperty.call(req.body, 'leads')) add('leads', Math.max(0, parseInt(req.body.leads, 10) || 0));
    if (Object.prototype.hasOwnProperty.call(req.body, 'placements')) add('placements', JSON.stringify(normalizeJsonList(req.body.placements)), '::jsonb');
    if (Object.prototype.hasOwnProperty.call(req.body, 'target_pages')) add('target_pages', JSON.stringify(normalizeJsonList(req.body.target_pages)), '::jsonb');
    if (
      Object.prototype.hasOwnProperty.call(req.body, 'creative_headline')
      || Object.prototype.hasOwnProperty.call(req.body, 'creative_body')
      || Object.prototype.hasOwnProperty.call(req.body, 'creative_cta')
      || Object.prototype.hasOwnProperty.call(req.body, 'creative_cta_url')
    ) {
      const previousAiCopy = safeJsonb(previousCampaign.ai_copy, {});
      add('ai_copy', JSON.stringify({
        ...previousAiCopy,
        headline: Object.prototype.hasOwnProperty.call(req.body, 'creative_headline') ? String(req.body.creative_headline || '').trim() : previousAiCopy.headline,
        body: Object.prototype.hasOwnProperty.call(req.body, 'creative_body') ? String(req.body.creative_body || '').trim() : previousAiCopy.body,
        call_to_action: Object.prototype.hasOwnProperty.call(req.body, 'creative_cta') ? String(req.body.creative_cta || 'View on makaug').trim() : (previousAiCopy.call_to_action || 'View on makaug'),
        cta_url: Object.prototype.hasOwnProperty.call(req.body, 'creative_cta_url') ? String(req.body.creative_cta_url || '').trim() || null : (previousAiCopy.cta_url || null)
      }), '::jsonb');
    }

    if (!updates.length) return res.status(400).json({ ok: false, error: 'No updates provided' });

    values.push(campaignId);
    const updated = await db.query(
      `UPDATE advertising_campaigns
       SET ${updates.join(', ')},
           updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING *`,
      values
    );
    if (!updated.rows.length) return res.status(404).json({ ok: false, error: 'Advertising campaign not found' });
    try {
      await notifyAdvertisingCampaignChange(updated.rows[0], previousCampaign);
    } catch (notifyError) {
      await writeAudit('advertising_campaign_notification_failed', {
        campaign_id: campaignId,
        error: notifyError.message || 'notification_failed'
      }, adminActorId(req));
    }
    await writeAudit('advertising_campaign_updated', { campaign_id: campaignId }, adminActorId(req));
    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/users/:id', async (req, res, next) => {
  try {
    const status = req.body.status ? String(req.body.status).trim().toLowerCase() : undefined;
    const role = req.body.role ? String(req.body.role).trim().toLowerCase() : undefined;
    const phoneVerified = typeof req.body.phone_verified === 'boolean' ? req.body.phone_verified : undefined;

    const allowedStatuses = ['active', 'suspended', 'deleted'];
    const allowedRoles = ['buyer_renter', 'property_owner', 'agent_broker', 'field_agent', 'moderator', 'admin'];

    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: 'Invalid status value' });
    }
    if (role && !allowedRoles.includes(role)) {
      return res.status(400).json({ ok: false, error: 'Invalid role value' });
    }
    if (status === undefined && role === undefined && phoneVerified === undefined) {
      return res.status(400).json({ ok: false, error: 'No supported fields to update' });
    }

    const setParts = [];
    const values = [req.params.id];
    let idx = 2;

    if (status !== undefined) {
      setParts.push(`status = $${idx}`);
      values.push(status);
      idx += 1;
    }
    if (role !== undefined) {
      setParts.push(`role = $${idx}`);
      values.push(role);
      idx += 1;
    }
    if (phoneVerified !== undefined) {
      setParts.push(`phone_verified = $${idx}`);
      values.push(phoneVerified);
      idx += 1;
    }

    const updated = await db.query(
      `UPDATE users
       SET ${setParts.join(', ')}
       WHERE id = $1
       RETURNING id, first_name, last_name, phone, email, role, status, phone_verified, updated_at`,
      values
    );

    if (!updated.rows.length) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    await writeAudit('admin_user_updated', {
      user_id: req.params.id,
      status: status || null,
      role: role || null,
      phone_verified: phoneVerified
    });

    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/field-agents/provision', async (req, res, next) => {
  try {
    const firstName = cleanText(req.body.first_name);
    const lastName = cleanText(req.body.last_name || req.body.surname);
    const email = normalizeEmail(req.body.email);
    const phone = normalizeFieldAgentContactPhone(req.body.phone);
    const whatsappPhone = normalizeFieldAgentContactPhone(req.body.whatsapp_phone || req.body.whatsapp || req.body.phone);
    const idNumber = cleanText(req.body.id_number || req.body.national_id_number || req.body.field_agent_id_number).slice(0, 80);
    const pin = cleanText(req.body.pin);
    const territory = cleanText(req.body.territory);
    const requestedFieldAgentCode = normalizeFieldAgentCode(req.body.field_agent_code || req.body.employee_number);
    const payoutRateUgx = toNullableInt(req.body.payout_rate_ugx) || FIELD_AGENT_DEFAULT_PAYOUT_UGX;
    const status = cleanText(req.body.status || 'active').toLowerCase();
    const preferredLanguage = cleanText(req.body.preferred_language || 'en').toLowerCase();
    const notes = cleanText(req.body.notes);
	    const supportPhone = normalizeFieldAgentContactPhone(req.body.support_phone || process.env.SUPPORT_WHATSAPP || process.env.SUPPORT_PHONE || '0760112587');
	    const actorId = adminActorId(req);
	    let idDocument = cleanFieldAgentUpload(req.body.id_document || req.body.id_document_file, 'Field Agent ID document');
	    let signedContract = cleanFieldAgentUpload(req.body.signed_contract || req.body.contract || req.body.signed_contract_file, 'Field Agent signed contract');

    if (!firstName || !lastName || !email || !idNumber || !phone || !whatsappPhone || !pin) {
      return res.status(400).json({ ok: false, error: 'First name, surname, email, ID number, phone, WhatsApp number, and 4-digit PIN are required' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ ok: false, error: 'Enter a valid email address' });
    }
    if (!isValidPhone(phone)) {
      return res.status(400).json({
        ok: false,
        error: 'Enter a full phone number with country code, e.g. +256701123456 or +447757773202'
      });
    }
    if (!isValidPhone(whatsappPhone)) {
      return res.status(400).json({
        ok: false,
        error: 'Enter a full WhatsApp number with country code, e.g. +256701123456 or +447757773202'
      });
    }
    if (!/^\d{4}$/.test(pin)) {
      return res.status(400).json({ ok: false, error: 'Field Agent PIN must be exactly 4 digits' });
    }
    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ ok: false, error: 'Field Agent status must be active or suspended' });
    }

    const existing = await db.query(
      `SELECT id, profile_data
       FROM users
       WHERE phone = $1
          OR LOWER(email) = LOWER($2)
          OR COALESCE(profile_data->>'field_agent_whatsapp', '') = $3
          OR COALESCE(profile_data->>'field_agent_id_number', '') = $4
       LIMIT 1`,
      [phone, email, whatsappPhone, idNumber]
    );
    const existingProfile = existing.rows[0]?.profile_data && typeof existing.rows[0].profile_data === 'object'
      ? existing.rows[0].profile_data
      : {};
	    const existingCode = normalizeFieldAgentCode(existingProfile.field_agent_code || existingProfile.employee_number);
	    const reusableExistingCode = existingCode && !isLegacyZeroFieldAgentCode(existingCode) ? existingCode : '';
	    const reusableRequestedCode = requestedFieldAgentCode && !isLegacyZeroFieldAgentCode(requestedFieldAgentCode) ? requestedFieldAgentCode : '';
	    const generatedCode = reusableExistingCode || reusableRequestedCode || await generateNextFieldAgentCode();
		    if ((req.body.field_agent_code || req.body.employee_number) && !reusableRequestedCode) {
		      return res.status(400).json({ ok: false, error: 'Field Agent ID must look like FA-7301, or leave it blank to auto-generate' });
	    }
		    const conflictQuery = existing.rows.length
      ? await db.query(
        `SELECT id
         FROM users
         WHERE role = 'field_agent'
           AND id <> $2
           AND (
             UPPER(COALESCE(profile_data->>'field_agent_code', '')) = $1
             OR UPPER(COALESCE(profile_data->>'employee_number', '')) = $1
           )
         LIMIT 1`,
        [generatedCode, existing.rows[0].id]
      )
      : await db.query(
        `SELECT id
         FROM users
         WHERE role = 'field_agent'
           AND (
             UPPER(COALESCE(profile_data->>'field_agent_code', '')) = $1
             OR UPPER(COALESCE(profile_data->>'employee_number', '')) = $1
           )
         LIMIT 1`,
        [generatedCode]
      );
	    if (conflictQuery.rows.length) {
	      return res.status(409).json({ ok: false, error: 'Field Agent ID is already assigned' });
	    }
	    idDocument = await prepareUploadObjectForStorage(idDocument, {
	      keyPrefix: `field-agents/${generatedCode}/documents`,
	      isPrivate: true,
	      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
	      maxBytes: FIELD_AGENT_UPLOAD_MAX_BYTES,
	      label: 'Field Agent ID document'
	    });
	    signedContract = await prepareUploadObjectForStorage(signedContract, {
	      keyPrefix: `field-agents/${generatedCode}/contracts`,
	      isPrivate: true,
	      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
	      maxBytes: FIELD_AGENT_UPLOAD_MAX_BYTES,
	      label: 'Field Agent signed contract'
	    });
	    const passwordHash = await bcrypt.hash(pin, 12);
    const profileData = {
      ...existingProfile,
      audience: 'field_agent',
      account_kind: 'field_agent',
      field_agent_application_status: 'approved',
      field_agent_code: generatedCode,
      employee_number: generatedCode,
      field_agent_id_number: idNumber,
      national_id_number: idNumber,
      field_agent_whatsapp: whatsappPhone,
      whatsapp_phone: whatsappPhone,
      field_agent_territory: territory || existingProfile.field_agent_territory || '',
      payout_rate_ugx: payoutRateUgx,
      payout_frequency: 'weekly',
      payout_day: FIELD_AGENT_PAYOUT_DAY,
      payout_rule: `${FIELD_AGENT_DEFAULT_PAYOUT_UGX} UGX per approved listing, paid every ${FIELD_AGENT_PAYOUT_DAY} based on previous week approvals`,
      next_payout_source: 'admin_set',
      field_agent_support_phone: supportPhone || existingProfile.field_agent_support_phone || '',
	      field_agent_notes: notes || existingProfile.field_agent_notes || '',
	      field_agent_pin_set: true,
	      field_agent_pin_last_set_at: new Date().toISOString(),
	      manual_review_required: true,
	      approved_by_admin: true,
	      ...(idDocument ? {
	        field_agent_id_document: idDocument,
	        field_agent_id_document_uploaded_at: idDocument.uploaded_at
	      } : {}),
	      ...(signedContract ? {
	        field_agent_signed_contract: signedContract,
	        field_agent_signed_contract_uploaded_at: signedContract.uploaded_at
	      } : {})
	    };

    let saved;
    if (existing.rows.length) {
      const updated = await db.query(
        `UPDATE users
         SET first_name = $2,
             last_name = $3,
             phone = $4,
             email = $5,
             role = 'field_agent',
             password_hash = $6,
             phone_verified = TRUE,
             status = $7,
             preferred_contact_channel = 'whatsapp',
             preferred_language = $8,
             profile_data = COALESCE(profile_data, '{}'::jsonb) || $9::jsonb,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, first_name, last_name, phone, email, role, status, phone_verified, preferred_language, profile_data, created_at, updated_at`,
        [
          existing.rows[0].id,
          firstName,
          lastName,
          phone,
          email,
          passwordHash,
          status,
          ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm'].includes(preferredLanguage) ? preferredLanguage : 'en',
          JSON.stringify(profileData)
        ]
      );
      saved = updated.rows[0];
    } else {
      const inserted = await db.query(
        `INSERT INTO users (
           first_name,
           last_name,
           phone,
           email,
           role,
           password_hash,
           phone_verified,
           status,
           marketing_opt_in,
           weekly_tips_opt_in,
           preferred_contact_channel,
           preferred_language,
           profile_data
         ) VALUES ($1,$2,$3,$4,'field_agent',$5,TRUE,$6,FALSE,TRUE,'whatsapp',$7,$8::jsonb)
         RETURNING id, first_name, last_name, phone, email, role, status, phone_verified, preferred_language, profile_data, created_at, updated_at`,
        [
          firstName,
          lastName,
          phone,
          email,
          passwordHash,
          status,
          ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm'].includes(preferredLanguage) ? preferredLanguage : 'en',
          JSON.stringify(profileData)
        ]
      );
      saved = inserted.rows[0];
    }

    await writeAudit('field_agent_provisioned', {
      user_id: saved.id,
      email,
      phone_masked: phone.replace(/(\d{4})\d+(\d{3})$/, '$1***$2'),
      whatsapp_masked: whatsappPhone.replace(/(\d{4})\d+(\d{3})$/, '$1***$2'),
	      field_agent_code: generatedCode,
	      employee_number: generatedCode,
	      id_number_saved: Boolean(idNumber),
	      id_document_uploaded: Boolean(idDocument),
	      signed_contract_uploaded: Boolean(signedContract),
	      pin_set: true
	    }, actorId);

    await logNotification(db, {
      userId: saved.id,
      recipientPhone: whatsappPhone || phone,
      recipientEmail: email,
      channel: 'in_app',
      type: 'field_agent_account_provisioned',
      status: 'logged',
      payloadSummary: {
        message: 'Field Agent account provisioned by makaug admin',
        field_agent_code: generatedCode,
        employee_number: generatedCode,
        login_identifier_hint: 'Use Field Agent ID and the admin-issued 4-digit PIN'
      }
    });

    const siteUrl = String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://makaug.com').replace(/\/$/, '');
    const dashboardUrl = `${siteUrl}/field-agent-dashboard`;
    const supportUrl = buildManualWhatsAppUrl
      ? buildManualWhatsAppUrl(supportPhone || phone, `Hi makaug.com Operations, this is ${firstName} (${generatedCode}). I need Field Agent support.`)
      : getSupportWhatsappUrl();
    const emailPayload = buildFieldAgentProvisionEmail({
      firstName,
      fieldAgentCode: generatedCode,
      pin,
      territory: profileData.field_agent_territory || 'Uganda',
      payoutRateUgx,
      dashboardUrl,
      supportUrl
    });
    let emailDelivery = { sent: false, reason: 'email_provider_missing' };
    if (emailProviderConfigured()) {
      emailDelivery = await sendSupportEmail({
        to: email,
        subject: `Your makaug.com Field Agent ID ${generatedCode}`,
        text: emailPayload.text,
        html: emailPayload.html
      });
    }
    const emailStatus = emailProviderConfigured()
      ? notificationStatusFromDelivery(emailDelivery)
      : 'provider_missing';
    await logEmailEvent(db, {
      eventType: 'field_agent_registered',
      recipientUserId: saved.id,
      recipientEmail: email,
      recipientRole: 'field_agent',
      templateKey: 'field_agent_registered',
      subject: `Your makaug.com Field Agent ID ${generatedCode}`,
      language: preferredLanguage || 'en',
      status: emailStatus,
      provider: emailDelivery.provider || null,
      providerMessageId: emailDelivery.id || null,
      failureReason: emailDelivery.error || emailDelivery.reason || null,
      sentAt: emailDelivery.sent ? new Date() : null
    });
    await logNotification(db, {
      userId: saved.id,
      recipientEmail: email,
      channel: 'email',
      type: 'field_agent_registered_email',
      status: emailStatus,
      failureReason: emailDelivery.error || emailDelivery.reason || null,
      payloadSummary: {
        field_agent_code: generatedCode,
        pin_delivered_by_email: Boolean(emailDelivery.sent),
        provider_configured: emailProviderConfigured()
      }
    });

    const whatsappMessage = [
      `Hello ${firstName}, welcome aboard as a makaug.com Field Agent.`,
      `Your Field Agent ID is ${generatedCode}.`,
      'Please check your email for your private 4-digit PIN.',
      `Open your dashboard: ${dashboardUrl}`,
      'Use your Field Agent ID on owner listings so approved properties count toward your payout.'
    ].join('\n');
    const whatsappDelivery = await sendWhatsAppText({ to: whatsappPhone || phone, body: whatsappMessage });
    const whatsappStatus = notificationStatusFromDelivery(whatsappDelivery);
    await logWhatsAppMessage(db, {
      userId: saved.id,
      recipientPhone: whatsappPhone || phone,
      templateKey: 'field_agent_registered',
      messageType: 'field_agent_onboarding',
      language: preferredLanguage || 'en',
      status: whatsappStatus,
      failureReason: whatsappDelivery.error || whatsappDelivery.reason || null,
      sentAt: whatsappDelivery.sent ? new Date() : null
    });
    await logNotification(db, {
      userId: saved.id,
      recipientPhone: whatsappPhone || phone,
      recipientEmail: email,
      channel: 'whatsapp',
      type: 'field_agent_registered_whatsapp',
      status: whatsappStatus,
      failureReason: whatsappDelivery.error || whatsappDelivery.reason || null,
      payloadSummary: {
        field_agent_code: generatedCode,
        pin_in_whatsapp: false,
        delivery_provider: whatsappDelivery.provider || null
      }
    });

	    return res.status(existing.rows.length ? 200 : 201).json({
	      ok: true,
	      data: {
        id: saved.id,
        first_name: saved.first_name,
        last_name: saved.last_name,
        email: saved.email,
        phone: saved.phone,
        whatsapp_phone: saved.profile_data?.field_agent_whatsapp || whatsappPhone,
        role: saved.role,
        status: saved.status,
        phone_verified: saved.phone_verified,
        field_agent_code: saved.profile_data?.field_agent_code,
        employee_number: saved.profile_data?.employee_number,
        payout_rate_ugx: saved.profile_data?.payout_rate_ugx,
        pin_set: true
      }
    });
	  } catch (error) {
	    return next(error);
	  }
	});

router.post('/field-agents/:id/documents', async (req, res, next) => {
  try {
    const userResult = await db.query(
      `SELECT id, first_name, last_name, phone, email, role, status, preferred_language, profile_data
       FROM users
       WHERE id = $1 AND role = 'field_agent'
       LIMIT 1`,
      [req.params.id]
    );
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ ok: false, error: 'Field Agent not found' });

    const profile = user.profile_data && typeof user.profile_data === 'object' ? user.profile_data : {};
    let idDocument = cleanFieldAgentUpload(req.body.id_document || req.body.id_document_file, 'Field Agent ID document');
    let signedContract = cleanFieldAgentUpload(req.body.signed_contract || req.body.contract || req.body.signed_contract_file, 'Field Agent signed contract');
    if (!idDocument && !signedContract) {
      return res.status(400).json({ ok: false, error: 'Upload an ID document or signed contract first' });
    }
    const fieldAgentCode = normalizeFieldAgentCode(profile.field_agent_code || profile.employee_number || req.params.id);
    idDocument = await prepareUploadObjectForStorage(idDocument, {
      keyPrefix: `field-agents/${fieldAgentCode || req.params.id}/documents`,
      isPrivate: true,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      maxBytes: FIELD_AGENT_UPLOAD_MAX_BYTES,
      label: 'Field Agent ID document'
    });
    signedContract = await prepareUploadObjectForStorage(signedContract, {
      keyPrefix: `field-agents/${fieldAgentCode || req.params.id}/contracts`,
      isPrivate: true,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      maxBytes: FIELD_AGENT_UPLOAD_MAX_BYTES,
      label: 'Field Agent signed contract'
    });

    const patch = {
      ...(idDocument ? {
        field_agent_id_document: idDocument,
        field_agent_id_document_uploaded_at: idDocument.uploaded_at
      } : {}),
      ...(signedContract ? {
        field_agent_signed_contract: signedContract,
        field_agent_signed_contract_uploaded_at: signedContract.uploaded_at
      } : {})
    };

    const updated = await db.query(
      `UPDATE users
       SET profile_data = COALESCE(profile_data, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, first_name, last_name, email, phone, role, status, profile_data, updated_at`,
      [user.id, JSON.stringify(patch)]
    );

    await writeAudit('field_agent_documents_updated', {
      user_id: user.id,
      field_agent_code: profile.field_agent_code || profile.employee_number || null,
      id_document_uploaded: Boolean(idDocument),
      signed_contract_uploaded: Boolean(signedContract)
    }, adminActorId(req));

    await logNotification(db, {
      userId: user.id,
      recipientPhone: user.phone,
      recipientEmail: user.email,
      channel: 'in_app',
      type: 'field_agent_documents_updated',
      status: 'logged',
      payloadSummary: {
        id_document_uploaded: Boolean(idDocument),
        signed_contract_uploaded: Boolean(signedContract)
      }
    });

    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/field-agents/:id/payment', async (req, res, next) => {
  try {
    const userResult = await db.query(
      `SELECT id, first_name, last_name, phone, email, role, status, preferred_language, profile_data
       FROM users
       WHERE id = $1 AND role = 'field_agent'
       LIMIT 1`,
      [req.params.id]
    );
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ ok: false, error: 'Field Agent not found' });

    const amountUgx = toNullableInt(req.body.amount_ugx || req.body.amount);
    const paymentReference = cleanText(req.body.payment_reference || req.body.reference).slice(0, 120);
    const paymentMethod = cleanText(req.body.payment_method || 'mobile_money').slice(0, 80);
    const paidAt = cleanText(req.body.paid_at || new Date().toISOString().slice(0, 10)).slice(0, 40);
    const periodStart = cleanText(req.body.period_start || '').slice(0, 40);
    const periodEnd = cleanText(req.body.period_end || '').slice(0, 40);
    const notes = cleanText(req.body.notes || '').slice(0, 800);
    let receipt = cleanFieldAgentUpload(req.body.receipt || req.body.receipt_file, 'Field Agent payment receipt');
    const receiptUrl = cleanText(req.body.receipt_url || '').slice(0, 2000);
    if (!receipt && receiptUrl) {
      receipt = cleanFieldAgentUpload({ url: receiptUrl, name: 'Payment receipt link' }, 'Field Agent payment receipt');
    }

    if (!amountUgx || amountUgx <= 0) {
      return res.status(400).json({ ok: false, error: 'Payment amount is required' });
    }
    if (!paymentReference) {
      return res.status(400).json({ ok: false, error: 'Payment reference is required' });
    }

    const profile = user.profile_data && typeof user.profile_data === 'object' ? user.profile_data : {};
    const fieldAgentCode = profile.field_agent_code || profile.employee_number || '';
    receipt = await prepareUploadObjectForStorage(receipt, {
      keyPrefix: `field-agents/${normalizeFieldAgentCode(fieldAgentCode) || req.params.id}/payments`,
      isPrivate: true,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      maxBytes: FIELD_AGENT_UPLOAD_MAX_BYTES,
      label: 'Field Agent payment receipt'
    });
    const payment = {
      id: `FAP-${Date.now()}`,
      amount_ugx: amountUgx,
      payment_reference: paymentReference,
      payment_method: paymentMethod,
      paid_at: paidAt,
      period_start: periodStart || undefined,
      period_end: periodEnd || undefined,
      receipt: receipt || undefined,
      notes: notes || undefined,
      created_at: new Date().toISOString(),
      created_by: adminActorId(req)
    };
    const payments = [payment, ...asArray(profile.field_agent_payments)].slice(0, 100);
    const patch = {
      field_agent_payments: payments,
      field_agent_latest_payment: payment,
      field_agent_last_payment_at: payment.created_at,
      field_agent_payment_status: 'paid'
    };

    const updated = await db.query(
      `UPDATE users
       SET profile_data = COALESCE(profile_data, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, first_name, last_name, email, phone, role, status, profile_data, updated_at`,
      [user.id, JSON.stringify(patch)]
    );

    const siteUrl = String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'https://makaug.com').replace(/\/$/, '');
    const dashboardUrl = `${siteUrl}/field-agent-dashboard`;
    const receiptHref = receipt?.url || '';
    const emailPayload = buildFieldAgentPaymentEmail({
      firstName: user.first_name,
      fieldAgentCode,
      amountUgx,
      paymentReference,
      paymentMethod,
      paidAt,
      receiptHref,
      dashboardUrl
    });
    let emailDelivery = { sent: false, reason: 'email_provider_missing' };
    if (user.email && emailProviderConfigured()) {
      emailDelivery = await sendSupportEmail({
        to: user.email,
        subject: `makaug.com Field Agent payment ${paymentReference}`,
        text: emailPayload.text,
        html: emailPayload.html
      });
    }
    const emailStatus = user.email
      ? (emailProviderConfigured() ? notificationStatusFromDelivery(emailDelivery) : 'provider_missing')
      : 'skipped';
    await logEmailEvent(db, {
      eventType: 'field_agent_payment_recorded',
      recipientUserId: user.id,
      recipientEmail: user.email,
      recipientRole: 'field_agent',
      templateKey: 'field_agent_payment_recorded',
      subject: `makaug.com Field Agent payment ${paymentReference}`,
      language: user.preferred_language || 'en',
      status: emailStatus,
      provider: emailDelivery.provider || null,
      providerMessageId: emailDelivery.id || null,
      failureReason: emailDelivery.error || emailDelivery.reason || null,
      sentAt: emailDelivery.sent ? new Date() : null
    });

    const whatsappBody = [
      `Hello ${user.first_name || 'there'}, makaug.com has recorded a Field Agent payment for ${fieldAgentCode || 'your account'}.`,
      `Amount: USh ${amountUgx.toLocaleString('en-UG')}`,
      `Reference: ${paymentReference}`,
      `Date: ${paidAt}`,
      `Open your dashboard: ${dashboardUrl}`
    ].join('\n');
    const whatsappTo = profile.field_agent_whatsapp || profile.whatsapp_phone || user.phone;
    const whatsappDelivery = whatsappTo ? await sendWhatsAppText({ to: whatsappTo, body: whatsappBody }) : { sent: false, reason: 'missing_phone' };
    const whatsappStatus = whatsappTo ? notificationStatusFromDelivery(whatsappDelivery) : 'skipped';
    await logWhatsAppMessage(db, {
      userId: user.id,
      recipientPhone: whatsappTo || null,
      templateKey: 'field_agent_payment_recorded',
      messageType: 'field_agent_payment_recorded',
      language: user.preferred_language || 'en',
      status: whatsappStatus,
      failureReason: whatsappDelivery.error || whatsappDelivery.reason || null,
      sentAt: whatsappDelivery.sent ? new Date() : null
    });
    await logNotification(db, {
      userId: user.id,
      recipientPhone: whatsappTo || null,
      recipientEmail: user.email,
      channel: 'in_app',
      type: 'field_agent_payment_recorded',
      status: 'logged',
      payloadSummary: {
        field_agent_code: fieldAgentCode,
        amount_ugx: amountUgx,
        payment_reference: paymentReference,
        email_status: emailStatus,
        whatsapp_status: whatsappStatus
      }
    });
    await writeAudit('field_agent_payment_recorded', {
      user_id: user.id,
      field_agent_code: fieldAgentCode,
      amount_ugx: amountUgx,
      payment_reference: paymentReference,
      payment_method: paymentMethod,
      receipt_uploaded: Boolean(receipt)
    }, adminActorId(req));

    return res.json({ ok: true, data: { payment, user: updated.rows[0], email_status: emailStatus, whatsapp_status: whatsappStatus } });
  } catch (error) {
    return next(error);
  }
});

router.post('/field-agents/broadcast', async (req, res, next) => {
  try {
    const territory = cleanText(req.body.territory || '').slice(0, 80);
    const channel = cleanText(req.body.channel || 'whatsapp').toLowerCase();
    const message = cleanText(req.body.message || '').slice(0, 1200);
    const bannerMessage = cleanText(req.body.banner_message || '').slice(0, 500);
    const actorId = adminActorId(req);
    const allowedChannels = ['whatsapp', 'email', 'both', 'banner'];

    if (!allowedChannels.includes(channel)) {
      return res.status(400).json({ ok: false, error: 'Choose WhatsApp, email, both, or banner' });
    }
    if (!message && !bannerMessage) {
      return res.status(400).json({ ok: false, error: 'Add a message or dashboard banner before broadcasting' });
    }

    const values = [];
    const filters = [`role = 'field_agent'`, `status <> 'deleted'`];
    if (territory) {
      values.push(territory);
      filters.push(`LOWER(COALESCE(profile_data->>'field_agent_territory', profile_data->>'territory', '')) = LOWER($${values.length})`);
    }
    const targets = await db.query(
      `SELECT id, first_name, last_name, phone, email, preferred_language, profile_data
       FROM users
       WHERE ${filters.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT 5000`,
      values
    );

    if (bannerMessage) {
      const bannerPayload = JSON.stringify({
        field_agent_banner_message: bannerMessage,
        field_agent_banner_territory: territory || 'all',
        field_agent_banner_updated_at: new Date().toISOString()
      });
      await db.query(
        `UPDATE users
         SET profile_data = COALESCE(profile_data, '{}'::jsonb) || $${values.length + 1}::jsonb,
             updated_at = NOW()
         WHERE ${filters.join(' AND ')}`,
        [...values, bannerPayload]
      );
    }

    let whatsappSent = 0;
    let whatsappFailed = 0;
    let emailSent = 0;
    let emailFailed = 0;
    const sendWhatsApp = ['whatsapp', 'both'].includes(channel) && Boolean(message);
    const sendEmail = ['email', 'both'].includes(channel) && Boolean(message);
    const subject = `makaug.com Field Agent update${territory ? ` - ${territory}` : ''}`;

    for (const agent of targets.rows) {
      const profile = agent.profile_data && typeof agent.profile_data === 'object' ? agent.profile_data : {};
      const toPhone = profile.field_agent_whatsapp || profile.whatsapp_phone || agent.phone;
      if (sendWhatsApp && toPhone) {
        const delivery = await sendWhatsAppText({ to: toPhone, body: message });
        const status = notificationStatusFromDelivery(delivery);
        if (delivery.sent) whatsappSent += 1;
        if (!delivery.sent) whatsappFailed += 1;
        await logWhatsAppMessage(db, {
          userId: agent.id,
          recipientPhone: toPhone,
          templateKey: 'field_agent_broadcast',
          messageType: 'field_agent_broadcast',
          language: agent.preferred_language || 'en',
          status,
          failureReason: delivery.error || delivery.reason || null,
          sentAt: delivery.sent ? new Date() : null
        });
        await logNotification(db, {
          userId: agent.id,
          recipientPhone: toPhone,
          channel: 'whatsapp',
          type: 'field_agent_broadcast',
          status,
          failureReason: delivery.error || delivery.reason || null,
          payloadSummary: { territory: territory || 'all', provider: delivery.provider || null }
        });
      }
      if (sendEmail && agent.email) {
        let delivery = { sent: false, reason: 'email_provider_missing' };
        if (emailProviderConfigured()) {
          delivery = await sendSupportEmail({
            to: agent.email,
            subject,
            text: message,
            html: `<p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>`
          });
        }
        const status = emailProviderConfigured() ? notificationStatusFromDelivery(delivery) : 'provider_missing';
        if (delivery.sent) emailSent += 1;
        if (!delivery.sent) emailFailed += 1;
        await logEmailEvent(db, {
          eventType: 'field_agent_broadcast',
          recipientUserId: agent.id,
          recipientEmail: agent.email,
          recipientRole: 'field_agent',
          templateKey: 'field_agent_broadcast',
          subject,
          language: agent.preferred_language || 'en',
          status,
          provider: delivery.provider || null,
          providerMessageId: delivery.id || null,
          failureReason: delivery.error || delivery.reason || null,
          sentAt: delivery.sent ? new Date() : null
        });
        await logNotification(db, {
          userId: agent.id,
          recipientEmail: agent.email,
          channel: 'email',
          type: 'field_agent_broadcast',
          status,
          failureReason: delivery.error || delivery.reason || null,
          payloadSummary: { territory: territory || 'all', provider_configured: emailProviderConfigured() }
        });
      }
    }

    await writeAudit('field_agent_broadcast_sent', {
      territory: territory || 'all',
      channel,
      target_count: targets.rows.length,
      banner_updated: Boolean(bannerMessage),
      whatsapp_sent: whatsappSent,
      whatsapp_failed: whatsappFailed,
      email_sent: emailSent,
      email_failed: emailFailed
    }, actorId);

    return res.json({
      ok: true,
      data: {
        territory: territory || 'all',
        channel,
        target_count: targets.rows.length,
        banner_updated: Boolean(bannerMessage),
        whatsapp_sent: whatsappSent,
        whatsapp_failed: whatsappFailed,
        email_sent: emailSent,
        email_failed: emailFailed
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/agents', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const status = String(req.query.status || '').trim().toLowerCase();
    const search = String(req.query.search || '').trim().toLowerCase();

    const filters = [];
    const values = [];

    if (status) {
      values.push(status);
      filters.push(`a.status = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      filters.push(`(
        a.full_name ILIKE $${values.length}
        OR COALESCE(a.company_name, '') ILIKE $${values.length}
        OR COALESCE(a.email, '') ILIKE $${values.length}
        OR a.phone ILIKE $${values.length}
      )`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM agents a ${where}`, values);
    const total = countResult.rows[0]?.total || 0;

    const listValues = [...values, limit, offset];
    const rows = await db.query(
      `SELECT
        a.id,
        a.makaug_agent_number,
        a.full_name,
        a.company_name,
        a.phone,
        a.email,
        a.licence_number,
        a.registration_status,
        a.user_id,
        a.nin,
        a.id_expiry_date,
        a.experience_years,
        a.identity_document_name,
        a.identity_document_url,
        a.identity_document_type,
        a.identity_document_uploaded_at,
        a.profile_photo_url,
        a.verification_reason,
        a.privacy_consent_accepted,
        a.privacy_consent_at,
        a.data_retention_notice_accepted,
        a.data_retention_notice_at,
        a.approved_at,
        a.contact_phone_verified_at,
        a.agent_application_channel,
        a.featured_homepage,
        a.featured_at,
        a.rating,
        a.sales_count,
        a.status,
        a.created_at,
        a.updated_at,
        COALESCE(p.total_listings, 0) AS total_listings,
        COALESCE(p.live_listings, 0) AS live_listings,
        COALESCE(p.pending_listings, 0) AS pending_listings,
        COALESCE(p.rejected_listings, 0) AS rejected_listings
      FROM agents a
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS total_listings,
          COUNT(*) FILTER (WHERE ${publicLivePropertyStatusSql('p')})::int AS live_listings,
          COUNT(*) FILTER (WHERE p.status = 'pending')::int AS pending_listings,
          COUNT(*) FILTER (WHERE p.status = 'rejected')::int AS rejected_listings
        FROM properties p
        WHERE p.agent_id = a.id
      ) p ON true
      ${where}
      ORDER BY a.created_at DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}`,
      listValues
    );

    return res.json({
      ok: true,
      data: rows.rows,
      pagination: toPagination(total, page, limit)
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/agents/:id/featured', async (req, res, next) => {
  try {
    const featured = req.body.featured === true || String(req.body.featured || '').toLowerCase() === 'true';
    const updated = await db.query(
      `UPDATE agents
       SET
         featured_homepage = $2,
         featured_at = CASE WHEN $2::boolean THEN NOW() ELSE NULL END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, full_name, company_name, featured_homepage, featured_at, updated_at`,
      [req.params.id, featured]
    );

    if (!updated.rows.length) {
      return res.status(404).json({ ok: false, error: 'Agent not found' });
    }

    await writeAudit('admin_agent_featured_updated', {
      agent_id: req.params.id,
      featured
    }, adminActorId(req));

    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/agents/:id/status', async (req, res, next) => {
  try {
    const status = String(req.body.status || '').trim().toLowerCase();
    const allowedStatuses = ['pending', 'approved', 'rejected', 'suspended'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: 'Invalid status value' });
    }

    const updated = await db.query(
      `UPDATE agents
       SET status = $2,
           approved_at = CASE WHEN $2 = 'approved' THEN COALESCE(approved_at, NOW()) ELSE approved_at END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING
         id,
         makaug_agent_number,
         full_name,
         company_name,
         phone,
         whatsapp,
         email,
         licence_number,
         registration_status,
         districts_covered,
         specializations,
         nin,
         id_expiry_date,
         experience_years,
         identity_document_name,
         identity_document_url,
         identity_document_type,
         identity_document_uploaded_at,
         verification_reason,
         privacy_consent_accepted,
         privacy_consent_at,
         data_retention_notice_accepted,
         data_retention_notice_at,
         user_id,
         approved_at,
         contact_phone_verified_at,
         agent_application_channel,
         status,
         updated_at`,
      [req.params.id, status]
    );

    if (!updated.rows.length) {
      return res.status(404).json({ ok: false, error: 'Agent not found' });
    }

    await writeAudit('admin_agent_status_updated', {
      agent_id: req.params.id,
      status
    });

    let accountProvisioning = null;
    if (status === 'approved') {
      accountProvisioning = await provisionApprovedBrokerAccount(updated.rows[0], req);
    }

    return res.json({
      ok: true,
      data: {
        ...updated.rows[0],
        account_provisioning: accountProvisioning
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/agents/:id/registration-status', async (req, res, next) => {
  try {
    const registrationStatus = String(req.body.registration_status || '').trim().toLowerCase();
    const allowedStatuses = ['registered', 'not_registered'];

    if (!allowedStatuses.includes(registrationStatus)) {
      return res.status(400).json({ ok: false, error: 'Invalid registration_status value' });
    }

    const updated = await db.query(
      `UPDATE agents
       SET registration_status = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, full_name, company_name, registration_status, updated_at`,
      [req.params.id, registrationStatus]
    );

    if (!updated.rows.length) {
      return res.status(404).json({ ok: false, error: 'Agent not found' });
    }

    await writeAudit('admin_agent_registration_status_updated', {
      agent_id: req.params.id,
      registration_status: registrationStatus
    }, adminActorId(req));

    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/properties/:id/registration-status', async (req, res, next) => {
  try {
    const registrationStatus = String(req.body.registration_status || '').trim().toLowerCase();
    const allowedStatuses = ['registered', 'not_registered'];

    if (!allowedStatuses.includes(registrationStatus)) {
      return res.status(400).json({ ok: false, error: 'Invalid registration_status value' });
    }

    const updated = await db.query(
      `UPDATE properties
       SET
         extra_fields = COALESCE(extra_fields, '{}'::jsonb)
           || jsonb_build_object(
             'lister_registration_status', $2::text,
             'lister_registration_reviewed_at', NOW()::text
           ),
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, title, extra_fields, updated_at`,
      [req.params.id, registrationStatus]
    );

    if (!updated.rows.length) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    await writeAudit('admin_property_lister_registration_status_updated', {
      property_id: req.params.id,
      registration_status: registrationStatus
    }, adminActorId(req));

    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.patch('/properties/:id/featured', async (req, res, next) => {
  try {
    const featured = req.body.featured === true || String(req.body.featured || '').toLowerCase() === 'true';
    const updated = await db.query(
      `UPDATE properties
       SET
         extra_fields = CASE
           WHEN $2::boolean THEN COALESCE(extra_fields, '{}'::jsonb)
             || jsonb_build_object(
               'featured', true,
               'featured_at', NOW()::text,
               'featured_by', $3::text
             )
           ELSE (COALESCE(extra_fields, '{}'::jsonb)
             || jsonb_build_object(
               'featured', false,
               'featured_removed_at', NOW()::text,
               'featured_removed_by', $3::text
             ))
         END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING
         id,
         title,
         status,
         extra_fields,
         (COALESCE(extra_fields->>'featured', 'false') IN ('true', '1', 'yes')) AS featured,
         extra_fields->>'featured_at' AS featured_at,
         updated_at`,
      [req.params.id, featured, adminActorId(req)]
    );

    if (!updated.rows.length) {
      return res.status(404).json({ ok: false, error: 'Property not found' });
    }

    await writeAudit('admin_property_featured_updated', {
      property_id: req.params.id,
      featured
    }, adminActorId(req));

    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

function normalizeReportStatus(value) {
  const status = cleanText(value).toLowerCase();
  return ['open', 'in_review', 'resolved', 'dismissed'].includes(status) ? status : '';
}

function extractLinkedPropertyIdFromReference(reference = '') {
  const match = String(reference || '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0] : null;
}

function normalizeReportRow(row = {}) {
  const linkedPropertyId = row.linked_property_id || extractLinkedPropertyIdFromReference(row.property_reference);
  return {
    ...row,
    request_type: row.request_type || 'report',
    request_source: row.request_source || '',
    structured_fields: row.structured_fields && typeof row.structured_fields === 'object' ? row.structured_fields : {},
    linked_property_id: linkedPropertyId,
    resolution_note: row.resolution_note || '',
    actioned_by: row.actioned_by || '',
    actioned_at: row.actioned_at || null
  };
}

async function listReportRows({ status = '', search = '', limit = 20, offset = 0 } = {}) {
  const filters = [];
  const values = [];

  if (status) {
    values.push(status);
    filters.push(`r.status = $${values.length}`);
  }
  if (search) {
    values.push(`%${search}%`);
    filters.push(`(
      r.property_reference ILIKE $${values.length}
      OR r.reason ILIKE $${values.length}
      OR COALESCE(r.details, '') ILIKE $${values.length}
      OR COALESCE(r.reporter_contact, '') ILIKE $${values.length}
    )`);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM report_listings r ${where}`, values);
  const total = countResult.rows[0]?.total || 0;
  const listValues = [...values, limit, offset];

  try {
    const rows = await db.query(
      `SELECT
        r.id,
        r.property_reference,
        r.reason,
        r.details,
        r.reporter_contact,
        r.status,
        r.request_type,
        r.request_source,
        r.structured_fields,
        r.linked_property_id,
        r.resolution_note,
        r.actioned_by,
        r.actioned_at,
        r.created_at,
        r.updated_at,
        p.title AS linked_property_title,
        p.status AS linked_property_status
      FROM report_listings r
      LEFT JOIN properties p ON p.id = r.linked_property_id
      ${where}
      ORDER BY r.created_at DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}`,
      listValues
    );
    return { total, rows: rows.rows.map(normalizeReportRow) };
  } catch (error) {
    if (error?.code !== '42703') throw error;
    const rows = await db.query(
      `SELECT
        r.id,
        r.property_reference,
        r.reason,
        r.details,
        r.reporter_contact,
        r.status,
        r.created_at,
        r.updated_at
      FROM report_listings r
      ${where}
      ORDER BY r.created_at DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}`,
      listValues
    );
    return { total, rows: rows.rows.map(normalizeReportRow) };
  }
}

async function hidePropertyForReport({ propertyId, reportId, note, actorId }) {
  const id = cleanText(propertyId);
  if (!id) return null;
  const updated = await db.query(
    `UPDATE properties
     SET
       status = 'hidden',
       moderation_stage = 'hidden',
       moderation_reason = $3,
       moderation_notes = CONCAT_WS(E'\n', NULLIF(moderation_notes, ''), $3),
       extra_fields = COALESCE(extra_fields, '{}'::jsonb)
         || jsonb_build_object(
           'hidden_by_report_id', $1::text,
           'hidden_by_report_at', NOW()::text,
           'hidden_by_report_by', $4::text,
           'hidden_by_report_note', $3::text
         ),
       updated_at = NOW()
     WHERE id = $2
     RETURNING id, title, status, updated_at`,
    [reportId, id, note, actorId]
  );
  return updated.rows[0] || null;
}

async function notifyReporterOfReportOutcome(row = {}, status = '', note = '') {
  const reporter = cleanText(row.reporter_contact);
  if (!reporter || !isValidEmail(reporter)) {
    await logNotification(db, {
      recipientEmail: null,
      recipientPhone: reporter && isValidPhone(reporter) ? reporter : null,
      channel: 'in_app',
      type: 'listing_report_outcome',
      status: 'logged',
      payloadSummary: {
        report_id: row.id,
        status,
        reporter_contact: reporter || null
      }
    });
    return { sent: false, reason: 'no_reporter_email' };
  }

  const delivery = await sendSupportEmail({
    to: reporter,
    subject: `makaug listing request updated: ${status}`,
    text: [
      'Your makaug listing request has been reviewed.',
      '',
      `Report ID: ${row.id}`,
      `Status: ${status}`,
      `Listing: ${row.property_reference || '-'}`,
      note ? `Moderator note: ${note}` : '',
      '',
      'Thank you for helping keep makaug accurate and safe.'
    ].filter(Boolean).join('\n')
  });
  const deliveryStatus = notificationStatusFromDelivery(delivery);
  await Promise.allSettled([
    logEmailEvent(db, {
      eventType: 'listing_report_outcome',
      recipientEmail: reporter,
      recipientRole: 'reporter',
      templateKey: 'listing_report_outcome',
      subject: `makaug listing request updated: ${status}`,
      status: deliveryStatus,
      failureReason: delivery?.error || delivery?.reason || null,
      sentAt: delivery?.sent ? new Date() : null
    }),
    logNotification(db, {
      recipientEmail: reporter,
      channel: 'email',
      type: 'listing_report_outcome',
      status: deliveryStatus,
      payloadSummary: {
        report_id: row.id,
        status
      }
    })
  ]);
  return delivery;
}

async function updateReportStatusWithAction(req, { actorId = 'admin_api_key', auditAction = 'admin_report_status_updated' } = {}) {
  const status = normalizeReportStatus(req.body.status);
  const resolutionNote = cleanText(req.body.resolution_note || req.body.note || req.body.moderator_note);
  const hideListing = parseBooleanLike(req.body.hide_listing || req.body.remove_listing || req.body.unpublish_listing, false);

  if (!status) {
    const error = new Error('Invalid status value');
    error.status = 400;
    throw error;
  }
  if (!resolutionNote) {
    const error = new Error('Moderator note is required');
    error.status = 400;
    throw error;
  }

  const existing = await db.query(
    `SELECT * FROM report_listings WHERE id = $1`,
    [req.params.id]
  );
  if (!existing.rows.length) {
    const error = new Error('Report not found');
    error.status = 404;
    throw error;
  }
  const current = normalizeReportRow(existing.rows[0]);
  const requestedPropertyId = cleanText(req.body.property_id || req.body.linked_property_id);
  const propertyId = extractLinkedPropertyIdFromReference(requestedPropertyId) || current.linked_property_id;
  const hiddenProperty = hideListing ? await hidePropertyForReport({
    propertyId,
    reportId: req.params.id,
    note: resolutionNote,
    actorId
  }) : null;

  let updated;
  try {
    updated = await db.query(
      `UPDATE report_listings
       SET
         status = $2,
         resolution_note = $3,
         actioned_by = $4,
         actioned_at = NOW(),
         linked_property_id = COALESCE(linked_property_id, $5),
         details = CONCAT(COALESCE(details, ''), CASE WHEN COALESCE(details, '') = '' THEN '' ELSE E'\n\n' END, 'Moderator note: ', $3::text),
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id, status, resolutionNote, actorId, propertyId || null]
    );
  } catch (error) {
    if (error?.code !== '42703') throw error;
    updated = await db.query(
      `UPDATE report_listings
       SET
         status = $2,
         details = CONCAT(COALESCE(details, ''), CASE WHEN COALESCE(details, '') = '' THEN '' ELSE E'\n\n' END, 'Moderator note: ', $3::text),
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, property_reference, reason, details, reporter_contact, status, created_at, updated_at`,
      [req.params.id, status, resolutionNote]
    );
  }

  const row = normalizeReportRow(updated.rows[0] || {});
  await Promise.allSettled([
    writeAudit(auditAction, {
      report_id: req.params.id,
      status,
      resolution_note: resolutionNote,
      hide_listing: hideListing,
      hidden_property_id: hiddenProperty?.id || null
    }, actorId),
    notifyReporterOfReportOutcome(row, status, resolutionNote)
  ]);

  return { row, hiddenProperty };
}

router.get('/reports', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const status = normalizeReportStatus(req.query.status);
    const search = String(req.query.search || '').trim().toLowerCase();
    const { total, rows } = await listReportRows({ status, search, limit, offset });

    return res.json({
      ok: true,
      data: rows,
      pagination: toPagination(total, page, limit)
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/reports/:id/status', async (req, res, next) => {
  try {
    const result = await updateReportStatusWithAction(req, {
      actorId: adminActorId(req),
      auditAction: 'admin_report_status_updated'
    });
    return res.json({ ok: true, data: result.row, hidden_property: result.hiddenProperty || null });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ ok: false, error: error.message });
    }
    return next(error);
  }
});

router.get('/whatsapp/insights', async (req, res, next) => {
  try {
    const [
      msgCounts,
      activeUsers,
      optIn,
      queueCounts,
      topIntents,
      transcriptionCounts,
      bridgeStatus
    ] = await Promise.all([
      db.query(
        `SELECT
          COUNT(*) FILTER (WHERE direction = 'inbound')::int AS inbound,
          COUNT(*) FILTER (WHERE direction = 'outbound')::int AS outbound,
          COUNT(*)::int AS total
         FROM whatsapp_messages`
      ),
      db.query(
        `SELECT
          COUNT(DISTINCT user_phone)::int AS active_7d
         FROM whatsapp_messages
         WHERE created_at >= NOW() - INTERVAL '7 days'`
      ),
      db.query(
        `SELECT
          COUNT(*) FILTER (WHERE marketing_opt_in = TRUE)::int AS opted_in,
          COUNT(*) FILTER (WHERE marketing_opt_in = FALSE)::int AS opted_out
         FROM whatsapp_user_profiles`
      ),
      db.query(
        `SELECT
          COUNT(*) FILTER (WHERE status IN ('pending','retry'))::int AS pending,
          COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM outbound_message_queue
         WHERE channel = 'whatsapp'`
      ),
      db.query(
        `SELECT detected_intent, COUNT(*)::int AS total
         FROM whatsapp_intent_logs
         WHERE created_at >= NOW() - INTERVAL '14 days'
         GROUP BY detected_intent
         ORDER BY total DESC
         LIMIT 10`
      ),
      db.query(
        `SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS last_7d
         FROM transcriptions`
      ),
      getWhatsappWebBridgeStatus()
    ]);

    const readiness = evaluateHostedWhatsappBridgeReadiness(bridgeStatus?.clients || [], {
      freshSeconds: Number(process.env.WHATSAPP_WEB_BRIDGE_FRESH_SECONDS || 180) || 180
    });

    return res.json({
      ok: true,
      data: {
        messages: msgCounts.rows[0],
        activeUsers: activeUsers.rows[0],
        optIn: optIn.rows[0],
        queue: queueCounts.rows[0],
        topIntents: topIntents.rows,
        transcriptions: transcriptionCounts.rows[0],
        webBridge: {
          ...bridgeStatus,
          readiness
        }
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/whatsapp/conversations', async (req, res, next) => {
  try {
    const result = await listWhatsappConversations(req.query);
    return res.json({
      ok: true,
      data: result.conversations,
      summary: result.summary,
      pagination: result.pagination
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/whatsapp/conversations/:phone', async (req, res, next) => {
  try {
    const detail = await loadWhatsappConversationDetail(req.params.phone);
    if (!detail) {
      return res.status(404).json({ ok: false, error: 'Conversation not found' });
    }
    return res.json({ ok: true, data: detail });
  } catch (error) {
    return next(error);
  }
});

router.patch('/whatsapp/conversations/:phone', async (req, res, next) => {
  try {
    const patch = {};
    if (Object.prototype.hasOwnProperty.call(req.body, 'status')) patch.status = normalizeConversationStatus(req.body.status);
    if (Object.prototype.hasOwnProperty.call(req.body, 'category')) patch.category = normalizeConversationCategory(req.body.category);
    if (Object.prototype.hasOwnProperty.call(req.body, 'priority')) patch.priority = normalizeConversationPriority(req.body.priority);
    if (Object.prototype.hasOwnProperty.call(req.body, 'assigned_to')) patch.assigned_to = String(req.body.assigned_to || '').trim();
    if (Object.prototype.hasOwnProperty.call(req.body, 'ai_mode')) patch.ai_mode = normalizeConversationAiMode(req.body.ai_mode);
    if (Object.prototype.hasOwnProperty.call(req.body, 'last_summary')) patch.last_summary = String(req.body.last_summary || '').trim();
    if (Object.prototype.hasOwnProperty.call(req.body, 'admin_notes')) patch.admin_notes = String(req.body.admin_notes || '').trim();
    if (Object.prototype.hasOwnProperty.call(req.body, 'tags')) patch.tags = Array.isArray(req.body.tags) ? req.body.tags : [];

    const updated = await updateWhatsappConversationControl(
      req.params.phone,
      patch,
      adminActorId(req)
    );

    await writeAudit('admin_whatsapp_conversation_updated', {
      phone: normalizeConversationPhone(req.params.phone),
      patch
    }, adminActorId(req));

    return res.json({ ok: true, data: updated });
  } catch (error) {
    return next(error);
  }
});

router.post('/whatsapp/conversations/:phone/suggest-reply', async (req, res, next) => {
  try {
    const detail = await loadWhatsappConversationDetail(req.params.phone);
    if (!detail) {
      return res.status(404).json({ ok: false, error: 'Conversation not found' });
    }

    const recentMessages = detail.messages.slice(-12).map((message) => ({
      direction: message.direction,
      text: message.preview,
      created_at: message.created_at
    }));
    const latestInbound = [...detail.messages].reverse().find((message) => message.direction === 'inbound');
    const fallbackIntent = detail.conversation.category === 'property_search'
      ? 'property_search'
      : detail.conversation.category === 'property_listing'
        ? 'property_listing'
        : detail.conversation.category === 'broker_help'
          ? 'agent_search'
          : detail.conversation.category === 'mortgage'
            ? 'mortgage_help'
            : detail.conversation.category === 'account'
              ? 'account_help'
              : detail.conversation.category === 'fraud_report'
                ? 'report_listing'
                : 'support';

    const suggestion = await suggestWhatsappAssistantReply({
      userMessage: latestInbound?.preview || detail.conversation.latest_preview || 'Customer needs support.',
      intent: detail.conversation.last_intent || fallbackIntent,
      language: detail.conversation.preferred_language || 'en',
      context: {
        category: detail.conversation.category,
        status: detail.conversation.status,
        priority: detail.conversation.priority,
        ai_mode: detail.conversation.ai_mode,
        participant_type: detail.conversation.participant_type,
        contact_name: detail.conversation.contact_name,
        account_role: detail.conversation.user_role || null,
        broker_company: detail.conversation.agent_company || null,
        current_step: detail.conversation.current_step || null,
        related: detail.related,
        admin_notes: detail.conversation.admin_notes || null,
        recent_messages: recentMessages
      },
      source: 'admin_whatsapp_inbox'
    });

    await writeAudit('admin_whatsapp_reply_suggested', {
      phone: detail.conversation.phone,
      intent: detail.conversation.last_intent || fallbackIntent,
      language: detail.conversation.preferred_language || 'en'
    }, adminActorId(req));

    return res.json({ ok: true, data: suggestion });
  } catch (error) {
    return next(error);
  }
});

router.post('/whatsapp/conversations/:phone/reply', async (req, res, next) => {
  try {
    const phone = normalizeConversationPhone(req.params.phone);
    const text = String(req.body.text || '').trim();
    const source = String(req.body.source || 'human').trim().toLowerCase();
    const requestedStatus = req.body.status ? normalizeConversationStatus(req.body.status) : null;
    const requestedDeliveryMode = String(req.body.delivery_mode || '').trim().toLowerCase();
    const actor = adminActorId(req);

    if (!phone) {
      return res.status(400).json({ ok: false, error: 'Invalid destination phone' });
    }
    if (!text) {
      return res.status(400).json({ ok: false, error: 'Reply text is required' });
    }

    const manualUrl = buildManualWhatsAppUrl(phone, text);
    const effectiveDeliveryMode = ['provider', 'web_bridge', 'auto'].includes(requestedDeliveryMode)
      ? requestedDeliveryMode
      : getWhatsappDeliveryMode();

    let delivery = {
      sent: false,
      provider: null
    };
    let queuedForBridge = false;
    let bridgeQueueId = null;

    if (effectiveDeliveryMode === 'web_bridge') {
      const queued = await queueWhatsappWebBridgeMessage({
        recipient: phone,
        text,
        source: source === 'ai' ? 'admin_ai_reply' : 'admin_human_reply',
        actorId: actor,
        metadata: {
          requested_status: requestedStatus || 'awaiting_customer'
        }
      });
      queuedForBridge = true;
      bridgeQueueId = queued?.id || null;
      delivery = {
        sent: false,
        queued: true,
        provider: 'whatsapp_web_bridge',
        id: bridgeQueueId
      };
    } else {
      delivery = await sendWhatsAppText({ to: phone, body: text });

      if (!delivery.sent && isWhatsappWebBridgeEnabled()) {
        const queued = await queueWhatsappWebBridgeMessage({
          recipient: phone,
          text,
          source: source === 'ai' ? 'admin_ai_reply' : 'admin_human_reply',
          actorId: actor,
          metadata: {
            fallback_from: delivery.provider || 'provider',
            requested_status: requestedStatus || 'awaiting_customer'
          }
        });
        queuedForBridge = true;
        bridgeQueueId = queued?.id || null;
      }
    }

    if (delivery.sent) {
      await db.query(
        `INSERT INTO whatsapp_messages (user_phone, wa_message_id, direction, message_type, payload)
         VALUES ($1, NULLIF($2, ''), 'outbound', 'text', $3::jsonb)`,
        [
          phone,
          delivery.id || null,
          JSON.stringify({
            provider: delivery.provider || 'whatsapp',
            reply: text,
            source: source === 'ai' ? 'admin_ai_reply' : 'admin_human_reply',
            actor_id: actor
          })
        ]
      );

      await syncWhatsappConversationState({
        phone,
        direction: 'outbound',
        provider: delivery.provider || 'whatsapp',
        messageType: 'text',
        ai: source === 'ai',
        human: source !== 'ai',
        metadata: {
          last_reply_source: source,
          last_reply_actor: actor,
          last_reply_preview: text.slice(0, 240)
        }
      });

      await updateWhatsappConversationControl(phone, {
        status: requestedStatus || 'awaiting_customer'
      }, actor);
    } else if (queuedForBridge) {
      await updateWhatsappConversationControl(phone, {
        status: requestedStatus || 'awaiting_customer',
        metadata: {
          pending_bridge_queue_id: bridgeQueueId,
          pending_bridge_reply_preview: text.slice(0, 240)
        }
      }, actor);
    }

    await writeAudit('admin_whatsapp_reply_sent', {
      phone,
      sent: delivery.sent === true,
      provider: delivery.provider || null,
      source,
      delivery_mode: effectiveDeliveryMode,
      queued_for_bridge: queuedForBridge,
      bridge_queue_id: bridgeQueueId,
      manual_required: delivery.sent !== true,
      manual_url: manualUrl || null
    }, actor);

    return res.json({
      ok: true,
      data: {
        sent: delivery.sent === true,
        delivery,
        queued_for_bridge: queuedForBridge,
        bridge_queue_id: bridgeQueueId,
        manual_required: delivery.sent !== true,
        manual_url: manualUrl || null
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/whatsapp/messages', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const direction = String(req.query.direction || '').trim().toLowerCase();
    const phone = String(req.query.phone || '').trim();
    const type = String(req.query.type || '').trim().toLowerCase();

    const filters = [];
    const values = [];

    if (direction) {
      values.push(direction);
      filters.push(`direction = $${values.length}`);
    }
    if (phone) {
      values.push(`%${phone}%`);
      filters.push(`user_phone ILIKE $${values.length}`);
    }
    if (type) {
      values.push(type);
      filters.push(`message_type = $${values.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM whatsapp_messages ${where}`, values);
    const total = countResult.rows[0]?.total || 0;

    const listValues = [...values, limit, offset];
    const rows = await db.query(
      `SELECT id, user_phone, wa_message_id, direction, message_type, payload, created_at
       FROM whatsapp_messages
       ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length + 1}
       OFFSET $${values.length + 2}`,
      listValues
    );

    return res.json({
      ok: true,
      data: rows.rows,
      pagination: toPagination(total, page, limit)
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/whatsapp/intents', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const phone = String(req.query.phone || '').trim();
    const intent = String(req.query.intent || '').trim().toLowerCase();

    const filters = [];
    const values = [];

    if (phone) {
      values.push(`%${phone}%`);
      filters.push(`user_phone ILIKE $${values.length}`);
    }
    if (intent) {
      values.push(intent);
      filters.push(`detected_intent = $${values.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM whatsapp_intent_logs ${where}`, values);
    const total = countResult.rows[0]?.total || 0;

    const listValues = [...values, limit, offset];
    const rows = await db.query(
      `SELECT id, user_phone, wa_message_id, detected_intent, confidence, language, current_step, raw_text, transcript, entities, model_used, created_at
       FROM whatsapp_intent_logs
       ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length + 1}
       OFFSET $${values.length + 2}`,
      listValues
    );

    return res.json({
      ok: true,
      data: rows.rows,
      pagination: toPagination(total, page, limit)
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/campaigns', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const status = String(req.query.status || '').trim().toLowerCase();

    const values = [];
    const where = status ? `WHERE status = $1` : '';
    if (status) values.push(status);

    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM marketing_campaigns ${where}`, values);
    const total = countResult.rows[0]?.total || 0;

    const listValues = [...values, limit, offset];
    const rows = await db.query(
      `SELECT
        c.*,
        COALESCE(q.total_recipients, 0) AS total_recipients,
        COALESCE(q.sent_count, 0) AS sent_count,
        COALESCE(q.pending_count, 0) AS pending_count,
        COALESCE(q.failed_count, 0) AS failed_count
       FROM marketing_campaigns c
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS total_recipients,
           COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count,
           COUNT(*) FILTER (WHERE status IN ('pending','retry'))::int AS pending_count,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count
         FROM outbound_message_queue q
         WHERE q.campaign_id = c.id
       ) q ON true
       ${where}
       ORDER BY c.created_at DESC
       LIMIT $${values.length + 1}
       OFFSET $${values.length + 2}`,
      listValues
    );

    return res.json({
      ok: true,
      data: rows.rows,
      pagination: toPagination(total, page, limit)
    });
  } catch (error) {
    return next(error);
  }
});

async function loadCampaign(campaignId) {
  const campaignResult = await db.query(
    `SELECT *
     FROM marketing_campaigns
     WHERE id = $1
     LIMIT 1`,
    [campaignId]
  );
  return campaignResult.rows[0] || null;
}

function getCampaignTargetFilter(campaign = {}) {
  return campaign.target_filter && typeof campaign.target_filter === 'object'
    ? campaign.target_filter
    : {};
}

async function queueCampaignRecipients({ campaign, limit = 2000 } = {}) {
  if (!campaign) {
    const error = new Error('Campaign not found');
    error.status = 404;
    throw error;
  }
  if (campaign.channel !== 'whatsapp') {
    const error = new Error('Only whatsapp channel queueing is currently supported');
    error.status = 400;
    throw error;
  }
  if (campaign.status === 'cancelled') {
    const error = new Error('Cancelled campaigns cannot be set live');
    error.status = 400;
    throw error;
  }
  if (!String(campaign.message_template || '').trim()) {
    const error = new Error('Campaign message is empty');
    error.status = 400;
    throw error;
  }

  const normalizedLimit = Math.max(1, Math.min(parseInt(limit, 10) || 2000, 20000));
  const filter = getCampaignTargetFilter(campaign);
  const languageFilter = Array.isArray(filter.languages)
    ? filter.languages.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const sinceDays = Math.max(0, parseInt(filter.active_within_days, 10) || 0);
  const minSeenAtClause = sinceDays > 0 ? `AND p.last_seen_at >= NOW() - ($2::text || ' days')::interval` : '';

  const profileValues = [normalizedLimit];
  if (sinceDays > 0) profileValues.push(String(sinceDays));

  const profiles = await db.query(
    `SELECT p.phone, p.preferred_language, p.marketing_opt_in
     FROM whatsapp_user_profiles p
     WHERE p.marketing_opt_in = TRUE
     ${minSeenAtClause}
     ORDER BY p.last_seen_at DESC
     LIMIT $1`,
    profileValues
  );

  let eligibleCount = 0;
  let insertedCount = 0;
  let skippedDuplicateCount = 0;
  for (const profile of profiles.rows) {
    const preferredLanguage = String(profile.preferred_language || '').toLowerCase();
    if (languageFilter.length && !languageFilter.includes(preferredLanguage)) {
      continue;
    }

    eligibleCount += 1;
    const inserted = await db.query(
      `INSERT INTO outbound_message_queue
        (user_phone, payload, status, attempts, next_attempt_at, campaign_id, channel, user_consent_snapshot, metadata)
       SELECT $1, $2::jsonb, 'pending', 0, NOW(), $3, 'whatsapp', TRUE, $4::jsonb
       WHERE NOT EXISTS (
         SELECT 1
         FROM outbound_message_queue q
         WHERE q.campaign_id = $3
           AND q.user_phone = $1
           AND q.status IN ('pending','retry','sent')
       )
       RETURNING id`,
      [
        profile.phone,
        JSON.stringify({
          text: campaign.message_template
        }),
        campaign.id,
        JSON.stringify({
          source: 'admin_campaign_queue',
          preferred_language: profile.preferred_language || 'en'
        })
      ]
    );
    if (inserted.rows.length) insertedCount += 1;
    else skippedDuplicateCount += 1;
  }

  const updated = await db.query(
    `UPDATE marketing_campaigns
     SET status = 'queued',
         queued_at = COALESCE(queued_at, NOW()),
         updated_at = NOW()
     WHERE id = $1
       AND status <> 'cancelled'
     RETURNING id, status, queued_at, sent_at, updated_at`,
    [campaign.id]
  );

  return {
    campaign: updated.rows[0] || campaign,
    eligible_recipients: eligibleCount,
    queued_recipients: insertedCount,
    skipped_duplicate_recipients: skippedDuplicateCount,
    requested_limit: normalizedLimit
  };
}

router.post('/campaigns/draft', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const objective = String(req.body.objective || '').trim();
    const audience = String(req.body.audience || '').trim();
    const language = String(req.body.language || 'English').trim();
    const channel = String(req.body.channel || 'whatsapp').trim().toLowerCase();
    const targetFilter = req.body.target_filter && typeof req.body.target_filter === 'object'
      ? req.body.target_filter
      : {};

    if (!name) {
      return res.status(400).json({ ok: false, error: 'name is required' });
    }
    if (!['whatsapp', 'sms', 'email'].includes(channel)) {
      return res.status(400).json({ ok: false, error: 'channel must be whatsapp, sms, or email' });
    }

    const generated = await generateCampaignCopy({
      objective,
      audience,
      language,
      channel
    });

    const inserted = await db.query(
      `INSERT INTO marketing_campaigns
        (name, channel, objective, message_template, target_filter, status, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'draft', $6)
       RETURNING *`,
      [
        name,
        channel,
        objective || null,
        generated.text,
        JSON.stringify(targetFilter),
        req.ip || 'admin_api_key'
      ]
    );

    await writeAudit('campaign_draft_created', {
      campaign_id: inserted.rows[0].id,
      channel,
      objective,
      model: generated.model
    });

    return res.status(201).json({
      ok: true,
      data: {
        ...inserted.rows[0],
        generated_by_model: generated.model
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/campaigns/:id/queue', async (req, res, next) => {
  try {
    const campaignId = req.params.id;
    const limit = Math.max(1, Math.min(parseInt(req.body.limit, 10) || 2000, 20000));

    const campaign = await loadCampaign(campaignId);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: 'Campaign not found' });
    }
    const queued = await queueCampaignRecipients({ campaign, limit });

    await writeAudit('campaign_queued', {
      campaign_id: campaign.id,
      eligible_recipients: queued.eligible_recipients,
      queued_recipients: queued.queued_recipients,
      skipped_duplicate_recipients: queued.skipped_duplicate_recipients,
      requested_limit: limit
    });

    return res.json({
      ok: true,
      data: {
        campaign_id: campaign.id,
        status: queued.campaign.status,
        queued_at: queued.campaign.queued_at,
        eligible_recipients: queued.eligible_recipients,
        queued_recipients: queued.queued_recipients,
        skipped_duplicate_recipients: queued.skipped_duplicate_recipients,
        requested_limit: queued.requested_limit
      }
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ ok: false, error: error.message });
    }
    return next(error);
  }
});

router.post('/campaigns/:id/live', async (req, res, next) => {
  try {
    const campaignId = req.params.id;
    const campaign = await loadCampaign(campaignId);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: 'Campaign not found' });
    }

    const limit = Math.max(1, Math.min(parseInt(req.body.limit, 10) || 2000, 20000));
    const maxAttempts = Math.max(1, Math.min(parseInt(req.body.max_attempts, 10) || 4, 10));
    const queued = await queueCampaignRecipients({ campaign, limit });
    const processLimit = Math.max(1, Math.min(parseInt(req.body.process_limit, 10) || Math.max(queued.queued_recipients, 100), 500));
    const processing = queued.queued_recipients > 0
      ? await processPendingCampaignQueue({ limit: processLimit, maxAttempts, campaignId: campaign.id })
      : { processed: 0, sent: 0, failed: 0, retried: 0, campaigns: [] };
    const status = await refreshCampaignStatus(campaign.id);

    await writeAudit('campaign_set_live', {
      campaign_id: campaign.id,
      eligible_recipients: queued.eligible_recipients,
      queued_recipients: queued.queued_recipients,
      skipped_duplicate_recipients: queued.skipped_duplicate_recipients,
      processing
    });

    return res.json({
      ok: true,
      data: {
        campaign_id: campaign.id,
        status: status?.status || queued.campaign.status,
        queued_at: status?.queued_at || queued.campaign.queued_at,
        sent_at: status?.sent_at || queued.campaign.sent_at || null,
        eligible_recipients: queued.eligible_recipients,
        queued_recipients: queued.queued_recipients,
        skipped_duplicate_recipients: queued.skipped_duplicate_recipients,
        processing,
        total_recipients: status?.total_recipients ?? queued.eligible_recipients,
        pending_count: status?.pending_count ?? 0,
        sent_count: status?.sent_count ?? 0,
        failed_count: status?.failed_count ?? 0
      }
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ ok: false, error: error.message });
    }
    return next(error);
  }
});

router.patch('/campaigns/:id/status', async (req, res, next) => {
  try {
    const campaignId = req.params.id;
    const requestedStatus = String(req.body.status || '').trim().toLowerCase();
    const campaign = await loadCampaign(campaignId);
    if (!campaign) {
      return res.status(404).json({ ok: false, error: 'Campaign not found' });
    }

    if (['live', 'active', 'queued'].includes(requestedStatus)) {
      const limit = Math.max(1, Math.min(parseInt(req.body.limit, 10) || 2000, 20000));
      const queued = await queueCampaignRecipients({ campaign, limit });
      await writeAudit('campaign_status_set_live', {
        campaign_id: campaign.id,
        requested_status: requestedStatus,
        eligible_recipients: queued.eligible_recipients,
        queued_recipients: queued.queued_recipients,
        skipped_duplicate_recipients: queued.skipped_duplicate_recipients
      });
      return res.json({
        ok: true,
        data: {
          campaign_id: campaign.id,
          status: queued.campaign.status,
          queued_at: queued.campaign.queued_at,
          eligible_recipients: queued.eligible_recipients,
          queued_recipients: queued.queued_recipients,
          skipped_duplicate_recipients: queued.skipped_duplicate_recipients
        }
      });
    }

    if (requestedStatus === 'cancelled' || requestedStatus === 'canceled') {
      const updated = await db.query(
        `UPDATE marketing_campaigns
         SET status = 'cancelled',
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, status, updated_at`,
        [campaign.id]
      );
      await db.query(
        `UPDATE outbound_message_queue
         SET status = 'failed',
             last_error = 'cancelled_by_admin',
             updated_at = NOW()
         WHERE campaign_id = $1
           AND status IN ('pending','retry')`,
        [campaign.id]
      );
      await writeAudit('campaign_status_cancelled', { campaign_id: campaign.id });
      return res.json({ ok: true, data: updated.rows[0] });
    }

    if (!['draft', 'queued', 'sending', 'sent'].includes(requestedStatus)) {
      return res.status(400).json({ ok: false, error: 'Unsupported campaign status' });
    }

    const updated = await db.query(
      `UPDATE marketing_campaigns
       SET status = $2,
           updated_at = NOW()
       WHERE id = $1
         AND status <> 'cancelled'
       RETURNING id, status, queued_at, sent_at, updated_at`,
      [campaign.id, requestedStatus]
    );
    await writeAudit('campaign_status_updated', {
      campaign_id: campaign.id,
      requested_status: requestedStatus
    });
    return res.json({ ok: true, data: updated.rows[0] || null });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ ok: false, error: error.message });
    }
    return next(error);
  }
});

router.post('/campaigns/process-queue', async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.body.limit, 10) || 100, 500));
    const maxAttempts = Math.max(1, Math.min(parseInt(req.body.max_attempts, 10) || 4, 10));
    const result = await processPendingCampaignQueue({ limit, maxAttempts });

    await writeAudit('campaign_queue_processed', {
      limit,
      max_attempts: maxAttempts,
      result
    });

    return res.json({
      ok: true,
      data: result
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/campaigns/:id/cancel', async (req, res, next) => {
  try {
    const campaignId = req.params.id;
    const updated = await db.query(
      `UPDATE marketing_campaigns
       SET status = 'cancelled',
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, status, updated_at`,
      [campaignId]
    );
    if (!updated.rows.length) {
      return res.status(404).json({ ok: false, error: 'Campaign not found' });
    }

    await db.query(
      `UPDATE outbound_message_queue
       SET status = 'failed',
           last_error = 'cancelled_by_admin',
           updated_at = NOW()
       WHERE campaign_id = $1
         AND status IN ('pending','retry')`,
      [campaignId]
    );

    await writeAudit('campaign_cancelled', { campaign_id: campaignId });

    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/crm/summary', async (_req, res, next) => {
  try {
    const [summary, bySource, byType, demand, tasks] = await Promise.all([
      db.query(
        `${adminLeadUnionSql()}
         SELECT
           COUNT(*)::int AS total_leads,
           COUNT(*) FILTER (WHERE lead_status = 'open')::int AS open_leads,
           COUNT(*) FILTER (WHERE assigned_to_user_id IS NULL)::int AS unassigned_leads,
           COUNT(*) FILTER (WHERE priority IN ('high','urgent'))::int AS hot_leads,
           COUNT(*) FILTER (WHERE next_follow_up_at < NOW() AND lead_status = 'open')::int AS overdue_followups,
           COALESCE(SUM(budget), 0)::bigint AS budget_pipeline
         FROM all_leads`
      ),
      db.query(
        `${adminLeadUnionSql()}
         SELECT source, COUNT(*)::int AS total
         FROM all_leads
         GROUP BY source
         ORDER BY total DESC
         LIMIT 12`
      ),
      db.query(
        `${adminLeadUnionSql()}
         SELECT lead_type, COUNT(*)::int AS total
         FROM all_leads
         GROUP BY lead_type
         ORDER BY total DESC
         LIMIT 12`
      ),
      db.query(
        `${adminLeadUnionSql()}
         SELECT location, category, COUNT(*)::int AS total, COALESCE(AVG(budget), 0)::bigint AS avg_budget
         FROM all_leads
         WHERE location IS NOT NULL OR category IS NOT NULL
         GROUP BY location, category
         ORDER BY total DESC
         LIMIT 20`
      ),
      db.query(
        `SELECT status, COUNT(*)::int AS total
         FROM lead_tasks
         GROUP BY status
         ORDER BY total DESC`
      )
    ]);
    return res.json({
      ok: true,
      data: {
        summary: summary.rows[0] || {},
        bySource: bySource.rows,
        byType: byType.rows,
        demand: demand.rows,
        tasks: tasks.rows
      }
    });
  } catch (error) {
    if (['42P01', '42703'].includes(error.code)) {
      return res.json({
        ok: true,
        data: {
          summary: { total_leads: 0, open_leads: 0, unassigned_leads: 0, hot_leads: 0, overdue_followups: 0, budget_pipeline: 0 },
          bySource: [],
          byType: [],
          demand: [],
          tasks: [],
          provider_missing: true
        }
      });
    }
    return next(error);
  }
});

router.get('/notifications', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const status = cleanText(req.query.status);
    const channel = cleanText(req.query.channel);
    const values = [];
    const filters = [];
    if (status) {
      values.push(status);
      filters.push(`status = $${values.length}`);
    }
    if (channel) {
      values.push(channel);
      filters.push(`channel = $${values.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const count = await db.query(`SELECT COUNT(*)::int AS total FROM notifications ${where}`, values);
    const total = count.rows[0]?.total || 0;
    const rows = await db.query(
      `SELECT *
       FROM notifications
       ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length + 1}
       OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );
    return res.json({ ok: true, data: rows.rows, pagination: toPagination(total, page, limit) });
  } catch (error) {
    if (['42P01', '42703'].includes(error.code)) return res.json({ ok: true, data: [], pagination: toPagination(0, 1, 50) });
    return next(error);
  }
});

router.get('/emails', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const status = cleanText(req.query.status);
    const values = [];
    const filters = [];
    if (status) {
      values.push(status);
      filters.push(`status = $${values.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const count = await db.query(`SELECT COUNT(*)::int AS total FROM email_logs ${where}`, values);
    const total = count.rows[0]?.total || 0;
    const rows = await db.query(
      `SELECT *
       FROM email_logs
       ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length + 1}
       OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );
    return res.json({ ok: true, data: rows.rows, pagination: toPagination(total, page, limit) });
  } catch (error) {
    if (['42P01', '42703'].includes(error.code)) {
      const fallback = await db.query(
        `SELECT id, type AS event_type, recipient_email AS recipient_email_masked,
                type AS template_key, status, channel AS provider, failure_reason,
                related_listing_id, related_lead_id, created_at, sent_at
         FROM notifications
         WHERE channel = 'email'
         ORDER BY created_at DESC
         LIMIT 100`
      ).catch(() => ({ rows: [] }));
      return res.json({ ok: true, data: fallback.rows, pagination: toPagination(fallback.rows.length, 1, 100), fallback: true });
    }
    return next(error);
  }
});

router.post('/outreach/email/send', async (req, res, next) => {
  try {
    const recipientEmail = normalizeEmail(req.body?.to || req.body?.email);
    const subject = cleanText(req.body?.subject);
    const bodyText = cleanText(req.body?.body || req.body?.text);
    const leadId = cleanText(req.body?.lead_id || req.body?.leadId);
    const leadName = cleanText(req.body?.name || req.body?.lead_name || req.body?.leadName);
    const source = cleanText(req.body?.source);
    const reviewed = req.body?.reviewed === true || String(req.body?.reviewed || '').toLowerCase() === 'true';
    const errors = [];

    if (!reviewed) errors.push('reviewed=true is required before sending');
    if (!isValidEmail(recipientEmail)) errors.push('to must be a valid email address');
    if (!subject) errors.push('subject is required');
    if (subject.length > 180) errors.push('subject must be 180 characters or fewer');
    if (!bodyText) errors.push('body is required');
    if (bodyText.length > 8000) errors.push('body must be 8000 characters or fewer');
    if (!outboundEmailDisclosureOk(bodyText)) {
      errors.push('body must include makaug.com and an unsubscribe instruction');
    }
    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'Invalid outreach email payload', details: errors });
    }
    if (!emailProviderConfigured()) {
      return res.status(409).json({
        ok: false,
        error: 'Email provider is not configured',
        missingEnv: missingProviderEnv('email')
      });
    }

    const delivery = await sendSupportEmail({
      to: recipientEmail,
      subject,
      text: bodyText,
      replyTo: getSupportEmail()
    });
    const status = notificationStatusFromDelivery(delivery);
    await logEmailEvent(db, {
      eventType: 'outreach_email_send_attempt',
      recipientEmail,
      recipientRole: 'outreach_lead',
      templateKey: 'lead_outreach_launch_invitation',
      subject,
      status,
      provider: delivery.provider || null,
      providerMessageId: delivery.id || null,
      failureReason: delivery.sent ? null : (delivery.error || delivery.reason || 'outreach_email_send_failed'),
      sentAt: delivery.sent ? new Date() : null
    });
    await writeAudit('outreach_email_send_attempt', {
      lead_id: leadId || null,
      lead_name: leadName || null,
      recipient_domain: emailDomain(recipientEmail),
      source: source || null,
      subject,
      sent: delivery.sent === true,
      provider: delivery.provider || null,
      from: getDefaultEmailFrom(),
      status,
      reason: delivery.sent ? null : (delivery.error || delivery.reason || null)
    }, adminActorId(req));

    return res.status(delivery.sent ? 200 : 502).json({
      ok: delivery.sent === true,
      data: {
        status,
        provider: delivery.provider || null,
        message_id: delivery.id || null,
        accepted: delivery.accepted || [],
        from: getDefaultEmailFrom()
      },
      reason: delivery.sent ? null : (delivery.error || delivery.reason || 'outreach_email_send_failed')
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/outreach/whatsapp/send', async (req, res, next) => {
  try {
    const phone = normalizeConversationPhone(req.body?.to || req.body?.phone || req.body?.whatsapp);
    const bodyText = cleanText(req.body?.body || req.body?.text || req.body?.message);
    const leadId = cleanText(req.body?.lead_id || req.body?.leadId);
    const leadName = cleanText(req.body?.name || req.body?.lead_name || req.body?.leadName);
    const source = cleanText(req.body?.source);
    const reviewed = req.body?.reviewed === true || String(req.body?.reviewed || '').toLowerCase() === 'true';
    const requestedDeliveryMode = String(req.body?.delivery_mode || '').trim().toLowerCase();
    const effectiveDeliveryMode = ['provider', 'web_bridge', 'auto'].includes(requestedDeliveryMode)
      ? requestedDeliveryMode
      : getWhatsappDeliveryMode();
    const manualUrl = buildManualWhatsAppUrl(phone, bodyText);
    const errors = [];

    if (!reviewed) errors.push('reviewed=true is required before sending');
    if (!phone || phone.replace(/\D/g, '').length < 9) errors.push('to/phone must be a valid WhatsApp number');
    if (!bodyText) errors.push('body is required');
    if (bodyText.length > 1200) errors.push('body must be 1200 characters or fewer');
    if (!outboundWhatsappDisclosureOk(bodyText)) {
      errors.push('body must include makaug.com and STOP opt-out wording');
    }
    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'Invalid outreach WhatsApp payload', details: errors, manual_url: manualUrl || null });
    }

    const bridgeEnabled = isWhatsappWebBridgeEnabled();
    const canUseProvider = providerConfigured('whatsapp');
    if (!bridgeEnabled && !canUseProvider) {
      return res.status(409).json({
        ok: false,
        error: 'WhatsApp provider is not configured',
        missingEnv: missingProviderEnv('whatsapp'),
        manual_url: manualUrl || null
      });
    }

    let delivery = { sent: false, provider: null };
    let queuedForBridge = false;
    let bridgeQueueId = null;

    if (effectiveDeliveryMode === 'web_bridge' || (effectiveDeliveryMode === 'auto' && bridgeEnabled)) {
      try {
        const queued = await queueWhatsappWebBridgeMessage({
          recipient: phone,
          text: bodyText,
          source: 'admin_outreach_whatsapp',
          actorId: adminActorId(req),
          metadata: {
            lead_id: leadId || null,
            lead_name: leadName || null,
            source: source || null,
            reviewed: true,
            outbound_type: 'lead_outreach_opt_in'
          }
        });
        queuedForBridge = true;
        bridgeQueueId = queued?.id || null;
        delivery = {
          sent: false,
          queued: true,
          provider: 'whatsapp_web_bridge',
          id: bridgeQueueId,
          duplicate_suppressed: queued?.duplicate_suppressed === true
        };
      } catch (error) {
        delivery = {
          sent: false,
          provider: 'whatsapp_web_bridge',
          error: error.message || 'whatsapp_web_bridge_queue_failed'
        };
      }
    } else {
      delivery = await sendWhatsAppText({ to: phone, body: bodyText });
      if (!delivery.sent && bridgeEnabled) {
        const providerFailure = delivery;
        try {
          const queued = await queueWhatsappWebBridgeMessage({
            recipient: phone,
            text: bodyText,
            source: 'admin_outreach_whatsapp',
            actorId: adminActorId(req),
            metadata: {
              fallback_from: providerFailure.provider || 'provider',
              lead_id: leadId || null,
              lead_name: leadName || null,
              source: source || null,
              reviewed: true,
              outbound_type: 'lead_outreach_opt_in'
            }
          });
          queuedForBridge = true;
          bridgeQueueId = queued?.id || null;
          delivery = {
            sent: false,
            queued: true,
            provider: 'whatsapp_web_bridge',
            id: bridgeQueueId,
            fallback_reason: providerFailure.reason || providerFailure.error || null,
            duplicate_suppressed: queued?.duplicate_suppressed === true
          };
        } catch (error) {
          delivery = {
            sent: false,
            provider: providerFailure.provider || 'whatsapp_web_bridge',
            reason: providerFailure.reason || null,
            error: error.message || providerFailure.error || 'whatsapp_web_bridge_queue_failed'
          };
        }
      }
    }

    const status = notificationStatusFromDelivery(delivery);
    await logWhatsAppMessage(db, {
      recipientPhone: phone,
      templateKey: 'lead_outreach_opt_in',
      messageType: 'outreach',
      status,
      failureReason: delivery.sent || delivery.queued ? null : (delivery.error || delivery.reason || 'outreach_whatsapp_send_failed'),
      sentAt: delivery.sent ? new Date() : null
    });
    await logNotification(db, {
      recipientPhone: phone,
      channel: 'whatsapp',
      type: 'outreach_whatsapp_send_attempt',
      status,
      payloadSummary: {
        lead_id: leadId || null,
        lead_name: leadName || null,
        source: source || null,
        provider: delivery.provider || null,
        queued_for_bridge: queuedForBridge,
        message_preview: bodyText.slice(0, 160)
      },
      failureReason: delivery.sent || delivery.queued ? null : (delivery.error || delivery.reason || 'outreach_whatsapp_send_failed'),
      sentAt: delivery.sent ? new Date() : null
    });
    await writeAudit('outreach_whatsapp_send_attempt', {
      lead_id: leadId || null,
      lead_name: leadName || null,
      recipient_last4: phoneLastDigits(phone),
      source: source || null,
      sent: delivery.sent === true,
      queued_for_bridge: queuedForBridge,
      bridge_queue_id: bridgeQueueId,
      provider: delivery.provider || null,
      delivery_mode: effectiveDeliveryMode,
      status,
      reason: delivery.sent || delivery.queued ? null : (delivery.error || delivery.reason || null)
    }, adminActorId(req));

    const ok = delivery.sent === true || delivery.queued === true;
    return res.status(ok ? 200 : 502).json({
      ok,
      data: {
        status,
        provider: delivery.provider || null,
        queued_for_bridge: queuedForBridge,
        bridge_queue_id: bridgeQueueId,
        duplicate_suppressed: delivery.duplicate_suppressed === true,
        manual_url: manualUrl || null
      },
      reason: ok ? null : (delivery.error || delivery.reason || 'outreach_whatsapp_send_failed')
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/outlook-agent/status', async (req, res, next) => {
  try {
    const data = await getOutlookAgentStatus(db);
    return res.json({ ok: true, data });
  } catch (error) {
    return next(error);
  }
});

router.get('/outlook-agent/actions', async (req, res, next) => {
  try {
    const { limit } = parsePagination(req.query);
    const data = await listOutlookEmailActions(db, {
      limit,
      status: cleanText(req.query.status)
    });
    return res.json({ ok: true, data, pagination: toPagination(data.length, 1, limit) });
  } catch (error) {
    return next(error);
  }
});

router.post('/outlook-agent/sync', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.body?.limit || req.query?.limit || '10', 10) || 10, 1), 50);
    const result = await syncOutlookInbox(db, {
      limit,
      unreadOnly: req.body?.unread_only !== false,
      createGraphDraft: req.body?.create_graph_draft !== false
    });
    await writeAudit('outlook_agent_sync', {
      ok: result.ok,
      synced: result.synced || 0,
      reason: result.reason || null
    }, adminActorId(req));
    return res.json({ ok: true, data: result });
  } catch (error) {
    return next(error);
  }
});

router.post('/outlook-agent/draft', async (req, res, next) => {
  try {
    const fromEmail = cleanText(req.body?.from_email || req.body?.fromEmail || req.body?.email);
    const subject = cleanText(req.body?.subject);
    const body = cleanText(req.body?.body || req.body?.body_preview || req.body?.bodyPreview);
    const errors = [];
    if (!isValidEmail(fromEmail)) errors.push('from_email must be a valid email address');
    if (!subject) errors.push('subject is required');
    if (!body) errors.push('body is required');
    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'Invalid Outlook draft payload', details: errors });
    }
    const result = await queueOutlookReplyDraft(db, {
      ...req.body,
      fromEmail,
      subject,
      body
    }, {
      source: 'king_dashboard_manual_draft',
      createGraphDraft: req.body?.create_graph_draft !== false
    });
    await writeAudit('outlook_agent_draft_created', {
      action_id: result.action?.id || null,
      category: result.draft?.category || null,
      graph_draft_id: result.graphDraft?.graphDraftId || null
    }, adminActorId(req));
    return res.status(201).json({ ok: true, data: result });
  } catch (error) {
    return next(error);
  }
});

router.post('/outlook-agent/actions/:id/approve', async (req, res, next) => {
  try {
    const action = await approveOutlookEmailAction(db, req.params.id, adminActorId(req));
    if (!action) return res.status(404).json({ ok: false, error: 'Outlook email action not found' });
    await writeAudit('outlook_agent_draft_approved', { action_id: action.id }, adminActorId(req));
    return res.json({ ok: true, data: action });
  } catch (error) {
    if (['22P02', '42P01', '42703'].includes(error.code)) {
      return res.status(error.code === '22P02' ? 400 : 404).json({ ok: false, error: 'Outlook email action not available' });
    }
    return next(error);
  }
});

router.post('/outlook-agent/actions/:id/reject', async (req, res, next) => {
  try {
    const action = await rejectOutlookEmailAction(db, req.params.id, adminActorId(req), cleanText(req.body?.reason));
    if (!action) return res.status(404).json({ ok: false, error: 'Outlook email action not found' });
    await writeAudit('outlook_agent_draft_rejected', { action_id: action.id }, adminActorId(req));
    return res.json({ ok: true, data: action });
  } catch (error) {
    if (['22P02', '42P01', '42703'].includes(error.code)) {
      return res.status(error.code === '22P02' ? 400 : 404).json({ ok: false, error: 'Outlook email action not available' });
    }
    return next(error);
  }
});

router.post('/outlook-agent/actions/:id/send', async (req, res, next) => {
  try {
    const result = await sendApprovedOutlookEmailAction(db, req.params.id, adminActorId(req));
    const status = result.sent ? 200 : 409;
    await writeAudit('outlook_agent_send_attempt', {
      action_id: req.params.id,
      sent: result.sent,
      reason: result.reason || result.error || null
    }, adminActorId(req));
    return res.status(status).json({ ok: result.sent, data: result.action || null, reason: result.reason || result.error || null });
  } catch (error) {
    if (['22P02', '42P01', '42703'].includes(error.code)) {
      return res.status(error.code === '22P02' ? 400 : 404).json({ ok: false, error: 'Outlook email action not available' });
    }
    return next(error);
  }
});

router.get('/whatsapp-message-logs', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const status = cleanText(req.query.status);
    const values = [];
    const filters = [];
    if (status) {
      values.push(status);
      filters.push(`status = $${values.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const count = await db.query(`SELECT COUNT(*)::int AS total FROM whatsapp_message_logs ${where}`, values);
    const total = count.rows[0]?.total || 0;
    const rows = await db.query(
      `SELECT *
       FROM whatsapp_message_logs
       ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length + 1}
       OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );
    return res.json({ ok: true, data: rows.rows, pagination: toPagination(total, page, limit) });
  } catch (error) {
    if (['42P01', '42703'].includes(error.code)) {
      const fallback = await db.query(
        `SELECT id, user_phone AS recipient_phone_masked, status, channel AS message_type,
                last_error AS failure_reason, created_at, sent_at
         FROM outbound_message_queue
         ORDER BY created_at DESC
         LIMIT 100`
      ).catch(() => ({ rows: [] }));
      return res.json({ ok: true, data: fallback.rows, pagination: toPagination(fallback.rows.length, 1, 100), fallback: true });
    }
    return next(error);
  }
});

function buildAdminLeadFilters(query = {}) {
  const filters = [];
  const values = [];
  const addFilter = (sql, value) => {
    values.push(value);
    filters.push(sql.replace('?', `$${values.length}`));
  };
  if (query.status) addFilter('lead_status = ?', String(query.status).trim());
  if (query.source) addFilter('source = ?', String(query.source).trim());
  if (query.type) addFilter('lead_type = ?', String(query.type).trim());
  if (query.priority) addFilter('priority = ?', String(query.priority).trim());
  if (query.category) addFilter('category ILIKE ?', `%${String(query.category).trim()}%`);
  if (query.location) addFilter('location ILIKE ?', `%${String(query.location).trim()}%`);
  if (query.bundle_tag) addFilter(`COALESCE(metadata->>'bundle_tag', '') = ?`, String(query.bundle_tag).trim());
  if (query.date_from) addFilter('created_at >= ?::timestamptz', String(query.date_from).trim());
  if (query.date_to) addFilter(`created_at < (?::date + INTERVAL '1 day')`, String(query.date_to).trim());
  if (query.search) {
    values.push(`%${String(query.search).trim()}%`);
    filters.push(`(message ILIKE $${values.length} OR location ILIKE $${values.length} OR contact_name ILIKE $${values.length} OR contact_phone ILIKE $${values.length} OR contact_email ILIKE $${values.length})`);
  }
  return {
    values,
    where: filters.length ? `WHERE ${filters.join(' AND ')}` : ''
  };
}

function adminLeadUnionSql() {
  return `
    WITH crm_leads AS (
      SELECT
        l.id::text AS id,
        l.contact_id::text AS contact_id,
        l.user_id::text AS user_id,
        l.listing_id::text AS listing_id,
        l.campaign_id::text AS campaign_id,
        l.source,
        l.lead_type,
        l.category,
        l.location,
        l.budget,
        l.message,
        l.lifecycle_stage,
        l.lead_status,
        l.lead_score,
        l.priority,
        l.assigned_to_user_id::text AS assigned_to_user_id,
        l.next_follow_up_at,
        l.last_contacted_at,
        l.sla_status,
        l.outcome,
        l.lost_reason,
        l.metadata,
        l.created_at,
        l.updated_at,
        c.name AS contact_name,
        c.phone AS contact_phone,
        c.email AS contact_email,
        c.whatsapp AS contact_whatsapp,
        p.title AS listing_title
      FROM leads l
      LEFT JOIN contacts c ON c.id = l.contact_id
      LEFT JOIN properties p ON p.id = l.listing_id
    ),
    mortgage_enquiry_fallback AS (
      SELECT
        ('mortgage-enquiry:' || me.id::text) AS id,
        NULL::text AS contact_id,
        NULL::text AS user_id,
        NULL::text AS listing_id,
        NULL::text AS campaign_id,
        COALESCE(NULLIF(me.payload->>'source', ''), 'website_mortgage_finder') AS source,
        'mortgage' AS lead_type,
        COALESCE(NULLIF(me.property_purpose, ''), 'mortgage_help') AS category,
        NULLIF(COALESCE(me.payload->>'location', me.payload->>'preferred_area'), '') AS location,
        COALESCE(me.property_price, NULL)::bigint AS budget,
        trim(concat(
          'Mortgage help requested',
          CASE WHEN NULLIF(me.payload->>'reference', '') IS NOT NULL THEN ' • ' || (me.payload->>'reference') ELSE '' END,
          CASE WHEN NULLIF(me.payload->>'preferredProviderName', '') IS NOT NULL THEN ' • ' || (me.payload->>'preferredProviderName') ELSE '' END
        )) AS message,
        'new' AS lifecycle_stage,
        'open' AS lead_status,
        60 AS lead_score,
        'normal' AS priority,
        NULL::text AS assigned_to_user_id,
        NULL::timestamptz AS next_follow_up_at,
        NULL::timestamptz AS last_contacted_at,
        'open' AS sla_status,
        NULL::text AS outcome,
        NULL::text AS lost_reason,
        me.payload || jsonb_build_object(
          'mortgage_enquiry_id', me.id::text,
          'crm_lead_missing', true,
          'admin_visible_fallback', true
        ) AS metadata,
        me.created_at,
        me.created_at AS updated_at,
        COALESCE(NULLIF(me.payload->>'name', ''), 'Mortgage lead') AS contact_name,
        me.user_phone AS contact_phone,
        NULLIF(me.payload->>'email', '') AS contact_email,
        me.user_phone AS contact_whatsapp,
        NULL::text AS listing_title
      FROM mortgage_enquiries me
      WHERE NOT EXISTS (
        SELECT 1
        FROM leads l
        WHERE l.metadata->>'mortgage_enquiry_id' = me.id::text
      )
    ),
    all_leads AS (
      SELECT * FROM crm_leads
      UNION ALL
      SELECT * FROM mortgage_enquiry_fallback
    )`;
}

router.get('/leads', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { values, where } = buildAdminLeadFilters(req.query);
    const leadUnion = adminLeadUnionSql();
    const count = await db.query(
      `SELECT COUNT(*)::int AS total
       FROM (${leadUnion}
         SELECT * FROM all_leads
       ) lead_rows
       ${where}`,
      values
    );
    const total = count.rows[0]?.total || 0;
    const rows = await db.query(
      `${leadUnion}
       SELECT *
       FROM all_leads
       ${where}
       ORDER BY created_at DESC
       LIMIT $${values.length + 1}
       OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );
    return res.json({ ok: true, data: rows.rows, pagination: toPagination(total, page, limit) });
  } catch (error) {
    if (['42P01', '42703'].includes(error.code)) {
      return res.json({ ok: true, data: [], pagination: toPagination(0, 1, 50), provider_missing: true });
    }
    return next(error);
  }
});

function csvCell(value) {
  const text = value == null
    ? ''
    : (typeof value === 'object' ? JSON.stringify(value) : String(value));
  const safeText = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

router.get('/leads-export.csv', async (req, res, next) => {
  try {
    const { values, where } = buildAdminLeadFilters(req.query);
    const rows = await db.query(
      `${adminLeadUnionSql()}
       SELECT *
       FROM all_leads
       ${where}
       ORDER BY created_at DESC
       LIMIT 10000`,
      values
    );
    const columns = [
      'id', 'created_at', 'lead_status', 'lifecycle_stage', 'priority', 'source',
      'lead_type', 'category', 'location', 'budget', 'contact_name', 'contact_phone',
      'contact_email', 'contact_whatsapp', 'message', 'listing_title', 'bundle_tag'
    ];
    const lines = [columns.map(csvCell).join(',')];
    rows.rows.forEach((row) => {
      const output = { ...row, bundle_tag: row.metadata?.bundle_tag || '' };
      lines.push(columns.map((column) => csvCell(output[column])).join(','));
    });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="makaug-leads-${stamp}.csv"`);
    return res.send(`\uFEFF${lines.join('\n')}`);
  } catch (error) {
    if (['42P01', '42703'].includes(error.code)) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.send('id,created_at,lead_status,category,location\n');
    }
    return next(error);
  }
});

async function queryAdminMortgageLeads(req) {
  const { page, limit, offset } = parsePagination(req.query);
  const filters = [];
  const values = [];
  if (req.query.search) {
    values.push(`%${String(req.query.search).trim()}%`);
    filters.push(`(me.user_phone ILIKE $${values.length} OR (me.payload->>'name') ILIKE $${values.length} OR (me.payload->>'email') ILIKE $${values.length} OR (me.payload->>'preferredProviderName') ILIKE $${values.length})`);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const count = await db.query(
    `SELECT COUNT(*)::int AS total
     FROM mortgage_enquiries me
     ${where}`,
    values
  );
  const rows = await db.query(
    `SELECT
       me.*,
       l.id AS crm_lead_id,
       l.lead_status AS crm_lead_status,
       l.source AS crm_lead_source,
       c.name AS contact_name,
       c.email AS contact_email,
       c.phone AS contact_phone
     FROM mortgage_enquiries me
     LEFT JOIN leads l ON l.metadata->>'mortgage_enquiry_id' = me.id::text
     LEFT JOIN contacts c ON c.id = l.contact_id
     ${where}
     ORDER BY me.created_at DESC
     LIMIT $${values.length + 1}
     OFFSET $${values.length + 2}`,
    [...values, limit, offset]
  );
  return { page, limit, total: count.rows[0]?.total || 0, rows: rows.rows };
}

router.get('/mortgage-leads', async (req, res, next) => {
  try {
    const result = await queryAdminMortgageLeads(req);
    return res.json({
      ok: true,
      data: result.rows,
      pagination: toPagination(result.total, result.page, result.limit)
    });
  } catch (error) {
    if (['42P01', '42703'].includes(error.code)) {
      return res.json({ ok: true, data: [], pagination: toPagination(0, 1, 50), provider_missing: true });
    }
    return next(error);
  }
});

router.get('/mortgage-enquiries', async (req, res, next) => {
  try {
    const result = await queryAdminMortgageLeads(req);
    return res.json({
      ok: true,
      data: result.rows,
      pagination: toPagination(result.total, result.page, result.limit)
    });
  } catch (error) {
    if (['42P01', '42703'].includes(error.code)) {
      return res.json({ ok: true, data: [], pagination: toPagination(0, 1, 50), provider_missing: true });
    }
    return next(error);
  }
});

router.get('/leads/:id/matches', async (req, res, next) => {
  try {
    const leadId = req.params.id;
    const found = await db.query(
      `SELECT l.*, c.name AS contact_name, c.phone AS contact_phone, c.email AS contact_email,
              c.whatsapp AS contact_whatsapp
       FROM leads l
       LEFT JOIN contacts c ON c.id = l.contact_id
       WHERE l.id = $1
       LIMIT 1`,
      [leadId]
    );
    if (!found.rows.length) return res.status(404).json({ ok: false, error: 'Lead not found' });
    const { criteria, exactCount, matches } = await findLeadPropertyMatches(found.rows[0], LEAD_PROPERTY_MATCH_LIMIT);
    return res.json({
      ok: true,
      data: {
        lead: found.rows[0],
        criteria,
        exact_match_count: exactCount,
        matches,
        keep_open_until_contacted: true
      }
    });
  } catch (error) {
    if (['42P01', '42703'].includes(error.code)) {
      return res.status(503).json({ ok: false, error: 'CRM matching tables are not ready' });
    }
    return next(error);
  }
});

router.post('/leads/:id/match-message', async (req, res, next) => {
  try {
    const leadId = req.params.id;
    const selectedPropertyId = cleanText(req.body.property_id || req.body.propertyId);
    const found = await db.query(
      `SELECT l.*, c.name AS contact_name, c.phone AS contact_phone, c.email AS contact_email,
              c.whatsapp AS contact_whatsapp
       FROM leads l
       LEFT JOIN contacts c ON c.id = l.contact_id
       WHERE l.id = $1
       LIMIT 1`,
      [leadId]
    );
    if (!found.rows.length) return res.status(404).json({ ok: false, error: 'Lead not found' });
    const lead = found.rows[0];
    const phone = normalizeConversationPhone(lead.contact_whatsapp || lead.contact_phone);
    if (!phone) return res.status(400).json({ ok: false, error: 'Lead does not have a WhatsApp/phone number' });

    const { criteria, exactCount, matches } = await findLeadPropertyMatches(lead, LEAD_PROPERTY_MATCH_LIMIT);
    const property = selectedPropertyId
      ? matches.find((row) => String(row.id) === selectedPropertyId)
      : matches[0];
    if (!property) return res.status(404).json({ ok: false, error: 'No approved matching property is available for this lead yet' });

    const message = buildLeadMatchWhatsappMessage({ lead, property, criteria });
    const manualUrl = buildManualWhatsAppUrl(phone, message);
    await db.query(
      `UPDATE leads
       SET lifecycle_stage = 'matched_property_available',
           lead_status = 'open',
           metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
           updated_at = NOW()
       WHERE id = $1`,
      [
        leadId,
        JSON.stringify({
          match_status: 'matched_waiting_customer_contact',
          last_matched_listing_id: property.id,
          last_match_strength: property.match_strength || null,
          last_match_message_created_at: new Date().toISOString(),
          exact_match_count: exactCount,
          lead_status_policy: 'kept_open_until_customer_contact_or_agent_assignment'
        })
      ]
    );
    await addLeadActivity(db, {
      leadId,
      actorUserId: req.adminAuth?.userId || null,
      actorType: 'admin',
      activityType: 'whatsapp_no_match_property_matched',
      message: `Prepared WhatsApp match follow-up for ${property.title || property.id}`,
      metadata: {
        listing_id: property.id,
        match_strength: property.match_strength || null,
        manual_url_created: Boolean(manualUrl),
        lead_status_after_action: 'open'
      }
    });
    await logWhatsAppMessage(db, {
      recipientPhone: phone,
      templateKey: 'whatsapp_no_match_property_available',
      messageType: 'freeform',
      status: 'logged',
      relatedListingId: property.id,
      relatedLeadId: leadId
    });
    await writeAudit('crm_no_match_property_match_message_prepared', {
      lead_id: leadId,
      listing_id: property.id,
      match_strength: property.match_strength || null,
      exact_match_count: exactCount,
      recipient_last4: phoneLastDigits(phone),
      lead_status_after_action: 'open'
    }, adminActorId(req));

    return res.json({
      ok: true,
      data: {
        lead_id: leadId,
        property,
        phone,
        message,
        manual_url: manualUrl,
        exact_match_count: exactCount,
        lead_status: 'open'
      }
    });
  } catch (error) {
    if (['42P01', '42703'].includes(error.code)) {
      return res.status(503).json({ ok: false, error: 'CRM matching tables are not ready' });
    }
    return next(error);
  }
});

router.get('/leads/:id', async (req, res, next) => {
  try {
    const leadId = req.params.id;
    const lead = await db.query(
      `SELECT l.*, c.name AS contact_name, c.phone AS contact_phone, c.email AS contact_email,
              c.whatsapp AS contact_whatsapp, c.preferred_contact_channel, c.preferred_language,
              p.title AS listing_title, p.inquiry_reference AS listing_reference
       FROM leads l
       LEFT JOIN contacts c ON c.id = l.contact_id
       LEFT JOIN properties p ON p.id = l.listing_id
       WHERE l.id = $1
       LIMIT 1`,
      [leadId]
    );
    if (!lead.rows.length) return res.status(404).json({ ok: false, error: 'Lead not found' });
    const [activities, tasks] = await Promise.all([
      db.query('SELECT * FROM lead_activities WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 100', [leadId]),
      db.query('SELECT * FROM lead_tasks WHERE lead_id = $1 ORDER BY created_at DESC LIMIT 100', [leadId])
    ]);
    return res.json({ ok: true, data: { lead: lead.rows[0], activities: activities.rows, tasks: tasks.rows } });
  } catch (error) {
    return next(error);
  }
});

router.patch('/leads/:id', async (req, res, next) => {
  try {
    const leadId = req.params.id;
    const previous = await db.query('SELECT * FROM leads WHERE id = $1 LIMIT 1', [leadId]);
    if (!previous.rows.length) return res.status(404).json({ ok: false, error: 'Lead not found' });
    const updates = [];
    const values = [];
    const add = (field, value, cast = '') => {
      values.push(value);
      updates.push(`${field} = $${values.length}${cast}`);
    };
    [
      'lead_status',
      'lifecycle_stage',
      'priority',
      'sla_status',
      'outcome',
      'lost_reason'
    ].forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) add(field, cleanText(req.body[field]) || null);
    });
    if (Object.prototype.hasOwnProperty.call(req.body, 'assigned_to_user_id')) add('assigned_to_user_id', cleanText(req.body.assigned_to_user_id) || null);
    if (Object.prototype.hasOwnProperty.call(req.body, 'next_follow_up_at')) add('next_follow_up_at', cleanText(req.body.next_follow_up_at) || null, '::timestamptz');
    if (Object.prototype.hasOwnProperty.call(req.body, 'last_contacted_at')) add('last_contacted_at', cleanText(req.body.last_contacted_at) || null, '::timestamptz');
    if (Object.prototype.hasOwnProperty.call(req.body, 'bundle_tag')) {
      const bundleTag = cleanText(req.body.bundle_tag);
      add(
        'metadata',
        JSON.stringify(bundleTag ? { bundle_tag: bundleTag } : { bundle_tag: null }),
        "::jsonb"
      );
      updates[updates.length - 1] = `metadata = COALESCE(metadata, '{}'::jsonb) || $${values.length}::jsonb`;
    }
    if (!updates.length) return res.status(400).json({ ok: false, error: 'No lead updates provided' });
    values.push(leadId);
    const updated = await db.query(
      `UPDATE leads
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING *`,
      values
    );
    await addLeadActivity(db, {
      leadId,
      actorUserId: req.adminAuth?.userId || null,
      actorType: 'admin',
      activityType: 'status_change',
      oldStatus: previous.rows[0].lead_status,
      newStatus: updated.rows[0].lead_status,
      message: cleanText(req.body.note) || 'Lead updated by admin',
      metadata: { changed_fields: updates.map((item) => item.split(' = ')[0]) }
    });
    await writeAudit('crm_lead_updated', { lead_id: leadId }, adminActorId(req));
    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/leads/:id/activities', async (req, res, next) => {
  try {
    const leadId = req.params.id;
    const found = await db.query('SELECT id FROM leads WHERE id = $1 LIMIT 1', [leadId]);
    if (!found.rows.length) return res.status(404).json({ ok: false, error: 'Lead not found' });
    const activity = await addLeadActivity(db, {
      leadId,
      actorUserId: req.adminAuth?.userId || null,
      actorType: 'admin',
      activityType: cleanText(req.body.activity_type || req.body.activityType) || 'note',
      message: cleanText(req.body.message || req.body.note) || null,
      metadata: req.body.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {}
    });
    await writeAudit('crm_lead_activity_added', { lead_id: leadId, activity_id: activity?.id }, adminActorId(req));
    return res.status(201).json({ ok: true, data: activity });
  } catch (error) {
    return next(error);
  }
});

router.post('/leads/:id/tasks', async (req, res, next) => {
  try {
    const leadId = req.params.id;
    const title = cleanText(req.body.title);
    if (!title) return res.status(400).json({ ok: false, error: 'title is required' });
    const found = await db.query('SELECT id FROM leads WHERE id = $1 LIMIT 1', [leadId]);
    if (!found.rows.length) return res.status(404).json({ ok: false, error: 'Lead not found' });
    const task = await db.query(
      `INSERT INTO lead_tasks (lead_id, assigned_to_user_id, title, due_at, status, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        leadId,
        cleanText(req.body.assigned_to_user_id) || req.adminAuth?.userId || null,
        title,
        cleanText(req.body.due_at) || null,
        cleanText(req.body.status) || 'open',
        req.adminAuth?.userId || null
      ]
    );
    await addLeadActivity(db, {
      leadId,
      actorUserId: req.adminAuth?.userId || null,
      actorType: 'admin',
      activityType: 'task_created',
      message: title,
      metadata: { task_id: task.rows[0]?.id }
    });
    await writeAudit('crm_lead_task_created', { lead_id: leadId, task_id: task.rows[0]?.id }, adminActorId(req));
    return res.status(201).json({ ok: true, data: task.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/property-need-requests', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const status = cleanText(req.query.status);
    const values = [];
    const filters = [];
    if (status && status !== 'all') {
      values.push(status);
      filters.push(`pnr.status = $${values.length}`);
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const count = await db.query(`SELECT COUNT(*)::int AS total FROM property_need_requests pnr ${where}`, values);
    const total = count.rows[0]?.total || 0;
    const rows = await db.query(
      `SELECT pnr.*, c.name AS contact_name, c.email AS contact_email, c.phone AS contact_phone,
              l.id AS lead_id, l.lead_status, l.priority, l.next_follow_up_at
       FROM property_need_requests pnr
       LEFT JOIN contacts c ON c.id = pnr.contact_id
       LEFT JOIN leads l ON l.metadata->>'property_need_request_id' = pnr.id::text
       ${where}
       ORDER BY pnr.created_at DESC
       LIMIT $${values.length + 1}
       OFFSET $${values.length + 2}`,
      [...values, limit, offset]
    );
    return res.json({ ok: true, data: rows.rows, pagination: toPagination(total, page, limit) });
  } catch (error) {
    if (['42P01', '42703'].includes(error.code)) {
      return res.json({ ok: true, data: [], pagination: toPagination(0, 1, 50), provider_missing: true });
    }
    return next(error);
  }
});

router.patch('/property-need-requests/:id', async (req, res, next) => {
  try {
    const requestId = req.params.id;
    const status = cleanText(req.body.status || req.body.lead_status || req.body.leadStatus);
    const allowed = new Set(['new', 'in_review', 'agent_contacted', 'matched', 'resolved', 'closed']);
    if (!allowed.has(status)) return res.status(400).json({ ok: false, error: 'Unsupported property need status' });
    const previous = await db.query('SELECT * FROM property_need_requests WHERE id = $1 LIMIT 1', [requestId]);
    if (!previous.rows.length) return res.status(404).json({ ok: false, error: 'Property need request not found' });
    const updated = await db.query(
      `UPDATE property_need_requests
       SET status = $2,
           assigned_to_user_id = COALESCE($3, assigned_to_user_id),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [requestId, status, cleanText(req.body.assigned_to_user_id) || req.adminAuth?.userId || null]
    );
    const lead = await db.query(
      `SELECT id, lead_status FROM leads WHERE metadata->>'property_need_request_id' = $1 LIMIT 1`,
      [requestId]
    );
    if (lead.rows[0]?.id) {
      const leadStatus = ['resolved', 'closed'].includes(status) ? 'closed' : 'open';
      await db.query(
        `UPDATE leads
         SET lead_status = $2,
             lifecycle_stage = $3,
             outcome = CASE WHEN $3 = 'resolved' THEN 'resolved' ELSE outcome END,
             updated_at = NOW()
         WHERE id = $1`,
        [lead.rows[0].id, leadStatus, status]
      );
      await addLeadActivity(db, {
        leadId: lead.rows[0].id,
        actorUserId: req.adminAuth?.userId || null,
        actorType: 'admin',
        activityType: 'property_need_status_changed',
        oldStatus: previous.rows[0].status,
        newStatus: status,
        message: cleanText(req.body.note) || `Property need marked ${status}`,
        metadata: { property_need_request_id: requestId }
      });
    }
    await writeAudit('property_need_request_status_updated', {
      property_need_request_id: requestId,
      status,
      previous_status: previous.rows[0].status
    }, adminActorId(req));
    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

async function buildSetupStatus() {
  const superAdmin = await safeOne(
    `SELECT COUNT(*)::int AS total,
            MAX(last_login_at) AS last_login_at
     FROM users
     WHERE role = 'super_admin'`,
    [],
    { total: 0, last_login_at: null, force_password_change: null }
  );
  const adminSecurity = await safeOne(
    `SELECT
       COUNT(*)::int AS total,
       BOOL_OR(COALESCE(mfa_enabled, false)) AS mfa_enabled,
       BOOL_OR(COALESCE(force_password_change, false)) AS force_password_change,
       MAX(last_password_change_at) AS last_password_change_at
     FROM admin_security_settings`,
    [],
    { total: 0, mfa_enabled: false, last_password_change_at: null }
  );
  const auditCount = await safeCount(
    `SELECT COUNT(*)::int AS total FROM audit_logs WHERE action ILIKE '%admin%' OR action ILIKE '%launch%'`
  );
  const migrations = await safeRows(
    `SELECT name, applied_at FROM schema_migrations
     WHERE name IN ('033_task3_engagement_crm.sql','034_task4_super_admin_alerts_payments.sql')
     ORDER BY name`
  );
  const latestProof = await safeRows(
    `SELECT DISTINCT ON (action) action, details, created_at
     FROM audit_logs
     WHERE action IN (
       'safe_property_submission_test',
       'provider_test_email',
       'provider_test_whatsapp',
       'provider_test_sms',
       'provider_test_google_places',
       'provider_test_openai_llm',
       'provider_test_payment_link',
       'provider_test_backups',
       'ai_chatbot_smoke_test',
       'alert_matching_manual_run',
       'viewing_callback_launch_test',
       'advertising_payment_launch_test',
       'support_flows_launch_test'
     )
     ORDER BY action, created_at DESC`
  );
  const proofByAction = latestProof.reduce((acc, row) => {
    acc[row.action] = {
      createdAt: row.created_at,
      details: row.details || {}
    };
    return acc;
  }, {});

  const providers = [
    ['email', 'Email'],
    ['whatsapp', 'WhatsApp'],
    ['sms', 'SMS'],
    ['media_storage', 'Media storage / Cloudflare R2'],
    ['google_places', 'Google Maps/Places'],
    ['openai_llm', 'OpenAI/LLM'],
    ['payment_link', 'Payment provider'],
    ['backups', 'Backup storage / Cloudflare R2'],
    ['public_base_url', 'PUBLIC_BASE_URL']
  ].map(([key, label]) => ({
    key,
    label,
    configured: providerConfigured(key),
    requiredEnv: providerEnvKeys(key),
    missingEnv: missingProviderEnv(key),
    diagnostic: key === 'email' ? emailProviderDiagnostic() : null,
    warnings: key === 'sms' ? smsProviderWarnings() : []
  }));
  const llmMeta = getProviderMeta();
  const counts = {
    leads: await safeCount('SELECT COUNT(*)::int AS total FROM leads'),
    listingsPending: await safeCount(`SELECT COUNT(*)::int AS total FROM properties p WHERE ${adminPendingReviewWhere('p')}`),
    listingsApproved: await safeCount("SELECT COUNT(*)::int AS total FROM properties WHERE status = 'approved'"),    listingTests: await safeCount("SELECT COUNT(*)::int AS total FROM properties WHERE source = 'admin_test'"),
    failedEmails: await safeCount("SELECT COUNT(*)::int AS total FROM email_logs WHERE status IN ('failed','provider_missing')"),
    failedWhatsApp: await safeCount("SELECT COUNT(*)::int AS total FROM whatsapp_message_logs WHERE status IN ('failed','provider_missing')"),
    failedSms: await safeCount("SELECT COUNT(*)::int AS total FROM notifications WHERE channel = 'sms' AND status IN ('failed','provider_missing')"),
    savedSearches: await safeCount("SELECT COUNT(*)::int AS total FROM saved_searches WHERE status = 'active'"),
    propertyNeedRequests: await safeCount("SELECT COUNT(*)::int AS total FROM property_need_requests"),
    unresolvedPropertyNeedRequests: await safeCount("SELECT COUNT(*)::int AS total FROM property_need_requests WHERE status NOT IN ('resolved','closed')"),
    resolvedPropertyNeedRequests: await safeCount("SELECT COUNT(*)::int AS total FROM property_need_requests WHERE status IN ('resolved','closed')"),
    alertMatches: await safeCount("SELECT COUNT(*)::int AS total FROM alert_matches"),
    viewings: await safeCount('SELECT COUNT(*)::int AS total FROM viewing_bookings'),
    callbacks: await safeCount('SELECT COUNT(*)::int AS total FROM callback_requests'),
    campaigns: await safeCount('SELECT COUNT(*)::int AS total FROM advertising_campaigns'),
    invoices: await safeCount('SELECT COUNT(*)::int AS total FROM invoices'),
    fraudReports: await safeCount('SELECT COUNT(*)::int AS total FROM report_listings'),
    mortgageEnquiries: await safeCount('SELECT COUNT(*)::int AS total FROM mortgage_enquiries'),
    locationSearches: await safeCount("SELECT COUNT(*)::int AS total FROM property_search_requests WHERE payload ? 'location' AND payload->'location' IS NOT NULL"),
    whatsappLocationSearches: await safeCount("SELECT COUNT(*)::int AS total FROM property_search_requests WHERE user_phone IS NOT NULL AND payload ? 'location' AND payload->'location' IS NOT NULL"),
    languageFallbackLogs: await safeCount("SELECT COUNT(*)::int AS total FROM whatsapp_message_logs WHERE COALESCE(fallback_used, false) = true OR fallback_reason IS NOT NULL"),
    otpFailures: await safeCount("SELECT COUNT(*)::int AS total FROM otp_attempt_logs WHERE status IN ('failed','expired','provider_missing')")
  };
  const translation = translationProviderStatus();
  const requiredSuperAdminEnv = providerEnvKeys('super_admin');
  const missingSuperAdminEnv = missingEnv(requiredSuperAdminEnv);
  const ownerActions = [];
  if (missingSuperAdminEnv.length) {
    ownerActions.push({
      title: 'Create live super_admin',
      status: 'blocked',
      missingEnv: missingSuperAdminEnv,
      command: 'npm run admin:create-super'
    });
  } else if (!Number(superAdmin.total || 0)) {
    ownerActions.push({
      title: 'Run super_admin bootstrap',
      status: 'required',
      command: 'npm run admin:create-super'
    });
  }
  providers.forEach((provider) => {
    if (!provider.configured) {
      ownerActions.push({
        title: `Configure ${provider.label}`,
        status: 'provider_missing',
        missingEnv: provider.missingEnv,
        warnings: provider.warnings || []
      });
    }
  });
  ownerActions.push({
    title: 'Run proof buttons',
    status: 'required',
    command: 'Open /admin/setup-status and run safe property, provider, AI, alert, payment, and support proof actions.'
  });

  return {
    superAdmin: {
      exists: Number(superAdmin.total || 0) > 0,
      count: Number(superAdmin.total || 0),
      lastLoginAt: superAdmin.last_login_at || null,
      forcePasswordChange: adminSecurity.force_password_change === true,
      adminSecuritySettings: {
        rows: Number(adminSecurity.total || 0),
        mfaEnabled: adminSecurity.mfa_enabled === true,
        lastPasswordChangeAt: adminSecurity.last_password_change_at || null
      },
      auditLogStatus: auditCount > 0 ? 'available' : 'no_admin_audit_rows_found'
    },
    providers,
    database: {
      databaseUrlConnected: true,
      migrations033034: migrations,
      missingMigrations: ['033_task3_engagement_crm.sql', '034_task4_super_admin_alerts_payments.sql']
        .filter((name) => !migrations.some((row) => row.name === name)),
      migrationTableStatus: migrations.length ? 'readable' : 'missing_or_no_rows'
    },
    launchProof: {
      latest: proofByAction,
      counts,
      llm: {
        provider: llmMeta.provider,
        configured: Boolean(llmMeta.hasApiKey || llmMeta.baseURL)
      },
      paymentProviderConfigured: paymentProviderConfigured()
    },
    languageSystem: {
      registry: 'canonical',
      supportedLanguages: translation.supportedLanguages,
      defaultLanguage: translation.defaultLanguage,
      missingTranslationFallback: translation.fallbackMode,
      wrongLanguageGuard: 'Rukiga/Runyankole never map to Kinyarwanda; English fallback is used when unreviewed translations are missing.',
      providerStatus: translation
    },
    mediaStorage: {
      provider: mediaStorageProvider(),
      durableCloudConfigured: mediaStorageConfigured(),
      requiredEnv: providerEnvKeys('media_storage'),
      missingEnv: missingProviderEnv('media_storage'),
      publicBaseUrlConfigured: envSet('S3_PUBLIC_BASE_URL') || envSet('SUPABASE_URL'),
      productionRequirement: 'Use MEDIA_STORAGE_PROVIDER=s3 with Cloudflare R2/S3-compatible credentials for live listing and WhatsApp media.'
    },
    backupStorage: {
      provider: backupStorageProvider(),
      durableCloudConfigured: backupStorageConfigured(),
      requiredEnv: providerEnvKeys('backups'),
      missingEnv: missingProviderEnv('backups'),
      bucketConfigured: envSet('DATA_BACKUP_BUCKET'),
      productionRequirement: 'Use DATA_BACKUP_BUCKET with S3/R2 credentials so database backups, restore manifests, and AI export artifacts are not stored only on Render disk.'    },
    locationSystem: {
      geolocation: 'browser_permission_plus_manual_fallback',
      backendRadiusSearch: true,
      defaultRadiusMiles: DEFAULT_SEARCH_RADIUS_MILES,
      defaultRadiusKm: Number(DEFAULT_SEARCH_RADIUS_KM.toFixed(2)),
      ugandaBounds: 'lat -1.7..4.5, lng 29.2..35.2',
      googlePlacesConfigured: providerConfigured('google_places'),
      privacy: 'Exact listing coordinates are kept for listing moderation after consent; search analytics use rounded coordinates.'
    },
    ownerActions
  };
}

router.get('/setup-status', async (_req, res, next) => {
  try {
    return res.json({ ok: true, data: await buildSetupStatus() });
  } catch (error) {
    return next(error);
  }
});

router.get('/setup-status/resend-domain-records', async (req, res, next) => {
  try {
    const domain = cleanText(req.query.domain);
    const result = await lookupResendDomainRecords(domain);
    return res.status(result.ok ? 200 : 502).json({ ok: result.ok, data: result });
  } catch (error) {
    return next(error);
  }
});

router.post('/setup-status/provider-test', async (req, res, next) => {
  try {
    const provider = cleanText(req.body.provider || req.body.type);
    const allowed = ['email', 'whatsapp', 'sms', 'media_storage', 'google_places', 'openai_llm', 'payment_link', 'backups'];    if (!allowed.includes(provider)) {
      return res.status(400).json({ ok: false, error: 'Unsupported provider test' });
    }
    const configured = providerConfigured(provider);
    const base = {
      provider,
      configured,
      status: configured ? 'logged' : 'provider_missing',
      missingEnv: configured ? [] : missingProviderEnv(provider),
      warnings: provider === 'sms' ? smsProviderWarnings() : [],
      diagnostic: provider === 'email' ? emailProviderDiagnostic() : null
    };
    let log = null;
    if (provider === 'email') {
      let delivery = { sent: false, reason: 'email_provider_missing' };
      if (configured) {
        delivery = await sendSupportEmail({
          to: adminTestEmail(),
          subject: 'makaug email provider test',
          text: [
            'makaug email provider test.',
            'No action needed.',
            `Created: ${new Date().toISOString()}`
          ].join('\n')
        });
      }
      const deliveryStatus = configured ? notificationStatusFromDelivery(delivery) : 'provider_missing';
      log = await logEmailEvent(db, {
        eventType: 'admin_provider_test_email',
        recipientEmail: adminTestEmail(),
        recipientRole: 'admin',
        templateKey: 'provider_test_email',
        subject: 'makaug email provider test',
        status: deliveryStatus,
        provider: delivery.provider || (configured ? 'configured' : null),
        providerMessageId: delivery.id || null,
        failureReason: deliveryStatus === 'sent' || deliveryStatus === 'queued'
          ? null
          : (delivery.error || delivery.reason || delivery.setupAction || 'email_provider_test_failed'),
        sentAt: delivery.sent ? new Date() : null
      });
      await logNotification(db, {
        recipientEmail: adminTestEmail(),
        channel: 'email',
        type: 'provider_test_email',
        status: deliveryStatus,
        payloadSummary: {
          provider,
          configured,
          launch_proof: true,
          delivery_provider: delivery.provider || null,
          provider_status: delivery.status || null,
          setup_action: delivery.setupAction || null
        },
        failureReason: deliveryStatus === 'sent' || deliveryStatus === 'queued'
          ? null
          : (delivery.error || delivery.reason || delivery.setupAction || 'email_provider_test_failed'),
        sentAt: delivery.sent ? new Date() : null
      });
      base.status = deliveryStatus;
      base.deliveryChannel = 'email';
      base.deliveryProvider = delivery.provider || null;
      base.providerStatus = delivery.status || null;
      base.setupAction = delivery.setupAction || null;
      base.durationMs = delivery.durationMs || null;
      base.attemptedProviders = Array.isArray(delivery.attemptedProviders) ? delivery.attemptedProviders : [];
      base.failureReason = deliveryStatus === 'sent' || deliveryStatus === 'queued'
        ? null
        : (delivery.error || delivery.reason || delivery.setupAction || 'email_provider_test_failed');
      base.mocked = delivery.mocked === true;
    } else if (provider === 'whatsapp') {
      log = await logWhatsAppMessage(db, {
        recipientPhone: adminTestPhone(),
        templateKey: 'provider_test_whatsapp',
        messageType: 'template',
        status: configured ? 'queued' : 'provider_missing',
        failureReason: configured ? null : 'whatsapp_provider_missing'
      });
    } else if (provider === 'sms') {
      const deliveryResult = await sendPhoneOtp({
        to: adminTestPhone(),
        message: 'makaug SMS provider test. No action needed.'
      });
      const deliveryStatus = deliveryResult.ok
        ? notificationStatusFromDelivery(deliveryResult.delivery)
        : (configured ? 'failed' : 'provider_missing');
      log = await logNotification(db, {
        recipientPhone: adminTestPhone(),
        channel: 'sms',
        type: 'provider_test_sms',
        status: deliveryStatus,
        payloadSummary: {
          provider,
          configured,
          launch_proof: true,
          attempts: deliveryResult.attempts || []
        },
        failureReason: deliveryResult.ok ? null : (deliveryResult.failureReason || 'sms_provider_test_failed')
      });
      base.status = deliveryStatus;
      base.deliveryChannel = 'sms';
      base.attempts = deliveryResult.attempts || [];
    } else if (provider === 'media_storage') {
      let canary = null;
      if (configured) {
        canary = await uploadMediaStorageCanary();
        base.status = 'uploaded';
        base.cloudRef = canary.internalRef;
        base.publicUrl = canary.publicUrl || null;
        base.bytes = canary.bytes;
        base.sha256 = canary.sha256;
      }
      log = await logNotification(db, {
        recipientEmail: adminTestEmail(),
        channel: 'in_app',
        type: 'provider_test_media_storage',
        status: configured ? base.status : 'provider_missing',
        payloadSummary: {
          provider,
          configured,
          launch_proof: true,
          cloud_ref: canary?.internalRef || null,
          public_url: canary?.publicUrl || null,
          key: canary?.key || null,
          bytes: canary?.bytes || null,
          sha256: canary?.sha256 || null
        },
        failureReason: configured ? null : 'media_storage_provider_missing'
      });
    } else if (provider === 'backups') {
      let canary = null;
      if (configured) {
        canary = await uploadBackupStorageCanary();
        base.status = 'uploaded';
        base.cloudRef = canary.internalRef;
        base.bytes = canary.bytes;
        base.sha256 = canary.sha256;
      }
      log = await logNotification(db, {
        recipientEmail: adminTestEmail(),
        channel: 'in_app',
        type: 'provider_test_backups',
        status: configured ? 'logged' : 'provider_missing',        payloadSummary: {
          provider,
          configured,
          launch_proof: true,
          cloud_ref: canary?.internalRef || null,
          bucket: canary?.bucket || null,
          key: canary?.key || null,
          bytes: canary?.bytes || null,
          sha256: canary?.sha256 || null
        },
        failureReason: configured ? null : 'backups_provider_missing'      });
    } else {
      log = await logNotification(db, {
        recipientPhone: provider === 'sms' ? adminTestPhone() : null,
        recipientEmail: provider !== 'sms' ? adminTestEmail() : null,
        channel: provider === 'sms' ? 'sms' : 'in_app',
        type: `provider_test_${provider}`,
        status: configured ? 'logged' : 'provider_missing',
        payloadSummary: { provider, configured, launch_proof: true },
        failureReason: configured ? null : `${provider}_provider_missing`
      });
    }
    await createLaunchAudit(req, `provider_test_${provider}`, {
      configured,
      log_id: log?.id || null,
      missing_env: base.missingEnv,
      cloud_ref: base.cloudRef || null
    });
    return res.json({ ok: true, data: { ...base, logId: log?.id || null } });
  } catch (error) {
    return next(error);
  }
});

router.post('/setup-status/property-submission-test', async (req, res, next) => {
  try {
    const { listing, lead, reference } = await createSafeLaunchProperty(req);
    return res.status(201).json({
      ok: true,
      data: {
        reference,
        listingId: listing.id,
        listingStatus: listing.status,
        source: listing.source,
        leadId: lead?.id || null,
        nonPublicTest: true,
        logs: {
          email: providerConfigured('email') ? 'queued' : 'provider_missing',
          whatsapp: providerConfigured('whatsapp') ? 'queued' : 'provider_missing',
          notification: 'logged'
        }
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/setup-status/ai-smoke-test', async (req, res, next) => {
  try {
    const prompts = [
      ['search_rent', 'Find me a 2 bedroom rental in Ntinda under 1.5m.'],
      ['search_student', 'I need student accommodation near Makerere.'],
      ['create_alert', 'Save this search and alert me.'],
      ['book_viewing', 'Book a viewing.'],
      ['request_callback', 'Request a callback.'],
      ['list_property_whatsapp', 'I want to list property on WhatsApp.'],
      ['report_fraud', 'I think this listing is fraud.'],
      ['ask_mortgage', 'Can I get mortgage help?'],
      ['advertiser_interest', 'I want to advertise on makaug.'],
      ['language_change', 'Use Luganda.'],
      ['human_handoff', 'I need a human.']
    ];
    const llmMeta = getProviderMeta();
    const configured = providerConfigured('openai_llm');
    const results = [];
    for (const [intent, prompt] of prompts) {
      const lead = ['book_viewing', 'request_callback', 'list_property_whatsapp', 'report_fraud', 'ask_mortgage', 'advertiser_interest', 'human_handoff'].includes(intent)
        ? await createLead(db, {
          source: 'ai_admin_smoke_test',
          leadType: intent,
          category: 'ai_chatbot',
          contact: {
            name: 'makaug AI Smoke Test',
            email: adminTestEmail(),
            phone: adminTestPhone(),
            roleType: 'admin_test'
          },
          message: prompt,
          metadata: { launch_proof: true, intent, provider_configured: configured }
        })
        : null;
      await logNotification(db, {
        recipientEmail: adminTestEmail(),
        channel: 'in_app',
        type: 'ai_chatbot_smoke_prompt',
        status: configured ? 'logged' : 'provider_missing',
        relatedLeadId: lead?.id || null,
        payloadSummary: { prompt, intent, launch_proof: true, provider: llmMeta.provider },
        failureReason: configured ? null : 'llm_provider_missing'
      });
      results.push({
        prompt,
        intent,
        safeResponse: configured ? 'provider configured; prompt logged for smoke execution' : 'LLM provider missing; safe provider-missing state logged',
        leadId: lead?.id || null
      });
    }
    await createLaunchAudit(req, 'ai_chatbot_smoke_test', {
      configured,
      provider: llmMeta.provider,
      prompts: prompts.length,
      actionable_leads: results.filter((item) => item.leadId).length
    });
    return res.json({ ok: true, data: { configured, provider: llmMeta.provider, results } });
  } catch (error) {
    return next(error);
  }
});

router.post('/setup-status/run-alert-matcher', async (req, res, next) => {
  try {
    const { listing, reference } = await createSafeLaunchProperty(req, {
      title: `Launch proof alert listing ${buildListingReference()}`
    });
    const savedSearch = await db.query(
      `INSERT INTO saved_searches (
         phone, category, filters, label, location, min_price, max_price,
         alert_frequency, alert_channels, created_from, status
       )
       VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9::jsonb,$10,$11)
       RETURNING *`,
      [
        adminTestPhone(),
        listing.listing_type,
        JSON.stringify({ district: listing.district, area: listing.area, launch_proof: true }),
        `Launch proof alert ${reference}`,
        listing.area,
        0,
        Number(listing.price || 0) + 1,
        'instant',
        JSON.stringify(['in_app', 'email']),
        'admin_setup_status',
        'active'
      ]
    );
    const result = await matchListingToSavedSearches(db, listing);
    const summary = await getAlertSummary(db);
    await createLaunchAudit(req, 'alert_matching_manual_run', {
      listing_id: listing.id,
      saved_search_id: savedSearch.rows[0]?.id,
      matches_created: result?.created || 0,
      duplicates: result?.duplicates || 0
    });
    return res.json({
      ok: true,
      data: {
        listingId: listing.id,
        savedSearchId: savedSearch.rows[0]?.id,
        reference,
        matcher: result,
        summary
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/setup-status/viewing-callback-test', async (req, res, next) => {
  try {
    const { listing, reference } = await createSafeLaunchProperty(req, { title: `Launch proof viewing ${buildListingReference()}` });
    await db.query(
      `INSERT INTO viewing_configs (
         listing_id, accepts_viewings, booking_mode, manager_type, contact_method,
         available_days, available_time_windows, public_instructions
       )
       VALUES ($1,true,'request','owner','whatsapp',$2::jsonb,$3::jsonb,$4)
       ON CONFLICT (listing_id) DO UPDATE
       SET accepts_viewings = true, booking_mode = 'request', updated_at = NOW()`,
      [listing.id, JSON.stringify(['monday', 'tuesday']), JSON.stringify(['09:00-12:00']), 'Launch proof viewing config']
    );
    const viewingLead = await createLead(db, {
      source: 'admin_viewing_test',
      leadType: 'viewing',
      listingId: listing.id,
      contact: { name: 'Launch Viewing Test', email: adminTestEmail(), phone: adminTestPhone(), roleType: 'property_finder' },
      message: `Launch viewing proof for ${reference}`,
      metadata: { launch_proof: true, reference }
    });
    const booking = await db.query(
      `INSERT INTO viewing_bookings (
         listing_id, name, phone, email, preferred_date, preferred_time, contact_method, message, source, lead_id
       )
       VALUES ($1,$2,$3,$4,CURRENT_DATE + INTERVAL '2 days',$5,$6,$7,$8,$9)
       RETURNING *`,
      [listing.id, 'Launch Viewing Test', adminTestPhone(), adminTestEmail(), '10:00', 'whatsapp', `Launch viewing proof ${reference}`, 'admin_setup_status', viewingLead?.id || null]
    );
    const callbackLead = await createLead(db, {
      source: 'admin_callback_test',
      leadType: 'callback',
      listingId: listing.id,
      contact: { name: 'Launch Callback Test', email: adminTestEmail(), phone: adminTestPhone(), roleType: 'property_finder' },
      message: `Launch callback proof for ${reference}`,
      metadata: { launch_proof: true, reference }
    });
    const callback = await db.query(
      `INSERT INTO callback_requests (
         listing_id, name, phone, email, preferred_callback_time, contact_method, message, source, lead_id
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [listing.id, 'Launch Callback Test', adminTestPhone(), adminTestEmail(), 'Tomorrow morning', 'whatsapp', `Launch callback proof ${reference}`, 'admin_setup_status', callbackLead?.id || null]
    );
    await logNotification(db, {
      recipientEmail: adminTestEmail(),
      channel: 'in_app',
      type: 'viewing_callback_launch_test',
      status: 'logged',
      relatedListingId: listing.id,
      relatedLeadId: viewingLead?.id || callbackLead?.id || null,
      payloadSummary: { reference, booking_id: booking.rows[0]?.id, callback_id: callback.rows[0]?.id }
    });
    await createLaunchAudit(req, 'viewing_callback_launch_test', {
      listing_id: listing.id,
      booking_id: booking.rows[0]?.id,
      callback_id: callback.rows[0]?.id
    });
    return res.json({
      ok: true,
      data: {
        reference,
        listingId: listing.id,
        viewingBookingId: booking.rows[0]?.id,
        callbackRequestId: callback.rows[0]?.id,
        viewingLeadId: viewingLead?.id || null,
        callbackLeadId: callbackLead?.id || null
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/setup-status/advertising-payment-test', async (req, res, next) => {
  try {
    const stamp = launchTimestamp();
    const campaign = await db.query(
      `INSERT INTO advertising_campaigns (
         advertiser_name, advertiser_email, advertiser_phone, campaign_name,
         package_key, package_label, placements, target_locations, target_listing_types,
         audience_segments, creative_status, creative_brief, quoted_amount_ugx,
         payment_status, status
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        'makaug Launch Proof Advertiser',
        adminTestEmail(),
        adminTestPhone(),
        `Launch proof campaign ${stamp}`,
        'featured_property_boost',
        'Featured property boost',
        JSON.stringify(['homepage', 'category']),
        JSON.stringify(['Kampala']),
        JSON.stringify(['sale']),
        JSON.stringify(['buyers']),
        'brief_needed',
        'Admin-only launch proof campaign.',
        100000,
        'invoiced',
        'awaiting_payment'
      ]
    );
    const invoiceNumber = `MK-INV-${stamp}`;
    const invoice = await db.query(
      `INSERT INTO invoices (
         campaign_id, invoice_number, amount, currency, status, payment_method, payment_provider, due_date
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE + INTERVAL '7 days')
       RETURNING *`,
      [campaign.rows[0].id, invoiceNumber, 100000, 'UGX', 'pending_payment', 'manual', paymentProviderConfigured() ? 'configured_provider' : 'manual']
    );
    const paymentLink = await db.query(
      `INSERT INTO payment_links (
         provider, amount, currency, purpose, related_campaign_id, invoice_id,
         status, provider_reference, checkout_url, expires_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW() + INTERVAL '7 days')
       RETURNING *`,
      [
        paymentProviderConfigured() ? 'configured_provider' : 'manual',
        100000,
        'UGX',
        'campaign',
        campaign.rows[0].id,
        invoice.rows[0].id,
        paymentProviderConfigured() ? 'created' : 'provider_missing',
        invoiceNumber,
        process.env.PAYMENT_LINK_BASE_URL ? `${process.env.PAYMENT_LINK_BASE_URL.replace(/\/$/, '')}/${invoiceNumber}` : null
      ]
    );
    const paid = await markInvoicePaidManually(db, {
      invoiceId: invoice.rows[0].id,
      adminUserId: req.adminAuth?.userId || null,
      reason: 'Launch proof manual payment fallback',
      reference: `MANUAL-${stamp}`,
      req
    });
    await createLaunchAudit(req, 'advertising_payment_launch_test', {
      campaign_id: campaign.rows[0].id,
      invoice_id: invoice.rows[0].id,
      payment_link_id: paymentLink.rows[0]?.id,
      provider_configured: paymentProviderConfigured()
    });
    return res.json({
      ok: true,
      data: {
        campaignId: campaign.rows[0].id,
        invoiceId: invoice.rows[0].id,
        paymentLinkId: paymentLink.rows[0]?.id,
        invoiceStatus: paid.status,
        providerConfigured: paymentProviderConfigured(),
        manualFallbackAudited: true
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/setup-status/support-flow-test', async (req, res, next) => {
  try {
    const stamp = launchTimestamp();
    const mortgage = await createLead(db, {
      source: 'admin_mortgage_test',
      leadType: 'mortgage',
      category: 'mortgage_help',
      budget: 100000000,
      contact: { name: 'Launch Mortgage Test', email: adminTestEmail(), phone: adminTestPhone(), roleType: 'mortgage' },
      message: 'Launch proof mortgage help request.',
      metadata: { launch_proof: true, stamp }
    });
    const mortgageRow = await db.query(
      `INSERT INTO mortgage_enquiries (user_phone, property_price, property_purpose, deposit_percent, term_years, household_income, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       RETURNING id`,
      [adminTestPhone(), 150000000, 'home_purchase', 20, 20, 4500000, JSON.stringify({ launch_proof: true, lead_id: mortgage?.id || null })]
    ).catch(() => ({ rows: [] }));
    const help = await createLead(db, {
      source: 'admin_help_test',
      leadType: 'help_request',
      category: 'support',
      contact: { name: 'Launch Help Test', email: adminTestEmail(), phone: adminTestPhone(), roleType: 'support' },
      message: 'Launch proof help request.',
      metadata: { launch_proof: true, stamp }
    });
    const career = await createLead(db, {
      source: 'admin_careers_test',
      leadType: 'career_interest',
      category: 'field_agent',
      contact: { name: 'Launch Career Test', email: adminTestEmail(), phone: adminTestPhone(), roleType: 'career' },
      message: 'Launch proof careers request.',
      metadata: { launch_proof: true, role_interest: 'field_agent', stamp }
    });
    const fraud = await createLead(db, {
      source: 'admin_fraud_test',
      leadType: 'fraud_report',
      category: 'fraud',
      contact: { name: 'Launch Fraud Test', email: adminTestEmail(), phone: adminTestPhone(), roleType: 'fraud_reporter' },
      message: 'Launch proof fraud report.',
      metadata: { launch_proof: true, stamp }
    });
    const report = await db.query(
      `INSERT INTO report_listings (property_reference, reason, details, reporter_contact, status)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [`LAUNCH-${stamp}`, 'launch proof', 'Admin-only fraud report proof.', adminTestEmail(), 'open']
    );
    for (const [eventType, lead] of [
      ['mortgage_help_requested', mortgage],
      ['help_request_submitted', help],
      ['careers_request_submitted', career],
      ['fraud_report_submitted', fraud]
    ]) {
      await logEmailEvent(db, {
        eventType,
        recipientEmail: adminTestEmail(),
        recipientRole: 'admin',
        templateKey: eventType,
        subject: `makaug ${eventType.replace(/_/g, ' ')}`,
        status: providerConfigured('email') ? 'queued' : 'provider_missing',
        provider: providerConfigured('email') ? 'configured' : null,
        relatedLeadId: lead?.id || null,
        relatedMortgageLeadId: eventType === 'mortgage_help_requested' ? (mortgageRow.rows[0]?.id || null) : null,
        failureReason: providerConfigured('email') ? null : 'email_provider_missing'
      });
      await logNotification(db, {
        recipientEmail: adminTestEmail(),
        channel: 'in_app',
        type: eventType,
        status: 'logged',
        relatedLeadId: lead?.id || null,
        payloadSummary: { launch_proof: true, stamp }
      });
    }
    await createLaunchAudit(req, 'support_flows_launch_test', {
      mortgage_lead_id: mortgage?.id || null,
      mortgage_enquiry_id: mortgageRow.rows[0]?.id || null,
      help_lead_id: help?.id || null,
      career_lead_id: career?.id || null,
      fraud_lead_id: fraud?.id || null,
      report_id: report.rows[0]?.id || null
    });
    return res.json({
      ok: true,
      data: {
        mortgageLeadId: mortgage?.id || null,
        mortgageEnquiryId: mortgageRow.rows[0]?.id || null,
        helpLeadId: help?.id || null,
        careerLeadId: career?.id || null,
        fraudLeadId: fraud?.id || null,
        fraudReportId: report.rows[0]?.id || null
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/alerts', async (_req, res, next) => {
  try {
    const summary = await getAlertSummary(db);
    return res.json({ ok: true, data: summary });
  } catch (error) {
    return next(error);
  }
});

router.post('/alerts/:id/retry', async (req, res, next) => {
  try {
    const alert = await db.query(
      `UPDATE alert_matches
       SET status = 'pending',
           failure_reason = NULL
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );
    if (!alert.rows.length) return res.status(404).json({ ok: false, error: 'Alert match not found' });
    await writeAudit('alert_retry_requested', { alert_match_id: req.params.id }, adminActorId(req));
    return res.json({ ok: true, data: alert.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.post('/payments/invoices/:id/manual-paid', async (req, res, next) => {
  try {
    const invoice = await markInvoicePaidManually(db, {
      invoiceId: req.params.id,
      adminUserId: req.adminAuth?.userId || null,
      reason: cleanText(req.body.reason),
      reference: cleanText(req.body.reference || req.body.payment_reference),
      req
    });
    return res.json({ ok: true, data: invoice });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, error: error.message || 'Manual payment update failed' });
  }
});

router.post('/notifications/:id/retry', async (req, res, next) => {
  try {
    const result = await retryNotification(db, {
      id: req.params.id,
      adminUserId: req.adminAuth?.userId || null,
      req
    });
    return res.json({ ok: true, data: result });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, error: error.message || 'Notification retry failed' });
  }
});

router.post('/emails/:id/retry', async (req, res, next) => {
  try {
    const result = await retryEmailLog(db, {
      id: req.params.id,
      adminUserId: req.adminAuth?.userId || null,
      req
    });
    return res.json({ ok: true, data: result });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, error: error.message || 'Email retry failed' });
  }
});

router.post('/whatsapp-message-logs/:id/retry', async (req, res, next) => {
  try {
    const result = await retryWhatsAppLog(db, {
      id: req.params.id,
      adminUserId: req.adminAuth?.userId || null,
      req
    });
    return res.json({ ok: true, data: result });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, error: error.message || 'WhatsApp retry failed' });
  }
});

module.exports = router;
