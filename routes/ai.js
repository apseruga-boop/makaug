const express = require('express');

const db = require('../config/database');
const { requireAdminApiKey } = require('../middleware/auth');
const { asArray, cleanText, toNullableInt, toNullableFloat } = require('../middleware/validation');
const { captureLearningEvent } = require('../services/aiLearningCaptureService');
const { createLead } = require('../services/leadService');
const { logNotification } = require('../services/notificationLogService');
const {
  SUPPORTED_AI_LANGUAGES,
  generateListingIntelligence,
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
      name: 'MakaUg Property AI Model',
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

router.post('/assistant-reply', async (req, res, next) => {
  try {
    const body = req.body || {};
    const userMessage = cleanText(body.message, 1200);
    if (!userMessage) {
      return res.status(400).json({ ok: false, error: 'message is required' });
    }

    const language = normalizeLanguageCode(body.language || 'en');
    const intent = cleanText(body.intent).toLowerCase() || 'unknown';
    const response = await suggestWhatsappAssistantReply({
      userMessage,
      intent,
      language,
      context: body.context && typeof body.context === 'object' ? body.context : {},
      source: 'api_assistant_reply'
    });

    await recordAssistantBackendTrace(req, { userMessage, intent, language, response });

    return res.json({
      ok: true,
      data: {
        ...response,
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
