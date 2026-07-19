'use strict';

const express = require('express');

const db = require('../config/database');
const { requireListingModerationAccess } = require('../middleware/auth');
const { isValidEmail, isValidPhone } = require('../middleware/validation');
const { createLead } = require('../services/leadService');
const { logNotification } = require('../services/notificationLogService');
const {
  DISTRICTS,
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_P1_MARKER,
  clean,
  getMarketplaceStats,
  invalidateMarketplaceStats,
  isCompetitorPortal,
  normalizeCategory,
  normalizePhone,
  parseMarketplaceQuery,
  recordMarketplaceEvent,
  registrationReference,
  searchMarketplace,
  slugify,
  validateUgandaLocation
} = require('../services/marketplaceService');

const router = express.Router();

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(clean).filter(Boolean))].slice(0, 146);
}

function normalizePublicUrl(value) {
  const raw = clean(value);
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch (_error) {
    return '';
  }
}

function normalizeUuid(value) {
  const uuid = clean(value).toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid) ? uuid : '';
}

function publicBusiness(row = {}) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    description: row.description,
    district: row.district,
    area: row.area,
    serves_regions: row.serves_regions || [],
    phone: row.phone,
    whatsapp: row.whatsapp,
    email: row.email,
    website: row.website,
    social_links: row.social_links || {},
    ursb_number: row.ursb_number,
    tier: row.tier,
    rating_avg: Number(row.rating_avg) || 0,
    rating_count: Number(row.rating_count) || 0,
    source_type: row.source_type,
    updated_at: row.updated_at
  };
}

router.get('/config', async (_req, res) => {
  return res.json({
    ok: true,
    data: {
      marker: MARKETPLACE_P1_MARKER,
      categories: MARKETPLACE_CATEGORIES,
      districts: DISTRICTS,
      paid_verification_enabled: false,
      source_drip_enabled: false
    }
  });
});

router.get('/stats', async (_req, res, next) => {
  try {
    return res.json({ ok: true, data: await getMarketplaceStats(db) });
  } catch (error) {
    return next(error);
  }
});

router.get('/search', async (req, res, next) => {
  try {
    const result = await searchMarketplace(db, req.query || {});
    return res.json({
      ok: true,
      data: {
        ...result,
        businesses: result.businesses.map(publicBusiness),
        pagination: {
          page: result.page,
          per_page: result.limit,
          total: result.total,
          total_pages: Math.max(1, Math.ceil(result.total / result.limit))
        }
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/ask', async (req, res, next) => {
  try {
    const message = clean(req.body?.message || req.body?.query);
    if (message.length < 2) return res.status(400).json({ ok: false, error: 'Describe the property service you need.' });
    const parsed = parseMarketplaceQuery(message);
    const result = await searchMarketplace(db, {
      query: parsed.category ? '' : parsed.query,
      category: parsed.category,
      district: parsed.district,
      area: parsed.area,
      limit: 6,
      page: 1
    });
    const params = new URLSearchParams();
    if (parsed.category) params.set('category', parsed.category);
    if (parsed.district) params.set('district', parsed.district);
    if (parsed.area) params.set('area', parsed.area);
    if (!parsed.category && parsed.query) params.set('q', parsed.query);
    const seeAllUrl = `/marketplace${params.toString() ? `?${params}` : ''}`;
    return res.json({
      ok: true,
      data: {
        marker: MARKETPLACE_P1_MARKER,
        text: result.total ? 'Here are property service providers that match your request.' : 'No exact provider is live yet. Tell us what you need and the makaug team will follow up.',
        parsed,
        businesses: result.businesses.map(publicBusiness),
        total_matches: result.total,
        see_all_url: seeAllUrl
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/register', async (req, res, next) => {
  try {
    const input = req.body || {};
    const name = clean(input.name);
    const category = normalizeCategory(input.category);
    const description = clean(input.description);
    const location = validateUgandaLocation({ district: input.district, area: input.area });
    const phone = normalizePhone(input.phone);
    const whatsapp = normalizePhone(input.whatsapp || input.phone);
    const email = clean(input.email).toLowerCase();
    const website = normalizePublicUrl(input.website);
    const socialLinks = safeObject(input.social_links);
    const primarySocialUrl = normalizePublicUrl(socialLinks.primary);
    const competitor = isCompetitorPortal({ ...input, social_links: socialLinks });
    const errors = [];
    if (name.length < 2) errors.push('Business name is required.');
    if (!category) errors.push('Choose a marketplace service category.');
    if (description.length < 20) errors.push('Add a short description of at least 20 characters.');
    if (!location.ok) errors.push(location.error);
    if (!phone || !isValidPhone(phone)) errors.push('Enter a valid phone number.');
    if (email && !isValidEmail(email)) errors.push('Enter a valid email address.');
    if (clean(input.website) && !website) errors.push('Website must be a valid HTTP or HTTPS URL.');
    if (clean(socialLinks.primary) && !primarySocialUrl) errors.push('Social media link must be a valid HTTP or HTTPS URL.');
    if (competitor) errors.push('Competing property portals cannot be registered as service providers.');
    if (errors.length) return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });

    const reference = registrationReference();
    const baseSlug = slugify(`${name}-${location.district}`);
    const slug = `${baseSlug}-${reference.slice(-6).toLowerCase()}`;
    const result = await db.query(
      `INSERT INTO marketplace_businesses (
         name, slug, category, description, district, area, serves_regions,
         phone, whatsapp, email, website, social_links, ursb_number,
         tier, status, source_type, source_metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,'private','pending_review','private',$14::jsonb)
       RETURNING id, name, slug, category, district, area, tier, status, created_at`,
      [
        name,
        slug,
        category,
        description,
        location.district,
        clean(input.area) || null,
        safeArray(input.serves_regions),
        phone,
        whatsapp || phone,
        email || null,
        website || null,
        JSON.stringify(primarySocialUrl ? { primary: primarySocialUrl } : {}),
        clean(input.ursb_number) || null,
        JSON.stringify({ registration_reference: reference, language: clean(input.language) || 'en' })
      ]
    );
    const business = result.rows[0];
    await recordMarketplaceEvent(db, {
      businessId: business.id,
      eventType: 'business_registered',
      metadata: { reference, category, district: location.district, source: 'marketplace_registration' }
    });
    const crmLead = await createLead(db, {
      source: 'marketplace_registration',
      leadType: 'marketplace_business_registration',
      category,
      location: [clean(input.area), location.district].filter(Boolean).join(', '),
      message: `Marketplace registration ${reference}: ${name}`,
      contact: { name, phone, whatsapp: whatsapp || phone, email },
      metadata: { marketplace_business_id: business.id, marketplace_reference: reference }
    });
    await logNotification(db, {
      channel: 'in_app',
      type: 'marketplace_business_registration',
      status: 'logged',
      recipientPhone: phone,
      recipientEmail: email || null,
      relatedLeadId: crmLead?.id || null,
      payloadSummary: { marketplace_business_id: business.id, reference, name, category, district: location.district }
    });
    return res.status(201).json({ ok: true, data: { marker: MARKETPLACE_P1_MARKER, reference, business } });
  } catch (error) {
    return next(error);
  }
});

router.post('/leads', async (req, res, next) => {
  try {
    const input = req.body || {};
    const requestedBusinessId = clean(input.business_id);
    const businessId = normalizeUuid(requestedBusinessId);
    const message = clean(input.message || input.need);
    const phone = normalizePhone(input.phone);
    const email = clean(input.email).toLowerCase();
    if (message.length < 5) return res.status(400).json({ ok: false, error: 'Tell us what service you need.' });
    if (!phone && !email) return res.status(400).json({ ok: false, error: 'Add a phone number or email so we can follow up.' });
    if (phone && !isValidPhone(phone)) return res.status(400).json({ ok: false, error: 'Enter a valid phone number.' });
    if (email && !isValidEmail(email)) return res.status(400).json({ ok: false, error: 'Enter a valid email address.' });
    if (requestedBusinessId && !businessId) return res.status(400).json({ ok: false, error: 'Choose a valid marketplace business.' });
    const category = normalizeCategory(input.category) || null;
    const result = await db.query(
      `INSERT INTO marketplace_leads (
         business_id, requester_name, requester_phone, requester_email,
         category, district, area, message, source, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
       RETURNING id, status, created_at`,
      [
        businessId || null,
        clean(input.name) || null,
        phone || null,
        email || null,
        category,
        clean(input.district) || null,
        clean(input.area) || null,
        message,
        clean(input.source) || 'marketplace_need_capture',
        JSON.stringify({ language: clean(input.language) || 'en', query: clean(input.query) || null })
      ]
    );
    const lead = result.rows[0];
    await recordMarketplaceEvent(db, { leadId: lead.id, businessId: businessId || null, eventType: 'marketplace_lead_created', metadata: { category } });
    const crmLead = await createLead(db, {
      source: 'marketplace_need_capture',
      leadType: 'marketplace_service_request',
      category,
      location: [clean(input.area), clean(input.district)].filter(Boolean).join(', '),
      message,
      contact: { name: clean(input.name), phone, email },
      metadata: { marketplace_lead_id: lead.id, marketplace_business_id: businessId || null }
    });
    await logNotification(db, {
      channel: 'in_app',
      type: 'marketplace_service_request',
      status: 'logged',
      recipientPhone: phone || null,
      recipientEmail: email || null,
      relatedLeadId: crmLead?.id || null,
      payloadSummary: { marketplace_lead_id: lead.id, category }
    });
    return res.status(201).json({ ok: true, data: { marker: MARKETPLACE_P1_MARKER, lead } });
  } catch (error) {
    return next(error);
  }
});

router.get('/admin/pending', requireListingModerationAccess, async (req, res, next) => {
  try {
    const status = ['pending_review', 'live', 'hidden', 'removed'].includes(clean(req.query.status)) ? clean(req.query.status) : 'pending_review';
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '50', 10) || 50));
    const result = await db.query(
      `SELECT id, name, slug, category, description, district, area, serves_regions,
              phone, whatsapp, email, website, social_links, ursb_number, tier,
              status, source_type, source_url, source_urls, source_metadata,
              moderation_notes, reviewed_by, reviewed_at, created_at, updated_at
       FROM marketplace_businesses
       WHERE status = $1
       ORDER BY created_at ASC
       LIMIT $2`,
      [status, limit]
    );
    return res.json({ ok: true, data: { marker: MARKETPLACE_P1_MARKER, status, businesses: result.rows } });
  } catch (error) {
    return next(error);
  }
});

router.patch('/admin/:id/status', requireListingModerationAccess, async (req, res, next) => {
  try {
    const requested = clean(req.body?.status).toLowerCase();
    const statusMap = { approve: 'live', approved: 'live', live: 'live', reject: 'hidden', rejected: 'hidden', hidden: 'hidden', remove: 'removed', removed: 'removed', pending: 'pending_review', pending_review: 'pending_review' };
    const status = statusMap[requested];
    if (!status) return res.status(400).json({ ok: false, error: 'Choose approve, hide, remove, or pending review.' });
    const notes = clean(req.body?.notes || req.body?.reason);
    if (['hidden', 'removed'].includes(status) && notes.length < 3) {
      return res.status(400).json({ ok: false, error: 'A moderation reason is required.' });
    }
    const result = await db.query(
      `UPDATE marketplace_businesses
       SET status = $2,
           tier = CASE WHEN $2 = 'live' AND tier = 'verified' THEN 'verified' WHEN $2 = 'live' AND tier = 'found_online' THEN 'found_online' WHEN $2 = 'live' THEN 'private' ELSE tier END,
           moderation_notes = NULLIF($3, ''),
           reviewed_by = $4,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, slug, category, district, area, tier, status, moderation_notes, reviewed_at`,
      [req.params.id, status, notes, req.userAuth?.id || req.adminAuth?.userId || null]
    );
    const business = result.rows[0];
    if (!business) return res.status(404).json({ ok: false, error: 'Marketplace business not found.' });
    await recordMarketplaceEvent(db, {
      businessId: business.id,
      actorUserId: req.userAuth?.id || req.adminAuth?.userId || null,
      eventType: `business_${status}`,
      metadata: { notes, role: req.userAuth?.role || req.adminAuth?.role || req.adminAuth?.type || null }
    });
    invalidateMarketplaceStats();
    return res.json({ ok: true, data: { marker: MARKETPLACE_P1_MARKER, business } });
  } catch (error) {
    return next(error);
  }
});

router.get('/:slug', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, name, slug, category, description, district, area, serves_regions,
              phone, whatsapp, email, website, social_links, ursb_number, tier,
              rating_avg, rating_count, source_type, updated_at
       FROM marketplace_businesses
       WHERE slug = $1 AND status = 'live'
       LIMIT 1`,
      [clean(req.params.slug)]
    );
    const business = result.rows[0];
    if (!business) return res.status(404).json({ ok: false, error: 'Marketplace business not found.' });
    const reviews = await db.query(
      `SELECT reviewer_name, rating, review_text, created_at
       FROM marketplace_reviews
       WHERE business_id = $1 AND status = 'live'
       ORDER BY created_at DESC
       LIMIT 20`,
      [business.id]
    );
    return res.json({ ok: true, data: { marker: MARKETPLACE_P1_MARKER, business: publicBusiness(business), reviews: reviews.rows } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
