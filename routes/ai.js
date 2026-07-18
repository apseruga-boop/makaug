const express = require('express');

const db = require('../config/database');
const { requireAdminApiKey } = require('../middleware/auth');
const { asArray, cleanText, toNullableInt, toNullableFloat } = require('../middleware/validation');
const { captureLearningEvent } = require('../services/aiLearningCaptureService');
const { createLead } = require('../services/leadService');
const { logNotification } = require('../services/notificationLogService');
const {
  SUPPORTED_AI_LANGUAGES,
  extractNaturalPropertyQuery,
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

function sanitizeAssistantText(value = '') {
  return cleanText(value, 1600)
    .replace(/[🟩🟨]/gu, '')
    .replace(/\s+\|/g, ' |')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

function publicSearchPathForType(searchType = 'any') {
  return ASSISTANT_CATEGORY_PATHS[searchType] || ASSISTANT_CATEGORY_PATHS.any;
}

function buildAssistantSearchParams(parsed = {}, searchType = 'any', language = 'en') {
  const params = new URLSearchParams({
    status: 'approved',
    public_only: '1',
    limit: '6',
    page: '1',
    include_summary: '1',
    sort: 'newest',
    source: 'ai_assistant',
    language
  });
  const type = cleanText(parsed.searchType || searchType || 'any').toLowerCase();
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
  if (parsed.propertyType) params.set('property_type', cleanText(parsed.propertyType, 80));
  if (Number(parsed.maxBudgetUgx) > 0) params.set('max_price', String(Math.round(Number(parsed.maxBudgetUgx))));
  return params;
}

function assistantFilterChips(parsed = {}, searchType = 'any') {
  const chips = [];
  const type = cleanText(parsed.searchType || searchType || 'any').toLowerCase();
  if (type && type !== 'any') chips.push(type === 'rent' ? 'To rent' : type.charAt(0).toUpperCase() + type.slice(1));
  if (parsed.bedsMin) chips.push(`${parsed.bedsMin}+ beds`);
  if (parsed.area || parsed.district) chips.push(parsed.area || parsed.district);
  if (parsed.maxBudgetUgx) chips.push(`<= UGX ${Number(parsed.maxBudgetUgx).toLocaleString('en-UG')}`);
  if (parsed.propertyType) chips.push(parsed.propertyType);
  return chips;
}

function assistantLeadText({ total = 0, parsed = {}, searchType = 'any', language = 'en' } = {}) {
  const place = cleanText(parsed.area || parsed.district || 'Uganda', 120);
  const type = cleanText(parsed.searchType || searchType || 'property').replace(/_/g, ' ');
  const count = Number(total) || 0;
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

async function fetchAssistantSearchResults(req, { parsed, searchType, language }) {
  const params = buildAssistantSearchParams(parsed, searchType, language);
  const origin = appOriginFromRequest(req);
  const url = `${origin}/api/properties/search?${params.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
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
    return {
      ok: true,
      url,
      listings,
      total
    };
  } finally {
    clearTimeout(timeout);
  }
}

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

router.post('/assistant-reply', async (req, res, next) => {
  try {
    const body = req.body || {};
    const userMessage = cleanText(body.message, 1200);
    if (!userMessage) {
      return res.status(400).json({ ok: false, error: 'message is required' });
    }

    const language = normalizeLanguageCode(body.language || 'en');
    const intent = cleanText(body.intent).toLowerCase() || 'unknown';
    let response = await suggestWhatsappAssistantReply({
      userMessage,
      intent,
      language,
      context: body.context && typeof body.context === 'object' ? body.context : {},
      source: 'api_assistant_reply'
    });
    response = {
      ...response,
      text: sanitizeAssistantText(response?.text || '')
    };

    let searchPayload = null;
    if (isAssistantSearchIntent(intent)) {
      const rawIntentType = assistantSearchType(intent);
      const parsed = await extractNaturalPropertyQuery({
        text: userMessage,
        language,
        sessionData: body.context && typeof body.context === 'object' ? body.context : {},
        fallbackType: rawIntentType
      });
      const searchType = cleanText(parsed?.searchType || rawIntentType || 'any').toLowerCase();
      const publicPath = publicSearchPathForType(searchType);
      const publicParams = new URLSearchParams();
      if (parsed?.area) publicParams.set('q', cleanText(parsed.area, 120));
      if (parsed?.district && !parsed.area) publicParams.set('district', cleanText(parsed.district, 120));
      if (Number(parsed?.bedsMin) > 0) publicParams.set('min_beds', String(Math.round(Number(parsed.bedsMin))));
      if (Number(parsed?.maxBudgetUgx) > 0) publicParams.set('max_price', String(Math.round(Number(parsed.maxBudgetUgx))));
      if (parsed?.propertyType) publicParams.set('property_type', cleanText(parsed.propertyType, 80));
      const seeAllUrl = `${publicPath}${publicParams.toString() ? `?${publicParams.toString()}` : ''}`;

      try {
        const result = await fetchAssistantSearchResults(req, { parsed, searchType, language });
        const leadText = assistantLeadText({ total: result.total, parsed, searchType, language });
        response.text = leadText;
        searchPayload = {
          parsed_query: parsed,
          filters: {
            search_type: searchType,
            area: parsed?.area || null,
            district: parsed?.district || null,
            bedrooms: parsed?.bedsMin || null,
            max_price: parsed?.maxBudgetUgx || null,
            property_type: parsed?.propertyType || null
          },
          filter_chips: assistantFilterChips(parsed, searchType),
          search_type: searchType,
          total_matches: result.total,
          result_count: result.listings.length,
          listings: result.listings,
          results: result.listings,
          see_all_url: seeAllUrl,
          search_path: publicPath,
          zero_results: result.total === 0,
          search_error: null
        };
      } catch (searchError) {
        searchPayload = {
          parsed_query: parsed,
          filters: {
            search_type: searchType,
            area: parsed?.area || null,
            district: parsed?.district || null,
            bedrooms: parsed?.bedsMin || null,
            max_price: parsed?.maxBudgetUgx || null,
            property_type: parsed?.propertyType || null
          },
          filter_chips: assistantFilterChips(parsed, searchType),
          search_type: searchType,
          total_matches: 0,
          result_count: 0,
          listings: [],
          results: [],
          see_all_url: seeAllUrl,
          search_path: publicPath,
          zero_results: true,
          search_error: searchError.message || 'property_search_failed'
        };
        response.text = assistantLeadText({ total: 0, parsed, searchType, language });
      }
    }

    await recordAssistantBackendTrace(req, { userMessage, intent, language, response });

    return res.json({
      ok: true,
      data: {
        ...response,
        ...(searchPayload || {}),
        intent: normalizeAssistantIntent(intent),
        conversation_logged: true
      }
    });
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
