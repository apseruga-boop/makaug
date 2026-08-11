const express = require('express');

const db = require('../config/database');
const { requireAdminApiKey } = require('../middleware/auth');
const { asArray, cleanText, toNullableInt, toNullableFloat } = require('../middleware/validation');
const { captureLearningEvent } = require('../services/aiLearningCaptureService');
const { createLead } = require('../services/leadService');
const { logNotification } = require('../services/notificationLogService');
const {
  normalizeCommercialTransactionType,
  normalizeCommercialPropertyType,
} = require('../utils/commercialClassification');
const {
  canonicalLocationSuggestions,
  resolveCanonicalUgandaLocation,
  resolveCanonicalUgandaLocationFromText,
} = require('../utils/ugandaLocationRegistry');
const {
  SUPPORTED_AI_LANGUAGES,
  extractNaturalPropertyQuery,
  heuristicNaturalPropertyQuery,
  generateListingIntelligence,
  translateFreeText,
  suggestWhatsappAssistantReply,
  recordAiFeedback,
  normalizeLanguageCode
} = require('../services/aiService');

const router = express.Router();

function normalizeAssistantIntent(value = '') {
  const intent = cleanText(value).toLowerCase();
  const aliases = {
    property_search: 'search_property',
    apply_filters: 'search_property',
    search_near_me: 'search_property',
    shared_location_search: 'search_property',
    search_rent: 'search_property',
    search_sale: 'search_property',
    search_student: 'search_property',
    search_land: 'search_property',
    search_commercial: 'search_property',
    ask_mortgage: 'mortgage_help',
    ask_help: 'support',
    report_fraud: 'report_listing',
    list_property_whatsapp: 'property_listing',
    list_property: 'property_listing',
    advertiser_interest: 'advertiser'
  };
  return aliases[intent] || intent || 'unknown';
}

const ASSISTANT_SEARCH_INTENTS = new Set([
  'search_property',
  'property_search',
  'apply_filters',
  'search_near_me',
  'shared_location_search',
  'search_rent',
  'search_rentals',
  'search_sale',
  'search_for_sale',
  'search_student',
  'student',
  'search_land',
  'land_search',
  'search_commercial',
  'commercial_search'
]);

const ASSISTANT_SEARCH_TYPE_BY_INTENT = Object.freeze({
  property_search: 'any',
  apply_filters: 'any',
  search_near_me: 'any',
  shared_location_search: 'any',
  search_rent: 'rent',
  search_rentals: 'rent',
  search_sale: 'sale',
  search_for_sale: 'sale',
  search_student: 'student',
  student: 'student',
  search_land: 'land',
  land_search: 'land',
  search_commercial: 'commercial',
  commercial_search: 'commercial'
});

const ASSISTANT_CATEGORY_PATHS = Object.freeze({
  any: '/for-sale',
  sale: '/for-sale',
  rent: '/to-rent',
  land: '/land',
  commercial: '/commercial',
  student: '/student-accommodation'
});

const ASSISTANT_TYPE_PATTERNS = Object.freeze([
  {
    canonical: 'land',
    searchType: 'land',
    pattern: /\b(land|lands|plot|plots?|acre|acres|hectare|hectares|decimal|decimals|m2|sqm|square\s*met(?:er|re)s?|50\s*[x×]\s*100|100\s*[x×]\s*50|title\s*land|ettaka|eitaka|itaka|ngom|ardhi|shamba|kiwanja)\b/i
  },
  {
    canonical: 'warehouse',
    searchType: 'commercial',
    pattern: /\b(warehouse|warehouses|godown|depot|industrial\s*space|storage\s*space)\b/i
  },
  {
    canonical: 'office',
    searchType: 'commercial',
    pattern: /\b(office|offices|office\s*space|workspace|work\s*space|coworking|co-working|commercial\s*office)\b/i
  },
  {
    canonical: 'shop',
    searchType: 'commercial',
    pattern: /\b(shop|shops|retail|store|stall|showroom|restaurant|commercial\s*space|business\s*space|duuka|dukas?)\b/i
  },
  {
    canonical: 'hostel',
    searchType: 'student',
    pattern: /\b(hostel|hostels|student\s*(room|rooms|accommodation|housing)|campus|makerere|kyambogo|mubs|ucu|nkumba|university|college|bedsitter|bed\s*sitter|self[-\s]?contained|single\s*room|double\s*room|per\s*semester)\b/i
  },
  {
    canonical: 'apartment',
    searchType: null,
    pattern: /\b(apartment|apartments|flat|flats|unit|condo|condominium|apartimenti)\b/i
  },
  {
    canonical: 'studio',
    searchType: null,
    pattern: /\b(studio|bedsitter|bed\s*sitter|single\s*room|self[-\s]?contained)\b/i
  },
  {
    canonical: 'bungalow',
    searchType: null,
    pattern: /\b(bungalow|bungalows)\b/i
  },
  {
    canonical: 'house',
    searchType: null,
    pattern: /\b(house|houses|home|homes|villa|villas|mansion|maka|nyumba|enju)\b/i
  }
]);

const ASSISTANT_LISTING_SIGNAL_PATTERN = /\b(for\s*sale|for\s*rent|to\s*let|to\s*rent|rent(?:al|als|ing)?|buy|sale|bed(?:room)?s?|bdrm|hostel|land|plot|acre|house|home|apartment|flat|studio|bedsitter|office|shop|warehouse|commercial|student|campus)\b/i;
const ASSISTANT_GREETING_ONLY_PATTERN = /^\s*(hi|hello|hey|yo|sup|good\s*(morning|afternoon|evening)|morning|afternoon|evening|test|testing|asdf+|qwerty+|ok|okay)\s*[.!?]*\s*$/i;

function sanitizeAssistantText(value = '') {
  return cleanText(value, 1600)
    .replace(/[🟩🟨]/gu, '')
    .replace(/\s+\|/g, ' |')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function assistantFastResponse(text = '', language = 'en', model = 'heuristic-fast') {
  return {
    text: sanitizeAssistantText(text),
    model,
    requestedLanguage: language,
    responseLanguage: language,
    fallbackUsed: false,
    fallbackReason: null
  };
}

function isAssistantSearchIntent(intent = '') {
  const rawIntent = cleanText(intent).toLowerCase();
  return ASSISTANT_SEARCH_INTENTS.has(rawIntent) || ASSISTANT_SEARCH_INTENTS.has(normalizeAssistantIntent(rawIntent));
}

function assistantSearchType(intent = '') {
  const rawIntent = cleanText(intent).toLowerCase();
  return ASSISTANT_SEARCH_TYPE_BY_INTENT[rawIntent] || 'any';
}

function appOriginFromRequest(req) {
  const configured = cleanText(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || process.env.MAKAUG_PUBLIC_URL);
  if (configured) return configured.replace(/\/+$/, '');
  const proto = cleanText(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0] || 'https';
  const host = cleanText(req.get('x-forwarded-host') || req.get('host') || 'makaug.com').split(',')[0] || 'makaug.com';
  return `${proto}://${host}`.replace(/\/+$/, '');
}

function assistantSearchOriginFromRequest(req) {
  const configured = cleanText(process.env.ASSISTANT_SEARCH_BASE_URL || process.env.INTERNAL_SEARCH_BASE_URL);
  if (configured) return configured.replace(/\/+$/, '');
  const port = cleanText(process.env.PORT);
  if (process.env.NODE_ENV === 'production' && port) {
    return `http://127.0.0.1:${port}`;
  }
  return appOriginFromRequest(req);
}

function publicSearchPathForType(searchType = 'any') {
  return ASSISTANT_CATEGORY_PATHS[searchType] || ASSISTANT_CATEGORY_PATHS.any;
}

function assistantSearchText(parsed = {}, userMessage = '') {
  return cleanText([
    userMessage,
    parsed?.searchType,
    parsed?.propertyType,
    parsed?.category,
    parsed?.listingType,
    parsed?.area,
    parsed?.district,
    parsed?.title,
    parsed?.description
  ].filter(Boolean).join(' '));
}

function normalizeAssistantPropertyType(propertyType = '', userMessage = '', parsed = {}) {
  const blob = assistantSearchText({ ...parsed, propertyType }, userMessage);
  if (!blob) return '';
  const explicit = cleanText(propertyType).toLowerCase();
  const directAliases = {
    commercial_property: 'commercial',
    commercial: 'commercial',
    student_accommodation: 'hostel',
    student: 'hostel',
    room: 'studio',
    rental: '',
    rent: '',
    sale: ''
  };
  if (Object.prototype.hasOwnProperty.call(directAliases, explicit)) return directAliases[explicit];
  const matched = ASSISTANT_TYPE_PATTERNS.find((item) => item.pattern.test(blob));
  return matched?.canonical || explicit || '';
}

function assistantSearchTypeFromProperty(propertyType = '', userMessage = '', parsed = {}) {
  const blob = assistantSearchText({ ...parsed, propertyType }, userMessage);
  const matched = ASSISTANT_TYPE_PATTERNS.find((item) => item.searchType && item.pattern.test(blob));
  return matched?.searchType || '';
}

function inferAssistantSearchType({ intent = '', parsed = {}, userMessage = '' } = {}) {
  const rawIntentType = assistantSearchType(intent);
  const parsedType = cleanText(parsed?.searchType || parsed?.listingType || parsed?.category).toLowerCase();
  const propertyDrivenType = assistantSearchTypeFromProperty(parsed?.propertyType, userMessage, parsed);
  if (propertyDrivenType) return propertyDrivenType;
  if (['land', 'commercial', 'student'].includes(parsedType)) return parsedType;
  if (['land', 'commercial', 'student'].includes(rawIntentType)) return rawIntentType;
  if (['rent', 'sale'].includes(rawIntentType)) return rawIntentType;
  if (['rent', 'sale'].includes(parsedType)) return parsedType;
  return 'any';
}

function prepareAssistantParsedQuery({ parsed = {}, intent = '', userMessage = '' } = {}) {
  const searchType = inferAssistantSearchType({ intent, parsed, userMessage });
  const normalizedPropertyType = normalizeAssistantPropertyType(parsed?.propertyType, userMessage, parsed);
  const propertyTypeRaw = normalizedPropertyType && normalizedPropertyType !== searchType ? normalizedPropertyType : '';
  const propertyType = searchType === 'commercial'
    ? normalizeCommercialPropertyType(propertyTypeRaw, { text: userMessage })
    : propertyTypeRaw;
  const transactionType = ['commercial', 'land'].includes(searchType)
    ? normalizeCommercialTransactionType(parsed?.transactionType || parsed?.transaction_type, {
      text: userMessage,
      pricePeriod: parsed?.budgetPeriod
    })
    : null;
  return {
    parsed: {
      ...(parsed || {}),
      searchType,
      propertyType: propertyType || null,
      transactionType: transactionType || null
    },
    searchType
  };
}

function resolveAssistantParsedLocation(parsed = {}, userMessage = '') {
  const rawArea = cleanText(parsed?.area, 120);
  const rawDistrict = cleanText(parsed?.district, 120);
  const hasStructuredLocation = Boolean(rawArea || rawDistrict);
  const resolution = rawArea
    ? resolveCanonicalUgandaLocation(rawArea, rawDistrict)
    : rawDistrict
      ? resolveCanonicalUgandaLocation(rawDistrict)
      : resolveCanonicalUgandaLocationFromText(userMessage);
  if (resolution.status === 'matched') {
    const location = resolution.match;
    return {
      parsed: {
        ...parsed,
        area: ['district', 'region'].includes(location.level) ? null : location.name,
        district: location.district,
        canonicalLocationId: location.key,
      },
      requested: hasStructuredLocation,
      resolution: {
        status: 'matched',
        match: resolution.match_type,
        confidence: 1,
        canonical_location_id: location.key,
        area: ['district', 'region'].includes(location.level) ? null : location.name,
        district: location.district,
        candidates: []
      }
    };
  }
  const suggestions = hasStructuredLocation
    ? canonicalLocationSuggestions(rawArea || rawDistrict, new Map(), 5)
      .filter((item) => item.auto_resolvable !== true)
      .map((item) => ({
        canonical_location_id: item.canonical_key,
        area: item.level === 'district' ? null : item.location,
        district: item.district,
        match: item.match,
        confidence: item.confidence
      }))
    : [];
  return {
    parsed: hasStructuredLocation ? { ...parsed, area: null, district: null, canonicalLocationId: null } : parsed,
    requested: hasStructuredLocation,
    resolution: {
      status: resolution.status,
      match: resolution.match_type,
      confidence: 0,
      canonical_location_id: null,
      area: null,
      district: null,
      candidates: resolution.candidates.map((item) => ({
        canonical_location_id: item.key,
        area: item.level === 'district' ? null : item.name,
        district: item.district,
        match: resolution.match_type,
        confidence: 0
      })),
      did_you_mean_suggestions: suggestions
    }
  };
}

function assistantHasSearchSignal(parsed = {}, searchType = 'any', userMessage = '') {
  const text = cleanText(userMessage);
  if (!text || ASSISTANT_GREETING_ONLY_PATTERN.test(text)) return false;
  if (Number(parsed?.bedsMin) > 0 || Number(parsed?.maxBudgetUgx) > 0) return true;
  if (cleanText(parsed?.area || parsed?.district || parsed?.propertyType)) return true;
  if (searchType && searchType !== 'any') return true;
  return ASSISTANT_LISTING_SIGNAL_PATTERN.test(text);
}

function inferAssistantIntentFromMessage(userMessage = '', suppliedIntent = 'unknown') {
  const explicitIntent = cleanText(suppliedIntent).toLowerCase();
  if (explicitIntent && explicitIntent !== 'unknown') return explicitIntent;
  const text = cleanText(userMessage, 1200);
  if (!text || ASSISTANT_GREETING_ONLY_PATTERN.test(text)) return 'unknown';
  if (ASSISTANT_LISTING_SIGNAL_PATTERN.test(text)) return 'property_search';
  if (ASSISTANT_TYPE_PATTERNS.some((item) => item.pattern.test(text))) return 'property_search';
  return 'unknown';
}

function buildAssistantSeeAllUrl(parsed = {}, searchType = 'any') {
  const publicPath = publicSearchPathForType(searchType);
  const publicParams = new URLSearchParams();
  if (parsed?.area) publicParams.set('q', cleanText(parsed.area, 120));
  if (parsed?.district && !parsed.area) publicParams.set('district', cleanText(parsed.district, 120));
  if (Number(parsed?.bedsMin) > 0) publicParams.set('min_beds', String(Math.round(Number(parsed.bedsMin))));
  if (Number(parsed?.maxBudgetUgx) > 0) publicParams.set('max_price', String(Math.round(Number(parsed.maxBudgetUgx))));
  if (parsed?.propertyType && cleanText(parsed.propertyType).toLowerCase() !== searchType) {
    publicParams.set('property_type', cleanText(parsed.propertyType, 80));
  }
  if (parsed?.transactionType) publicParams.set('transaction_type', cleanText(parsed.transactionType, 20));
  return `${publicPath}${publicParams.toString() ? `?${publicParams.toString()}` : ''}`;
}

function buildAssistantSearchParams(parsed = {}, searchType = 'any', language = 'en') {
  const params = new URLSearchParams({
    status: 'approved',
    public_only: '1',
    limit: '6',
    page: '1',
    include_summary: '0',
    card_fields: '1',
    sort: 'newest',
    source: 'ai_assistant',
    language
  });
  const type = cleanText(searchType || parsed.searchType || 'any').toLowerCase();
  if (type && type !== 'any') {
    if (type === 'student') {
      params.set('student_portal', '1');
    } else {
      params.set('listing_type', type);
    }
  }
  if (parsed.area) params.set('query', cleanText(parsed.area, 120));
  if (parsed.district && !parsed.area) params.set('district', cleanText(parsed.district, 120));
  if (Number(parsed.bedsMin) > 0) params.set('min_beds', String(Math.round(Number(parsed.bedsMin))));
  const propertyType = cleanText(parsed.propertyType, 80);
  if (propertyType && propertyType.toLowerCase() !== type) {
    params.set('property_type', propertyType);
    if (type === 'commercial') params.set('commercial_type', propertyType);
  }
  if (parsed.transactionType && ['commercial', 'land'].includes(type)) {
    params.set('transaction_type', cleanText(parsed.transactionType, 20));
  }
  if (Number(parsed.maxBudgetUgx) > 0) params.set('max_price', String(Math.round(Number(parsed.maxBudgetUgx))));
  return params;
}

function assistantFilterChips(parsed = {}, searchType = 'any') {
  const chips = [];
  const type = cleanText(searchType || parsed.searchType || 'any').toLowerCase();
  const typeLabels = {
    rent: 'To rent',
    sale: 'For sale',
    land: 'Land',
    commercial: 'Commercial',
    student: 'Student accommodation'
  };
  if (type && type !== 'any') chips.push(typeLabels[type] || type.charAt(0).toUpperCase() + type.slice(1));
  if (parsed.transactionType) chips.push(parsed.transactionType === 'rent' ? 'For rent' : 'For sale');
  if (parsed.bedsMin) chips.push(`${parsed.bedsMin}+ beds`);
  if (parsed.area || parsed.district) chips.push(parsed.area || parsed.district);
  if (parsed.maxBudgetUgx) chips.push(`<= UGX ${Number(parsed.maxBudgetUgx).toLocaleString('en-UG')}`);
  if (parsed.propertyType) chips.push(parsed.propertyType);
  return chips;
}

function assistantLeadText({ total = 0, parsed = {}, searchType = 'any', language = 'en', matchQuality = 'exact', needsInput = false } = {}) {
  const place = cleanText(parsed.area || parsed.district || 'Uganda', 120);
  const type = cleanText(parsed.searchType || searchType || 'property').replace(/_/g, ' ');
  const count = Number(total) || 0;
  if (needsInput) {
    if (language === 'sw') return 'Niambie eneo, bei, na aina ya mali unayotafuta, kisha nitakuletea matokeo halisi.';
    if (language === 'lg') return 'Mbuulira ekitundu, budget, n’ekika ky’ennyumba gy’onoonya, nkuleetere ebiriwo.';
    if (language === 'ar') return 'اكتب المنطقة والميزانية ونوع العقار الذي تريده، وسأعرض لك النتائج المناسبة.';
    return 'Tell me the area, budget, and property type you want, and I will search the live listings.';
  }
  if (count > 0 && matchQuality === 'nearby_not_exact') {
    if (language === 'sw') return `Sikupata matokeo kamili ya ombi lote. Haya ni matokeo ya karibu zaidi kwa ${place}.`;
    if (language === 'lg') return `Tewali kitu ekikwatagana ddala n’obusabe bwonna. Bino bye bisinga okumpi ne ${place}.`;
    if (language === 'ar') return `لم أجد تطابقاً دقيقاً لكل طلبك. هذه أقرب نتائج مفيدة حول ${place}.`;
    return `No exact match for the full request yet. Here are the nearest useful results around ${place}.`;
  }
  if (language === 'sw') {
    return count > 0
      ? `Nimepata matokeo ${count} ya ${type} karibu na ${place}.`
      : `Sijapata matokeo kamili karibu na ${place}. Unaweza kutuambia unachotafuta.`;
  }
  if (language === 'lg') {
    return count > 0
      ? `Nfunye ebivudde ${count} ebikwatagana ne ${type} mu ${place}.`
      : `Tebinnabaawo ebikwatagana mu ${place}. Tusobola okukuyamba okuteekawo obwetaavu bwo.`;
  }
  if (language === 'ar') {
    return count > 0
      ? `وجدت ${count} نتيجة مطابقة تقريباً في ${place}.`
      : `لم أجد نتائج دقيقة في ${place}. أخبرنا بما تحتاجه وسنساعدك.`;
  }
  return count > 0
    ? `I found ${count} matching ${type} result${count === 1 ? '' : 's'} around ${place}.`
    : `I could not find exact matches around ${place}. Tell us what you need and we can help watch for it.`;
}

function assistantLocationLooksRelaxed(listings = [], parsed = {}) {
  const wanted = cleanText(parsed?.area || parsed?.district).toLowerCase();
  if (!wanted || !Array.isArray(listings) || !listings.length) return false;
  const normalizedWanted = wanted.replace(/[^a-z0-9]+/g, ' ').trim();
  if (!normalizedWanted || normalizedWanted.length < 3) return false;
  return !listings.some((listing) => {
    const text = cleanText([
      listing?.area,
      listing?.district,
      listing?.city,
      listing?.address,
      listing?.location_label,
      listing?.title
    ].filter(Boolean).join(' ')).toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    return text.includes(normalizedWanted);
  });
}

function buildAssistantCapturePayload({ userMessage = '', parsed = {}, searchType = 'any', reason = 'zero_results' } = {}) {
  return {
    reason,
    search_type: searchType || 'any',
    area: parsed?.area || null,
    district: parsed?.district || null,
    bedrooms: parsed?.bedsMin || null,
    max_price: parsed?.maxBudgetUgx || null,
    property_type: parsed?.propertyType || null,
    transaction_type: parsed?.transactionType || null,
    message: userMessage
  };
}

const ASSISTANT_SEARCH_PREWARM_MARKER = 'ask-ai-search-prewarm-20260718';
const ASSISTANT_SEARCH_PREWARM_BROAD_MARKER = 'ask-ai-prewarm-broad-20260718';
const ASSISTANT_SEARCH_RESULT_CACHE_TTL_MS = Math.max(
  60 * 1000,
  Math.min(10 * 60 * 1000, parseInt(process.env.ASSISTANT_SEARCH_CACHE_TTL_MS || `${5 * 60 * 1000}`, 10) || (5 * 60 * 1000))
);
const ASSISTANT_SEARCH_TIMEOUT_MS = Math.max(1200, Math.min(8000, parseInt(process.env.ASSISTANT_SEARCH_TIMEOUT_MS || '5000', 10) || 5000));
const ASSISTANT_SEARCH_RESULT_CACHE_MAX_ENTRIES = Math.max(80, Math.min(300, parseInt(process.env.ASSISTANT_SEARCH_CACHE_MAX_ENTRIES || '200', 10) || 200));
// Prewarming can fan out across dozens of search variants. Keep it opt-in so
// the single production instance cannot starve real category and AI searches.
const ASSISTANT_SEARCH_PREWARM_ENABLED = String(process.env.ASSISTANT_SEARCH_PREWARM_ENABLED || 'false').toLowerCase() === 'true';
const ASSISTANT_SEARCH_PREWARM_INTERVAL_MS = Math.max(
  60 * 1000,
  Math.min(15 * 60 * 1000, parseInt(process.env.ASSISTANT_SEARCH_PREWARM_INTERVAL_MS || `${4 * 60 * 1000}`, 10) || (4 * 60 * 1000))
);
const ASSISTANT_SEARCH_PREWARM_START_DELAY_MS = Math.max(
  5000,
  Math.min(120000, parseInt(process.env.ASSISTANT_SEARCH_PREWARM_START_DELAY_MS || '90000', 10) || 90000)
);
const ASSISTANT_SEARCH_PREWARM_REFRESH_MS = Math.max(
  30 * 1000,
  Math.min(
    Math.max(30 * 1000, ASSISTANT_SEARCH_RESULT_CACHE_TTL_MS - 15000),
    parseInt(process.env.ASSISTANT_SEARCH_PREWARM_REFRESH_MS || `${Math.floor(ASSISTANT_SEARCH_RESULT_CACHE_TTL_MS * 0.55)}`, 10)
      || Math.floor(ASSISTANT_SEARCH_RESULT_CACHE_TTL_MS * 0.55)
  )
);
const ASSISTANT_SEARCH_PREWARM_DELAY_MS = Math.max(0, Math.min(500, parseInt(process.env.ASSISTANT_SEARCH_PREWARM_DELAY_MS || '200', 10) || 200));
const assistantSearchResultCache = new Map();
let assistantSearchPrewarmStarted = false;
let assistantSearchPrewarmInFlight = false;
const ASSISTANT_SEARCH_PREWARM_LOAD_SHED_MARKER = 'k32-launch-traffic-load-shed-20260805';

const ASSISTANT_SEARCH_PREWARM_BROAD_AREAS = Object.freeze([
  'Kira',
  'Kampala',
  'Wakiso',
  'Nansana',
  'Mukono',
  'Gayaza',
  'Entebbe'
]);

function assistantUniquePrewarmQueries(queries = []) {
  const seen = new Set();
  return queries.filter((query) => {
    const key = `${query?.searchType || 'any'}:${cleanText(query?.parsed?.area || '')}:${cleanText(query?.parsed?.district || '')}:${cleanText(query?.parsed?.propertyType || '')}:${query?.parsed?.bedsMin || ''}:${query?.parsed?.maxBudgetUgx || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Keep prewarm on broad category URLs. Ask AI relaxes subtype words like house/warehouse
// for the preview cards, and subtype URL filters are the expensive search path.
const ASSISTANT_SEARCH_PREWARM_BROAD_QUERIES = Object.freeze(ASSISTANT_SEARCH_PREWARM_BROAD_AREAS.flatMap((area) => [
  { searchType: 'sale', parsed: { area } },
  { searchType: 'rent', parsed: { area } },
  { searchType: 'land', parsed: { area } },
  { searchType: 'commercial', parsed: { area } }
]));

const ASSISTANT_SEARCH_PREWARM_QUERIES = Object.freeze(assistantUniquePrewarmQueries([
  ...ASSISTANT_SEARCH_PREWARM_BROAD_QUERIES,
  { searchType: 'sale', parsed: { area: 'Kira' } },
  { searchType: 'sale', parsed: { area: 'Ntinda' } },
  { searchType: 'sale', parsed: { area: 'Muyenga' } },
  { searchType: 'sale', parsed: { area: 'Najjera' } },
  { searchType: 'sale', parsed: { area: 'Kyanja' } },
  { searchType: 'sale', parsed: { area: 'Gayaza' } },
  { searchType: 'sale', parsed: { district: 'Wakiso' } },
  { searchType: 'rent', parsed: { area: 'Ntinda' } },
  { searchType: 'rent', parsed: { area: 'Kira' } },
  { searchType: 'rent', parsed: { area: 'Bukoto' } },
  { searchType: 'rent', parsed: { area: 'Kisaasi' } },
  { searchType: 'rent', parsed: { area: 'Muyenga' } },
  { searchType: 'rent', parsed: { area: 'Nakasero' } },
  { searchType: 'land', parsed: { area: 'Gayaza' } },
  { searchType: 'land', parsed: { area: 'Wakiso' } },
  { searchType: 'land', parsed: { area: 'Mukono' } },
  { searchType: 'land', parsed: { area: 'Kira' } },
  { searchType: 'commercial', parsed: { area: 'Kampala' } },
  { searchType: 'commercial', parsed: { area: 'Nakawa' } },
  { searchType: 'commercial', parsed: { area: 'Nakasero' } },
  { searchType: 'student', parsed: { area: 'Makerere', propertyType: 'hostel' } },
  { searchType: 'student', parsed: { area: 'Kyambogo', propertyType: 'hostel' } },
  { searchType: 'student', parsed: { area: 'MUBS', propertyType: 'hostel' } }
]));

function assistantSearchCacheKeyForUrl(rawUrl = '') {
  const text = cleanText(rawUrl, 2000);
  if (!text) return '';
  try {
    const parsed = new URL(text, 'http://makaug.local');
    return `${parsed.pathname}?${parsed.searchParams.toString()}`;
  } catch (_) {
    return text;
  }
}

function getAssistantSearchResultCache(key = '') {
  const cacheKey = assistantSearchCacheKeyForUrl(key);
  const cached = assistantSearchResultCache.get(cacheKey);
  if (!cached) return null;
  if ((Date.now() - cached.createdAt) > ASSISTANT_SEARCH_RESULT_CACHE_TTL_MS) {
    assistantSearchResultCache.delete(cacheKey);
    return null;
  }
  return cached.payload;
}

function getAssistantSearchResultCacheAgeMs(key = '') {
  const cacheKey = assistantSearchCacheKeyForUrl(key);
  const cached = assistantSearchResultCache.get(cacheKey);
  if (!cached?.createdAt) return Infinity;
  return Date.now() - cached.createdAt;
}

function setAssistantSearchResultCache(key = '', payload = null) {
  const cacheKey = assistantSearchCacheKeyForUrl(key);
  if (!cacheKey || !payload) return;
  assistantSearchResultCache.set(cacheKey, { createdAt: Date.now(), payload });
  if (assistantSearchResultCache.size <= ASSISTANT_SEARCH_RESULT_CACHE_MAX_ENTRIES) return;
  const oldestKey = assistantSearchResultCache.keys().next().value;
  if (oldestKey) assistantSearchResultCache.delete(oldestKey);
}

async function fetchAssistantSearchUrl(url, { timeoutMs = ASSISTANT_SEARCH_TIMEOUT_MS, forceRefresh = false } = {}) {
  const cached = forceRefresh ? null : getAssistantSearchResultCache(url);
  if (cached) return cached;
  const controller = new AbortController();
  const boundedTimeoutMs = Math.max(1000, Math.min(ASSISTANT_SEARCH_TIMEOUT_MS, Number(timeoutMs) || ASSISTANT_SEARCH_TIMEOUT_MS));
  const timeout = setTimeout(() => controller.abort(), boundedTimeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(json?.error || `property search failed (${response.status})`);
      err.status = response.status;
      throw err;
    }
    const listings = Array.isArray(json?.data) ? json.data : [];
    const total = Number(json?.pagination?.total ?? json?.summary?.public_opportunities?.total ?? listings.length) || 0;
    const payload = {
      ok: true,
      url,
      listings,
      total,
      pagination: json?.pagination || null,
      meta: json?.meta || null,
      prewarm_marker: ASSISTANT_SEARCH_PREWARM_MARKER,
      prewarm_broad_marker: ASSISTANT_SEARCH_PREWARM_BROAD_MARKER
    };
    setAssistantSearchResultCache(url, payload);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAssistantSearchResults(req, { parsed, searchType, language, timeoutMs = ASSISTANT_SEARCH_TIMEOUT_MS }) {
  const params = buildAssistantSearchParams(parsed, searchType, language);
  const origin = assistantSearchOriginFromRequest(req);
  const url = `${origin}/api/properties/search?${params.toString()}`;
  return fetchAssistantSearchUrl(url, { timeoutMs });
}

function assistantSearchPrewarmOrigin() {
  const explicit = cleanText(process.env.ASSISTANT_SEARCH_BASE_URL || process.env.PUBLIC_SITE_URL || process.env.APP_URL || process.env.RENDER_EXTERNAL_URL);
  if (explicit) return explicit.replace(/\/$/, '');
  const port = cleanText(process.env.PORT || '3000');
  return `http://127.0.0.1:${port}`;
}

async function prewarmAssistantSearchCacheOnce() {
  const origin = assistantSearchPrewarmOrigin();
  if (!origin) return { warmed: 0, skipped: 0, failed: 0 };
  let warmed = 0;
  let skipped = 0;
  let failed = 0;
  for (const query of ASSISTANT_SEARCH_PREWARM_QUERIES) {
    const params = buildAssistantSearchParams(query.parsed, query.searchType, 'en');
    const url = `${origin}/api/properties/search?${params.toString()}`;
    const cachedAgeMs = getAssistantSearchResultCacheAgeMs(url);
    if (Number.isFinite(cachedAgeMs) && cachedAgeMs < ASSISTANT_SEARCH_PREWARM_REFRESH_MS) {
      skipped += 1;
      continue;
    }
    try {
      await fetchAssistantSearchUrl(url, { timeoutMs: ASSISTANT_SEARCH_TIMEOUT_MS, forceRefresh: true });
      warmed += 1;
    } catch (error) {
      failed += 1;
      if (process.env.NODE_ENV !== 'test') console.warn('Ask AI search prewarm failed', { url, error: error?.message || error });
    }
    if (ASSISTANT_SEARCH_PREWARM_DELAY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, ASSISTANT_SEARCH_PREWARM_DELAY_MS));
    }
  }
  return { warmed, skipped, failed };
}

function startAssistantSearchPrewarmLoop() {
  if (!ASSISTANT_SEARCH_PREWARM_ENABLED || assistantSearchPrewarmStarted || process.env.NODE_ENV === 'test') return;
  assistantSearchPrewarmStarted = true;
  const run = () => {
    if (assistantSearchPrewarmInFlight) return;
    assistantSearchPrewarmInFlight = true;
    prewarmAssistantSearchCacheOnce()
      .then((result) => {
        if (process.env.NODE_ENV !== 'test') console.info('Ask AI search prewarm completed', {
          ...result,
          marker: ASSISTANT_SEARCH_PREWARM_LOAD_SHED_MARKER
        });
      })
      .catch((error) => {
        console.warn('Ask AI search prewarm loop failed', error?.message || error);
      })
      .finally(() => {
        assistantSearchPrewarmInFlight = false;
      });
  };
  const first = setTimeout(run, ASSISTANT_SEARCH_PREWARM_START_DELAY_MS);
  if (typeof first.unref === 'function') first.unref();
  const interval = setInterval(run, ASSISTANT_SEARCH_PREWARM_INTERVAL_MS);
  if (typeof interval.unref === 'function') interval.unref();
}

startAssistantSearchPrewarmLoop();

async function recordAssistantBackendTrace(req, { userMessage, intent, language, response }) {
  const normalizedIntent = normalizeAssistantIntent(intent);
  const context = req.body?.context && typeof req.body.context === 'object' ? req.body.context : {};
  await captureLearningEvent({
    eventName: `ai_chatbot_${normalizedIntent}`,
    source: cleanText(req.body?.source) || 'discover_ai_chatbot',
    channel: 'web',
    sessionId: cleanText(req.body?.session_id || context.sessionId) || `ai_chatbot:${Date.now()}`,
    externalUserId: cleanText(context.userId || context.phone || context.email) || null,
    language,
    inputText: userMessage,
    responseText: response?.text || '',
    payload: {
      intent: normalizedIntent,
      provider_model: response?.model || 'unknown',
      route: context.route || '/discover-ai-chatbot'
    },
    entities: context.entities || {},
    outcome: 'responded',
    requestIp: req.ip,
    userAgent: req.get('user-agent')
  });

  const leadTypeByIntent = {
    report_listing: 'fraud',
    mortgage_help: 'mortgage',
    advertiser: 'advertiser',
    human_handoff: 'support',
    support: 'support',
    property_listing: 'listing_owner'
  };
  const leadType = leadTypeByIntent[normalizedIntent];
  if (leadType) {
    const lead = await createLead(db, {
      source: 'ai_chatbot',
      leadType,
      category: normalizedIntent,
      message: userMessage,
      contact: {
        name: cleanText(context.name) || 'AI chatbot user',
        email: cleanText(context.email) || null,
        phone: cleanText(context.phone) || null,
        preferredContactChannel: cleanText(context.preferredContactChannel) || 'whatsapp',
        preferredLanguage: language,
        roleType: leadType
      },
      activityType: `ai_${normalizedIntent}`,
      metadata: {
        route: context.route || '/discover-ai-chatbot',
        model: response?.model || 'unknown'
      }
    });
    await logNotification(db, {
      recipientEmail: cleanText(context.email) || null,
      recipientPhone: cleanText(context.phone) || null,
      channel: 'in_app',
      type: normalizedIntent === 'human_handoff' ? 'human_handoff_required' : `ai_${normalizedIntent}`,
      status: 'logged',
      payloadSummary: { intent: normalizedIntent, model: response?.model || 'unknown' },
      relatedLeadId: lead?.id || null
    });
  }
}

function logAssistantTraceFailure(error) {
  if (process.env.NODE_ENV === 'test') return;
  console.warn('Ask AI trace logging failed', error?.message || error);
}

function parseBooleanLike(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = String(value || '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(text)) return false;
  return fallback;
}

router.get('/model-card', (req, res) => {
  return res.json({
    ok: true,
    data: {
      name: 'makaug property AI model',
      version: process.env.AI_MODEL_VERSION || '2026.03.27',
      focus: 'Uganda property search, listing quality, multilingual WhatsApp assistance, and campaign optimization',
      languages: SUPPORTED_AI_LANGUAGES,
      capabilities: [
        'intent_classification',
        'voice_transcription',
        'listing_rewrite',
        'area_highlights_generation',
        'multilingual_listing_text',
        'assistant_reply_suggestions',
        'campaign_copy_generation',
        'ai_event_logging',
        'feedback_loop_training'
      ],
      public_base_url: (process.env.PUBLIC_BASE_URL || 'https://makaug.com').replace(/\/+$/, '')
    }
  });
});

router.post('/listing-intelligence', async (req, res, next) => {
  try {
    const body = req.body || {};
    const listing = {
      listing_type: cleanText(body.listing_type || body.type).toLowerCase(),
      title: cleanText(body.title),
      description: cleanText(body.description),
      district: cleanText(body.district),
      area: cleanText(body.area),
      price: toNullableInt(body.price),
      price_period: cleanText(body.price_period),
      bedrooms: toNullableInt(body.bedrooms),
      bathrooms: toNullableInt(body.bathrooms),
      property_type: cleanText(body.property_type),
      amenities: asArray(body.amenities).map((x) => cleanText(x)).filter(Boolean),
      nearest_university: cleanText(body.nearest_university),
      commercial_intent: cleanText(body.commercial_intent),
      land_size_value: toNullableFloat(body.land_size_value),
      land_size_unit: cleanText(body.land_size_unit)
    };

    if (!listing.title || !listing.district || !listing.area) {
      return res.status(400).json({ ok: false, error: 'title, district, and area are required' });
    }

    const targetLanguage = normalizeLanguageCode(body.target_language || body.language || 'en');
    const includeAllLanguages = parseBooleanLike(body.include_all_languages, false);

    const intelligence = await generateListingIntelligence({
      listing,
      targetLanguage,
      includeAllLanguages,
      source: 'api_listing_intelligence'
    });

    return res.json({ ok: true, data: intelligence });
  } catch (error) {
    return next(error);
  }
});

router.post('/rewrite-description', async (req, res, next) => {
  try {
    const body = req.body || {};

    const listing = {
      listing_type: cleanText(body.listing_type || body.type).toLowerCase(),
      title: cleanText(body.title),
      description: cleanText(body.description),
      district: cleanText(body.district),
      area: cleanText(body.area),
      price: toNullableInt(body.price),
      bedrooms: toNullableInt(body.bedrooms),
      bathrooms: toNullableInt(body.bathrooms),
      property_type: cleanText(body.property_type),
      amenities: asArray(body.amenities).map((x) => cleanText(x)).filter(Boolean)
    };

    if (!listing.title || !listing.description || !listing.district || !listing.area) {
      return res.status(400).json({ ok: false, error: 'title, description, district, and area are required' });
    }

    const targetLanguage = normalizeLanguageCode(body.target_language || body.language || 'en');
    const intelligence = await generateListingIntelligence({
      listing,
      targetLanguage,
      includeAllLanguages: false,
      source: 'api_rewrite_description'
    });

    return res.json({
      ok: true,
      data: {
        event_id: intelligence.event_id || null,
        model: intelligence.model,
        language: targetLanguage,
        rewritten_description: intelligence.canonical?.rewritten_description || listing.description,
        area_highlights: intelligence.canonical?.area_highlights || ''
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/translate-text', async (req, res, next) => {
  try {
    const body = req.body || {};
    const text = cleanText(body.text || body.description).replace(/\s+/g, ' ').slice(0, 5000);
    if (!text) {
      return res.status(400).json({ ok: false, error: 'text is required' });
    }

    const targetLanguage = normalizeLanguageCode(body.target_language || body.language || 'en');
    const sourceLanguage = normalizeLanguageCode(body.source_language || 'en');
    const result = await translateFreeText({
      text,
      targetLanguage,
      sourceLanguage,
      context: cleanText(body.context || 'list-property description preview').slice(0, 500),
      source: cleanText(body.source || 'api_translate_text') || 'api_translate_text'
    });

    return res.json({
      ok: true,
      data: {
        language: result.language || targetLanguage,
        source_language: result.source_language || sourceLanguage,
        translated_text: result.translated_text || text,
        model: result.model || 'unknown',
        fallback_used: Boolean(result.fallbackUsed),
        fallback_reason: result.fallbackReason || null
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/property-need', async (req, res, next) => {
  try {
    const body = req.body || {};
    const message = cleanText(body.message || body.search_message || body.details, 1200);
    const searchType = cleanText(body.search_type || body.category || body.listing_type || 'any', 80).toLowerCase() || 'any';
    const language = normalizeLanguageCode(body.language || 'en');
    const name = cleanText(body.name, 120) || 'Ask AI property seeker';
    const phone = cleanText(body.phone || body.whatsapp, 40) || null;
    const email = cleanText(body.email, 160).toLowerCase() || null;
    const area = cleanText(body.area || body.location, 120) || null;
    const district = cleanText(body.district, 120) || null;
    const budget = toNullableInt(body.max_price || body.budget || body.maxBudgetUgx);
    const propertyType = cleanText(body.property_type, 80) || null;

    if (!message && !area && !district && !propertyType) {
      return res.status(400).json({ ok: false, error: 'message or search details are required' });
    }

    const summary = message || `Ask AI no-match request: ${[searchType, area || district, propertyType].filter(Boolean).join(' · ')}`;
    const lead = await createLead(db, {
      source: 'ask_ai_zero_result',
      leadType: 'property_need',
      category: searchType,
      location: area || district || null,
      budget,
      message: summary,
      contact: {
        name,
        email,
        phone,
        preferredContactChannel: phone ? 'whatsapp' : (email ? 'email' : 'in_app'),
        preferredLanguage: language,
        roleType: 'buyer_renter',
        locationInterest: area || district || null,
        categoryInterest: searchType,
        budgetRange: budget ? `Up to UGX ${budget}` : null,
        whatsappConsent: Boolean(phone),
        marketingConsent: false
      },
      activityType: 'ask_ai_property_need_captured',
      metadata: {
        route: cleanText(body.route || body.context?.route || '/'),
        source: 'ask_ai',
        capture_reason: cleanText(body.reason || 'zero_results'),
        search_type: searchType,
        area,
        district,
        bedrooms: toNullableInt(body.bedrooms),
        max_price: budget,
        property_type: propertyType,
        original_message: message || null
      }
    });

    await logNotification(db, {
      recipientEmail: email,
      recipientPhone: phone,
      channel: 'in_app',
      type: 'ask_ai_property_need',
      status: 'logged',
      payloadSummary: {
        search_type: searchType,
        area: area || district || null,
        property_type: propertyType,
        lead_id: lead?.id || null
      },
      relatedLeadId: lead?.id || null
    });

    return res.status(201).json({
      ok: true,
      data: {
        lead_id: lead?.id || null,
        status: lead?.lead_status || 'logged',
        message: 'Property need captured for follow-up.'
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/assistant-reply', async (req, res, next) => {
  try {
    const body = req.body || {};
    const context = body.context && typeof body.context === 'object' ? body.context : {};
    const userMessage = cleanText(body.message, 1200);
    if (!userMessage) {
      return res.status(400).json({ ok: false, error: 'message is required' });
    }

    const language = normalizeLanguageCode(body.language || 'en');
    const requestedIntent = cleanText(body.intent).toLowerCase() || 'unknown';
    const sourceKey = cleanText(body.source || context.source).toLowerCase();
    const cleanBarSearchOnly = sourceKey === 'ask_ai_search_bar'
      || sourceKey === 'home_ask_ai_hero'
      || sourceKey === 'discover_ai_chatbot'
      || sourceKey.includes('ask_ai');
    const effectiveIntent = cleanBarSearchOnly && !isAssistantSearchIntent(requestedIntent)
      ? inferAssistantIntentFromMessage(userMessage, 'search_property')
      : inferAssistantIntentFromMessage(userMessage, requestedIntent);
    const assistantIsSearch = isAssistantSearchIntent(effectiveIntent);
    let response = null;
    let searchPayload = null;

    if (!assistantIsSearch && !cleanBarSearchOnly) {
      response = await suggestWhatsappAssistantReply({
        userMessage,
        intent: effectiveIntent,
        language,
        context,
        source: 'api_assistant_reply'
      });
      response = {
        ...response,
        text: sanitizeAssistantText(response?.text || '')
      };
    }

    if (assistantIsSearch || cleanBarSearchOnly) {
      const rawIntentType = assistantSearchType(effectiveIntent);
      const useLlmParser = parseBooleanLike(body.use_llm_parser ?? body.force_llm_parser, false);
      const extracted = useLlmParser
        ? await extractNaturalPropertyQuery({
          text: userMessage,
          language,
          sessionData: context,
          fallbackType: rawIntentType
        })
        : {
          ...heuristicNaturalPropertyQuery({ text: userMessage, fallbackType: rawIntentType }),
          model: 'heuristic-fast'
        };
      const prepared = prepareAssistantParsedQuery({ parsed: extracted, intent: effectiveIntent, userMessage });
      const locationPrepared = resolveAssistantParsedLocation(prepared.parsed, userMessage);
      const parsed = locationPrepared.parsed;
      const locationResolution = locationPrepared.resolution;
      const locationConfirmationRequired = locationPrepared.requested && locationResolution.status !== 'matched';
      const searchType = prepared.searchType;
      const publicPath = publicSearchPathForType(searchType);
      const hasSearchSignal = assistantHasSearchSignal(parsed, searchType, userMessage);

      if (!hasSearchSignal || locationConfirmationRequired) {
        response = assistantFastResponse(
          assistantLeadText({ total: 0, parsed, searchType, language, needsInput: true }),
          language,
          extracted?.model || 'heuristic-fast'
        );
        searchPayload = {
          parsed_query: extracted,
          effective_query: parsed,
          relaxed_filters: [],
          filters: {
            search_type: searchType,
            area: null,
            district: null,
            bedrooms: null,
            max_price: null,
            property_type: null,
            transaction_type: parsed?.transactionType || null
          },
          filter_chips: [],
          search_type: searchType,
          total_matches: 0,
          result_count: 0,
          listings: [],
          results: [],
          see_all_url: buildAssistantSeeAllUrl(parsed, searchType),
          search_path: publicPath,
          zero_results: false,
          needs_search_input: true,
          needs_location_confirmation: locationConfirmationRequired,
          location_resolution: locationResolution,
          capture_available: false,
          match_quality: 'needs_input',
          exact_match: false,
          search_error: null,
          search_prewarm_marker: ASSISTANT_SEARCH_PREWARM_MARKER,
          search_prewarm_broad_marker: ASSISTANT_SEARCH_PREWARM_BROAD_MARKER
        };
      } else {
        try {
          let effectiveParsed = parsed;
          let relaxedFilters = [];
          let matchQuality = 'exact';
          let exactTotal = null;
          let result = null;
          let exactSearchError = null;
          try {
            result = await fetchAssistantSearchResults(req, {
              parsed: effectiveParsed,
              searchType,
              language
            });
            exactTotal = result.total;
          } catch (error) {
            exactSearchError = error;
            exactTotal = 0;
          }
          if (!result) throw exactSearchError || new Error('property_search_failed');
          if (result.total === 0 && parsed?.propertyType) {
            effectiveParsed = { ...parsed, propertyType: null };
            relaxedFilters = ['property_type'];
            matchQuality = 'nearby_not_exact';
            result = await fetchAssistantSearchResults(req, {
              parsed: effectiveParsed,
              searchType,
              language
            });
          }
          if (result.total > 0 && assistantLocationLooksRelaxed(result.listings, effectiveParsed)) {
            matchQuality = 'nearby_not_exact';
            relaxedFilters = Array.from(new Set([...relaxedFilters, 'location']));
          }
          const seeAllUrl = buildAssistantSeeAllUrl(effectiveParsed, searchType);
          const leadText = assistantLeadText({ total: result.total, parsed: effectiveParsed, searchType, language, matchQuality });
          response = assistantFastResponse(leadText, language, extracted?.model || 'heuristic-fast');
          const capturePayload = buildAssistantCapturePayload({
            userMessage,
            parsed: effectiveParsed,
            searchType,
            reason: result.total === 0 ? 'zero_results' : matchQuality
          });
          searchPayload = {
            parsed_query: extracted,
            effective_query: effectiveParsed,
            location_resolution: locationResolution,
            needs_location_confirmation: false,
            relaxed_filters: relaxedFilters,
            filters: {
              search_type: searchType,
              area: effectiveParsed?.area || null,
              district: effectiveParsed?.district || null,
              bedrooms: effectiveParsed?.bedsMin || null,
              max_price: effectiveParsed?.maxBudgetUgx || null,
              property_type: effectiveParsed?.propertyType || null,
              transaction_type: effectiveParsed?.transactionType || null
            },
            filter_chips: assistantFilterChips(effectiveParsed, searchType),
            search_type: searchType,
            total_matches: result.total,
            exact_total_matches: exactTotal,
            result_count: result.listings.length,
            listings: result.listings,
            results: result.listings,
            see_all_url: seeAllUrl,
            search_path: publicPath,
            zero_results: result.total === 0,
            capture_available: result.total === 0 || matchQuality === 'nearby_not_exact',
            capture_payload: capturePayload,
            match_quality: matchQuality,
            exact_match: matchQuality === 'exact' && result.total > 0,
            search_error: null,
            search_prewarm_marker: ASSISTANT_SEARCH_PREWARM_MARKER,
            search_prewarm_broad_marker: ASSISTANT_SEARCH_PREWARM_BROAD_MARKER
          };
        } catch (searchError) {
          const capturePayload = buildAssistantCapturePayload({
            userMessage,
            parsed,
            searchType,
            reason: 'search_error'
          });
          searchPayload = {
            parsed_query: extracted,
            effective_query: parsed,
            location_resolution: locationResolution,
            needs_location_confirmation: false,
            relaxed_filters: [],
            filters: {
              search_type: searchType,
              area: parsed?.area || null,
              district: parsed?.district || null,
              bedrooms: parsed?.bedsMin || null,
              max_price: parsed?.maxBudgetUgx || null,
              property_type: parsed?.propertyType || null,
              transaction_type: parsed?.transactionType || null
            },
            filter_chips: assistantFilterChips(parsed, searchType),
            search_type: searchType,
            total_matches: 0,
            exact_total_matches: 0,
            result_count: 0,
            listings: [],
            results: [],
            see_all_url: buildAssistantSeeAllUrl(parsed, searchType),
            search_path: publicPath,
            zero_results: true,
            capture_available: true,
            capture_payload: capturePayload,
            match_quality: 'search_error',
            exact_match: false,
            search_error: searchError.message || 'property_search_failed',
            search_prewarm_marker: ASSISTANT_SEARCH_PREWARM_MARKER,
            search_prewarm_broad_marker: ASSISTANT_SEARCH_PREWARM_BROAD_MARKER
          };
          response = assistantFastResponse(
            assistantLeadText({ total: 0, parsed, searchType, language }),
            language,
            extracted?.model || 'heuristic-fast'
          );
        }
      }
    }

    if (!response) {
      response = assistantFastResponse('', language);
    }

    const responseBody = {
      ok: true,
      data: {
        ...response,
        ...(searchPayload || {}),
        intent: normalizeAssistantIntent(effectiveIntent),
        requested_intent: normalizeAssistantIntent(requestedIntent),
        conversation_logged: true
      }
    };

    const tracePromise = recordAssistantBackendTrace(req, { userMessage, intent: effectiveIntent, language, response });
    if (assistantIsSearch) {
      tracePromise.catch(logAssistantTraceFailure);
      return res.json(responseBody);
    }

    await tracePromise;
    return res.json(responseBody);
  } catch (error) {
    return next(error);
  }
});

router.post('/feedback', requireAdminApiKey, async (req, res, next) => {
  try {
    const body = req.body || {};

    const feedback = await recordAiFeedback({
      eventId: cleanText(body.event_id) || null,
      rating: body.rating,
      label: cleanText(body.label),
      notes: cleanText(body.notes, 1000),
      actorId: cleanText(body.actor_id) || 'admin_api_key'
    });

    return res.status(201).json({ ok: true, data: feedback });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
