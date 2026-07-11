'use strict';

const { DISTRICTS } = require('./constants');

const NON_LISTING_SOURCE_PATTERN = /\b(?:dawinci|da\s*winci|sameblood)\b/i;
const HARD_NON_LISTING_PATTERN = /\b(?:how\s+to\s+apply|how\s+big\s+is|building\s+permit|building\s+regulations?|bio(?:de)?g[ie]ster|biodigester|plumbing|pipe\s*work|pipework|material\s+costs?|cost\s+breakdown|roofing\s+materials?|perimeter\s+fence|land\s+title\s+transfer|documents?\s+needed|penthouse\s+design|house\s+design|house\s+plan|(?:plot|land)\s+(?:sizes?|dimensions?|measurements?)|(?:plot|land)\s+measurements?|\d+\s*ft\s*(?:by|x)\s*\d+\s*ft|construction\s+(?:tips?|ideas?|costs?|materials?))\b/i;
const SOURCE_BOUND_NON_LISTING_PATTERN = /\b(?:house\s+reveal|building\s+nice\s+houses?|design\s+and\s+construction|construction\s+clip|construction\s+video|building\s+process|site\s+visit)\b/i;
const EXPLICIT_LISTING_INTENT_PATTERN = /\b(?:for\s+sale|on\s+sale|for\s+rent|to\s+rent|to\s+let|rent\s+to\s+own|rent-to-own|available\s+(?:for\s+)?(?:sale|rent|lease)|selling|asking\s+price|guide\s+price|price\s*:|land\s+for\s+sale|plots?\s+for\s+sale|house\s+for\s+sale|home\s+for\s+sale|apartment\s+for\s+sale|apartment\s+for\s+rent|office\s+space\s+for\s+rent|shop\s+for\s+rent|student\s+(?:room|hostel|accommodation))\b/i;
const MONEY_SIGNAL_PATTERN = /\b(?:ugx|ush|shs?|usd|\$)\s*[\d,.]+|[\d,.]+\s*(?:m|mn|million|b|bn|billion)\b/i;
const LOW_SIGNAL_PROMO_PATTERN = /\b(?:serious\s+customer|owner\s+wants?\s+money|owner\s+want\s+money|my\s+people|just\s+at|you\s+are\s+to\s+own|own\s+this|take\s+this\s+beautiful\s+house|fuuka\s+landlord|njagala\s+plot|tusigazawo|plot\s+ntono|sente\s+obukadde|hot\s+deal|quick\s+sale)\b/i;
const SPECIFIC_LOCATION_SIGNAL_PATTERN = /\b(?:entebbe\s*(?:road|rd)|hoima\s*(?:road|rd)|mawanda\s*(?:road|rd)|road|rd|street|avenue|close|estate|village|zone|parish|division|municipality|kiwatule|kyanja|kisaasi|kira|kira[-\s]*mulawa|mulawa|nsasa|kitende|kasangati|mawule|munyonyo|kololo|ntinda|bugolobi|makindye|lubowa|seguku|bwebajja|akright|kajjansi|komamboga|kyebando|makerere|najjeera|namugongo|gayaza|nansana|bulindo|katosi|mpunge|ndejje|bujjuko|bujuuko|kakiri|masulita)\b/i;
const FOREIGN_PROPERTY_MARKET_PATTERN = /\b(?:kolkata|west\s+bengal|bengal|warangal|hanumakonda|telugu|hyderabad|telangana|andhra\s+pradesh|mumbai|delhi|pune|india|indian\s+real\s+estate|[1-9]\s*bhk)\b/i;
const UGANDA_BBOX = { minLat: -1.5, maxLat: 4.3, minLng: 29.5, maxLng: 35.1 };
const UGANDA_DISTRICT_SET = new Set(DISTRICTS.map((district) => district.toLowerCase()));
const POSITIVE_LISTING_SIGNAL_PATTERN = /\b(?:for\s+sale|for\s+rent|to\s+let|to\s+rent|bedroom|bdrm|plots?|land|acre|house|home|apartment|studio|rental|hostel|shop|office|warehouse|duplex|bungalow|mansion|condo|estate)\b/i;
const POSITIVE_FOREIGN_LOCATION_PATTERN = /(^|\b)(ajah|lekki|ibeju|lagos|abuja|ikeja|ikoyi|nigeria|naira|nairobi|mombasa|kenya|accra|ghana|east\s+legon|dar\s+es\s+salaam|tanzania|kigali|rwanda|johannesburg|cape\s+town|south\s+africa|dubai|uae|texas|florida|london|uk|canada|portugal|golden\s+visa|passport|citizenship|residency|owerri|asaba|enugu|awka|onitsha|nnewi|imo|anambra|delta\s+state|edo|certificate\s+of\s+occupancy|ibusa|apogazi|avu|sangotedo|ibeju|eneka|port\s+harcourt|gra\s+phase|ph\s+city|shell\s+cooperative\s+estate|cooperative\s+estate\s+ph|rwf|kanombe|ada\s+george|aluu|omoko|rivers\s+state|ksh|tzs|ota|sango|ogun|ogborhill|aba|abia|cantonment|trasacco|murakaza\s+neza|tubafitiye|turabafitiye)(\b|$)|\bc\s*(?:of|\/|-)\s*o\b|\b(?:apogazi\s+nike|nike\s+enugu)\b|\+233\b|\u20a6/i;
const POSITIVE_CLICKBAIT_PATTERN = /^\s*what\s+\$/i;
const POSITIVE_EXPLAINER_PATTERN = /(?:\$\s*\d{2,}\s*k?\s+can\s+(?:buy|get)|\b\d+\s+countries\b|\bgolden\s+visa\b|\bland\s+banking\b|\bhow\s+to\b|\btop\s+\d+\b|\bexplained\b|\btour\s+of\b|\bforget\s+\$|\bltd\b|\blimited\b|\bcompany\b|welcome\s+to|well\s*come\s+to|\bep\s?\d+\b|\bepisode\b|podcast|ifma|association|new\s+chapter|your\s+(?:construction|real\s+estate)|ai[- ]powered|ecosystem|getting\s+smarter|real\s+estate\s+ltd|consultants\s+ltd|agencies\b|real\s+estate\s+empire|future\s+is\s+in\s+real\s+estate|what\s+rich\s+homes\s+look\s+like|what(?:'|’)?s\s+your\s+budget|\bvs\s+real\s+estate\b|physical\s+development\s+plan|don't\s+buy\s+this\s+house|no\s+road\s+access|\bscam\b|investing\s+in\s+real\s+estate|real\s+estate\s+investment\s+in\s+uganda|real\s+estate\s+tips|\btips?\b|\bu24\s+television\b)/i;
const POSITIVE_NEWS_POLITICS_PATTERN = /\b(?:mps?|opposition|speaker|bill|parliament|minister|president|drama|arrested|scandal|police|election|cdf|warns|robber(?:y|ies)|thie(?:f|ves)|fraud|lukwago|baryomunsi)\b/i;
const POSITIVE_VLOG_EVENT_PATTERN = /(?:latest\s+updates|city\s+streets|streets\s+\d|rainy\s+day|\bparties\b|sunrise|\bvlog\b|presentation|\bproject\b|walkthrough|drone|timelapse|nightlife|worship|church|\bmix\b|whatsapp\s+video|\bvillage\b|i\s+found|why\s+everyone|moving\s+to|trusted\s+real\s+estate\s+partner|be\s+aware|lucky\s+winner|price\s+reduction|inflated\s+uganda\s+real\s+estate|\bsalon\b|home\s+service|opening\s+soon|new\s+\w+\s+office|closed\s+testing|\bfilatom\b|what(?:'s|\s+is)\s+in\s+the\s+box|ever\s+wondered|^\s*\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}\s*$)/i;
const POSITIVE_TITLE_ONLY_NON_LISTING_PATTERN = /^\s*\d{1,2}\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4}\s*$|^joint\s+venture\s+available\s*$|future\s+is\s+in\s+real\s+estate|what(?:'|’)?s\s+your\s+budget/i;
const BROAD_PROPERTY_TYPE_LABELS = new Set(['property', 'other', 'unknown', 'not stated', 'n/a', 'na']);
const BROAD_LOCATION_LABELS = new Set([
  'uganda',
  'kampala',
  'wakiso',
  'greater kampala',
  'central',
  'central uganda',
  'unknown',
  'unknown area',
]);

function compactText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function nullableNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/,/g, '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function jsonText(value) {
  if (!value || typeof value !== 'object') return '';
  try {
    return JSON.stringify(value);
  } catch (_) {
    return '';
  }
}

function sourceQualityText(record = {}) {
  const extra = record.extra_fields && typeof record.extra_fields === 'object' && !Array.isArray(record.extra_fields)
    ? record.extra_fields
    : {};
  return [
    record.title,
    record.sourceTitle,
    record.source_title,
    record.caption,
    record.description,
    record.sourceText,
    record.source_text,
    record.sourceVisualText,
    record.source_visual_text,
    record.lister_name,
    record.source_name,
    record.sourceAgentName,
    record.source_agent_name,
    record.channel_name,
    record.source,
    record.listed_via,
    record.source_platform,
    extra.source_name,
    extra.source_agent_name,
    extra.public_display_name,
    extra.source_title,
    extra.source_caption,
    extra.source_description,
    extra.source_text,
    extra.source_visual_text,
    extra.youtube_source_title,
    jsonText(extra.raw_source_post),
  ].map(compactText).filter(Boolean).join(' ');
}

function sourceNameText(record = {}) {
  const extra = record.extra_fields && typeof record.extra_fields === 'object' && !Array.isArray(record.extra_fields)
    ? record.extra_fields
    : {};
  return [
    record.source_name,
    record.sourceAgentName,
    record.source_agent_name,
    record.lister_name,
    record.channel_name,
    extra.source_name,
    extra.source_agent_name,
    extra.public_display_name,
    extra.youtube_channel_title,
  ].map(compactText).filter(Boolean).join(' ');
}

function normalizedLocationLabel(value = '') {
  return compactText(value).toLowerCase().replace(/[.,]+$/g, '');
}

function locationLabelIsBroad(value = '') {
  const normalized = normalizedLocationLabel(value);
  if (!normalized || BROAD_LOCATION_LABELS.has(normalized)) return true;
  const parts = normalized.split(/[,/|]+/).map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => BROAD_LOCATION_LABELS.has(part));
}

function sourceLocationText(record = {}) {
  const extra = record.extra_fields && typeof record.extra_fields === 'object' && !Array.isArray(record.extra_fields)
    ? record.extra_fields
    : {};
  return [
    record.address,
    record.area,
    record.district,
    record.location,
    record.location_label,
    record.title,
    record.sourceTitle,
    record.source_title,
    record.caption,
    extra.resolved_location_label,
    extra.map_pin_label,
    extra.source_title,
    extra.source_caption,
    extra.youtube_source_title,
  ].map(compactText).filter(Boolean).join(' ');
}

function sourcePositiveListingText(record = {}) {
  return [sourceQualityText(record), sourceLocationText(record)].map(compactText).filter(Boolean).join(' ');
}

function sourcePositiveListingTitleValues(record = {}) {
  const extra = record.extra_fields && typeof record.extra_fields === 'object' && !Array.isArray(record.extra_fields)
    ? record.extra_fields
    : {};
  return [
    record.title,
    record.sourceTitle,
    record.source_title,
    extra.source_title,
    extra.youtube_source_title,
    extra.raw_source_post && extra.raw_source_post.title,
  ].map(compactText).filter(Boolean);
}

function sourcePositiveListingCoordinates(record = {}) {
  const extra = record.extra_fields && typeof record.extra_fields === 'object' && !Array.isArray(record.extra_fields)
    ? record.extra_fields
    : {};
  const lat = nullableNumber(record.latitude ?? record.lat ?? extra.latitude ?? extra.lat ?? extra.map_latitude ?? extra.map_lat);
  const lng = nullableNumber(record.longitude ?? record.lng ?? record.lon ?? record.long ?? extra.longitude ?? extra.lng ?? extra.lon ?? extra.long ?? extra.map_longitude ?? extra.map_lng);
  if (lat == null || lng == null) return null;
  if (Number(lat) === 0 && Number(lng) === 0) return null;
  return { lat, lng };
}

function sourceCoordinatesInsideUganda(coords = null) {
  if (!coords) return false;
  return coords.lat >= UGANDA_BBOX.minLat
    && coords.lat <= UGANDA_BBOX.maxLat
    && coords.lng >= UGANDA_BBOX.minLng
    && coords.lng <= UGANDA_BBOX.maxLng;
}

function sourceCanonicalUgandaDistrict(record = {}) {
  const extra = record.extra_fields && typeof record.extra_fields === 'object' && !Array.isArray(record.extra_fields)
    ? record.extra_fields
    : {};
  const district = compactText(record.district || extra.district || extra.resolved_district || '');
  return district && UGANDA_DISTRICT_SET.has(district.toLowerCase()) ? district : '';
}

function sourceHasConcreteListingSignal(record = {}) {
  const extra = record.extra_fields && typeof record.extra_fields === 'object' && !Array.isArray(record.extra_fields)
    ? record.extra_fields
    : {};
  const price = nullableNumber(record.price ?? record.asking_price ?? record.amount ?? extra.price ?? extra.asking_price);
  const bedrooms = nullableNumber(record.bedrooms ?? record.beds ?? extra.bedrooms ?? extra.beds);
  const propertyType = compactText(record.property_type || record.subtype || record.type || extra.property_type || extra.subtype || '').toLowerCase();
  const text = sourcePositiveListingText(record);
  return Boolean(
    (price != null && price > 0)
      || (bedrooms != null && bedrooms > 0)
      || (propertyType && !BROAD_PROPERTY_TYPE_LABELS.has(propertyType))
      || POSITIVE_LISTING_SIGNAL_PATTERN.test(text)
  );
}

function sourcePositiveListingGateForRecord(record = {}) {
  const text = sourcePositiveListingText(record);
  const coords = sourcePositiveListingCoordinates(record);
  const canonicalDistrict = sourceCanonicalUgandaDistrict(record);
  const hasInUgandaCoordinates = sourceCoordinatesInsideUganda(coords);
  if (coords && !hasInUgandaCoordinates) {
    return {
      ok: false,
      reason: 'non_uganda_location',
      details: [`Coordinates ${coords.lat}, ${coords.lng} are outside Uganda's bounding box.`],
      has_uganda_location_signal: false,
      has_listing_signal: false,
      coordinates: coords,
      district: canonicalDistrict,
    };
  }
  if (POSITIVE_FOREIGN_LOCATION_PATTERN.test(text)) {
    return {
      ok: false,
      reason: 'non_uganda_location',
      details: ['Foreign location/currency/residency token detected in source text.'],
      has_uganda_location_signal: false,
      has_listing_signal: false,
      coordinates: coords,
      district: canonicalDistrict,
    };
  }
  if (!canonicalDistrict && !hasInUgandaCoordinates) {
    return {
      ok: false,
      reason: 'non_uganda_location',
      details: ['Canonical Uganda district or in-Uganda coordinates are required.'],
      has_uganda_location_signal: false,
      has_listing_signal: false,
      coordinates: coords,
      district: canonicalDistrict,
    };
  }
  const titleOnlyNegative = sourcePositiveListingTitleValues(record)
    .find((title) => POSITIVE_TITLE_ONLY_NON_LISTING_PATTERN.test(title));
  if (titleOnlyNegative) {
    return {
      ok: false,
      reason: 'not_a_listing',
      details: [`Non-listing title signal detected: ${titleOnlyNegative}`],
      has_uganda_location_signal: true,
      has_listing_signal: false,
      coordinates: coords,
      district: canonicalDistrict,
    };
  }
  const negativeMatch = text.match(POSITIVE_CLICKBAIT_PATTERN)
    || text.match(POSITIVE_EXPLAINER_PATTERN)
    || text.match(POSITIVE_NEWS_POLITICS_PATTERN)
    || text.match(POSITIVE_VLOG_EVENT_PATTERN);
  if (negativeMatch) {
    return {
      ok: false,
      reason: 'not_a_listing',
      details: [`Non-listing content signal detected: ${negativeMatch[0]}`],
      has_uganda_location_signal: true,
      has_listing_signal: false,
      coordinates: coords,
      district: canonicalDistrict,
    };
  }
  const hasListingSignal = sourceHasConcreteListingSignal(record);
  if (!hasListingSignal) {
    return {
      ok: false,
      reason: 'not_a_listing',
      details: ['Concrete property listing signal is required before approval.'],
      has_uganda_location_signal: true,
      has_listing_signal: false,
      coordinates: coords,
      district: canonicalDistrict,
    };
  }
  return {
    ok: true,
    reason: '',
    details: [],
    has_uganda_location_signal: true,
    has_listing_signal: true,
    coordinates: coords,
    district: canonicalDistrict,
  };
}

function sourceLocationQualityForRecord(record = {}) {
  const extra = record.extra_fields && typeof record.extra_fields === 'object' && !Array.isArray(record.extra_fields)
    ? record.extra_fields
    : {};
  const area = compactText(record.area || extra.area || extra.resolved_area || '');
  const district = compactText(record.district || extra.district || '');
  const address = compactText(record.address || record.location_label || extra.resolved_location_label || extra.map_pin_label || '');
  const areaKey = normalizedLocationLabel(area);
  const districtKey = normalizedLocationLabel(district);
  const addressKey = normalizedLocationLabel(address);
  const text = sourceLocationText(record);

  if (!area && !district && !address) {
    return {
      ok: false,
      status: 'missing_location',
      reason: 'No area, district, address, or source-location text was captured.',
      area,
      district,
      address,
    };
  }

  if (area && !locationLabelIsBroad(area) && areaKey !== districtKey) {
    return {
      ok: true,
      status: 'specific_area',
      reason: 'A specific area or neighbourhood is present.',
      area,
      district,
      address,
    };
  }

  if (address && !locationLabelIsBroad(address) && addressKey !== areaKey && addressKey !== districtKey) {
    return {
      ok: true,
      status: 'specific_address',
      reason: 'A usable address or corridor label is present.',
      area,
      district,
      address,
    };
  }

  const specificMatch = text.match(SPECIFIC_LOCATION_SIGNAL_PATTERN);
  if (specificMatch) {
    return {
      ok: true,
      status: 'specific_source_location',
      reason: 'The source text names a specific area, estate, road, or corridor.',
      matched: specificMatch[0],
      area,
      district,
      address,
    };
  }

  return {
    ok: false,
    status: 'district_only_location',
    reason: 'Only a broad district/city label was captured; moderators need a neighbourhood, road, estate, or corridor.',
    area,
    district,
    address,
  };
}

function sourceQualitySuppressionForRecord(record = {}) {
  const text = sourceQualityText(record);
  const sourceText = sourceNameText(record);
  const hasExplicitListingIntent = EXPLICIT_LISTING_INTENT_PATTERN.test(text);
  const hasMoneySignal = MONEY_SIGNAL_PATTERN.test(text);
  const hardMatch = text.match(HARD_NON_LISTING_PATTERN);
  const sourceBoundMatch = text.match(SOURCE_BOUND_NON_LISTING_PATTERN);
  const knownNonListingSource = NON_LISTING_SOURCE_PATTERN.test(sourceText || text);
  const locationQuality = sourceLocationQualityForRecord(record);
  const lowSignalPromoMatch = text.match(LOW_SIGNAL_PROMO_PATTERN);
  const foreignMarketMatch = text.match(FOREIGN_PROPERTY_MARKET_PATTERN);

  if (foreignMarketMatch) {
    return {
      suppressed: true,
      reason: 'foreign_property_market_source',
      matched: foreignMarketMatch[0],
      location_status: locationQuality.status,
      listing_signal: hasExplicitListingIntent || hasMoneySignal ? 'foreign_listing_signal_not_uganda' : 'foreign_market_content',
    };
  }

  if (!locationQuality.ok && lowSignalPromoMatch) {
    return {
      suppressed: true,
      reason: 'low_signal_district_only_promo',
      matched: lowSignalPromoMatch[0],
      location_status: locationQuality.status,
      listing_signal: hasMoneySignal ? 'price_signal_without_specific_location' : 'promo_without_specific_location',
    };
  }

  if (hardMatch && !hasExplicitListingIntent) {
    return {
      suppressed: true,
      reason: 'non_listing_tutorial_or_construction_content',
      matched: hardMatch[0],
      known_non_listing_source: knownNonListingSource,
      listing_signal: hasMoneySignal ? 'price_signal_ignored_for_tutorial_content' : 'no_listing_intent',
    };
  }

  if (knownNonListingSource && sourceBoundMatch && !hasExplicitListingIntent) {
    return {
      suppressed: true,
      reason: 'non_listing_design_or_construction_showcase',
      matched: sourceBoundMatch[0],
      known_non_listing_source: true,
      listing_signal: hasMoneySignal ? 'price_signal_ignored_for_showcase_content' : 'no_listing_intent',
    };
  }

  if (knownNonListingSource && hardMatch) {
    return {
      suppressed: true,
      reason: 'known_non_listing_source_tutorial_content',
      matched: hardMatch[0],
      known_non_listing_source: true,
      listing_signal: hasExplicitListingIntent ? 'explicit_listing_intent_present_but_source_keyword_is_blocked' : 'no_listing_intent',
    };
  }

  return {
    suppressed: false,
    reason: '',
    matched: '',
    known_non_listing_source: knownNonListingSource,
    listing_signal: hasExplicitListingIntent || hasMoneySignal ? 'listing_signal_present' : '',
    location_status: locationQuality.status,
  };
}

function sqlTextExpression(alias = 'p') {
  const prefix = alias ? `${alias}.` : '';
  // Keep staff dashboard SQL cheap. The richer JS classifier still inspects long
  // source/OCR text at import time, but live queue counts must avoid scanning
  // large JSON text fields for every pending row on every dashboard hydrate.
  return `CONCAT_WS(' ',
    COALESCE(${prefix}title, ''),
    COALESCE(${prefix}lister_name, ''),
    COALESCE(${prefix}source, ''),
    COALESCE(${prefix}listed_via, ''),
    COALESCE(${prefix}extra_fields->>'source_name', ''),
    COALESCE(${prefix}extra_fields->>'source_agent_name', ''),
    COALESCE(${prefix}extra_fields->>'public_display_name', ''),
    COALESCE(${prefix}extra_fields->>'youtube_channel_title', ''),
    COALESCE(${prefix}extra_fields->>'source_title', ''),
    COALESCE(${prefix}extra_fields->>'source_caption', ''),
    COALESCE(${prefix}extra_fields->>'youtube_source_title', '')
  )`;
}

function sqlSourceExpression(alias = 'p') {
  const prefix = alias ? `${alias}.` : '';
  return `CONCAT_WS(' ',
    COALESCE(${prefix}lister_name, ''),
    COALESCE(${prefix}source, ''),
    COALESCE(${prefix}listed_via, ''),
    COALESCE(${prefix}extra_fields->>'source_name', ''),
    COALESCE(${prefix}extra_fields->>'source_agent_name', ''),
    COALESCE(${prefix}extra_fields->>'public_display_name', ''),
    COALESCE(${prefix}extra_fields->>'youtube_channel_title', '')
  )`;
}

function sourceQualitySuppressedSql(alias = 'p') {
  const text = sqlTextExpression(alias);
  const source = sqlSourceExpression(alias);
  const prefix = alias ? `${alias}.` : '';
  const hard = "(how[[:space:]]+to[[:space:]]+apply|how[[:space:]]+big[[:space:]]+is|building[[:space:]]+permit|building[[:space:]]+regulations?|bio(de)?g[ie]ster|biodigester|plumbing|pipe[[:space:]]*work|pipework|material[[:space:]]+costs?|cost[[:space:]]+breakdown|roofing[[:space:]]+materials?|perimeter[[:space:]]+fence|land[[:space:]]+title[[:space:]]+transfer|documents?[[:space:]]+needed|penthouse[[:space:]]+design|house[[:space:]]+design|house[[:space:]]+plan|(plot|land)[[:space:]]+(size|sizes|dimensions?|measurements?)|(plot|land)[[:space:]]+measurements?|[0-9]+[[:space:]]*ft[[:space:]]*(by|x)[[:space:]]*[0-9]+[[:space:]]*ft|construction[[:space:]]+(tips?|ideas?|costs?|materials?))";
  const sourceBound = "(house[[:space:]]+reveal|building[[:space:]]+nice[[:space:]]+houses?|design[[:space:]]+and[[:space:]]+construction|construction[[:space:]]+clip|construction[[:space:]]+video|building[[:space:]]+process|site[[:space:]]+visit)";
  const explicit = "(for[[:space:]]+sale|on[[:space:]]+sale|for[[:space:]]+rent|to[[:space:]]+rent|to[[:space:]]+let|rent[[:space:]]+to[[:space:]]+own|rent-to-own|available[[:space:]]+(for[[:space:]]+)?(sale|rent|lease)|selling|asking[[:space:]]+price|guide[[:space:]]+price|price[[:space:]]*:|land[[:space:]]+for[[:space:]]+sale|plots?[[:space:]]+for[[:space:]]+sale|house[[:space:]]+for[[:space:]]+sale|home[[:space:]]+for[[:space:]]+sale|apartment[[:space:]]+for[[:space:]]+sale|apartment[[:space:]]+for[[:space:]]+rent|office[[:space:]]+space[[:space:]]+for[[:space:]]+rent|shop[[:space:]]+for[[:space:]]+rent|student[[:space:]]+(room|hostel|accommodation))";
  const knownSource = "(dawinci|da[[:space:]]*winci|sameblood)";
  const lowSignalPromo = "(serious[[:space:]]+customer|owner[[:space:]]+wants?[[:space:]]+money|owner[[:space:]]+want[[:space:]]+money|my[[:space:]]+people|just[[:space:]]+at|you[[:space:]]+are[[:space:]]+to[[:space:]]+own|own[[:space:]]+this|take[[:space:]]+this[[:space:]]+beautiful[[:space:]]+house|fuuka[[:space:]]+landlord|njagala[[:space:]]+plot|tusigazawo|plot[[:space:]]+ntono|sente[[:space:]]+obukadde|hot[[:space:]]+deal|quick[[:space:]]+sale)";
  const foreignMarket = "(kolkata|west[[:space:]]+bengal|bengal|warangal|hanumakonda|telugu|hyderabad|telangana|andhra[[:space:]]+pradesh|mumbai|delhi|pune|india|indian[[:space:]]+real[[:space:]]+estate|[1-9][[:space:]]*bhk)";
  const specificLocation = "(entebbe[[:space:]]*(road|rd)|hoima[[:space:]]*(road|rd)|mawanda[[:space:]]*(road|rd)|road|rd|street|avenue|close|estate|village|zone|parish|division|municipality|kiwatule|kyanja|kisaasi|kira|kira(-|[[:space:]])*mulawa|mulawa|nsasa|kitende|kasangati|mawule|munyonyo|kololo|ntinda|bugolobi|makindye|lubowa|seguku|bwebajja|akright|kajjansi|komamboga|kyebando|makerere|najjeera|namugongo|gayaza|nansana|bulindo|katosi|mpunge|ndejje|bujjuko|bujuuko|kakiri|masulita)";
  const broadLocationOnly = `(
      COALESCE(NULLIF(TRIM(${prefix}area), ''), '') = ''
      OR LOWER(TRIM(${prefix}area)) IN ('uganda', 'kampala', 'wakiso', 'greater kampala', 'central', 'central uganda', 'unknown', 'unknown area')
      OR LOWER(TRIM(${prefix}area)) = LOWER(TRIM(COALESCE(${prefix}district, '')))
    )
    AND (
      COALESCE(NULLIF(TRIM(${prefix}address), ''), '') = ''
      OR LOWER(TRIM(${prefix}address)) IN ('uganda', 'kampala', 'wakiso', 'greater kampala', 'central', 'central uganda', 'unknown', 'unknown area')
      OR LOWER(TRIM(${prefix}address)) = LOWER(TRIM(COALESCE(${prefix}area, '')))
      OR LOWER(TRIM(${prefix}address)) = LOWER(TRIM(COALESCE(${prefix}district, '')))
    )
    AND ${text} !~* '${specificLocation}'`;
  return `(
    (${text} ~* '${foreignMarket}')
    OR (${text} ~* '${hard}' AND ${text} !~* '${explicit}')
    OR (${source} ~* '${knownSource}' AND ${text} ~* '${sourceBound}' AND ${text} !~* '${explicit}')
    OR (${source} ~* '${knownSource}' AND ${text} ~* '${hard}')
    OR (${text} ~* '${lowSignalPromo}' AND ${broadLocationOnly})
  )`;
}

module.exports = {
  sourceQualitySuppressionForRecord,
  sourceLocationQualityForRecord,
  sourcePositiveListingGateForRecord,
  sourceQualitySuppressedSql,
};
