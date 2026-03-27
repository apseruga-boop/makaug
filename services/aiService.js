const OpenAI = require('openai');

const logger = require('../config/logger');
const db = require('../config/database');

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

const SUPPORTED_AI_LANGUAGES = {
  en: 'English',
  lg: 'Luganda',
  sw: 'Kiswahili',
  ac: 'Acholi',
  ny: 'Runyankole',
  rn: 'Rukiga',
  sm: 'Lusoga'
};

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://makaug.com').replace(/\/+$/, '');

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
}

function normalizeIntent(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (INTENTS.includes(raw)) return raw;
  return 'unknown';
}

function normalizeLanguageCode(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(SUPPORTED_AI_LANGUAGES, raw)) return raw;
  return 'en';
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanText(value, max = 1200) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function safeJsonParse(text, fallback = {}) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return fallback;
  }
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

  if (/(find|search|looking|rent|buy|sale|house|apartment|property|near me|area|nyumba|plot|ttaka|enju|ot|ot me)/.test(t)) {
    return { intent: 'property_search', confidence: 0.62, entities: {} };
  }
  if (/(list|advertise|post|submit|upload|my property|teeka|kwandika|orodhesha|listing)/.test(t)) {
    return { intent: 'property_listing', confidence: 0.67, entities: {} };
  }
  if (/(agent|broker|find agent|realtor|wakala|musomesa)/.test(t)) {
    return { intent: 'agent_search', confidence: 0.65, entities: {} };
  }
  if (/(register agent|agent registration|area licence|license|lisensi|licence)/.test(t)) {
    return { intent: 'agent_registration', confidence: 0.68, entities: {} };
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
  if (/(help|support|human|call me|contact)/.test(t)) {
    return { intent: 'support', confidence: 0.64, entities: {} };
  }
  return { intent: 'unknown', confidence: 0.2, entities: {} };
}

async function classifyWhatsappIntent({ text, language = 'en', step = '', sessionData = {} }) {
  const fallback = heuristicIntent(text);
  const client = getClient();
  if (!client) {
    return {
      ...fallback,
      model: 'heuristic'
    };
  }

  let model = process.env.OPENAI_INTENT_MODEL || 'gpt-4.1-mini';

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You classify intents for MakaUg WhatsApp assistant for Uganda.
Return strict JSON only:
{
  "intent": one of ${JSON.stringify(INTENTS)},
  "confidence": number between 0 and 1,
  "entities": object with optional keys like listing_type, area, district, budget, bedrooms, language
}`
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
    });

    const raw = completion?.choices?.[0]?.message?.content || '{}';
    const parsed = safeJsonParse(raw, {});
    const intent = normalizeIntent(parsed.intent);
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
    const entities = parsed.entities && typeof parsed.entities === 'object' ? parsed.entities : {};

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

async function transcribeAudioFromUrl(mediaUrl, mediaType = 'audio/ogg') {
  if (!mediaUrl) return null;
  const client = getClient();
  if (!client) return null;

  let model = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';

  try {
    const headers = {};
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      headers.Authorization = `Basic ${auth}`;
    }

    const resp = await fetch(mediaUrl, { headers });
    if (!resp.ok) return null;

    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (!buffer.length) return null;

    const ext = String(mediaType || '').includes('mpeg') ? 'mp3' : (String(mediaType || '').includes('wav') ? 'wav' : 'ogg');
    const fileName = `voice-note.${ext}`;

    const file = await OpenAI.toFile(buffer, fileName, { type: mediaType || 'audio/ogg' });

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
      inputPayload: { mediaType },
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
      quality_notes: ['Template intelligence fallback used because OPENAI_API_KEY is not configured or model response failed.']
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

  const model = process.env.OPENAI_LISTING_MODEL || 'gpt-4.1-mini';

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.35,
      response_format: { type: 'json_object' },
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
    });

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

  const fallbackText = [
    'I can help with property search, listing, agent support, mortgage guidance, and account help.',
    `Open: ${link}`,
    'If you need human support, call +256 770 646 879 or email info@makaug.com.'
  ].join(' ');

  const client = getClient();
  if (!client) {
    await logAiModelEvent({
      eventType: 'assistant_reply',
      source,
      inputPayload: { userMessage, intent, language: languageCode, context },
      outputPayload: { text: fallbackText },
      modelName: 'template',
      language: languageCode,
      qualityScore: 0.5
    });
    return { text: fallbackText, model: 'template' };
  }

  const model = process.env.OPENAI_REPLY_MODEL || 'gpt-4.1-mini';

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are MakaUg WhatsApp property assistant for Uganda.
Produce a short typed reply in ${SUPPORTED_AI_LANGUAGES[languageCode]}.
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
    });

    const raw = completion?.choices?.[0]?.message?.content || '{}';
    const parsed = safeJsonParse(raw, {});
    const text = cleanText(parsed.text || fallbackText, 1500);

    const output = {
      text: text.includes('http') ? text : `${text}\n${link}`,
      model
    };

    await logAiModelEvent({
      eventType: 'assistant_reply',
      source,
      inputPayload: { userMessage, intent, language: languageCode, context },
      outputPayload: output,
      modelName: model,
      language: languageCode,
      qualityScore: 0.8
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

  const model = process.env.OPENAI_CAMPAIGN_MODEL || 'gpt-4.1-mini';

  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: 0.4,
      response_format: { type: 'json_object' },
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
    });

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
  transcribeAudioFromUrl,
  generateCampaignCopy,
  generateListingIntelligence,
  suggestWhatsappAssistantReply,
  recordAiFeedback,
  logAiModelEvent,
  normalizeLanguageCode
};
