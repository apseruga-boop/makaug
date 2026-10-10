'use strict';

// Public listing copy shared by the JSON API (routes/properties.js) and the
// server-rendered pages (services/publicSeoRenderService.js), so both show the
// same title, description, price label, amenities and contact line.
//
// Found-online rows get a factual makaug-written title/summary unless a person
// corrected the text: staff (extra_fields.staff_corrected_fields) or King
// (king_review_facts_confirmed / king_review_corrected_fields). Staff-corrected
// fields always win and skip the "looks copied" heuristics.

const { cleanText } = require('../middleware/validation');
const {
  landTitleAvailabilityLabel,
  normalizeLandTitleAvailability
} = require('../utils/landTitleAvailability');
const { normalizePricePeriodForWrite } = require('../utils/propertyPriceCurrency');
const { humanPropertyTypeLabel } = require('../utils/commercialClassification');

const ACTIVE_COUNTRY_CODE = String(process.env.COUNTRY_CODE || 'UG').trim().toUpperCase();
const IS_SOUTH_AFRICA = ACTIVE_COUNTRY_CODE === 'ZA';
const ACTIVE_COUNTRY_NAME = IS_SOUTH_AFRICA ? 'South Africa' : 'Uganda';
const ACTIVE_PUBLIC_DOMAIN = IS_SOUTH_AFRICA ? 'seshaikhaya.com' : 'makaug.com';
const ACTIVE_PUBLIC_BRAND_LABEL = IS_SOUTH_AFRICA ? ACTIVE_PUBLIC_DOMAIN : 'Makaug';
const STAFF_COPY_MAX_CHARS = 2000;

function asStringList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
  if (typeof value === 'string' && value.trim()) {
    const text = value.trim();
    if (text.startsWith('[')) {
      try { return asStringList(JSON.parse(text)); } catch (_) { /* fall through */ }
    }
    return text.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  }
  return [];
}

function truthy(value) {
  return value === true || ['true', '1', 'yes'].includes(String(value || '').trim().toLowerCase());
}

// Review flags live in the RAW extra_fields (publicExtraFields() drops them),
// so read property.extra_fields first and fall back to the extra passed in.
function copyReviewState(property = {}, extra = {}) {
  const candidates = [property?.admin_extra_fields, property?.extra_fields].filter((item) => item && typeof item === 'object');
  const raw = candidates.find((item) => item.staff_corrected_fields !== undefined || item.king_review_corrected_fields !== undefined || item.king_review_facts_confirmed !== undefined)
    || candidates[0]
    || {};
  const pick = (key) => (raw[key] !== undefined ? raw[key] : (extra || {})[key]);
  const staffFields = asStringList(pick('staff_corrected_fields'));
  const kingFields = asStringList(pick('king_review_corrected_fields'));
  const kingConfirmed = truthy(pick('king_review_facts_confirmed'));
  return {
    staffTitle: staffFields.includes('title'),
    staffDescription: staffFields.includes('description'),
    kingTitle: kingConfirmed || kingFields.includes('title'),
    kingDescription: kingConfirmed || kingFields.includes('description'),
    kingFields
  };
}

// Public flag so the SPA (assets/makaug-app.js) shows the reviewed title
// instead of building its own generic found-online title.
function publicCopyReviewed(property = {}, extra = {}) {
  const review = copyReviewState(property, extra);
  return { title: review.staffTitle || review.kingTitle, description: review.staffDescription || review.kingDescription };
}

function sanitizeStaffCopy(value = '') {
  return cleanPublicListingCopy(value)
    .replace(/#[\p{L}\p{N}_-]+/gu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
    .slice(0, STAFF_COPY_MAX_CHARS)
    .trim();
}

// The "Found on TikTok … check the original post before paying" safety line.
// It is shown as its own notice in the source panel (found_online_notice on the
// API row), never appended to the description (P2, 10 Oct 2026).
function foundOnlineSourceLine(extra = {}) {
  const platform = redactThirdPartyPublicText(extra.source_platform || '') || 'the original source';
  const sourceName = redactThirdPartyPublicText(extra.source_name || extra.source_agent_name || '');
  return `Found on ${platform}${sourceName ? ` from ${sourceName}` : ''}. Check the original post before paying.`;
}

// Staff instructions that harvest and import code used to write into public
// copy: any "Confirm … before (public) approval." sentence (e.g. "Confirm the
// exact property pin and local amenities with the listing agent before
// approval."), "… before featuring.", and "Pending King review …" (P4).
// The same patterns are in assets/makaug-app.js sanitizePublicListingCopyForUi
// and scripts/report-staff-wording-in-public-copy.js.
const STAFF_INSTRUCTION_PATTERNS = [
  /\s*\bConfirm\b[^.!?]*?\bbefore\s+(?:public\s+)?approval\b[^.!?]*[.!?]?/gi,
  /\s*\bConfirm latest availability, exact pin, and ownership authority before featuring\.?/gi,
  /\s*\bPending King review\b[^.!?]*[.!?]?/gi
];

function stripStaffInstructions(value = '') {
  return STAFF_INSTRUCTION_PATTERNS.reduce((text, pattern) => text.replace(pattern, ''), String(value || ''));
}

function cleanPublicListingCopy(value = '') {
  return stripStaffInstructions(cleanText(value)).trim();
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
    || ACTIVE_COUNTRY_NAME
  ) || ACTIVE_COUNTRY_NAME;
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
  if (!Number.isFinite(amount) || amount <= 0) return 'Price on application';
  const period = cleanText(property.price_period || '').toLowerCase();
  const currencyLabel = IS_SOUTH_AFRICA ? 'R' : 'UGX';
  const locale = IS_SOUTH_AFRICA ? 'en-ZA' : 'en-US';
  // Rows store mo / monthly / per_month as well as month.
  return `${currencyLabel} ${Math.round(amount).toLocaleString(locale)}${normalizePricePeriodForWrite(period) === 'month' ? '/month' : ''}`;
}

function stripTransactionFromPublicPropertyType(value = '') {
  return redactThirdPartyPublicText(value)
    .replace(/\s+(?:for\s+sale|for\s+rent|to\s+rent)\s*$/i, '')
    .trim()
    .toLowerCase();
}

function collapseDuplicatePublicTransaction(value = '') {
  return redactThirdPartyPublicText(value)
    .replace(/\bfor\s+sale\s+for\s+sale\b/gi, 'for sale')
    .replace(/\bfor\s+rent\s+for\s+rent\b/gi, 'for rent')
    .replace(/\bto\s+rent\s+for\s+rent\b/gi, 'to rent')
    .trim();
}

function buildThirdPartyPublicTitle(property = {}, extra = {}) {
  const review = copyReviewState(property, extra);
  if (review.staffTitle) {
    const staffTitle = sanitizeStaffCopy(property.title || '');
    if (staffTitle) return staffTitle;
  }
  const reviewedFields = review.kingFields;
  const reviewedTitle = collapseDuplicatePublicTransaction(property.title || '');
  const reviewedTitleLooksCopied = String(property.title || '').includes('#')
    || reviewedTitle.length > 120
    || reviewedTitle.split(/\s+/).filter(Boolean).length > 14;
  const typeForReview = cleanText(property.listing_type || property.category || '').toLowerCase();
  if (
    reviewedTitle
    && review.kingTitle
    && !reviewedTitleLooksCopied
    && !(typeForReview !== 'land' && /^land\s+in\b/i.test(reviewedTitle))
  ) {
    return reviewedTitle;
  }
  const area = publicAreaLabelFor(property, extra);
  const type = thirdPartyTypeLabel(property);
  const beds = Number(property.bedrooms);
  const roomLabel = Number.isFinite(beds) && beds > 0 && type !== 'land' ? `${beds}-bed ` : '';
  const propertyType = stripTransactionFromPublicPropertyType(humanPropertyTypeLabel(property.property_type || ''));
  if (type === 'land') {
    const size = redactThirdPartyPublicText(extra.size_raw || property.land_size || '');
    return `${size ? `${size} ` : ''}Land in ${area}`.trim();
  }
  if (type === 'property for rent') return `${roomLabel}${propertyType || 'Property'} for rent in ${area}`.trim();
  if (type === 'commercial property') {
    const label = propertyType || 'commercial property';
    return `${label.charAt(0).toUpperCase()}${label.slice(1)} in ${area}`.trim();
  }
  if (type === 'student accommodation') return `Student accommodation in ${area}`.trim();
  return `${roomLabel}${propertyType || 'Property'} for sale in ${area}`.trim();
}

function buildThirdPartyPublicSummary(property = {}, extra = {}) {
  const review = copyReviewState(property, extra);
  if (review.staffDescription) {
    const staffDescription = sanitizeStaffCopy(property.description || '');
    // Staff's saved copy, unchanged; the safety line is found_online_notice.
    if (staffDescription) return staffDescription;
  }
  const area = publicAreaLabelFor(property, extra);
  const type = thirdPartyTypeLabel(property);
  const sourcePlatform = redactThirdPartyPublicText(extra.source_platform || 'the original source');
  const sourceName = redactThirdPartyPublicText(extra.source_name || extra.source_agent_name || '');
  const reviewedDescription = redactThirdPartyPublicText(property.description || '');
  const reviewedDescriptionLooksCopied = !reviewedDescription
    || reviewedDescription.length > 420
    || /\boriginal post date\b|\bsource post\b|\bthird-party\b|(?:makaug|seshaikhaya(?:\.com)?) has not verified/i.test(reviewedDescription);
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
    && review.kingDescription
    && !reviewedDescriptionLooksCopied
  ) {
    return `${reviewedDescription} Third-party property result found from ${source}. ${ACTIVE_PUBLIC_BRAND_LABEL} provides a search and discovery preview using limited factual information only. ${ACTIVE_PUBLIC_BRAND_LABEL} has not verified ownership, availability, price, land title, seller authority, image rights, or contact details. Open the original source before contacting the seller, arranging a viewing, or making any payment.`
      .replace(/\s+/g, ' ')
      .trim();
  }
  return `${buildThirdPartyPublicTitle(property, extra)} is a third-party property result found from ${source}. ${ACTIVE_PUBLIC_BRAND_LABEL} provides a search and discovery preview using limited factual information only. ${facts}. ${ACTIVE_PUBLIC_BRAND_LABEL} has not verified ownership, availability, price, land title, seller authority, image rights, or contact details. Open the original source before contacting the seller, arranging a viewing, or making any payment.`
    .replace(/\s+/g, ' ')
    .trim();
}

// Separate safety notice for found-online rows (null for everything else).
function foundOnlinePublicNotice(property = {}, extra = {}) {
  if (!isFoundOnlinePublicRow(property, extra)) return null;
  return foundOnlineSourceLine(extra || {});
}

function isFoundOnlinePublicRow(property = {}, safeExtra = null) {
  const extra = safeExtra || (property?.extra_fields && typeof property.extra_fields === 'object' ? property.extra_fields : {});
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

// ---- Titles for owner/agent listings ---------------------------------------
// Captions were used as titles: "Land on sale!! Location: Gayaza Road … 120m
// per acre…", "NEW APARTMENT ALERT – KIWATULE! Looking for a modern…",
// "Plotforsale 50x100ft@15m team". Strip noise, sentence-case ALL CAPS, cut at
// a word boundary (≤ 60 chars), else fall back to a factual title.
const TITLE_MAX_CHARS = 60;
const DANGLING_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'at', 'on', 'for', 'to', 'with', 'near', 'from', 'by', 'off', 'along', 'opposite', 'behind', 'per', 'via', '&']);

function sentenceCaseSegment(segment = '') {
  const letters = segment.replace(/[^\p{L}]/gu, '');
  if (letters.length < 2 || letters !== letters.toUpperCase()) return segment;
  const lower = segment.toLowerCase();
  return lower.replace(/\p{L}/u, (char) => char.toUpperCase());
}

function stripTitleNoise(value = '') {
  return String(value || '')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ')
    .replace(/(^|\s|\S)@[\p{L}\p{N}_.]+/gu, '$1 ')
    .replace(/#[\p{L}\p{N}_-]+/gu, ' ')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, ' ')
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}️︎‍⃣]/gu, ' ')
    .replace(/([!?.,:;\-–—*_~])\1+/g, '$1')
    .replace(/\s*([!?.,:;])\s*(?=[!?.,:;])/g, '')
    .replace(/[\s|•·]+/g, ' ')
    .replace(/\s+([!?.,:;])/g, '$1')
    .trim();
}

function cutTitleAtWord(value = '', max = TITLE_MAX_CHARS) {
  let text = value;
  if (text.length > max) {
    const slice = text.slice(0, max + 1);
    // Prefer a whole first sentence when one ends after 20 characters.
    const sentenceEnd = Math.max(slice.lastIndexOf('! '), slice.lastIndexOf('? '), slice.lastIndexOf('. '));
    const lastSpace = slice.lastIndexOf(' ');
    text = sentenceEnd >= 20
      ? slice.slice(0, sentenceEnd + 1).trim()
      : (lastSpace > 0 ? slice.slice(0, lastSpace) : slice.slice(0, max)).trim();
  }
  // Drop an unclosed "(" left by the cut, then never end on "(", punctuation
  // or a dangling preposition/article.
  if ((text.match(/\(/g) || []).length > (text.match(/\)/g) || []).length) {
    text = text.slice(0, text.lastIndexOf('(')).trim();
  }
  for (let guard = 0; guard < 8; guard += 1) {
    const before = text;
    text = text.replace(/[\s(\[{"'“‘\-–—:;,/&]+$/u, '').trim();
    if (/[!?.]$/.test(text) && text.length >= 20) break;
    const words = text.split(/\s+/);
    if (words.length > 1 && DANGLING_WORDS.has(words[words.length - 1].toLowerCase().replace(/[^\p{L}&]/gu, ''))) {
      words.pop();
      text = words.join(' ');
    }
    if (text === before) break;
  }
  return text;
}

function factualListingTitle(row = {}) {
  const listingType = String(row.listing_type || row.category || '').toLowerCase();
  const isLand = listingType === 'land';
  const period = normalizePricePeriodForWrite(String(row.price_period || '').toLowerCase()) || '';
  const transaction = String(row.transaction_type || row?.extra_fields?.transaction_type || '').toLowerCase();
  const forRent = listingType === 'rent' || listingType === 'student' || listingType === 'students' || transaction === 'rent' || period === 'month';
  const typeLabel = humanPropertyTypeLabel(row.property_type || '')
    || (isLand ? 'Land' : listingType === 'commercial' ? 'Commercial property' : (listingType === 'student' || listingType === 'students') ? 'Student room' : 'Property');
  const beds = Number(row.bedrooms);
  const bedPrefix = !isLand && Number.isFinite(beds) && beds > 0 ? `${beds}-bed ` : '';
  const area = String(row.area || row.district || '').trim() || ACTIVE_COUNTRY_NAME;
  const type = bedPrefix ? typeLabel.toLowerCase() : typeLabel;
  const title = `${bedPrefix}${type} for ${forRent ? 'rent' : 'sale'} in ${area}`;
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function cleanListingTitle(row = {}) {
  const original = String(row.title || '').replace(/\s+/g, ' ').trim();
  // Stored enums in titles ("shop_retail in Kampala") read as labels.
  const humanised = original.replace(/\b[a-z]+(?:_[a-z]+)+\b/gi, (word) => humanPropertyTypeLabel(word.toLowerCase()));
  const stripped = stripTitleNoise(cleanPublicListingCopy(humanised))
    .split(/(\s[–—-]\s|[!?.]\s)/)
    .map((part) => sentenceCaseSegment(part))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  const cleaned = cutTitleAtWord(stripped);
  const hasLetters = /\p{L}/u.test(cleaned);
  const lostTooMuch = original.length > 0 && stripped.length < original.length / 2;
  if (!cleaned || cleaned.length < 12 || !hasLetters || lostTooMuch) return factualListingTitle(row);
  return cleaned.replace(/\p{L}/u, (char) => char.toUpperCase());
}

// ---- Amenities -------------------------------------------------------------
// Only real amenities are public. Mirrors the LP_CONFIG amenity values and
// labels in assets/makaug-app.js, plus common amenities owners type freely.
// Internal moderation tags ("Found online", "TikTok source evidence", "Agent
// follow-up required", "HD photos to verify", "Road access to verify", "Title
// to verify") were written into amenities at import and must never show.
const LP_AMENITY_VALUES = [
  'parking', 'security', 'borehole', 'generator', 'garden', 'wall', 'servant', 'wifi', 'solar', 'water_tank',
  'paved', 'near_taxi', 'cctv', 'water', 'balcony', 'furnished', 'garbage', 'road', 'power', 'fenced',
  'surveyed', 'ready_docs', 'title_ready', 'near_tarmac', 'flat', 'drainage', 'loading', 'internet', 'fire',
  'dock', 'study', 'laundry', 'meals', 'shuttle', 'warden', 'curfew'
];
const LP_AMENITY_LABELS = [
  'Parking', 'Security', 'Borehole Water', 'Generator', 'Garden', 'Perimeter Wall', 'Servant Quarters',
  'WiFi/Internet', 'Solar', 'Water Tank', 'Paved Compound', 'Near Taxi Stage', 'CCTV', 'Reliable Water',
  'Balcony', 'Furnished', 'Garbage Collection', 'Road Access', 'Water Nearby', 'Electricity Nearby', 'Fenced',
  'Surveyed', 'Ready Documents', 'Title Available', 'Near Tarmac', 'Flat Land', 'Good Drainage',
  '3-Phase Power', 'Loading Bay', 'Fibre Internet', 'Generator Backup', 'Fire Safety Systems', 'Water Storage',
  'Delivery Dock', 'WiFi', 'Study Area', 'Laundry', 'Meals', 'Water', 'Reliable Power', 'Campus Shuttle',
  'Warden / Matron', 'Curfew Policy'
];
const COMMON_AMENITY_LABELS = [
  'Swimming Pool', 'Pool', 'Gym', 'Lift', 'Elevator', 'Air Conditioning', 'AC', 'Backup Generator',
  'Electricity', 'Power', 'Internet', 'TV', 'DSTV', 'Kitchen', 'Fitted Kitchen', 'Wardrobes', 'Built-in Wardrobes',
  'Gated Community', 'Gate', 'Compound', 'Garage', 'Boys Quarters', 'Servant Quarter', 'Store', 'Staff Quarters',
  'Playground', 'Water Heater', 'Hot Water', 'Shower', 'Bathtub', 'En-suite', 'Ensuite', 'Self-contained',
  'Tiled Floors', 'Electric Fence', 'Guard', 'Askari', 'Lake View', 'View', 'Rooftop', 'Terrace', 'Veranda',
  'Pet Friendly', 'Cleaning', 'Housekeeping', 'Reception', 'Conference Room', 'Office Space', 'Shops',
  'Tarmac Road', 'Murram Road', 'Title', 'Land Title', 'Mailo Title', 'Freehold Title', 'Leasehold Title',
  'Water Connected', 'Power Connected', 'Electricity Connected', 'Near School', 'Near Hospital', 'Near Market'
];

function amenityKey(value = '') {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}/&+-]+/gu, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

const PUBLIC_AMENITY_KEYS = new Set([
  ...LP_AMENITY_VALUES.map((value) => amenityKey(value.replace(/_/g, ' '))),
  ...LP_AMENITY_VALUES.map((value) => amenityKey(value)),
  ...LP_AMENITY_LABELS.map(amenityKey),
  ...COMMON_AMENITY_LABELS.map(amenityKey)
]);

const INTERNAL_REVIEW_TAG_PATTERNS = [
  /^found online$/i,
  /source evidence$/i,
  /follow[- ]?up required/i,
  /\bto verify$/i,
  /\bverify\b/i,
  /^hd photos/i
];

function isInternalReviewTag(value = '') {
  const text = String(value || '').trim();
  return Boolean(text) && INTERNAL_REVIEW_TAG_PATTERNS.some((pattern) => pattern.test(text));
}

function isPublicAmenity(value = '') {
  if (typeof value !== 'string') return false;
  if (isInternalReviewTag(value)) return false;
  return PUBLIC_AMENITY_KEYS.has(amenityKey(value));
}

function filterPublicAmenities(amenities) {
  const list = Array.isArray(amenities) ? amenities : [];
  const seen = new Set();
  return list.filter((item) => {
    if (!isPublicAmenity(item)) return false;
    const key = amenityKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---- Contact line ----------------------------------------------------------
// Derived from the contact we actually show, never a label frozen at import
// ("Contact through the public TikTok source" next to Call/WhatsApp buttons).
function publicContactLabelFor({ phone = '', email = '', platform = '', hasSourceUrl = false } = {}) {
  if (String(phone || '').trim()) return 'Call or WhatsApp the agent';
  if (String(email || '').trim()) return 'Email the agent';
  if (hasSourceUrl) return `Contact via ${String(platform || '').trim() || 'source'} source`;
  return null;
}

// ---- Server-rendered pages -------------------------------------------------
// The SSR selects only the raw extra_fields keys listed here
// (LISTING_COPY_EXTRA_KEYS) and turns them into the same "safe extra" shape
// the JSON API passes to the builders, so both render identical copy.
const LISTING_COPY_EXTRA_KEYS = [
  'found_online', 'social_search_candidate', 'sourced_inventory_candidate', 'found_online_candidate',
  'source_badge', 'source_batch', 'source_platform', 'source_url', 'source_post_url', 'post_url',
  'platform_url', 'original_url', 'source_contact_url', 'video_url', 'source_name', 'source_agent_name',
  'resolved_location_label', 'size_raw', 'land_title_available', 'landTitleAvailable', 'title_available',
  'land_title_status', 'source_title', 'source_caption', 'source_description', 'source_text',
  'source_visual_text', 'video_ocr_text', 'frame_ocr_text',
  'staff_corrected_fields', 'king_review_corrected_fields', 'king_review_facts_confirmed'
];

function listingCopyExtraSql(alias = 'p') {
  return `jsonb_build_object(${LISTING_COPY_EXTRA_KEYS.map((key) => `'${key}', ${alias}.extra_fields->'${key}'`).join(', ')})`;
}

function inferSourcePlatform(value = '') {
  const url = cleanText(value).toLowerCase();
  if (url.includes('tiktok.com')) return 'TikTok';
  if (url.includes('instagram.com')) return 'Instagram';
  if (url.includes('facebook.com') || url.includes('fb.watch')) return 'Facebook';
  if (url.includes('x.com') || url.includes('twitter.com')) return 'X/Twitter';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'YouTube';
  return '';
}

function listingCopyExtraFromRaw(raw = {}) {
  const extra = raw && typeof raw === 'object' ? raw : {};
  const sourceUrl = cleanText(extra.source_url || extra.source_post_url || extra.post_url || extra.platform_url || extra.original_url);
  const landTitleAvailable = normalizeLandTitleAvailability(
    extra.land_title_available ?? extra.landTitleAvailable ?? extra.title_available ?? extra.land_title_status,
    extra.source_title,
    extra.source_caption,
    extra.source_description,
    extra.source_text,
    extra.source_visual_text,
    extra.video_ocr_text,
    extra.frame_ocr_text
  );
  return {
    found_online: extra.found_online === true,
    social_search_candidate: extra.social_search_candidate === true,
    sourced_inventory_candidate: extra.sourced_inventory_candidate === true,
    found_online_candidate: truthy(extra.found_online_candidate),
    third_party_discovery_result: extra.found_online === true
      || extra.social_search_candidate === true
      || extra.sourced_inventory_candidate === true
      || /found|sourced/i.test(String(extra.source_badge || '')),
    source_badge: extra.source_badge || null,
    source_batch: extra.source_batch || null,
    source_platform: cleanText(extra.source_platform) || inferSourcePlatform(sourceUrl) || inferSourcePlatform(extra.source_contact_url) || null,
    source_url: sourceUrl || null,
    video_url: extra.video_url || null,
    source_name: extra.source_name || null,
    source_agent_name: extra.source_agent_name || extra.source_name || null,
    resolved_location_label: extra.resolved_location_label || null,
    size_raw: extra.size_raw || '',
    land_title_available: landTitleAvailable || null,
    staff_corrected_fields: extra.staff_corrected_fields,
    king_review_corrected_fields: extra.king_review_corrected_fields,
    king_review_facts_confirmed: extra.king_review_facts_confirmed
  };
}

module.exports = {
  ACTIVE_PUBLIC_BRAND_LABEL,
  STAFF_COPY_MAX_CHARS,
  cleanPublicListingCopy,
  redactThirdPartyPublicText,
  publicAreaLabelFor,
  thirdPartyTypeLabel,
  publicPriceLabelFor,
  stripTransactionFromPublicPropertyType,
  collapseDuplicatePublicTransaction,
  copyReviewState,
  publicCopyReviewed,
  sanitizeStaffCopy,
  foundOnlineSourceLine,
  foundOnlinePublicNotice,
  STAFF_INSTRUCTION_PATTERNS,
  stripStaffInstructions,
  buildThirdPartyPublicTitle,
  buildThirdPartyPublicSummary,
  isFoundOnlinePublicRow,
  isInternalReviewTag,
  isPublicAmenity,
  filterPublicAmenities,
  publicContactLabelFor,
  cleanListingTitle,
  factualListingTitle,
  TITLE_MAX_CHARS,
  LISTING_COPY_EXTRA_KEYS,
  listingCopyExtraSql,
  listingCopyExtraFromRaw
};
