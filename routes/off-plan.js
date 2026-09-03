'use strict';

const express = require('express');
const db = require('../config/database');
const { requireAdminApiKey, requireStaffAccess } = require('../middleware/auth');
const {
  buildOffPlanPaymentSchedule,
  createEnquiry,
  createWalkthroughJob,
  getManagedDevelopment,
  getPublicDevelopment,
  isPublicationReady,
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
const { notifyOffPlanEnquiry } = require('../services/offPlanNotificationService');
const { prepareMediaUrlForStorage } = require('../services/cloudMediaStorageService');

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
  const phone = String(process.env.SUPPORT_PHONE || '+256760112587').replace(/\D/g, '') || '256760112587';
  const intro = cleanText(enquiry.name, 120) ? `Hi makaug, my name is ${cleanText(enquiry.name, 120)}. ` : 'Hi makaug, my name is... ';
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

publicRouter.get('/locations', asyncRoute(async (_req, res) => {
  const result = await db.query(
    `SELECT * FROM off_plan_developments
     WHERE country_code = 'UG' AND status = 'published' AND verification_status = 'verified'
     ORDER BY district, area`
  );
  const counts = new Map();
  result.rows.map(normalizeDevelopmentRow).filter(isPublicationReady).forEach((project) => {
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
      `SELECT slug FROM off_plan_developments
       WHERE id = $1 AND country_code = 'UG' AND status = 'published' AND verification_status = 'verified'
       LIMIT 1`,
      [requestedDevelopmentId]
    );
    if (!publicMatch.rows[0]) return res.status(404).json({ ok: false, error: 'Off-plan project not found' });
    development = await getPublicDevelopment(db, publicMatch.rows[0].slug);
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
  const development = await getPublicDevelopment(db, req.params.slug);
  if (!development) return res.status(404).json({ ok: false, error: 'Off-plan project not found' });
  const pdf = await brochureBuffer(development);
  const fileName = `${development.slug}-makaug-brochure.pdf`;
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'public, max-age=300'
  });
  return res.send(pdf);
}));

publicRouter.get('/:slug', asyncRoute(async (req, res) => {
  const development = await getPublicDevelopment(db, req.params.slug);
  if (!development) return res.status(404).json({ ok: false, error: 'Off-plan project not found' });
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  return res.json({ ok: true, development });
}));

function mountManagementRoutes(router, authMiddleware) {
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
    const pdf = await brochureBuffer(development);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${development.slug}-makaug-review-brochure.pdf"`,
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

mountManagementRoutes(staffRouter, requireStaffAccess);
mountManagementRoutes(adminRouter, requireAdminApiKey);

module.exports = {
  adminRouter,
  publicRouter,
  staffRouter,
  whatsappEnquiryUrl
};
