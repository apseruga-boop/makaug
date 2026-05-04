const logger = require('../config/logger');
const db = require('../config/database');
const { DISTRICTS } = require('../utils/constants');
const {
  getProviderClient,
  getProviderName,
  getTaskModel,
  isLlmEnabled,
  getProviderMeta,
  toProviderFile
} = require('./llmProvider');
const {
  SUPPORTED_AI_LANGUAGES,
  normalizeLanguageCode,
  toCanonicalLanguageCode,
  languageDisplayName,
  languageGuardrail,
  shouldUseEnglishFallback
} = require('../config/languageRegistry');

const INTENTS = [
  'property_search',
  'property_listing',
  'agent_search',
  'agent_registration',
  'mortgage_help',
  'account_help',
  'saved_properties',
  'support',
  'report_listing',
  'looking_for_property_lead',
  'unknown'
];

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://makaug.com').replace(/\/+$/, '');

function getClient() {
  return getProviderClient();
}

function normalizeIntent(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (INTENTS.includes(raw)) return raw;
  return 'unknown';
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanText(value, max = 1200) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyLlmError(error) {
  const msg = String(error?.message || '').toLowerCase();
  if (!msg) return 'unknown';
  if (msg.includes('context') && msg.includes('long')) return 'context_too_long';
  if (msg.includes('rate limit') || msg.includes('429')) return 'rate_limit';
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('internal server error')) {
    return 'server_error';
  }
  if (
    msg.includes('response_format')
    || msg.includes('json_object')
    || (msg.includes('json') && msg.includes('schema'))
    || (msg.includes('unsupported') && msg.includes('format'))
  ) {
    return 'json_format_unsupported';
  }
  return 'unknown';
}

function stripCodeFence(text) {
  const raw = String(text || '').trim();
  const block = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return block && block[1] ? block[1].trim() : raw;
}

function extractBalancedJsonSnippet(text) {
  const raw = String(text || '');
  if (!raw) return null;

  const opener = raw.search(/[\{\[]/);
  if (opener < 0) return null;

  const stack = [];
  let inString = false;
  let escaped = false;
  const startChar = raw[opener];
  const expectedClose = startChar === '{' ? '}' : ']';

  for (let i = opener; i < raw.length; i += 1) {
    const ch = raw[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{' || ch === '[') {
      stack.push(ch);
      continue;
    }

    if (ch === '}' || ch === ']') {
      const open = stack.pop();
      if (!open) return null;
      const validPair = (open === '{' && ch === '}') || (open === '[' && ch === ']');
      if (!validPair) return null;
      if (!stack.length) {
        const snippet = raw.slice(opener, i + 1).trim();
        if (!snippet.endsWith(expectedClose)) return null;
        return snippet;
      }
    }
  }

  return null;
}

function safeJsonParse(text, fallback = {}) {
  if (text && typeof text === 'object') return text;

  const raw = String(text || '').trim();
  if (!raw) return fallback;

  const candidates = [
    raw,
    stripCodeFence(raw),
    extractBalancedJsonSnippet(raw)
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (_error) {
      // Try next candidate
    }
  }

  return fallback;
}

async function createChatCompletionResilient(client, payload, { preferJson = false } = {}) {
  const basePayload = { ...payload };
  const requestVariants = [];

  if (preferJson) {
    requestVariants.push({
      ...basePayload,
      response_format: { type: 'json_object' }
    });
  }
  requestVariants.push(basePayload);

  const providerMeta = getProviderMeta();
  const provider = providerMeta?.provider || getProviderName() || 'none';

  let lastError = null;
  for (let v = 0; v < requestVariants.length; v += 1) {
    const req = requestVariants[v];
    let retries = 0;

    while (retries <= 2) {
      try {
        return await client.chat.completions.create(req);
      } catch (error) {
        lastError = error;
        const kind = classifyLlmError(error);
        const hasFallbackVariant = requestVariants.length > 1 && v < requestVariants.length - 1;

        if (kind === 'json_format_unsupported' && hasFallbackVariant) {
          break;
        }

        if ((kind === 'rate_limit' || kind === 'server_error') && retries < 2) {
          await sleep(250 * (2 ** retries));
          retries += 1;
          continue;
        }

        if (kind === 'unknown' && hasFallbackVariant && provider !== 'openai') {
          break;
        }

        throw error;
      }
    }
  }

  throw lastError || new Error('LLM completion failed');
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return [value];
}

function listingTypeLabel(type) {
  const key = String(type || '').trim().toLowerCase();
  if (key === 'sale') return 'For Sale';
  if (key === 'rent') return 'To Rent';
  if (key === 'student' || key === 'students') return 'Students';
  if (key === 'commercial') return 'Commercial';
  if (key === 'land') return 'Land';
  return 'Property';
}

function formatUGX(value) {
  const amount = safeNumber(value, 0);
  if (!amount) return 'UGX (price on request)';
  try {
    return `UGX ${amount.toLocaleString('en-UG')}`;
  } catch (_error) {
    return `UGX ${amount}`;
  }
}

function buildIntentLink(intent) {
  const key = normalizeIntent(intent);
  if (key === 'property_search' || key === 'looking_for_property_lead') return `${PUBLIC_BASE_URL}/#page-sale`;
  if (key === 'property_listing') return `${PUBLIC_BASE_URL}/#page-list-property`;
  if (key === 'agent_search') return `${PUBLIC_BASE_URL}/#page-brokers`;
  if (key === 'agent_registration') return `${PUBLIC_BASE_URL}/#page-brokers`;
  if (key === 'mortgage_help') return `${PUBLIC_BASE_URL}/#page-mortgage`;
  if (key === 'account_help' || key === 'saved_properties') return `${PUBLIC_BASE_URL}/#page-account`;
  if (key === 'report_listing') return `${PUBLIC_BASE_URL}/#page-report`;
  return PUBLIC_BASE_URL;
}

function buildLocalizedAssistantFallbackText(languageCode, link) {
  const code = normalizeLanguageCode(languageCode);
  const displayName = languageDisplayName(code);
  const copy = {
    en: [
      'I can help with property search, listing, agent support, mortgage guidance, and account help.',
      `Open: ${link}`,
      'If you need human support, call 0760112587 or email info@makaug.com.'
    ],
    lg: [
      'Nsobola okukuyamba okunoonya property, okulistinga, okunoonya agent, mortgage, ne account.',
      `Ggulawo: ${link}`,
      'Bwoba weetaaga omuntu akuyambe, kuba 0760112587 oba email info@makaug.com.'
    ],
    sw: [
      'Naweza kusaidia kutafuta mali, kuorodhesha mali, kupata agent, mortgage, na akaunti.',
      `Fungua: ${link}`,
      'Ukitaka msaada wa mtu, piga 0760112587 au tuma email info@makaug.com.'
    ],
    ac: [
      'Aromo konyi me yeny property, keto property, nongo agent, mortgage, ki account.',
      `Yab: ${link}`,
      'Ka imito kony pa dano, lwong 0760112587 onyo email info@makaug.com.'
    ],
    ny: [
      'Nimbaasa kukuyamba kushaka property, kuhandiika property, kushaka agent, mortgage, na account.',
      `Guraho: ${link}`,
      'Ku oraabe nooyenda omuntu akuyambe, teera 0760112587 nari email info@makaug.com.'
    ],
    rn: [
      `${displayName} translation is not fully available yet, so I will use English rather than guessing another language.`,
      'I can help with property search, listing, agent support, mortgage guidance, and account help.',
      `Open: ${link}`,
      'If you need human support, call 0760112587 or email info@makaug.com.'
    ],
    sm: [
      'Nsobola okukuyamba okunoonya property, okulistinga, okunoonya agent, mortgage, ne account.',
      `Ggulawo: ${link}`,
      'Bwoba weetaaga omuntu akuyambe, kuba 0760112587 oba email info@makaug.com.'
    ]
  };
  return (copy[code] || copy.en).join(' ');
}

function looksLikeWrongNearbyLanguage(languageCode, text) {
  const canonical = toCanonicalLanguageCode(languageCode);
  if (!['rkg', 'rnynk'].includes(canonical)) return false;
  const sample = cleanText(text, 1500).toLowerCase();
  if (!sample) return false;
  return /\b(gushaka|gufasha|umutungo|urubuga|amafoto|ndabona|kwandikisha|mushobora|mukeneye|hamagara|mumbwire|subiza|nimero)\b/.test(sample);
}

async function logAiModelEvent({
  eventType,
  source = 'api',
  inputPayload = {},
  outputPayload = {},
  modelName = null,
  language = null,
  qualityScore = null,
  errorMessage = null,
  actorId = null
}) {
  try {
    const event = await db.query(
      `INSERT INTO ai_model_events (
        event_type,
        source,
        input_payload,
        output_payload,
        model_name,
        language,
        quality_score,
        error_message,
        actor_id
      ) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8,$9)
      RETURNING id, created_at`,
      [
        cleanText(eventType, 120),
        cleanText(source, 120),
        JSON.stringify(inputPayload || {}),
        JSON.stringify(outputPayload || {}),
        modelName || null,
        language || null,
        qualityScore != null ? safeNumber(qualityScore, null) : null,
        errorMessage ? cleanText(errorMessage, 500) : null,
        actorId || null
      ]
    );
    return event.rows[0] || null;
  } catch (_error) {
    return null;
  }
}

function heuristicIntent(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return { intent: 'unknown', confidence: 0.1, entities: {} };

  if (/(register agent|agent registration|sign up as (?:an )?agent|become (?:an )?agent|join as (?:an )?agent|area licence|license|lisensi|licence)/.test(t)) {
    return { intent: 'agent_registration', confidence: 0.68, entities: {} };
  }
  if (/(agent|broker|find agent|realtor|wakala|musomesa)/.test(t)) {
    return { intent: 'agent_search', confidence: 0.65, entities: {} };
  }
  if (/(help|support|human|call me|contact)/.test(t)) {
    return { intent: 'support', confidence: 0.64, entities: {} };
  }
  if (/(list|advertise|post|submit|upload|my property|teeka|kwandika|orodhesha|listing)/.test(t)) {
    return { intent: 'property_listing', confidence: 0.67, entities: {} };
  }
  if (/(find|search|looking|rent|buy|sale|house|apartment|property|student|accommodation|hostel|near me|area|nyumba|shamba|kiwanja|ardhi|plot|ttaka|enju|ot|ot me)/.test(t)) {
    return { intent: 'property_search', confidence: 0.62, entities: {} };
  }
  if (/(mortgage|loan|deposit|repayment|interest|home loan)/.test(t)) {
    return { intent: 'mortgage_help', confidence: 0.66, entities: {} };
  }
  if (/(account|sign in|login|saved|password|profile|otp)/.test(t)) {
    return { intent: 'account_help', confidence: 0.61, entities: {} };
  }
  if (/(report|fraud|scam|suspicious|fake)/.test(t)) {
    return { intent: 'report_listing', confidence: 0.7, entities: {} };
  }
  return { intent: 'unknown', confidence: 0.2, entities: {} };
}

function shouldUseFastIntentPath({ text = '', step = '', fallback = {} } = {}) {
  const clean = cleanText(text, 700);
  const currentStep = String(step || '').trim().toLowerCase();
  const fallbackIntent = normalizeIntent(fallback.intent);
  const confidence = safeNumber(fallback.confidence, 0);

  if (!clean) return true;

  // Borrowed from the Claw runtime idea of keeping the hot message loop lean:
  // deterministic flow steps should not wait on a model unless the message is
  // clearly trying to change task.
  const flowOwnedSteps = new Set([
    'listing_type',
    'ownership',
    'title',
    'district',
    'area',
    'price',
    'bedrooms',
    'description',
    'photos',
    'ask_deposit',
    'ask_contract',
    'ask_university',
    'ask_distance',
    'ask_public_name',
    'ask_contact_method',
    'ask_contact_value',
    'ask_id_number',
    'ask_selfie',
    'ask_phone',
    'verify_otp'
  ]);

  if (flowOwnedSteps.has(currentStep) && fallbackIntent === 'unknown') return true;
  if (flowOwnedSteps.has(currentStep) && confidence < 0.7) return true;

  if (['greeting', 'main_menu', 'search_type', 'search_area', 'agent_area'].includes(currentStep)) {
    return confidence >= 0.64 && fallbackIntent !== 'unknown';
  }

  return false;
}

const QUERY_SEARCH_TYPE_RULES = [
  { type: 'land', re: /\b(land|plot|plots|acre|acres|farm|shamba|kiwanja|ardhi|ttaka)\b/i },
  { type: 'student', re: /\b(student|students|hostel|dorm|campus|university)\b/i },
  { type: 'commercial', re: /\b(commercial|office|retail|warehouse|shop|business)\b/i },
  { type: 'rent', re: /\b(rent|rental|to rent|lease|monthly|per month|\/month)\b/i },
  { type: 'sale', re: /\b(buy|buying|sale|for sale|purchase|own)\b/i }
];

const QUERY_PROPERTY_TYPE_RULES = [
  { value: 'house', re: /\b(house|home|nyumba|enju)\b/i },
  { value: 'villa', re: /\b(villa)\b/i },
  { value: 'apartment', re: /\b(apartment|flat)\b/i },
  { value: 'townhouse', re: /\b(townhouse)\b/i },
  { value: 'bungalow', re: /\b(bungalow)\b/i },
  { value: 'studio', re: /\b(studio)\b/i },
  { value: 'hostel', re: /\b(hostel|dorm|dormitory)\b/i },
  { value: 'office', re: /\b(office)\b/i },
  { value: 'warehouse', re: /\b(warehouse)\b/i },
  { value: 'retail shop', re: /\b(retail|shop|storefront)\b/i },
  { value: 'land', re: /\b(shamba|kiwanja|ardhi|ttaka)\b/i }
];

const QUERY_WORD_NUMBERS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10
};

const QUERY_NEAR_ME_RULES = [
  /\bnear\s+me\b/i,
  /\baround\s+me\b/i,
  /\bnearby\b/i,
  /\bmy\s+location\b/i,
  /\bclose\s+to\s+me\b/i,
  /\bwithin\s+\d+(?:\.\d+)?\s*(?:km|kms|kilomet(?:er|re)s?|mi|mile|miles)\b/i
];

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function normalizeSearchType(value, fallback = 'any') {
  const raw = String(value || '').trim().toLowerCase();
  if (['sale', 'rent', 'student', 'commercial', 'land', 'any'].includes(raw)) return raw;
  return fallback;
}

function normalizeBudgetPeriod(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (['month', 'week', 'year', 'semester'].includes(raw)) return raw;
  return null;
}

function normalizeBool(value) {
  if (typeof value === 'boolean') return value;
  const raw = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(raw)) return true;
  if (['0', 'false', 'no', 'n'].includes(raw)) return false;
  return false;
}

function parseAmountWithSuffix(rawNumber, suffix) {
  let amount = Number(String(rawNumber || '').replace(/[, ]+/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const tail = String(suffix || '').toLowerCase();
  if (tail === 'k') amount *= 1_000;
  if (tail === 'm') amount *= 1_000_000;
  if (tail === 'b') amount *= 1_000_000_000;
  return amount;
}

function parseBedsHeuristic(text) {
  const clean = cleanText(text, 500).toLowerCase();
  let m = clean.match(/\b(\d+)\s*[- ]?(?:bed|beds|bedroom|bedrooms|br)\b/i);
  if (m) return Number(m[1]);
  m = clean.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s*[- ]?(?:bed|beds|bedroom|bedrooms|br)\b/i);
  if (m) return QUERY_WORD_NUMBERS[m[1]] || 0;
  m = clean.match(/\b(?:bed|beds|bedroom|bedrooms)\s*(\d+)\b/i);
  if (m) return Number(m[1]);
  return 0;
}

function parseSearchTypeHeuristic(text, fallback = 'any') {
  const clean = cleanText(text, 600);
  for (const rule of QUERY_SEARCH_TYPE_RULES) {
    if (rule.re.test(clean)) return rule.type;
  }
  return normalizeSearchType(fallback, 'any');
}

function parsePropertyTypeHeuristic(text) {
  const clean = cleanText(text, 600);
  for (const rule of QUERY_PROPERTY_TYPE_RULES) {
    if (rule.re.test(clean)) return rule.value;
  }
  return null;
}

function parseAreaHeuristic(text) {
  const clean = cleanText(text, 700);
  if (!clean) return null;
  const lower = clean.toLowerCase();

  const districtHit = DISTRICTS.find((d) => lower.includes(String(d || '').toLowerCase()));
  if (districtHit) return districtHit;

  const areaRe = /\b(?:in|at|around|near|within|from)\s+([a-z][a-z\s'-]{2,})/i;
  const m = lower.match(areaRe);
  if (!m || !m[1]) return null;

  const candidate = m[1]
    .split(/\b(for|under|max|with|within|around|budget|monthly|per|a month|near me|my location|phone|call|rent|sale|buy)\b/i)[0]
    .replace(/[^a-z\s'-]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!candidate || candidate === 'uganda') return null;

  return candidate
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function parseBudgetHeuristic(text) {
  const raw = cleanText(text, 1200);
  if (!raw) return { maxBudgetUgx: 0, budgetPeriod: null, convertedFromUsd: false };

  const lower = raw.toLowerCase().replace(/us dollars?/g, 'usd');
  const rx = /(?:(usd|\$|ugx|ush|shs)\s*)?(\d[\d,\s]*(?:\.\d+)?)\s*([kmb])?\s*(usd|ugx|ush|shs)?/gi;
  const candidates = [];

  let m;
  while ((m = rx.exec(lower)) !== null) {
    const curA = (m[1] || '').toLowerCase();
    const curB = (m[4] || '').toLowerCase();
    const amount = parseAmountWithSuffix(m[2], m[3]);
    if (!amount) continue;

    const currency = curA || curB || (m[0].includes('$') ? 'usd' : 'ugx');
    const start = Math.max(0, (m.index || 0) - 28);
    const end = Math.min(lower.length, (m.index || 0) + m[0].length + 28);
    const context = lower.slice(start, end);
    const before = lower.slice(Math.max(0, (m.index || 0) - 24), m.index || 0);

    let score = 0;
    if (/\b(for|under|max(?:imum)?|budget(?:\s+of)?|up to|around|about|at)\b/i.test(before)) score += 4;
    if (/\b(per\s*month|a month|monthly|\/month|pm|per\s*week|weekly|\/week|per\s*year|yearly|annually|\/year|semester|\/sem)\b/i.test(context)) score += 2;
    if (curA || curB || m[0].includes('$')) score += 2;
    if (m[3]) score += 1;
    if (amount >= 100_000) score += 1;
    if (amount < 10_000 && !(curA || curB || m[0].includes('$'))) score -= 3;
    if (/\b(bed|beds|bedroom|bedrooms|bath|bathroom|toilet|room)\b/i.test(context)) score -= 6;
    if (/\b(acre|acres|sq\s?m|sqm|sqft|hectare|plot|plots)\b/i.test(context)) score -= 3;

    candidates.push({ amount, currency, score });
  }

  if (!candidates.length) return { maxBudgetUgx: 0, budgetPeriod: null, convertedFromUsd: false };
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (best.score < -1) return { maxBudgetUgx: 0, budgetPeriod: null, convertedFromUsd: false };

  const rate = Number(process.env.USD_TO_UGX_RATE || 3800);
  const maxBudgetUgx = best.currency === 'usd' || best.currency === '$'
    ? Math.round(best.amount * (Number.isFinite(rate) && rate > 0 ? rate : 3800))
    : Math.round(best.amount);

  let budgetPeriod = null;
  if (/\b(per\s*month|a month|monthly|\/month|pm)\b/i.test(lower)) budgetPeriod = 'month';
  else if (/\b(per\s*week|weekly|\/week)\b/i.test(lower)) budgetPeriod = 'week';
  else if (/\b(per\s*year|yearly|annually|\/year)\b/i.test(lower)) budgetPeriod = 'year';
  else if (/\b(semester|\/sem|per\s*semester)\b/i.test(lower)) budgetPeriod = 'semester';

  return {
    maxBudgetUgx,
    budgetPeriod,
    convertedFromUsd: best.currency === 'usd' || best.currency === '$'
  };
}

function isNearMeHeuristic(text) {
  const clean = cleanText(text, 600);
  if (!clean) return false;
  return QUERY_NEAR_ME_RULES.some((rule) => rule.test(clean));
}

function normalizeNaturalQueryPayload(payload = {}, fallbackType = 'any') {
  const searchType = normalizeSearchType(payload.searchType || payload.search_type, fallbackType);
  const areaRaw = cleanText(payload.area || payload.location || payload.area_name || payload.district || '', 120);
  const districtRaw = cleanText(payload.district || '', 120);
  const area = areaRaw || null;
  const district = districtRaw || null;
  const bedsMin = Math.max(0, parseInt(payload.bedsMin ?? payload.bedrooms ?? payload.beds ?? 0, 10) || 0);
  const propertyType = cleanText(payload.propertyType || payload.property_type || '', 60) || null;
  const maxBudgetUgx = Math.max(0, Math.round(Number(payload.maxBudgetUgx ?? payload.budget ?? payload.budget_max ?? 0) || 0));
  const budgetPeriod = normalizeBudgetPeriod(payload.budgetPeriod || payload.period);
  const useSharedLocation = normalizeBool(payload.useSharedLocation ?? payload.use_shared_location ?? payload.near_me);
  const confidence = clamp(payload.confidence ?? 0.72, 0, 1);

  const hasSignal = Boolean(
    area
    || district
    || bedsMin > 0
    || propertyType
    || maxBudgetUgx > 0
    || useSharedLocation
    || (searchType && searchType !== 'any')
  );

  return {
    hasSignal,
    searchType,
    area,
    district,
    bedsMin,
    propertyType,
    maxBudgetUgx,
    budgetPeriod,
    useSharedLocation,
    convertedFromUsd: Boolean(payload.convertedFromUsd || payload.converted_from_usd),
    confidence,
    raw: payload
  };
}

function mergeNaturalQueryPayloads(primary = {}, secondary = {}, fallbackType = 'any') {
  const p = primary && typeof primary === 'object' ? primary : {};
  const s = secondary && typeof secondary === 'object' ? secondary : {};

  const merged = normalizeNaturalQueryPayload(
    {
      searchType: (p.searchType && p.searchType !== 'any') ? p.searchType : (s.searchType || fallbackType),
      area: p.area || s.area || '',
      district: p.district || s.district || '',
      bedsMin: Number(p.bedsMin || 0) > 0 ? p.bedsMin : (s.bedsMin || 0),
      propertyType: p.propertyType || s.propertyType || '',
      maxBudgetUgx: Number(p.maxBudgetUgx || 0) > 0 ? p.maxBudgetUgx : (s.maxBudgetUgx || 0),
      budgetPeriod: p.budgetPeriod || s.budgetPeriod || null,
      convertedFromUsd: Boolean(p.convertedFromUsd || s.convertedFromUsd),
      useSharedLocation: Boolean(p.useSharedLocation || s.useSharedLocation),
      confidence: clamp(Math.max(Number(p.confidence || 0), Number(s.confidence || 0)), 0, 1)
    },
    fallbackType
  );

  merged.raw = {
    primary: p.raw || p,
    fallback: s.raw || s
  };

  return merged;
}

function heuristicNaturalPropertyQuery({ text = '', fallbackType = 'any' } = {}) {
  const clean = cleanText(text, 1200);
  const budget = parseBudgetHeuristic(clean);
  return normalizeNaturalQueryPayload(
    {
      searchType: parseSearchTypeHeuristic(clean, fallbackType),
      area: parseAreaHeuristic(clean),
      bedsMin: parseBedsHeuristic(clean),
      propertyType: parsePropertyTypeHeuristic(clean),
      maxBudgetUgx: budget.maxBudgetUgx,
      budgetPeriod: budget.budgetPeriod,
      convertedFromUsd: budget.convertedFromUsd,
      useSharedLocation: isNearMeHeuristic(clean),
      confidence: 0.65
    },
    fallbackType
  );
}

async function detectWhatsappLanguage({ text = '', sessionLanguage = 'en', step = '' } = {}) {
  const clean = cleanText(text, 1200);
  const fallback = {
    language: normalizeLanguageCode(sessionLanguage),
    confidence: 0.5,
    explicitSwitch: false,
    reason: 'session_fallback',
    model: 'heuristic'
  };

  if (!clean) return fallback;

  const client = getClient();
  if (!client) return fallback;

  const model = getTaskModel('language', process.env.OPENAI_LANGUAGE_MODEL || process.env.OPENAI_INTENT_MODEL || 'gpt-4.1-mini');

  try {
    const completion = await createChatCompletionResilient(client, {
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `You detect the user's language for MakaUg WhatsApp.
Supported languages: ${JSON.stringify(SUPPORTED_AI_LANGUAGES)}.
Return strict JSON only:
{
  "language": "en|lg|sw|ac|ny|rn|sm",
  "confidence": number 0..1,
  "explicitSwitch": boolean,
  "reason": "short explanation"
}
Rules:
- Detect the language the user is actually using, not the country, district, or property location.
- If the user says "respond in English/Luganda/Kiswahili/etc", set explicitSwitch true and use that requested language.
- If text mixes languages, choose the language of the user's request.
- Never treat a language name as a property search area.
- Rukiga and Runyankole are Ugandan languages. Do not map them to Kinyarwanda.
- Do not use Kinyarwanda as a fallback language; use English fallback if uncertain.
- If uncertain, keep the current session language with lower confidence.`
        },
        {
          role: 'user',
          content: JSON.stringify({
            text: clean,
            currentSessionLanguage: normalizeLanguageCode(sessionLanguage),
            step
          })
        }
      ]
    }, { preferJson: true });

    const raw = completion?.choices?.[0]?.message?.content || '{}';
    const parsed = safeJsonParse(raw, {});
    const language = normalizeLanguageCode(parsed.language || fallback.language);
    const confidence = clamp(parsed.confidence || 0, 0, 1) || fallback.confidence;
    const output = {
      language,
      confidence,
      explicitSwitch: Boolean(parsed.explicitSwitch),
      reason: cleanText(parsed.reason || 'ai_detected', 300),
      model
    };

    await logAiModelEvent({
      eventType: 'language_detection',
      source: 'whatsapp',
      inputPayload: { text: clean, sessionLanguage: normalizeLanguageCode(sessionLanguage), step },
      outputPayload: output,
      modelName: model,
      language,
      qualityScore: output.confidence
    });

    return output;
  } catch (error) {
    logger.warn('AI language detection failed, using session language.', error.message);
    await logAiModelEvent({
      eventType: 'language_detection_error',
      source: 'whatsapp',
      inputPayload: { text: clean, sessionLanguage: normalizeLanguageCode(sessionLanguage), step },
      outputPayload: fallback,
      modelName: model,
      language: fallback.language,
      qualityScore: fallback.confidence,
      errorMessage: error.message
    });
    return fallback;
  }
}

async function extractNaturalPropertyQuery({ text = '', language = 'en', sessionData = {}, fallbackType = 'any' } = {}) {
  const fallback = heuristicNaturalPropertyQuery({ text, fallbackType });
  const client = getClient();
  const languageCode = normalizeLanguageCode(language);
  if (!client) {
    return {
      ...fallback,
      model: 'heuristic'
    };
  }

  const model = getTaskModel(
    'extract',
    process.env.OPENAI_EXTRACT_MODEL || process.env.OPENAI_INTENT_MODEL || 'gpt-4.1-mini'
  );

  try {
    const completion = await createChatCompletionResilient(client, {
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `Extract structured real-estate search filters for MakaUg WhatsApp assistant.
Return strict JSON only:
{
  "searchType": "sale|rent|student|commercial|land|any",
  "area": "string or empty",
  "district": "string or empty",
  "bedsMin": number,
  "propertyType": "string or empty",
  "maxBudgetUgx": number,
  "budgetPeriod": "month|week|year|semester|null",
  "convertedFromUsd": boolean,
  "useSharedLocation": boolean,
  "confidence": number 0..1
}
Rules:
- Detect natural queries like "2 bed in Muyenga under $20k per month".
- Detect Uganda language queries such as "Natafuta shamba Mbale", "Noonya enju eya rent e Kampala", and "Funa agent e Wakiso".
- Convert USD to UGX using rate 1 USD = ${process.env.USD_TO_UGX_RATE || 3800}.
- Treat Kampala, Wakiso, Mukono, Mbale, Jinja, Mbarara, Gulu, etc. as places, never as property types.
- Treat English/Luganda/Kiswahili/Acholi/Runyankole/Rukiga/Lusoga as languages, never as search areas.
- Never invent impossible numbers.
- If uncertain, set low confidence and leave field empty rather than hallucinating.`
        },
        {
          role: 'user',
          content: JSON.stringify({
            text: cleanText(text, 1200),
            language: languageCode,
            sessionData,
            fallbackType: normalizeSearchType(fallbackType, 'any')
          })
        }
      ]
    }, { preferJson: true });

    const raw = completion?.choices?.[0]?.message?.content || '{}';
    const parsed = safeJsonParse(raw, {});
    const normalized = mergeNaturalQueryPayloads(
      normalizeNaturalQueryPayload(parsed, fallbackType),
      fallback,
      fallbackType
    );

    await logAiModelEvent({
      eventType: 'natural_query_extraction',
      source: 'whatsapp',
      inputPayload: { text: cleanText(text, 1200), language: languageCode, fallbackType },
      outputPayload: normalized,
      modelName: model,
      language: languageCode,
      qualityScore: normalized.confidence
    });

    return {
      ...normalized,
      model
    };
  } catch (error) {
    logger.warn('Natural query extraction failed, using heuristics.', error.message);
    await logAiModelEvent({
      eventType: 'natural_query_extraction_error',
      source: 'whatsapp',
      inputPayload: { text: cleanText(text, 1200), language: languageCode, fallbackType },
      outputPayload: fallback,
      modelName: model,
      language: languageCode,
      qualityScore: fallback.confidence,
      errorMessage: error.message
    });
    return {
      ...fallback,
      model: 'heuristic_fallback'
    };
  }
}

async function classifyWhatsappIntent({ text, language = 'en', step = '', sessionData = {} }) {
  const fallback = heuristicIntent(text);
  if (shouldUseFastIntentPath({ text, step, fallback })) {
    return {
      ...fallback,
      model: 'heuristic_fast'
    };
  }

  const client = getClient();
  if (!client) {
    return {
      ...fallback,
      model: 'heuristic'
    };
  }

  let model = getTaskModel('intent', process.env.OPENAI_INTENT_MODEL || 'gpt-4.1-mini');

  try {
    const completion = await createChatCompletionResilient(client, {
      model,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: `You classify intents for MakaUg WhatsApp assistant for Uganda.
Return strict JSON only:
{
  "intent": one of ${JSON.stringify(INTENTS)},
  "confidence": number between 0 and 1,
  "entities": object with optional keys:
    - listing_type: sale | rent | student | commercial | land | any
    - area: string
    - district: string
    - budget: number
    - budget_max: number
    - period: month | week | year | semester
    - bedrooms: number
    - property_type: house | villa | apartment | townhouse | bungalow | studio | office | warehouse | retail shop | hostel
    - language: en | lg | sw | ac | ny | rn | sm
}
Rules:
- Property search includes natural requests in any supported language, e.g. "2 bed in Kampala", "Natafuta shamba Mbale", "Noonya enju eya rent".
- Agent search includes "find me an agent/broker" and equivalents in supported languages.
- Language change requests like "respond in Luganda" should set entities.language and intent unknown unless another action is also requested.
- Never treat language names as districts or areas.
- If the user is mid-flow, use step/sessionData to preserve the flow unless the new message clearly starts a different action.`
        },
        {
          role: 'user',
          content: JSON.stringify({
            language: normalizeLanguageCode(language),
            step,
            text,
            sessionData
          })
        }
      ]
    }, { preferJson: true });

    const raw = completion?.choices?.[0]?.message?.content || '{}';
    const parsed = safeJsonParse(raw, {});
    const aiIntent = normalizeIntent(parsed.intent);
    const aiConfidence = clamp(parsed.confidence || 0, 0, 1);
    const aiEntities = parsed.entities && typeof parsed.entities === 'object' ? parsed.entities : {};
    const fallbackIntent = normalizeIntent(fallback.intent);
    const fallbackConfidence = clamp(fallback.confidence || 0, 0, 1);

    const shouldUseFallbackIntent = aiIntent === 'unknown' || aiConfidence < 0.45;
    const intent = shouldUseFallbackIntent ? fallbackIntent : aiIntent;
    const confidence = shouldUseFallbackIntent
      ? Math.max(fallbackConfidence, aiConfidence)
      : aiConfidence;
    const entities = {
      ...(fallback.entities || {}),
      ...aiEntities
    };

    return {
      intent,
      confidence,
      entities,
      model
    };
  } catch (error) {
    logger.warn('AI intent classification failed, falling back to heuristics.', error.message);
    await logAiModelEvent({
      eventType: 'intent_classification_error',
      source: 'whatsapp',
      inputPayload: { language, step, text },
      outputPayload: { fallback },
      modelName: model,
      language: normalizeLanguageCode(language),
      errorMessage: error.message
    });
    return {
      ...fallback,
      model: 'heuristic_fallback'
    };
  }
}

function audioExtensionFromType(mediaType = '') {
  const type = String(mediaType || '').toLowerCase();
  if (type.includes('mpeg') || type.includes('mp3')) return 'mp3';
  if (type.includes('wav')) return 'wav';
  if (type.includes('webm')) return 'webm';
  if (type.includes('mp4') || type.includes('m4a')) return 'm4a';
  return 'ogg';
}

async function transcribeAudioBuffer(buffer, mediaType = 'audio/ogg', sourceMeta = {}) {
  if (!buffer?.length) return null;
  const client = getClient();
  if (!client) return null;

  let model = getTaskModel('transcribe', process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe');

  try {
    const ext = audioExtensionFromType(mediaType);
    const fileName = `voice-note.${ext}`;
    const file = await toProviderFile(buffer, fileName, { type: mediaType || 'audio/ogg' });

    const tx = await client.audio.transcriptions.create({
      model,
      file
    });

    const text = String(tx?.text || '').trim();
    if (!text) return null;

    const result = {
      text,
      language: String(tx?.language || '').trim().toLowerCase() || null,
      model
    };

    await logAiModelEvent({
      eventType: 'audio_transcription',
      source: 'whatsapp',
      inputPayload: { mediaType, ...sourceMeta },
      outputPayload: { text_length: text.length },
      modelName: model,
      language: result.language
    });

    return result;
  } catch (error) {
    logger.warn('Audio transcription failed:', error.message);
    await logAiModelEvent({
      eventType: 'audio_transcription_error',
      source: 'whatsapp',
      inputPayload: { mediaType, ...sourceMeta },
      outputPayload: {},
      modelName: model,
      errorMessage: error.message
    });
    return null;
  }
}

async function transcribeAudioFromDataUrl(dataUrl, mediaType = 'audio/ogg') {
  const raw = String(dataUrl || '');
  const match = raw.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,([a-z0-9+/=\s]+)$/i);
  if (!match) return null;

  const detectedType = match[1] || mediaType || 'audio/ogg';
  const base64 = match[2].replace(/\s+/g, '');
  const maxBytes = Math.max(256_000, Number(process.env.WHATSAPP_VOICE_MAX_BYTES || 8_000_000));
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes > maxBytes) {
    logger.warn(`WhatsApp audio transcription skipped: ${approxBytes} bytes exceeds limit ${maxBytes}.`);
    return null;
  }

  const buffer = Buffer.from(base64, 'base64');
  return transcribeAudioBuffer(buffer, detectedType, { source: 'web_bridge_data_url', bytes: buffer.length });
}

async function transcribeAudioFromUrl(mediaUrl, mediaType = 'audio/ogg') {
  if (!mediaUrl) return null;
  if (String(mediaUrl).startsWith('data:')) {
    return transcribeAudioFromDataUrl(mediaUrl, mediaType);
  }
  const client = getClient();
  if (!client) return null;

  try {
    const headers = {};
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      headers.Authorization = `Basic ${auth}`;
    } else if (process.env.WHATSAPP_ACCESS_TOKEN) {
      headers.Authorization = `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`;
    }

    const resp = await fetch(mediaUrl, { headers });
    if (!resp.ok) return null;

    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return transcribeAudioBuffer(buffer, mediaType, { source: 'media_url' });
  } catch (error) {
    logger.warn('Audio transcription failed:', error.message);
    await logAiModelEvent({
      eventType: 'audio_transcription_error',
      source: 'whatsapp',
      inputPayload: { mediaType },
      outputPayload: {},
      modelName: model,
      errorMessage: error.message
    });
    return null;
  }
}

function buildFallbackListingIntelligence({ listing = {}, targetLanguage = 'en', includeAllLanguages = false }) {
  const typeLabel = listingTypeLabel(listing.listing_type);
  const title = cleanText(listing.title, 180) || `${typeLabel} in ${cleanText(listing.area, 80) || cleanText(listing.district, 80) || 'Uganda'}`;
  const district = cleanText(listing.district, 80);
  const area = cleanText(listing.area, 80);
  const priceText = formatUGX(listing.price);
  const beds = safeNumber(listing.bedrooms, 0);
  const baths = safeNumber(listing.bathrooms, 0);
  const propertyType = cleanText(listing.property_type, 80) || typeLabel;
  const amenities = toArray(listing.amenities).map((x) => cleanText(x, 60)).filter(Boolean).slice(0, 8);

  const canonicalDescription = [
    `${title} is available in ${area || district || 'Uganda'} at ${priceText}.`,
    beds > 0 ? `It offers ${beds} bedroom${beds > 1 ? 's' : ''}` : '',
    baths > 0 ? `and ${baths} bathroom${baths > 1 ? 's' : ''}` : '',
    `with ${propertyType.toLowerCase()} features suited for Uganda property seekers.`,
    amenities.length ? `Highlights include ${amenities.join(', ')}.` : ''
  ].filter(Boolean).join(' ');

  const canonicalAreaHighlights = [
    `${area || district || 'This area'} has strong local access to transport, schools, clinics, and day-to-day services in Uganda.`,
    'Please verify utilities, road access, and exact travel times during viewing.'
  ].join(' ');

  const translations = {};
  const targetCodes = includeAllLanguages
    ? Object.keys(SUPPORTED_AI_LANGUAGES)
    : [normalizeLanguageCode(targetLanguage)];

  targetCodes.forEach((code) => {
    translations[code] = {
      title,
      description: canonicalDescription,
      area_highlights: canonicalAreaHighlights
    };
  });

  return {
    model: 'template',
    generated_at: new Date().toISOString(),
    target_language: normalizeLanguageCode(targetLanguage),
    canonical: {
      rewritten_description: canonicalDescription,
      area_highlights: canonicalAreaHighlights,
      seo_title: title,
      seo_keywords: [typeLabel, district, area, propertyType].filter(Boolean),
      tags: [typeLabel.toLowerCase(), propertyType.toLowerCase(), district.toLowerCase()].filter(Boolean),
      quality_notes: ['Template intelligence fallback used because LLM provider is not configured or model response failed.']
    },
    translations
  };
}

async function generateListingIntelligence({
  listing = {},
  targetLanguage = 'en',
  includeAllLanguages = false,
  source = 'api'
}) {
  const safeListing = {
    listing_type: cleanText(listing.listing_type, 40).toLowerCase(),
    title: cleanText(listing.title, 220),
    description: cleanText(listing.description, 4000),
    district: cleanText(listing.district, 80),
    area: cleanText(listing.area, 80),
    price: safeNumber(listing.price, 0),
    price_period: cleanText(listing.price_period, 40),
    bedrooms: safeNumber(listing.bedrooms, 0),
    bathrooms: safeNumber(listing.bathrooms, 0),
    property_type: cleanText(listing.property_type, 80),
    amenities: toArray(listing.amenities).map((x) => cleanText(x, 80)).filter(Boolean).slice(0, 20),
    nearest_university: cleanText(listing.nearest_university, 120),
    commercial_intent: cleanText(listing.commercial_intent, 80),
    land_size_value: listing.land_size_value,
    land_size_unit: cleanText(listing.land_size_unit, 30)
  };

  const normalizedTargetLanguage = normalizeLanguageCode(targetLanguage);
  const fallback = buildFallbackListingIntelligence({
    listing: safeListing,
    targetLanguage: normalizedTargetLanguage,
    includeAllLanguages
  });

  const client = getClient();
  if (!client) {
    await logAiModelEvent({
      eventType: 'listing_intelligence',
      source,
      inputPayload: { listing: safeListing, targetLanguage: normalizedTargetLanguage, includeAllLanguages },
      outputPayload: fallback,
      modelName: 'template',
      language: normalizedTargetLanguage,
      qualityScore: 0.5
    });
    return fallback;
  }

  const languageCodes = includeAllLanguages
    ? Object.keys(SUPPORTED_AI_LANGUAGES)
    : [normalizedTargetLanguage];

  const model = getTaskModel('listing', process.env.OPENAI_LISTING_MODEL || 'gpt-4.1-mini');

  try {
    const completion = await createChatCompletionResilient(client, {
      model,
      temperature: 0.35,
      messages: [
        {
          role: 'system',
          content: `You are MakaUg's elite Uganda property intelligence model.
You write premium, trustworthy, plain-language property content for Uganda and East Africa audiences.
Return strict JSON with this schema:
{
  "canonical": {
    "rewritten_description": "string",
    "area_highlights": "string",
    "seo_title": "string",
    "seo_keywords": ["string"],
    "tags": ["string"],
    "quality_notes": ["string"]
  },
  "translations": {
    "en": {"title":"string","description":"string","area_highlights":"string"},
    "lg": {"title":"string","description":"string","area_highlights":"string"},
    "sw": {"title":"string","description":"string","area_highlights":"string"},
    "ac": {"title":"string","description":"string","area_highlights":"string"},
    "ny": {"title":"string","description":"string","area_highlights":"string"},
    "rn": {"title":"string","description":"string","area_highlights":"string"},
    "sm": {"title":"string","description":"string","area_highlights":"string"}
  }
}
Rules:
- Keep claims factual and conservative.
- Do not invent exact distances unless provided.
- Keep rewritten_description between 80 and 220 words.
- Keep area_highlights between 35 and 90 words.
- Mention Uganda context naturally.
- Avoid legal risk language or guarantees.
- Use natural, non-robotic tone.
- Populate only requested languages: ${languageCodes.join(', ')}.`
        },
        {
          role: 'user',
          content: JSON.stringify({
            listing: safeListing,
            requested_languages: languageCodes,
            language_names: SUPPORTED_AI_LANGUAGES
          })
        }
      ]
    }, { preferJson: true });

    const raw = completion?.choices?.[0]?.message?.content || '{}';
    const parsed = safeJsonParse(raw, {});

    const canonical = parsed.canonical && typeof parsed.canonical === 'object'
      ? parsed.canonical
      : {};

    const rewrittenDescription = cleanText(
      canonical.rewritten_description || fallback.canonical.rewritten_description,
      5000
    );
    const areaHighlights = cleanText(
      canonical.area_highlights || fallback.canonical.area_highlights,
      3000
    );
    const seoTitle = cleanText(canonical.seo_title || fallback.canonical.seo_title, 220);
    const seoKeywords = toArray(canonical.seo_keywords)
      .map((x) => cleanText(x, 64))
      .filter(Boolean)
      .slice(0, 15);
    const tags = toArray(canonical.tags)
      .map((x) => cleanText(x, 40).toLowerCase())
      .filter(Boolean)
      .slice(0, 20);
    const qualityNotes = toArray(canonical.quality_notes)
      .map((x) => cleanText(x, 300))
      .filter(Boolean)
      .slice(0, 10);

    const translationsRaw = parsed.translations && typeof parsed.translations === 'object'
      ? parsed.translations
      : {};

    const translations = {};
    languageCodes.forEach((code) => {
      const tNode = translationsRaw[code] && typeof translationsRaw[code] === 'object'
        ? translationsRaw[code]
        : {};

      translations[code] = {
        title: cleanText(tNode.title || safeListing.title || fallback.translations[code]?.title || fallback.canonical.seo_title, 220),
        description: cleanText(tNode.description || rewrittenDescription, 5000),
        area_highlights: cleanText(tNode.area_highlights || areaHighlights, 3000)
      };
    });

    const result = {
      model,
      generated_at: new Date().toISOString(),
      target_language: normalizedTargetLanguage,
      canonical: {
        rewritten_description: rewrittenDescription,
        area_highlights: areaHighlights,
        seo_title: seoTitle,
        seo_keywords: seoKeywords.length ? seoKeywords : fallback.canonical.seo_keywords,
        tags: tags.length ? tags : fallback.canonical.tags,
        quality_notes: qualityNotes.length ? qualityNotes : []
      },
      translations
    };

    const event = await logAiModelEvent({
      eventType: 'listing_intelligence',
      source,
      inputPayload: { listing: safeListing, targetLanguage: normalizedTargetLanguage, includeAllLanguages },
      outputPayload: result,
      modelName: model,
      language: normalizedTargetLanguage,
      qualityScore: 0.85
    });

    if (event?.id) {
      result.event_id = event.id;
    }

    return result;
  } catch (error) {
    logger.warn('Listing intelligence generation failed:', error.message);
    const event = await logAiModelEvent({
      eventType: 'listing_intelligence_error',
      source,
      inputPayload: { listing: safeListing, targetLanguage: normalizedTargetLanguage, includeAllLanguages },
      outputPayload: fallback,
      modelName: model,
      language: normalizedTargetLanguage,
      qualityScore: 0.45,
      errorMessage: error.message
    });
    if (event?.id) {
      fallback.event_id = event.id;
    }
    return fallback;
  }
}

async function suggestWhatsappAssistantReply({
  userMessage = '',
  intent = 'unknown',
  language = 'en',
  context = {},
  source = 'whatsapp'
}) {
  const link = buildIntentLink(intent);
  const languageCode = normalizeLanguageCode(language);
  const fallbackText = buildLocalizedAssistantFallbackText(languageCode, link);
  const guardrail = languageGuardrail(languageCode);

  const client = getClient();
  if (!client || shouldUseEnglishFallback(languageCode)) {
    await logAiModelEvent({
      eventType: 'assistant_reply',
      source,
      inputPayload: { userMessage, intent, language: languageCode, context },
      outputPayload: {
        text: fallbackText,
        fallbackUsed: shouldUseEnglishFallback(languageCode),
        fallbackReason: shouldUseEnglishFallback(languageCode) ? 'language_translation_not_reviewed' : 'template_provider_missing'
      },
      modelName: 'template',
      language: languageCode,
      qualityScore: 0.5
    });
    return {
      text: fallbackText,
      model: 'template',
      language: languageCode,
      requestedLanguage: languageCode,
      responseLanguage: shouldUseEnglishFallback(languageCode) ? 'en' : languageCode,
      fallbackUsed: shouldUseEnglishFallback(languageCode),
      fallbackReason: shouldUseEnglishFallback(languageCode) ? 'language_translation_not_reviewed' : 'template_provider_missing'
    };
  }

  const model = getTaskModel('reply', process.env.OPENAI_REPLY_MODEL || 'gpt-4.1-mini');

  try {
    const completion = await createChatCompletionResilient(client, {
      model,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content: `You are MakaUg WhatsApp property assistant for Uganda.
Produce a short typed reply in ${SUPPORTED_AI_LANGUAGES[languageCode]}.
Language guardrail: ${guardrail}
Requirements:
- Keep under 550 characters.
- Be practical and action-oriented.
- Include exactly one relevant MakaUg link.
- Do not include markdown tables.
Return strict JSON: {"text":"..."}`
        },
        {
          role: 'user',
          content: JSON.stringify({
            message: cleanText(userMessage, 1200),
            intent: normalizeIntent(intent),
            context,
            link
          })
        }
      ]
    }, { preferJson: true });

    const raw = completion?.choices?.[0]?.message?.content || '{}';
    const parsed = safeJsonParse(raw, {});
    const generatedText = cleanText(parsed.text || fallbackText, 1500);
    const fallbackUsed = looksLikeWrongNearbyLanguage(languageCode, generatedText);
    const text = fallbackUsed ? fallbackText : generatedText;

    const output = {
      text: text.includes('http') ? text : `${text}\n${link}`,
      model,
      requestedLanguage: languageCode,
      responseLanguage: fallbackUsed ? 'en' : languageCode,
      fallbackUsed,
      fallbackReason: fallbackUsed ? 'wrong_nearby_language_guard' : null
    };

    await logAiModelEvent({
      eventType: 'assistant_reply',
      source,
      inputPayload: { userMessage, intent, language: languageCode, context },
      outputPayload: output,
      modelName: model,
      language: languageCode,
      qualityScore: fallbackUsed ? 0.55 : 0.8
    });

    return output;
  } catch (error) {
    logger.warn('Assistant reply generation failed:', error.message);
    await logAiModelEvent({
      eventType: 'assistant_reply_error',
      source,
      inputPayload: { userMessage, intent, language: languageCode, context },
      outputPayload: { text: fallbackText },
      modelName: model,
      language: languageCode,
      qualityScore: 0.4,
      errorMessage: error.message
    });
    return { text: fallbackText, model: 'template_fallback' };
  }
}

async function recordAiFeedback({ eventId = null, rating = null, label = '', notes = '', actorId = null }) {
  const safeRating = rating == null ? null : Math.max(1, Math.min(5, parseInt(rating, 10) || 0));
  const safeLabel = cleanText(label, 80).toLowerCase() || null;
  const safeNotes = cleanText(notes, 1000) || null;

  const result = await db.query(
    `INSERT INTO ai_model_feedback (event_id, rating, label, notes, actor_id)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, created_at`,
    [eventId || null, safeRating || null, safeLabel, safeNotes, actorId || null]
  );

  return result.rows[0] || null;
}

async function generateCampaignCopy({
  objective = '',
  audience = '',
  language = 'English',
  channel = 'whatsapp'
}) {
  const fallback = `MakaUg update: ${objective || 'New property opportunities available'}.\nReply with your preferred area and budget, and we will share matching listings.\n${PUBLIC_BASE_URL}`;
  const client = getClient();
  if (!client) {
    return {
      text: fallback,
      model: 'template'
    };
  }

  const model = getTaskModel('campaign', process.env.OPENAI_CAMPAIGN_MODEL || 'gpt-4.1-mini');

  try {
    const completion = await createChatCompletionResilient(client, {
      model,
      temperature: 0.4,
      messages: [
        {
          role: 'system',
          content: 'Write a short, compliant marketing message for MakaUg. Keep it human, clear, and under 500 chars. Mention opt-out by replying STOP.'
        },
        {
          role: 'user',
          content: JSON.stringify({ objective, audience, language, channel })
        }
      ]
    }, { preferJson: true });

    const parsed = safeJsonParse(completion?.choices?.[0]?.message?.content || '{}', {});
    const text = cleanText(parsed.text || parsed.message || '', 1000) || fallback;

    await logAiModelEvent({
      eventType: 'campaign_copy_generation',
      source: 'admin_campaigns',
      inputPayload: { objective, audience, language, channel },
      outputPayload: { text },
      modelName: model,
      language: normalizeLanguageCode(language),
      qualityScore: 0.8
    });

    return {
      text,
      model
    };
  } catch (error) {
    logger.warn('Campaign copy generation failed:', error.message);
    await logAiModelEvent({
      eventType: 'campaign_copy_generation_error',
      source: 'admin_campaigns',
      inputPayload: { objective, audience, language, channel },
      outputPayload: { text: fallback },
      modelName: model,
      qualityScore: 0.4,
      errorMessage: error.message
    });
    return {
      text: fallback,
      model: 'template_fallback'
    };
  }
}

module.exports = {
  INTENTS,
  SUPPORTED_AI_LANGUAGES,
  classifyWhatsappIntent,
  detectWhatsappLanguage,
  extractNaturalPropertyQuery,
  transcribeAudioFromUrl,
  transcribeAudioFromDataUrl,
  generateCampaignCopy,
  generateListingIntelligence,
  suggestWhatsappAssistantReply,
  recordAiFeedback,
  logAiModelEvent,
  normalizeLanguageCode
};
