'use strict';

const express = require('express');
const db = require('../config/database');
const { requireAdminApiKey, requireStaffAccess } = require('../middleware/auth');
const {
  buildOffPlanPaymentSchedule,
  createEnquiry,
  createWalkthroughJob,
  deleteArchivedDevelopment,
  getManagedDevelopment,
  getPublicDevelopment,
  isPubliclyVisible,
  listEnquiries,
  listManagedDevelopments,
  listPublicDevelopments,
  normalizeDevelopmentRow,
  setDevelopmentStatus,
  updateEnquiryDelivery,
  updateEnquiryStatus,
  updateWalkthroughJob,
  writeDevelopment
} = require('../services/offPlanService');
const { brochureBuffer } = require('../services/offPlanBrochureService');
const { normalizeBrochureLanguage } = require('../services/offPlanBrochureI18n');
const { notifyOffPlanEnquiry } = require('../services/offPlanNotificationService');
const { prepareMediaUrlForStorage } = require('../services/cloudMediaStorageService');
const { readMortgageProviders } = require('./mortgage');

const publicRouter = express.Router();
const staffRouter = express.Router();
const adminRouter = express.Router();

function cleanText(value, max = 2000) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').slice(0, max);
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function actor(req) {
  return {
    actorId: req.userAuth?.id || req.staffAuth?.userId || req.adminAuth?.userId || null,
    actorRole: req.userAuth?.role || req.staffAuth?.role || req.adminAuth?.role || req.adminAuth?.type || null
  };
}

function booleanValue(value) {
  return value === true || ['1', 'true', 'yes', 'on'].includes(cleanText(value, 12).toLowerCase());
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleanText(value, 80));
}

function publicCountryCode(value) {
  return cleanText(value || 'UG', 2).toUpperCase() === 'KE' ? 'KE' : 'UG';
}

async function storeManagedMedia(items, { developmentId, folder, allowedMimeTypes, label }) {
  const source = Array.isArray(items) ? items : [];
  const stored = [];
  for (const [index, item] of source.slice(0, 20).entries()) {
    // Keep data URLs byte-for-byte intact; collapsing whitespace can corrupt
    // encoded uploads. The upper bound allows the media service to enforce its
    // own decoded 15 MB limit.
    const url = String(item?.url == null ? '' : item.url).trim().slice(0, 22_000_000);
    if (!url) continue;
    const storedUrl = url.startsWith('/assets/') ? url : await prepareMediaUrlForStorage(url, {
      keyPrefix: `off-plan/${developmentId}/${folder}`,
      filename: cleanText(item?.filename || item?.caption || `${folder}-${index + 1}`, 180),
      isPrivate: false,
      allowedMimeTypes,
      maxBytes: 15 * 1024 * 1024,
      label
    });
    stored.push({
      url: storedUrl,
      caption: cleanText(item?.caption || item?.filename || label, 300),
      kind: cleanText(item?.kind || (folder === 'floor-plans' ? 'floor_plan' : 'project_photo'), 80)
    });
  }
  return stored;
}

function whatsappEnquiryUrl(enquiry = {}, development = null) {
  const makaugManaged = development?.extra_fields?.contact_mode === 'makaug_managed';
  const projectAgentPhone = enquiry.enquiry_type === 'project_interest' && !makaugManaged
    ? cleanText(development?.source_agent_whatsapp || development?.source_agent_phone, 80)
    : '';
  const phone = String(projectAgentPhone || process.env.SUPPORT_PHONE || '+256760112587').replace(/\D/g, '') || '256760112587';
  const recipient = projectAgentPhone ? cleanText(development?.source_agent_name || 'project contact', 120) : 'makaug';
  const intro = cleanText(enquiry.name, 120) ? `Hi ${recipient}, my name is ${cleanText(enquiry.name, 120)}. ` : `Hi ${recipient}, my name is... `;
  const message = enquiry.enquiry_type === 'listing_request'
    ? `${intro}I would like to enquire about listing a new off-plan project.`
    : `${intro}I would like to enquire about ${cleanText(development?.name || 'this off-plan project', 220)}.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

publicRouter.get('/', asyncRoute(async (req, res) => {
  const developments = await listPublicDevelopments(db, req.query);
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  return res.json({ ok: true, developments, count: developments.length });
}));

publicRouter.get('/locations', asyncRoute(async (req, res) => {
  const countryCode = publicCountryCode(req.query.country_code || req.query.country);
  const result = await db.query(
    `SELECT * FROM off_plan_developments
     WHERE country_code = $1 AND status = 'published'
       AND (verification_status = 'verified' OR (verification_status = 'partially_verified' AND extra_fields->>'public_preview_approved' = 'true'))
     ORDER BY district, area`,
    [countryCode]
  );
  const counts = new Map();
  result.rows.map(normalizeDevelopmentRow).filter(isPubliclyVisible).forEach((project) => {
    const key = `${project.district || ''}\u0000${project.area || ''}`;
    const current = counts.get(key) || { district: project.district, area: project.area, project_count: 0 };
    current.project_count += 1;
    counts.set(key, current);
  });
  res.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=900');
  return res.json({ ok: true, locations: Array.from(counts.values()) });
}));

publicRouter.post('/calculate', (req, res) => {
  return res.json({ ok: true, schedule: buildOffPlanPaymentSchedule(req.body || {}) });
});

publicRouter.post('/enquiries', asyncRoute(async (req, res) => {
  const requestedDevelopmentId = cleanText(req.body?.development_id, 80);
  let development = null;
  if (requestedDevelopmentId) {
    if (!isUuid(requestedDevelopmentId)) return res.status(404).json({ ok: false, error: 'Off-plan project not found' });
    const publicMatch = await db.query(
      `SELECT slug, country_code FROM off_plan_developments
       WHERE id = $1 AND country_code = ANY(ARRAY['UG','KE']) AND status = 'published'
         AND (verification_status = 'verified' OR (verification_status = 'partially_verified' AND extra_fields->>'public_preview_approved' = 'true'))
       LIMIT 1`,
      [requestedDevelopmentId]
    );
    if (!publicMatch.rows[0]) return res.status(404).json({ ok: false, error: 'Off-plan project not found' });
    development = await getPublicDevelopment(db, publicMatch.rows[0].slug, publicMatch.rows[0].country_code);
  }
  const enquiry = await createEnquiry(db, {
    ...(req.body || {}),
    source_path: cleanText(req.body?.source_path || req.get('referer') || '/off-plan', 1000),
    metadata: {
      ...(req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {}),
      user_agent: cleanText(req.get('user-agent'), 300)
    }
  });
  const delivery = await notifyOffPlanEnquiry(enquiry, development);
  await updateEnquiryDelivery(db, enquiry.id, delivery);
  return res.status(201).json({
    ok: true,
    enquiry_id: enquiry.id,
    notification_received: true,
    notification_delivery: delivery.delivered ? 'sent' : 'queued_or_unavailable',
    whatsapp_url: enquiry.preferred_contact_channel === 'whatsapp' ? whatsappEnquiryUrl(enquiry, development) : null,
    message: 'Thank you. The makaug team has received your off-plan enquiry and will get in touch.'
  });
}));

publicRouter.get('/:slug/brochure.pdf', asyncRoute(async (req, res) => {
  const development = await getPublicDevelopment(db, req.params.slug, publicCountryCode(req.query.country));
  if (!development) return res.status(404).json({ ok: false, error: 'Off-plan project not found' });
  const [agentProfile, mortgagePayload] = await Promise.all([readBrochureAgentProfile(development), readMortgageProviders()]);
  const preferredKeys = development.extra_fields?.mortgage_provider_keys || ['stanbic', 'dfcu', 'kcb'];
  const mortgageProviders = (mortgagePayload.providers || []).filter((provider) => preferredKeys.includes(provider.key)).slice(0, 3);
  const language = normalizeBrochureLanguage(req.query.lang);
  const pdf = await brochureBuffer(development, { agentProfile, mortgageProviders, language });
  const fileName = `${development.slug}-${language}-makaug-brochure.pdf`;
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'public, max-age=300'
  });
  return res.send(pdf);
}));

publicRouter.get('/:slug', asyncRoute(async (req, res) => {
  const development = await getPublicDevelopment(db, req.params.slug, publicCountryCode(req.query.country));
  if (!development) return res.status(404).json({ ok: false, error: 'Off-plan project not found' });
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  return res.json({ ok: true, development });
}));

function mountManagementRoutes(router, authMiddleware, { allowPermanentDelete = false } = {}) {
  router.use(authMiddleware);

  router.get('/developments', asyncRoute(async (req, res) => {
    const developments = await listManagedDevelopments(db, req.query);
    return res.json({ ok: true, developments, count: developments.length });
  }));

  router.get('/developments/:id', asyncRoute(async (req, res) => {
    const development = await getManagedDevelopment(db, req.params.id);
    if (!development) return res.status(404).json({ ok: false, error: 'Off-plan project not found' });
    return res.json({ ok: true, development });
  }));

  router.get('/developments/:id/brochure.pdf', asyncRoute(async (req, res) => {
    const development = await getManagedDevelopment(db, req.params.id);
    if (!development) return res.status(404).json({ ok: false, error: 'Off-plan project not found' });
    const [agentProfile, mortgagePayload] = await Promise.all([readBrochureAgentProfile(development), readMortgageProviders()]);
    const preferredKeys = development.extra_fields?.mortgage_provider_keys || ['stanbic', 'dfcu', 'kcb'];
    const mortgageProviders = (mortgagePayload.providers || []).filter((provider) => preferredKeys.includes(provider.key)).slice(0, 3);
    const language = normalizeBrochureLanguage(req.query.lang);
    const pdf = await brochureBuffer(development, { agentProfile, mortgageProviders, language });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${development.slug}-${language}-makaug-review-brochure.pdf"`,
      'Cache-Control': 'private, no-store'
    });
    return res.send(pdf);
  }));

  router.post('/developments', asyncRoute(async (req, res) => {
    const development = await writeDevelopment(db, req.body || {}, actor(req));
    return res.status(201).json({ ok: true, development });
  }));

  router.patch('/developments/:id', asyncRoute(async (req, res) => {
    const development = await writeDevelopment(db, req.body || {}, { id: req.params.id, ...actor(req) });
    if (!development) return res.status(404).json({ ok: false, error: 'Off-plan project not found' });
    return res.json({ ok: true, development });
  }));

  if (allowPermanentDelete) {
    router.delete('/developments/:id', asyncRoute(async (req, res) => {
      try {
        const development = await deleteArchivedDevelopment(db, req.params.id, actor(req));
        if (!development) return res.status(404).json({ ok: false, error: 'Off-plan project not found' });
        return res.json({ ok: true, development });
      } catch (error) {
        if (error.status === 409) return res.status(409).json({ ok: false, error: error.message });
        throw error;
      }
    }));
  }

  router.post('/developments/:id/images', asyncRoute(async (req, res) => {
    if (!booleanValue(req.body?.confirm_rights)) return res.status(400).json({ ok: false, error: 'Image rights confirmation is required' });
    const development = await getManagedDevelopment(db, req.params.id);
    if (!development) return res.status(404).json({ ok: false, error: 'Off-plan project not found' });
    const images = await storeManagedMedia(req.body?.images, { developmentId: req.params.id, folder: 'images', allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'], label: 'Off-plan project image' });
    if (!images.length) return res.status(400).json({ ok: false, error: 'At least one image is required' });
    const updated = await writeDevelopment(db, { images: [...development.images, ...images] }, { id: req.params.id, ...actor(req) });
    return res.status(201).json({ ok: true, development: updated, images });
  }));

  router.post('/developments/:id/floor-plans', asyncRoute(async (req, res) => {
    if (!booleanValue(req.body?.confirm_rights)) return res.status(400).json({ ok: false, error: 'Floor-plan rights confirmation is required' });
    const development = await getManagedDevelopment(db, req.params.id);
    if (!development) return res.status(404).json({ ok: false, error: 'Off-plan project not found' });
    const floorPlans = await storeManagedMedia(req.body?.floor_plans, { developmentId: req.params.id, folder: 'floor-plans', allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], label: 'Off-plan floor plan' });
    if (!floorPlans.length) return res.status(400).json({ ok: false, error: 'At least one floor plan is required' });
    const updated = await writeDevelopment(db, { floor_plans: [...development.floor_plans, ...floorPlans] }, { id: req.params.id, ...actor(req) });
    return res.status(201).json({ ok: true, development: updated, floor_plans: floorPlans });
  }));

  router.post('/developments/:id/status', asyncRoute(async (req, res) => {
    try {
      const development = await setDevelopmentStatus(db, req.params.id, req.body?.status, actor(req));
      if (!development) return res.status(404).json({ ok: false, error: 'Off-plan project not found' });
      return res.json({ ok: true, development });
    } catch (error) {
      if (error.status === 409) return res.status(409).json({ ok: false, error: error.message, blockers: error.details || [] });
      throw error;
    }
  }));

  router.get('/enquiries', asyncRoute(async (req, res) => {
    const enquiries = await listEnquiries(db, req.query);
    return res.json({ ok: true, enquiries, count: enquiries.length });
  }));

  router.patch('/enquiries/:id/status', asyncRoute(async (req, res) => {
    const enquiry = await updateEnquiryStatus(db, req.params.id, req.body?.status, actor(req).actorId);
    if (!enquiry) return res.status(404).json({ ok: false, error: 'Enquiry not found' });
    return res.json({ ok: true, enquiry });
  }));

  router.post('/developments/:id/walkthroughs', asyncRoute(async (req, res) => {
    const development = await getManagedDevelopment(db, req.params.id);
    if (!development) return res.status(404).json({ ok: false, error: 'Off-plan project not found' });
    const walkthrough = await createWalkthroughJob(db, req.params.id, req.body || {}, actor(req));
    return res.status(201).json({ ok: true, walkthrough });
  }));

  router.patch('/walkthroughs/:id', asyncRoute(async (req, res) => {
    const walkthrough = await updateWalkthroughJob(db, req.params.id, req.body || {}, actor(req));
    if (!walkthrough) return res.status(404).json({ ok: false, error: 'Walkthrough job not found' });
    return res.json({ ok: true, walkthrough });
  }));
}

async function readBrochureAgentProfile(development = {}) {
  if (!development.source_agent_id && !development.source_agent_profile_id) return null;
  const agentId = development.source_agent_profile_id || development.source_agent_id;
  const agent = await db.query(
    `SELECT id, full_name, company_name, bio, phone, whatsapp, email, profile_photo_url
     FROM agents
     WHERE id = $1 AND status = 'approved'
     LIMIT 1`,
    [agentId]
  );
  if (!agent.rows[0]) return null;
  const listings = await db.query(
    `SELECT p.id, p.title, p.area, p.district, p.price, p.price_currency,
            img.url AS primary_image_url
     FROM properties p
     LEFT JOIN LATERAL (
       SELECT i.url FROM property_images i
       WHERE i.property_id = p.id
       ORDER BY i.is_primary DESC, i.sort_order ASC, i.created_at ASC
       LIMIT 1
     ) img ON true
     WHERE p.agent_id = $1 AND p.status = 'approved'
     ORDER BY COALESCE(p.approved_at, p.updated_at, p.created_at) DESC
     LIMIT 10`,
    [agentId]
  );
  return { ...agent.rows[0], listings: listings.rows };
}

mountManagementRoutes(staffRouter, requireStaffAccess);
mountManagementRoutes(adminRouter, requireAdminApiKey, { allowPermanentDelete: true });

module.exports = {
  adminRouter,
  publicRouter,
  staffRouter,
  whatsappEnquiryUrl
};
