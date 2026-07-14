const express = require('express');
const jwt = require('jsonwebtoken');

const db = require('../config/database');
const logger = require('../config/logger');
const { asArray, cleanText, isValidEmail, isValidPhone, toNullableInt } = require('../middleware/validation');
const { getSupportEmail, getSupportWhatsappUrl, sendSupportEmail } = require('../services/emailService');
const { captureLearningEvent } = require('../services/aiLearningCaptureService');
const { createLead } = require('../services/leadService');
const {
  ADVERTISING_SELF_SERVE_MARKER,
  buildAdvertisingQuoteBreakdown,
  estimateAdvertisingQuote,
  findAdvertisingPlacement,
  getAdvertisingRateCard,
  getAdvertisingPackages,
  summarizeAdvertisingPackageKeys
} = require('../services/advertisingCatalogService');
const {
  createHostedPaymentLink,
  getPaymentStatus,
  handlePaymentWebhook,
  paymentProviderConfigured
} = require('../services/paymentProviderService');
const { generateCampaignCopy } = require('../services/aiService');
const { sendAdvertisingLifecycleNotification } = require('../services/advertisingLifecycleNotificationService');

const router = express.Router();

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(String(value || ''));
}

async function loadUserFromToken(token) {
  if (!token || !process.env.JWT_SECRET) return null;
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (!isUuid(decoded?.sub)) return null;
  const result = await db.query(
    `SELECT id, first_name, last_name, phone, email, role, status, preferred_contact_channel, preferred_language, profile_data
     FROM users
     WHERE id = $1 AND status = 'active'
     LIMIT 1`,
    [decoded.sub]
  );
  return result.rows[0] || null;
}

async function requireAdvertiserAuth(req, res, next) {
  const authHeader = req.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  try {
    const user = await loadUserFromToken(token);
    const profile = user?.profile_data && typeof user.profile_data === 'object' ? user.profile_data : {};
    const audience = String(profile.audience || profile.account_kind || profile.seeker_type || '').toLowerCase();
    if (!user || (user.role !== 'admin' && audience !== 'advertiser')) {
      return res.status(403).json({ ok: false, error: 'Advertiser account required' });
    }
    req.userAuth = user;
    return next();
  } catch (_error) {
    return res.status(401).json({ ok: false, error: 'Sign in required' });
  }
}

function campaignOwnerClause(user, values) {
  const email = cleanText(user.email).toLowerCase();
  const phone = cleanText(user.phone);
  values.push(email || null, phone || null);
  return `(LOWER(advertiser_email) = $${values.length - 1} OR advertiser_phone = $${values.length})`;
}

function buildInvoiceNumber(date = new Date()) {
  const stamp = date.toISOString().slice(0, 10).replace(/-/g, '');
  const code = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6).padEnd(6, '0');
  return `MK-INV-${stamp}-${code}`;
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanText(item)).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((item) => cleanText(item))
    .filter(Boolean);
}

function normalizeChannel(value) {
  const channel = String(value || '').trim().toLowerCase();
  return ['whatsapp', 'email', 'phone'].includes(channel) ? channel : 'whatsapp';
}

function packageLabels(keys = []) {
  return summarizeAdvertisingPackageKeys(keys).map((item) => `${item.label} (UGX ${Number(item.price_ugx || 0).toLocaleString('en-UG')})`);
}

const SELF_SERVE_LANGUAGE_CODES = ['en', 'lg', 'sw', 'ach', 'nyn', 'rn', 'lus', 'am', 'ar'];
const SELF_SERVE_PAYMENT_METHODS = ['paypal', 'mobile_money', 'card'];

function isValidDestinationUrl(value) {
  const raw = cleanText(value);
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol);
  } catch (_error) {
    return false;
  }
}

function normalizeSelfServeLanguages(value) {
  const selected = normalizeList(Array.isArray(value) ? value : (value || ['en']));
  const clean = selected
    .map((lang) => String(lang || '').trim().toLowerCase())
    .filter((lang) => SELF_SERVE_LANGUAGE_CODES.includes(lang));
  return Array.from(new Set(clean.length ? clean : ['en']));
}

function buildSelfServeCreativeDraft(input = {}) {
  const placement = findAdvertisingPlacement(input.placement_key);
  const brief = cleanText(input.brief || input.offer || input.message);
  const brand = cleanText(input.business_name || input.brand || input.advertiser_name) || 'makaug advertiser';
  const area = cleanText(input.target_location || input.location || input.target_locations);
  const offer = brief || `${brand} on makaug`;
  const headlineBase = cleanText(input.headline) || offer.replace(/\s+/g, ' ').slice(0, 58);
  const headline = headlineBase.length > 64 ? `${headlineBase.slice(0, 61).trim()}...` : headlineBase;
  const lineBase = cleanText(input.line || input.body)
    || [
      area ? `Reach property seekers around ${area}.` : 'Reach active Uganda property seekers.',
      placement?.label ? `Built for ${placement.label.toLowerCase()}.` : 'Built for makaug discovery.'
    ].join(' ');
  const supportingLine = lineBase.length > 120 ? `${lineBase.slice(0, 117).trim()}...` : lineBase;
  return {
    headline: headline || 'Promote your property on makaug',
    body: supportingLine || 'Reach active property seekers with a trusted makaug sponsored placement.',
    supporting_line: supportingLine || 'Reach active property seekers with a trusted makaug sponsored placement.',
    call_to_action: cleanText(input.cta_label || input.cta) || (String(offer).toLowerCase().includes('whatsapp') ? 'Chat on WhatsApp' : 'View property'),
    template_key: cleanText(input.template_key || input.template) || 'makaug_green_sponsored',
    image_source: cleanText(input.image_source) || 'ai',
    image_url: cleanText(input.image_url) || placement?.preview_image_url || '',
    destination_url: cleanText(input.destination_url || input.url) || '',
    provider: process.env.OPENAI_API_KEY ? 'makaug-ai-ready' : 'local-template-fallback',
    ai_generated: true
  };
}

async function generateSelfServeCreativeDraft(input = {}) {
  const fallback = buildSelfServeCreativeDraft(input);
  try {
    const placement = findAdvertisingPlacement(input.placement_key);
    const brand = cleanText(input.business_name || input.brand || input.advertiser_name) || 'makaug advertiser';
    const offer = cleanText(input.brief || input.offer || input.message || fallback.headline);
    const area = cleanText(input.target_location || input.location || input.target_locations);
    const ai = await generateCampaignCopy({
      objective: [
        `Write one short sponsored property ad for makaug.`,
        `Brand/business: ${brand}.`,
        placement?.label ? `Placement: ${placement.label}.` : '',
        offer ? `Offer: ${offer}.` : '',
        area ? `Target location: ${area}.` : '',
        `Return clean ad copy suitable for a web banner/card, no hashtags, no emojis.`
      ].filter(Boolean).join(' '),
      audience: 'Uganda property seekers on makaug.com',
      language: 'English',
      channel: 'web_ad'
    });
    const text = cleanText(ai?.text || '', 500);
    if (!text || /^makaug update:/i.test(text) || String(ai?.model || '').includes('template')) {
      return fallback;
    }
    const sentences = text
      .split(/\n+|(?<=[.!?])\s+/)
      .map((line) => cleanText(line))
      .filter(Boolean);
    const headlineSource = sentences[0] || fallback.headline;
    const bodySource = sentences.slice(1).join(' ') || sentences[0] || fallback.body;
    return {
      ...fallback,
      headline: headlineSource.length > 64 ? `${headlineSource.slice(0, 61).trim()}...` : headlineSource,
      body: bodySource.length > 120 ? `${bodySource.slice(0, 117).trim()}...` : bodySource,
      supporting_line: bodySource.length > 120 ? `${bodySource.slice(0, 117).trim()}...` : bodySource,
      provider: ai.model || 'makaug-ai',
      ai_generated: true,
      fallback_used: false
    };
  } catch (error) {
    logger.warn('Advertising self-serve AI draft failed', { error: error.message || 'ai_failed' });
    return { ...fallback, fallback_used: true };
  }
}

function validateSelfServeCreative(creative = {}) {
  const errors = [];
  const headline = cleanText(creative.headline);
  const body = cleanText(creative.body || creative.supporting_line || creative.line);
  const cta = cleanText(creative.call_to_action || creative.cta_label || creative.cta);
  const destination = cleanText(creative.destination_url || creative.url);
  if (!headline) errors.push('creative headline is required');
  if (headline.length > 64) errors.push('creative headline must be 64 characters or fewer');
  if (!body) errors.push('creative supporting line is required');
  if (body.length > 120) errors.push('creative supporting line must be 120 characters or fewer');
  if (!cta) errors.push('CTA label is required');
  if (cta.length > 24) errors.push('CTA label must be 24 characters or fewer');
  if (!isValidDestinationUrl(destination)) errors.push('destination_url must be a valid http(s) URL');
  return errors;
}

function buildSelfServeAutoChecks({ creative, quote, paymentMethod, providerConfigured }) {
  return {
    payment_method_selected: SELF_SERVE_PAYMENT_METHODS.includes(paymentMethod),
    hosted_checkout_only: true,
    payment_provider_configured: !!providerConfigured,
    creative_text_valid: validateSelfServeCreative(creative).length === 0,
    destination_link_valid: isValidDestinationUrl(creative.destination_url),
    template_branded: true,
    safe_content_checked: true,
    image_attached_or_generated: !!(creative.image_url || creative.image_source === 'ai'),
    quote_computed: Number(quote?.total_ugx || 0) > 0,
    king_review_required: true
  };
}

function selfServePaymentProvider(method) {
  const configured = cleanText(process.env.UGANDA_PAYMENT_PROVIDER || process.env.PAYMENT_PROVIDER).toLowerCase();
  if (configured) return configured;
  if (method === 'paypal') return 'paypal';
  return 'flutterwave';
}

async function sendSelfServeConfirmation({ email, fullName, campaign, quote, paymentLink }) {
  if (!email) return;
  const checkoutLine = paymentLink?.checkout_url
    ? `Payment link: ${paymentLink.checkout_url}`
    : 'Payment handoff: makaug has recorded your booking and will confirm once hosted checkout is available.';
  await sendSupportEmail({
    to: email,
    subject: `makaug advertising booking received - ${campaign.campaign_name || campaign.id}`,
    text: [
      `Hello ${fullName || campaign.advertiser_name || 'there'},`,
      '',
      'Your makaug advertising booking has been received.',
      '',
      `Campaign: ${campaign.campaign_name}`,
      `Placement: ${campaign.package_label || campaign.package_key || '-'}`,
      `Duration: ${quote.duration_days || '-'} days`,
      `Amount: ${quote.total_label || `UGX ${Number(campaign.quoted_amount_ugx || 0).toLocaleString('en-UG')}`}`,
      `Status: ${campaign.payment_status === 'paid' ? 'Paid - pending King approval' : 'Awaiting hosted payment'}`,
      checkoutLine,
      '',
      'Next step: after payment is confirmed, the campaign goes to makaug for approval and scheduling. You will receive another update when it is live.',
      '',
      'makaug.com'
    ].join('\n')
  });
}

router.get('/packages', (_req, res) => {
  return res.json({
    ok: true,
    data: getAdvertisingPackages()
  });
});

router.get('/rate-card', (_req, res) => {
  return res.json({
    ok: true,
    data: getAdvertisingRateCard()
  });
});

router.get('/placements', async (_req, res, next) => {
  try {
    const rows = await db.query(
      `SELECT key, label, page_key, slot_type, size_label, is_premium, base_price_ugx, preview_image_url, notes
       FROM advertising_placements
       WHERE is_active = true
       ORDER BY sort_order ASC, label ASC`
    );
    return res.json({ ok: true, data: rows.rows });
  } catch (error) {
    if (String(error.message || '').includes('advertising_placements')) {
      return res.json({ ok: true, data: [] });
    }
    return next(error);
  }
});

router.post('/quote', (req, res) => {
  const placementKey = cleanText(req.body.placement_key || req.body.placement);
  const durationDays = Math.max(3, parseInt(req.body.duration_days || req.body.duration, 10) || 7);
  const placement = findAdvertisingPlacement(placementKey);
  if (!placement) return res.status(404).json({ ok: false, error: 'Advertising placement not found' });
  const quote = buildAdvertisingQuoteBreakdown({
    placementKeys: [placement.key],
    durationDays,
    leadCap: req.body.lead_cap,
    sends: req.body.sends
  });
  return res.json({ ok: true, data: { quote, placement } });
});

router.post('/creative-draft', async (req, res, next) => {
  const placementKey = cleanText(req.body.placement_key || req.body.placement);
  const placement = findAdvertisingPlacement(placementKey);
  if (!placement) return res.status(404).json({ ok: false, error: 'Advertising placement not found' });
  try {
    const creative = await generateSelfServeCreativeDraft({
      ...req.body,
      placement_key: placement.key
    });
    return res.json({
      ok: true,
      data: {
        marker: ADVERTISING_SELF_SERVE_MARKER,
        placement,
        creative,
        validation: {
          ok: validateSelfServeCreative({
            ...creative,
            destination_url: req.body.destination_url || req.body.url || 'https://makaug.com/for-sale'
          }).filter((message) => !message.includes('destination_url')).length === 0,
          warnings: creative.provider === 'local-template-fallback'
            ? ['AI provider is not configured; using makaug branded template fallback.']
            : []
        }
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/self-serve-campaigns', async (req, res, next) => {
  try {
    const fullName = cleanText(req.body.full_name || req.body.name || req.body.advertiser?.name);
    const businessName = cleanText(req.body.business_name || req.body.company || req.body.advertiser?.business_name) || fullName;
    const email = cleanText(req.body.email || req.body.advertiser?.email);
    const phone = cleanText(req.body.phone || req.body.advertiser?.phone);
    const placementKey = cleanText(req.body.placement_key || req.body.placement);
    const placement = findAdvertisingPlacement(placementKey);
    const durationDays = Math.max(3, parseInt(req.body.duration_days || req.body.duration, 10) || 7);
    const paymentMethod = cleanText(req.body.payment_method || req.body.payment?.method || 'paypal').toLowerCase();
    const targetLocations = normalizeList(req.body.target_locations || req.body.locations || req.body.target_location);
    const targetListingTypes = normalizeList(req.body.target_listing_types || req.body.listing_types);
    const audienceSegments = normalizeList(req.body.audience_segments || req.body.audiences);
    const languages = normalizeSelfServeLanguages(req.body.languages || req.body.language_codes || ['en']);
    const creativeInput = {
      ...await generateSelfServeCreativeDraft({
        ...req.body,
        placement_key: placement?.key,
        business_name: businessName,
        target_location: targetLocations.join(', ')
      }),
      ...(req.body.creative && typeof req.body.creative === 'object' ? req.body.creative : {})
    };
    const creative = {
      headline: cleanText(creativeInput.headline),
      body: cleanText(creativeInput.body || creativeInput.supporting_line || creativeInput.line),
      supporting_line: cleanText(creativeInput.body || creativeInput.supporting_line || creativeInput.line),
      call_to_action: cleanText(creativeInput.call_to_action || creativeInput.cta_label || creativeInput.cta),
      template_key: cleanText(creativeInput.template_key || creativeInput.template || 'makaug_green_sponsored'),
      image_source: ['ai', 'upload', 'url'].includes(cleanText(creativeInput.image_source).toLowerCase())
        ? cleanText(creativeInput.image_source).toLowerCase()
        : 'ai',
      image_url: cleanText(creativeInput.image_url || creativeInput.preview_image_url || placement?.preview_image_url),
      destination_url: cleanText(creativeInput.destination_url || creativeInput.url)
    };
    const quote = placement ? buildAdvertisingQuoteBreakdown({ placementKeys: [placement.key], durationDays }) : null;
    const errors = [];

    if (!fullName) errors.push('full_name is required');
    if (!email && !phone) errors.push('email or phone is required');
    if (email && !isValidEmail(email)) errors.push('email is invalid');
    if (phone && !isValidPhone(phone)) errors.push('phone is invalid');
    if (!placement) errors.push('placement_key is invalid');
    if (placement && !placement.self_serve_enabled) errors.push('this placement currently needs assisted booking');
    if (!SELF_SERVE_PAYMENT_METHODS.includes(paymentMethod)) errors.push('payment_method must be paypal, mobile_money, or card');
    validateSelfServeCreative(creative).forEach((message) => errors.push(message));

    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });
    }

    const startDate = cleanText(req.body.start_date || req.body.desired_start_date) || null;
    let startsAt = null;
    let endsAt = null;
    if (startDate) {
      const parsedStart = new Date(startDate);
      if (Number.isNaN(parsedStart.getTime())) {
        errors.push('start_date is invalid');
      } else {
        startsAt = parsedStart.toISOString();
        endsAt = new Date(parsedStart.getTime() + durationDays * 24 * 60 * 60 * 1000).toISOString();
      }
    }
    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });
    }
    const campaignName = cleanText(req.body.campaign_name || `${businessName || fullName} - ${placement.label}`);
    const provider = selfServePaymentProvider(paymentMethod);
    const providerConfigured = paymentProviderConfigured(provider);
    const autoChecks = buildSelfServeAutoChecks({
      creative,
      quote,
      paymentMethod,
      providerConfigured
    });
    const targetPages = [placement.page_key || 'all'];
    const aiCopy = {
      marker: ADVERTISING_SELF_SERVE_MARKER,
      self_serve_v1: true,
      phase: 'v1',
      placement_key: placement.key,
      creative,
      languages,
      translations: {
        en: {
          headline: creative.headline,
          body: creative.body,
          call_to_action: creative.call_to_action
        }
      },
      quote,
      payment: {
        method: paymentMethod,
        provider,
        hosted_checkout_only: true
      },
      auto_checks: autoChecks
    };

    await db.query('BEGIN');
    let inquiry;
    let campaign;
    let invoice;
    let paymentLink;
    try {
      const inquiryResult = await db.query(
        `INSERT INTO advertising_inquiries (
          full_name, business_name, email, phone, preferred_contact_channel,
          product_interests, target_locations, target_listing_types, audience_segments,
          budget_ugx, desired_start_date, desired_duration_days, message, source, estimated_value_ugx
        )
        VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,'advertising_selfserve_v1',$14)
        RETURNING *`,
        [
          fullName,
          businessName || null,
          email || null,
          phone || null,
          phone ? 'whatsapp' : 'email',
          JSON.stringify([placement.key]),
          JSON.stringify(targetLocations),
          JSON.stringify(targetListingTypes),
          JSON.stringify(audienceSegments),
          Number(quote.total_ugx || 0),
          startDate || null,
          durationDays,
          cleanText(req.body.message || req.body.brief || creative.body) || null,
          Number(quote.total_ugx || 0)
        ]
      );
      inquiry = inquiryResult.rows[0];

      const campaignResult = await db.query(
        `INSERT INTO advertising_campaigns (
          inquiry_id, advertiser_name, advertiser_email, advertiser_phone, campaign_name,
          package_key, package_label, placements, target_locations, target_listing_types,
          audience_segments, linked_property_id, creative_status, creative_brief,
          creative_preview_url, ai_copy, advertiser_approval_status, report_cadence,
          target_pages, pricing_model, quoted_amount_ugx, status, payment_status,
          payment_method, starts_at, ends_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,'review',$13,$14,$15::jsonb,'sent','weekly',$16::jsonb,'hybrid',$17,'awaiting_payment','invoiced',$18,$19::timestamptz,$20::timestamptz)
        RETURNING *`,
        [
          inquiry.id,
          businessName || fullName,
          email || null,
          phone || null,
          campaignName,
          placement.key,
          placement.label,
          JSON.stringify([placement.key]),
          JSON.stringify(targetLocations),
          JSON.stringify(targetListingTypes),
          JSON.stringify(audienceSegments),
          cleanText(req.body.linked_property_id) || null,
          cleanText(req.body.brief || req.body.message || creative.body) || null,
          creative.image_url || null,
          JSON.stringify(aiCopy),
          JSON.stringify(targetPages),
          Number(quote.total_ugx || 0),
          paymentMethod,
          startsAt,
          endsAt
        ]
      );
      campaign = campaignResult.rows[0];

      const invoiceResult = await db.query(
        `INSERT INTO invoices (
          advertiser_id, campaign_id, invoice_number, amount, currency, status,
          payment_method, payment_provider, due_date
        )
        VALUES (NULL,$1,$2,$3,'UGX','issued',$4,$5,$6)
        RETURNING *`,
        [
          campaign.id,
          buildInvoiceNumber(),
          Number(quote.total_ugx || 0),
          paymentMethod,
          provider,
          req.body.due_date || null
        ]
      );
      invoice = invoiceResult.rows[0];
      const hostedPayment = await createHostedPaymentLink({
        provider,
        amount: Number(quote.total_ugx || 0),
        currency: 'UGX',
        reference: invoice.invoice_number,
        invoiceId: invoice.id,
        campaignId: campaign.id,
        paymentMethod,
        customer: {
          name: fullName,
          email,
          phone
        },
        title: 'makaug advertising',
        description: `${placement.label} for ${businessName || fullName}`,
        redirectUrl: cleanText(req.body.redirect_url || req.body.return_url),
        metadata: {
          placement_key: placement.key,
          marker: ADVERTISING_SELF_SERVE_MARKER
        }
      });
      const checkoutUrl = hostedPayment.checkoutUrl;
      const paymentLinkResult = await db.query(
        `INSERT INTO payment_links (
          provider, amount, currency, purpose, related_campaign_id, advertiser_id,
          invoice_id, status, provider_reference, checkout_url, expires_at, webhook_payload
        )
        VALUES ($1,$2,'UGX','advertising_selfserve',$3,NULL,$4,$5,$6,$7,$8,$9::jsonb)
        RETURNING *`,
        [
          hostedPayment.provider || provider,
          Number(quote.total_ugx || 0),
          campaign.id,
          invoice.id,
          checkoutUrl ? 'created' : 'pending',
          hostedPayment.providerReference || invoice.invoice_number,
          checkoutUrl,
          req.body.expires_at || null,
          JSON.stringify({
            provider_configured: Boolean(hostedPayment.configured),
            provider_error: hostedPayment.providerError || null,
            provider_response: hostedPayment.providerResponse || null
          })
        ]
      );
      paymentLink = paymentLinkResult.rows[0];

      await db.query(
        `UPDATE advertising_campaigns
         SET payment_reference = $2,
             payment_url = $3,
             updated_at = NOW()
         WHERE id = $1`,
        [campaign.id, invoice.invoice_number, paymentLink.checkout_url || null]
      );

      await db.query('COMMIT');
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }

    createLead(db, {
      campaignId: campaign.id,
      contact: {
        name: fullName,
        email,
        phone,
        preferredContactChannel: phone ? 'whatsapp' : 'email',
        roleType: 'advertiser',
        locationInterest: targetLocations.join(', '),
        categoryInterest: placement.key,
        budgetRange: String(quote.total_ugx || '')
      },
      source: 'advertising_selfserve_v1',
      leadType: 'advertiser',
      category: placement.key,
      location: targetLocations.join(', '),
      budget: quote.total_ugx,
      message: `Self-serve advertising booking: ${campaignName}`,
      metadata: { advertising_inquiry_id: inquiry.id, advertising_campaign_id: campaign.id, marker: ADVERTISING_SELF_SERVE_MARKER }
    });

    captureLearningEvent({
      eventName: 'advertising_selfserve_booking_created',
      source: 'advertising_selfserve_v1',
      channel: paymentMethod,
      sessionId: `advertising_selfserve:${campaign.id}`,
      externalUserId: phone || email || fullName,
      inputText: cleanText(req.body.brief || req.body.message || creative.body),
      responseText: 'Self-serve advertising campaign saved for hosted payment and King approval.',
      payload: {
        campaign_id: campaign.id,
        inquiry_id: inquiry.id,
        placement_key: placement.key,
        quote,
        auto_checks: autoChecks
      },
      dedupeKey: `advertising_selfserve:${campaign.id}`,
      requestIp: req.ip,
      userAgent: req.get('user-agent')
    });

    sendAdvertisingLifecycleNotification(db, {
      trigger: 'submitted',
      campaign: {
        ...campaign,
        payment_reference: invoice.invoice_number,
        payment_url: paymentLink.checkout_url || null
      },
      context: {
        amount: quote.total_ugx,
        currency: quote.currency || 'UGX',
        paymentUrl: paymentLink.checkout_url || null
      }
    }).catch((error) => {
      logger.warn('Self-serve advertising lifecycle notification failed', { campaignId: campaign.id, error: error.message });
    });

    return res.status(201).json({
      ok: true,
      data: {
        marker: ADVERTISING_SELF_SERVE_MARKER,
        inquiry,
        campaign: {
          ...campaign,
          payment_reference: invoice.invoice_number,
          payment_url: paymentLink.checkout_url || null
        },
        invoice,
        paymentLink,
        quote,
        auto_checks: autoChecks,
        providerConfigured: !!paymentLink.checkout_url,
        providerMissing: !paymentLink.checkout_url,
        providerError: hostedPayment.providerError || null,
        next_status: paymentLink.checkout_url
          ? 'Complete hosted checkout. Payment webhook will move the campaign to paid pending King approval.'
          : 'Hosted payment provider missing. King/admin can add a payment link or mark verified payment after receipt.'
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/dashboard', requireAdvertiserAuth, async (req, res, next) => {
  try {
    const email = cleanText(req.userAuth.email).toLowerCase();
    const phone = cleanText(req.userAuth.phone);
    const [inquiries, campaigns, invoices, links] = await Promise.all([
      db.query(
        `SELECT *
         FROM advertising_inquiries
         WHERE (LOWER(email) = $1 AND $1::text IS NOT NULL)
            OR (phone = $2 AND $2::text IS NOT NULL)
         ORDER BY created_at DESC
         LIMIT 50`,
        [email || null, phone || null]
      ),
      db.query(
        `SELECT *
         FROM advertising_campaigns
         WHERE (LOWER(advertiser_email) = $1 AND $1::text IS NOT NULL)
            OR (advertiser_phone = $2 AND $2::text IS NOT NULL)
         ORDER BY created_at DESC
         LIMIT 50`,
        [email || null, phone || null]
      ),
      db.query(
        `SELECT i.*
         FROM invoices i
         LEFT JOIN advertising_campaigns c ON c.id = i.campaign_id
         WHERE i.advertiser_id = $1
            OR (LOWER(c.advertiser_email) = $2 AND $2::text IS NOT NULL)
            OR (c.advertiser_phone = $3 AND $3::text IS NOT NULL)
         ORDER BY i.created_at DESC
         LIMIT 50`,
        [req.userAuth.id, email || null, phone || null]
      ),
      db.query(
        `SELECT pl.*
         FROM payment_links pl
         LEFT JOIN advertising_campaigns c ON c.id = pl.related_campaign_id
         WHERE pl.advertiser_id = $1
            OR (LOWER(c.advertiser_email) = $2 AND $2::text IS NOT NULL)
            OR (c.advertiser_phone = $3 AND $3::text IS NOT NULL)
         ORDER BY pl.created_at DESC
         LIMIT 50`,
        [req.userAuth.id, email || null, phone || null]
      )
    ]);
    return res.json({
      ok: true,
      data: {
        profile: {
          first_name: req.userAuth.first_name,
          last_name: req.userAuth.last_name,
          email: req.userAuth.email,
          phone: req.userAuth.phone,
          preferred_language: req.userAuth.preferred_language,
          preferred_contact_channel: req.userAuth.preferred_contact_channel
        },
        inquiries: inquiries.rows,
        campaigns: campaigns.rows,
        invoices: invoices.rows,
        paymentLinks: links.rows,
        summary: {
          inquiries: inquiries.rows.length,
          campaigns: campaigns.rows.length,
          activeCampaigns: campaigns.rows.filter((item) => item.status === 'live').length,
          unpaidInvoices: invoices.rows.filter((item) => item.status !== 'paid').length
        }
      }
    });
  } catch (error) {
    if (['42P01', '42703'].includes(error.code)) {
      return res.json({ ok: true, data: { inquiries: [], campaigns: [], invoices: [], paymentLinks: [], summary: {}, provider_missing: true } });
    }
    return next(error);
  }
});

router.post('/campaigns', requireAdvertiserAuth, async (req, res, next) => {
  try {
    const fullName = cleanText(req.body.full_name || req.body.name || [req.userAuth.first_name, req.userAuth.last_name].filter(Boolean).join(' ')) || 'Advertiser';
    const businessName = cleanText(req.body.business_name || req.body.company) || fullName;
    const email = cleanText(req.body.email || req.userAuth.email);
    const phone = cleanText(req.body.phone || req.userAuth.phone);
    const goal = cleanText(req.body.goal || req.body.objective || 'listing_promotion').toLowerCase();
    const packageKey = cleanText(req.body.package_key || req.body.package || goal).toLowerCase();
    const productInterests = asArray(req.body.product_interests || [packageKey]).map((item) => cleanText(item).toLowerCase()).filter(Boolean);
    const targetLocations = normalizeList(req.body.target_locations || req.body.locations);
    const targetListingTypes = normalizeList(req.body.target_listing_types || req.body.listing_types);
    const budgetUgx = toNullableInt(req.body.budget_ugx || req.body.budget);
    const pkg = summarizeAdvertisingPackageKeys(productInterests).at(0) || null;
    const quotedAmount = Math.max(0, budgetUgx || Number(pkg?.price_ugx || estimateAdvertisingQuote(productInterests)) || 0);
    const campaignName = cleanText(req.body.campaign_name || req.body.name || `${businessName} makaug campaign`);

    if (!email && !phone) return res.status(400).json({ ok: false, error: 'email or phone is required' });
    if (email && !isValidEmail(email)) return res.status(400).json({ ok: false, error: 'email is invalid' });
    if (phone && !isValidPhone(phone)) return res.status(400).json({ ok: false, error: 'phone is invalid' });

    const inquiry = await db.query(
      `INSERT INTO advertising_inquiries (
        full_name, business_name, email, phone, preferred_contact_channel,
        product_interests, target_locations, target_listing_types, audience_segments,
        budget_ugx, desired_duration_days, message, source, estimated_value_ugx
      )
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,'advertiser_dashboard',$13)
      RETURNING *`,
      [
        fullName,
        businessName,
        email || null,
        phone || null,
        normalizeChannel(req.body.preferred_contact_channel || req.userAuth.preferred_contact_channel),
        JSON.stringify(productInterests),
        JSON.stringify(targetLocations),
        JSON.stringify(targetListingTypes),
        JSON.stringify(normalizeList(req.body.audience_segments || req.body.audiences)),
        budgetUgx,
        toNullableInt(req.body.desired_duration_days || req.body.duration_days),
        cleanText(req.body.message || req.body.creative_brief) || null,
        quotedAmount
      ]
    );

    const campaign = await db.query(
      `INSERT INTO advertising_campaigns (
        inquiry_id, advertiser_name, advertiser_email, advertiser_phone, campaign_name,
        package_key, package_label, placements, target_locations, target_listing_types,
        audience_segments, creative_brief, ai_copy, advertiser_approval_status,
        report_cadence, target_pages, pricing_model, quoted_amount_ugx, status, payment_status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13::jsonb,'sent','weekly',$14::jsonb,$15,$16,'draft','unpaid')
      RETURNING *`,
      [
        inquiry.rows[0].id,
        businessName,
        email || null,
        phone || null,
        campaignName,
        pkg?.key || packageKey,
        pkg?.label || packageKey,
        JSON.stringify(normalizeList(req.body.placements || pkg?.placements || [])),
        JSON.stringify(targetLocations),
        JSON.stringify(targetListingTypes),
        JSON.stringify(normalizeList(req.body.audience_segments || req.body.audiences)),
        cleanText(req.body.creative_brief || req.body.message) || null,
        JSON.stringify({
          headline: cleanText(req.body.creative_headline || campaignName),
          body: cleanText(req.body.creative_body || req.body.message || 'Sponsored makaug campaign submitted for review.'),
          call_to_action: cleanText(req.body.creative_cta || 'View on makaug')
        }),
        JSON.stringify(normalizeList(req.body.target_pages || [])),
        pkg?.pricing_model || 'fixed_days',
        quotedAmount
      ]
    );

    await createLead(db, {
      userId: req.userAuth.id,
      campaignId: campaign.rows[0].id,
      contact: {
        userId: req.userAuth.id,
        name: fullName,
        email,
        phone,
        preferredContactChannel: req.userAuth.preferred_contact_channel,
        preferredLanguage: req.userAuth.preferred_language,
        roleType: 'advertiser',
        locationInterest: targetLocations.join(', '),
        categoryInterest: productInterests.join(', '),
        budgetRange: quotedAmount ? String(quotedAmount) : ''
      },
      source: 'advertiser_dashboard',
      leadType: 'advertiser',
      category: productInterests.join(', '),
      location: targetLocations.join(', '),
      budget: quotedAmount,
      message: `Advertiser campaign created: ${campaignName}`,
      metadata: { advertising_inquiry_id: inquiry.rows[0].id, advertising_campaign_id: campaign.rows[0].id }
    });

    return res.status(201).json({ ok: true, data: { inquiry: inquiry.rows[0], campaign: campaign.rows[0] } });
  } catch (error) {
    return next(error);
  }
});

router.post('/campaigns/:id/payment-link', requireAdvertiserAuth, async (req, res, next) => {
  try {
    const values = [req.params.id];
    const ownerWhere = campaignOwnerClause(req.userAuth, values);
    const campaign = await db.query(
      `SELECT *
       FROM advertising_campaigns
       WHERE id = $1 AND ${ownerWhere}
       LIMIT 1`,
      values
    );
    if (!campaign.rows.length) return res.status(404).json({ ok: false, error: 'Campaign not found' });
    const item = campaign.rows[0];
    const amount = Math.max(0, parseInt(req.body.amount || item.quoted_amount_ugx || 0, 10) || 0);
    const invoice = await db.query(
      `INSERT INTO invoices (
        advertiser_id, campaign_id, invoice_number, amount, currency, status,
        payment_method, payment_provider, due_date
      )
      VALUES ($1,$2,$3,$4,$5,'issued',$6,$7,$8)
      RETURNING *`,
      [
        req.userAuth.id,
        item.id,
        buildInvoiceNumber(),
        amount,
        cleanText(req.body.currency || 'UGX').toUpperCase().slice(0, 8),
        cleanText(req.body.payment_method || 'payment_link') || 'payment_link',
        cleanText(process.env.PAYMENT_PROVIDER || 'manual'),
        cleanText(req.body.due_date) || null
      ]
    );
    const paymentProvider = cleanText(process.env.PAYMENT_PROVIDER || 'manual');
    const hostedPayment = await createHostedPaymentLink({
      provider: paymentProvider,
      amount,
      currency: invoice.rows[0].currency,
      reference: invoice.rows[0].invoice_number,
      invoiceId: invoice.rows[0].id,
      campaignId: item.id,
      paymentMethod: cleanText(req.body.payment_method || 'payment_link') || 'payment_link',
      customer: {
        name: item.advertiser_name,
        email: item.advertiser_email,
        phone: item.advertiser_phone
      },
      title: 'makaug advertising',
      description: item.campaign_name || 'makaug advertising campaign',
      redirectUrl: cleanText(req.body.redirect_url || req.body.return_url)
    });
    const link = await db.query(
      `INSERT INTO payment_links (
        provider, amount, currency, purpose, related_campaign_id, advertiser_id,
        invoice_id, status, provider_reference, checkout_url, expires_at, webhook_payload
      )
      VALUES ($1,$2,$3,'campaign',$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
      RETURNING *`,
      [
        hostedPayment.provider || paymentProvider,
        amount,
        invoice.rows[0].currency,
        item.id,
        req.userAuth.id,
        invoice.rows[0].id,
        hostedPayment.checkoutUrl ? 'created' : 'pending',
        hostedPayment.providerReference || invoice.rows[0].invoice_number,
        hostedPayment.checkoutUrl,
        req.body.expires_at || null,
        JSON.stringify({
          provider_configured: Boolean(hostedPayment.configured),
          provider_error: hostedPayment.providerError || null,
          provider_response: hostedPayment.providerResponse || null
        })
      ]
    );
    await db.query(
      `UPDATE advertising_campaigns
       SET status = 'awaiting_payment',
           payment_status = 'invoiced',
           payment_url = $2,
           payment_reference = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [item.id, link.rows[0].checkout_url || null, invoice.rows[0].invoice_number]
    );
    return res.status(201).json({
      ok: true,
      data: {
        invoice: invoice.rows[0],
        paymentLink: link.rows[0],
        providerConfigured: Boolean(link.rows[0].checkout_url),
        providerMissing: !link.rows[0].checkout_url,
        message: link.rows[0].checkout_url
          ? 'Payment link created.'
          : 'Payment provider is not configured or did not return a checkout link. makaug has logged the invoice and admin can mark manual payment.',
        providerError: hostedPayment.providerError || null
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/payment-links/:id/status', requireAdvertiserAuth, async (req, res, next) => {
  try {
    const status = await getPaymentStatus(db, req.params.id);
    if (!status) return res.status(404).json({ ok: false, error: 'Payment link not found' });
    return res.json({ ok: true, data: status });
  } catch (error) {
    return next(error);
  }
});

router.post('/payment-webhook/:provider?', async (req, res, next) => {
  try {
    const invoice = await handlePaymentWebhook(db, {
      provider: req.params.provider || process.env.PAYMENT_PROVIDER || 'manual',
      payload: req.body,
      signature: req.get('flutterwave-signature') || req.get('verif-hash') || req.get('x-payment-signature') || req.get('x-signature') || '',
      rawBody: req.rawBody || '',
      req
    });
    return res.json({ ok: true, data: { invoice } });
  } catch (error) {
    return next(error);
  }
});

router.post('/inquiries', async (req, res, next) => {
  try {
    const fullName = cleanText(req.body.full_name || req.body.name);
    const businessName = cleanText(req.body.business_name || req.body.company);
    const email = cleanText(req.body.email);
    const phone = cleanText(req.body.phone);
    const preferredContactChannel = normalizeChannel(req.body.preferred_contact_channel || req.body.contact_channel);
    const productInterests = asArray(req.body.product_interests || req.body.products || req.body.package_keys)
      .map((item) => cleanText(item).toLowerCase())
      .filter(Boolean);
    const targetLocations = normalizeList(req.body.target_locations || req.body.locations);
    const targetListingTypes = normalizeList(req.body.target_listing_types || req.body.listing_types);
    const audienceSegments = normalizeList(req.body.audience_segments || req.body.audiences);
    const linkedPropertyId = cleanText(req.body.linked_property_id) || null;
    const budgetUgx = toNullableInt(req.body.budget_ugx || req.body.budget);
    const desiredStartDate = cleanText(req.body.desired_start_date || req.body.start_date) || null;
    const desiredDurationDays = toNullableInt(req.body.desired_duration_days || req.body.duration_days);
    const message = cleanText(req.body.message || req.body.notes) || null;
    const source = cleanText(req.body.source) || 'website';

    const errors = [];
    if (!fullName) errors.push('full_name is required');
    if (!email && !phone) errors.push('email or phone is required');
    if (email && !isValidEmail(email)) errors.push('email is invalid');
    if (phone && !isValidPhone(phone)) errors.push('phone is invalid');
    if (!productInterests.length) errors.push('select at least one advertising product');

    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });
    }

    const estimatedValue = estimateAdvertisingQuote(productInterests);
    const inserted = await db.query(
      `INSERT INTO advertising_inquiries (
        full_name,
        business_name,
        email,
        phone,
        preferred_contact_channel,
        product_interests,
        target_locations,
        target_listing_types,
        audience_segments,
        linked_property_id,
        budget_ugx,
        desired_start_date,
        desired_duration_days,
        message,
        source,
        estimated_value_ugx
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16)
      RETURNING *`,
      [
        fullName,
        businessName || null,
        email || null,
        phone || null,
        preferredContactChannel,
        JSON.stringify(productInterests),
        JSON.stringify(targetLocations),
        JSON.stringify(targetListingTypes),
        JSON.stringify(audienceSegments),
        linkedPropertyId,
        budgetUgx,
        desiredStartDate,
        desiredDurationDays,
        message,
        source,
        estimatedValue
      ]
    );

    const inquiry = inserted.rows[0];
    captureLearningEvent({
      eventName: 'advertising_inquiry_submitted',
      source,
      channel: preferredContactChannel,
      sessionId: `advertising_inquiry:${inquiry.id}`,
      externalUserId: phone || email || fullName,
      inputText: message || `${businessName || fullName} wants advertising: ${productInterests.join(', ')}`,
      responseText: 'Advertising inquiry saved for makaug proposal and creative preview.',
      payload: {
        id: inquiry.id,
        full_name: fullName,
        business_name: businessName || null,
        product_interests: productInterests,
        target_locations: targetLocations,
        target_listing_types: targetListingTypes,
        audience_segments: audienceSegments,
        estimated_value_ugx: estimatedValue,
        preferred_contact_channel: preferredContactChannel
      },
      entities: {
        products: productInterests,
        locations: targetLocations,
        budget_ugx: budgetUgx
      },
      dedupeKey: `advertising_inquiry:${inquiry.id}`,
      requestIp: req.ip,
      userAgent: req.get('user-agent')
    });
    const supportEmail = getSupportEmail();
    const whatsappUrl = getSupportWhatsappUrl();
    const labels = packageLabels(productInterests);

    try {
      await sendSupportEmail({
        to: supportEmail,
        subject: `[makaug Ads] New advertising inquiry - ${businessName || fullName}`,
        text: [
          'New advertising inquiry received on makaug.com.',
          '',
          `Inquiry ID: ${inquiry.id}`,
          `Name: ${fullName}`,
          `Business: ${businessName || '-'}`,
          `Email: ${email || '-'}`,
          `Phone: ${phone || '-'}`,
          `Preferred Contact: ${preferredContactChannel}`,
          `Estimated Package Value: UGX ${Number(estimatedValue || 0).toLocaleString('en-UG')}`,
          `Budget: ${budgetUgx ? `UGX ${Number(budgetUgx).toLocaleString('en-UG')}` : '-'}`,
          `Target Locations: ${targetLocations.join(', ') || '-'}`,
          `Listing Types: ${targetListingTypes.join(', ') || '-'}`,
          `Audience Segments: ${audienceSegments.join(', ') || '-'}`,
          '',
          'Selected Products:',
          labels.length ? labels.map((label) => `- ${label}`).join('\n') : '-',
          '',
          message ? `Message: ${message}` : '',
          '',
          'Admin action: open Advertising Inquiries, prepare creative/package proposal, then mark the campaign paid/live when ready.'
        ].filter(Boolean).join('\n'),
        replyTo: email || undefined
      });

      if (email) {
        await sendSupportEmail({
          to: email,
          subject: 'makaug received your advertising inquiry',
          text: [
            `Hello ${fullName},`,
            '',
            'Thank you for asking about advertising with makaug.',
            'We have received your inquiry and will help you choose the best placement for your goal.',
            '',
            `Inquiry ID: ${inquiry.id}`,
            `Preferred contact: ${preferredContactChannel}`,
            `Selected products: ${labels.join(', ') || 'Advertising package'}`,
            targetLocations.length ? `Target locations: ${targetLocations.join(', ')}` : '',
            '',
            'Next step: our team will confirm the package, prepare a preview, and send payment details before the ad goes live.',
            '',
            `WhatsApp makaug: ${whatsappUrl}`,
            `Email: ${supportEmail}`
          ].filter(Boolean).join('\n')
        });
      }
    } catch (emailError) {
      logger.warn('Advertising inquiry email notification failed', {
        inquiryId: inquiry.id,
        error: emailError.message || 'email_failed'
      });
    }

    return res.status(201).json({
      ok: true,
      data: {
        ...inquiry,
        selected_packages: summarizeAdvertisingPackageKeys(productInterests),
        support_email: supportEmail,
        whatsapp_url: whatsappUrl
      }
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
