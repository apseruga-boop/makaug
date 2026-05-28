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
  buildAutomatedListingReview,
  createOwnerEditToken,
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
const { hasAdminAccess, requireAdminApiKey } = require('../middleware/auth');
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

const router = express.Router();
const LAUNCH_SEED_LISTING_MARKERS = ['SOFT LAUNCH TEST - DELETE', 'QA TEST - DELETE'];
const LAUNCH_DUMMY_LISTING_TITLES = new Set(['sdgsdgd', 'sgsgsgsgs']);

function addFilter(filters, values, clause, ...vals) {
  let prepared = clause;
  vals.forEach((v) => {
    values.push(v);
    prepared = prepared.replace('?', `$${values.length}`);
  });
  filters.push(prepared);
}

function isLaunchSeedListing(row = {}) {
  const title = String(row.title || '');
  const normalizedTitle = title.trim().toLowerCase();
  const description = String(row.description || '');
  return LAUNCH_DUMMY_LISTING_TITLES.has(normalizedTitle)
    || LAUNCH_SEED_LISTING_MARKERS.some((marker) => title.includes(marker) || description.includes(marker));
}

function addPublicLaunchSeedFilter(filters, values) {
  LAUNCH_SEED_LISTING_MARKERS.forEach((marker) => {
    addFilter(
      filters,
      values,
      "(COALESCE(p.title, '') NOT ILIKE ? AND COALESCE(p.description, '') NOT ILIKE ?)",
      `%${marker}%`,
      `%${marker}%`
    );
  });
  LAUNCH_DUMMY_LISTING_TITLES.forEach((title) => {
    addFilter(filters, values, 'LOWER(TRIM(COALESCE(p.title, \'\'))) <> ?', title);
  });
  filters.push("COALESCE(p.source, '') !~* '(qa|test|demo|soft_launch|launch_proof)'");
  filters.push("COALESCE(p.listed_via, '') !~* '(qa|test|demo|soft_launch|launch_proof)'");
  filters.push("COALESCE(p.lister_name, '') !~* '(qa test delete|qa owner|dummy|sample)'");
  filters.push("COALESCE(p.inquiry_reference, '') !~* '^(SLT|QA|TEST|DUMMY|SAMPLE)-'");
  filters.push("COALESCE(p.extra_fields->>'qa_test_delete', '') !~* '^(true|1|yes)$'");
  filters.push("COALESCE(p.extra_fields->>'soft_launch_test', '') !~* '^(true|1|yes)$'");
  filters.push("COALESCE(p.extra_fields->>'is_test', '') !~* '^(true|1|yes)$'");
  filters.push("COALESCE(p.extra_fields->>'launch_proof', '') !~* '^(true|1|yes)$'");
  filters.push("COALESCE(p.extra_fields->>'non_public_test', '') !~* '^(true|1|yes)$'");
}

function normalizeListingType(type) {
  const t = cleanText(type).toLowerCase();
  if (t === 'students') return 'student';
  return t;
}

const PUBLIC_AREA_PIN_OVERRIDES = [
  { name: 'Ndejje', district: 'Wakiso', latitude: 0.244, longitude: 32.553, aliases: ['Ndejje', 'Ndejje Lubugumu'] },
  { name: 'Bujjuko Akright Estate', district: 'Wakiso', latitude: 0.374, longitude: 32.389, aliases: ['Bujjuko Akright', 'Bujuuko Akright', 'Akright', 'Bujjuko', 'Bujuuko'] },
  { name: 'Kakiri', district: 'Wakiso', latitude: 0.409, longitude: 32.38, aliases: ['Kakiri', 'Kakiri Masulita', 'Kakiri Masulita Hoima Road', 'Hoima Road'] },
  { name: 'Masulita', district: 'Wakiso', latitude: 0.51, longitude: 32.46, aliases: ['Masulita'] },
  { name: 'Kira', district: 'Wakiso', latitude: 0.3978, longitude: 32.6414, aliases: ['Kira', 'Kira Town'] },
  { name: 'Kira-Mulawa', district: 'Wakiso', latitude: 0.412, longitude: 32.65, aliases: ['Kira-Mulawa', 'Kira Mulawa', 'Mulawa'] },
  { name: 'Kira-Nsasa', district: 'Wakiso', latitude: 0.428, longitude: 32.665, aliases: ['Kira-Nsasa', 'Kira Nsasa', 'Nsasa'] },
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

function cleanPublicListingCopy(value = '') {
  return cleanText(value)
    .replace(/\s*Confirm the exact property pin with the listing agent before approval\.?/gi, '')
    .replace(/\s*Confirm exact gate or plot pin with the agent before public approval\.?/gi, '')
    .replace(/\s*Confirm latest availability, exact pin, and ownership authority before featuring\.?/gi, '')
    .replace(/\s*Pending King review[^.]*\.?/gi, '')
    .trim();
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
  if (type === 'student') return 'student accommodation';
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
  const price = publicPriceLabelFor(property);
  const bedrooms = Number(property.bedrooms);
  const bathrooms = Number(property.bathrooms);
  const facts = [
    area && `Area: ${area}`,
    type && `Type: ${type}`,
    price && `Guide price: ${price}`,
    Number.isFinite(bedrooms) && bedrooms > 0 ? `Bedrooms: ${bedrooms}` : '',
    Number.isFinite(bathrooms) && bathrooms > 0 ? `Bathrooms: ${bathrooms}` : ''
  ].filter(Boolean).join('. ');
  const source = sourceName ? `${sourceName} on ${sourcePlatform}` : sourcePlatform;
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

function publicExtraFields(extraFields = {}) {
  const extra = extraFields && typeof extraFields === 'object' ? extraFields : {};
  const landVerification = buildUgNlisLandVerificationPack(extra);
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
  const sourceContactLabel = cleanText(extra.source_contact_label)
    || (sourceContactUrl ? `Contact via ${sourceContactPlatform || 'source'} source` : null);
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
  return {
    city: extra.city || null,
    neighborhood: extra.neighborhood || null,
    street_name: extra.street_name || null,
    region: extra.region || null,
    resolved_location_label: extra.resolved_location_label || null,
    public_display_name: extra.public_display_name || null,
    preferred_contact_method: extra.preferred_contact_method || null,
    video_url: videoUrl || null,
    youtube_url: youtubeUrl || null,
    tiktok_url: tiktokUrl || null,
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
    first_seen_online_at: extra.first_seen_online_at || null,
    first_seen_online_label: extra.first_seen_online_label || null,
    first_posted_online_at: extra.first_posted_online_at || null,
    first_posted_online_label: extra.first_posted_online_label || null,
    source_published_at: extra.source_published_at || null,
    source_published_label: extra.source_published_label || null,
    original_publish_date_status: extra.original_publish_date_status || null,
    added_to_makaug_at: extra.added_to_makaug_at || null,
    added_to_makaug_label: extra.added_to_makaug_label || null,
    source_followers_label: extra.source_followers_label || null,
    source_audience_label: extra.source_audience_label || null,
    source_contact_url: sourceContactUrl || null,
    source_contact_label: sourceContactLabel,
    source_contact_method: extra.source_contact_method || null,
    source_contact_platform: sourceContactPlatform || null,
    source_channel_url: extra.source_channel_url || extra.youtube_channel_url || null,
    youtube_channel_url: extra.youtube_channel_url || extra.source_channel_url || null,
    area_highlights: cleanPublicListingCopy(extra.area_highlights || ''),
    nearby_facilities: Array.isArray(extra.nearby_facilities) ? extra.nearby_facilities : [],
    size_raw: extra.size_raw || '',
    land_verification: landVerification,
    ugnlis_title_volume: extra.ugnlis_title_volume || null,
    ugnlis_title_folio: extra.ugnlis_title_folio || null,
    ugnlis_county: extra.ugnlis_county || null,
    ugnlis_block: extra.ugnlis_block || null,
    ugnlis_plot: extra.ugnlis_plot || null,
    ugnlis_transaction_number: extra.ugnlis_transaction_number || null,
    ugnlis_search_reference: extra.ugnlis_search_reference || null,
    ugnlis_search_date: extra.ugnlis_search_date || null,
    ugnlis_search_letter_url: extra.ugnlis_search_letter_url || null,
    land_verification_status: landVerification.status,
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
  const publicLatitude = toNullableFloat(safeProperty.latitude);
  const publicLongitude = toNullableFloat(safeProperty.longitude);
  const publicTitle = foundOnlinePublic
    ? buildThirdPartyPublicTitle(safeProperty, safeExtra)
    : cleanPublicListingCopy(safeProperty.title || '');
  const publicDescription = foundOnlinePublic
    ? buildThirdPartyPublicSummary(safeProperty, safeExtra)
    : cleanPublicListingCopy(safeProperty.description || '');
  return {
    ...safeProperty,
    title: publicTitle,
    description: publicDescription,
    district: locationOverride?.district || safeProperty.district,
    latitude: publicLatitude == null && locationOverride ? locationOverride.latitude : safeProperty.latitude,
    longitude: publicLongitude == null && locationOverride ? locationOverride.longitude : safeProperty.longitude,
    extra_fields: safeExtra,
    land_verification: buildUgNlisLandVerificationPack(property?.extra_fields || {}),
    featured: safeProperty.featured === true || String(safeExtra?.featured || '').toLowerCase() === 'true',
    featured_at: safeProperty.featured_at || safeExtra?.featured_at || null,
    id_number_present: !!property?.id_number,
    id_document_present: !!property?.id_document_name,
    agent_id: foundOnlinePublic ? null : safeProperty.agent_id,
    lister_phone: foundOnlinePublic ? null : safeProperty.lister_phone,
    lister_email: foundOnlinePublic ? null : safeProperty.lister_email,
    primary_image_url: foundOnlinePublic ? null : safeProperty.primary_image_url,
    image: foundOnlinePublic ? null : safeProperty.image,
    images: foundOnlinePublic ? [] : images,
    third_party_discovery_result: foundOnlinePublic
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
      values.push(listingTypeFilter === 'student' ? 'student' : listingTypeFilter);
      whereType = ` AND listing_type = $2`;
    }

    const areas = await db.query(
      `SELECT DISTINCT area
       FROM properties
       WHERE status = 'approved' AND area ILIKE $1${whereType}
       ORDER BY area ASC
       LIMIT 20`,
      values
    );

    const streets = await db.query(
      `SELECT DISTINCT extra_fields->>'street_name' AS street_name
       FROM properties
       WHERE status = 'approved'
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

    const listingType = normalizeListingType(req.query.listing_type);
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
    const amenities = asArray(req.query.amenities).map((item) => cleanText(item).toLowerCase()).filter(Boolean);
    const studentCampus = cleanText(req.query.studentCampus || req.query.student_campus);
    const landTitleType = cleanText(req.query.landTitleType || req.query.land_title_type);
    const commercialType = cleanText(req.query.commercialType || req.query.commercial_type);
    const currency = cleanText(req.query.currency || 'UGX').toUpperCase();
    const source = cleanText(req.query.source || 'web_search');
    const language = cleanText(req.query.language || req.query.lang || 'en').toLowerCase();
    const sessionId = cleanText(req.query.session || req.query.session_id || req.query.guest_session_id);
    const locationSource = cleanText(req.query.locationSource || req.query.location_source);
    const publicOnly = parseBooleanLike(req.query.public_only || req.query.publicOnly, false);
    const featuredRaw = req.query.featured ?? req.query.is_featured ?? req.query.isFeatured;
    const featuredFilterRequested = featuredRaw !== undefined && featuredRaw !== null && cleanText(featuredRaw) !== '';
    const featuredOnly = parseBooleanLike(featuredRaw, false);
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

    if (publicOnly || !adminAccess) {
      addPublicLaunchSeedFilter(filters, values);
    }

    if (studentPortal) {
      addFilter(filters, values, "(p.listing_type = ? OR p.students_welcome = ?)", 'student', true);
    } else if (listingType && LISTING_TYPES.includes(listingType)) {
      addFilter(filters, values, 'p.listing_type = ?', listingType);
    }

    if (district) {
      addFilter(filters, values, 'p.district = ?', district);
    }

    if (area) {
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

    if (status && status !== 'all') {
      if (status === 'approved') {
        addFilter(filters, values, "(p.status = 'approved' OR (p.status = 'sold' AND p.sold_at >= NOW() - INTERVAL '7 days'))");
      } else {
        addFilter(filters, values, 'p.status = ?', status);
      }
    }
    if (featuredFilterRequested) {
      if (featuredOnly) {
        filters.push("(COALESCE(p.extra_fields->>'featured', 'false') IN ('true', '1', 'yes'))");
      } else {
        filters.push("(COALESCE(p.extra_fields->>'featured', 'false') NOT IN ('true', '1', 'yes'))");
      }
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
    if (studentCampus) {
      addFilter(
        filters,
        values,
        "(COALESCE(p.extra_fields->>'nearest_university', '') ILIKE ? OR COALESCE(p.extra_fields->>'student_campus', '') ILIKE ? OR COALESCE(p.description, '') ILIKE ?)",
        `%${studentCampus}%`,
        `%${studentCampus}%`,
        `%${studentCampus}%`
      );
    }
    if (landTitleType) {
      addFilter(filters, values, "(COALESCE(p.title_type, '') ILIKE ? OR COALESCE(p.extra_fields->>'title_type', '') ILIKE ?)", `%${landTitleType}%`, `%${landTitleType}%`);
    }
    if (commercialType) {
      addFilter(filters, values, "(p.property_type ILIKE ? OR COALESCE(p.extra_fields->>'commercial_type', '') ILIKE ?)", `%${commercialType}%`, `%${commercialType}%`);
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

    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM properties p ${where}`, values);
    const total = countResult.rows[0]?.total || 0;
    if (total === 0) {
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
              commercial_type: commercialType || null
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

    const sortMap = {
      featured: "p.extra_fields->>'featured_at' DESC NULLS LAST, p.updated_at DESC, p.created_at DESC",
      newest: 'p.created_at DESC',
      price_asc: 'p.price ASC NULLS LAST',
      price_desc: 'p.price DESC NULLS LAST'
    };

    const defaultSort = featuredFilterRequested && featuredOnly ? 'featured' : 'newest';
    const sortBy = cleanText(req.query.sort || defaultSort).toLowerCase();
    const orderBy = hasRadiusSearch
      ? `${distanceSql} ASC NULLS LAST, p.created_at DESC`
      : (sortMap[sortBy] || sortMap.newest);

    const listValues = [...values, limit, offset];

    const listResult = await db.query(
      `SELECT
        p.id,
        p.listing_type,
        p.title,
        p.description,
        p.district,
        p.area,
        p.address,
        p.price,
        p.price_period,
        p.bedrooms,
        p.bathrooms,
        p.property_type,
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
        p.extra_fields AS admin_extra_fields,
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
        img.url AS primary_image_url,
        CASE
          WHEN p.agent_id IS NOT NULL OR p.lister_type = 'agent' THEN 'agent'
          ELSE 'private'
        END AS listed_by,
        CASE
          WHEN p.agent_id IS NOT NULL THEN COALESCE(a.registration_status, 'not_registered')
          WHEN p.lister_type = 'agent' THEN COALESCE(p.extra_fields->>'lister_registration_status', 'not_registered')
          ELSE COALESCE(p.extra_fields->>'lister_registration_status', 'not_registered')
        END AS registration_status
      FROM properties p
      LEFT JOIN agents a ON a.id = p.agent_id
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
      OFFSET $${values.length + 2}`,
      listValues
    );
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
              commercial_type: commercialType || null
            },
            result_count: listResult.rows.length,
            outside_uganda: false
          })]
        );
      } catch (logError) {
        logger.warn('Failed to log radius property search', { error: logError.message });
      }
    }

    return res.json({
      ok: true,
      data: listResult.rows.map((row) => {
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
          ...publicRow
        } = row;
        const distanceKm = row.distance_km == null ? null : Number(Number(row.distance_km).toFixed(3));
        const safeExtra = publicExtraFields(adminExtraFields || {});
        const foundOnlinePublic = isFoundOnlinePublicRow(row, safeExtra);
        const primaryImageUrl = foundOnlinePublic ? null : normalizePublicImageUrl(row.primary_image_url);
        const locationOverride = publicLocationOverrideForListing(row, safeExtra);
        const rowLatitude = toNullableFloat(row.latitude);
        const rowLongitude = toNullableFloat(row.longitude);
        const publicDistrict = locationOverride?.district || row.district;
        const publicLatitude = rowLatitude == null && locationOverride ? locationOverride.latitude : row.latitude;
        const publicLongitude = rowLongitude == null && locationOverride ? locationOverride.longitude : row.longitude;
        const publicTitle = foundOnlinePublic
          ? buildThirdPartyPublicTitle(row, safeExtra)
          : cleanPublicListingCopy(publicRow.title || '');
        const publicDescription = foundOnlinePublic
          ? buildThirdPartyPublicSummary(row, safeExtra)
          : cleanPublicListingCopy(publicRow.description || '');
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
          distance_km: distanceKm,
          distanceKm,
          distance_miles: distanceKm == null ? null : Number(kmToMiles(Number(distanceKm)).toFixed(2)),
          distanceMiles: distanceKm == null ? null : Number(kmToMiles(Number(distanceKm)).toFixed(2)),
          extra_fields: safeExtra,
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
      pagination: toPagination(total, page, limit)
    });
  } catch (error) {
    return next(error);
  }
}

router.get('/search', listPropertiesHandler);
router.get('/', listPropertiesHandler);

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
    const canViewNonPublic = property.status === 'approved'
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
    const price = toNullableInt(body.price);

    const errors = [];

    if (!LISTING_TYPES.includes(listingType)) errors.push('listing_type is required and must be valid');
    if (!title) errors.push('title is required');
    if (!district) errors.push('district is required');
    if (!area) errors.push('area is required');
    if (!description) errors.push('description is required');
    if (price == null || price < 10000) errors.push('price must be provided in UGX');

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
    const idDocumentName = cleanText(body.id_document_name || extraFields?.verify?.id_document_name);
    const idDocumentUrl = cleanText(body.id_document_url || extraFields?.verify?.id_document_url);
    const idDocumentType = cleanText(body.id_document_type || body.id_document_mime_type || extraFields?.verify?.id_document_type || extraFields?.verify?.id_document_mime_type);

    if (listerEmail && !isValidEmail(listerEmail)) errors.push('lister_email is invalid');
    if (listerPhone && !isValidPhone(listerPhone)) errors.push('lister_phone is invalid');
    if (listerPhone && !isValidUgPhone(listerPhone)) errors.push('lister_phone must be a valid Uganda phone (+256XXXXXXXXX)');
    if (latitude != null && (latitude < -90 || latitude > 90)) errors.push('latitude is out of range');
    if (longitude != null && (longitude < -180 || longitude > 180)) errors.push('longitude is out of range');

    const listedVia = cleanText(body.listed_via || (brokerCanSkipOwnerIdentity ? 'broker_dashboard' : 'website')).toLowerCase();
    const listedViaBrokerPath = listedVia.includes('broker');
    const enforceOtp = !brokerCanSkipOwnerIdentity && (listedVia === 'website' || listedVia === 'web' || listedVia === 'desktop' || listedViaBrokerPath);
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

    if (enforceOtp) {
      if (otpChannel === 'email') {
        if (!listerEmailNormalized || !isValidEmail(listerEmailNormalized)) {
          errors.push('lister_email is required for email OTP verification');
        }
      } else if (!listerPhone) {
        errors.push('lister_phone is required for OTP verification');
      }
      if (submittedImages.length < websiteMinImages || submittedImages.length > websiteMaxImages) {
        errors.push(`At least ${websiteMinImages} and no more than ${websiteMaxImages} property images are required for website submissions`);
      }
      if (invalidSubmittedImages.length) {
        errors.push('Each property image must include a viewable image URL');
      }
      if (!idDocumentName && !idDocumentUrl) {
        errors.push('National ID photo is required. Upload a photo image; PDFs are not accepted');
      } else if (!isAcceptedNationalIdPhoto({ name: idDocumentName, url: idDocumentUrl, mimeType: idDocumentType })) {
        errors.push('National ID must be uploaded as a photo image. PDFs are not accepted. Please take a picture and upload it');
      }
      if (!listingOtpToken) {
        errors.push('listing_otp_token is required. Verify OTP before submit');
      } else {
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
    const landVerificationFields = sanitizeUgNlisLandVerificationFields({
      ...extraFields,
      ...body
    });
    if (listingType === 'land' || Object.keys(landVerificationFields).length) {
      Object.assign(extraFields, landVerificationFields);
    }
    if (brokerCanSkipOwnerIdentity) {
      extraFields.broker_submission = true;
      extraFields.broker_agent_id = brokerAgent.id;
      extraFields.broker_listing_review = 'Admin approval required before this broker listing goes live.';
      extraFields.skip_owner_identity_recheck = true;
    }

    const insertResult = await db.query(
      `INSERT INTO properties (
        listing_type,
        title,
        description,
        district,
        area,
        address,
        price,
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
        $41,$42,$43,$44,$45,$46,$47,$48
      ) RETURNING id`,
      [
        listingType,
        title,
        description,
        district,
        area,
        cleanText(body.address) || null,
        price,
        cleanText(body.price_period) || null,
        toNullableInt(body.bedrooms),
        toNullableInt(body.bathrooms),
        cleanText(body.property_type) || null,
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
        cleanText(body.nearest_university) || null,
        toNullableFloat(body.distance_to_uni_km),
        cleanText(body.room_type) || null,
        cleanText(body.room_arrangement) || null,
        cleanText(body.commercial_intent) || null,
        latitude,
        longitude,
        listingType === 'student' ? true : studentsWelcome,
        verificationTermsAccepted,
        inquiryReference,
        cleanText(body.id_number) || null,
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

    const imageItems = submittedImageItems.slice(0, enforceOtp ? websiteMaxImages : 20);
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

    const ownerNotificationListing = {
      id: propertyId,
      title,
      listing_type: listingType,
      inquiry_reference: inquiryReference,
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
         AND p.status IN ('approved','sold')
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

router.patch('/:id/status', requireAdminApiKey, async (req, res, next) => {
  try {
    const nextStatus = cleanText(req.body.status).toLowerCase();
    let moderationReason = cleanText(req.body.reason) || null;
    const reviewNotes = cleanText(req.body.review_notes || req.body.notes) || null;
    const warningOverrides = req.body.warning_overrides && typeof req.body.warning_overrides === 'object'
      ? req.body.warning_overrides
      : {};

    if (!PROPERTY_STATUSES.includes(nextStatus)) {
      return res.status(400).json({ ok: false, error: 'Invalid status value' });
    }

    if (nextStatus === 'rejected' && !moderationReason) {
      return res.status(400).json({ ok: false, error: 'reason is required when rejecting a listing' });
    }

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

    const current = currentResult.rows[0];
    const actorId = req.adminAuth?.userId || req.adminAuth?.type || 'admin_api_key';
    const reviewerUserId = toUuidOrNull(req.adminAuth?.userId);
    const isSourcedCandidate = isSourcedInventoryCandidateRecord(current);
    const requestedSourcedCandidateOverride = nextStatus === 'approved'
      && parseBooleanLike(req.body.sourced_candidate_override || req.body.sourced_candidate_special_dispensation, false);
    const sourcedCandidateConsentConfirmed = parseBooleanLike(req.body.consent_confirmed, false);
    const sourcedCandidateImageRightsConfirmed = parseBooleanLike(req.body.image_rights_confirmed, false);
    const sourcedCandidateLocationConfirmed = parseBooleanLike(req.body.found_online_location_confirmed || req.body.location_confirmed, false);

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
    const approvalWarnings = [];
    let automatedReview = null;
    if (nextStatus === 'approved') {
      try {
        automatedReview = await loadAutomatedReviewForProperty(req.params.id);
      } catch (error) {
        logger.error('Automated approval review failed; continuing with saved checklist', {
          property_id: req.params.id,
          message: error.message
        });
        approvalWarnings.push('Automated review refresh failed; used saved checklist data.');
      }
    }
    const checklistSource = automatedReview?.checklist
      || (req.body.checklist && typeof req.body.checklist === 'object' ? req.body.checklist : current.moderation_checklist);
    const checklist = normalizeReviewChecklist(checklistSource);
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

    let sourcedCandidateDispensation = null;
    if (sourcedCandidateOverride) {
      moderationReason = moderationReason || 'Approved as found-online intake after location was confirmed and non-location source-review checks were overridden.';
      sourcedCandidateDispensation = {
        used: true,
        source: 'found_online_property_source_v1',
        at: new Date().toISOString(),
        actor_id: actorId,
        approval_policy: 'location_required_non_location_checks_admin_override',
        location_confirmed: sourcedCandidateLocationConfirmed || sourcedCandidateRecordHasApprovalLocation(current),
        consent_confirmed: sourcedCandidateConsentConfirmed,
        image_rights_confirmed: sourcedCandidateImageRightsConfirmed,
        missing_checks_overridden: missingChecks,
        warning_checks_overridden: missingWarningOverrides,
        reason: moderationReason
      };
      approvalWarnings.push('Found-online approval used; admin confirmed location and overrode non-location review checks.');
    }
    const sourcedCandidateExtraFields = sourcedCandidateDispensation
      ? {
        sourced_candidate_special_dispensation: sourcedCandidateDispensation,
        found_online_approval_policy: 'location_required_non_location_checks_admin_override',
        found_online_location_confirmed: sourcedCandidateDispensation.location_confirmed,
        found_online_non_location_checks_overridden: true,
        ...(sourcedCandidateConsentConfirmed ? { consent_confirmed: true } : {}),
        ...(sourcedCandidateImageRightsConfirmed ? {
          image_rights_confirmed: true,
          image_rights_status: 'admin_confirmed_authorised'
        } : {})
      }
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
         RETURNING id, title, listing_type, inquiry_reference, lister_name, lister_phone, lister_email, status, reviewed_at, approved_at, last_moderation_notification_at, moderation_stage, moderation_checklist, moderation_notes, moderation_reason, extra_fields`,
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
          sourcedCandidateExtraFields ? JSON.stringify(sourcedCandidateExtraFields) : null
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
         RETURNING id, title, listing_type, inquiry_reference, lister_name, lister_phone, lister_email, status, reviewed_at, extra_fields`,
        [
          req.params.id,
          nextStatus,
          moderationStage,
          JSON.stringify(checklist),
          reviewNotes,
          moderationReason,
          JSON.stringify(warningOverrides),
          sourcedCandidateExtraFields ? JSON.stringify(sourcedCandidateExtraFields) : null
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
    let notification = {
      email: { sent: false, reason: 'not_attempted' },
      whatsapp: { sent: false, reason: 'not_attempted' }
    };

    try {
      notification = await sendOwnerListingStatusNotifications({
        listing: {
          ...listing,
          owner_edit_token: regeneratedOwnerToken
        },
        status: nextStatus,
        reason: moderationReason
      });
      if (notification.email?.sent || notification.whatsapp?.sent) {
        await db.query(
          'UPDATE properties SET last_moderation_notification_at = NOW() WHERE id = $1',
          [listing.id]
        );
      }
    } catch (error) {
      notification = { sent: false, reason: 'notification_failed', error: error.message || 'send_failed' };
    }

    try {
      const moderationEventDelivery = sourcedCandidateDispensation
        ? {
          ...notification,
          sourced_candidate_special_dispensation: sourcedCandidateDispensation
        }
        : notification;
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
            'Admin confirmed location and overrode non-location checks for this found-online approval.',
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

    let alertMatching = null;
    if (nextStatus === 'approved' && current.status !== 'approved') {
      alertMatching = await matchListingToSavedSearches(db, { ...current, ...listing });
    }

    return res.json({
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
