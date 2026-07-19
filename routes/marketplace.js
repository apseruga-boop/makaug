'use strict';

const express = require('express');

const db = require('../config/database');
const {
  MARKETPLACE_POLISH_MARKER,
  MARKETPLACE_VERIFIED_BILLING_PERIOD,
  MARKETPLACE_VERIFIED_PRICE_UGX
} = require('../config/marketplacePricing');
const { requireListingModerationAccess } = require('../middleware/auth');
const { isValidEmail, isValidPhone } = require('../middleware/validation');
const { createLead } = require('../services/leadService');
const { isDataUrl, prepareMediaUrlForStorage } = require('../services/cloudMediaStorageService');
const { logNotification, notificationStatusFromDelivery } = require('../services/notificationLogService');
const {
  getGooglePlaceDetails,
  googleDetailsStatus
} = require('../services/marketplaceGooglePlacesService');
const {
  MARKETPLACE_REGJOURNEY_MARKER,
  REJECTION_REASONS,
  notifyMarketplaceLeadOpportunity,
  resolveMarketplaceEditToken,
  sendMarketplaceApprovalNotification,
  sendMarketplaceRegistrationAcknowledgement,
  sendMarketplaceRejectionNotification
} = require('../services/marketplaceLifecycleService');
const {
  DISTRICTS,
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_ENRICH_MARKER,
  MARKETPLACE_P1_MARKER,
  MARKETPLACE_REPORT_FIXES_MARKER,
  claimReference,
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
  validateMarketplaceFilters,
  validateUgandaLocation
} = require('../services/marketplaceService');
const {
  MARKETPLACE_P2_MARKER,
  sourceDefinitions
} = require('../services/marketplaceNationalDripService');

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
  const foundOnline = row.tier === 'found_online' || row.source_type === 'found_online';
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
    profile_images: row.profile_images || [],
    social_links: row.social_links || {},
    ursb_number: row.ursb_number,
    tier: row.tier,
    rating_avg: Number(row.rating_avg) || 0,
    rating_count: Number(row.rating_count) || 0,
    source_type: row.source_type,
    source: foundOnline ? row.source : null,
    source_url: foundOnline ? row.source_url : null,
    first_seen: foundOnline ? row.first_seen : null,
    last_refreshed: foundOnline ? row.last_refreshed : null,
    updated_at: row.updated_at
  };
}

router.get('/config', async (_req, res) => {
  return res.json({
    ok: true,
    data: {
      marker: MARKETPLACE_P1_MARKER,
      release_markers: [MARKETPLACE_P1_MARKER, MARKETPLACE_REPORT_FIXES_MARKER, MARKETPLACE_ENRICH_MARKER, MARKETPLACE_REGJOURNEY_MARKER, MARKETPLACE_P2_MARKER, MARKETPLACE_POLISH_MARKER],
      categories: MARKETPLACE_CATEGORIES,
      districts: DISTRICTS,
      paid_verification_enabled: false,
      verified_waitlist_enabled: true,
      verified_pricing: {
        amount_ugx: MARKETPLACE_VERIFIED_PRICE_UGX,
        billing_period: MARKETPLACE_VERIFIED_BILLING_PERIOD
      },
      registration_review_target_hours: 24,
      rejection_reasons: REJECTION_REASONS,
      source_drip_available: true,
      source_catalog: sourceDefinitions().map(({ key, label, url, adapter_status, enabled, configured }) => ({ key, label, url, adapter_status, enabled, configured })),
      google_details: {
        configured: googleDetailsStatus().configured,
        cache_ttl_ms: googleDetailsStatus().cache_ttl_ms
      }
    }
  });
});

router.get('/seo-links', (_req, res) => {
  const links = [];
  for (const category of MARKETPLACE_CATEGORIES) {
    for (const district of DISTRICTS) {
      links.push({
        category: category.key,
        category_label: category.label,
        district,
        label: `${category.label} in ${district}`,
        url: `/marketplace?category=${encodeURIComponent(category.key)}&district=${encodeURIComponent(district)}`
      });
    }
  }
  return res.json({ ok: true, data: { marker: MARKETPLACE_P2_MARKER, total: links.length, links } });
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
    const validation = validateMarketplaceFilters(req.query || {});
    if (!validation.ok) {
      return res.status(400).json({ ok: false, error: 'Invalid marketplace filters.', details: validation.errors });
    }
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

router.post('/claims', async (req, res, next) => {
  try {
    const input = req.body || {};
    const businessId = normalizeUuid(input.business_id);
    const claimantName = clean(input.claimant_name || input.name);
    const claimantPhone = normalizePhone(input.claimant_phone || input.phone);
    const claimantEmail = clean(input.claimant_email || input.email).toLowerCase();
    const claimantRole = clean(input.claimant_role || input.role);
    const proofUrl = normalizePublicUrl(input.proof_url);
    const proofNotes = clean(input.proof_notes || input.notes);
    const allowedRoles = new Set(['owner', 'director', 'employee', 'authorised_agent']);
    const errors = [];
    if (!businessId) errors.push('Choose a valid Marketplace business.');
    if (claimantName.length < 2) errors.push('Claimant name is required.');
    if (!claimantPhone || !isValidPhone(claimantPhone)) errors.push('Enter a valid claimant phone number.');
    if (claimantEmail && !isValidEmail(claimantEmail)) errors.push('Enter a valid claimant email address.');
    if (!allowedRoles.has(claimantRole)) errors.push('Choose your relationship to the business.');
    if (clean(input.proof_url) && !proofUrl) errors.push('Proof URL must be a valid HTTP or HTTPS URL.');
    if (proofNotes.length < 20) errors.push('Explain how the team can verify ownership in at least 20 characters.');
    if (errors.length) return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });

    const businessResult = await db.query(
      `SELECT id, name, category, district, tier, status
       FROM marketplace_businesses
       WHERE id = $1 AND status = 'live'
       LIMIT 1`,
      [businessId]
    );
    const business = businessResult.rows[0];
    if (!business) return res.status(404).json({ ok: false, error: 'Marketplace business not found.' });
    if (business.tier !== 'found_online') {
      return res.status(409).json({ ok: false, error: 'This business is already privately listed or verified.' });
    }
    const duplicate = await db.query(
      `SELECT id, reference
       FROM marketplace_claims
       WHERE business_id = $1 AND status = 'pending_review'
         AND (claimant_phone = $2 OR ($3 <> '' AND claimant_email = $3))
       LIMIT 1`,
      [businessId, claimantPhone, claimantEmail]
    );
    if (duplicate.rows[0]) {
      return res.status(409).json({ ok: false, error: 'A claim from this contact is already under review.', reference: duplicate.rows[0].reference });
    }
    const reference = claimReference();
    const result = await db.query(
      `INSERT INTO marketplace_claims (
         business_id, reference, claimant_name, claimant_phone, claimant_email,
         claimant_role, proof_url, proof_notes, language
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, reference, business_id, status, created_at`,
      [businessId, reference, claimantName, claimantPhone, claimantEmail || null, claimantRole, proofUrl || null, proofNotes, clean(input.language) || 'en']
    );
    const claim = result.rows[0];
    await recordMarketplaceEvent(db, {
      businessId,
      eventType: 'business_claim_submitted',
      metadata: { claim_id: claim.id, reference, claimant_role: claimantRole }
    });
    const crmLead = await createLead(db, {
      source: 'marketplace_claim',
      leadType: 'marketplace_business_claim',
      category: business.category,
      location: business.district,
      message: `Marketplace claim ${reference}: ${business.name}`,
      contact: { name: claimantName, phone: claimantPhone, email: claimantEmail },
      metadata: { marketplace_claim_id: claim.id, marketplace_business_id: businessId, marketplace_reference: reference }
    });
    await logNotification(db, {
      channel: 'in_app',
      type: 'marketplace_business_claim',
      status: 'logged',
      recipientPhone: claimantPhone,
      recipientEmail: claimantEmail || null,
      relatedLeadId: crmLead?.id || null,
      payloadSummary: { marketplace_claim_id: claim.id, marketplace_business_id: businessId, reference }
    });
    return res.status(201).json({ ok: true, data: { marker: MARKETPLACE_REPORT_FIXES_MARKER, reference, claim } });
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
    const ownerName = clean(input.owner_name || input.contact_name);
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
    if (ownerName.length < 2) errors.push('Contact person name is required.');
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
         tier, status, source_type, source_metadata, registration_reference,
         owner_name, owner_phone, owner_email, owner_language
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,'private','pending_review','private',$14::jsonb,$15,$16,$17,$18,$19)
       RETURNING id, name, slug, category, district, area, tier, status, created_at,
                 registration_reference, owner_name, owner_phone, owner_email, owner_language,
                 phone, whatsapp, email`,
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
        JSON.stringify({ registration_reference: reference, language: clean(input.language) || 'en' }),
        reference,
        ownerName,
        whatsapp || phone,
        email || null,
        clean(input.language) || 'en'
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
    const acknowledgement = await sendMarketplaceRegistrationAcknowledgement(db, business, reference);
    await recordMarketplaceEvent(db, {
      businessId: business.id,
      eventType: 'business_registration_acknowledgement_attempted',
      metadata: {
        reference,
        sent: Boolean(acknowledgement.sent),
        channel: acknowledgement.channel || null,
        failure_reason: acknowledgement.failure_reason || null
      }
    });
    return res.status(201).json({
      ok: true,
      data: {
        marker: MARKETPLACE_REGJOURNEY_MARKER,
        reference,
        review_target_hours: 24,
        acknowledgement: {
          sent: Boolean(acknowledgement.sent),
          channel: acknowledgement.channel || null,
          status: notificationStatusFromDelivery(acknowledgement.delivery || acknowledgement)
        },
        business
      }
    });
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
       RETURNING id, category, district, area, status, created_at`,
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
    setImmediate(() => {
      notifyMarketplaceLeadOpportunity(db, lead).catch(() => {});
    });
    return res.status(201).json({ ok: true, data: { marker: MARKETPLACE_P1_MARKER, lead } });
  } catch (error) {
    return next(error);
  }
});

router.get('/businesses/:id/details', async (req, res, next) => {
  try {
    const businessId = normalizeUuid(req.params.id);
    if (!businessId) return res.status(400).json({ ok: false, error: 'Choose a valid Marketplace business.' });
    const result = await db.query(
      `SELECT id, name, slug, category, description, district, area, serves_regions,
              phone, whatsapp, email, website, social_links, ursb_number, tier,
              rating_avg, rating_count, source_type, source, source_url,
              source_place_id, source_metadata, first_seen, last_refreshed, updated_at
       FROM marketplace_businesses
       WHERE id = $1 AND status = 'live'
       LIMIT 1`,
      [businessId]
    );
    const business = result.rows[0];
    if (!business) return res.status(404).json({ ok: false, error: 'Marketplace business not found.' });
    await db.query(
      `UPDATE marketplace_businesses
       SET profile_view_count = profile_view_count + 1, last_profile_viewed_at = NOW()
       WHERE id = $1`,
      [business.id]
    );
    const publicProfile = publicBusiness(business);
    if (business.source !== 'google_maps' || business.source_type !== 'found_online') {
      return res.json({ ok: true, data: { marker: MARKETPLACE_ENRICH_MARKER, business: publicProfile, enrichment: null, meta: { applicable: false } } });
    }
    const metadata = safeObject(business.source_metadata);
    const placeId = clean(business.source_place_id || metadata.google_place_id);
    if (!placeId) {
      return res.json({ ok: true, data: { marker: MARKETPLACE_ENRICH_MARKER, business: publicProfile, enrichment: null, meta: { applicable: true, available: false, reason: 'missing_place_id' } } });
    }
    try {
      const enrichment = await getGooglePlaceDetails(placeId);
      if (enrichment?.business_status === 'permanently_closed') {
        await db.query(
          `UPDATE marketplace_businesses
           SET status = 'hidden', moderation_notes = 'Automatically hidden: Google reports permanently closed.', last_refreshed = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [business.id]
        );
        await recordMarketplaceEvent(db, {
          businessId: business.id,
          eventType: 'business_hidden_permanently_closed',
          metadata: { source: 'google_maps', place_id: placeId }
        });
        invalidateMarketplaceStats();
        return res.status(410).json({ ok: false, error: 'This business is permanently closed and has been removed from the directory.' });
      }
      await db.query(
        `UPDATE marketplace_businesses
         SET source_place_id = COALESCE(source_place_id, $2),
             phone = COALESCE(NULLIF(phone, ''), NULLIF($3, '')),
             whatsapp = COALESCE(NULLIF(whatsapp, ''), NULLIF($3, '')),
             website = COALESCE(NULLIF(website, ''), NULLIF($4, '')),
             source_url = COALESCE(NULLIF($5, ''), source_url),
             source_urls = CASE WHEN NULLIF($5, '') IS NULL THEN source_urls ELSE ARRAY(SELECT DISTINCT unnest(source_urls || ARRAY[$5]::text[])) END,
             last_refreshed = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [business.id, placeId, enrichment.international_phone, enrichment.website, enrichment.google_maps_url]
      );
      return res.json({
        ok: true,
        data: {
          marker: MARKETPLACE_ENRICH_MARKER,
          business: {
            ...publicProfile,
            phone: publicProfile.phone || enrichment.international_phone || null,
            whatsapp: publicProfile.whatsapp || enrichment.international_phone || null,
            website: publicProfile.website || enrichment.website || null,
            source_url: enrichment.google_maps_url || publicProfile.source_url,
            last_refreshed: new Date().toISOString()
          },
          enrichment,
          meta: { applicable: true, available: true, cache_status: enrichment.cache_status }
        }
      });
    } catch (error) {
      return res.json({
        ok: true,
        data: {
          marker: MARKETPLACE_ENRICH_MARKER,
          business: publicProfile,
          enrichment: null,
          meta: {
            applicable: true,
            available: false,
            reason: error.code || 'google_details_unavailable'
          }
        }
      });
    }
  } catch (error) {
    return next(error);
  }
});

router.post('/manage/resolve', async (req, res, next) => {
  try {
    const business = await resolveMarketplaceEditToken(db, req.body?.token);
    if (!business) return res.status(401).json({ ok: false, error: 'This edit link is invalid or has expired.' });
    return res.json({
      ok: true,
      data: {
        marker: MARKETPLACE_REGJOURNEY_MARKER,
        business: {
          id: business.id,
          name: business.name,
          slug: business.slug,
          category: business.category,
          description: business.description,
          services_text: business.services_text,
          district: business.district,
          area: business.area,
          serves_regions: business.serves_regions || [],
          phone: business.phone,
          whatsapp: business.whatsapp,
          email: business.email,
          website: business.website,
          social_links: business.social_links || {},
          profile_images: business.profile_images || [],
          tier: business.tier,
          status: business.status,
          profile_view_count: Number(business.profile_view_count || 0),
          updated_at: business.updated_at
        },
        paid_verification_enabled: false,
        verified_waitlist_url: `/marketplace?verified_waitlist=1&business=${encodeURIComponent(business.slug)}`
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/manage/update', async (req, res, next) => {
  try {
    const business = await resolveMarketplaceEditToken(db, req.body?.token);
    if (!business) return res.status(401).json({ ok: false, error: 'This edit link is invalid or has expired.' });
    const input = req.body || {};
    const name = clean(input.name);
    const description = clean(input.description);
    const servicesText = clean(input.services_text);
    const phone = normalizePhone(input.phone);
    const whatsapp = normalizePhone(input.whatsapp || input.phone);
    const email = clean(input.email).toLowerCase();
    const website = normalizePublicUrl(input.website);
    const location = validateUgandaLocation({ district: input.district || business.district, area: input.area });
    const socialLinks = Object.fromEntries(
      Object.entries(safeObject(input.social_links))
        .map(([key, value]) => [clean(key).toLowerCase().slice(0, 32), normalizePublicUrl(value)])
        .filter(([key, value]) => key && value)
        .slice(0, 8)
    );
    const profileImages = [];
    for (const [index, rawImage] of (Array.isArray(input.profile_images) ? input.profile_images : []).slice(0, 4).entries()) {
      const raw = clean(rawImage);
      const stored = isDataUrl(raw)
        ? await prepareMediaUrlForStorage(raw, {
          allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
          maxBytes: 2_500_000,
          keyPrefix: `marketplace/${business.id}/profile`,
          filename: `business-photo-${index + 1}`,
          label: `Marketplace business photo ${index + 1}`
        })
        : raw;
      const publicUrl = normalizePublicUrl(stored);
      if (isDataUrl(raw) && !publicUrl) {
        return res.status(503).json({ ok: false, error: 'Business photo storage is temporarily unavailable. Try again shortly.' });
      }
      if (publicUrl) profileImages.push(publicUrl);
    }
    const errors = [];
    if (name.length < 2) errors.push('Business name is required.');
    if (description.length < 20) errors.push('Add a description of at least 20 characters.');
    if (!location.ok) errors.push(location.error);
    if (!phone || !isValidPhone(phone)) errors.push('Enter a valid phone number.');
    if (email && !isValidEmail(email)) errors.push('Enter a valid email address.');
    if (clean(input.website) && !website) errors.push('Website must be a valid HTTP or HTTPS URL.');
    if (isCompetitorPortal({ ...input, name, website, description, social_links: socialLinks })) errors.push('Competing property portals cannot be registered as service providers.');
    if (errors.length) return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });
    const result = await db.query(
      `UPDATE marketplace_businesses
       SET name = $2, description = $3, services_text = NULLIF($4, ''),
           district = $5, area = NULLIF($6, ''), serves_regions = $7,
           phone = $8, whatsapp = $9, email = NULLIF($10, ''),
           website = NULLIF($11, ''), social_links = $12::jsonb,
           profile_images = $13, owner_phone = $9, owner_email = NULLIF($10, ''),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, name, slug, category, description, services_text, district, area,
                 serves_regions, phone, whatsapp, email, website, social_links,
                 profile_images, tier, status, updated_at`,
      [
        business.id,
        name,
        description,
        servicesText,
        location.district,
        clean(input.area),
        safeArray(input.serves_regions),
        phone,
        whatsapp || phone,
        email,
        website,
        JSON.stringify(socialLinks),
        profileImages
      ]
    );
    await recordMarketplaceEvent(db, {
      businessId: business.id,
      eventType: 'business_profile_updated_by_owner_magic_link',
      metadata: { changed_at: new Date().toISOString() }
    });
    invalidateMarketplaceStats();
    return res.json({ ok: true, data: { marker: MARKETPLACE_REGJOURNEY_MARKER, business: result.rows[0] } });
  } catch (error) {
    return next(error);
  }
});

router.post('/verified-waitlist', async (req, res, next) => {
  try {
    const input = req.body || {};
    let businessId = normalizeUuid(input.business_id);
    const businessSlug = clean(input.business_slug);
    const name = clean(input.name);
    const phone = normalizePhone(input.phone);
    const email = clean(input.email).toLowerCase();
    if (name.length < 2) return res.status(400).json({ ok: false, error: 'Add your name or business name.' });
    if (!phone && !email) return res.status(400).json({ ok: false, error: 'Add a phone number or email.' });
    if (phone && !isValidPhone(phone)) return res.status(400).json({ ok: false, error: 'Enter a valid phone number.' });
    if (email && !isValidEmail(email)) return res.status(400).json({ ok: false, error: 'Enter a valid email address.' });
    if (clean(input.business_id) && !businessId) return res.status(400).json({ ok: false, error: 'Choose a valid Marketplace business.' });
    if (!businessId && businessSlug) {
      const businessResult = await db.query(
        `SELECT id FROM marketplace_businesses WHERE slug = $1 AND status = 'live' LIMIT 1`,
        [businessSlug]
      );
      businessId = businessResult.rows[0]?.id || null;
    }
    const duplicate = await db.query(
      `SELECT id FROM marketplace_verified_waitlist
       WHERE created_at > NOW() - INTERVAL '30 days'
         AND (($1::uuid IS NOT NULL AND business_id = $1) OR ($2 <> '' AND phone = $2) OR ($3 <> '' AND email = $3))
       LIMIT 1`,
      [businessId || null, phone || '', email || '']
    );
    if (duplicate.rows[0]) {
      return res.json({ ok: true, data: { marker: MARKETPLACE_REGJOURNEY_MARKER, waitlist_id: duplicate.rows[0].id, already_joined: true } });
    }
    const result = await db.query(
      `INSERT INTO marketplace_verified_waitlist (business_id, name, phone, email, language, source)
       VALUES ($1,$2,$3,$4,$5,'marketplace_verified_waitlist')
       RETURNING id, status, created_at`,
      [businessId || null, name, phone || null, email || null, clean(input.language) || 'en']
    );
    const waitlist = result.rows[0];
    const crmLead = await createLead(db, {
      source: 'marketplace_verified_waitlist',
      leadType: 'marketplace_verified_interest',
      category: 'marketplace_verification',
      message: `${name} joined the Marketplace Verified waitlist.`,
      contact: { name, phone, email },
      metadata: { marketplace_waitlist_id: waitlist.id, marketplace_business_id: businessId || null }
    });
    await logNotification(db, {
      channel: 'in_app',
      type: 'marketplace_verified_waitlist_joined',
      status: 'logged',
      recipientPhone: phone || null,
      recipientEmail: email || null,
      relatedLeadId: crmLead?.id || null,
      payloadSummary: { marketplace_waitlist_id: waitlist.id, marketplace_business_id: businessId || null }
    });
    if (businessId) {
      await recordMarketplaceEvent(db, { businessId, eventType: 'business_joined_verified_waitlist', metadata: { waitlist_id: waitlist.id } });
    }
    return res.status(201).json({ ok: true, data: { marker: MARKETPLACE_REGJOURNEY_MARKER, waitlist } });
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
              phone, whatsapp, email, website, social_links, profile_images, ursb_number, tier,
              status, source_type, source_url, source_urls, source_metadata,
              registration_reference, owner_name, owner_phone, owner_email, owner_language,
              moderation_notes, rejection_reason_code, rejection_message,
              reviewed_by, reviewed_at, created_at, updated_at
       FROM marketplace_businesses
       WHERE status = $1
       ORDER BY created_at ASC
       LIMIT $2`,
      [status, limit]
    );
    const claims = await db.query(
      `SELECT c.id, c.reference, c.business_id, c.claimant_name, c.claimant_phone,
              c.claimant_email, c.claimant_role, c.proof_url, c.proof_notes,
              c.language, c.status, c.moderation_reason, c.created_at,
              b.name AS business_name, b.category, b.district, b.area, b.source_url
       FROM marketplace_claims c
       JOIN marketplace_businesses b ON b.id = c.business_id
       WHERE c.status = 'pending_review'
       ORDER BY c.created_at ASC
       LIMIT $1`,
      [limit]
    );
    return res.json({ ok: true, data: { marker: MARKETPLACE_REPORT_FIXES_MARKER, status, businesses: result.rows, claims: claims.rows } });
  } catch (error) {
    return next(error);
  }
});

router.patch('/admin/claims/:id/status', requireListingModerationAccess, async (req, res, next) => {
  const requested = clean(req.body?.status).toLowerCase();
  const status = requested === 'approve' || requested === 'approved' ? 'approved' : requested === 'reject' || requested === 'rejected' ? 'rejected' : '';
  const reason = clean(req.body?.reason || req.body?.notes);
  const reasonCode = clean(req.body?.reason_code).toLowerCase();
  if (!status) return res.status(400).json({ ok: false, error: 'Choose approve or reject.' });
  if (status === 'rejected' && reason.length < 3) return res.status(400).json({ ok: false, error: 'A rejection reason is required.' });
  if (status === 'rejected' && !REJECTION_REASONS[reasonCode]) return res.status(400).json({ ok: false, error: 'Choose a structured rejection reason.', reasons: REJECTION_REASONS });
  const actorId = req.userAuth?.id || req.adminAuth?.userId || null;
  const client = await db.pool.connect();
  let notification = null;
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT c.*, b.name AS business_name, b.slug AS business_slug,
              b.category AS business_category, b.district AS business_district,
              b.phone AS business_phone, b.whatsapp AS business_whatsapp, b.email AS business_email
       FROM marketplace_claims c
       JOIN marketplace_businesses b ON b.id = c.business_id
       WHERE c.id = $1 AND c.status = 'pending_review'
       FOR UPDATE`,
      [req.params.id]
    );
    const claim = current.rows[0];
    if (!claim) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Pending Marketplace claim not found.' });
    }
    await client.query(
      `UPDATE marketplace_claims
       SET status = $2, moderation_reason = NULLIF($3, ''), reviewed_by = $4, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [claim.id, status, reason, actorId]
    );
    if (status === 'approved') {
      const converted = await client.query(
        `UPDATE marketplace_businesses
         SET tier = 'private', source_type = 'private', status = 'live',
             owner_name = $4, owner_phone = $5, owner_email = NULLIF($6, ''), owner_language = $7,
             reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW(),
             source_metadata = COALESCE(source_metadata, '{}'::jsonb) || jsonb_build_object(
               'approved_claim', jsonb_build_object(
                 'claim_id', $3::text,
                 'claimant_name', $4::text,
                 'claimant_phone', $5::text,
                 'claimant_email', COALESCE($6::text, ''),
                 'approved_at', NOW()
               )
             )
         WHERE id = $1
         RETURNING *`,
        [claim.business_id, actorId, claim.id, claim.claimant_name, claim.claimant_phone, claim.claimant_email, claim.language || 'en']
      );
      claim.converted_business = converted.rows[0] || null;
    }
    await recordMarketplaceEvent(client, {
      businessId: claim.business_id,
      actorUserId: actorId,
      eventType: `business_claim_${status}`,
      metadata: { claim_id: claim.id, reference: claim.reference, reason_code: reasonCode || null, reason }
    });
    await client.query('COMMIT');
    invalidateMarketplaceStats();
    if (status === 'approved' && claim.converted_business) {
      notification = await sendMarketplaceApprovalNotification(db, claim.converted_business, {
        claimId: claim.id,
        actorUserId: actorId
      });
    } else if (status === 'rejected') {
      notification = await sendMarketplaceRejectionNotification(db, {
        id: claim.business_id,
        name: claim.business_name,
        slug: claim.business_slug,
        category: claim.business_category,
        district: claim.business_district,
        phone: claim.business_phone,
        whatsapp: claim.claimant_phone || claim.business_whatsapp,
        email: claim.claimant_email || claim.business_email,
        owner_phone: claim.claimant_phone,
        owner_email: claim.claimant_email,
        owner_language: claim.language || 'en'
      }, { reasonCode, reason, triggerSuffix: claim.id });
    }
    return res.json({
      ok: true,
      data: {
        marker: MARKETPLACE_REPORT_FIXES_MARKER,
        claim: { id: claim.id, reference: claim.reference, business_id: claim.business_id, status, moderation_reason: reason || null },
        notification
      }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
});

router.patch('/admin/:id/status', requireListingModerationAccess, async (req, res, next) => {
  try {
    const requested = clean(req.body?.status).toLowerCase();
    const statusMap = { approve: 'live', approved: 'live', live: 'live', reject: 'hidden', rejected: 'hidden', hidden: 'hidden', remove: 'removed', removed: 'removed', pending: 'pending_review', pending_review: 'pending_review' };
    const status = statusMap[requested];
    if (!status) return res.status(400).json({ ok: false, error: 'Choose approve, hide, remove, or pending review.' });
    const notes = clean(req.body?.notes || req.body?.reason);
    const reasonCode = clean(req.body?.reason_code).toLowerCase();
    if (['hidden', 'removed'].includes(status) && notes.length < 3) {
      return res.status(400).json({ ok: false, error: 'A moderation reason is required.' });
    }
    if (['reject', 'rejected'].includes(requested) && !REJECTION_REASONS[reasonCode]) {
      return res.status(400).json({ ok: false, error: 'Choose a structured rejection reason.', reasons: REJECTION_REASONS });
    }
    const result = await db.query(
      `UPDATE marketplace_businesses
       SET status = $2,
           tier = CASE WHEN $2 = 'live' AND tier = 'verified' THEN 'verified' WHEN $2 = 'live' AND tier = 'found_online' THEN 'found_online' WHEN $2 = 'live' THEN 'private' ELSE tier END,
           moderation_notes = NULLIF($3, ''),
           reviewed_by = $4,
           reviewed_at = NOW(),
           rejection_reason_code = CASE WHEN $2 = 'hidden' THEN NULLIF($5, '') ELSE NULL END,
           rejection_message = CASE WHEN $2 = 'hidden' THEN NULLIF($3, '') ELSE NULL END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id, status, notes, req.userAuth?.id || req.adminAuth?.userId || null, reasonCode]
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
    let notification = null;
    const hasOwnerContact = Boolean(business.owner_phone || business.owner_email || (business.source_type === 'private' && (business.whatsapp || business.phone || business.email)));
    if (status === 'live' && hasOwnerContact && !business.approval_notification_sent_at) {
      notification = await sendMarketplaceApprovalNotification(db, business, {
        actorUserId: req.userAuth?.id || req.adminAuth?.userId || null
      });
    } else if (['reject', 'rejected'].includes(requested) && hasOwnerContact) {
      notification = await sendMarketplaceRejectionNotification(db, business, { reasonCode, reason: notes });
    }
    return res.json({ ok: true, data: { marker: MARKETPLACE_REGJOURNEY_MARKER, business, notification } });
  } catch (error) {
    return next(error);
  }
});

router.get('/:slug', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, name, slug, category, description, district, area, serves_regions,
              phone, whatsapp, email, website, social_links, profile_images, ursb_number, tier,
              rating_avg, rating_count, source_type, source, source_url, source_place_id,
              first_seen, last_refreshed, profile_view_count, updated_at
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
    return res.json({ ok: true, data: { marker: MARKETPLACE_ENRICH_MARKER, business: publicBusiness(business), reviews: reviews.rows } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
